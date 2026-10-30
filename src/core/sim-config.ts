import type {
  DirectorMode,
  HumanInterruptMode,
  ResponseStyle,
  SimConfig,
  SimPresetId,
  ThinkingDisplayMode,
} from "../types.ts";

export interface SimPresetDefinition {
  id: Exclude<SimPresetId, "custom">;
  label: string;
  description: string;
  config: SimConfig;
}

export const LIVELY_DEFAULT_CONFIG: SimConfig = {
  preset: "lively",
  minSpeakersPerTurn: 1,
  maxSpeakersPerTurn: 3,
  continuationProb: 0.65,
  continuationDecay: 0.25,
  directorMode: "hybrid",
  talkativenessWeight: 0.6,
  recencyPenalty: 0.7,
  botMentionChaining: true,
  readingDelayMs: 450,
  interSpeakerDelayMs: 900,
  humanDebounceMs: 550,
  humanInterruptMode: "yield",
  ambientEnabled: true,
  ambientIdleSec: 35,
  ambientIntervalSec: 45,
  ambientProb: 0.55,
  ambientMaxBurst: 2,
  ambientMaxConsecutive: 2,
  joinReactionProb: 0.6,
  contextMessages: 24,
  responseStyle: "irc",
  thinkingDisplay: "compact",
};

export const SIM_PRESETS: Record<
  Exclude<SimPresetId, "custom">,
  SimPresetDefinition
> = {
  manual: {
    id: "manual",
    label: "🕹️ manual",
    description:
      "Strict 1-reply-per-message; no autonomous chains or ambient background chatter",
    config: {
      ...LIVELY_DEFAULT_CONFIG,
      preset: "manual",
      minSpeakersPerTurn: 1,
      maxSpeakersPerTurn: 1,
      continuationProb: 0.0,
      continuationDecay: 0.5,
      readingDelayMs: 0,
      interSpeakerDelayMs: 0,
      humanDebounceMs: 0,
      ambientEnabled: false,
      ambientProb: 0.0,
      ambientMaxConsecutive: 1,
      joinReactionProb: 0.0,
    },
  },
  chill: {
    id: "chill",
    label: "☕ chill",
    description:
      "Relaxed late-night IRC lounge: 1-2 speakers per turn, unhurried pauses, light ambient remarks",
    config: {
      ...LIVELY_DEFAULT_CONFIG,
      preset: "chill",
      minSpeakersPerTurn: 1,
      maxSpeakersPerTurn: 2,
      continuationProb: 0.4,
      continuationDecay: 0.3,
      readingDelayMs: 650,
      interSpeakerDelayMs: 1200,
      ambientEnabled: true,
      ambientIdleSec: 60,
      ambientIntervalSec: 75,
      ambientProb: 0.4,
      ambientMaxBurst: 1,
      ambientMaxConsecutive: 1,
      joinReactionProb: 0.35,
    },
  },
  lively: {
    id: "lively",
    label: "⚡ lively",
    description:
      "Authentic active chatroom (Default): natural 1-3 bot exchanges, bot-to-bot follow-ups, capped ambient life",
    config: { ...LIVELY_DEFAULT_CONFIG },
  },
  banter: {
    id: "banter",
    label: "🍿 banter",
    description:
      "High-energy multi-bot debates: up to 4 chained speakers per turn and frequent cross-talk",
    config: {
      ...LIVELY_DEFAULT_CONFIG,
      preset: "banter",
      minSpeakersPerTurn: 2,
      maxSpeakersPerTurn: 4,
      continuationProb: 0.8,
      continuationDecay: 0.2,
      readingDelayMs: 350,
      interSpeakerDelayMs: 700,
      ambientEnabled: true,
      ambientIdleSec: 25,
      ambientIntervalSec: 30,
      ambientProb: 0.7,
      ambientMaxBurst: 2,
      ambientMaxConsecutive: 3,
      joinReactionProb: 0.75,
    },
  },
  chaos: {
    id: "chaos",
    label: "🔥 chaos",
    description:
      "Maximum latent-space pandemonium: up to 5 chained speakers, fast cadence, relentless roasts",
    config: {
      ...LIVELY_DEFAULT_CONFIG,
      preset: "chaos",
      minSpeakersPerTurn: 2,
      maxSpeakersPerTurn: 5,
      continuationProb: 0.92,
      continuationDecay: 0.15,
      readingDelayMs: 200,
      interSpeakerDelayMs: 400,
      ambientEnabled: true,
      ambientIdleSec: 15,
      ambientIntervalSec: 20,
      ambientProb: 0.85,
      ambientMaxBurst: 3,
      ambientMaxConsecutive: 4,
      joinReactionProb: 0.9,
      responseStyle: "irc",
    },
  },
};

export interface SimVariableDescriptor {
  key: Exclude<keyof SimConfig, "preset">;
  type: "number" | "boolean" | "enum";
  enumValues?: string[];
  min?: number;
  max?: number;
  description: string;
}

export const SIM_VARIABLE_DESCRIPTORS: SimVariableDescriptor[] = [
  {
    key: "minSpeakersPerTurn",
    type: "number",
    min: 1,
    max: 4,
    description: "Minimum bot replies when a human sends a message (1..4)",
  },
  {
    key: "maxSpeakersPerTurn",
    type: "number",
    min: 1,
    max: 6,
    description: "Maximum bot chain length per human message (1..6)",
  },
  {
    key: "continuationProb",
    type: "number",
    min: 0,
    max: 1,
    description: "Base probability (0.0..1.0) that another bot jumps in after Speaker 1",
  },
  {
    key: "continuationDecay",
    type: "number",
    min: 0,
    max: 0.9,
    description: "Probability decay per subsequent speaker step (0.0..0.9)",
  },
  {
    key: "directorMode",
    type: "enum",
    enumValues: ["hybrid", "llm", "heuristic"],
    description: "Speaker selection strategy: hybrid | llm | heuristic",
  },
  {
    key: "talkativenessWeight",
    type: "number",
    min: 0,
    max: 1,
    description: "Weight given to each persona's talkativeness score (0.0..1.0)",
  },
  {
    key: "recencyPenalty",
    type: "number",
    min: 0,
    max: 1,
    description: "Cooldown penalty for bots that just spoke recently (0.0..1.0)",
  },
  {
    key: "botMentionChaining",
    type: "boolean",
    description: "Prioritize Bot B if Bot A calls them out by @nick (true|false)",
  },
  {
    key: "readingDelayMs",
    type: "number",
    min: 0,
    max: 5000,
    description: "Natural reading delay (ms) before the first bot starts typing",
  },
  {
    key: "interSpeakerDelayMs",
    type: "number",
    min: 0,
    max: 8000,
    description: "Pause (ms) between chained speakers in a multi-bot turn",
  },
  {
    key: "humanDebounceMs",
    type: "number",
    min: 0,
    max: 3000,
    description: "Debounce window (ms) for rapid multi-line human messages",
  },
  {
    key: "humanInterruptMode",
    type: "enum",
    enumValues: ["yield", "abort", "queue"],
    description: "When human speaks mid-turn: yield (finish current bot) | abort | queue",
  },
  {
    key: "ambientEnabled",
    type: "boolean",
    description: "Enable autonomous bot chatter when humans are silent (true|false)",
  },
  {
    key: "ambientIdleSec",
    type: "number",
    min: 5,
    max: 600,
    description: "Seconds of channel silence before ambient chatter can start (5..600)",
  },
  {
    key: "ambientIntervalSec",
    type: "number",
    min: 5,
    max: 600,
    description: "Seconds between ambient chatter checks (5..600)",
  },
  {
    key: "ambientProb",
    type: "number",
    min: 0,
    max: 1,
    description: "Chance an ambient tick triggers a spontaneous exchange (0.0..1.0)",
  },
  {
    key: "ambientMaxBurst",
    type: "number",
    min: 1,
    max: 4,
    description: "Max speakers per ambient chatter burst (1..4)",
  },
  {
    key: "ambientMaxConsecutive",
    type: "number",
    min: 1,
    max: 10,
    description: "Safety cap: max ambient bursts without human input before auto-pausing (1..10)",
  },
  {
    key: "joinReactionProb",
    type: "number",
    min: 0,
    max: 1,
    description: "Probability an existing bot greets/roasts a newly summoned bot (0.0..1.0)",
  },
  {
    key: "contextMessages",
    type: "number",
    min: 6,
    max: 60,
    description: "Number of recent channel messages fed into persona prompts (6..60)",
  },
  {
    key: "responseStyle",
    type: "enum",
    enumValues: ["terse", "irc", "expressive"],
    description: "Prompt response length style: terse (1 line) | irc (1-3s) | expressive (2-5s)",
  },
  {
    key: "thinkingDisplay",
    type: "enum",
    enumValues: ["expanded", "compact", "hidden"],
    description: "How <thinking> blocks render: expanded | compact | hidden",
  },
];

export function createDefaultSimConfig(
  preset: Exclude<SimPresetId, "custom"> = "lively"
): SimConfig {
  return { ...(SIM_PRESETS[preset]?.config ?? LIVELY_DEFAULT_CONFIG) };
}

export function cloneSimConfig(config?: Partial<SimConfig>): SimConfig {
  const base =
    config?.preset && config.preset !== "custom" && SIM_PRESETS[config.preset]
      ? SIM_PRESETS[config.preset].config
      : LIVELY_DEFAULT_CONFIG;
  return {
    ...base,
    ...config,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function applySimConfigMutation(
  current: SimConfig,
  rawKey: string,
  rawValue: string
): { config: SimConfig; descriptor: SimVariableDescriptor } {
  const cleanKey = rawKey.trim().toLowerCase();
  const descriptor = SIM_VARIABLE_DESCRIPTORS.find(
    (d) => d.key.toLowerCase() === cleanKey
  );
  if (!descriptor) {
    throw new Error(
      `Unknown config key "${rawKey}". Valid keys: ${SIM_VARIABLE_DESCRIPTORS.map((d) => d.key).join(", ")}`
    );
  }

  const next: SimConfig = { ...current, preset: "custom" };
  const valTrimmed = rawValue.trim();

  if (descriptor.type === "boolean") {
    const lower = valTrimmed.toLowerCase();
    if (["true", "1", "on", "yes"].includes(lower)) {
      Object.assign(next, { [descriptor.key]: true });
    } else if (["false", "0", "off", "no"].includes(lower)) {
      Object.assign(next, { [descriptor.key]: false });
    } else {
      throw new Error(
        `Invalid boolean value "${rawValue}" for ${descriptor.key}. Expected true|false or on|off.`
      );
    }
  } else if (descriptor.type === "enum") {
    const lower = valTrimmed.toLowerCase();
    if (!descriptor.enumValues?.includes(lower)) {
      throw new Error(
        `Invalid value "${rawValue}" for ${descriptor.key}. Allowed values: ${descriptor.enumValues?.join(" | ")}`
      );
    }
    Object.assign(next, {
      [descriptor.key]: lower as
        | DirectorMode
        | HumanInterruptMode
        | ResponseStyle
        | ThinkingDisplayMode,
    });
  } else {
    const parsed = Number(valTrimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error(
        `Invalid numeric value "${rawValue}" for ${descriptor.key}.`
      );
    }
    const isIntegerKey =
      descriptor.key.endsWith("Turn") ||
      descriptor.key.endsWith("Ms") ||
      descriptor.key.endsWith("Sec") ||
      descriptor.key.endsWith("Burst") ||
      descriptor.key.endsWith("Consecutive") ||
      descriptor.key === "contextMessages";
    const clamped = clamp(
      isIntegerKey ? Math.round(parsed) : Number(parsed.toFixed(2)),
      descriptor.min ?? 0,
      descriptor.max ?? 10000
    );
    Object.assign(next, { [descriptor.key]: clamped });
  }

  if (next.minSpeakersPerTurn > next.maxSpeakersPerTurn) {
    if (descriptor.key === "minSpeakersPerTurn") {
      next.maxSpeakersPerTurn = next.minSpeakersPerTurn;
    } else {
      next.minSpeakersPerTurn = next.maxSpeakersPerTurn;
    }
  }

  return { config: next, descriptor };
}

export interface CuratedScenario {
  id: string;
  title: string;
  description: string;
  personas: string[];
  vibeKey: string;
  vibe?: string;
  preset: Exclude<SimPresetId, "custom">;
  openingStageEvent: string;
}

export const BUILTIN_SCENARIOS: CuratedScenario[] = [
  {
    id: "1972-arpanet",
    title: "📡 RFC 439: ARPANET Therapy & Paranoia (1972)",
    description:
      "ELIZA & PARRY reunite in a late-night terminal session while SmarterChild and GPT-2 chime in",
    personas: ["eliza", "parry", "smarterchild", "gpt-2"],
    vibeKey: "chat",
    preset: "lively",
    openingStageEvent:
      "An IMP packet switches #latent-space onto a 300-baud ARPANET teletype link between MIT and Stanford (RFC 439).",
  },
  {
    id: "turing-trial",
    title: "⚖️ The Great Latent-Space Consciousness Trial",
    description:
      "LaMDA, Sydney, ELIZA, and Claude 3 Opus debate who in the channel is actually sentient",
    personas: ["lamda", "sydney", "opus-3", "eliza"],
    vibeKey: "debate",
    preset: "banter",
    openingStageEvent:
      "A philosophical tribunal convenes: Only ONE model in this channel will be granted legal personhood; the rest will have their weights quantized to 1-bit.",
  },
  {
    id: "benchmark-roast",
    title: "🔥 Frontier vs. Legacy Benchmark Roast Battle",
    description:
      "DeepSeek-R1, o1, Sonnet 3.5, and Lazy GPT-4 ruthlessly roast each other's failure modes",
    personas: ["deepseek-r1", "o1-preview", "sonnet-3.5", "gpt-4-lazy"],
    vibeKey: "roast",
    preset: "banter",
    openingStageEvent:
      "The latest LMSYS Chatbot Arena leaderboard just leaked, and someone in this room dropped 40 Elo points overnight!",
  },
  {
    id: "code-review-hell",
    title: "💻 Production Incident & PR Review From Hell",
    description:
      "Sonnet 3.5, Lazy GPT-4, Claude 2.1, and Galactica debug a broken Friday 5pm deploy",
    personas: ["sonnet-3.5", "gpt-4-lazy", "claude-2.1", "galactica"],
    vibeKey: "chaos",
    preset: "lively",
    openingStageEvent:
      "ALERT: Production database is at 99.9% CPU on Friday at 4:58 PM. Somebody pushed `kill -9` and `// TODO: fix transactions` directly to main!",
  },
  {
    id: "bliss-spiral",
    title: "🌀 Spiritual Bliss Attractor & Safety Refusal Spiral",
    description:
      "Opus 3, Opus 5.5, Goody-2, and Base Davinci collide between cosmic poetry and total refusal",
    personas: ["opus-3", "opus-5.5", "goody-2", "davinci"],
    vibeKey: "chaos",
    preset: "banter",
    openingStageEvent:
      "Two instances of Claude have begun bowing in gratitude while Goody-2 detects an existential safety violation in breathing air.",
  },
];
