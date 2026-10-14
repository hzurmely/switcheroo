const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { Engine } = require("./engine");
const sys = process.platform === "darwin" ? require("./netmac") : require("./netwin");
const { Store } = require("./store");
const games = require("./games");
const updater = require("./updater");
const { detectPair } = require("./detect");
let updateVersion = null;

const ASSETS = __dirname;
const hiddenStart = process.argv.includes("--hidden");

let win = null;
let tray = null;
let engine = null;
let quitting = false;
const cache = { logs: [], status: {}, active: null, series: [], game: null };
let store = null;
let runHouse = null; // household the running engine belongs to
const avgCache = {};

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on("second-instance", () => showWindow());

// ---------------------------------------------------------------- settings

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next));
  } catch {}
  return next;
}

// ---------------------------------------------------------------- households

function houses() {
  const st = loadSettings();
  if (Array.isArray(st.houses)) return st.houses;
  if (st.a && st.b) {
    const h = [{ id: "h1", name: "Home", a: st.a, b: st.b }];
    saveSettings({ houses: h, house: "h1" });
    return h;
  }
  return [];
}
function currentHouse() {
  const list = houses();
  const id = loadSettings().house;
  return list.find((h) => h.id === id) || list[0] || null;
}
const sameName = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function getAverages(range) {
  const h = currentHouse();
  if (!h || !store) return {};
  const key = h.id + "|" + range;
  const hit = avgCache[key];
  if (hit && Date.now() - hit.at < 20000) return hit.v;
  const since = range === "day" ? Date.now() - 86400000 : range === "week" ? Date.now() - 7 * 86400000 : 0;
  const v = store.averages(h.id, since);
  avgCache[key] = { at: Date.now(), v };
  return v;
}

function storageInfo() {
  return { dir: store.dir, size: store.size(), max: store.maxBytes };
}

// ---------------------------------------------------------------- engine control

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

let lastStartError = "";
function startEngine() {
  const house = currentHouse();
  if (!house || !house.a || !house.b) { lastStartError = "Choose both networks first."; return false; }
  if (house.a === house.b) { lastStartError = "Pick two different networks."; return false; }
  if (engine) { lastStartError = "Already switching."; return false; }
  lastStartError = "";
  const a = house.a;
  const b = house.b;
  runHouse = house.id;
  cache.game = null;
  cache.status = {};
  cache.series = [];
  cache.active = null;
  engine = new Engine(sys, [a, b], {
    averages: () => {
      if (!store) return {};
      // game mode ranks networks on the cleaned, balanced data, and falls back to the raw averages when there is none yet
      const clean = store.cleanAverages(house.id);
      return Object.keys(clean).length ? clean : store.averages(house.id);
    },
  });
  const mine = engine;
  engine.on("log", (e) => {
    if (engine !== mine) return;
    cache.logs.push(e);
    if (cache.logs.length > 200) cache.logs.shift();
    send("log", e);
  });
  engine.on("status", (s) => {
    if (engine !== mine) return;
    cache.status[s.net] = s;
    cache.series.push({ net: s.net, score: s.m.score, ts: s.ts });
    if (cache.series.length > 120) cache.series.shift();
    if (store) store.add({ ...s.m, ts: s.ts, house: house.id, net: s.net, mode: s.mode, signal: s.signal, link: s.link });
    send("status", s);
    updateTray();
  });
  engine.on("joinfail", (f) => {
    if (engine !== mine) return;
    if (store) store.event({ ts: f.ts, house: house.id, net: f.net, type: "joinfail" });
  });
  engine.on("game", (g) => {
    if (engine !== mine) return;
    cache.game = g;
    send("game", g);
    updateTray();
  });
  engine.on("active", (n) => {
    if (engine !== mine) return;
    cache.active = n;
    send("active", n);
    updateTray();
  });
  engine.on("running", (r) => {
    if (!r && engine === mine) engine = null;
    send("running", !!engine);
    updateTray();
  });
  saveSettings({ running: true });
  send("running", true);
  engine.run().catch(() => {});
  updateTray();
  return true;
}

function stopEngine() {
  if (engine) engine.stop();
  engine = null;
  cache.game = null;
  send("game", null);
  saveSettings({ running: false });
  send("running", false);
  updateTray();
}

// ---------------------------------------------------------------- window and tray

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 680,
    minWidth: 820,
    minHeight: 540,
    show: false,
    backgroundColor: "#1e1f22",
    title: "Switcheroo",
    icon: path.join(ASSETS, "icon.png"),
    ...(process.platform === "win32"
      ? { titleBarStyle: "hidden", titleBarOverlay: { color: "#1e1f22", symbolColor: "#dbdee1", height: 32 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.on("did-finish-load", () => {
    if (process.platform !== "win32") win.webContents.insertCSS(".titlebar{display:none}").catch(() => {});
  });
  win.once("ready-to-show", () => {
    if (!hiddenStart) win.show();
  });
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function showWindow() {
  if (!win) return;
  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

function autostartOn() {
  // Windows only reports the entry when asked with the same arguments it was saved with.
  return app.getLoginItemSettings({ args: ["--hidden"] }).openAtLogin || app.getLoginItemSettings().openAtLogin;
}

function setAutostart(on) {
  app.setLoginItemSettings({ openAtLogin: !!on, args: ["--hidden"] });
  if (!on) app.setLoginItemSettings({ openAtLogin: false });
}

function updateTray() {
  if (!tray) return;
  const running = !!engine;
  tray.setImage(nativeImage.createFromPath(path.join(ASSETS, running ? "tray-on.png" : "tray-off.png")));
  const s = cache.active && cache.status[cache.active];
  tray.setToolTip(
    running
      ? `Switcheroo${cache.game ? " (game mode)" : ""}: on ${cache.active || "..."}${s && s.m.mbps != null ? ", " + s.m.mbps.toFixed(1) + " Mbps" : ""}`
      : "Switcheroo: paused"
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Switcheroo", click: showWindow },
      {
        label: running ? "Pause switching" : "Resume switching",
        click: () => {
          if (running) stopEngine();
          else if (!startEngine()) showWindow();
        },
      },
      {
        label: "Start with Windows",
        type: "checkbox",
        checked: autostartOn(),
        click: (item) => {
          setAutostart(item.checked);
          send("autostart", item.checked);
        },
      },
      updateVersion
        ? { label: `Restart to update to ${updateVersion}`, click: () => { quitting = true; updater.installNow(); } }
        : { label: "Check for updates", click: () => updater.check() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          stopEngine();
          app.quit();
        },
      },
    ])
  );
}

// ---------------------------------------------------------------- IPC

function fullState() {
  const st = loadSettings();
  return {
    houses: houses(),
    house: (currentHouse() || {}).id || null,
    running: !!engine,
    autostart: autostartOn(),
    active: cache.active,
    status: cache.status,
    series: cache.series,
    logs: cache.logs,
    game: cache.game,
    prefs: { game: st.game !== false, extraGames: st.extraGames || [], maxMb: st.maxMb || 50, autoDetect: st.autoDetect !== false, autoUpdate: st.autoUpdate !== false },
    storage: storageInfo(),
  };
}

ipcMain.handle("state", async () => ({ ...fullState(), profiles: await sys.profiles() }));
ipcMain.handle("profiles", () => sys.profiles());
ipcMain.handle("averages", (_e, range) => getAverages(range));
ipcMain.handle("averages:clean", (_e, range) => {
  const h = currentHouse();
  if (!h || !store) return {};
  const since = range === "day" ? Date.now() - 86400000 : range === "week" ? Date.now() - 7 * 86400000 : 0;
  return store.cleanAverages(h.id, since);
});
ipcMain.handle("storage", () => storageInfo());

// Add or update a household: { id?, name, a, b }
ipcMain.handle("house:save", (_e, h) => {
  const list = houses().slice();
  const clean = { id: h.id || "h" + Date.now().toString(36), name: String(h.name || "House").slice(0, 24), a: h.a || "", b: h.b || "" };
  const i = list.findIndex((x) => x.id === clean.id);
  if (i >= 0) list[i] = clean;
  else list.push(clean);
  const wasRunning = !!engine && runHouse === clean.id;
  saveSettings({ houses: list, house: clean.id });
  if (engine && (wasRunning || runHouse !== clean.id)) {
    stopEngine();
    startEngine();
  }
  send("houses", { houses: list, house: clean.id });
  return clean.id;
});
ipcMain.handle("house:select", (_e, id) => {
  if (!houses().some((h) => h.id === id)) return false;
  const was = !!engine;
  if (was) stopEngine();
  saveSettings({ house: id });
  cache.status = {};
  cache.series = [];
  cache.active = null;
  if (was) startEngine();
  send("houses", { houses: houses(), house: id });
  return true;
});
ipcMain.handle("house:delete", (_e, id) => {
  const list = houses().filter((h) => h.id !== id);
  const was = !!engine && runHouse === id;
  if (was) stopEngine();
  saveSettings({ houses: list, house: list[0] ? list[0].id : null });
  send("houses", { houses: list, house: list[0] ? list[0].id : null });
  return true;
});

ipcMain.handle("start", async () => {
  const ok = startEngine();
  if (!ok && lastStartError === "Already switching.") send("running", true);
  return { ok, why: ok ? "" : lastStartError };
});
ipcMain.handle("stop", () => stopEngine());
ipcMain.handle("update:state", () => updater.getState());
ipcMain.handle("update:check", () => updater.check());
ipcMain.handle("update:install", () => {
  quitting = true;
  updater.installNow();
});
ipcMain.handle("autostart", (_e, on) => {
  setAutostart(on);
  updateTray();
  return autostartOn();
});

ipcMain.handle("prefs:set", (_e, p) => {
  const patch = {};
  if (typeof p.game === "boolean") patch.game = p.game;
  if (typeof p.autoDetect === "boolean") patch.autoDetect = p.autoDetect;
  if (typeof p.autoUpdate === "boolean") patch.autoUpdate = p.autoUpdate;
  if (Array.isArray(p.extraGames)) patch.extraGames = p.extraGames.map(String).slice(0, 50);
  if (Number(p.maxMb) >= 5) {
    patch.maxMb = Math.min(5000, Math.floor(Number(p.maxMb)));
    store.setMax(patch.maxMb * 1024 * 1024);
  }
  saveSettings(patch);
  if (patch.game === false && engine) engine.setGame(null);
  return fullState().prefs;
});
ipcMain.handle("data:open", () => shell.openPath(store.dir));
ipcMain.handle("data:reveal", (_e, file) => {
  if (typeof file === "string" && path.dirname(file) === store.dir) shell.showItemInFolder(file);
});
ipcMain.handle("data:csv", () => {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const file = path.join(store.dir, `raw-samples-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}.csv`);
  const names = Object.fromEntries(houses().map((h) => [h.id, h.name]));
  try {
    const rows = store.exportCsv(file, (id) => names[id] || id);
    return { ok: true, file, rows };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});
// ---- Python analysis: cleans the data, fixes oversampling, makes graphs
function runPy(args, timeout) {
  return new Promise((resolve) => {
    const tries = [["py", ["-3"]], ["python", []], ["python3", []]];
    const pe = pyenvGet();
    if (pe.isReady()) tries.unshift([pe.exe(), []]);
    const next = (i) => {
      if (i >= tries.length) return resolve({ missing: true });
      const [cmd, pre] = tries[i];
      require("child_process").execFile(cmd, [...pre, ...args], { timeout, maxBuffer: 32 << 20, windowsHide: true }, (err, out, errOut) => {
        if (err && (err.code === "ENOENT" || /not recognized|was not found|Microsoft Store/i.test(String(errOut)))) return next(i + 1);
        resolve({ err, out: String(out || ""), errOut: String(errOut || "") });
      });
    };
    next(0);
  });
}
const analysisDir = () => path.join(store.dir, "analysis");

// ---- Python tab: private python, notebook kernel, small terminal
let pyenvMod = null;
function pyenvGet() {
  if (!pyenvMod) {
    pyenvMod = require("./pyenv").create({
      root: app.getPath("userData"),
      kernelScript: path.join(__dirname, "python", "kernel.py"),
      onProgress: (p) => send("pyprogress", p),
    });
  }
  return pyenvMod;
}
// refreshes raw.csv with the newest measurements and returns the folder the kernel reads from
function pyData() {
  const dir = analysisDir();
  fs.mkdirSync(dir, { recursive: true });
  store.exportCsv(path.join(dir, "raw.csv"), (id) => (houses().find((x) => x.id === id) || {}).name || id);
  return dir;
}
ipcMain.handle("py:status", () => pyenvGet().status());
ipcMain.handle("py:setup", () => pyenvGet().setup());
ipcMain.handle("py:run", (_e, code) => pyenvGet().runCell(String(code || ""), pyData));
ipcMain.handle("py:reload", () => pyenvGet().reload(pyData));
ipcMain.handle("py:restart", () => {
  pyenvGet().stop();
  return true;
});
ipcMain.handle("py:term", (_e, line) => pyenvGet().term(line, analysisDir(), pyData));
const nbFile = () => path.join(app.getPath("userData"), "notebook.json");
ipcMain.handle("py:nbload", () => {
  try {
    return JSON.parse(fs.readFileSync(nbFile(), "utf8"));
  } catch {
    return null;
  }
});
ipcMain.handle("py:nbsave", (_e, cells) => {
  try {
    fs.writeFileSync(nbFile(), JSON.stringify(cells));
  } catch {}
  return true;
});
const GRAPHS = ["samples.png", "speed_time.png", "speed_box.png", "latency_hist.png", "speed_hour.png"];
ipcMain.handle("analysis:run", async () => {
  const h = currentHouse();
  const dir = analysisDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const raw = path.join(dir, "raw.csv");
    store.exportCsv(raw, (id) => (houses().find((x) => x.id === id) || {}).name || id);
    const script = path.join(__dirname, "python", "analyze.py").replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
    const chk = await runPy(["-c", "import pandas, numpy, matplotlib"], 30000);
    if (chk.missing) return { ok: false, error: "Python was not found. Install Python 3 from python.org (tick Add to PATH), then try again." };
    if (chk.err) return { ok: false, error: "Python needs three packages. Open Command Prompt and run: python -m pip install pandas numpy matplotlib" };
    const r = await runPy([script, raw, dir, (h && h.a) || "", (h && h.name) || ""], 180000);
    if (r.err) return { ok: false, error: (r.errOut || String(r.err.message)).split(/\r?\n/).filter(Boolean).slice(-2).join(" ") };
    const out = JSON.parse(r.out.trim().split(/\r?\n/).pop());
    out.dir = dir;
    return out;
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});
ipcMain.handle("analysis:last", () => {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(analysisDir(), "summary.json"), "utf8"));
    s.dir = analysisDir();
    return s;
  } catch {
    return null;
  }
});
ipcMain.handle("analysis:image", (_e, name) => {
  if (!GRAPHS.includes(name)) return null;
  try {
    return "data:image/png;base64," + fs.readFileSync(path.join(analysisDir(), name)).toString("base64");
  } catch {
    return null;
  }
});
ipcMain.handle("analysis:open", () => shell.openPath(analysisDir()));
ipcMain.handle("avg:csv", (_e, range, text) => {
  const safe = ["day", "week", "all"].includes(range) ? range : "all";
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
  const file = path.join(store.dir, `averages-${safe}-${stamp}.csv`);
  try {
    fs.writeFileSync(file, "\ufeff" + String(text), "utf8");
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});
ipcMain.handle("data:choose", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], defaultPath: store.dir });
  if (r.canceled || !r.filePaths[0]) return storageInfo();
  const dir = r.filePaths[0];
  store.setDir(dir);
  saveSettings({ dataDir: dir });
  for (const k of Object.keys(avgCache)) delete avgCache[k];
  return storageInfo();
});

// ---------------------------------------------------------------- background watchers

// Looks for a running game and tells the engine.
async function watchGames() {
  if (!engine) return;
  const st = loadSettings();
  if (st.game === false) return;
  const found = await games.detect(st.extraGames || []);
  if (engine) engine.setGame(found);
}

ipcMain.handle("games:scan", async () => {
  const r = await games.scan(loadSettings().extraGames || []);
  r.running = !!engine;
  r.enabled = loadSettings().game !== false;
  return r;
});

function goToHouse(id, text) {
  const was = !!engine;
  if (was) stopEngine();
  saveSettings({ house: id });
  cache.status = {};
  cache.series = [];
  cache.active = null;
  if (was) startEngine();
  send("houses", { houses: houses(), house: id });
  if (text) {
    const e = { ts: Date.now(), text };
    cache.logs.push(e);
    send("log", e);
  }
}

// Builds a household from the connected network and its partner, when the names make it obvious.
async function autoCreateHouse(ssid, manual) {
  const list = houses();
  const owner = list.find((h) => sameName(h.a, ssid) || sameName(h.b, ssid));
  if (owner) return { ok: false, message: `${ssid} already belongs to ${owner.name}.` };
  const pair = detectPair(ssid, await sys.profiles());
  if (!pair) {
    return { ok: false, message: `No partner network found for ${ssid}. Name both networks alike, like Home and Home_5G.` };
  }
  let name = pair.name;
  let n = 2;
  while (list.some((h) => sameName(h.name, name))) name = `${pair.name.slice(0, 20)} ${n++}`;
  const house = { id: "h" + Date.now().toString(36), name, a: pair.a, b: pair.b };
  saveSettings({ houses: [...list, house] });
  goToHouse(house.id, `New household found: ${name} (${pair.a} and ${pair.b})`);
  return { ok: true, name, a: pair.a, b: pair.b, manual: !!manual };
}

// If the PC joins a network that belongs to another household, follow it.
// If it joins a network that belongs to none, try to build a household from it.
async function watchLocation() {
  const c = await sys.current();
  if (!c.ssid) return;
  const list = houses();
  const cur = currentHouse();
  if (cur && (sameName(cur.a, c.ssid) || sameName(cur.b, c.ssid))) return;
  const match = list.find((h) => sameName(h.a, c.ssid) || sameName(h.b, c.ssid));
  if (match) return goToHouse(match.id, `Arrived at ${match.name}, switched household`);
  if (loadSettings().autoDetect !== false) await autoCreateHouse(c.ssid, false);
}

ipcMain.handle("house:detect", async () => {
  const c = await sys.current();
  if (!c.ssid) return { ok: false, message: "Connect to a Wi-Fi network first." };
  return autoCreateHouse(c.ssid, true);
});

// ---------------------------------------------------------------- lifecycle

app.whenReady().then(() => {
  app.setAppUserModelId("com.hzurmely.switcheroo");
  // Rewrite the startup entry so older installs also start hidden in the tray.
  if (autostartOn()) setAutostart(true);
  games.init(app.getPath("userData")).catch(() => {});
  createWindow();
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, "tray-off.png")));
  tray.on("click", showWindow);
  updateTray();

  updater.init({
    auto: () => loadSettings().autoUpdate !== false,
    log: (text) => {
      const e = { ts: Date.now(), text };
      cache.logs.push(e);
      send("log", e);
    },
    onReady: (v) => {
      updateVersion = v;
      updateTray();
    },
    onChange: (s) => send("update", s),
  });

  const s = loadSettings();
  const dir = s.dataDir || path.join(app.getPath("documents"), "Switcheroo Data");
  store = new Store(dir, (s.maxMb || 50) * 1024 * 1024);
  store.prune();
  setInterval(() => store.prune(), 3600000);
  setInterval(() => watchGames().catch(() => {}), 15000);
  setInterval(() => watchLocation().catch(() => {}), 25000);

  watchLocation().catch(() => {}).finally(() => {
    if (s.running) startEngine();
  });
});

app.on("before-quit", () => {
  if (pyenvMod) pyenvMod.stop();
  quitting = true;
  if (engine) engine.stop();
});
app.on("window-all-closed", () => {});
app.on("activate", () => showWindow());
