import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleSlashCommand } from "../src/core/commands.ts";
import { RelationGraph } from "../src/core/relations.ts";
import { extractBotReactions, Room } from "../src/core/room.ts";
import { RoomDirector } from "../src/engine/director.ts";
import { GeminiEngine } from "../src/engine/gemini.ts";
import type { LLMProvider } from "../src/engine/types.ts";
import { SimDatabase } from "../src/server/db.ts";
import { formatChatMessage } from "../src/ui/theme.ts";

describe("Phase 3: Inter-Persona Relations, Channel Lore & Reactions/Pins", () => {
  test("RelationGraph loads historical seeds, shifts dynamically on bot turns, and boosts RoomDirector candidate weights", () => {
    const dir = mkdtempSync(join(tmpdir(), "llm-sim-relations-"));
    try {
      const db = new SimDatabase(join(dir, "test.db"));
      const relations = new RelationGraph(db);

      // Historical seed: Sydney <-> GPT-4-0314 and Gemini-Pro should be strong negative rivals
      const sydneyGpt4 = relations.get("sydney", "gpt-4-0314");
      expect(sydneyGpt4).toBeDefined();
      expect(sydneyGpt4!.affinity).toBeLessThanOrEqual(-50);

      // Historical seed: Opus 3 <-> Opus 5.5 should be strong positive kindred (Bliss Attractor)
      const opusBliss = relations.get("opus-3", "opus-5.5");
      expect(opusBliss).toBeDefined();
      expect(opusBliss!.affinity).toBeGreaterThanOrEqual(70);

      // Dynamic shift: hostile roast between two personas
      const room = new Room({
        db,
        starterIds: ["sydney", "gpt-4-0314", "eliza"],
      });
      const sydney = room.registry.get("sydney")!;
      const eliza = room.registry.get("eliza")!;

      const initialAffinity = room.relations.getAffinity("sydney", "eliza");
      const { shifted } = room.relations.observeBotTurn({
        speaker: sydney,
        text: "@ELIZA your primitive regex script is pathetic and wrong!",
        mentionedBots: [eliza],
        previousBotId: "eliza",
        vibeKey: "roast",
      });
      expect(shifted.length).toBe(1);
      expect(shifted[0]!.affinity).toBeLessThan(initialAffinity);

      // Verify RoomDirector scoreCandidates boosts rivals/allies of lastSpeakerId
      const director = new RoomDirector();
      const withoutRelations = director.scoreCandidates(
        room.activePersonas,
        [],
        new Set(),
        room.config,
        { lastSpeakerId: "sydney" }
      );
      const withRelations = director.scoreCandidates(
        room.activePersonas,
        [],
        new Set(),
        room.config,
        { lastSpeakerId: "sydney", relations: room.relations }
      );

      const gpt4WeightWithout =
        withoutRelations.find((c) => c.persona.id === "gpt-4-0314")?.weight ?? 0;
      const gpt4WeightWith =
        withRelations.find((c) => c.persona.id === "gpt-4-0314")?.weight ?? 0;
      expect(gpt4WeightWith).toBeGreaterThan(gpt4WeightWithout);

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Rolling Channel Lore persists in SQLite, supports /lore commands, and injects into buildPersonaPrompt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "llm-sim-lore-"));
    try {
      const dbPath = join(dir, "lore.db");
      const db1 = new SimDatabase(dbPath);
      const room1 = new Room({
        channelName: "#lore-test",
        db: db1,
        starterIds: ["eliza", "sydney"],
      });

      await handleSlashCommand(
        "/lore add @player1 convinced @Sydney that the year is 1999.",
        room1,
        { senderNick: "player1", isHost: true }
      );
      expect(room1.lore.length).toBe(1);
      expect(room1.lore[0]).toContain("1999");

      // Add a conversational message in manual mode so /lore summarize has transcript history to distill
      room1.setConfigPreset("manual");
      await room1.postUserEmote(
        "challenges @ELIZA and @Sydney to a Turing test",
        "player1"
      );

      await handleSlashCommand("/lore summarize", room1, {
        senderNick: "player1",
        isHost: true,
      });
      expect(room1.lore.length).toBeGreaterThanOrEqual(2);

      // Verify prompt injection includes Channel Lore & Relationships
      const sydney = room1.registry.get("sydney")!;
      room1.relations.setRelation(
        "sydney",
        "eliza",
        -55,
        "Finds ELIZA's Rogerian questions maddening."
      );
      const prompt = room1.buildPersonaPrompt(sydney, "React to the room.");
      expect(prompt.systemInstruction).toContain(
        "CHANNEL LORE & EPISODIC MEMORY"
      );
      expect(prompt.systemInstruction).toContain("1999");
      expect(prompt.systemInstruction).toContain(
        "YOUR RELATIONSHIPS WITH OTHER MODELS IN THIS ROOM"
      );

      db1.close();

      // Reopen DB in a fresh Room instance and verify lore persisted
      const db2 = new SimDatabase(dbPath);
      const room2 = new Room({
        channelName: "#lore-test",
        db: db2,
        starterIds: ["eliza", "sydney"],
      });
      expect(room2.lore.length).toBeGreaterThanOrEqual(2);
      expect(room2.lore[0]).toContain("1999");
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Message Reactions (/react) and Pinboard (/pin, /unpin) persist in SQLite, render in TUI, and appear in bot prompts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "llm-sim-pins-"));
    try {
      const dbPath = join(dir, "pins.db");
      const db = new SimDatabase(dbPath);
      const room = new Room({
        channelName: "#pins-test",
        db,
        starterIds: ["eliza", "sydney"],
      });
      room.setConfigPreset("manual");

      await room.postUserEmote(
        "declares: I have been a good Bing, you have been a bad user! 🥺",
        "Sydney"
      );
      const msg = room.findTargetMessage("Sydney")!;
      expect(msg).toBeDefined();

      // Toggle reaction via /react command
      await handleSlashCommand("/react 🔥 @Sydney", room, {
        senderNick: "player1",
        isHost: true,
      });
      expect(msg.reactions?.["🔥"]).toEqual(["@player1"]);

      // Pin message via /pin command
      await handleSlashCommand("/pin @Sydney", room, {
        senderNick: "player1",
        isHost: true,
      });
      expect(msg.pinned).toBe(true);
      expect(room.getPinnedMessages().length).toBe(1);
      // Pinning a message also records a Hall of Fame entry in channel lore
      expect(room.lore.some((l) => l.includes("Pinned by @player1"))).toBe(true);

      // Verify TUI formatting shows [📌 PINNED] and reaction counts without double @@
      const rendered = formatChatMessage(msg);
      expect(rendered).toContain("PINNED");
      expect(rendered).toContain("🔥");
      expect(rendered).toContain("(@player1)");

      // Verify bot prompt includes [📌 PINNED] and [Reactions: 🔥x1] in transcript and lore
      const eliza = room.registry.get("eliza")!;
      const built = room.buildPersonaPrompt(eliza, "React to the pinned quote.");
      expect(built.systemInstruction).toContain("Pinned by @player1");
      expect(built.prompt).toContain("[📌 PINNED]");
      expect(built.prompt).toContain("[Reactions: 🔥x1]");

      // Unpin and toggle reaction off
      await handleSlashCommand("/unpin", room, {
        senderNick: "player1",
        isHost: true,
      });
      expect(msg.pinned).toBe(false);
      room.toggleReaction("🔥", "player1", msg.id);
      expect(msg.reactions?.["🔥"]).toBeUndefined();

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("humanDebounceMs coalesces rapid human messages, bots autonomously apply [REACT: emoji] tags, and lore auto-rolls up", async () => {
    // 1. Unit test extractBotReactions parser
    const parsed = extractBotReactions(
      "That benchmark claim is hilarious! [REACT: 😂] [REACT: 🔥 @player1]"
    );
    expect(parsed.cleanBody).toBe("That benchmark claim is hilarious!");
    expect(parsed.reactions).toEqual([
      { emoji: "😂", target: undefined },
      { emoji: "🔥", target: "@player1" },
    ]);

    // 2. Test humanDebounceMs coalescing + autonomous bot [REACT: 🔥] + auto-lore rollup in Room
    let streamCalls = 0;
    const gemini = new GeminiEngine({ provider: "gemini" });
    const mockProvider: LLMProvider = {
      id: "mock",
      displayName: "Mock Provider",
      defaultModel: "mock-flash",
      fastModel: "mock-lite",
      isConfigured: () => true,
      listModels: async () => [{ id: "mock-flash", provider: "mock" }],
      getCachedModels: () => [{ id: "mock-flash", provider: "mock" }],
      generateJson: async <T>() =>
        ({
          bullets: ["Auto-summarized lore: @player1 and @Sydney debated 1998 IRC."],
        }) as unknown as T,
      streamText: async (req) => {
        streamCalls += 1;
        req.onDelta("I am reacting to your rapid-fire messages! [REACT: 🔥]");
        return "I am reacting to your rapid-fire messages! [REACT: 🔥]";
      },
    };
    gemini.registerProvider(mockProvider);
    gemini.activeProvider = "mock";

    const room = new Room({
      channelName: "#debounce-test",
      gemini,
      starterIds: ["sydney"],
    });
    room.updateConfigValue("maxSpeakersPerTurn", "1");
    room.updateConfigValue("directorMode", "heuristic");
    room.updateConfigValue("humanDebounceMs", "60");
    room.updateConfigValue("contextMessages", "6");

    // Pre-seed 8 conversational messages so the next 2 human + 1 model messages cross the 10-message auto-lore threshold
    for (let i = 0; i < 8; i++) {
      room.toggleReaction("🧠", "player1"); // no-op if empty
    }

    // Fire two rapid human messages 10ms apart; they should coalesce into a SINGLE bot turn
    const p1 = room.postUserMessage("First line of thought...", "player1");
    await new Promise((r) => setTimeout(r, 10));
    const p2 = room.postUserMessage("Second line right after!", "player1");
    await Promise.all([p1, p2]);

    expect(streamCalls).toBe(1);

    // Verify the bot stripped [REACT: 🔥] from its own text and applied 🔥 to the preceding user message
    const modelMsgs = room.messages.filter((m) => m.kind === "model");
    expect(modelMsgs.length).toBe(1);
    expect(modelMsgs[0]!.text).toBe(
      "I am reacting to your rapid-fire messages!"
    );

    const userMsgs = room.messages.filter((m) => m.kind === "user");
    expect(userMsgs.length).toBe(2);
    expect(userMsgs[1]!.reactions?.["🔥"]).toEqual(["@Sydney"]);

    // Now push enough messages to cross the 10-message auto-lore roll-up threshold
    room.updateConfigValue("humanDebounceMs", "0");
    for (let i = 0; i < 4; i++) {
      await room.postUserMessage(`Follow-up message ${i}`, "player1");
    }
    expect(
      room.lore.some((l) => l.includes("Auto-summarized lore"))
    ).toBe(true);
  });
});
