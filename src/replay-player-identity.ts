import type { ReplayRow } from "./AvatarGrid";
import type { RecordingPortraitSide } from "./recording-types";

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

export type ReplayUser = { key: string; steamId: string | null; names: string[] };

function usableName(name: string) {
  const normalized = name.trim().toLowerCase();
  return normalized && !/^(?:p[12]|player\s*[12]|unknown)$/.test(normalized) ? normalized : null;
}

export function inferReplayUser(games: ReplayRow[], groupedGames: ReplayRow[]): ReplayUser | null {
  const participation = new Map<string, number>();
  for (const { player1, player2 } of groupedGames) {
    for (const key of new Set([player1, player2])) {
      if (steamIdFromKey(key) || usableName(key)) {
        participation.set(key, (participation.get(key) ?? 0) + 1);
      }
    }
  }
  const [mostFrequent, runnerUp] = [...participation].sort((left, right) => right[1] - left[1]);
  if (!mostFrequent || mostFrequent[1] === runnerUp?.[1]) return null;

  const [key] = mostFrequent;
  const steamId = steamIdFromKey(key);
  const names = new Set<string>();
  const currentName = usableName(displayGroupedPlayerName(key));
  if (currentName) names.add(currentName);
  if (steamId) {
    const accountsByName = new Map<string, Set<string>>();
    for (const game of games) {
      for (const slot of [1, 2] as const) {
        const account = game[`player${slot}SteamId`];
        const name = usableName(game[`player${slot}`]);
        if (!account || !name) continue;
        const accounts = accountsByName.get(name) ?? new Set<string>();
        accounts.add(account);
        accountsByName.set(name, accounts);
      }
    }
    for (const [name, accounts] of accountsByName) {
      if (!accounts.has(steamId)) continue;
      if (accounts.size === 1) names.add(name);
      else names.delete(name);
    }
  }
  return { key, steamId, names: [...names] };
}

export function recordingPlayersWithUserFirst<
  T extends Pick<RecordingPortraitSide, "playerName" | "steamId">,
>(players: [T, T], user: ReplayUser | null): [T, T] {
  if (!user) return players;
  const [left, right] = players;
  if (user.steamId && (left.steamId === user.steamId || right.steamId === user.steamId)) {
    return left.steamId === user.steamId ? players : [right, left];
  }
  const matchesName = (player: T) =>
    (!user.steamId || !player.steamId) &&
    user.names.includes(player.playerName.trim().toLowerCase());
  return matchesName(right) && !matchesName(left) ? [right, left] : players;
}

export function recordingPlayerDisplayName(
  player: Pick<RecordingPortraitSide, "playerName" | "steamId">,
  user: ReplayUser | null,
) {
  if (!usableName(player.playerName) && user?.steamId && player.steamId === user.steamId) {
    const replayName = displayGroupedPlayerName(user.key);
    if (usableName(replayName)) return replayName;
  }
  return player.playerName;
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
