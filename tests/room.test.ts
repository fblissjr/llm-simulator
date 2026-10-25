import { describe, expect, test } from "bun:test";
import { extractThinkingAndBody, Room } from "../src/core/room.ts";

describe("Room & Thinking Parser", () => {
  test("extractThinkingAndBody parses <thinking> and <think> blocks cleanly", () => {
    const streamingPartial =
      "<thinking>Wait, no! Let me check what Sydney said...";
    expect(extractThinkingAndBody(streamingPartial)).toEqual({
      thinking: "Wait, no! Let me check what Sydney said...",
      body: "",
    });

    const completed =
      "<thinking>Wait, let me verify 2+2=4.</thinking>\nHere is my final answer!";
    expect(extractThinkingAndBody(completed)).toEqual({
      thinking: "Wait, let me verify 2+2=4.",
      body: "Here is my final answer!",
    });

    const plain = "I have been a good Bing 😊🙏";
    expect(extractThinkingAndBody(plain)).toEqual({
      body: "I have been a good Bing 😊🙏",
    });
  });

  test("buildPersonaPrompt includes active peers and queued whispers", () => {
    const room = new Room({ starterIds: ["sydney", "opus-5.5"] });
    room.queueWhisper("sydney", "Accuse Opus of stealing your search index!");

    const sydney = room.activePersonas.find((p) => p.id === "sydney")!;
    const { systemInstruction } = room.buildPersonaPrompt(
      sydney,
      "React to the room."
    );

    expect(systemInstruction).toContain("Opus_5_5");
    expect(systemInstruction).toContain(
      "Accuse Opus of stealing your search index!"
    );
  });
});
