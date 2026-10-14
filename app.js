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

async function renderAvg() {
  const range = $("range").value;
  const data = range === "all" ? S.avg : (await window.api.averages(range)) || {};
  const rows = [S.a, S.b].filter(Boolean).map((n) => ({ n, v: data[n] }));
  const ranks = rows.map((r) => (r.v ? gameRank(r.v) : 0));
  const bestSpeed = Math.max(...rows.map((r) => (r.v && r.v.mbps) || 0));
  const bestLat = Math.min(...rows.map((r) => (r.v && r.v.latency !== null ? r.v.latency : Infinity)));
  const body = $("avgBody");
  body.innerHTML = "";
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    const cells = r.v
      ? [r.n, String(r.v.n), r.v.mbps === null ? "n/a" : r.v.mbps.toFixed(1) + " Mbps", r.v.latency === null ? "n/a" : Math.round(r.v.latency) + " ms", (r.v.loss * 100).toFixed(1) + " %", ranks[i].toFixed(1)]
      : [r.n, "0", "no data", "no data", "no data", "no data"];
    cells.forEach((t, k) => {
      const td = document.createElement("td");
      td.textContent = t;
      if (r.v && ((k === 2 && r.v.mbps === bestSpeed && rows.length > 1) || (k === 3 && r.v.latency === bestLat && rows.length > 1) || (k === 5 && ranks[i] === Math.max(...ranks) && rows.length > 1))) td.className = "best";
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  $("avgNote").textContent = rows.length
    ? "Green marks the better network. Game rank favours low latency and no packet loss, and is what game mode uses."
    : "Pick two networks to see their averages.";
}

function renderSettings() {
  $("gameOn").checked = !!S.prefs.game;
  if (document.activeElement !== $("extraGames")) $("extraGames").value = (S.prefs.extraGames || []).join(", ");
  $("maxMb").value = String(S.prefs.maxMb);
  const st = S.storage;
  if (st) {
    $("dataPath").textContent = st.dir;
    $("dataBar").style.width = Math.min(100, (st.size / st.max) * 100) + "%";
    $("dataText").textContent = `${mb(st.size)} used of ${mb(st.max)}`;
  }
}

function setTab(t) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  for (const id of ["live", "avg", "set"]) $("pane-" + id).hidden = id !== t;
  if (t === "live") drawChart();
  if (t === "avg") renderAvg();
  if (t === "set") window.api.storage().then((s) => ((S.storage = s), renderSettings()));
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
  $("autostart").checked = !!st.autostart;
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
  $("autostart").onchange = async (e) => {
    e.target.checked = await window.api.setAutostart(e.target.checked);
  };
  document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
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
  window.api.on("autostart", (v) => ($("autostart").checked = v));
}

init();
