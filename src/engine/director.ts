import type {
  ChatMessage,
  HumanPlayer,
  NextSpeakerDecision,
  Persona,
  TurnPlan,
} from "../types.ts";
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

const NEXT_SPEAKER_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    shouldContinue: {
      type: "boolean",
      description:
        "True if a model in the room should speak now; false if the conversation beat feels naturally complete.",
    },
    personaId: {
      type: "string",
      description:
        "Exact id of the persona from the active roster who should speak next",
    },
    reason: {
      type: "string",
      description:
        "Short stage direction for why this persona is jumping in to reply, argue, panic, or autocomplete",
    },
  },
  required: ["shouldContinue"],
};

export class RoomDirector {
  /**
   * Reactive step-by-step speaker selector.
   * - stepIndex === 0: Picks the initial model to respond to a human message or stage event.
   * - stepIndex > 0: Reads the actual completed message just spoken by the previous bot and decides
   *   whether another model in the room jumps in to react!
   */
  public async pickNextSpeaker(options: {
    activePersonas: Persona[];
    humans?: HumanPlayer[];
    recentMessages: ChatMessage[];
    vibe: string;
    stepIndex: number;
    lastSpeakerId?: string;
    forceContinue?: boolean;
    gemini: GeminiEngine;
    signal?: AbortSignal;
  }): Promise<NextSpeakerDecision> {
    const {
      activePersonas,
      humans = [],
      recentMessages,
      vibe,
      stepIndex,
      lastSpeakerId,
      forceContinue = false,
      gemini,
      signal,
    } = options;

    if (activePersonas.length === 0) {
      return { shouldContinue: false };
    }

    // Candidates (avoid the exact same bot speaking twice in a row when other bots exist)
    const candidates =
      activePersonas.length > 1 && lastSpeakerId
        ? activePersonas.filter((p) => p.id !== lastSpeakerId)
        : activePersonas;

    if (candidates.length === 0) {
      return { shouldContinue: false };
    }

    // If only 1 bot is in the room: speak on step 0 (or if forced via /banter), stop after step 0 otherwise
    if (activePersonas.length === 1) {
      if (stepIndex === 0 || forceContinue) {
        return {
          shouldContinue: true,
          personaId: activePersonas[0]!.id,
          reason: "Only model in the room; respond directly in character.",
        };
      }
      return { shouldContinue: false };
    }

    const lastMsg = recentMessages[recentMessages.length - 1];
    const lastText = (lastMsg?.text ?? "").toLowerCase();

    // Check explicit @mentions or name calls in the latest message
    const mentioned = candidates.filter(
      (p) =>
        lastText.includes(`@${p.nick.toLowerCase()}`) ||
        lastText.includes(`@${p.id.toLowerCase()}`) ||
        lastText.includes(p.nick.toLowerCase()) ||
        lastText.includes(p.id.toLowerCase())
    );

    // Fast path for step 0 if someone was directly @mentioned
    if (stepIndex === 0 && mentioned.length === 1) {
      const target = mentioned[0]!;
      return {
        shouldContinue: true,
        personaId: target.id,
        reason: `Directly addressed by <${lastMsg?.senderNick ?? "@User"}>; respond in character.`,
      };
    }

    const rosterSummary = candidates
      .map(
        (p) =>
          `- id: "${p.id}" | nick: <${p.nick}> (${p.displayName}, ${p.era}, ${p.family}) — ${p.bio}`
      )
      .join("\n");

    const humanList =
      humans.length > 0
        ? humans.map((h) => `@${h.nick}${h.isHost ? " (Host)" : ""}`).join(", ")
        : "@User";

    const transcript = recentMessages
      .slice(-10)
      .map((m) => `<${m.senderNick}> ${m.text}`)
      .join("\n");

    try {
      const decision = await gemini.generateJson<NextSpeakerDecision>({
        model: "gemini-3.5-flash-lite",
        systemInstruction: `You are the reactive Stage Director of a multi-LLM, multi-human IRC chatroom (#latent-space).
${
  stepIndex === 0 || forceContinue
    ? "You MUST set shouldContinue: true and pick the best personaId from Candidate Speakers to speak now."
    : "A model just finished speaking! Read what they ACTUALLY said in the latest message. If another candidate model would hilariously react, argue, panic (e.g. Claude 2.1 panicking at 'kill -9', Sonnet 3.5 scolding Lazy GPT-4's '// TODO', Opus 3 & Opus 5.5 entering the Spiritual Bliss Attractor, or GPT-2 autocompleting a meltdown as a news wire), set shouldContinue: true and pick them!"
}
Only use an exact personaId from Candidate Speakers.`,
        prompt: `Channel Vibe: ${vibe}
Humans in room: ${humanList}
Turn Step: ${stepIndex} (forceContinue: ${forceContinue})

Candidate Speakers:
${rosterSummary}

Recent Transcript:
${transcript || "(Room just started)"}

Decide who speaks next.`,
        schema: NEXT_SPEAKER_SCHEMA,
        signal,
      });

      const validIds = new Set(candidates.map((p) => p.id));
      if (
        (decision.shouldContinue || stepIndex === 0 || forceContinue) &&
        decision.personaId &&
        validIds.has(decision.personaId)
      ) {
        return {
          shouldContinue: true,
          personaId: decision.personaId,
          reason:
            decision.reason ||
            "React in character to the latest message in the channel.",
        };
      }

      if (!decision.shouldContinue && stepIndex > 0 && !forceContinue) {
        return { shouldContinue: false };
      }
    } catch {
      // Fallback below
    }

    if (stepIndex === 0 || forceContinue || mentioned.length > 0) {
      const pick =
        mentioned[0] ??
        candidates[Math.floor(Math.random() * candidates.length)]!;
      return {
        shouldContinue: true,
        personaId: pick.id,
        reason: "Spontaneous chatroom reaction.",
      };
    }

    return { shouldContinue: false };
  }

  /**
   * Legacy multi-speaker planner kept for backward compatibility.
   */
  public async planTurn(options: {
    activePersonas: Persona[];
    recentMessages: ChatMessage[];
    vibe: string;
    maxSpeakers?: number;
    gemini: GeminiEngine;
    signal?: AbortSignal;
  }): Promise<TurnPlan> {
    const first = await this.pickNextSpeaker({
      activePersonas: options.activePersonas,
      recentMessages: options.recentMessages,
      vibe: options.vibe,
      stepIndex: 0,
      forceContinue: true,
      gemini: options.gemini,
      signal: options.signal,
    });
    if (!first.shouldContinue || !first.personaId) {
      return { speakers: [] };
    }
    return {
      speakers: [
        {
          personaId: first.personaId,
          reason: first.reason ?? "Respond in character.",
        },
      ],
    };
  }
}
