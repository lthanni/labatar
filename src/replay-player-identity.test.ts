import { describe, expect, it } from "vite-plus/test";
import type { ReplayRow } from "./AvatarGrid";
import {
  displayGroupedPlayerName,
  groupReplayPlayersBySteamId,
  resolveGroupedPlayerSelection,
} from "./replay-player-identity";

function game(
  id: string,
  timestamp: string,
  player1: string,
  player1SteamId: string,
  player2: string,
  player2SteamId: string,
): ReplayRow {
  return {
    id,
    timestamp,
    player1,
    player2,
    player1SteamId,
    player2SteamId,
    player1Character: "Aang",
    player2Character: "Korra",
    player1Support: "",
    player2Support: "",
    winner: player2,
    roundScore: "",
    ratings: null,
  };
}

describe("Steam player grouping", () => {
  it("uses the latest name for one Steam ID and keeps equal names with different IDs separate", () => {
    const grouped = groupReplayPlayersBySteamId([
      game("old", "2026-01-01", "Me", "1", "Old name", "2"),
      game("new", "2026-02-01", "New name", "2", "Me", "1"),
      game("other", "2026-03-01", "Me", "3", "Unknown", ""),
    ]);
    expect(grouped[0].player2).toBe(grouped[1].player1);
    expect(grouped[0].player1).not.toBe(grouped[2].player1);
    expect(
      grouped.map(({ player1, player2, winner }) => ({
        player1: displayGroupedPlayerName(player1),
        player2: displayGroupedPlayerName(player2),
        winner: displayGroupedPlayerName(winner),
      })),
    ).toEqual([
      { player1: "Me", player2: "New name", winner: "New name" },
      { player1: "New name", player2: "Me", winner: "Me" },
      { player1: "Me", player2: "Unknown", winner: "Unknown" },
    ]);
  });

  it("keeps the winner tied to the replay slot when both players have the same name", () => {
    const replay = game("same", "2026-01-01", "Alex", "1", "Alex", "2");
    replay.winnerSlot = 2;
    const grouped = groupReplayPlayersBySteamId([replay])[0];
    expect(grouped.winner).toBe(grouped.player2);
    expect(displayGroupedPlayerName(grouped.winner)).toBe("Alex");
  });

  it("keeps a selected Steam account after its name changes on rescan", () => {
    const grouped = groupReplayPlayersBySteamId([
      game("new", "2026-02-01", "Me", "1", "Renamed", "2"),
    ]);
    expect(resolveGroupedPlayerSelection("Old name\u0000steam:2", grouped)).toBe(
      grouped[0].player2,
    );
  });

  it("preserves numeric text in names without Steam IDs", () => {
    expect(displayGroupedPlayerName("Alex (123) ")).toBe("Alex (123) ");
  });
});
