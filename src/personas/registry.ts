import * as fs from "node:fs";
import * as path from "node:path";
import type { GeminiEngine } from "../engine/gemini.ts";
import type { Persona } from "../types.ts";
import { BUILTIN_PERSONAS } from "./builtin.ts";

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
  private customDir: string;

  constructor(customDir = path.resolve(process.cwd(), "personas")) {
    this.customDir = customDir;
    for (const p of BUILTIN_PERSONAS) {
      this.personas.set(p.id.toLowerCase(), p);
    }
    this.loadCustomPersonas();
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
    if (persistToDisk) {
      try {
        fs.mkdirSync(this.customDir, { recursive: true });
        const filePath = path.join(
          this.customDir,
          `${persona.id.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}.json`
        );
        fs.writeFileSync(filePath, JSON.stringify(persona, null, 2), "utf-8");
      } catch {
        // Non-fatal if disk write fails
      }
    }
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

    const generated = await gemini.generateJson<Omit<Persona, "aliases" | "eraGroup">>({
      prompt: `Create an authentic, funny, historically/culturally accurate chatroom simulation persona for the AI model or chatbot: "${query}".
If it is a real historical or current LLM/chatbot, capture its actual verbal tics, famous incidents, formatting quirks, and era.
If it is a fictional, future, or speculative model (e.g. "GPT-7", "Opus 9", "HAL 9000", "Clippy"), lean into its lore and comedic characterization.`,
      systemInstruction:
        "You design hilarious, deeply accurate AI/LLM simulation personas for a multi-model IRC chatroom game.",
      schema: PERSONA_SCHEMA,
      model: "gemini-3.5-flash-lite",
    });

    const id = (generated.id || query)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9.-]+/g, "-");

    const persona: Persona = {
      id,
      aliases: [query.toLowerCase().trim()],
      nick: (generated.nick || query).replace(/\s+/g, "_").slice(0, 18),
      displayName: generated.displayName || query,
      family: generated.family || "Unknown Lab",
      era: generated.era || "Unknown Era",
      eraGroup: "Custom / Summoned",
      avatar: generated.avatar || "✨",
      color: generated.color?.startsWith("#") ? generated.color : "#8be9fd",
      bio: generated.bio || `Summoned persona for ${query}`,
      joinLine:
        generated.joinLine || `${generated.nick || query} has joined the room.`,
      leaveLine:
        generated.leaveLine || `${generated.nick || query} has left the room.`,
      systemPrompt: generated.systemPrompt,
      talkativeness: Math.max(
        0.3,
        Math.min(0.9, Number(generated.talkativeness) || 0.65)
      ),
    };

    this.register(persona, true);
    return { persona, createdNew: true };
  }
}
