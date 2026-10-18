// Benchmark and "only switch when quality drops", against fake networks.
const assert = require("assert");
const { Engine } = require("./engine");

function fake(start) {
  const s = { ssid: start, q: { Home5G: 100, Home24: 40 }, joins: [] };
  s.sys = {
    current: async () => ({ ssid: s.ssid, signal: 80 }),
    connect: async (p) => {
      s.ssid = p;
      s.joins.push(p);
    },
    internetOk: async () => true,
    ping: async () => ({ latency: 20, loss: 0, mbps: null, score: null }),
    measure: async () => ({ latency: 20, loss: 0, mbps: s.q[s.ssid], score: s.q[s.ssid] / (1 + 20 / 150) }),
  };
  return s;
}
const fast = { checkInterval: 20, trialInterval: 60, trialCooldown: 30, connectRetry: 5 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // standalone, starts on the slow one and must return to it
  let f = fake("Home24");
  let e = new Engine(f.sys, ["Home5G", "Home24"], fast);
  let r = await e.benchmark(2);
  assert(r.ok && r.results.length === 2, "tested both networks");
  assert.strictEqual(r.winner, "Home5G", "faster network wins");
  assert.strictEqual(f.ssid, "Home24", "back on the starting network");
  assert(r.returned, "reports that it returned");
  assert.strictEqual(r.results[0].net, "Home24", "starting network is tested first");

  // standalone, starts on the fast one
  f = fake("Home5G");
  e = new Engine(f.sys, ["Home5G", "Home24"], fast);
  r = await e.benchmark(1);
  assert.strictEqual(f.ssid, "Home5G");
  assert.strictEqual(r.winner, "Home5G");

  // while switching is running
  f = fake("Home5G");
  e = new Engine(f.sys, ["Home5G", "Home24"], { ...fast, trialInterval: 100000 });
  const run = e.run();
  await sleep(100);
  r = await e.benchmark(1);
  assert(r.ok && r.results.length === 2, "benchmark ran inside the loop");
  assert.strictEqual(f.ssid, "Home5G", "loop network restored");
  e.stop();
  await run;

  // a game blocks it
  f = fake("Home5G");
  e = new Engine(f.sys, ["Home5G", "Home24"], fast);
  e.game = "cs2";
  r = await e.benchmark(1);
  assert.strictEqual(r.ok, false);

  // only switch when quality drops
  f = fake("Home5G");
  e = new Engine(f.sys, ["Home5G", "Home24"], { ...fast, onlyOnDrop: true });
  const logs = [];
  e.on("log", (l) => logs.push(l.text));
  const run2 = e.run();
  await sleep(500);
  assert(!logs.some((l) => /Testing/.test(l)), "no scheduled trial when the setting is on");
  f.q.Home5G = 10;
  await sleep(400);
  assert(logs.some((l) => /Testing Home24 \(quality dropped\)/.test(l)), "trial after a drop");
  e.stop();
  await run2;

  // setting off keeps the timer
  f = fake("Home5G");
  e = new Engine(f.sys, ["Home5G", "Home24"], fast);
  const logs2 = [];
  e.on("log", (l) => logs2.push(l.text));
  const run3 = e.run();
  await sleep(400);
  assert(logs2.some((l) => /scheduled comparison/.test(l)), "scheduled trial still works");
  e.stop();
  await run3;

  console.log("bench ok");
  process.exit(0);
})().catch((err) => {
  console.error("FAIL", err.message);
  process.exit(1);
});
