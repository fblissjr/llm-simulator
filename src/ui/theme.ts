import type {
  EditorTheme,
  MarkdownTheme,
  SelectListTheme,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import type { Room } from "../core/room.ts";
import type { ChatMessage, ThinkingDisplayMode } from "../types.ts";

export const selectListTheme: SelectListTheme = {
  selectedPrefix: (t) => chalk.hex("#50fa7b").bold(t),
  selectedText: (t) => chalk.hex("#f8f8f2").bold(t),
  description: (t) => chalk.hex("#6272a4")(t),
  scrollInfo: (t) => chalk.dim(t),
  noMatch: (t) => chalk.hex("#ff5555")(t),
};

export const editorTheme: EditorTheme = {
  borderColor: (t) => chalk.hex("#6272a4")(t),
  selectList: selectListTheme,
};

export const markdownTheme: MarkdownTheme = {
  heading: (t) => chalk.hex("#bd93f9").bold(t),
  link: (t) => chalk.hex("#8be9fd").underline(t),
  linkUrl: (t) => chalk.dim(t),
  code: (t) => chalk.hex("#f1fa8c")(t),
  codeBlock: (t) => chalk.hex("#f8f8f2")(t),
  codeBlockBorder: (t) => chalk.hex("#6272a4")(t),
  quote: (t) => chalk.hex("#8be9fd").italic(t),
  quoteBorder: (t) => chalk.hex("#6272a4")(t),
  hr: (t) => chalk.hex("#6272a4")(t),
  listBullet: (t) => chalk.hex("#50fa7b")(t),
  bold: (t) => chalk.bold(t),
  italic: (t) => chalk.italic(t),
  strikethrough: (t) => chalk.strikethrough(t),
  underline: (t) => chalk.underline(t),
};

export interface HeaderRenderOptions {
  selfNick?: string;
  locked?: boolean;
  shareUrl?: string | null;
  localInviteUrl?: string;
  maxHumans?: number;
  apiOnline?: boolean;
}

export function renderIrcHeader(
  room: Room,
  opts?: HeaderRenderOptions
): string {
  const title = chalk
    .bgHex("#282a36")
    .hex("#50fa7b")
    .bold(` ${room.channelName} `);
  const lockIcon = opts?.locked ? chalk.hex("#ff5555")(" 🔒") : "";
  const vibeBadge =
    chalk.hex("#ffb86c").bold(`Vibe: ${room.vibeKey.toUpperCase()}`) + lockIcon;
  const ambientDot = room.config.ambientEnabled ? "⚡" : "○";
  const paceBadge = chalk.hex("#ff79c6")(
    `Pace: ${room.config.preset.toUpperCase()}${ambientDot}`
  );
  const engineBadge = chalk.hex("#8be9fd")(
    `Engine: ${room.gemini.activeEngineLabel}`
  );
  const isOnline = opts?.apiOnline ?? room.gemini.isConfigured();
  const apiStatus = isOnline
    ? chalk.hex("#50fa7b")("● ONLINE")
    : chalk.hex("#ff5555")("○ NO API KEY");

  const maxH = opts?.maxHumans ?? 4;
  const humanList =
    room.humans.length > 0
      ? room.humans
      : [{ nick: opts?.selfNick ?? "User", isHost: true, channel: room.channelName }];

  const humanTags = humanList
    .map((h) => {
      const star = h.isHost ? "★" : "";
      const isMe =
        opts?.selfNick && h.nick.toLowerCase() === opts.selfNick.toLowerCase();
      return isMe
        ? chalk.hex("#50fa7b").bold(`@${h.nick}${star}`)
        : chalk.hex("#8be9fd")(`@${h.nick}${star}`);
    })
    .join("  ");

  const bindings = room.gemini.getAllPersonaBindings();
  const botTags =
    room.activePersonas
      .map((p) => {
        const b = bindings[p.id.toLowerCase()];
        const via = b ? chalk.dim(`(${b.provider}:${b.model})`) : "";
        return (
          chalk.hex(p.color || "#8be9fd").bold(`${p.avatar} <${p.nick}>`) + via
        );
      })
      .join("  ") || chalk.dim("(none — use /summon)");

  const topLine = `${chalk.hex("#6272a4")("╔══")}${title}${chalk.hex("#6272a4")("══╡")} ${vibeBadge} ${chalk.hex("#6272a4")("│")} ${paceBadge} ${chalk.hex("#6272a4")("│")} ${engineBadge} ${chalk.hex("#6272a4")("│")} ${chalk.hex("#f1fa8c")(`Co-op [${humanList.length}/${maxH}]`)} ${chalk.hex("#6272a4")("│")} ${apiStatus}`;
  const rosterLine = `${chalk.hex("#6272a4")("╠══")} ${chalk.dim("Humans:")} ${humanTags} ${chalk.hex("#6272a4")("│")} ${chalk.dim(`AIs [${room.activePersonas.length}]:`)} ${botTags}`;

  const inviteInfo = opts?.shareUrl
    ? `${chalk.hex("#50fa7b")("🌍 Public Invite:")} ${chalk.underline(opts.shareUrl)}`
    : opts?.localInviteUrl
      ? `${chalk.dim("LAN Browser Invite:")} ${chalk.hex("#8be9fd")(opts.localInviteUrl)} ${chalk.dim("(/share for public link)")}`
      : chalk.dim(
          "Commands: /summon • /config • /scenario • /vibe • /me • /slap • /share • /help"
        );

  const hintLine = `${chalk.hex("#6272a4")("╚══")} ${inviteInfo}`;

  return `${topLine}\n${rosterLine}\n${hintLine}`;
}

function styleInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_m, code) => chalk.hex("#f1fa8c")(`\`${code}\``))
    .replace(/\*\*([^*]+)\*\*/g, (_m, bold) => chalk.bold(bold));
}

export function formatChatMessage(
  msg: ChatMessage,
  opts?: { thinkingDisplay?: ThinkingDisplayMode }
): string {
  const ts = chalk.hex("#6272a4")(`[${msg.timestamp}]`);

  if (msg.kind === "event") {
    return `${ts} ${chalk.hex("#f1fa8c")("***")} ${chalk.hex("#f8f8f2")(msg.text)}`;
  }

  if (msg.kind === "system") {
    return `${ts} ${chalk.hex("#8be9fd").bold("[SYS]")} ${chalk.hex("#d8dee9")(msg.text)}`;
  }

  if (msg.kind === "emote") {
    const nickTag = msg.senderNick.startsWith("@")
      ? msg.senderNick
      : `@${msg.senderNick}`;
    return `${ts} ${chalk.hex(msg.color || "#ff79c6").italic(`* ${nickTag} ${msg.text}`)}`;
  }

  if (msg.kind === "user") {
    const nickTag = msg.senderNick.startsWith("@")
      ? msg.senderNick
      : `@${msg.senderNick}`;
    return `${ts} ${chalk.hex("#50fa7b").bold(`<${nickTag}>`)} ${chalk.hex("#f8f8f2")(msg.text)}`;
  }

  const nickColor = chalk.hex(msg.color || "#8be9fd").bold;
  const avatar = msg.avatar ? `${msg.avatar} ` : "";
  const familyMeta = msg.familyTag
    ? ` ${chalk.hex("#6272a4")(`[${msg.familyTag}]`)}`
    : "";
  const streamingCursor = msg.streaming ? chalk.hex("#50fa7b")(" ▍") : "";

  const parts: string[] = [];
  parts.push(`${ts} ${nickColor(`<${avatar}${msg.senderNick}>`)}${familyMeta}`);

  const thinkingMode = opts?.thinkingDisplay ?? "expanded";
  if (msg.thinking && thinkingMode !== "hidden") {
    const rawLines = msg.thinking.split("\n");
    if (
      thinkingMode === "compact" &&
      !msg.streaming &&
      (rawLines.length > 2 || msg.thinking.length > 140)
    ) {
      const firstLine = rawLines[0]!.trim().slice(0, 85);
      parts.push(
        `    ${chalk.hex("#6272a4").italic(`💭 [${rawLines.length} lines: "${firstLine}..." • Ctrl+T to expand]`)}`
      );
    } else {
      const thoughtLines = rawLines
        .map((line) => `    ${chalk.hex("#6272a4").italic(`💭 ${line}`)}`)
        .join("\n");
      parts.push(thoughtLines);
    }
  } else if (msg.thinking && thinkingMode === "hidden" && msg.streaming && !msg.text) {
    parts.push(`    ${chalk.hex("#6272a4").italic("💭 thinking...")}`);
  }

  if (msg.text) {
    parts.push(`  ${styleInlineMarkdown(msg.text)}${streamingCursor}`);
  } else if (msg.streaming) {
    parts.push(`  ${chalk.dim("...")}${streamingCursor}`);
  }

  return parts.join("\n");
}
