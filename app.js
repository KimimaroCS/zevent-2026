const STORAGE_KEY = "zevent-multiview-v2";
const CHAT_MIN = 300;
const CHAT_MAX = 640;
const LIVE_POLL_MS = 60000;
const MAX_AUTO_ADD_DESKTOP = 8;
const TWITCH_GQL = "https://gql.twitch.tv/gql";
const TWITCH_WEB_CLIENT = "kimne78kx3ncx6brgo4mv6wki5h1ko";

const grid = document.getElementById("grid");
const addForm = document.getElementById("add-form");
const channelInput = document.getElementById("channel-input");
const catalog = document.getElementById("catalog");
const catalogList = document.getElementById("catalog-list");
const catalogSearch = document.getElementById("catalog-search");
const catalogStatus = document.getElementById("catalog-status");
const filterAll = document.getElementById("filter-all");
const filterLive = document.getElementById("filter-live");
const addLivesBtn = document.getElementById("add-lives");
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
const twitchLoginBtn = document.getElementById("twitch-login-btn");
const twitchLoginDialog = document.getElementById("twitch-login-dialog");
const twitchLoginMount = document.getElementById("twitch-login-mount");
const twitchLoginPopup = document.getElementById("twitch-login-popup");
const twitchLoginReload = document.getElementById("twitch-login-reload");

const players = new Map();
const liveByLogin = new Map();
const state = loadState();
let catalogLiveOnly = false;
let liveFetchOk = true;

function isPhone() {
  return window.matchMedia("(max-width: 720px)").matches;
}

function isCompact() {
  return window.matchMedia("(max-width: 1180px)").matches;
}

function maxAutoAdd() {
  if (isPhone()) return 2;
  if (isCompact() || window.matchMedia("(pointer: coarse)").matches) return 4;
  return MAX_AUTO_ADD_DESKTOP;
}

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
          soundOn: false,
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
    soundOn: false,
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
  const live = liveByLogin.get(login);
  if (live?.displayName) return live.displayName;
  const known = ZEVENT_STREAMERS.find((s) => s.login === login);
  return known ? known.name : login;
}

function isLive(login) {
  return Boolean(liveByLogin.get(login)?.live);
}

function formatViewers(n) {
  if (n < 1000) return String(n);
  const rounded = n >= 10000 ? (n / 1000).toFixed(0) : (n / 1000).toFixed(1);
  return `${rounded.replace(".", ",")} k`;
}

function liveLogins() {
  return [...liveByLogin.entries()]
    .filter(([, info]) => info.live)
    .sort((a, b) => b[1].viewers - a[1].viewers)
    .map(([login]) => login);
}

async function fetchLiveChunk(logins) {
  const query = `query { users(logins: ${JSON.stringify(logins)}) { login displayName stream { title viewersCount } } }`;
  const res = await fetch(TWITCH_GQL, {
    method: "POST",
    headers: {
      "Client-ID": TWITCH_WEB_CLIENT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`gql ${res.status}`);
  const json = await res.json();
  for (const user of json.data?.users || []) {
    if (!user?.login) continue;
    liveByLogin.set(user.login.toLowerCase(), {
      displayName: user.displayName || user.login,
      live: Boolean(user.stream),
      title: user.stream?.title || "",
      viewers: Number(user.stream?.viewersCount) || 0,
    });
  }
}

async function refreshLiveStatus() {
  const extras = state.channels.filter((login) => !ZEVENT_STREAMERS.some((s) => s.login === login));
  const all = [...new Set([...ZEVENT_STREAMERS.map((s) => s.login), ...extras])];
  try {
    for (let i = 0; i < all.length; i += 30) {
      await fetchLiveChunk(all.slice(i, i + 30));
    }
    liveFetchOk = true;
  } catch {
    liveFetchOk = false;
  }
  renderCatalog();
  updatePlayerLiveBadges();
}

function addTopLives() {
  const room = Math.max(0, maxAutoAdd() - state.channels.length);
  if (!room) return;
  let added = 0;
  for (const login of liveLogins()) {
    if (added >= room) break;
    if (state.channels.includes(login)) continue;
    state.channels.push(login);
    if (!state.sound) state.sound = login;
    if (!state.chatActive) state.chatActive = login;
    added += 1;
  }
  if (!added) return;
  saveState();
  syncPlayers();
  updateChrome();
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
  if (state.theater) {
    state.sound = login;
    state.soundOn = true;
  }
  saveState();
  syncPlayers();
  applySound({ userGesture: Boolean(state.theater), target: state.theater });
  updateChrome();
}

function clearTheater() {
  state.theater = null;
  saveState();
  syncPlayers();
  updateChrome();
}

function setSound(login) {
  const turnOff = state.soundOn && state.sound === login;
  state.sound = login;
  state.soundOn = !turnOff;
  saveState();
  applySound({ userGesture: true, target: login });
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
  if (isPhone() || !state.chatSplit || state.chats.length < 2) {
    return [state.chatActive || state.chats[0]];
  }
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
  if (!chatPanel) return;
  if (isCompact()) {
    chatPanel.style.top = "";
    return;
  }
  if (!topbar) return;
  let top = topbar.getBoundingClientRect().bottom;
  if (catalog && !catalog.hidden) top = catalog.getBoundingClientRect().bottom;
  chatPanel.style.top = `${Math.max(0, top)}px`;
}

function playerSrc(login, muted) {
  const params = new URLSearchParams({
    channel: login,
    muted: muted ? "true" : "false",
    autoplay: "true",
  });
  parentHosts().forEach((p) => params.append("parent", p));
  return `https://player.twitch.tv/?${params.toString()}`;
}

function iframeIsMuted(iframe) {
  try {
    return new URL(iframe.src).searchParams.get("muted") !== "false";
  } catch {
    return true;
  }
}

function configureIframe(iframe, title) {
  iframe.setAttribute(
    "allow",
    "autoplay; fullscreen; picture-in-picture; encrypted-media; playsinline; storage-access *"
  );
  iframe.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media; playsinline; storage-access *";
  iframe.allowFullscreen = true;
  iframe.setAttribute("allowfullscreen", "true");
  iframe.setAttribute("webkitallowfullscreen", "true");
  iframe.setAttribute("playsinline", "true");
  iframe.setAttribute("webkit-playsinline", "true");
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.title = title;
}

function mountPlayer(mount, login, muted) {
  mount.replaceChildren();
  const iframe = document.createElement("iframe");
  configureIframe(iframe, `Stream ${displayName(login)}`);
  mount.appendChild(iframe);
  iframe.src = playerSrc(login, muted);
  return iframe;
}

function remountAllTwitchFrames() {
  players.forEach((entry, login) => {
    const mount = entry.card.querySelector(".twitch-mount");
    const iframe = mount?.querySelector("iframe");
    const muted = !iframe || iframeIsMuted(iframe);
    if (mount) mountPlayer(mount, login, muted);
  });
  chatBodies.querySelectorAll(".chat-pane").forEach((pane) => {
    const login = pane.dataset.channel;
    const frame = pane.querySelector("iframe");
    if (login && frame) frame.src = chatSrc(login);
  });
  mountLoginPreview();
}

function loginPreviewChannel() {
  return (
    state.channels.find((login) => isLive(login)) ||
    state.channels[0] ||
    ZEVENT_STREAMERS[0]?.login ||
    "twitch"
  );
}

function mountLoginPreview() {
  if (!twitchLoginMount) return;
  const login = loginPreviewChannel();
  mountPlayer(twitchLoginMount, login, true);
}

function openTwitchLoginPopup(e) {
  e?.preventDefault();
  const url = "https://www.twitch.tv/login";
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) window.location.assign(url);
}

function openTwitchLoginDialog() {
  if (!twitchLoginDialog) return;
  mountLoginPreview();
  if (typeof twitchLoginDialog.showModal === "function") twitchLoginDialog.showModal();
  else twitchLoginDialog.setAttribute("open", "");
}

function applySound({ userGesture = false, target = null } = {}) {
  players.forEach((entry, login) => {
    const isOn = Boolean(state.soundOn && state.sound === login);
    const mount = entry.card.querySelector(".twitch-mount");
    const iframe = mount.querySelector("iframe");
    const alreadyMuted = !iframe || iframeIsMuted(iframe);

    if (userGesture && login === target) {
      mountPlayer(mount, login, !isOn);
    } else if (!isOn && !alreadyMuted) {
      mountPlayer(mount, login, true);
    }

    const soundBtn = entry.card.querySelector(".sound");
    if (soundBtn) {
      soundBtn.classList.toggle("on", isOn);
      soundBtn.textContent = isOn ? "Son ON" : "Son";
      soundBtn.setAttribute("aria-pressed", String(isOn));
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

  const nameWrap = document.createElement("div");
  nameWrap.className = "player-id";

  const name = document.createElement("span");
  name.className = "player-name";
  name.textContent = displayName(login);

  const livePill = document.createElement("span");
  livePill.className = "live-pill";
  livePill.hidden = true;

  nameWrap.append(name, livePill);

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

  const openTwitch = document.createElement("a");
  openTwitch.className = "mini";
  openTwitch.href = `https://www.twitch.tv/${login}`;
  openTwitch.target = "_blank";
  openTwitch.rel = "noreferrer";
  openTwitch.textContent = "Twitch";
  openTwitch.title = "Ouvrir sur twitch.tv (sans pubs si le compte Turbo est connecté dans Safari)";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "mini danger";
  removeBtn.textContent = "Retirer";
  removeBtn.addEventListener("click", () => removeChannel(login));

  actions.append(theaterBtn, soundBtn, chatBtn, openTwitch, removeBtn);
  bar.append(nameWrap, actions);
  card.append(mount, bar);
  grid.appendChild(card);

  mountPlayer(mount, login, true);
  players.set(login, { card });
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
  updatePlayerLiveBadges();
}

function updatePlayerLiveBadges() {
  players.forEach((entry, login) => {
    const name = entry.card.querySelector(".player-name");
    const pill = entry.card.querySelector(".live-pill");
    const info = liveByLogin.get(login);
    if (name) name.textContent = displayName(login);
    if (!pill) return;
    if (info?.live) {
      pill.hidden = false;
      pill.textContent = `LIVE ${formatViewers(info.viewers)}`;
      pill.title = info.title || "";
    } else {
      pill.hidden = true;
      pill.textContent = "";
      pill.removeAttribute("title");
    }
  });
}

function renderCatalog() {
  const q = catalogSearch.value.trim().toLowerCase();
  const liveCount = liveLogins().length;
  if (catalogStatus) {
    if (!liveFetchOk) {
      catalogStatus.textContent = "Statut live indisponible — le catalogue reste utilisable.";
    } else if (!liveByLogin.size) {
      catalogStatus.textContent = "Chargement des lives…";
    } else {
      catalogStatus.textContent = `${liveCount} en live · ${ZEVENT_STREAMERS.length} streamers — clique pour ajouter.`;
    }
  }
  if (filterAll) filterAll.classList.toggle("on", !catalogLiveOnly);
  if (filterLive) {
    filterLive.classList.toggle("on", catalogLiveOnly);
    filterLive.textContent = liveByLogin.size ? `En live (${liveCount})` : "En live";
  }
  if (addLivesBtn) {
    const cap = maxAutoAdd();
    const room = Math.max(0, cap - state.channels.length);
    addLivesBtn.disabled = !liveCount || room === 0;
    addLivesBtn.textContent = room === 0 ? `Grille pleine (${cap})` : "Ajouter les plus gros";
  }

  const rows = ZEVENT_STREAMERS.filter((s) => {
    if (q && !s.name.toLowerCase().includes(q) && !s.login.includes(q)) return false;
    if (catalogLiveOnly && !isLive(s.login)) return false;
    return true;
  }).sort((a, b) => {
    const liveA = liveByLogin.get(a.login);
    const liveB = liveByLogin.get(b.login);
    const aOn = Boolean(liveA?.live);
    const bOn = Boolean(liveB?.live);
    if (aOn !== bOn) return aOn ? -1 : 1;
    if (aOn && bOn) return liveB.viewers - liveA.viewers;
    return displayName(a.login).localeCompare(displayName(b.login), "fr");
  });

  catalogList.innerHTML = "";
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "catalog-empty";
    empty.textContent = !liveByLogin.size
      ? "Chargement des lives…"
      : catalogLiveOnly
        ? "Personne en live pour ce filtre."
        : "Aucun streamer.";
    catalogList.appendChild(empty);
    return;
  }

  rows.forEach((s) => {
    const info = liveByLogin.get(s.login);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip${state.channels.includes(s.login) ? " on" : ""}${info?.live ? " live" : ""}`;
    if (info?.title) btn.title = info.title;
    const label = document.createElement("span");
    label.textContent = displayName(s.login);
    btn.appendChild(label);
    if (info?.live) {
      const viewers = document.createElement("span");
      viewers.className = "chip-viewers";
      viewers.textContent = formatViewers(info.viewers);
      btn.appendChild(viewers);
    }
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
    chatSplitBtn.hidden = isPhone() || state.chats.length < 2;
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
        configureIframe(frame, `Chat ${displayName(login)}`);
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
filterAll?.addEventListener("click", () => {
  catalogLiveOnly = false;
  renderCatalog();
});
filterLive?.addEventListener("click", () => {
  catalogLiveOnly = true;
  renderCatalog();
});
addLivesBtn?.addEventListener("click", addTopLives);
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
twitchLoginBtn?.addEventListener("click", openTwitchLoginDialog);
twitchLoginPopup?.addEventListener("click", openTwitchLoginPopup);
twitchLoginReload?.addEventListener("click", () => {
  remountAllTwitchFrames();
  twitchLoginDialog?.close();
});
twitchLoginDialog?.addEventListener("close", () => {
  twitchLoginMount?.replaceChildren();
});

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
window.addEventListener("orientationchange", () => {
  requestAnimationFrame(positionChatDock);
});
window.visualViewport?.addEventListener("resize", positionChatDock);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.theater) clearTheater();
    else if (state.chats.length) setChat(false);
  }
});

if (window.location.protocol === "file:") {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<p class="hint" style="padding:12px 18px;color:#00bd00">Ouvre le site via <code>lancer.bat</code> (http://localhost:5173). Twitch bloque les players en fichier local.</p>`
  );
}

function boot() {
  syncPlayers();
  updateChrome();
  refreshLiveStatus();
  setInterval(refreshLiveStatus, LIVE_POLL_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
