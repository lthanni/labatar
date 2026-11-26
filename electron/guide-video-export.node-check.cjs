const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { promisify } = require("node:util");
const ffmpeg = require("ffmpeg-static");
const { probeMedia } = require("./game-chapters.cjs");
const { buildClipExportFfmpegArgs } = require("./clip-export.cjs");
const { buildRecordingCaption, exportGuideVideo } = require("./guide-video-export.cjs");

const run = (args, options) => promisify(execFile)(ffmpeg, args, { ...options, windowsHide: true });

void test("exports full-width guide clips with text below the footage, including mixed aspect ratios", async () => {
  const root = await fs.realpath(os.tmpdir());
  const folder = await fs.mkdtemp(path.join(root, "labatar-guide-test-"));
  try {
    const red = path.join(folder, "red and silent.mp4");
    const blue = path.join(folder, "blue with audio.mp4");
    const outputPath = path.join(folder, "guide.mp4");
    const landscapePath = path.join(folder, "landscape.mp4");
    const uncaptionedPath = path.join(folder, "uncaptioned.mp4");
    const input = ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"];
    await run([...input, "color=c=red:s=320x180:r=30:d=0.5", "-c:v", "libx264", red]);
    await run([
      ...input,
      "color=c=blue:s=240x240:r=24:d=0.75",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100:duration=0.75",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      blue,
    ]);
    await exportGuideVideo({
      executable: ffmpeg,
      runFfmpeg: run,
      outputPath,
      onProgress() {},
      clips: [
        { filePath: red, title: "First take", caption: "First clip {literal} \\N" },
        { filePath: blue, title: "Second take", caption: "" },
        { filePath: red, title: "", caption: "" },
      ],
    });
    const media = await probeMedia(ffmpeg, outputPath);
    assert.ok(Math.abs(media.durationMs - 1750) < 75, `unexpected duration ${media.durationMs}`);
    assert.equal(media.hasAudio, true);
    const width = 552;
    const height = 720;
    assert.equal(media.displayAspectRatio, width / height);
    for (const [time, color] of [
      ["0.2", 0],
      ["0.8", 2],
      ["1.45", 0],
    ]) {
      const { stdout: frame } = await run(
        [
          "-v",
          "error",
          "-ss",
          time,
          "-i",
          outputPath,
          "-frames:v",
          "1",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          "-",
        ],
        { encoding: "buffer", maxBuffer: 3_000_000 },
      );
      assert.equal(frame.length, width * height * 3);
      for (const x of [2, width / 2, width - 3]) {
        const pixel = (width * 400 + x) * 3;
        assert.ok(
          frame[pixel + color] > 200 && frame[pixel + (2 - color)] < 40,
          `wrong clip or side padding at ${time}s, x=${x}`,
        );
      }
      const footer = frame.subarray(width * 552 * 3);
      if (time === "1.45") assert.ok(footer.every((channel) => channel < 16));
      else
        assert.ok(
          footer.some((channel) => channel > 220),
          `clip text missing at ${time}s`,
        );
      if (time === "0.2") {
        const mid = width * (636 - 552) * 3;
        assert.ok(
          footer.subarray(0, mid).some((channel) => channel > 220),
          "title missing",
        );
        assert.ok(
          footer.subarray(mid).some((channel) => channel > 220),
          "caption missing",
        );
      }
      assert.ok(footer.subarray(0, width * 3).every((channel) => channel < 16));
    }
    await exportGuideVideo({
      executable: ffmpeg,
      runFfmpeg: run,
      outputPath: landscapePath,
      onProgress() {},
      clips: [{ filePath: red, caption: "Landscape" }],
    });
    assert.equal((await probeMedia(ffmpeg, landscapePath)).displayAspectRatio, 980 / 720);
    await exportGuideVideo({
      executable: ffmpeg,
      runFfmpeg: run,
      outputPath: uncaptionedPath,
      onProgress() {},
      clips: [{ filePath: red, title: "", caption: "" }],
    });
    assert.equal((await probeMedia(ffmpeg, uncaptionedPath)).displayAspectRatio, 980 / 552);
    assert.deepEqual((await fs.readdir(folder)).sort(), [
      "blue with audio.mp4",
      "guide.mp4",
      "landscape.mp4",
      "red and silent.mp4",
      "uncaptioned.mp4",
    ]);
  } finally {
    if (path.dirname(folder) === root && path.basename(folder).startsWith("labatar-guide-test-"))
      await fs.rm(folder, { recursive: true, force: true });
  }
});

void test("burns a caption under a precisely cut recording without resizing the footage", async () => {
  const root = await fs.realpath(os.tmpdir());
  const folder = await fs.mkdtemp(path.join(root, "labatar-caption-test-"));
  try {
    const sourcePath = path.join(folder, "source.mp4");
    const outputPath = path.join(folder, "caption.tmp");
    await run([
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x180:r=24:d=1.5",
      "-f",
      "lavfi",
      "-i",
      "sine=duration=1.5",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      sourcePath,
    ]);
    const source = await probeMedia(ffmpeg, sourcePath);
    const { subtitle, videoFilter } = buildRecordingCaption(
      "Recording caption {literal} \\N\nSecond line",
      500,
      source.displayAspectRatio,
      "caption.ass",
    );
    await fs.writeFile(path.join(folder, "caption.ass"), subtitle);
    await run(
      buildClipExportFfmpegArgs({
        sourcePath,
        startTime: 0.5,
        duration: 0.5,
        outputPath,
        videoFilter,
      }),
      { cwd: folder },
    );
    const width = 320;
    const videoHeight = 180;
    const height = 236;
    const media = await probeMedia(ffmpeg, outputPath);
    assert.ok(Math.abs(media.durationMs - 500) < 100, `unexpected duration ${media.durationMs}`);
    assert.equal(media.hasAudio, true);
    assert.equal(media.displayAspectRatio, width / height);
    for (const time of ["0.05", "0.4"]) {
      const { stdout: frame } = await run(
        [
          "-v",
          "error",
          "-ss",
          time,
          "-i",
          outputPath,
          "-frames:v",
          "1",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          "-",
        ],
        { encoding: "buffer" },
      );
      assert.equal(frame.length, width * height * 3);
      const footerStart = width * videoHeight * 3;
      assert.ok(frame[footerStart - 3] > 200 && frame[footerStart - 2] < 40);
      assert.ok(frame.subarray(footerStart).some((channel) => channel > 220));
    }
  } finally {
    if (
      path.dirname(folder) === root &&
      path.basename(folder).startsWith("labatar-caption-test-")
    ) {
      await fs.rm(folder, { recursive: true, force: true });
    }
  }
});
