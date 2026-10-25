import os from "node:os";
import chalk from "chalk";
import { InferenceRouter } from "./engine/gemini.ts";
import { ChannelHub } from "./server/hub.ts";
import { getLocalLanIp } from "./server/tunnel.ts";
import type { ProviderId } from "./types.ts";
import { ChatroomApp } from "./ui/app.ts";

interface CliOptions {
  mode: "host" | "server" | "connect";
  port: number;
  nick: string;
  channel: string;
  share: boolean;
  provider?: ProviderId;
  model?: string;
  passkey?: string;
  dbPath?: string;
  connectUrl?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const defaultNick =
    process.env.USER || os.userInfo().username || "player1";
  const opts: CliOptions = {
    mode: "host",
    port: Number(process.env.PORT) || 4321,
    nick: defaultNick,
    channel: "#latent-space",
    share: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "server" || arg === "--server") {
      opts.mode = "server";
    } else if (arg === "connect" || arg === "--connect") {
      opts.mode = "connect";
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        opts.connectUrl = next;
        i++;
      }
    } else if (
      (arg.startsWith("ws://") ||
        arg.startsWith("wss://") ||
        arg.startsWith("http://") ||
        arg.startsWith("https://")) &&
      !opts.connectUrl
    ) {
      opts.mode = "connect";
      opts.connectUrl = arg;
    } else if (arg === "--port" || arg === "-p") {
      opts.port = Number(argv[++i]) || 4321;
    } else if (arg === "--nick" || arg === "-n") {
      opts.nick = argv[++i] || defaultNick;
    } else if (arg === "--channel" || arg === "-c") {
      opts.channel = argv[++i] || "#latent-space";
    } else if (arg === "--provider") {
      opts.provider = argv[++i];
    } else if (arg === "--model" || arg === "-m") {
      opts.model = argv[++i];
    } else if (arg === "--key" || arg === "--passkey") {
      opts.passkey = argv[++i];
    } else if (arg === "--db") {
      opts.dbPath = argv[++i];
    } else if (arg === "--share") {
      opts.share = true;
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.mode === "connect") {
    if (!opts.connectUrl) {
      console.error(
        chalk.red(
          "Usage: bun run connect <ws-or-http-invite-url> [--nick <name>] [--channel <#channel>]"
        )
      );
      process.exit(1);
    }

    const app = new ChatroomApp({
      wsUrl: opts.connectUrl,
      nick: opts.nick,
      channel: opts.channel,
    });
    app.start();
    return;
  }

  const router = new InferenceRouter({
    provider: opts.provider,
    model: opts.model,
  });

  if (router.activeProvider === "heylook" || !router.isConfigured()) {
    await router.autoDetectLocalProviders();
  }

  const hub = new ChannelHub({
    dbPath: opts.dbPath,
    passkey: opts.passkey,
    gemini: router,
  });

  let port = opts.port;
  try {
    port = hub.start(opts.port);
  } catch {
    port = hub.start(0);
  }

  if (opts.share) {
    await hub.tunnel.start(port, hub.passkey);
  }

  if (opts.mode === "server") {
    const lanIp = getLocalLanIp();
    console.log(
      chalk.hex("#50fa7b").bold("\n═══ #latent-space 4-Player Co-op Server Online ═══")
    );
    console.log(
      `  • ${chalk.bold("Active Inference Engine:")}        ${chalk.magenta(router.activeEngineLabel)}`
    );
    console.log(
      `  • ${chalk.bold("Local Browser UI (Zero-Install):")} ${chalk.cyan(hub.localInviteUrl)}`
    );
    if (hub.tunnel.publicUrl) {
      console.log(
        `  • ${chalk.bold("🌍 Public Browser Invite Link:")}   ${chalk.green.underline(hub.tunnel.publicUrl)}`
      );
    }
    console.log(
      `  • ${chalk.bold("Terminal CLI Join Command:")}      ${chalk.yellow(`bun run connect ws://${lanIp}:${port}/ws?key=${hub.passkey} --nick friend`)}`
    );
    console.log(
      `  • ${chalk.bold("SQLite History Database:")}        ${chalk.dim(opts.dbPath ?? "llm-sim.db")}`
    );
    console.log(
      chalk.dim("\nPress Ctrl+C to stop the server.\n")
    );
    return;
  }

  const app = new ChatroomApp({
    hub,
    nick: opts.nick,
    channel: opts.channel,
  });
  app.start();
}

void main();
