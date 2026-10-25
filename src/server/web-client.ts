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
    .chan-badge {
      background: #282a36;
      color: var(--green);
      font-weight: 700;
      padding: 3px 8px;
      border: 1px solid var(--green);
      border-radius: 4px;
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
    .pill {
      padding: 2px 7px;
      border-radius: 4px;
      background: #282a36;
      border: 1px solid var(--border);
      white-space: nowrap;
    }
    .pill.human { border-color: var(--green); color: var(--green); }
    #feed {
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
    .msg .nick { font-weight: 700; }
    .msg .family { color: var(--muted); font-size: 12px; margin-left: 6px; }
    .msg .thinking {
      color: var(--muted);
      font-style: italic;
      border-left: 2px solid var(--border);
      margin: 4px 0 4px 12px;
      padding-left: 8px;
    }
    .msg .body { margin-top: 2px; padding-left: 10px; }
    .msg.event { color: var(--yellow); }
    .msg.system { color: var(--cyan); }
    #status-bar {
      padding: 6px 14px;
      background: var(--panel);
      border-top: 1px solid var(--border);
      color: var(--yellow);
      font-size: 12px;
      min-height: 28px;
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
    form {
      display: flex;
      background: #12131a;
      border-top: 2px solid var(--border);
      padding: 8px 14px;
      gap: 8px;
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
      <div>
        <span class="chan-badge" id="chan-name">#latent-space</span>
        <span id="vibe-badge" style="color: var(--orange); margin-left: 8px; font-weight: bold;">Vibe: CHAT</span>
      </div>
      <div class="meta-badges">
        <span id="engine-badge">Engine: gemini-3.8-flash</span>
        <span id="player-count">Humans: 1/4</span>
      </div>
    </div>
    <div class="roster-row" id="roster-bar">Connecting...</div>
  </header>

  <div id="feed"></div>
  <div id="status-bar">Connecting to llm-sim lobby...</div>

  <div class="quick-bar">
    <button class="quick-btn" data-cmd="/roster">📜 /roster</button>
    <button class="quick-btn" data-cmd="/banter 2">🍿 /banter 2</button>
    <button class="quick-btn" data-cmd="/vibe roast">🔥 /vibe roast</button>
    <button class="quick-btn" data-cmd="/vibe debate">⚖️ /vibe debate</button>
    <button class="quick-btn" data-cmd="/shush">🤫 /shush</button>
    <button class="quick-btn" data-cmd="/channels">📡 /channels</button>
    <button class="quick-btn" data-cmd="/help">❓ /help</button>
  </div>

  <form id="chat-form">
    <span id="self-nick-label" style="color: var(--green); font-weight: bold; align-self: center;">@guest&gt;</span>
    <input id="chat-input" type="text" placeholder="Type a message, @Nick, or /summon <model>..." autocomplete="off" autofocus />
    <button class="send" type="submit">Send</button>
  </form>

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
    const engineEl = document.getElementById("engine-badge");
    const countEl = document.getElementById("player-count");
    const rosterEl = document.getElementById("roster-bar");
    const selfNickEl = document.getElementById("self-nick-label");
    const formEl = document.getElementById("chat-form");
    const inputEl = document.getElementById("chat-input");

    let messages = new Map();
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + window.location.host + "/ws?key=" + encodeURIComponent(key) + "&nick=" + encodeURIComponent(storedNick));

    function escapeHtml(s) {
      return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
        el.innerHTML = '<span class="ts">[' + escapeHtml(m.timestamp) + ']</span> *** ' + escapeHtml(m.text);
      } else if (m.kind === "system") {
        el.innerHTML = '<span class="ts">[' + escapeHtml(m.timestamp) + ']</span> <b>[SYS]</b> ' + escapeHtml(m.text);
      } else if (m.kind === "user") {
        el.innerHTML = '<span class="ts">[' + escapeHtml(m.timestamp) + ']</span> <span class="nick" style="color: var(--green)">&lt;' + escapeHtml(m.senderNick) + '&gt;</span> ' + escapeHtml(m.text);
      } else {
        const col = m.color || "#8be9fd";
        const av = m.avatar ? m.avatar + " " : "";
        const fam = m.familyTag ? '<span class="family">[' + escapeHtml(m.familyTag) + ']</span>' : "";
        const thinkHtml = m.thinking ? '<div class="thinking">💭 ' + escapeHtml(m.thinking) + '</div>' : "";
        const cursor = m.streaming ? ' <span style="color:var(--green)">▍</span>' : "";
        el.innerHTML =
          '<div><span class="ts">[' + escapeHtml(m.timestamp) + ']</span> <span class="nick" style="color:' + escapeHtml(col) + '">&lt;' + escapeHtml(av + m.senderNick) + '&gt;</span>' + fam + '</div>' +
          thinkHtml +
          '<div class="body">' + escapeHtml(m.text || (m.streaming ? "..." : "")) + cursor + '</div>';
      }
      if (isNew || m.streaming) {
        feedEl.scrollTop = feedEl.scrollHeight;
      }
    }

    function updateHeader(state) {
      chanEl.textContent = state.channelName;
      vibeEl.textContent = "Vibe: " + state.vibeKey.toUpperCase() + (state.locked ? " 🔒" : "");
      const provPrefix = state.activeProvider ? state.activeProvider + ":" : "";
      engineEl.textContent = "Engine: " + provPrefix + state.engineModel;
      countEl.textContent = "Humans: " + state.humans.length + "/" + (state.maxHumans || 4);

      const humanPills = state.humans.map(h =>
        '<span class="pill human">@' + escapeHtml(h.nick) + (h.isHost ? " ★" : "") + '</span>'
      );
      const botPills = state.activePersonas.map(p =>
        '<span class="pill" style="border-color:' + escapeHtml(p.color) + ';color:' + escapeHtml(p.color) + '">' + escapeHtml(p.avatar + " <" + p.nick + ">") + '</span>'
      );
      rosterEl.innerHTML = humanPills.concat(botPills).join("");
    }

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
        updateHeader({
          channelName: pkt.channel,
          vibeKey: pkt.vibeKey,
          activeProvider: pkt.activeProvider,
          engineModel: pkt.engineModel,
          locked: pkt.locked,
          humans: pkt.humans,
          maxHumans: 4,
          activePersonas: pkt.activePersonas
        });
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

    ws.onclose = (ev) => {
      statusEl.textContent = "Disconnected from server (" + (ev.reason || "closed") + "). Refresh to reconnect.";
    };

    formEl.onsubmit = (e) => {
      e.preventDefault();
      const val = inputEl.value.trim();
      if (!val || ws.readyState !== WebSocket.OPEN) return;
      if (val.startsWith("/")) {
        ws.send(JSON.stringify({ type: "command", raw: val }));
      } else {
        ws.send(JSON.stringify({ type: "chat", text: val }));
      }
      inputEl.value = "";
    };

    document.querySelectorAll(".quick-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const cmd = btn.getAttribute("data-cmd");
        if (cmd && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "command", raw: cmd }));
          inputEl.focus();
        }
      });
    });
  </script>
</body>
</html>`;
}
