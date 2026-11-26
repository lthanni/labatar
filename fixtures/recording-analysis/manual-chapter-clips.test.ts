import { createRequire } from "node:module";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const {
  planManualChapterClips,
  createMissingManualChapterClips,
  isManualChapterClip,
  manualChapterClipState,
} = require("../../electron/manual-chapter-clips.cjs");

describe("F10 clip origin", () => {
  it("recognizes legacy marker metadata and keeps recognizing renamed or detached clips", () => {
    expect(isManualChapterClip({ clip: { manualChapterStartMs: 45_000 } }, "renamed.mp4")).toBe(
      true,
    );
    expect(isManualChapterClip({ f10Clip: true, clip: null }, "trimmed and renamed.mp4")).toBe(
      true,
    );
  });

  it("recovers older trims from generated filenames without including exports made from them", () => {
    const stem = "set - F10 clip 00-00-15-000 to 00-00-45-000";
    expect(isManualChapterClip({}, `${stem}.mp4`)).toBe(true);
    expect(isManualChapterClip({}, `${stem} (2).mp4`)).toBe(true);
    expect(isManualChapterClip({}, `${stem} - clip 00-00-00-000 to 00-00-05-000.mp4`)).toBe(false);
    expect(isManualChapterClip(null, `${stem}.mp4`)).toBe(false);
  });
});

describe("F10 clip edits", () => {
  const generated = "Set - F10 clip 00-00-15-000 to 00-00-45-000.mp4";
  const renamed = "Corner punish.mp4";
  const clip = { startTime: 15, endTime: 45, manualChapterStartMs: 45_000 };
  const original = { f10Clip: true, f10ClipTrimmed: false, clip };

  it("recognizes each saved edit independently", () => {
    const trimmed = { ...original, f10ClipTrimmed: true };
    expect(manualChapterClipState(original, generated)).toEqual({ trimmed: false, renamed: false });
    expect(manualChapterClipState({ ...original, outputFileName: renamed }, renamed)).toEqual({
      trimmed: false,
      renamed: true,
    });
    expect(manualChapterClipState(trimmed, generated)).toEqual({ trimmed: true, renamed: false });
    expect(manualChapterClipState({ ...trimmed, outputFileName: renamed }, renamed)).toEqual({
      trimmed: true,
      renamed: true,
    });
    expect(manualChapterClipState({ ...trimmed, outputFileName: renamed }, generated)).toEqual({
      trimmed: true,
      renamed: false,
    });
  });

  it("recognizes older start and end trims while keeping full clips available", () => {
    const manifest = { f10Clip: true, outputFileName: renamed };
    expect(manualChapterClipState({ ...manifest, clip }, renamed)?.trimmed).toBe(false);
    expect(
      manualChapterClipState({ ...manifest, clip: { ...clip, startTime: 21 } }, renamed)?.trimmed,
    ).toBe(true);
    expect(
      manualChapterClipState({ ...manifest, clip: { startTime: 15, endTime: 36 } }, renamed)
        ?.trimmed,
    ).toBe(true);
    expect(
      manualChapterClipState(
        { ...manifest, clip: { startTime: 0, endTime: 17, manualChapterStartMs: 17_000 } },
        renamed,
      )?.trimmed,
    ).toBe(false);
  });

  it("preserves a recorded trim after the source link is removed", () => {
    const detached = { f10Clip: true, clip: null, outputFileName: renamed };
    expect(manualChapterClipState(detached, renamed)).toEqual({ trimmed: false, renamed: true });
    expect(manualChapterClipState({ ...detached, f10ClipTrimmed: true }, renamed)).toEqual({
      trimmed: true,
      renamed: true,
    });
  });
});

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
