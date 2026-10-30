import type { ProviderId } from "../types.ts";

export interface ProviderModelInfo {
  id: string;
  name?: string;
  provider: ProviderId;
  runtime?: string; // e.g. "mlx" | "gguf" for heylookitsanllm
  capabilities?: string[];
  description?: string;
}

export interface GenerateJsonOptions {
  prompt: string;
  systemInstruction?: string;
  schema: Record<string, unknown>;
  model?: string;
  signal?: AbortSignal;
}

export interface StreamTextOptions {
  prompt: string;
  systemInstruction: string;
  model?: string;
  signal?: AbortSignal;
  onDelta: (deltaText: string) => void;
  onStatus?: (statusText: string) => void;
}

export interface GenerateImageOptions {
  prompt: string;
  model?: string;
  signal?: AbortSignal;
}

export interface GeneratedImageResult {
  data: string; // base64
  mimeType: string;
}

export interface LLMProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  defaultModel: string;
  fastModel: string;
  baseUrl?: string;
  isConfigured(): boolean;
  listModels(): Promise<ProviderModelInfo[]>;
  getCachedModels(): ProviderModelInfo[];
  generateJson<T>(options: GenerateJsonOptions): Promise<T>;
  streamText(options: StreamTextOptions): Promise<string>;
  generateImage?(options: GenerateImageOptions): Promise<GeneratedImageResult | null>;
}

/**
 * Extracts and parses the first JSON object from a raw LLM string
 * (handles markdown code fences and surrounding prose).
 */
export function parseJsonLoose<T>(raw: string): T {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Empty JSON response");
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Strip markdown fences if present
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) {
      return JSON.parse(fenceMatch[1].trim()) as T;
    }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error(`Failed to parse JSON from response: ${trimmed.slice(0, 120)}`);
  }
}
