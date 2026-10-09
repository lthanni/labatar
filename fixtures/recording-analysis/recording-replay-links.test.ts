import { describe, expect, it } from "vite-plus/test";
import { buildRecordingReplayIndex, recordingIdForSet } from "../../src/recording-replay-links";

describe("set recording links", () => {
  it("links an automatic recording by its exact saved replay path", () => {
    const index = buildRecordingReplayIndex([
      {
        id: "set.mp4",
        source: "automatic",
        games: [{ replayPath: "C:\\Replays\\August\\game-one.dlr" }],
        replays: [{ replayPath: "C:\\Replays\\August\\game-two.dlr" }],
      },
    ]);

    expect(
      recordingIdForSet(["August/game-one.dlr", "August/game-two.dlr"], "c:/replays", index),
    ).toBe("set.mp4");
    expect(recordingIdForSet(["August/game-one.dlr"], "C:/Other Replays", index)).toBeNull();
  });

  it("does not link manual recordings, clips, or ambiguous sets", () => {
    const index = buildRecordingReplayIndex([
      {
        id: "manual.mp4",
        source: "manual",
        games: [{ replayPath: "C:/Replays/first.dlr" }],
      },
      {
        id: "clip.mp4",
        source: "automatic",
        clip: { sourceRecordingId: "first.mp4" },
        games: [{ replayPath: "C:/Replays/first.dlr" }],
      },
      {
        id: "first.mp4",
        source: "automatic",
        games: [{ replayPath: "C:/Replays/first.dlr" }],
      },
      {
        id: "second.mp4",
        source: "automatic",
        games: [{ replayPath: "C:/Replays/second.dlr" }],
      },
    ]);

    expect(recordingIdForSet(["first.dlr"], "C:/Replays", index)).toBe("first.mp4");
    expect(recordingIdForSet(["first.dlr", "second.dlr"], "C:/Replays", index)).toBeNull();
    expect(recordingIdForSet(["third.dlr"], "C:/Replays", index)).toBeNull();
    expect(recordingIdForSet(["first.dlr", "third.dlr"], "C:/Replays", index)).toBeNull();
    expect(recordingIdForSet([], "C:/Replays", index)).toBeNull();
  });

  it("does not choose one recording when a replay path belongs to two", () => {
    const index = buildRecordingReplayIndex([
      { id: "short.mp4", source: "automatic", games: [{ replayPath: "C:/Replays/first.dlr" }] },
      { id: "full.mp4", source: "automatic", games: [{ replayPath: "C:/Replays/first.dlr" }] },
    ]);
    expect(recordingIdForSet(["first.dlr"], "C:/Replays", index)).toBeNull();
  });

  it("ignores a legacy replay whose characters contradict its game metadata", () => {
    const index = buildRecordingReplayIndex([
      {
        id: "wrong.mp4",
        source: "automatic",
        games: [
          {
            matchId: "old-game",
            replayPath: "C:/Replays/wrong.dlr",
            metadata: { player1Character: "Aang", player2Character: "Korra" },
            replay: { player1Character: "Aang", player2Character: "Kyoshi" },
          },
        ],
        replays: [
          {
            matchId: "old-game",
            replayPath: "C:/Replays/wrong.dlr",
            replay: { player1Character: "Aang", player2Character: "Kyoshi" },
          },
        ],
      },
    ]);
    expect(recordingIdForSet(["wrong.dlr"], "C:/Replays", index)).toBeNull();
  });

  it("keeps recording links distinct when restored and recovered replays share a filename", () => {
    const oldHash = "a".repeat(64);
    const newHash = "b".repeat(64);
    const index = buildRecordingReplayIndex([
      {
        id: "old.mp4",
        source: "automatic",
        games: [{ replayPath: "C:/game/replays/first.dlr", replay: { contentHash: oldHash } }],
      },
      {
        id: "new.mp4",
        source: "automatic",
        games: [{ replayPath: "C:/game/replays/first.dlr", replay: { contentHash: newHash } }],
      },
    ]);
    const hashes = new Map([
      ["replays/first.dlr", oldHash],
      ["replays/Recovered while staged/abc/first.dlr", newHash],
    ]);
    expect(recordingIdForSet(["replays/first.dlr"], "C:/game", index, hashes)).toBe("old.mp4");
    expect(
      recordingIdForSet(["replays/Recovered while staged/abc/first.dlr"], "C:/game", index, hashes),
    ).toBe("new.mp4");
  });
});
