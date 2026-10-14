const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  state: () => ipcRenderer.invoke("state"),
  profiles: () => ipcRenderer.invoke("profiles"),
  start: () => ipcRenderer.invoke("start"),
  averages: (range) => ipcRenderer.invoke("averages", range),
  cleanAverages: (range) => ipcRenderer.invoke("averages:clean", range),
  storage: () => ipcRenderer.invoke("storage"),
  saveHouse: (h) => ipcRenderer.invoke("house:save", h),
  selectHouse: (id) => ipcRenderer.invoke("house:select", id),
  deleteHouse: (id) => ipcRenderer.invoke("house:delete", id),
  exportCsv: (range, text) => ipcRenderer.invoke("avg:csv", range, text),
  runAnalysis: () => ipcRenderer.invoke("analysis:run"),
  lastAnalysis: () => ipcRenderer.invoke("analysis:last"),
  analysisImage: (n) => ipcRenderer.invoke("analysis:image", n),
  openAnalysis: () => ipcRenderer.invoke("analysis:open"),
  exportRaw: () => ipcRenderer.invoke("data:csv"),
  revealFile: (f) => ipcRenderer.invoke("data:reveal", f),
  setPrefs: (p) => ipcRenderer.invoke("prefs:set", p),
  openData: () => ipcRenderer.invoke("data:open"),
  chooseData: () => ipcRenderer.invoke("data:choose"),
  stop: () => ipcRenderer.invoke("stop"),
  scanGames: () => ipcRenderer.invoke("games:scan"),
  detectHouse: () => ipcRenderer.invoke("house:detect"),
  updateState: () => ipcRenderer.invoke("update:state"),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  setAutostart: (on) => ipcRenderer.invoke("autostart", on),
  on: (channel, cb) => {
    const allowed = ["log", "status", "active", "running", "autostart", "game", "houses", "update"];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
});
