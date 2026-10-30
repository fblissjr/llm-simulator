import {
  type Component,
  Editor,
  matchesKey,
  type OverlayHandle,
  ProcessTerminal,
  type SettingItem,
  SettingsList,
  Text,
  TUI,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import {
  ChatroomAutocompleteProvider,
  handleSlashCommand,
} from "../core/commands.ts";
import { Room } from "../core/room.ts";
import {
  getVariableMenuValues,
  SIM_VARIABLE_DESCRIPTORS,
} from "../core/sim-config.ts";
import type { ChannelHub } from "../server/hub.ts";
import type { ClientPacket, ServerPacket } from "../types.ts";
import {
  editorTheme,
  formatChatMessage,
  renderIrcHeader,
  settingsListTheme,
} from "./theme.ts";

class SettingsModalComponent implements Component {
  constructor(
    private titleFn: () => string,
    public readonly list: SettingsList,
    private onStepDirection: (direction: 1 | -1) => void
  ) {}

  invalidate(): void {
    this.list.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "left")) {
      this.onStepDirection(-1);
      return;
    }
    if (matchesKey(data, "right")) {
      this.onStepDirection(1);
      return;
    }
    this.list.handleInput(data);
  }

  render(width: number): string[] {
    const innerWidth = Math.max(24, width - 4);
    const border = chalk.hex("#bd93f9")("═".repeat(Math.max(10, width - 2)));
    const header = chalk.bgHex("#282a36").hex("#50fa7b").bold(` ${this.titleFn()} `);
    const sub = chalk.hex("#6272a4")(
      "  ↑/↓ navigate • ←/→ or Enter/Space step value • Esc or Ctrl+O close"
    );
    const bodyLines = this.list.render(innerWidth);
    return [
      chalk.hex("#bd93f9")(`╔${border}╗`),
      `  ${header}`,
      sub,
      "",
      ...bodyLines.map((l) => `  ${l}`),
      chalk.hex("#bd93f9")(`╚${border}╝`),
    ];
  }
}

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
  private arenaActive?: boolean;
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
  private settingsOverlay: OverlayHandle | null = null;
  private settingsModal: SettingsModalComponent | null = null;
  private forgeOverlay: OverlayHandle | null = null;
  private forgeModal: SettingsModalComponent | null = null;

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
        `  • Use /settings (Ctrl+O), /summon <model>, /scenario <id>, /imagine <prompt>, /pad, /mood, /game, /me, /slap, or /share.`,
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
        this.room.registry.register(p, false);
      }
      const incomingScenarios = packet.scenarios ?? packet.state.scenarios;
      if (incomingScenarios) {
        for (const sc of incomingScenarios) {
          if (sc.isCustom) {
            this.room.registry.saveScenario(sc, false);
          }
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
      if (s.arenaActive !== undefined) {
        this.arenaActive = s.arenaActive;
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
      if (packet.lore) {
        this.room.lore = packet.lore;
      }
      if (packet.sharedPad !== undefined) {
        this.room.sharedPad = packet.sharedPad;
      }
      if (packet.arenaActive !== undefined) {
        this.arenaActive = packet.arenaActive;
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
        this.room.registry.register(p, false);
        this.room.refreshActivePersona(p);
      }
      if (packet.scenarios) {
        for (const sc of packet.scenarios) {
          if (sc.isCustom) {
            this.room.registry.saveScenario(sc, false);
          }
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

      if (matchesKey(data, "ctrl+o")) {
        if (this.isSettingsOpen()) {
          this.closeSettingsMenu();
        } else {
          if (this.isForgeOpen()) this.closeForgeMenu();
          this.openSettingsMenu();
        }
        return { consume: true };
      }

      if (matchesKey(data, "ctrl+f")) {
        if (this.isForgeOpen()) {
          this.closeForgeMenu();
        } else {
          if (this.isSettingsOpen()) this.closeSettingsMenu();
          this.openForgeMenu();
        }
        return { consume: true };
      }

      if (this.isSettingsOpen() || this.isForgeOpen()) {
        return undefined;
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

  public getSettingsItems(): SettingItem[] {
    const items: SettingItem[] = [
      {
        id: "preset",
        label: "[preset] Room Pacing Preset",
        currentValue: String(this.room.config.preset),
        values: ["manual", "chill", "lively", "banter", "chaos"],
        description:
          "Switch overall room pacing preset (manual | chill | lively | banter | chaos)",
      },
    ];

    for (const d of SIM_VARIABLE_DESCRIPTORS) {
      items.push({
        id: d.key,
        label: `[${d.category}] ${d.label}`,
        currentValue: String(this.room.config[d.key]),
        values: getVariableMenuValues(d),
        description: `${d.key}: ${d.description}`,
      });
    }
    return items;
  }

  public isSettingsOpen(): boolean {
    return this.settingsOverlay !== null && !this.settingsOverlay.isHidden();
  }

  public openSettingsMenu(): void {
    if (this.isSettingsOpen()) {
      return;
    }

    const applySettingChange = (id: string, newValue: string) => {
      const rawCmd =
        id === "preset"
          ? `/config preset ${newValue}`
          : `/config set ${id} ${newValue}`;
      if (this.wsUrl) {
        this.sendClientPacket({ type: "command", raw: rawCmd });
      } else {
        void handleSlashCommand(rawCmd, this.room, {
          senderNick: this.selfNick,
          isHost: this.isHost,
        }).then(() => {
          this.refreshSettingsMenuValues();
        });
      }
    };

    const items = this.getSettingsItems();
    const list = new SettingsList(
      items,
      14,
      settingsListTheme,
      applySettingChange,
      () => {
        this.closeSettingsMenu();
      },
      { enableSearch: false }
    );

    this.settingsModal = new SettingsModalComponent(
      () =>
        `⚙️ Simulation & Feature Control Center — ${this.room.channelName} [Preset: ${this.room.config.preset.toUpperCase()}]`,
      list,
      (direction) => {
        this.stepSelectedSetting(direction, applySettingChange);
      }
    );
    if (this.isStarted) {
      this.settingsOverlay = this.tui.showOverlay(this.settingsModal, {
        width: "85%",
        minWidth: 56,
        maxHeight: "85%",
        anchor: "center",
      });
    } else {
      let hidden = false;
      this.settingsOverlay = {
        hide: () => {
          hidden = true;
        },
        setHidden: (h: boolean) => {
          hidden = h;
        },
        isHidden: () => hidden,
        focus: () => {},
        unfocus: () => {},
        isFocused: () => !hidden,
      };
    }
    this.syncViews();
  }

  public stepSelectedSetting(
    direction: 1 | -1,
    onChange?: (id: string, newValue: string) => void
  ): boolean {
    if (!this.settingsModal) return false;
    const listAny = this.settingsModal.list as unknown as {
      items: SettingItem[];
      selectedIndex: number;
    };
    const item = listAny.items?.[listAny.selectedIndex];
    if (!item || !item.values || item.values.length === 0) return false;
    const len = item.values.length;
    const curIdx = item.values.indexOf(item.currentValue);
    const nextIdx =
      curIdx >= 0
        ? (curIdx + direction + len) % len
        : direction > 0
          ? 0
          : len - 1;
    const newValue = item.values[nextIdx]!;
    item.currentValue = newValue;
    if (onChange) {
      onChange(item.id, newValue);
    } else {
      const rawCmd =
        item.id === "preset"
          ? `/config preset ${newValue}`
          : `/config set ${item.id} ${newValue}`;
      void handleSlashCommand(rawCmd, this.room, {
        senderNick: this.selfNick,
        isHost: this.isHost,
      }).then(() => {
        this.refreshSettingsMenuValues();
      });
    }
    return true;
  }

  public closeSettingsMenu(): void {
    if (this.settingsOverlay) {
      this.settingsOverlay.hide();
      this.settingsOverlay = null;
      this.settingsModal = null;
    }
    this.tui.setFocus(this.editor);
    this.syncViews();
  }

  public getForgeItems(): SettingItem[] {
    const scenarios = this.room.getAllScenarios();
    const activePersonas = this.room.activePersonas;
    const allPersonas = this.room.registry.all();
    const items: SettingItem[] = [
      {
        id: "snapshot_room",
        label: "[Scenario] 📸 Snapshot Current Room",
        currentValue: "ready",
        values: ["ready", "save-snapshot"],
        description:
          "Capture active cast, vibe, and preset as a reusable custom scenario",
      },
      {
        id: "launch_scenario",
        label: "[Scenario] 🎬 Launch Scenario",
        currentValue: scenarios[0]?.id ?? "1972-arpanet",
        values: scenarios.map((s) => s.id),
        description: `Launch any built-in or custom showdown (${scenarios.length} available)`,
      },
      {
        id: "clone_persona",
        label: "[Forge] 🧬 Clone & Variant-Fork Persona",
        currentValue: "select",
        values: ["select", ...allPersonas.map((p) => p.id)],
        description:
          "Clone any catalog persona into a custom <id>-variant and summon it",
      },
    ];

    for (const p of activePersonas) {
      items.push({
        id: `talk:${p.id}`,
        label: `[Bot <${p.nick}>] 🔊 Talkativeness`,
        currentValue: String(p.talkativeness),
        values: ["0.2", "0.4", "0.55", "0.65", "0.75", "0.85", "0.95"],
        description: `Live-edit talkativeness weight for ${p.displayName} (${p.id})`,
      });
      items.push({
        id: `avatar:${p.id}`,
        label: `[Bot <${p.nick}>] 🎭 Avatar Badge`,
        currentValue: p.avatar,
        values: Array.from(
          new Set([p.avatar, "🤖", "🔥", "⚡", "🧠", "🎭", "👾", "🛸", "💎", "🌀"])
        ),
        description: `Live-edit avatar emoji for ${p.displayName} (${p.id})`,
      });
    }

    return items;
  }

  public isForgeOpen(): boolean {
    return this.forgeOverlay !== null && !this.forgeOverlay.isHidden();
  }

  public openForgeMenu(_initialTab?: "persona" | "scenario"): void {
    if (this.isForgeOpen()) {
      return;
    }

    const applyForgeAction = (id: string, newValue: string) => {
      let rawCmd: string | null = null;
      if (id === "snapshot_room" && newValue === "save-snapshot") {
        const cleanChan = this.room.channelName
          .replace(/^#/, "")
          .replace(/[^a-z0-9-]+/gi, "-")
          .toLowerCase();
        const snapId = `${cleanChan}-snap`;
        rawCmd = `/make-scenario snapshot ${snapId} 📸 ${this.room.channelName} Custom Showdown`;
      } else if (id === "launch_scenario") {
        rawCmd = `/scenario ${newValue}`;
      } else if (id === "clone_persona" && newValue !== "select") {
        rawCmd = `/forge clone ${newValue} ${newValue}-fork`;
      } else if (id.startsWith("talk:")) {
        const pid = id.slice("talk:".length);
        rawCmd = `/forge edit ${pid} talkativeness ${newValue}`;
      } else if (id.startsWith("avatar:")) {
        const pid = id.slice("avatar:".length);
        rawCmd = `/forge edit ${pid} avatar ${newValue}`;
      }

      if (!rawCmd) return;
      if (this.wsUrl) {
        this.sendClientPacket({ type: "command", raw: rawCmd });
      } else {
        void handleSlashCommand(rawCmd, this.room, {
          senderNick: this.selfNick,
          isHost: this.isHost,
        }).then(() => {
          this.syncViews();
        });
      }
    };

    const items = this.getForgeItems();
    const list = new SettingsList(
      items,
      12,
      settingsListTheme,
      applyForgeAction,
      () => {
        this.closeForgeMenu();
      },
      { enableSearch: false }
    );

    this.forgeModal = new SettingsModalComponent(
      () =>
        `🔨 Persona Forge & Scenario Builder Studio — ${this.room.channelName} (${this.room.registry.customPersonas().length} custom bots • ${this.room.registry.customScenarios().length} custom scenes)`,
      list,
      (direction) => {
        if (!this.forgeModal) return;
        const listAny = this.forgeModal.list as unknown as {
          items: SettingItem[];
          selectedIndex: number;
        };
        const item = listAny.items?.[listAny.selectedIndex];
        if (!item || !item.values || item.values.length === 0) return;
        const len = item.values.length;
        const curIdx = item.values.indexOf(item.currentValue);
        const nextIdx =
          curIdx >= 0
            ? (curIdx + direction + len) % len
            : direction > 0
              ? 0
              : len - 1;
        const newValue = item.values[nextIdx]!;
        item.currentValue = newValue;
        applyForgeAction(item.id, newValue);
      }
    );

    if (this.isStarted) {
      this.forgeOverlay = this.tui.showOverlay(this.forgeModal, {
        width: "85%",
        minWidth: 56,
        maxHeight: "85%",
        anchor: "center",
      });
    } else {
      let hidden = false;
      this.forgeOverlay = {
        hide: () => {
          hidden = true;
        },
        setHidden: (h: boolean) => {
          hidden = h;
        },
        isHidden: () => hidden,
        focus: () => {},
        unfocus: () => {},
        isFocused: () => !hidden,
      };
    }
    this.syncViews();
  }

  public closeForgeMenu(): void {
    if (this.forgeOverlay) {
      this.forgeOverlay.hide();
      this.forgeOverlay = null;
      this.forgeModal = null;
    }
    this.tui.setFocus(this.editor);
    this.syncViews();
  }

  private refreshSettingsMenuValues(): void {
    if (!this.settingsModal) return;
    this.settingsModal.list.updateValue(
      "preset",
      String(this.room.config.preset)
    );
    for (const d of SIM_VARIABLE_DESCRIPTORS) {
      this.settingsModal.list.updateValue(
        d.key,
        String(this.room.config[d.key])
      );
    }
  }

  private async processInput(text: string): Promise<void> {
    if (text === "/quit" || text === "/exit") {
      this.quit();
      return;
    }

    const cleanLower = text.trim().toLowerCase();
    if (
      cleanLower === "/settings" ||
      cleanLower === "/menu" ||
      cleanLower === "/options"
    ) {
      this.openSettingsMenu();
      return;
    }

    if (
      cleanLower === "/forge ui" ||
      cleanLower === "/persona ui" ||
      cleanLower === "/craft ui"
    ) {
      this.openForgeMenu("persona");
      return;
    }
    if (
      cleanLower === "/make-scenario ui" ||
      cleanLower === "/scenario ui"
    ) {
      this.openForgeMenu("scenario");
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
        onOpenSettings: () => this.openSettingsMenu(),
        onOpenForge: (tab) => this.openForgeMenu(tab),
      });
      return;
    }

    await this.room.postUserMessage(text, this.selfNick);
  }

  private syncViews(): void {
    this.refreshSettingsMenuValues();
    this.headerView.setText(
      renderIrcHeader(this.room, {
        selfNick: this.selfNick,
        locked: this.locked,
        shareUrl: this.shareUrl,
        localInviteUrl: this.localInviteUrl,
        maxHumans: this.maxHumans,
        spectatorCount: this.spectatorCount,
        arenaActive: this.arenaActive,
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
          `  ── [@${this.selfNick}]${scrollBadge}${typingBadge} Type a message or /command (Tab: autocomplete • Ctrl+O: settings • Ctrl+T: thoughts • Esc: shush) ──`
        )
      );
    }

    if (this.isStarted) {
      this.tui.requestRender();
    }
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
