import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const { createOpponentSetHistory } = createRequire(import.meta.url)(
  "../../electron/opponent-set-history.cjs",
);

let root: string;

function history() {
  return createOpponentSetHistory({
    cachePath: () => join(root, "opponent-set-history.json"),
    getLogsDirectory: () => root,
  });
}

function matched(opponentSteamId: string, lobbyId: string) {
  return `XMatch: MATCHED opponent=${opponentSteamId}, lobbyId=${lobbyId}; starting finalize`;
}

function joined(lobbyId: string) {
  return `Joined meetup lobby, setting currentMeetupLobbyIdHash to ${lobbyId}`;
}

function game(id: string, player1SteamId: string, player2SteamId: string) {
  return [
    `SetNewMatch: New match started with ID ${id}`,
    `SetNewMatch: Player 1: Aang (SteamID: ${player1SteamId}, Glicko: [])`,
    `SetNewMatch: Player 2: Sokka (SteamID: ${player2SteamId}, Glicko: [])`,
  ];
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "labatar-opponent-sets-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("opponent set history", () => {
  it("counts played lobbies once per opponent across log files", async () => {
    writeFileSync(
      join(root, "abare_log_one.txt"),
      [
        matched("111", "100"),
        joined("100"),
        ...game("game-one", "999", "111"),
        ...game("game-two", "111", "999"),
        "Steam: Leaving lobby 100",
        matched("111", "101"),
        joined("101"),
        "Steam: Leaving lobby 101",
        matched("222", "200"),
        joined("200"),
        ...game("game-three", "999", "222"),
      ].join("\n"),
    );
    writeFileSync(
      join(root, "abare_log_two.txt"),
      [
        matched("111", "100"),
        joined("100"),
        ...game("duplicate-log", "999", "111"),
        matched("111", "102"),
        joined("102"),
        ...game("game-four", "999", "111"),
        matched("111", "300"),
        joined("300"),
        ...game("different-local-player", "888", "111"),
      ].join("\n"),
    );

    const sets = history();
    expect(await sets.setNumberForLobby("100")).toBe(2);
    expect(await sets.setNumberForLobby("102")).toBe(2);
    expect(await sets.setNumberForLobby("200")).toBe(1);
    expect(await sets.setNumberForLobby("300")).toBe(1);
    expect(await sets.setNumberForLobby("101")).toBeNull();
  });

  it("keeps observed sets after old logs disappear and indexes new games", async () => {
    const oldLog = join(root, "abare_log_old.txt");
    writeFileSync(
      oldLog,
      [matched("111", "100"), joined("100"), ...game("old", "999", "111")].join("\n"),
    );
    expect(await history().setNumberForLobby("100")).toBe(1);
    rmSync(oldLog);

    const newLog = join(root, "abare_log_new.txt");
    writeFileSync(
      newLog,
      [matched("111", "101"), joined("101"), ...game("new", "999", "111")].join("\n"),
    );
    const restarted = history();
    expect(await restarted.setNumberForLobby("101")).toBe(2);
    writeFileSync(
      newLog,
      [
        matched("111", "101"),
        joined("101"),
        ...game("new", "999", "111"),
        matched("111", "102"),
        joined("102"),
        ...game("newer", "999", "111"),
      ].join("\n"),
    );
    expect(await restarted.setNumberForLobby("102")).toBe(3);
  });

  it("rebuilds a historical ordinal rather than using today's opponent total", async () => {
    writeFileSync(
      join(root, "abare_log_one.txt"),
      [
        "[2026-08-01 23:59:40 UTC]",
        `[23:59:45] ${matched("111", "100")}`,
        `[23:59:46] ${joined("100")}`,
        ...game("first", "999", "111").map((line) => `[23:59:47] ${line}`),
        `[00:00:05] ${matched("111", "102")}`,
        `[00:00:06] ${joined("102")}`,
        ...game("third", "999", "111").map((line) => `[00:00:10] ${line}`),
      ].join("\n"),
    );
    writeFileSync(
      join(root, "abare_log_two.txt"),
      [
        "[2026-08-02 00:00:00 UTC]",
        `[00:00:01] ${matched("111", "101")}`,
        `[00:00:02] ${joined("101")}`,
        ...game("second", "999", "111").map((line) => `[00:00:03] ${line}`),
      ].join("\n"),
    );

    const sets = history();
    expect(await sets.setNumberForLobby("100")).toBe(3);
    expect(await sets.historicalSetNumberForLobby("100")).toBe(1);
    expect(await sets.historicalSetNumberForLobby("101")).toBe(2);
    expect(await sets.historicalSetNumberForLobby("102")).toBe(3);
  });

  it("does not guess a historical ordinal when a known set has no timestamp", async () => {
    writeFileSync(
      join(root, "opponent-set-history.json"),
      JSON.stringify({
        schemaVersion: 2,
        scannedFiles: [],
        setsByLobby: [["100", { playerSteamId: "999", opponentSteamId: "111" }]],
      }),
    );
    writeFileSync(
      join(root, "abare_log_new.txt"),
      [
        "[2026-08-02 00:00:00 UTC]",
        `[00:00:01] ${matched("111", "101")}`,
        `[00:00:02] ${joined("101")}`,
        ...game("new", "999", "111").map((line) => `[00:00:03] ${line}`),
      ].join("\n"),
    );

    const sets = history();
    expect(await sets.setNumberForLobby("101")).toBe(2);
    expect(await sets.historicalSetNumberForLobby("101")).toBeNull();
  });
});
