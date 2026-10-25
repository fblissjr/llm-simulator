import type {
  EditorTheme,
  MarkdownTheme,
  SelectListTheme,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import type { ChatMessage } from "../types.ts";
import type { Room } from "../core/room.ts";

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

export function renderIrcHeader(room: Room): string {
  const title = chalk.bgHex("#282a36").hex("#50fa7b").bold(` ${room.channelName} `);
  const vibeBadge = chalk
    .hex("#ffb86c")
    .bold(`Vibe: ${room.vibeKey.toUpperCase()}`);
  const engineBadge = chalk
    .hex("#8be9fd")(`Engine: ${room.gemini.activeModel}`);
  const apiStatus = room.gemini.isConfigured()
    ? chalk.hex("#50fa7b")("● ONLINE")
    : chalk.hex("#ff5555")("○ NO API KEY");

  const nicks = [
    chalk.hex("#50fa7b").bold("@User"),
    ...room.activePersonas.map((p) =>
      chalk.hex(p.color || "#8be9fd").bold(`${p.avatar} <${p.nick}>`)
    ),
  ].join("  ");

  const topLine = `${chalk.hex("#6272a4")("╔══")}${title}${chalk.hex("#6272a4")("══╡")} ${vibeBadge} ${chalk.hex("#6272a4")("│")} ${engineBadge} ${chalk.hex("#6272a4")("│")} ${apiStatus}`;
  const rosterLine = `${chalk.hex("#6272a4")("╠══")} ${chalk.dim(
    `In Room [${room.activePersonas.length + 1}]:`
  )} ${nicks}`;
  const hintLine = `${chalk.hex("#6272a4")("╚══")} ${chalk.dim(
    "Commands: /summon <model> • /banish <model> • /vibe <mode> • /banter • /roster • /stage • /whisper • /help"
  )}`;

  return `${topLine}\n${rosterLine}\n${hintLine}`;
}

export function formatChatMessage(msg: ChatMessage): string {
  const ts = chalk.hex("#6272a4")(`[${msg.timestamp}]`);

  if (msg.kind === "event") {
    return `${ts} ${chalk.hex("#f1fa8c")("***")} ${chalk.hex("#f8f8f2")(msg.text)}`;
  }

  if (msg.kind === "system") {
    return `${ts} ${chalk.hex("#8be9fd").bold("[SYS]")} ${chalk.hex("#d8dee9")(msg.text)}`;
  }

  if (msg.kind === "user") {
    return `${ts} ${chalk.hex("#50fa7b").bold("<@User>")} ${chalk.hex("#f8f8f2")(msg.text)}`;
  }

  const nickColor = chalk.hex(msg.color || "#8be9fd").bold;
  const avatar = msg.avatar ? `${msg.avatar} ` : "";
  const familyMeta = msg.familyTag
    ? ` ${chalk.hex("#6272a4")(`[${msg.familyTag}]`)}`
    : "";
  const streamingCursor = msg.streaming ? chalk.hex("#50fa7b")(" ▍") : "";

  const parts: string[] = [];
  parts.push(`${ts} ${nickColor(`<${avatar}${msg.senderNick}>`)}${familyMeta}`);

  if (msg.thinking) {
    const thoughtLines = msg.thinking
      .split("\n")
      .map((line) => `    ${chalk.hex("#6272a4").italic(`💭 ${line}`)}`)
      .join("\n");
    parts.push(thoughtLines);
  }

  if (msg.text) {
    parts.push(`  ${msg.text}${streamingCursor}`);
  } else if (msg.streaming) {
    parts.push(`  ${chalk.dim("...")}${streamingCursor}`);
  }

  return parts.join("\n");
}
