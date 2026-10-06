import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const { MatchLogWatcher } = require("../../electron/match-watcher.cjs");
const {
  canRecordLobbylessMatch,
  recordingMatchesAutomaticGame,
} = require("../../electron/lobbyless-recording.cjs");

const match = {
  matchId: "blaze drift creek river beach ghost vivid horizon",
  lobbyId: null,
  mode: "casual",
  player1: { steamId: "76561198010491730" },
  player2: { steamId: "76561198078956731" },
};

describe("lobbyless automatic recording safety", () => {
  it("detects ranked mode and player identities before a replay is saved", async () => {
    const watcher = new MatchLogWatcher({ onMatchStarted: () => true });
    await watcher.processLine(
      "[01:44:57] [TEL] SetNewMatch: New match started with ID ranked-game",
    );
    await watcher.processLine(
      "[01:44:57] [TEL] SetNewMatch: Player 1: Aang (SteamID: 76561198010491730, Glicko: [ R: 1907: D: 50: Vol: 0.060001])",
    );
    await watcher.processLine(
      "[01:44:57] [TEL] SetNewMatch: Player 2: Sokka (SteamID: 76561198078956731, Glicko: [ R: 1500: D: 350: Vol: 0.060000])",
    );
    await watcher.processLine("[01:44:57] [TEL] SetNewMatch: Casual: 0");
    expect(watcher.currentMatch?.mode).toBe("ranked");
    expect(watcher.currentMatch?.player1?.character).toBe("Aang");
    expect(watcher.currentMatch?.player2?.steamId).toBe("76561198078956731");
  });

  it("recovers an adopted public lobby when Labatar starts after the first game begins", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-public-lobby-"));
    const logPath = path.join(directory, "abare_log_test.txt");
    const lobbyId = "17799238216663001795";
    try {
      await fs.writeFile(
        logPath,
        [
          `[01:44:40] [MAT] Adopting already joined lobby: ${lobbyId} with gamemode PUBLIC`,
          "[01:44:57] [TEL] SetNewMatch: New match started with ID first-game",
          "[01:44:57] [TEL] SetNewMatch: Player 1: Aang (SteamID: 76561198010491730, Glicko: [ R: 1907: D: 50: Vol: 0.060001])",
          "[01:44:57] [TEL] SetNewMatch: Player 2: Sokka (SteamID: 76561198078956731, Glicko: [ R: 1500: D: 350: Vol: 0.060000])",
          "[01:44:57] [TEL] SetNewMatch: Casual: 1",
          "",
        ].join("\n"),
      );
      const started: string[] = [];
      const watcher = new MatchLogWatcher({
        onLobbyStarted: ({ lobbyId: id }: { lobbyId: string }) => started.push(`lobby:${id}`),
        onMatchStarted: (match: { matchId: string; lobbyId: string }) => {
          started.push(`match:${match.matchId}:${match.lobbyId}`);
          return true;
        },
      });
      await watcher.switchToLog(logPath);
      expect(watcher.lobbyId).toBe(lobbyId);
      expect(watcher.currentMatch?.lobbyId).toBe(lobbyId);
      expect(watcher.currentMatch?.mode).toBe("casual");
      expect(watcher.currentMatch?.player1).toMatchObject({
        character: "Aang",
        steamId: "76561198010491730",
      });
      expect(watcher.currentMatch?.player2).toMatchObject({
        character: "Sokka",
        steamId: "76561198078956731",
      });
      expect(started).toEqual([`lobby:${lobbyId}`, `match:first-game:${lobbyId}`]);
    } finally {
      await fs.unlink(logPath);
      await fs.rmdir(directory);
    }
  });

  it("treats public-lobby rematches as one lobby lifecycle", async () => {
    const lobbyId = "17799238216663001795";
    const events: string[] = [];
    const watcher = new MatchLogWatcher({
      onLobbyStarted: ({ lobbyId: id }: { lobbyId: string }) => events.push(`lobby-start:${id}`),
      onLobbyEnded: ({ lobbyId: id }: { lobbyId: string }) => events.push(`lobby-end:${id}`),
      onMatchStarted: (started: { matchId: string; lobbyId: string }) => {
        events.push(`match-start:${started.matchId}:${started.lobbyId}`);
        return true;
      },
      onMatchEnded: (ended: { matchId: string }) => events.push(`match-end:${ended.matchId}`),
    });
    await watcher.processLine(
      `[01:44:40] [MAT] Adopting already joined lobby: ${lobbyId} with gamemode PUBLIC`,
    );
    for (const matchId of ["game-one", "game-two"]) {
      await watcher.processLine(
        `[01:44:57] [TEL] SetNewMatch: New match started with ID ${matchId}`,
      );
      await watcher.processLine(
        `[01:44:57] [TEL] SetNewMatch: Player 1: Aang (SteamID: 76561198010491730, Glicko: [ R: 1907: D: 50: Vol: 0.060001])`,
      );
      await watcher.processLine(
        `[01:44:57] [TEL] SetNewMatch: Player 2: Sokka (SteamID: 76561198078956731, Glicko: [ R: 1500: D: 350: Vol: 0.060000])`,
      );
      await watcher.processLine("[01:44:57] [TEL] SetNewMatch: Casual: 1");
      await watcher.processLine("[01:46:56] [TEL] EndMatch: Match ended and telemetry submitted");
    }
    expect(watcher.lobbyId).toBe(lobbyId);
    expect(watcher.setNumber).toBe(1);
    expect(watcher.gameNumber).toBe(2);
    await watcher.processLine(`[02:32:48] Steam: Leaving lobby ${lobbyId}`);
    expect(watcher.lobbyId).toBeNull();
    expect(events).toEqual([
      `lobby-start:${lobbyId}`,
      `match-start:game-one:${lobbyId}`,
      "match-end:game-one",
      `match-start:game-two:${lobbyId}`,
      "match-end:game-two",
      `lobby-end:${lobbyId}`,
    ]);
  });

  it("does not start a meetup lobby twice when adoption follows XMatch", async () => {
    const starts: string[] = [];
    const watcher = new MatchLogWatcher({
      onLobbyStarted: ({ lobbyId }: { lobbyId: string }) => starts.push(lobbyId),
    });
    await watcher.processLine(
      "[01:33:19] XMatch: MATCHED opponent=123, lobbyId=4331450546401791302; starting finalize",
    );
    await watcher.processLine(
      "[01:33:21] [MAT] Adopting already joined lobby: 4331450546401791302 with gamemode MEETUP",
    );
    expect(starts).toEqual(["4331450546401791302"]);
  });

  it("accepts an identified two-player match without a lobby", () => {
    expect(canRecordLobbylessMatch(match)).toBe(true);
  });

  it("refuses unidentified, solo, and already-lobbied matches", () => {
    expect(canRecordLobbylessMatch({ ...match, lobbyId: "lobby" })).toBe(false);
    expect(canRecordLobbylessMatch({ ...match, player2: null })).toBe(false);
    expect(canRecordLobbylessMatch({ ...match, player2: match.player1 })).toBe(false);
    expect(canRecordLobbylessMatch({ ...match, mode: null })).toBe(false);
    expect(canRecordLobbylessMatch({ ...match, matchId: "" })).toBe(false);
  });

  it("only assigns games to their own single-match recording", () => {
    const recording = { source: "automatic", fallbackMatchId: match.matchId, lobbyId: null };
    expect(recordingMatchesAutomaticGame(recording, match)).toBe(true);
    expect(recordingMatchesAutomaticGame(recording, { ...match, matchId: "other" })).toBe(false);
    expect(recordingMatchesAutomaticGame({ ...recording, source: "manual" }, match)).toBe(false);
    expect(recordingMatchesAutomaticGame({ source: "automatic", lobbyId: "other" }, match)).toBe(
      false,
    );
  });
});
