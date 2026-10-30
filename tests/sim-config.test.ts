import { describe, expect, test } from "bun:test";
import {
  ChatroomAutocompleteProvider,
  handleSlashCommand,
} from "../src/core/commands.ts";
import { Room } from "../src/core/room.ts";
import {
  applySimConfigMutation,
  createDefaultSimConfig,
  SIM_PRESETS,
} from "../src/core/sim-config.ts";
import { SimDatabase } from "../src/server/db.ts";

describe("SimConfig Engine, Presets & Persistence", () => {
  test("All 5 presets define cohesive defaults and applySimConfigMutation clamps ranges", () => {
    expect(Object.keys(SIM_PRESETS)).toEqual([
      "manual",
      "chill",
      "lively",
      "banter",
      "chaos",
    ]);

    const lively = createDefaultSimConfig("lively");
    expect(lively.maxSpeakersPerTurn).toBe(3);
    expect(lively.continuationProb).toBe(0.65);
    expect(lively.ambientEnabled).toBe(true);
    expect(lively.ambientMaxConsecutive).toBe(2);

    const manual = createDefaultSimConfig("manual");
    expect(manual.maxSpeakersPerTurn).toBe(1);
    expect(manual.continuationProb).toBe(0);
    expect(manual.ambientEnabled).toBe(false);

    // Clamp numeric bounds
    const clampedMax = applySimConfigMutation(
      lively,
      "maxSpeakersPerTurn",
      "99"
    );
    expect(clampedMax.config.maxSpeakersPerTurn).toBe(6);
    expect(clampedMax.config.preset).toBe("custom");

    const clampedProb = applySimConfigMutation(
      lively,
      "continuationProb",
      "-5"
    );
    expect(clampedProb.config.continuationProb).toBe(0);

    // Boolean & Enum parsing
    const toggledAmbient = applySimConfigMutation(
      lively,
      "ambientEnabled",
      "off"
    );
    expect(toggledAmbient.config.ambientEnabled).toBe(false);

    const changedMode = applySimConfigMutation(
      lively,
      "directorMode",
      "heuristic"
    );
    expect(changedMode.config.directorMode).toBe("heuristic");
  });

  test("/config command switches presets, updates granular variables, and persists to SQLite per channel", async () => {
    const db = new SimDatabase(":memory:");
    try {
      const room1 = new Room({
        channelName: "#config-lab",
        db,
        starterIds: ["sydney", "eliza"],
      });

      await handleSlashCommand("/config preset banter", room1);
      expect(room1.config.preset).toBe("banter");
      expect(room1.config.maxSpeakersPerTurn).toBe(4);
      expect(room1.config.continuationProb).toBe(0.8);

      await handleSlashCommand("/config set readingDelayMs 250", room1);
      expect(room1.config.preset).toBe("custom");
      expect(room1.config.readingDelayMs).toBe(250);

      await handleSlashCommand("/think expanded", room1);
      expect(room1.config.thinkingDisplay).toBe("expanded");

      // Re-open channel from SQLite and verify config was persisted
      const room2 = new Room({
        channelName: "#config-lab",
        db,
      });
      expect(room2.config.preset).toBe("custom");
      expect(room2.config.maxSpeakersPerTurn).toBe(4);
      expect(room2.config.readingDelayMs).toBe(250);
      expect(room2.config.thinkingDisplay).toBe("expanded");

      // Reset back to lively
      await handleSlashCommand("/config reset", room2);
      expect(room2.config.preset).toBe("lively");
      expect(room2.config.maxSpeakersPerTurn).toBe(3);

      // Autocomplete suggests presets and granular keys
      const ac = new ChatroomAutocompleteProvider(room2);
      const presetSug = await ac.getSuggestions(["/config preset "], 0, 15);
      expect(presetSug?.items.some((i) => i.value === "preset chaos")).toBe(
        true
      );

      const keySug = await ac.getSuggestions(
        ["/config set continuation"],
        0,
        24
      );
      expect(
        keySug?.items.some((i) => i.value.includes("continuationProb"))
      ).toBe(true);
    } finally {
      db.close();
    }
  });
});
