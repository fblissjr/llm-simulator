import type { Server, ServerWebSocket } from "bun";
import { handleSlashCommand } from "../core/commands.ts";
import { formatTime, Room } from "../core/room.ts";
import { RoomDirector } from "../engine/director.ts";
import { GeminiEngine } from "../engine/gemini.ts";
import { PersonaRegistry } from "../personas/registry.ts";
import type {
  ChannelSnapshot,
  ChannelSummary,
  ChatMessage,
  ClientPacket,
  HumanPlayer,
  ServerPacket,
} from "../types.ts";
import { SimDatabase } from "./db.ts";
import { getLocalLanIp, TunnelManager } from "./tunnel.ts";
import { renderWebClientHtml } from "./web-client.ts";

export interface WsClientData {
  clientId: string;
  nick: string;
  channel: string;
  isHost: boolean;
  lastActionAt: number;
}

export const MAX_HUMANS = 4;

export class ChannelHub {
  public readonly db: SimDatabase;
  public readonly gemini: GeminiEngine;
  public readonly registry: PersonaRegistry;
  public readonly director: RoomDirector;
  public readonly tunnel = new TunnelManager();

  public passkey: string;
  public locked = false;
  public maxHumans: number;
  public guestCooldownMs: number;

  private rooms = new Map<string, Room>();
  private clients = new Map<string, ServerWebSocket<WsClientData>>();
  private server: Server<WsClientData> | null = null;
  private starterIds?: string[];

  constructor(options?: {
    dbPath?: string;
    passkey?: string;
    maxHumans?: number;
    guestCooldownMs?: number;
    starterIds?: string[];
    gemini?: GeminiEngine;
  }) {
    this.db = new SimDatabase(options?.dbPath);
    this.gemini = options?.gemini ?? new GeminiEngine();
    this.registry = new PersonaRegistry(undefined, this.db);
    this.director = new RoomDirector();
    this.passkey =
      options?.passkey ?? Math.random().toString(36).slice(2, 10);
    this.maxHumans = options?.maxHumans ?? MAX_HUMANS;
    this.guestCooldownMs = options?.guestCooldownMs ?? 2500;
    this.starterIds = options?.starterIds;

    // Ensure default channel exists
    this.getOrCreateRoom("#latent-space");
  }

  public get port(): number {
    return this.server?.port ?? 4321;
  }

  public get localInviteUrl(): string {
    const ip = getLocalLanIp();
    return `http://${ip}:${this.port}/?key=${this.passkey}`;
  }

  public start(port = 4321, hostname = "0.0.0.0"): number {
    if (this.server) {
      return this.server.port ?? port;
    }

    const hub = this;
    this.server = Bun.serve<WsClientData>({
      port,
      hostname,
      fetch(req, server) {
        const url = new URL(req.url);

        if (url.pathname === "/health") {
          return Response.json({
            ok: true,
            players: hub.clients.size,
            maxPlayers: hub.maxHumans,
          });
        }

        const key = url.searchParams.get("key") ?? "";
        if (key !== hub.passkey) {
          return new Response(
            "401 Unauthorized — Valid ?key= invite passkey required to join this 4-player lobby.",
            { status: 401 }
          );
        }

        if (url.pathname === "/ws") {
          if (hub.clients.size >= hub.maxHumans) {
            return new Response(
              `403 Lobby Full — Maximum ${hub.maxHumans} human players (DOOM Co-op limit) reached.`,
              { status: 403 }
            );
          }

          const rawNick = url.searchParams.get("nick") ?? "player";
          const nick = hub.allocateUniqueNick(rawNick);
          const rawChan = url.searchParams.get("channel") ?? "#latent-space";
          const channel = rawChan.startsWith("#") ? rawChan : `#${rawChan}`;
          const isHost =
            url.searchParams.get("host") === "1" || hub.clients.size === 0;

          const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const upgraded = server.upgrade(req, {
            data: {
              clientId,
              nick,
              channel,
              isHost,
              lastActionAt: 0,
            },
          });
          if (upgraded) return undefined;
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        if (url.pathname === "/" || url.pathname === "/index.html") {
          return new Response(renderWebClientHtml(), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        return new Response("Not Found", { status: 404 });
      },
      websocket: {
        open(ws) {
          hub.handleOpen(ws);
        },
        message(ws, message) {
          void hub.handleMessage(ws, String(message));
        },
        close(ws) {
          hub.handleClose(ws);
        },
      },
    });

    return this.server.port ?? port;
  }

  public stop(): void {
    this.tunnel.stop();
    for (const room of this.rooms.values()) {
      room.abortCurrentTurn();
    }
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }
    this.db.close();
  }

  private allocateUniqueNick(desired: string, excludeClientId?: string): string {
    const base =
      desired
        .trim()
        .replace(/^@/, "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 16) || "player";

    const taken = new Set<string>();
    for (const [id, ws] of this.clients.entries()) {
      if (id !== excludeClientId) {
        taken.add(ws.data.nick.toLowerCase());
      }
    }

    if (!taken.has(base.toLowerCase())) {
      return base;
    }
    let suffix = 2;
    while (taken.has(`${base}${suffix}`.toLowerCase())) {
      suffix += 1;
    }
    return `${base}${suffix}`;
  }

  public getOrCreateRoom(rawName: string): Room {
    const channelName = rawName.startsWith("#") ? rawName : `#${rawName}`;
    const existing = this.rooms.get(channelName);
    if (existing) return existing;

    const room = new Room({
      channelName,
      registry: this.registry,
      gemini: this.gemini,
      director: this.director,
      db: this.db,
      starterIds: this.starterIds,
      callbacks: {
        onMessageUpsert: (msg) => {
          this.broadcastToChannel(channelName, {
            type: "message:upsert",
            channel: channelName,
            message: msg,
          });
        },
        onMessageClear: () => {
          this.broadcastToChannel(channelName, {
            type: "message:clear",
            channel: channelName,
          });
        },
        onPresenceChange: () => {
          this.syncChannelHumans(channelName);
          this.broadcastPresence(channelName);
        },
        onStatusChange: (statusText) => {
          this.broadcastToChannel(channelName, {
            type: "status",
            channel: channelName,
            statusText,
          });
        },
      },
    });

    this.rooms.set(channelName, room);
    return room;
  }

  private getChannelHumans(channelName: string): HumanPlayer[] {
    const list: HumanPlayer[] = [];
    for (const ws of this.clients.values()) {
      if (ws.data.channel === channelName) {
        list.push({
          nick: ws.data.nick,
          isHost: ws.data.isHost,
          channel: ws.data.channel,
        });
      }
    }
    return list;
  }

  private syncChannelHumans(channelName: string): void {
    const room = this.rooms.get(channelName);
    if (room) {
      room.humans = this.getChannelHumans(channelName);
    }
  }

  public buildChannelSnapshot(room: Room): ChannelSnapshot {
    this.syncChannelHumans(room.channelName);
    return {
      channelName: room.channelName,
      vibeKey: room.vibeKey,
      vibe: room.vibe,
      activeProvider: this.gemini.activeProvider,
      engineModel: this.gemini.activeModel,
      apiOnline: this.gemini.isConfigured(),
      locked: this.locked,
      shareUrl: this.tunnel.publicUrl,
      localInviteUrl: this.localInviteUrl,
      humans: room.humans,
      maxHumans: this.maxHumans,
      activePersonas: room.activePersonas,
      personaBindings: this.gemini.getAllPersonaBindings(),
      messages: room.messages.slice(-80),
      statusText: room.statusText,
    };
  }

  private sendPacket(
    ws: ServerWebSocket<WsClientData>,
    packet: ServerPacket
  ): void {
    try {
      ws.send(JSON.stringify(packet));
    } catch {
      // Ignore closed socket
    }
  }

  private sendNotice(ws: ServerWebSocket<WsClientData>, text: string): void {
    const noticeMsg: ChatMessage = {
      id: `notice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: formatTime(),
      kind: "system",
      senderId: "system",
      senderNick: "SYS",
      text,
    };
    this.sendPacket(ws, { type: "notice", message: noticeMsg });
  }

  private broadcastToChannel(channelName: string, packet: ServerPacket): void {
    const payload = JSON.stringify(packet);
    for (const ws of this.clients.values()) {
      if (ws.data.channel === channelName) {
        try {
          ws.send(payload);
        } catch {
          // Ignore
        }
      }
    }
  }

  private broadcastAll(packet: ServerPacket): void {
    const payload = JSON.stringify(packet);
    for (const ws of this.clients.values()) {
      try {
        ws.send(payload);
      } catch {
        // Ignore
      }
    }
  }

  private broadcastPresence(channelName: string): void {
    const room = this.getOrCreateRoom(channelName);
    this.syncChannelHumans(channelName);
    this.broadcastToChannel(channelName, {
      type: "presence",
      channel: channelName,
      humans: room.humans,
      activePersonas: room.activePersonas,
      personaBindings: this.gemini.getAllPersonaBindings(),
      vibeKey: room.vibeKey,
      vibe: room.vibe,
      activeProvider: this.gemini.activeProvider,
      engineModel: this.gemini.activeModel,
      apiOnline: this.gemini.isConfigured(),
      locked: this.locked,
      shareUrl: this.tunnel.publicUrl,
      localInviteUrl: this.localInviteUrl,
    });
  }

  private handleOpen(ws: ServerWebSocket<WsClientData>): void {
    this.clients.set(ws.data.clientId, ws);
    const room = this.getOrCreateRoom(ws.data.channel);
    this.syncChannelHumans(room.channelName);

    this.sendPacket(ws, {
      type: "sync",
      state: this.buildChannelSnapshot(room),
      catalog: this.registry.all(),
      selfNick: ws.data.nick,
      isHost: ws.data.isHost,
    });

    const roleTag = ws.data.isHost ? "★ Room Host" : "Co-op Player";
    room.addSystemMessage(
      `👤 @${ws.data.nick} (${roleTag}) has connected to ${room.channelName} [${this.clients.size}/${this.maxHumans} Humans]`,
      "event"
    );
    this.broadcastPresence(room.channelName);
  }

  private handleClose(ws: ServerWebSocket<WsClientData>): void {
    const existed = this.clients.delete(ws.data.clientId);
    if (!existed) return;

    // If the host disconnected and guests remain, promote the oldest connected player to host
    if (ws.data.isHost && this.clients.size > 0) {
      const nextHost = this.clients.values().next().value;
      if (nextHost) {
        nextHost.data.isHost = true;
      }
    }

    const room = this.rooms.get(ws.data.channel);
    if (room) {
      this.syncChannelHumans(room.channelName);
      room.addSystemMessage(
        `👤 @${ws.data.nick} disconnected from ${room.channelName} [${this.clients.size}/${this.maxHumans} Humans]`,
        "event"
      );
      this.broadcastPresence(room.channelName);
    }
  }

  private async handleMessage(
    ws: ServerWebSocket<WsClientData>,
    raw: string
  ): Promise<void> {
    let packet: ClientPacket;
    try {
      packet = JSON.parse(raw) as ClientPacket;
    } catch {
      return;
    }

    const room = this.getOrCreateRoom(ws.data.channel);

    if (packet.type === "hello") {
      if (packet.nick) {
        this.changeClientNick(ws, packet.nick);
      }
      if (packet.channel && packet.channel !== ws.data.channel) {
        this.switchClientChannel(ws, packet.channel);
      }
      return;
    }

    if (packet.type === "command") {
      await handleSlashCommand(packet.raw, room, {
        senderNick: ws.data.nick,
        isHost: ws.data.isHost,
        locked: this.locked,
        notifyCaller: (text) => this.sendNotice(ws, text),
        onChangeNick: (newNick) => this.changeClientNick(ws, newNick),
        onSwitchChannel: (newChan) => this.switchClientChannel(ws, newChan),
        onListChannels: () => this.sendChannelList(ws),
        onShare: () => this.handleShare(ws),
        onUnshare: () => this.handleUnshare(ws),
        onSetLocked: (locked) => this.handleSetLocked(ws, locked),
        onKickPlayer: (targetNick) => this.handleKickPlayer(ws, targetNick),
        onCatalogChanged: () =>
          this.broadcastAll({
            type: "catalog:update",
            catalog: this.registry.all(),
          }),
      });
      return;
    }

    if (packet.type === "chat") {
      const text = packet.text.trim();
      if (!text) return;

      // Guest cooldown check to protect host API budget
      const now = Date.now();
      if (
        !ws.data.isHost &&
        this.guestCooldownMs > 0 &&
        now - ws.data.lastActionAt < this.guestCooldownMs
      ) {
        const waitSec = (
          (this.guestCooldownMs - (now - ws.data.lastActionAt)) /
          1000
        ).toFixed(1);
        this.sendNotice(
          ws,
          `⏳ Cooldown: Please wait ${waitSec}s before sending another message.`
        );
        return;
      }
      ws.data.lastActionAt = now;

      await room.postUserMessage(text, ws.data.nick);
    }
  }

  private changeClientNick(
    ws: ServerWebSocket<WsClientData>,
    desiredNick: string
  ): void {
    const oldNick = ws.data.nick;
    const newNick = this.allocateUniqueNick(desiredNick, ws.data.clientId);
    if (oldNick === newNick) return;

    ws.data.nick = newNick;
    this.sendPacket(ws, { type: "nick:ack", nick: newNick });

    const room = this.getOrCreateRoom(ws.data.channel);
    this.syncChannelHumans(room.channelName);
    room.addSystemMessage(
      `👤 @${oldNick} is now known as @${newNick}`,
      "event"
    );
    this.broadcastPresence(room.channelName);
  }

  private switchClientChannel(
    ws: ServerWebSocket<WsClientData>,
    targetChan: string
  ): void {
    const cleanChan = targetChan.startsWith("#") ? targetChan : `#${targetChan}`;
    const oldChan = ws.data.channel;
    if (oldChan === cleanChan) {
      this.sendNotice(ws, `You are already in ${cleanChan}.`);
      return;
    }

    const oldRoom = this.getOrCreateRoom(oldChan);
    ws.data.channel = cleanChan;
    this.syncChannelHumans(oldChan);
    oldRoom.addSystemMessage(
      `👤 @${ws.data.nick} switched to ${cleanChan}`,
      "event"
    );
    this.broadcastPresence(oldChan);

    const newRoom = this.getOrCreateRoom(cleanChan);
    this.syncChannelHumans(cleanChan);
    this.sendPacket(ws, {
      type: "sync",
      state: this.buildChannelSnapshot(newRoom),
      catalog: this.registry.all(),
      selfNick: ws.data.nick,
      isHost: ws.data.isHost,
    });
    newRoom.addSystemMessage(
      `👤 @${ws.data.nick} joined ${cleanChan}`,
      "event"
    );
    this.broadcastPresence(cleanChan);
  }

  public getChannelSummaries(): ChannelSummary[] {
    const dbRows = this.db.listChannelRows();
    const names = new Set<string>([
      "#latent-space",
      ...dbRows.map((r) => r.name),
      ...this.rooms.keys(),
    ]);

    const summaries: ChannelSummary[] = [];
    for (const name of names) {
      const room = this.rooms.get(name);
      const botIds = room
        ? room.activePersonas.map((p) => p.nick)
        : this.db.getChannelBotIds(name);
      const vibeRow = this.db.getChannel(name);
      summaries.push({
        channelName: name,
        vibeKey: room?.vibeKey ?? vibeRow?.vibe_key ?? "chat",
        vibe: room?.vibe ?? vibeRow?.vibe ?? "",
        humanCount: this.getChannelHumans(name).length,
        botNicks: botIds,
        messageCount: this.db.getMessageCount(name),
      });
    }
    return summaries;
  }

  private sendChannelList(ws: ServerWebSocket<WsClientData>): void {
    const summaries = this.getChannelSummaries();
    const lines = ["═══ Persistent Channels on Server ═══"];
    for (const s of summaries) {
      const activeMarker = s.channelName === ws.data.channel ? "● [CURRENT]" : "○";
      lines.push(
        `  ${activeMarker} ${s.channelName.padEnd(16)} │ Humans: ${s.humanCount}/${this.maxHumans} │ Bots (${s.botNicks.length}): ${s.botNicks.join(", ") || "None"} │ Messages: ${s.messageCount} │ Vibe: ${s.vibeKey.toUpperCase()}`
      );
    }
    lines.push("\nTip: Switch or create any channel with /channel #name");
    this.sendNotice(ws, lines.join("\n"));
  }

  private async handleShare(ws: ServerWebSocket<WsClientData>): Promise<void> {
    this.sendNotice(
      ws,
      "🌐 Starting 4-Player Co-op Invite link (checking local LAN & cloudflared tunnel)..."
    );
    const res = await this.tunnel.start(this.port, this.passkey);
    const lines = [
      `🎮 4-Player DOOM Co-op Lobby Active [${this.clients.size}/${this.maxHumans} Humans • ∞ AIs]`,
      `  • Local Wi-Fi / Tailscale Browser Link: ${res.localUrl}`,
      `  • Terminal CLI Join Command: bun run connect ws://${getLocalLanIp()}:${this.port}/ws?key=${this.passkey} --nick friend`,
    ];
    if (res.url) {
      lines.unshift(`  • 🌍 Public Zero-Install Browser Link: ${res.url}`);
    }
    if (res.note) {
      lines.push(`  • Note: ${res.note}`);
    }
    lines.push(
      "  • Non-technical friends can simply open the link in any browser (no installs or API key needed!). Use /lock, /kickplayer, or /unshare anytime."
    );
    this.sendNotice(ws, lines.join("\n"));
    this.broadcastPresence(ws.data.channel);
  }

  private handleUnshare(ws: ServerWebSocket<WsClientData>): void {
    this.tunnel.stop();
    this.sendNotice(ws, "🛑 Closed public tunnel.");
    this.broadcastPresence(ws.data.channel);
  }

  private handleSetLocked(
    ws: ServerWebSocket<WsClientData>,
    locked: boolean
  ): void {
    this.locked = locked;
    const room = this.getOrCreateRoom(ws.data.channel);
    room.addSystemMessage(
      locked
        ? `🔒 Room Host (@${ws.data.nick}) locked roster & vibe controls to Host-only (guests can still chat!).`
        : `🔓 Room Host (@${ws.data.nick}) unlocked roster & vibe controls for all players!`,
      "event"
    );
    this.broadcastPresence(ws.data.channel);
  }

  private handleKickPlayer(
    ws: ServerWebSocket<WsClientData>,
    targetNick: string
  ): void {
    const clean = targetNick.toLowerCase().replace(/^@/, "");
    let targetWs: ServerWebSocket<WsClientData> | undefined;
    for (const client of this.clients.values()) {
      if (
        client.data.clientId !== ws.data.clientId &&
        client.data.nick.toLowerCase() === clean
      ) {
        targetWs = client;
        break;
      }
    }

    if (!targetWs) {
      this.sendNotice(ws, `No connected guest found with nick "@${targetNick}".`);
      return;
    }

    const kickedNick = targetWs.data.nick;
    const chan = targetWs.data.channel;
    this.sendPacket(targetWs, {
      type: "kicked",
      reason: `Kicked from lobby by Host (@${ws.data.nick}).`,
    });
    targetWs.close(4001, "Kicked by Host");
    this.clients.delete(targetWs.data.clientId);

    const room = this.getOrCreateRoom(chan);
    this.syncChannelHumans(chan);
    room.addSystemMessage(
      `👢 Guest @${kickedNick} was kicked from the lobby by Host @${ws.data.nick}.`,
      "event"
    );
    this.broadcastPresence(chan);
  }
}
