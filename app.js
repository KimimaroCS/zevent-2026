const STORAGE_KEY = "zevent-multiview-v2";
const CHAT_MIN = 300;
const CHAT_MAX = 640;

const grid = document.getElementById("grid");
const addForm = document.getElementById("add-form");
const channelInput = document.getElementById("channel-input");
const catalog = document.getElementById("catalog");
const catalogList = document.getElementById("catalog-list");
const catalogSearch = document.getElementById("catalog-search");
const toggleCatalog = document.getElementById("toggle-catalog");
const toggleChat = document.getElementById("toggle-chat");
const closeChat = document.getElementById("close-chat");
const chatPanel = document.getElementById("chat-panel");
const chatTabs = document.getElementById("chat-tabs");
const chatBodies = document.getElementById("chat-bodies");
const chatSplitBtn = document.getElementById("chat-split");
const chatResize = document.getElementById("chat-resize");
const exitTheater = document.getElementById("exit-theater");
const topbar = document.querySelector(".topbar");

const players = new Map();
const state = loadState();

function parentHosts() {
  const host = window.location.hostname || "localhost";
  const hosts = new Set([host, "kimimarocs.github.io"]);
  if (host === "localhost" || host === "127.0.0.1") {
    hosts.add("localhost");
    hosts.add("127.0.0.1");
  }
  return [...hosts];
}

function normalize(login) {
  return login
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//, "")
    .split(/[/?#]/)[0]
    .replace(/[^a-z0-9_]/g, "");
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("zevent-multiview-v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.channels) && parsed.channels.length) {
        return {
          channels: parsed.channels,
          theater: parsed.theater || null,
          sound: parsed.sound || parsed.channels[0],
          chats: [],
          chatActive: parsed.channels[0],
          chatSplit: false,
          chatWidth: Number(parsed.chatWidth) || 380,
          catalogOpen: Boolean(parsed.catalogOpen),
        };
      }
    }
  } catch {
    /* ignore */
  }
  return {
    channels: [...DEFAULT_CHANNELS],
    theater: null,
    sound: DEFAULT_CHANNELS[0],
    chats: [],
    chatActive: DEFAULT_CHANNELS[0],
    chatSplit: false,
    chatWidth: 380,
    catalogOpen: false,
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function chatSrc(login) {
  const params = new URLSearchParams();
  parentHosts().forEach((p) => params.append("parent", p));
  return `https://www.twitch.tv/embed/${login}/chat?${params.toString()}&darkpopout`;
}

function displayName(login) {
  const known = ZEVENT_STREAMERS.find((s) => s.login === login);
  return known ? known.name : login;
}

function addChannel(raw) {
  const login = normalize(raw);
  if (!login || state.channels.includes(login)) return;
  state.channels.push(login);
  if (!state.sound) state.sound = login;
  if (!state.chatActive) state.chatActive = login;
  saveState();
  syncPlayers();
  updateChrome();
}

function removeChannel(login) {
  state.channels = state.channels.filter((c) => c !== login);
  if (state.theater === login) state.theater = null;
  if (state.sound === login) state.sound = state.channels[0] || null;
  state.chats = state.chats.filter((c) => c !== login);
  if (state.chatActive === login) state.chatActive = state.chats[0] || state.channels[0] || null;
  saveState();
  syncPlayers();
  updateChrome();
}

function setTheater(login) {
  state.theater = state.theater === login ? null : login;
  if (state.theater) state.sound = login;
  saveState();
  syncPlayers();
  updateChrome();
}

function clearTheater() {
  state.theater = null;
  saveState();
  syncPlayers();
  updateChrome();
}

function setSound(login) {
  state.sound = login;
  saveState();
  applySound();
  updateChrome();
}

function setChat(open, login = state.chatActive) {
  if (!open) {
    state.chats = [];
    state.chatSplit = false;
  } else if (login && !state.chats.includes(login)) {
    state.chats.push(login);
    state.chatActive = login;
  } else if (login) {
    state.chatActive = login;
  }
  saveState();
  updateChrome();
}

function closeChatTab(login) {
  state.chats = state.chats.filter((c) => c !== login);
  if (state.chatActive === login) state.chatActive = state.chats[0] || null;
  if (state.chats.length < 2) state.chatSplit = false;
  saveState();
  updateChrome();
}

function visibleChats() {
  if (!state.chats.length) return [];
  if (!state.chatSplit || state.chats.length < 2) return [state.chatActive || state.chats[0]];
  const primary = state.chatActive || state.chats[0];
  const second = state.chats.find((c) => c !== primary) || state.chats[0];
  return [primary, second];
}

function applyChatWidth() {
  const width = Math.min(CHAT_MAX, Math.max(CHAT_MIN, state.chatWidth || 380));
  state.chatWidth = width;
  document.documentElement.style.setProperty("--chat-width", `${width}px`);
}

function positionChatDock() {
  if (!topbar) return;
  let top = topbar.getBoundingClientRect().bottom;
  if (catalog && !catalog.hidden) top = catalog.getBoundingClientRect().bottom;
  chatPanel.style.top = `${Math.max(0, top)}px`;
}

function applySound() {
  players.forEach((entry, login) => {
    if (entry.player && typeof entry.player.setMuted === "function") {
      entry.player.setMuted(state.sound !== login);
    }
    const soundBtn = entry.card.querySelector(".sound");
    if (soundBtn) {
      soundBtn.classList.toggle("on", state.sound === login);
      soundBtn.textContent = state.sound === login ? "Son ON" : "Son";
    }
  });
}

function createPlayer(login) {
  const card = document.createElement("article");
  card.className = "player";
  card.dataset.channel = login;

  const mount = document.createElement("div");
  mount.id = `twitch-${login}`;
  mount.className = "twitch-mount";

  const bar = document.createElement("div");
  bar.className = "player-bar";

  const name = document.createElement("span");
  name.className = "player-name";
  name.textContent = displayName(login);

  const actions = document.createElement("div");
  actions.className = "player-actions";

  const theaterBtn = document.createElement("button");
  theaterBtn.type = "button";
  theaterBtn.className = "mini theater-btn";
  theaterBtn.addEventListener("click", () => setTheater(login));

  const soundBtn = document.createElement("button");
  soundBtn.type = "button";
  soundBtn.className = "mini sound";
  soundBtn.addEventListener("click", () => setSound(login));

  const chatBtn = document.createElement("button");
  chatBtn.type = "button";
  chatBtn.className = "mini";
  chatBtn.textContent = "Chat";
  chatBtn.addEventListener("click", () => setChat(true, login));

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "mini danger";
  removeBtn.textContent = "Retirer";
  removeBtn.addEventListener("click", () => removeChannel(login));

  actions.append(theaterBtn, soundBtn, chatBtn, removeBtn);
  bar.append(name, actions);
  card.append(mount, bar);
  grid.appendChild(card);

  let player = null;
  if (window.Twitch && window.Twitch.Player) {
    player = new Twitch.Player(mount.id, {
      channel: login,
      width: "100%",
      height: "100%",
      muted: state.sound !== login,
      parent: parentHosts(),
      autoplay: true,
    });
  } else {
    const iframe = document.createElement("iframe");
    const params = new URLSearchParams({
      channel: login,
      muted: state.sound !== login ? "true" : "false",
    });
    parentHosts().forEach((p) => params.append("parent", p));
    iframe.src = `https://player.twitch.tv/?${params.toString()}`;
    iframe.allowFullscreen = true;
    iframe.setAttribute("allow", "autoplay; fullscreen");
    iframe.title = `Stream ${displayName(login)}`;
    mount.appendChild(iframe);
  }

  players.set(login, { card, player });
}

function syncPlayers() {
  for (const login of [...players.keys()]) {
    if (!state.channels.includes(login)) {
      players.get(login).card.remove();
      players.delete(login);
    }
  }

  state.channels.forEach((login) => {
    if (!players.has(login)) createPlayer(login);
    const { card } = players.get(login);
    card.classList.toggle("theater", state.theater === login);
    const theaterBtn = card.querySelector(".theater-btn");
    if (theaterBtn) theaterBtn.textContent = state.theater === login ? "Grille" : "Théâtre";
    grid.appendChild(card);
  });

  grid.dataset.layout = state.theater ? "theater" : "grid";
  applySound();
}

function renderCatalog() {
  const q = catalogSearch.value.trim().toLowerCase();
  catalogList.innerHTML = "";
  ZEVENT_STREAMERS.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || s.login.includes(q)
  ).forEach((s) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip${state.channels.includes(s.login) ? " on" : ""}`;
    btn.textContent = s.name;
    btn.addEventListener("click", () => {
      if (state.channels.includes(s.login)) removeChannel(s.login);
      else addChannel(s.login);
    });
    catalogList.appendChild(btn);
  });
}

function updateChrome() {
  document.body.classList.toggle("has-streams", state.channels.length > 0);
  catalog.hidden = !state.catalogOpen;
  toggleCatalog.setAttribute("aria-expanded", String(state.catalogOpen));
  toggleCatalog.classList.toggle("active", state.catalogOpen);
  exitTheater.hidden = !state.theater;

  const open = state.chats.length > 0;
  chatPanel.hidden = !open;
  chatPanel.classList.toggle("is-open", open);
  document.body.classList.toggle("has-chat", open);
  toggleChat.setAttribute("aria-pressed", String(open));
  applyChatWidth();
  positionChatDock();

  if (open) {
    const shown = visibleChats();
    chatSplitBtn.hidden = state.chats.length < 2;
    chatSplitBtn.textContent = state.chatSplit ? "1 chat" : "2 chats";
    chatSplitBtn.classList.toggle("on", state.chatSplit);
    chatBodies.classList.toggle("split", shown.length > 1);

    chatTabs.innerHTML = "";
    state.chats.forEach((login) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `chat-tab${state.chatActive === login ? " active" : ""}`;
      tab.innerHTML = `<span>${displayName(login)}</span>`;
      tab.addEventListener("click", () => {
        state.chatActive = login;
        saveState();
        updateChrome();
      });
      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×";
      close.title = "Fermer";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        closeChatTab(login);
      });
      tab.appendChild(close);
      chatTabs.appendChild(tab);
    });

    [...chatBodies.querySelectorAll(".chat-pane")].forEach((pane) => {
      if (!state.chats.includes(pane.dataset.channel)) pane.remove();
    });

    state.chats.forEach((login) => {
      let pane = chatBodies.querySelector(`[data-channel="${login}"]`);
      if (!pane) {
        pane = document.createElement("div");
        pane.className = "chat-pane";
        pane.dataset.channel = login;
        const frame = document.createElement("iframe");
        frame.title = `Chat ${displayName(login)}`;
        frame.src = chatSrc(login);
        pane.appendChild(frame);
        chatBodies.appendChild(pane);
      }
      pane.classList.toggle("visible", shown.includes(login));
    });

    shown.forEach((login) => {
      const pane = chatBodies.querySelector(`[data-channel="${login}"]`);
      if (pane) chatBodies.appendChild(pane);
    });
  } else {
    chatBodies.innerHTML = "";
    chatTabs.innerHTML = "";
  }

  renderCatalog();
}

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  addChannel(channelInput.value);
  channelInput.value = "";
});

toggleCatalog.addEventListener("click", () => {
  state.catalogOpen = !state.catalogOpen;
  saveState();
  updateChrome();
});

catalogSearch.addEventListener("input", renderCatalog);
toggleChat.addEventListener("click", () => {
  if (state.chats.length) setChat(false);
});
closeChat.addEventListener("click", () => setChat(false));
chatSplitBtn.addEventListener("click", () => {
  state.chatSplit = !state.chatSplit;
  saveState();
  updateChrome();
});
exitTheater.addEventListener("click", clearTheater);

chatResize.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startW = state.chatWidth || 380;
  const move = (ev) => {
    state.chatWidth = Math.min(CHAT_MAX, Math.max(CHAT_MIN, startW + (startX - ev.clientX)));
    applyChatWidth();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    saveState();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
});

window.addEventListener("resize", positionChatDock);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.theater) clearTheater();
    else if (state.chats.length) setChat(false);
  }
});

if (window.location.protocol === "file:") {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<p class="hint" style="padding:12px 18px;color:#ffe14a">Ouvre le site via <code>lancer.bat</code> (http://localhost:5173). Twitch bloque les players en fichier local.</p>`
  );
}

function boot() {
  syncPlayers();
  updateChrome();
}

if (window.Twitch && window.Twitch.Player) boot();
else window.addEventListener("load", boot);
