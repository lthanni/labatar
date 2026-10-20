const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  replaceLocalRecordingWithYouTube,
} = require("../../electron/youtube-recording-replacement.cjs");

async function withRecording(callback) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-youtube-replacement-"));
  const videoPath = path.join(folder, "recording.mp4");
  const manifestPath = `${videoPath}.labatar.json`;
  const originalManifestContent = JSON.stringify({ schemaVersion: 1, tags: { match: ["casual"] } });
  try {
    await fs.writeFile(videoPath, "local video bytes");
    await fs.writeFile(manifestPath, originalManifestContent);
    await callback({
      videoPath,
      manifestPath,
      originalStat: await fs.stat(videoPath),
      originalManifestContent,
    });
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
}

void test("removes local video only after its YouTube manifest is installed", async () => {
  await withRecording(async (paths) => {
    const nextManifestContent = JSON.stringify({
      schemaVersion: 1,
      youtubeUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      youtubeMedia: {
        kind: "youtube",
        durationMs: 12000,
        chapters: [{ startMs: 0, title: "Opening" }],
      },
    });
    await replaceLocalRecordingWithYouTube({ ...paths, nextManifestContent });
    await assert.rejects(fs.stat(paths.videoPath), { code: "ENOENT" });
    assert.equal(await fs.readFile(paths.manifestPath, "utf8"), nextManifestContent);
  });
});

void test("restores original metadata when local video removal fails", async () => {
  await withRecording(async (paths) => {
    await assert.rejects(
      replaceLocalRecordingWithYouTube({
        ...paths,
        nextManifestContent: JSON.stringify({ youtubeMedia: { kind: "youtube" } }),
        removeVideo: async () => {
          throw new Error("video is open");
        },
      }),
      /video is open/,
    );
    assert.equal(await fs.readFile(paths.videoPath, "utf8"), "local video bytes");
    assert.equal(await fs.readFile(paths.manifestPath, "utf8"), paths.originalManifestContent);
  });
});

void test("does not replace files after the recording metadata changes", async () => {
  await withRecording(async (paths) => {
    await fs.writeFile(paths.manifestPath, "updated metadata");
    await assert.rejects(
      replaceLocalRecordingWithYouTube({
        ...paths,
        nextManifestContent: JSON.stringify({ youtubeMedia: { kind: "youtube" } }),
      }),
      /changed while the YouTube replacement was prepared/,
    );
    assert.equal(await fs.readFile(paths.videoPath, "utf8"), "local video bytes");
    assert.equal(await fs.readFile(paths.manifestPath, "utf8"), "updated metadata");
  });
});
