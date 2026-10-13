// Switching logic. Pure JS, talks to the system only through an adapter,
// so it can be tested without Windows.
const { EventEmitter } = require("events");

const DEFAULTS = {
  checkInterval: 30000, // measure the active network this often
  trialInterval: 240000, // visit the other network this often
  trialCooldown: 90000, // minimum gap between trials, even when degraded
  stayMargin: 1.25, // the other network must score 25 percent higher to win
  degradeRatio: 0.6, // a check below 60 percent of the recent average triggers a trial
};

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

      const m = await this.sys.measure();
      if (this.stopped) break;
      const prev = mean(this.history[active]);
      this.push(active, m.score);
      this.emit("status", { net: active, m, signal: c.signal, ts: Date.now() });

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
    this.emit("status", { net: alt, m, signal: c.signal, ts: Date.now() });

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

module.exports = { Engine, DEFAULTS };
