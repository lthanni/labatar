const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");
const { probeChapters } = require("./game-chapters.cjs");
const { probeVideoDimensions } = require("./combo-input-overlay.cjs");
const {
  combineSetRecordings,
  splitSetRecording,
  sourceIdsHiddenByCombinations,
} = require("./set-combinations.cjs");

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
  });
}

void test("combines playable MP4s and restores original set recordings", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-set-combine-"));
  const ids = ["first.mp4", "second.mp4", "third.mp4"];
  const hashes = ids.map((_, index) => String(index + 1).repeat(64));
  try {
    for (const [index, id] of ids.entries()) {
      const videoPath = path.join(folder, id);
      await runFfmpeg([
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=${["red", "green", "blue"][index]}:s=320x180:r=30`,
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        "0.6",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        videoPath,
      ]);
      await fs.writeFile(
        `${videoPath}.labatar.json`,
        JSON.stringify({
          schemaVersion: 1,
          source: "automatic",
          metadata: { opponent: "Opponent", setLabel: `Set ${index + 1}` },
          games: [{ matchId: `match-${index + 1}` }],
          replays: [{ replayPath: `${index + 1}.dlr`, replay: { contentHash: hashes[index] } }],
        }),
      );
    }
    const findRecordingFiles = async () =>
      (await fs.readdir(folder))
        .filter((name) => name.endsWith(".mp4"))
        .map((name) => path.join(folder, name));
    const originalManifests = await Promise.all(
      ids.map((id) => fs.readFile(path.join(folder, `${id}.labatar.json`), "utf8")),
    );
    const combined = await combineSetRecordings({
      sets: ids.map((recordingId, index) => ({
        recordingId,
        replayKeys: [`sha256:${hashes[index]}`],
      })),
      folder,
      executable: ffmpeg,
      runFfmpeg,
      probeChapters,
      probeVideoDimensions,
      findRecordingFiles,
    });
    const combinedPath = path.join(folder, combined.recordingId);
    const combinedProbe = await probeChapters(ffmpeg, combinedPath);
    assert.equal(
      combinedProbe.chapters.filter((chapter) => /^Set \d+$/.test(chapter.title)).length,
      3,
    );
    assert.ok(combinedProbe.durationMs >= 1600);
    const manifest = JSON.parse(await fs.readFile(`${combinedPath}.labatar.json`, "utf8"));
    assert.equal(manifest.games.length, 3);
    assert.equal(manifest.combinedSets.sourceSets[0].startMs, 0);
    assert.ok(manifest.combinedSets.sourceSets[1].startMs > 0);
    assert.ok(
      manifest.combinedSets.sourceSets[2].startMs > manifest.combinedSets.sourceSets[1].startMs,
    );
    assert.deepEqual(
      [
        ...sourceIdsHiddenByCombinations([
          { id: combined.recordingId, combinedSets: manifest.combinedSets },
        ]),
      ],
      ids,
    );
    assert.deepEqual(
      await Promise.all(
        ids.map((id) => fs.readFile(path.join(folder, `${id}.labatar.json`), "utf8")),
      ),
      originalManifests,
    );
    await assert.rejects(
      () =>
        combineSetRecordings({
          sets: ids.slice(0, 2).map((recordingId, index) => ({
            recordingId,
            replayKeys: [`sha256:${hashes[index]}`],
          })),
          folder,
          executable: ffmpeg,
          runFfmpeg,
          probeChapters,
          probeVideoDimensions,
          findRecordingFiles,
        }),
      /already belongs/,
    );
    assert.deepEqual(
      await splitSetRecording({ recordingId: combined.recordingId, folder, findRecordingFiles }),
      { sourceCount: 3 },
    );
    await assert.rejects(() => fs.access(combinedPath));
    assert.deepEqual(
      await Promise.all(
        ids.map((id) => fs.readFile(path.join(folder, `${id}.labatar.json`), "utf8")),
      ),
      originalManifests,
    );
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
