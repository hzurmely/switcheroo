// Saves every measurement to a folder and keeps that folder under a size limit.
// One JSONL file per day. When the folder grows past the limit, the oldest days
// are folded into summary.json (so lifetime averages survive) and deleted.
const fs = require("fs");
const path = require("path");

const DAY = 86400000;
const FILE_RE = /^samples-(\d{4}-\d{2}-\d{2})\.jsonl$/;

const fresh = () => ({ n: 0, mbps: 0, mN: 0, lat: 0, latN: 0, loss: 0, score: 0, sN: 0 });
function accumulate(b, r) {
  b.n++;
  b.loss += r.p;
  if (r.m !== null && r.m !== undefined) {
    b.mbps += r.m;
    b.mN++;
  }
  if (r.s !== null && r.s !== undefined) {
    b.score += r.s;
    b.sN++;
  }
  if (r.l !== null && r.l !== undefined) {
    b.lat += r.l;
    b.latN++;
  }
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
    };
    try {
      fs.appendFileSync(path.join(this.dir, `samples-${dayKey(row.t)}.jsonl`), JSON.stringify(row) + "\n");
    } catch {}
    if (++this.writes % 40 === 0) this.prune();
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
        for (const k of Object.keys(b)) b[k] += v[k] || 0;
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
      if (!b.n) continue;
      out[n] = {
        n: b.n,
        mbps: b.mN ? b.mbps / b.mN : null,
        latency: b.latN ? b.lat / b.latN : null,
        loss: b.loss / b.n,
        score: b.sN ? b.score / b.sN : null,
      };
    }
    return out;
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
