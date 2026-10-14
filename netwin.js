// Windows adapter: netsh for Wi-Fi control, plain TCP and HTTPS for measuring.
const { execFile } = require("child_process");
const net = require("net");
const https = require("https");

const HOSTS = [
  ["1.1.1.1", 443],
  ["8.8.8.8", 443],
];
const SPEED_URL = "https://speed.cloudflare.com/__down?bytes=2000000";

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 25000, encoding: "utf8", maxBuffer: 1 << 20 }, (_e, out) =>
      resolve(out || "")
    );
  });
}

// chcp 65001 makes netsh print UTF-8, so network names with accents survive.
const show = (what) => run("cmd.exe", ["/d", "/c", `chcp 65001 >nul & netsh wlan show ${what}`]);

async function profiles() {
  const names = [];
  for (const line of (await show("profiles")).split(/\r?\n/)) {
    if (/^\s+\S/.test(line) && line.includes(":")) {
      const v = line.slice(line.indexOf(":") + 1).trim();
      if (v && !names.includes(v)) names.push(v);
    }
  }
  return names;
}

async function current() {
  let ssid = null;
  let signal = null;
  for (const line of (await show("interfaces")).split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (key === "SSID") ssid = val;
    else if (signal === null) {
      const m = /^(\d+)%$/.exec(val);
      if (m) signal = Number(m[1]);
    }
  }
  return { ssid, signal };
}

async function connect(profile) {
  await run("netsh", ["wlan", "connect", "name=" + profile]);
}

function tcpPing(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const s = net.connect({ host, port });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeout, () => done(null));
    s.on("connect", () => done(Number(process.hrtime.bigint() - t0) / 1e6));
    s.on("error", () => done(null));
  });
}

async function internetOk() {
  for (const [h, p] of HOSTS) if ((await tcpPing(h, p)) !== null) return true;
  return false;
}

function download(url, maxMs = 3000) {
  return new Promise((resolve) => {
    let bytes = 0;
    let fired = false;
    const t0 = Date.now();
    const fin = () => {
      if (fired) return;
      fired = true;
      const el = (Date.now() - t0) / 1000;
      resolve(el > 0 ? (bytes * 8) / el / 1e6 : 0);
    };
    const req = https.get(url, { agent: false, timeout: 8000 }, (res) => {
      res.on("data", (c) => {
        bytes += c.length;
        if (Date.now() - t0 >= maxMs) req.destroy();
      });
      res.on("end", fin);
      res.on("close", fin);
      res.on("error", fin);
    });
    req.on("error", fin);
    req.on("timeout", () => req.destroy());
  });
}

async function measure() {
  const times = [];
  let lost = 0;
  const samples = 6;
  for (let i = 0; i < samples; i++) {
    const [h, p] = HOSTS[i % HOSTS.length];
    const t = await tcpPing(h, p);
    if (t === null) lost++;
    else times.push(t);
  }
  times.sort((a, b) => a - b);
  const latency = times.length ? times[Math.floor(times.length / 2)] : null;
  const loss = lost / samples;
  const mbps = times.length ? await download(SPEED_URL) : 0;
  const score = latency === null || mbps <= 0 ? 0 : (mbps * (1 - loss)) / (1 + latency / 150);
  return { latency, loss, mbps, score };
}

// Latency and loss only, no download. Used while gaming so tests never add lag.
async function ping() {
  const times = [];
  let lost = 0;
  const samples = 5;
  for (let i = 0; i < samples; i++) {
    const [h, p] = HOSTS[i % HOSTS.length];
    const t = await tcpPing(h, p);
    if (t === null) lost++;
    else times.push(t);
  }
  times.sort((a, b) => a - b);
  return { latency: times.length ? times[Math.floor(times.length / 2)] : null, loss: lost / samples, mbps: null, score: null };
}

module.exports = { profiles, current, connect, internetOk, measure, ping };
