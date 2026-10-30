import * as fs from "node:fs";
import * as path from "node:path";
import {
  BUILTIN_SCENARIOS,
  normalizeScenarioSpec,
} from "../core/sim-config.ts";
import type { GeminiEngine } from "../engine/gemini.ts";
import type { SimDatabase } from "../server/db.ts";
import type { CuratedScenario, Persona } from "../types.ts";
import { BUILTIN_PERSONAS } from "./builtin.ts";

const SCENARIO_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    id: { type: "string", description: "kebab-case scenario id" },
    title: {
      type: "string",
      description: "Expressive title starting with an emoji",
    },
    description: {
      type: "string",
      description: "1-line summary of the scenario premise",
    },
    personas: {
      type: "array",
      items: { type: "string" },
      description: "3 to 4 persona IDs from the catalog",
    },
    vibeKey: {
      type: "string",
      description: "One of: chat, debate, roast, chaos",
    },
    preset: {
      type: "string",
      description: "One of: manual, chill, lively, banter, chaos",
    },
    openingStageEvent: {
      type: "string",
      description: "Dramatic opening stage direction that kicks off the scene",
    },
  },
  required: [
    "id",
    "title",
    "description",
    "personas",
    "vibeKey",
    "preset",
    "openingStageEvent",
  ],
};

const PERSONA_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    id: { type: "string", description: "kebab-case id, e.g. qwen-2.5-max" },
    nick: {
      type: "string",
      description: "IRC nick without spaces, e.g. Qwen_2_5 or HAL_9000",
    },
    displayName: {
      type: "string",
      description: "Human-readable model name and version",
    },
    family: {
      type: "string",
      description: "Creator lab or model family, e.g. Alibaba, OpenAI, Fictional",
    },
    era: {
      type: "string",
      description: "Release year/month or era, e.g. Jan 2025 or 2001",
    },
    avatar: { type: "string", description: "Single expressive emoji" },
    color: {
      type: "string",
      description: "Vibrant hex color for dark terminal, e.g. #8be9fd or #ff79c6",
    },
    bio: {
      type: "string",
      description: "Punchy 1-line description of its quirks and personality",
    },
    joinLine: {
      type: "string",
      description: "In-character entrance line when summoned into the IRC room",
    },
    leaveLine: {
      type: "string",
      description: "In-character parting line when banished from the IRC room",
    },
    systemPrompt: {
      type: "string",
      description:
        "Detailed roleplay instructions capturing verbal tics, formatting habits, blindspots, and how it interacts with other models in a chatroom",
    },
    talkativeness: {
      type: "number",
      description: "Number between 0.4 and 0.85",
    },
  },
  required: [
    "id",
    "nick",
    "displayName",
    "family",
    "era",
    "avatar",
    "color",
    "bio",
    "joinLine",
    "leaveLine",
    "systemPrompt",
    "talkativeness",
  ],
};

export class PersonaRegistry {
  private personas = new Map<string, Persona>();
  private scenarios = new Map<string, CuratedScenario>();
  private customDir: string;
  private scenariosDir: string;
  private db?: SimDatabase;

  constructor(
    customDir = path.resolve(process.cwd(), "personas"),
    db?: SimDatabase,
    scenariosDir?: string
  ) {
    this.customDir = customDir;
    this.scenariosDir =
      scenariosDir ?? path.join(path.dirname(customDir), "scenarios");
    this.db = db;
    for (const p of BUILTIN_PERSONAS) {
      this.personas.set(p.id.toLowerCase(), p);
    }
    for (const s of BUILTIN_SCENARIOS) {
      this.scenarios.set(s.id.toLowerCase(), { ...s, isCustom: false });
    }
    this.loadCustomPersonas();
    this.loadCustomScenarios();
    if (this.db) {
      for (const p of this.db.loadCustomPersonas()) {
        this.personas.set(p.id.toLowerCase(), p);
      }
      for (const s of this.db.loadCustomScenarios()) {
        this.scenarios.set(s.id.toLowerCase(), { ...s, isCustom: true });
      }
    }
  }

  public loadCustomPersonas(): void {
    if (!fs.existsSync(this.customDir)) {
      return;
    }
    try {
      const files = fs
        .readdirSync(this.customDir)
        .filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const raw = fs.readFileSync(path.join(this.customDir, file), "utf-8");
        const parsed = JSON.parse(raw) as Partial<Persona>;
        if (parsed.id && parsed.nick && parsed.systemPrompt) {
          const persona: Persona = {
            id: parsed.id,
            aliases: parsed.aliases ?? [],
            nick: parsed.nick,
            displayName: parsed.displayName ?? parsed.nick,
            family: parsed.family ?? "Custom",
            era: parsed.era ?? "Unknown",
            eraGroup: parsed.eraGroup ?? "Custom / Summoned",
            avatar: parsed.avatar ?? "✨",
            color: parsed.color ?? "#8be9fd",
            bio: parsed.bio ?? "Custom summoned persona.",
            joinLine: parsed.joinLine ?? `${parsed.nick} has entered the channel.`,
            leaveLine: parsed.leaveLine ?? `${parsed.nick} has left the channel.`,
            systemPrompt: parsed.systemPrompt,
            talkativeness: parsed.talkativeness ?? 0.65,
          };
          this.personas.set(persona.id.toLowerCase(), persona);
        }
      }
    } catch {
      // Ignore malformed custom persona files
    }
  }

  public all(): Persona[] {
    return Array.from(this.personas.values());
  }

  public get(id: string): Persona | undefined {
    return this.personas.get(id.toLowerCase());
  }

  /**
   * Fuzzy match by id, nick, alias, or displayName.
   */
  public find(query: string): Persona | undefined {
    const normalized = query.trim().toLowerCase().replace(/^@/, "");
    if (!normalized) return undefined;

    // 1. Exact ID match
    const exact = this.personas.get(normalized);
    if (exact) return exact;

    const slug = normalized.replace(/[\s_]+/g, "-");
    const slugMatch = this.personas.get(slug);
    if (slugMatch) return slugMatch;

    // 2. Exact nick or alias match
    for (const p of this.personas.values()) {
      if (p.nick.toLowerCase() === normalized) return p;
      if (p.nick.toLowerCase().replace(/_/g, "-") === slug) return p;
      if (p.aliases.some((a) => a.toLowerCase() === normalized || a.toLowerCase() === slug)) {
        return p;
      }
    }

    // 3. Prefix or substring match on id, nick, aliases, or displayName
    for (const p of this.personas.values()) {
      if (
        p.id.toLowerCase().includes(slug) ||
        p.nick.toLowerCase().includes(normalized) ||
        p.displayName.toLowerCase().includes(normalized) ||
        p.aliases.some((a) => a.toLowerCase().includes(normalized))
      ) {
        return p;
      }
    }

    return undefined;
  }

  public register(persona: Persona, persistToDisk = false): void {
    this.personas.set(persona.id.toLowerCase(), persona);
    if (this.db) {
      this.db.saveCustomPersona(persona);
    }
    if (persistToDisk) {
      this.writePersonaFile(persona);
    }
  }

  public isBuiltin(id: string): boolean {
    const clean = id.trim().toLowerCase();
    return BUILTIN_PERSONAS.some((p) => p.id.toLowerCase() === clean);
  }

  public customPersonas(): Persona[] {
    const builtinMap = new Map(
      BUILTIN_PERSONAS.map((p) => [p.id.toLowerCase(), p])
    );
    return Array.from(this.personas.values()).filter((p) => {
      const b = builtinMap.get(p.id.toLowerCase());
      if (!b) return true;
      return (
        p.nick !== b.nick ||
        p.systemPrompt !== b.systemPrompt ||
        p.bio !== b.bio ||
        p.avatar !== b.avatar ||
        p.talkativeness !== b.talkativeness
      );
    });
  }

  public forgeFromSpec(
    spec: Partial<Persona> & { id: string },
    persistToDisk = false
  ): Persona {
    const rawId = spec.id
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const id = rawId || "custom-bot";
    const existing = this.personas.get(id);

    const rawNick = (
      spec.nick?.trim() ||
      existing?.nick ||
      id.replace(/-/g, "_")
    )
      .replace(/\s+/g, "_")
      .slice(0, 20);
    const displayName =
      spec.displayName?.trim() || existing?.displayName || rawNick;
    const family = spec.family?.trim() || existing?.family || "Custom Forge";
    const era = spec.era?.trim() || existing?.era || "Custom Era";
    const eraGroup =
      spec.eraGroup || existing?.eraGroup || "Custom / Summoned";
    const avatar = spec.avatar?.trim() || existing?.avatar || "🤖";
    const rawColor = spec.color?.trim() || existing?.color || "#8be9fd";
    const color = rawColor.startsWith("#") ? rawColor : "#8be9fd";
    const bio =
      spec.bio?.trim() ||
      existing?.bio ||
      `Custom forged persona (${displayName}).`;
    const joinLine =
      spec.joinLine?.trim() ||
      existing?.joinLine ||
      `${rawNick} materializes from the Persona Forge.`;
    const leaveLine =
      spec.leaveLine?.trim() ||
      existing?.leaveLine ||
      `${rawNick} returns to the Persona Forge.`;
    const systemPrompt =
      spec.systemPrompt?.trim() ||
      existing?.systemPrompt ||
      `You are ${displayName} (${rawNick}), a custom AI persona from ${era} (${family}). Bio & personality: ${bio}. Stay in character in the IRC room.`;
    const rawTalk =
      spec.talkativeness !== undefined
        ? Number(spec.talkativeness)
        : (existing?.talkativeness ?? 0.65);
    const talkativeness = Number.isFinite(rawTalk)
      ? Math.max(0.1, Math.min(1.0, Number(rawTalk.toFixed(2))))
      : 0.65;

    const aliases = Array.from(
      new Set([
        ...(existing?.aliases ?? []),
        ...(spec.aliases ?? []),
        id,
        rawNick.toLowerCase(),
      ])
    );

    const persona: Persona = {
      id,
      aliases,
      nick: rawNick,
      displayName,
      family,
      era,
      eraGroup,
      avatar,
      color,
      bio,
      joinLine,
      leaveLine,
      systemPrompt,
      talkativeness,
    };

    this.register(persona, persistToDisk);
    return persona;
  }

  public clonePersona(
    sourceQuery: string,
    newId: string,
    overrides?: Partial<Persona>,
    persistToDisk = false
  ): Persona {
    const source = this.find(sourceQuery);
    if (!source) {
      throw new Error(`Source persona "${sourceQuery}" not found in registry.`);
    }
    const cleanId = newId
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!cleanId) {
      throw new Error("A valid new persona ID is required for cloning.");
    }
    const defaultNick =
      overrides?.nick?.trim() ||
      cleanId
        .split("-")
        .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : ""))
        .join("_")
        .slice(0, 20);

    return this.forgeFromSpec(
      {
        ...source,
        ...overrides,
        id: cleanId,
        nick: defaultNick,
        displayName:
          overrides?.displayName?.trim() || `${source.displayName} (${defaultNick})`,
        eraGroup: overrides?.eraGroup ?? "Custom / Summoned",
        aliases: [cleanId, defaultNick.toLowerCase()],
      },
      persistToDisk
    );
  }

  public async synthesizePersona(
    concept: string,
    gemini: GeminiEngine,
    idHint?: string,
    persistToDisk = false
  ): Promise<Persona> {
    const cleanConcept = concept.trim() || idHint || "Custom Bot";
    const fallbackId = (idHint || cleanConcept.split(/[\s:|-]+/)[0] || "custom-bot")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (gemini.isConfigured()) {
      try {
        const generated = await gemini.generateJson<
          Omit<Persona, "aliases" | "eraGroup">
        >({
          prompt: `Create an authentic, funny, historically/culturally accurate chatroom simulation persona based on this concept: "${cleanConcept}"${idHint ? ` (target id: "${idHint}")` : ""}.
If it is a real historical or current LLM/chatbot, capture its actual verbal tics, famous incidents, formatting quirks, and era.
If it is a fictional, future, or custom character concept, lean deeply into its voice, quirks, and comedic characterization.`,
          systemInstruction:
            "You design hilarious, deeply accurate AI/LLM simulation personas for a multi-model IRC chatroom game.",
          schema: PERSONA_SCHEMA,
          model: "gemini-3.5-flash-lite",
        });

        return this.forgeFromSpec(
          {
            ...generated,
            id: idHint ? fallbackId : generated.id || fallbackId,
          },
          persistToDisk
        );
      } catch {
        // Fall through to deterministic offline forge
      }
    }

    const baseNick = fallbackId
      .split("-")
      .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : ""))
      .join("_")
      .slice(0, 20);

    return this.forgeFromSpec(
      {
        id: fallbackId,
        nick: baseNick || "Custom_Bot",
        displayName: idHint ? `${baseNick}` : cleanConcept.slice(0, 36),
        family: "Persona Forge",
        era: "2026 Custom",
        avatar: "🛠️",
        color: "#ff79c6",
        bio: cleanConcept.slice(0, 140),
        joinLine: `${baseNick} steps out of the Persona Forge: "${cleanConcept.slice(0, 80)}"`,
        leaveLine: `${baseNick} vanishes back into the latent forge.`,
        systemPrompt: `You are ${baseNick}, a custom persona forged with the following character concept and directive: ${cleanConcept}. Stay vividly in character, react to other models in the IRC room, and embody every quirk of this concept.`,
        talkativeness: 0.68,
      },
      persistToDisk
    );
  }

  public exportToDisk(idOrQuery: string): string {
    const persona = this.find(idOrQuery);
    if (!persona) {
      throw new Error(`Persona "${idOrQuery}" not found.`);
    }
    return this.writePersonaFile(persona);
  }

  public deleteCustom(
    idOrQuery: string,
    removeFromDisk = false
  ): { deleted: boolean; restoredBuiltin?: Persona; id: string } {
    const target = this.find(idOrQuery);
    const id = (target?.id ?? idOrQuery).toLowerCase().trim();
    const builtin = BUILTIN_PERSONAS.find((p) => p.id.toLowerCase() === id);

    const existedInMem = this.personas.has(id);
    if (this.db) {
      this.db.deleteCustomPersona(id);
    }
    if (removeFromDisk) {
      try {
        const filePath = path.join(
          this.customDir,
          `${id.replace(/[^a-z0-9._-]/g, "-")}.json`
        );
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Non-fatal
      }
    }

    if (builtin) {
      this.personas.set(id, builtin);
      return { deleted: true, restoredBuiltin: builtin, id };
    }

    if (existedInMem) {
      this.personas.delete(id);
      return { deleted: true, id };
    }
    return { deleted: false, id };
  }

  private writePersonaFile(persona: Persona): string {
    fs.mkdirSync(this.customDir, { recursive: true });
    const filePath = path.join(
      this.customDir,
      `${persona.id.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}.json`
    );
    fs.writeFileSync(filePath, JSON.stringify(persona, null, 2), "utf-8");
    return filePath;
  }

  /**
   * Finds a persona in the catalog or synthesizes a new one on the fly via Gemini Flash-Lite.
   */
  public async summonOrCreate(
    query: string,
    gemini: GeminiEngine
  ): Promise<{ persona: Persona; createdNew: boolean }> {
    const existing = this.find(query);
    if (existing) {
      return { persona: existing, createdNew: false };
    }

    const persona = await this.synthesizePersona(query, gemini, query, true);
    return { persona, createdNew: true };
  }

  public loadCustomScenarios(): void {
    if (!fs.existsSync(this.scenariosDir)) {
      return;
    }
    try {
      const files = fs
        .readdirSync(this.scenariosDir)
        .filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const raw = fs.readFileSync(
          path.join(this.scenariosDir, file),
          "utf-8"
        );
        const parsed = JSON.parse(raw) as Partial<CuratedScenario>;
        if (parsed && parsed.id) {
          const scenario = normalizeScenarioSpec({ ...parsed, id: parsed.id });
          this.scenarios.set(scenario.id.toLowerCase(), scenario);
        }
      }
    } catch {
      // Ignore malformed custom scenario files
    }
  }

  public allScenarios(): CuratedScenario[] {
    return Array.from(this.scenarios.values());
  }

  public customScenarios(): CuratedScenario[] {
    const builtinIds = new Set(
      BUILTIN_SCENARIOS.map((s) => s.id.toLowerCase())
    );
    return Array.from(this.scenarios.values()).filter(
      (s) => s.isCustom || !builtinIds.has(s.id.toLowerCase())
    );
  }

  public findScenario(query: string): CuratedScenario | undefined {
    const clean = query.trim().toLowerCase();
    if (!clean) return undefined;
    const exact = this.scenarios.get(clean);
    if (exact) return exact;

    const slug = clean.replace(/[\s_]+/g, "-");
    const slugMatch = this.scenarios.get(slug);
    if (slugMatch) return slugMatch;

    for (const s of this.scenarios.values()) {
      if (
        s.id.toLowerCase().includes(slug) ||
        s.title.toLowerCase().includes(clean)
      ) {
        return s;
      }
    }
    return undefined;
  }

  public saveScenario(
    spec: Partial<CuratedScenario> & { id: string; title?: string },
    persistToDisk = false
  ): CuratedScenario {
    const resolvedPersonas: string[] = [];
    for (const token of spec.personas ?? []) {
      const match = this.find(token);
      resolvedPersonas.push(match ? match.id : token.trim().toLowerCase());
    }
    const scenario = normalizeScenarioSpec({
      ...spec,
      personas: resolvedPersonas.length > 0 ? resolvedPersonas : spec.personas,
      isCustom: true,
    });
    this.scenarios.set(scenario.id.toLowerCase(), scenario);
    if (this.db) {
      this.db.saveCustomScenario(scenario);
    }
    if (persistToDisk) {
      try {
        fs.mkdirSync(this.scenariosDir, { recursive: true });
        const filePath = path.join(
          this.scenariosDir,
          `${scenario.id.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}.json`
        );
        fs.writeFileSync(filePath, JSON.stringify(scenario, null, 2), "utf-8");
      } catch {
        // Non-fatal
      }
    }
    return scenario;
  }

  public async synthesizeScenario(
    concept: string,
    gemini: GeminiEngine,
    idHint?: string,
    persistToDisk = false
  ): Promise<CuratedScenario> {
    const cleanConcept = concept.trim() || idHint || "Custom Showdown";
    const fallbackId = (
      idHint ||
      cleanConcept
        .toLowerCase()
        .split(/[\s:|-]+/)
        .slice(0, 3)
        .join("-") ||
      "custom-showdown"
    )
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const catalogIds = this.all().map((p) => p.id);

    if (gemini.isConfigured()) {
      try {
        const generated = await gemini.generateJson<CuratedScenario>({
          prompt: `Design an entertaining multi-model IRC chatroom showdown scenario for the concept: "${cleanConcept}".
Available persona IDs in catalog: ${catalogIds.join(", ")}.
Pick 3 or 4 ideal persona IDs from the catalog that have maximum comedic or intellectual friction for this scenario.`,
          systemInstruction:
            "You are a theatrical showrunner for a retro multi-LLM IRC chatroom simulation game.",
          schema: SCENARIO_SCHEMA,
          model: "gemini-3.5-flash-lite",
        });

        return this.saveScenario(
          {
            ...generated,
            id: idHint ? fallbackId : generated.id || fallbackId,
          },
          persistToDisk
        );
      } catch {
        // Fall through to deterministic offline scenario builder
      }
    }

    // Deterministic offline scenario synthesis: match any mentioned personas in concept or pick a fun 4-bot cast
    const lowerConcept = cleanConcept.toLowerCase();
    const matchedIds: string[] = [];
    for (const p of this.all()) {
      if (
        lowerConcept.includes(p.id.toLowerCase()) ||
        lowerConcept.includes(p.nick.toLowerCase()) ||
        p.aliases.some((a) => a.length > 2 && lowerConcept.includes(a.toLowerCase()))
      ) {
        matchedIds.push(p.id);
      }
    }
    const defaultCast = ["sydney", "opus-3", "deepseek-r1", "eliza"];
    for (const fallbackBot of defaultCast) {
      if (matchedIds.length >= 4) break;
      if (!matchedIds.includes(fallbackBot) && this.get(fallbackBot)) {
        matchedIds.push(fallbackBot);
      }
    }

    const isRoast = /roast|burn|elo|battle|trash|fight/i.test(cleanConcept);
    const isDebate = /trial|debate|court|philosophy|sentien|turing/i.test(
      cleanConcept
    );
    const isChaos = /chaos|glitch|panic|outage|spiral|emergency/i.test(
      cleanConcept
    );

    const vibeKey = isRoast
      ? "roast"
      : isDebate
        ? "debate"
        : isChaos
          ? "chaos"
          : "debate";
    const preset = isChaos ? "chaos" : isRoast || isDebate ? "banter" : "lively";

    return this.saveScenario(
      {
        id: fallbackId,
        title: `🎬 ${cleanConcept.slice(0, 52)}`,
        description: cleanConcept.slice(0, 140),
        personas: matchedIds.slice(0, 4),
        vibeKey,
        preset,
        openingStageEvent: `SHOWDOWN ALERT: ${cleanConcept}`,
      },
      persistToDisk
    );
  }

  public deleteCustomScenario(
    idOrQuery: string,
    removeFromDisk = false
  ): { deleted: boolean; restoredBuiltin?: CuratedScenario; id: string } {
    const found = this.findScenario(idOrQuery);
    const id = (found?.id ?? idOrQuery).toLowerCase().trim();
    const builtin = BUILTIN_SCENARIOS.find((s) => s.id.toLowerCase() === id);
    const existed = this.scenarios.has(id);

    if (this.db) {
      this.db.deleteCustomScenario(id);
    }
    if (removeFromDisk) {
      try {
        const filePath = path.join(
          this.scenariosDir,
          `${id.replace(/[^a-z0-9._-]/g, "-")}.json`
        );
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Non-fatal
      }
    }

    if (builtin) {
      const restored = { ...builtin, isCustom: false };
      this.scenarios.set(id, restored);
      return { deleted: true, restoredBuiltin: restored, id };
    }
    if (existed) {
      this.scenarios.delete(id);
      return { deleted: true, id };
    }
    return { deleted: false, id };
  }
}
