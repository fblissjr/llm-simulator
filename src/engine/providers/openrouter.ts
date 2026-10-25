import {
  type GenerateJsonOptions,
  type LLMProvider,
  parseJsonLoose,
  type ProviderModelInfo,
  type StreamTextOptions,
} from "../types.ts";

const OPENROUTER_POPULAR_MODELS: ProviderModelInfo[] = [
  {
    id: "google/gemini-2.5-flash",
    name: "Google: Gemini 2.5 Flash",
    provider: "openrouter",
    capabilities: ["chat", "thinking", "json_schema"],
  },
  {
    id: "google/gemini-2.5-flash-lite",
    name: "Google: Gemini 2.5 Flash Lite",
    provider: "openrouter",
    capabilities: ["chat", "json_schema"],
  },
  {
    id: "anthropic/claude-3.7-sonnet",
    name: "Anthropic: Claude 3.7 Sonnet",
    provider: "openrouter",
    capabilities: ["chat", "thinking"],
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek: R1 (Reasoning)",
    provider: "openrouter",
    capabilities: ["chat", "thinking"],
  },
  {
    id: "openai/gpt-4o",
    name: "OpenAI: GPT-4o",
    provider: "openrouter",
    capabilities: ["chat", "json_schema"],
  },
  {
    id: "openai/o3-mini",
    name: "OpenAI: o3-mini (Reasoning)",
    provider: "openrouter",
    capabilities: ["chat", "thinking", "json_schema"],
  },
  {
    id: "qwen/qwen-2.5-72b-instruct",
    name: "Qwen: Qwen 2.5 72B Instruct",
    provider: "openrouter",
    capabilities: ["chat", "json_schema"],
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Meta: Llama 3.3 70B Instruct",
    provider: "openrouter",
    capabilities: ["chat", "json_schema"],
  },
];

function ensureStrictSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  if (schema.type === "object") {
    return {
      ...schema,
      additionalProperties: false,
    };
  }
  return schema;
}

export class OpenRouterProvider implements LLMProvider {
  public readonly id = "openrouter" as const;
  public readonly displayName = "OpenRouter (Unified Multi-Model API)";
  public baseUrl: string;
  public defaultModel: string;
  public fastModel: string;

  private explicitApiKey?: string;
  private cachedModels: ProviderModelInfo[] = [...OPENROUTER_POPULAR_MODELS];

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
    fastModel?: string;
  }) {
    this.explicitApiKey = options?.apiKey;
    this.baseUrl = (
      options?.baseUrl ||
      process.env.OPENROUTER_BASE_URL ||
      "https://openrouter.ai/api/v1"
    ).replace(/\/+$/, "");
    this.defaultModel =
      options?.defaultModel ||
      process.env.OPENROUTER_MODEL ||
      "google/gemini-2.5-flash";
    this.fastModel =
      options?.fastModel ||
      process.env.OPENROUTER_FAST_MODEL ||
      "google/gemini-2.5-flash-lite";
  }

  private getApiKey(): string | undefined {
    return this.explicitApiKey || process.env.OPENROUTER_API_KEY;
  }

  public isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  private buildHeaders(): Record<string, string> {
    const key = this.getApiKey();
    if (!key) {
      throw new Error(
        "Missing OPENROUTER_API_KEY. Set it in your environment or switch providers via /provider."
      );
    }
    return {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.OPENROUTER_SITE_URL || "https://github.com/fblissjr/llm-sim",
      "X-Title": process.env.OPENROUTER_APP_NAME || "llm-sim",
    };
  }

  public getCachedModels(): ProviderModelInfo[] {
    return this.cachedModels;
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.getApiKey()
          ? { Authorization: `Bearer ${this.getApiKey()}` }
          : undefined,
      });
      if (!res.ok) {
        return this.cachedModels;
      }
      const data = (await res.json()) as {
        data?: Array<{
          id: string;
          name?: string;
          description?: string;
          supported_parameters?: string[];
        }>;
      };
      if (Array.isArray(data.data) && data.data.length > 0) {
        this.cachedModels = data.data.slice(0, 120).map((m) => ({
          id: m.id,
          name: m.name || m.id,
          provider: "openrouter",
          capabilities: m.supported_parameters ?? ["chat"],
          description: m.description?.slice(0, 90),
        }));
      }
    } catch {
      // Keep popular fallback models if offline
    }
    return this.cachedModels;
  }

  public async generateJson<T>(options: GenerateJsonOptions): Promise<T> {
    const model = options.model || this.fastModel;
    const messages: Array<{ role: string; content: string }> = [];
    if (options.systemInstruction) {
      messages.push({
        role: "system",
        content: `${options.systemInstruction}\nRespond strictly with valid JSON matching the requested schema.`,
      });
    } else {
      messages.push({
        role: "system",
        content: "Respond strictly with valid JSON matching the requested schema.",
      });
    }
    messages.push({ role: "user", content: options.prompt });

    // 1. Try OpenRouter Structured Outputs (json_schema)
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "sim_response",
            strict: true,
            schema: ensureStrictSchema(options.schema),
          },
        },
      }),
      signal: options.signal,
    });

    if (res.ok) {
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawText = body.choices?.[0]?.message?.content ?? "{}";
      return parseJsonLoose<T>(rawText);
    }

    // 2. Fallback without strict response_format if the chosen OpenRouter model doesn't support json_schema
    const fallbackRes = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model,
        messages: [
          ...messages,
          {
            role: "user",
            content: `Return ONLY a JSON object matching this schema:\n${JSON.stringify(options.schema)}`,
          },
        ],
        stream: false,
      }),
      signal: options.signal,
    });

    if (!fallbackRes.ok) {
      const errText = await fallbackRes.text().catch(() => "");
      throw new Error(
        `OpenRouter JSON error (${fallbackRes.status}): ${errText.slice(0, 200)}`
      );
    }

    const fallbackBody = (await fallbackRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return parseJsonLoose<T>(
      fallbackBody.choices?.[0]?.message?.content ?? "{}"
    );
  }

  public async streamText(options: StreamTextOptions): Promise<string> {
    const model = options.model || this.defaultModel;
    const messages: Array<{ role: string; content: string }> = [];
    if (options.systemInstruction) {
      messages.push({ role: "system", content: options.systemInstruction });
    }
    messages.push({ role: "user", content: options.prompt });

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal: options.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `OpenRouter stream error (${res.status}): ${errText.slice(0, 240)}`
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let inReasoningBlock = false;

    const emitDelta = (chunk: string) => {
      if (!chunk) return;
      fullText += chunk;
      options.onDelta(chunk);
    };

    try {
      while (true) {
        if (options.signal?.aborted) break;
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx = buffer.indexOf("\n");
        while (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          newlineIdx = buffer.indexOf("\n");

          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          try {
            const parsed = JSON.parse(payload) as {
              error?: { message?: string };
              choices?: Array<{
                delta?: {
                  content?: string | null;
                  reasoning?: string | null;
                  reasoning_content?: string | null;
                };
              }>;
            };

            if (parsed.error?.message) {
              throw new Error(parsed.error.message);
            }

            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            const reasoningChunk =
              delta.reasoning ?? delta.reasoning_content ?? "";
            if (reasoningChunk) {
              if (!inReasoningBlock) {
                inReasoningBlock = true;
                emitDelta("<thinking>");
              }
              emitDelta(reasoningChunk);
            }

            const contentChunk = delta.content ?? "";
            if (contentChunk) {
              if (inReasoningBlock) {
                inReasoningBlock = false;
                emitDelta("</thinking>\n");
              }
              emitDelta(contentChunk);
            }
          } catch (err) {
            if (err instanceof Error && !err.message.includes("JSON")) {
              throw err;
            }
          }
        }
      }
    } finally {
      if (inReasoningBlock) {
        emitDelta("</thinking>\n");
      }
      reader.releaseLock();
    }

    return fullText;
  }
}
