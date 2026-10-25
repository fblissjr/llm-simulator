import {
  type GenerateJsonOptions,
  type LLMProvider,
  parseJsonLoose,
  type ProviderModelInfo,
  type StreamTextOptions,
} from "../types.ts";

interface HeylookModelRow {
  id: string;
  provider?: "mlx" | "gguf" | string;
  capabilities?: string[];
  modalities?: string[];
  thinking_default?: boolean;
}

interface HeylookContentBlock {
  type: "text" | "thinking" | string;
  text?: string;
  thinking?: string;
}

export class HeylookProvider implements LLMProvider {
  public readonly id = "heylook" as const;
  public readonly displayName =
    "heylookitsanllm (Local MLX / GGUF /v1/messages)";
  public baseUrl: string;
  private _activeModel: string;
  private cachedModels: ProviderModelInfo[] = [];
  private reachable = false;

  constructor(options?: { baseUrl?: string; model?: string }) {
    this.baseUrl = (
      options?.baseUrl ||
      process.env.HEYLOOK_URL ||
      process.env.HEYLOOK_BASE_URL ||
      "http://127.0.0.1:8000"
    ).replace(/\/+$/, "");
    this._activeModel =
      options?.model || process.env.HEYLOOK_MODEL || "auto";
  }

  public get defaultModel(): string {
    return this._activeModel;
  }

  public set defaultModel(model: string) {
    this._activeModel = model;
  }

  /**
   * Reuse the single active local model for both Director routing and Persona streaming
   * so max_loaded_models = 1 never evicts/reloads weights between turns.
   */
  public get fastModel(): string {
    return this._activeModel;
  }

  public set fastModel(model: string) {
    this._activeModel = model;
  }

  public isConfigured(): boolean {
    return (
      this.reachable ||
      this.cachedModels.length > 0 ||
      Boolean(process.env.HEYLOOK_URL || process.env.HEYLOOK_BASE_URL || process.env.HEYLOOK_MODEL)
    );
  }

  public getCachedModels(): ProviderModelInfo[] {
    return this.cachedModels;
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`);
      if (!res.ok) {
        return this.cachedModels;
      }
      this.reachable = true;
      const body = (await res.json()) as
        | { data?: HeylookModelRow[] }
        | HeylookModelRow[];
      const rows = Array.isArray(body) ? body : (body.data ?? []);

      this.cachedModels = rows.map((row) => ({
        id: row.id,
        name: row.id,
        provider: "heylook",
        runtime: row.provider ?? "mlx",
        capabilities: row.capabilities ?? ["chat"],
        description: `${(row.provider ?? "local").toUpperCase()} • capabilities: ${(row.capabilities ?? ["chat"]).join(", ")}`,
      }));

      if (
        (this._activeModel === "auto" || !this._activeModel) &&
        this.cachedModels.length > 0
      ) {
        const chatModel =
          this.cachedModels.find((m) => m.capabilities?.includes("chat")) ??
          this.cachedModels[0]!;
        this._activeModel = chatModel.id;
      }
    } catch {
      // Server may not be running right now
    }
    return this.cachedModels;
  }

  public async resolveActiveModel(requestedModel?: string): Promise<string> {
    if (
      requestedModel &&
      requestedModel !== "auto" &&
      requestedModel !== "gemini-3.8-flash" &&
      requestedModel !== "gemini-3.5-flash-lite"
    ) {
      return requestedModel;
    }

    if (this._activeModel && this._activeModel !== "auto") {
      return this._activeModel;
    }

    const models = await this.listModels();
    if (models.length === 0) {
      throw new Error(
        `No models discovered on heylookitsanllm at ${this.baseUrl}/v1/models. Is 'heylookllm' running?`
      );
    }
    return this._activeModel;
  }

  /**
   * Explicitly preloads a model on heylookitsanllm via POST /v1/models/{id}/load.
   */
  public async preloadModel(modelId: string): Promise<void> {
    try {
      await fetch(
        `${this.baseUrl}/v1/models/${encodeURIComponent(modelId)}/load`,
        { method: "POST" }
      );
    } catch {
      // Non-fatal if preload endpoint is unreachable
    }
  }

  private async fetchWithOverloadRetry(
    url: string,
    init: RequestInit,
    maxRetries = 2
  ): Promise<Response> {
    let attempt = 0;
    while (true) {
      const res = await fetch(url, init);
      if (res.status !== 503 || attempt >= maxRetries) {
        return res;
      }
      attempt += 1;
      const retryAfterSec = Number(res.headers.get("Retry-After"));
      const delayMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, 4000)
          : 800 * attempt;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  private static extractTextBlocks(content?: HeylookContentBlock[]): string {
    if (!Array.isArray(content)) return "";
    return content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text!)
      .join("");
  }

  public async generateJson<T>(options: GenerateJsonOptions): Promise<T> {
    const model = await this.resolveActiveModel(options.model);
    const systemPrompt = options.systemInstruction
      ? `${options.systemInstruction}\nRespond strictly with valid JSON matching the requested schema.`
      : "Respond strictly with valid JSON matching the requested schema.";

    // 1. Attempt POST /v1/messages with response_format: json_schema
    const res = await this.fetchWithOverloadRetry(
      `${this.baseUrl}/v1/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          system: systemPrompt,
          messages: [{ role: "user", content: options.prompt }],
          stream: false,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "sim_response",
              schema: options.schema,
            },
          },
        }),
        signal: options.signal,
      }
    );

    if (res.ok) {
      this.reachable = true;
      const body = (await res.json()) as { content?: HeylookContentBlock[] };
      const text = HeylookProvider.extractTextBlocks(body.content);
      return parseJsonLoose<T>(text);
    }

    // 2. If checkpoint rejects response_format (400 on harmony/diffusion models), retry without response_format
    if (res.status === 400 || res.status === 422) {
      const fallbackRes = await this.fetchWithOverloadRetry(
        `${this.baseUrl}/v1/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            system: systemPrompt,
            messages: [
              {
                role: "user",
                content: `${options.prompt}\n\nReturn ONLY a valid JSON object matching this schema (no prose):\n${JSON.stringify(options.schema)}`,
              },
            ],
            stream: false,
          }),
          signal: options.signal,
        }
      );

      if (fallbackRes.ok) {
        this.reachable = true;
        const fallbackBody = (await fallbackRes.json()) as {
          content?: HeylookContentBlock[];
        };
        const text = HeylookProvider.extractTextBlocks(fallbackBody.content);
        return parseJsonLoose<T>(text);
      }
    }

    const errText = await res.text().catch(() => "");
    throw new Error(
      `heylookitsanllm JSON error (${res.status}): ${errText.slice(0, 200)}`
    );
  }

  public async streamText(options: StreamTextOptions): Promise<string> {
    const model = await this.resolveActiveModel(options.model);

    const res = await this.fetchWithOverloadRetry(
      `${this.baseUrl}/v1/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          system: options.systemInstruction,
          messages: [{ role: "user", content: options.prompt }],
          stream: true,
        }),
        signal: options.signal,
      }
    );

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `heylookitsanllm stream error (${res.status}): ${errText.slice(0, 240)}`
      );
    }

    this.reachable = true;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let inThinkingBlock = false;
    let currentEvent = "";

    const emitDelta = (chunk: string) => {
      if (!chunk) return;
      fullText += chunk;
      options.onDelta(chunk);
    };

    try {
      outer: while (true) {
        if (options.signal?.aborted) break;
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx = buffer.indexOf("\n");
        while (newlineIdx !== -1) {
          const rawLine = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          newlineIdx = buffer.indexOf("\n");

          const line = rawLine.trim();
          if (!line) {
            currentEvent = "";
            continue;
          }

          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
            continue;
          }

          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(dataStr) as Record<string, unknown>;
          } catch {
            continue;
          }

          const evType =
            (parsed.type as string | undefined) || currentEvent;

          if (evType === "ping") {
            continue;
          }

          if (evType === "heylook_progress") {
            const prefill = parsed.prefill as
              | { processed?: number; total?: number }
              | undefined;
            if (prefill && typeof prefill.processed === "number") {
              options.onStatus?.(
                `Prefilling on heylook (${prefill.processed}/${prefill.total ?? "?"} tokens)...`
              );
            }
            continue;
          }

          if (evType === "error") {
            const errObj = parsed.error as
              | { type?: string; message?: string }
              | undefined;
            throw new Error(
              errObj?.message ||
                `heylookitsanllm stream error (${errObj?.type ?? "unknown"})`
            );
          }

          if (evType === "content_block_start") {
            const block = parsed.content_block as
              | { type?: string; thinking?: string; text?: string }
              | undefined;
            if (block?.type === "thinking" && !inThinkingBlock) {
              inThinkingBlock = true;
              emitDelta("<thinking>");
              const initialThought = block.thinking || block.text || "";
              if (initialThought) emitDelta(initialThought);
            } else if (block?.type === "text") {
              if (inThinkingBlock) {
                inThinkingBlock = false;
                emitDelta("</thinking>\n");
              }
              if (block.text) emitDelta(block.text);
            }
            continue;
          }

          if (evType === "content_block_delta") {
            const delta = parsed.delta as
              | {
                  type?: string;
                  text?: string;
                  thinking?: string;
                }
              | undefined;
            if (!delta) continue;

            if (delta.type === "thinking_delta") {
              if (!inThinkingBlock) {
                inThinkingBlock = true;
                emitDelta("<thinking>");
              }
              const thoughtChunk = delta.thinking ?? delta.text ?? "";
              if (thoughtChunk) emitDelta(thoughtChunk);
            } else if (delta.type === "text_delta") {
              if (inThinkingBlock) {
                inThinkingBlock = false;
                emitDelta("</thinking>\n");
              }
              if (delta.text) emitDelta(delta.text);
            }
            continue;
          }

          if (evType === "content_block_stop") {
            if (inThinkingBlock) {
              inThinkingBlock = false;
              emitDelta("</thinking>\n");
            }
            continue;
          }

          if (evType === "message_stop") {
            break outer;
          }
        }
      }
    } finally {
      if (inThinkingBlock) {
        emitDelta("</thinking>\n");
      }
      reader.releaseLock();
    }

    return fullText;
  }
}
