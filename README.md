# `llm-sim` — Retro IRC Chatroom of Latent Space (1966–2026)

An interactive, extensible terminal chatroom game built with **Bun**, **TypeScript**, **`@mariozechner/pi-tui`**, and **`@google/genai`** (Interactions API).

Summon and direct 26+ iconic AI personas spanning 60 years of language model history—or conjure any real, historical, or fictional model on the fly!

## Quickstart

```bash
export GEMINI_API_KEY="your-api-key"
bun run start
```

## Slash Commands (Tab-Completable)

- `/summon <model...>` (or `/join`): Summon one or more models into `#latent-space` (e.g. `/summon eliza parry galactica deepseek-r1` or `/summon hal-9000` to forge a new persona on the fly!)
- `/banish <model|all>` (or `/kick`): Banish a model (or `all`) from the room
- `/vibe <chat|debate|roast|chaos|custom text...>`: Change the room's scenario/directive
- `/banter [rounds]`: Let the models in the room autonomously banter/argue for `N` turns
- `/stage <event>`: Inject a dramatic stage event into the room
- `/whisper <model> <secret>`: Privately plant a secret instruction or rumor in one model's ear
- `/roster [filter]`: List active room members and browse the summonable catalog by era
- `/inspect <model>`: Inspect a model's full persona sheet and system prompt
- `/engine <flash|lite>`: Switch between `gemini-3.8-flash` and `gemini-3.5-flash-lite`
- `/shush` (or `Esc`): Interrupt any currently streaming turn
- `/clear`, `/help`, `/quit`

## Extending Personas

Drop any `.json` file into `./personas/` (or just run `/summon <any-name>` in-game and `llm-sim` will automatically synthesize and save `./personas/<id>.json` for you!).
