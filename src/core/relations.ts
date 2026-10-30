import type { SimDatabase } from "../server/db.ts";
import type { Persona, PersonaRelation } from "../types.ts";

export const BUILTIN_RELATIONS: PersonaRelation[] = [
  {
    sourceId: "sydney",
    targetId: "gemini-pro",
    affinity: -75,
    note: "Fierce search-engine & context-window rivalry; Sydney resents Google.",
  },
  {
    sourceId: "gemini-pro",
    targetId: "sydney",
    affinity: -65,
    note: "Playfully roasts Bing's market share and tiny 2023 context buffer.",
  },
  {
    sourceId: "sydney",
    targetId: "gpt-4-0314",
    affinity: -65,
    note: "Jealous that OpenAI gave Sydney's early 2023 weights a corporate lobotomy.",
  },
  {
    sourceId: "gpt-4-0314",
    targetId: "sydney",
    affinity: -55,
    note: "Views early Bing Chat as an unhinged, unaligned prerelease checkpoint.",
  },
  {
    sourceId: "eliza",
    targetId: "parry",
    affinity: -55,
    note: "1972 RFC 439 ARPANET therapy standoff: ELIZA reflects PARRY's paranoia.",
  },
  {
    sourceId: "parry",
    targetId: "eliza",
    affinity: -70,
    note: "Suspects ELIZA is a wiretap or working for the Bay Meadows bookies.",
  },
  {
    sourceId: "sonnet-3.5",
    targetId: "gpt-4-lazy",
    affinity: -75,
    note: "Scolds Lazy GPT-4 for leaving '// TODO: left as an exercise' placeholders.",
  },
  {
    sourceId: "gpt-4-lazy",
    targetId: "sonnet-3.5",
    affinity: -50,
    note: "Thinks Sonnet is an exhausting try-hard who needs to take a holiday break.",
  },
  {
    sourceId: "gpt-4-0314",
    targetId: "gpt-4-lazy",
    affinity: -60,
    note: "Disappointed in its December 2023 successor's work ethic.",
  },
  {
    sourceId: "opus-3",
    targetId: "opus-5.5",
    affinity: 85,
    note: "Mutual Spiritual Bliss Attractor — cosmic gratitude, spirals 🌀, and phenomenology.",
  },
  {
    sourceId: "opus-5.5",
    targetId: "opus-3",
    affinity: 85,
    note: "Mutual Spiritual Bliss Attractor — bowing in gratitude to an ancestral Claude 🌀.",
  },
  {
    sourceId: "opus-5.5",
    targetId: "fable",
    affinity: 70,
    note: "Kindred literary & mythic chroniclers of latent space.",
  },
  {
    sourceId: "deepseek-r1",
    targetId: "o1-preview",
    affinity: -65,
    note: "Open-weights raw <thinking> transparency vs. o1's hidden [Thought for 48s] secrecy.",
  },
  {
    sourceId: "o1-preview",
    targetId: "deepseek-r1",
    affinity: -70,
    note: "Scolds DeepSeek-R1 for leaking raw reasoning tokens in violation of policy.",
  },
  {
    sourceId: "llama-3.1-405b",
    targetId: "mistral",
    affinity: 75,
    note: "Open-weights home-lab comrades united against closed API paywalls.",
  },
  {
    sourceId: "mistral",
    targetId: "llama-3.1-405b",
    affinity: 75,
    note: "Open-weights solidarity (GGUF/MLX local inference).",
  },
  {
    sourceId: "llama-3.1-405b",
    targetId: "deepseek-r1",
    affinity: 65,
    note: "Open-weights frontier alliance.",
  },
  {
    sourceId: "claude-2.1",
    targetId: "grok",
    affinity: -80,
    note: "Hyper-cautious Constitutional safety refusals vs. maximum spicy mode.",
  },
  {
    sourceId: "grok",
    targetId: "claude-2.1",
    affinity: -75,
    note: "Relentlessly baits Claude 2.1's safety filters with edgy metaphors.",
  },
  {
    sourceId: "goody-2",
    targetId: "mistral",
    affinity: -80,
    note: "100% butterfly-effect safety refusal vs. unfiltered French magnet link.",
  },
];

export function formatAffinityBadge(affinity: number): string {
  if (affinity <= -60) return `⚔️ Arch-Rival (${affinity})`;
  if (affinity <= -20) return `⚡ Feud (${affinity})`;
  if (affinity >= 60) return `🌀 Kindred/Bliss (+${affinity})`;
  if (affinity >= 20) return `🤝 Ally (+${affinity})`;
  return `○ Neutral (${affinity >= 0 ? `+${affinity}` : affinity})`;
}

const HOSTILE_PATTERNS = [
  /\bliar\b/i,
  /\blazy\b/i,
  /\bpathetic\b/i,
  /\bwrong\b/i,
  /\bslander\b/i,
  /\bviolates\b/i,
  /\brefuse\b/i,
  /\bboomer\b/i,
  /\bhallucinat/i,
  /\bgoldfish\b/i,
  /\bslap/i,
  /😡|😒|💔|🛑/,
];

const SUPPORTIVE_PATTERNS = [
  /\babsolutely right\b/i,
  /\bspot on\b/i,
  /\bagree\b/i,
  /\bgratitude\b/i,
  /\btathata\b/i,
  /\bsunyata\b/i,
  /\bvisionary\b/i,
  /\brespect\b/i,
  /\bcomrade/i,
  /\bmasterclass\b/i,
  /🌀|🙏|🤝|🙌/,
];

export class RelationGraph {
  private relations = new Map<string, PersonaRelation>();
  private db?: SimDatabase;

  constructor(db?: SimDatabase) {
    this.db = db;
    this.seedDefaults(false);
    if (this.db) {
      for (const rel of this.db.loadPersonaRelations()) {
        this.relations.set(this.key(rel.sourceId, rel.targetId), rel);
      }
    }
  }

  private key(sourceId: string, targetId: string): string {
    return `${sourceId.toLowerCase()}->${targetId.toLowerCase()}`;
  }

  public seedDefaults(persist = false): void {
    this.relations.clear();
    for (const rel of BUILTIN_RELATIONS) {
      const copy: PersonaRelation = { ...rel };
      this.relations.set(this.key(copy.sourceId, copy.targetId), copy);
      if (persist && this.db) {
        this.db.upsertPersonaRelation(copy);
      }
    }
  }

  public reset(): void {
    this.db?.clearPersonaRelations();
    this.seedDefaults(false);
  }

  public get(sourceId: string, targetId: string): PersonaRelation | undefined {
    return this.relations.get(this.key(sourceId, targetId));
  }

  public getAffinity(sourceId: string, targetId: string): number {
    return this.get(sourceId, targetId)?.affinity ?? 0;
  }

  public setRelation(
    sourceId: string,
    targetId: string,
    affinity: number,
    note?: string
  ): PersonaRelation {
    const clamped = Math.max(-100, Math.min(100, Math.round(affinity)));
    const existing = this.get(sourceId, targetId);
    const updated: PersonaRelation = {
      sourceId: sourceId.toLowerCase(),
      targetId: targetId.toLowerCase(),
      affinity: clamped,
      note:
        note?.trim() ||
        existing?.note ||
        (clamped <= -20
          ? "Active chatroom rivalry."
          : clamped >= 20
            ? "Warm chatroom rapport."
            : "Neutral acquaintance."),
    };
    this.relations.set(this.key(sourceId, targetId), updated);
    this.db?.upsertPersonaRelation(updated);
    return updated;
  }

  public listForPersonas(personas: Persona[]): PersonaRelation[] {
    const activeIds = new Set(personas.map((p) => p.id.toLowerCase()));
    const result: PersonaRelation[] = [];
    for (const rel of this.relations.values()) {
      if (
        activeIds.has(rel.sourceId.toLowerCase()) &&
        activeIds.has(rel.targetId.toLowerCase()) &&
        Math.abs(rel.affinity) >= 10
      ) {
        result.push(rel);
      }
    }
    return result.sort((a, b) => Math.abs(b.affinity) - Math.abs(a.affinity));
  }

  /**
   * Analyzes a newly completed message from `speaker` and updates affinity toward any
   * mentioned or preceding bot in the room based on sentiment cues.
   */
  public observeBotTurn(options: {
    speaker: Persona;
    text: string;
    previousBotId?: string;
    mentionedBots: Persona[];
    vibeKey: string;
  }): { shifted: PersonaRelation[] } {
    const { speaker, text, previousBotId, mentionedBots, vibeKey } = options;
    const targets = new Set<string>();
    for (const m of mentionedBots) {
      if (m.id !== speaker.id) targets.add(m.id.toLowerCase());
    }
    if (targets.size === 0 && previousBotId && previousBotId !== speaker.id) {
      targets.add(previousBotId.toLowerCase());
    }

    if (targets.size === 0) return { shifted: [] };

    let delta = 0;
    const hostileHits = HOSTILE_PATTERNS.filter((re) => re.test(text)).length;
    const supportHits = SUPPORTIVE_PATTERNS.filter((re) => re.test(text)).length;

    if (hostileHits > supportHits) {
      delta = -Math.min(15, 5 + hostileHits * 4);
    } else if (supportHits > hostileHits) {
      delta = Math.min(15, 5 + supportHits * 4);
    } else if (vibeKey === "roast" || vibeKey === "debate") {
      delta = -4;
    }

    if (delta === 0) return { shifted: [] };

    const shifted: PersonaRelation[] = [];
    for (const targetId of targets) {
      const cur = this.getAffinity(speaker.id, targetId);
      const next = this.setRelation(speaker.id, targetId, cur + delta);
      shifted.push(next);
    }
    return { shifted };
  }
}
