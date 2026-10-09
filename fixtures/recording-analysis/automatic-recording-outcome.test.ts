import { createRequire } from "node:module";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const {
  noGameStartedRecordingBaseName,
} = require("../../electron/automatic-recording-outcome.cjs");

describe("automatic recordings with no game", () => {
  const recording = {
    source: "automatic",
    lobbyId: "7813738033888547190",
    startedAt: "2026-10-07T01:20:54.914Z",
    games: [],
  };

  it("names a lobby closed before SetNewMatch without inventing players or a set", () => {
    expect(noGameStartedRecordingBaseName(recording)).toBe(
      "No game started - 2026-10-07 01-20-54 UTC",
    );
  });

  it("does not change real sets or manual recordings", () => {
    expect(
      noGameStartedRecordingBaseName({ ...recording, games: [{ matchId: "first" }] }),
    ).toBeNull();
    expect(noGameStartedRecordingBaseName({ ...recording, source: "manual" })).toBeNull();
  });
});
