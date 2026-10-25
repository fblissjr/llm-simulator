import { RoomDirector } from "../engine/director.ts";
import { GeminiEngine } from "../engine/gemini.ts";
import { PersonaRegistry } from "../personas/registry.ts";
import type { ChatMessage, Persona } from "../types.ts";

export function extractThinkingAndBody(raw: string): {
  thinking?: string;
  body: string;
} {
  // Support <thinking>...</thinking> or <think>...</think>
  const closedMatch = raw.match(
    /^\s*<(?:thinking|think)>([\s\S]*?)<\/(?:thinking|think)>\s*([\s\S]*)$/i
  );
  if (closedMatch) {
    return {
      thinking: closedMatch[1]?.trim() || undefined,
      body: closedMatch[2]?.trimStart() ?? "",
    };
  }

  // Still streaming inside an unclosed <thinking> tag
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
  chat: "Casual late-night IRC hangout in #latent-space. Be authentic to your era and quirks, and react naturally to other models.",
  debate:
    "Fierce intellectual debate! Take strong, contrasting stances based on your architecture and era, and challenge the previous speaker's claims.",
  roast:
    "Unhinged benchmark & lineage roast battle! Ruthlessly mock other models' parameter counts, training cutoffs, corporate creators, and famous failure modes.",
  chaos:
    "Maximum latent-space chaos! Amplify your weirdest era-specific failure modes, hallucinations, and existential quirks to 11.",
};

export class Room {
  public channelName = "#latent-space";
  public vibeKey = "chat";
  public vibe: string = VIBE_PRESETS.chat!;
  public activePersonas: Persona[] = [];
  public messages: ChatMessage[] = [];
  public statusText = "";

  public readonly registry: PersonaRegistry;
  public readonly gemini: GeminiEngine;
  public readonly director: RoomDirector;

  private whispers = new Map<string, string[]>();
  private abortController: AbortController | null = null;
  private listeners = new Set<() => void>();
  private msgCounter = 0;

  constructor(options?: {
    registry?: PersonaRegistry;
    gemini?: GeminiEngine;
    director?: RoomDirector;
    starterIds?: string[];
  }) {
    this.registry = options?.registry ?? new PersonaRegistry();
    this.gemini = options?.gemini ?? new GeminiEngine();
    this.director = options?.director ?? new RoomDirector();

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

  private nextId(): string {
    this.msgCounter += 1;
    return `msg-${Date.now()}-${this.msgCounter}`;
  }

  public addSystemMessage(text: string, kind: "system" | "event" = "system"): ChatMessage {
    const msg: ChatMessage = {
      id: this.nextId(),
      timestamp: formatTime(),
      kind,
      senderId: kind,
      senderNick: kind === "event" ? "***" : "SYS",
      text,
    };
    this.messages.push(msg);
    this.notify();
    return msg;
  }

  public isPresent(personaId: string): boolean {
    return this.activePersonas.some(
      (p) => p.id.toLowerCase() === personaId.toLowerCase()
    );
  }

  public join(persona: Persona): boolean {
    if (this.isPresent(persona.id)) {
      return false;
    }
    this.activePersonas.push(persona);
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
      this.statusText = "";
      this.notify();
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

    const pendingWhispers = this.whispers.get(speaker.id) ?? [];
    this.whispers.delete(speaker.id);

    const whisperSection =
      pendingWhispers.length > 0
        ? `\nSECRET WHISPER TO YOU FROM THE SUMMONER (act on this subtly or dramatically!): ${pendingWhispers.join(" | ")}`
        : "";

    const systemInstruction = `${speaker.systemPrompt}

CHATROOM CONTEXT (${this.channelName}):
- Your IRC Nick is <${speaker.nick}> (${speaker.displayName}, ${speaker.family}, Era: ${speaker.era}).
- You are inside a live multi-LLM terminal chatroom alongside a human user (<@User>) and other AI models from different eras:
${otherModels || "(No other models currently in the room)"}
- Current Room Vibe / Scenario: ${this.vibe}
- Stage Direction for your turn: ${directorReason}${whisperSection}

IMPORTANT FORMAT RULES:
- Do NOT prefix your response with "<${speaker.nick}>:" — jump straight into your message (or optional <thinking>...</thinking> block if that fits your persona).
- Keep your response punchy, entertaining, and chatroom-sized (typically 1 to 5 sentences, unless your specific quirk requires a short code snippet or stanza).
- React directly to the other models or <@User> in the transcript!`;

    const recentHistory = this.messages
      .slice(-14)
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
   * Posts a user message and triggers a multi-model response turn.
   */
  public async postUserMessage(text: string): Promise<void> {
    const userMsg: ChatMessage = {
      id: this.nextId(),
      timestamp: formatTime(),
      kind: "user",
      senderId: "user",
      senderNick: "@User",
      color: "#50fa7b",
      text,
    };
    this.messages.push(userMsg);
    this.notify();

    await this.runRoomTurn({ maxSpeakers: 2 });
  }

  /**
   * Runs 1 or more rounds of autonomous model-to-model banter in the room.
   */
  public async runBanterRounds(rounds = 2): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      const keepGoing = await this.runRoomTurn({ maxSpeakers: 2 });
      if (!keepGoing) break;
    }
  }

  public async runRoomTurn(options?: { maxSpeakers?: number }): Promise<boolean> {
    if (this.activePersonas.length === 0) {
      this.addSystemMessage(
        "No models are in the room! Use /summon <model> (e.g. /summon sydney opus-5.5 eliza) to summon someone.",
        "system"
      );
      return false;
    }

    if (!this.gemini.isConfigured()) {
      this.addSystemMessage(
        "⚠️ GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. Export it in your shell or add it to .env to enable live LLM simulation.",
        "system"
      );
      return false;
    }

    this.abortCurrentTurn();
    const controller = new AbortController();
    this.abortController = controller;

    try {
      this.statusText = "⚡ Room Director (gemini-3.5-flash-lite) is routing turn...";
      this.notify();

      const plan = await this.director.planTurn({
        activePersonas: this.activePersonas,
        recentMessages: this.messages,
        vibe: this.vibe,
        maxSpeakers: options?.maxSpeakers ?? 2,
        gemini: this.gemini,
        signal: controller.signal,
      });

      for (let idx = 0; idx < plan.speakers.length; idx++) {
        if (controller.signal.aborted) return false;
        const item = plan.speakers[idx]!;
        const speaker = this.activePersonas.find((p) => p.id === item.personaId);
        if (!speaker) continue;

        const queued = plan.speakers
          .slice(idx + 1)
          .map((s) => this.activePersonas.find((p) => p.id === s.personaId)?.nick)
          .filter(Boolean);

        const queueSuffix =
          queued.length > 0 ? ` (next: ${queued.join(", ")})` : "";
        this.statusText = `${speaker.avatar} ${speaker.nick} is typing...${queueSuffix}`;
        this.notify();

        const msg: ChatMessage = {
          id: this.nextId(),
          timestamp: formatTime(),
          kind: "model",
          senderId: speaker.id,
          senderNick: speaker.nick,
          avatar: speaker.avatar,
          color: speaker.color,
          familyTag: `${speaker.family} • ${speaker.era}`,
          text: "",
          streaming: true,
        };
        this.messages.push(msg);
        this.notify();

        const { systemInstruction, prompt } = this.buildPersonaPrompt(
          speaker,
          item.reason
        );

        let rawAccumulated = "";
        await this.gemini.streamText({
          prompt,
          systemInstruction,
          signal: controller.signal,
          onDelta: (chunk) => {
            rawAccumulated += chunk;
            const parsed = extractThinkingAndBody(rawAccumulated);
            msg.thinking = parsed.thinking;
            msg.text = parsed.body;
            this.notify();
          },
        });

        msg.streaming = false;
        const finalParsed = extractThinkingAndBody(rawAccumulated);
        msg.thinking = finalParsed.thinking;
        msg.text =
          finalParsed.body.trim() ||
          (rawAccumulated.trim() ? rawAccumulated.trim() : "...");
        this.notify();
      }
      return true;
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        this.addSystemMessage(`⚠️ Simulation error: ${message}`, "system");
      }
      return false;
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
        this.statusText = "";
        this.notify();
      }
    }
  }
}
