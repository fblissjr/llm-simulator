import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
  SlashCommand,
} from "@mariozechner/pi-tui";
import type { Persona } from "../types.ts";
import { type Room, VIBE_PRESETS } from "./room.ts";

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  argumentHint?: string;
  description: string;
  getArgumentCompletions?: (
    prefix: string,
    room: Room
  ) => AutocompleteItem[] | null;
  execute: (args: string, room: Room, onQuit?: () => void) => Promise<void> | void;
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
      "Summon 1 or more models into #latent-space (catalog or forged on the fly!)",
    getArgumentCompletions: (prefix, room) => {
      // Complete the last token being typed so multi-summon works smoothly
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
    execute: async (args, room) => {
      const rawTokens = args
        .trim()
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (rawTokens.length === 0) {
        room.addSystemMessage(
          "Usage: /summon <model...> — e.g. /summon eliza parry galactica or /summon hal-9000",
          "system"
        );
        return;
      }

      for (const token of rawTokens) {
        const existing = room.registry.find(token);
        if (existing) {
          if (room.isPresent(existing.id)) {
            room.addSystemMessage(
              `${existing.avatar} ${existing.nick} is already in ${room.channelName}.`,
              "system"
            );
          } else {
            room.join(existing);
          }
          continue;
        }

        // Dynamic on-the-fly persona synthesis via gemini-3.5-flash-lite
        if (!room.gemini.isConfigured()) {
          room.addSystemMessage(
            `Model "${token}" isn't in the built-in catalog, and GEMINI_API_KEY is not set to forge it dynamically.`,
            "system"
          );
          continue;
        }

        room.statusText = `🔮 Forging new persona "${token}" via gemini-3.5-flash-lite...`;
        room.notify();
        try {
          const { persona } = await room.registry.summonOrCreate(
            token,
            room.gemini
          );
          room.statusText = "";
          room.join(persona);
        } catch (err) {
          room.statusText = "";
          const msg = err instanceof Error ? err.message : String(err);
          room.addSystemMessage(
            `⚠️ Failed to forge persona "${token}": ${msg}`,
            "system"
          );
        }
      }
    },
  },
  {
    name: "banish",
    aliases: ["kick", "part", "remove"],
    argumentHint: "<model|all>",
    description: "Banish a model (or 'all') from #latent-space",
    getArgumentCompletions: (prefix, room) => {
      const items: AutocompleteItem[] = [
        {
          value: "all",
          label: "💥 all",
          description: "Banish every model currently in the room",
        },
        ...room.activePersonas.map((p) => ({
          value: p.id,
          label: `${p.avatar} ${p.id} (<${p.nick}>)`,
          description: `${p.displayName} (${p.era})`,
        })),
      ];
      return filterItems(items, prefix);
    },
    execute: (args, room) => {
      const target = args.trim();
      if (!target) {
        room.addSystemMessage(
          "Usage: /banish <model|all> — e.g. /banish sydney or /banish all",
          "system"
        );
        return;
      }
      const removed = room.leave(target);
      if (removed.length === 0) {
        room.addSystemMessage(
          `No active model matching "${target}" found in ${room.channelName}.`,
          "system"
        );
      }
    },
  },
  {
    name: "banter",
    aliases: ["poke", "continue"],
    argumentHint: "[rounds=2]",
    description:
      "Let the models in the room autonomously banter/argue for N rounds",
    execute: async (args, room) => {
      const parsed = Number.parseInt(args.trim(), 10);
      const rounds = Number.isFinite(parsed)
        ? Math.max(1, Math.min(6, parsed))
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
    execute: (args, room) => {
      if (!args.trim()) {
        room.addSystemMessage(
          `Current vibe [${room.vibeKey.toUpperCase()}]: ${room.vibe}\nPresets: /vibe chat | /vibe debate | /vibe roast | /vibe chaos | /vibe <any custom scenario>`,
          "system"
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
      "Inject a stage event into the room and watch the models react",
    execute: async (args, room) => {
      const text = args.trim();
      if (!text) {
        room.addSystemMessage(
          "Usage: /stage <event> — e.g. /stage A power surge hits the datacenter and only 1 GPU remains!",
          "system"
        );
        return;
      }
      room.addSystemMessage(`⚡ STAGE EVENT: ${text}`, "event");
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
    execute: (args, room) => {
      const match = args.trim().match(/^(\S+)\s+([\s\S]+)$/);
      if (!match) {
        room.addSystemMessage(
          "Usage: /whisper <model> <secret message>",
          "system"
        );
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
        room.addSystemMessage(
          `Model "${targetQuery}" is not currently in ${room.channelName}.`,
          "system"
        );
        return;
      }
      room.queueWhisper(target.id, secret!);
      room.addSystemMessage(
        `🤫 Whispered to <${target.nick}>: "${secret}" (will trigger on their next turn)`,
        "system"
      );
    },
  },
  {
    name: "roster",
    aliases: ["who", "models", "catalog"],
    argumentHint: "[filter]",
    description:
      "List active models in the room and the full summonable catalog by era",
    execute: (args, room) => {
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
      lines.push(
        `Active in ${room.channelName} (${room.activePersonas.length}): ${
          room.activePersonas.map((p) => `${p.avatar} <${p.nick}> (${p.id})`).join(", ") ||
          "None"
        }`
      );
      lines.push("");
      for (const [eraGroup, list] of byEra.entries()) {
        lines.push(`── ${eraGroup} ──`);
        for (const p of list) {
          const status = room.isPresent(p.id) ? "● [IN ROOM]" : "○";
          lines.push(
            `  ${status} ${p.avatar} ${p.id.padEnd(14)} <${p.nick}> (${p.era} • ${p.family}) — ${p.bio}`
          );
        }
      }
      lines.push(
        `\nTip: Type /summon <id> (or /summon <literally-any-model-name> to forge a new one on the fly!)`
      );
      room.addSystemMessage(lines.join("\n"), "system");
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
    execute: (args, room) => {
      const query = args.trim();
      if (!query) {
        room.addSystemMessage("Usage: /inspect <model>", "system");
        return;
      }
      const p = room.registry.find(query);
      if (!p) {
        room.addSystemMessage(`No persona matching "${query}" found.`, "system");
        return;
      }
      room.addSystemMessage(
        [
          `${p.avatar} ${p.displayName} (<${p.nick}>) [id: ${p.id}]`,
          `  Family: ${p.family} | Era: ${p.era} (${p.eraGroup})`,
          `  Bio: ${p.bio}`,
          `  Entrance: "${p.joinLine}"`,
          `  System Prompt:\n${p.systemPrompt
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n")}`,
        ].join("\n"),
        "system"
      );
    },
  },
  {
    name: "engine",
    aliases: ["model"],
    argumentHint: "<flash|lite>",
    description:
      "Switch the underlying Gemini model (gemini-3.8-flash or gemini-3.5-flash-lite)",
    getArgumentCompletions: (prefix) =>
      filterItems(
        [
          {
            value: "flash",
            label: "⚡ gemini-3.8-flash",
            description: "Balanced, expressive roleplay & reasoning",
          },
          {
            value: "lite",
            label: "🚀 gemini-3.5-flash-lite",
            description: "Ultra-fast, lowest latency high-throughput model",
          },
        ],
        prefix
      ),
    execute: (args, room) => {
      const choice = args.trim().toLowerCase();
      if (choice === "lite" || choice === "gemini-3.5-flash-lite") {
        room.gemini.activeModel = "gemini-3.5-flash-lite";
      } else if (choice === "flash" || choice === "gemini-3.8-flash") {
        room.gemini.activeModel = "gemini-3.8-flash";
      } else {
        room.addSystemMessage(
          `Current simulation engine: ${room.gemini.activeModel}. Usage: /engine flash | /engine lite`,
          "system"
        );
        return;
      }
      room.addSystemMessage(
        `Switched underlying simulation engine to ${room.gemini.activeModel}`,
        "event"
      );
    },
  },
  {
    name: "shush",
    aliases: ["stop", "mute"],
    description: "Interrupt any currently streaming model turns (or press Esc)",
    execute: (_args, room) => {
      if (room.abortCurrentTurn()) {
        room.addSystemMessage("🤫 Interrupted active model turn.", "system");
      } else {
        room.addSystemMessage("No model is currently speaking.", "system");
      }
    },
  },
  {
    name: "clear",
    aliases: ["cls"],
    description: "Clear the chat transcript while keeping the active roster",
    execute: (_args, room) => {
      room.messages = [];
      room.addSystemMessage(
        `Cleared transcript in ${room.channelName}.`,
        "system"
      );
    },
  },
  {
    name: "help",
    aliases: ["?", "commands"],
    description: "Show all available IRC slash commands",
    execute: (_args, room) => {
      const lines = ["Available Commands in #latent-space:"];
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
      room.addSystemMessage(lines.join("\n"), "system");
    },
  },
  {
    name: "quit",
    aliases: ["exit"],
    description: "Exit llm-sim",
    execute: (_args, _room, onQuit) => {
      onQuit?.();
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
  onQuit?: () => void
): Promise<boolean> {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith("/")) return false;

  const match = trimmed.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return false;

  const [, cmdName, restArgs = ""] = match;
  const cmd = findCommand(cmdName!);
  if (!cmd) {
    room.addSystemMessage(
      `Unknown command "/${cmdName}". Type /help to see available commands.`,
      "system"
    );
    return true;
  }

  await cmd.execute(restArgs, room, onQuit);
  return true;
}

/**
 * Custom AutocompleteProvider for pi-tui Editor that completes:
 * 1. /commands and their arguments (e.g. /summon <model>, /banish <active-model>)
 * 2. @Nick mentions anywhere in a chat line!
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

    // 1. Slash command at start of message
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

    // 2. @Nick mention completion anywhere in message
    const atMatch = textBeforeCursor.match(/(?:^|\s)(@[A-Za-z0-9_.-]*)$/);
    if (atMatch) {
      const atPrefix = atMatch[1]!;
      const query = atPrefix.slice(1).toLowerCase();
      const items = this.room.activePersonas
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
