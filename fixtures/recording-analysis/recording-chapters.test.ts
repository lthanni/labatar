import { describe, expect, it } from "vite-plus/test";
import { timelineChapterMarkers } from "../../src/recording-chapters";

describe("recording timeline chapters", () => {
  it("positions embedded chapters and keeps their titles", () => {
    expect(
      timelineChapterMarkers(
        [
          { startMs: 0, title: "Start" },
          { startMs: 45_000, title: "Labatar Game 2" },
          { startMs: 90_000, title: "Unnamed 1" },
        ],
        100,
      ),
    ).toEqual([
      { time: 0, positionPercent: 0.5, titles: ["Start"], gameStart: false },
      { time: 45, positionPercent: 45, titles: ["Labatar Game 2"], gameStart: true },
      { time: 90, positionPercent: 90, titles: ["Unnamed 1"], gameStart: false },
    ]);
  });

  it("groups chapters at the same instant so both titles are hoverable", () => {
    const markers = timelineChapterMarkers(
      [
        { startMs: 100, title: "" },
        { startMs: 0, title: "Labatar Game 1" },
      ],
      10,
    );
    expect(markers).toEqual([
      {
        time: 0,
        positionPercent: 0.5,
        titles: ["Labatar Game 1", "Untitled chapter"],
        gameStart: true,
      },
    ]);
  });

  it("ignores out-of-range chapters and videos with no duration", () => {
    expect(timelineChapterMarkers([{ startMs: 15_000, title: "Late" }], 10)).toEqual([]);
    expect(timelineChapterMarkers([{ startMs: 0, title: "Start" }], Number.NaN)).toEqual([]);
  });
});
