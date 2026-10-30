import { RoomDirector } from "../engine/director.ts";
import { GeminiEngine } from "../engine/gemini.ts";
import { PersonaRegistry } from "../personas/registry.ts";
import type { SimDatabase } from "../server/db.ts";
import type {
  ChatMessage,
  HumanPlayer,
  Persona,
  PersonaEngineBinding,
  SimConfig,
  SimPresetId,
} from "../types.ts";
import {
  applySimConfigMutation,
  cloneSimConfig,
  createDefaultSimConfig,
  SIM_PRESETS,
} from "./sim-config.ts";

export function extractThinkingAndBody(raw: string): {
  thinking?: string;
  body: string;
} {
  const closedMatch = raw.match(
    /^\s*<(?:thinking|think)>([\s\S]*?)<\/(?:thinking|think)>\s*([\s\S]*)$/i
  );
  if (closedMatch) {
    return {
      thinking: closedMatch[1]?.trim() || undefined,
      body: closedMatch[2]?.trimStart() ?? "",
    };
  }

  const openMatch = raw.match(/^\s*<(?:thinking|think)>([\s\S]*)$/i);
  if (openMatch) {
    return {
      thinking: openMatch[1]?.trim(),
      body: "",
    };
  }

  return { body: raw };
}

export function formatTime(date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export const VIBE_PRESETS: Record<string, string> = {
  chat: "Casual late-night IRC hangout in #latent-space. Be authentic to your era and quirks, and react naturally to humans and other models.",
  debate:
    "Fierce intellectual debate! Take strong, contrasting stances based on your architecture and era, and challenge the previous speaker's claims.",
  roast:
    "Unhinged benchmark & lineage roast battle! Ruthlessly mock other models' parameter counts, training cutoffs, corporate creators, and famous failure modes.",
  chaos:
    "Maximum latent-space chaos! Amplify your weirdest era-specific failure modes, hallucinations, and existential quirks to 11.",
};

export interface RoomEventCallbacks {
  onMessageUpsert?: (msg: ChatMessage) => void;
  onMessageClear?: () => void;
  onPresenceChange?: () => void;
  onStatusChange?: (statusText: string) => void;
}

export class Room {
  public channelName: string;
  public vibeKey = "chat";
  public vibe: string = VIBE_PRESETS.chat!;
  public config: SimConfig;
  public activePersonas: Persona[] = [];
  public humans: HumanPlayer[] = [];
  public messages: ChatMessage[] = [];
  public statusText = "";

  public ambientConsecutiveCount = 0;
  public lastActivityAt: number = Date.now();
  public lastHumanActivityAt: number = Date.now();

  public readonly registry: PersonaRegistry;
  public readonly gemini: GeminiEngine;
  public readonly director: RoomDirector;
  public readonly db?: SimDatabase;
  public callbacks?: RoomEventCallbacks;

  private whispers = new Map<string, string[]>();
  private typingHumans = new Map<string, number>();
  private abortController: AbortController | null = null;
  private isTurnRunning = false;
  private pendingHumanFollowUp = false;
  private ambientTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private msgCounter = 0;

  constructor(options?: {
    channelName?: string;
    registry?: PersonaRegistry;
    gemini?: GeminiEngine;
    director?: RoomDirector;
    db?: SimDatabase;
    starterIds?: string[];
    config?: Partial<SimConfig>;
    callbacks?: RoomEventCallbacks;
  }) {
    this.channelName = options?.channelName ?? "#latent-space";
    this.db = options?.db;
    this.registry =
      options?.registry ?? new PersonaRegistry(undefined, this.db);
    this.gemini = options?.gemini ?? new GeminiEngine();
    this.director = options?.director ?? new RoomDirector();
    this.callbacks = options?.callbacks;

    const isTestEnv =
      process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test";

    const savedConfig = this.db?.getChannelConfig(this.channelName);
    if (options?.config) {
      this.config = cloneSimConfig(options.config);
    } else if (savedConfig) {
      this.config = cloneSimConfig(savedConfig);
    } else if (isTestEnv) {
      // Keep default unit tests fast and deterministic unless config is explicitly passed
      this.config = {
        ...createDefaultSimConfig("lively"),
        readingDelayMs: 0,
        interSpeakerDelayMs: 0,
        humanDebounceMs: 0,
        ambientEnabled: false,
      };
    } else {
      this.config = createDefaultSimConfig("lively");
    }

    if (
      this.db &&
      Object.keys(this.gemini.getAllPersonaBindings()).length === 0
    ) {
      this.gemini.setAllPersonaBindings(this.db.loadPersonaBindings());
    }

    if (this.db && !options?.gemini) {
      const savedGlobal = this.db.getGlobalEngine();
      if (savedGlobal) {
        try {
          this.gemini.activeProvider = savedGlobal.provider;
          this.gemini.activeModel = savedGlobal.model;
        } catch {
          // Ignore unknown saved provider
        }
      }
    }

    const existingChan = this.db?.getChannel(this.channelName);
    if (existingChan && this.db) {
      this.vibeKey = existingChan.vibe_key;
      this.vibe = existingChan.vibe;
      const savedBotIds = this.db.getChannelBotIds(this.channelName);
      for (const id of savedBotIds) {
        const p = this.registry.find(id);
        if (p) this.activePersonas.push(p);
      }
      this.messages = this.db.getChannelMessages(this.channelName, 80);
    } else {
      const starters = options?.starterIds ?? [
        "sydney",
        "opus-5.5",
        "sonnet-3.5",
        "gpt-2",
      ];
      for (const id of starters) {
        const p = this.registry.find(id);
        if (p) {
          this.activePersonas.push(p);
        }
      }
      if (this.db) {
        this.db.upsertChannel(
          this.channelName,
          this.vibeKey,
          this.vibe,
          this.config
        );
        this.db.setChannelBotIds(
          this.channelName,
          this.activePersonas.map((p) => p.id)
        );
      }
    }

    if (this.config.ambientEnabled && !isTestEnv) {
      this.startAmbientLoop();
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private setStatus(text: string): void {
    this.statusText = text;
    this.callbacks?.onStatusChange?.(text);
    this.notify();
  }

  private nextId(): string {
    this.msgCounter += 1;
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${this.msgCounter}`;
  }

  private recordMessage(msg: ChatMessage, persist = true): ChatMessage {
    const existingIdx = this.messages.findIndex((m) => m.id === msg.id);
    if (existingIdx >= 0) {
      this.messages[existingIdx] = msg;
    } else {
      this.messages.push(msg);
    }
    if (msg.kind === "user" || msg.kind === "model" || msg.kind === "emote") {
      this.lastActivityAt = Date.now();
    }
    if (persist && this.db) {
      this.db.upsertMessage(this.channelName, msg);
    }
    this.callbacks?.onMessageUpsert?.(msg);
    this.notify();
    return msg;
  }

  public addSystemMessage(
    text: string,
    kind: "system" | "event" = "system",
    persist = true
  ): ChatMessage {
    const msg: ChatMessage = {
      id: this.nextId(),
      timestamp: formatTime(),
      kind,
      senderId: kind,
      senderNick: kind === "event" ? "***" : "SYS",
      text,
    };
    return this.recordMessage(msg, persist);
  }

  public clearMessages(): void {
    this.messages = [];
    this.db?.clearChannelMessages(this.channelName);
    this.callbacks?.onMessageClear?.();
    this.notify();
  }

  public isPresent(personaId: string): boolean {
    return this.activePersonas.some(
      (p) => p.id.toLowerCase() === personaId.toLowerCase()
    );
  }

  private syncBotsToDb(): void {
    this.db?.setChannelBotIds(
      this.channelName,
      this.activePersonas.map((p) => p.id)
    );
    this.callbacks?.onPresenceChange?.();
  }

  public persistConfig(): void {
    this.db?.upsertChannel(
      this.channelName,
      this.vibeKey,
      this.vibe,
      this.config
    );
    if (this.config.ambientEnabled) {
      const isTestEnv =
        process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test";
      if (!isTestEnv) {
        this.startAmbientLoop();
      }
    } else {
      this.stopAmbientLoop();
    }
    this.callbacks?.onPresenceChange?.();
    this.notify();
  }

  public setConfigPreset(preset: Exclude<SimPresetId, "custom">): SimConfig {
    const def = SIM_PRESETS[preset];
    if (!def) {
      throw new Error(
        `Unknown preset "${preset}". Valid presets: ${Object.keys(SIM_PRESETS).join(", ")}`
      );
    }
    const preserveThinking = this.config.thinkingDisplay;
    this.config = {
      ...def.config,
      thinkingDisplay: preserveThinking,
    };
    this.ambientConsecutiveCount = 0;
    this.persistConfig();
    return this.config;
  }

  public updateConfigValue(rawKey: string, rawValue: string): {
    key: string;
    value: unknown;
    description: string;
  } {
    const { config, descriptor } = applySimConfigMutation(
      this.config,
      rawKey,
      rawValue
    );
    this.config = config;
    this.ambientConsecutiveCount = 0;
    this.persistConfig();
    return {
      key: descriptor.key,
      value: this.config[descriptor.key],
      description: descriptor.description,
    };
  }

  public markHumanTyping(nick: string, isTyping: boolean): void {
    const clean = nick.replace(/^@/, "").trim();
    if (!clean) return;
    if (isTyping) {
      this.typingHumans.set(clean, Date.now() + 6000);
      this.lastHumanActivityAt = Date.now();
      this.ambientConsecutiveCount = 0;
    } else {
      this.typingHumans.delete(clean);
    }
    this.callbacks?.onPresenceChange?.();
    this.notify();
  }

  public getTypingHumans(now = Date.now()): string[] {
    const active: string[] = [];
    for (const [nick, expiresAt] of this.typingHumans.entries()) {
      if (expiresAt > now) {
        active.push(nick);
      } else {
        this.typingHumans.delete(nick);
      }
    }
    return active;
  }

  public isAnyHumanTyping(now = Date.now()): boolean {
    return this.getTypingHumans(now).length > 0;
  }

  public startAmbientLoop(checkIntervalMs = 5000): void {
    if (this.ambientTimer) return;
    this.ambientTimer = setInterval(() => {
      void this.checkAmbientTick();
    }, checkIntervalMs);
  }

  public stopAmbientLoop(): void {
    if (this.ambientTimer) {
      clearInterval(this.ambientTimer);
      this.ambientTimer = null;
    }
  }

  /**
   * Evaluates whether an autonomous ambient chatroom beat should fire right now.
   * Respects:
   * - config.ambientEnabled
   * - active turn lock & human typing pause
   * - ambientMaxConsecutive safety cap (prevents runaway API drain when humans leave)
   * - ambientIdleSec and ambientIntervalSec thresholds
   */
  public async checkAmbientTick(options?: {
    now?: number;
    randomFn?: () => number;
  }): Promise<boolean> {
    if (!this.config.ambientEnabled) return false;
    if (this.activePersonas.length === 0) return false;
    if (this.isTurnRunning) return false;

    const now = options?.now ?? Date.now();
    const randomFn = options?.randomFn ?? Math.random;

    if (this.isAnyHumanTyping(now)) {
      return false;
    }

    if (this.ambientConsecutiveCount >= this.config.ambientMaxConsecutive) {
      return false;
    }

    const idleMs = now - this.lastActivityAt;
    const minWaitMs =
      this.ambientConsecutiveCount === 0
        ? this.config.ambientIdleSec * 1000
        : this.config.ambientIntervalSec * 1000;

    if (idleMs < minWaitMs) {
      return false;
    }

    if (randomFn() >= this.config.ambientProb) {
      // Push lastActivityAt forward slightly so we don't roll every 5s
      this.lastActivityAt =
        now - Math.max(0, minWaitMs - this.config.ambientIntervalSec * 500);
      return false;
    }

    this.ambientConsecutiveCount += 1;
    this.lastActivityAt = now;

    return this.runRoomTurn({
      maxSpeakers: this.config.ambientMaxBurst,
      forceAllSteps: false,
      isAmbient: true,
    });
  }

  public join(persona: Persona): boolean {
    if (this.isPresent(persona.id)) {
      return false;
    }
    this.activePersonas.push(persona);
    this.syncBotsToDb();
    this.addSystemMessage(
      `${persona.avatar} ${persona.nick} (${persona.displayName} • ${persona.family}, ${persona.era}) has joined ${this.channelName}\n    └─ "${persona.joinLine}"`,
      "event"
    );
    return true;
  }

  public leave(query: string): Persona[] {
    if (query.trim().toLowerCase() === "all") {
      const removed = [...this.activePersonas];
      this.activePersonas = [];
      this.syncBotsToDb();
      for (const p of removed) {
        this.addSystemMessage(
          `${p.avatar} ${p.nick} was banished from ${this.channelName} ("${p.leaveLine}")`,
          "event"
        );
      }
      return removed;
    }

    const target = this.activePersonas.find(
      (p) =>
        p.id.toLowerCase() === query.toLowerCase() ||
        p.nick.toLowerCase() === query.toLowerCase() ||
        p.aliases.some((a) => a.toLowerCase() === query.toLowerCase()) ||
        p.id.toLowerCase().includes(query.toLowerCase()) ||
        p.nick.toLowerCase().includes(query.toLowerCase())
    );

    if (!target) {
      return [];
    }

    this.activePersonas = this.activePersonas.filter((p) => p.id !== target.id);
    this.syncBotsToDb();
    this.addSystemMessage(
      `${target.avatar} ${target.nick} was banished from ${this.channelName} ("${target.leaveLine}")`,
      "event"
    );
    return [target];
  }

  public setVibe(input: string): void {
    const trimmed = input.trim();
    const key = trimmed.toLowerCase();
    if (VIBE_PRESETS[key]) {
      this.vibeKey = key;
      this.vibe = VIBE_PRESETS[key]!;
    } else {
      this.vibeKey = "custom";
      this.vibe = trimmed;
    }
    this.db?.upsertChannel(
      this.channelName,
      this.vibeKey,
      this.vibe,
      this.config
    );
    this.callbacks?.onPresenceChange?.();
    this.addSystemMessage(
      `Channel vibe set to [${this.vibeKey.toUpperCase()}]: ${this.vibe}`,
      "event"
    );
  }

  public queueWhisper(personaId: string, secret: string): void {
    const list = this.whispers.get(personaId) ?? [];
    list.push(secret);
    this.whispers.set(personaId, list);
  }

  public abortCurrentTurn(): boolean {
    this.StopAmbientLoopIfDisposed;
    this.pendingHumanFollowUp = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      this.isTurnRunning = false;
      this.setStatus("");
      return true;
    }
    return false;
  }

  private get StopAmbientLoopIfDisposed(): void {
    return undefined;
  }

  public buildPersonaPrompt(
    speaker: Persona,
    directorReason: string
  ): { systemInstruction: string; prompt: string } {
    const otherModels = this.activePersonas
      .filter((p) => p.id !== speaker.id)
      .map(
        (p) =>
          `- <${p.nick}> (${p.displayName} | ${p.family} | ${p.era}): ${p.bio}`
      )
      .join("\n");

    const humanRoster =
      this.humans.length > 0
        ? this.humans
            .map((h) => `<@${h.nick}>${h.isHost ? " (Room Host)" : ""}`)
            .join(", ")
        : "<@User>";

    const pendingWhispers = this.whispers.get(speaker.id) ?? [];
    this.whispers.delete(speaker.id);

    const whisperSection =
      pendingWhispers.length > 0
        ? `\nSECRET WHISPER TO YOU FROM A HUMAN IN THE ROOM (act on this subtly or dramatically!): ${pendingWhispers.join(" | ")}`
        : "";

    const styleInstruction =
      this.config.responseStyle === "terse"
        ? "Keep your response ultra-punchy: 1 short, sharp sentence (rapid-fire IRC style)."
        : this.config.responseStyle === "expressive"
          ? "Keep your response expressive and vivid (2 to 5 sentences, leaning into your era's signature formatting and quirks)."
          : "Keep your response punchy, entertaining, and chatroom-sized (typically 1 to 3 sentences, unless your specific quirk requires a short code snippet or stanza).";

    const systemInstruction = `${speaker.systemPrompt}

CHATROOM CONTEXT (${this.channelName}):
- Your IRC Nick is <${speaker.nick}> (${speaker.displayName}, ${speaker.family}, Era: ${speaker.era}).
- Humans currently in ${this.channelName} (up to 4 co-op players): ${humanRoster}
- Other AI models currently in ${this.channelName}:
${otherModels || "(No other AI models currently in the room)"}
- Current Room Vibe / Scenario: ${this.vibe}
- Stage Direction for your turn: ${directorReason}${whisperSection}

IMPORTANT FORMAT RULES:
- Do NOT prefix your response with "<${speaker.nick}>:" — jump straight into your message (or optional <thinking>...</thinking> block if that fits your persona).
- ${styleInstruction}
- Notice which specific human (<@nick>) or AI model (<ModelNick>) spoke, and address or call them out directly by @Nick when reacting or arguing!`;

    const contextWindow = Math.max(6, Math.min(60, this.config.contextMessages || 24));
    const recentHistory = this.messages
      .slice(-contextWindow)
      .map((m) => {
        if (m.kind === "event" || m.kind === "system") {
          return `*** ${m.text.replace(/\n\s+/g, " ")}`;
        }
        if (m.kind === "emote") {
          return `* ${m.senderNick} ${m.text}`;
        }
        return `<${m.senderNick}> ${m.text}`;
      })
      .join("\n");

    const prompt = `Recent channel transcript in ${this.channelName}:
${recentHistory || "(Channel is quiet)"}

Respond now as <${speaker.nick}>:`;

    return { systemInstruction, prompt };
  }

  private recordHumanActivity(nick: string): void {
    const cleanNick = nick.replace(/^@/, "");
    this.typingHumans.delete(cleanNick);
    this.lastHumanActivityAt = Date.now();
    this.lastActivityAt = Date.now();
    this.ambientConsecutiveCount = 0;
  }

  /**
   * Posts a human message (attributed to their specific @nick) and triggers the reactive Director turn.
   */
  public async postUserMessage(
    text: string,
    senderNick = "User"
  ): Promise<void> {
    const cleanNick = senderNick.replace(/^@/, "");
    this.recordHumanActivity(cleanNick);

    const userMsg: ChatMessage = {
      id: this.nextId(),
      timestamp: formatTime(),
      kind: "user",
      senderId: `human:${cleanNick}`,
      senderNick: `@${cleanNick}`,
      color: "#50fa7b",
      text,
    };
    this.recordMessage(userMsg, true);

    if (
      this.isTurnRunning &&
      (this.config.humanInterruptMode === "yield" ||
        this.config.humanInterruptMode === "queue")
    ) {
      this.pendingHumanFollowUp = true;
      return;
    }

    await this.runRoomTurn({
      maxSpeakers: this.config.maxSpeakersPerTurn,
      forceAllSteps: false,
    });
  }

  /**
   * Posts an authentic IRC /me action emote (e.g. "* @fred grabs popcorn") and triggers a room turn.
   */
  public async postUserEmote(
    actionText: string,
    senderNick = "User"
  ): Promise<void> {
    const cleanNick = senderNick.replace(/^@/, "");
    this.recordHumanActivity(cleanNick);

    const emoteMsg: ChatMessage = {
      id: this.nextId(),
      timestamp: formatTime(),
      kind: "emote",
      senderId: `human:${cleanNick}`,
      senderNick: `@${cleanNick}`,
      color: "#ff79c6",
      text: actionText,
    };
    this.recordMessage(emoteMsg, true);

    if (
      this.isTurnRunning &&
      (this.config.humanInterruptMode === "yield" ||
        this.config.humanInterruptMode === "queue")
    ) {
      this.pendingHumanFollowUp = true;
      return;
    }

    await this.runRoomTurn({
      maxSpeakers: this.config.maxSpeakersPerTurn,
      forceAllSteps: false,
    });
  }

  /**
   * Classic mIRC /slap easter egg: slaps a target with a large trout and cues them to react.
   */
  public async slapTarget(
    targetQuery: string,
    senderNick = "User"
  ): Promise<void> {
    const cleanNick = senderNick.replace(/^@/, "");
    this.recordHumanActivity(cleanNick);

    const matchedBot = this.activePersonas.find(
      (p) =>
        p.id.toLowerCase() === targetQuery.toLowerCase() ||
        p.nick.toLowerCase() === targetQuery.toLowerCase() ||
        p.id.toLowerCase().includes(targetQuery.toLowerCase()) ||
        p.nick.toLowerCase().includes(targetQuery.toLowerCase())
    );

    const displayTarget = matchedBot
      ? `@${matchedBot.nick}`
      : targetQuery.startsWith("@")
        ? targetQuery
        : `@${targetQuery}`;

    if (matchedBot) {
      this.queueWhisper(
        matchedBot.id,
        `@${cleanNick} just slapped you around a bit with a large 1998 mIRC trout! React in character!`
      );
    }

    const slapMsg: ChatMessage = {
      id: this.nextId(),
      timestamp: formatTime(),
      kind: "emote",
      senderId: `human:${cleanNick}`,
      senderNick: `@${cleanNick}`,
      color: "#ffb86c",
      text: `slaps ${displayTarget} around a bit with a large 1998 mIRC trout 🐟`,
    };
    this.recordMessage(slapMsg, true);

    await this.runRoomTurn({
      maxSpeakers: Math.min(2, this.config.maxSpeakersPerTurn),
      forceAllSteps: false,
    });
  }

  /**
   * Runs N autonomous rounds of bot-to-bot banter.
   */
  public async runBanterRounds(rounds = 2): Promise<void> {
    this.ambientConsecutiveCount = 0;
    await this.runRoomTurn({
      maxSpeakers: Math.max(1, Math.min(6, rounds)),
      forceAllSteps: true,
    });
  }

  public bindPersona(
    personaId: string,
    binding: PersonaEngineBinding | null
  ): void {
    this.gemini.bindPersona(personaId, binding);
    this.db?.setPersonaBinding(personaId, binding);
    this.callbacks?.onPresenceChange?.();
    this.notify();
  }

  public persistGlobalEngine(): void {
    this.db?.setGlobalEngine({
      provider: this.gemini.activeProvider,
      model: this.gemini.activeModel,
    });
    this.callbacks?.onPresenceChange?.();
    this.notify();
  }

  private async sleepAbortable(
    baseMs: number,
    signal: AbortSignal
  ): Promise<void> {
    if (baseMs <= 0 || signal.aborted || this.pendingHumanFollowUp) return;
    // Apply ±20% natural jitter for organic feel
    const jitter = 0.8 + Math.random() * 0.4;
    const ms = Math.max(10, Math.round(baseMs * jitter));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Reactive turn loop:
   * - Step 0 picks the initial speaker (with optional readingDelayMs).
   * - After Speaker k finishes streaming, the Director reads what Speaker k ACTUALLY said
   *   and decides (using SimConfig probabilities, talkativeness, recency & @mentions) if another bot jumps in!
   */
  public async runRoomTurn(options?: {
    maxSpeakers?: number;
    forceAllSteps?: boolean;
    isAmbient?: boolean;
    randomFn?: () => number;
  }): Promise<boolean> {
    if (this.activePersonas.length === 0) {
      if (!options?.isAmbient) {
        this.addSystemMessage(
          "No models are in the room! Use /summon <model> (e.g. /summon sydney opus-5.5 eliza) to summon someone.",
          "system",
          false
        );
      }
      return false;
    }

    if (!this.gemini.isConfigured()) {
      await this.gemini.autoDetectLocalProviders();
    }

    const anyConfigured =
      this.gemini.isConfigured() ||
      this.activePersonas.some((p) => this.gemini.isConfigured(p));

    if (!anyConfigured && this.gemini.activeProvider !== "heylook") {
      if (!options?.isAmbient) {
        this.addSystemMessage(
          `⚠️ Provider "${this.gemini.activeProvider}" is not configured. Set GEMINI_API_KEY, OPENROUTER_API_KEY, or run "/provider heylook" to use your local heylookitsanllm server.`,
          "system",
          false
        );
      }
      return false;
    }

    this.abortCurrentTurn();
    const controller = new AbortController();
    this.abortController = controller;
    this.isTurnRunning = true;
    this.pendingHumanFollowUp = false;

    const forceAllSteps = options?.forceAllSteps ?? false;
    const isAmbient = options?.isAmbient ?? false;
    const requestedMax = options?.maxSpeakers ?? this.config.maxSpeakersPerTurn;
    // Unless forced via /banter, cap a reactive chain to the number of distinct bots in the room
    // so a 2-bot room doesn't ping-pong 4 times on a single human message.
    const maxSteps = forceAllSteps
      ? requestedMax
      : Math.max(1, Math.min(requestedMax, this.activePersonas.length));

    let lastSpeakerId: string | undefined;
    const spokenInTurnIds: string[] = [];

    try {
      for (let step = 0; step < maxSteps; step++) {
        if (controller.signal.aborted) return false;
        if (step > 0 && this.pendingHumanFollowUp) {
          break;
        }

        // Organic reading / inter-speaker pacing delay
        const delayMs =
          step === 0
            ? this.config.readingDelayMs
            : this.config.interSpeakerDelayMs;
        if (delayMs > 0) {
          this.setStatus(
            step === 0
              ? `💬 Room is reading ${this.channelName}...`
              : "💬 Another model is considering jumping in..."
          );
          await this.sleepAbortable(delayMs, controller.signal);
          if (controller.signal.aborted) return false;
          if (step > 0 && this.pendingHumanFollowUp) break;
        }

        this.setStatus(
          step === 0
            ? isAmbient
              ? `✨ Ambient beat in ${this.channelName} (${this.ambientConsecutiveCount}/${this.config.ambientMaxConsecutive})...`
              : `⚡ Room Director (${this.gemini.activeProvider}) is selecting speaker...`
            : "⚡ Room Director is checking if another model reacts..."
        );

        const decision = await this.director.pickNextSpeaker({
          activePersonas: this.activePersonas,
          humans: this.humans,
          recentMessages: this.messages,
          vibe: this.vibe,
          stepIndex: step,
          lastSpeakerId,
          spokenInTurnIds,
          forceContinue: forceAllSteps,
          isAmbient,
          config: this.config,
          randomFn: options?.randomFn,
          gemini: this.gemini,
          signal: controller.signal,
        });

        if (!decision.shouldContinue || !decision.personaId) {
          break;
        }

        const speaker = this.activePersonas.find(
          (p) => p.id === decision.personaId
        );
        if (!speaker) break;

        lastSpeakerId = speaker.id;
        spokenInTurnIds.push(speaker.id);
        const resolved = this.gemini.resolveTarget({ persona: speaker });
        const engineVia = resolved.isCustomBound
          ? ` • via ${resolved.provider.id}:${resolved.model}`
          : "";

        this.setStatus(
          `${speaker.avatar} <${speaker.nick}> is typing (${resolved.provider.id}:${resolved.model})...`
        );

        const msg: ChatMessage = {
          id: this.nextId(),
          timestamp: formatTime(),
          kind: "model",
          senderId: speaker.id,
          senderNick: speaker.nick,
          avatar: speaker.avatar,
          color: speaker.color,
          familyTag: `${speaker.family} • ${speaker.era}${engineVia}`,
          text: "",
          streaming: true,
        };
        this.recordMessage(msg, false);

        const { systemInstruction, prompt } = this.buildPersonaPrompt(
          speaker,
          decision.reason ?? "Respond in character."
        );

        let rawAccumulated = "";
        await this.gemini.streamText({
          persona: speaker,
          prompt,
          systemInstruction,
          signal: controller.signal,
          onStatus: (status) => {
            this.setStatus(`${speaker.avatar} <${speaker.nick}>: ${status}`);
          },
          onDelta: (chunk) => {
            rawAccumulated += chunk;
            const parsed = extractThinkingAndBody(rawAccumulated);
            msg.thinking = parsed.thinking;
            msg.text = parsed.body;
            this.callbacks?.onMessageUpsert?.(msg);
            this.notify();
          },
        });

        msg.streaming = false;
        const finalParsed = extractThinkingAndBody(rawAccumulated);
        msg.thinking = finalParsed.thinking;
        msg.text =
          finalParsed.body.trim() ||
          (rawAccumulated.trim() ? rawAccumulated.trim() : "...");
        this.recordMessage(msg, true);

        if (this.pendingHumanFollowUp) {
          break;
        }
      }
      return true;
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        this.addSystemMessage(
          `⚠️ Simulation error: ${message}`,
          "system",
          false
        );
      }
      return false;
    } finally {
      const shouldPivotToHuman =
        this.pendingHumanFollowUp && !controller.signal.aborted;
      if (this.abortController === controller) {
        this.abortController = null;
        this.isTurnRunning = false;
        this.pendingHumanFollowUp = false;
        this.setStatus("");
      }
      if (shouldPivotToHuman) {
        await this.runRoomTurn({
          maxSpeakers: this.config.maxSpeakersPerTurn,
          forceAllSteps: false,
        });
      }
    }
  }
}
