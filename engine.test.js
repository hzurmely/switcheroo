// Runs the engine against fake networks. No Windows, no Electron needed.
const assert = require("assert");
const { Engine } = require("./engine");

const quality = { Home5G: 100, Home24: 40 };
let ssid = "Home5G";
const calls = [];
let lat5 = 60;
const sys = {
  current: async () => ({ ssid, signal: 80 }),
  connect: async (p) => {
    ssid = p;
    calls.push(p);
  },
  internetOk: async () => true,
  ping: async () => ({ latency: ssid === "Home5G" ? lat5 : 15, loss: 0, mbps: null, score: null }),
  measure: async () => {
    const q = quality[ssid];
    return { latency: 20, loss: 0, mbps: q, score: q / (1 + 20 / 150) };
  },
};

(async () => {
  let avgs = {};
  const e = new Engine(sys, ["Home5G", "Home24"], {
    averages: () => avgs,
    gameInterval: 30,
    checkInterval: 20,
    trialInterval: 150,
    trialCooldown: 50,
  });
  const logs = [];
  e.on("log", (l) => logs.push(l.text));
  const done = e.run();

  await new Promise((r) => setTimeout(r, 700));
  assert.strictEqual(ssid, "Home5G", "stays on the better network");
  assert(logs.some((l) => /not clearly better/.test(l)), "tried the other network and came back");

  quality.Home5G = 5;
  quality.Home24 = 60;
  await new Promise((r) => setTimeout(r, 1200));
  assert.strictEqual(ssid, "Home24", "switches to the faster network");
  assert(logs.some((l) => /Switched to Home24/.test(l)));

  // game mode: averages say Home24 has the lower latency, so it should switch to it
  quality.Home5G = 100;
  quality.Home24 = 100;
  avgs = {
    Home5G: { n: 20, mbps: 100, latency: 60, loss: 0.02 },
    Home24: { n: 20, mbps: 60, latency: 15, loss: 0 },
  };
  if (ssid !== "Home5G") await e.connect("Home5G");
  e.setGame("cs2.exe");
  await new Promise((r) => setTimeout(r, 400));
  assert.strictEqual(ssid, "Home24", "game mode picks the lower latency network");
  assert(logs.some((l) => /Game mode: switched to Home24/.test(l)));
  e.setGame(null);

  e.stop();
  await done;
  // store: saves, averages, prunes oldest days and keeps lifetime totals
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Store } = require("./store");
const { matchGame } = require("./games");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-"));
const st = new Store(dir, 6000);
for (let d = 10; d >= 0; d--)
  for (let i = 0; i < 20; i++)
    st.add({ ts: Date.now() - d * 86400000 + i * 1000, house: "h1", net: i % 2 ? "A" : "B", mode: "normal", mbps: i % 2 ? 100 : 40, latency: i % 2 ? 10 : 30, loss: 0, score: 50, signal: 80 });
st.add({ ts: Date.now(), house: "h1", net: "A", mode: "game", mbps: null, latency: 12, loss: 0, score: null, signal: 80 });
const before = st.averages("h1");
st.prune();
assert(st.size() <= 6000, "folder pruned under the limit, size " + st.size());
assert(st.files().length < 11, "old files deleted");
const after = st.averages("h1");
assert.strictEqual(after.A.n, before.A.n, "sample counts survive pruning");
assert(Math.abs(after.A.mbps - before.A.mbps) < 0.01 && Math.abs(after.B.latency - before.B.latency) < 0.01, "averages survive pruning");
assert(st.averages("h1", Date.now() - 3600000).A.n >= 1, "range filter works");
assert.deepStrictEqual(st.averages("other"), {}, "households are separate");
assert.strictEqual(matchGame(["chrome.exe", "CS2.exe".toLowerCase()]), "cs2.exe");
assert.strictEqual(matchGame(["chrome.exe"], ["chrome.exe"]), "chrome.exe");
assert.strictEqual(matchGame(["notepad.exe"]), null);
fs.rmSync(dir, { recursive: true, force: true });

console.log("engine ok. switches:", logs.filter((l) => /Switched/.test(l)).length);
  process.exit(0);
})().catch((err) => {
  console.error("FAIL", err.message);
  process.exit(1);
});
