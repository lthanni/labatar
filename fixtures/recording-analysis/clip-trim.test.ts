import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const {
  planClipTrim,
  planRecordingTrim,
  replaceClipAndRollback,
} = require("../../electron/clip-trim.cjs");

const manifest = {
  clip: {
    sourceRecordingId: "set.mp4",
    sourceRecordingName: "set.mp4",
    startTime: 30,
    endTime: 60,
    manualChapterStartMs: 60_000,
  },
  tags: { match: [], lab: [], combo: false, pressure: false },
};

describe("clip trim planning", () => {
  it("rebases retained media into the parent recording's timeline", () => {
    const result = planClipTrim(manifest, 4, 27, 30_000);
    expect(result.clip).toMatchObject({ startTime: 34, endTime: 57 });
    expect(result.clip.manualChapterStartMs).toBeUndefined();
    expect(manifest.clip.startTime).toBe(30);
  });

  it("retains the F10 marker if the clip still ends at that marker", () => {
    const result = planClipTrim(manifest, 5, 30, 30_000);
    expect(result.clip.manualChapterStartMs).toBe(60_000);
  });

  it("rejects non-clips, linked data, and invalid ranges", () => {
    expect(() => planClipTrim({}, 1, 5, 30_000)).toThrow(/Only clips/);
    expect(() =>
      planClipTrim({ ...manifest, analysis: { schemaVersion: 1 } }, 1, 5, 30_000),
    ).toThrow(/analysis/);
    expect(() =>
      planClipTrim({ ...manifest, youtubeUrl: "https://youtube.com/watch?v=abc" }, 1, 5, 30_000),
    ).toThrow(/YouTube/);
    expect(() => planClipTrim(manifest, 0, 30, 30_000)).toThrow(/shorter range/);
    expect(() => planClipTrim(manifest, 1, 31, 30_000)).toThrow(/outside/);
    expect(() => planClipTrim(manifest, 1, 20, 20_000)).toThrow(/outside/);
  });
});

describe("chapterless recording trim planning", () => {
  const recording = {
    source: "manual",
    capture: { fpsNumerator: 60, fpsDenominator: 1 },
    tags: { match: [], lab: ["practice"], combo: false, pressure: false },
    games: [],
    replays: [],
  };

  it("allows a shorter range and preserves manual recording metadata", () => {
    expect(planRecordingTrim(recording, 2, 8, 10_000, [])).toEqual(recording);
  });

  it("allows chapters and refuses linked timing data and invalid ranges", () => {
    expect(planRecordingTrim(recording, 2, 8, 10_000, [{ startMs: 1000 }])).toEqual(recording);
    expect(() =>
      planRecordingTrim({ ...recording, moveTake: { id: "5A" } }, 2, 8, 10_000, []),
    ).toThrow(/linked/);
    expect(() => planRecordingTrim(recording, 0, 10, 10_000, [])).toThrow(/shorter range/);
    expect(() => planRecordingTrim(recording, 2, 11, 10_000, [])).toThrow(/outside/);
  });
});

describe("clip trim replacement", () => {
  async function fixture() {
    const folder = await mkdtemp(path.join(tmpdir(), "labatar-clip-trim-"));
    const videoPath = path.join(folder, "clip.mp4");
    const manifestPath = `${videoPath}.labatar.json`;
    const candidateVideoPath = path.join(folder, "candidate.mp4");
    const candidateManifestPath = path.join(folder, "candidate.labatar.json");
    const temporaryOriginalVideoPath = path.join(folder, "original-temporary.mp4");
    const temporaryOriginalManifestPath = path.join(folder, "original-temporary.labatar.json");
    await writeFile(videoPath, "original-video");
    await writeFile(manifestPath, "original-metadata");
    await writeFile(candidateVideoPath, "trimmed-video");
    await writeFile(candidateManifestPath, "trimmed-metadata");
    return {
      folder,
      videoPath,
      manifestPath,
      candidateVideoPath,
      candidateManifestPath,
      temporaryOriginalVideoPath,
      temporaryOriginalManifestPath,
      originalStat: await stat(videoPath),
      originalManifestContent: "original-metadata",
    };
  }

  it("replaces both files and leaves temporary originals for caller cleanup", async () => {
    const files = await fixture();
    try {
      await replaceClipAndRollback(files);
      expect(await readFile(files.videoPath, "utf8")).toBe("trimmed-video");
      expect(await readFile(files.manifestPath, "utf8")).toBe("trimmed-metadata");
      expect(await readFile(files.temporaryOriginalVideoPath, "utf8")).toBe("original-video");
      expect(await readFile(files.temporaryOriginalManifestPath, "utf8")).toBe("original-metadata");
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });

  it("restores both originals if installing the new manifest fails", async () => {
    const files = await fixture();
    try {
      await rm(files.candidateManifestPath);
      await expect(replaceClipAndRollback(files)).rejects.toThrow();
      expect(await readFile(files.videoPath, "utf8")).toBe("original-video");
      expect(await readFile(files.manifestPath, "utf8")).toBe("original-metadata");
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });

  it("can replace a recording that had no sidecar", async () => {
    const files = await fixture();
    try {
      await rm(files.manifestPath);
      await replaceClipAndRollback({ ...files, originalManifestContent: null });
      expect(await readFile(files.videoPath, "utf8")).toBe("trimmed-video");
      expect(await readFile(files.manifestPath, "utf8")).toBe("trimmed-metadata");
      await expect(readFile(files.temporaryOriginalManifestPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });

  it("restores a sidecarless recording if installing its new metadata fails", async () => {
    const files = await fixture();
    try {
      await rm(files.manifestPath);
      await rm(files.candidateManifestPath);
      await expect(
        replaceClipAndRollback({ ...files, originalManifestContent: null }),
      ).rejects.toThrow();
      expect(await readFile(files.videoPath, "utf8")).toBe("original-video");
      await expect(readFile(files.manifestPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });

  it("refuses to replace files changed during encoding", async () => {
    const files = await fixture();
    try {
      await writeFile(files.manifestPath, "changed-metadata");
      await expect(replaceClipAndRollback(files)).rejects.toThrow(/changed/);
      expect(await readFile(files.videoPath, "utf8")).toBe("original-video");
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });
});
