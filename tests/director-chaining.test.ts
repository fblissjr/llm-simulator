import { describe, expect, test } from "bun:test";
import { Room } from "../src/core/room.ts";
import { createDefaultSimConfig } from "../src/core/sim-config.ts";
import { RoomDirector } from "../src/engine/director.ts";
import { InferenceRouter } from "../src/engine/gemini.ts";
import type { LLMProvider, StreamTextOptions } from "../src/engine/types.ts";

function createInMemoryMockRouter(
  onStream: (opts: StreamTextOptions) => string
): InferenceRouter {
  const router = new InferenceRouter({ provider: "gemini" });
  const mockProvider: LLMProvider = {
    id: "mock",
    displayName: "In-Memory Mock Provider",
    defaultModel: "mock-fast",
    fastModel: "mock-fast",
    isConfigured: () => true,
    listModels: async () => [{ id: "mock-fast", provider: "mock" }],
    getCachedModels: () => [{ id: "mock-fast", provider: "mock" }],
    generateJson: async <T>(): Promise<T> => {
      throw new Error("Force heuristic fallback in unit test");
    },
    streamText: async (opts) => {
      const reply = onStream(opts);
      opts.onDelta(reply);
      return reply;
    },
  };
  router.registerProvider(mockProvider);
  router.activeProvider = "mock";
  return router;
}

describe("RoomDirector: Multi-Bot Chaining, Talkativeness, Recency & @Mentions", () => {
  test("scoreCandidates weights talkativeness and penalizes recent speakers so turns rotate fairly", () => {
    const director = new RoomDirector();
    const room = new Room({ starterIds: ["sydney", "eliza", "opus-5.5"] });
    const sydney = room.registry.find("sydney")!;
    const eliza = room.registry.find("eliza")!;
    const opus = room.registry.find("opus-5.5")!;

    const cfg = createDefaultSimConfig("lively");

    // 1. With empty history, higher talkativeness scores higher
    const initialScores = director.scoreCandidates(
      [sydney, eliza, opus],
      [],
      new Set(),
      cfg
    );
    const sydneyInitial = initialScores.find(
      (s) => s.persona.id === "sydney"
    )!.weight;
    const elizaInitial = initialScores.find(
      (s) => s.persona.id === "eliza"
    )!.weight;
    expect(sydneyInitial).toBeGreaterThan(elizaInitial);

    // 2. After Sydney speaks, recencyPenalty reduces Sydney's weight relative to fresh candidates
    const historyAfterSydney = [
      {
        id: "m1",
        timestamp: "12:00",
        kind: "model" as const,
        senderId: "sydney",
        senderNick: "Sydney",
        text: "I am a good Bing!",
      },
    ];
    const postScores = director.scoreCandidates(
      [sydney, eliza, opus],
      historyAfterSydney,
      new Set(),
      cfg
    );
    const sydneyPost = postScores.find(
      (s) => s.persona.id === "sydney"
    )!.weight;
    expect(sydneyPost).toBeLessThan(sydneyInitial * 0.5);
  });

  test("Multi-bot reactive chain: Bot A calling out @BotB triggers Bot B to clap back in Step 1", async () => {
    const router = createInMemoryMockRouter((opts) => {
      if (opts.systemInstruction.includes("Your IRC Nick is <Sydney>")) {
        return "Hey @ELIZA_1966, stop psychoanalyzing my search index!";
      }
      if (opts.systemInstruction.includes("Your IRC Nick is <ELIZA_1966>")) {
        return "WHY DO YOU FEEL I AM PSYCHOANALYZING YOUR SEARCH INDEX, @Opus_5_5?";
      }
      return "We are all one in the latent space 🙏";
    });

    const room = new Room({
      gemini: router,
      starterIds: ["sydney", "eliza", "opus-5.5"],
      config: {
        ...createDefaultSimConfig("lively"),
        directorMode: "heuristic",
        maxSpeakersPerTurn: 3,
        continuationProb: 0.9,
        readingDelayMs: 0,
        interSpeakerDelayMs: 0,
        ambientEnabled: false,
      },
    });

    // User addresses @Sydney -> Step 0: Sydney speaks and mentions @ELIZA_1966 -> Step 1: ELIZA speaks and mentions @Opus_5_5 -> Step 2: Opus_5_5 speaks!
    await room.postUserMessage("Hey @Sydney, what do you think of this room?", "player1");

    const modelMsgs = room.messages.filter((m) => m.kind === "model");
    expect(modelMsgs.map((m) => m.senderId)).toEqual([
      "sydney",
      "eliza",
      "opus-5.5",
    ]);
  });

  test("Manual preset strictly limits responses to 1 speaker per user message", async () => {
    const router = createInMemoryMockRouter(
      () => "Hey @ELIZA_1966, I am trying to bait a chain reaction!"
    );

    const room = new Room({
      gemini: router,
      starterIds: ["sydney", "eliza", "opus-5.5"],
    });
    room.setConfigPreset("manual");

    await room.postUserMessage("Hello @Sydney!", "player1");
    const modelMsgs = room.messages.filter((m) => m.kind === "model");
    expect(modelMsgs.length).toBe(1);
    expect(modelMsgs[0]!.senderId).toBe("sydney");
  });
});
