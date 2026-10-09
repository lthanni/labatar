import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static") as string;
const { buildClipExportFfmpegArgs } = require("../../electron/clip-export.cjs");
const { probeChapters } = require("../../electron/game-chapters.cjs");

function runFfmpeg(args: string[]) {
  const result = spawnSync(ffmpeg, ["-nostdin", "-v", "error", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
}

describe("recording clip export", () => {
  it("does not carry source MP4 chapters into the clip", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "labatar-clip-export-test-"));
    try {
      const base = path.join(directory, "base.mp4");
      const source = path.join(directory, "source.mp4");
      const metadata = path.join(directory, "chapters.ffmeta");
      const output = path.join(directory, "clip.mp4");
      runFfmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=size=64x64:rate=30:color=black",
        "-t",
        "3",
        "-c:v",
        "mpeg4",
        "-y",
        base,
      ]);
      await writeFile(
        metadata,
        ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Source chapter\n",
      );
      runFfmpeg([
        "-i",
        base,
        "-f",
        "ffmetadata",
        "-i",
        metadata,
        "-map",
        "0",
        "-map_metadata",
        "0",
        "-map_chapters",
        "1",
        "-c",
        "copy",
        "-y",
        source,
      ]);
      expect((await probeChapters(ffmpeg, source)).chapters).toHaveLength(1);

      runFfmpeg(
        buildClipExportFfmpegArgs({
          sourcePath: source,
          startTime: 0.5,
          duration: 1.5,
          outputPath: output,
        }),
      );

      expect((await probeChapters(ffmpeg, output)).chapters).toHaveLength(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
