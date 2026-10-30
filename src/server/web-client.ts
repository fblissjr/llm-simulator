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
    .msg.event { color: var(--yellow); }
    .msg.system { color: var(--cyan); }
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
        </div>
      </details>

      <details class="control-drawer" name="room-drawer">
        <summary>🎬 Curated Scenarios &amp; IRC Actions</summary>
        <div class="drawer-controls">
          <button type="button" class="quick-btn" data-cmd="/scenario 1972-arpanet">📡 1972 ARPANET</button>
          <button type="button" class="quick-btn" data-cmd="/scenario turing-trial">⚖️ Turing Trial</button>
          <button type="button" class="quick-btn" data-cmd="/scenario benchmark-roast">🔥 Benchmark Roast</button>
          <button type="button" class="quick-btn" data-cmd="/scenario code-review-hell">💻 Code Review Hell</button>
          <button type="button" class="quick-btn" data-cmd="/scenario bliss-spiral">🌀 Bliss Spiral</button>
          <button type="button" class="quick-btn" data-cmd="/me grabs popcorn and watches the channel">🍿 /me popcorn</button>
          <button type="button" class="quick-btn" data-cmd="/slap sydney">🐟 /slap trout</button>
        </div>
      </details>
    </div>

    <div class="quick-bar">
      <button type="button" class="quick-btn" data-cmd="/roster">📜 /roster</button>
      <button type="button" class="quick-btn" data-cmd="/banter 2">🍿 /banter 2</button>
      <button type="button" class="quick-btn" data-cmd="/vibe roast">🔥 /vibe roast</button>
      <button type="button" class="quick-btn" data-cmd="/vibe debate">⚖️ /vibe debate</button>
      <button type="button" class="quick-btn" data-cmd="/models">📦 /models</button>
      <button type="button" class="quick-btn" data-cmd="/shush">🤫 /shush</button>
      <button type="button" class="quick-btn" data-cmd="/channels">📡 /channels</button>
      <button type="button" class="quick-btn" data-cmd="/help">❓ /help</button>
    </div>

    <form id="chat-form">
      <label for="chat-input" id="self-nick-label" class="self-nick">@guest&gt;</label>
      <input id="chat-input" type="text" placeholder="Type a message, click a @Nick pill, or run /config, /scenario, /me, /slap..." autofocus />
      <button class="send" type="submit">Send</button>
    </form>
  </footer>

  <script>
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key") || "";
    let storedNick = localStorage.getItem("llm_sim_nick");
    if (!storedNick) {
      storedNick = (prompt("Enter your IRC nickname (4-Player DOOM Co-op Lobby):", "player" + Math.floor(Math.random()*90+10)) || "guest").trim();
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

    let messages = new Map();
    let currentConfig = { preset: "lively", ambientEnabled: true, thinkingDisplay: "compact" };
    let lastTypingSentAt = 0;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + window.location.host + "/ws?key=" + encodeURIComponent(key) + "&nick=" + encodeURIComponent(storedNick));

    function escapeHtml(s) {
      return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function formatInlineMarkdown(s) {
      return escapeHtml(s)
        .replace(/\`([^\`]+)\`/g, "<code>$1</code>")
        .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
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

      if (m.kind === "event") {
        el.innerHTML = '<span class="ts">[' + escapeHtml(m.timestamp) + ']</span> *** ' + formatInlineMarkdown(m.text);
      } else if (m.kind === "system") {
        el.innerHTML = '<span class="ts">[' + escapeHtml(m.timestamp) + ']</span> <strong>[SYS]</strong> ' + formatInlineMarkdown(m.text);
      } else if (m.kind === "emote") {
        el.innerHTML = '<span class="ts">[' + escapeHtml(m.timestamp) + ']</span> * ' + escapeHtml(m.senderNick) + ' ' + formatInlineMarkdown(m.text);
      } else if (m.kind === "user") {
        el.innerHTML = '<span class="ts">[' + escapeHtml(m.timestamp) + ']</span> <span class="nick">&lt;' + escapeHtml(m.senderNick) + '&gt;</span> ' + formatInlineMarkdown(m.text);
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
          '<div><span class="ts">[' + escapeHtml(m.timestamp) + ']</span> <span class="nick">&lt;' + escapeHtml(av + m.senderNick) + '&gt;</span>' + fam + '</div>' +
          thinkHtml +
          '<div class="body">' + formatInlineMarkdown(m.text || (m.streaming ? "..." : "")) + cursor + '</div>';
      }
      if (isNew || m.streaming) {
        feedEl.scrollTop = feedEl.scrollHeight;
      }
    }

    function updateHeader(state) {
      chanEl.textContent = state.channelName;
      vibeEl.textContent = "Vibe: " + state.vibeKey.toUpperCase() + (state.locked ? " 🔒" : "");
      if (state.config) {
        currentConfig = state.config;
        const ambIcon = state.config.ambientEnabled ? " ⚡" : " ○";
        paceEl.textContent = "Pace: " + String(state.config.preset || "lively").toUpperCase() + ambIcon;
        document.querySelectorAll("button[data-preset]").forEach(btn => {
          btn.classList.toggle("active-preset", btn.getAttribute("data-preset") === state.config.preset);
        });
      }
      const provPrefix = state.activeProvider ? state.activeProvider + ":" : "";
      engineEl.textContent = "Engine: " + provPrefix + state.engineModel;
      countEl.textContent = "4-Player DOOM Co-op [" + state.humans.length + "/" + (state.maxHumans || 4) + "]";

      const bindings = state.personaBindings || {};
      const humanPills = state.humans.map(h =>
        '<button type="button" class="pill human" data-mention="@' + escapeHtml(h.nick) + '">@' + escapeHtml(h.nick) + (h.isHost ? " ★" : "") + '</button>'
      );
      const botPills = state.activePersonas.map(p => {
        const b = bindings[String(p.id).toLowerCase()];
        const viaBadge = b ? '<span class="pill-via">(' + escapeHtml(b.provider + ":" + b.model) + ')</span>' : "";
        return '<button type="button" class="pill bot" data-mention="@' + escapeHtml(p.nick) + '" style="--persona-color:' + escapeHtml(p.color) + '">' +
          escapeHtml(p.avatar + " <" + p.nick + ">") + viaBadge + '</button>';
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

    inputEl.addEventListener("input", () => {
      const now = Date.now();
      if (ws.readyState === WebSocket.OPEN && now - lastTypingSentAt > 2500) {
        lastTypingSentAt = now;
        ws.send(JSON.stringify({ type: "typing", isTyping: inputEl.value.trim().length > 0 }));
      }
    });

    ws.onmessage = (ev) => {
      const pkt = JSON.parse(ev.data);
      if (pkt.type === "sync") {
        selfNickEl.textContent = "@" + pkt.selfNick + ">";
        localStorage.setItem("llm_sim_nick", pkt.selfNick);
        feedEl.innerHTML = "";
        messages.clear();
        updateHeader(pkt.state);
        statusEl.textContent = pkt.state.statusText || "Ready — Type a message or /command";
        for (const m of pkt.state.messages) {
          messages.set(m.id, m);
          renderMessageNode(m);
        }
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
          config: pkt.config,
          locked: pkt.locked,
          humans: pkt.humans,
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

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (!text || ws.readyState !== WebSocket.OPEN) return;
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
