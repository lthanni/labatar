import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static") as string;
const {
  buildFastTrimFfmpegArgs,
  probeFastTrimStart,
} = require("../../electron/clip-fast-trim.cjs");
const { mapChaptersToTrim } = require("../../electron/clip-trim.cjs");
const { buildChapterMetadata, probeChapters } = require("../../electron/game-chapters.cjs");

function runFfmpeg(args: string[]) {
  const result = spawnSync(ffmpeg, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
}

describe("fast recording trim", () => {
  it("copies audio and video from the preceding keyframe with chapters on the actual timeline", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "labatar-fast-trim-test-"));
    try {
      const source = path.join(directory, "source.mp4");
      const output = path.join(directory, "trimmed.mp4");
      const metadataPath = path.join(directory, "chapters.ffmeta");
      runFfmpeg([
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=64x64:rate=30:duration=12",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=12",
        "-c:v",
        "libx264",
        "-g",
        "60",
        "-keyint_min",
        "60",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-metadata",
        "creation_time=2026-10-18T00:00:00.000Z",
        "-y",
        source,
      ]);
      const requestedStart = 5.2;
      const requestedEnd = 7.7;
      const actualStart = await probeFastTrimStart(ffmpeg, source, requestedStart);
      expect(actualStart).toBe(4);
      const chapters = mapChaptersToTrim(
        [{ startMs: 5500, title: "Chapter" }],
        actualStart,
        requestedEnd,
      );
      await writeFile(metadataPath, buildChapterMetadata(chapters, [], 3700, true).text);
      const args = buildFastTrimFfmpegArgs({
        sourcePath: source,
        requestedStart,
        requestedEnd,
        creationTime: "2026-10-18T00:00:04.000Z",
        outputPath: output,
      });
      expect(args).toContain("copy");
      runFfmpeg(args);
      const result = await probeChapters(ffmpeg, output);
      expect(result.durationMs).toBeGreaterThan(3600);
      expect(result.durationMs).toBeLessThan(3900);
      expect(result.chapters).toEqual([]);
      expect(result.creationTime).toBe("2026-10-18T00:00:04.000000Z");
      const chaptered = path.join(directory, "chaptered.mp4");
      runFfmpeg([
        "-nostdin",
        "-v",
        "error",
        "-i",
        output,
        "-f",
        "ffmetadata",
        "-i",
        metadataPath,
        "-map",
        "0",
        "-map_metadata",
        "0",
        "-map_chapters",
        "1",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        "-y",
        chaptered,
      ]);
      expect((await probeChapters(ffmpeg, chaptered)).chapters).toEqual([
        { startMs: 0, title: "Recording start" },
        { startMs: 1500, title: "Chapter" },
      ]);
      const streams = spawnSync(ffmpeg, ["-hide_banner", "-i", output], {
        encoding: "utf8",
      }).stderr;
      expect(streams).toContain("Video: h264");
      expect(streams).toContain("Audio: aac");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
