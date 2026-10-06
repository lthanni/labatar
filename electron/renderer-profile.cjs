const knownTabs = new Set([
  "Match history",
  "Recordings",
  "Dev-only capture",
  "Nerd processing",
  "Tech",
]);

function nonnegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeRendererSnapshot(value) {
  const snapshot = value && typeof value === "object" ? value : {};
  const videos = Array.isArray(snapshot.videos) ? snapshot.videos.slice(0, 4) : [];
  return {
    activeTab: knownTabs.has(snapshot.activeTab) ? snapshot.activeTab : null,
    heapUsedKiB: nonnegativeNumber(snapshot.heapUsedKiB),
    heapLimitKiB: nonnegativeNumber(snapshot.heapLimitKiB),
    blinkAllocatedKiB: nonnegativeNumber(snapshot.blinkAllocatedKiB),
    blinkTotalKiB: nonnegativeNumber(snapshot.blinkTotalKiB),
    videoCount: nonnegativeNumber(snapshot.videoCount),
    videos: videos.map((video) => ({
      visible: video?.visible === true,
      playing: video?.playing === true,
      sourceLoaded: video?.sourceLoaded === true,
      readyState: nonnegativeNumber(video?.readyState),
      width: nonnegativeNumber(video?.width),
      height: nonnegativeNumber(video?.height),
    })),
  };
}

function summarizeProcessMetric(metric) {
  return {
    pid: nonnegativeNumber(metric?.pid),
    type: typeof metric?.type === "string" ? metric.type : "Unknown",
    workingSetKiB: nonnegativeNumber(metric?.memory?.workingSetSize),
    privateKiB: nonnegativeNumber(metric?.memory?.privateBytes),
  };
}

module.exports = { normalizeRendererSnapshot, summarizeProcessMetric };
