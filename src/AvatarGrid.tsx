import { useEffect, useMemo, useRef, useState } from "react";
import type { ColDef, ICellRendererParams, ValueGetterParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import {
  AnalyticsSection,
  OPPONENT_CHARACTER_ROSTER,
  isInDateRange,
  type AnalysisSummary,
} from "./AnalyticsSection";
import { buildRecordingReplayIndex, recordingIdForSet } from "./recording-replay-links";
import type { RecordedVideo } from "./recording-types";
import type { ReplayStagingPreview, ReplayStagingStatus } from "./replay-staging-types";
import { techSelectedRecordingStorageKey, techSelectRecordingEvent } from "./tech-types";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Menu,
  MenuItem,
  Pagination,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";

const SETS_PER_PAGE = 50;

export type ReplayRow = {
  id: string;
  contentHash?: string;
  timestamp: string | null;
  player1: string;
  player2: string;
  player1Character: string;
  player2Character: string;
  winner: string;
  player1Support: string;
  player2Support: string;
  roundScore: string;
  ratings: ReplayRatings | null;
};
export type ReplayRating = {
  rating: number | null;
  deviation: number | null;
  volatility: number | null;
  characterMmr: number | null;
  mmrChange: number | null;
};
export type ReplayRatings = {
  mode: string;
  affectsRank: boolean | null;
  player1: ReplayRating;
  player2: ReplayRating;
};
type SessionRow = {
  id: string;
  started: string;
  record: string;
  opponent: string;
  playerCharacters: string;
  playerSupports: string;
  opponentCharacters: string;
  opponentSupports: string;
  mode: string;
  playerMmrAtStart: string;
  playerMmrChange: string;
  games: ReplayRow[];
};
type DisplayRow =
  | (SessionRow & { kind: "session" })
  | (ReplayRow & { kind: "game"; sessionId: string });
type ExportMessage = { severity: "success" | "error"; text: string };
type ContextMenuState = { data: DisplayRow; mouseX: number; mouseY: number } | null;
type CharacterSupportPair = { character: string; support: string };
type PortraitUrls = { portraitUrl: string | null; supportUrl: string | null };

function portraitPairKey(pair: CharacterSupportPair) {
  return JSON.stringify([pair.character, pair.support]);
}

function characterSupportForGame(
  game: ReplayRow,
  playerOfInterest: string | null,
  side: "player" | "opponent",
): CharacterSupportPair {
  const playerIsPlayer1 = playerOfInterest === game.player1;
  const usePlayer1 = side === "player" ? playerIsPlayer1 : !playerIsPlayer1;
  return usePlayer1
    ? { character: game.player1Character, support: game.player1Support }
    : { character: game.player2Character, support: game.player2Support };
}

function characterSupportPairsForRow(
  row: DisplayRow,
  playerOfInterest: string | null,
  side: "player" | "opponent",
): CharacterSupportPair[] {
  const games = row.kind === "session" ? row.games : [row];
  const seen = new Set<string>();
  return games
    .map((game) => characterSupportForGame(game, playerOfInterest, side))
    .filter((pair) => {
      const key = portraitPairKey(pair);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function CharacterSupportCell({
  pairs,
  portraits,
  rightAligned = false,
}: {
  pairs: CharacterSupportPair[];
  portraits: Readonly<Record<string, PortraitUrls>>;
  rightAligned?: boolean;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        height: "100%",
        width: rightAligned ? "100%" : undefined,
        minWidth: 0,
        alignItems: "center",
        justifyContent: rightAligned ? "flex-end" : undefined,
        overflowX: "auto",
      }}
    >
      {pairs.map((pair) => {
        const artwork = portraits[portraitPairKey(pair)];
        const support = pair.support.trim();
        const showSupport = support && !/^(?:none|unknown)$/i.test(support);
        return (
          <Stack
            key={portraitPairKey(pair)}
            direction="row"
            spacing={0.25}
            title={`${pair.character}${showSupport ? ` / ${support}` : ""}`}
            sx={{ alignItems: "center", flexShrink: 0 }}
          >
            {artwork?.portraitUrl ? (
              <Box
                component="img"
                src={artwork.portraitUrl}
                alt={pair.character}
                loading="lazy"
                sx={{ width: 34, height: 34, objectFit: "contain" }}
              />
            ) : (
              <Typography variant="caption" noWrap sx={{ maxWidth: 90 }}>
                {pair.character}
              </Typography>
            )}
            {showSupport &&
              (artwork?.supportUrl ? (
                <Box
                  component="img"
                  src={artwork.supportUrl}
                  alt={support}
                  loading="lazy"
                  sx={{ width: 28, height: 34, objectFit: "contain" }}
                />
              ) : (
                <Typography variant="caption" noWrap sx={{ maxWidth: 90 }}>
                  {support}
                </Typography>
              ))}
          </Stack>
        );
      })}
    </Stack>
  );
}

function formatReplayTimestamp(timestamp: string | null) {
  if (!timestamp) return "";
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!match) return timestamp;
  const [, year, month, day, hour, minute] = match;
  const currentYear = new Date().getFullYear().toString();
  return `${year === currentYear ? "" : `${year} `}${month}/${day} ${hour}:${minute}`;
}

function formatRatingValue(value: number | null) {
  if (value === null) return null;
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function getReplayMode(game: ReplayRow) {
  return game.ratings?.mode.trim().toLowerCase() ?? null;
}

function getReplayRating(game: ReplayRow, poi: string | null) {
  if (!game.ratings) return null;
  const playerIsPlayer1 = poi === null || poi === game.player1;
  return playerIsPlayer1 ? game.ratings.player1 : game.ratings.player2;
}

function getReplayMmr(game: ReplayRow, poi: string | null) {
  const characterMmr = getReplayCharacterMmr(game, poi);
  if (characterMmr !== null) return characterMmr;
  return getReplayRating(game, poi)?.rating ?? null;
}

function getReplayCharacterMmr(game: ReplayRow, poi: string | null) {
  const rating = getReplayRating(game, poi);
  if (!rating) return null;
  if (rating.characterMmr !== null && rating.characterMmr >= 0) return rating.characterMmr;
  return null;
}

function getSessionMode(games: ReplayRow[]) {
  return [...new Set(games.map(getReplayMode).filter(Boolean))].join(", ");
}

function getSessionMmrAtStart(games: ReplayRow[], poi: string | null) {
  const rankedGames = games.filter((game) => getReplayMode(game) === "ranked");
  if (rankedGames.length === 0) return "";
  const firstGame = rankedGames.at(-1)!;
  const postGameMmr = getReplayCharacterMmr(firstGame, poi);
  const firstGameChange = getReplayMmrChange(firstGame, poi);
  const startMmr =
    postGameMmr !== null && firstGameChange !== null
      ? postGameMmr - firstGameChange
      : getReplayMmr(firstGame, poi);
  return formatRatingValue(startMmr) ?? "";
}

function getSessionMmrChange(games: ReplayRow[], poi: string | null) {
  const rankedGames = games.filter((game) => getReplayMode(game) === "ranked");
  if (rankedGames.length === 0) return "";
  const gameChanges = rankedGames.map((game) => getReplayMmrChange(game, poi));
  if (gameChanges.every((change): change is number => change !== null)) {
    const change = gameChanges.reduce((total, current) => total + current, 0);
    return `${change > 0 ? "+" : ""}${formatRatingValue(change)}`;
  }
  if (rankedGames.length < 2) return "";
  const startMmr = getReplayMmr(rankedGames.at(-1)!, poi);
  const endMmr = getReplayMmr(rankedGames[0], poi);
  if (startMmr === null || endMmr === null) return "";
  const change = endMmr - startMmr;
  return `${change > 0 ? "+" : ""}${formatRatingValue(change)}`;
}

function getReplayMmrChange(game: ReplayRow, poi: string | null) {
  if (getReplayMode(game) !== "ranked") return null;
  return getReplayRating(game, poi)?.mmrChange ?? null;
}

function formatMmrChange(value: number | null) {
  if (value === null) return "";
  return `${value > 0 ? "+" : ""}${formatRatingValue(value)}`;
}

function getMmrChangeCellStyle(value: unknown) {
  const change =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(change) || change === 0) return undefined;

  const intensity = Math.min(Math.abs(change) / 25, 1);
  const neutral = [176, 190, 197];
  const target = change > 0 ? [129, 199, 132] : [239, 154, 154];
  const color = neutral.map((channel, index) =>
    Math.round(channel + (target[index] - channel) * intensity),
  );
  return {
    color: `rgb(${color.join(", ")})`,
    fontWeight: intensity >= 0.5 ? 600 : 400,
  };
}

function getPlayerMmrParts(data: DisplayRow | undefined, poi: string | null) {
  if (!data) return { mmr: "", change: "" };
  return data.kind === "session"
    ? { mmr: data.playerMmrAtStart, change: data.playerMmrChange }
    : { mmr: "", change: formatMmrChange(getReplayMmrChange(data, poi)) };
}

function getOpponentForRow(data: DisplayRow, poi: string | null) {
  if (data.kind === "session") return data.opponent;
  return poi === data.player1 ? data.player2 : data.player1;
}

function getOpponentMmrForRow(data: DisplayRow, poi: string | null) {
  const opponent = getOpponentForRow(data, poi);
  return data.kind === "session"
    ? getSessionMmrAtStart(data.games, opponent)
    : (formatRatingValue(getReplayMmr(data, opponent)) ?? "");
}

function getGameResult(game: ReplayRow, poi: string | null) {
  if (!poi) return "";
  if (game.winner === poi) return "W";
  const opponent = poi === game.player1 ? game.player2 : game.player1;
  return game.winner === opponent ? "L" : "";
}

type MatchScore = readonly [number, number];

function parseMatchScore(roundScore: string): MatchScore | null {
  const match = roundScore.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function getMatchupKey(game: ReplayRow) {
  return [game.player1, game.player2]
    .sort((left, right) => left.localeCompare(right))
    .join("\u0000");
}

function getMatchScore(game: ReplayRow): MatchScore | null {
  const score = parseMatchScore(game.roundScore);
  if (!score) return null;
  return game.player1.localeCompare(game.player2) <= 0 ? score : [score[1], score[0]];
}

function scoresCanContinue(
  newerGame: ReplayRow,
  olderGame: ReplayRow,
  unknownGamesBetween: number,
) {
  const newerScore = getMatchScore(newerGame);
  const olderScore = getMatchScore(olderGame);
  if (!newerScore || !olderScore) return false;

  // Games are processed oldest first. A contiguous set therefore advances
  // one game per replay when walking to the next newer replay.
  const firstScoreDelta = newerScore[0] - olderScore[0];
  const secondScoreDelta = newerScore[1] - olderScore[1];
  return (
    firstScoreDelta >= 0 &&
    secondScoreDelta >= 0 &&
    firstScoreDelta + secondScoreDelta === unknownGamesBetween + 1
  );
}

function appendToSessions(sessions: ReplayRow[][], game: ReplayRow) {
  const currentSession = sessions.at(-1);
  if (!currentSession) {
    sessions.push([game]);
    return;
  }

  const previous = currentSession.at(-1);
  if (!previous || getMatchupKey(previous) !== getMatchupKey(game)) {
    sessions.push([game]);
    return;
  }

  const gameMode = getReplayMode(game);
  if (
    gameMode &&
    currentSession.some((candidate) => {
      const candidateMode = getReplayMode(candidate);
      return candidateMode !== null && candidateMode !== gameMode;
    })
  ) {
    // A mode change is another boundary signal. If the current session ends
    // with scoreless replays, keep that tail with the newer session: those
    // are commonly the opening replays whose score header has not been
    // populated yet.
    const lastScoredIndex = currentSession.findLastIndex(
      (candidate) => getMatchScore(candidate) !== null,
    );
    if (lastScoredIndex >= 0 && lastScoredIndex < currentSession.length - 1) {
      const scorelessTail = currentSession.splice(lastScoredIndex + 1);
      sessions.push([...scorelessTail, game]);
    } else {
      sessions.push([game]);
    }
    return;
  }

  const gameScore = getMatchScore(game);
  if (!gameScore) {
    currentSession.push(game);
    return;
  }

  const lastScoredIndex = currentSession.findLastIndex(
    (candidate) => getMatchScore(candidate) !== null,
  );
  if (lastScoredIndex < 0) {
    currentSession.push(game);
    return;
  }

  const unknownGamesBetween = currentSession.length - lastScoredIndex - 1;
  const lastScoredGame = currentSession[lastScoredIndex];
  if (scoresCanContinue(game, lastScoredGame, unknownGamesBetween)) {
    currentSession.push(game);
    return;
  }

  const scorelessTail = currentSession.splice(lastScoredIndex + 1);
  sessions.push([...scorelessTail, game]);
}

function sortGamesChronologically(games: ReplayRow[]) {
  return [...games].sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
}

function finalizeSessions(sessions: ReplayRow[][]) {
  // Grouping is easiest to reason about oldest-to-newest. The grid and MMR
  // calculations expect each session's games newest-to-oldest, so restore
  // that order at the boundary. Preserve the grid's newest-session-first
  // ordering as well.
  return [...sessions].reverse().map((sessionGames) => [...sessionGames].reverse());
}

function makeSessions(games: ReplayRow[], poi: string | null): SessionRow[] {
  const sessions: ReplayRow[][] = [];
  const sortedGames = sortGamesChronologically(games);
  for (const game of sortedGames) appendToSessions(sessions, game);
  return finalizeSessions(sessions).map((sessionGames, index) => {
    const wins = sessionGames.filter((game) => game.winner === poi).length;
    const losses = sessionGames.filter(
      (game) => game.winner !== "Unknown" && game.winner !== poi,
    ).length;
    const first = sessionGames[0];
    return {
      id: `session-${index}-${first.id}`,
      started: sessionGames.at(-1)?.timestamp ?? "Unknown",
      record: `${wins} - ${losses}`,
      opponent: poi === first.player1 ? first.player2 : first.player1,
      playerCharacters: [
        ...new Set(
          sessionGames.map((game) =>
            poi === game.player1 ? game.player1Character : game.player2Character,
          ),
        ),
      ].join(", "),
      playerSupports: [
        ...new Set(
          sessionGames.map((game) =>
            poi === game.player1 ? game.player1Support : game.player2Support,
          ),
        ),
      ].join(", "),
      opponentCharacters: [
        ...new Set(
          sessionGames.map((game) =>
            poi === game.player1 ? game.player2Character : game.player1Character,
          ),
        ),
      ].join(", "),
      opponentSupports: [
        ...new Set(
          sessionGames.map((game) =>
            poi === game.player1 ? game.player2Support : game.player1Support,
          ),
        ),
      ].join(", "),
      mode: getSessionMode(sessionGames),
      playerMmrAtStart: getSessionMmrAtStart(sessionGames, poi),
      playerMmrChange: getSessionMmrChange(sessionGames, poi),
      games: sessionGames,
    };
  });
}

function makeSessionsAsync(
  games: ReplayRow[],
  poi: string | null,
  onProgress: (completed: number, total: number) => void,
  isCancelled: () => boolean,
): Promise<SessionRow[]> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (isCancelled()) {
        resolve([]);
        return;
      }
      const sortedGames = sortGamesChronologically(games);
      const sessions: ReplayRow[][] = [];
      let index = 0;

      const processBatch = () => {
        if (isCancelled()) {
          resolve([]);
          return;
        }
        const end = Math.min(index + 250, sortedGames.length);
        for (; index < end; index += 1) {
          const game = sortedGames[index];
          appendToSessions(sessions, game);
        }
        onProgress(index, sortedGames.length);
        if (index < sortedGames.length) {
          window.setTimeout(processBatch, 0);
        } else {
          resolve(
            finalizeSessions(sessions).map((sessionGames, sessionIndex) => {
              const wins = sessionGames.filter((game) => game.winner === poi).length;
              const losses = sessionGames.filter(
                (game) => game.winner !== "Unknown" && game.winner !== poi,
              ).length;
              const first = sessionGames[0];
              return {
                id: `session-${sessionIndex}-${first.id}`,
                started: sessionGames.at(-1)?.timestamp ?? "Unknown",
                record: `${wins} - ${losses}`,
                opponent: poi === first.player1 ? first.player2 : first.player1,
                playerCharacters: [
                  ...new Set(
                    sessionGames.map((game) =>
                      poi === game.player1 ? game.player1Character : game.player2Character,
                    ),
                  ),
                ].join(", "),
                playerSupports: [
                  ...new Set(
                    sessionGames.map((game) =>
                      poi === game.player1 ? game.player1Support : game.player2Support,
                    ),
                  ),
                ].join(", "),
                opponentCharacters: [
                  ...new Set(
                    sessionGames.map((game) =>
                      poi === game.player1 ? game.player2Character : game.player1Character,
                    ),
                  ),
                ].join(", "),
                opponentSupports: [
                  ...new Set(
                    sessionGames.map((game) =>
                      poi === game.player1 ? game.player2Support : game.player1Support,
                    ),
                  ),
                ].join(", "),
                mode: getSessionMode(sessionGames),
                playerMmrAtStart: getSessionMmrAtStart(sessionGames, poi),
                playerMmrChange: getSessionMmrChange(sessionGames, poi),
                games: sessionGames,
              };
            }),
          );
        }
      };

      processBatch();
    }, 0);
  });
}

function projectSession(session: SessionRow, games: ReplayRow[], poi: string | null): SessionRow {
  const wins = games.filter((game) => game.winner === poi).length;
  const losses = games.filter((game) => game.winner !== "Unknown" && game.winner !== poi).length;
  return {
    ...session,
    started: games.at(-1)?.timestamp ?? "Unknown",
    record: `${wins} - ${losses}`,
    playerCharacters: [
      ...new Set(
        games.map((game) => (poi === game.player1 ? game.player1Character : game.player2Character)),
      ),
    ].join(", "),
    playerSupports: [
      ...new Set(
        games.map((game) => (poi === game.player1 ? game.player1Support : game.player2Support)),
      ),
    ].join(", "),
    opponentCharacters: [
      ...new Set(
        games.map((game) => (poi === game.player1 ? game.player2Character : game.player1Character)),
      ),
    ].join(", "),
    opponentSupports: [
      ...new Set(
        games.map((game) => (poi === game.player1 ? game.player2Support : game.player1Support)),
      ),
    ].join(", "),
    mode: getSessionMode(games),
    playerMmrAtStart: getSessionMmrAtStart(games, poi),
    playerMmrChange: getSessionMmrChange(games, poi),
    games,
  };
}

export function AvatarGrid({
  rowData,
  replayFolder,
  active,
  recordingsRefreshToken,
  playerOfInterest,
  playerCounts,
  playerOverride,
  onPlayerOverrideChange,
  dateFrom,
  dateTo,
  invalidDateRange,
  onSummaryChange,
  onReplaysChanged,
}: {
  rowData: ReplayRow[];
  replayFolder: string | null;
  active: boolean;
  recordingsRefreshToken: number;
  playerOfInterest: string | null;
  playerCounts: Record<string, number>;
  playerOverride: string | null;
  onPlayerOverrideChange: (value: string | null) => void;
  dateFrom: string;
  dateTo: string;
  invalidDateRange: boolean;
  onSummaryChange: (summary: AnalysisSummary) => void;
  onReplaysChanged: () => void;
}) {
  const gridRef = useRef<AgGridReact<DisplayRow>>(null);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({
    opponent: [] as string[],
  });
  const [page, setPage] = useState(1);
  const [sessionRows, setSessionRows] = useState<SessionRow[]>(() =>
    makeSessions(rowData, playerOfInterest),
  );
  const [sessionProgress, setSessionProgress] = useState({ completed: 0, total: 0 });
  const [isPreparingSessions, setIsPreparingSessions] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [exportMessage, setExportMessage] = useState<ExportMessage | null>(null);
  const [stagingStatus, setStagingStatus] = useState<ReplayStagingStatus | null>(null);
  const [stageRequest, setStageRequest] = useState<{
    ids: string[];
    preview: ReplayStagingPreview;
    label: string;
  } | null>(null);
  const [restoreConfirmationOpen, setRestoreConfirmationOpen] = useState(false);
  const [stagingBusy, setStagingBusy] = useState(false);
  const [selectedMatchupGameIds, setSelectedMatchupGameIds] = useState<string[] | null>(null);
  const [recordings, setRecordings] = useState<RecordedVideo[]>([]);
  const [portraits, setPortraits] = useState<Record<string, PortraitUrls>>({});
  useEffect(() => {
    if (!active || !window.electronAPI?.replays) return;
    let cancelled = false;
    void window.electronAPI.replays.stagingStatus().then(
      (status) => {
        if (!cancelled) setStagingStatus(status);
      },
      (error) => {
        if (!cancelled) {
          setStagingStatus({
            active: false,
            gameFolder: null,
            selectedCount: 0,
            newReplayCount: 0,
            issue: `Could not read replay staging status: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, replayFolder, rowData]);
  const portraitPairs = useMemo(() => {
    const pairs = new Map<string, CharacterSupportPair>();
    const characters = new Set<string>(OPPONENT_CHARACTER_ROSTER);
    for (const game of rowData) {
      for (const pair of [
        { character: game.player1Character, support: game.player1Support },
        { character: game.player2Character, support: game.player2Support },
      ]) {
        pairs.set(portraitPairKey(pair), pair);
        characters.add(pair.character);
      }
    }
    for (const character of characters) {
      for (const slot of [1, 2, 3]) {
        const pair = { character, support: `Support #${slot}` };
        pairs.set(portraitPairKey(pair), pair);
      }
    }
    return [...pairs.values()];
  }, [rowData]);
  useEffect(() => {
    const resolvePortraits = window.electronAPI?.replays?.resolvePortraits;
    if (!active || !resolvePortraits) return;
    let cancelled = false;
    const batches: CharacterSupportPair[][] = [];
    for (let index = 0; index < portraitPairs.length; index += 512) {
      batches.push(portraitPairs.slice(index, index + 512));
    }
    void Promise.all(batches.map((pairs) => resolvePortraits({ pairs }))).then(
      (results) => {
        if (cancelled) return;
        const next: Record<string, PortraitUrls> = {};
        for (const [index, batch] of batches.entries()) {
          for (const [pairIndex, pair] of batch.entries()) {
            next[portraitPairKey(pair)] = results[index][pairIndex];
          }
        }
        setPortraits(next);
      },
      () => {
        if (!cancelled) setPortraits({});
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, portraitPairs, recordingsRefreshToken]);
  useEffect(() => {
    if (!active || !replayFolder || !window.electronAPI?.recordings) return;
    let cancelled = false;
    void window.electronAPI.recordings
      .list()
      .then(({ recordings: nextRecordings }) => {
        if (!cancelled) setRecordings(nextRecordings);
      })
      .catch(() => {
        if (!cancelled) setRecordings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active, replayFolder, recordingsRefreshToken]);
  const recordingReplayIndex = useMemo(() => buildRecordingReplayIndex(recordings), [recordings]);
  const replayHashesById = useMemo(
    () =>
      new Map(
        rowData.filter((game) => game.contentHash).map((game) => [game.id, game.contentHash!]),
      ),
    [rowData],
  );
  const openRecording = (recordingId: string) => {
    localStorage.setItem(techSelectedRecordingStorageKey, recordingId);
    window.dispatchEvent(new CustomEvent(techSelectRecordingEvent, { detail: recordingId }));
  };
  useEffect(() => {
    if (!active) {
      setSessionRows([]);
      setIsPreparingSessions(false);
      return;
    }
    let running = true;
    setIsPreparingSessions(true);
    setSessionProgress({ completed: 0, total: rowData.length });
    void makeSessionsAsync(
      rowData,
      playerOfInterest,
      (completed, total) => {
        if (running) setSessionProgress({ completed, total });
      },
      () => !running,
    ).then((nextSessions) => {
      if (!running) return;
      setSessionRows(nextSessions);
      setIsPreparingSessions(false);
    });
    return () => {
      running = false;
    };
  }, [active, rowData, playerOfInterest]);
  useEffect(() => {
    setSelectedMatchupGameIds(null);
  }, [playerOfInterest]);
  const matchesOtherFilters = (session: SessionRow, ignored: keyof typeof filters) =>
    ignored === "opponent" ||
    filters.opponent.length === 0 ||
    filters.opponent.includes(session.opponent);
  const filterValues = useMemo(() => {
    const valuesFor = (
      ignored: keyof typeof filters,
      getValues: (session: SessionRow) => string[],
    ) =>
      [
        ...new Set(
          sessionRows.filter((session) => matchesOtherFilters(session, ignored)).flatMap(getValues),
        ),
      ].sort();
    return {
      opponent: valuesFor("opponent", (session) => [session.opponent]),
    };
  }, [sessionRows, filters]);
  const filteredSessions = useMemo(
    () =>
      sessionRows.filter(
        (session) => filters.opponent.length === 0 || filters.opponent.includes(session.opponent),
      ),
    [sessionRows, filters],
  );
  const tableSessions = useMemo(() => {
    if (invalidDateRange) return [];
    const selectedIds = selectedMatchupGameIds === null ? null : new Set(selectedMatchupGameIds);
    return filteredSessions.flatMap((session) => {
      const matchingGames = session.games.filter(
        (game) =>
          isInDateRange(game, dateFrom, dateTo) &&
          (selectedIds === null || selectedIds.has(game.id)),
      );
      if (matchingGames.length === 0) return [];
      return [
        matchingGames.length === session.games.length
          ? session
          : projectSession(session, matchingGames, playerOfInterest),
      ];
    });
  }, [
    dateFrom,
    dateTo,
    filteredSessions,
    invalidDateRange,
    playerOfInterest,
    selectedMatchupGameIds,
  ]);
  const pageCount = Math.max(1, Math.ceil(tableSessions.length / SETS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pagedSessions = useMemo(
    () => tableSessions.slice((currentPage - 1) * SETS_PER_PAGE, currentPage * SETS_PER_PAGE),
    [currentPage, tableSessions],
  );
  const displayRows = useMemo<DisplayRow[]>(
    () =>
      pagedSessions.flatMap((session) => [
        { ...session, kind: "session" as const },
        ...(expandedSessions.has(session.id)
          ? session.games.map((game) => ({ ...game, kind: "game" as const, sessionId: session.id }))
          : []),
      ]),
    [expandedSessions, pagedSessions],
  );
  const filteredGames = useMemo(
    () => filteredSessions.flatMap((session) => session.games),
    [filteredSessions],
  );
  const exportContextRow = async () => {
    if (!contextMenu || !window.electronAPI) return;
    const { data } = contextMenu;
    const ids = data.kind === "session" ? data.games.map((game) => game.id) : [data.id];
    const suggestedName =
      data.kind === "session"
        ? `Labatar set - ${data.started} vs ${data.opponent}`
        : `Labatar replay - ${data.timestamp ?? data.id}`;
    setContextMenu(null);
    try {
      const result = await window.electronAPI.replays.zip({ ids, suggestedName });
      if (result) {
        setExportMessage({
          severity: "success",
          text: `Created ZIP with ${result.fileCount} replay${result.fileCount === 1 ? "" : "s"}: ${result.path}`,
        });
      }
    } catch (error) {
      setExportMessage({
        severity: "error",
        text: `Could not create ZIP: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };
  const showContextInExplorer = async () => {
    if (!contextMenu || !window.electronAPI) return;
    const { data } = contextMenu;
    const ids = data.kind === "session" ? data.games.map((game) => game.id) : [data.id];
    setContextMenu(null);
    try {
      await window.electronAPI.replays.showInFolder({ ids });
    } catch (error) {
      setExportMessage({
        severity: "error",
        text: `Could not open File Explorer: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };
  const prepareContextReplays = async () => {
    if (!contextMenu || !window.electronAPI?.replays) return;
    const { data } = contextMenu;
    setContextMenu(null);
    const originalSet =
      data.kind === "session" ? sessionRows.find((session) => session.id === data.id) : null;
    if (data.kind === "session" && !originalSet) {
      setExportMessage({
        severity: "error",
        text: "That set is no longer available. Refresh match history.",
      });
      return;
    }
    const ids = data.kind === "session" ? originalSet!.games.map((game) => game.id) : [data.id];
    try {
      const preview = await window.electronAPI.replays.stagingPreview({ ids });
      setStageRequest({ ids, preview, label: data.kind === "session" ? "set" : "game" });
    } catch (error) {
      setExportMessage({
        severity: "error",
        text: `Could not prepare in-game replays: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };
  const confirmStageReplays = async () => {
    if (!stageRequest || !window.electronAPI?.replays) return;
    setStagingBusy(true);
    try {
      const result = await window.electronAPI.replays.stage({ ids: stageRequest.ids });
      setStagingStatus(result);
      setStageRequest(null);
      onReplaysChanged();
      setExportMessage({
        severity: "success",
        text: `Prepared ${result.selectedCount} replay${result.selectedCount === 1 ? "" : "s"} for in-game playback.`,
      });
    } catch (error) {
      setExportMessage({
        severity: "error",
        text: `Could not stage replays: ${error instanceof Error ? error.message : String(error)}`,
      });
      const status = await window.electronAPI.replays.stagingStatus().catch(() => null);
      if (status) setStagingStatus(status);
    } finally {
      setStagingBusy(false);
    }
  };
  const confirmRestoreReplays = async () => {
    if (!window.electronAPI?.replays) return;
    setStagingBusy(true);
    try {
      const result = await window.electronAPI.replays.restoreStaged();
      setStagingStatus(result);
      setRestoreConfirmationOpen(false);
      onReplaysChanged();
      setExportMessage({
        severity: "success",
        text: `Restored the original replay folder. Preserved ${result.newReplayCount} new replay${result.newReplayCount === 1 ? "" : "s"}${result.recoveredCount ? `; ${result.recoveredCount} filename conflict${result.recoveredCount === 1 ? " was" : "s were"} kept in “Recovered while staged”` : ""}.`,
      });
    } catch (error) {
      setExportMessage({
        severity: "error",
        text: `Could not restore replays: ${error instanceof Error ? error.message : String(error)}`,
      });
      const status = await window.electronAPI.replays.stagingStatus().catch(() => null);
      if (status) setStagingStatus(status);
    } finally {
      setStagingBusy(false);
    }
  };
  const columnDefs = useMemo<ColDef<DisplayRow>[]>(
    () => [
      {
        colId: "actions",
        headerName: "Player",
        width: 360,
        minWidth: 340,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<DisplayRow>) => {
          const data = params.data;
          if (!data) return null;
          const isSession = data.kind === "session";
          const recordingId = isSession
            ? recordingIdForSet(
                data.games.map((game) => game.id),
                replayFolder,
                recordingReplayIndex,
                replayHashesById,
              )
            : null;
          const { mmr, change } = getPlayerMmrParts(data, playerOfInterest);
          return (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                width: "100%",
                height: "100%",
                minWidth: 0,
              }}
            >
              <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, alignItems: "center" }}>
                {isSession ? (
                  <button
                    type="button"
                    style={{ width: 72 }}
                    onClick={() =>
                      setExpandedSessions((current) => {
                        const next = new Set(current);
                        if (next.has(data.id)) next.delete(data.id);
                        else next.add(data.id);
                        return next;
                      })
                    }
                  >
                    {expandedSessions.has(data.id) ? "- Hide" : "+ Show"}
                  </button>
                ) : (
                  <Box component="span" aria-hidden="true" sx={{ width: 72, flexShrink: 0 }} />
                )}
                <Box sx={{ width: 88, flexShrink: 0 }}>
                  {recordingId ? (
                    <button
                      type="button"
                      style={{ width: "100%" }}
                      aria-label={
                        isSession
                          ? `Open recording for set against ${data.opponent}`
                          : "Open set recording"
                      }
                      title="Open set recording"
                      onClick={() => openRecording(recordingId)}
                    >
                      Recording
                    </button>
                  ) : (
                    <Box
                      component="span"
                      aria-hidden="true"
                      sx={{ display: "block", width: "100%", height: 24 }}
                    />
                  )}
                </Box>
              </Stack>
              {mmr && (
                <Box component="span" sx={{ color: "common.white", whiteSpace: "nowrap" }}>
                  {mmr}
                </Box>
              )}
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 0.25, ml: "auto", minWidth: 0 }}
              >
                {change && (
                  <Box
                    component="span"
                    sx={{ whiteSpace: "nowrap", ...getMmrChangeCellStyle(change) }}
                  >
                    {mmr ? `(${change})` : change}
                  </Box>
                )}
                <Box
                  sx={{
                    width: "max-content",
                    maxWidth: 170,
                    minWidth: 0,
                    flexShrink: 1,
                    overflow: "hidden",
                  }}
                >
                  <CharacterSupportCell
                    pairs={characterSupportPairsForRow(data, playerOfInterest, "player")}
                    portraits={portraits}
                    rightAligned
                  />
                </Box>
              </Box>
            </Box>
          );
        },
      },
      {
        colId: "time",
        headerName: "Time",
        valueGetter: ({ data }) =>
          data?.kind === "session"
            ? formatReplayTimestamp(data.started)
            : formatReplayTimestamp(data?.timestamp ?? null),
        minWidth: 125,
        maxWidth: 190,
      },
      {
        colId: "result",
        headerName: "Record",
        valueGetter: ({ data }) =>
          data?.kind === "session"
            ? data.record
            : data?.kind === "game"
              ? getGameResult(data, playerOfInterest)
              : "",
        cellRenderer: ({ data }: ICellRendererParams<DisplayRow>) => {
          if (!data) return null;
          if (data.kind === "session") {
            const wins = data.games.filter(
              (game) => getGameResult(game, playerOfInterest) === "W",
            ).length;
            const losses = data.games.filter(
              (game) => getGameResult(game, playerOfInterest) === "L",
            ).length;
            const decidedGames = wins + losses;
            const color = decidedGames
              ? `hsl(${Math.round((wins / decidedGames) * 120)} 70% 55%)`
              : "text.secondary";
            return (
              <Box component="span" sx={{ color, fontWeight: 600 }}>
                {data.record}
              </Box>
            );
          }
          const result = getGameResult(data, playerOfInterest);
          return result ? (
            <Box
              component="span"
              aria-label={result === "W" ? "Win" : "Loss"}
              title={result === "W" ? "Win" : "Loss"}
              sx={{ color: result === "W" ? "success.main" : "error.main", fontWeight: 700 }}
            >
              {result}
            </Box>
          ) : null;
        },
        minWidth: 100,
        maxWidth: 150,
      },
      {
        colId: "opponent",
        headerName: "Opponent",
        valueGetter: ({ data }: ValueGetterParams<DisplayRow>) => {
          if (!data) return "";
          const name = getOpponentForRow(data, playerOfInterest);
          const mmr = getOpponentMmrForRow(data, playerOfInterest);
          const portraits = characterSupportPairsForRow(data, playerOfInterest, "opponent")
            .map(({ character, support }) => `${character}/${support}`)
            .join(", ");
          return [name, mmr ? `(${mmr})` : "", portraits].filter(Boolean).join(" ");
        },
        cellRenderer: ({ data }: ICellRendererParams<DisplayRow>) => {
          if (!data) return null;
          const name = getOpponentForRow(data, playerOfInterest);
          const mmr = getOpponentMmrForRow(data, playerOfInterest);
          return (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                width: "100%",
                height: "100%",
                minWidth: 0,
              }}
            >
              <Typography
                variant="body2"
                noWrap
                title={name}
                sx={{ flex: "1 1 auto", minWidth: 0, textAlign: "left" }}
              >
                {name}
              </Typography>
              {mmr && (
                <Box
                  component="span"
                  sx={{ color: "common.white", whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  ({mmr})
                </Box>
              )}
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "flex-end",
                  flex: "0 1 auto",
                  minWidth: 80,
                  maxWidth: "55%",
                  overflow: "hidden",
                }}
              >
                <CharacterSupportCell
                  pairs={characterSupportPairsForRow(data, playerOfInterest, "opponent")}
                  portraits={portraits}
                />
              </Box>
            </Box>
          );
        },
        minWidth: 300,
        maxWidth: 480,
      },
    ],
    [
      expandedSessions,
      playerOfInterest,
      portraits,
      recordingReplayIndex,
      replayFolder,
      replayHashesById,
    ],
  );
  useEffect(() => {
    if (!active) return;
    let frame: number | null = null;
    const scheduleAutoSize = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        const api = gridRef.current?.api;
        if (api && !api.isDestroyed()) api.autoSizeAllColumns();
      });
    };
    scheduleAutoSize();
    const hot = import.meta.hot;
    hot?.on("vite:afterUpdate", scheduleAutoSize);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      hot?.off("vite:afterUpdate", scheduleAutoSize);
    };
  }, [active, columnDefs, displayRows]);
  return (
    <Box
      sx={{
        flex: "1 1 auto",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {isPreparingSessions && (
        <Stack spacing={0.5} sx={{ mb: 1, textAlign: "left" }}>
          <LinearProgress
            variant={sessionProgress.total > 0 ? "determinate" : "indeterminate"}
            value={
              sessionProgress.total > 0
                ? (sessionProgress.completed / sessionProgress.total) * 100
                : undefined
            }
          />
          <Typography variant="caption" color="text.secondary">
            Preparing replay sessions
            {sessionProgress.total > 0
              ? ` (${sessionProgress.completed} of ${sessionProgress.total})`
              : "…"}
            …
          </Typography>
        </Stack>
      )}
      {stagingStatus && (stagingStatus.active || stagingStatus.issue) && (
        <Alert
          severity={stagingStatus.issue ? "warning" : "info"}
          sx={{ mb: 1, textAlign: "left" }}
          action={
            stagingStatus.active ? (
              <Button
                color="inherit"
                size="small"
                disabled={stagingBusy}
                onClick={() => setRestoreConfirmationOpen(true)}
              >
                Restore original replays
              </Button>
            ) : undefined
          }
        >
          {stagingStatus.issue ||
            `${stagingStatus.selectedCount} replay${stagingStatus.selectedCount === 1 ? "" : "s"} prepared for in-game playback.${stagingStatus.newReplayCount ? ` ${stagingStatus.newReplayCount} new replay${stagingStatus.newReplayCount === 1 ? "" : "s"} saved while staged will be preserved.` : ""}`}
          {stagingStatus.gameFolder && stagingStatus.gameFolder !== replayFolder
            ? ` Game folder: ${stagingStatus.gameFolder}`
            : ""}
        </Alert>
      )}
      <AnalyticsSection
        fillHeight
        tableContent={
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              minHeight: 0,
            }}
          >
            <div
              className="ag-theme-quartz-dark"
              style={{ flex: "1 1 auto", minHeight: 0, width: "100%" }}
            >
              <AgGridReact<DisplayRow>
                ref={gridRef}
                theme="legacy"
                columnDefs={columnDefs}
                rowData={displayRows}
                defaultColDef={{ sortable: true, filter: true, resizable: true }}
                autoSizeStrategy={{ type: "fitCellContents" }}
                getRowId={({ data }) => data.id}
                onCellContextMenu={(params) => {
                  const event = params.event;
                  if (!params.data || !(event instanceof MouseEvent)) return;
                  event.preventDefault();
                  setContextMenu({
                    data: params.data,
                    mouseX: event.clientX,
                    mouseY: event.clientY,
                  });
                }}
              />
            </div>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              sx={{ mt: 1, alignItems: { sm: "center" }, justifyContent: "space-between" }}
            >
              <Typography variant="caption" color="text.secondary">
                {tableSessions.length === 0
                  ? "No sets"
                  : `Showing ${(currentPage - 1) * SETS_PER_PAGE + 1}-${Math.min(
                      currentPage * SETS_PER_PAGE,
                      tableSessions.length,
                    )} of ${tableSessions.length} sets`}
              </Typography>
              <Pagination
                count={pageCount}
                page={currentPage}
                onChange={(_, nextPage) => setPage(nextPage)}
                size="small"
                color="primary"
                showFirstButton
                showLastButton
                disabled={pageCount <= 1}
              />
            </Stack>
          </Box>
        }
        games={filteredGames}
        sessions={filteredSessions}
        getPortrait={(character, support) => portraits[portraitPairKey({ character, support })]}
        playerOfInterest={playerOfInterest}
        playerCounts={playerCounts}
        playerOverride={playerOverride}
        onPlayerOverrideChange={onPlayerOverrideChange}
        dateFrom={dateFrom}
        dateTo={dateTo}
        invalidDateRange={invalidDateRange}
        onSummaryChange={onSummaryChange}
        opponentFilterValues={{
          players: filterValues.opponent,
        }}
        selectedOpponentPlayers={filters.opponent}
        onOpponentPlayersChange={(value) =>
          setFilters((current) => ({ ...current, opponent: value }))
        }
        onMatchupGameIdsChange={(ids) =>
          setSelectedMatchupGameIds((current) => {
            if (ids === null) return current === null ? current : null;
            if (
              current &&
              current.length === ids.length &&
              current.every((id, index) => id === ids[index])
            ) {
              return current;
            }
            return ids;
          })
        }
      />
      <Menu
        open={contextMenu !== null}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined
        }
      >
        <MenuItem onClick={() => void showContextInExplorer()}>
          {contextMenu?.data.kind === "session"
            ? "Show set folder in File Explorer"
            : "Show game in File Explorer"}
        </MenuItem>
        <MenuItem onClick={() => void exportContextRow()}>
          {contextMenu?.data.kind === "session"
            ? `Export set as ZIP (${contextMenu.data.games.length} replays)`
            : "Export replay as ZIP"}
        </MenuItem>
        <MenuItem onClick={() => void prepareContextReplays()} disabled={stagingBusy}>
          Prepare {contextMenu?.data.kind === "session" ? "set" : "game"} for in-game playback
        </MenuItem>
      </Menu>
      <Dialog open={stageRequest !== null} onClose={() => !stagingBusy && setStageRequest(null)}>
        <DialogTitle>Prepare replays for in-game playback</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Close the game first. Labatar will preserve the existing replay folder and place only
            the {stageRequest?.preview.selectedCount} replay
            {stageRequest?.preview.selectedCount === 1 ? "" : "s"} from this {stageRequest?.label}
            in the game’s replay folder.
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {stageRequest?.preview.switching
              ? "The original replay tree remains preserved."
              : `${stageRequest?.preview.archivedCount} existing replays will remain available in Labatar.`}{" "}
            Any new replays saved afterward will be kept when you switch or restore.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={stagingBusy} onClick={() => setStageRequest(null)}>
            Cancel
          </Button>
          <Button disabled={stagingBusy} onClick={() => void confirmStageReplays()}>
            Prepare replays
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={restoreConfirmationOpen}
        onClose={() => !stagingBusy && setRestoreConfirmationOpen(false)}
      >
        <DialogTitle>Restore original replay folder?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Close the game first. Labatar will restore the original folder structure and preserve
            any new replays saved while this selection was prepared.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={stagingBusy} onClick={() => setRestoreConfirmationOpen(false)}>
            Cancel
          </Button>
          <Button disabled={stagingBusy} onClick={() => void confirmRestoreReplays()}>
            Restore replays
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={exportMessage !== null}
        autoHideDuration={7000}
        onClose={() => setExportMessage(null)}
      >
        {exportMessage ? (
          <Alert onClose={() => setExportMessage(null)} severity={exportMessage.severity}>
            {exportMessage.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
