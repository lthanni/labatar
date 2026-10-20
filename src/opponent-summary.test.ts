import { describe, expect, it } from "vite-plus/test";
import type { ReplayRow } from "./AvatarGrid";
import { summarizeOpponents } from "./opponent-summary";

function game(
  id: string,
  player1: string,
  player2: string,
  player1Character: string,
  player2Character: string,
): ReplayRow {
  return {
    id,
    timestamp: null,
    player1,
    player2,
    player1Character,
    player2Character,
    winner: "Unknown",
    player1Support: "",
    player2Support: "",
    roundScore: "",
    ratings: null,
  };
}

describe("opponent summaries", () => {
  it("counts matching games and distinct sets when player sides change", () => {
    const first = game("first", "Me", "A", "Aang", "Korra");
    const second = game("second", "A", "Me", "Zuko", "Aang");
    const third = game("third", "Me", "B", "Aang", "Toph");
    const fourth = game("fourth", "Me", "A", "Aang", "Korra");
    const sessions = [{ games: [first, second] }, { games: [third] }, { games: [fourth] }];

    expect(summarizeOpponents([first, second, third, fourth], sessions, "Me")).toEqual([
      {
        name: "A",
        sets: 2,
        games: 3,
        characters: [
          { name: "Korra", games: 2 },
          { name: "Zuko", games: 1 },
        ],
      },
      { name: "B", sets: 1, games: 1, characters: [{ name: "Toph", games: 1 }] },
    ]);

    expect(summarizeOpponents([second, third], sessions, "Me")).toEqual([
      { name: "A", sets: 1, games: 1, characters: [{ name: "Zuko", games: 1 }] },
      { name: "B", sets: 1, games: 1, characters: [{ name: "Toph", games: 1 }] },
    ]);
  });
});
