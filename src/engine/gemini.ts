import { GoogleGenAI } from "@google/genai";
import type { EngineModelId } from "../types.ts";

export class GeminiEngine {
  private client: GoogleGenAI | null = null;
  public activeModel: EngineModelId = "gemini-3.8-flash";

  constructor(apiKey?: string) {
    const key =
      apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (key) {
      this.client = new GoogleGenAI({ apiKey: key });
    }
  }

  public isConfigured(): boolean {
    if (this.client) return true;
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (key) {
      this.client = new GoogleGenAI({ apiKey: key });
      return true;
    }
    return false;
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!key) {
        throw new Error(
          "Missing GEMINI_API_KEY (or GOOGLE_API_KEY). Set it in your environment or .env file."
        );
      }
      this.client = new GoogleGenAI({ apiKey: key });
    }
    return this.client;
  }

  /**
   * Fast structured JSON call using gemini-3.5-flash-lite by default.
   */
  public async generateJson<T>(options: {
    prompt: string;
    systemInstruction?: string;
    schema: Record<string, unknown>;
    model?: EngineModelId;
    signal?: AbortSignal;
  }): Promise<T> {
    const client = this.getClient();
    const interaction = await client.interactions.create(
      {
        model: options.model ?? "gemini-3.5-flash-lite",
        input: options.prompt,
        system_instruction: options.systemInstruction,
        response_format: options.schema,
        store: false,
      },
      options.signal ? { signal: options.signal } : undefined
    );

    const rawText = interaction.output_text ?? "{}";
    return JSON.parse(rawText) as T;
  }

  /**
   * Streams text tokens from the active Gemini model using the Interactions API.
   */
  public async streamText(options: {
    prompt: string;
    systemInstruction: string;
    model?: EngineModelId;
    signal?: AbortSignal;
    onDelta: (deltaText: string) => void;
  }): Promise<string> {
    const client = this.getClient();
    const stream = await client.interactions.create(
      {
        model: options.model ?? this.activeModel,
        input: options.prompt,
        system_instruction: options.systemInstruction,
        stream: true,
        store: false,
      },
      options.signal ? { signal: options.signal } : undefined
    );

    let fullText = "";
    for await (const event of stream) {
      if (options.signal?.aborted) {
        break;
      }
      if (event.event_type === "step.delta" && event.delta?.type === "text") {
        const chunk = event.delta.text ?? "";
        if (chunk) {
          fullText += chunk;
          options.onDelta(chunk);
        }
      }
    }
    return fullText;
  }
}
