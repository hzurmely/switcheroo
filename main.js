const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { Engine } = require("./engine");
const sys = require("./netwin");

const ASSETS = __dirname;
const hiddenStart = process.argv.includes("--hidden");

let win = null;
let tray = null;
let engine = null;
let quitting = false;
const cache = { logs: [], status: {}, active: null, series: [] };

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

// ---------------------------------------------------------------- engine control

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function startEngine(a, b) {
  if (engine || !a || !b || a === b) return false;
  cache.status = {};
  cache.series = [];
  cache.active = null;
  engine = new Engine(sys, [a, b]);
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
    send("status", s);
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
  saveSettings({ a, b, running: true });
  send("running", true);
  engine.run();
  updateTray();
  return true;
}

function stopEngine() {
  if (engine) engine.stop();
  engine = null;
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
      ? `Switcheroo: on ${cache.active || "..."}${s ? ", " + s.m.mbps.toFixed(1) + " Mbps" : ""}`
      : "Switcheroo: paused"
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Switcheroo", click: showWindow },
      {
        label: running ? "Pause switching" : "Resume switching",
        click: () => {
          const st = loadSettings();
          if (running) stopEngine();
          else if (!startEngine(st.a, st.b)) showWindow();
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

ipcMain.handle("state", async () => {
  const s = loadSettings();
  return {
    profiles: await sys.profiles(),
    a: s.a || "",
    b: s.b || "",
    running: !!engine,
    autostart: autostartOn(),
    active: cache.active,
    status: cache.status,
    series: cache.series,
    logs: cache.logs,
  };
});
ipcMain.handle("profiles", () => sys.profiles());
ipcMain.handle("start", (_e, a, b) => startEngine(a, b));
ipcMain.handle("stop", () => stopEngine());
ipcMain.handle("autostart", (_e, on) => {
  setAutostart(on);
  updateTray();
  return autostartOn();
});

// ---------------------------------------------------------------- lifecycle

app.whenReady().then(() => {
  app.setAppUserModelId("com.hzurmely.switcheroo");
  createWindow();
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, "tray-off.png")));
  tray.on("click", showWindow);
  updateTray();

  const s = loadSettings();
  if (s.running && s.a && s.b) startEngine(s.a, s.b);
});

app.on("before-quit", () => {
  quitting = true;
  if (engine) engine.stop();
});
app.on("window-all-closed", () => {});
