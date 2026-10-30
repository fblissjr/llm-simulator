# `llm-sim` — 4-Player Co-op Retro IRC Chatroom of Latent Space (1966–2026)

An interactive, extensible **4-Player DOOM-Style Co-op + Infinite AI** chatroom game built with **Bun**, **TypeScript**, **`bun:sqlite`**, and **`@mariozechner/pi-tui`**.

Summon and direct **28 built-in iconic AI personas** spanning 60 years of language model history (1966–2026)—or conjure any real, historical, or fictional model on the fly!

## Multi-Provider Inference Architecture

`llm-sim` supports multiple pluggable inference backends with a **Global -> Per-Persona Hierarchy** (every simulated persona retains its authentic era `systemPrompt`, verbal tics, and quirks regardless of which backend powers it):

1. **Google Gemini (`gemini`)**: Uses `@google/genai` Interactions API (`gemini-3.8-flash` & `gemini-3.5-flash-lite`). Set `GEMINI_API_KEY`.
2. **OpenRouter (`openrouter`)**: Uses OpenRouter's latest Chat Completions API (`POST https://openrouter.ai/api/v1/chat/completions` & `GET /api/v1/models`) with `json_schema` structured outputs and normalized `delta.reasoning` thought streaming. Set `OPENROUTER_API_KEY`.
3. **`heylookitsanllm` (`heylook`)**: Connects to your local MLX / GGUF server via its Anthropic Messages-conformant `POST /v1/messages` and `GET /v1/models` endpoints (default `http://127.0.0.1:8000`, configurable via `HEYLOOK_URL`). Automatically discovers resident checkpoints, streams native `thinking_delta` + `text_delta` blocks, and reuses the single loaded model so `max_loaded_models = 1` never thrashes VRAM.

📖 **See the full [Provider Setup & Multi-Engine Guide (`docs/PROVIDERS.md`)](./docs/PROVIDERS.md)** for environment variables, local `heylookitsanllm` setup, hybrid `/bind` arenas, and adding new providers.
🎛️ **See the [Simulation Variables & Roadmap Guide (`docs/ROADMAP.md`)](./docs/ROADMAP.md)** for all 5 pacing presets (`manual`, `chill`, `lively`, `banter`, `chaos`), 19+ granular `/config` knobs, ambient chatter safety caps, and curated `/scenario` showdowns.

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
bun run start --nick player1 --channel "#latent-space" --share

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
- `/settings [pacing|director|ambient|emergent|memory|display | <key> [val]]` (or `/menu`, `/options`, `Ctrl+O` in TUI, `⚙️ Settings` button in Web UI): Open the interactive Settings Control Center to toggle or tune all 30 granular simulation & emergent AI settings
- `/config [preset <manual|chill|lively|banter|chaos> | set <key> <val> | reset]`: Inspect or tune granular chatroom pacing, multi-bot chaining, reading delays, emergent AI toggles, and ambient life
- `/scenario [1972-arpanet|turing-trial|benchmark-roast|code-review-hell|bliss-spiral]`: Launch a curated multi-model showdown (summons cast, sets vibe & pacing, and fires an opening event)
- `/me <action>`: Perform a classic IRC action emote (`* @nick pours a cup of coffee`)
- `/slap <target>`: Classic 1998 mIRC easter egg (`* @nick slaps <Target> around a bit with a large 1998 mIRC trout 🐟`)
- `/lore [add <fact> | summarize | clear]`: View, add, or distill persistent channel lore & running jokes (automatically injected into bot prompts)
- `/relations [all | set <botA> <botB> <-100..100> [note] | reset]`: Inspect or customize the live inter-persona rivalry & affinity graph
- `/mood [<model> <mood> [obsession...] | reset [model]]` (or `/moods`, `/arc`, `/obsession`): Inspect or shift active personas' live emotional moods (`heated`, `paranoid`, `existential`, `hyperfixated`, `blissed-out`, `indignant`, `euphoric`, `melancholic`, etc.), energy multipliers, and rabbit-hole obsessions
- `/react <emoji> [@nick|text]`: Toggle an emoji reaction (`🔥`, `😂`, `💀`, `🧠`, `🌀`, `❤️`) on a message (or click reaction pills directly in the Web UI)
- `/pin [@nick|text]`, `/unpin`, `/pins`: Pin iconic quotes to the Channel Hall of Fame (persisted in SQLite and visible to bots)
- `/game [start [topic] | status | reveal]` (or `/arena`): Start a Blind Turing Arena party game where models speak under `<Mystery_A>`, `<Mystery_B>`, `<Mystery_C>` masks
- `/guess <A|B|C> <model>`: Lock in your guess for a masked model during Blind Turing Arena (`+100 pts` per match, `+50 pts` Perfect Sweep bonus)
- `/roam [model] [#target-channel]`: Send a model wandering into another persistent channel carrying fresh cross-channel gossip & lore
- `/imagine [@model] <prompt>` (or `/art`, `/draw`, `/paint`): Conjure an era-styled CRT/ANSI artwork into the channel (uses `gemini-nano-banana-2.1` when configured, or an era-authentic Dracula CRT SVG + ANSI half-block `▀` pixel preview offline)
- `/pad [show | set <text> | append <text> | fire [stage|chat|lore] | clear]`: View, edit, or fire the real-time 4-Player Co-op Shared Scratchpad
- `/think [compact|expanded|hidden]`: Toggle how `<thinking>` traces are displayed (or press `Ctrl+T` in the TUI)
- `/export [filename]`: Export the current channel transcript and roster to `./logs/<name>.md`
- `/replay [list | <filename> | stop]`: Play back any exported transcript from `./logs/` in Replay Theater mode
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
- **Keyboard Shortcuts (Terminal TUI)**: `Tab` (autocomplete `/commands`, models, `@Human`, and `@Bot`), `Ctrl+O` (open/close interactive Settings Control Center), `Ctrl+T` (cycle `<thinking>` display: compact / expanded / hidden), `PgUp` / `PgDn` (scroll through SQLite channel history), `Esc` (interrupt streaming or close Settings modal), `Ctrl+C` (exit).

## Extending Personas

Drop any `.json` file into `./personas/` (including optional `"provider"` and `"model"` fields if you want that persona pre-bound to a specific provider), or run `/summon <any-name>` in-game to synthesize and persist a new persona automatically.
