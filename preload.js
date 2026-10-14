const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  state: () => ipcRenderer.invoke("state"),
  profiles: () => ipcRenderer.invoke("profiles"),
  start: () => ipcRenderer.invoke("start"),
  averages: (range) => ipcRenderer.invoke("averages", range),
  storage: () => ipcRenderer.invoke("storage"),
  saveHouse: (h) => ipcRenderer.invoke("house:save", h),
  selectHouse: (id) => ipcRenderer.invoke("house:select", id),
  deleteHouse: (id) => ipcRenderer.invoke("house:delete", id),
  setPrefs: (p) => ipcRenderer.invoke("prefs:set", p),
  openData: () => ipcRenderer.invoke("data:open"),
  chooseData: () => ipcRenderer.invoke("data:choose"),
  stop: () => ipcRenderer.invoke("stop"),
  updateState: () => ipcRenderer.invoke("update:state"),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  setAutostart: (on) => ipcRenderer.invoke("autostart", on),
  on: (channel, cb) => {
    const allowed = ["log", "status", "active", "running", "autostart", "game", "houses", "update"];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
});
