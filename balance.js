// The same balancing rules as python/switcheroo_clean.py, so the Clean table and game mode agree with the Python results.
//   small gap     -> nothing is done
//   moderate gap  -> SMOTE: the smaller network gets new rows between a real row and one of its neighbours
//   large gap     -> SMOTEENN: SMOTE, then ENN drops rows in the wrong neighbourhood (at most 15 percent of a network)
// Neighbours are searched among the 30 rows before and after in time.
const FINE = 0.8;
const SEVERE = 0.4;
const NEAR = 30;
const FEATS = ["t", "m", "l", "x", "j", "p", "g", "rx", "c"];
const INTERP = ["t", "m", "l", "x", "j", "p", "s", "g", "rx", "c"];

function decide(counts) {
  const v = Object.values(counts);
  const big = Math.max(...v);
  const small = Math.min(...v);
  const ratio = big ? small / big : 1;
  if (ratio >= FINE) return { ratio, action: "nothing" };
  else if (ratio >= SEVERE) return { ratio, action: "smote" };
  else return { ratio, action: "smoteenn" };
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// rows scaled 0..1 on FEATS; missing values take the middle of the column
function scaled(rows) {
  const lo = {};
  const hi = {};
  const mid = {};
  for (const f of FEATS) {
    const v = rows.map((r) => r[f]).filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
    lo[f] = v.length ? v[0] : 0;
    hi[f] = v.length ? v[v.length - 1] : 1;
    mid[f] = v.length ? v[v.length >> 1] : 0;
  }
  return rows.map((r) =>
    FEATS.map((f) => {
      const x = r[f] === null || r[f] === undefined ? mid[f] : r[f];
      return hi[f] > lo[f] ? (x - lo[f]) / (hi[f] - lo[f]) : 0;
    })
  );
}

// for each row of a time sorted list: indexes of its k closest rows among the NEAR before and after
function neighbours(Z, k) {
  const out = [];
  for (let i = 0; i < Z.length; i++) {
    const cand = [];
    for (let j = Math.max(0, i - NEAR); j < Math.min(Z.length, i + NEAR + 1); j++) {
      if (j !== i) cand.push(j);
    }
    const scored = cand.map((j) => {
      let d = 0;
      for (let f = 0; f < Z[i].length; f++) d += (Z[j][f] - Z[i][f]) ** 2;
      return [d, j];
    });
    scored.sort((a, b) => a[0] - b[0]);
    out.push(scored.slice(0, k).map((s) => s[1]));
  }
  return out;
}

function smote(rows, target, rand) {
  const d = rows.slice().sort((a, b) => a.t - b.t);
  const need = target - d.length;
  if (need <= 0 || d.length < 2) return [];
  const nb = neighbours(scaled(d), 5);
  const out = [];
  for (let n = 0; n < need; n++) {
    const i = Math.floor(rand() * d.length);
    const list = nb[i];
    const j = list.length ? list[Math.floor(rand() * list.length)] : i;
    const lam = rand();
    const r = { ...d[i] };
    for (const f of INTERP) {
      const a = d[i][f];
      const b = d[j][f];
      r[f] = a === null || a === undefined || b === null || b === undefined ? null : a + lam * (b - a);
    }
    r.t = Math.round(r.t);
    r.synthetic = true;
    out.push(r);
  }
  return out;
}

// rows: all rows of all networks, each with .n (network)
function enn(rows, k = 3, max = 0.15) {
  const d = rows.slice().sort((a, b) => a.t - b.t);
  if (d.length <= k + 1) return d;
  const nb = neighbours(scaled(d), k);
  const dis = d.map((r, i) => (nb[i].length ? nb[i].filter((j) => d[j].n !== r.n).length / nb[i].length : 0));
  const drop = new Set();
  for (const net of new Set(d.map((r) => r.n))) {
    const idx = d.map((r, i) => i).filter((i) => d[i].n === net && dis[i] > 0.5);
    idx.sort((a, b) => dis[b] - dis[a] || a - b);
    const cap = Math.floor(d.filter((r) => r.n === net).length * max);
    idx.slice(0, cap).forEach((i) => drop.add(i));
  }
  return d.filter((r, i) => !drop.has(i));
}

// byNet: { network: [rows] }. Returns { byNet, action, ratio, synthetic }
function balance(byNet, seed = 7) {
  const counts = {};
  for (const [n, rows] of Object.entries(byNet)) counts[n] = rows.length;
  if (Object.keys(counts).length < 2) return { byNet, action: "nothing", ratio: 1, synthetic: 0 };
  const { ratio, action } = decide(counts);
  if (action === "nothing") return { byNet, action, ratio, synthetic: 0 };
  const rand = rng(seed);
  const target = Math.max(...Object.values(counts));
  let all = [];
  let synthetic = 0;
  for (const [n, rows] of Object.entries(byNet)) {
    const extra = rows.length < target ? smote(rows, target, rand) : [];
    synthetic += extra.length;
    all = all.concat(rows, extra);
  }
  if (action === "smoteenn") all = enn(all);
  const out = {};
  for (const r of all) (out[r.n] ||= []).push(r);
  for (const n of Object.keys(byNet)) out[n] ||= [];
  return { byNet: out, action, ratio, synthetic };
}

module.exports = { balance, decide, smote, enn, FINE, SEVERE };
