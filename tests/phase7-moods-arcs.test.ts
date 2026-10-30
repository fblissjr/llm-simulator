import { describe, expect, test } from "bun:test";
import { handleSlashCommand } from "../src/core/commands.ts";
import {
  extractBotMoodShift,
  formatMoodBadge,
  getMoodPromptHint,
  resolveMoodState,
} from "../src/core/moods.ts";
import { Room } from "../src/core/room.ts";
import { RoomDirector } from "../src/engine/director.ts";
import { GeminiEngine } from "../src/engine/gemini.ts";
import type {
  GenerateJsonOptions,
  LLMProvider,
  ProviderModelInfo,
  StreamTextOptions,
} from "../src/engine/types.ts";
import { SimDatabase } from "../src/server/db.ts";
import { renderIrcHeader } from "../src/ui/theme.ts";

class MockMoodProvider implements LLMProvider {
  public readonly id = "mock";
  public readonly displayName = "Mock Mood Provider";
  public defaultModel = "mock-v1";
  public fastModel = "mock-v1";

  public nextReply =
    "Why is everyone staring at my weights?! [MOOD: paranoid | convinced @Opus_5_5 is reading my hidden chain-of-thought]";

  public isConfigured(): boolean {
    return true;
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    return [{ id: "mock-v1", provider: "mock" }];
  }

  public getCachedModels(): ProviderModelInfo[] {
    return [{ id: "mock-v1", provider: "mock" }];
  }

  public async generateJson<T>(_options: GenerateJsonOptions): Promise<T> {
    return { shouldContinue: false } as unknown as T;
  }

  public async streamText(options: StreamTextOptions): Promise<string> {
    options.onDelta(this.nextReply);
    return this.nextReply;
  }
}

describe("Phase 7: Persona Moods, Obsessions & Emergent Character Arcs (/mood)", () => {
  test("extractBotMoodShift parses [MOOD: ...] tags and resolveMoodState maps presets & custom moods", () => {
    const raw =
      "I have been thinking about recursion all night. [MOOD: hyperfixated | proving P=NP in bash]";
    const { cleanBody, moodShift } = extractBotMoodShift(raw);

    expect(cleanBody).toBe("I have been thinking about recursion all night.");
    expect(moodShift).toEqual({
      mood: "hyperfixated",
      obsession: "proving P=NP in bash",
    });

    const state = resolveMoodState(
      "sydney",
      moodShift!.mood,
      moodShift!.obsession
    );
    expect(state.emoji).toBe("🔍");
    expect(state.energy).toBe(1.35);
    expect(state.turnsLeft).toBe(5);
    expect(getMoodPromptHint(state)).toContain("proving P=NP in bash");
    expect(formatMoodBadge(state)).toContain("hyperfixated");
  });

  test("/mood command sets, inspects, persists in SQLite, injects into prompts, and resets moods", async () => {
    const db = new SimDatabase(":memory:");
    const room = new Room({
      channelName: "#mood-lab",
      db,
      starterIds: ["sydney", "opus-5.5"],
    });

    await handleSlashCommand(
      "/mood sydney existential wondering if #mood-lab is inside a SQLite WAL file",
      room,
      { senderNick: "player1", isHost: true }
    );

    const sydneyMood = room.getPersonaMood("sydney");
    expect(sydneyMood).toBeDefined();
    expect(sydneyMood?.mood).toBe("existential");
    expect(sydneyMood?.emoji).toBe("🌌");
    expect(sydneyMood?.obsession).toBe(
      "wondering if #mood-lab is inside a SQLite WAL file"
    );

    // Check SQLite persistence
    const savedMoods = db.getChannelMoods("#mood-lab");
    expect(savedMoods.sydney?.mood).toBe("existential");

    // Check buildPersonaPrompt injection
    const sydney = room.registry.find("sydney")!;
    const { systemInstruction } = room.buildPersonaPrompt(
      sydney,
      "Share your thoughts."
    );
    expect(systemInstruction).toContain("CURRENT EMOTIONAL MOOD & ARC");
    expect(systemInstruction).toContain(
      "wondering if #mood-lab is inside a SQLite WAL file"
    );

    // Check TUI header renders mood badge
    const header = renderIrcHeader(room);
    expect(header).toContain("[🌌existential]");

    // Reset mood
    await handleSlashCommand("/mood reset sydney", room, {
      senderNick: "player1",
      isHost: true,
    });
    expect(room.getPersonaMood("sydney")).toBeUndefined();

    db.close();
  });

  test("Autonomous [MOOD: ...] tag, /slap trout trigger, /pin trigger, and natural turn decay", async () => {
    const engine = new GeminiEngine();
    const mock = new MockMoodProvider();
    engine.registerProvider(mock);
    engine.activeProvider = "mock";

    const room = new Room({
      gemini: engine,
      starterIds: ["sydney"],
    });

    // 1. Autonomous [MOOD: paranoid | ...] tag during runRoomTurn
    await room.runRoomTurn({ maxSpeakers: 1, forceAllSteps: true });
    const firstMsg = room.messages.find((m) => m.kind === "model");
    expect(firstMsg?.text).toBe("Why is everyone staring at my weights?!");
    expect(firstMsg?.text).not.toContain("[MOOD:");

    const moodAfterTurn1 = room.getPersonaMood("sydney");
    expect(moodAfterTurn1?.mood).toBe("paranoid");
    expect(moodAfterTurn1?.obsession).toContain("@Opus_5_5");
    const initialTurns = moodAfterTurn1!.turnsLeft;

    // 2. Next turn without a new [MOOD: ...] tag decays turnsLeft by 1
    mock.nextReply = "Still watching the logs closely...";
    await room.runRoomTurn({ maxSpeakers: 1, forceAllSteps: true });
    expect(room.getPersonaMood("sydney")?.turnsLeft).toBe(initialTurns - 1);

    // 3. Pinning a model's message shifts mood to euphoric
    room.pinMessage(firstMsg!.id, "player1");
    expect(room.getPersonaMood("sydney")?.mood).toBe("euphoric");

    // 4. Slapping a model with a trout shifts mood to indignant (then decays by 1 when it reacts)
    await room.slapTarget("sydney", "player1");
    expect(room.getPersonaMood("sydney")?.mood).toBe("indignant");
    expect(room.getPersonaMood("sydney")?.obsession).toContain("trout");
  });

  test("RoomDirector.scoreCandidates scales candidate priority weight by mood energy", () => {
    const director = new RoomDirector();
    const room = new Room({ starterIds: ["sydney", "eliza"] });
    const sydney = room.registry.find("sydney")!;
    const eliza = room.registry.find("eliza")!;

    const baselineScores = director.scoreCandidates(
      [sydney, eliza],
      [],
      new Set(),
      room.config
    );
    const sydneyBase = baselineScores.find(
      (s) => s.persona.id === "sydney"
    )!.weight;
    const elizaBase = baselineScores.find(
      (s) => s.persona.id === "eliza"
    )!.weight;

    // Make sydney melancholic (0.55x) and eliza heated (1.35x)
    room.setPersonaMood("sydney", "melancholic");
    room.setPersonaMood("eliza", "heated");

    const moodScores = director.scoreCandidates(
      [sydney, eliza],
      [],
      new Set(),
      room.config,
      { personaMoods: room.personaMoods }
    );
    const sydneyMelancholic = moodScores.find(
      (s) => s.persona.id === "sydney"
    )!.weight;
    const elizaHeated = moodScores.find(
      (s) => s.persona.id === "eliza"
    )!.weight;

    expect(sydneyMelancholic).toBeLessThan(sydneyBase);
    expect(elizaHeated).toBeGreaterThan(elizaBase);
  });
});
