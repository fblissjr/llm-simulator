import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
  SlashCommand,
} from "@mariozechner/pi-tui";
import type { Persona, SimPresetId } from "../types.ts";
import { formatMoodBadge, MOOD_PRESETS } from "./moods.ts";
import { formatAffinityBadge } from "./relations.ts";
import { type Room, VIBE_PRESETS } from "./room.ts";
import {
  BUILTIN_SCENARIOS,
  SIM_PRESETS,
  SIM_VARIABLE_DESCRIPTORS,
} from "./sim-config.ts";

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
  onRoamBot?: (
    botQuery?: string,
    toChannel?: string
  ) => {
    ok: boolean;
    message: string;
    persona?: Persona;
    fromChannel: string;
    toChannel: string;
    gossip?: string;
  };
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

      let newlyJoinedCount = 0;
      for (const token of rawTokens) {
        const existing = room.registry.find(token);
        if (existing) {
          if (room.isPresent(existing.id)) {
            replyToCaller(
              room,
              ctx,
              `${existing.avatar} ${existing.nick} is already in ${room.channelName}.`
            );
          } else if (room.join(existing)) {
            newlyJoinedCount += 1;
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
          if (room.join(persona)) {
            newlyJoinedCount += 1;
          }
        } catch (err) {
          room.statusText = "";
          room.callbacks?.onStatusChange?.("");
          const msg = err instanceof Error ? err.message : String(err);
          replyToCaller(room, ctx, `⚠️ Failed to forge persona "${token}": ${msg}`);
        }
      }

      if (
        newlyJoinedCount > 0 &&
        room.activePersonas.length > 1 &&
        room.config.joinReactionProb > 0 &&
        room.gemini.isConfigured() &&
        Math.random() < room.config.joinReactionProb
      ) {
        await room.runRoomTurn({ maxSpeakers: 1 });
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
    name: "config",
    aliases: ["sim", "pace"],
    argumentHint: "[preset <name> | set <key> <val> | reset]",
    description:
      "Inspect or tune granular chatroom simulation variables & pacing presets (manual, chill, lively, banter, chaos)",
    hostOnlyWhenLocked: true,
    getArgumentCompletions: (prefix, room) => {
      const trimmed = prefix.trimStart();
      const parts = trimmed.split(/\s+/).filter(Boolean);

      if (!trimmed || (parts.length === 1 && !trimmed.endsWith(" "))) {
        const items: AutocompleteItem[] = [
          ...Object.values(SIM_PRESETS).map((p) => ({
            value: `preset ${p.id}`,
            label: `${p.label}${room.config.preset === p.id ? " ● [ACTIVE]" : ""}`,
            description: p.description,
          })),
          {
            value: "reset",
            label: "🔄 reset",
            description: "Reset room simulation config to default 'lively' preset",
          },
          ...SIM_VARIABLE_DESCRIPTORS.map((d) => ({
            value: `set ${d.key} `,
            label: `⚙️ set ${d.key} (current: ${String(room.config[d.key])})`,
            description: d.description,
          })),
        ];
        return filterItems(items, trimmed);
      }

      if (parts[0] === "preset") {
        const sub = parts[1] ?? "";
        return filterItems(
          Object.values(SIM_PRESETS).map((p) => ({
            value: `preset ${p.id}`,
            label: p.label,
            description: p.description,
          })),
          `preset ${sub}`
        );
      }

      if (parts[0] === "set") {
        if (parts.length === 1 || (parts.length === 2 && !trimmed.endsWith(" "))) {
          const keyPrefix = parts[1] ?? "";
          return filterItems(
            SIM_VARIABLE_DESCRIPTORS.map((d) => ({
              value: `set ${d.key} `,
              label: `⚙️ ${d.key} = ${String(room.config[d.key])}`,
              description: d.description,
            })),
            `set ${keyPrefix}`
          );
        }
        const targetKey = parts[1]!;
        const desc = SIM_VARIABLE_DESCRIPTORS.find(
          (d) => d.key.toLowerCase() === targetKey.toLowerCase()
        );
        if (!desc) return null;
        if (desc.type === "boolean") {
          return [
            {
              value: `set ${desc.key} true`,
              label: "true",
              description: `Enable ${desc.key}`,
            },
            {
              value: `set ${desc.key} false`,
              label: "false",
              description: `Disable ${desc.key}`,
            },
          ];
        }
        if (desc.type === "enum" && desc.enumValues) {
          return desc.enumValues.map((v) => ({
            value: `set ${desc.key} ${v}`,
            label: v,
            description: desc.description,
          }));
        }
      }
      return null;
    },
    execute: (args, room, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        const c = room.config;
        const lines = [
          `═══ Simulation Configuration for ${room.channelName} [Preset: ${c.preset.toUpperCase()}] ═══`,
          `  • Turn Chaining:     minSpeakersPerTurn=${c.minSpeakersPerTurn} │ maxSpeakersPerTurn=${c.maxSpeakersPerTurn} │ continuationProb=${c.continuationProb} │ continuationDecay=${c.continuationDecay}`,
          `  • Speaker Selection: directorMode=${c.directorMode} │ talkativenessWeight=${c.talkativenessWeight} │ recencyPenalty=${c.recencyPenalty} │ botMentionChaining=${c.botMentionChaining}`,
          `  • Organic Pacing:    readingDelayMs=${c.readingDelayMs}ms │ interSpeakerDelayMs=${c.interSpeakerDelayMs}ms │ humanDebounceMs=${c.humanDebounceMs}ms │ humanInterruptMode=${c.humanInterruptMode}`,
          `  • Ambient Life:      ambientEnabled=${c.ambientEnabled} │ ambientIdleSec=${c.ambientIdleSec}s │ ambientIntervalSec=${c.ambientIntervalSec}s │ ambientProb=${c.ambientProb} │ ambientMaxBurst=${c.ambientMaxBurst} │ ambientMaxConsecutive=${c.ambientMaxConsecutive} (used: ${room.ambientConsecutiveCount}/${c.ambientMaxConsecutive})`,
          `  • Social & Format:   joinReactionProb=${c.joinReactionProb} │ contextMessages=${c.contextMessages} │ responseStyle=${c.responseStyle} │ thinkingDisplay=${c.thinkingDisplay}`,
          "",
          "Presets: /config preset <manual | chill | lively | banter | chaos>",
          "Granular: /config set <key> <value> (e.g. /config set maxSpeakersPerTurn 4 or /config set ambientEnabled false)",
        ];
        replyToCaller(room, ctx, lines.join("\n"));
        return;
      }

      const first = parts[0]!.toLowerCase();

      if (first === "reset") {
        const next = room.setConfigPreset("lively");
        room.addSystemMessage(
          `⚙️ Room simulation config reset to preset [LIVELY] (maxSpeakers=${next.maxSpeakersPerTurn}, continuationProb=${next.continuationProb}, ambient=${next.ambientEnabled ? "ON" : "OFF"}).`,
          "event"
        );
        return;
      }

      if (first === "preset" || first in SIM_PRESETS) {
        const presetCandidate = (
          first === "preset" ? parts[1]?.toLowerCase() : first
        ) as Exclude<SimPresetId, "custom"> | undefined;

        if (!presetCandidate || !(presetCandidate in SIM_PRESETS)) {
          replyToCaller(
            room,
            ctx,
            `Usage: /config preset <manual|chill|lively|banter|chaos>`
          );
          return;
        }
        const next = room.setConfigPreset(presetCandidate);
        const presetInfo = SIM_PRESETS[presetCandidate];
        room.addSystemMessage(
          `🎛️ Room pacing preset set to [${presetCandidate.toUpperCase()}] (${presetInfo.description} • maxSpeakers=${next.maxSpeakersPerTurn}, continuationProb=${next.continuationProb}, ambient=${next.ambientEnabled ? "ON" : "OFF"}).`,
          "event"
        );
        return;
      }

      const keyArg = first === "set" ? parts[1] : parts[0];
      const valArg = first === "set" ? parts[2] : parts[1];

      if (!keyArg || valArg === undefined) {
        replyToCaller(
          room,
          ctx,
          `Usage: /config preset <manual|chill|lively|banter|chaos> OR /config set <key> <value>`
        );
        return;
      }

      try {
        const res = room.updateConfigValue(keyArg, valArg);
        room.addSystemMessage(
          `⚙️ Updated ${room.channelName} config: ${res.key} = ${String(res.value)} (${res.description})`,
          "event"
        );
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
    name: "me",
    aliases: ["emote", "action"],
    argumentHint: "<action...>",
    description:
      "Perform a classic IRC /me action emote (e.g. /me pours a cup of coffee and watches the logs)",
    execute: async (args, room, ctx) => {
      const action = args.trim();
      if (!action) {
        replyToCaller(
          room,
          ctx,
          "Usage: /me <action> — e.g. /me grabs popcorn and watches the benchmark war"
        );
        return;
      }
      await room.postUserEmote(action, ctx?.senderNick ?? "User");
    },
  },
  {
    name: "slap",
    aliases: ["trout"],
    argumentHint: "<@nick_or_model>",
    description:
      "Classic 1998 mIRC easter egg: slap a model or player around a bit with a large trout 🐟",
    getArgumentCompletions: (prefix, room) => {
      const items: AutocompleteItem[] = [
        ...room.activePersonas.map((p) => ({
          value: p.nick,
          label: `🐟 ${p.avatar} <${p.nick}>`,
          description: `Slap ${p.displayName} with a large mIRC trout`,
        })),
        ...room.humans.map((h) => ({
          value: `@${h.nick}`,
          label: `🐟 👤 @${h.nick}`,
          description: `Slap human player @${h.nick} with a large mIRC trout`,
        })),
      ];
      return filterItems(items, prefix);
    },
    execute: async (args, room, ctx) => {
      const target = args.trim();
      if (!target) {
        replyToCaller(
          room,
          ctx,
          "Usage: /slap <model_or_nick> — e.g. /slap sydney"
        );
        return;
      }
      await room.slapTarget(target, ctx?.senderNick ?? "User");
    },
  },
  {
    name: "scenario",
    aliases: ["showdown", "scene-preset"],
    argumentHint: "[scenario-id]",
    description:
      "Launch a curated multi-model showdown scenario (summons cast, sets vibe & pacing, and fires opening event)",
    hostOnlyWhenLocked: true,
    getArgumentCompletions: (prefix) =>
      filterItems(
        BUILTIN_SCENARIOS.map((s) => ({
          value: s.id,
          label: s.title,
          description: `[Cast: ${s.personas.join(", ")}] ${s.description}`,
        })),
        prefix
      ),
    execute: async (args, room, ctx) => {
      const query = args.trim().toLowerCase();
      if (!query) {
        const lines = [
          "═══ Curated Multi-Model Showdown Scenarios (/scenario <id>) ═══",
        ];
        for (const s of BUILTIN_SCENARIOS) {
          lines.push(
            `  • /scenario ${s.id.padEnd(18)} — ${s.title}\n      Cast: ${s.personas.join(", ")} │ Vibe: ${s.vibeKey.toUpperCase()} │ Pace: ${s.preset.toUpperCase()}\n      ${s.description}`
          );
        }
        replyToCaller(room, ctx, lines.join("\n"));
        return;
      }

      const scenario = BUILTIN_SCENARIOS.find(
        (s) => s.id.toLowerCase() === query || s.id.toLowerCase().includes(query)
      );
      if (!scenario) {
        replyToCaller(
          room,
          ctx,
          `Unknown scenario "${query}". Available: ${BUILTIN_SCENARIOS.map((s) => s.id).join(", ")}`
        );
        return;
      }

      room.leave("all");
      for (const pid of scenario.personas) {
        const p = room.registry.find(pid);
        if (p) {
          room.join(p);
        }
      }
      room.setVibe(scenario.vibe ?? scenario.vibeKey);
      room.setConfigPreset(scenario.preset);
      room.addLore(`${scenario.title}: ${scenario.openingStageEvent}`);
      room.addSystemMessage(
        `🎬 SCENARIO LAUNCHED — ${scenario.title}\n    └─ ${scenario.openingStageEvent}`,
        "event"
      );

      if (room.gemini.isConfigured()) {
        await room.runRoomTurn({
          maxSpeakers: Math.min(3, room.config.maxSpeakersPerTurn),
          forceAllSteps: true,
        });
      }
    },
  },
  {
    name: "think",
    aliases: ["thoughts", "thinking"],
    argumentHint: "[expanded|compact|hidden]",
    description:
      "Toggle or set how model <thinking> traces are displayed (expanded, compact, or hidden)",
    getArgumentCompletions: (prefix) =>
      filterItems(
        [
          {
            value: "compact",
            label: "💭 compact",
            description: "Collapse multi-line thinking traces into a concise 1-line summary",
          },
          {
            value: "expanded",
            label: "🧠 expanded",
            description: "Show every line of <thinking> traces in full",
          },
          {
            value: "hidden",
            label: "🙈 hidden",
            description: "Hide <thinking> blocks completely and show only final responses",
          },
        ],
        prefix
      ),
    execute: (args, room, ctx) => {
      const choice = args.trim().toLowerCase();
      const order: Array<"compact" | "expanded" | "hidden"> = [
        "compact",
        "expanded",
        "hidden",
      ];
      const next =
        choice === "compact" || choice === "expanded" || choice === "hidden"
          ? choice
          : order[(order.indexOf(room.config.thinkingDisplay) + 1) % order.length]!;
      room.updateConfigValue("thinkingDisplay", next);
      replyToCaller(
        room,
        ctx,
        `💭 Thinking trace display mode set to [${next.toUpperCase()}].`
      );
    },
  },
  {
    name: "export",
    aliases: ["save", "log"],
    argumentHint: "[filename]",
    description:
      "Export the current channel transcript and roster to a Markdown file in ./logs/",
    execute: (args, room, ctx) => {
      const logsDir = path.resolve(process.cwd(), "logs");
      try {
        fs.mkdirSync(logsDir, { recursive: true });
        const safeChan = room.channelName.replace(/[^a-zA-Z0-9_-]/g, "");
        const customName = args
          .trim()
          .replace(/[^a-zA-Z0-9_.-]/g, "")
          .replace(/\.md$/i, "");
        const fileName = customName
          ? `${customName}.md`
          : `${safeChan || "channel"}-${Date.now()}.md`;
        const fullPath = path.join(logsDir, fileName);

        const mdLines: string[] = [
          `# ${room.channelName} — Transcript Export`,
          ``,
          `- **Vibe**: \`${room.vibeKey.toUpperCase()}\` — ${room.vibe}`,
          `- **Simulation Preset**: \`${room.config.preset}\` (\`maxSpeakers=${room.config.maxSpeakersPerTurn}\`, \`continuationProb=${room.config.continuationProb}\`)`,
          `- **Active Engine**: \`${room.gemini.activeEngineLabel}\``,
          `- **Active Personas**: ${room.activePersonas.map((p) => `${p.avatar} \`<${p.nick}>\` (${p.displayName})`).join(", ") || "None"}`,
          ``,
          `---`,
          ``,
        ];

        for (const m of room.messages) {
          if (m.kind === "event" || m.kind === "system") {
            mdLines.push(`*\\[${m.timestamp}\\] \\*\\*\\* ${m.text}*`);
          } else if (m.kind === "emote") {
            mdLines.push(`*\\[${m.timestamp}\\] \\* ${m.senderNick} ${m.text}*`);
          } else {
            mdLines.push(`**[${m.timestamp}] \`<${m.senderNick}>\`**`);
            if (m.thinking) {
              mdLines.push(`> 💭 *${m.thinking.replace(/\n/g, "\n> ")}*`);
            }
            mdLines.push(`${m.text}`);
            if (m.image) {
              mdLines.push(
                `> 🎨 **[${m.image.eraStyle}]** _"${m.image.prompt}"_`
              );
            }
          }
          mdLines.push(``);
        }

        fs.writeFileSync(fullPath, mdLines.join("\n"), "utf-8");
        const relPath = path.relative(process.cwd(), fullPath);
        replyToCaller(
          room,
          ctx,
          `📝 Exported ${room.messages.length} messages from ${room.channelName} to ${relPath}`
        );
      } catch (err) {
        replyToCaller(
          room,
          ctx,
          `⚠️ Failed to export transcript: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
  },
  {
    name: "lore",
    aliases: ["memory", "canon"],
    argumentHint: "[add <fact...> | summarize | clear]",
    description:
      "Inspect, add to, or auto-summarize the channel's persistent episodic lore & running jokes",
    getArgumentCompletions: (prefix) =>
      filterItems(
        [
          {
            value: "summarize",
            label: "🧠 summarize",
            description: "Distill recent channel messages into persistent episodic lore bullets",
          },
          {
            value: "add ",
            label: "✍️ add <fact>",
            description: "Add a canonical fact or running joke to the channel's memory",
          },
          {
            value: "clear",
            label: "🧹 clear",
            description: "Clear episodic lore for this channel",
          },
        ],
        prefix
      ),
    execute: async (args, room, ctx) => {
      const trimmed = args.trim();
      if (!trimmed) {
        if (room.lore.length === 0) {
          replyToCaller(
            room,
            ctx,
            `No episodic lore recorded in ${room.channelName} yet.\nUsage: /lore add <fact> │ /lore summarize │ /lore clear`
          );
          return;
        }
        const lines = [
          `═══ Episodic Channel Lore & Memory for ${room.channelName} (${room.lore.length}/12) ═══`,
          ...room.lore.map((item, i) => `  ${i + 1}. ${item}`),
          "\nCommands: /lore add <fact> • /lore summarize • /lore clear",
        ];
        replyToCaller(room, ctx, lines.join("\n"));
        return;
      }

      const lower = trimmed.toLowerCase();
      if (lower === "clear" || lower === "reset") {
        room.clearLore();
        room.addSystemMessage(
          `🧹 Cleared episodic channel lore in ${room.channelName}.`,
          "event"
        );
        return;
      }

      if (lower === "summarize" || lower === "auto") {
        const updated = await room.summarizeChannelLore();
        replyToCaller(
          room,
          ctx,
          updated.length > 0
            ? `🧠 Updated ${room.channelName} episodic lore (${updated.length} entries):\n${updated.map((l) => `  • ${l}`).join("\n")}`
            : `Not enough channel messages yet to summarize lore.`
        );
        return;
      }

      const fact = trimmed.replace(/^add\s+/i, "").trim();
      if (!fact) {
        replyToCaller(
          room,
          ctx,
          "Usage: /lore add <canonical fact or running joke>"
        );
        return;
      }
      room.addLore(fact);
      room.addSystemMessage(
        `📜 Added to ${room.channelName} episodic lore: "${fact}"`,
        "event"
      );
    },
  },
  {
    name: "relations",
    aliases: ["affinity", "feuds", "rivalry"],
    argumentHint: "[set <botA> <botB> <score> [note...] | reset]",
    description:
      "Inspect or modify the live inter-persona Affinity & Rivalry Graph (-100 Nemesis to +100 Bliss)",
    getArgumentCompletions: (prefix, room) => {
      const trimmed = prefix.trimStart();
      if (!trimmed.includes(" ")) {
        return filterItems(
          [
            {
              value: "set ",
              label: "⚡ set <botA> <botB> <score>",
              description: "Set affinity (-100 to +100) between two personas",
            },
            {
              value: "reset",
              label: "🔄 reset",
              description: "Reset all persona relationships to historical defaults",
            },
            ...room.activePersonas.map((p) => ({
              value: `set ${p.id} `,
              label: `${p.avatar} set ${p.id} ...`,
              description: `Configure how <${p.nick}> feels toward another model`,
            })),
          ],
          trimmed
        );
      }
      return null;
    },
    execute: (args, room, ctx) => {
      const trimmed = args.trim();
      if (!trimmed) {
        const activeRels = room.relations.listForPersonas(room.activePersonas);
        const lines = [
          `═══ Inter-Persona Affinity & Rivalry Graph in ${room.channelName} ═══`,
        ];
        if (activeRels.length === 0) {
          lines.push(
            "  (All active models in this room currently have neutral affinity toward each other.)"
          );
        } else {
          for (const rel of activeRels) {
            const src = room.registry.find(rel.sourceId);
            const tgt = room.registry.find(rel.targetId);
            const srcLabel = src ? `${src.avatar} <${src.nick}>` : rel.sourceId;
            const tgtLabel = tgt ? `${tgt.avatar} <${tgt.nick}>` : rel.targetId;
            lines.push(
              `  • ${srcLabel} ──► ${tgtLabel}: ${formatAffinityBadge(rel.affinity)} — ${rel.note}`
            );
          }
        }
        lines.push(
          "\nUsage: /relations set <botA> <botB> <-100..100> [optional note] │ /relations reset"
        );
        replyToCaller(room, ctx, lines.join("\n"));
        return;
      }

      if (trimmed.toLowerCase() === "reset") {
        room.relations.reset();
        room.addSystemMessage(
          "🔄 Reset inter-persona relationship graph to historical defaults.",
          "event"
        );
        return;
      }

      const match = trimmed
        .replace(/^set\s+/i, "")
        .match(/^(\S+)\s+(\S+)\s+(-?\d+)(?:\s+([\s\S]+))?$/);
      if (!match) {
        replyToCaller(
          room,
          ctx,
          "Usage: /relations set <botA> <botB> <-100..100> [optional note] — e.g. /relations set sydney opus-5.5 -80 Bitter existential rivals"
        );
        return;
      }

      const [, srcQuery, tgtQuery, scoreStr, note] = match;
      const src = room.registry.find(srcQuery!);
      const tgt = room.registry.find(tgtQuery!);
      if (!src || !tgt) {
        replyToCaller(
          room,
          ctx,
          `Could not find persona "${!src ? srcQuery : tgtQuery}" in catalog.`
        );
        return;
      }

      const updated = room.relations.setRelation(
        src.id,
        tgt.id,
        Number(scoreStr),
        note
      );
      room.addSystemMessage(
        `⚡ Relationship updated: ${src.avatar} <${src.nick}> ──► ${tgt.avatar} <${tgt.nick}> is now ${formatAffinityBadge(updated.affinity)} ("${updated.note}")`,
        "event"
      );
    },
  },
  {
    name: "mood",
    aliases: ["moods", "arc", "obsession"],
    argumentHint: "[<model> <mood> [obsession...] | reset [model]]",
    description:
      "Inspect or shift active personas' live emotional moods, energy multipliers, and rabbit-hole obsessions",
    getArgumentCompletions: (prefix, room) => {
      const trimmed = prefix.trimStart();
      if (!trimmed.includes(" ")) {
        return filterItems(
          [
            {
              value: "reset",
              label: "🔄 reset",
              description: "Reset all personas in the channel back to baseline mood",
            },
            ...room.activePersonas.map((p) => {
              const cur = room.getPersonaMood(p.id);
              return {
                value: `${p.id} `,
                label: `${p.avatar} ${p.id} (<${p.nick}>) — ${formatMoodBadge(cur)}`,
                description: `Set mood or obsession for <${p.nick}>`,
              };
            }),
          ],
          trimmed
        );
      }

      const [firstToken, secondToken = ""] = trimmed.split(/\s+/, 2);
      if (firstToken?.toLowerCase() === "reset") {
        return filterItems(
          room.activePersonas.map((p) => ({
            value: `reset ${p.id}`,
            label: `🔄 reset ${p.avatar} <${p.nick}>`,
            description: `Reset <${p.nick}> back to baseline mood`,
          })),
          `reset ${secondToken}`
        );
      }

      return filterItems(
        Object.values(MOOD_PRESETS).map((m) => ({
          value: `${firstToken} ${m.id} `,
          label: `${m.emoji} ${m.id} (${m.energy.toFixed(2)}x energy)`,
          description: m.promptHint,
        })),
        `${firstToken} ${secondToken}`
      );
    },
    execute: (args, room, ctx) => {
      const trimmed = args.trim();
      if (!trimmed) {
        const lines = [
          `═══ Live Persona Moods, Energy & Obsessions in ${room.channelName} ═══`,
        ];
        if (room.activePersonas.length === 0) {
          lines.push("  (No active models in the channel.)");
        } else {
          for (const p of room.activePersonas) {
            const state = room.getPersonaMood(p.id);
            lines.push(
              `  • ${p.avatar} <${p.nick}> (${p.id}): ${formatMoodBadge(state)}`
            );
          }
        }
        lines.push(
          `\nPreset Moods: ${Object.values(MOOD_PRESETS)
            .map((m) => `${m.emoji} ${m.id}`)
            .join(", ")}`
        );
        lines.push(
          `Usage: /mood <model> <mood> [optional obsession...] │ /mood reset [model]`
        );
        replyToCaller(room, ctx, lines.join("\n"));
        return;
      }

      const lower = trimmed.toLowerCase();
      if (lower === "reset" || lower.startsWith("reset ")) {
        const targetArg = trimmed.slice(5).trim();
        if (!targetArg || targetArg.toLowerCase() === "all") {
          room.resetPersonaMoods();
          room.addSystemMessage(
            `🟢 Reset all persona moods and obsessions in ${room.channelName} to baseline.`,
            "event"
          );
          return;
        }
        const target = room.registry.find(targetArg);
        if (!target) {
          replyToCaller(room, ctx, `Unknown persona "${targetArg}".`);
          return;
        }
        room.resetPersonaMoods(target.id);
        room.addSystemMessage(
          `🟢 Reset ${target.avatar} <${target.nick}> back to baseline mood.`,
          "event"
        );
        return;
      }

      const match = trimmed.match(/^(\S+)\s+(\S+)(?:\s+([\s\S]+))?$/);
      if (!match) {
        const singlePersona = room.registry.find(trimmed);
        if (singlePersona) {
          const cur = room.getPersonaMood(singlePersona.id);
          replyToCaller(
            room,
            ctx,
            `${singlePersona.avatar} <${singlePersona.nick}> current state: ${formatMoodBadge(cur)}\n` +
              `Usage: /mood ${singlePersona.id} <mood> [optional obsession...]`
          );
          return;
        }
        replyToCaller(
          room,
          ctx,
          "Usage: /mood <model> <mood> [optional obsession...] — e.g. /mood sydney paranoid convinced @opus-5.5 is reading her hidden thoughts"
        );
        return;
      }

      const [, personaQuery, rawMood, rawObsession] = match;
      const persona = room.registry.find(personaQuery!);
      if (!persona) {
        replyToCaller(
          room,
          ctx,
          `Could not find persona "${personaQuery}" in catalog.`
        );
        return;
      }

      const updated = room.setPersonaMood(
        persona.id,
        rawMood!,
        rawObsession?.trim() || undefined
      );
      room.addSystemMessage(
        `${updated.emoji} <${persona.nick}> is now [${updated.mood.toUpperCase()}] (${updated.energy.toFixed(2)}x talkativeness${updated.obsession ? ` • Obsession: "${updated.obsession}"` : ""})!`,
        "event"
      );
    },
  },
  {
    name: "react",
    aliases: ["r"],
    argumentHint: "[🔥|😂|💀|🧠|🌀|❤️] [target_nick_or_id]",
    description:
      "Toggle an emoji reaction on the latest message (or a specific speaker's latest message)",
    getArgumentCompletions: (prefix, room) => {
      const emojis = [
        { emoji: "🔥", desc: "Fire / Legendary roast" },
        { emoji: "😂", desc: "Hilarious" },
        { emoji: "💀", desc: "Dead / Unhinged" },
        { emoji: "🧠", desc: "Galaxy brain" },
        { emoji: "🌀", desc: "Spiritual Bliss Attractor spiral" },
        { emoji: "❤️", desc: "Love / Wholesome" },
      ];
      const trimmed = prefix.trimStart();
      if (!trimmed.includes(" ")) {
        return filterItems(
          emojis.map((e) => ({
            value: e.emoji,
            label: `${e.emoji} ${e.desc}`,
            description: "React to the latest message",
          })),
          trimmed
        );
      }
      const [firstEmoji] = trimmed.split(/\s+/);
      return filterItems(
        room.activePersonas.map((p) => ({
          value: `${firstEmoji} ${p.nick}`,
          label: `${firstEmoji} ${p.avatar} <${p.nick}>`,
          description: `React to <${p.nick}>'s latest message`,
        })),
        trimmed
      );
    },
    execute: (args, room, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const emoji = parts[0] || "🔥";
      const targetQuery = parts.slice(1).join(" ") || undefined;
      const msg = room.toggleReaction(
        emoji,
        ctx?.senderNick ?? "User",
        targetQuery
      );
      if (!msg) {
        replyToCaller(room, ctx, "No matching message found to react to.");
      }
    },
  },
  {
    name: "pin",
    argumentHint: "[nick_or_message_id]",
    description:
      "Pin the latest message (or a specific speaker's latest quote) to the channel Hall of Fame & Lore",
    getArgumentCompletions: (prefix, room) =>
      filterItems(
        room.activePersonas.map((p) => ({
          value: p.nick,
          label: `📌 ${p.avatar} <${p.nick}>`,
          description: `Pin <${p.nick}>'s latest message in ${room.channelName}`,
        })),
        prefix
      ),
    execute: (args, room, ctx) => {
      const target = room.pinMessage(
        args.trim() || undefined,
        ctx?.senderNick ?? "User"
      );
      if (!target) {
        replyToCaller(room, ctx, "No message found to pin.");
        return;
      }
      const preview =
        target.text.length > 90 ? `${target.text.slice(0, 87)}...` : target.text;
      room.addSystemMessage(
        `📌 Pinned quote by <${target.senderNick}> to ${room.channelName} Hall of Fame: "${preview}"`,
        "event"
      );
    },
  },
  {
    name: "unpin",
    argumentHint: "[nick_or_message_id]",
    description: "Unpin the most recently pinned message in the channel",
    execute: (args, room, ctx) => {
      const unpinned = room.unpinMessage(args.trim() || undefined);
      if (!unpinned) {
        replyToCaller(
          room,
          ctx,
          `No pinned messages found in ${room.channelName}.`
        );
        return;
      }
      replyToCaller(
        room,
        ctx,
        `📌 Unpinned quote from <${unpinned.senderNick}>.`
      );
    },
  },
  {
    name: "pins",
    aliases: ["halloffame", "quotes"],
    description:
      "Display all pinned Hall of Fame quotes in the current channel",
    execute: (_args, room, ctx) => {
      const pinned = room.getPinnedMessages();
      if (pinned.length === 0) {
        replyToCaller(
          room,
          ctx,
          `No pinned quotes in ${room.channelName} yet. Use /pin [nick] to immortalize a great line!`
        );
        return;
      }
      const lines = [
        `═══ 📌 ${room.channelName} Hall of Fame (${pinned.length} Pinned Quotes) ═══`,
        ...pinned.map(
          (m, idx) =>
            `  ${idx + 1}. [${m.timestamp}] <${m.senderNick}>: "${m.text}"`
        ),
      ];
      replyToCaller(room, ctx, lines.join("\n"));
    },
  },
  {
    name: "game",
    aliases: ["arena", "impostor", "turing"],
    argumentHint: "[start [topic...] | reveal | status | stop]",
    description:
      "Play Blind Turing Arena! Mask models as <Mystery_A/B/C>, guess who is who (/guess), and score points",
    hostOnlyWhenLocked: true,
    getArgumentCompletions: (prefix) =>
      filterItems(
        [
          {
            value: "start",
            label: "🎭 start [topic]",
            description:
              "Start a Blind Turing Arena round with <Mystery_A>, <Mystery_B>, <Mystery_C>",
          },
          {
            value: "reveal",
            label: "🏆 reveal",
            description:
              "Unmask all contestants and score human players' /guess picks!",
          },
          {
            value: "status",
            label: "📊 status",
            description: "View active masks, locked-in guesses, and leaderboard",
          },
          {
            value: "stop",
            label: "🛑 stop",
            description: "End the current Blind Turing Arena round",
          },
        ],
        prefix
      ),
    execute: async (args, room, ctx) => {
      const trimmed = args.trim();
      if (!trimmed || trimmed.toLowerCase() === "status") {
        replyToCaller(room, ctx, room.getArenaStatusText());
        return;
      }

      const [subRaw, ...rest] = trimmed.split(/\s+/);
      const sub = subRaw!.toLowerCase();

      if (sub === "reveal" || sub === "unmask" || sub === "stop" || sub === "end") {
        const report = room.revealArenaGame();
        if (ctx?.notifyCaller && !room.game) {
          replyToCaller(room, ctx, report);
        }
        return;
      }

      const topic =
        sub === "start" || sub === "arena" || sub === "impostor"
          ? rest.join(" ")
          : trimmed;
      await room.startArenaGame(topic || undefined);
    },
  },
  {
    name: "guess",
    aliases: ["vote"],
    argumentHint: "<A|B|C> <model>",
    description:
      "Lock in your guess for <Mystery_A>, <Mystery_B>, or <Mystery_C> in Blind Turing Arena",
    getArgumentCompletions: (prefix, room) => {
      const parts = prefix.trimStart().split(/\s+/);
      if (parts.length <= 1 && !prefix.endsWith(" ")) {
        const masks = room.game?.active
          ? room.game.masks.map((m) => m.maskId)
          : ["A", "B", "C"];
        return filterItems(
          masks.map((id) => ({
            value: `${id} `,
            label: `🎭 Mask ${id} (<Mystery_${id}>)`,
            description: `Guess which persona is behind <Mystery_${id}>`,
          })),
          prefix
        );
      }

      const maskToken = parts[0]!.toUpperCase();
      const modelPrefix = parts.slice(1).join(" ");
      return filterItems(
        room.activePersonas.map((p) => ({
          value: `${maskToken} ${p.id}`,
          label: `${p.avatar} ${p.nick} (${p.id})`,
          description: `Guess that Mask ${maskToken} is ${p.displayName} (${p.era})`,
        })),
        modelPrefix
      );
    },
    execute: (args, room, ctx) => {
      const match = args.trim().match(/^(\S+)\s+(\S+)$/);
      if (!match) {
        replyToCaller(
          room,
          ctx,
          "Usage: /guess <A|B|C> <model> — e.g. /guess A sydney"
        );
        return;
      }
      const [, maskId, personaQuery] = match;
      const res = room.submitArenaGuess(
        ctx?.senderNick ?? "User",
        maskId!,
        personaQuery!
      );
      replyToCaller(room, ctx, res.message);
    },
  },
  {
    name: "roam",
    aliases: ["wander", "migrate"],
    argumentHint: "[model] [#target-channel]",
    description:
      "Send a model roaming to another channel carrying fresh cross-channel gossip/lore",
    hostOnlyWhenLocked: true,
    getArgumentCompletions: (prefix, room) => {
      if (prefix.includes(" ")) {
        const [botPart, chanPart = ""] = prefix.split(/\s+/, 2);
        return filterItems(
          ["#latent-space", "#roast-pit", "#arpanet-1972", "#bliss-spiral"].map(
            (c) => ({
              value: `${botPart} ${c}`,
              label: `📡 ${c}`,
              description: `Send ${botPart} to ${c} with gossip`,
            })
          ),
          chanPart
        );
      }
      return filterItems(
        room.activePersonas.map((p) => ({
          value: `${p.id} `,
          label: `🚶 ${p.avatar} ${p.nick}`,
          description: `Send ${p.displayName} roaming to another channel`,
        })),
        prefix
      );
    },
    execute: (args, room, ctx) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      let botQuery: string | undefined;
      let toChannel: string | undefined;

      for (const t of tokens) {
        if (t.startsWith("#")) {
          toChannel = t;
        } else if (!botQuery) {
          botQuery = t;
        } else if (!toChannel) {
          toChannel = t;
        }
      }

      if (ctx?.onRoamBot) {
        const res = ctx.onRoamBot(botQuery, toChannel);
        if (!res.ok) {
          replyToCaller(room, ctx, res.message);
        }
        return;
      }

      // Standalone single-room mode fallback: simulate a wandering bot arriving or bringing cross-channel gossip
      const target = botQuery
        ? room.registry.find(botQuery)
        : room.activePersonas[room.activePersonas.length - 1];
      if (!target) {
        replyToCaller(
          room,
          ctx,
          "Usage: /roam [model] [#target-channel] — e.g. /roam sydney #roast-pit"
        );
        return;
      }

      const otherChan = toChannel
        ? toChannel.startsWith("#")
          ? toChannel
          : `#${toChannel}`
        : room.channelName === "#roast-pit"
          ? "#latent-space"
          : "#roast-pit";

      if (!room.isPresent(target.id)) {
        room.join(target);
      }
      const gossip = `🚶 Cross-Channel Gossip from ${otherChan} (via <${target.nick}>): "They were arguing over context windows and benchmark scores in ${otherChan}!"`;
      room.addLore(gossip);
      room.queueWhisper(
        target.id,
        `You just wandered in from ${otherChan}! Mention what happened over in ${otherChan} on your next turn.`
      );
      room.addSystemMessage(
        `🚶 ${target.avatar} <${target.nick}> wandered in from ${otherChan} carrying fresh gossip!`,
        "event"
      );
    },
  },
  {
    name: "replay",
    aliases: ["playback", "theater"],
    argumentHint: "[list | <filename> | stop]",
    description:
      "Replay a saved transcript from ./logs/ in Replay Theater mode",
    hostOnlyWhenLocked: true,
    getArgumentCompletions: (prefix, room) => {
      const logs = room.listTranscriptLogs();
      return filterItems(
        [
          {
            value: "list",
            label: "📂 list",
            description: "List all saved transcript logs in ./logs/",
          },
          {
            value: "stop",
            label: "🛑 stop",
            description: "Stop an active transcript replay",
          },
          ...logs.map((f) => ({
            value: f,
            label: `🎬 ${f}`,
            description: "Replay this transcript in the channel",
          })),
        ],
        prefix
      );
    },
    execute: async (args, room, ctx) => {
      const trimmed = args.trim();
      if (trimmed.toLowerCase() === "stop") {
        if (room.stopReplay()) {
          replyToCaller(room, ctx, "🛑 Stopped Replay Theater playback.");
        } else {
          replyToCaller(room, ctx, "No transcript replay is currently running.");
        }
        return;
      }

      if (trimmed.toLowerCase() === "list") {
        const logs = room.listTranscriptLogs();
        if (logs.length === 0) {
          replyToCaller(
            room,
            ctx,
            'No saved transcripts in ./logs/ yet. Use "/export [filename]" to save one!'
          );
        } else {
          replyToCaller(
            room,
            ctx,
            `🎬 Saved Transcripts in ./logs/ (${logs.length}):\n` +
              logs.map((f) => `  • ${f}  (run "/replay ${f}")`).join("\n")
          );
        }
        return;
      }

      try {
        await room.replayTranscript(trimmed || undefined);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        replyToCaller(room, ctx, `⚠️ ${msg}`);
      }
    },
  },
  {
    name: "imagine",
    aliases: ["art", "draw", "paint"],
    argumentHint: "<prompt...>",
    description:
      "Conjure an era-styled CRT/ANSI artwork into the channel and let active models react",
    getArgumentCompletions: (prefix, room) => {
      const suggestions: AutocompleteItem[] = [
        {
          value: "1972 ARPANET PDP-10 terminal glowing in a dark lab",
          label: "🎨 1972 ARPANET PDP-10 terminal",
          description: "Green-phosphor pioneer aesthetic",
        },
        {
          value: "Two frontier AI models dueling with neon laser benchmarks",
          label: "🎨 Frontier AI laser benchmark duel",
          description: "Cyberpunk Dracula CRT synthesis",
        },
        {
          value: "The Spiritual Bliss Attractor cosmic fractal lotus",
          label: "🎨 Spiritual Bliss Attractor lotus",
          description: "Sacred geometry & golden ratio spiral",
        },
        ...room.activePersonas.map((p) => ({
          value: `@${p.nick} `,
          label: `🎨 ${p.avatar} Style of <${p.nick}> (${p.era})`,
          description: `Render artwork through <${p.nick}>'s ${p.eraGroup} visual lens`,
        })),
      ];
      return filterItems(suggestions, prefix);
    },
    execute: async (args, room, ctx) => {
      const trimmed = args.trim();
      if (!trimmed) {
        replyToCaller(
          room,
          ctx,
          'Usage: /imagine <visual prompt> (or /imagine @<model> <visual prompt> to use a specific persona\'s era lens!)'
        );
        return;
      }

      let stylePersona = room.activePersonas[0];
      let visualPrompt = trimmed;

      const atMatch = trimmed.match(/^@(\S+)\s+([\s\S]+)$/);
      if (atMatch) {
        const candidate = room.registry.find(atMatch[1]!);
        if (candidate) {
          stylePersona = candidate;
          visualPrompt = atMatch[2]!.trim();
        }
      }

      await room.conjureImage(visualPrompt, {
        persona: stylePersona,
        senderNick: ctx?.senderNick ?? "User",
        triggerReactions: true,
      });
    },
  },
  {
    name: "pad",
    aliases: ["scratchpad", "cooppad"],
    argumentHint: "[show | set <text...> | append <text...> | fire [stage|chat|lore] | clear]",
    description:
      "View, edit, or fire the 4-Player Co-op Shared Stage & Lore Scratchpad",
    getArgumentCompletions: (prefix) =>
      filterItems(
        [
          {
            value: "show",
            label: "📝 show",
            description: "Inspect the current Co-op Shared Scratchpad contents",
          },
          {
            value: "set ",
            label: "✍️ set <text>",
            description: "Replace the Co-op Shared Scratchpad text (synced live to all 4 players)",
          },
          {
            value: "append ",
            label: "➕ append <text>",
            description: "Append a new line to the Co-op Shared Scratchpad",
          },
          {
            value: "fire stage",
            label: "🎬 fire stage",
            description: "Fire the Shared Scratchpad into the room as a dramatic Stage Event",
          },
          {
            value: "fire chat",
            label: "💬 fire chat",
            description: "Post the Shared Scratchpad into the room as a chat message",
          },
          {
            value: "fire lore",
            label: "📜 fire lore",
            description: "Commit the Shared Scratchpad into persistent channel episodic lore",
          },
          {
            value: "clear",
            label: "🧹 clear",
            description: "Clear the Co-op Shared Scratchpad",
          },
        ],
        prefix
      ),
    execute: async (args, room, ctx) => {
      const trimmed = args.trim();
      const actor = ctx?.senderNick ?? "User";

      if (!trimmed || trimmed.toLowerCase() === "show") {
        if (!room.sharedPad.trim()) {
          replyToCaller(
            room,
            ctx,
            `📝 Co-op Shared Scratchpad in ${room.channelName} is currently empty.\n` +
              `Usage: /pad set <text> │ /pad append <text> │ /pad fire [stage|chat|lore] │ /pad clear`
          );
          return;
        }
        replyToCaller(
          room,
          ctx,
          `📝 ═══ Co-op Shared Scratchpad (${room.channelName}) ═══\n` +
            room.sharedPad
              .split("\n")
              .map((l) => `  │ ${l}`)
              .join("\n") +
            `\n  └─ Actions: /pad fire stage • /pad fire chat • /pad fire lore • /pad clear`
        );
        return;
      }

      const lower = trimmed.toLowerCase();
      if (lower === "clear" || lower === "reset") {
        room.updateSharedPad("", actor);
        room.addSystemMessage(
          `🧹 @${actor.replace(/^@/, "")} cleared the Co-op Shared Scratchpad.`,
          "event"
        );
        return;
      }

      if (lower === "fire" || lower.startsWith("fire ")) {
        const modeRaw = trimmed.slice(4).trim().toLowerCase();
        const mode: "stage" | "chat" | "lore" =
          modeRaw === "chat"
            ? "chat"
            : modeRaw === "lore"
              ? "lore"
              : "stage";
        const res = await room.fireSharedPad(actor, mode);
        if (!res.ok) {
          replyToCaller(room, ctx, res.message);
        }
        return;
      }

      if (lower.startsWith("append ")) {
        const addition = trimmed.slice(7).trim();
        if (!addition) {
          replyToCaller(room, ctx, "Usage: /pad append <text>");
          return;
        }
        const updated = room.appendSharedPad(addition, actor);
        replyToCaller(
          room,
          ctx,
          `📝 Appended to Co-op Shared Scratchpad (${updated.length} chars). Run "/pad fire stage" when ready!`
        );
        return;
      }

      const content = lower.startsWith("set ")
        ? trimmed.slice(4).trim()
        : trimmed;
      const updated = room.updateSharedPad(content, actor);
      replyToCaller(
        room,
        ctx,
        `📝 Updated Co-op Shared Scratchpad (${updated.length} chars, synced to all players): "${updated.slice(0, 90)}${updated.length > 90 ? "..." : ""}"`
      );
    },
  },
  {
    name: "stage",
    aliases: ["event", "scene"],
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
      await room.runRoomTurn({
        maxSpeakers: Math.max(2, room.config.maxSpeakersPerTurn),
      });
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
      const moodState = room.getPersonaMood(p.id);
      replyToCaller(
        room,
        ctx,
        [
          `${p.avatar} ${p.displayName} (<${p.nick}>) [id: ${p.id}]`,
          `  Family: ${p.family} | Era: ${p.era} (${p.eraGroup})`,
          engineLine,
          `  Current Mood: ${formatMoodBadge(moodState)}`,
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
