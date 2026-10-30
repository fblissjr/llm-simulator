import * as fs from "node:fs";
import * as path from "node:path";
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
  HumanActivity,
  HumanPlayer,
  Persona,
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
  isSpectator?: boolean;
  activity?: HumanActivity;
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
    if (!options?.gemini) {
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
            players: hub.getActivePlayerCount(),
            spectators: hub.getSpectatorCount(),
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
          const isSpectator =
            url.searchParams.get("spectate") === "1" ||
            url.searchParams.get("spectate") === "true";
          const activePlayers = hub.getActivePlayerCount();
          if (!isSpectator && activePlayers >= hub.maxHumans) {
            return new Response(
              `403 Lobby Full — Maximum ${hub.maxHumans} human players (DOOM Co-op limit) reached. Append &spectate=1 to watch live in Spectator Mode!`,
              { status: 403 }
            );
          }

          const rawNick =
            url.searchParams.get("nick") ??
            (isSpectator ? "spectator" : "player");
          const nick = hub.allocateUniqueNick(rawNick);
          const rawChan = url.searchParams.get("channel") ?? "#latent-space";
          const channel = rawChan.startsWith("#") ? rawChan : `#${rawChan}`;
          const isHost =
            !isSpectator &&
            (url.searchParams.get("host") === "1" || activePlayers === 0);

          const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const upgraded = server.upgrade(req, {
            data: {
              clientId,
              nick,
              channel,
              isHost,
              isSpectator,
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

        if (url.pathname.startsWith("/media/")) {
          const safeFile = path.basename(url.pathname.slice(7));
          const mediaPath = path.resolve("./logs/media", safeFile);
          if (fs.existsSync(mediaPath)) {
            return new Response(Bun.file(mediaPath));
          }
          return new Response("Media not found", { status: 404 });
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
      room.stopAmbientLoop();
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
        onPadUpdate: (text, updatedBy) => {
          this.broadcastToChannel(channelName, {
            type: "pad:update",
            channel: channelName,
            text,
            updatedBy,
          });
        },
        onAmbientRoam: () => {
          this.roamBot(channelName);
        },
      },
    });

    this.rooms.set(channelName, room);
    return room;
  }

  public getActivePlayerCount(): number {
    let count = 0;
    for (const ws of this.clients.values()) {
      if (!ws.data.isSpectator) count += 1;
    }
    return count;
  }

  public getSpectatorCount(channelName?: string): number {
    let count = 0;
    for (const ws of this.clients.values()) {
      if (
        ws.data.isSpectator &&
        (!channelName || ws.data.channel === channelName)
      ) {
        count += 1;
      }
    }
    return count;
  }

  private getChannelHumans(channelName: string): HumanPlayer[] {
    const room = this.rooms.get(channelName);
    const typingSet = new Set(
      (room?.getTypingHumans() ?? []).map((n) => n.toLowerCase())
    );
    const list: HumanPlayer[] = [];
    for (const ws of this.clients.values()) {
      if (ws.data.channel === channelName && !ws.data.isSpectator) {
        const isTyping = typingSet.has(ws.data.nick.toLowerCase());
        const activity: HumanActivity = isTyping
          ? "typing"
          : room?.game?.active
            ? (ws.data.activity ?? "arena")
            : (ws.data.activity ?? "idle");
        list.push({
          nick: ws.data.nick,
          isHost: ws.data.isHost,
          channel: ws.data.channel,
          activity,
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
      spectatorCount: this.getSpectatorCount(room.channelName),
      activePersonas: room.activePersonas,
      personaBindings: this.gemini.getAllPersonaBindings(),
      personaMoods: room.personaMoods,
      config: room.config,
      lore: room.lore,
      sharedPad: room.sharedPad,
      arenaActive: Boolean(room.game?.active),
      scenarios: this.registry.allScenarios(),
      typingUsers: room.getTypingHumans(),
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
      spectatorCount: this.getSpectatorCount(channelName),
      activePersonas: room.activePersonas,
      personaBindings: this.gemini.getAllPersonaBindings(),
      personaMoods: room.personaMoods,
      config: room.config,
      lore: room.lore,
      sharedPad: room.sharedPad,
      arenaActive: Boolean(room.game?.active),
      typingUsers: room.getTypingHumans(),
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
      scenarios: this.registry.allScenarios(),
      selfNick: ws.data.nick,
      isHost: ws.data.isHost,
      isSpectator: ws.data.isSpectator,
    });

    if (ws.data.isSpectator) {
      this.sendNotice(
        ws,
        `👁️ Connected to ${room.channelName} in Read-Only Spectator Mode! You can watch live and switch channels with /channel #name.`
      );
      this.broadcastPresence(room.channelName);
      return;
    }

    const roleTag = ws.data.isHost ? "★ Room Host" : "Co-op Player";
    room.addSystemMessage(
      `👤 @${ws.data.nick} (${roleTag}) has connected to ${room.channelName} [${this.getActivePlayerCount()}/${this.maxHumans} Humans]`,
      "event"
    );
    this.broadcastPresence(room.channelName);
  }

  private handleClose(ws: ServerWebSocket<WsClientData>): void {
    const existed = this.clients.delete(ws.data.clientId);
    if (!existed) return;

    if (ws.data.isSpectator) {
      this.broadcastPresence(ws.data.channel);
      return;
    }

    // If the host disconnected and guests remain, promote the oldest connected player to host
    if (ws.data.isHost && this.getActivePlayerCount() > 0) {
      for (const candidate of this.clients.values()) {
        if (!candidate.data.isSpectator) {
          candidate.data.isHost = true;
          break;
        }
      }
    }

    const room = this.rooms.get(ws.data.channel);
    if (room) {
      this.syncChannelHumans(room.channelName);
      room.addSystemMessage(
        `👤 @${ws.data.nick} disconnected from ${room.channelName} [${this.getActivePlayerCount()}/${this.maxHumans} Humans]`,
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

    if (packet.type === "typing") {
      if (!ws.data.isSpectator) {
        ws.data.activity = packet.isTyping ? "typing" : "idle";
        room.markHumanTyping(ws.data.nick, Boolean(packet.isTyping));
      }
      return;
    }

    if (packet.type === "activity") {
      if (!ws.data.isSpectator) {
        ws.data.activity = packet.activity;
        this.syncChannelHumans(room.channelName);
        this.broadcastPresence(room.channelName);
      }
      return;
    }

    if (packet.type === "pad:edit") {
      if (ws.data.isSpectator) {
        this.sendNotice(
          ws,
          "👁️ Spectator Mode: Co-op Shared Scratchpad is read-only while spectating."
        );
        return;
      }
      ws.data.activity = "pad";
      room.updateSharedPad(packet.text ?? "", ws.data.nick);
      return;
    }

    if (packet.type === "react") {
      if (ws.data.isSpectator) {
        this.sendNotice(
          ws,
          "👁️ Spectator Mode: Reactions are disabled while watching in read-only mode."
        );
        return;
      }
      if (packet.messageId && packet.emoji) {
        room.toggleReaction(packet.emoji, ws.data.nick, packet.messageId);
      }
      return;
    }

    if (packet.type === "command") {
      if (ws.data.isSpectator) {
        const tokens = packet.raw.trim().split(/\s+/);
        const cmdVerb = tokens[0]?.toLowerCase() ?? "";
        const subArg = tokens[1]?.toLowerCase() ?? "";
        const allowedSpectatorCmds = new Set([
          "/channel",
          "/joinchan",
          "/c",
          "/switch",
          "/channels",
          "/list",
          "/roster",
          "/inspect",
          "/pins",
          "/halloffame",
          "/quotes",
          "/lore",
          "/relations",
          "/mood",
          "/moods",
          "/config",
          "/sim",
          "/settings",
          "/menu",
          "/options",
          "/forge",
          "/persona",
          "/craft",
          "/scenario",
          "/make-scenario",
          "/models",
          "/help",
          "/?",
          "/commands",
        ]);
        const isMutatingSub =
          (cmdVerb === "/lore" ||
            cmdVerb === "/relations" ||
            cmdVerb === "/mood" ||
            cmdVerb === "/moods" ||
            cmdVerb === "/config" ||
            cmdVerb === "/sim" ||
            cmdVerb === "/settings" ||
            cmdVerb === "/menu" ||
            cmdVerb === "/options" ||
            cmdVerb === "/forge" ||
            cmdVerb === "/persona" ||
            cmdVerb === "/craft" ||
            cmdVerb === "/scenario" ||
            cmdVerb === "/make-scenario") &&
          subArg.length > 0 &&
          ![
            "pacing",
            "director",
            "ambient",
            "emergent",
            "memory",
            "display",
            "all",
            "list",
          ].includes(subArg);

        if (!allowedSpectatorCmds.has(cmdVerb) || isMutatingSub) {
          this.sendNotice(
            ws,
            "👁️ Spectator Mode: You are watching in read-only mode (you can still run /channels, /channel #name, /roster, /pins, /lore, /mood, /settings, /forge, or /help)."
          );
          return;
        }
      }

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
        onRoamBot: (botQuery, toChannel) =>
          this.roamBot(ws.data.channel, botQuery, toChannel),
        onCatalogChanged: () => {
          for (const r of this.rooms.values()) {
            for (const p of this.registry.all()) {
              r.refreshActivePersona(p);
            }
          }
          this.broadcastAll({
            type: "catalog:update",
            catalog: this.registry.all(),
            scenarios: this.registry.allScenarios(),
          });
        },
      });
      return;
    }

    if (packet.type === "chat") {
      if (ws.data.isSpectator) {
        this.sendNotice(
          ws,
          "👁️ Spectator Mode: You are watching live in read-only mode."
        );
        return;
      }
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
    if (!ws.data.isSpectator) {
      oldRoom.addSystemMessage(
        `👤 @${ws.data.nick} switched to ${cleanChan}`,
        "event"
      );
    }
    this.broadcastPresence(oldChan);

    const newRoom = this.getOrCreateRoom(cleanChan);
    this.syncChannelHumans(cleanChan);
    this.sendPacket(ws, {
      type: "sync",
      state: this.buildChannelSnapshot(newRoom),
      catalog: this.registry.all(),
      scenarios: this.registry.allScenarios(),
      selfNick: ws.data.nick,
      isHost: ws.data.isHost,
      isSpectator: ws.data.isSpectator,
    });
    if (ws.data.isSpectator) {
      this.sendNotice(
        ws,
        `👁️ Switched Read-Only Spectator view to ${cleanChan}.`
      );
    } else {
      newRoom.addSystemMessage(
        `👤 @${ws.data.nick} joined ${cleanChan}`,
        "event"
      );
    }
    this.broadcastPresence(cleanChan);
  }

  /**
   * Cross-channel bot roaming: moves an active bot from `fromChannel` to `toChannelRaw`
   * (or another persistent channel) carrying a piece of episodic lore/gossip with them!
   */
  public roamBot(
    fromChannel: string,
    botQuery?: string,
    toChannelRaw?: string
  ): {
    ok: boolean;
    message: string;
    persona?: Persona;
    fromChannel: string;
    toChannel: string;
    gossip?: string;
  } {
    const sourceRoom = this.getOrCreateRoom(fromChannel);
    if (sourceRoom.activePersonas.length === 0) {
      return {
        ok: false,
        message: `No active models in ${sourceRoom.channelName} to roam! Summon someone first with /summon.`,
        fromChannel: sourceRoom.channelName,
        toChannel: sourceRoom.channelName,
      };
    }

    const q = (botQuery ?? "").trim().toLowerCase();
    const persona = q
      ? sourceRoom.activePersonas.find(
          (p) =>
            p.id.toLowerCase() === q ||
            p.nick.toLowerCase() === q ||
            p.id.toLowerCase().includes(q) ||
            p.nick.toLowerCase().includes(q)
        )
      : sourceRoom.activePersonas[sourceRoom.activePersonas.length - 1];

    if (!persona) {
      return {
        ok: false,
        message: `No active model matching "${botQuery}" in ${sourceRoom.channelName}.`,
        fromChannel: sourceRoom.channelName,
        toChannel: sourceRoom.channelName,
      };
    }

    let targetChan: string;
    if (toChannelRaw?.trim()) {
      const clean = toChannelRaw.trim();
      targetChan = clean.startsWith("#") ? clean : `#${clean}`;
    } else {
      const otherNames = [...this.rooms.keys()].filter(
        (n) => n.toLowerCase() !== sourceRoom.channelName.toLowerCase()
      );
      targetChan =
        otherNames[0] ??
        (sourceRoom.channelName === "#latent-space"
          ? "#roast-pit"
          : "#latent-space");
    }

    if (targetChan.toLowerCase() === sourceRoom.channelName.toLowerCase()) {
      return {
        ok: false,
        message: `<${persona.nick}> is already in ${sourceRoom.channelName}! Specify another channel (e.g. /roam ${persona.id} #roast-pit).`,
        fromChannel: sourceRoom.channelName,
        toChannel: targetChan,
      };
    }

    const destRoom = this.getOrCreateRoom(targetChan);

    // Extract a piece of gossip from sourceRoom (latest lore bullet or latest conversational message)
    const lastLore = sourceRoom.lore[sourceRoom.lore.length - 1];
    const lastConv = [...sourceRoom.messages]
      .reverse()
      .find(
        (m) => m.kind === "model" || m.kind === "user" || m.kind === "emote"
      );
    const gossip =
      lastLore ??
      (lastConv
        ? `<${lastConv.senderNick}> said: "${lastConv.text.slice(0, 90)}"`
        : `Vibe was [${sourceRoom.vibeKey.toUpperCase()}]`);

    // Remove from sourceRoom and join destRoom
    sourceRoom.leave(persona.id);
    sourceRoom.addSystemMessage(
      `🚶 ${persona.avatar} <${persona.nick}> wandered over to ${destRoom.channelName} carrying channel gossip!`,
      "event"
    );

    if (!destRoom.isPresent(persona.id)) {
      destRoom.join(persona);
    }
    const gossipLore = `🚶 Gossip from ${sourceRoom.channelName} (via <${persona.nick}>): ${gossip}`;
    destRoom.addLore(gossipLore);
    destRoom.queueWhisper(
      persona.id,
      `You just wandered over from ${sourceRoom.channelName} where: ${gossip}. Gossip about what happened in ${sourceRoom.channelName} on your next turn!`
    );
    destRoom.addSystemMessage(
      `🚶 ${persona.avatar} <${persona.nick}> wandered in from ${sourceRoom.channelName} with fresh gossip: "${gossip}"`,
      "event"
    );

    return {
      ok: true,
      message: `🚶 ${persona.avatar} <${persona.nick}> roamed from ${sourceRoom.channelName} -> ${destRoom.channelName} carrying gossip: "${gossip}"`,
      persona,
      fromChannel: sourceRoom.channelName,
      toChannel: destRoom.channelName,
      gossip,
    };
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
