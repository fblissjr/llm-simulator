import { RoomDirector } from "../engine/director.ts";
import { GeminiEngine } from "../engine/gemini.ts";
import { PersonaRegistry } from "../personas/registry.ts";
import type { SimDatabase } from "../server/db.ts";
import type {
  ChatMessage,
  HumanPlayer,
  Persona,
  PersonaEngineBinding,
} from "../types.ts";

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
  public activePersonas: Persona[] = [];
  public humans: HumanPlayer[] = [];
  public messages: ChatMessage[] = [];
  public statusText = "";

  public readonly registry: PersonaRegistry;
  public readonly gemini: GeminiEngine;
  public readonly director: RoomDirector;
  public readonly db?: SimDatabase;
  public callbacks?: RoomEventCallbacks;

  private whispers = new Map<string, string[]>();
  private abortController: AbortController | null = null;
  private listeners = new Set<() => void>();
  private msgCounter = 0;

  constructor(options?: {
    channelName?: string;
    registry?: PersonaRegistry;
    gemini?: GeminiEngine;
    director?: RoomDirector;
    db?: SimDatabase;
    starterIds?: string[];
    callbacks?: RoomEventCallbacks;
  }) {
    this.channelName = options?.channelName ?? "#latent-space";
    this.db = options?.db;
    this.registry =
      options?.registry ?? new PersonaRegistry(undefined, this.db);
    this.gemini = options?.gemini ?? new GeminiEngine();
    this.director = options?.director ?? new RoomDirector();
    this.callbacks = options?.callbacks;

    if (
      this.db &&
      Object.keys(this.gemini.getAllPersonaBindings()).length === 0
    ) {
      this.gemini.setAllPersonaBindings(this.db.loadPersonaBindings());
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
        this.db.upsertChannel(this.channelName, this.vibeKey, this.vibe);
        this.db.setChannelBotIds(
          this.channelName,
          this.activePersonas.map((p) => p.id)
        );
      }
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
    this.db?.upsertChannel(this.channelName, this.vibeKey, this.vibe);
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
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      this.setStatus("");
      return true;
    }
    return false;
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
- Keep your response punchy, entertaining, and chatroom-sized (typically 1 to 5 sentences, unless your specific quirk requires a short code snippet or stanza).
- Notice which specific human (<@nick>) or AI model (<ModelNick>) spoke, and react directly to them!`;

    const recentHistory = this.messages
      .slice(-16)
      .map((m) => {
        if (m.kind === "event" || m.kind === "system") {
          return `*** ${m.text.replace(/\n\s+/g, " ")}`;
        }
        return `<${m.senderNick}> ${m.text}`;
      })
      .join("\n");

    const prompt = `Recent channel transcript in ${this.channelName}:
${recentHistory || "(Channel is quiet)"}

Respond now as <${speaker.nick}>:`;

    return { systemInstruction, prompt };
  }

  /**
   * Posts a human message (attributed to their specific @nick) and triggers the reactive Director turn.
   */
  public async postUserMessage(
    text: string,
    senderNick = "User"
  ): Promise<void> {
    const cleanNick = senderNick.replace(/^@/, "");
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

    await this.runRoomTurn({ maxSpeakers: 2, forceAllSteps: false });
  }

  /**
   * Runs N autonomous rounds of bot-to-bot banter.
   */
  public async runBanterRounds(rounds = 2): Promise<void> {
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

  /**
   * Reactive turn loop:
   * - Step 0 picks the initial speaker.
   * - After Speaker k finishes streaming, the Director reads what Speaker k ACTUALLY said
   *   and decides if another bot in the room jumps in!
   */
  public async runRoomTurn(options?: {
    maxSpeakers?: number;
    forceAllSteps?: boolean;
  }): Promise<boolean> {
    if (this.activePersonas.length === 0) {
      this.addSystemMessage(
        "No models are in the room! Use /summon <model> (e.g. /summon sydney opus-5.5 eliza) to summon someone.",
        "system",
        false
      );
      return false;
    }

    if (!this.gemini.isConfigured()) {
      await this.gemini.autoDetectLocalProviders();
    }

    const anyConfigured =
      this.gemini.isConfigured() ||
      this.activePersonas.some((p) => this.gemini.isConfigured(p));

    if (!anyConfigured && this.gemini.activeProvider !== "heylook") {
      this.addSystemMessage(
        `⚠️ Provider "${this.gemini.activeProvider}" is not configured. Set GEMINI_API_KEY, OPENROUTER_API_KEY, or run "/provider heylook" to use your local heylookitsanllm server.`,
        "system",
        false
      );
      return false;
    }

    this.abortCurrentTurn();
    const controller = new AbortController();
    this.abortController = controller;

    const maxSteps = options?.maxSpeakers ?? 2;
    const forceAllSteps = options?.forceAllSteps ?? false;
    let lastSpeakerId: string | undefined;

    try {
      for (let step = 0; step < maxSteps; step++) {
        if (controller.signal.aborted) return false;

        this.setStatus(
          step === 0
            ? `⚡ Room Director (${this.gemini.activeProvider}) is selecting speaker...`
            : "⚡ Room Director is checking if another model reacts..."
        );

        const decision = await this.director.pickNextSpeaker({
          activePersonas: this.activePersonas,
          humans: this.humans,
          recentMessages: this.messages,
          vibe: this.vibe,
          stepIndex: step,
          lastSpeakerId,
          forceContinue: forceAllSteps,
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
      }
      return true;
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        this.addSystemMessage(`⚠️ Simulation error: ${message}`, "system", false);
      }
      return false;
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
        this.setStatus("");
      }
    }
  }
}
