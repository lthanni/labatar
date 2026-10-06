import { createRequire } from "node:module";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const {
  normalizeRendererSnapshot,
  summarizeProcessMetric,
} = require("../../electron/renderer-profile.cjs");

describe("renderer profiling data", () => {
  it("keeps memory units and a bounded, path-free video summary", () => {
    const profile = normalizeRendererSnapshot({
      activeTab: "Recordings",
      heapUsedKiB: 42,
      blinkAllocatedKiB: 84,
      videoCount: 5,
      videos: Array.from({ length: 5 }, () => ({
        visible: true,
        playing: false,
        sourceLoaded: true,
        width: 1920,
        height: 1080,
        src: "private-file.mp4",
      })),
    });
    expect(profile.activeTab).toBe("Recordings");
    expect(profile.heapUsedKiB).toBe(42);
    expect(profile.blinkAllocatedKiB).toBe(84);
    expect(profile.videos).toHaveLength(4);
    expect(JSON.stringify(profile)).not.toContain("private-file.mp4");
  });

  it("rejects unexpected fields and invalid numbers", () => {
    const profile = normalizeRendererSnapshot({
      activeTab: "private recording name",
      heapUsedKiB: -1,
      videos: [{ width: Infinity, playing: "yes" }],
    });
    expect(profile.activeTab).toBeNull();
    expect(profile.heapUsedKiB).toBeNull();
    expect(profile.videos[0]).toMatchObject({ width: null, playing: false });
  });

  it("records renderer and GPU memory in KiB", () => {
    expect(
      summarizeProcessMetric({
        pid: 123,
        type: "Tab",
        memory: { workingSetSize: 1024, privateBytes: 512 },
      }),
    ).toEqual({ pid: 123, type: "Tab", workingSetKiB: 1024, privateKiB: 512 });
  });
});
