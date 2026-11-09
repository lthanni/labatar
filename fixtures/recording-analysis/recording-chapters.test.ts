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

  it("hides legacy input chapters while grouping ordinary chapters", () => {
    const markers = timelineChapterMarkers(
      [
        { startMs: 0, title: "Opening cue" },
        { startMs: 100, title: "Labatar Input: 2B" },
        { startMs: 101, title: "Labatar Input: 2C" },
        { startMs: 290, title: "Labatar Input: 236C" },
        { startMs: 1000, title: "Unnamed 1" },
        { startMs: 1100, title: "Labatar Game 2" },
      ],
      10,
    );
    expect(markers).toHaveLength(2);
    expect(markers[0].titles).toEqual(["Opening cue"]);
    expect(markers[1].titles).toEqual(["Unnamed 1", "Labatar Game 2"]);
  });

  it("omits synthetic start chapters without hiding other markers", () => {
    const markers = timelineChapterMarkers(
      [
        { startMs: 0, title: "Recording start" },
        { startMs: 0, title: "Video start" },
        { startMs: 1000, title: "Labatar Game 1" },
        { startMs: 2000, title: "Unnamed 1" },
      ],
      5,
    );
    expect(markers.map((marker) => marker.titles)).toEqual([["Labatar Game 1"], ["Unnamed 1"]]);
  });

  it("ignores out-of-range chapters and videos with no duration", () => {
    expect(timelineChapterMarkers([{ startMs: 15_000, title: "Late" }], 10)).toEqual([]);
    expect(timelineChapterMarkers([{ startMs: 0, title: "Start" }], Number.NaN)).toEqual([]);
  });
});
