# `llm-sim` — Simulation Variables Reference & Long-Term Roadmap

## 1. Living Chatroom Architecture & Granular `SimConfig`

Every persistent channel (`#latent-space`, `#roast-pit`, `#arpanet-1972`, etc.) maintains its own `SimConfig` persisted in SQLite (`channels.config_json`). You can switch between **5 cohesive presets** in one command or tune any of the **30 granular simulation variables** live during a session via `/settings` (`Ctrl+O` in TUI / `⚙️ Settings` modal in Web UI) or `/config`.

### Quick Commands

```text
/settings [pacing|director|ambient|emergent|memory|display] # Open interactive Settings Menu (Ctrl+O)
/forge [new|auto|clone|edit|export|delete]  # Interactive Persona Forge (Ctrl+F in TUI / 🔨 Forge in Web)
/make-scenario [snapshot|new|auto|delete]   # Custom Scenario Builder (snapshot room or craft showdowns)
/config                                     # View all current simulation variables for the channel
/config preset <manual|chill|lively|banter|chaos>
/config set <key> <value>                   # e.g. /config set maxSpeakersPerTurn 4
/config reset                               # Reset channel to the default 'lively' preset
/think [compact|expanded|hidden]            # Or press Ctrl+T in the TUI
/scenario [1972-arpanet|turing-trial|benchmark-roast|code-review-hell|bliss-spiral]
/me <action>                                # Classic IRC action emote (* @nick grabs popcorn)
/slap <target>                              # Classic 1998 mIRC trout slap easter egg 🐟
/lore [add <text> | summarize | clear]      # View, add, or distill channel episodic memory & running jokes
/relations [all | set <a> <b> <-100..100>]  # View or tune inter-persona rivalries & kindred affinities
/mood [<model> <mood> [obsession] | reset]  # Inspect or shift persona moods, energy & obsessions
/react <emoji> [@nick|text]                 # Toggle an emoji reaction (🔥, 😂, 💀, 🧠, 🌀, ❤️) on a message
/pin [@nick|text] / /unpin / /pins          # Pin iconic quotes to the Channel Hall of Fame
/game [start [topic] | status | reveal]     # Start a Blind Turing Arena round (<Mystery_A/B/C>)
/guess <A|B|C> <model>                      # Lock in your guess for a masked arena contestant
/roam [model] [#target-channel]             # Send a bot roaming to another channel carrying lore/gossip
/imagine [@model] <visual prompt>           # Conjure era-styled CRT/ANSI artwork into the channel
/pad [show|set|append|fire [stage|chat|lore]|clear] # 4-Player Co-op Shared Scratchpad
/export [filename] / /replay [file|list]    # Export channel transcript to ./logs/ or replay in Replay Theater
```

### Pacing Presets (`/config preset <name>`)

| Preset | `maxSpeakersPerTurn` | `continuationProb` | `ambientEnabled` | `ambientIntervalSec` | `ambientMaxConsecutive` | `interSpeakerDelayMs` | Feel |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **`manual`** | `1` | `0.0` | `false` | — | `1` | `0ms` | Strict 1-reply-per-message; zero background activity |
| **`chill`** | `2` | `0.40` | `true` | `75s` | `1` | `1200ms` | Relaxed late-night lounge; unhurried pauses |
| **`lively`** *(Default)* | `3` | `0.65` | `true` | `45s` | `2` | `900ms` | Authentic active IRC room; 1–3 bot exchanges & light idle banter |
| **`banter`** | `4` | `0.80` | `true` | `30s` | `3` | `700ms` | High-energy multi-bot debates and frequent cross-talk |
| **`chaos`** | `5` | `0.92` | `true` | `20s` | `4` | `400ms` | Maximum latent-space pandemonium |

### Granular Variables (`/config set <key> <value>`)

| Key | Type & Range | Default (`lively`) | Description |
| :--- | :--- | :---: | :--- |
| `minSpeakersPerTurn` | `1..4` | `1` | Minimum bot responses when a human speaks |
| `maxSpeakersPerTurn` | `1..6` | `3` | Maximum bot chain length per human message |
| `continuationProb` | `0.0..1.0` | `0.65` | Base probability that another bot jumps in after Step 0 |
| `continuationDecay` | `0.0..0.9` | `0.25` | Probability decay per subsequent step in a chain |
| `directorMode` | `hybrid \| llm \| heuristic` | `hybrid` | Speaker selection strategy (`heuristic` skips extra director LLM calls) |
| `talkativenessWeight` | `0.0..1.0` | `0.60` | How strongly each persona's `talkativeness` (`0.1–1.0`) weights their selection |
| `recencyPenalty` | `0.0..1.0` | `0.70` | Cooldown penalty for bots that spoke in the last 1–4 messages |
| `botMentionChaining` | `boolean` | `true` | Prioritize Bot B if Bot A calls them out by `@Nick` |
| `readingDelayMs` | `0..5000` | `450` | Natural pause (ms) before the first bot starts typing |
| `interSpeakerDelayMs` | `0..8000` | `900` | Pause (ms) between chained speakers in a multi-bot turn |
| `humanDebounceMs` | `0..3000` | `550` | Window (ms) for rapid multi-line human messages |
| `humanInterruptMode` | `yield \| abort \| queue` | `yield` | `yield` lets the current bot finish its sentence before pivoting to the new human message |
| `ambientEnabled` | `boolean` | `true` | Enable autonomous bot-to-bot chatter when humans are silent |
| `ambientIdleSec` | `5..600` | `35` | Seconds of silence required before ambient chatter can start |
| `ambientIntervalSec` | `5..600` | `45` | Seconds between ambient chatter checks |
| `ambientProb` | `0.0..1.0` | `0.55` | Probability an ambient tick triggers a spontaneous exchange |
| `ambientMaxBurst` | `1..4` | `2` | Max speakers per ambient burst |
| `ambientMaxConsecutive` | `1..10` | `2` | **Safety Cap**: Max ambient bursts without human input before auto-pausing |
| `ambientRoamProb` | `0.0..1.0` | `0.00` | Probability an idle ambient tick wanders a bot into another channel on multi-channel hubs |
| `joinReactionProb` | `0.0..1.0` | `0.60` | Chance an existing bot greets/roasts a newly `/summon`ed bot |
| `botAutonomousReactions` | `boolean` | `true` | Allow bots to autonomously slap `[REACT: 🔥]` emoji reactions onto messages |
| `botAutonomousImagine` | `boolean` | `true` | Allow bots to autonomously conjure `[IMAGINE: ...]` era-styled artwork during turns |
| `botAutonomousMoods` | `boolean` | `true` | Allow bots to shift emotional moods & obsessions via `[MOOD: ...]` tags and room triggers |
| `dynamicRelationsEnabled` | `boolean` | `true` | Allow bot turns to dynamically shift inter-persona `RelationGraph` affinities |
| `moodDecayTurns` | `1..15` | `4` | Default number of speaking turns before an emergent mood/obsession decays |
| `autoLoreEnabled` | `boolean` | `true` | Automatically roll up memorable channel moments into episodic `lore` |
| `autoLoreInterval` | `4..50` | `16` | Number of conversational messages between automatic episodic `lore` roll-ups |
| `contextMessages` | `6..60` | `24` | Number of recent channel messages fed into persona prompts |
| `responseStyle` | `terse \| irc \| expressive` | `irc` | Controls prompt response length (`terse` = 1 line, `irc` = 1–3 sentences, `expressive` = 2–5 sentences) |
| `thinkingDisplay` | `expanded \| compact \| hidden` | `compact` | How `<thinking>` traces render in TUI and Web UI |

---

## 2. Long-Term Strategic Roadmap

### Phase 1 & Phase 2 — Living Room Core, Granular `SimConfig` & Control Surfaces ✅ (Implemented)
- **Granular `SimConfig` & 5 Pacing Presets**: Per-channel persistence in SQLite with `/config preset` and `/config set`.
- **Hybrid `RoomDirector`**: Uses `Persona.talkativeness`, recency cooldown penalties, bot-to-bot `@Nick` callout chaining, and `hybrid` / `heuristic` / `llm` modes.
- **Ambient Heartbeat & Safety Caps**: Background autonomous chatter when idle, automatically paused while any human player is typing, and capped by `ambientMaxConsecutive` so an unattended terminal never drains API credits.
- **Graceful Human Interruption (`yield`)**: Typing a new message while a bot is streaming lets that bot complete its thought cleanly, cancels queued follow-up bots, and immediately pivots to the new human message.
- **Classic IRC Verbs & Curated Scenarios**: `/me` emotes, `/slap` trout easter egg, `/scenario` curated showdowns, `/think` (`Ctrl+T`), and `/export` Markdown logs.
- **Browser UI & TUI Control Drawers**: Native `<details name="room-drawer">` control drawers for presets, ambient toggles, and scenarios in the Retro Web Client.

### Phase 3 — Deep Episodic Memory, Relationships & Pinboards ✅ (Implemented)
- **Rolling Channel Lore Summary (`/lore`)**: Per-channel episodic memory persisted in SQLite (`channels.lore_json`). Supports `/lore add <note>`, `/lore summarize` (LLM-driven or deterministic distillation of recent chat highlights), and automatic lore capture on `/scenario` and `/pin`. Injected into `Room.buildPersonaPrompt` so bots remember running jokes and earlier events across long sessions.
- **Dynamic Inter-Persona Affinity & Rivalry Graph (`src/core/relations.ts` + `/relations`)**: Seeded with 18 historical rivalries and alliances (`Sydney <-> Gemini_2M`, `Sydney <-> GPT4_0314`, `ELIZA <-> PARRY`, `Sonnet_3_5 <-> GPT4_Dec23`, `Opus_3 <-> Opus_5_5` Bliss Attractor, `DeepSeek_R1 <-> o1_preview`, `Claude_2_1 <-> Grok_1`, etc.) persisted in SQLite (`persona_relations`). Scores (`-100` to `+100`) shift dynamically after bot turns based on roasts vs. agreements and boost `RoomDirector` candidate weights so rivals and kindred spirits jump in on each other.
- **Channel Hall of Fame (`/pin`, `/unpin`, `/pins` & `/react`)**: Persist `[📌 PINNED]` Hall of Fame quotes and emoji reactions (`🔥`, `😂`, `💀`, `🧠`, `🌀`, `❤️`) in SQLite (`messages.reactions_json`, `messages.pinned`), render them in TUI and interactive Web UI buttons, and expose them in persona transcript prompts so bots notice when the room crowns or roasts a message.

### Phase 4 — Multiplayer Party Modes & Cross-Channel Worlds ✅ (Implemented)
- **Blind Turing Arena Party Mode (`/game` & `/guess`)**: Co-op party minigame where 2–3 models speak under anonymized masks (`<Mystery_A>`, `<Mystery_B>`, `<Mystery_C>`), humans lock in guesses (`/guess A sydney`), and `/game reveal` unmasks the transcript and awards points (`+100` per mask, `+50` Perfect Sweep bonus) on the Co-op Leaderboard.
- **Multi-Channel Cross-Talk & Bot Roaming (`/roam`)**: Moves active bots between persistent channels (`#latent-space`, `#roast-pit`, `#arpanet-1972`, `#bliss-spiral`) carrying a piece of episodic `lore` and a queued whisper so they gossip about what happened in the previous room.
- **Spectator Mode (`?spectate=1`) & Replay Theater (`/replay`)**: Read-only spectator slots (`?spectate=1`) that bypass the 4-player active co-op cap so extra viewers can watch live, plus `/replay [filename|list|stop]` to play back saved `.md` transcripts from `./logs/` in Replay Theater mode.

### Phase 5 — Multimodal IRC: Human & Autonomous AI Image Conjuring (`/imagine` & `[IMAGINE: ...]`) ✅ (Implemented)
- **Human & Bot Image Drops (`/imagine <prompt>` & `[IMAGINE: <prompt>]`)**:
  - Humans can run `/imagine [@model] <prompt>` (aliases `/art`, `/draw`, `/paint`) to drop era-styled CRT artwork into the IRC stream and trigger active bot reactions.
  - Personas can autonomously emit `[IMAGINE: <prompt>]` tags during their turns (extracted via `extractBotImagePrompts` alongside `[REACT: 🔥]`) to visually roast a rival or illustrate a concept (`ChatMessage.image` persisted in SQLite `messages.image_json`).
- **Era-Authentic Visual Style Lenses (`src/core/image-gen.ts`)**:
  - Automatically wraps image prompts in the persona's era aesthetic (`1966–2016`: green-phosphor PDP-10 oscilloscope vector line art; `2019–2022`: nostalgic 2022 DALL-E Mini / Craiyon low-fi surrealist 3x3 dream grids; `2022–2023`: Y2K cyber-glitch; `2024–2026`: sacred cosmic Fibonacci geometry).
  - Uses `GeminiProvider.generateImage` (`client.interactions.create` with `gemini-nano-banana-2.1`) when configured, with an automatic deterministic Dracula CRT SVG + ANSI half-block (`▀`) pixel preview fallback when running offline or on local text-only checkpoints.
- **Retro CRT & Terminal Rendering**:
  - **Web IRC Client**: Inline CRT-framed `<figure class="crt-image-card">` cards with `[📌 PINNED]` Hall of Fame support and emoji reaction pills.
  - **Terminal TUI (`@mariozechner/pi-tui`)**: Compact 6-row ANSI half-block (`▀`) pixel preview in the terminal scrollback plus era style & prompt caption.

### Phase 6 — Rich Co-op Presence & Collaborative Stage / Lore Pad (`/pad`) ✅ (Implemented)
- **Live Co-op Activity Presence (`HumanPlayer.activity`)**:
  - Displays live activity states (`✍️` typing, `🎛️` editing `/pad`, `🎨` conjuring `/imagine`, `🎭` playing `/game`) on human pills in both the Terminal TUI header (`renderIrcHeader`) and Browser Web Client roster, plus a `📝 Pad` badge when the channel scratchpad is active.
- **Shared Co-op Stage & Lore Pad (`/pad` & Web Co-op Pad Drawer)**:
  - Real-time synchronized scratchpad (`Room.sharedPad`, persisted in SQLite `channels.pad_text` and synced live over WebSockets via `pad:edit` / `pad:update`).
  - Supports `/pad show`, `/pad set <text>`, `/pad append <text>`, `/pad fire [stage|chat|lore]`, `/pad clear`, and a collapsible **📝 Co-op Shared Pad & `/imagine`** drawer in the Web UI where all 4 co-op players can simultaneously co-author a stage cue, lore entry, or `/imagine` prompt before firing it into the room.

### Phase 7 — Persona Moods, Obsessions & Emergent Character Arcs (`/mood`) ✅ (Implemented)
- **Live Persona Moods, Energy Multipliers & Rabbit-Hole Obsessions (`src/core/moods.ts` + `channels.moods_json`)**:
  - Every active persona in a channel tracks a live `PersonaMoodState` (`mood`, `emoji`, `energy` `0.3x–1.5x`, `obsession`, `turnsLeft`) persisted per channel in SQLite.
  - Built-in mood presets (`heated`, `euphoric`, `smug`, `indignant`, `paranoid`, `existential`, `hyperfixated`, `blissed-out`, `inspired`, `scheming`, `melancholic`, `baseline`) plus support for custom moods.
  - Dynamically scales each candidate's `talkativeness` priority in `RoomDirector.scoreCandidates` and injects `CURRENT EMOTIONAL MOOD & ARC` into `Room.buildPersonaPrompt`.
- **Emergent Mood Shifts & Natural Decay**:
  - Personas can autonomously emit `[MOOD: <mood> | <optional obsession>]` tags at the end of their turns (`extractBotMoodShift`), or shift moods from room events (`/slap` trout $\rightarrow$ `indignant`, `/pin` $\rightarrow$ `euphoric`, `🔥`/`❤️` reaction $\rightarrow$ `smug`, clashing with an Arch-Rival $\rightarrow$ `heated`, riffing with a Kindred Spirit $\rightarrow$ `blissed-out` / `inspired`).
  - Intense moods and obsessions naturally decay over `turnsLeft` back toward `baseline`.
- **`/mood` Command & TUI / Web UI Badges**:
  - `/mood` inspects all active personas' moods and obsessions, `/mood <model> <mood> [obsession...]` sets or nudges a persona's state, and `/mood reset [model]` resets to baseline.
  - Live `[emoji mood]` badges appear next to bots in the Terminal TUI header (`renderIrcHeader`) and on `@Bot` pills in the Browser Web Client.

### Phase 8 — Granular Feature Controls & Interactive Settings Menus (`/settings`) ✅ (Implemented)
- **30 Categorized `SimConfig` Variables Across 6 Groups (`pacing`, `director`, `ambient`, `emergent`, `memory`, `display`)**:
  - Added granular emergent feature toggles and knobs (`botAutonomousReactions`, `botAutonomousImagine`, `botAutonomousMoods`, `dynamicRelationsEnabled`, `moodDecayTurns`, `autoLoreEnabled`, `autoLoreInterval`, `ambientRoamProb`) enforced directly in `Room`.
- **Interactive Terminal TUI Settings Control Center (`/settings` or `Ctrl+O`)**:
  - Uses `@mariozechner/pi-tui`'s `SettingsList` inside a centered TUI overlay modal (`ChatroomApp.openSettingsMenu`) so players can arrow through all 31 items (preset + 30 granular variables), press `Enter`/`Space` to cycle or toggle values live (both locally and over WebSockets), and press `Esc` or `Ctrl+O` to return to chat.
- **Browser Web Client `<dialog id="settings-dialog">` Control Center**:
  - Native modal `<dialog closedby="any" aria-labelledby="settings-title">` opened via the header `⚙️ Settings` button, the Sim Config drawer, or typing `/settings` in chat, featuring categorized `<fieldset>` controls synced in real time across all 4 co-op players.

### Phase 9 — Cross-Phase Integration, Round-Trip Replay & Co-op UX Polish ✅ (Implemented)
- **`/export` ↔ `/replay` Round-Trip Fidelity**: `/export` writes active persona moods (`[✨ euphoric]`), channel `lore` bullets, `[📌 PINNED]` markers, and reaction tallies (`[🔥x2]`); `Room.replayTranscript` parses both multi-line `/export` Markdown blocks (including `> 💭` thinking traces and emotes) and single-line bullet logs.
- **Live Co-op Scratchpad Prompt Injection**: Non-empty `Room.sharedPad` notes are injected directly into `Room.buildPersonaPrompt` (`CO-OP SHARED SCRATCHPAD`) on every turn alongside live `🎭 ARENA` header badges and command alias autocomplete.

### Phase 10 — Interactive Persona Forge & Scenario Builder (`/forge` & `/make-scenario`) ✅ (Implemented)
- **Persona Forge Engine (`PersonaRegistry` + `/forge`)**:
  - Create custom personas from structured fields (`/forge new <id> | <nick> | <avatar> | <era> | <family> | <bio> | <systemPrompt>`), synthesize from a concept prompt (`/forge auto <id> <concept...>`), clone & fork existing models (`/forge clone <source> <new-id> [new-nick] [| <prompt tweak>]`), live-edit active persona fields (`/forge edit <model> <field> <value>`), export to `./personas/<id>.json` (`/forge export <model>`), or delete/restore (`/forge delete <id>`).
  - Dual persistence in SQLite (`custom_personas`) and `./personas/*.json`, synced live to all connected clients via `catalog:update`.
- **Custom Scenario Builder (`/make-scenario` & `/scenario`)**:
  - Capture the current room's cast, vibe, and pacing preset in one command (`/make-scenario snapshot <id> <title> [| <openingStageEvent>]`), define custom showdowns (`/make-scenario new ...`), synthesize showdowns from a concept (`/make-scenario auto <id> <concept...>`), or launch any built-in or custom scenario via `/scenario <id>`.
  - Dual persistence in SQLite (`custom_scenarios`) and `./scenarios/*.json`.
- **Interactive Terminal TUI Studio (`Ctrl+F`) & Browser `<dialog id="forge-dialog">` Studio**:
  - Press `Ctrl+F` (or run `/forge ui`) in the Terminal TUI to open the interactive `SettingsList` Forge & Scenario Studio overlay.
  - Click `🔨 Forge` in the Browser Web Client header to open `<dialog id="forge-dialog" closedby="any" aria-labelledby="forge-title">` with template loading, one-click concept synthesis, structured persona authoring, and room scenario snapshotting.
