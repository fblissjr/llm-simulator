import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { handleSlashCommand } from "../src/core/commands.ts";
import { Room } from "../src/core/room.ts";
import { createDefaultSimConfig } from "../src/core/sim-config.ts";
import { InferenceRouter } from "../src/engine/gemini.ts";
import type { LLMProvider } from "../src/engine/types.ts";

function createTestRouter(delayMs = 0): InferenceRouter {
  const router = new InferenceRouter({ provider: "gemini" });
  const mockProvider: LLMProvider = {
    id: "mock",
    displayName: "Mock Provider",
    defaultModel: "mock-1",
    fastModel: "mock-1",
    isConfigured: () => true,
    listModels: async () => [{ id: "mock-1", provider: "mock" }],
    getCachedModels: () => [{ id: "mock-1", provider: "mock" }],
    generateJson: async <T>(): Promise<T> => {
      throw new Error("Heuristic fallback");
    },
    streamText: async (opts) => {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      const text = "Simulated chatroom reply!";
      opts.onDelta(text);
      return text;
    },
  };
  router.registerProvider(mockProvider);
  router.activeProvider = "mock";
  return router;
}

describe("Ambient Heartbeat, Safety Caps, Human Typing Pause & IRC Commands", () => {
  test("checkAmbientTick fires when idle, pauses when a human is typing, and stops at ambientMaxConsecutive safety cap", async () => {
    const router = createTestRouter();
    const room = new Room({
      gemini: router,
      starterIds: ["sydney", "eliza"],
      config: {
        ...createDefaultSimConfig("lively"),
        directorMode: "heuristic",
        ambientEnabled: true,
        ambientIdleSec: 10,
        ambientIntervalSec: 10,
        ambientProb: 1.0,
        ambientMaxBurst: 1,
        ambientMaxConsecutive: 2,
        readingDelayMs: 0,
        interSpeakerDelayMs: 0,
      },
    });

    const baseTime = Date.now();
    room.lastActivityAt = baseTime - 15_000;

    // 1. If a human is actively typing, ambient tick must NOT fire
    room.markHumanTyping("alice", true);
    const firedWhileTyping = await room.checkAmbientTick({
      now: baseTime,
      randomFn: () => 0.1,
    });
    expect(firedWhileTyping).toBe(false);
    expect(room.ambientConsecutiveCount).toBe(0);

    // 2. Once human stops typing, ambient Burst #1 fires
    room.markHumanTyping("alice", false);
    room.lastActivityAt = baseTime - 15_000;
    const fired1 = await room.checkAmbientTick({
      now: baseTime,
      randomFn: () => 0.1,
    });
    expect(fired1).toBe(true);
    expect(room.ambientConsecutiveCount).toBe(1);

    // 3. Ambient Burst #2 fires after interval
    room.lastActivityAt = baseTime - 15_000;
    const fired2 = await room.checkAmbientTick({
      now: baseTime,
      randomFn: () => 0.1,
    });
    expect(fired2).toBe(true);
    expect(room.ambientConsecutiveCount).toBe(2);

    // 4. Safety cap reached (ambientMaxConsecutive = 2): Burst #3 is blocked so it never drains API while idle!
    room.lastActivityAt = baseTime - 99_000;
    const fired3 = await room.checkAmbientTick({
      now: baseTime,
      randomFn: () => 0.1,
    });
    expect(fired3).toBe(false);
    expect(room.ambientConsecutiveCount).toBe(2);

    // 5. Human speaks -> resets ambientConsecutiveCount back to 0!
    await room.postUserMessage("I'm back!", "alice");
    expect(room.ambientConsecutiveCount).toBe(0);
  });

  test("humanInterruptMode: 'yield' lets current streaming speaker finish before pivoting to new human message", async () => {
    const router = createTestRouter(30);
    const room = new Room({
      gemini: router,
      starterIds: ["sydney", "eliza", "opus-5.5"],
      config: {
        ...createDefaultSimConfig("banter"),
        directorMode: "heuristic",
        maxSpeakersPerTurn: 3,
        minSpeakersPerTurn: 1,
        continuationProb: 0, // 1 speaker per turn for deterministic count
        humanInterruptMode: "yield",
        readingDelayMs: 0,
        interSpeakerDelayMs: 0,
        ambientEnabled: false,
      },
    });

    // Start first turn (takes ~30ms) and send a second human message 5ms later while bot is mid-stream
    const turn1 = room.postUserMessage("First question @Sydney", "player1");
    await new Promise((r) => setTimeout(r, 5));
    const turn2 = room.postUserMessage("Wait, second question @ELIZA_1966!", "player1");

    await Promise.all([turn1, turn2]);

    const modelMsgs = room.messages.filter((m) => m.kind === "model");
    // Both turns completed cleanly without aborting the first message mid-sentence
    expect(modelMsgs.length).toBe(2);
    expect(modelMsgs[0]!.streaming).toBe(false);
    expect(modelMsgs[1]!.streaming).toBe(false);
  });

  test("/me, /slap, /scenario, and /export commands work end-to-end", async () => {
    const router = createTestRouter();
    const room = new Room({
      channelName: "#irc-fun",
      gemini: router,
      starterIds: ["sydney", "eliza"],
      config: {
        ...createDefaultSimConfig("manual"),
        directorMode: "heuristic",
      },
    });

    await handleSlashCommand("/me pours a cup of coffee", room, {
      senderNick: "player1",
    });
    const emoteMsg = room.messages.find((m) => m.kind === "emote");
    expect(emoteMsg).toBeDefined();
    expect(emoteMsg?.text).toBe("pours a cup of coffee");

    await handleSlashCommand("/slap sydney", room, { senderNick: "player1" });
    expect(
      room.messages.some(
        (m) => m.kind === "emote" && m.text.includes("mIRC trout")
      )
    ).toBe(true);

    // Launch a curated scenario (with provider unconfigured so we only test roster/vibe/preset setup)
    const offlineRoom = new Room({
      channelName: "#scenario-test",
      starterIds: ["sydney"],
    });
    await handleSlashCommand("/scenario 1972-arpanet", offlineRoom);
    expect(offlineRoom.activePersonas.map((p) => p.id)).toEqual([
      "eliza",
      "parry",
      "smarterchild",
      "gpt-2",
    ]);
    expect(offlineRoom.config.preset).toBe("lively");

    // Test /export and clean up generated file
    await handleSlashCommand("/export test-export-log", room);
    const exportedPath = path.resolve(
      process.cwd(),
      "logs",
      "test-export-log.md"
    );
    expect(fs.existsSync(exportedPath)).toBe(true);
    const exportedContent = fs.readFileSync(exportedPath, "utf-8");
    expect(exportedContent).toContain("#irc-fun");
    expect(exportedContent).toContain("mIRC trout");
    fs.rmSync(exportedPath, { force: true });
  });
});
