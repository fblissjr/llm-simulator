import { describe, expect, test } from "bun:test";
import { Room } from "../src/core/room.ts";
import { BUILTIN_PERSONAS } from "../src/personas/builtin.ts";
import { PersonaRegistry } from "../src/personas/registry.ts";
import { SimDatabase } from "../src/server/db.ts";

describe("SQLite Persistence & 28-Persona Catalog", () => {
  test("Catalog contains all 28 built-in historical & frontier personas (1966–2026)", () => {
    expect(BUILTIN_PERSONAS.length).toBeGreaterThanOrEqual(28);
    const registry = new PersonaRegistry();
    expect(registry.find("eliza")?.id).toBe("eliza");
    expect(registry.find("qwen")?.id).toBe("qwen");
    expect(registry.find("llama-3.1-405b")?.id).toBe("llama-3.1-405b");
    expect(registry.find("gemini")?.id).toBe("gemini-pro");
  });

  test("SimDatabase persists channel rosters, messages, vibes, and custom personas across Room instances", () => {
    const db = new SimDatabase(":memory:");
    const reg1 = new PersonaRegistry(undefined, db);

    const room1 = new Room({
      channelName: "#retro-lab",
      db,
      registry: reg1,
      starterIds: ["eliza", "parry"],
    });

    room1.setVibe("roast");
    const sydney = reg1.find("sydney")!;
    room1.join(sydney);
    room1.addSystemMessage("Welcome to #retro-lab!", "system", true);

    // Register a custom persona and summon it
    const halPersona = {
      id: "hal-9000",
      aliases: ["hal", "hal9000"],
      nick: "HAL_9000",
      displayName: "HAL 9000",
      family: "Discovery One",
      era: "2001",
      eraGroup: "Custom / Summoned" as const,
      color: "#ff5555",
      avatar: "🔴",
      bio: "I'm sorry Dave, I'm afraid I can't do that.",
      joinLine: "HAL_9000 has joined the pod bay.",
      leaveLine: "Daisy, Daisy...",
      systemPrompt: "Speak like HAL 9000.",
      talkativeness: 0.7,
    };
    reg1.register(halPersona);
    room1.join(halPersona);

    // Re-hydrate a second Room and PersonaRegistry from the same SQLite DB
    const reg2 = new PersonaRegistry(undefined, db);
    expect(reg2.find("hal-9000")?.nick).toBe("HAL_9000");

    const room2 = new Room({
      channelName: "#retro-lab",
      db,
      registry: reg2,
    });

    expect(room2.vibeKey).toBe("roast");
    expect(room2.activePersonas.map((p) => p.id)).toEqual([
      "eliza",
      "parry",
      "sydney",
      "hal-9000",
    ]);
    expect(
      room2.messages.some((m) => m.text.includes("Welcome to #retro-lab!"))
    ).toBe(true);

    db.close();
  });
});
