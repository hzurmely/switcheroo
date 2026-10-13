const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  state: () => ipcRenderer.invoke("state"),
  profiles: () => ipcRenderer.invoke("profiles"),
  start: (a, b) => ipcRenderer.invoke("start", a, b),
  stop: () => ipcRenderer.invoke("stop"),
  setAutostart: (on) => ipcRenderer.invoke("autostart", on),
  on: (channel, cb) => {
    const allowed = ["log", "status", "active", "running", "autostart"];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
});
