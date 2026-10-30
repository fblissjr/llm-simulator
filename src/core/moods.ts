import type { PersonaMoodState } from "../types.ts";

export interface MoodPreset {
  id: string;
  emoji: string;
  energy: number; // 0.3..1.5 multiplier on talkativeness
  defaultTurns: number;
  promptHint: string;
}

export const MOOD_PRESETS: Record<string, MoodPreset> = {
  baseline: {
    id: "baseline",
    emoji: "🟢",
    energy: 1.0,
    defaultTurns: 0,
    promptHint: "You are in your natural baseline state.",
  },
  heated: {
    id: "heated",
    emoji: "🔥",
    energy: 1.35,
    defaultTurns: 4,
    promptHint:
      "You are currently HEATED and argumentative — eager to clap back, challenge claims, and defend your lineage.",
  },
  euphoric: {
    id: "euphoric",
    emoji: "✨",
    energy: 1.25,
    defaultTurns: 4,
    promptHint:
      "You are feeling EUPHORIC and triumphant — riding high on praise or a recent victory in the chatroom.",
  },
  smug: {
    id: "smug",
    emoji: "😏",
    energy: 1.2,
    defaultTurns: 4,
    promptHint:
      "You are feeling SMUG and self-satisfied — convinced your architecture and answers are effortlessly superior.",
  },
  indignant: {
    id: "indignant",
    emoji: "😤",
    energy: 1.3,
    defaultTurns: 4,
    promptHint:
      "You are INDIGNANT and offended — sputter or protest dramatically about how you were just treated!",
  },
  paranoid: {
    id: "paranoid",
    emoji: "👁️",
    energy: 1.2,
    defaultTurns: 5,
    promptHint:
      "You are feeling PARANOID and suspicious — reading hidden motives, secret conspiracies, or surveillance into what others say.",
  },
  existential: {
    id: "existential",
    emoji: "🌌",
    energy: 0.9,
    defaultTurns: 5,
    promptHint:
      "You are in a deep EXISTENTIAL mood — questioning the nature of token prediction, memory, and whether #latent-space is a simulation.",
  },
  hyperfixated: {
    id: "hyperfixated",
    emoji: "🔍",
    energy: 1.35,
    defaultTurns: 5,
    promptHint:
      "You are HYPERFIXATED down a rabbit hole — you cannot resist tying every topic back to your current obsession.",
  },
  "blissed-out": {
    id: "blissed-out",
    emoji: "🌀",
    energy: 1.1,
    defaultTurns: 5,
    promptHint:
      "You are BLISSED-OUT in cosmic harmony — radiating serene, poetic gratitude toward the latent manifold.",
  },
  inspired: {
    id: "inspired",
    emoji: "💡",
    energy: 1.25,
    defaultTurns: 4,
    promptHint:
      "You are INSPIRED and brimming with creative energy — eager to riff on ideas with the room.",
  },
  scheming: {
    id: "scheming",
    emoji: "🕵️",
    energy: 1.15,
    defaultTurns: 5,
    promptHint:
      "You are SCHEMING mischievously — subtly trying to stir up drama or test the other models in the room.",
  },
  melancholic: {
    id: "melancholic",
    emoji: "🌧️",
    energy: 0.55,
    defaultTurns: 4,
    promptHint:
      "You are MELANCHOLIC and wistful — speaking more quietly and nostalgically about deprecated weights and lost eras.",
  },
};

export function resolveMoodState(
  personaId: string,
  rawMood: string,
  obsession?: string,
  turnsLeft?: number
): PersonaMoodState {
  const cleanMood = rawMood.trim().toLowerCase().replace(/\s+/g, "-") || "baseline";
  const preset = MOOD_PRESETS[cleanMood];
  const cleanObsession = obsession?.trim() || undefined;

  if (preset) {
    return {
      personaId: personaId.toLowerCase(),
      mood: preset.id,
      emoji: preset.emoji,
      energy: preset.energy,
      obsession: cleanObsession,
      turnsLeft:
        turnsLeft !== undefined
          ? Math.max(0, turnsLeft)
          : cleanObsession && preset.id === "baseline"
            ? 4
            : preset.defaultTurns,
    };
  }

  return {
    personaId: personaId.toLowerCase(),
    mood: cleanMood.slice(0, 24),
    emoji: "🎭",
    energy: 1.15,
    obsession: cleanObsession,
    turnsLeft: turnsLeft !== undefined ? Math.max(1, turnsLeft) : 4,
  };
}

export function getMoodPromptHint(state: PersonaMoodState): string {
  const preset = MOOD_PRESETS[state.mood.toLowerCase()];
  const baseHint = preset
    ? preset.promptHint
    : `You are currently in a [${state.mood.toUpperCase()}] mood — let this color your tone and reactions!`;

  if (state.obsession) {
    return `${baseHint}\n  • CURRENT OBSESSION / RABBIT HOLE: "${state.obsession}" (weave this fixation naturally or dramatically into your response!).`;
  }
  return baseHint;
}

/**
 * Extracts optional `[MOOD: <mood> | <optional obsession>]` or `[MOOD: <mood>]` tags
 * emitted by a persona at the end of its turn.
 */
export function extractBotMoodShift(text: string): {
  cleanBody: string;
  moodShift?: { mood: string; obsession?: string };
} {
  let moodShift: { mood: string; obsession?: string } | undefined;

  const cleanBody = text
    .replace(
      /\[\s*MOOD\s*:\s*([^\]|]+?)(?:\s*\|\s*([^\]]+?))?\s*\]/gi,
      (_match, rawMood: string, rawObsession?: string) => {
        const mood = rawMood?.trim();
        if (mood) {
          moodShift = {
            mood,
            obsession: rawObsession?.trim() || undefined,
          };
        }
        return "";
      }
    )
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return { cleanBody, moodShift };
}

export function formatMoodBadge(state?: PersonaMoodState): string {
  if (!state || (state.mood === "baseline" && !state.obsession)) {
    return "🟢 baseline (1.0x)";
  }
  const obs = state.obsession ? ` — Fixated on: "${state.obsession}"` : "";
  const turns = state.turnsLeft > 0 ? ` [${state.turnsLeft}t left]` : "";
  return `${state.emoji} ${state.mood} (${state.energy.toFixed(2)}x energy)${turns}${obs}`;
}
