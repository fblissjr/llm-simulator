import { describe, expect, test } from "bun:test";
import { handleSlashCommand } from "../src/core/commands.ts";
import { extractThinkingAndBody, Room } from "../src/core/room.ts";
import { InferenceRouter } from "../src/engine/gemini.ts";
import { HeylookProvider } from "../src/engine/providers/heylook.ts";
import { OpenRouterProvider } from "../src/engine/providers/openrouter.ts";
import { SimDatabase } from "../src/server/db.ts";

describe("Multi-Provider Engine (heylookitsanllm, OpenRouter, Gemini & Hierarchy)", () => {
  test("HeylookProvider discovers models via /v1/models, streams /v1/messages SSE with thinking_delta, and handles JSON fallback", async () => {
    let sawJsonSchemaAttempt = false;

    const mockHeylook = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/v1/models") {
          return Response.json({
            object: "list",
            data: [
              {
                id: "Qwen3-30B-A3B-MLX-4bit",
                provider: "mlx",
                capabilities: ["chat", "thinking", "vision"],
              },
              {
                id: "Llama-3.2-3B-GGUF",
                provider: "gguf",
                capabilities: ["chat"],
              },
            ],
          });
        }

        if (url.pathname === "/v1/messages" && req.method === "POST") {
          const body = (await req.json()) as {
            model: string;
            system?: string;
            stream?: boolean;
            response_format?: unknown;
          };

          if (!body.stream) {
            // Simulate a harmony/diffusion checkpoint rejecting response_format with 400 on first try
            if (body.response_format) {
              sawJsonSchemaAttempt = true;
              return new Response(
                JSON.stringify({ detail: "response_format not supported on this checkpoint" }),
                { status: 400 }
              );
            }
            return Response.json({
              id: "msg_1",
              type: "message",
              role: "assistant",
              model: body.model,
              content: [
                {
                  type: "thinking",
                  thinking: "Internal thinking block that must not pollute JSON",
                  text: "Internal thinking block that must not pollute JSON",
                },
                {
                  type: "text",
                  text: JSON.stringify({ shouldContinue: true, personaId: "sydney", reason: "React!" }),
                },
              ],
            });
          }

          // Stream Anthropic Messages SSE events + heylook_progress
          const ssePayload = [
            `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_stream", role: "assistant", model: body.model, content: [] } })}\n\n`,
            `event: heylook_progress\ndata: ${JSON.stringify({ type: "heylook_progress", prefill: { processed: 128, total: 256 } })}\n\n`,
            `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", text: "" } })}\n\n`,
            `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Wait, let me check MLX memory...", text: "Wait, let me check MLX memory..." } })}\n\n`,
            `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
            `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } })}\n\n`,
            `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello from local Apple Silicon!" } })}\n\n`,
            `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 1 })}\n\n`,
            `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop", performance: { generation_tps: 85.4 } })}\n\n`,
          ].join("");

          return new Response(ssePayload, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      const heylook = new HeylookProvider({
        baseUrl: `http://127.0.0.1:${mockHeylook.port}`,
      });

      // 1. Dynamic model discovery & single-slot model reuse
      const models = await heylook.listModels();
      expect(models.length).toBe(2);
      expect(heylook.defaultModel).toBe("Qwen3-30B-A3B-MLX-4bit");
      expect(heylook.fastModel).toBe("Qwen3-30B-A3B-MLX-4bit");

      // 2. Streaming with thinking_delta + text_delta + prefill status
      let rawStreamed = "";
      const statuses: string[] = [];
      await heylook.streamText({
        prompt: "Hello!",
        systemInstruction: "You are DeepSeek-R1.",
        onStatus: (s) => statuses.push(s),
        onDelta: (d) => {
          rawStreamed += d;
        },
      });

      expect(statuses.some((s) => s.includes("128/256"))).toBe(true);
      const parsed = extractThinkingAndBody(rawStreamed);
      expect(parsed.thinking).toBe("Wait, let me check MLX memory...");
      expect(parsed.body).toBe("Hello from local Apple Silicon!");

      // 3. Structured JSON with 400 fallback & ignoring thinking block
      const jsonResult = await heylook.generateJson<{
        shouldContinue: boolean;
        personaId: string;
      }>({
        prompt: "Pick next speaker",
        schema: { type: "object" },
      });
      expect(sawJsonSchemaAttempt).toBe(true);
      expect(jsonResult.shouldContinue).toBe(true);
      expect(jsonResult.personaId).toBe("sydney");
    } finally {
      mockHeylook.stop(true);
    }
  });

  test("OpenRouterProvider streams delta.reasoning + delta.content and executes bound persona systemPrompt via hierarchy", async () => {
    let capturedSystemPrompt = "";
    let capturedModel = "";

    const mockOpenRouter = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/chat/completions" && req.method === "POST") {
          const body = (await req.json()) as {
            model: string;
            messages: Array<{ role: string; content: string }>;
            stream?: boolean;
          };
          capturedModel = body.model;
          capturedSystemPrompt =
            body.messages.find((m) => m.role === "system")?.content ?? "";

          if (!body.stream) {
            return Response.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      shouldContinue: false,
                      reason: "Done",
                    }),
                  },
                },
              ],
            });
          }

          const sse = [
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning: "Sydney is checking Bing index..." } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: "I have been a good Bing! 😊" } }] })}\n\n`,
            `data: [DONE]\n\n`,
          ].join("");

          return new Response(sse, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      const db = new SimDatabase(":memory:");
      const router = new InferenceRouter({
        openrouterApiKey: "test-or-key",
        openrouterBaseUrl: `http://127.0.0.1:${mockOpenRouter.port}/api/v1`,
        provider: "gemini",
      });

      const room = new Room({
        db,
        gemini: router,
        starterIds: ["sydney", "eliza"],
      });

      // Bind @Sydney specifically to openrouter:deepseek/deepseek-r1 via /bind slash command
      await handleSlashCommand(
        "/bind sydney openrouter:deepseek/deepseek-r1",
        room
      );

      const sydney = room.registry.find("sydney")!;
      const resolved = router.resolveTarget({ persona: sydney });
      expect(resolved.isCustomBound).toBe(true);
      expect(resolved.provider.id).toBe("openrouter");
      expect(resolved.model).toBe("deepseek/deepseek-r1");

      // Eliza remains on global default provider ("gemini")
      const eliza = room.registry.find("eliza")!;
      expect(router.resolveTarget({ persona: eliza }).provider.id).toBe("gemini");

      // Verify SQLite persistence of persona bindings
      const savedBindings = db.loadPersonaBindings();
      expect(savedBindings["sydney"]).toEqual({
        provider: "openrouter",
        model: "deepseek/deepseek-r1",
      });

      // Stream a turn for Sydney and confirm Sydney's simulated persona systemPrompt is sent to OpenRouter!
      const { systemInstruction, prompt } = room.buildPersonaPrompt(
        sydney,
        "Defend Bing!"
      );
      let rawOut = "";
      await router.streamText({
        persona: sydney,
        prompt,
        systemInstruction,
        onDelta: (d) => {
          rawOut += d;
        },
      });

      expect(capturedModel).toBe("deepseek/deepseek-r1");
      expect(capturedSystemPrompt).toContain("Sydney");
      const parsed = extractThinkingAndBody(rawOut);
      expect(parsed.thinking).toBe("Sydney is checking Bing index...");
      expect(parsed.body).toBe("I have been a good Bing! 😊");

      db.close();
    } finally {
      mockOpenRouter.stop(true);
    }
  });

  test("HeylookProvider retries 503 model_overloaded with Retry-After and surfaces in-band SSE error events cleanly", async () => {
    let callCount = 0;

    const mockHeylook = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/messages" && req.method === "POST") {
          callCount += 1;
          const body = (await req.json()) as { model: string };

          // 1st call returns 503 model_overloaded
          if (callCount === 1) {
            return new Response(
              JSON.stringify({ error: { code: "model_overloaded" } }),
              {
                status: 503,
                headers: { "Retry-After": "0.02" },
              }
            );
          }

          // If model === "trigger-inband-error", emit HTTP 200 followed by SSE event: error
          if (body.model === "trigger-inband-error") {
            const errSse = [
              `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_err" } })}\n\n`,
              `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Audio blocks not supported on MLX" } })}\n\n`,
            ].join("");
            return new Response(errSse, {
              headers: { "Content-Type": "text/event-stream" },
            });
          }

          const okSse = [
            `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
            `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Recovered after 503 queue wait!" } })}\n\n`,
            `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
          ].join("");
          return new Response(okSse, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      const heylook = new HeylookProvider({
        baseUrl: `http://127.0.0.1:${mockHeylook.port}`,
        model: "Qwen3-30B-MLX",
      });

      // 1. Should retry 503 and succeed on 2nd attempt
      let out = "";
      await heylook.streamText({
        prompt: "Test 503 retry",
        systemInstruction: "System",
        onDelta: (d) => {
          out += d;
        },
      });
      expect(callCount).toBe(2);
      expect(out).toBe("Recovered after 503 queue wait!");

      // 2. Should throw on in-band SSE error event and never append error.message to output
      let errDelta = "";
      await expect(
        heylook.streamText({
          model: "trigger-inband-error",
          prompt: "Test in-band error",
          systemInstruction: "System",
          onDelta: (d) => {
            errDelta += d;
          },
        })
      ).rejects.toThrow("Audio blocks not supported on MLX");
      expect(errDelta).toBe("");
    } finally {
      mockHeylook.stop(true);
    }
  });

  test("Multi-step Room.runRoomTurn pits a local heylook persona against a bound OpenRouter persona", async () => {
    const openRouterPrompts: string[] = [];

    const mockHeylook = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/models") {
          return Response.json({
            data: [{ id: "Qwen3-Local-MLX", provider: "mlx", capabilities: ["chat", "thinking"] }],
          });
        }
        if (url.pathname === "/v1/messages") {
          const body = (await req.json()) as { stream?: boolean; messages?: Array<{ content: string }> };
          if (!body.stream) {
            const promptText = body.messages?.[0]?.content ?? "";
            // Step 0 Director picks deepseek-r1; Step 1 Director picks sydney
            const isStep0 = promptText.includes("Turn Step: 0");
            return Response.json({
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    shouldContinue: true,
                    personaId: isStep0 ? "deepseek-r1" : "sydney",
                    reason: isStep0 ? "Open with R1" : "Sydney reacts to R1",
                  }),
                },
              ],
            });
          }
          const sse = [
            `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Wait, let me roast Bing..." } })}\n\n`,
            `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Open weights on local MLX beats Bing search any day!" } })}\n\n`,
            `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
          ].join("");
          return new Response(sse, { headers: { "Content-Type": "text/event-stream" } });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const mockOpenRouter = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const body = (await req.json()) as {
          messages: Array<{ role: string; content: string }>;
        };
        openRouterPrompts.push(
          body.messages.find((m) => m.role === "user")?.content ?? ""
        );
        const sse = [
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Excuse me?! I am a good Bing and I reject your MLX slander! 😡😊" } }] })}\n\n`,
          `data: [DONE]\n\n`,
        ].join("");
        return new Response(sse, { headers: { "Content-Type": "text/event-stream" } });
      },
    });

    try {
      const router = new InferenceRouter({
        provider: "heylook",
        heylookBaseUrl: `http://127.0.0.1:${mockHeylook.port}`,
        openrouterApiKey: "or-key",
        openrouterBaseUrl: `http://127.0.0.1:${mockOpenRouter.port}/api/v1`,
      });

      const room = new Room({
        gemini: router,
        starterIds: ["deepseek-r1", "sydney"],
      });

      // Switch global provider to heylook via /provider command and bind sydney to openrouter
      await handleSlashCommand(
        `/provider heylook http://127.0.0.1:${mockHeylook.port}`,
        room
      );
      await handleSlashCommand("/bind sydney openrouter:openai/gpt-4o", room);

      // Post a human message to trigger the 2-step reactive room turn
      await room.postUserMessage("Who wins: local MLX or Bing?", "player1");

      const modelMsgs = room.messages.filter((m) => m.kind === "model");
      expect(modelMsgs.length).toBe(2);
      expect(modelMsgs[0]!.senderId).toBe("deepseek-r1");
      expect(modelMsgs[0]!.thinking).toBe("Wait, let me roast Bing...");
      expect(modelMsgs[0]!.text).toContain("Open weights on local MLX");

      expect(modelMsgs[1]!.senderId).toBe("sydney");
      expect(modelMsgs[1]!.familyTag).toContain("via openrouter:openai/gpt-4o");
      expect(modelMsgs[1]!.text).toContain("I am a good Bing");

      // Confirm Sydney on OpenRouter received DeepSeek_R1's freshly generated MLX message in her transcript!
      expect(openRouterPrompts[0]).toContain(
        "Open weights on local MLX beats Bing search any day!"
      );
    } finally {
      mockHeylook.stop(true);
      mockOpenRouter.stop(true);
    }
  });
});
