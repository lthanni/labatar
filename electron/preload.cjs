const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  app: {
    getVersion: () => ipcRenderer.invoke("app:get-version"),
  },
  obs: {
    getState: () => ipcRenderer.invoke("obs:get-state"),
    getSettings: () => ipcRenderer.invoke("obs:get-settings"),
    connect: (request) => ipcRenderer.invoke("obs:connect", request),
    clearPassword: () => ipcRenderer.invoke("obs:clear-password"),
    disconnect: () => ipcRenderer.invoke("obs:disconnect"),
    prepareProfile: (request) => ipcRenderer.invoke("obs:prepare-profile", request),
    startRecording: (request) => ipcRenderer.invoke("obs:start-recording", request),
    startManualRecording: (request) => ipcRenderer.invoke("obs:start-manual-recording", request),
    stopRecording: () => ipcRenderer.invoke("obs:stop-recording"),
    setAutomaticRecording: (enabled) => ipcRenderer.invoke("obs:set-automatic-recording", enabled),
    onState: (listener) => {
      const handler = (_, state) => listener(state);
      ipcRenderer.on("obs:state", handler);
      return () => ipcRenderer.removeListener("obs:state", handler);
    },
  },
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
    showInFolder: (request) => ipcRenderer.invoke("replays:show-in-folder", request),
    zip: (request) => ipcRenderer.invoke("replays:zip", request),
    onScanProgress: (listener) => {
      const handler = (_, progress) => listener(progress);
      ipcRenderer.on("replays:scan-progress", handler);
      return () => ipcRenderer.removeListener("replays:scan-progress", handler);
    },
  },
  recordings: {
    list: () => ipcRenderer.invoke("recordings:list"),
    exportClip: (request) => ipcRenderer.invoke("recordings:export-clip", request),
    renameRecording: (request) => ipcRenderer.invoke("recordings:rename", request),
    deleteRecording: (request) => ipcRenderer.invoke("recordings:delete", request),
    startDrag: (request) => ipcRenderer.send("recordings:start-drag", request),
  },
  updates: {
    onStatus: (listener) => {
      const handler = (_, status) => listener(status);
      ipcRenderer.on("updates:status", handler);
      return () => ipcRenderer.removeListener("updates:status", handler);
    },
  },
});
