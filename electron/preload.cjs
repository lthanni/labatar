const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  overlay: {
    show: () => ipcRenderer.invoke("overlay:show"),
    hide: () => ipcRenderer.invoke("overlay:hide"),
    isVisible: () => ipcRenderer.invoke("overlay:is-visible"),
    setFocusMode: (enabled) => ipcRenderer.invoke("overlay:set-focus-mode", enabled),
    getCaptureSource: () => ipcRenderer.invoke("overlay:get-capture-source"),
  },
  replays: {
    getFolder: () => ipcRenderer.invoke("replays:get-folder"),
    selectFolder: () => ipcRenderer.invoke("replays:select-folder"),
    scanFolder: (folder) => ipcRenderer.invoke("replays:scan-folder", folder),
    onScanProgress: (listener) => {
      const handler = (_, progress) => listener(progress);
      ipcRenderer.on("replays:scan-progress", handler);
      return () => ipcRenderer.removeListener("replays:scan-progress", handler);
    },
  },
});
