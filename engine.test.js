// Runs the engine against fake networks. No Windows, no Electron needed.
const assert = require("assert");
const { Engine } = require("./engine");

const quality = { Home5G: 100, Home24: 40 };
let ssid = "Home5G";
const calls = [];
const sys = {
  current: async () => ({ ssid, signal: 80 }),
  connect: async (p) => {
    ssid = p;
    calls.push(p);
  },
  internetOk: async () => true,
  measure: async () => {
    const q = quality[ssid];
    return { latency: 20, loss: 0, mbps: q, score: q / (1 + 20 / 150) };
  },
};

(async () => {
  const e = new Engine(sys, ["Home5G", "Home24"], {
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

  e.stop();
  await done;
  console.log("engine ok. switches:", logs.filter((l) => /Switched/.test(l)).length);
  process.exit(0);
})().catch((err) => {
  console.error("FAIL", err.message);
  process.exit(1);
});
