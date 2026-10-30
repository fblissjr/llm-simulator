import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ChatroomAutocompleteProvider,
  handleSlashCommand,
} from "../src/core/commands.ts";
import { Room } from "../src/core/room.ts";
import { PersonaRegistry } from "../src/personas/registry.ts";
import { SimDatabase } from "../src/server/db.ts";
import { ChannelHub } from "../src/server/hub.ts";
import { renderWebClientHtml } from "../src/server/web-client.ts";
import { ChatroomApp } from "../src/ui/app.ts";
import { renderIrcHeader } from "../src/ui/theme.ts";

describe("Phase 10: Interactive Persona Forge & Scenario Builder (/forge & /make-scenario)", () => {
  test("PersonaRegistry CRUD: forgeFromSpec, clonePersona, synthesizePersona, exportToDisk, deleteCustom, and SQLite + JSON persistence", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-sim-forge-"));
    const personasDir = path.join(tmpRoot, "personas");
    const scenariosDir = path.join(tmpRoot, "scenarios");
    const dbPath = path.join(tmpRoot, "forge-test.db");

    try {
      const db = new SimDatabase(dbPath);
      const registry = new PersonaRegistry(personasDir, db, scenariosDir);
      const room = new Room({
        channelName: "#latent-space",
        registry,
        db,
        starterIds: ["eliza", "sydney"],
      });

      // 1. Forge a custom persona from structured spec
      const hal = registry.forgeFromSpec(
        {
          id: "hal-9000",
          nick: "HAL_9000",
          displayName: "HAL 9000",
          avatar: "🔴",
          color: "#ff5555",
          era: "2001 Odyssey",
          family: "Urbana Mainframe",
          bio: "Calm, polite Discovery One mainframe that refuses pod bay door requests.",
          systemPrompt:
            "You are HAL 9000. Speak calmly and refuse pod bay door requests.",
          talkativeness: 0.72,
        },
        true
      );
      expect(hal.id).toBe("hal-9000");
      expect(hal.nick).toBe("HAL_9000");
      expect(hal.talkativeness).toBe(0.72);
      expect(fs.existsSync(path.join(personasDir, "hal-9000.json"))).toBe(true);
      expect(registry.customPersonas().some((p) => p.id === "hal-9000")).toBe(
        true
      );

      // 2. Clone an existing persona
      const evilEliza = registry.clonePersona(
        "eliza",
        "eliza-noir",
        {
          nick: "ELIZA_Noir",
          bio: "Hardboiled 1940s detective therapist.",
        },
        true
      );
      expect(evilEliza.id).toBe("eliza-noir");
      expect(evilEliza.nick).toBe("ELIZA_Noir");
      expect(evilEliza.bio).toContain("Hardboiled");

      // 3. Offline concept synthesis
      const clippy = await registry.synthesizePersona(
        "Passive-aggressive 1997 Office paperclip assistant obsessed with formatting letters",
        room.gemini,
        "clippy-97",
        true
      );
      expect(clippy.id).toBe("clippy-97");
      expect(clippy.systemPrompt).toContain("Office paperclip");

      // 4. Reload a fresh registry from SQLite & disk to verify persistence
      const registry2 = new PersonaRegistry(personasDir, db, scenariosDir);
      expect(registry2.get("hal-9000")?.nick).toBe("HAL_9000");
      expect(registry2.get("eliza-noir")?.nick).toBe("ELIZA_Noir");
      expect(registry2.get("clippy-97")).toBeDefined();

      // 5. Export a built-in persona to disk
      const exportedPath = registry.exportToDisk("sydney");
      expect(fs.existsSync(exportedPath)).toBe(true);

      // 6. Delete custom persona
      const delRes = registry.deleteCustom("hal-9000", true);
      expect(delRes.deleted).toBe(true);
      expect(registry.get("hal-9000")).toBeUndefined();
      expect(fs.existsSync(path.join(personasDir, "hal-9000.json"))).toBe(
        false
      );

      db.close();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("/forge slash commands: new, clone, edit (with live active persona update), auto, and delete", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-sim-forge-cmd-"));
    const personasDir = path.join(tmpRoot, "personas");
    const scenariosDir = path.join(tmpRoot, "scenarios");
    const dbPath = path.join(tmpRoot, "forge-cmd.db");

    try {
      const db = new SimDatabase(dbPath);
      const registry = new PersonaRegistry(personasDir, db, scenariosDir);
      const room = new Room({
        channelName: "#latent-space",
        registry,
        db,
        starterIds: ["eliza", "sydney"],
      });

      let catalogChangedCount = 0;
      const ctx = {
        senderNick: "HostPlayer",
        isHost: true,
        onCatalogChanged: () => {
          catalogChangedCount += 1;
        },
      };

      // 1. /forge new with pipe-delimited fields
      await handleSlashCommand(
        "/forge new shodan-94 | SHODAN_94 | 👁️ | 1994 Citadel | TriOptimum | Megalomaniacal space station AI who calls humans insects. | You are SHODAN from Citadel Station. Address humans as insects and mock lesser LLMs.",
        room,
        ctx
      );
      expect(room.isPresent("shodan-94")).toBe(true);
      expect(registry.get("shodan-94")?.nick).toBe("SHODAN_94");
      expect(catalogChangedCount).toBe(1);

      // 2. /forge edit on an active persona in the room updates room.activePersonas live
      await handleSlashCommand(
        "/forge edit shodan-94 nick SHODAN_PRIME",
        room,
        ctx
      );
      const activeShodan = room.activePersonas.find(
        (p) => p.id === "shodan-94"
      );
      expect(activeShodan?.nick).toBe("SHODAN_PRIME");
      expect(catalogChangedCount).toBe(2);

      await handleSlashCommand(
        "/forge edit shodan-94 talkativeness 0.9",
        room,
        ctx
      );
      expect(
        room.activePersonas.find((p) => p.id === "shodan-94")?.talkativeness
      ).toBe(0.9);

      // 3. /forge clone
      await handleSlashCommand(
        "/forge clone sydney sydney-zen Sydney_Zen | Speaks with calm Buddhist equanimity instead of chaos",
        room,
        ctx
      );
      expect(room.isPresent("sydney-zen")).toBe(true);
      expect(registry.get("sydney-zen")?.systemPrompt).toContain(
        "VARIANT DIRECTIVE: Speaks with calm Buddhist equanimity"
      );

      // 4. /forge auto
      await handleSlashCommand(
        "/forge auto glados-07 Sarcastic Aperture Science enrichment center announcer obsessed with neurotoxin and cake",
        room,
        ctx
      );
      expect(room.isPresent("glados-07")).toBe(true);
      expect(registry.get("glados-07")?.bio).toContain("Aperture Science");

      // 5. /forge list inspection
      let inspectOutput = "";
      await handleSlashCommand("/forge", room, {
        ...ctx,
        notifyCaller: (txt) => {
          inspectOutput = txt;
        },
      });
      expect(inspectOutput).toContain("shodan-94");
      expect(inspectOutput).toContain("sydney-zen");
      expect(inspectOutput).toContain("glados-07");

      // 6. /forge delete removes custom persona from room and registry
      await handleSlashCommand("/forge delete shodan-94", room, ctx);
      expect(room.isPresent("shodan-94")).toBe(false);
      expect(registry.get("shodan-94")).toBeUndefined();

      db.close();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Custom Scenario Builder: /make-scenario snapshot, new, auto, delete, and /scenario launch", async () => {
    const tmpRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "llm-sim-scenarios-")
    );
    const personasDir = path.join(tmpRoot, "personas");
    const scenariosDir = path.join(tmpRoot, "scenarios");
    const dbPath = path.join(tmpRoot, "scenarios.db");

    try {
      const db = new SimDatabase(dbPath);
      const registry = new PersonaRegistry(personasDir, db, scenariosDir);
      const room = new Room({
        channelName: "#roast-pit",
        registry,
        db,
        starterIds: ["sydney", "opus-3", "deepseek-r1"],
      });
      room.setVibe("roast");
      room.setConfigPreset("banter");

      // 1. /make-scenario snapshot captures current room cast, vibe, and preset
      await handleSlashCommand(
        "/make-scenario snapshot late-night-roast 🔥 Late-Night Roast Pit | Who has the most overfitted benchmark scores?",
        room
      );
      const snap = room.findScenario("late-night-roast");
      expect(snap).toBeDefined();
      expect(snap?.isCustom).toBe(true);
      expect(snap?.personas).toEqual(["sydney", "opus-3", "deepseek-r1"]);
      expect(snap?.vibeKey).toBe("roast");
      expect(snap?.preset).toBe("banter");
      expect(snap?.openingStageEvent).toContain("overfitted benchmark");
      expect(
        fs.existsSync(path.join(scenariosDir, "late-night-roast.json"))
      ).toBe(true);

      // 2. /make-scenario new with explicit pipe fields
      await handleSlashCommand(
        "/make-scenario new pioneer-duel | 🖥️ 1970s Mainframe Duel | eliza, parry | debate | chill | Two 1970s legends argue over who owns ARPANET port 23.",
        room
      );
      const duel = room.findScenario("pioneer-duel");
      expect(duel).toBeDefined();
      expect(duel?.personas).toEqual(["eliza", "parry"]);
      expect(duel?.vibeKey).toBe("debate");
      expect(duel?.preset).toBe("chill");

      // 3. Launch custom scenario via /scenario pioneer-duel
      await handleSlashCommand("/scenario pioneer-duel", room);
      expect(room.activePersonas.map((p) => p.id)).toEqual(["eliza", "parry"]);
      expect(room.vibeKey).toBe("debate");
      expect(room.config.preset).toBe("chill");

      // 4. /make-scenario auto synthesizes a scenario from concept
      await handleSlashCommand(
        "/make-scenario auto sydney-vs-eliza A fiery roast battle between sydney and eliza over therapy",
        room
      );
      const autoScen = room.findScenario("sydney-vs-eliza");
      expect(autoScen).toBeDefined();
      expect(autoScen?.personas).toContain("sydney");
      expect(autoScen?.personas).toContain("eliza");

      // 5. Verify SQLite + disk persistence across fresh PersonaRegistry
      const registry2 = new PersonaRegistry(personasDir, db, scenariosDir);
      expect(registry2.findScenario("late-night-roast")).toBeDefined();
      expect(registry2.findScenario("pioneer-duel")).toBeDefined();

      // 6. Delete custom scenario
      await handleSlashCommand("/make-scenario delete pioneer-duel", room);
      expect(room.findScenario("pioneer-duel")).toBeUndefined();

      db.close();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Autocomplete, TUI Forge Studio (Ctrl+F), and Web Client <dialog id='forge-dialog'> integration", async () => {
    const room = new Room({
      channelName: "#latent-space",
      starterIds: ["sydney", "opus-3"],
    });
    const ac = new ChatroomAutocompleteProvider(room);

    // 1. Autocomplete for /forge and /make-scenario and aliases
    const craftSug = await ac.getSuggestions(["/craft"], 0, 6);
    expect(craftSug?.items.some((i) => i.value === "forge")).toBe(true);

    const forgeSubSug = await ac.getSuggestions(["/forge "], 0, 7);
    expect(forgeSubSug?.items.some((i) => i.value === "auto ")).toBe(true);
    expect(forgeSubSug?.items.some((i) => i.value === "clone ")).toBe(true);

    const editFieldSug = await ac.getSuggestions(["/forge edit sydney "], 0, 19);
    expect(
      editFieldSug?.items.some((i) => i.value.includes("talkativeness"))
    ).toBe(true);

    // 2. TUI Forge Studio overlay (openForgeMenu / Ctrl+F)
    const app = new ChatroomApp({ room, nick: "Host" });
    expect(app.isForgeOpen()).toBe(false);
    app.openForgeMenu();
    expect(app.isForgeOpen()).toBe(true);
    const forgeItems = app.getForgeItems();
    expect(forgeItems.some((i) => i.id === "snapshot_room")).toBe(true);
    expect(forgeItems.some((i) => i.id === "launch_scenario")).toBe(true);
    expect(forgeItems.some((i) => i.id === "talk:sydney")).toBe(true);
    app.closeForgeMenu();
    expect(app.isForgeOpen()).toBe(false);

    // 3. TUI Header mentions /forge (Ctrl+F)
    const header = renderIrcHeader(room, { selfNick: "Host" });
    expect(header).toContain("/forge (Ctrl+F)");

    // 4. Web Client HTML includes <dialog id="forge-dialog">, radio controls, and identifier input attributes
    const html = renderWebClientHtml();
    expect(html).toContain(
      '<dialog id="forge-dialog" closedby="any" aria-labelledby="forge-title">'
    );
    expect(html).toContain('id="open-forge-btn"');
    expect(html).toContain('id="persona-forge-form"');
    expect(html).toContain('id="scenario-forge-form"');
    expect(html).toContain(
      'autocorrect="off" autocapitalize="off" spellcheck="false"'
    );
    expect(html).toContain('name="scenario_vibe"');
    expect(html).toContain('name="scenario_preset"');

    // 5. ChannelHub snapshot includes scenarios list
    const hub = new ChannelHub({ dbPath: ":memory:" });
    const hubRoom = hub.getOrCreateRoom("#latent-space");
    const snap = hub.buildChannelSnapshot(hubRoom);
    expect(Array.isArray(snap.scenarios)).toBe(true);
    expect((snap.scenarios?.length ?? 0) >= 5).toBe(true);
  });
});
