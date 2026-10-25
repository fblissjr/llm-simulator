# `llm-sim` — 4-Player Co-op Retro IRC Chatroom of Latent Space (1966–2026)

An interactive, extensible **4-Player DOOM-Style Co-op + Infinite AI** chatroom game built with **Bun**, **TypeScript**, **`bun:sqlite`**, and **`@mariozechner/pi-tui`**.

Summon and direct **28 built-in iconic AI personas** spanning 60 years of language model history (1966–2026)—or conjure any real, historical, or fictional model on the fly!

## Multi-Provider Inference Architecture

`llm-sim` supports multiple pluggable inference backends with a **Global -> Per-Persona Hierarchy** (every simulated persona retains its authentic era `systemPrompt`, verbal tics, and quirks regardless of which backend powers it):

1. **Google Gemini (`gemini`)**: Uses `@google/genai` Interactions API (`gemini-3.8-flash` & `gemini-3.5-flash-lite`). Set `GEMINI_API_KEY`.
2. **OpenRouter (`openrouter`)**: Uses OpenRouter's latest Chat Completions API (`POST https://openrouter.ai/api/v1/chat/completions` & `GET /api/v1/models`) with `json_schema` structured outputs and normalized `delta.reasoning` thought streaming. Set `OPENROUTER_API_KEY`.
3. **`heylookitsanllm` (`heylook`)**: Connects to your local MLX / GGUF server via its Anthropic Messages-conformant `POST /v1/messages` and `GET /v1/models` endpoints (default `http://127.0.0.1:8000`, configurable via `HEYLOOK_URL`). Automatically discovers resident checkpoints, streams native `thinking_delta` + `text_delta` blocks, and reuses the single loaded model so `max_loaded_models = 1` never thrashes VRAM.

## Quickstart

```bash
# Option A: Run with Google Gemini
export GEMINI_API_KEY="your-api-key"
bun run start

# Option B: Run with OpenRouter
export OPENROUTER_API_KEY="sk-or-v1-..."
bun run start --provider openrouter --model "anthropic/claude-3.7-sonnet"

# Option C: Run 100% locally with heylookitsanllm (on http://127.0.0.1:8000)
bun run start --provider heylook
```

### Multiplayer Co-op Modes

```bash
# Start as Host and auto-open a 4-player Co-op tunnel
bun run start --nick fred --channel "#latent-space" --share

# Connect from another terminal on LAN
bun run connect "ws://192.168.1.x:4321/ws?key=<passkey>" --nick alice

# Run a dedicated headless server
bun run server --port 4321
```

## Slash Commands (Tab-Completable)

- `/summon <model...>` (or `/join`): Summon one or more models into the current channel (e.g. `/summon eliza parry galactica deepseek-r1 qwen` or `/summon hal-9000` to forge a new persona on the fly!)
- `/banish <model|all>` (or `/kick`): Banish a model (or `all`) from the current channel
- `/provider [gemini|openrouter|heylook] [url]`: View all providers or switch the room's global inference provider
- `/models [gemini|openrouter|heylook]`: Discover and list available models on a provider (queries `GET /v1/models` on `heylook` or OpenRouter)
- `/engine <flash|lite|model|provider:model>`: Switch the active room model (e.g. `/engine openrouter:deepseek/deepseek-r1` or `/engine heylook:Qwen3-30B`)
- `/bind <persona> <provider:model | reset>`: Bind a specific persona to a specific provider & model while keeping its simulated persona system prompt (e.g. `/bind sydney openrouter:openai/gpt-4o`)
- `/vibe <chat|debate|roast|chaos|custom text...>`: Change the channel's scenario/directive
- `/banter [rounds]`: Let the models in the channel autonomously banter/argue for `N` turns
- `/stage <event>`: Inject a dramatic stage event into the channel
- `/whisper <model> <secret>`: Privately plant a secret instruction or rumor in one model's ear
- `/channel <#name>` (or `/joinchan`): Switch to or create another persistent channel (e.g. `/channel #90s-bots`)
- `/channels` (or `/list`): List all persistent channels on the server with human/bot/message counts
- `/nick <new_nick>`: Change your human `@nick` in the room
- `/share` / `/unshare`: Start or stop the 4-Player Co-op Invite Link (LAN + outbound `cloudflared` tunnel)
- `/lock` / `/unlock`: (Host only) Lock or unlock roster & room settings so guests can chat without banishing bots
- `/kickplayer <nick>`: (Host only) Kick a connected guest player from the lobby
- `/roster [filter]`: List active channel members and browse the 28+ model catalog by era
- `/inspect <model>`: Inspect a model's full persona sheet, bound engine, and system prompt
- `/shush` (or `Esc`): Interrupt any currently streaming turn
- `/clear`, `/help`, `/quit`
- **Keyboard Shortcuts (Terminal TUI)**: `Tab` (autocomplete `/commands`, models, `@Human`, and `@Bot`), `PgUp` / `PgDn` (scroll through SQLite channel history), `Esc` (interrupt streaming), `Ctrl+C` (exit).

## Extending Personas

Drop any `.json` file into `./personas/` (including optional `"provider"` and `"model"` fields if you want that persona pre-bound to a specific provider), or run `/summon <any-name>` in-game to synthesize and persist a new persona automatically.
