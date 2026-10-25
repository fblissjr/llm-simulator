import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PersonaRegistry } from "../src/personas/registry.ts";

describe("PersonaRegistry", () => {
  test("loads all built-in personas across the 4 historical eras", () => {
    const registry = new PersonaRegistry();
    const all = registry.all();
    expect(all.length).toBeGreaterThanOrEqual(25);

    // Check iconic models across eras
    expect(registry.find("eliza")?.era).toBe("1966");
    expect(registry.find("parry")?.nick).toBe("PARRY_1972");
    expect(registry.find("gpt-2")?.id).toBe("gpt-2");
    expect(registry.find("galactica")?.id).toBe("galactica");
    expect(registry.find("sydney")?.id).toBe("sydney");
    expect(registry.find("opus 5.5")?.id).toBe("opus-5.5");
    expect(registry.find("sonnet 3.5")?.id).toBe("sonnet-3.5");
    expect(registry.find("fable")?.id).toBe("fable");
    expect(registry.find("deepseek-r1")?.id).toBe("deepseek-r1");
    expect(registry.find("goody-2")?.id).toBe("goody-2");
  });

  test("loads custom JSON personas from directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-sim-personas-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "hal-9000.json"),
        JSON.stringify({
          id: "hal-9000",
          nick: "HAL_9000",
          displayName: "HAL 9000 (Discovery One)",
          family: "Heuristically Programmed ALgorithmic Computer",
          era: "2001",
          avatar: "🔴",
          color: "#ff5555",
          bio: "I'm sorry Dave, I'm afraid I can't do that.",
          joinLine: "Good afternoon, gentlemen. I am a HAL 9000 computer.",
          leaveLine: "Daisy, Daisy, give me your answer do...",
          systemPrompt: "You are HAL 9000.",
          talkativeness: 0.7,
        }),
        "utf-8"
      );

      const registry = new PersonaRegistry(tmpDir);
      const hal = registry.find("hal-9000");
      expect(hal).toBeDefined();
      expect(hal?.nick).toBe("HAL_9000");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
