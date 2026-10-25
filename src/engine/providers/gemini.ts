import { GoogleGenAI } from "@google/genai";
import {
  type GenerateJsonOptions,
  type LLMProvider,
  parseJsonLoose,
  type ProviderModelInfo,
  type StreamTextOptions,
} from "../types.ts";

const GEMINI_BUILTIN_MODELS: ProviderModelInfo[] = [
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    provider: "gemini",
    capabilities: ["chat", "thinking", "json_schema"],
    description: "Default high-speed frontier persona streamer",
  },
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    provider: "gemini",
    capabilities: ["chat", "json_schema"],
    description: "Ultra-low-latency Room Director & JSON synthesizer",
  },
];

export class GeminiProvider implements LLMProvider {
  public readonly id = "gemini" as const;
  public readonly displayName = "Google Gemini (Interactions API)";
  public defaultModel =
    process.env.GEMINI_MODEL || "gemini-3.8-flash";
  public fastModel =
    process.env.GEMINI_FAST_MODEL || "gemini-3.5-flash-lite";

  private client: GoogleGenAI | null = null;
  private explicitApiKey?: string;

  constructor(apiKey?: string) {
    this.explicitApiKey = apiKey;
    const key =
      apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (key) {
      this.client = new GoogleGenAI({ apiKey: key });
    }
  }

  public isConfigured(): boolean {
    if (this.client) return true;
    const key =
      this.explicitApiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY;
    if (key) {
      this.client = new GoogleGenAI({ apiKey: key });
      return true;
    }
    return false;
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      const key =
        this.explicitApiKey ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY;
      if (!key) {
        throw new Error(
          "Missing GEMINI_API_KEY (or GOOGLE_API_KEY). Set it in your environment or switch providers via /provider."
        );
      }
      this.client = new GoogleGenAI({ apiKey: key });
    }
    return this.client;
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    return GEMINI_BUILTIN_MODELS;
  }

  public getCachedModels(): ProviderModelInfo[] {
    return GEMINI_BUILTIN_MODELS;
  }

  public async generateJson<T>(options: GenerateJsonOptions): Promise<T> {
    const client = this.getClient();
    const interaction = await client.interactions.create(
      {
        model: options.model || this.fastModel,
        input: options.prompt,
        system_instruction: options.systemInstruction,
        response_format: options.schema,
        store: false,
      },
      options.signal ? { signal: options.signal } : undefined
    );

    const rawText = interaction.output_text ?? "{}";
    return parseJsonLoose<T>(rawText);
  }

  public async streamText(options: StreamTextOptions): Promise<string> {
    const client = this.getClient();
    const stream = await client.interactions.create(
      {
        model: options.model || this.defaultModel,
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
