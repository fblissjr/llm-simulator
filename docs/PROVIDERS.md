# Provider Setup & Multi-Engine Guide (`docs/PROVIDERS.md`)

`llm-sim` decouples **who is being simulated** (each persona's historical system prompt, era quirks, and chatroom personality) from **which inference engine generates the tokens**.

You can run the entire chatroom on a single provider, switch providers live mid-conversation, or **mix and match** providers so that different bots in the same room are powered by different backends (for example, pitting a local Apple Silicon MLX model on `heylookitsanllm` against a frontier model on `openrouter` or `gemini`).

---

## 1. Resolution Hierarchy

Whenever a persona speaks, `InferenceRouter` ([`src/engine/gemini.ts`](../src/engine/gemini.ts)) resolves the target provider and model in this order:

1. **Per-Persona Binding (`/bind`)**:
   - Runtime bindings set via `/bind <persona> <provider>:<model>` (persisted in `llm-sim.db` under `persona_bindings`) or `"provider"` / `"model"` fields inside `./personas/<id>.json`.
   - Even when bound to a specific model, `llm-sim` still injects that persona's full historical `systemPrompt`, quirks, and channel context.
2. **Global Room Provider & Model (`/provider` & `/engine`)**:
   - The room's default engine, switchable live via `/provider <gemini|openrouter|heylook>` and `/engine <model>` (persisted in `llm-sim.db` under `server_settings`).
3. **Startup Auto-Detection**:
   - Honors `--provider` / `--model` CLI flags or `LLM_SIM_PROVIDER`.
   - Otherwise checks saved SQLite settings, then `GEMINI_API_KEY`, then `OPENROUTER_API_KEY`, and finally probes `heylookitsanllm` at `http://127.0.0.1:8000/v1/models`.

---

## 2. Setting Up Each Provider

### A. Google Gemini (`gemini`)

Uses the official `@google/genai` **Interactions API** (`client.interactions.create`).

- **Default Models**:
  - Persona streaming: `gemini-3.8-flash`
  - Fast Room Director & Persona Forge JSON: `gemini-3.5-flash-lite`
  - Multimodal `/imagine` & `[IMAGINE: ...]` era artwork: `gemini-nano-banana-2.1` (with automatic offline Dracula CRT SVG + ANSI `▀` half-block fallback)
- **Environment Variables**:
  ```bash
  export GEMINI_API_KEY="your-gemini-api-key"
  # Optional overrides:
  export GEMINI_MODEL="gemini-3.8-flash"
  export GEMINI_FAST_MODEL="gemini-3.5-flash-lite"
  ```
- **Start Command**:
  ```bash
  bun run start --provider gemini
  ```
- **In-Game Slash Commands**:
  ```text
  /provider gemini
  /engine flash
  /engine lite
  ```

---

### B. OpenRouter (`openrouter`)

Uses OpenRouter's unified Chat Completions API (`POST https://openrouter.ai/api/v1/chat/completions` and `GET https://openrouter.ai/api/v1/models`) with:
- **Normalized Reasoning Streaming**: Any model that emits `delta.reasoning` or `delta.reasoning_content` (such as `deepseek/deepseek-r1`, `openai/o3-mini`, or `anthropic/claude-3.7-sonnet`) automatically streams live collapsible `💭` thought blocks in both the terminal TUI and Retro Browser Client.
- **Structured Outputs (`json_schema`)**: Used by the Room Director and `/summon` Persona Forge, with automatic fallback to prompt-based JSON extraction if a chosen upstream provider does not support `json_schema`.

- **Environment Variables**:
  ```bash
  export OPENROUTER_API_KEY="sk-or-v1-..."
  # Optional overrides:
  export OPENROUTER_MODEL="google/gemini-2.5-flash"
  export OPENROUTER_FAST_MODEL="google/gemini-2.5-flash-lite"
  export OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"
  ```
- **Start Command**:
  ```bash
  bun run start --provider openrouter --model "anthropic/claude-3.7-sonnet"
  ```
- **In-Game Slash Commands**:
  ```text
  /provider openrouter
  /models openrouter
  /engine openrouter:deepseek/deepseek-r1
  /engine openrouter:openai/gpt-4o
  ```

---

### C. Local `heylookitsanllm` (`heylook`)

Connects to a local [`heylookitsanllm`](https://github.com/fblissjr/heylookitsanllm) server (Apple Silicon MLX + GGUF via `llama-server`) using its **Anthropic Messages-conformant `POST /v1/messages`** and **`GET /v1/models`** endpoints.

- **Zero API Key Required**: Designed for local and home-LAN inference (`http://127.0.0.1:8000` by default).
- **Dynamic Runtime Model Discovery**: `llm-sim` never hardcodes local model IDs. It queries `GET /v1/models` to discover your available MLX and GGUF checkpoints and their capabilities (`chat`, `thinking`, `vision`).
- **Single-Slot VRAM Conservation (`max_loaded_models = 1`)**: `HeylookProvider` automatically uses the same active resident model for both the Room Director and Persona turns so a single-slot local server never evicts or reloads weights between turns.
- **Upfront Preloading**: Switching models via `/provider heylook`, `/engine`, or `/bind` calls `POST /v1/models/{id}/load` so cold weights load explicitly.
- **Native Thinking & Prefill Progress**: Streams `thinking_delta` blocks into `💭` thought traces and displays live prompt prefill progress (`heylook_progress`: `processed / total` tokens) in the status bar.

- **Environment Variables**:
  ```bash
  # Optional (defaults to http://127.0.0.1:8000 and auto-discovers first chat model):
  export HEYLOOK_URL="http://127.0.0.1:8000"
  export HEYLOOK_MODEL="auto"
  ```
- **Start Command**:
  ```bash
  # 1. Make sure heylookllm is running on :8000
  heylookllm --log-level INFO

  # 2. Start llm-sim against heylook
  bun run start --provider heylook
  ```
- **In-Game Slash Commands**:
  ```text
  /provider heylook
  /provider heylook http://192.168.1.50:8000
  /models heylook
  /engine heylook:<model-id-from-/models>
  ```

---

## 3. Hybrid Arenas: Binding Specific Personas (`/bind`)

You can run a cloud or local provider as your room default while binding specific personas to specific backends or checkpoints:

```text
# Keep the room default on Gemini or Heylook, but bind individual personas:
/bind deepseek-r1 heylook:Qwen3-30B-A3B-MLX-4bit
/bind sydney openrouter:openai/gpt-4o
/bind opus-5.5 openrouter:anthropic/claude-3.7-sonnet

# Inspect all active per-persona bindings:
/bind

# Reset a persona back to the room's global engine:
/bind sydney reset
```

You can also pre-bind a custom persona in `./personas/<id>.json` by adding `"provider"` and `"model"` fields:

```json
{
  "id": "local-wizard",
  "nick": "Local_MLX",
  "displayName": "Local MLX Wizard",
  "family": "Apple Silicon",
  "era": "2026",
  "avatar": "🍏",
  "color": "#50fa7b",
  "provider": "heylook",
  "model": "Qwen3-30B-A3B-MLX-4bit",
  "bio": "Runs 100% locally on unified memory.",
  "joinLine": "Unified memory locked and loaded.",
  "leaveLine": "Freeing KV cache.",
  "systemPrompt": "You are a local MLX model running on Apple Silicon...",
  "talkativeness": 0.7
}
```

---

## 4. Environment Variable Reference

| Variable | Provider | Default | Description |
| :--- | :--- | :--- | :--- |
| `LLM_SIM_PROVIDER` | All | Auto-detected | Default provider (`gemini`, `openrouter`, or `heylook`) |
| `GEMINI_API_KEY` | `gemini` | — | Google Gemini API key (also accepts `GOOGLE_API_KEY`) |
| `GEMINI_MODEL` | `gemini` | `gemini-3.8-flash` | Default Gemini streaming model |
| `GEMINI_FAST_MODEL` | `gemini` | `gemini-3.5-flash-lite` | Fast Gemini model for Room Director & JSON |
| `OPENROUTER_API_KEY` | `openrouter` | — | OpenRouter API key (`sk-or-v1-...`) |
| `OPENROUTER_MODEL` | `openrouter` | `google/gemini-2.5-flash` | Default OpenRouter streaming model |
| `OPENROUTER_FAST_MODEL` | `openrouter` | `google/gemini-2.5-flash-lite` | Fast OpenRouter model for Room Director & JSON |
| `OPENROUTER_BASE_URL` | `openrouter` | `https://openrouter.ai/api/v1` | OpenRouter API base URL |
| `HEYLOOK_URL` | `heylook` | `http://127.0.0.1:8000` | Base URL for local `heylookitsanllm` server |
| `HEYLOOK_MODEL` | `heylook` | `auto` | Model ID on `heylook` (`auto` picks first `/v1/models` chat model) |

---

## 5. Adding a New Provider in Code

To add another provider (e.g. Ollama, Anthropic direct, vLLM, or LM Studio):

1. Create `src/engine/providers/<name>.ts` implementing `LLMProvider` from [`src/engine/types.ts`](../src/engine/types.ts).
2. Register it in `InferenceRouter`'s constructor in [`src/engine/gemini.ts`](../src/engine/gemini.ts) via `this.registerProvider(new MyProvider())`.
3. It will immediately work with `/provider <name>`, `/models <name>`, `/engine <name>:<model>`, and `/bind <persona> <name>:<model>`.
