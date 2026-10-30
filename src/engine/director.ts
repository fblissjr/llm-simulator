import type { RelationGraph } from "../core/relations.ts";
import { LIVELY_DEFAULT_CONFIG } from "../core/sim-config.ts";
import type {
  ChatMessage,
  HumanPlayer,
  NextSpeakerDecision,
  Persona,
  SimConfig,
  TurnPlan,
} from "../types.ts";
import type { GeminiEngine } from "./gemini.ts";

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

export interface CandidateScore {
  persona: Persona;
  weight: number;
  mentioned: boolean;
  recentTurnsAgo: number | null;
  relationAffinity?: number;
  relationNote?: string;
}

export class RoomDirector {
  /**
   * Finds candidates explicitly mentioned by @nick, @id, nick, or id in the given text.
   */
  public findMentionedCandidates(
    candidates: Persona[],
    rawText: string
  ): Persona[] {
    const text = rawText.toLowerCase();
    if (!text.trim()) return [];

    // 1. Check explicit @nick or @id mentions first
    const explicitAt = candidates.filter((p) => {
      const nick = p.nick.toLowerCase();
      const id = p.id.toLowerCase();
      return (
        text.includes(`@${nick}`) ||
        text.includes(`@${id}`) ||
        text.includes(`<${nick}>`) ||
        text.includes(`<@${nick}>`)
      );
    });
    if (explicitAt.length > 0) {
      return explicitAt;
    }

    // 2. Check word-boundary nick or id mentions
    return candidates.filter((p) => {
      const tokens = [p.nick.toLowerCase(), p.id.toLowerCase()].filter(
        (t) => t.length >= 3
      );

      return tokens.some((token) => {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(?:^|[^a-z0-9_-])${escaped}(?:$|[^a-z0-9_-])`, "i");
        return re.test(text);
      });
    });
  }

  /**
   * Scores candidate personas using:
   * - Persona.talkativeness weighted by config.talkativenessWeight
   * - Recency penalty (config.recencyPenalty) so the same 1-2 bots don't monopolize the room
   * - Direct @mention boost
   */
  public scoreCandidates(
    candidates: Persona[],
    recentMessages: ChatMessage[],
    mentionedIds: Set<string>,
    config: SimConfig,
    options?: {
      lastSpeakerId?: string;
      relations?: RelationGraph;
    }
  ): CandidateScore[] {
    const recentModelSenders = recentMessages
      .filter((m) => m.kind === "model")
      .slice(-4)
      .reverse()
      .map((m) => m.senderId);

    return candidates.map((persona) => {
      const talk = Math.max(0.1, Math.min(1.0, persona.talkativeness ?? 0.6));
      const baseWeight =
        1.0 * (1 - config.talkativenessWeight) +
        talk * config.talkativenessWeight;

      const idx = recentModelSenders.indexOf(persona.id);
      const recentTurnsAgo = idx >= 0 ? idx + 1 : null;

      let recencyMultiplier = 1.0;
      if (recentTurnsAgo !== null && config.recencyPenalty > 0) {
        // Recent speakers get penalized proportionally so quieter/idle bots get a turn
        const distanceFactor =
          recentTurnsAgo === 1
            ? 0.85
            : recentTurnsAgo === 2
              ? 0.65
              : recentTurnsAgo === 3
                ? 0.4
                : 0.2;
        recencyMultiplier = Math.max(
          0.12,
          1 - distanceFactor * config.recencyPenalty
        );
      }

      const mentioned = mentionedIds.has(persona.id);
      const mentionMultiplier = mentioned ? 3.0 : 1.0;

      let relationMultiplier = 1.0;
      let relationAffinity: number | undefined;
      let relationNote: string | undefined;
      if (options?.lastSpeakerId && options?.relations) {
        const rel = options.relations.get(persona.id, options.lastSpeakerId);
        if (rel && Math.abs(rel.affinity) >= 25) {
          relationAffinity = rel.affinity;
          relationNote = rel.note;
          relationMultiplier = 1.0 + Math.abs(rel.affinity) / 140;
        }
      }

      return {
        persona,
        weight: Math.max(
          0.05,
          baseWeight * recencyMultiplier * mentionMultiplier * relationMultiplier
        ),
        mentioned,
        recentTurnsAgo,
        relationAffinity,
        relationNote,
      };
    });
  }

  public pickWeightedCandidate(
    scored: CandidateScore[],
    randomFn: () => number = Math.random
  ): CandidateScore {
    const mentionedOnly = scored.filter((s) => s.mentioned);
    const pool = mentionedOnly.length > 0 ? mentionedOnly : scored;

    const totalWeight = pool.reduce((acc, item) => acc + item.weight, 0);
    if (totalWeight <= 0) {
      return pool[0]!;
    }

    let roll = randomFn() * totalWeight;
    for (const item of pool) {
      roll -= item.weight;
      if (roll <= 0) {
        return item;
      }
    }
    return pool[pool.length - 1]!;
  }

  /**
   * Computes probability (0..1) that a multi-bot chain should continue at stepIndex > 0.
   */
  public computeContinuationProbability(options: {
    stepIndex: number;
    config: SimConfig;
    hasMentionedCandidate: boolean;
    lastMessageText: string;
    vibe: string;
  }): number {
    const { stepIndex, config, hasMentionedCandidate, lastMessageText, vibe } =
      options;
    if (stepIndex === 0) return 1.0;
    if (stepIndex < config.minSpeakersPerTurn) return 1.0;
    if (config.continuationProb <= 0) return 0.0;

    let prob =
      config.continuationProb -
      Math.max(0, stepIndex - 1) * config.continuationDecay;

    if (hasMentionedCandidate && config.botMentionChaining) {
      prob += 0.3;
    }
    if (lastMessageText.includes("?")) {
      prob += 0.12;
    }
    const lowerVibe = vibe.toLowerCase();
    if (
      lowerVibe.includes("debate") ||
      lowerVibe.includes("roast") ||
      lowerVibe.includes("chaos")
    ) {
      prob += 0.1;
    }

    return Math.max(0, Math.min(0.96, prob));
  }

  /**
   * Reactive step-by-step speaker selector.
   * - stepIndex === 0: Picks the initial model to respond to a human message, emote, or ambient beat.
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
    spokenInTurnIds?: string[];
    forceContinue?: boolean;
    isAmbient?: boolean;
    config?: SimConfig;
    relations?: RelationGraph;
    randomFn?: () => number;
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
      spokenInTurnIds = [],
      forceContinue = false,
      isAmbient = false,
      config = LIVELY_DEFAULT_CONFIG,
      relations,
      randomFn = Math.random,
      gemini,
      signal,
    } = options;

    if (activePersonas.length === 0) {
      return { shouldContinue: false };
    }

    // Candidates (avoid the exact same bot speaking twice in a row when other bots exist)
    const nonRepeatingCandidates =
      activePersonas.length > 1 && lastSpeakerId
        ? activePersonas.filter((p) => p.id !== lastSpeakerId)
        : activePersonas;

    if (nonRepeatingCandidates.length === 0) {
      return { shouldContinue: false };
    }

    const lastMsg = recentMessages[recentMessages.length - 1];
    const lastText = lastMsg?.text ?? "";
    const mentionedAll = this.findMentionedCandidates(
      nonRepeatingCandidates,
      lastText
    );

    // Prefer bots who haven't spoken yet in this turn chain unless a bot who already spoke was explicitly @mentioned
    const spokenSet = new Set(spokenInTurnIds);
    const freshInTurn = nonRepeatingCandidates.filter(
      (p) => !spokenSet.has(p.id)
    );
    const candidates =
      freshInTurn.length > 0 && mentionedAll.length === 0
        ? freshInTurn
        : nonRepeatingCandidates;

    // If only 1 bot is in the room: speak on step 0 (or if forced via /banter), stop after step 0 otherwise
    if (activePersonas.length === 1) {
      if (stepIndex === 0 || forceContinue) {
        return {
          shouldContinue: true,
          personaId: activePersonas[0]!.id,
          reason: isAmbient
            ? "The channel is quiet; share an in-character thought or observation."
            : "Only model in the room; respond directly in character.",
        };
      }
      return { shouldContinue: false };
    }

    const mentioned = this.findMentionedCandidates(candidates, lastText);
    const mentionedIds = new Set(mentioned.map((p) => p.id));
    const scored = this.scoreCandidates(
      candidates,
      recentMessages,
      mentionedIds,
      config,
      { lastSpeakerId, relations }
    );

    const mustContinue =
      stepIndex === 0 ||
      forceContinue ||
      stepIndex < config.minSpeakersPerTurn;

    const continuationProb = this.computeContinuationProbability({
      stepIndex,
      config,
      hasMentionedCandidate:
        mentioned.length > 0 && (stepIndex === 0 || config.botMentionChaining),
      lastMessageText: lastText,
      vibe,
    });

    // If continuationProb is 0 (e.g. "manual" preset on step > 0), stop immediately
    if (!mustContinue && continuationProb <= 0) {
      return { shouldContinue: false };
    }

    // Fast path for step 0 if someone was directly @mentioned
    if (stepIndex === 0 && mentioned.length === 1) {
      const target = mentioned[0]!;
      return {
        shouldContinue: true,
        personaId: target.id,
        reason: `Directly addressed by <${lastMsg?.senderNick ?? "@User"}>; respond in character.`,
      };
    }

    // Fast path for step > 0 in hybrid mode when Bot A explicitly @mentioned Bot B by @nick
    if (
      stepIndex > 0 &&
      config.directorMode === "hybrid" &&
      config.botMentionChaining &&
      mentioned.length === 1 &&
      lastText.toLowerCase().includes(`@${mentioned[0]!.nick.toLowerCase()}`)
    ) {
      if (mustContinue || randomFn() < continuationProb) {
        const target = mentioned[0]!;
        return {
          shouldContinue: true,
          personaId: target.id,
          reason: `<${lastMsg?.senderNick ?? "Another model"}> just called you out directly (@${target.nick}) — clap back or react in character!`,
        };
      }
    }

    // Heuristic mode skips extra LLM calls for zero-latency turn routing
    if (config.directorMode === "heuristic") {
      if (!mustContinue && randomFn() >= continuationProb) {
        return { shouldContinue: false };
      }
      const chosen = this.pickWeightedCandidate(scored, randomFn);
      const reason = isAmbient
        ? stepIndex === 0
          ? "The IRC channel has been quiet for a moment — spark an in-character remark, hot take, or question for another model in the room!"
          : `React spontaneously to <${lastMsg?.senderNick ?? "the previous speaker"}>'s remark.`
        : chosen.mentioned
          ? `<${lastMsg?.senderNick ?? "@User"}> mentioned you — respond directly in character!`
          : stepIndex === 0
            ? `Respond in character to <${lastMsg?.senderNick ?? "@User"}>.`
            : `Jump in to react, agree, or argue with what <${lastMsg?.senderNick ?? "the previous model"}> just said!`;
      return {
        shouldContinue: true,
        personaId: chosen.persona.id,
        reason,
      };
    }

    const rosterSummary = scored
      .map(
        ({
          persona: p,
          weight,
          recentTurnsAgo,
          relationAffinity,
          relationNote,
        }) => {
          const recencyNote =
            recentTurnsAgo !== null
              ? ` [spoke ${recentTurnsAgo} turn(s) ago]`
              : " [fresh]";
          const relInfo =
            relationAffinity !== undefined
              ? ` [affinity to last speaker: ${relationAffinity >= 0 ? `+${relationAffinity}` : relationAffinity} (${relationNote})]`
              : "";
          return `- id: "${p.id}" | nick: <${p.nick}> (${p.displayName}, ${p.era}, ${p.family}, talkativeness: ${p.talkativeness}, priorityWeight: ${weight.toFixed(2)}${recencyNote}${relInfo}) — ${p.bio}`;
        }
      )
      .join("\n");

    const humanList =
      humans.length > 0
        ? humans.map((h) => `@${h.nick}${h.isHost ? " (Host)" : ""}`).join(", ")
        : "@User";

    const transcript = recentMessages
      .slice(-10)
      .map((m) =>
        m.kind === "emote"
          ? `* ${m.senderNick} ${m.text}`
          : `<${m.senderNick}> ${m.text}`
      )
      .join("\n");

    try {
      const decision = await gemini.generateJson<NextSpeakerDecision>({
        model: "gemini-3.5-flash-lite",
        systemInstruction: `You are the reactive Stage Director of a multi-LLM, multi-human IRC chatroom (#latent-space).
${
  mustContinue
    ? "You MUST set shouldContinue: true and pick the best personaId from Candidate Speakers to speak now."
    : `A model just finished speaking! Read what they ACTUALLY said in the latest message. Target continuation probability for this beat is ${Math.round(continuationProb * 100)}%. If another candidate model would naturally react, argue, panic, roast, or chime in (favoring higher priorityWeight / fresh speakers or anyone called out), set shouldContinue: true and pick them!`
}
Only use an exact personaId from Candidate Speakers.`,
        prompt: `Channel Vibe: ${vibe}
Humans in room: ${humanList}
Turn Step: ${stepIndex} (forceContinue: ${forceContinue}, isAmbient: ${isAmbient})

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
        (decision.shouldContinue || mustContinue) &&
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

      if (!decision.shouldContinue && !mustContinue) {
        // If a bot was explicitly called out on step > 0 and botMentionChaining is enabled, allow a probabilistic clap-back
        if (
          config.botMentionChaining &&
          mentioned.length > 0 &&
          randomFn() < continuationProb
        ) {
          const target = mentioned[0]!;
          return {
            shouldContinue: true,
            personaId: target.id,
            reason: `<${lastMsg?.senderNick ?? "Another model"}> mentioned you — jump in with a quick reaction!`,
          };
        }
        return { shouldContinue: false };
      }
    } catch {
      // Fallback to weighted heuristic selector below
    }

    if (mustContinue || randomFn() < continuationProb) {
      const pick = this.pickWeightedCandidate(scored, randomFn);
      return {
        shouldContinue: true,
        personaId: pick.persona.id,
        reason: isAmbient
          ? "Break the silence in the IRC channel with an in-character observation or question for another model."
          : "Spontaneous chatroom reaction.",
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
