export type EngineModelId = "gemini-3.8-flash" | "gemini-3.5-flash-lite";

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
