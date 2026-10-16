const $ = (id) => document.getElementById(id);
const COLORS = { a: "#3d87d6", b: "#ef4135" };

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

// Colour of an activity message: green when things worked, yellow when Switcheroo is checking or being careful, red when something failed.
function logLevel(text) {
  const t = String(text || "");
  if (/^Error|^Could not|did not come up|Lost internet|Left the selected networks|failed|could not/i.test(t)) return "bad";
  if (/^Not on a selected network|^Not enough history|^Testing |not clearly better|Returning to|Going back|Checking for/i.test(t)) return "warn";
  return "ok";
}

function addMessage(e) {
  const feed = $("feed");
  const empty = feed.querySelector(".empty");
  if (empty) empty.remove();
  const m = document.createElement("div");
  m.className = "msg " + logLevel(e.text);
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
  $("presence").classList.toggle("game", !!S.game);
  $("stateTitle").textContent = S.running ? "Switching" : "Paused";
  $("stateSub").textContent = S.running ? (S.active ? "On " + S.active : "Connecting...") : "Not switching";
  $("topic").textContent = S.running
    ? `Watching ${S.a} and ${S.b}. Currently on ${S.active || "..."}.`
    : "Pick two networks and press Start";
  const playing = !!(S.game && S.prefs.game);
  $("gameCard").classList.toggle("playing", playing);
  $("gameCard").classList.toggle("off", !S.prefs.game);
  $("gcLive").hidden = !playing;
  $("gcLabel").textContent = playing ? "Current game" : "Game mode";
  $("gcTitle").textContent = playing ? String(S.game) : S.prefs.game ? "No game running" : "Game mode is off";
  $("gcSub").textContent = playing
    ? `Staying on ${S.active || "your network"} and only pinging, so there is no extra lag.`
    : S.prefs.game
    ? (S.running ? "Watching for games. Open one and it shows up here." : "Press Start switching and Switcheroo watches for games.")
    : "Turn it on to move to the lower ping network when a game opens.";
  $("gcToggle").checked = !!S.prefs.game;
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
  try {
    const r = await window.api.start();
    if (r && r.ok === false && r.why) $("hint").textContent = r.why;
  } catch (e) {
    $("hint").textContent = "Could not start: " + (e.message || e);
  }
  S.running = (await window.api.state()).running;
  render();
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
  const raw = range === "all" ? S.avg : (await window.api.averages(range)) || {};
  fillAvg(raw, "avgHead", "avgBody", "avgNote", "Blue marks the better network. Game rank favours low latency and no packet loss.");
  const clean = (await window.api.cleanAverages(range)) || {};
  fillAvg(clean, "cleanAvgHead", "cleanAvgBody", "cleanAvgNote", "Preprocessed data: duplicates and impossible rows removed, outliers capped, then the networks are balanced only if the gap in samples is big. Game mode picks the network using these numbers.");
}

function setSub(t) {
  document.querySelectorAll(".sub").forEach((b) => b.classList.toggle("on", b.dataset.sub === t));
  for (const id of ["raw", "clean"]) $("sub-" + id).hidden = id !== t;
}

function fillAvg(data, headId, bodyId, noteId, note) {
  const nets = [S.a, S.b].filter(Boolean);
  const head = $(headId);
  head.innerHTML = "";
  const hr = document.createElement("tr");
  for (const t of ["", ...nets]) {
    const th = document.createElement("th");
    th.textContent = t;
    hr.appendChild(th);
  }
  head.appendChild(hr);
  const body = $(bodyId);
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
  $(noteId).textContent = nets.length ? note : "Pick two networks to see their averages.";
}

const CLEAN_ROWS = [
  ["Samples", (v) => String(v.n)],
  ["Average speed", (v) => (v.mbps === null ? "no data" : v.mbps.toFixed(1) + " Mbps")],
  ["Best speed", (v) => (v.topMbps === null ? "no data" : v.topMbps.toFixed(1) + " Mbps")],
  ["Worst speed", (v) => (v.lowMbps === null ? "no data" : v.lowMbps.toFixed(1) + " Mbps")],
  ["Average latency", (v) => (v.latency === null ? "no data" : Math.round(v.latency) + " ms")],
  ["Jitter", (v) => (v.jitter === null ? "no data" : v.jitter.toFixed(1) + " ms")],
  ["Packet loss", (v) => (v.loss === null ? "no data" : v.loss.toFixed(1) + " %")],
  ["Signal", (v) => (v.signal === null ? "no data" : Math.round(v.signal) + " %")],
  ["Failed to join", (v) => String(v.fails)],
];
async function renderClean(r) {
  if (!r) return;
  if (!r.ok) {
    $("cleanNote").textContent = r.error || "Something went wrong.";
    return;
  }
  const nets = r.networks;
  const head = $("cleanHead");
  head.innerHTML = "";
  const hr = document.createElement("tr");
  for (const t of [""].concat(...nets.map((n) => [n + " raw", n + " clean"]))) {
    const th = document.createElement("th");
    th.textContent = t;
    hr.appendChild(th);
  }
  head.appendChild(hr);
  const body = $("cleanBody");
  body.innerHTML = "";
  for (const [label, fmt] of CLEAN_ROWS) {
    const tr = document.createElement("tr");
    const lab = document.createElement("td");
    lab.textContent = label;
    tr.appendChild(lab);
    for (const n of nets) {
      for (const kind of ["raw", "clean"]) {
        const td = document.createElement("td");
        td.textContent = fmt(r[kind][n]);
        tr.appendChild(td);
      }
    }
    body.appendChild(tr);
  }
  $("cleanTable").hidden = false;
  const steps = $("cleanSteps");
  steps.innerHTML = "";
  for (const s of r.steps || []) {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = s.step + ". ";
    li.appendChild(b);
    li.appendChild(document.createTextNode(s.text.replace(/^\d+\.\s*/, "")));
    steps.appendChild(li);
  }
  const box = $("cleanGraphs");
  box.innerHTML = "";
  for (const g of r.graphs || []) {
    const src = await window.api.analysisImage(g);
    if (!src) continue;
    const img = document.createElement("img");
    img.src = src;
    img.alt = g.replace(".png", "").replace(/_/g, " ");
    box.appendChild(img);
  }
  $("openClean").hidden = false;
  const bal = r.balance || {};
  const what = { nothing: "nothing was added or removed, the gap is small", smote: "SMOTE added rows to the smaller network", smoteenn: "SMOTEENN was used, the gap is large" }[bal.action] || "";
  $("cleanNote").textContent = `${r.rawRows} raw rows, ${r.realRows} real rows left after cleaning, ${r.cleanRows} rows after the balancing step (${what}${bal.synthetic ? ", " + bal.synthetic + " new rows" : ""}). Files are in ${r.dir}: clean-samples.csv (final), clean-rows.csv (cleaned real rows) and the graphs.`;
}
async function runClean() {
  $("runClean").disabled = true;
  $("cleanNote").textContent = "Cleaning with Python, this takes a few seconds...";
  try {
    await renderClean(await window.api.runAnalysis());
  } catch (e) {
    $("cleanNote").textContent = "Could not run: " + (e.message || e);
  }
  $("runClean").disabled = false;
}

let lastCsv = null;
async function exportCsv() {
  const range = $("range").value;
  const data = range === "all" ? S.avg : (await window.api.averages(range)) || {};
  const nets = [S.a, S.b].filter(Boolean);
  if (!nets.length) return ($("csvNote").textContent = "Pick two networks first.");
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const raw = {
    "Samples": (v) => v.n, "Average speed (Mbps)": (v) => v.mbps, "Best speed (Mbps)": (v) => v.topMbps,
    "Worst speed (Mbps)": (v) => v.lowMbps, "Average latency (ms)": (v) => v.latency, "Slowest ping (ms)": (v) => v.peakLat,
    "Jitter (ms)": (v) => v.jitter, "Packet loss (%)": (v) => v.loss * 100, "Signal (%)": (v) => v.signal,
    "Link speed (Mbps)": (v) => v.linkRate, "Seen on 5 GHz (%)": (v) => v.band5 * 100, "Failed to join": (v) => v.fails,
    "Game rank": (v) => gameRank(v),
  };
  const num = (x) => (x === null || x === undefined || Number.isNaN(x) ? "" : String(Math.round(x * 100) / 100));
  const lines = [["Metric", ...nets].map(q).join(",")];
  for (const [label, get] of Object.entries(raw)) {
    lines.push([q(label), ...nets.map((n) => { try { return num(data[n] ? get(data[n]) : null); } catch { return ""; } })].join(","));
  }
  const r = await window.api.exportCsv(range, lines.join("\r\n") + "\r\n");
  lastCsv = r.ok ? r.file : null;
  $("csvNote").textContent = r.ok ? "Saved to " + r.file : "Could not save: " + r.error;
  $("revealCsv").hidden = !r.ok;
}

function renderSettings() {
  $("gameOn").checked = !!S.prefs.game;
  $("autoDetect").checked = S.prefs.autoDetect !== false;
  $("autoUpdate").checked = S.prefs.autoUpdate !== false;
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
  for (const id of ["live", "avg", "py"]) $("pane-" + id).hidden = id !== t;
  if (t === "live") drawChart();
  if (t === "avg") renderAvg();
  if (t === "py") pyOpen();
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
  document.querySelectorAll(".sub").forEach((b) => (b.onclick = () => setSub(b.dataset.sub)));
  pyWire();
  rooWire();
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
  $("autoUpdate").onchange = async (e) => ((S.prefs = await window.api.setPrefs({ autoUpdate: e.target.checked })), renderSettings());
  $("exportCsv").onclick = exportCsv;
  $("runClean").onclick = runClean;
  $("openClean").onclick = () => window.api.openAnalysis();
  window.api.lastAnalysis().then((r) => r && r.ok && renderClean(r));
  $("exportRaw").onclick = async () => {
    $("csvNote").textContent = "Saving...";
    const r = await window.api.exportRaw();
    lastCsv = r.ok ? r.file : null;
    $("csvNote").textContent = r.ok ? `Saved ${r.rows} rows to ${r.file}` : "Could not save: " + r.error;
    $("revealCsv").hidden = !r.ok;
  };
  $("revealCsv").onclick = () => lastCsv && window.api.revealFile(lastCsv);
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
  $("gcToggle").onchange = async (e) => ((S.prefs = await window.api.setPrefs({ game: e.target.checked })), renderSettings(), render());
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
    if (r && !S.running) rooDo("roo-thumb");
    S.running = r;
    if (!r) {
      S.active = null;
      S.game = null;
    }
    render();
  });
  window.api.on("active", (n) => {
    if (S.active && n !== S.active) rooDo("roo-hop");
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


// ---------------------------------------------------------------- Python tab: notebook and small terminal
const PY_START = [
  '# raw and clean are pandas tables of your saved measurements. Press Refresh data to read the newest ones.\nraw.groupby("network")[["mbps", "latency_ms"]].median()',
  '# clean is the preprocessed data, balanced only when the gap between the networks is big (see clean_info)\nfor n, g in clean.groupby("network"):\n    plt.plot(g["time"], g["mbps"], label=n)\nplt.legend()\nplt.ylabel("Mbps")',
];
let pyCells = [];
let pyReady = false;
let pyLoaded = false;
let pySaveTimer = null;

function pySave() {
  clearTimeout(pySaveTimer);
  pySaveTimer = setTimeout(() => window.api.pySave(pyCells.map((c) => ({ code: c.code }))), 400);
}

function pyShow(box, r) {
  box.innerHTML = "";
  if (!r) return;
  if (r.out) {
    const pre = document.createElement("pre");
    pre.textContent = r.out;
    box.appendChild(pre);
  }
  if (r.err) {
    const pre = document.createElement("pre");
    pre.className = "err";
    pre.textContent = r.err;
    box.appendChild(pre);
  }
  for (const b of r.images || []) {
    const img = document.createElement("img");
    img.src = "data:image/png;base64," + b;
    box.appendChild(img);
  }
}

async function pyRunCell(c) {
  if (!pyReady) {
    pyShow(c.outBox, { err: "Python is not set up yet. Press Set up Python at the top." });
    return;
  }
  c.runBtn.disabled = true;
  c.runBtn.textContent = "Running...";
  c.outBox.innerHTML = "";
  try {
    pyShow(c.outBox, await window.api.pyRun(c.code));
  } catch (e) {
    pyShow(c.outBox, { err: String(e.message || e) });
  }
  c.runBtn.disabled = false;
  c.runBtn.textContent = "Run";
}

function pyMakeCell(code, after) {
  const c = { code };
  const el = document.createElement("div");
  el.className = "pycell";
  const ta = document.createElement("textarea");
  ta.spellcheck = false;
  ta.value = code;
  ta.rows = Math.max(2, code.split("\n").length);
  const fit = () => {
    ta.style.height = "auto";
    ta.style.height = Math.max(44, ta.scrollHeight) + "px";
  };
  ta.oninput = () => {
    c.code = ta.value;
    fit();
    pySave();
  };
  ta.onkeydown = (e) => {
    if (e.key === "Enter" && (e.shiftKey || e.ctrlKey)) {
      e.preventDefault();
      pyRunCell(c).then(() => {
        const i = pyCells.indexOf(c);
        if (e.shiftKey && i === pyCells.length - 1) pyMakeCell("");
        const next = pyCells[i + 1];
        if (next && e.shiftKey) next.ta.focus();
      });
    } else if (e.key === "Tab") {
      e.preventDefault();
      const s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + "    " + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + 4;
      ta.oninput();
    }
  };
  const row = document.createElement("div");
  row.className = "pycell-row";
  const run = document.createElement("button");
  run.className = "btn primary small";
  run.textContent = "Run";
  run.onclick = () => pyRunCell(c);
  const del = document.createElement("button");
  del.className = "btn small";
  del.textContent = "Delete";
  del.onclick = () => {
    pyCells.splice(pyCells.indexOf(c), 1);
    el.remove();
    pySave();
  };
  const hint = document.createElement("small");
  hint.textContent = "Shift+Enter runs and goes to the next cell";
  row.append(run, del, hint);
  const out = document.createElement("div");
  out.className = "pyout";
  el.append(ta, row, out);
  Object.assign(c, { ta, outBox: out, runBtn: run, el });
  const list = $("pyCells");
  const idx = after ? pyCells.indexOf(after) + 1 : pyCells.length;
  pyCells.splice(idx, 0, c);
  list.insertBefore(el, list.children[idx] || null);
  fit();
  if (!after) ta.focus();
  return c;
}

async function pyRefreshStatus() {
  const s = await window.api.pyStatus();
  pyReady = s.ready;
  $("pyState").textContent = s.setting ? "Setting up Python..." : s.ready ? "Python is ready" : "Python is not set up. One download, about 200 MB, kept in Switcheroo's own folder.";
  $("pySetup").hidden = s.ready || s.setting;
  return s;
}

async function pyOpen() {
  if (!pyLoaded) {
    pyLoaded = true;
    const saved = await window.api.pyLoad();
    const list = saved && saved.length ? saved.map((c) => c.code) : PY_START;
    for (const code of list) pyMakeCell(code, pyCells[pyCells.length - 1] || null);
    $("pyCells").querySelectorAll("textarea").forEach((t) => (t.style.height = Math.max(44, t.scrollHeight) + "px"));
  }
  const s = await pyRefreshStatus();
  // not set up here, but a system python with the packages may exist: the first run finds out
  if (!s.ready && !s.setting) {
    const probe = await window.api.pyRun("1");
    if (!/not set up/i.test(probe.err || "")) {
      pyReady = true;
      $("pyState").textContent = "Python is ready (using the Python already on this computer)";
      $("pySetup").hidden = true;
    }
  }
}

async function pySetup() {
  $("pySetup").hidden = true;
  $("pyState").textContent = "Setting up Python...";
  $("pyProg").hidden = false;
  const r = await window.api.pySetup();
  $("pyProg").hidden = true;
  if (!r.ok) {
    $("pyState").textContent = "Setup failed: " + r.error;
    $("pySetup").hidden = false;
    $("pySetup").textContent = "Try again";
    return;
  }
  await pyRefreshStatus();
}

const pyHistory = [];
let pyHistPos = 0;
function pyTermPrint(text, cls) {
  const box = $("pyTermOut");
  const pre = document.createElement("pre");
  if (cls) pre.className = cls;
  pre.textContent = text;
  box.appendChild(pre);
  while (box.children.length > 200) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
async function pyTermRun(line) {
  pyTermPrint("> " + line, "cmd");
  const r = await window.api.pyTerm(line);
  if (r.out) pyTermPrint(r.out.replace(/\s+$/, ""));
  if (r.err) pyTermPrint(r.err.replace(/\s+$/, ""), "err");
  for (const b of r.images || []) {
    const img = document.createElement("img");
    img.src = "data:image/png;base64," + b;
    $("pyTermOut").appendChild(img);
  }
  $("pyTermOut").scrollTop = $("pyTermOut").scrollHeight;
}

function pyWire() {
  window.api.on("pyprogress", (p) => {
    $("pyProg").hidden = false;
    $("pyProgText").textContent = p.text || "";
    $("pyFill").style.width = p.pct === null || p.pct === undefined ? "100%" : p.pct + "%";
    $("pyFill").classList.toggle("busy", p.pct === null || p.pct === undefined);
  });
  $("pySetup").onclick = pySetup;
  $("pyAdd").onclick = () => pyMakeCell("", pyCells[pyCells.length - 1] || null);
  $("pyRunAll").onclick = async () => {
    for (const c of pyCells.slice()) await pyRunCell(c);
  };
  $("pyRefresh").onclick = async () => {
    if (!pyReady) return;
    const r = await window.api.pyReload();
    pyTermPrint(r.out || r.err || "Reloaded.", r.err ? "err" : "");
  };
  $("pyRestart").onclick = async () => {
    await window.api.pyRestart();
    pyTermPrint("Python restarted. Variables are gone, raw and clean are loaded again on the next run.");
  };
  $("pyTermIn").onkeydown = async (e) => {
    const inp = e.target;
    if (e.key === "Enter" && inp.value.trim()) {
      const line = inp.value;
      pyHistory.push(line);
      pyHistPos = pyHistory.length;
      inp.value = "";
      await pyTermRun(line);
    } else if (e.key === "ArrowUp" && pyHistPos > 0) {
      e.preventDefault();
      inp.value = pyHistory[--pyHistPos];
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      inp.value = pyHistPos < pyHistory.length - 1 ? pyHistory[++pyHistPos] : ((pyHistPos = pyHistory.length), "");
    }
  };
}


// ---------------------------------------------------------------- Roo, the profile picture
// One shot actions: add the class, take it away when the animation ends (see mascot/README.md).
function rooDo(cls) {
  const roo = document.getElementById("switcheroo");
  if (!roo) return;
  roo.classList.remove(cls);
  void roo.getBBox();
  roo.classList.add(cls);
  if (cls === "roo-hop") setTimeout(() => roo.classList.toggle("roo-swapped"), 400);
}
function rooWire() {
  const roo = document.getElementById("switcheroo");
  if (!roo) return;
  roo.addEventListener("animationend", (e) => {
    if (e.animationName === "roo-hop") roo.classList.remove("roo-hop");
    if (e.animationName === "roo-thumb-head") roo.classList.remove("roo-thumb");
  });
  document.getElementById("presence").onclick = () => rooDo("roo-hop");
}
