import type { ReplayRow } from "./AvatarGrid";

export type OpponentSummaryRow = {
  name: string;
  sets: number;
  games: number;
  characters: Array<{ name: string; games: number }>;
};

export function summarizeOpponents(
  games: ReplayRow[],
  sessions: Array<{ games: ReplayRow[] }>,
  playerOfInterest: string,
): OpponentSummaryRow[] {
  const byOpponent = new Map<
    string,
    { sets: number; games: number; characters: Map<string, number> }
  >();
  const matchingGameIds = new Set<string>();

  for (const game of games) {
    matchingGameIds.add(game.id);
    const isPlayerOne = game.player1 === playerOfInterest;
    const name = isPlayerOne ? game.player2 : game.player1;
    const character = (isPlayerOne ? game.player2Character : game.player1Character) || "Unknown";
    const current = byOpponent.get(name) ?? { sets: 0, games: 0, characters: new Map() };
    current.games += 1;
    current.characters.set(character, (current.characters.get(character) ?? 0) + 1);
    byOpponent.set(name, current);
  }

  for (const session of sessions) {
    const opponentsInSet = new Set<string>();
    for (const game of session.games) {
      if (!matchingGameIds.has(game.id)) continue;
      opponentsInSet.add(game.player1 === playerOfInterest ? game.player2 : game.player1);
    }
    for (const name of opponentsInSet) {
      const current = byOpponent.get(name);
      if (current) current.sets += 1;
    }
  }

  return [...byOpponent.entries()]
    .map(([name, current]) => ({
      name,
      sets: current.sets,
      games: current.games,
      characters: [...current.characters.entries()]
        .map(([character, count]) => ({ name: character, games: count }))
        .sort((left, right) => right.games - left.games || left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => right.games - left.games || left.name.localeCompare(right.name));
}
