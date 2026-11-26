import { describe, expect, it } from "vite-plus/test";
import { applyCombinedSets, type ReplayRow } from "./AvatarGrid";
import type { RecordedVideo } from "./recording-types";

const replay = (id: string, hash: string, timestamp: string): ReplayRow => ({
  id,
  contentHash: hash.repeat(64),
  timestamp,
  player1: "Me",
  player2: "Opponent",
  player1Character: "Aang",
  player2Character: "Korra",
  winner: "Me",
  player1Support: "None",
  player2Support: "None",
  roundScore: "1-0",
  ratings: null,
});

describe("combined match history sets", () => {
  it("shows three original sets as one while the combined recording exists, and restores them on split", () => {
    const games = [
      replay("newest", "3", "2026-11-15 12:00"),
      replay("middle", "2", "2026-11-15 11:00"),
      replay("oldest", "1", "2026-11-15 10:00"),
    ];
    const sessions = games.map((game) => ({
      id: `session-${game.id}`,
      started: game.timestamp!,
      record: "1 - 0",
      opponent: "Opponent",
      playerCharacters: "Aang",
      playerSupports: "None",
      opponentCharacters: "Korra",
      opponentSupports: "None",
      mode: "",
      playerMmrAtStart: "",
      playerMmrChange: "",
      games: [game],
    }));
    const combinedRecording = {
      id: "combined.mp4",
      combinedSets: {
        schemaVersion: 1,
        createdAt: "2026-11-15T12:30:00Z",
        sourceSets: [
          {
            recordingId: "oldest.mp4",
            replayKeys: [`sha256:${"1".repeat(64)}`],
            startMs: 0,
            durationMs: 1000,
          },
          {
            recordingId: "middle.mp4",
            replayKeys: [`sha256:${"2".repeat(64)}`],
            startMs: 1000,
            durationMs: 1000,
          },
          {
            recordingId: "newest.mp4",
            replayKeys: [`sha256:${"3".repeat(64)}`],
            startMs: 2000,
            durationMs: 1000,
          },
        ],
      },
    } as RecordedVideo;
    const combined = applyCombinedSets(sessions, [combinedRecording], "Me");
    expect(combined).toHaveLength(1);
    expect(combined[0]).toMatchObject({
      id: "combined:combined.mp4",
      record: "3 - 0",
      combinedSourceCount: 3,
      games: [{ id: "newest" }, { id: "middle" }, { id: "oldest" }],
    });
    expect(applyCombinedSets(sessions, [], "Me")).toEqual(sessions);
    expect(sessions.map((session) => session.games[0].id)).toEqual(["newest", "middle", "oldest"]);
  });
});
