const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { Engine } = require("./engine");
const sys = require("./netwin");
const { Store } = require("./store");
const games = require("./games");
const updater = require("./updater");
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

function startEngine() {
  const house = currentHouse();
  if (engine || !house || !house.a || !house.b || house.a === house.b) return false;
  const a = house.a;
  const b = house.b;
  runHouse = house.id;
  cache.game = null;
  cache.status = {};
  cache.series = [];
  cache.active = null;
  engine = new Engine(sys, [a, b], { averages: () => (store ? store.averages(house.id) : {}) });
  const mine = engine;
  engine.on("log", (e) => {
    cache.logs.push(e);
    if (cache.logs.length > 200) cache.logs.shift();
    send("log", e);
  });
  engine.on("status", (s) => {
    cache.status[s.net] = s;
    cache.series.push({ net: s.net, score: s.m.score, ts: s.ts });
    if (cache.series.length > 120) cache.series.shift();
    if (store) store.add({ ...s.m, ts: s.ts, house: house.id, net: s.net, mode: s.mode, signal: s.signal });
    send("status", s);
    updateTray();
  });
  engine.on("game", (g) => {
    cache.game = g;
    send("game", g);
    updateTray();
  });
  engine.on("active", (n) => {
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
  engine.run();
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
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#1e1f22", symbolColor: "#dbdee1", height: 32 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "index.html"));
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
  return app.getLoginItemSettings().openAtLogin;
}

function setAutostart(on) {
  app.setLoginItemSettings({ openAtLogin: !!on, args: ["--hidden"] });
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
    prefs: { game: st.game !== false, extraGames: st.extraGames || [], maxMb: st.maxMb || 50 },
    storage: storageInfo(),
  };
}

ipcMain.handle("state", async () => ({ ...fullState(), profiles: await sys.profiles() }));
ipcMain.handle("profiles", () => sys.profiles());
ipcMain.handle("averages", (_e, range) => getAverages(range));
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

ipcMain.handle("start", () => startEngine());
ipcMain.handle("stop", () => stopEngine());
ipcMain.handle("autostart", (_e, on) => {
  setAutostart(on);
  updateTray();
  return autostartOn();
});

ipcMain.handle("prefs:set", (_e, p) => {
  const patch = {};
  if (typeof p.game === "boolean") patch.game = p.game;
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

// If the PC joins a network that belongs to another household, follow it.
async function watchLocation() {
  const list = houses();
  if (list.length < 2) return;
  const c = await sys.current();
  if (!c.ssid) return;
  const cur = currentHouse();
  if (cur && (sameName(cur.a, c.ssid) || sameName(cur.b, c.ssid))) return;
  const match = list.find((h) => sameName(h.a, c.ssid) || sameName(h.b, c.ssid));
  if (!match) return;
  const was = !!engine;
  if (was) stopEngine();
  saveSettings({ house: match.id });
  cache.status = {};
  cache.series = [];
  cache.active = null;
  if (was) startEngine();
  send("houses", { houses: list, house: match.id });
  send("log", { ts: Date.now(), text: `Arrived at ${match.name}, switched household` });
}

// ---------------------------------------------------------------- lifecycle

app.whenReady().then(() => {
  app.setAppUserModelId("com.hzurmely.switcheroo");
  createWindow();
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, "tray-off.png")));
  tray.on("click", showWindow);
  updateTray();

  updater.init({
    log: (text) => {
      const e = { ts: Date.now(), text };
      cache.logs.push(e);
      send("log", e);
    },
    onReady: (v) => {
      updateVersion = v;
      updateTray();
    },
  });

  const s = loadSettings();
  const dir = s.dataDir || path.join(app.getPath("documents"), "Switcheroo Data");
  store = new Store(dir, (s.maxMb || 50) * 1024 * 1024);
  store.prune();
  setInterval(() => store.prune(), 3600000);
  setInterval(() => watchGames().catch(() => {}), 10000);
  setInterval(() => watchLocation().catch(() => {}), 25000);

  watchLocation().catch(() => {}).finally(() => {
    if (s.running) startEngine();
  });
});

app.on("before-quit", () => {
  quitting = true;
  if (engine) engine.stop();
});
app.on("window-all-closed", () => {});
