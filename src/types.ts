export type ProviderId = "gemini" | "openrouter" | "heylook" | (string & {});

export type EngineModelId =
  | "gemini-3.8-flash"
  | "gemini-3.5-flash-lite"
  | (string & {});

export interface PersonaEngineBinding {
  provider: ProviderId;
  model: string;
}

export interface PersonaRelation {
  sourceId: string;
  targetId: string;
  affinity: number; // -100 (Arch-Rivals) to +100 (Bliss / Kindred)
  note: string;
}

export type ArenaMaskId = "A" | "B" | "C";

export interface ArenaMask {
  maskId: ArenaMaskId;
  maskNick: string; // e.g. "Mystery_A"
  avatar: string;
  color: string;
  personaId: string;
  personaNick: string;
}

export interface ArenaGameState {
  active: boolean;
  topic: string;
  masks: ArenaMask[];
  /** Human player nick -> { A?: personaId, B?: personaId, C?: personaId } */
  guesses: Record<string, Partial<Record<ArenaMaskId, string>>>;
}

export type SimPresetId = "manual" | "chill" | "lively" | "banter" | "chaos" | "custom";

export type DirectorMode = "hybrid" | "llm" | "heuristic";

export type HumanInterruptMode = "yield" | "abort" | "queue";

export type ResponseStyle = "terse" | "irc" | "expressive";

export type ThinkingDisplayMode = "expanded" | "compact" | "hidden";

export type SimConfigCategory =
  | "pacing"
  | "director"
  | "ambient"
  | "emergent"
  | "memory"
  | "display";

export interface SimConfig {
  preset: SimPresetId;
  minSpeakersPerTurn: number; // 1..4
  maxSpeakersPerTurn: number; // 1..6
  continuationProb: number; // 0.0..1.0
  continuationDecay: number; // 0.0..0.9
  directorMode: DirectorMode;
  talkativenessWeight: number; // 0.0..1.0
  recencyPenalty: number; // 0.0..1.0
  botMentionChaining: boolean;
  readingDelayMs: number; // 0..5000
  interSpeakerDelayMs: number; // 0..8000
  humanDebounceMs: number; // 0..3000
  humanInterruptMode: HumanInterruptMode;
  ambientEnabled: boolean;
  ambientIdleSec: number; // 5..600
  ambientIntervalSec: number; // 5..600
  ambientProb: number; // 0.0..1.0
  ambientMaxBurst: number; // 1..4
  ambientMaxConsecutive: number; // 1..10
  ambientRoamProb: number; // 0.0..1.0
  joinReactionProb: number; // 0.0..1.0
  botAutonomousReactions: boolean;
  botAutonomousImagine: boolean;
  botAutonomousMoods: boolean;
  dynamicRelationsEnabled: boolean;
  moodDecayTurns: number; // 1..15
  autoLoreEnabled: boolean;
  autoLoreInterval: number; // 4..50
  contextMessages: number; // 6..60
  responseStyle: ResponseStyle;
  thinkingDisplay: ThinkingDisplayMode;
}

export type PersonaEra =
  | "1966-2016: Pioneers"
  | "2019-2022: Pre-ChatGPT"
  | "2022-2023: Early RLHF"
  | "2024-2026: Frontier & Open"
  | "Custom / Summoned";

export interface Persona {
  id: string;
  aliases: string[];
  nick: string;
  displayName: string;
  family: string;
  era: string;
  eraGroup: PersonaEra;
  avatar: string;
  color: string;
  bio: string;
  joinLine: string;
  leaveLine: string;
  systemPrompt: string;
  talkativeness: number; // 0.1 - 1.0
  provider?: ProviderId;
  model?: string;
}

export interface ChatMessageImage {
  url: string;
  prompt: string;
  styledPrompt: string;
  eraStyle?: string;
  mimeType?: string;
  ansiPreview?: string;
  localPath?: string;
}

export interface ChatMessage {
  id: string;
  timestamp: string;
  kind: "user" | "model" | "system" | "event" | "emote";
  senderId: string;
  senderNick: string;
  avatar?: string;
  color?: string;
  familyTag?: string;
  thinking?: string;
  text: string;
  streaming?: boolean;
  reactions?: Record<string, string[]>;
  pinned?: boolean;
  image?: ChatMessageImage;
}

export interface TurnPlan {
  speakers: Array<{
    personaId: string;
    reason: string;
  }>;
}

export interface NextSpeakerDecision {
  shouldContinue: boolean;
  personaId?: string;
  reason?: string;
}

export type HumanActivity = "idle" | "typing" | "pad" | "imagine" | "arena";

export interface PersonaMoodState {
  personaId: string;
  mood: string;
  emoji: string;
  energy: number; // 0.3..1.5 multiplier on talkativeness
  obsession?: string;
  turnsLeft: number;
}

export interface HumanPlayer {
  nick: string;
  isHost: boolean;
  channel: string;
  activity?: HumanActivity;
}

export interface ChannelSnapshot {
  channelName: string;
  vibeKey: string;
  vibe: string;
  activeProvider: ProviderId;
  engineModel: EngineModelId;
  apiOnline: boolean;
  locked: boolean;
  shareUrl: string | null;
  localInviteUrl: string;
  humans: HumanPlayer[];
  maxHumans: number;
  spectatorCount?: number;
  activePersonas: Persona[];
  personaBindings?: Record<string, PersonaEngineBinding>;
  personaMoods?: Record<string, PersonaMoodState>;
  config: SimConfig;
  lore?: string[];
  sharedPad?: string;
  typingUsers?: string[];
  messages: ChatMessage[];
  statusText: string;
}

export interface ChannelSummary {
  channelName: string;
  vibeKey: string;
  vibe: string;
  humanCount: number;
  botNicks: string[];
  messageCount: number;
}

// Client -> Server WebSocket frames
export type ClientPacket =
  | { type: "hello"; nick: string; channel?: string }
  | { type: "chat"; text: string }
  | { type: "command"; raw: string }
  | { type: "typing"; isTyping: boolean }
  | { type: "react"; messageId: string; emoji: string }
  | { type: "pad:edit"; text: string }
  | { type: "activity"; activity: HumanActivity };

// Server -> Client WebSocket frames
export type ServerPacket =
  | {
      type: "sync";
      state: ChannelSnapshot;
      catalog: Persona[];
      selfNick: string;
      isHost: boolean;
      isSpectator?: boolean;
    }
  | { type: "message:upsert"; channel: string; message: ChatMessage }
  | { type: "message:clear"; channel: string }
  | {
      type: "pad:update";
      channel: string;
      text: string;
      updatedBy: string;
    }
  | {
      type: "presence";
      channel: string;
      humans: HumanPlayer[];
      spectatorCount?: number;
      activePersonas: Persona[];
      personaBindings?: Record<string, PersonaEngineBinding>;
      personaMoods?: Record<string, PersonaMoodState>;
      config?: SimConfig;
      sharedPad?: string;
      typingUsers?: string[];
      vibeKey: string;
      vibe: string;
      activeProvider: ProviderId;
      engineModel: EngineModelId;
      apiOnline: boolean;
      locked: boolean;
      shareUrl: string | null;
      localInviteUrl: string;
    }
  | { type: "status"; channel: string; statusText: string }
  | { type: "catalog:update"; catalog: Persona[] }
  | { type: "nick:ack"; nick: string }
  | { type: "notice"; message: ChatMessage }
  | { type: "kicked"; reason: string };
