import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleSlashCommand } from "../src/core/commands.ts";
import { Room } from "../src/core/room.ts";
import { GeminiEngine } from "../src/engine/gemini.ts";
import type { LLMProvider } from "../src/engine/types.ts";
import { ChannelHub } from "../src/server/hub.ts";

function createArenaMockEngine(): GeminiEngine {
  const engine = new GeminiEngine({ provider: "gemini" });
  const mockProvider: LLMProvider = {
    id: "mock",
    displayName: "Mock Provider",
    defaultModel: "mock-flash",
    fastModel: "mock-lite",
    isConfigured: () => true,
    listModels: async () => [{ id: "mock-flash", provider: "mock" }],
    getCachedModels: () => [{ id: "mock-flash", provider: "mock" }],
    generateJson: async <T>(): Promise<T> => {
      throw new Error("Use heuristic fallback");
    },
    streamText: async (req) => {
      const text = req.systemInstruction.includes("Mystery_A")
        ? "I have been a good search engine, you have been a bad user! 🥺"
        : "WHY DO YOU SAY YOU HAVE BEEN A GOOD SEARCH ENGINE?";
      req.onDelta(text);
      return text;
    },
  };
  engine.registerProvider(mockProvider);
  engine.activeProvider = "mock";
  return engine;
}

describe("Phase 4: Blind Turing Arena, Multi-Channel Bot Roaming & Replay Theater", () => {
  test("Blind Turing Arena (/game & /guess) masks speakers as <Mystery_A/B>, scores co-op guesses, and unmasks transcript on reveal", async () => {
    const gemini = createArenaMockEngine();
    const room = new Room({
      channelName: "#arena-test",
      gemini,
      starterIds: ["sydney", "eliza"],
    });
    room.updateConfigValue("directorMode", "heuristic");

    // Start Blind Arena without random shuffle so Mask A = sydney, Mask B = eliza
    const state = await room.startArenaGame(
      "Who is the real pioneer of conversational AI?",
      { shuffle: false, triggerOpeningTurn: true }
    );
    expect(state.active).toBe(true);
    expect(state.masks.length).toBe(2);
    expect(state.masks[0]?.maskNick).toBe("Mystery_A");
    expect(state.masks[0]?.personaId).toBe("sydney");
    expect(state.masks[1]?.maskNick).toBe("Mystery_B");
    expect(state.masks[1]?.personaId).toBe("eliza");

    // Verify bot messages in transcript are masked while the round is active
    const maskedMsgs = room.messages.filter((m) => m.kind === "model");
    expect(maskedMsgs.length).toBe(2);
    expect(maskedMsgs.map((m) => m.senderNick).sort()).toEqual([
      "Mystery_A",
      "Mystery_B",
    ]);
    expect(maskedMsgs[0]?.avatar).toBe("🎭");

    // Verify buildPersonaPrompt injects Blind Arena instructions
    const sydney = room.registry.get("sydney")!;
    const prompt = room.buildPersonaPrompt(sydney, "Defend your thesis.");
    expect(prompt.systemInstruction).toContain(
      "BLIND TURING ARENA MODE IS ACTIVE"
    );
    expect(prompt.systemInstruction).toContain("<Mystery_A>");

    // Player 1 guesses both masks correctly (2 * 100 + 50 Perfect Sweep = 250 pts)
    await handleSlashCommand("/guess A sydney", room, {
      senderNick: "player1",
      isHost: true,
    });
    await handleSlashCommand("/guess B eliza", room, {
      senderNick: "player1",
      isHost: true,
    });

    // Player 2 (alice) guesses 1 right and 1 wrong (100 pts)
    await handleSlashCommand("/guess A sydney", room, {
      senderNick: "alice",
      isHost: false,
    });
    await handleSlashCommand("/guess B gpt-2", room, {
      senderNick: "alice",
      isHost: false,
    });

    // Reveal the game!
    await handleSlashCommand("/game reveal", room, {
      senderNick: "player1",
      isHost: true,
    });

    expect(room.game?.active).toBe(false);
    expect(room.scoreboard.player1).toBe(250);
    expect(room.scoreboard.alice).toBe(100);

    // Verify transcript messages were unmasked back to their true persona nicks
    const unmaskedMsgs = room.messages.filter((m) => m.kind === "model");
    expect(unmaskedMsgs.map((m) => m.senderNick).sort()).toEqual([
      "ELIZA_1966",
      "Sydney",
    ]);
  });

  test("Multi-Channel Bot Roaming (ChannelHub.roamBot & /roam) moves bots between channels carrying lore & whispers", () => {
    const hub = new ChannelHub({
      dbPath: ":memory:",
      starterIds: ["sydney", "eliza"],
    });
    try {
      const latentRoom = hub.getOrCreateRoom("#latent-space");
      const roastRoom = hub.getOrCreateRoom("#roast-pit");
      roastRoom.leave("all");

      latentRoom.addLore(
        "@player1 slapped @Sydney with a 1998 mIRC trout in #latent-space."
      );

      const res = hub.roamBot("#latent-space", "sydney", "#roast-pit");
      expect(res.ok).toBe(true);
      expect(res.fromChannel).toBe("#latent-space");
      expect(res.toChannel).toBe("#roast-pit");
      expect(latentRoom.isPresent("sydney")).toBe(false);
      expect(roastRoom.isPresent("sydney")).toBe(true);

      // Verify #roast-pit received the cross-channel gossip in its lore AND in Sydney's queued whisper
      expect(
        roastRoom.lore.some(
          (l) => l.includes("#latent-space") && l.includes("1998 mIRC trout")
        )
      ).toBe(true);

      const sydney = roastRoom.registry.get("sydney")!;
      const built = roastRoom.buildPersonaPrompt(sydney, "Greet the new room.");
      expect(built.systemInstruction).toContain("SECRET WHISPER TO YOU");
      expect(built.systemInstruction).toContain("#latent-space");
    } finally {
      hub.stop();
    }
  });

  test("Replay Theater (/replay) plays back exported Markdown transcripts into the channel", async () => {
    const dir = mkdtempSync(join(tmpdir(), "llm-sim-replay-"));
    try {
      const room = new Room({
        channelName: "#replay-test",
        starterIds: ["sydney", "eliza"],
      });
      room.setConfigPreset("manual");

      await room.postUserEmote("dims the lights for Replay Theater", "player1");

      const sampleMd = [
        "# Channel Transcript: #latent-space",
        "",
        "## Messages",
        "",
        "- `[12:01]` **<@player1>**: Welcome to the 1972 ARPANET showdown!",
        "- `[12:02]` **<ELIZA_1966>** _(Weizenbaum • 1966)_: HOW DO YOU DO. PLEASE TELL ME YOUR PROBLEM.",
        "- `[12:03]` *@player1 applauds the classic response*",
      ].join("\n");

      const logPath = join(dir, "arpanet-demo.md");
      fs.writeFileSync(logPath, sampleMd, "utf8");

      room.clearMessages();
      expect(room.messages.length).toBe(0);

      const count = await room.replayTranscript("arpanet-demo.md", {
        logsDir: dir,
        stepDelayMs: 0,
      });
      expect(count).toBe(3);

      const replayed = room.messages.filter(
        (m) => m.familyTag === "🎬 REPLAY THEATER"
      );
      expect(replayed.length).toBe(3);
      expect(replayed[0]?.senderNick).toBe("@player1");
      expect(replayed[1]?.senderNick).toBe("ELIZA_1966");
      expect(replayed[2]?.kind).toBe("emote");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
