const $ = (id) => document.getElementById(id);
const COLORS = { a: "#5865f2", b: "#23a559" };

const S = {
  profiles: [], houses: [], house: null, a: "", b: "", running: false, active: null, status: {}, series: [],
  game: null, avg: {}, prefs: { game: true, extraGames: [], maxMb: 50 }, storage: null,
};
const cur = () => S.houses.find((h) => h.id === S.house) || null;
const f1 = (v) => (v === null || v === undefined ? "n/a" : v.toFixed(1));
function gameRank(a) {
  const lat = a.latency === null ? 500 : a.latency;
  const speed = a.mbps === null ? 1 : Math.max(0.1, Math.min(1, a.mbps / 10));
  return ((1 - Math.min(1, a.loss * 4)) * 1000 * speed) / (lat + 10);
}
function mb(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

const BOT_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.8 12.6a9.3 9.3 0 0 1 12.4 0"/><path d="M9.1 16.1a4.6 4.6 0 0 1 5.8 0"/><circle cx="12" cy="19.6" r="1" fill="#fff"/></svg>';

function short(name) {
  if (!name) return "?";
  const w = name.replace(/[^A-Za-z0-9 ]/g, "").trim();
  return (w.slice(0, 2) || "?").toUpperCase();
}

function fillSelect(sel, value) {
  sel.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Choose a network";
  sel.appendChild(none);
  for (const p of S.profiles) {
    const o = document.createElement("option");
    o.value = p;
    o.textContent = p;
    sel.appendChild(o);
  }
  sel.value = S.profiles.includes(value) ? value : "";
}

function addMessage(e) {
  const feed = $("feed");
  const empty = feed.querySelector(".empty");
  if (empty) empty.remove();
  const m = document.createElement("div");
  m.className = "msg";
  const t = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  m.innerHTML = '<div class="av">' + BOT_SVG + '</div><div class="msg-body"><b>Switcheroo</b><time></time><p></p></div>';
  m.querySelector("time").textContent = t;
  m.querySelector("p").textContent = e.text;
  const stick = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
  feed.appendChild(m);
  while (feed.children.length > 150) feed.removeChild(feed.firstChild);
  if (stick) feed.scrollTop = feed.scrollHeight;
}

function netInfo(slot) {
  const name = S[slot];
  const st = name && S.status[name];
  return { name, st };
}

function render() {
  const h = cur();
  S.a = h ? h.a : "";
  S.b = h ? h.b : "";
  renderHouses();
  for (const slot of ["a", "b"]) {
    const { name, st } = netInfo(slot);
    const U = slot.toUpperCase();
    $("name" + U).textContent = name || "Not set";
    $("leg" + U).textContent = name || U;
    const av = name && S.avg[name];
    $("sub" + U).textContent = av
      ? `avg ${av.mbps === null ? "n/a" : av.mbps.toFixed(1) + " Mbps"}, ${av.latency === null ? "n/a" : Math.round(av.latency) + " ms"}`
      : st && st.m.mbps != null
      ? `${st.m.mbps.toFixed(1)} Mbps, ${st.m.latency === null ? "n/a" : Math.round(st.m.latency) + " ms"}`
      : "no data yet";
    const isActive = S.running && name && name === S.active;
    $("badge" + U).hidden = !isActive;
    $("net" + U).classList.toggle("active", !!isActive);
  }

  const live = S.active && S.status[S.active];
  $("stSpeed").textContent = live && live.m.mbps != null ? live.m.mbps.toFixed(1) : "--";
  $("stLat").textContent = live && live.m.latency !== null ? Math.round(live.m.latency) : "--";
  $("stLoss").textContent = live ? Math.round(live.m.loss * 100) : "--";
  $("stSig").textContent = live && live.signal !== null ? live.signal : "--";
  $("stJit").textContent = live && live.m.jitter != null ? live.m.jitter.toFixed(1) : "--";
  const lk = (live && live.link) || {};
  $("stLink").textContent = lk.rx != null ? Math.round(lk.rx) : "--";
  $("stCh").textContent = lk.channel != null ? lk.channel : "--";
  $("stRadio").textContent = lk.radio || "";

  const btn = $("toggle");
  btn.textContent = S.running ? "Stop switching" : "Start switching";
  btn.classList.toggle("stop", S.running);
  $("presence").classList.toggle("on", S.running);
  $("stateTitle").textContent = S.running ? "Switching" : "Paused";
  $("stateSub").textContent = S.running ? (S.active ? "On " + S.active : "Connecting...") : "Not switching";
  $("topic").textContent = S.running
    ? `Watching ${S.a} and ${S.b}. Currently on ${S.active || "..."}.`
    : "Pick two networks and press Start";
  $("gamePill").hidden = !S.game;
  if (S.game) $("gamePill").textContent = "GAME MODE";
  $("houseTitle").textContent = (cur() && cur().name) || "Switcheroo";
  $("delHouse").hidden = !cur();
  $("houseName").disabled = S.running;
  $("selA").disabled = S.running;
  $("selB").disabled = S.running;
  drawChart();
}

function drawChart() {
  const c = $("chart");
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);

  const pts = S.series.slice(-40);
  const max = Math.max(10, ...pts.map((p) => p.score)) * 1.15;
  g.strokeStyle = "#3f4147";
  g.lineWidth = 1;
  g.fillStyle = "#949ba4";
  g.font = "11px Segoe UI, sans-serif";
  for (let i = 0; i <= 3; i++) {
    const y = 8 + ((h - 24) * i) / 3;
    g.beginPath();
    g.moveTo(34, y);
    g.lineTo(w, y);
    g.stroke();
    g.fillText(String(Math.round(max * (1 - i / 3))), 0, y + 4);
  }
  if (!pts.length) {
    g.fillStyle = "#949ba4";
    g.textAlign = "center";
    g.fillText("Waiting for the first measurement...", w / 2, h / 2);
    g.textAlign = "left";
    return;
  }
  const x = (i) => 34 + ((w - 40) * i) / Math.max(1, pts.length - 1);
  const y = (v) => 8 + (h - 24) * (1 - v / max);
  for (const slot of ["a", "b"]) {
    const name = S[slot];
    if (!name) continue;
    g.strokeStyle = COLORS[slot];
    g.fillStyle = COLORS[slot];
    g.lineWidth = 2;
    let started = false;
    let last = null;
    g.beginPath();
    pts.forEach((p, i) => {
      if (p.net !== name) return;
      if (!started) {
        g.moveTo(x(i), y(p.score));
        started = true;
      } else g.lineTo(x(i), y(p.score));
      last = [x(i), y(p.score)];
    });
    g.stroke();
    pts.forEach((p, i) => {
      if (p.net !== name) return;
      g.beginPath();
      g.arc(x(i), y(p.score), 3, 0, Math.PI * 2);
      g.fill();
    });
  }
}

function renderHouses() {
  const box = $("railHouses");
  box.innerHTML = "";
  for (const h of S.houses) {
    const b = document.createElement("button");
    b.className = "rail-net" + (h.id === S.house ? " on" : "");
    b.textContent = short(h.name);
    b.title = h.name;
    b.onclick = () => window.api.selectHouse(h.id);
    box.appendChild(b);
  }
}

async function saveHouse(patch) {
  const h = cur() || { name: "Home", a: "", b: "" };
  const id = await window.api.saveHouse({ ...h, ...patch });
  S.house = id;
}

async function start() {
  $("hint").textContent = "";
  const h = cur();
  if (!h || !h.a || !h.b) return ($("hint").textContent = "Choose both networks first.");
  if (h.a === h.b) return ($("hint").textContent = "Pick two different networks.");
  await window.api.start();
}

async function loadAvg() {
  S.avg = (await window.api.averages("all")) || {};
  renderAvg();
  render();
}

const AVG_ROWS = [
  { label: "Samples", get: (v) => v.n, fmt: (x) => String(x) },
  { label: "Average speed", get: (v) => v.mbps, fmt: (x) => x.toFixed(1) + " Mbps", best: "high" },
  { label: "Best speed", get: (v) => v.topMbps, fmt: (x) => x.toFixed(1) + " Mbps", best: "high" },
  { label: "Worst speed", get: (v) => v.lowMbps, fmt: (x) => x.toFixed(1) + " Mbps", best: "high" },
  { label: "Average latency", get: (v) => v.latency, fmt: (x) => Math.round(x) + " ms", best: "low" },
  { label: "Slowest ping", get: (v) => v.peakLat, fmt: (x) => Math.round(x) + " ms", best: "low" },
  { label: "Jitter", get: (v) => v.jitter, fmt: (x) => x.toFixed(1) + " ms", best: "low" },
  { label: "Packet loss", get: (v) => v.loss, fmt: (x) => (x * 100).toFixed(1) + " %", best: "low" },
  { label: "Signal", get: (v) => v.signal, fmt: (x) => Math.round(x) + " %", best: "high" },
  { label: "Link speed", get: (v) => v.linkRate, fmt: (x) => Math.round(x) + " Mbps", best: "high" },
  { label: "Seen on 5 GHz", get: (v) => v.band5, fmt: (x) => Math.round(x * 100) + " %" },
  { label: "Failed to join", get: (v) => v.fails, fmt: (x) => String(x), best: "low" },
  { label: "Game rank", get: (v) => gameRank(v), fmt: (x) => x.toFixed(1), best: "high" },
];

async function renderAvg() {
  const range = $("range").value;
  const data = range === "all" ? S.avg : (await window.api.averages(range)) || {};
  const nets = [S.a, S.b].filter(Boolean);
  const head = $("avgHead");
  head.innerHTML = "";
  const hr = document.createElement("tr");
  for (const t of ["", ...nets]) {
    const th = document.createElement("th");
    th.textContent = t;
    hr.appendChild(th);
  }
  head.appendChild(hr);
  const body = $("avgBody");
  body.innerHTML = "";
  for (const row of AVG_ROWS) {
    const vals = nets.map((n) => {
      const v = data[n];
      const x = v ? row.get(v) : null;
      return x === null || x === undefined || Number.isNaN(x) ? null : x;
    });
    const real = vals.filter((x) => x !== null);
    const target = row.best && real.length > 1 ? (row.best === "high" ? Math.max(...real) : Math.min(...real)) : null;
    const tr = document.createElement("tr");
    const lab = document.createElement("td");
    lab.textContent = row.label;
    tr.appendChild(lab);
    vals.forEach((x) => {
      const td = document.createElement("td");
      td.textContent = x === null ? "no data" : row.fmt(x);
      if (target !== null && x === target && real.some((y) => y !== target)) td.className = "best";
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
  $("avgNote").textContent = nets.length
    ? "Green marks the better network. Game rank favours low latency and no packet loss, and is what game mode uses."
    : "Pick two networks to see their averages.";
}

function renderSettings() {
  $("gameOn").checked = !!S.prefs.game;
  $("autoDetect").checked = S.prefs.autoDetect !== false;
  if (document.activeElement !== $("extraGames")) $("extraGames").value = (S.prefs.extraGames || []).join(", ");
  $("maxMb").value = String(S.prefs.maxMb);
  const st = S.storage;
  if (st) {
    $("dataPath").textContent = st.dir;
    $("dataBar").style.width = Math.min(100, (st.size / st.max) * 100) + "%";
    $("dataText").textContent = `${mb(st.size)} used of ${mb(st.max)}`;
  }
}

function renderUpdate(u) {
  if (!u) return;
  const cur = "Version " + (u.current || "?");
  const text = {
    idle: cur,
    dev: cur + ". " + u.message,
    checking: cur + ". Checking for updates...",
    latest: cur + ". " + u.message,
    downloading: cur + `. Downloading ${u.version}, ${u.percent}%`,
    ready: cur + `. Version ${u.version} is ready.`,
    error: cur + ". " + u.message,
  }[u.state];
  $("updText").textContent = text || cur;
  $("verText").textContent = cur;
  $("updBarWrap").hidden = u.state !== "downloading";
  $("updBar").style.width = (u.percent || 0) + "%";
  $("updInstall").hidden = u.state !== "ready";
  $("updCheck").disabled = ["checking", "downloading", "ready", "dev"].includes(u.state);
}

function setTab(t) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  for (const id of ["live", "avg"]) $("pane-" + id).hidden = id !== t;
  if (t === "live") drawChart();
  if (t === "avg") renderAvg();
}

function openModal(sec) {
  $("modal").hidden = false;
  $("openSettings").classList.add("on");
  showSection(sec || "general");
  window.api.storage().then((s) => ((S.storage = s), renderSettings()));
  renderSettings();
}
function closeModal() {
  $("modal").hidden = true;
  $("openSettings").classList.remove("on");
}
function showSection(sec) {
  document.querySelectorAll(".mnav").forEach((b) => b.classList.toggle("on", b.dataset.sec === sec));
  document.querySelectorAll(".sec").forEach((s) => (s.hidden = s.id !== "sec-" + sec));
}

function applyState(st) {
  Object.assign(S, {
    houses: st.houses,
    house: st.house,
    running: st.running,
    active: st.active,
    status: st.status || {},
    series: st.series || [],
    game: st.game,
    prefs: st.prefs,
    storage: st.storage,
  });
}

async function init() {
  const st = await window.api.state();
  S.profiles = st.profiles;
  applyState(st);
  fillSelect($("selA"), (cur() || {}).a);
  fillSelect($("selB"), (cur() || {}).b);
  $("houseName").value = (cur() || {}).name || "";
  $("autostart2").checked = !!st.autostart;
  $("feed").innerHTML = '<div class="empty">Nothing yet. Start switching and updates show up here.</div>';
  (st.logs || []).forEach(addMessage);
  render();
  renderSettings();
  loadAvg();

  const syncSetup = () => {
    fillSelect($("selA"), (cur() || {}).a);
    fillSelect($("selB"), (cur() || {}).b);
    $("houseName").value = (cur() || {}).name || "";
  };

  $("selA").onchange = () => saveHouse({ a: $("selA").value });
  $("selB").onchange = () => saveHouse({ b: $("selB").value });
  $("houseName").onchange = () => saveHouse({ name: $("houseName").value.trim() || "Home" });
  $("addHouse").onclick = async () => {
    const id = await window.api.saveHouse({ name: "House " + (S.houses.length + 1), a: "", b: "" });
    S.house = id;
  };
  $("delHouse").onclick = () => {
    const h = cur();
    if (h && $("delHouse").dataset.arm === h.id) {
      $("delHouse").dataset.arm = "";
      $("delHouse").textContent = "Delete household";
      window.api.deleteHouse(h.id);
    } else if (h) {
      $("delHouse").dataset.arm = h.id;
      $("delHouse").textContent = "Click again to delete";
      setTimeout(() => {
        $("delHouse").dataset.arm = "";
        $("delHouse").textContent = "Delete household";
      }, 4000);
    }
  };
  $("toggle").onclick = () => (S.running ? window.api.stop() : start());
  $("refresh").onclick = async () => {
    S.profiles = await window.api.profiles();
    fillSelect($("selA"), $("selA").value);
    fillSelect($("selB"), $("selB").value);
  };
  document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  $("openSettings").onclick = () => ($("modal").hidden ? openModal() : closeModal());
  $("modalX").onclick = closeModal;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("modal").hidden) closeModal();
  });
  document.querySelectorAll(".mnav").forEach((b) => (b.onclick = () => showSection(b.dataset.sec)));
  $("scanGames").onclick = async () => {
    $("scanNote").textContent = "Scanning...";
    $("scanList").innerHTML = "";
    const r = await window.api.scanGames();
    if (r.error) return ($("scanNote").textContent = "Could not list running programs: " + r.error);
    const lines = [`Saw ${r.count} running programs.`];
    lines.push(r.found ? `Game found: ${r.found}.` : "No game found.");
    if (!r.enabled) lines.push("Game mode is switched off above.");
    else if (!r.running) lines.push("Switching is stopped, so game mode is idle. Press Start switching.");
    $("scanNote").textContent = lines.join(" ");
    if (!r.found && r.top.length) {
      const label = document.createElement("p");
      label.className = "note";
      label.textContent = "Biggest programs right now. Click your game to add it:";
      $("scanList").appendChild(label);
      for (const p of r.top) {
        const b = document.createElement("button");
        b.className = "btn chip";
        b.textContent = `${p.name} (${p.mb} MB)`;
        b.onclick = async () => {
          const list = (S.prefs.extraGames || []).filter((x) => x.toLowerCase() !== p.name.toLowerCase());
          list.push(p.name);
          S.prefs = await window.api.setPrefs({ extraGames: list });
          renderSettings();
          b.textContent = "Added " + p.name;
          b.disabled = true;
        };
        $("scanList").appendChild(b);
      }
    }
  };
  $("autoDetect").onchange = async (e) => ((S.prefs = await window.api.setPrefs({ autoDetect: e.target.checked })), renderSettings());
  $("detectNow").onclick = async () => {
    $("detectNote").textContent = "Looking...";
    const r = await window.api.detectHouse();
    $("detectNote").textContent = r.ok ? `Added ${r.name}: ${r.a} and ${r.b}.` : r.message;
  };
  $("autostart2").onchange = async (e) => {
    e.target.checked = await window.api.setAutostart(e.target.checked);
  };
  $("updCheck").onclick = () => window.api.checkUpdate();
  $("updInstall").onclick = () => window.api.installUpdate();
  window.api.updateState().then(renderUpdate);
  window.api.on("update", renderUpdate);
  $("range").onchange = renderAvg;
  $("gameOn").onchange = async (e) => ((S.prefs = await window.api.setPrefs({ game: e.target.checked })), renderSettings());
  $("extraGames").onchange = async (e) => {
    const list = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
    S.prefs = await window.api.setPrefs({ extraGames: list });
  };
  $("maxMb").onchange = async (e) => {
    S.prefs = await window.api.setPrefs({ maxMb: Number(e.target.value) });
    S.storage = await window.api.storage();
    renderSettings();
  };
  $("openData").onclick = () => window.api.openData();
  $("chooseData").onclick = async () => ((S.storage = await window.api.chooseData()), renderSettings());
  window.addEventListener("resize", drawChart);

  let lastAvg = 0;
  window.api.on("log", addMessage);
  window.api.on("running", (r) => {
    S.running = r;
    if (!r) {
      S.active = null;
      S.game = null;
    }
    render();
  });
  window.api.on("active", (n) => {
    S.active = n;
    render();
  });
  window.api.on("game", (g) => {
    S.game = g;
    render();
  });
  window.api.on("houses", async (p) => {
    S.houses = p.houses;
    S.house = p.house;
    S.status = {};
    S.series = [];
    S.active = null;
    S.running = (await window.api.state()).running;
    syncSetup();
    render();
    loadAvg();
  });
  window.api.on("status", (s) => {
    S.status[s.net] = s;
    if (s.m.score != null) S.series.push({ net: s.net, score: s.m.score, ts: s.ts });
    if (S.series.length > 120) S.series.shift();
    render();
    if (Date.now() - lastAvg > 30000) {
      lastAvg = Date.now();
      loadAvg();
    }
  });
  window.api.on("autostart", (v) => ($("autostart2").checked = v));
}

init();
