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
import {
  editorTheme,
  formatChatMessage,
  renderIrcHeader,
} from "./theme.ts";

export class ChatroomApp {
  private terminal: ProcessTerminal;
  private tui: TUI;
  private room: Room;

  private headerView: Text;
  private feedView: Text;
  private statusView: Text;
  private editor: Editor;

  constructor(room?: Room) {
    this.room = room ?? new Room();
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
    this.seedWelcomeMessage();
    this.syncViews();

    this.room.subscribe(() => {
      this.syncViews();
    });
  }

  private seedWelcomeMessage(): void {
    const starterList = this.room.activePersonas
      .map((p) => `${p.avatar} <${p.nick}> (${p.era})`)
      .join(", ");

    this.room.addSystemMessage(
      `Welcome to ${this.room.channelName} — The Multi-Era LLM Simulation Chatroom (1966–2026)!\n` +
        `  Currently in channel: ${starterList}\n` +
        `  • Type a message (or @Nick) to chat with the room.\n` +
        `  • Use /summon <model> to summon ANY historical, modern, or fictional AI (e.g. /summon eliza parry galactica deepseek-r1).\n` +
        `  • Use /banish <model>, /vibe <chat|debate|roast|chaos>, /banter, /stage <event>, /whisper <model> <secret>, or /roster.`,
      "system"
    );
  }

  private setupHandlers(): void {
    this.editor.onSubmit = (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;

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

      if (matchesKey(data, "escape") && !this.editor.isShowingAutocomplete()) {
        if (this.room.abortCurrentTurn()) {
          this.room.addSystemMessage(
            "🤫 Interrupted active model turn (Esc).",
            "system"
          );
          return { consume: true };
        }
      }

      return undefined;
    });
  }

  private async processInput(text: string): Promise<void> {
    if (text.startsWith("/")) {
      await handleSlashCommand(text, this.room, () => this.quit());
      return;
    }

    await this.room.postUserMessage(text);
  }

  private syncViews(): void {
    this.headerView.setText(renderIrcHeader(this.room));

    const renderedMessages = this.room.messages
      .slice(-40)
      .map((m) => formatChatMessage(m))
      .join("\n\n");

    this.feedView.setText(
      renderedMessages ? `\n${renderedMessages}\n` : "\n"
    );

    if (this.room.statusText) {
      this.statusView.setText(
        chalk.hex("#f1fa8c")(`  ⏳ ${this.room.statusText}`)
      );
    } else {
      this.statusView.setText(
        chalk.hex("#6272a4")(
          "  ── Type a message or /command (Tab: autocomplete • Esc: shush • Ctrl+C: quit) ──"
        )
      );
    }

    this.tui.requestRender();
  }

  public start(): void {
    this.tui.start();
  }

  public quit(): void {
    this.room.abortCurrentTurn();
    this.tui.stop();
    process.exit(0);
  }
}
