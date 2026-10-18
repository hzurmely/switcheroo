// Linux adapter: NetworkManager (nmcli) for Wi-Fi control. Measuring is shared with Windows.
// A network is named by its NetworkManager connection name, which is the Wi-Fi name unless it was renamed.
const { execFile } = require("child_process");
const win = require("./netwin");

function run(args, timeout = 25000) {
  return new Promise((resolve) => {
    execFile("nmcli", args, { timeout, encoding: "utf8", maxBuffer: 4 << 20, env: { ...process.env, LC_ALL: "C" } }, (_e, out, err) =>
      resolve((out || "") + (out ? "" : err || ""))
    );
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// nmcli -t separates fields with ":" and escapes a colon or backslash inside a value with a backslash.
function terse(line) {
  const out = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) cur += line[++i];
    else if (ch === ":") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
const rows = (text) => String(text || "").split(/\r?\n/).filter((l) => l.trim()).map(terse);

// nmcli -t -f NAME,TYPE connection show
function parseProfiles(text) {
  const names = [];
  for (const [name, type] of rows(text)) if (name && /wireless|wifi/i.test(type || "") && !names.includes(name)) names.push(name);
  return names;
}

// nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device
function parseDevices(text) {
  const wifi = rows(text).filter((r) => /^wifi$/i.test(r[1] || ""));
  const pick = wifi.find((r) => /^connected/i.test(r[2] || "")) || wifi[0];
  if (!pick) return null;
  return { iface: pick[0], connected: /^connected/i.test(pick[2] || ""), name: pick[3] || null };
}

// nmcli -t -f IN-USE,SSID,CHAN,FREQ,RATE,SIGNAL device wifi list
function parseLink(text) {
  const r = rows(text).find((x) => x[0] === "*");
  const data = { signal: null, channel: null, radio: null, band: null, rx: null, tx: null };
  if (!r) return data;
  const num = (s) => {
    const m = /(\d+(?:\.\d+)?)/.exec(String(s || ""));
    return m ? Number(m[1]) : null;
  };
  data.channel = num(r[2]);
  const mhz = num(r[3]);
  if (mhz) data.band = mhz >= 5900 ? "6 GHz" : mhz >= 4900 ? "5 GHz" : "2.4 GHz";
  const rate = num(r[4]);
  if (rate) data.rx = data.tx = rate;
  data.signal = num(r[5]);
  return data;
}

let dev = null;
async function wifiDevice() {
  const d = parseDevices(await run(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"]));
  if (d) dev = d.iface;
  return d;
}

async function profiles() {
  return parseProfiles(await run(["-t", "-f", "NAME,TYPE", "connection", "show"]));
}

async function current() {
  const d = await wifiDevice();
  const r = { iface: d ? d.iface : null, ssid: d && d.connected ? d.name : null, signal: null, channel: null, radio: null, band: null, rx: null, tx: null };
  if (r.ssid) Object.assign(r, parseLink(await run(["-t", "-f", "IN-USE,SSID,CHAN,FREQ,RATE,SIGNAL", "device", "wifi", "list", "ifname", r.iface, "--rescan", "no"])));
  return r;
}

// attempt 0 joins the saved network, 1 repeats it, 2 turns Wi-Fi off and on first.
async function connect(profile, attempt = 0, iface = null) {
  let d = iface || dev;
  if (!d) d = ((await wifiDevice()) || {}).iface;
  if (attempt >= 2) {
    await run(["radio", "wifi", "off"]);
    await sleep(1000);
    await run(["radio", "wifi", "on"]);
    await sleep(3000);
  }
  const args = ["--wait", "15", "connection", "up", "id", profile];
  if (d) args.push("ifname", d);
  return (await run(args)).replace(/\s+/g, " ").trim().slice(0, 160);
}

async function rescan() {
  if (dev) await run(["device", "wifi", "rescan", "ifname", dev], 8000);
}

module.exports = { profiles, current, connect, rescan, internetOk: win.internetOk, measure: win.measure, ping: win.ping, terse, parseProfiles, parseDevices, parseLink };
