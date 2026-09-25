const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  overlay: {
    show: () => ipcRenderer.invoke("overlay:show"),
    hide: () => ipcRenderer.invoke("overlay:hide"),
    isVisible: () => ipcRenderer.invoke("overlay:is-visible"),
    setFocusMode: (enabled) => ipcRenderer.invoke("overlay:set-focus-mode", enabled),
    getCaptureSource: () => ipcRenderer.invoke("overlay:get-capture-source"),
    getCaptureFolder: () => ipcRenderer.invoke("overlay:get-capture-folder"),
    openCaptureFolder: () => ipcRenderer.invoke("overlay:open-capture-folder"),
    finalizeCapture: () => ipcRenderer.invoke("overlay:finalize-capture"),
    beginCapture: () => ipcRenderer.invoke("overlay:begin-capture"),
    onCaptureFinalize: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("overlay:finalize-capture", handler);
      return () => ipcRenderer.removeListener("overlay:finalize-capture", handler);
    },
    onCaptureBegin: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("overlay:begin-capture", handler);
      return () => ipcRenderer.removeListener("overlay:begin-capture", handler);
    },
    saveCaptureScreenshot: (request) =>
      ipcRenderer.invoke("overlay:save-capture-screenshot", request),
    saveCaptureVideo: (request) => ipcRenderer.invoke("overlay:save-capture-video", request),
    saveCaptureSession: (request) => ipcRenderer.invoke("overlay:save-capture-session", request),
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
