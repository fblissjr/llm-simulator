import { describe, expect, test } from "bun:test";
import { handleSlashCommand } from "../src/core/commands.ts";
import { Room } from "../src/core/room.ts";
import {
  applySimConfigMutation,
  createDefaultSimConfig,
  getVariableMenuValues,
  SIM_CATEGORY_LABELS,
  SIM_VARIABLE_DESCRIPTORS,
} from "../src/core/sim-config.ts";
import { GeminiEngine } from "../src/engine/gemini.ts";
import { renderWebClientHtml } from "../src/server/web-client.ts";
import { ChatroomApp } from "../src/ui/app.ts";

describe("Phase 8: Granular Feature Controls & Interactive Settings Menus (/settings)", () => {
  test("SIM_VARIABLE_DESCRIPTORS covers all 30 SimConfig variables across 6 categories", () => {
    expect(SIM_VARIABLE_DESCRIPTORS.length).toBe(30);
    const categories = Object.keys(SIM_CATEGORY_LABELS);
    expect(categories).toEqual([
      "pacing",
      "director",
      "ambient",
      "emergent",
      "memory",
      "display",
    ]);

    for (const d of SIM_VARIABLE_DESCRIPTORS) {
      expect(categories).toContain(d.category);
      expect(d.label.length).toBeGreaterThan(2);
      const menuVals = getVariableMenuValues(d);
      expect(menuVals.length).toBeGreaterThan(0);
    }

    const cfg = createDefaultSimConfig("lively");
    expect(cfg.botAutonomousReactions).toBe(true);
    expect(cfg.botAutonomousImagine).toBe(true);
    expect(cfg.botAutonomousMoods).toBe(true);
    expect(cfg.dynamicRelationsEnabled).toBe(true);
    expect(cfg.moodDecayTurns).toBe(4);
    expect(cfg.autoLoreEnabled).toBe(true);
    expect(cfg.autoLoreInterval).toBe(16);
    expect(cfg.ambientRoamProb).toBe(0);

    const mutated = applySimConfigMutation(
      cfg,
      "botAutonomousImagine",
      "false"
    );
    expect(mutated.config.botAutonomousImagine).toBe(false);
    expect(mutated.config.preset).toBe("custom");

    const clampedMoodTurns = applySimConfigMutation(cfg, "moodDecayTurns", "99");
    expect(clampedMoodTurns.config.moodDecayTurns).toBe(15);
  });

  test("Room enforces botAutonomousReactions, botAutonomousImagine, botAutonomousMoods, dynamicRelationsEnabled, and moodDecayTurns", async () => {
    const fakeEngine = new GeminiEngine("fake-key");
    fakeEngine.streamText = async (opts) => {
      const reply =
        "I totally disagree with you @opus-5.5, your architecture is terrible and broken! [REACT: 🔥] [IMAGINE: a burning mainframe] [MOOD: paranoid | watching the router]";
      opts.onDelta(reply);
      return reply;
    };

    const room = new Room({
      channelName: "#settings-test",
      gemini: fakeEngine,
      starterIds: ["sydney", "opus-5.5"],
      config: {
        minSpeakersPerTurn: 1,
        maxSpeakersPerTurn: 1,
        readingDelayMs: 0,
        interSpeakerDelayMs: 0,
        botAutonomousReactions: false,
        botAutonomousImagine: false,
        botAutonomousMoods: false,
        dynamicRelationsEnabled: false,
        moodDecayTurns: 7,
      },
    });

    const sydney = room.registry.find("sydney")!;
    const promptDisabled = room.buildPersonaPrompt(sydney, "Test turn");
    expect(promptDisabled.systemInstruction).not.toContain("[REACT:");
    expect(promptDisabled.systemInstruction).not.toContain("[IMAGINE:");
    expect(promptDisabled.systemInstruction).not.toContain("[MOOD:");

    const relBefore = room.relations.get("sydney", "opus-5.5")?.affinity ?? 0;

    await room.postUserMessage("What do you think @sydney?", "host");

    const modelMsgs = room.messages.filter((m) => m.kind === "model");
    expect(modelMsgs.length).toBe(1);
    const botReply = modelMsgs[0]!;
    // Tags are still stripped cleanly from text, but autonomous side effects are suppressed
    expect(botReply.text).not.toContain("[REACT:");
    expect(botReply.text).not.toContain("[IMAGINE:");
    expect(botReply.text).not.toContain("[MOOD:");
    expect(botReply.image).toBeUndefined();

    const userMsg = room.messages.find((m) => m.kind === "user")!;
    expect(userMsg.reactions).toBeUndefined();
    expect(room.getPersonaMood("sydney")).toBeUndefined();

    const relAfter = room.relations.get("sydney", "opus-5.5")?.affinity ?? 0;
    expect(relAfter).toBe(relBefore);

    // Event mood triggers (/pin, /react, /slap) are also suppressed when botAutonomousMoods=false
    room.pinMessage("sydney", "host");
    expect(room.getPersonaMood("sydney")).toBeUndefined();

    // Re-enable botAutonomousMoods and verify moodDecayTurns=7 is used as default duration
    room.updateConfigValue("botAutonomousMoods", "true");
    room.pinMessage("sydney", "host");
    const moodAfterPin = room.getPersonaMood("sydney");
    expect(moodAfterPin?.mood).toBe("euphoric");
    expect(moodAfterPin?.turnsLeft).toBe(7);
  });

  test("Room enforces autoLoreEnabled, autoLoreInterval, and ambientRoamProb", async () => {
    let roamed = false;
    const room = new Room({
      channelName: "#lore-roam-test",
      starterIds: ["sydney", "eliza"],
      config: {
        ambientEnabled: true,
        ambientIdleSec: 5,
        ambientIntervalSec: 5,
        ambientProb: 1.0,
        ambientRoamProb: 1.0,
        autoLoreEnabled: false,
        autoLoreInterval: 4,
      },
      callbacks: {
        onAmbientRoam: () => {
          roamed = true;
        },
      },
    });

    const triggered = await room.checkAmbientTick({
      now: Date.now() + 20_000,
      randomFn: () => 0.1,
    });
    expect(triggered).toBe(true);
    expect(roamed).toBe(true);
  });

  test("/settings slash command supports interactive callback, category filtering, and boolean quick-toggling", async () => {
    const room = new Room({
      channelName: "#cmd-settings",
      starterIds: ["sydney"],
    });

    let openedModal = false;
    await handleSlashCommand("/settings", room, {
      onOpenSettings: () => {
        openedModal = true;
      },
    });
    expect(openedModal).toBe(true);

    const notices: string[] = [];
    await handleSlashCommand("/settings emergent", room, {
      notifyCaller: (t) => notices.push(t),
    });
    expect(notices[0]).toContain("Emergent AI Features");
    expect(notices[0]).toContain("botAutonomousReactions");
    expect(notices[0]).toContain("botAutonomousImagine");

    // Single-argument boolean toggle via /settings <booleanKey>
    expect(room.config.botAutonomousImagine).toBe(true);
    await handleSlashCommand("/settings botAutonomousImagine", room);
    expect(room.config.botAutonomousImagine).toBe(false);
  });

  test("ChatroomApp exposes 31 interactive SettingsList items (preset + 30 variables) and Web Client renders <dialog id='settings-dialog'>", () => {
    const room = new Room({
      channelName: "#tui-settings",
      starterIds: ["sydney"],
    });
    const app = new ChatroomApp({ room });
    const items = app.getSettingsItems();
    expect(items.length).toBe(31);
    expect(items[0]?.id).toBe("preset");
    expect(items.some((i) => i.id === "botAutonomousMoods")).toBe(true);
    expect(items.some((i) => i.id === "autoLoreInterval")).toBe(true);

    const html = renderWebClientHtml();
    expect(html).toContain(
      '<dialog id="settings-dialog" closedby="any" aria-labelledby="settings-title">'
    );
    expect(html).toContain("dialog:modal");
    expect(html).toContain("overscroll-behavior: contain");
    expect(html).toContain('data-config-key="botAutonomousReactions"');
    expect(html).toContain('data-config-key="botAutonomousImagine"');
    expect(html).toContain('data-config-key="botAutonomousMoods"');
    expect(html).toContain('data-config-key="dynamicRelationsEnabled"');
    expect(html).toContain('data-config-key="moodDecayTurns"');
    expect(html).toContain('data-config-key="autoLoreEnabled"');
    expect(html).toContain('data-config-key="autoLoreInterval"');
    expect(html).toContain('data-config-key="ambientRoamProb"');
  });
});
