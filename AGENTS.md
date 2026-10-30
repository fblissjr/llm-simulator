# `AGENTS.md` — Developer & Agent Guide for `llm-sim`

## Project Overview

`llm-sim` is a **4-Player DOOM-Style Co-op + Infinite AI** Retro IRC / BBS terminal & browser chatroom game built with **Bun**, **TypeScript**, **`bun:sqlite`**, and **`@mariozechner/pi-tui`**. Players summon, banish, and direct **28+ historical and frontier LLMs (1966–2026)** inside persistent channels (`#latent-space`, etc.).

## Commands

- **Typecheck**: `bun run typecheck` (`tsc --noEmit`)
- **Run Tests**: `bun test`
- **Start (Host TUI + Local Server)**: `bun run start [--provider gemini|openrouter|heylook] [--model <id>] [--nick <name>] [--channel <#chan>] [--share]`
- **Start Headless Server**: `bun run server [--port 4321] [--share]`
- **Connect Terminal Client**: `bun run connect <ws-or-http-invite-url> [--nick <name>]`

## Architecture & Module Map

- `docs/PROVIDERS.md` — Comprehensive setup guide for `gemini`, `openrouter`, `heylookitsanllm`, and per-persona `/bind` configurations.
- `docs/ROADMAP.md` — Granular simulation variables (`SimConfig`), pacing presets (`manual`, `chill`, `lively`, `banter`, `chaos`), curated scenarios, and long-term roadmap.
- `src/index.ts` — CLI entrypoint (`host`, `server`, and `connect` modes).
- `src/types.ts` — Shared domain types (`Persona`, `ChatMessage`, `ProviderId`, `PersonaEngineBinding`, `ChannelSnapshot`, `ClientPacket`, `ServerPacket`).
- `src/engine/` — Multi-Provider Inference Layer:
  - `src/engine/types.ts` — `LLMProvider` interface, `ProviderModelInfo`, and `parseJsonLoose`.
  - `src/engine/gemini.ts` — `InferenceRouter` (exported also as `GeminiEngine` for backwards compatibility). Resolves provider/model per turn using the hierarchy: **Per-Persona Binding (`/bind`) -> Global Room Provider (`/provider` + `/engine`) -> Startup Auto-Detection**.
  - `src/engine/providers/gemini.ts` — `GeminiProvider`: Uses `@google/genai` **Interactions API** (`client.interactions.create`, never legacy `models.generateContent`). Default models: `gemini-3.8-flash` (streaming) and `gemini-3.5-flash-lite` (fast JSON/Director).
  - `src/engine/providers/openrouter.ts` — `OpenRouterProvider`: Uses `POST https://openrouter.ai/api/v1/chat/completions` and `GET /api/v1/models`. Supports `json_schema` structured outputs (with prompt-JSON fallback) and wraps normalized `delta.reasoning` / `delta.reasoning_content` tokens inside `<thinking>...</thinking>`.
  - `src/engine/providers/heylook.ts` — `HeylookProvider`: Connects to local `heylookitsanllm` (`http://127.0.0.1:8000` by default, or `HEYLOOK_URL`).
  - `src/engine/director.ts` — `RoomDirector`: Reactive post-turn speaker selector (`pickNextSpeaker`) with deterministic heuristic fallback when offline or if a local checkpoint does not support structured JSON.
- `src/personas/` — Persona Catalog & Forge:
  - `src/personas/builtin.ts` — 28 built-in historical personas across 4 eras (`1966–2016`, `2019–2022`, `2022–2023`, `2024–2026`).
  - `src/personas/registry.ts` — `PersonaRegistry`: Fuzzy lookup (`find`), custom `./personas/*.json` loader, SQLite custom persona sync, and dynamic on-the-fly persona synthesis (`summonOrCreate`) when a user summons an unknown model name.
- `src/core/` — Room State, Simulation Config & Slash Commands:
  - `src/core/sim-config.ts` — `SimConfig` presets (`manual`, `chill`, `lively`, `banter`, `chaos`), 30 granular simulation & emergent feature variable descriptors across 6 categories (`pacing`, `director`, `ambient`, `emergent`, `memory`, `display`), `applySimConfigMutation`, and `BUILTIN_SCENARIOS`.
  - `src/core/relations.ts` — `RelationGraph` & `BUILTIN_RELATIONS`: 18 historical inter-persona rivalries/affinities (`-100` Arch-Rivals to `+100` Kindred/Bliss), SQLite persistence (`persona_relations`), dynamic post-turn sentiment shifts (`observeBotTurn`), and `RoomDirector` candidate priority boosts.
  - `src/core/moods.ts` — `MOOD_PRESETS`, `resolveMoodState`, `getMoodPromptHint`, `extractBotMoodShift`, and `formatMoodBadge` for live persona moods, energy multipliers, and temporary obsessions.
  - `src/core/image-gen.ts` — Multimodal IRC art helpers (`extractBotImagePrompts`, `buildEraStyledImagePrompt`, `renderAnsiCardPreview`, `generateRetroSvgDataUri`).
  - `src/core/room.ts` — `Room`: Manages active personas, connected humans, `<thinking>` stream extraction (`extractThinkingAndBody`), autonomous bot emoji reactions (`extractBotReactions`), `[IMAGINE: ...]` art (`conjureImage`, `buildImageAttachment`), and `[MOOD: ...]` shifts (`setPersonaMood`, `observeTurnMood`), whispers, rolling channel episodic memory (`lore`) with automatic roll-up, Co-op Shared Scratchpad (`sharedPad`, `updateSharedPad`, `fireSharedPad`), message emoji reactions & Hall of Fame pins (`toggleReaction`, `pinMessage`), Blind Turing Arena party mode (`startArenaGame`, `submitArenaGuess`, `revealArenaGame`), Replay Theater (`replayTranscript`), organic reading/inter-speaker delays, `humanDebounceMs` coalescing, `yield` human-interruption handling, human typing tracking (`markHumanTyping`), ambient background chatter (`checkAmbientTick`) with `ambientMaxConsecutive` safety caps, and the reactive multi-step turn loop (`runRoomTurn`).
  - `src/core/commands.ts` — Slash command definitions (`/summon`, `/banish`, `/forge`, `/make-scenario`, `/settings`, `/config`, `/scenario`, `/lore`, `/relations`, `/mood`, `/react`, `/pin`, `/unpin`, `/pins`, `/game`, `/guess`, `/roam`, `/replay`, `/imagine`, `/pad`, `/me`, `/slap`, `/think`, `/export`, `/provider`, `/models`, `/engine`, `/bind`, `/vibe`, `/banter`, `/stage`, `/whisper`, `/channel`, `/channels`, `/nick`, `/share`, `/unshare`, `/lock`, `/unlock`, `/kickplayer`, `/roster`, `/inspect`, `/shush`, `/clear`, `/help`, `/quit`) and `ChatroomAutocompleteProvider`.
- `src/server/` — Multiplayer Co-op & Persistence:
  - `src/server/db.ts` — `SimDatabase` (`bun:sqlite` in WAL mode): Persists `channels`, `channel_bots`, `messages`, `custom_personas`, `custom_scenarios`, `persona_bindings`, `persona_relations`, and `server_settings` (`global_engine`).
  - `src/server/hub.ts` — `ChannelHub` (`Bun.serve` HTTP + WebSocket server): Enforces `MAX_HUMANS = 4` (DOOM-style 4-player co-op cap) plus read-only `?spectate=1` spectator slots, `?key=` passkey validation, per-guest message cooldowns, cross-channel bot roaming (`roamBot`), and multi-channel synchronization.
  - `src/server/web-client.ts` — Self-contained Retro CRT / IRC HTML/JS browser client served at `GET /?key=<passkey>` with interactive `<button type="button">` `@Nick` pills, collapsible `<details>` thought traces, and inline markdown rendering.
  - `src/server/tunnel.ts` — `TunnelManager`: Spawns outbound `cloudflared tunnel` for `/share` and detects LAN/Tailscale IPs.
- `src/ui/` — Terminal UI (`@mariozechner/pi-tui`):
  - `src/ui/app.ts` — `ChatroomApp` (supports both WebSocket client mode and standalone `Room` mode, `PageUp`/`PageDown` scrollback, and animated braille status spinner).
  - `src/ui/theme.ts` — Retro IRC header, per-persona `(provider:model)` binding badges, and inline markdown/thought styling.

## Critical Invariants & Provider Contracts

1. **`heylookitsanllm` Contract (`src/engine/providers/heylook.ts`)**:
   - Always use `POST /v1/messages` (Anthropic Messages wire format) and `GET /v1/models`. Never use `/v1/chat/completions` (removed in `heylook` v1.79.66).
   - Never hardcode model IDs for `heylook`; discover them at runtime via `GET /v1/models` and preload newly selected models via `POST /v1/models/{id}/load`.
   - Keep `defaultModel === fastModel` on `HeylookProvider` so single-slot local servers (`max_loaded_models = 1`) never thrash VRAM between Room Director and Persona turns.
   - Terminate `/v1/messages` SSE streams on `event: message_stop` (there is no `data: [DONE]`), handle in-band `event: error` by throwing (never render `error.message` as assistant text), and retry HTTP `503 model_overloaded` using `Retry-After`.
2. **Gemini SDK Contract (`src/engine/providers/gemini.ts`)**:
   - Always use `@google/genai` Interactions API (`client.interactions.create({ model, input, system_instruction, response_format, stream, store: false })`).
   - Default to `gemini-3.8-flash` and `gemini-3.5-flash-lite`.
3. **Per-Persona Simulation Prompt Integrity**:
   - When a persona is bound to a custom provider/model via `/bind <persona> <provider>:<model>`, `Room.buildPersonaPrompt` must still inject that persona's historical `systemPrompt`, quirks, and channel context so the underlying model roleplays the simulated persona faithfully.
4. **Path Privacy**:
   - Never include absolute home directory paths or personal identifiers in repo files, tests, or commit messages.
