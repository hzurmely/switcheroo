const $ = (id) => document.getElementById(id);
const COLORS = { a: "#5865f2", b: "#23a559" };

const S = { profiles: [], a: "", b: "", running: false, active: null, status: {}, series: [] };

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
  for (const slot of ["a", "b"]) {
    const { name, st } = netInfo(slot);
    const U = slot.toUpperCase();
    $("name" + U).textContent = name || "Not set";
    $("rail" + U + "Text").textContent = name && short(S.a) !== short(S.b) ? short(name) : U;
    $("rail" + U).title = name || "Network " + U;
    $("leg" + U).textContent = name || U;
    $("sub" + U).textContent = st
      ? `${st.m.mbps.toFixed(1)} Mbps, ${st.m.latency === null ? "n/a" : Math.round(st.m.latency) + " ms"}`
      : "no data yet";
    const isActive = S.running && name && name === S.active;
    $("badge" + U).hidden = !isActive;
    $("net" + U).classList.toggle("active", !!isActive);
    $("rail" + U).classList.toggle("on", !!isActive);
  }

  const cur = S.active && S.status[S.active];
  $("stSpeed").textContent = cur ? cur.m.mbps.toFixed(1) : "--";
  $("stLat").textContent = cur && cur.m.latency !== null ? Math.round(cur.m.latency) : "--";
  $("stLoss").textContent = cur ? Math.round(cur.m.loss * 100) : "--";
  $("stSig").textContent = cur && cur.signal !== null ? cur.signal : "--";

  const btn = $("toggle");
  btn.textContent = S.running ? "Stop switching" : "Start switching";
  btn.classList.toggle("stop", S.running);
  $("presence").classList.toggle("on", S.running);
  $("stateTitle").textContent = S.running ? "Switching" : "Paused";
  $("stateSub").textContent = S.running ? (S.active ? "On " + S.active : "Connecting...") : "Not switching";
  $("topic").textContent = S.running
    ? `Watching ${S.a} and ${S.b}. Currently on ${S.active || "..."}.`
    : "Pick two networks and press Start";
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

async function start() {
  $("hint").textContent = "";
  const a = $("selA").value;
  const b = $("selB").value;
  if (!a || !b) return ($("hint").textContent = "Choose both networks first.");
  if (a === b) return ($("hint").textContent = "Pick two different networks.");
  S.a = a;
  S.b = b;
  S.series = [];
  S.status = {};
  await window.api.start(a, b);
  render();
}

async function init() {
  const st = await window.api.state();
  Object.assign(S, {
    profiles: st.profiles,
    a: st.a,
    b: st.b,
    running: st.running,
    active: st.active,
    status: st.status || {},
    series: st.series || [],
  });
  fillSelect($("selA"), S.a);
  fillSelect($("selB"), S.b);
  $("autostart").checked = !!st.autostart;
  $("feed").innerHTML = '<div class="empty">Nothing yet. Start switching and updates show up here.</div>';
  (st.logs || []).forEach(addMessage);
  render();

  $("selA").onchange = () => { S.a = $("selA").value; render(); };
  $("selB").onchange = () => { S.b = $("selB").value; render(); };
  $("toggle").onclick = () => (S.running ? window.api.stop() : start());
  $("refresh").onclick = async () => {
    S.profiles = await window.api.profiles();
    fillSelect($("selA"), $("selA").value);
    fillSelect($("selB"), $("selB").value);
  };
  $("autostart").onchange = async (e) => {
    e.target.checked = await window.api.setAutostart(e.target.checked);
  };
  window.addEventListener("resize", drawChart);

  window.api.on("log", addMessage);
  window.api.on("running", (r) => {
    S.running = r;
    if (!r) S.active = null;
    render();
  });
  window.api.on("active", (n) => {
    S.active = n;
    render();
  });
  window.api.on("status", (s) => {
    S.status[s.net] = s;
    S.series.push({ net: s.net, score: s.m.score, ts: s.ts });
    if (S.series.length > 120) S.series.shift();
    render();
  });
  window.api.on("autostart", (v) => ($("autostart").checked = v));
}

init();
