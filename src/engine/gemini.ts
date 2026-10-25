import type {
  EngineModelId,
  Persona,
  PersonaEngineBinding,
  ProviderId,
} from "../types.ts";
import { GeminiProvider } from "./providers/gemini.ts";
import { HeylookProvider } from "./providers/heylook.ts";
import { OpenRouterProvider } from "./providers/openrouter.ts";
import type {
  GenerateJsonOptions,
  LLMProvider,
  ProviderModelInfo,
  StreamTextOptions,
} from "./types.ts";

export interface RouterInitOptions {
  apiKey?: string;
  provider?: ProviderId;
  model?: string;
  openrouterApiKey?: string;
  openrouterBaseUrl?: string;
  heylookBaseUrl?: string;
  heylookModel?: string;
}

export class InferenceRouter {
  private providers = new Map<ProviderId, LLMProvider>();
  private _activeProviderId: ProviderId = "gemini";
  private personaBindings = new Map<string, PersonaEngineBinding>();

  constructor(apiKeyOrOptions?: string | RouterInitOptions) {
    const opts: RouterInitOptions =
      typeof apiKeyOrOptions === "string"
        ? { apiKey: apiKeyOrOptions }
        : (apiKeyOrOptions ?? {});

    const gemini = new GeminiProvider(opts.apiKey);
    const openrouter = new OpenRouterProvider({
      apiKey: opts.openrouterApiKey,
      baseUrl: opts.openrouterBaseUrl,
    });
    const heylook = new HeylookProvider({
      baseUrl: opts.heylookBaseUrl,
      model: opts.heylookModel,
    });

    this.registerProvider(gemini);
    this.registerProvider(openrouter);
    this.registerProvider(heylook);

    const envProvider = process.env.LLM_SIM_PROVIDER?.trim().toLowerCase();
    if (opts.provider && this.providers.has(opts.provider)) {
      this._activeProviderId = opts.provider;
    } else if (envProvider && this.providers.has(envProvider)) {
      this._activeProviderId = envProvider;
    } else if (gemini.isConfigured()) {
      this._activeProviderId = "gemini";
    } else if (openrouter.isConfigured()) {
      this._activeProviderId = "openrouter";
    } else if (heylook.isConfigured()) {
      this._activeProviderId = "heylook";
    } else {
      this._activeProviderId = "gemini";
    }

    if (opts.model) {
      this.activeModel = opts.model;
    }
  }

  public registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.id.toLowerCase(), provider);
  }

  public getProvider(id?: ProviderId): LLMProvider {
    const key = (id ?? this._activeProviderId).toLowerCase();
    const found = this.providers.get(key);
    if (!found) {
      throw new Error(
        `Unknown provider "${key}". Available providers: ${Array.from(this.providers.keys()).join(", ")}`
      );
    }
    return found;
  }

  public listProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  public get activeProvider(): ProviderId {
    return this._activeProviderId;
  }

  public set activeProvider(id: ProviderId) {
    const normalized = id.trim().toLowerCase();
    if (!this.providers.has(normalized)) {
      throw new Error(
        `Unknown provider "${id}". Available providers: ${Array.from(this.providers.keys()).join(", ")}`
      );
    }
    this._activeProviderId = normalized;
  }

  public get activeModel(): EngineModelId {
    return this.getProvider().defaultModel;
  }

  public set activeModel(modelOrSpec: EngineModelId) {
    const parsed = this.parseProviderModelSpec(modelOrSpec);
    if (parsed) {
      this._activeProviderId = parsed.provider;
      const p = this.getProvider(parsed.provider);
      p.defaultModel = parsed.model;
      return;
    }
    const current = this.getProvider();
    current.defaultModel = modelOrSpec;
  }

  public get activeEngineLabel(): string {
    const p = this.getProvider();
    return `${p.id}:${p.defaultModel}`;
  }

  /**
   * Parses "provider:model" strings (e.g. "openrouter:deepseek/deepseek-r1" or "heylook:Qwen3-30B")
   * only when the prefix matches a registered provider ID.
   */
  public parseProviderModelSpec(
    spec: string
  ): PersonaEngineBinding | undefined {
    const trimmed = spec.trim();
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx <= 0) return undefined;
    const prefix = trimmed.slice(0, colonIdx).toLowerCase();
    const rest = trimmed.slice(colonIdx + 1).trim();
    if (this.providers.has(prefix) && rest) {
      return { provider: prefix, model: rest };
    }
    return undefined;
  }

  public bindPersona(
    personaId: string,
    binding: PersonaEngineBinding | null
  ): void {
    const key = personaId.toLowerCase();
    if (!binding) {
      this.personaBindings.delete(key);
    } else {
      this.personaBindings.set(key, {
        provider: binding.provider.toLowerCase(),
        model: binding.model,
      });
    }
  }

  public getPersonaBinding(persona: Persona): PersonaEngineBinding | undefined {
    const runtime = this.personaBindings.get(persona.id.toLowerCase());
    if (runtime) return runtime;
    if (persona.provider && persona.model) {
      return {
        provider: persona.provider.toLowerCase(),
        model: persona.model,
      };
    }
    if (persona.model) {
      const parsed = this.parseProviderModelSpec(persona.model);
      if (parsed) return parsed;
      return {
        provider: (persona.provider ?? this._activeProviderId).toLowerCase(),
        model: persona.model,
      };
    }
    if (persona.provider) {
      const p = this.getProvider(persona.provider);
      return {
        provider: p.id,
        model: p.defaultModel,
      };
    }
    return undefined;
  }

  public getAllPersonaBindings(): Record<string, PersonaEngineBinding> {
    const out: Record<string, PersonaEngineBinding> = {};
    for (const [k, v] of this.personaBindings.entries()) {
      out[k] = v;
    }
    return out;
  }

  public setAllPersonaBindings(
    bindings: Record<string, PersonaEngineBinding>
  ): void {
    this.personaBindings.clear();
    for (const [k, v] of Object.entries(bindings)) {
      this.personaBindings.set(k.toLowerCase(), v);
    }
  }

  public resolveTarget(options?: {
    persona?: Persona;
    model?: string;
    useFastModel?: boolean;
  }): {
    provider: LLMProvider;
    model: string;
    isCustomBound: boolean;
  } {
    // 1. Explicit "provider:model" in options.model
    if (options?.model) {
      const parsed = this.parseProviderModelSpec(options.model);
      if (parsed) {
        return {
          provider: this.getProvider(parsed.provider),
          model: parsed.model,
          isCustomBound: true,
        };
      }
    }

    // 2. Per-persona binding (Hierarchy level 1)
    if (options?.persona) {
      const binding = this.getPersonaBinding(options.persona);
      if (binding && this.providers.has(binding.provider)) {
        const provider = this.getProvider(binding.provider);
        return {
          provider,
          model: binding.model || provider.defaultModel,
          isCustomBound: true,
        };
      }
    }

    // 3. Global active provider (Hierarchy level 2)
    const provider = this.getProvider();
    let model = options?.useFastModel
      ? provider.fastModel
      : provider.defaultModel;

    if (options?.model) {
      // Ignore hardcoded Gemini defaults when global provider is non-Gemini
      const isGeminiDefault =
        options.model === "gemini-3.8-flash" ||
        options.model === "gemini-3.5-flash-lite";
      if (provider.id === "gemini" || !isGeminiDefault) {
        model = options.model;
      }
    }

    return {
      provider,
      model,
      isCustomBound: false,
    };
  }

  public isConfigured(persona?: Persona): boolean {
    const target = this.resolveTarget({ persona });
    return target.provider.isConfigured();
  }

  /**
   * Probes local heylook server on startup if no cloud API key is configured,
   * automatically switching to heylook if it responds on :8000.
   */
  public async autoDetectLocalProviders(): Promise<void> {
    const heylook = this.providers.get("heylook");
    if (!heylook) return;
    const models = await heylook.listModels();
    if (models.length > 0 && !this.getProvider().isConfigured()) {
      this._activeProviderId = "heylook";
    }
  }

  public async listModels(
    providerId?: ProviderId
  ): Promise<ProviderModelInfo[]> {
    return this.getProvider(providerId).listModels();
  }

  public getCachedModels(providerId?: ProviderId): ProviderModelInfo[] {
    return this.getProvider(providerId).getCachedModels();
  }

  public async generateJson<T>(
    options: GenerateJsonOptions & { persona?: Persona }
  ): Promise<T> {
    const { provider, model } = this.resolveTarget({
      persona: options.persona,
      model: options.model,
      useFastModel: true,
    });
    return provider.generateJson<T>({
      ...options,
      model,
    });
  }

  public async streamText(
    options: StreamTextOptions & { persona?: Persona }
  ): Promise<string> {
    const { provider, model } = this.resolveTarget({
      persona: options.persona,
      model: options.model,
      useFastModel: false,
    });
    return provider.streamText({
      ...options,
      model,
    });
  }
}

export { InferenceRouter as GeminiEngine };
