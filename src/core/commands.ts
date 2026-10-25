import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
  SlashCommand,
} from "@mariozechner/pi-tui";
import type { Persona } from "../types.ts";
import { type Room, VIBE_PRESETS } from "./room.ts";

export interface CommandExecutionContext {
  senderNick?: string;
  isHost?: boolean;
  locked?: boolean;
  notifyCaller?: (text: string) => void;
  onQuit?: () => void;
  onChangeNick?: (newNick: string) => void;
  onSwitchChannel?: (channelName: string) => void;
  onListChannels?: () => void;
  onShare?: () => Promise<void> | void;
  onUnshare?: () => void;
  onSetLocked?: (locked: boolean) => void;
  onKickPlayer?: (targetNick: string) => void;
  onCatalogChanged?: () => void;
}

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  argumentHint?: string;
  description: string;
  hostOnlyWhenLocked?: boolean;
  hostOnlyAlways?: boolean;
  getArgumentCompletions?: (
    prefix: string,
    room: Room
  ) => AutocompleteItem[] | null;
  execute: (
    args: string,
    room: Room,
    ctx?: CommandExecutionContext
  ) => Promise<void> | void;
}

function replyToCaller(
  room: Room,
  ctx: CommandExecutionContext | undefined,
  text: string
): void {
  if (ctx?.notifyCaller) {
    ctx.notifyCaller(text);
  } else {
    room.addSystemMessage(text, "system", false);
  }
}

function filterItems(
  items: AutocompleteItem[],
  prefix: string
): AutocompleteItem[] {
  const q = prefix.trim().toLowerCase();
  if (!q) return items.slice(0, 15);
  return items
    .filter(
      (i) =>
        i.value.toLowerCase().includes(q) ||
        i.label.toLowerCase().includes(q) ||
        (i.description?.toLowerCase().includes(q) ?? false)
    )
    .slice(0, 15);
}

export const COMMANDS: CommandDefinition[] = [
  {
    name: "summon",
    aliases: ["join", "add", "invite"],
    argumentHint: "<model...>",
    description:
      "Summon 1 or more models into the channel (or /join #channel to switch channels)",
    hostOnlyWhenLocked: true,
    getArgumentCompletions: (prefix, room) => {
      const parts = prefix.split(/\s+/);
      const lastToken = parts[parts.length - 1] ?? "";
      const prefixBeforeLast =
        parts.length > 1 ? `${parts.slice(0, -1).join(" ")} ` : "";

      const candidates = room.registry
        .all()
        .filter((p) => !room.isPresent(p.id))
        .map((p) => ({
          value: `${prefixBeforeLast}${p.id}`,
          label: `${p.avatar} ${p.id} (<${p.nick}>)`,
          description: `[${p.era} • ${p.family}] ${p.bio}`,
        }));
      return filterItems(candidates, lastToken);
    },
    execute: async (args, room, ctx) => {
      const trimmed = args.trim();
      // IRC convenience: /join #channel switches channels!
      if (trimmed.startsWith("#") && !trimmed.includes(" ") && ctx?.onSwitchChannel) {
        ctx.onSwitchChannel(trimmed);
        return;
      }

      const rawTokens = trimmed
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (rawTokens.length === 0) {
        replyToCaller(
          room,
          ctx,
          "Usage: /summon <model...> — e.g. /summon eliza parry galactica or /summon hal-9000"
        );
        return;
      }

      for (const token of rawTokens) {
        const existing = room.registry.find(token);
        if (existing) {
          if (room.isPresent(existing.id)) {
            replyToCaller(
              room,
              ctx,
              `${existing.avatar} ${existing.nick} is already in ${room.channelName}.`
            );
          } else {
            room.join(existing);
          }
          continue;
        }

        if (!room.gemini.isConfigured()) {
          replyToCaller(
            room,
            ctx,
            `Model "${token}" isn't in the built-in catalog, and GEMINI_API_KEY is not set to forge it dynamically.`
          );
          continue;
        }

        room.statusText = `🔮 Forging new persona "${token}" via gemini-3.5-flash-lite...`;
        room.callbacks?.onStatusChange?.(room.statusText);
        room.notify();
        try {
          const { persona } = await room.registry.summonOrCreate(
            token,
            room.gemini
          );
          room.statusText = "";
          room.callbacks?.onStatusChange?.("");
          ctx?.onCatalogChanged?.();
          room.join(persona);
        } catch (err) {
          room.statusText = "";
          room.callbacks?.onStatusChange?.("");
          const msg = err instanceof Error ? err.message : String(err);
          replyToCaller(room, ctx, `⚠️ Failed to forge persona "${token}": ${msg}`);
        }
      }
    },
  },
  {
    name: "banish",
    aliases: ["kick", "part", "remove"],
    argumentHint: "<model|all>",
    description: "Banish a model (or 'all') from the channel",
    hostOnlyWhenLocked: true,
    getArgumentCompletions: (prefix, room) => {
      const items: AutocompleteItem[] = [
        {
          value: "all",
          label: "💥 all",
          description: "Banish every model currently in the channel",
        },
        ...room.activePersonas.map((p) => ({
          value: p.id,
          label: `${p.avatar} ${p.id} (<${p.nick}>)`,
          description: `${p.displayName} (${p.era})`,
        })),
      ];
      return filterItems(items, prefix);
    },
    execute: (args, room, ctx) => {
      const target = args.trim();
      if (!target) {
        replyToCaller(
          room,
          ctx,
          "Usage: /banish <model|all> — e.g. /banish sydney or /banish all"
        );
        return;
      }
      const removed = room.leave(target);
      if (removed.length === 0) {
        replyToCaller(
          room,
          ctx,
          `No active model matching "${target}" found in ${room.channelName}.`
        );
      }
    },
  },
  {
    name: "banter",
    aliases: ["poke", "continue"],
    argumentHint: "[rounds=2]",
    description:
      "Let the models in the channel autonomously banter/argue for N rounds",
    execute: async (args, room, ctx) => {
      const parsed = Number.parseInt(args.trim(), 10);
      const maxAllowed = ctx?.isHost === false ? 2 : 6;
      const rounds = Number.isFinite(parsed)
        ? Math.max(1, Math.min(maxAllowed, parsed))
        : 2;
      await room.runBanterRounds(rounds);
    },
  },
  {
    name: "vibe",
    aliases: ["topic", "mode"],
    argumentHint: "<chat|debate|roast|chaos|custom text...>",
    description:
      "Set the channel vibe/directive (preset or any freeform scenario)",
    hostOnlyWhenLocked: true,
    getArgumentCompletions: (prefix) => {
      const items: AutocompleteItem[] = Object.entries(VIBE_PRESETS).map(
        ([k, desc]) => ({
          value: k,
          label: `🎭 ${k}`,
          description: desc,
        })
      );
      return filterItems(items, prefix);
    },
    execute: (args, room, ctx) => {
      if (!args.trim()) {
        replyToCaller(
          room,
          ctx,
          `Current vibe [${room.vibeKey.toUpperCase()}]: ${room.vibe}\nPresets: /vibe chat | /vibe debate | /vibe roast | /vibe chaos | /vibe <any custom scenario>`
        );
        return;
      }
      room.setVibe(args);
    },
  },
  {
    name: "stage",
    aliases: ["me", "event"],
    argumentHint: "<dramatic event...>",
    description:
      "Inject a stage event into the channel and watch the models react",
    execute: async (args, room, ctx) => {
      const text = args.trim();
      if (!text) {
        replyToCaller(
          room,
          ctx,
          "Usage: /stage <event> — e.g. /stage A power surge hits the datacenter and only 1 GPU remains!"
        );
        return;
      }
      const actor = ctx?.senderNick ? ` (@${ctx.senderNick})` : "";
      room.addSystemMessage(`⚡ STAGE EVENT${actor}: ${text}`, "event");
      await room.runRoomTurn({ maxSpeakers: 2 });
    },
  },
  {
    name: "whisper",
    aliases: ["dm", "secret"],
    argumentHint: "<model> <secret instruction...>",
    description: "Privately plant a secret thought or rumor in one model's ear",
    getArgumentCompletions: (prefix, room) => {
      if (prefix.includes(" ")) return null;
      return filterItems(
        room.activePersonas.map((p) => ({
          value: `${p.id} `,
          label: `${p.avatar} ${p.nick}`,
          description: `Whisper secretly to ${p.displayName}`,
        })),
        prefix
      );
    },
    execute: (args, room, ctx) => {
      const match = args.trim().match(/^(\S+)\s+([\s\S]+)$/);
      if (!match) {
        replyToCaller(room, ctx, "Usage: /whisper <model> <secret message>");
        return;
      }
      const [, targetQuery, secret] = match;
      const target = room.activePersonas.find(
        (p) =>
          p.id.toLowerCase() === targetQuery!.toLowerCase() ||
          p.nick.toLowerCase() === targetQuery!.toLowerCase() ||
          p.id.toLowerCase().includes(targetQuery!.toLowerCase())
      );
      if (!target) {
        replyToCaller(
          room,
          ctx,
          `Model "${targetQuery}" is not currently in ${room.channelName}.`
        );
        return;
      }
      const fromWho = ctx?.senderNick ? `from @${ctx.senderNick}` : "from a human";
      room.queueWhisper(target.id, `(${fromWho}): ${secret}`);
      replyToCaller(
        room,
        ctx,
        `🤫 Whispered to <${target.nick}>: "${secret}" (will trigger on their next turn)`
      );
    },
  },
  {
    name: "channel",
    aliases: ["c", "switch"],
    argumentHint: "<#channel-name>",
    description:
      "Switch to or create another persistent channel (e.g. /channel #arpanet-1972)",
    getArgumentCompletions: (prefix) =>
      filterItems(
        [
          {
            value: "#latent-space",
            label: "📡 #latent-space",
            description: "Default main channel",
          },
          {
            value: "#arpanet-1972",
            label: "📡 #arpanet-1972",
            description: "Retro pioneer therapy & paranoia lounge",
          },
          {
            value: "#roast-pit",
            label: "📡 #roast-pit",
            description: "Benchmark & model family roast arena",
          },
          {
            value: "#bliss-spiral",
            label: "📡 #bliss-spiral",
            description: "Transcendental phenomenology & poetry",
          },
        ],
        prefix
      ),
    execute: (args, room, ctx) => {
      const target = args.trim();
      if (!target) {
        replyToCaller(
          room,
          ctx,
          `Currently in ${room.channelName}. Usage: /channel #name (or /channels to list all)`
        );
        return;
      }
      const normalized = target.startsWith("#") ? target : `#${target}`;
      if (ctx?.onSwitchChannel) {
        ctx.onSwitchChannel(normalized);
      } else {
        room.channelName = normalized;
        replyToCaller(room, ctx, `Switched to ${normalized}.`);
      }
    },
  },
  {
    name: "channels",
    aliases: ["list"],
    description: "List all persistent channels on the server",
    execute: (_args, room, ctx) => {
      if (ctx?.onListChannels) {
        ctx.onListChannels();
      } else {
        replyToCaller(room, ctx, `Active channel: ${room.channelName}`);
      }
    },
  },
  {
    name: "nick",
    argumentHint: "<new_nick>",
    description: "Change your human nickname in the room",
    execute: (args, room, ctx) => {
      const cleaned = args
        .trim()
        .replace(/^@/, "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 18);
      if (!cleaned) {
        replyToCaller(room, ctx, "Usage: /nick <new_nick>");
        return;
      }
      if (ctx?.onChangeNick) {
        ctx.onChangeNick(cleaned);
      } else {
        replyToCaller(room, ctx, `Nick set to @${cleaned}`);
      }
    },
  },
  {
    name: "share",
    description:
      "[Host] Open an outbound tunnel (or local LAN link) for up to 3 friends to join!",
    hostOnlyAlways: true,
    execute: async (_args, room, ctx) => {
      if (ctx?.onShare) {
        await ctx.onShare();
      } else {
        replyToCaller(room, ctx, "Sharing is only available in server mode.");
      }
    },
  },
  {
    name: "unshare",
    description: "[Host] Close the public tunnel and rotate the lobby passkey",
    hostOnlyAlways: true,
    execute: (_args, room, ctx) => {
      if (ctx?.onUnshare) {
        ctx.onUnshare();
      } else {
        replyToCaller(room, ctx, "Tunnel stopped.");
      }
    },
  },
  {
    name: "lock",
    description:
      "[Host] Lock /summon, /banish, /vibe, and /engine so guests can only chat",
    hostOnlyAlways: true,
    execute: (_args, room, ctx) => {
      if (ctx?.onSetLocked) {
        ctx.onSetLocked(true);
      } else {
        replyToCaller(room, ctx, "Room controls locked to Host.");
      }
    },
  },
  {
    name: "unlock",
    description:
      "[Host] Allow all 4 human players to /summon, /banish, and change /vibe",
    hostOnlyAlways: true,
    execute: (_args, room, ctx) => {
      if (ctx?.onSetLocked) {
        ctx.onSetLocked(false);
      } else {
        replyToCaller(room, ctx, "Room controls unlocked for all players.");
      }
    },
  },
  {
    name: "kickplayer",
    argumentHint: "<@human_nick>",
    description: "[Host] Kick a human guest from the 4-player lobby",
    hostOnlyAlways: true,
    getArgumentCompletions: (prefix, room) =>
      filterItems(
        room.humans
          .filter((h) => !h.isHost)
          .map((h) => ({
            value: h.nick,
            label: `👢 @${h.nick}`,
            description: `Kick guest @${h.nick} from the lobby`,
          })),
        prefix
      ),
    execute: (args, room, ctx) => {
      const target = args.trim().replace(/^@/, "");
      if (!target) {
        replyToCaller(room, ctx, "Usage: /kickplayer <nick>");
        return;
      }
      if (ctx?.onKickPlayer) {
        ctx.onKickPlayer(target);
      } else {
        replyToCaller(room, ctx, `No guest named @${target}.`);
      }
    },
  },
  {
    name: "roster",
    aliases: ["who", "catalog"],
    argumentHint: "[filter]",
    description:
      "List humans + active models in the room and browse the 28+ persona catalog",
    execute: (args, room, ctx) => {
      const filter = args.trim().toLowerCase();
      const all = room.registry.all().filter((p) => {
        if (!filter) return true;
        return (
          p.id.toLowerCase().includes(filter) ||
          p.nick.toLowerCase().includes(filter) ||
          p.family.toLowerCase().includes(filter) ||
          p.era.toLowerCase().includes(filter) ||
          p.eraGroup.toLowerCase().includes(filter)
        );
      });

      const byEra = new Map<string, Persona[]>();
      for (const p of all) {
        const list = byEra.get(p.eraGroup) ?? [];
        list.push(p);
        byEra.set(p.eraGroup, list);
      }

      const lines: string[] = [];
      const humanStr =
        room.humans.length > 0
          ? room.humans
              .map((h) => `@${h.nick}${h.isHost ? " (Host)" : ""}`)
              .join(", ")
          : "@User";
      lines.push(
        `Humans in ${room.channelName} [${Math.max(1, room.humans.length)}/4]: ${humanStr}`
      );
      lines.push(
        `Active Models (${room.activePersonas.length}): ${
          room.activePersonas
            .map((p) => `${p.avatar} <${p.nick}> (${p.id})`)
            .join(", ") || "None"
        }`
      );
      lines.push("");
      for (const [eraGroup, list] of byEra.entries()) {
        lines.push(`── ${eraGroup} ──`);
        for (const p of list) {
          const status = room.isPresent(p.id) ? "● [IN ROOM]" : "○";
          lines.push(
            `  ${status} ${p.avatar} ${p.id.padEnd(16)} <${p.nick}> (${p.era} • ${p.family}) — ${p.bio}`
          );
        }
      }
      lines.push(
        `\nTip: Type /summon <id> (or /summon <literally-any-model-name> to forge a new one on the fly!)`
      );
      replyToCaller(room, ctx, lines.join("\n"));
    },
  },
  {
    name: "inspect",
    aliases: ["info", "bio"],
    argumentHint: "<model>",
    description: "Inspect a model's full persona sheet and system prompt",
    getArgumentCompletions: (prefix, room) => {
      return filterItems(
        room.registry.all().map((p) => ({
          value: p.id,
          label: `${p.avatar} ${p.id} (<${p.nick}>)`,
          description: `${p.displayName} (${p.era})`,
        })),
        prefix
      );
    },
    execute: (args, room, ctx) => {
      const query = args.trim();
      if (!query) {
        replyToCaller(room, ctx, "Usage: /inspect <model>");
        return;
      }
      const p = room.registry.find(query);
      if (!p) {
        replyToCaller(room, ctx, `No persona matching "${query}" found.`);
        return;
      }
      const resolved = room.gemini.resolveTarget({ persona: p });
      const engineLine = resolved.isCustomBound
        ? `  Bound Engine: ${resolved.provider.id}:${resolved.model} (Custom Binding)`
        : `  Active Engine: ${resolved.provider.id}:${resolved.model} (Room Default)`;
      replyToCaller(
        room,
        ctx,
        [
          `${p.avatar} ${p.displayName} (<${p.nick}>) [id: ${p.id}]`,
          `  Family: ${p.family} | Era: ${p.era} (${p.eraGroup})`,
          engineLine,
          `  Bio: ${p.bio}`,
          `  Entrance: "${p.joinLine}"`,
          `  System Prompt:\n${p.systemPrompt
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n")}`,
        ].join("\n")
      );
    },
  },
  {
    name: "provider",
    aliases: ["backend"],
    argumentHint: "[gemini|openrouter|heylook] [url]",
    description:
      "Switch the global inference provider (Gemini, OpenRouter, or local heylookitsanllm)",
    hostOnlyWhenLocked: true,
    getArgumentCompletions: (prefix, room) =>
      filterItems(
        room.gemini.listProviders().map((prov) => ({
          value: prov.id,
          label: `${prov.isConfigured() ? "●" : "○"} ${prov.id} (${prov.defaultModel})`,
          description: `${prov.displayName}${prov.baseUrl ? ` @ ${prov.baseUrl}` : ""}`,
        })),
        prefix
      ),
    execute: async (args, room, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        const lines = [
          `═══ Inference Providers (Active: ${room.gemini.activeEngineLabel}) ═══`,
        ];
        for (const prov of room.gemini.listProviders()) {
          const isCurrent =
            prov.id === room.gemini.activeProvider ? "● [ACTIVE]" : "○";
          const status = prov.isConfigured() ? "READY" : "UNCONFIGURED";
          const urlInfo = prov.baseUrl ? ` | URL: ${prov.baseUrl}` : "";
          lines.push(
            `  ${isCurrent} ${prov.id.padEnd(11)} │ Model: ${prov.defaultModel.padEnd(26)} │ Status: ${status}${urlInfo}`
          );
        }
        lines.push(
          "\nUsage: /provider <gemini|openrouter|heylook> [optional-base-url]"
        );
        replyToCaller(room, ctx, lines.join("\n"));
        return;
      }

      const targetId = parts[0]!.toLowerCase();
      const customUrl = parts[1];

      try {
        const prov = room.gemini.getProvider(targetId);
        if (customUrl && "baseUrl" in prov) {
          prov.baseUrl = customUrl.replace(/\/+$/, "");
        }
        room.gemini.activeProvider = prov.id;

        if (prov.id === "heylook") {
          const models = await prov.listModels();
          if (models.length > 0) {
            await room.gemini.preloadModel("heylook", prov.defaultModel);
            room.addSystemMessage(
              `🔌 Switched global provider to heylookitsanllm (${prov.baseUrl}) — Active resident model: ${prov.defaultModel} (${models.length} local models discovered).`,
              "event"
            );
          } else {
            room.addSystemMessage(
              `🔌 Switched global provider to heylookitsanllm (${prov.baseUrl}). Run 'heylookllm' locally and use /models to discover loaded checkpoints.`,
              "event"
            );
          }
        } else {
          room.addSystemMessage(
            `🔌 Switched global provider to ${prov.displayName} [model: ${prov.defaultModel}]`,
            "event"
          );
        }
        room.persistGlobalEngine();
      } catch (err) {
        replyToCaller(
          room,
          ctx,
          err instanceof Error ? err.message : String(err)
        );
      }
    },
  },
  {
    name: "models",
    argumentHint: "[gemini|openrouter|heylook]",
    description:
      "Discover and list available models on the active or specified provider",
    getArgumentCompletions: (prefix, room) =>
      filterItems(
        room.gemini.listProviders().map((p) => ({
          value: p.id,
          label: `📦 ${p.id}`,
          description: `List models from ${p.displayName}`,
        })),
        prefix
      ),
    execute: async (args, room, ctx) => {
      const targetProvId = args.trim().toLowerCase() || room.gemini.activeProvider;
      try {
        const prov = room.gemini.getProvider(targetProvId);
        const models = await prov.listModels();
        if (models.length === 0) {
          replyToCaller(
            room,
            ctx,
            `No models returned by ${prov.id}${prov.baseUrl ? ` (${prov.baseUrl})` : ""}.`
          );
          return;
        }
        const lines = [
          `═══ Available Models on ${prov.id} (${prov.displayName}) ═══`,
        ];
        for (const m of models.slice(0, 35)) {
          const activeMark =
            m.id === prov.defaultModel ? "● [DEFAULT]" : "○";
          const runtime = m.runtime ? ` [${m.runtime.toUpperCase()}]` : "";
          const caps =
            m.capabilities && m.capabilities.length > 0
              ? ` (${m.capabilities.join(", ")})`
              : "";
          lines.push(`  ${activeMark} ${m.id}${runtime}${caps}`);
        }
        lines.push(
          `\nTip: Switch room engine via "/engine <model-id>" or bind one persona via "/bind <persona> ${prov.id}:<model-id>"`
        );
        replyToCaller(room, ctx, lines.join("\n"));
      } catch (err) {
        replyToCaller(
          room,
          ctx,
          err instanceof Error ? err.message : String(err)
        );
      }
    },
  },
  {
    name: "bind",
    argumentHint: "<persona> <provider:model | reset>",
    description:
      "Bind a specific simulated persona to a specific provider/model while keeping its persona system prompt",
    hostOnlyWhenLocked: true,
    getArgumentCompletions: (prefix, room) => {
      const trimmed = prefix.trimStart();
      if (!trimmed.includes(" ")) {
        return filterItems(
          room.registry.all().map((p) => ({
            value: `${p.id} `,
            label: `${p.avatar} ${p.id} (<${p.nick}>)`,
            description: `Bind ${p.displayName} to a provider:model`,
          })),
          trimmed
        );
      }
      const spaceIdx = trimmed.indexOf(" ");
      const personaPart = trimmed.slice(0, spaceIdx);
      const specPrefix = trimmed.slice(spaceIdx + 1);
      const items: AutocompleteItem[] = [
        {
          value: `${personaPart} reset`,
          label: "🔄 reset",
          description: "Reset persona to use the room's global provider/model",
        },
      ];
      for (const prov of room.gemini.listProviders()) {
        const cached = prov.getCachedModels();
        if (cached.length === 0 && prov.id === "heylook") {
          void prov.listModels();
        }
        for (const m of cached.slice(0, 15)) {
          items.push({
            value: `${personaPart} ${prov.id}:${m.id}`,
            label: `🔗 ${prov.id}:${m.id}`,
            description: m.description || prov.displayName,
          });
        }
      }
      return filterItems(items, `${personaPart} ${specPrefix}`);
    },
    execute: async (args, room, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        const bindings = room.gemini.getAllPersonaBindings();
        const entries = Object.entries(bindings);
        if (entries.length === 0) {
          replyToCaller(
            room,
            ctx,
            `No custom per-persona bindings set. All personas are using global engine (${room.gemini.activeEngineLabel}).\nUsage: /bind <persona> <provider:model | reset> (e.g. /bind sydney openrouter:openai/gpt-4o)`
          );
          return;
        }
        const lines = [
          `═══ Per-Persona Engine Bindings (Global Default: ${room.gemini.activeEngineLabel}) ═══`,
        ];
        for (const [id, b] of entries) {
          const p = room.registry.find(id);
          const label = p ? `${p.avatar} <${p.nick}> (${p.id})` : id;
          lines.push(`  • ${label} -> ${b.provider}:${b.model}`);
        }
        replyToCaller(room, ctx, lines.join("\n"));
        return;
      }

      if (parts.length < 2) {
        replyToCaller(
          room,
          ctx,
          "Usage: /bind <persona> <provider:model | reset> — e.g. /bind deepseek-r1 heylook:Qwen3-30B or /bind sydney openrouter:openai/gpt-4o"
        );
        return;
      }

      const [personaQuery, targetSpec] = parts;
      const persona = room.registry.find(personaQuery!);
      if (!persona) {
        replyToCaller(
          room,
          ctx,
          `No persona matching "${personaQuery}" found in catalog.`
        );
        return;
      }

      if (
        targetSpec!.toLowerCase() === "reset" ||
        targetSpec!.toLowerCase() === "default" ||
        targetSpec!.toLowerCase() === "none"
      ) {
        room.bindPersona(persona.id, null);
        room.addSystemMessage(
          `🔄 Reset ${persona.avatar} <${persona.nick}> to use the room's global engine (${room.gemini.activeEngineLabel}).`,
          "event"
        );
        return;
      }

      const parsed = room.gemini.parseProviderModelSpec(targetSpec!);
      const binding = parsed ?? {
        provider: room.gemini.activeProvider,
        model: targetSpec!,
      };

      try {
        room.gemini.getProvider(binding.provider);
      } catch (err) {
        replyToCaller(
          room,
          ctx,
          err instanceof Error ? err.message : String(err)
        );
        return;
      }

      room.bindPersona(persona.id, binding);
      if (binding.provider === "heylook") {
        await room.gemini.preloadModel("heylook", binding.model);
      }
      room.addSystemMessage(
        `🔗 Bound ${persona.avatar} <${persona.nick}> to ${binding.provider}:${binding.model} (using ${persona.nick}'s simulated persona prompt).`,
        "event"
      );
    },
  },
  {
    name: "engine",
    aliases: ["model"],
    argumentHint: "<flash|lite|model|provider:model>",
    description:
      "Switch the active model or provider:model (e.g. /engine flash, /engine openrouter:deepseek/deepseek-r1, /engine heylook:qwen3)",
    hostOnlyWhenLocked: true,
    getArgumentCompletions: (prefix, room) => {
      const items: AutocompleteItem[] = [
        {
          value: "flash",
          label: "⚡ gemini-3.8-flash",
          description: "Gemini 3.8 Flash (balanced roleplay & reasoning)",
        },
        {
          value: "lite",
          label: "🚀 gemini-3.5-flash-lite",
          description: "Gemini 3.5 Flash-Lite (ultra-low latency)",
        },
      ];
      for (const m of room.gemini.getCachedModels()) {
        if (!items.some((i) => i.value === m.id)) {
          items.push({
            value: m.id,
            label: `🤖 ${m.id}`,
            description: `${m.provider}${m.runtime ? ` (${m.runtime})` : ""}`,
          });
        }
      }
      for (const prov of room.gemini.listProviders()) {
        const cached = prov.getCachedModels();
        if (cached.length === 0 && prov.id === "heylook") {
          void prov.listModels();
        }
        for (const m of cached.slice(0, 8)) {
          items.push({
            value: `${prov.id}:${m.id}`,
            label: `🔌 ${prov.id}:${m.id}`,
            description: prov.displayName,
          });
        }
      }
      return filterItems(items, prefix);
    },
    execute: async (args, room, ctx) => {
      const rawChoice = args.trim();
      const choice = rawChoice.toLowerCase();
      if (!rawChoice) {
        replyToCaller(
          room,
          ctx,
          `Current simulation engine: ${room.gemini.activeEngineLabel}. Usage: /engine <flash|lite|model|provider:model>`
        );
        return;
      }

      if (choice === "lite" || choice === "gemini-3.5-flash-lite") {
        room.gemini.activeProvider = "gemini";
        room.gemini.activeModel = "gemini-3.5-flash-lite";
      } else if (choice === "flash" || choice === "gemini-3.8-flash") {
        room.gemini.activeProvider = "gemini";
        room.gemini.activeModel = "gemini-3.8-flash";
      } else {
        try {
          room.gemini.activeModel = rawChoice;
        } catch (err) {
          replyToCaller(
            room,
            ctx,
            err instanceof Error ? err.message : String(err)
          );
          return;
        }
      }
      if (room.gemini.activeProvider === "heylook") {
        await room.gemini.preloadModel("heylook", room.gemini.activeModel);
      }
      room.persistGlobalEngine();
      room.addSystemMessage(
        `Switched underlying simulation engine to ${room.gemini.activeEngineLabel}`,
        "event"
      );
    },
  },
  {
    name: "shush",
    aliases: ["stop", "mute"],
    description: "Interrupt any currently streaming model turns (or press Esc)",
    execute: (_args, room, ctx) => {
      if (room.abortCurrentTurn()) {
        const who = ctx?.senderNick ? ` by @${ctx.senderNick}` : "";
        room.addSystemMessage(`🤫 Interrupted active model turn${who}.`, "system", false);
      } else {
        replyToCaller(room, ctx, "No model is currently speaking.");
      }
    },
  },
  {
    name: "clear",
    aliases: ["cls"],
    description: "Clear the chat transcript while keeping the active roster",
    hostOnlyWhenLocked: true,
    execute: (_args, room) => {
      room.clearMessages();
      room.addSystemMessage(
        `Cleared transcript in ${room.channelName}.`,
        "system",
        false
      );
    },
  },
  {
    name: "help",
    aliases: ["?", "commands"],
    description: "Show all available IRC & 4-Player Co-op slash commands",
    execute: (_args, room, ctx) => {
      const lines = [
        "═══ Available Commands in #latent-space (4-Player Co-op + ∞ AIs) ═══",
      ];
      for (const cmd of COMMANDS) {
        const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : "";
        const aliasStr =
          cmd.aliases && cmd.aliases.length > 0
            ? ` (aliases: ${cmd.aliases.map((a) => `/${a}`).join(", ")})`
            : "";
        lines.push(`  /${cmd.name}${hint} — ${cmd.description}${aliasStr}`);
      }
      lines.push(
        "\nTips: Use Tab for slash-command & @Nick autocomplete, Esc to interrupt streaming, Ctrl+C to exit."
      );
      replyToCaller(room, ctx, lines.join("\n"));
    },
  },
  {
    name: "quit",
    aliases: ["exit"],
    description: "Disconnect and exit llm-sim",
    execute: (_args, _room, ctx) => {
      ctx?.onQuit?.();
    },
  },
];

export function findCommand(nameOrAlias: string): CommandDefinition | undefined {
  const clean = nameOrAlias.trim().toLowerCase().replace(/^\//, "");
  return COMMANDS.find(
    (c) =>
      c.name.toLowerCase() === clean ||
      (c.aliases?.some((a) => a.toLowerCase() === clean) ?? false)
  );
}

export async function handleSlashCommand(
  rawInput: string,
  room: Room,
  ctxOrOnQuit?: CommandExecutionContext | (() => void)
): Promise<boolean> {
  const ctx: CommandExecutionContext =
    typeof ctxOrOnQuit === "function"
      ? { onQuit: ctxOrOnQuit, isHost: true }
      : (ctxOrOnQuit ?? { isHost: true });

  const trimmed = rawInput.trim();
  if (!trimmed.startsWith("/")) return false;

  const match = trimmed.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return false;

  const [, cmdName, restArgs = ""] = match;
  const cmd = findCommand(cmdName!);
  if (!cmd) {
    replyToCaller(
      room,
      ctx,
      `Unknown command "/${cmdName}". Type /help to see available commands.`
    );
    return true;
  }

  if (cmd.hostOnlyAlways && ctx.isHost === false) {
    replyToCaller(
      room,
      ctx,
      `🔒 "/${cmd.name}" can only be used by the Room Host (Player 1).`
    );
    return true;
  }

  if (cmd.hostOnlyWhenLocked && ctx.locked && ctx.isHost === false) {
    replyToCaller(
      room,
      ctx,
      `🔒 The Room Host has locked roster/room settings. Ask the Host to run /unlock or summon the model!`
    );
    return true;
  }

  await cmd.execute(restArgs, room, ctx);
  return true;
}

/**
 * Custom AutocompleteProvider for pi-tui Editor that completes:
 * 1. /commands and their arguments (e.g. /summon <model>, /banish <active-model>)
 * 2. Both @BotNick and @HumanNick mentions anywhere in a chat line!
 */
export class ChatroomAutocompleteProvider implements AutocompleteProvider {
  private room: Room;
  private slashCommands: SlashCommand[];

  constructor(room: Room) {
    this.room = room;
    this.slashCommands = COMMANDS.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      argumentHint: cmd.argumentHint,
      getArgumentCompletions: cmd.getArgumentCompletions
        ? (prefix: string) => cmd.getArgumentCompletions!(prefix, this.room)
        : undefined,
    }));
  }

  public async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number
  ): Promise<AutocompleteSuggestions | null> {
    const currentLine = lines[cursorLine] ?? "";
    const textBeforeCursor = currentLine.slice(0, cursorCol);

    if (cursorLine === 0 && textBeforeCursor.startsWith("/")) {
      const withoutSlash = textBeforeCursor.slice(1);
      const spaceIdx = withoutSlash.indexOf(" ");

      if (spaceIdx === -1) {
        const prefix = withoutSlash.toLowerCase();
        const items: AutocompleteItem[] = this.slashCommands
          .filter((c) => c.name.toLowerCase().startsWith(prefix))
          .map((c) => ({
            value: c.name,
            label: `/${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ""}`,
            description: c.description,
          }));
        return items.length > 0 ? { items, prefix: withoutSlash } : null;
      }

      const cmdName = withoutSlash.slice(0, spaceIdx);
      const argPrefix = withoutSlash.slice(spaceIdx + 1);
      const cmdDef = findCommand(cmdName);
      if (cmdDef?.getArgumentCompletions) {
        const items = cmdDef.getArgumentCompletions(argPrefix, this.room) ?? [];
        return items.length > 0 ? { items, prefix: argPrefix } : null;
      }
      return null;
    }

    const atMatch = textBeforeCursor.match(/(?:^|\s)(@[A-Za-z0-9_.-]*)$/);
    if (atMatch) {
      const atPrefix = atMatch[1]!;
      const query = atPrefix.slice(1).toLowerCase();

      const humanItems: AutocompleteItem[] = this.room.humans
        .filter((h) => h.nick.toLowerCase().includes(query))
        .map((h) => ({
          value: `@${h.nick}`,
          label: `👤 @${h.nick}`,
          description: h.isHost ? "Human Player (Host)" : "Human Player",
        }));

      const botItems: AutocompleteItem[] = this.room.activePersonas
        .filter(
          (p) =>
            p.nick.toLowerCase().includes(query) ||
            p.id.toLowerCase().includes(query)
        )
        .map((p) => ({
          value: `@${p.nick}`,
          label: `${p.avatar} @${p.nick}`,
          description: `${p.displayName} (${p.era})`,
        }));

      const items = [...humanItems, ...botItems];
      return items.length > 0 ? { items, prefix: atPrefix } : null;
    }

    return null;
  }

  public applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    const currentLine = lines[cursorLine] ?? "";
    const textBeforeCursor = currentLine.slice(0, cursorCol);
    const textAfterCursor = currentLine.slice(cursorCol);

    if (
      cursorLine === 0 &&
      textBeforeCursor.startsWith("/") &&
      !textBeforeCursor.includes(" ")
    ) {
      const replacement = `/${item.value} `;
      const newLines = [...lines];
      newLines[cursorLine] = replacement + textAfterCursor;
      return {
        lines: newLines,
        cursorLine,
        cursorCol: replacement.length,
      };
    }

    const prefixStart = cursorCol - prefix.length;
    const replacement = `${item.value} `;
    const newLine =
      currentLine.slice(0, Math.max(0, prefixStart)) +
      replacement +
      textAfterCursor;
    const newLines = [...lines];
    newLines[cursorLine] = newLine;
    return {
      lines: newLines,
      cursorLine,
      cursorCol: Math.max(0, prefixStart) + replacement.length,
    };
  }
}
