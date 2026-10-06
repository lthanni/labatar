import { createRequire } from "node:module";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const {
  planManualChapterClips,
  createMissingManualChapterClips,
} = require("../../electron/manual-chapter-clips.cjs");

describe("manual chapter clip planning", () => {
  it("clips the 30 seconds before each OBS F10 chapter", () => {
    expect(
      planManualChapterClips(
        [
          { startMs: 0, title: "Start" },
          { startMs: 0, title: "Labatar Game 1 (start not captured)" },
          { startMs: 70_500, title: "Unnamed 2" },
          { startMs: 45_000, title: "Unnamed 1" },
          { startMs: 70_500, title: "Unnamed 2" },
          { startMs: 90_000, title: "Labatar Game 2" },
        ],
        120_000,
      ),
    ).toEqual([
      { chapterStartMs: 45_000, startTime: 15, endTime: 45 },
      { chapterStartMs: 70_500, startTime: 40.5, endTime: 70.5 },
    ]);
  });

  it("truncates the first clip to recording start and ignores invalid markers", () => {
    expect(
      planManualChapterClips(
        [
          { startMs: 0, title: "Unnamed 1" },
          { startMs: 4_666, title: "Unnamed 2" },
          { startMs: 60_000, title: "Unnamed 3" },
          { startMs: -1, title: "Unnamed 4" },
          { startMs: Number.NaN, title: "Unnamed 5" },
        ],
        60_000,
      ),
    ).toEqual([{ chapterStartMs: 4_666, startTime: 0, endTime: 4.666 }]);
  });

  it("requires a usable recording duration", () => {
    expect(() => planManualChapterClips([{ startMs: 2_000, title: "Unnamed 1" }], null)).toThrow(
      "no playable duration",
    );
  });

  it("skips existing clips and retries only failed F10 markers", async () => {
    const chapters = [
      { startMs: 15_000, title: "Unnamed 1" },
      { startMs: 45_000, title: "Unnamed 2" },
      { startMs: 75_000, title: "Unnamed 3" },
      { startMs: 90_000, title: "Labatar Game 4" },
    ];
    const exported: number[] = [];
    const result = await createMissingManualChapterClips(
      chapters,
      100_000,
      new Set([15_000]),
      async ({ chapterStartMs }: { chapterStartMs: number }) => {
        if (chapterStartMs === 45_000) throw new Error("encoder failed");
        exported.push(chapterStartMs);
      },
    );
    expect(result).toEqual({
      total: 3,
      created: 1,
      alreadyExisting: 1,
      failures: [{ chapterStartMs: 45_000, error: "encoder failed" }],
    });
    expect(exported).toEqual([75_000]);

    const retry = await createMissingManualChapterClips(
      chapters,
      100_000,
      new Set([15_000, ...exported]),
      async ({ chapterStartMs }: { chapterStartMs: number }) => {
        exported.push(chapterStartMs);
      },
    );
    expect(retry).toEqual({ total: 3, created: 1, alreadyExisting: 2, failures: [] });
    expect(exported).toEqual([75_000, 45_000]);
  });

  it("reports which clip is being encoded and advances past existing chapters", async () => {
    const progress: Array<{ index: number; total: number; phase: string }> = [];
    await createMissingManualChapterClips(
      [
        { startMs: 15_000, title: "Unnamed 1" },
        { startMs: 45_000, title: "Unnamed 2" },
      ],
      60_000,
      new Set([15_000]),
      async () => undefined,
      ({ index, total, phase }: { index: number; total: number; phase: string }) => {
        progress.push({ index, total, phase });
      },
    );
    expect(progress).toEqual([
      { index: 1, total: 2, phase: "existing" },
      { index: 2, total: 2, phase: "creating" },
      { index: 2, total: 2, phase: "created" },
    ]);
  });
});
