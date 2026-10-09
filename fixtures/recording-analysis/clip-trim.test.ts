import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const { planClipTrim, replaceClipWithBackup } = require("../../electron/clip-trim.cjs");

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

describe("clip trim replacement", () => {
  async function fixture() {
    const folder = await mkdtemp(path.join(tmpdir(), "labatar-clip-trim-"));
    const videoPath = path.join(folder, "clip.mp4");
    const manifestPath = `${videoPath}.labatar.json`;
    const candidateVideoPath = path.join(folder, "candidate.mp4");
    const candidateManifestPath = path.join(folder, "candidate.labatar.json");
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
      originalStat: await stat(videoPath),
      originalManifestContent: "original-metadata",
    };
  }

  it("replaces both files and preserves the originals as hidden backups", async () => {
    const files = await fixture();
    try {
      const backup = await replaceClipWithBackup(files);
      expect(await readFile(files.videoPath, "utf8")).toBe("trimmed-video");
      expect(await readFile(files.manifestPath, "utf8")).toBe("trimmed-metadata");
      expect(await readFile(backup.backupPath, "utf8")).toBe("original-video");
      expect(await readFile(backup.backupManifestPath, "utf8")).toBe("original-metadata");
      expect(backup.backupPath.endsWith(".bak")).toBe(true);
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });

  it("restores both originals if installing the new manifest fails", async () => {
    const files = await fixture();
    try {
      await rm(files.candidateManifestPath);
      await expect(replaceClipWithBackup(files)).rejects.toThrow();
      expect(await readFile(files.videoPath, "utf8")).toBe("original-video");
      expect(await readFile(files.manifestPath, "utf8")).toBe("original-metadata");
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });

  it("refuses to replace files changed during encoding", async () => {
    const files = await fixture();
    try {
      await writeFile(files.manifestPath, "changed-metadata");
      await expect(replaceClipWithBackup(files)).rejects.toThrow(/changed/);
      expect(await readFile(files.videoPath, "utf8")).toBe("original-video");
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });
});
