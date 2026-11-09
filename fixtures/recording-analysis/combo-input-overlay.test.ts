import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static") as string;
const {
  buildComboInputOverlayAss,
  buildComboInputVideoFilter,
  comboInputVideoLayout,
  probeVideoDimensions,
} = require("../../electron/combo-input-overlay.cjs");
const { buildClipExportFfmpegArgs } = require("../../electron/clip-export.cjs");

function runFfmpeg(args: string[], cwd: string): Buffer {
  const result = spawnSync(ffmpeg, ["-nostdin", "-v", "error", ...args], {
    cwd,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr.toString("utf8") || String(result.error));
  return result.stdout;
}

function pixelCounts(frame: Buffer, firstRow = 0, lastRow = 360) {
  let red = 0;
  let white = 0;
  for (let index = firstRow * 640 * 3; index < lastRow * 640 * 3; index += 3) {
    const r = frame[index];
    const g = frame[index + 1];
    const b = frame[index + 2];
    if (r > 120 && r > g * 1.5 && r > b * 1.5) red += 1;
    if (r > 150 && g > 150 && b > 150) white += 1;
  }
  return { red, white };
}

describe("combo input video overlay", () => {
  it("crops the HUD and keeps each token red until its physical button is released", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "labatar-input-overlay-test-"));
    try {
      const source = path.join(directory, "source.mp4");
      const output = path.join(directory, "rendered.mp4");
      const capture = {
        schemaVersion: 1,
        status: "complete",
        durationMs: 1000,
        states: [
          { timeMs: 0, buttons: [] },
          { timeMs: 100, buttons: ["X"] },
          { timeMs: 350, buttons: ["X", "Y"] },
          { timeMs: 600, buttons: ["Y"] },
          { timeMs: 850, buttons: [] },
        ],
      };
      const processed = {
        presses: [
          {
            timeMs: 100,
            sourceStateIndex: 1,
            physicalButton: "X",
            interpretations: { right: { notation: "5A" } },
          },
          {
            timeMs: 350,
            sourceStateIndex: 2,
            physicalButton: "Y",
            interpretations: { right: { notation: "5B" } },
          },
        ],
      };
      const subtitle = buildComboInputOverlayAss(processed, capture, 1000);
      expect(subtitle).toContain(
        "0:00:00.60,0:00:00.85,Inputs,,0,0,0,,{\\an5\\pos(960,972)}{\\c&HFFFFFF&}5A {\\c&H0000FF&}5B",
      );
      await writeFile(path.join(directory, "overlay.ass"), subtitle);
      runFfmpeg(
        [
          "-f",
          "lavfi",
          "-i",
          "color=c=green:s=640x360:r=30:d=1",
          "-vf",
          "drawbox=x=0:y=0:w=iw:h=8:color=blue:t=fill,drawbox=x=0:y=336:w=iw:h=24:color=red:t=fill",
          "-c:v",
          "mpeg4",
          "-y",
          source,
        ],
        directory,
      );
      expect(await probeVideoDimensions(ffmpeg, source)).toEqual({ width: 640, height: 360 });
      runFfmpeg(
        buildClipExportFfmpegArgs({
          sourcePath: source,
          startTime: 0,
          duration: 1,
          outputPath: output,
          videoFilter: buildComboInputVideoFilter(640, 360, "overlay.ass"),
        }),
        directory,
      );
      const frameAt = (seconds: number) =>
        runFfmpeg(
          [
            "-ss",
            String(seconds),
            "-i",
            output,
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
          ],
          directory,
        );
      const layout = comboInputVideoLayout(640, 360);
      expect(layout.footerTop).toBe(288);
      const firstFrame = frameAt(0.2);
      const overlapFrame = frameAt(0.5);
      const secondFrame = frameAt(0.7);
      const releasedFrame = frameAt(0.9);
      expect(firstFrame.length).toBe(640 * 360 * 3);
      const first = pixelCounts(firstFrame, layout.footerTop);
      const overlap = pixelCounts(overlapFrame, layout.footerTop);
      const second = pixelCounts(secondFrame, layout.footerTop);
      const released = pixelCounts(releasedFrame, layout.footerTop);
      expect(first.red).toBeGreaterThan(0);
      expect(first.white).toBeGreaterThan(0);
      expect(overlap.red).toBeGreaterThan(0);
      expect(second.red).toBeGreaterThan(0);
      expect(second.white).toBeGreaterThan(0);
      expect(released.red).toBe(0);
      expect(released.white).toBeGreaterThan(0);
      expect(pixelCounts(firstFrame, 0, layout.footerTop).red).toBe(0);
      const topCenter = 320 * 3;
      expect(firstFrame[topCenter + 1]).toBeGreaterThan(70);
      expect(firstFrame[topCenter]).toBeLessThan(40);
      expect(firstFrame[topCenter + 2]).toBeLessThan(40);
      const footerCorner = (340 * 640 + 10) * 3;
      expect(Math.max(...firstFrame.subarray(footerCorner, footerCorner + 3))).toBeLessThan(20);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("tracks repeated presses separately and stops an interrupted hold at the last saved state", () => {
    const capture = {
      schemaVersion: 1,
      status: "interrupted",
      durationMs: 1000,
      states: [
        { timeMs: 0, buttons: [] },
        { timeMs: 100, buttons: ["X"] },
        { timeMs: 200, buttons: [] },
        { timeMs: 500, buttons: ["X"] },
        { timeMs: 700, buttons: ["X", "Y"] },
      ],
    };
    const processed = {
      presses: [
        {
          timeMs: 100,
          sourceStateIndex: 1,
          physicalButton: "X",
          interpretations: { right: { notation: "5A" } },
        },
        {
          timeMs: 500,
          sourceStateIndex: 3,
          physicalButton: "X",
          interpretations: { right: { notation: "6A" } },
        },
      ],
    };
    const subtitle = buildComboInputOverlayAss(processed, capture, 1000);
    expect(subtitle).toContain(
      "0:00:00.50,0:00:00.70,Inputs,,0,0,0,,{\\an5\\pos(960,972)}{\\c&HFFFFFF&}5A {\\c&H0000FF&}6A",
    );
    expect(subtitle).toContain(
      "0:00:00.70,0:00:01.00,Inputs,,0,0,0,,{\\an5\\pos(960,972)}{\\c&HFFFFFF&}5A {\\c&HFFFFFF&}6A",
    );
  });
});
