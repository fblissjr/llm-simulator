export type ProviderId = "gemini" | "openrouter" | "heylook" | (string & {});

export type EngineModelId =
  | "gemini-3.8-flash"
  | "gemini-3.5-flash-lite"
  | (string & {});

export interface PersonaEngineBinding {
  provider: ProviderId;
  model: string;
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

export interface ChatMessage {
  id: string;
  timestamp: string;
  kind: "user" | "model" | "system" | "event";
  senderId: string;
  senderNick: string;
  avatar?: string;
  color?: string;
  familyTag?: string;
  thinking?: string;
  text: string;
  streaming?: boolean;
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

export interface HumanPlayer {
  nick: string;
  isHost: boolean;
  channel: string;
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
  activePersonas: Persona[];
  personaBindings?: Record<string, PersonaEngineBinding>;
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
  | { type: "command"; raw: string };

// Server -> Client WebSocket frames
export type ServerPacket =
  | {
      type: "sync";
      state: ChannelSnapshot;
      catalog: Persona[];
      selfNick: string;
      isHost: boolean;
    }
  | { type: "message:upsert"; channel: string; message: ChatMessage }
  | { type: "message:clear"; channel: string }
  | {
      type: "presence";
      channel: string;
      humans: HumanPlayer[];
      activePersonas: Persona[];
      personaBindings?: Record<string, PersonaEngineBinding>;
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
