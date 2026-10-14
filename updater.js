// Checks GitHub releases for a newer version, downloads it quietly and installs it when the app quits.
const { app } = require("electron");

let autoUpdater = null;
let ready = false;
let state = { state: "idle", current: "", version: null, percent: 0, message: "" };
let onState = () => {};

function set(patch) {
  state = { ...state, current: app.getVersion(), ...patch };
  onState(state);
}

function init({ log, onReady, onChange, auto }) {
  onState = onChange || onState;
  state.current = app.getVersion();
  if (!app.isPackaged) {
    set({ state: "dev", message: "Updates only work in the installed app." });
    return;
  }
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    set({ state: "error", message: "The updater could not start." });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => set({ state: "checking", message: "" }));
  autoUpdater.on("update-not-available", () => set({ state: "latest", message: "You have the newest version." }));
  autoUpdater.on("update-available", (i) => {
    log(`Update ${i.version} found, downloading`);
    set({ state: "downloading", version: i.version, percent: 0, message: "" });
  });
  autoUpdater.on("download-progress", (p) => set({ state: "downloading", percent: Math.round(p.percent || 0) }));
  autoUpdater.on("update-downloaded", (i) => {
    ready = true;
    log(`Update ${i.version} is ready. It installs when you quit, or use Restart to update`);
    set({ state: "ready", version: i.version, percent: 100, message: "" });
    onReady(i.version);
  });
  autoUpdater.on("error", () => set({ state: "error", message: "Could not reach GitHub. Try again later." }));
  const check = () => {
    if (auto && !auto()) return;
    autoUpdater.checkForUpdates().catch(() => {});
  };
  setTimeout(check, 15000);
  setInterval(check, 4 * 3600000);
}

function check() {
  if (!autoUpdater) return;
  if (state.state === "checking" || state.state === "downloading" || ready) return;
  autoUpdater.checkForUpdates().catch(() => {});
}

function installNow() {
  if (autoUpdater && ready) autoUpdater.quitAndInstall(false, true);
}

module.exports = { init, check, installNow, isReady: () => ready, getState: () => ({ ...state, current: app.getVersion() }) };
