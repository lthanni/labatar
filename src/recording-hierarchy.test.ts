import { describe, expect, it } from "vite-plus/test";
import type { RecordedVideo } from "./recording-types";
import {
  isF10Clip,
  isPendingF10Clip,
  recordingLibraryTab,
  recordingMatchesSearch,
} from "./recording-hierarchy";

function recording(id: string, name: string): RecordedVideo {
  return {
    id,
    name,
    metadata: null,
    games: [],
    replays: [],
    clip: null,
  } as unknown as RecordedVideo;
}

describe("F10 clip collection", () => {
  it("includes marked clips and renamed clips without a source link", () => {
    const source = recording("set", "Set.mp4");
    const ordinary = recording("ordinary", "Manual export.mp4");
    ordinary.clip = {
      sourceRecordingId: source.id,
      sourceRecordingName: source.name,
      startTime: 0,
      endTime: 10,
      createdAt: null,
    };
    const marked = recording("marked", "Legacy clip.mp4");
    marked.clip = { ...ordinary.clip, manualChapterStartMs: 10_000 };
    const detached = recording("renamed", "Trimmed highlight.mp4");
    detached.f10Clip = true;

    expect([source, ordinary, marked, detached].filter(isF10Clip)).toEqual([marked, detached]);
  });

  it("hides completed clips only from the F10 list", () => {
    const pending = recording("pending", "Needs one more edit.mp4");
    pending.f10Clip = true;
    const completed = {
      ...pending,
      id: "completed",
      name: "Finished clip.mp4",
      tags: { match: [], lab: [], combo: false, pressure: false },
      f10ClipTrimmedAndRenamed: true,
    };

    expect([pending, completed].filter(isPendingF10Clip)).toEqual([pending]);
    expect(isF10Clip(completed)).toBe(true);
    expect(recordingLibraryTab(completed, new Map())).toBe("other");
  });
});

describe("recording search", () => {
  it("finds filenames without requiring match metadata", () => {
    const video = recording("one", "Evening Set.MP4");
    const byId = new Map([[video.id, video]]);
    expect(recordingMatchesSearch(video, " evening ", false, byId)).toBe(true);
    expect(recordingMatchesSearch(video, "missing", false, byId)).toBe(false);
  });

  it("finds match player names from portraits and linked games", () => {
    const video = recording("one", "2026-11-14.mp4");
    video.portraitMatchup = {
      players: [
        {
          slot: 1,
          playerName: "Chai",
          character: "Aang",
          support: null,
          portraitUrl: null,
          supportUrl: null,
        },
        {
          slot: 2,
          playerName: "Mako",
          character: "Korra",
          support: null,
          portraitUrl: null,
          supportUrl: null,
        },
      ],
      gameCount: 1,
      gameNumber: 1,
    };
    video.games = [{ replay: { player1: "Replay Name" } } as RecordedVideo["games"][number]];
    const byId = new Map([[video.id, video]]);
    expect(recordingMatchesSearch(video, "MAKO", true, byId)).toBe(true);
    expect(recordingMatchesSearch(video, "replay name", true, byId)).toBe(true);
    video.replays = [
      { matchId: null, replayPath: "", replayFileName: "", replay: { player2: "Archive Name" } },
    ];
    expect(recordingMatchesSearch(video, "archive name", true, byId)).toBe(true);
    expect(recordingMatchesSearch(video, "Mako", false, byId)).toBe(false);
  });

  it("uses a match clip's source player names", () => {
    const source = recording("source", "set.mp4");
    source.metadata = { player1: "Tenzin", player2: "Lin" } as RecordedVideo["metadata"];
    const clip = recording("clip", "round-1.mp4");
    clip.clip = {
      sourceRecordingId: source.id,
      sourceRecordingName: source.name,
      startTime: 0,
      endTime: 10,
      createdAt: null,
    };
    const byId = new Map([source, clip].map((video) => [video.id, video]));
    expect(recordingMatchesSearch(clip, "tenzin", true, byId)).toBe(true);
    expect(recordingMatchesSearch(clip, "set.mp4", true, byId)).toBe(false);
  });
});
