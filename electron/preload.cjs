const { contextBridge, ipcRenderer } = require("electron");

function sendRendererProfileSnapshot() {
  try {
    const heap = process.getHeapStatistics();
    const blink = process.getBlinkMemoryInfo();
    const videos = Array.from(document.querySelectorAll("video"));
    const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
    ipcRenderer.send("diagnostics:renderer-profile", {
      activeTab: activeTab?.textContent?.trim() ?? null,
      heapUsedKiB: heap.usedHeapSize,
      heapLimitKiB: heap.heapSizeLimit,
      blinkAllocatedKiB: blink.allocated,
      blinkTotalKiB: blink.total,
      videoCount: videos.length,
      videos: videos.slice(0, 4).map((video) => ({
        visible: video.getClientRects().length > 0,
        playing: !video.paused && !video.ended,
        sourceLoaded: Boolean(video.currentSrc),
        readyState: video.readyState,
        width: video.videoWidth,
        height: video.videoHeight,
      })),
    });
  } catch {
    // Profiling must never interrupt the renderer or recording controls.
  }
}

function startRendererProfileSnapshots() {
  sendRendererProfileSnapshot();
  window.setInterval(sendRendererProfileSnapshot, 10_000);
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startRendererProfileSnapshots, { once: true });
} else {
  startRendererProfileSnapshots();
}

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  app: {
    getVersion: () => ipcRenderer.invoke("app:get-version"),
  },
  capture: {
    getState: () => ipcRenderer.invoke("capture:get-state"),
    setSettings: (request) => ipcRenderer.invoke("capture:set-settings", request),
    setChapterSettings: (request) => ipcRenderer.invoke("capture:set-chapter-settings", request),
    toggle: () => ipcRenderer.invoke("capture:toggle"),
    setDevTabActive: (active) => ipcRenderer.invoke("capture:set-dev-tab-active", active),
    addChapter: () => ipcRenderer.invoke("capture:add-chapter"),
    setAutoGameChapters: (enabled) =>
      ipcRenderer.invoke("capture:set-auto-game-chapters", { enabled }),
    setAutoClipManualChapters: (enabled) =>
      ipcRenderer.invoke("capture:set-auto-clip-manual-chapters", { enabled }),
    onState: (listener) => {
      const handler = (_, state) => listener(state);
      ipcRenderer.on("capture:state", handler);
      return () => ipcRenderer.removeListener("capture:state", handler);
    },
  },
  obs: {
    getState: () => ipcRenderer.invoke("obs:get-state"),
    getSettings: () => ipcRenderer.invoke("obs:get-settings"),
    connect: (request) => ipcRenderer.invoke("obs:connect", request),
    openApp: () => ipcRenderer.invoke("obs:open-app"),
    clearPassword: () => ipcRenderer.invoke("obs:clear-password"),
    disconnect: () => ipcRenderer.invoke("obs:disconnect"),
    prepareProfile: (request) => ipcRenderer.invoke("obs:prepare-profile", request),
    setupScenes: (request) => ipcRenderer.invoke("obs:setup-scenes", request),
    setScene: (sceneName) => ipcRenderer.invoke("obs:set-scene", sceneName),
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
  replays: {
    getFolder: () => ipcRenderer.invoke("replays:get-folder"),
    getGameFolderStatus: () => ipcRenderer.invoke("replays:get-game-folder-status"),
    selectFolder: () => ipcRenderer.invoke("replays:select-folder"),
    getCachedScan: (folder) => ipcRenderer.invoke("replays:get-cached-scan", folder),
    scanFolder: (folder) => ipcRenderer.invoke("replays:scan-folder", folder),
    resolvePortraits: (request) => ipcRenderer.invoke("replays:resolve-portraits", request),
    showInFolder: (request) => ipcRenderer.invoke("replays:show-in-folder", request),
    zip: (request) => ipcRenderer.invoke("replays:zip", request),
    stagingStatus: () => ipcRenderer.invoke("replays:staging-status"),
    stagingPreview: (request) => ipcRenderer.invoke("replays:staging-preview", request),
    stage: (request) => ipcRenderer.invoke("replays:stage", request),
    restoreStaged: () => ipcRenderer.invoke("replays:restore-staged"),
    onScanProgress: (listener) => {
      const handler = (_, progress) => listener(progress);
      ipcRenderer.on("replays:scan-progress", handler);
      return () => ipcRenderer.removeListener("replays:scan-progress", handler);
    },
  },
  recordings: {
    getWorkState: () => ipcRenderer.invoke("recordings:get-work-state"),
    onWorkState: (listener) => {
      const handler = (_, work) => listener(work);
      ipcRenderer.on("recordings:work-state", handler);
      return () => ipcRenderer.removeListener("recordings:work-state", handler);
    },
    onChanged: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("recordings:changed", handler);
      return () => ipcRenderer.removeListener("recordings:changed", handler);
    },
    list: (request) => ipcRenderer.invoke("recordings:list", request),
    getChapters: (request) => ipcRenderer.invoke("recordings:get-chapters", request),
    openFrameReader: (request) => ipcRenderer.invoke("recordings:frame-reader-open", request),
    readFrame: (request) => ipcRenderer.invoke("recordings:frame-reader-read", request),
    closeFrameReader: (request) => ipcRenderer.invoke("recordings:frame-reader-close", request),
    exportClip: (request) => ipcRenderer.invoke("recordings:export-clip", request),
    trimClip: (request) => ipcRenderer.invoke("recordings:trim-clip", request),
    createF10Clips: (request) => ipcRenderer.invoke("recordings:create-f10-clips", request),
    renameRecording: (request) => ipcRenderer.invoke("recordings:rename", request),
    reprocessName: (request) => ipcRenderer.invoke("recordings:reprocess-name", request),
    addGameChapters: (request) => ipcRenderer.invoke("recordings:add-game-chapters", request),
    openYouTubeStudio: (request) => ipcRenderer.invoke("recordings:open-youtube-studio", request),
    setYouTubeLink: (request) => ipcRenderer.invoke("recordings:set-youtube-link", request),
    openYouTubeVideo: (request) => ipcRenderer.invoke("recordings:open-youtube-video", request),
    setTags: (request) => ipcRenderer.invoke("recordings:set-tags", request),
    saveAnalysis: (request) => ipcRenderer.invoke("recordings:save-analysis", request),
    setMoveEvidence: (request) => ipcRenderer.invoke("recordings:set-move-evidence", request),
    reviewCapture: (request) => ipcRenderer.invoke("recordings:review-capture", request),
    deleteRecording: (request) => ipcRenderer.invoke("recordings:delete", request),
    deletePendingMove: (request) => ipcRenderer.invoke("recordings:delete-pending-move", request),
    startDrag: (request) => ipcRenderer.send("recordings:start-drag", request),
  },
  artwork: {
    getStatus: () => ipcRenderer.invoke("artwork:get-status"),
    extract: () => ipcRenderer.invoke("artwork:extract"),
    cancel: (request) => ipcRenderer.invoke("artwork:cancel", request),
    onProgress: (listener) => {
      const handler = (_, progress) => listener(progress);
      ipcRenderer.on("artwork:progress", handler);
      return () => ipcRenderer.removeListener("artwork:progress", handler);
    },
  },
  moveCatalog: {
    load: () => ipcRenderer.invoke("move-catalog:load"),
    knownVariants: () => ipcRenderer.invoke("move-catalog:known-variants"),
    save: (request) => ipcRenderer.invoke("move-catalog:save", request),
  },
  moveCapture: {
    getState: () => ipcRenderer.invoke("move-capture:get-state"),
    arm: (request) => ipcRenderer.invoke("move-capture:arm", request),
    disarm: () => ipcRenderer.invoke("move-capture:disarm"),
    automaticStart: (request) => ipcRenderer.invoke("move-capture:automatic-start", request),
    automaticStatus: () => ipcRenderer.invoke("move-capture:automatic-status"),
    automaticPause: () => ipcRenderer.invoke("move-capture:automatic-pause"),
    automaticResume: () => ipcRenderer.invoke("move-capture:automatic-resume"),
    automaticCancel: () => ipcRenderer.invoke("move-capture:automatic-cancel"),
    onAutomaticState: (listener) => {
      const handler = (_, state) => listener(state);
      ipcRenderer.on("move-capture:automatic-state", handler);
      return () => ipcRenderer.removeListener("move-capture:automatic-state", handler);
    },
    onState: (listener) => {
      const handler = (_, state) => listener(state);
      ipcRenderer.on("move-capture:state", handler);
      return () => ipcRenderer.removeListener("move-capture:state", handler);
    },
  },
  devBlackout: {
    status: () => ipcRenderer.invoke("dev-blackout:status"),
    start: () => ipcRenderer.invoke("dev-blackout:start"),
    restore: () => ipcRenderer.invoke("dev-blackout:restore"),
  },
  processingConfiguration: {
    load: () => ipcRenderer.invoke("processing-config:load"),
    save: (request) => ipcRenderer.invoke("processing-config:save", request),
    export: () => ipcRenderer.invoke("processing-config:export"),
    import: (request) => ipcRenderer.invoke("processing-config:import", request),
  },
  updates: {
    onStatus: (listener) => {
      const handler = (_, status) => listener(status);
      ipcRenderer.on("updates:status", handler);
      return () => ipcRenderer.removeListener("updates:status", handler);
    },
  },
});
