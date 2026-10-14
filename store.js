// Saves every measurement to a folder and keeps that folder under a size limit.
// One JSONL file per day. When the folder grows past the limit, the oldest days
// are folded into summary.json (so lifetime averages survive) and deleted.
const fs = require("fs");
const path = require("path");

const DAY = 86400000;
const FILE_RE = /^samples-(\d{4}-\d{2}-\d{2})\.jsonl$/;

const SUMS = ["n", "mbps", "mN", "lat", "latN", "loss", "score", "sN", "jit", "jitN", "sig", "sigN", "rate", "rateN", "maxLat", "fails", "ch5", "ch24"];
const fresh = () => ({ ...Object.fromEntries(SUMS.map((k) => [k, 0])), topMbps: null, lowMbps: null, peakLat: null });
const has = (x) => x !== null && x !== undefined;
function accumulate(b, r) {
  if (r.ev === "joinfail") {
    b.fails++;
    return;
  }
  b.n++;
  b.loss += r.p;
  if (has(r.m)) {
    b.mbps += r.m;
    b.mN++;
    if (r.m > 0) {
      b.topMbps = b.topMbps === null ? r.m : Math.max(b.topMbps, r.m);
      b.lowMbps = b.lowMbps === null ? r.m : Math.min(b.lowMbps, r.m);
    }
  }
  if (has(r.s)) {
    b.score += r.s;
    b.sN++;
  }
  if (has(r.l)) {
    b.lat += r.l;
    b.latN++;
  }
  if (has(r.x)) b.peakLat = b.peakLat === null ? r.x : Math.max(b.peakLat, r.x);
  if (has(r.j)) {
    b.jit += r.j;
    b.jitN++;
  }
  if (has(r.g)) {
    b.sig += r.g;
    b.sigN++;
  }
  const rate = has(r.rx) ? r.rx : null;
  if (rate !== null) {
    b.rate += rate;
    b.rateN++;
  }
  if (has(r.c)) r.c > 14 ? b.ch5++ : b.ch24++;
}
// Folds the totals of one pruned group into the running summary.
function merge(into, v) {
  for (const k of SUMS) into[k] += v[k] || 0;
  if (has(v.topMbps)) into.topMbps = into.topMbps === null ? v.topMbps : Math.max(into.topMbps, v.topMbps);
  if (has(v.lowMbps)) into.lowMbps = into.lowMbps === null ? v.lowMbps : Math.min(into.lowMbps, v.lowMbps);
  if (has(v.peakLat)) into.peakLat = into.peakLat === null ? v.peakLat : Math.max(into.peakLat, v.peakLat);
}

const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);

class Store {
  constructor(dir, maxBytes = 50 * 1024 * 1024) {
    this.dir = dir;
    this.maxBytes = maxBytes;
    this.writes = 0;
    fs.mkdirSync(dir, { recursive: true });
  }

  setDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    this.dir = dir;
  }

  setMax(bytes) {
    this.maxBytes = bytes;
    this.prune();
  }

  files() {
    let names = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch {}
    return names
      .filter((n) => FILE_RE.test(n))
      .sort()
      .map((n) => {
        const p = path.join(this.dir, n);
        let size = 0;
        try {
          size = fs.statSync(p).size;
        } catch {}
        return { name: n, path: p, size };
      });
  }

  size() {
    let total = this.files().reduce((s, f) => s + f.size, 0);
    try {
      total += fs.statSync(path.join(this.dir, "summary.json")).size;
    } catch {}
    return total;
  }

  // s: { ts, house, net, mode, mbps, latency, loss, score, signal }
  add(s) {
    const row = {
      t: s.ts,
      h: s.house,
      n: s.net,
      md: s.mode || "normal",
      m: s.mbps === null || s.mbps === undefined ? null : Math.round(s.mbps * 100) / 100,
      l: s.latency === null || s.latency === undefined ? null : Math.round(s.latency * 10) / 10,
      p: Math.round(s.loss * 1000) / 1000,
      s: s.score === null || s.score === undefined ? null : Math.round(s.score * 100) / 100,
      g: s.signal ?? null,
      j: has(s.jitter) ? Math.round(s.jitter * 10) / 10 : null,
      x: has(s.maxLatency) ? Math.round(s.maxLatency * 10) / 10 : null,
      rx: s.link && has(s.link.rx) ? s.link.rx : null,
      tx: s.link && has(s.link.tx) ? s.link.tx : null,
      c: s.link && has(s.link.channel) ? s.link.channel : null,
      rd: s.link && s.link.radio ? s.link.radio : null,
    };
    try {
      fs.appendFileSync(path.join(this.dir, `samples-${dayKey(row.t)}.jsonl`), JSON.stringify(row) + "\n");
    } catch {}
    if (++this.writes % 40 === 0) this.prune();
  }

  // A failed attempt to join a network. Kept in the same daily file so pruning handles it too.
  event(ev) {
    try {
      fs.appendFileSync(path.join(this.dir, `samples-${dayKey(ev.ts)}.jsonl`), JSON.stringify({ t: ev.ts, h: ev.house, n: ev.net, ev: ev.type }) + "\n");
    } catch {}
  }

  readFile(f) {
    const out = [];
    let text = "";
    try {
      text = fs.readFileSync(f.path, "utf8");
    } catch {
      return out;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {}
    }
    return out;
  }

  // Writes every saved measurement to a CSV file, one row per measurement. Returns the row count.
  exportCsv(file, houseName = (id) => id) {
    const cols = ["time_utc", "unix_ms", "household", "network", "mode", "mbps", "latency_ms", "max_latency_ms", "jitter_ms", "packet_loss", "score", "signal_pct", "rx_mbps", "tx_mbps", "channel", "radio", "event"];
    const q = (v) => (v === null || v === undefined ? "" : /[",\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
    const fd = fs.openSync(file, "w");
    let rows = 0;
    try {
      fs.writeSync(fd, "\ufeff" + cols.join(",") + "\r\n");
      for (const f of this.files()) {
        let buf = "";
        for (const r of this.readFile(f)) {
          buf += [new Date(r.t).toISOString(), r.t, houseName(r.h), r.n, r.md, r.m, r.l, r.x, r.j, r.p, r.s, r.g, r.rx, r.tx, r.c, r.rd, r.ev].map(q).join(",") + "\r\n";
          rows++;
        }
        if (buf) fs.writeSync(fd, buf);
      }
    } finally {
      fs.closeSync(fd);
    }
    return rows;
  }

  summary() {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, "summary.json"), "utf8"));
    } catch {
      return {};
    }
  }

  // Averages per network for one household. since = 0 means everything, including pruned days.
  averages(house, since = 0) {
    const acc = {};
    const bucket = (n) => (acc[n] ||= fresh());
    if (!since) {
      for (const [key, v] of Object.entries(this.summary())) {
        const [h, ...rest] = key.split("|");
        if (h !== house) continue;
        const b = bucket(rest.join("|"));
        merge(b, v);
      }
    }
    for (const f of this.files()) {
      if (since && Date.parse(f.name.slice(8, 18)) + DAY < since) continue;
      for (const r of this.readFile(f)) {
        if (r.h !== house || r.t < since) continue;
        accumulate(bucket(r.n), r);
      }
    }
    const out = {};
    for (const [n, b] of Object.entries(acc)) {
      if (!b.n && !b.fails) continue;
      out[n] = {
        n: b.n,
        mbps: b.mN ? b.mbps / b.mN : null,
        latency: b.latN ? b.lat / b.latN : null,
        loss: b.n ? b.loss / b.n : 0,
        score: b.sN ? b.score / b.sN : null,
        jitter: b.jitN ? b.jit / b.jitN : null,
        signal: b.sigN ? b.sig / b.sigN : null,
        linkRate: b.rateN ? b.rate / b.rateN : null,
        topMbps: b.topMbps,
        lowMbps: b.lowMbps,
        peakLat: b.peakLat,
        fails: b.fails,
        band5: b.ch5 + b.ch24 ? b.ch5 / (b.ch5 + b.ch24) : null,
      };
    }
    return out;
  }

  // Same numbers as averages(), but on cleaned data: impossible values dropped, extreme outliers capped,
  // and one median row per 5 minute window so the network you stay on does not count more than the other.
  // Only uses the saved sample files, never the old summary, so the data is always the detailed kind.
  cleanAverages(house, since = 0) {
    const WIN = 5 * 60 * 1000;
    const med = (a) => {
      const v = a.filter(has).sort((x, y) => x - y);
      if (!v.length) return null;
      const m = v.length >> 1;
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    const quant = (v, q) => {
      const i = (v.length - 1) * q;
      const lo = Math.floor(i);
      return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (i - lo);
    };
    const groups = {};
    const fails = {};
    for (const f of this.files()) {
      if (since && Date.parse(f.name.slice(8, 18)) + DAY < since) continue;
      for (const r of this.readFile(f)) {
        if (r.h !== house || r.t < since) continue;
        if (r.ev === "joinfail") {
          fails[r.n] = (fails[r.n] || 0) + 1;
          continue;
        }
        const g = ((groups[r.n] ||= {})[Math.floor(r.t / WIN)] ||= []);
        g.push(r);
      }
    }
    const out = {};
    for (const n of new Set([...Object.keys(groups), ...Object.keys(fails)])) {
      const rows = Object.values(groups[n] || {}).map((g) => {
        const ok = (k, lo, hi) => g.map((r) => r[k]).filter((x) => has(x) && x > lo && x <= hi);
        return {
          m: med(ok("m", 0, 5000)),
          l: med(ok("l", 0, 5000)),
          x: med(ok("x", 0, 5000)),
          j: med(g.map((r) => r.j)),
          s: med(g.map((r) => r.s)),
          g: med(g.map((r) => r.g)),
          rx: med(g.map((r) => r.rx)),
          c: med(g.map((r) => r.c)),
          p: g.reduce((a, r) => a + (r.p || 0), 0) / g.length,
        };
      });
      for (const k of ["m", "l", "x", "j"]) {
        const v = rows.map((r) => r[k]).filter(has).sort((a, b) => a - b);
        if (v.length < 4) continue;
        const cap = quant(v, 0.75) + 1.5 * (quant(v, 0.75) - quant(v, 0.25));
        for (const r of rows) if (has(r[k]) && r[k] > cap) r[k] = cap;
      }
      const b = fresh();
      for (const r of rows) accumulate(b, r);
      b.fails = fails[n] || 0;
      if (!b.n && !b.fails) continue;
      out[n] = this.shape(b);
    }
    return out;
  }

  shape(b) {
    return {
      n: b.n,
      mbps: b.mN ? b.mbps / b.mN : null,
      latency: b.latN ? b.lat / b.latN : null,
      loss: b.n ? b.loss / b.n : 0,
      score: b.sN ? b.score / b.sN : null,
      jitter: b.jitN ? b.jit / b.jitN : null,
      signal: b.sigN ? b.sig / b.sigN : null,
      linkRate: b.rateN ? b.rate / b.rateN : null,
      topMbps: b.topMbps,
      lowMbps: b.lowMbps,
      peakLat: b.peakLat,
      fails: b.fails,
      band5: b.ch5 + b.ch24 ? b.ch5 / (b.ch5 + b.ch24) : null,
    };
  }

  prune() {
    const files = this.files();
    let total = this.size();
    if (total <= this.maxBytes) return 0;
    const target = this.maxBytes * 0.8;
    const today = dayKey(Date.now());
    const sum = this.summary();
    let removed = 0;
    for (const f of files) {
      if (total <= target) break;
      if (f.name.includes(today)) continue;
      for (const r of this.readFile(f)) accumulate((sum[`${r.h}|${r.n}`] ||= fresh()), r);
      try {
        fs.unlinkSync(f.path);
        total -= f.size;
        removed++;
      } catch {}
    }
    try {
      fs.writeFileSync(path.join(this.dir, "summary.json"), JSON.stringify(sum));
    } catch {}
    return removed;
  }
}

module.exports = { Store };
