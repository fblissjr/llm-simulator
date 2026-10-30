import {
  Editor,
  matchesKey,
  ProcessTerminal,
  Text,
  TUI,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import {
  ChatroomAutocompleteProvider,
  handleSlashCommand,
} from "../core/commands.ts";
import { Room } from "../core/room.ts";
import type { ChannelHub } from "../server/hub.ts";
import type { ClientPacket, ServerPacket } from "../types.ts";
import {
  editorTheme,
  formatChatMessage,
  renderIrcHeader,
} from "./theme.ts";

export interface ChatroomAppOptions {
  room?: Room;
  hub?: ChannelHub;
  wsUrl?: string;
  nick?: string;
  channel?: string;
}

export class ChatroomApp {
  private terminal: ProcessTerminal;
  private tui: TUI;
  private room: Room;
  private hub?: ChannelHub;
  private wsUrl?: string;
  private ws: WebSocket | null = null;

  public selfNick: string;
  public isHost = true;
  private locked = false;
  private shareUrl: string | null = null;
  private localInviteUrl?: string;
  private maxHumans = 4;
  private spectatorCount = 0;
  private apiOnline?: boolean;
  private typingUsers: string[] = [];
  private lastTypingSentAt = 0;
  private scrollOffset = 0;
  private spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private spinnerIndex = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private isStarted = false;

  private headerView: Text;
  private feedView: Text;
  private statusView: Text;
  private editor: Editor;

  constructor(roomOrOptions?: Room | ChatroomAppOptions) {
    const opts: ChatroomAppOptions =
      roomOrOptions instanceof Room
        ? { room: roomOrOptions }
        : (roomOrOptions ?? {});

    this.hub = opts.hub;
    this.selfNick = opts.nick ?? "host";
    const initialChannel = opts.channel ?? "#latent-space";

    if (opts.wsUrl) {
      this.wsUrl = ChatroomApp.normalizeWsUrl(
        opts.wsUrl,
        this.selfNick,
        initialChannel,
        false
      );
      this.room = new Room({ channelName: initialChannel, starterIds: [] });
    } else if (opts.hub) {
      this.wsUrl = ChatroomApp.normalizeWsUrl(
        `ws://127.0.0.1:${opts.hub.port}/ws?key=${opts.hub.passkey}`,
        this.selfNick,
        initialChannel,
        true
      );
      this.room = new Room({ channelName: initialChannel, starterIds: [] });
    } else {
      this.room = opts.room ?? new Room({ channelName: initialChannel });
    }

    this.terminal = new ProcessTerminal();
    this.tui = new TUI(this.terminal);

    this.headerView = new Text("", 1, 0);
    this.feedView = new Text("", 1, 0);
    this.statusView = new Text("", 1, 0);
    this.editor = new Editor(this.tui, editorTheme, {
      paddingX: 1,
      autocompleteMaxVisible: 10,
    });

    this.editor.setAutocompleteProvider(
      new ChatroomAutocompleteProvider(this.room)
    );

    this.tui.addChild(this.headerView);
    this.tui.addChild(this.feedView);
    this.tui.addChild(this.statusView);
    this.tui.addChild(this.editor);
    this.tui.setFocus(this.editor);

    this.setupHandlers();
    if (!this.wsUrl) {
      this.seedWelcomeMessage();
    }
    this.syncViews();

    this.room.subscribe(() => {
      this.syncViews();
    });
  }

  public static normalizeWsUrl(
    rawUrl: string,
    nick: string,
    channel: string,
    isHost: boolean
  ): string {
    const parsed = new URL(
      rawUrl.startsWith("http://")
        ? rawUrl.replace(/^http:\/\//, "ws://")
        : rawUrl.startsWith("https://")
          ? rawUrl.replace(/^https:\/\//, "wss://")
          : rawUrl
    );
    if (!parsed.pathname || parsed.pathname === "/") {
      parsed.pathname = "/ws";
    }
    if (!parsed.searchParams.get("nick")) {
      parsed.searchParams.set("nick", nick);
    }
    if (!parsed.searchParams.get("channel")) {
      parsed.searchParams.set("channel", channel);
    }
    if (isHost) {
      parsed.searchParams.set("host", "1");
    }
    return parsed.toString();
  }

  private seedWelcomeMessage(): void {
    const starterList = this.room.activePersonas
      .map((p) => `${p.avatar} <${p.nick}> (${p.era})`)
      .join(", ");

    this.room.addSystemMessage(
      `Welcome to ${this.room.channelName} — The Multi-Era LLM Simulation Chatroom (1966–2026)!\n` +
        `  Currently in channel: ${starterList}\n` +
        `  • Type a message (or @Nick) to chat with the room (Preset: ${this.room.config.preset.toUpperCase()} — 1 to ${this.room.config.maxSpeakersPerTurn} bots react naturally!).\n` +
        `  • Use /summon <model>, /config [preset|set], /scenario <id>, /vibe, /me <action>, /slap <nick>, /whisper, or /share.`,
      "system",
      false
    );
  }

  private connectWebSocket(): void {
    if (!this.wsUrl) return;

    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.seedWelcomeMessage();
      this.syncViews();
    });

    ws.addEventListener("message", (ev) => {
      try {
        const packet = JSON.parse(String(ev.data)) as ServerPacket;
        this.handleServerPacket(packet);
      } catch {
        // Ignore malformed packets
      }
    });

    ws.addEventListener("close", (ev) => {
      this.room.addSystemMessage(
        `Disconnected from server (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ""}).`,
        "system",
        false
      );
      this.syncViews();
    });
  }

  private sendClientPacket(packet: ClientPacket): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(packet));
    }
  }

  private handleServerPacket(packet: ServerPacket): void {
    if (packet.type === "sync") {
      for (const p of packet.catalog) {
        if (!this.room.registry.get(p.id)) {
          this.room.registry.register(p, false);
        }
      }
      const s = packet.state;
      this.selfNick = packet.selfNick;
      this.isHost = packet.isHost;
      this.room.channelName = s.channelName;
      this.room.vibeKey = s.vibeKey;
      this.room.vibe = s.vibe;
      if (s.activeProvider) {
        this.room.gemini.activeProvider = s.activeProvider;
      }
      this.room.gemini.activeModel = s.engineModel;
      if (s.personaBindings) {
        this.room.gemini.setAllPersonaBindings(s.personaBindings);
      }
      if (s.personaMoods) {
        this.room.personaMoods = s.personaMoods;
      }
      if (s.config) {
        this.room.config = s.config;
      }
      if (s.lore) {
        this.room.lore = s.lore;
      }
      if (s.sharedPad !== undefined) {
        this.room.sharedPad = s.sharedPad;
      }
      this.typingUsers = s.typingUsers ?? [];
      this.apiOnline = s.apiOnline;
      this.locked = s.locked;
      this.shareUrl = s.shareUrl;
      this.localInviteUrl = s.localInviteUrl;
      this.maxHumans = s.maxHumans;
      this.spectatorCount = s.spectatorCount ?? 0;
      this.room.humans = s.humans;
      this.room.activePersonas = s.activePersonas;
      this.room.messages = s.messages;
      this.room.statusText = s.statusText;
      this.syncViews();
      return;
    }

    if (packet.type === "presence") {
      for (const p of packet.activePersonas) {
        if (!this.room.registry.get(p.id)) {
          this.room.registry.register(p, false);
        }
      }
      this.room.humans = packet.humans;
      this.spectatorCount = packet.spectatorCount ?? 0;
      this.room.activePersonas = packet.activePersonas;
      this.room.vibeKey = packet.vibeKey;
      this.room.vibe = packet.vibe;
      if (packet.activeProvider) {
        this.room.gemini.activeProvider = packet.activeProvider;
      }
      this.room.gemini.activeModel = packet.engineModel;
      if (packet.personaBindings) {
        this.room.gemini.setAllPersonaBindings(packet.personaBindings);
      }
      if (packet.personaMoods) {
        this.room.personaMoods = packet.personaMoods;
      }
      if (packet.config) {
        this.room.config = packet.config;
      }
      if (packet.sharedPad !== undefined) {
        this.room.sharedPad = packet.sharedPad;
      }
      this.typingUsers = packet.typingUsers ?? [];
      this.apiOnline = packet.apiOnline;
      this.locked = packet.locked;
      this.shareUrl = packet.shareUrl;
      this.localInviteUrl = packet.localInviteUrl;
      this.syncViews();
      return;
    }

    if (packet.type === "catalog:update") {
      for (const p of packet.catalog) {
        if (!this.room.registry.get(p.id)) {
          this.room.registry.register(p, false);
        }
      }
      this.syncViews();
      return;
    }

    if (packet.type === "message:upsert") {
      const idx = this.room.messages.findIndex(
        (m) => m.id === packet.message.id
      );
      if (idx >= 0) {
        this.room.messages[idx] = packet.message;
      } else {
        this.room.messages.push(packet.message);
      }
      this.syncViews();
      return;
    }

    if (packet.type === "message:clear") {
      this.room.messages = [];
      this.syncViews();
      return;
    }

    if (packet.type === "notice") {
      this.room.messages.push(packet.message);
      this.syncViews();
      return;
    }

    if (packet.type === "status") {
      this.room.statusText = packet.statusText;
      this.syncViews();
      return;
    }

    if (packet.type === "pad:update") {
      this.room.sharedPad = packet.text;
      this.syncViews();
      return;
    }

    if (packet.type === "nick:ack") {
      this.selfNick = packet.nick;
      this.syncViews();
      return;
    }

    if (packet.type === "kicked") {
      this.room.addSystemMessage(`👢 ${packet.reason}`, "system", false);
      this.syncViews();
      setTimeout(() => this.quit(), 500);
    }
  }

  private setupHandlers(): void {
    this.editor.onSubmit = (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;

      this.scrollOffset = 0;
      this.editor.addToHistory(text);
      this.editor.setText("");
      this.tui.requestRender();

      void this.processInput(text);
    };

    this.tui.addInputListener((data) => {
      if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) {
        this.quit();
        return { consume: true };
      }

      if (matchesKey(data, "pageUp")) {
        const maxOffset = Math.max(0, this.room.messages.length - 10);
        this.scrollOffset = Math.min(maxOffset, this.scrollOffset + 10);
        this.syncViews();
        return { consume: true };
      }

      if (matchesKey(data, "pageDown")) {
        this.scrollOffset = Math.max(0, this.scrollOffset - 10);
        this.syncViews();
        return { consume: true };
      }

      if (matchesKey(data, "ctrl+t")) {
        if (this.wsUrl) {
          this.sendClientPacket({ type: "command", raw: "/think" });
        } else {
          void handleSlashCommand("/think", this.room, {
            senderNick: this.selfNick,
            isHost: this.isHost,
          });
        }
        return { consume: true };
      }

      if (matchesKey(data, "escape") && !this.editor.isShowingAutocomplete()) {
        if (this.wsUrl) {
          this.sendClientPacket({ type: "command", raw: "/shush" });
          return { consume: true };
        }
        if (this.room.abortCurrentTurn()) {
          this.room.addSystemMessage(
            "🤫 Interrupted active model turn (Esc).",
            "system",
            false
          );
          return { consume: true };
        }
      }

      // Notify typing presence (throttled) so ambient chatter pauses while a human is typing
      const now = Date.now();
      if (now - this.lastTypingSentAt > 2500) {
        this.lastTypingSentAt = now;
        if (this.wsUrl) {
          this.sendClientPacket({ type: "typing", isTyping: true });
        } else {
          this.room.markHumanTyping(this.selfNick, true);
        }
      }

      return undefined;
    });
  }

  private async processInput(text: string): Promise<void> {
    if (text === "/quit" || text === "/exit") {
      this.quit();
      return;
    }

    if (this.wsUrl) {
      if (text.startsWith("/")) {
        this.sendClientPacket({ type: "command", raw: text });
      } else {
        this.sendClientPacket({ type: "chat", text });
      }
      return;
    }

    if (text.startsWith("/")) {
      await handleSlashCommand(text, this.room, {
        senderNick: this.selfNick,
        isHost: this.isHost,
        onQuit: () => this.quit(),
      });
      return;
    }

    await this.room.postUserMessage(text, this.selfNick);
  }

  private syncViews(): void {
    this.headerView.setText(
      renderIrcHeader(this.room, {
        selfNick: this.selfNick,
        locked: this.locked,
        shareUrl: this.shareUrl,
        localInviteUrl: this.localInviteUrl,
        maxHumans: this.maxHumans,
        spectatorCount: this.spectatorCount,
        apiOnline: this.apiOnline,
      })
    );

    const total = this.room.messages.length;
    const endIdx = Math.max(0, total - this.scrollOffset);
    const startIdx = Math.max(0, endIdx - 45);
    const renderedMessages = this.room.messages
      .slice(startIdx, endIdx)
      .map((m) =>
        formatChatMessage(m, {
          thinkingDisplay: this.room.config.thinkingDisplay,
        })
      )
      .join("\n\n");

    this.feedView.setText(
      renderedMessages ? `\n${renderedMessages}\n` : "\n"
    );

    if (this.room.statusText) {
      if (this.isStarted && !this.spinnerTimer) {
        this.spinnerTimer = setInterval(() => {
          this.spinnerIndex =
            (this.spinnerIndex + 1) % this.spinnerFrames.length;
          this.syncViews();
        }, 90);
      }
      const frame = this.spinnerFrames[this.spinnerIndex] ?? "⏳";
      this.statusView.setText(
        chalk.hex("#f1fa8c")(`  ${frame} ${this.room.statusText}`)
      );
    } else {
      if (this.spinnerTimer) {
        clearInterval(this.spinnerTimer);
        this.spinnerTimer = null;
      }
      const scrollBadge =
        this.scrollOffset > 0
          ? chalk.hex("#ffb86c")(` [Scrolled +${this.scrollOffset} msgs • PgDn to return] `)
          : "";
      const otherTypers = (
        this.wsUrl ? this.typingUsers : this.room.getTypingHumans()
      ).filter((u) => u.toLowerCase() !== this.selfNick.toLowerCase());
      const typingBadge =
        otherTypers.length > 0
          ? chalk.hex("#8be9fd")(
              ` [✍️ ${otherTypers.map((u) => `@${u}`).join(", ")} typing...] `
            )
          : "";
      this.statusView.setText(
        chalk.hex("#6272a4")(
          `  ── [@${this.selfNick}]${scrollBadge}${typingBadge} Type a message or /command (Tab: autocomplete • Ctrl+T: thoughts • Esc: shush) ──`
        )
      );
    }

    this.tui.requestRender();
  }

  public start(): void {
    this.isStarted = true;
    if (this.wsUrl) {
      this.connectWebSocket();
    }
    this.tui.start();
  }

  public quit(): void {
    this.isStarted = false;
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }
    this.room.stopAmbientLoop();
    this.room.abortCurrentTurn();
    this.hub?.stop();
    this.tui.stop();
    process.exit(0);
  }
}
