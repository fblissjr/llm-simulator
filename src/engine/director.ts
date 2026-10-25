import type { ChatMessage, Persona, TurnPlan } from "../types.ts";
import type { GeminiEngine } from "./gemini.ts";

const DIRECTOR_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    speakers: {
      type: "array",
      description:
        "Ordered list of 1 to 3 personaIds from the active room roster who should speak in sequence on this turn.",
      items: {
        type: "object",
        properties: {
          personaId: {
            type: "string",
            description: "Exact id of the persona from the active room roster",
          },
          reason: {
            type: "string",
            description:
              "Short dynamic direction for how/why this model responds or reacts to the previous speaker",
          },
        },
        required: ["personaId", "reason"],
      },
    },
  },
  required: ["speakers"],
};

export class RoomDirector {
  /**
   * Determines which models in the room should speak next and in what order.
   */
  public async planTurn(options: {
    activePersonas: Persona[];
    recentMessages: ChatMessage[];
    vibe: string;
    maxSpeakers?: number;
    gemini: GeminiEngine;
    signal?: AbortSignal;
  }): Promise<TurnPlan> {
    const {
      activePersonas,
      recentMessages,
      vibe,
      maxSpeakers = 2,
      gemini,
      signal,
    } = options;

    if (activePersonas.length === 0) {
      return { speakers: [] };
    }

    if (activePersonas.length === 1) {
      const only = activePersonas[0]!;
      return {
        speakers: [
          {
            personaId: only.id,
            reason: "Only model in the room; respond directly in character.",
          },
        ],
      };
    }

    const lastMsg = recentMessages[recentMessages.length - 1];
    const lastText = (lastMsg?.text ?? "").toLowerCase();

    // Check if any active persona was explicitly @mentioned or named
    const mentioned = activePersonas.filter(
      (p) =>
        lastText.includes(`@${p.nick.toLowerCase()}`) ||
        lastText.includes(`@${p.id.toLowerCase()}`) ||
        lastText.includes(p.nick.toLowerCase()) ||
        lastText.includes(p.id.toLowerCase())
    );

    const rosterSummary = activePersonas
      .map(
        (p) =>
          `- id: "${p.id}" | nick: <${p.nick}> (${p.displayName}, ${p.era}, ${p.family}) — ${p.bio}`
      )
      .join("\n");

    const transcript = recentMessages
      .slice(-10)
      .map((m) => `<${m.senderNick}> ${m.text}`)
      .join("\n");

    try {
      const plan = await gemini.generateJson<TurnPlan>({
        model: "gemini-3.5-flash-lite",
        systemInstruction: `You are the invisible Stage Director of a comedic, authentic multi-LLM IRC chatroom (#latent-space).
Pick 1 to ${maxSpeakers} models from the active roster to speak in sequence.
- If a model was directly addressed or @mentioned, put them FIRST.
- Then optionally pick 1 or 2 other models in the room who would hilariously react, disagree, autocomplete, panic, or banter with what was just said!
- Only use exact personaId values from the Active Roster.`,
        prompt: `Current Room Vibe / Topic: ${vibe}

Active Roster in #latent-space:
${rosterSummary}

Recent Transcript:
${transcript || "(Room just started)"}

Choose 1 to ${maxSpeakers} speakers in order.`,
        schema: DIRECTOR_SCHEMA,
        signal,
      });

      const validIds = new Set(activePersonas.map((p) => p.id));
      const validSpeakers = (plan.speakers || [])
        .filter((s) => validIds.has(s.personaId))
        .slice(0, maxSpeakers);

      if (validSpeakers.length > 0) {
        return { speakers: validSpeakers };
      }
    } catch {
      // Fallback below if structured call fails or is aborted
    }

    // Deterministic fallback: mentioned models first, plus a random bystander
    const chosen: Array<{ personaId: string; reason: string }> = [];
    for (const m of mentioned.slice(0, maxSpeakers)) {
      chosen.push({
        personaId: m.id,
        reason: "Directly mentioned in the message.",
      });
    }
    if (chosen.length === 0) {
      const shuffled = [...activePersonas].sort(() => Math.random() - 0.5);
      for (const p of shuffled.slice(0, Math.min(2, activePersonas.length))) {
        chosen.push({
          personaId: p.id,
          reason: "Spontaneous chatroom response.",
        });
      }
    }
    return { speakers: chosen };
  }
}
