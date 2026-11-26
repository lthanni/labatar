const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createGuideVideoLibrary } = require("./guide-video-library.cjs");

void test("selected guide MP4s retain backend upload IDs across restarts, with separate IDs per backend and file version", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labatar-guide-video-"));
  try {
    const videoPath = path.join(root, "demo.mp4");
    fs.writeFileSync(videoPath, "video bytes");
    const first = createGuideVideoLibrary(path.join(root, "app-data"));
    const selected = await first.add(videoPath);
    assert.deepEqual(await first.add(videoPath), selected);
    assert.deepEqual(await first.list(), [selected]);
    assert.equal(selected.fileName, "demo.mp4");
    assert.equal((await first.file(selected.id)).filePath, videoPath);
    const source = await first.file(selected.id);
    const remoteId = first.remoteId(selected.id, "https://catalog.example.com", source.stat);
    const restarted = createGuideVideoLibrary(path.join(root, "app-data"));
    assert.equal(
      restarted.remoteId(selected.id, "https://catalog.example.com", source.stat),
      remoteId,
    );
    assert.notEqual(
      restarted.remoteId(selected.id, "http://localhost:8787", source.stat),
      remoteId,
    );
    assert.notEqual(
      restarted.remoteId(selected.id, "https://catalog.example.com", {
        size: source.stat.size + 1,
        mtimeMs: source.stat.mtimeMs,
      }),
      remoteId,
    );
    fs.rmSync(videoPath);
    assert.deepEqual(await restarted.list(), []);
    assert.ok(restarted.remote(selected.id, "https://catalog.example.com").id);
    await assert.rejects(restarted.file(selected.id), /unavailable/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

void test("guide MP4s link to the visible recording with the same file path", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labatar-guide-recording-"));
  try {
    const folder = path.join(root, "recordings");
    const guideFolder = path.join(folder, "Guide Videos");
    fs.mkdirSync(guideFolder, { recursive: true });
    const recorded = path.join(guideFolder, "clip.mp4");
    const otherRecording = path.join(folder, "clip.mp4");
    const external = path.join(root, "clip.mp4");
    for (const video of [recorded, otherRecording, external])
      fs.writeFileSync(video, "video bytes");
    const userData = path.join(root, "app-data");
    const library = createGuideVideoLibrary(userData);
    const [guide, other, outside] = await Promise.all(
      [recorded, otherRecording, external].map((filePath) => library.add(filePath)),
    );
    const restarted = createGuideVideoLibrary(userData);
    const ids = [guide.id, other.id, outside.id, "invalid"];
    const listed = new Set(["Guide Videos/clip.mp4", "clip.mp4"]);
    assert.deepEqual(await restarted.recordingLinks(ids, folder, listed), {
      [guide.id]: "Guide Videos/clip.mp4",
      [other.id]: "clip.mp4",
    });
    fs.rmSync(recorded);
    assert.deepEqual(await restarted.recordingLinks(ids, folder, listed), {
      [other.id]: "clip.mp4",
    });
    assert.deepEqual(
      await restarted.recordingLinks(ids, folder, new Set(["Guide Videos/clip.mp4"])),
      {},
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
