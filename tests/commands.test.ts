import { describe, expect, test } from "bun:test";
import {
  ChatroomAutocompleteProvider,
  handleSlashCommand,
} from "../src/core/commands.ts";
import { Room } from "../src/core/room.ts";

describe("Slash Commands & Autocomplete", () => {
  test("/summon and /banish add and remove models from the room", async () => {
    const room = new Room({ starterIds: ["sydney"] });
    expect(room.activePersonas.map((p) => p.id)).toEqual(["sydney"]);

    await handleSlashCommand("/summon eliza parry", room);
    expect(room.activePersonas.map((p) => p.id)).toEqual([
      "sydney",
      "eliza",
      "parry",
    ]);

    await handleSlashCommand("/banish eliza", room);
    expect(room.activePersonas.map((p) => p.id)).toEqual(["sydney", "parry"]);

    await handleSlashCommand("/banish all", room);
    expect(room.activePersonas.length).toBe(0);
  });

  test("/vibe and /engine update room configuration", async () => {
    const room = new Room({ starterIds: ["opus-5.5"] });
    await handleSlashCommand("/vibe roast", room);
    expect(room.vibeKey).toBe("roast");

    await handleSlashCommand("/vibe Everyone thinks it is 1999", room);
    expect(room.vibeKey).toBe("custom");
    expect(room.vibe).toBe("Everyone thinks it is 1999");

    await handleSlashCommand("/engine lite", room);
    expect(room.gemini.activeModel).toBe("gemini-3.5-flash-lite");
  });

  test("ChatroomAutocompleteProvider suggests commands, arguments, and @Nick mentions", async () => {
    const room = new Room({ starterIds: ["sydney", "opus-5.5"] });
    const ac = new ChatroomAutocompleteProvider(room);

    // 1. Slash command completion
    const cmdSug = await ac.getSuggestions(["/sum"], 0, 4);
    expect(cmdSug?.items.some((i) => i.value === "summon")).toBe(true);

    // 2. /summon argument completion (models not yet in room)
    const argSug = await ac.getSuggestions(["/summon eli"], 0, 11);
    expect(argSug?.items.some((i) => i.value === "eliza")).toBe(true);

    // 3. @Nick mention completion
    const mentionSug = await ac.getSuggestions(["hey @Syd"], 0, 8);
    expect(mentionSug?.items.some((i) => i.value === "@Sydney")).toBe(true);
  });
});
