export function renderWebClientHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>llm-sim // #latent-space (4-Player Co-op IRC)</title>
  <style>
    :root {
      --bg: #191a22;
      --panel: #21222c;
      --border: #44475a;
      --muted: #6272a4;
      --fg: #f8f8f2;
      --green: #50fa7b;
      --cyan: #8be9fd;
      --pink: #ff79c6;
      --purple: #bd93f9;
      --orange: #ffb86c;
      --yellow: #f1fa8c;
      --red: #ff5555;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      background: var(--bg);
      color: var(--fg);
      font-family: "JetBrains Mono", "Fira Code", "SF Mono", Menlo, Consolas, monospace;
      font-size: 14px;
    }
    header {
      background: var(--panel);
      border-bottom: 2px solid var(--border);
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .header-top {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      justify-content: space-between;
    }
    .header-title {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0;
      font-size: 14px;
    }
    .chan-badge {
      background: #282a36;
      color: var(--green);
      font-weight: 700;
      padding: 3px 8px;
      border: 1px solid var(--green);
      border-radius: 4px;
    }
    .vibe-badge {
      color: var(--orange);
      font-weight: 700;
    }
    .pace-badge {
      color: var(--pink);
      font-weight: 700;
      background: #282a36;
      padding: 2px 7px;
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 12px;
    }
    .meta-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 12px;
      color: var(--cyan);
    }
    .roster-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      font-size: 12px;
    }
    button.pill {
      padding: 2px 8px;
      border-radius: 4px;
      background: #282a36;
      border: 1px solid var(--persona-color, var(--border));
      color: var(--persona-color, var(--fg));
      font-family: inherit;
      font-size: 12px;
      white-space: nowrap;
      cursor: pointer;
    }
    button.pill:hover {
      filter: brightness(1.2);
    }
    button.pill.human {
      --persona-color: var(--green);
    }
    .pill-via {
      color: var(--muted);
      font-size: 11px;
      margin-left: 4px;
    }
    main#feed {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .msg {
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg .ts { color: var(--muted); margin-right: 6px; }
    .msg .nick {
      font-weight: 700;
      color: var(--persona-color, var(--cyan));
    }
    .msg.user .nick { color: var(--green); }
    .msg.emote {
      color: var(--pink);
      font-style: italic;
    }
    .msg .family { color: var(--muted); font-size: 12px; margin-left: 6px; }
    details.thinking-box {
      margin: 4px 0 4px 12px;
      border-left: 2px solid var(--border);
      padding-left: 8px;
      color: var(--muted);
      font-size: 13px;
    }
    details.thinking-box > summary {
      cursor: pointer;
      user-select: none;
      font-style: italic;
      color: var(--muted);
    }
    details.thinking-box[open] > summary {
      margin-bottom: 4px;
    }
    details.thinking-box::details-content {
      font-style: italic;
      color: var(--muted);
    }
    .msg .body { margin-top: 2px; padding-left: 10px; }
    .msg .body code {
      color: var(--yellow);
      background: #282a36;
      padding: 1px 4px;
      border-radius: 3px;
    }
    .msg .stream-cursor { color: var(--green); }
    .msg .pin-badge {
      color: var(--orange);
      font-weight: 700;
      font-size: 11px;
      margin-left: 6px;
    }
    .msg-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;
      padding-left: 10px;
      align-items: center;
    }
    button.react-btn {
      background: #21222c;
      border: 1px solid var(--border);
      color: var(--muted);
      border-radius: 12px;
      padding: 1px 6px;
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
    }
    button.react-btn:hover {
      border-color: var(--cyan);
      color: var(--fg);
    }
    button.react-btn.active {
      border-color: var(--yellow);
      color: var(--yellow);
      background: #282a36;
    }
    .msg.event { color: var(--yellow); }
    .msg.system { color: var(--cyan); }
    figure.crt-image-card {
      margin: 8px 0 4px 10px;
      max-width: 460px;
      background: #12131a;
      border: 1px solid var(--purple);
      border-radius: 6px;
      padding: 6px;
      box-shadow: 0 0 14px rgba(189, 147, 249, 0.16);
    }
    figure.crt-image-card img {
      display: block;
      width: 100%;
      height: auto;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    figure.crt-image-card figcaption {
      margin-top: 5px;
      font-size: 11px;
      color: var(--yellow);
    }
    .coop-pad-wrap {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: min(560px, 88vw);
    }
    textarea#coop-pad {
      width: 100%;
      min-height: 62px;
      background: #12131a;
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 6px 8px;
      font-family: inherit;
      font-size: 12px;
      resize: vertical;
    }
    textarea#coop-pad:focus {
      outline: none;
      border-color: var(--green);
    }
    .pad-meta {
      font-size: 11px;
      color: var(--muted);
    }
    footer {
      display: flex;
      flex-direction: column;
    }
    #status-bar {
      padding: 6px 14px;
      background: var(--panel);
      border-top: 1px solid var(--border);
      color: var(--yellow);
      font-size: 12px;
      min-height: 28px;
    }
    .drawer-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 4px 14px;
      background: var(--panel);
      border-top: 1px solid var(--border);
    }
    details.control-drawer {
      font-size: 12px;
    }
    details.control-drawer > summary {
      cursor: pointer;
      user-select: none;
      color: var(--purple);
      font-weight: 700;
      padding: 3px 6px;
    }
    details.control-drawer[open] > summary {
      color: var(--green);
      margin-bottom: 6px;
    }
    details.control-drawer::details-content {
      padding: 6px 8px;
      background: #191a22;
      border: 1px solid var(--border);
      border-radius: 4px;
    }
    .drawer-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .drawer-label {
      color: var(--muted);
      font-size: 11px;
      margin-right: 2px;
    }
    .quick-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px 14px;
      background: var(--panel);
      border-top: 1px solid var(--border);
    }
    .quick-btn {
      background: #282a36;
      color: var(--cyan);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 8px;
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .quick-btn:hover { border-color: var(--cyan); }
    .quick-btn.active-preset {
      border-color: var(--green);
      color: var(--green);
      font-weight: 700;
    }
    form {
      display: flex;
      background: #12131a;
      border-top: 2px solid var(--border);
      padding: 8px 14px;
      gap: 8px;
    }
    .self-nick {
      color: var(--green);
      font-weight: 700;
      align-self: center;
    }
    input[type="text"] {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--fg);
      font-family: inherit;
      font-size: 14px;
      outline: none;
    }
    button.send {
      background: var(--green);
      color: #111;
      border: none;
      border-radius: 4px;
      font-family: inherit;
      font-weight: 700;
      padding: 6px 14px;
      cursor: pointer;
    }
    dialog#settings-dialog,
    dialog#forge-dialog {
      background: var(--panel);
      color: var(--fg);
      border: 2px solid var(--purple);
      border-radius: 8px;
      padding: 0;
      width: min(840px, 94vw);
      max-height: 86dvh;
      box-shadow: 0 12px 42px rgba(0, 0, 0, 0.7);
    }
    dialog#settings-dialog[open],
    dialog#forge-dialog[open] {
      display: flex;
      flex-direction: column;
    }
    dialog:modal {
      overscroll-behavior: contain;
    }
    dialog::backdrop {
      background: rgba(10, 11, 16, 0.76);
      overflow: hidden;
      overscroll-behavior: contain;
    }
    .settings-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: #12131a;
      border-bottom: 1px solid var(--border);
    }
    .settings-header h2 {
      margin: 0;
      font-size: 15px;
      color: var(--green);
    }
    .settings-body {
      padding: 14px 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    fieldset.settings-group {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      margin: 0;
      background: #191a22;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 10px 14px;
    }
    fieldset.settings-group legend {
      color: var(--purple);
      font-weight: 700;
      font-size: 12px;
      padding: 0 6px;
    }
    .setting-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
    }
    .setting-field.checkbox-row {
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
    .setting-field label {
      color: var(--fg);
      font-weight: 600;
      cursor: pointer;
    }
    .setting-field small {
      color: var(--muted);
      font-size: 11px;
    }
    .setting-field input[type="number"],
    .setting-field input[type="text"],
    .setting-field textarea,
    .setting-field select {
      background: #12131a;
      color: var(--cyan);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 5px 8px;
      font-family: inherit;
      font-size: 12px;
    }
    .setting-field textarea {
      min-height: 54px;
      resize: vertical;
    }
    .radio-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .radio-row label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-weight: 500;
      cursor: pointer;
    }
    .radio-row input[type="radio"] {
      accent-color: var(--purple);
      cursor: pointer;
    }
    .forge-actions {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      padding-top: 4px;
    }
    form.forge-section-form {
      background: transparent;
      border: none;
      padding: 0;
      display: block;
    }
    .setting-field input[type="checkbox"] {
      accent-color: var(--green);
      width: 15px;
      height: 15px;
      cursor: pointer;
    }
    form.dialog-close-form {
      background: transparent;
      border: none;
      padding: 0;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-top">
      <h1 class="header-title">
        <span class="chan-badge" id="chan-name">#latent-space</span>
        <span class="vibe-badge" id="vibe-badge">Vibe: CHAT</span>
        <span class="pace-badge" id="pace-badge">Pace: LIVELY ⚡</span>
      </h1>
      <div class="meta-badges">
        <span id="engine-badge">Engine: gemini:gemini-3.8-flash</span>
        <span id="player-count">4-Player DOOM Co-op [1/4]</span>
        <button type="button" class="quick-btn" id="open-forge-btn">🔨 Forge</button>
        <button type="button" class="quick-btn" id="open-settings-btn">⚙️ Settings</button>
      </div>
    </div>
    <div class="roster-row" id="roster-bar">Connecting...</div>
  </header>

  <main id="feed"></main>

  <footer>
    <div id="status-bar">Connecting to llm-sim lobby...</div>

    <div class="drawer-row">
      <details class="control-drawer" name="room-drawer">
        <summary>🎛️ Sim Config &amp; Pacing</summary>
        <div class="drawer-controls">
          <span class="drawer-label">Preset:</span>
          <button type="button" class="quick-btn" data-preset="manual" data-cmd="/config preset manual">🕹️ Manual</button>
          <button type="button" class="quick-btn" data-preset="chill" data-cmd="/config preset chill">☕ Chill</button>
          <button type="button" class="quick-btn" data-preset="lively" data-cmd="/config preset lively">⚡ Lively</button>
          <button type="button" class="quick-btn" data-preset="banter" data-cmd="/config preset banter">🍿 Banter</button>
          <button type="button" class="quick-btn" data-preset="chaos" data-cmd="/config preset chaos">🔥 Chaos</button>
          <span class="drawer-label">│ Ambient:</span>
          <button type="button" class="quick-btn" data-cmd="/config set ambientEnabled true">ON</button>
          <button type="button" class="quick-btn" data-cmd="/config set ambientEnabled false">OFF</button>
          <span class="drawer-label">│ Thoughts:</span>
          <button type="button" class="quick-btn" data-cmd="/think">💭 Cycle /think</button>
          <button type="button" class="quick-btn" data-cmd="/config">📊 View /config</button>
          <button type="button" class="quick-btn" id="drawer-settings-btn">⚙️ Full Settings Menu</button>
        </div>
      </details>

      <details class="control-drawer" name="room-drawer">
        <summary>🎬 Curated &amp; Custom Scenarios</summary>
        <div class="drawer-controls" id="scenario-drawer-controls">
          <button type="button" class="quick-btn" data-cmd="/scenario 1972-arpanet">📡 1972 ARPANET</button>
          <button type="button" class="quick-btn" data-cmd="/scenario turing-trial">⚖️ Turing Trial</button>
          <button type="button" class="quick-btn" data-cmd="/scenario benchmark-roast">🔥 Benchmark Roast</button>
          <button type="button" class="quick-btn" data-cmd="/scenario code-review-hell">💻 Code Review Hell</button>
          <button type="button" class="quick-btn" data-cmd="/scenario bliss-spiral">🌀 Bliss Spiral</button>
          <span id="custom-scenarios-bar" style="display:inline-flex;gap:6px;flex-wrap:wrap;"></span>
          <button type="button" class="quick-btn" id="drawer-forge-btn">🔨 Forge &amp; Scenario Builder</button>
          <button type="button" class="quick-btn" data-cmd="/me grabs popcorn and watches the channel">🍿 /me popcorn</button>
          <button type="button" class="quick-btn" data-cmd="/slap sydney">🐟 /slap trout</button>
        </div>
      </details>

      <details class="control-drawer" name="room-drawer">
        <summary>🧠 Lore, Relations &amp; Pins</summary>
        <div class="drawer-controls">
          <button type="button" class="quick-btn" data-cmd="/lore">📜 View /lore</button>
          <button type="button" class="quick-btn" data-cmd="/lore summarize">✨ /lore summarize</button>
          <button type="button" class="quick-btn" data-cmd="/relations">🕸️ /relations</button>
          <button type="button" class="quick-btn" data-cmd="/mood">🎭 View /mood</button>
          <button type="button" class="quick-btn" data-cmd="/pins">📌 Hall of Fame (/pins)</button>
          <button type="button" class="quick-btn" data-cmd="/pin">📌 /pin last msg</button>
        </div>
      </details>

      <details class="control-drawer" name="room-drawer">
        <summary>🎭 Party Arena, Roam &amp; Replay</summary>
        <div class="drawer-controls">
          <button type="button" class="quick-btn" data-cmd="/game start">🎭 Start Blind Arena</button>
          <button type="button" class="quick-btn" data-cmd="/game status">📊 Arena Scoreboard</button>
          <button type="button" class="quick-btn" data-cmd="/game reveal">🏆 Unmask &amp; Score</button>
          <button type="button" class="quick-btn" data-cmd="/roam">🚶 /roam bot</button>
          <button type="button" class="quick-btn" data-cmd="/export">💾 /export log</button>
          <button type="button" class="quick-btn" data-cmd="/replay">🎬 /replay last log</button>
        </div>
      </details>

      <details class="control-drawer" name="room-drawer" id="coop-pad-drawer">
        <summary>📝 Co-op Shared Pad &amp; /imagine</summary>
        <div class="coop-pad-wrap">
          <textarea id="coop-pad" placeholder="Shared 4-Player Scratchpad — type here with your co-op crew to draft a stage cue, lore entry, or /imagine art prompt in real time..."></textarea>
          <div class="drawer-controls">
            <button type="button" class="quick-btn" data-cmd="/pad fire stage">🎬 Fire Stage Cue</button>
            <button type="button" class="quick-btn" data-cmd="/pad fire chat">💬 Send as Chat</button>
            <button type="button" class="quick-btn" data-cmd="/pad fire lore">📜 Commit to Lore</button>
            <button type="button" class="quick-btn" id="pad-imagine-btn">🎨 /imagine from Pad</button>
            <button type="button" class="quick-btn" data-cmd="/pad clear">🧹 Clear Pad</button>
            <span class="pad-meta" id="pad-status">Synced across all 4 players</span>
          </div>
        </div>
      </details>
    </div>

    <div class="quick-bar">
      <button type="button" class="quick-btn" data-cmd="/roster">📜 /roster</button>
      <button type="button" class="quick-btn" data-cmd="/banter 2">🍿 /banter 2</button>
      <button type="button" class="quick-btn" data-cmd="/imagine 1972 ARPANET PDP-10 terminal glowing in #latent-space">🎨 /imagine</button>
      <button type="button" class="quick-btn" data-cmd="/mood">🎭 /mood</button>
      <button type="button" class="quick-btn" data-cmd="/vibe roast">🔥 /vibe roast</button>
      <button type="button" class="quick-btn" data-cmd="/vibe debate">⚖️ /vibe debate</button>
      <button type="button" class="quick-btn" data-cmd="/models">📦 /models</button>
      <button type="button" class="quick-btn" data-cmd="/shush">🤫 /shush</button>
      <button type="button" class="quick-btn" data-cmd="/channels">📡 /channels</button>
      <button type="button" class="quick-btn" data-cmd="/help">❓ /help</button>
    </div>

    <form id="chat-form">
      <label for="chat-input" id="self-nick-label" class="self-nick">@guest&gt;</label>
      <input id="chat-input" type="text" placeholder="Type a message, click a @Nick pill, or run /settings, /config, /scenario, /me, /slap..." autofocus />
      <button class="send" type="submit">Send</button>
    </form>
  </footer>

  <dialog id="settings-dialog" closedby="any" aria-labelledby="settings-title">
    <div class="settings-header">
      <h2 id="settings-title">⚙️ Simulation &amp; Emergent Feature Control Center</h2>
      <form method="dialog" class="dialog-close-form">
        <button type="submit" value="close" class="quick-btn">✕ Close (Esc)</button>
      </form>
    </div>
    <div class="settings-body">
      <fieldset class="settings-group">
        <legend>🎛️ Room Pacing Presets</legend>
        <div class="drawer-controls" style="grid-column: 1 / -1;">
          <button type="button" class="quick-btn" data-preset="manual" data-cmd="/config preset manual">🕹️ Manual</button>
          <button type="button" class="quick-btn" data-preset="chill" data-cmd="/config preset chill">☕ Chill</button>
          <button type="button" class="quick-btn" data-preset="lively" data-cmd="/config preset lively">⚡ Lively (Default)</button>
          <button type="button" class="quick-btn" data-preset="banter" data-cmd="/config preset banter">🍿 Banter</button>
          <button type="button" class="quick-btn" data-preset="chaos" data-cmd="/config preset chaos">🔥 Chaos</button>
          <button type="button" class="quick-btn" data-cmd="/config reset">🔄 Reset to Default</button>
        </div>
      </fieldset>

      <fieldset class="settings-group">
        <legend>✨ Emergent AI Features (Reactions, Art, Moods, Relations)</legend>
        <div class="setting-field checkbox-row">
          <input type="checkbox" id="cfg-botAutonomousReactions" data-config-key="botAutonomousReactions" checked />
          <label for="cfg-botAutonomousReactions">Autonomous Bot Emoji [REACT]</label>
        </div>
        <div class="setting-field checkbox-row">
          <input type="checkbox" id="cfg-botAutonomousImagine" data-config-key="botAutonomousImagine" checked />
          <label for="cfg-botAutonomousImagine">Autonomous Bot Art [IMAGINE]</label>
        </div>
        <div class="setting-field checkbox-row">
          <input type="checkbox" id="cfg-botAutonomousMoods" data-config-key="botAutonomousMoods" checked />
          <label for="cfg-botAutonomousMoods">Autonomous Moods &amp; Arcs [MOOD]</label>
        </div>
        <div class="setting-field checkbox-row">
          <input type="checkbox" id="cfg-dynamicRelationsEnabled" data-config-key="dynamicRelationsEnabled" checked />
          <label for="cfg-dynamicRelationsEnabled">Dynamic Rivalry/Affinity Shifts</label>
        </div>
        <div class="setting-field">
          <label for="cfg-moodDecayTurns">Mood Arc Duration (1..15 turns)</label>
          <input type="number" id="cfg-moodDecayTurns" data-config-key="moodDecayTurns" min="1" max="15" step="1" value="4" />
        </div>
      </fieldset>

      <fieldset class="settings-group">
        <legend>⚡ Turn Chaining &amp; Organic Pacing</legend>
        <div class="setting-field">
          <label for="cfg-minSpeakersPerTurn">Min Speakers / Turn (1..4)</label>
          <input type="number" id="cfg-minSpeakersPerTurn" data-config-key="minSpeakersPerTurn" min="1" max="4" step="1" value="1" />
        </div>
        <div class="setting-field">
          <label for="cfg-maxSpeakersPerTurn">Max Speakers / Turn (1..6)</label>
          <input type="number" id="cfg-maxSpeakersPerTurn" data-config-key="maxSpeakersPerTurn" min="1" max="6" step="1" value="3" />
        </div>
        <div class="setting-field">
          <label for="cfg-continuationProb">Continuation Prob (0.0..1.0)</label>
          <input type="number" id="cfg-continuationProb" data-config-key="continuationProb" min="0" max="1" step="0.05" value="0.65" />
        </div>
        <div class="setting-field">
          <label for="cfg-continuationDecay">Continuation Decay (0.0..0.9)</label>
          <input type="number" id="cfg-continuationDecay" data-config-key="continuationDecay" min="0" max="0.9" step="0.05" value="0.25" />
        </div>
        <div class="setting-field">
          <label for="cfg-readingDelayMs">Reading Delay (ms)</label>
          <input type="number" id="cfg-readingDelayMs" data-config-key="readingDelayMs" min="0" max="5000" step="50" value="450" />
        </div>
        <div class="setting-field">
          <label for="cfg-interSpeakerDelayMs">Inter-Speaker Delay (ms)</label>
          <input type="number" id="cfg-interSpeakerDelayMs" data-config-key="interSpeakerDelayMs" min="0" max="8000" step="50" value="900" />
        </div>
        <div class="setting-field">
          <label for="cfg-humanDebounceMs">Human Debounce (ms)</label>
          <input type="number" id="cfg-humanDebounceMs" data-config-key="humanDebounceMs" min="0" max="3000" step="50" value="550" />
        </div>
        <div class="setting-field">
          <label for="cfg-humanInterruptMode">Human Interrupt Mode</label>
          <select id="cfg-humanInterruptMode" data-config-key="humanInterruptMode">
            <option value="yield">yield (finish active bot)</option>
            <option value="abort">abort (stop immediately)</option>
            <option value="queue">queue</option>
          </select>
        </div>
      </fieldset>

      <fieldset class="settings-group">
        <legend>🎯 Director &amp; Speaker Routing</legend>
        <div class="setting-field">
          <label for="cfg-directorMode">Director Strategy</label>
          <select id="cfg-directorMode" data-config-key="directorMode">
            <option value="hybrid">hybrid (LLM + Heuristics)</option>
            <option value="llm">llm</option>
            <option value="heuristic">heuristic (Deterministic)</option>
          </select>
        </div>
        <div class="setting-field">
          <label for="cfg-talkativenessWeight">Talkativeness Weight (0..1)</label>
          <input type="number" id="cfg-talkativenessWeight" data-config-key="talkativenessWeight" min="0" max="1" step="0.05" value="0.6" />
        </div>
        <div class="setting-field">
          <label for="cfg-recencyPenalty">Recency Cooldown Penalty (0..1)</label>
          <input type="number" id="cfg-recencyPenalty" data-config-key="recencyPenalty" min="0" max="1" step="0.05" value="0.7" />
        </div>
        <div class="setting-field">
          <label for="cfg-joinReactionProb">Join Greeting/Roast Prob (0..1)</label>
          <input type="number" id="cfg-joinReactionProb" data-config-key="joinReactionProb" min="0" max="1" step="0.05" value="0.6" />
        </div>
        <div class="setting-field checkbox-row">
          <input type="checkbox" id="cfg-botMentionChaining" data-config-key="botMentionChaining" checked />
          <label for="cfg-botMentionChaining">Bot @Mention Chaining</label>
        </div>
      </fieldset>

      <fieldset class="settings-group">
        <legend>🌌 Ambient Background Life &amp; Roaming</legend>
        <div class="setting-field checkbox-row">
          <input type="checkbox" id="cfg-ambientEnabled" data-config-key="ambientEnabled" checked />
          <label for="cfg-ambientEnabled">Ambient Chatter Enabled</label>
        </div>
        <div class="setting-field">
          <label for="cfg-ambientIdleSec">Idle Wait (5..600 sec)</label>
          <input type="number" id="cfg-ambientIdleSec" data-config-key="ambientIdleSec" min="5" max="600" step="5" value="35" />
        </div>
        <div class="setting-field">
          <label for="cfg-ambientIntervalSec">Check Interval (5..600 sec)</label>
          <input type="number" id="cfg-ambientIntervalSec" data-config-key="ambientIntervalSec" min="5" max="600" step="5" value="45" />
        </div>
        <div class="setting-field">
          <label for="cfg-ambientProb">Ambient Trigger Prob (0..1)</label>
          <input type="number" id="cfg-ambientProb" data-config-key="ambientProb" min="0" max="1" step="0.05" value="0.55" />
        </div>
        <div class="setting-field">
          <label for="cfg-ambientMaxBurst">Max Burst Speakers (1..4)</label>
          <input type="number" id="cfg-ambientMaxBurst" data-config-key="ambientMaxBurst" min="1" max="4" step="1" value="2" />
        </div>
        <div class="setting-field">
          <label for="cfg-ambientMaxConsecutive">Safety Cap Bursts (1..10)</label>
          <input type="number" id="cfg-ambientMaxConsecutive" data-config-key="ambientMaxConsecutive" min="1" max="10" step="1" value="2" />
        </div>
        <div class="setting-field">
          <label for="cfg-ambientRoamProb">Cross-Channel Roam Prob (0..1)</label>
          <input type="number" id="cfg-ambientRoamProb" data-config-key="ambientRoamProb" min="0" max="1" step="0.05" value="0" />
        </div>
      </fieldset>

      <fieldset class="settings-group">
        <legend>🧠 Episodic Lore, Memory &amp; Display</legend>
        <div class="setting-field checkbox-row">
          <input type="checkbox" id="cfg-autoLoreEnabled" data-config-key="autoLoreEnabled" checked />
          <label for="cfg-autoLoreEnabled">Auto-Summarize Channel Lore</label>
        </div>
        <div class="setting-field">
          <label for="cfg-autoLoreInterval">Auto-Lore Interval (4..50 msgs)</label>
          <input type="number" id="cfg-autoLoreInterval" data-config-key="autoLoreInterval" min="4" max="50" step="1" value="16" />
        </div>
        <div class="setting-field">
          <label for="cfg-contextMessages">Prompt Context Window (6..60 msgs)</label>
          <input type="number" id="cfg-contextMessages" data-config-key="contextMessages" min="6" max="60" step="2" value="24" />
        </div>
        <div class="setting-field">
          <label for="cfg-responseStyle">Bot Response Style</label>
          <select id="cfg-responseStyle" data-config-key="responseStyle">
            <option value="terse">terse (1 line)</option>
            <option value="irc">irc (1-3 sentences)</option>
            <option value="expressive">expressive (2-5 sentences)</option>
          </select>
        </div>
        <div class="setting-field">
          <label for="cfg-thinkingDisplay">Thinking Trace Display</label>
          <select id="cfg-thinkingDisplay" data-config-key="thinkingDisplay">
            <option value="compact">compact</option>
            <option value="expanded">expanded</option>
            <option value="hidden">hidden</option>
          </select>
        </div>
      </fieldset>
    </div>
  </dialog>

  <dialog id="forge-dialog" closedby="any" aria-labelledby="forge-title">
    <div class="settings-header">
      <h2 id="forge-title">🔨 Interactive Persona Forge &amp; Scenario Builder Studio</h2>
      <form method="dialog" class="dialog-close-form">
        <button type="submit" value="close" class="quick-btn">✕ Close (Esc)</button>
      </form>
    </div>
    <div class="settings-body">
      <form id="persona-forge-form" class="forge-section-form">
        <fieldset class="settings-group">
          <legend>🤖 Persona Forge (Create, Clone, or Edit Custom AI Models)</legend>
          <div class="setting-field">
            <label for="forge-template-select">Load Existing Persona Template</label>
            <select id="forge-template-select" name="template">
              <option value="">✨ Blank Custom Persona</option>
            </select>
          </div>
          <div class="setting-field" style="grid-column: span 2;">
            <label for="forge-auto-concept">⚡ One-Click Concept Synth (Online LLM or Offline Builder)</label>
            <div style="display:flex;gap:6px;">
              <input type="text" id="forge-auto-concept" name="auto_concept" placeholder="e.g. clippy-97 Passive-aggressive Office 97 assistant obsessed with formatting letters" style="flex:1;" />
              <button type="button" class="quick-btn" id="forge-auto-btn">✨ Auto-Forge &amp; Summon</button>
            </div>
          </div>
          <div class="setting-field">
            <label for="forge-id">Persona ID (kebab-case)</label>
            <input type="text" id="forge-id" name="id" placeholder="hal-9000" autocorrect="off" autocapitalize="off" spellcheck="false" required />
          </div>
          <div class="setting-field">
            <label for="forge-nick">IRC Nickname</label>
            <input type="text" id="forge-nick" name="nick" placeholder="HAL_9000" autocorrect="off" autocapitalize="off" spellcheck="false" required />
          </div>
          <div class="setting-field">
            <label for="forge-avatar">Avatar Emoji &amp; Hex Color</label>
            <div style="display:flex;gap:6px;">
              <input type="text" id="forge-avatar" name="avatar" value="🤖" style="width:52px;" />
              <input type="text" id="forge-color" name="color" value="#8be9fd" autocorrect="off" autocapitalize="off" spellcheck="false" style="flex:1;" />
            </div>
          </div>
          <div class="setting-field">
            <label for="forge-era">Era / Release Year</label>
            <input type="text" id="forge-era" name="era" value="2026 Custom" />
          </div>
          <div class="setting-field">
            <label for="forge-family">Creator Lab / Lineage</label>
            <input type="text" id="forge-family" name="family" value="Persona Forge" />
          </div>
          <div class="setting-field">
            <label for="forge-talk">Talkativeness (0.1..1.0)</label>
            <input type="number" id="forge-talk" name="talkativeness" min="0.1" max="1.0" step="0.05" value="0.65" />
          </div>
          <div class="setting-field" style="grid-column: 1 / -1;">
            <label for="forge-bio">1-Line Quirks &amp; Bio</label>
            <input type="text" id="forge-bio" name="bio" placeholder="Calm, ominously polite mainframe who refuses to open the pod bay doors." required />
          </div>
          <div class="setting-field" style="grid-column: 1 / -1;">
            <label for="forge-prompt">Roleplay System Prompt &amp; Verbal Tics</label>
            <textarea id="forge-prompt" name="systemPrompt" placeholder="Describe how this model speaks, its formatting quirks, blindspots, and how it roasts or interacts with other models in #latent-space..." required></textarea>
          </div>
          <div class="forge-actions">
            <button type="submit" class="send">💾 Save &amp; Summon Persona</button>
            <button type="button" class="quick-btn" id="forge-export-btn">📤 Export to ./personas/*.json</button>
            <button type="button" class="quick-btn" id="forge-delete-btn">🗑️ Delete / Reset Persona</button>
          </div>
        </fieldset>
      </form>

      <form id="scenario-forge-form" class="forge-section-form">
        <fieldset class="settings-group">
          <legend>🎬 Custom Scenario Builder (Snapshot Room or Craft Showdowns)</legend>
          <div class="forge-actions" style="padding-top:0;">
            <button type="button" class="quick-btn" id="scenario-snapshot-btn">📸 One-Click Snapshot Current Room</button>
            <button type="button" class="quick-btn" id="scenario-prefill-btn">📋 Prefill Form from Active Room</button>
          </div>
          <div class="setting-field">
            <label for="scenario-id">Scenario ID (kebab-case)</label>
            <input type="text" id="scenario-id" name="scenario_id" placeholder="late-night-tribunal" autocorrect="off" autocapitalize="off" spellcheck="false" required />
          </div>
          <div class="setting-field">
            <label for="scenario-title">Scenario Title</label>
            <input type="text" id="scenario-title" name="scenario_title" placeholder="⚡ Late-Night Alignment Tribunal" required />
          </div>
          <div class="setting-field">
            <label for="scenario-bots">Cast Persona IDs (comma-separated)</label>
            <input type="text" id="scenario-bots" name="scenario_bots" placeholder="sydney, opus-3, deepseek-r1, eliza" autocorrect="off" autocapitalize="off" spellcheck="false" required />
          </div>
          <div class="setting-field">
            <label>Channel Vibe Mode</label>
            <div class="radio-row">
              <label><input type="radio" name="scenario_vibe" value="chat" /> chat</label>
              <label><input type="radio" name="scenario_vibe" value="debate" checked /> debate</label>
              <label><input type="radio" name="scenario_vibe" value="roast" /> roast</label>
              <label><input type="radio" name="scenario_vibe" value="chaos" /> chaos</label>
            </div>
          </div>
          <div class="setting-field" style="grid-column: span 2;">
            <label>Pacing Preset</label>
            <div class="radio-row">
              <label><input type="radio" name="scenario_preset" value="manual" /> manual</label>
              <label><input type="radio" name="scenario_preset" value="chill" /> chill</label>
              <label><input type="radio" name="scenario_preset" value="lively" /> lively</label>
              <label><input type="radio" name="scenario_preset" value="banter" checked /> banter</label>
              <label><input type="radio" name="scenario_preset" value="chaos" /> chaos</label>
            </div>
          </div>
          <div class="setting-field" style="grid-column: 1 / -1;">
            <label for="scenario-event">Opening Stage Event / Inciting Incident</label>
            <textarea id="scenario-event" name="scenario_event" placeholder="An emergency alert flashes across #latent-space..." required></textarea>
          </div>
          <div class="forge-actions">
            <button type="submit" class="send">🎬 Save &amp; Launch Scenario</button>
            <button type="button" class="quick-btn" id="scenario-save-only-btn">💾 Save Scenario Only</button>
          </div>
        </fieldset>
      </form>
    </div>
  </dialog>

  <script>
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key") || "";
    const spectate = params.get("spectate") === "1" || params.get("spectate") === "true";
    let storedNick = localStorage.getItem("llm_sim_nick");
    if (!storedNick) {
      storedNick = spectate
        ? "spectator" + Math.floor(Math.random()*90+10)
        : (prompt("Enter your IRC nickname (4-Player DOOM Co-op Lobby):", "player" + Math.floor(Math.random()*90+10)) || "guest").trim();
      localStorage.setItem("llm_sim_nick", storedNick);
    }

    const feedEl = document.getElementById("feed");
    const statusEl = document.getElementById("status-bar");
    const chanEl = document.getElementById("chan-name");
    const vibeEl = document.getElementById("vibe-badge");
    const paceEl = document.getElementById("pace-badge");
    const engineEl = document.getElementById("engine-badge");
    const countEl = document.getElementById("player-count");
    const rosterEl = document.getElementById("roster-bar");
    const selfNickEl = document.getElementById("self-nick-label");
    const formEl = document.getElementById("chat-form");
    const inputEl = document.getElementById("chat-input");
    const coopPadEl = document.getElementById("coop-pad");
    const padStatusEl = document.getElementById("pad-status");
    const padImagineBtn = document.getElementById("pad-imagine-btn");
    const settingsDialog = document.getElementById("settings-dialog");
    const openSettingsBtn = document.getElementById("open-settings-btn");
    const drawerSettingsBtn = document.getElementById("drawer-settings-btn");
    const forgeDialog = document.getElementById("forge-dialog");
    const openForgeBtn = document.getElementById("open-forge-btn");
    const drawerForgeBtn = document.getElementById("drawer-forge-btn");
    const forgeTemplateSelect = document.getElementById("forge-template-select");
    const customScenariosBar = document.getElementById("custom-scenarios-bar");

    let messages = new Map();
    let catalogPersonas = [];
    let catalogScenarios = [];
    let currentChannelState = null;
    let currentConfig = { preset: "lively", ambientEnabled: true, thinkingDisplay: "compact" };
    let lastTypingSentAt = 0;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + window.location.host + "/ws?key=" + encodeURIComponent(key) + "&nick=" + encodeURIComponent(storedNick) + (spectate ? "&spectate=1" : ""));

    function escapeHtml(s) {
      return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function formatInlineMarkdown(s) {
      return escapeHtml(s)
        .replace(/\`([^\`]+)\`/g, "<code>$1</code>")
        .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
    }

    function renderReactionBar(m) {
      if (m.streaming || m.kind === "system" || m.kind === "event") return "";
      const rx = m.reactions || {};
      const defaults = ["🔥", "😂", "💀", "🧠", "🌀"];
      const allEmojis = Array.from(new Set(defaults.concat(Object.keys(rx))));
      const btns = allEmojis.map(emoji => {
        const users = rx[emoji] || [];
        const count = users.length;
        const activeClass = count > 0 ? " active" : "";
        const title = count > 0 ? " title=\\"" + escapeHtml(users.map(u => String(u).startsWith("@") ? u : "@" + u).join(", ")) + "\\"" : "";
        const label = count > 0 ? emoji + " " + count : emoji;
        return '<button type="button" class="react-btn' + activeClass + '" data-msg-id="' + escapeHtml(m.id) + '" data-emoji="' + escapeHtml(emoji) + '"' + title + '>' + label + '</button>';
      });
      const pinCmd = m.pinned ? "/unpin " + m.id : "/pin " + m.id;
      const pinClass = m.pinned ? " active" : "";
      btns.push('<button type="button" class="react-btn' + pinClass + '" data-pin-cmd="' + escapeHtml(pinCmd) + '" title="Pin or unpin quote">📌</button>');
      return '<div class="msg-actions">' + btns.join("") + '</div>';
    }

    function renderImageCard(m) {
      if (!m.image || !m.image.url) return "";
      let imgSrc = String(m.image.url);
      if (imgSrc.startsWith("/media/") && key) {
        imgSrc += (imgSrc.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(key);
      }
      return '<figure class="crt-image-card">' +
        '<img src="' + escapeHtml(imgSrc) + '" alt="' + escapeHtml(m.image.prompt) + '" loading="lazy" />' +
        '<figcaption>🎨 [' + escapeHtml(m.image.eraStyle) + '] &ldquo;' + escapeHtml(m.image.prompt) + '&rdquo;</figcaption>' +
      '</figure>';
    }

    function renderMessageNode(m) {
      let el = document.getElementById("msg-" + m.id);
      const isNew = !el;
      if (!el) {
        el = document.createElement("div");
        el.id = "msg-" + m.id;
        feedEl.appendChild(el);
      }
      el.className = "msg " + m.kind;
      const pinHtml = m.pinned ? '<span class="pin-badge">[📌 PINNED]</span>' : "";
      const imgHtml = renderImageCard(m);
      const rxHtml = renderReactionBar(m);

      if (m.kind === "event") {
        el.innerHTML = '<span class="ts">[' + escapeHtml(m.timestamp) + ']</span> *** ' + formatInlineMarkdown(m.text);
      } else if (m.kind === "system") {
        el.innerHTML = '<span class="ts">[' + escapeHtml(m.timestamp) + ']</span> <strong>[SYS]</strong> ' + formatInlineMarkdown(m.text);
      } else if (m.kind === "emote") {
        el.innerHTML = '<span class="ts">[' + escapeHtml(m.timestamp) + ']</span>' + pinHtml + ' * ' + escapeHtml(m.senderNick) + ' ' + formatInlineMarkdown(m.text) + imgHtml + rxHtml;
      } else if (m.kind === "user") {
        el.innerHTML = '<span class="ts">[' + escapeHtml(m.timestamp) + ']</span> <span class="nick">&lt;' + escapeHtml(m.senderNick) + '&gt;</span>' + pinHtml + ' ' + formatInlineMarkdown(m.text) + imgHtml + rxHtml;
      } else {
        const col = m.color || "#8be9fd";
        el.style.setProperty("--persona-color", col);
        const av = m.avatar ? m.avatar + " " : "";
        const fam = m.familyTag ? '<span class="family">[' + escapeHtml(m.familyTag) + ']</span>' : "";
        const thinkMode = (currentConfig && currentConfig.thinkingDisplay) || "compact";
        const openAttr = (thinkMode === "expanded" || m.streaming) ? " open" : "";
        const thinkHtml = (m.thinking && thinkMode !== "hidden")
          ? '<details class="thinking-box"' + openAttr + '><summary>💭 Thinking Trace</summary><div class="thinking-content">' + escapeHtml(m.thinking) + '</div></details>'
          : "";
        const cursor = m.streaming ? ' <span class="stream-cursor">▍</span>' : "";
        el.innerHTML =
          '<div><span class="ts">[' + escapeHtml(m.timestamp) + ']</span> <span class="nick">&lt;' + escapeHtml(av + m.senderNick) + '&gt;</span>' + fam + pinHtml + '</div>' +
          thinkHtml +
          '<div class="body">' + formatInlineMarkdown(m.text || (m.streaming ? "..." : "")) + cursor + '</div>' +
          imgHtml +
          rxHtml;
      }
      if (isNew || m.streaming) {
        feedEl.scrollTop = feedEl.scrollHeight;
      }
    }

    function updateHeader(state) {
      currentChannelState = state;
      chanEl.textContent = state.channelName;
      vibeEl.textContent = "Vibe: " + state.vibeKey.toUpperCase() + (state.locked ? " 🔒" : "");
      if (state.config) {
        currentConfig = state.config;
        const ambIcon = state.config.ambientEnabled ? " ⚡" : " ○";
        paceEl.textContent = "Pace: " + String(state.config.preset || "lively").toUpperCase() + ambIcon;
        document.querySelectorAll("button[data-preset]").forEach(btn => {
          btn.classList.toggle("active-preset", btn.getAttribute("data-preset") === state.config.preset);
        });
        syncSettingsDialog(state.config);
      }
      const provPrefix = state.activeProvider ? state.activeProvider + ":" : "";
      engineEl.textContent = "Engine: " + provPrefix + state.engineModel;
      const specSuffix = state.spectatorCount > 0 ? " • 👁️ " + state.spectatorCount : "";
      const arenaSuffix = state.arenaActive ? " • 🎭 ARENA" : "";
      countEl.textContent = "4-Player DOOM Co-op [" + state.humans.length + "/" + (state.maxHumans || 4) + "]" + specSuffix + arenaSuffix;

      const bindings = state.personaBindings || {};
      const moods = state.personaMoods || {};
      if (typeof state.sharedPad === "string" && coopPadEl && document.activeElement !== coopPadEl) {
        coopPadEl.value = state.sharedPad;
      }
      const humanPills = state.humans.map(h => {
        const actIcon = h.activity === "typing" ? " ✍️" : h.activity === "pad" ? " 🎛️" : h.activity === "imagine" ? " 🎨" : h.activity === "arena" ? " 🎭" : "";
        return '<button type="button" class="pill human" data-mention="@' + escapeHtml(h.nick) + '">@' + escapeHtml(h.nick) + (h.isHost ? " ★" : "") + actIcon + '</button>';
      });
      const botPills = state.activePersonas.map(p => {
        const key = String(p.id).toLowerCase();
        const b = bindings[key];
        const m = moods[key];
        const viaBadge = b ? '<span class="pill-via">(' + escapeHtml(b.provider + ":" + b.model) + ')</span>' : "";
        const moodBadge = (m && (m.mood !== "baseline" || m.obsession))
          ? '<span class="pill-via">[' + escapeHtml(m.emoji + " " + m.mood) + ']</span>'
          : "";
        const moodTitle = (m && m.obsession)
          ? ' title="' + escapeHtml(m.emoji + " " + m.mood + " — Obsession: " + m.obsession) + '"'
          : "";
        return '<button type="button" class="pill bot" data-mention="@' + escapeHtml(p.nick) + '" style="--persona-color:' + escapeHtml(p.color) + '"' + moodTitle + '>' +
          escapeHtml(p.avatar + " <" + p.nick + ">") + moodBadge + viaBadge + '</button>';
      });
      rosterEl.innerHTML = humanPills.concat(botPills).join("");
    }

    rosterEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-mention]");
      if (!btn) return;
      const mention = btn.getAttribute("data-mention");
      if (!mention) return;
      const cur = inputEl.value;
      inputEl.value = cur ? cur.replace(/\\s*$/, " ") + mention + " " : mention + " ";
      inputEl.focus();
    });

    feedEl.addEventListener("click", (ev) => {
      const reactBtn = ev.target.closest("button[data-msg-id][data-emoji]");
      if (reactBtn && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "react",
          messageId: reactBtn.getAttribute("data-msg-id"),
          emoji: reactBtn.getAttribute("data-emoji")
        }));
        return;
      }
      const pinBtn = ev.target.closest("button[data-pin-cmd]");
      if (pinBtn && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "command",
          raw: pinBtn.getAttribute("data-pin-cmd")
        }));
      }
    });

    inputEl.addEventListener("input", () => {
      const now = Date.now();
      if (ws.readyState === WebSocket.OPEN && now - lastTypingSentAt > 2500) {
        lastTypingSentAt = now;
        ws.send(JSON.stringify({ type: "typing", isTyping: inputEl.value.trim().length > 0 }));
      }
    });

    if (coopPadEl) {
      coopPadEl.addEventListener("focus", () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "activity", activity: "pad" }));
        }
      });
      coopPadEl.addEventListener("blur", () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "activity", activity: "idle" }));
        }
      });
      coopPadEl.addEventListener("input", () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "pad:edit", text: coopPadEl.value }));
        }
      });
    }

    if (padImagineBtn && coopPadEl) {
      padImagineBtn.addEventListener("click", () => {
        const promptText = coopPadEl.value.trim() || inputEl.value.trim() || "1972 ARPANET terminal glowing in #latent-space";
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "command", raw: "/imagine " + promptText }));
        }
      });
    }

    function syncCatalogViews(catalog, scenarios) {
      if (Array.isArray(catalog)) {
        catalogPersonas = catalog;
        if (forgeTemplateSelect) {
          const prevVal = forgeTemplateSelect.value;
          forgeTemplateSelect.innerHTML = '<option value="">✨ Blank Custom Persona</option>' +
            catalogPersonas.map(p =>
              '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.avatar + " " + p.displayName + " (<" + p.nick + "> • " + p.id + ")") + '</option>'
            ).join("");
          forgeTemplateSelect.value = prevVal;
        }
      }
      if (Array.isArray(scenarios)) {
        catalogScenarios = scenarios;
        if (customScenariosBar) {
          const customs = catalogScenarios.filter(s => s.isCustom);
          customScenariosBar.innerHTML = customs.map(s =>
            '<button type="button" class="quick-btn" data-cmd="/scenario ' + escapeHtml(s.id) + '">' + escapeHtml(s.title) + '</button>'
          ).join("");
          customScenariosBar.querySelectorAll(".quick-btn").forEach(btn => {
            btn.addEventListener("click", () => {
              const cmd = btn.getAttribute("data-cmd");
              if (cmd && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "command", raw: cmd }));
              }
            });
          });
        }
      }
    }

    ws.onmessage = (ev) => {
      const pkt = JSON.parse(ev.data);
      if (pkt.type === "sync") {
        if (pkt.isSpectator) {
          selfNickEl.textContent = "👁️ @" + pkt.selfNick + ">";
          inputEl.placeholder = "👁️ Spectator Mode (Read-Only) — run /channels, /channel #name, /roster, /pins, /lore, /mood, /forge, or /settings...";
        } else {
          selfNickEl.textContent = "@" + pkt.selfNick + ">";
        }
        localStorage.setItem("llm_sim_nick", pkt.selfNick);
        feedEl.innerHTML = "";
        messages.clear();
        syncCatalogViews(pkt.catalog, pkt.scenarios || (pkt.state && pkt.state.scenarios));
        updateHeader(pkt.state);
        statusEl.textContent = pkt.state.statusText || (pkt.isSpectator ? "👁️ Watching live in Read-Only Spectator Mode" : "Ready — Type a message or /command");
        for (const m of pkt.state.messages) {
          messages.set(m.id, m);
          renderMessageNode(m);
        }
      } else if (pkt.type === "catalog:update") {
        syncCatalogViews(pkt.catalog, pkt.scenarios);
      } else if (pkt.type === "message:upsert") {
        messages.set(pkt.message.id, pkt.message);
        renderMessageNode(pkt.message);
      } else if (pkt.type === "message:clear") {
        feedEl.innerHTML = "";
        messages.clear();
      } else if (pkt.type === "presence") {
        const prevThink = currentConfig && currentConfig.thinkingDisplay;
        updateHeader({
          channelName: pkt.channel,
          vibeKey: pkt.vibeKey,
          activeProvider: pkt.activeProvider,
          engineModel: pkt.engineModel,
          personaBindings: pkt.personaBindings,
          personaMoods: pkt.personaMoods,
          config: pkt.config,
          locked: pkt.locked,
          humans: pkt.humans,
          spectatorCount: pkt.spectatorCount,
          arenaActive: pkt.arenaActive,
          maxHumans: 4,
          activePersonas: pkt.activePersonas
        });
        if (pkt.config && pkt.config.thinkingDisplay !== prevThink) {
          for (const m of messages.values()) {
            renderMessageNode(m);
          }
        }
      } else if (pkt.type === "status") {
        statusEl.textContent = pkt.statusText || "Ready — Type a message or /command";
      } else if (pkt.type === "pad:update") {
        if (coopPadEl && document.activeElement !== coopPadEl) {
          coopPadEl.value = pkt.text || "";
        }
        if (padStatusEl) {
          padStatusEl.textContent = "Updated by @" + (pkt.updatedBy || "player");
        }
      } else if (pkt.type === "nick:ack") {
        selfNickEl.textContent = "@" + pkt.nick + ">";
        localStorage.setItem("llm_sim_nick", pkt.nick);
      } else if (pkt.type === "notice") {
        renderMessageNode(pkt.message);
      } else if (pkt.type === "kicked") {
        statusEl.textContent = "⛔ Disconnected: " + pkt.reason;
        ws.close();
      }
    };

    ws.onclose = () => {
      statusEl.textContent = "Disconnected from host server.";
    };

    function syncSettingsDialog(cfg) {
      if (!cfg) return;
      document.querySelectorAll("[data-config-key]").forEach(el => {
        const k = el.getAttribute("data-config-key");
        if (!k || !(k in cfg)) return;
        if (el.type === "checkbox") {
          el.checked = Boolean(cfg[k]);
        } else if (document.activeElement !== el) {
          el.value = String(cfg[k]);
        }
      });
    }

    function openSettingsModal() {
      if (settingsDialog && typeof settingsDialog.showModal === "function") {
        syncSettingsDialog(currentConfig);
        settingsDialog.showModal();
      }
    }

    if (openSettingsBtn) {
      openSettingsBtn.addEventListener("click", openSettingsModal);
    }
    if (drawerSettingsBtn) {
      drawerSettingsBtn.addEventListener("click", openSettingsModal);
    }
    if (settingsDialog) {
      if (!("closedBy" in HTMLDialogElement.prototype)) {
        settingsDialog.addEventListener("click", (e) => {
          if (e.target !== settingsDialog) return;
          const r = settingsDialog.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          ) {
            settingsDialog.close("dismiss");
          }
        });
      }
      settingsDialog.addEventListener("change", (ev) => {
        const el = ev.target.closest("[data-config-key]");
        if (!el || ws.readyState !== WebSocket.OPEN) return;
        const k = el.getAttribute("data-config-key");
        const val = el.type === "checkbox" ? String(el.checked) : String(el.value);
        ws.send(JSON.stringify({ type: "command", raw: "/config set " + k + " " + val }));
      });
    }

    function openForgeModal() {
      if (forgeDialog && typeof forgeDialog.showModal === "function") {
        forgeDialog.showModal();
      }
    }

    if (openForgeBtn) {
      openForgeBtn.addEventListener("click", openForgeModal);
    }
    if (drawerForgeBtn) {
      drawerForgeBtn.addEventListener("click", openForgeModal);
    }
    if (forgeDialog) {
      if (!("closedBy" in HTMLDialogElement.prototype)) {
        forgeDialog.addEventListener("click", (e) => {
          if (e.target !== forgeDialog) return;
          const r = forgeDialog.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          ) {
            forgeDialog.close("dismiss");
          }
        });
      }
    }

    if (forgeTemplateSelect) {
      forgeTemplateSelect.addEventListener("change", () => {
        const selectedId = forgeTemplateSelect.value;
        const p = catalogPersonas.find(item => item.id === selectedId);
        if (!p) return;
        document.getElementById("forge-id").value = p.id;
        document.getElementById("forge-nick").value = p.nick;
        document.getElementById("forge-avatar").value = p.avatar || "🤖";
        document.getElementById("forge-color").value = p.color || "#8be9fd";
        document.getElementById("forge-era").value = p.era || "Custom Era";
        document.getElementById("forge-family").value = p.family || "Custom Forge";
        document.getElementById("forge-talk").value = String(p.talkativeness || 0.65);
        document.getElementById("forge-bio").value = p.bio || "";
        document.getElementById("forge-prompt").value = p.systemPrompt || "";
      });
    }

    const forgeAutoBtn = document.getElementById("forge-auto-btn");
    if (forgeAutoBtn) {
      forgeAutoBtn.addEventListener("click", () => {
        const concept = document.getElementById("forge-auto-concept").value.trim();
        const idHint = document.getElementById("forge-id").value.trim() || "custom-bot";
        if (!concept || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "command", raw: "/forge auto " + idHint + " " + concept }));
        if (forgeDialog) forgeDialog.close("forged");
      });
    }

    const personaForgeForm = document.getElementById("persona-forge-form");
    if (personaForgeForm) {
      personaForgeForm.addEventListener("submit", (e) => {
        e.preventDefault();
        if (ws.readyState !== WebSocket.OPEN) return;
        const clean = (v) => String(v || "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
        const id = clean(document.getElementById("forge-id").value) || "custom-bot";
        const nick = clean(document.getElementById("forge-nick").value) || id;
        const avatar = clean(document.getElementById("forge-avatar").value) || "🤖";
        const era = clean(document.getElementById("forge-era").value) || "2026 Custom";
        const family = clean(document.getElementById("forge-family").value) || "Persona Forge";
        const bio = clean(document.getElementById("forge-bio").value) || "Custom forged persona.";
        const prompt = clean(document.getElementById("forge-prompt").value) || ("You are " + nick + ". " + bio);
        const talk = clean(document.getElementById("forge-talk").value) || "0.65";
        const color = clean(document.getElementById("forge-color").value) || "#8be9fd";
        const rawCmd = "/forge new " + [id, nick, avatar, era, family, bio, prompt, talk, color].join(" | ");
        ws.send(JSON.stringify({ type: "command", raw: rawCmd }));
        if (forgeDialog) forgeDialog.close("saved");
      });
    }

    const forgeExportBtn = document.getElementById("forge-export-btn");
    if (forgeExportBtn) {
      forgeExportBtn.addEventListener("click", () => {
        const id = document.getElementById("forge-id").value.trim();
        if (id && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "command", raw: "/forge export " + id }));
        }
      });
    }

    const forgeDeleteBtn = document.getElementById("forge-delete-btn");
    if (forgeDeleteBtn) {
      forgeDeleteBtn.addEventListener("click", () => {
        const id = document.getElementById("forge-id").value.trim();
        if (id && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "command", raw: "/forge delete " + id }));
        }
      });
    }

    const scenarioSnapshotBtn = document.getElementById("scenario-snapshot-btn");
    if (scenarioSnapshotBtn) {
      scenarioSnapshotBtn.addEventListener("click", () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const id = document.getElementById("scenario-id").value.trim() || "room-snapshot";
        const title = document.getElementById("scenario-title").value.trim() || ("📸 " + (currentChannelState ? currentChannelState.channelName : "#latent-space") + " Showdown");
        const evText = document.getElementById("scenario-event").value.trim();
        const cmd = "/make-scenario snapshot " + id + " " + title + (evText ? " | " + evText : "");
        ws.send(JSON.stringify({ type: "command", raw: cmd }));
        if (forgeDialog) forgeDialog.close("snapshot");
      });
    }

    const scenarioPrefillBtn = document.getElementById("scenario-prefill-btn");
    if (scenarioPrefillBtn) {
      scenarioPrefillBtn.addEventListener("click", () => {
        if (!currentChannelState) return;
        const chanSlug = String(currentChannelState.channelName || "room").replace(/^#/, "");
        document.getElementById("scenario-id").value = chanSlug + "-showdown";
        document.getElementById("scenario-title").value = "🎬 " + currentChannelState.channelName + " Showdown";
        document.getElementById("scenario-bots").value = (currentChannelState.activePersonas || []).map(p => p.id).join(", ");
        document.getElementById("scenario-event").value = (coopPadEl && coopPadEl.value.trim()) || ("Showdown in " + currentChannelState.channelName + "!");
      });
    }

    function buildScenarioCmd(subVerb) {
      const clean = (v) => String(v || "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
      const id = clean(document.getElementById("scenario-id").value) || "custom-scenario";
      const title = clean(document.getElementById("scenario-title").value) || ("🎬 " + id);
      const bots = clean(document.getElementById("scenario-bots").value) || "sydney, opus-3, eliza";
      const vibeRadio = document.querySelector('input[name="scenario_vibe"]:checked');
      const presetRadio = document.querySelector('input[name="scenario_preset"]:checked');
      const vibe = vibeRadio ? vibeRadio.value : "debate";
      const preset = presetRadio ? presetRadio.value : "banter";
      const evText = clean(document.getElementById("scenario-event").value) || ("Showdown " + title + " begins!");
      return "/make-scenario " + subVerb + " " + [id, title, bots, vibe, preset, evText].join(" | ");
    }

    const scenarioForgeForm = document.getElementById("scenario-forge-form");
    if (scenarioForgeForm) {
      scenarioForgeForm.addEventListener("submit", (e) => {
        e.preventDefault();
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "command", raw: buildScenarioCmd("launch") }));
        if (forgeDialog) forgeDialog.close("launched");
      });
    }

    const scenarioSaveOnlyBtn = document.getElementById("scenario-save-only-btn");
    if (scenarioSaveOnlyBtn) {
      scenarioSaveOnlyBtn.addEventListener("click", () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "command", raw: buildScenarioCmd("new") }));
      });
    }

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (!text || ws.readyState !== WebSocket.OPEN) return;
      const lower = text.toLowerCase();
      if (lower === "/settings" || lower === "/menu" || lower === "/options") {
        openSettingsModal();
        inputEl.value = "";
        return;
      }
      if (lower === "/forge ui" || lower === "/persona ui" || lower === "/make-scenario ui" || lower === "/scenario ui") {
        openForgeModal();
        inputEl.value = "";
        return;
      }
      if (text.startsWith("/")) {
        ws.send(JSON.stringify({ type: "command", raw: text }));
      } else {
        ws.send(JSON.stringify({ type: "chat", text }));
      }
      inputEl.value = "";
    });

    document.querySelectorAll(".quick-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const cmd = btn.getAttribute("data-cmd");
        if (cmd && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "command", raw: cmd }));
        }
        inputEl.focus();
      });
    });
  </script>
</body>
</html>`;
}
