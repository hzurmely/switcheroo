// macOS adapter (test build): networksetup and ipconfig for Wi-Fi control. Measuring is shared with Windows.
const { execFile } = require("child_process");
const win = require("./netwin");

function run(file, args, timeout = 25000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, encoding: "utf8", maxBuffer: 8 << 20 }, (_e, out, err) => resolve((out || "") + (out ? "" : err || "")));
  });
}

let dev = null;
// The Wi-Fi adapter, usually en0.
async function wifiDevice() {
  if (dev) return dev;
  const out = await run("networksetup", ["-listallhardwareports"]);
  const m = /Hardware Port: (?:Wi-Fi|AirPort)\s*\nDevice: (\w+)/i.exec(out);
  dev = m ? m[1] : "en0";
  return dev;
}

async function profiles() {
  const out = await run("networksetup", ["-listpreferredwirelessnetworks", await wifiDevice()]);
  const names = [];
  for (const line of out.split(/\r?\n/).slice(1)) {
    const v = line.replace(/^\t+/, "").trim();
    if (v && line.startsWith("\t") && !names.includes(v)) names.push(v);
  }
  return names;
}

async function ssidNow(d) {
  // ipconfig keeps reporting the name when networksetup hides it on newer macOS.
  const sum = await run("ipconfig", ["getsummary", d]);
  let m = /^\s*SSID : (.+)$/m.exec(sum);
  if (m) return m[1].trim();
  const out = await run("networksetup", ["-getairportnetwork", d]);
  m = /Current Wi-Fi Network: (.+)/.exec(out);
  return m ? m[1].trim() : null;
}

// Signal, channel and rates come from system_profiler, which is slow, so they are cached for 20 seconds.
let detail = { at: 0, ssid: null, data: {} };
async function link(ssid) {
  if (detail.ssid === ssid && Date.now() - detail.at < 20000) return detail.data;
  const data = { signal: null, channel: null, radio: null, band: null, rx: null, tx: null };
  try {
    const j = JSON.parse(await run("system_profiler", ["SPAirPortDataType", "-json"], 20000));
    for (const card of (j.SPAirPortDataType || []).flatMap((x) => x.spairport_airport_interfaces || [])) {
      const cur = card.spairport_current_network_information;
      if (!cur) continue;
      const rssi = /(-?\d+) dBm/.exec(String(cur.spairport_signal_noise || ""));
      if (rssi) data.signal = Math.max(0, Math.min(100, 2 * (Number(rssi[1]) + 100)));
      const ch = /^(\d+)/.exec(String(cur.spairport_network_channel || ""));
      if (ch) data.channel = Number(ch[1]);
      if (/5GHz/i.test(String(cur.spairport_network_channel))) data.band = "5 GHz";
      else if (/2GHz/i.test(String(cur.spairport_network_channel))) data.band = "2.4 GHz";
      if (cur.spairport_network_phymode) data.radio = String(cur.spairport_network_phymode);
      if (Number(cur.spairport_network_rate)) data.rx = data.tx = Number(cur.spairport_network_rate);
    }
  } catch {}
  detail = { at: Date.now(), ssid, data };
  return data;
}

async function current() {
  const d = await wifiDevice();
  const ssid = await ssidNow(d);
  const r = { iface: d, ssid, signal: null, channel: null, radio: null, band: null, rx: null, tx: null };
  if (ssid) Object.assign(r, await link(ssid));
  return r;
}

// attempt 0 joins the saved network, 1 repeats it, 2 turns Wi-Fi off and on first.
async function connect(profile, attempt = 0, iface = null) {
  const d = iface || (await wifiDevice());
  if (attempt >= 2) {
    await run("networksetup", ["-setairportpower", d, "off"]);
    await run("networksetup", ["-setairportpower", d, "on"]);
  }
  const out = (await run("networksetup", ["-setairportnetwork", d, profile])).replace(/\s+/g, " ").trim();
  return out.slice(0, 160);
}

async function rescan() {}

module.exports = { profiles, current, connect, rescan, internetOk: win.internetOk, measure: win.measure, ping: win.ping };
