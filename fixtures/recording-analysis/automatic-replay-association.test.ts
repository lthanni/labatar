import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const { MatchLogWatcher } = require("../../electron/match-watcher.cjs");
const {
  takePendingReplayMatch,
  replayMatchesGame,
  replayRoundScore,
} = require("../../electron/automatic-replay-association.cjs");

describe("automatic replay association", () => {
  it("publishes watcher state only when its contents change", () => {
    const states: string[] = [];
    const watcher = new MatchLogWatcher({
      onState: (state: unknown) => states.push(JSON.stringify(state)),
    });
    watcher.emit();
    watcher.emit();
    expect(states).toHaveLength(1);

    watcher.currentMatch = { matchId: "live", player1: { character: "Aang" } };
    watcher.emit();
    watcher.currentMatch.player1.character = "Korra";
    watcher.emit();
    watcher.emit();
    expect(states).toHaveLength(3);
  });

  it("matches a replay to the ended match even when an older game has no replay", async () => {
    const pending: Array<{ match: { matchId: string } }> = [];
    const attached: Array<{
      replayPath: string;
      matchId: string | null;
      pendingMatchId: string | null;
    }> = [];
    const watcher = new MatchLogWatcher({
      onMatchEnded: (match: { matchId: string }) => pending.push({ match }),
      onReplaySaved: (replayPath: string, matchId: string | null) => {
        const match = takePendingReplayMatch(pending, matchId);
        attached.push({ replayPath, matchId, pendingMatchId: match?.match.matchId ?? null });
      },
    });

    watcher.currentMatch = { matchId: "gg8", lobbyId: "old-lobby" };
    await watcher.processLine("[00:44:40] EndMatch: Match ended and telemetry submitted");
    await watcher.processLine("[00:45:11] SetNewMatch: New match started with ID bustafat");
    await watcher.processLine("[00:47:41] EndMatch: Match ended and telemetry submitted");
    await watcher.processLine("[00:47:41] Successfully wrote replay file: C:/replays/bustafat.dlr");

    expect(attached).toEqual([
      {
        replayPath: "C:/replays/bustafat.dlr",
        matchId: "bustafat",
        pendingMatchId: "bustafat",
      },
    ]);
    expect(pending.map((entry) => entry.match.matchId)).toEqual(["gg8"]);
  });

  it("leaves a replay unlinked when the log provides no match identity", async () => {
    const pending = [{ match: { matchId: "old" } }];
    let linkedMatchId: string | null = "unexpected";
    const watcher = new MatchLogWatcher({
      onReplaySaved: (_replayPath: string, matchId: string | null) => {
        linkedMatchId = takePendingReplayMatch(pending, matchId)?.match.matchId ?? null;
      },
    });

    await watcher.processLine("[00:47:41] Successfully wrote replay file: C:/replays/unknown.dlr");

    expect(linkedMatchId).toBeNull();
    expect(pending).toHaveLength(1);
  });

  it("rejects a replay with another game's characters, including during a name rebuild", () => {
    const game = { metadata: { player1Character: "Aang", player2Character: "Korra" } };
    expect(replayMatchesGame(game, { player1Character: "Aang", player2Character: "Kyoshi" })).toBe(
      false,
    );
    expect(replayMatchesGame(game, { player1Character: "Aang", player2Character: "Korra" })).toBe(
      true,
    );
    expect(
      replayMatchesGame({ metadata: {} }, { player1Character: "Aang", player2Character: "Korra" }),
    ).toBe(false);
    expect(
      replayMatchesGame(
        { metadata: { player1Character: "korra_nightmare", player2Character: "Aang" } },
        { player1Character: "Nightmare Korra", player2Character: "Aang" },
        (character: string) => (character === "korra_nightmare" ? "Nightmare Korra" : character),
      ),
    ).toBe(true);
  });

  it("treats an omitted score side as zero only when the other side is present", () => {
    expect(replayRoundScore({ TM_WinsT1: "4" })).toBe("4 - 0");
    expect(replayRoundScore({ TM_WinsT2: "2" })).toBe("0 - 2");
    expect(replayRoundScore({ TM_WinsT1: "1", TM_WinsT2: "1" })).toBe("1 - 1");
    expect(replayRoundScore({})).toBe("Unknown");
    expect(replayRoundScore({ TM_WinsT1: "bad" })).toBe("Unknown");
  });

  it("does not recover a match from a stale log", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-watch-"));
    const logPath = path.join(directory, "abare_log_test.txt");
    try {
      await fs.writeFile(
        logPath,
        "[00:00:00] SetNewMatch: New match started with ID stale-match\n",
      );
      const oldTime = new Date(Date.now() - 10 * 60_000);
      await fs.utimes(logPath, oldTime, oldTime);
      let recovered = false;
      const watcher = new MatchLogWatcher({
        onMatchStarted: () => {
          recovered = true;
        },
      });
      await watcher.switchToLog(logPath);
      expect(watcher.currentMatch).toBeNull();
      expect(recovered).toBe(false);
      expect(watcher.offset).toBe((await fs.stat(logPath)).size);
    } finally {
      await fs.unlink(logPath);
      await fs.rmdir(directory);
    }
  });

  it("does not recover a match that ended by quit in a fresh log", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-watch-"));
    const logPath = path.join(directory, "abare_log_test.txt");
    try {
      await fs.writeFile(
        logPath,
        [
          "[00:00:00] SetNewMatch: New match started with ID ended-match",
          "[00:00:30] Ending Netplay from script with reason: Quit",
          "",
        ].join("\n"),
      );
      const watcher = new MatchLogWatcher({});
      await watcher.switchToLog(logPath);
      expect(watcher.currentMatch).toBeNull();
    } finally {
      await fs.unlink(logPath);
      await fs.rmdir(directory);
    }
  });
});
