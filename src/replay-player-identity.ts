import type { ReplayRow } from "./AvatarGrid";

const STEAM_KEY_SEPARATOR = "\u0000steam:";

function steamIdFromKey(key: string): string | null {
  const separator = key.lastIndexOf(STEAM_KEY_SEPARATOR);
  if (separator < 0) return null;
  const steamId = key.slice(separator + STEAM_KEY_SEPARATOR.length);
  return /^\d+$/.test(steamId) ? steamId : null;
}

export function displayGroupedPlayerName(key: string): string {
  return steamIdFromKey(key) ? key.slice(0, key.lastIndexOf(STEAM_KEY_SEPARATOR)) : key;
}

/** Give every known Steam account one stable name throughout the match history. */
export function groupReplayPlayersBySteamId(games: ReplayRow[]): ReplayRow[] {
  const latestNameById = new Map<string, { name: string; timestamp: string }>();
  for (const game of games) {
    for (const slot of [1, 2] as const) {
      const steamId = game[`player${slot}SteamId`];
      if (!steamId) continue;
      const timestamp = game.timestamp ?? "";
      const current = latestNameById.get(steamId);
      if (!current || timestamp > current.timestamp) {
        latestNameById.set(steamId, { name: game[`player${slot}`], timestamp });
      }
    }
  }

  return games.map((game) => {
    const player1 = game.player1SteamId
      ? `${latestNameById.get(game.player1SteamId)?.name ?? game.player1}${STEAM_KEY_SEPARATOR}${game.player1SteamId}`
      : game.player1;
    const player2 = game.player2SteamId
      ? `${latestNameById.get(game.player2SteamId)?.name ?? game.player2}${STEAM_KEY_SEPARATOR}${game.player2SteamId}`
      : game.player2;
    return {
      ...game,
      player1,
      player2,
      winner:
        game.winnerSlot === 1
          ? player1
          : game.winnerSlot === 2
            ? player2
            : game.winner === "Unknown"
              ? "Unknown"
              : game.winner === game.player1
                ? player1
                : game.winner === game.player2
                  ? player2
                  : game.winner,
    };
  });
}

/** Follow a selected Steam account when its display name changes after a rescan. */
export function resolveGroupedPlayerSelection(
  selection: string | null,
  groupedGames: ReplayRow[],
): string | null {
  if (!selection) return null;
  const labels = new Set(groupedGames.flatMap((game) => [game.player1, game.player2]));
  if (labels.has(selection)) return selection;
  const steamId = steamIdFromKey(selection);
  if (!steamId) return selection;
  for (const game of groupedGames) {
    if (game.player1SteamId === steamId) return game.player1;
    if (game.player2SteamId === steamId) return game.player2;
  }
  return selection;
}
