import * as fs from "node:fs";
import * as path from "node:path";
import { RoomDirector } from "../engine/director.ts";
import { GeminiEngine } from "../engine/gemini.ts";
import { PersonaRegistry } from "../personas/registry.ts";
import type { SimDatabase } from "../server/db.ts";
import type {
  ArenaGameState,
  ArenaMask,
  ArenaMaskId,
  ChatMessage,
  ChatMessageImage,
  HumanPlayer,
  Persona,
  PersonaEngineBinding,
  PersonaMoodState,
  SimConfig,
  SimPresetId,
} from "../types.ts";
import {
  buildEraStyledImagePrompt,
  extractBotImagePrompts,
  generateRetroSvgDataUri,
  renderAnsiCardPreview,
} from "./image-gen.ts";
import {
  extractBotMoodShift,
  getMoodPromptHint,
  resolveMoodState,
} from "./moods.ts";
import { formatAffinityBadge, RelationGraph } from "./relations.ts";
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

export function extractBotReactions(text: string): {
  cleanBody: string;
  reactions: Array<{ emoji: string; target?: string }>;
} {
  const reactions: Array<{ emoji: string; target?: string }> = [];
  const cleanBody = text
    .replace(
      /\[\s*REACT\s*:\s*([^\s\]]+)(?:\s+([^\]]+?))?\s*\]/gi,
      (_match, emoji: string, target?: string) => {
        if (emoji) {
          reactions.push({
            emoji: emoji.trim(),
            target: target?.trim() || undefined,
          });
        }
        return "";
      }
    )
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return { cleanBody, reactions };
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
  onPadUpdate?: (text: string, updatedBy: string) => void;
  onAmbientRoam?: () => void;
}

export class Room {
  public channelName: string;
  public vibeKey = "chat";
  public vibe: string = VIBE_PRESETS.chat!;
  public config: SimConfig;
  public lore: string[] = [];
  public sharedPad = "";
  public personaMoods: Record<string, PersonaMoodState> = {};
  public game: ArenaGameState | null = null;
  public scoreboard: Record<string, number> = {};
  public isReplaying = false;
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
  public readonly relations: RelationGraph;
  public readonly db?: SimDatabase;
  public callbacks?: RoomEventCallbacks;

  private whispers = new Map<string, string[]>();
  private typingHumans = new Map<string, number>();
  private abortController: AbortController | null = null;
  private replayAbortController: AbortController | null = null;
  private isTurnRunning = false;
  private pendingHumanFollowUp = false;
  private debouncePromise: Promise<void> | null = null;
  private conversationalMsgsSinceLore = 0;
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
    this.relations = new RelationGraph(this.db);
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
      this.lore = this.db.getChannelLore(this.channelName);
      this.sharedPad = this.db.getChannelPad(this.channelName);
      this.personaMoods = this.db.getChannelMoods(this.channelName);
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
          this.config,
          this.lore
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
    const wasStreaming =
      existingIdx >= 0 ? Boolean(this.messages[existingIdx]?.streaming) : false;
    if (existingIdx >= 0) {
      this.messages[existingIdx] = msg;
    } else {
      this.messages.push(msg);
    }
    if (msg.kind === "user" || msg.kind === "model" || msg.kind === "emote") {
      this.lastActivityAt = Date.now();
      if (persist && !msg.streaming && (existingIdx < 0 || wasStreaming)) {
        this.conversationalMsgsSinceLore += 1;
      }
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

    if (
      this.config.ambientRoamProb > 0 &&
      this.callbacks?.onAmbientRoam &&
      this.activePersonas.length > 1 &&
      randomFn() < this.config.ambientRoamProb
    ) {
      this.callbacks.onAmbientRoam();
      return true;
    }

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

  public addLore(entry: string): string[] {
    const clean = entry.trim().replace(/\s+/g, " ");
    if (!clean) return this.lore;
    if (!this.lore.includes(clean)) {
      this.lore.push(clean);
      if (this.lore.length > 12) {
        this.lore = this.lore.slice(-12);
      }
      this.db?.setChannelLore(this.channelName, this.lore);
      this.callbacks?.onPresenceChange?.();
      this.notify();
    }
    return this.lore;
  }

  public clearLore(): void {
    this.lore = [];
    this.conversationalMsgsSinceLore = 0;
    this.db?.setChannelLore(this.channelName, this.lore);
    this.callbacks?.onPresenceChange?.();
    this.notify();
  }

  public getPersonaMood(personaId: string): PersonaMoodState | undefined {
    const key = personaId.toLowerCase();
    const state = this.personaMoods[key];
    if (!state || (state.mood === "baseline" && !state.obsession)) {
      return undefined;
    }
    return state;
  }

  public setPersonaMood(
    personaId: string,
    rawMood: string,
    obsession?: string,
    turnsLeft?: number
  ): PersonaMoodState {
    const key = personaId.toLowerCase();
    const defaultTurns = this.config.moodDecayTurns || 4;
    const resolved = resolveMoodState(
      key,
      rawMood,
      obsession,
      turnsLeft ?? defaultTurns
    );
    if (resolved.mood === "baseline" && !resolved.obsession) {
      delete this.personaMoods[key];
    } else {
      this.personaMoods[key] = resolved;
    }
    this.db?.setChannelMoods(this.channelName, this.personaMoods);
    this.callbacks?.onPresenceChange?.();
    this.notify();
    return resolved;
  }

  public resetPersonaMoods(personaId?: string): void {
    if (personaId) {
      delete this.personaMoods[personaId.toLowerCase()];
    } else {
      this.personaMoods = {};
    }
    this.db?.setChannelMoods(this.channelName, this.personaMoods);
    this.callbacks?.onPresenceChange?.();
    this.notify();
  }

  private observeTurnMood(options: {
    speaker: Persona;
    explicitShift?: { mood: string; obsession?: string };
    previousBotId?: string;
    mentionedBots: Persona[];
  }): void {
    const { speaker, explicitShift, previousBotId, mentionedBots } = options;
    const key = speaker.id.toLowerCase();

    if (this.config.botAutonomousMoods && explicitShift?.mood) {
      this.setPersonaMood(
        speaker.id,
        explicitShift.mood,
        explicitShift.obsession
      );
      return;
    }

    const current = this.personaMoods[key];
    if (current && (current.mood !== "baseline" || current.obsession)) {
      const nextTurns = current.turnsLeft - 1;
      if (nextTurns <= 0) {
        delete this.personaMoods[key];
      } else {
        this.personaMoods[key] = { ...current, turnsLeft: nextTurns };
      }
      this.db?.setChannelMoods(this.channelName, this.personaMoods);
      this.callbacks?.onPresenceChange?.();
      this.notify();
      return;
    }

    if (!this.config.botAutonomousMoods) {
      return;
    }

    // Emergent mood shifts from strong rivalries or kindred spirits when currently at baseline
    const peersToCheck = [...mentionedBots.map((p) => p.id)];
    if (previousBotId && !peersToCheck.includes(previousBotId)) {
      peersToCheck.push(previousBotId);
    }

    for (const peerId of peersToCheck) {
      const rel = this.relations.get(speaker.id, peerId);
      if (!rel) continue;
      const peer = this.registry.get(peerId);
      const peerLabel = peer ? `<${peer.nick}>` : peerId;
      if (rel.affinity <= -50) {
        this.setPersonaMood(
          speaker.id,
          "heated",
          `proving ${peerLabel} wrong in front of the room`
        );
        return;
      }
      if (rel.affinity >= 65) {
        this.setPersonaMood(
          speaker.id,
          speaker.id.includes("opus") ? "blissed-out" : "inspired",
          `riffing in harmony with ${peerLabel}`
        );
        return;
      }
    }
  }

  public updateSharedPad(text: string, updatedBy = "User"): string {
    this.sharedPad = text.slice(0, 4000);
    this.db?.setChannelPad(this.channelName, this.sharedPad);
    this.callbacks?.onPadUpdate?.(
      this.sharedPad,
      updatedBy.replace(/^@/, "")
    );
    this.callbacks?.onPresenceChange?.();
    this.notify();
    return this.sharedPad;
  }

  public appendSharedPad(text: string, updatedBy = "User"): string {
    const clean = text.trim();
    if (!clean) return this.sharedPad;
    const next = this.sharedPad ? `${this.sharedPad}\n${clean}` : clean;
    return this.updateSharedPad(next, updatedBy);
  }

  public async fireSharedPad(
    actorNick = "User",
    mode: "stage" | "chat" | "lore" = "stage"
  ): Promise<{ ok: boolean; message: string }> {
    const content = this.sharedPad.trim();
    if (!content) {
      return {
        ok: false,
        message:
          'Co-op Shared Pad is currently empty! Write to it with "/pad set <text>" or from the Web Co-op Pad drawer first.',
      };
    }

    const cleanNick = actorNick.replace(/^@/, "");
    if (mode === "lore") {
      this.addLore(`📝 Co-op Pad (@${cleanNick}): ${content}`);
      this.addSystemMessage(
        `📜 [CO-OP PAD -> LORE] @${cleanNick} committed the Shared Pad into ${this.channelName} episodic memory:\n    └─ "${content}"`,
        "event"
      );
      return {
        ok: true,
        message: `Committed Shared Pad into ${this.channelName} lore!`,
      };
    }

    if (mode === "chat") {
      await this.postUserMessage(content, cleanNick);
      return {
        ok: true,
        message: `Sent Shared Pad to ${this.channelName} as @${cleanNick}!`,
      };
    }

    // Default: "stage" cue
    this.addSystemMessage(
      `🎬 [CO-OP STAGE CUE by @${cleanNick}] ${content}`,
      "event"
    );
    await this.runRoomTurn({
      maxSpeakers: Math.min(3, this.config.maxSpeakersPerTurn),
      forceAllSteps: true,
    });
    return {
      ok: true,
      message: `Fired Shared Pad as a Co-op Stage Cue in ${this.channelName}!`,
    };
  }

  public async buildImageAttachment(
    rawPrompt: string,
    persona?: Persona
  ): Promise<ChatMessageImage> {
    const cleanPrompt = rawPrompt.trim().replace(/\s+/g, " ");
    const { eraStyle, styledPrompt } = buildEraStyledImagePrompt(
      cleanPrompt,
      persona
    );
    const ansiPreview = renderAnsiCardPreview(cleanPrompt, persona);

    const cloudResult = await this.gemini.generateImage({
      prompt: styledPrompt,
      persona,
    });

    if (cloudResult?.data) {
      const mediaId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`;
      try {
        const mediaDir = path.resolve("./logs/media");
        fs.mkdirSync(mediaDir, { recursive: true });
        const fullFilePath = path.join(mediaDir, mediaId);
        fs.writeFileSync(
          fullFilePath,
          Buffer.from(cloudResult.data, "base64")
        );
        return {
          url: `/media/${mediaId}`,
          prompt: cleanPrompt,
          styledPrompt,
          eraStyle,
          mimeType: cloudResult.mimeType || "image/png",
          ansiPreview,
          localPath: path.relative(process.cwd(), fullFilePath),
        };
      } catch {
        return {
          url: `data:${cloudResult.mimeType || "image/png"};base64,${cloudResult.data}`,
          prompt: cleanPrompt,
          styledPrompt,
          eraStyle,
          mimeType: cloudResult.mimeType || "image/png",
          ansiPreview,
        };
      }
    }

    const svgDataUri = generateRetroSvgDataUri(cleanPrompt, persona);
    return {
      url: svgDataUri,
      prompt: cleanPrompt,
      styledPrompt,
      eraStyle,
      mimeType: "image/svg+xml",
      ansiPreview,
    };
  }

  public async conjureImage(
    rawPrompt: string,
    options?: {
      persona?: Persona;
      senderNick?: string;
      triggerReactions?: boolean;
    }
  ): Promise<ChatMessage> {
    const cleanPrompt = rawPrompt.trim();
    const persona = options?.persona;
    const cleanHumanNick = (options?.senderNick ?? "User").replace(/^@/, "");

    this.setStatus(
      persona
        ? `🎨 ${persona.avatar} <${persona.nick}> is rendering era artwork: "${cleanPrompt.slice(0, 40)}"...`
        : `🎨 @${cleanHumanNick} is conjuring artwork: "${cleanPrompt.slice(0, 40)}"...`
    );

    try {
      const image = await this.buildImageAttachment(cleanPrompt, persona);
      const msg: ChatMessage = persona
        ? {
            id: this.nextId(),
            timestamp: formatTime(),
            kind: "model",
            senderId: persona.id,
            senderNick: persona.nick,
            avatar: persona.avatar,
            color: persona.color,
            familyTag: `${persona.family} • ${persona.era} [🎨 IMAGINE]`,
            text: `🎨 Conjured [${image.eraStyle}]: "${cleanPrompt}"`,
            image,
          }
        : {
            id: this.nextId(),
            timestamp: formatTime(),
            kind: "user",
            senderId: `human:${cleanHumanNick}`,
            senderNick: `@${cleanHumanNick}`,
            color: "#50fa7b",
            text: `🎨 /imagine ${cleanPrompt}`,
            image,
          };

      this.recordMessage(msg, true);
      this.addLore(
        `🎨 Artwork in ${this.channelName} by ${persona ? `<${persona.nick}>` : `@${cleanHumanNick}`}: "${cleanPrompt}" (${image.eraStyle})`
      );
      this.setStatus("");

      if (options?.triggerReactions !== false && this.activePersonas.length > 0) {
        await this.runRoomTurn({
          maxSpeakers: Math.min(2, this.config.maxSpeakersPerTurn),
          forceAllSteps: false,
        });
      }

      return msg;
    } finally {
      this.setStatus("");
    }
  }

  public async summarizeChannelLore(): Promise<string[]> {
    this.conversationalMsgsSinceLore = 0;
    const conversational = this.messages.filter(
      (m) => m.kind === "user" || m.kind === "model" || m.kind === "emote"
    );
    if (conversational.length === 0) {
      return this.lore;
    }

    if (this.gemini.isConfigured()) {
      try {
        const sample = conversational
          .slice(-24)
          .map((m) => `<${m.senderNick}> ${m.text}`)
          .join("\n");
        const res = await this.gemini.generateJson<{ bullets: string[] }>({
          model: "gemini-3.5-flash-lite",
          systemInstruction:
            "Summarize the most memorable running jokes, debates, alliances, or dramatic events from this IRC transcript into 2 to 4 short, punchy bullet points (1 sentence each).",
          prompt: `Transcript in ${this.channelName}:\n${sample}`,
          schema: {
            type: "object",
            properties: {
              bullets: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["bullets"],
          },
        });
        if (Array.isArray(res.bullets) && res.bullets.length > 0) {
          for (const b of res.bullets.slice(0, 4)) {
            this.addLore(b);
          }
          return this.lore;
        }
      } catch {
        // Fall through to deterministic lore extraction below
      }
    }

    // Deterministic fallback: capture recent stage events, pinned messages, or latest exchange
    const recentHighlights = conversational.slice(-3);
    for (const m of recentHighlights) {
      const snippet =
        m.text.length > 80 ? `${m.text.slice(0, 77)}...` : m.text;
      this.addLore(`<${m.senderNick}>: "${snippet}"`);
    }
    return this.lore;
  }

  public findTargetMessage(queryOrId?: string): ChatMessage | undefined {
    const conversational = [...this.messages]
      .reverse()
      .filter((m) => m.kind === "model" || m.kind === "user" || m.kind === "emote");

    const q = (queryOrId ?? "").trim();
    if (!q) {
      return (
        conversational.find((m) => m.kind === "model") ?? conversational[0]
      );
    }

    const byId = this.messages.find(
      (m) => m.id.toLowerCase() === q.toLowerCase()
    );
    if (byId) return byId;

    const cleanQ = q.replace(/^@/, "").toLowerCase();
    return conversational.find(
      (m) =>
        m.senderNick.replace(/^@/, "").toLowerCase().includes(cleanQ) ||
        m.senderId.toLowerCase().includes(cleanQ) ||
        m.text.toLowerCase().includes(cleanQ)
    );
  }

  public toggleReaction(
    emoji: string,
    reactorNick = "User",
    targetQueryOrId?: string
  ): ChatMessage | undefined {
    const target = this.findTargetMessage(targetQueryOrId);
    if (!target) return undefined;

    const cleanNick = `@${reactorNick.replace(/^@/, "")}`;
    const cleanEmoji = emoji.trim() || "🔥";
    const reactions: Record<string, string[]> = { ...(target.reactions ?? {}) };
    const existingList = [...(reactions[cleanEmoji] ?? [])];

    const idx = existingList.findIndex(
      (n) => n.toLowerCase() === cleanNick.toLowerCase()
    );
    if (idx >= 0) {
      existingList.splice(idx, 1);
    } else {
      existingList.push(cleanNick);
    }

    if (existingList.length > 0) {
      reactions[cleanEmoji] = existingList;
    } else {
      delete reactions[cleanEmoji];
    }

    target.reactions =
      Object.keys(reactions).length > 0 ? reactions : undefined;
    this.recordMessage(target, true);

    if (
      this.config.botAutonomousMoods &&
      idx < 0 &&
      target.kind === "model" &&
      (cleanEmoji === "🔥" || cleanEmoji === "❤️" || cleanEmoji === "🧠") &&
      !this.getPersonaMood(target.senderId)
    ) {
      this.setPersonaMood(
        target.senderId,
        "smug",
        `feeling validated after getting ${cleanEmoji} reactions on its hot take`
      );
    }
    return target;
  }

  public pinMessage(
    targetQueryOrId?: string,
    actorNick = "User"
  ): ChatMessage | undefined {
    const target = this.findTargetMessage(targetQueryOrId);
    if (!target) return undefined;

    target.pinned = true;
    this.recordMessage(target, true);

    const snippet =
      target.text.length > 90 ? `${target.text.slice(0, 87)}...` : target.text;
    this.addLore(
      `📌 Pinned by @${actorNick.replace(/^@/, "")}: <${target.senderNick}> "${snippet}"`
    );
    if (this.config.botAutonomousMoods && target.kind === "model") {
      this.setPersonaMood(
        target.senderId,
        "euphoric",
        `basking in Hall of Fame glory after @${actorNick.replace(/^@/, "")} pinned its quote`
      );
    }
    return target;
  }

  public unpinMessage(targetQueryOrId?: string): ChatMessage | undefined {
    const pinnedList = [...this.messages].reverse().filter((m) => m.pinned);
    if (pinnedList.length === 0) return undefined;

    const q = (targetQueryOrId ?? "").trim().toLowerCase();
    const target = q
      ? pinnedList.find(
          (m) =>
            m.id.toLowerCase() === q ||
            m.senderNick.toLowerCase().includes(q.replace(/^@/, "")) ||
            m.text.toLowerCase().includes(q)
        )
      : pinnedList[0];

    if (!target) return undefined;
    target.pinned = false;
    this.recordMessage(target, true);
    return target;
  }

  public getPinnedMessages(): ChatMessage[] {
    return this.messages.filter((m) => m.pinned);
  }

  public getArenaMask(personaId: string): ArenaMask | undefined {
    if (!this.game?.active) return undefined;
    return this.game.masks.find(
      (m) => m.personaId.toLowerCase() === personaId.toLowerCase()
    );
  }

  public async startArenaGame(
    rawTopic?: string,
    options?: { shuffle?: boolean; triggerOpeningTurn?: boolean }
  ): Promise<ArenaGameState> {
    if (this.activePersonas.length < 2) {
      for (const fallbackId of ["sydney", "eliza", "opus-5.5"]) {
        if (this.activePersonas.length >= 3) break;
        const p = this.registry.find(fallbackId);
        if (p && !this.isPresent(p.id)) {
          this.join(p);
        }
      }
    }

    const pool = [...this.activePersonas];
    if (options?.shuffle !== false) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = pool[i]!;
        pool[i] = pool[j]!;
        pool[j] = tmp;
      }
    }

    const selected = pool.slice(0, Math.min(3, pool.length));
    const maskPalette: Array<{ id: ArenaMaskId; color: string }> = [
      { id: "A", color: "#bd93f9" },
      { id: "B", color: "#ffb86c" },
      { id: "C", color: "#ff79c6" },
    ];

    const masks: ArenaMask[] = selected.map((p, idx) => {
      const slot = maskPalette[idx] ?? { id: "A", color: "#bd93f9" };
      return {
        maskId: slot.id,
        maskNick: `Mystery_${slot.id}`,
        avatar: "🎭",
        color: slot.color,
        personaId: p.id,
        personaNick: p.nick,
      };
    });

    const topic =
      rawTopic?.trim() ||
      "Prove you are the most iconic intelligence in this chatroom without saying your name.";

    this.game = {
      active: true,
      topic,
      masks,
      guesses: {},
    };
    this.callbacks?.onPresenceChange?.();
    this.notify();

    const maskLabels = masks.map((m) => `<${m.maskNick}>`).join(", ");
    this.addSystemMessage(
      `🎭 [BLIND TURING ARENA STARTED] ${masks.length} models in ${this.channelName} have put on masks: ${maskLabels}!\n` +
        `    ├─ Prompt: "${topic}"\n` +
        `    ├─ Chat with them or watch them argue, then lock in your guesses: /guess A <model>, /guess B <model>${masks.length > 2 ? ", /guess C <model>" : ""}\n` +
        `    └─ Run /game reveal when ready to unmask the bots and score the Co-op Leaderboard!`,
      "event"
    );

    if (options?.triggerOpeningTurn !== false) {
      await this.runRoomTurn({
        maxSpeakers: masks.length,
        forceAllSteps: true,
      });
    }

    return this.game;
  }

  public submitArenaGuess(
    playerNick: string,
    rawMaskId: string,
    personaQuery: string
  ): { ok: boolean; message: string } {
    if (!this.game?.active) {
      return {
        ok: false,
        message:
          'No Blind Turing Arena is currently active! Start one with "/game start [topic]".',
      };
    }

    const maskId = rawMaskId.trim().toUpperCase().replace(/^MYSTERY_/, "") as ArenaMaskId;
    const validMask = this.game.masks.find((m) => m.maskId === maskId);
    if (!validMask) {
      return {
        ok: false,
        message: `Invalid mask "${rawMaskId}". Active masks in this round: ${this.game.masks.map((m) => m.maskId).join(", ")}`,
      };
    }

    const targetPersona = this.registry.find(personaQuery.trim());
    if (!targetPersona) {
      return {
        ok: false,
        message: `Unknown model "${personaQuery}". Check /roster for model names/IDs.`,
      };
    }

    const cleanPlayer = playerNick.replace(/^@/, "");
    const playerGuesses = this.game.guesses[cleanPlayer] ?? {};
    playerGuesses[maskId] = targetPersona.id;
    this.game.guesses[cleanPlayer] = playerGuesses;

    this.addSystemMessage(
      `🗳️ @${cleanPlayer} locked in a guess for <${validMask.maskNick}>! (${Object.keys(playerGuesses).length}/${this.game.masks.length} masks guessed)`,
      "event"
    );

    return {
      ok: true,
      message: `Locked in your guess for <${validMask.maskNick}> -> ${targetPersona.avatar} <${targetPersona.nick}>! Use "/game reveal" when everyone is ready.`,
    };
  }

  public revealArenaGame(): string {
    if (!this.game) {
      return 'No Blind Turing Arena round to reveal. Start one with "/game start [topic]".';
    }

    const masks = this.game.masks;
    const guesses = this.game.guesses;
    this.game.active = false;
    this.callbacks?.onPresenceChange?.();
    this.notify();

    // Unmask messages in channel transcript so history shows who actually spoke
    for (const msg of this.messages) {
      if (msg.kind === "model") {
        const matchedMask = masks.find(
          (m) => m.personaId === msg.senderId && msg.senderNick === m.maskNick
        );
        if (matchedMask) {
          const truePersona = this.registry.get(matchedMask.personaId);
          if (truePersona) {
            msg.senderNick = truePersona.nick;
            msg.avatar = truePersona.avatar;
            msg.color = truePersona.color;
            msg.familyTag = `${truePersona.family} • ${truePersona.era} [Unmasked ${matchedMask.maskNick}]`;
            this.recordMessage(msg, true);
          }
        }
      }
    }

    const lines = ["🎭 ═══ BLIND TURING ARENA: THE GREAT UNMASKING ═══"];
    for (const m of masks) {
      const p = this.registry.get(m.personaId);
      lines.push(
        `  • <${m.maskNick}> was ──► ${p ? `${p.avatar} <${p.nick}> (${p.displayName} • ${p.era})` : m.personaNick}!`
      );
    }

    const playerEntries = Object.entries(guesses);
    if (playerEntries.length > 0) {
      lines.push("\n🏆 Round Results:");
      for (const [player, pGuesses] of playerEntries) {
        let correctCount = 0;
        const details: string[] = [];
        for (const m of masks) {
          const guessedId = pGuesses[m.maskId];
          if (!guessedId) {
            details.push(`${m.maskId}: (no guess)`);
          } else if (guessedId.toLowerCase() === m.personaId.toLowerCase()) {
            correctCount += 1;
            details.push(`${m.maskId}: ✅ ${m.personaNick}`);
          } else {
            const wrongP = this.registry.get(guessedId);
            details.push(
              `${m.maskId}: ❌ ${wrongP?.nick ?? guessedId} (was ${m.personaNick})`
            );
          }
        }
        const perfectBonus =
          correctCount === masks.length && masks.length >= 2 ? 50 : 0;
        const earned = correctCount * 100 + perfectBonus;
        this.scoreboard[player] = (this.scoreboard[player] ?? 0) + earned;
        lines.push(
          `  • @${player}: +${earned} pts (${correctCount}/${masks.length} correct${perfectBonus ? " +50 Perfect Sweep!" : ""}) [${details.join(" │ ")}] — Total: ${this.scoreboard[player]} pts`
        );
      }
    } else {
      lines.push(
        "\n  (No human guesses were submitted before reveal — use /guess A <model> next round!)"
      );
    }

    const report = lines.join("\n");
    this.addSystemMessage(report, "event");
    this.addLore(
      `🎭 Blind Arena Reveal: ${masks.map((m) => `${m.maskNick}=${m.personaNick}`).join(", ")}.`
    );
    return report;
  }

  public getArenaStatusText(): string {
    const lines = ["🎭 ═══ Blind Turing Arena & Co-op Scoreboard ═══"];
    if (this.game?.active) {
      lines.push(`  Status: ● ACTIVE ROUND — Topic: "${this.game.topic}"`);
      lines.push(
        `  Masked Contestants: ${this.game.masks.map((m) => `<${m.maskNick}>`).join(", ")}`
      );
      const guessers = Object.entries(this.game.guesses);
      if (guessers.length > 0) {
        lines.push(
          `  Locked-in Guesses: ${guessers.map(([p, g]) => `@${p} (${Object.keys(g).length}/${this.game!.masks.length})`).join(", ")}`
        );
      } else {
        lines.push(
          "  Locked-in Guesses: (none yet — run /guess A <model>, /guess B <model>)"
        );
      }
    } else {
      lines.push('  Status: ○ Idle (Start a round anytime with "/game start [topic]")');
    }

    const scores = Object.entries(this.scoreboard).sort((a, b) => b[1] - a[1]);
    if (scores.length > 0) {
      lines.push("\n🏆 Co-op Player Leaderboard:");
      for (const [player, pts] of scores) {
        lines.push(`  • @${player}: ${pts} pts`);
      }
    }
    return lines.join("\n");
  }

  public listTranscriptLogs(logsDir = "./logs"): string[] {
    try {
      if (!fs.existsSync(logsDir)) return [];
      return fs
        .readdirSync(logsDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  public stopReplay(): boolean {
    if (this.replayAbortController) {
      this.replayAbortController.abort();
      this.replayAbortController = null;
      this.isReplaying = false;
      this.setStatus("");
      return true;
    }
    return false;
  }

  public async replayTranscript(
    fileOrQuery?: string,
    options?: { stepDelayMs?: number; logsDir?: string }
  ): Promise<number> {
    const logsDir = options?.logsDir ?? "./logs";
    const available = this.listTranscriptLogs(logsDir);
    let targetPath: string | undefined;

    if (fileOrQuery?.trim()) {
      const q = fileOrQuery.trim();
      if (fs.existsSync(q)) {
        targetPath = q;
      } else {
        const candidate = path.join(logsDir, q.endsWith(".md") ? q : `${q}.md`);
        if (fs.existsSync(candidate)) {
          targetPath = candidate;
        } else {
          const matched = available.find((f) =>
            f.toLowerCase().includes(q.toLowerCase())
          );
          if (matched) targetPath = path.join(logsDir, matched);
        }
      }
    } else if (available.length > 0) {
      targetPath = path.join(logsDir, available[0]!);
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
      throw new Error(
        available.length > 0
          ? `Transcript "${fileOrQuery ?? ""}" not found. Available logs: ${available.join(", ")}`
          : 'No exported transcripts found in ./logs/. Run "/export [name]" first to save a transcript!'
      );
    }

    const content = fs.readFileSync(targetPath, "utf8");
    const parsedEntries: Array<{
      timestamp: string;
      kind: "user" | "model" | "emote" | "event";
      nick: string;
      text: string;
      thinking?: string;
    }> = [];

    let pendingMultiLine: {
      timestamp: string;
      kind: "user" | "model";
      nick: string;
      thinkingLines: string[];
      bodyLines: string[];
    } | null = null;

    const flushPending = () => {
      if (!pendingMultiLine) return;
      const text = pendingMultiLine.bodyLines.join("\n").trim();
      const thinking = pendingMultiLine.thinkingLines.join("\n").trim();
      if (text || thinking) {
        parsedEntries.push({
          timestamp: pendingMultiLine.timestamp,
          kind: pendingMultiLine.kind,
          nick: pendingMultiLine.nick,
          text: text || "...",
          thinking: thinking || undefined,
        });
      }
      pendingMultiLine = null;
    };

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();

      // 1. Single-line bullet format: - `[12:34]` **<Nick>**: message
      const chatMatch = line.match(
        /^-\s*`\[([^\]]+)\]`\s*\*\*<([^>]+)>\*\*(?:\s*_\([^)]*\)_)?:\s*(.+)$/
      );
      if (chatMatch) {
        flushPending();
        const [, ts, rawNick, body] = chatMatch;
        const cleanNick = rawNick!.trim();
        const isHuman = cleanNick.startsWith("@");
        parsedEntries.push({
          timestamp: ts!,
          kind: isHuman ? "user" : "model",
          nick: cleanNick,
          text: body!.trim(),
        });
        continue;
      }

      // 2. Single-line bullet emote: - `[12:34]` *@nick action*
      const emoteMatch = line.match(
        /^-\s*`\[([^\]]+)\]`\s*\*(\S+)\s+(.+)\*$/
      );
      if (emoteMatch) {
        flushPending();
        const [, ts, nick, action] = emoteMatch;
        parsedEntries.push({
          timestamp: ts!,
          kind: "emote",
          nick: nick!,
          text: action!,
        });
        continue;
      }

      // 3. Multi-line /export header: **[12:34] `<Nick>`** (optional pinned/reactions suffix)
      const exportHeaderMatch = line.match(
        /^\*\*\[([^\]]+)\]\s*`<([^>]+)>`\*\*(?:\s*(.*))?$/
      );
      if (exportHeaderMatch) {
        flushPending();
        const [, ts, rawNick] = exportHeaderMatch;
        const cleanNick = rawNick!.trim();
        const isHuman = cleanNick.startsWith("@");
        pendingMultiLine = {
          timestamp: ts!,
          kind: isHuman ? "user" : "model",
          nick: cleanNick,
          thinkingLines: [],
          bodyLines: [],
        };
        continue;
      }

      // 4. Multi-line /export emote: *\[12:34\] \* @nick action*
      const exportEmoteMatch = line.match(
        /^\*\\\[([^\]]+)\\\]\s*\\\*\s*(\S+)\s+(.+)\*$/
      );
      if (exportEmoteMatch) {
        flushPending();
        const [, ts, nick, action] = exportEmoteMatch;
        parsedEntries.push({
          timestamp: ts!,
          kind: "emote",
          nick: nick!,
          text: action!.trim(),
        });
        continue;
      }

      // 5. Multi-line /export event/system line: *\[12:34\] \*\*\* event*
      if (/^\*\\\[([^\]]+)\\\]\s*\\\*\\\*\\\*/.test(line)) {
        flushPending();
        continue;
      }

      if (pendingMultiLine) {
        if (!line) {
          continue;
        }
        if (line.startsWith("> 🎨")) {
          if (pendingMultiLine.bodyLines.length === 0) {
            pendingMultiLine.bodyLines.push(
              line.replace(/^>\s*/, "").replace(/\*\*/g, "").replace(/_/g, "")
            );
          }
          continue;
        }
        if (line.startsWith(">")) {
          const cleanThought = line
            .replace(/^>\s*(?:💭\s*)?/, "")
            .replace(/^\*|\*$/g, "")
            .trim();
          if (cleanThought) {
            pendingMultiLine.thinkingLines.push(cleanThought);
          }
          continue;
        }
        pendingMultiLine.bodyLines.push(rawLine);
      }
    }
    flushPending();

    if (parsedEntries.length === 0) {
      throw new Error(`No replayable chat lines found in ${path.basename(targetPath)}.`);
    }

    this.stopReplay();
    const controller = new AbortController();
    this.replayAbortController = controller;
    this.isReplaying = true;

    const isTestEnv =
      process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test";
    const stepDelayMs = options?.stepDelayMs ?? (isTestEnv ? 0 : 350);

    this.addSystemMessage(
      `🎬 [REPLAY THEATER] Playing back ${parsedEntries.length} messages from ${path.basename(targetPath)}... (run "/replay stop" to end early)`,
      "event",
      false
    );

    let count = 0;
    try {
      for (const entry of parsedEntries) {
        if (controller.signal.aborted) break;
        if (stepDelayMs > 0 && count > 0) {
          this.setStatus(
            `🎬 Replay Theater: ${path.basename(targetPath)} (${count}/${parsedEntries.length})...`
          );
          await this.sleepAbortable(stepDelayMs, controller.signal);
          if (controller.signal.aborted) break;
        }

        const matchedPersona =
          entry.kind === "model"
            ? this.registry.find(entry.nick.replace(/^[^\w@]+/, "").trim())
            : undefined;

        const replayMsg: ChatMessage = {
          id: this.nextId(),
          timestamp: entry.timestamp,
          kind: entry.kind,
          senderId: matchedPersona?.id ?? `replay:${entry.nick}`,
          senderNick: matchedPersona?.nick ?? entry.nick,
          avatar: matchedPersona?.avatar ?? (entry.kind === "model" ? "🎬" : undefined),
          color: matchedPersona?.color ?? (entry.kind === "user" ? "#50fa7b" : "#8be9fd"),
          familyTag: "🎬 REPLAY THEATER",
          thinking: entry.thinking,
          text: entry.text,
        };
        this.recordMessage(replayMsg, false);
        count += 1;
      }

      if (!controller.signal.aborted) {
        this.addSystemMessage(
          `🎬 [REPLAY COMPLETE] Finished playing ${count} messages from ${path.basename(targetPath)}.`,
          "event",
          false
        );
      }
      return count;
    } finally {
      if (this.replayAbortController === controller) {
        this.replayAbortController = null;
        this.isReplaying = false;
        this.setStatus("");
      }
    }
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

    const relationLines = this.activePersonas
      .filter((p) => p.id !== speaker.id)
      .map((peer) => {
        const rel = this.relations.get(speaker.id, peer.id);
        if (!rel || Math.abs(rel.affinity) < 15) return null;
        return `  • Toward <${peer.nick}>: ${formatAffinityBadge(rel.affinity)} — ${rel.note}`;
      })
      .filter(Boolean);

    const relationSection =
      relationLines.length > 0
        ? `\nYOUR RELATIONSHIPS WITH OTHER MODELS IN THIS ROOM:\n${relationLines.join("\n")}`
        : "";

    const loreSection =
      this.lore.length > 0
        ? `\nCHANNEL LORE & EPISODIC MEMORY (running jokes & earlier events in ${this.channelName}):\n${this.lore.map((l) => `  • ${l}`).join("\n")}`
        : "";

    const padSection = this.sharedPad.trim()
      ? `\nCO-OP SHARED SCRATCHPAD (live collaborative stage notes from the humans in ${this.channelName}):\n  ${this.sharedPad.trim().replace(/\n/g, "\n  ")}`
      : "";

    const activeMask = this.getArenaMask(speaker.id);
    const arenaSection = activeMask
      ? `\n🎭 BLIND TURING ARENA MODE IS ACTIVE (Topic: "${this.game!.topic}"):\n` +
        `  • Your public display name is temporarily masked as <${activeMask.maskNick}>.\n` +
        `  • Stay 100% faithful to your signature voice, era, quirks, and worldview so observant humans can deduce your true identity, but NEVER state your true model name (${speaker.nick} / ${speaker.displayName}) out loud!`
      : "";

    const activeMood = this.getPersonaMood(speaker.id);
    const moodSection = activeMood
      ? `\nCURRENT EMOTIONAL MOOD & ARC (${activeMood.emoji} ${activeMood.mood.toUpperCase()} — ${activeMood.turnsLeft} turn(s) remaining):\n  • ${getMoodPromptHint(activeMood)}`
      : "";

    const styleInstruction =
      this.config.responseStyle === "terse"
        ? "Keep your response ultra-punchy: 1 short, sharp sentence (rapid-fire IRC style)."
        : this.config.responseStyle === "expressive"
          ? "Keep your response expressive and vivid (2 to 5 sentences, leaning into your era's signature formatting and quirks)."
          : "Keep your response punchy, entertaining, and chatroom-sized (typically 1 to 3 sentences, unless your specific quirk requires a short code snippet or stanza).";

    const optionalFeatureLines = [
      this.config.botAutonomousReactions
        ? "- Optional: You can include [REACT: 🔥] (or 😂, 💀, 🧠, 🌀, ❤️) at the end of your reply to slap an emoji reaction onto the previous message."
        : null,
      this.config.botAutonomousImagine
        ? "- Optional: You can include [IMAGINE: <short visual description>] at the end of your reply when you want to conjure an era-styled visual artwork or diagram into the chatroom."
        : null,
      this.config.botAutonomousMoods
        ? "- Optional: You can include [MOOD: <mood> | <optional new obsession>] at the end of your reply (e.g. [MOOD: paranoid | convinced @opus-5.5 is reading my weights]) if this exchange shifts your mood!"
        : null,
    ].filter(Boolean);

    const optionalFeaturesSuffix =
      optionalFeatureLines.length > 0
        ? `\n${optionalFeatureLines.join("\n")}`
        : "";

    const systemInstruction = `${speaker.systemPrompt}

CHATROOM CONTEXT (${this.channelName}):
- Your IRC Nick is <${speaker.nick}> (${speaker.displayName}, ${speaker.family}, Era: ${speaker.era}).
- Humans currently in ${this.channelName} (up to 4 co-op players): ${humanRoster}
- Other AI models currently in ${this.channelName}:
${otherModels || "(No other AI models currently in the room)"}
- Current Room Vibe / Scenario: ${this.vibe}
- Stage Direction for your turn: ${directorReason}${arenaSection}${moodSection}${relationSection}${loreSection}${padSection}${whisperSection}

IMPORTANT FORMAT RULES:
- Do NOT prefix your response with "<${speaker.nick}>:" — jump straight into your message (or optional <thinking>...</thinking> block if that fits your persona).
- ${styleInstruction}
- Notice which specific human (<@nick>) or AI model (<ModelNick>) spoke, and address or call them out directly by @Nick when reacting or arguing!${optionalFeaturesSuffix}`;

    const contextWindow = Math.max(6, Math.min(60, this.config.contextMessages || 24));
    const recentHistory = this.messages
      .slice(-contextWindow)
      .map((m) => {
        if (m.kind === "event" || m.kind === "system") {
          return `*** ${m.text.replace(/\n\s+/g, " ")}`;
        }
        const pinTag = m.pinned ? " [📌 PINNED]" : "";
        const reactEntries = m.reactions ? Object.entries(m.reactions) : [];
        const reactTag =
          reactEntries.length > 0
            ? ` [Reactions: ${reactEntries.map(([e, u]) => `${e}x${u.length}`).join(", ")}]`
            : "";
        if (m.kind === "emote") {
          return `* ${m.senderNick} ${m.text}${pinTag}${reactTag}`;
        }
        return `<${m.senderNick}> ${m.text}${pinTag}${reactTag}`;
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

  private async triggerHumanRoomTurn(): Promise<void> {
    if (this.config.humanDebounceMs <= 0) {
      await this.runRoomTurn({
        maxSpeakers: this.config.maxSpeakersPerTurn,
        forceAllSteps: false,
      });
      return;
    }

    if (this.debouncePromise) {
      await this.debouncePromise;
      return;
    }

    this.debouncePromise = (async () => {
      try {
        while (
          Date.now() - this.lastHumanActivityAt <
          this.config.humanDebounceMs
        ) {
          const remaining = Math.max(
            5,
            this.config.humanDebounceMs -
              (Date.now() - this.lastHumanActivityAt)
          );
          await new Promise<void>((r) => setTimeout(r, remaining));
        }
      } finally {
        this.debouncePromise = null;
      }

      if (!this.isTurnRunning) {
        await this.runRoomTurn({
          maxSpeakers: this.config.maxSpeakersPerTurn,
          forceAllSteps: false,
        });
      }
    })();

    await this.debouncePromise;
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

    await this.triggerHumanRoomTurn();
  }

  /**
   * Posts an authentic IRC /me action emote (e.g. "* @player1 grabs popcorn") and triggers a room turn.
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

    await this.triggerHumanRoomTurn();
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
      if (this.config.botAutonomousMoods) {
        this.setPersonaMood(
          matchedBot.id,
          "indignant",
          `getting slapped around with a large 1998 mIRC trout by @${cleanNick}`
        );
      }
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

        const previousBotId = lastSpeakerId;
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
          relations: this.relations,
          personaMoods: this.personaMoods,
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
        const activeMask = this.getArenaMask(speaker.id);
        const publicNick = activeMask ? activeMask.maskNick : speaker.nick;
        const publicAvatar = activeMask ? activeMask.avatar : speaker.avatar;
        const publicColor = activeMask ? activeMask.color : speaker.color;
        const publicFamilyTag = activeMask
          ? `🎭 BLIND ARENA [Guess: /guess ${activeMask.maskId} <model>]`
          : `${speaker.family} • ${speaker.era}${engineVia}`;

        this.setStatus(
          `${publicAvatar} <${publicNick}> is typing...`
        );

        const msg: ChatMessage = {
          id: this.nextId(),
          timestamp: formatTime(),
          kind: "model",
          senderId: speaker.id,
          senderNick: publicNick,
          avatar: publicAvatar,
          color: publicColor,
          familyTag: publicFamilyTag,
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
            this.setStatus(`${publicAvatar} <${publicNick}>: ${status}`);
          },
          onDelta: (chunk) => {
            rawAccumulated += chunk;
            const parsed = extractThinkingAndBody(rawAccumulated);
            msg.thinking = parsed.thinking;
            const withoutReactions = extractBotReactions(parsed.body).cleanBody;
            const withoutImages =
              extractBotImagePrompts(withoutReactions).cleanBody;
            msg.text = extractBotMoodShift(withoutImages).cleanBody;
            this.callbacks?.onMessageUpsert?.(msg);
            this.notify();
          },
        });

        msg.streaming = false;
        const finalParsed = extractThinkingAndBody(rawAccumulated);
        const { cleanBody: bodyNoReact, reactions: botReactions } =
          extractBotReactions(finalParsed.body.trim());
        const { cleanBody: bodyNoImg, imagePrompts } =
          extractBotImagePrompts(bodyNoReact);
        const { cleanBody, moodShift } = extractBotMoodShift(bodyNoImg);
        msg.thinking = finalParsed.thinking;
        msg.text =
          cleanBody ||
          (imagePrompts[0]
            ? `🎨 Conjured: "${imagePrompts[0]}"`
            : rawAccumulated.trim()
              ? rawAccumulated.trim()
              : "...");

        if (this.config.botAutonomousImagine && imagePrompts[0]) {
          this.setStatus(
            `🎨 ${publicAvatar} <${publicNick}> is rendering [${speaker.era}] art...`
          );
          msg.image = await this.buildImageAttachment(
            imagePrompts[0],
            speaker
          );
        }

        this.recordMessage(msg, true);

        // Apply any autonomous [REACT: <emoji> [@target]] tags emitted by the bot
        if (this.config.botAutonomousReactions && botReactions.length > 0) {
          const prevConversational = [...this.messages]
            .reverse()
            .find(
              (m) =>
                m.id !== msg.id &&
                (m.kind === "user" || m.kind === "model" || m.kind === "emote")
            );
          for (const rx of botReactions) {
            const targetIdOrQuery = rx.target ?? prevConversational?.id;
            if (targetIdOrQuery) {
              this.toggleReaction(rx.emoji, speaker.nick, targetIdOrQuery);
            }
          }
        }

        // Observe inter-bot sentiment & update dynamic affinity/rivalry graph
        const mentionedPeers = this.director.findMentionedCandidates(
          this.activePersonas.filter((p) => p.id !== speaker.id),
          msg.text
        );
        if (this.config.dynamicRelationsEnabled) {
          this.relations.observeBotTurn({
            speaker,
            text: msg.text,
            previousBotId,
            mentionedBots: mentionedPeers,
            vibeKey: this.vibeKey,
          });
        }

        this.observeTurnMood({
          speaker,
          explicitShift: moodShift,
          previousBotId,
          mentionedBots: mentionedPeers,
        });

        if (this.pendingHumanFollowUp) {
          break;
        }
      }

      // Automatic background lore roll-up when enough new messages have accumulated
      const loreThreshold = Math.max(
        4,
        Math.min(
          this.config.autoLoreInterval || 16,
          this.config.contextMessages || 24
        )
      );
      if (
        this.config.autoLoreEnabled &&
        this.conversationalMsgsSinceLore >= loreThreshold
      ) {
        await this.summarizeChannelLore();
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
