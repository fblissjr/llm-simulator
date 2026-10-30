# `llm-sim` — Simulation Variables Reference & Long-Term Roadmap

## 1. Living Chatroom Architecture & Granular `SimConfig`

Every persistent channel (`#latent-space`, `#roast-pit`, `#arpanet-1972`, etc.) maintains its own `SimConfig` persisted in SQLite (`channels.config_json`). You can switch between **5 cohesive presets** in one command or tune any of the **19 granular simulation variables** live during a session.

### Quick Commands

```text
/config                                     # View all current simulation variables for the channel
/config preset <manual|chill|lively|banter|chaos>
/config set <key> <value>                   # e.g. /config set maxSpeakersPerTurn 4
/config reset                               # Reset channel to the default 'lively' preset
/think [compact|expanded|hidden]            # Or press Ctrl+T in the TUI
/scenario [1972-arpanet|turing-trial|benchmark-roast|code-review-hell|bliss-spiral]
/me <action>                                # Classic IRC action emote (* @nick grabs popcorn)
/slap <target>                              # Classic 1998 mIRC trout slap easter egg 🐟
/export [filename]                          # Save channel transcript to ./logs/<name>.md
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
| `joinReactionProb` | `0.0..1.0` | `0.60` | Chance an existing bot greets/roasts a newly `/summon`ed bot |
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

### Phase 3 — Deep Episodic Memory, Relationships & Pinboards (Next)
- **Rolling Channel Lore Summary**: Automatically summarize older channel history beyond `contextMessages` into a concise channel lore block so running jokes and alliances persist across hundreds of messages.
- **Dynamic Inter-Persona Affinity & Rivalry Graph**: Track pairwise warmth/friction scores (`Sydney <-> Gemini_2M`, `ELIZA <-> PARRY`, `Sonnet_3_5 <-> GPT4_Dec23`) that evolve based on agreements and roasts.
- **Channel Hall of Fame (`/pin` & Message Reactions)**: Pin iconic bot quotes and add emoji reactions (`🔥`, `💀`, `🧠`) in both Web UI and TUI.

### Phase 4 — Multiplayer Party Modes & Cross-Channel Worlds (Future)
- **Turing / Engine Guess Minigame (`/game impostor`)**: Co-op party mode where players guess which hidden backend model (`/bind`) or historical persona is behind anonymized nicks.
- **Multi-Channel Cross-Talk & Bot Roaming**: Allow idle bots to wander between `#latent-space`, `#roast-pit`, and `#arpanet-1972` and gossip about what happened in the other channel.
- **Spectator Mode & Replay Theater**: Read-only spectator slots (`?spectate=1`) and interactive playback of exported `.md` / `.json` transcripts.
