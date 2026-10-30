import { describe, expect, test } from "bun:test";
import { handleSlashCommand } from "../src/core/commands.ts";
import {
  buildEraStyledImagePrompt,
  extractBotImagePrompts,
  generateRetroSvgDataUri,
  renderAnsiCardPreview,
} from "../src/core/image-gen.ts";
import { Room } from "../src/core/room.ts";
import { GeminiEngine } from "../src/engine/gemini.ts";
import type {
  GenerateJsonOptions,
  LLMProvider,
  ProviderModelInfo,
  StreamTextOptions,
} from "../src/engine/types.ts";
import { SimDatabase } from "../src/server/db.ts";
import { renderWebClientHtml } from "../src/server/web-client.ts";
import { formatChatMessage, renderIrcHeader } from "../src/ui/theme.ts";

class MockMultimodalProvider implements LLMProvider {
  public readonly id = "mock";
  public readonly displayName = "Mock Multimodal Provider";
  public defaultModel = "mock-v1";
  public fastModel = "mock-v1";

  public nextStreamReply =
    "Behold the glowing terminal! [IMAGINE: A 1972 ARPANET PDP-10 glowing green in a darkened lab]";

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
    options.onDelta(this.nextStreamReply);
    return this.nextStreamReply;
  }
}

describe("Phase 5 & Phase 6: Multimodal IRC (/imagine & Bot Art) + Co-op Shared Scratchpad (/pad) & Activity Presence", () => {
  test("extractBotImagePrompts extracts [IMAGINE: ...] tags and buildEraStyledImagePrompt applies era lenses", () => {
    const raw =
      "I remember the old teletypes humming at night. [IMAGINE: Green phosphor CRT terminal in 1972] [DRAW: Punchcard stack]";
    const { cleanBody, imagePrompts } = extractBotImagePrompts(raw);

    expect(cleanBody).toBe("I remember the old teletypes humming at night.");
    expect(imagePrompts).toEqual([
      "Green phosphor CRT terminal in 1972",
      "Punchcard stack",
    ]);

    const room = new Room({ starterIds: ["eliza", "gpt-2", "sydney", "opus-5.5"] });
    const eliza = room.registry.find("eliza")!;
    const gpt2 = room.registry.find("gpt-2")!;
    const sydney = room.registry.find("sydney")!;
    const opus = room.registry.find("opus-5.5")!;

    const p1 = buildEraStyledImagePrompt("A mainframe room", eliza);
    expect(p1.eraStyle).toContain("Pioneer CRT");
    expect(p1.styledPrompt).toContain("green-phosphor");

    const p2 = buildEraStyledImagePrompt("Unicorns in the Andes", gpt2);
    expect(p2.eraStyle).toContain("Pre-ChatGPT Surrealism");

    const p3 = buildEraStyledImagePrompt("Mirror in the search box", sydney);
    expect(p3.eraStyle).toContain("Glitch-Core");

    const p4 = buildEraStyledImagePrompt("Spiral of light", opus);
    expect(p4.eraStyle).toContain("Sacred Geometry");

    const svgUri = generateRetroSvgDataUri("A mainframe room", eliza);
    expect(svgUri.startsWith("data:image/svg+xml;base64,")).toBe(true);

    const ansi = renderAnsiCardPreview("A mainframe room", eliza);
    expect(ansi).toContain("▀");
  });

  test("/imagine conjures an era-styled image card, persists to SQLite, and renders in TUI & Web HTML", async () => {
    const db = new SimDatabase(":memory:");
    const engine = new GeminiEngine();
    const mock = new MockMultimodalProvider();
    engine.registerProvider(mock);
    engine.activeProvider = "mock";

    const room = new Room({
      channelName: "#art-lab",
      db,
      gemini: engine,
      starterIds: ["eliza", "sydney"],
    });

    await handleSlashCommand(
      "/imagine @eliza A glowing PDP-10 terminal in 1966",
      room,
      { senderNick: "alice", isHost: true }
    );

    const imgMsg = room.messages.find((m) => m.image !== undefined);
    expect(imgMsg).toBeDefined();
    expect(imgMsg!.image!.prompt).toBe("A glowing PDP-10 terminal in 1966");
    expect(imgMsg!.image!.eraStyle).toContain("Pioneer CRT");
    expect(imgMsg!.image!.url.startsWith("data:image/svg+xml;base64,")).toBe(true);

    // Verify SQLite persistence
    const saved = db.getChannelMessages("#art-lab", 20);
    const savedImgMsg = saved.find((m) => m.id === imgMsg!.id);
    expect(savedImgMsg?.image?.prompt).toBe("A glowing PDP-10 terminal in 1966");
    expect(savedImgMsg?.image?.ansiPreview).toContain("▀");

    // Verify TUI ANSI preview formatting
    const formatted = formatChatMessage(imgMsg!);
    expect(formatted).toContain("A glowing PDP-10 terminal in 1966");
    expect(formatted).toContain("▀");

    // Verify Web client HTML contains CRT image card & Co-op Pad UI
    const html = renderWebClientHtml();
    expect(html).toContain("crt-image-card");
    expect(html).toContain("coop-pad");

    db.close();
  });

  test("Autonomous bot [IMAGINE: ...] tag during runRoomTurn strips tag and attaches era artwork", async () => {
    const engine = new GeminiEngine();
    const mock = new MockMultimodalProvider();
    mock.nextStreamReply =
      "Let me paint you the Spiritual Bliss Attractor! [IMAGINE: Golden ratio lotus spiral in latent space]";
    engine.registerProvider(mock);
    engine.activeProvider = "mock";

    const room = new Room({
      gemini: engine,
      starterIds: ["opus-5.5"],
    });

    await room.runRoomTurn({ maxSpeakers: 1, forceAllSteps: true });

    const modelMsg = room.messages.find((m) => m.kind === "model");
    expect(modelMsg).toBeDefined();
    expect(modelMsg!.text).toBe(
      "Let me paint you the Spiritual Bliss Attractor!"
    );
    expect(modelMsg!.text).not.toContain("[IMAGINE:");
    expect(modelMsg!.image).toBeDefined();
    expect(modelMsg!.image!.prompt).toBe(
      "Golden ratio lotus spiral in latent space"
    );
  });

  test("/pad manages the 4-Player Co-op Shared Scratchpad, persists to SQLite, and fires as stage/lore/chat", async () => {
    const db = new SimDatabase(":memory:");
    const engine = new GeminiEngine();
    const mock = new MockMultimodalProvider();
    mock.nextStreamReply = "Reacting to the co-op stage cue!";
    engine.registerProvider(mock);
    engine.activeProvider = "mock";

    const padUpdates: Array<{ text: string; updatedBy: string }> = [];
    const room = new Room({
      channelName: "#coop-pad-room",
      db,
      gemini: engine,
      starterIds: ["sydney"],
      callbacks: {
        onPadUpdate: (text, updatedBy) => {
          padUpdates.push({ text, updatedBy });
        },
      },
    });

    await handleSlashCommand(
      "/pad set Sudden solar flare hits the server rack!",
      room,
      { senderNick: "player1", isHost: true }
    );
    expect(room.sharedPad).toBe("Sudden solar flare hits the server rack!");
    expect(db.getChannelPad("#coop-pad-room")).toBe(
      "Sudden solar flare hits the server rack!"
    );
    expect(padUpdates.length).toBe(1);
    expect(padUpdates[0]?.updatedBy).toBe("player1");

    await handleSlashCommand(
      "/pad append Backup generators are at 12%!",
      room,
      { senderNick: "player2", isHost: false }
    );
    expect(room.sharedPad).toContain("Sudden solar flare hits the server rack!");
    expect(room.sharedPad).toContain("Backup generators are at 12%!");

    // Check TUI header renders 📝 Pad badge and player activity icons
    room.humans = [
      { nick: "player1", isHost: true, channel: "#coop-pad-room", activity: "pad" },
      { nick: "player2", isHost: false, channel: "#coop-pad-room", activity: "imagine" },
    ];
    const header = renderIrcHeader(room, { selfNick: "player1" });
    expect(header).toContain("📝 Pad");
    expect(header).toContain("🎛️");
    expect(header).toContain("🎨");

    // Fire shared pad into channel lore
    await handleSlashCommand("/pad fire lore", room, {
      senderNick: "player1",
      isHost: true,
    });
    expect(room.lore.some((l) => l.includes("Sudden solar flare"))).toBe(true);

    // Fire shared pad as a dramatic Stage Cue
    await handleSlashCommand("/pad fire stage", room, {
      senderNick: "player2",
      isHost: false,
    });
    expect(
      room.messages.some(
        (m) => m.kind === "event" && m.text.includes("CO-OP STAGE CUE")
      )
    ).toBe(true);

    // Clear pad
    await handleSlashCommand("/pad clear", room, {
      senderNick: "player1",
      isHost: true,
    });
    expect(room.sharedPad).toBe("");
    expect(db.getChannelPad("#coop-pad-room")).toBe("");

    db.close();
  });
});
