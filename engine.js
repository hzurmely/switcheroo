// Switching logic. Pure JS, talks to the system only through an adapter,
// so it can be tested without Windows.
const { EventEmitter } = require("events");

const DEFAULTS = {
  gameInterval: 20000, // while gaming, only a light ping this often
  minGameSamples: 5, // averages need this many samples per network to be trusted
  checkInterval: 30000, // measure the active network this often
  trialInterval: 240000, // visit the other network this often
  trialCooldown: 90000, // minimum gap between trials, even when degraded
  stayMargin: 1.25, // the other network must score 25 percent higher to win
  degradeRatio: 0.6, // a check below 60 percent of the recent average triggers a trial
};

// Ranks a network for gaming: low latency and no loss matter most, speed only has to be decent.
function gameRank(a) {
  if (!a) return 0;
  const lat = a.latency === null || a.latency === undefined ? 500 : a.latency;
  const speed = a.mbps === null || a.mbps === undefined ? 1 : Math.max(0.1, Math.min(1, a.mbps / 10));
  return ((1 - Math.min(1, a.loss * 4)) * 1000 * speed) / (lat + 10);
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

class Engine extends EventEmitter {
  constructor(adapter, nets, opts = {}) {
    super();
    this.sys = adapter;
    this.nets = nets;
    this.o = { ...DEFAULTS, ...opts };
    this.stopped = false;
    this.wake = null;
    this.game = null; // name of the running game, or null
    this.gameDone = false;
    this.averages = opts.averages || (() => ({}));
    this.history = { [nets[0]]: [], [nets[1]]: [] };
  }

  log(text) {
    this.emit("log", { ts: Date.now(), text });
  }

  other(n) {
    return n === this.nets[0] ? this.nets[1] : this.nets[0];
  }

  push(net, score) {
    const h = this.history[net];
    h.push(score);
    if (h.length > 6) h.shift();
  }

  // Called when a game starts (name) or ends (null).
  setGame(name) {
    if (name === this.game) return;
    this.game = name;
    this.gameDone = false;
    this.log(name ? `Game mode on (${name})` : "Game closed. Back to normal switching");
    this.emit("game", name);
    if (this.wake) this.wake();
  }

  stop() {
    this.stopped = true;
    if (this.wake) this.wake();
  }

  wait(ms) {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }

  async connect(profile, timeout = 20000) {
    await this.sys.connect(profile);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.stopped) return false;
      const c = await this.sys.current();
      if (same(c.ssid, profile) && (await this.sys.internetOk())) return true;
      await this.wait(1000);
    }
    return false;
  }

  setActive(net) {
    this.active = net;
    this.emit("active", net);
  }

  async run() {
    this.emit("running", true);
    try {
      await this.loop();
    } catch (e) {
      this.log("Error: " + e.message);
    }
    this.emit("running", false);
  }

  async loop() {
    const first = await this.sys.current();
    let active = this.nets.find((n) => same(n, first.ssid));
    if (!active) {
      active = this.nets[0];
      this.log("Not on a selected network. Connecting to " + active);
      if (!(await this.connect(active))) this.log("Could not connect to " + active + ", will keep trying.");
    } else {
      this.log("Starting on " + active);
    }
    this.setActive(active);

    let lastTrial = Date.now();
    while (!this.stopped) {
      const c = await this.sys.current();
      const here = this.nets.find((n) => same(n, c.ssid));
      if (here && here !== active) {
        active = here;
        this.setActive(active);
      }
      if (!here || !(await this.sys.internetOk())) {
        this.log(here ? "Lost internet on " + active + ", trying the other network." : "Left the selected networks, going back.");
        const alt = here ? this.other(active) : active;
        if (await this.connect(alt)) {
          active = alt;
          this.setActive(active);
          this.log("Now on " + active);
        } else if (here) {
          await this.connect(active);
        }
        await this.wait(5000);
        continue;
      }

      if (this.game) {
        if (!this.gameDone) {
          active = await this.gameSwitch(active);
          this.setActive(active);
          this.gameDone = true;
          lastTrial = Date.now();
        }
        const gm = await this.sys.ping();
        if (this.stopped) break;
        this.emit("status", { net: active, m: gm, signal: c.signal, ts: Date.now(), mode: "game" });
        await this.wait(this.o.gameInterval);
        continue;
      }

      const m = await this.sys.measure();
      if (this.stopped) break;
      const prev = mean(this.history[active]);
      this.push(active, m.score);
      this.emit("status", { net: active, m, signal: c.signal, ts: Date.now(), mode: "normal" });

      const degraded = prev > 0 && m.score < prev * this.o.degradeRatio;
      const since = Date.now() - lastTrial;
      if ((degraded && since >= this.o.trialCooldown) || since >= this.o.trialInterval) {
        active = await this.trial(active, m, degraded ? "quality dropped" : "scheduled comparison");
        this.setActive(active);
        lastTrial = Date.now();
      }
      await this.wait(this.o.checkInterval);
    }
  }

  // Picks the better network for gaming once, when the game opens, so nothing disconnects mid match.
  async gameSwitch(active) {
    const alt = this.other(active);
    const avg = this.averages();
    let ra = avg[active];
    let rb = avg[alt];
    const enough = (x) => x && x.n >= this.o.minGameSamples;
    if (!enough(ra) || !enough(rb)) {
      this.log("Not enough history yet, doing a quick test of both networks");
      const here = await this.sys.ping();
      if (!(await this.connect(alt))) {
        await this.connect(active);
        this.log(`${alt} did not come up, staying on ${active}`);
        return active;
      }
      const there = await this.sys.ping();
      ra = { ...here, mbps: ra ? ra.mbps : null };
      rb = { ...there, mbps: rb ? rb.mbps : null };
      if (gameRank(rb) > gameRank(ra) * 1.1) {
        this.log(`Game mode: using ${alt} (${Math.round(there.latency ?? 0)} ms vs ${Math.round(here.latency ?? 0)} ms)`);
        return alt;
      }
      this.log(`Game mode: ${active} is better, returning`);
      return (await this.connect(active)) ? active : alt;
    }
    this.log(
      `Game averages: ${active} ${Math.round(ra.latency ?? 0)} ms, ${alt} ${Math.round(rb.latency ?? 0)} ms`
    );
    if (gameRank(rb) > gameRank(ra) * 1.1) {
      if (await this.connect(alt)) {
        this.log(`Game mode: switched to ${alt}, better averages`);
        return alt;
      }
      await this.connect(active);
      this.log(`${alt} did not come up, staying on ${active}`);
    } else {
      this.log(`Game mode: staying on ${active}, better averages`);
    }
    return active;
  }

  async trial(active, current, reason) {
    const alt = this.other(active);
    this.log(`Testing ${alt} (${reason})`);
    if (!(await this.connect(alt))) {
      this.log(`${alt} did not come up. Going back to ${active}`);
      await this.connect(active);
      return active;
    }
    const m = await this.sys.measure();
    const c = await this.sys.current();
    this.push(alt, m.score);
    this.emit("status", { net: alt, m, signal: c.signal, ts: Date.now(), mode: "normal" });

    const recent = this.history[active].slice(-2);
    const reference = recent.length ? mean(recent) : current.score;
    if (m.score > reference * this.o.stayMargin || (current.score === 0 && m.score > 0)) {
      this.log(`Switched to ${alt} (${m.mbps.toFixed(1)} Mbps, ${m.latency === null ? "n/a" : Math.round(m.latency) + " ms"})`);
      return alt;
    }
    this.log(`${alt} is not clearly better (${m.mbps.toFixed(1)} Mbps). Returning to ${active}`);
    if (!(await this.connect(active))) {
      this.log(`Could not return to ${active}, staying on ${alt}`);
      return alt;
    }
    return active;
  }
}

module.exports = { Engine, DEFAULTS, gameRank };
