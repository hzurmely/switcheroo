// Windows ignores the first connect request: the engine must ask again.
const assert = require("assert");
const { Engine } = require("./engine");
let ssid = "A", asks = 0, rescans = 0;
const sys = {
  current: async () => ({ ssid, signal: 70 }),
  connect: async (p) => { if (p === "B" && ++asks < 3) return; ssid = p; },
  rescan: async () => { rescans++; },
  internetOk: async () => true,
};
(async () => {
  const e = new Engine(sys, ["A", "B"], { connectRetry: 30 });
  e.wait = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20)));
  assert.strictEqual(await e.connect("B", 3000), true);
  assert(asks >= 3 && rescans >= 2);
  ssid = "A"; asks = -100;
  assert.strictEqual(await e.connect("B", 300), false);
  assert.strictEqual(e.why, "Windows would not join it");
  console.log("retry ok");
})();
