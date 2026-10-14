// Checks GitHub releases for a newer version, downloads it quietly and installs it when the app quits.
const { app } = require("electron");

let autoUpdater = null;
let ready = false;

function init({ log, onReady }) {
  if (!app.isPackaged) return; // only the installed app updates itself
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (i) => log(`Update ${i.version} found, downloading`));
  autoUpdater.on("update-downloaded", (i) => {
    ready = true;
    log(`Update ${i.version} is ready. It installs when you quit, or use Restart to update in the tray menu`);
    onReady(i.version);
  });
  autoUpdater.on("error", () => {}); // offline or rate limited, try again later
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 15000);
  setInterval(check, 4 * 3600000);
}

function check() {
  if (autoUpdater) autoUpdater.checkForUpdates().catch(() => {});
}

function installNow() {
  if (autoUpdater && ready) autoUpdater.quitAndInstall(false, true);
}

module.exports = { init, check, installNow, isReady: () => ready };
