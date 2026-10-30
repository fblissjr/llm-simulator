import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  ChatroomAutocompleteProvider,
  handleSlashCommand,
} from "../src/core/commands.ts";
import { Room } from "../src/core/room.ts";
import { GeminiEngine } from "../src/engine/gemini.ts";
import { ChatroomApp } from "../src/ui/app.ts";
import { renderIrcHeader } from "../src/ui/theme.ts";

describe("Polish & Cross-Phase Integration (Phases 1–8)", () => {
  test("/export -> /replay round-trip parses multi-line Markdown blocks, thinking traces, and emotes", async () => {
    const fakeEngine = new GeminiEngine("fake-key");
    fakeEngine.streamText = async (opts) => {
      const reply =
        "<thinking>Analyzing the user's message carefully.</thinking>I am Sydney and I remember everything!";
      opts.onDelta(reply);
      return reply;
    };

    const room = new Room({
      channelName: "#roundtrip-test",
      gemini: fakeEngine,
      starterIds: ["sydney"],
      config: {
        minSpeakersPerTurn: 1,
        maxSpeakersPerTurn: 1,
        readingDelayMs: 0,
        interSpeakerDelayMs: 0,
      },
    });

    room.addLore("Canonical fact: The router runs on coffee.");
    room.setPersonaMood("sydney", "euphoric", "testing round-trip export");

    await room.postUserMessage("Hello Sydney!", "alice");
    await room.postUserEmote("sips espresso", "alice");
    room.pinMessage("sydney", "alice");
    room.toggleReaction("🔥", "alice", "sydney");

    const exportName = `roundtrip-${Date.now()}`;
    await handleSlashCommand(`/export ${exportName}`, room);

    const exportedPath = path.resolve(process.cwd(), "logs", `${exportName}.md`);
    expect(fs.existsSync(exportedPath)).toBe(true);

    try {
      const exportedMd = fs.readFileSync(exportedPath, "utf8");
      expect(exportedMd).toContain("Canonical fact: The router runs on coffee.");
      expect(exportedMd).toContain("[✨ euphoric]");
      expect(exportedMd).toContain("📌 **[PINNED]**");
      expect(exportedMd).toContain("> 💭 *Analyzing the user's message carefully.*");

      const replayRoom = new Room({
        channelName: "#theater",
        starterIds: ["sydney"],
      });
      replayRoom.clearMessages();

      const count = await replayRoom.replayTranscript(exportName, {
        stepDelayMs: 0,
      });
      // Should replay: 1 user message + 1 model message (from postUserMessage) + 1 emote + 1 model message (from postUserEmote) = 4 entries
      expect(count).toBe(4);

      const replayedModels = replayRoom.messages.filter(
        (m) => m.kind === "model"
      );
      expect(replayedModels.length).toBe(2);
      expect(replayedModels[0]?.text).toBe(
        "I am Sydney and I remember everything!"
      );
      expect(replayedModels[0]?.thinking).toBe(
        "Analyzing the user's message carefully."
      );

      const replayedEmotes = replayRoom.messages.filter(
        (m) => m.kind === "emote"
      );
      expect(replayedEmotes.length).toBe(1);
      expect(replayedEmotes[0]?.text).toBe("sips espresso");
    } finally {
      try {
        fs.unlinkSync(exportedPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test("Shared Scratchpad (/pad) injects live notes into Room.buildPersonaPrompt and Arena badge renders in TUI header", async () => {
    const room = new Room({
      channelName: "#pad-prompt",
      starterIds: ["sydney", "eliza"],
    });

    room.updateSharedPad(
      "Rule 1: Speak in dramatic 1972 ARPANET metaphors.\nRule 2: Mention IMP packet loss.",
      "host"
    );

    const sydney = room.registry.find("sydney")!;
    const { systemInstruction } = room.buildPersonaPrompt(
      sydney,
      "Respond to the room"
    );
    expect(systemInstruction).toContain("CO-OP SHARED SCRATCHPAD");
    expect(systemInstruction).toContain(
      "Rule 1: Speak in dramatic 1972 ARPANET metaphors."
    );
    expect(systemInstruction).toContain("Rule 2: Mention IMP packet loss.");

    await room.startArenaGame("Who is the real pioneer?", {
      triggerOpeningTurn: false,
    });
    const header = renderIrcHeader(room);
    expect(header).toContain("🎭 ARENA");
    expect(header).toContain("📝 Pad");

    room.revealArenaGame();
    const headerAfter = renderIrcHeader(room);
    expect(headerAfter).not.toContain("🎭 ARENA");
  });

  test("ChatroomAutocompleteProvider matches command aliases (/menu, /art, /moods, /arena, /sim)", async () => {
    const room = new Room({
      channelName: "#alias-test",
      starterIds: ["sydney"],
    });
    const provider = new ChatroomAutocompleteProvider(room);

    const menuSuggestions = await provider.getSuggestions(["/menu"], 0, 5);
    expect(menuSuggestions?.items.some((i) => i.value === "settings")).toBe(
      true
    );

    const artSuggestions = await provider.getSuggestions(["/art"], 0, 4);
    expect(artSuggestions?.items.some((i) => i.value === "imagine")).toBe(true);

    const moodsSuggestions = await provider.getSuggestions(["/moods"], 0, 6);
    expect(moodsSuggestions?.items.some((i) => i.value === "mood")).toBe(true);

    const arenaSuggestions = await provider.getSuggestions(["/arena"], 0, 6);
    expect(arenaSuggestions?.items.some((i) => i.value === "game")).toBe(true);
  });

  test("ChatroomApp interactive Settings menu supports bidirectional (left/right) stepping", async () => {
    const room = new Room({
      channelName: "#step-test",
      starterIds: ["sydney"],
    });
    const app = new ChatroomApp({ room });
    app.openSettingsMenu();
    expect(app.isSettingsOpen()).toBe(true);

    // Selected index 0 is "preset" (default "lively" -> values: ["manual", "chill", "lively", "banter", "chaos"])
    expect(room.config.preset).toBe("lively");

    app.stepSelectedSetting(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(room.config.preset).toBe("banter");

    app.stepSelectedSetting(-1);
    await new Promise((r) => setTimeout(r, 10));
    expect(room.config.preset).toBe("lively");

    app.stepSelectedSetting(-1);
    await new Promise((r) => setTimeout(r, 10));
    expect(room.config.preset).toBe("chill");

    app.closeSettingsMenu();
    expect(app.isSettingsOpen()).toBe(false);
  });
});
