import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReplayRow } from "./AvatarGrid";

type AnalyticsSectionProps = {
  games: ReplayRow[];
  sessions: Array<{ games: ReplayRow[] }>;
  playerOfInterest: string | null;
  dateFrom: string;
  dateTo: string;
  invalidDateRange: boolean;
  opponentFilterValues: { players: string[] };
  selectedOpponentPlayers: string[];
  onOpponentPlayersChange: (value: string[]) => void;
  onMatchupGameIdsChange: (ids: string[] | null) => void;
  onSummaryChange: (summary: AnalysisSummary) => void;
};

export type AnalysisSummary = {
  games: number;
  sessions: number;
  wins: number;
  losses: number;
  opponents: number;
  winRate: number;
};

type PerformanceRow = {
  name: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
};

type TimelineRow = {
  period: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  mmr: number | null;
};

type MatchupStats = { games: number; wins: number; losses: number };
type SupportStats = { name: string; games: number };

type MatchupData = {
  rows: string[];
  columns: string[];
  supportsByCharacter: Map<string, SupportStats[]>;
  supportsByOpponentCharacter: Map<string, SupportStats[]>;
  cells: Map<string, MatchupStats>;
};

function parseTimestamp(timestamp: string | null) {
  if (!timestamp) return null;
  const date = new Date(timestamp.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getPoiCharacter(game: ReplayRow, poi: string) {
  return poi === game.player1 ? game.player1Character : game.player2Character;
}

function getPoiSupport(game: ReplayRow, poi: string) {
  return poi === game.player1 ? game.player1Support : game.player2Support;
}

function getOpponentSupport(game: ReplayRow, poi: string) {
  return poi === game.player1 ? game.player2Support : game.player1Support;
}

function getOpponent(game: ReplayRow, poi: string) {
  return poi === game.player1 ? game.player2 : game.player1;
}

function getOpponentCharacter(game: ReplayRow, poi: string) {
  return poi === game.player1 ? game.player2Character : game.player1Character;
}

function getPoiMmr(game: ReplayRow, poi: string) {
  if (game.ratings?.mode.trim().toLowerCase() !== "ranked") return null;
  const rating = poi === game.player1 ? game.ratings.player1 : game.ratings.player2;
  if (rating.characterMmr !== null && rating.characterMmr >= 0) return rating.characterMmr;
  return rating.rating;
}

function getMatchupKey(game: ReplayRow, poi: string) {
  return `${getPoiCharacter(game, poi) || "Unknown"}\u0000${getOpponentCharacter(game, poi) || "Unknown"}`;
}

function getPoiSupportKey(character: string, support: string) {
  return `${character}\u0000${support}`;
}

function isWin(game: ReplayRow, poi: string) {
  return game.winner === poi;
}

function isLoss(game: ReplayRow, poi: string) {
  return game.winner !== "Unknown" && game.winner !== poi;
}

function getWinRate(wins: number, losses: number) {
  const knownGames = wins + losses;
  return knownGames === 0 ? 0 : Math.round((wins / knownGames) * 100);
}

function getNormalizedDomain(
  [dataMin, dataMax]: readonly [number, number],
  minimumPadding: number,
  lowerBound?: number,
) {
  const range = dataMax - dataMin;
  const padding = range === 0 ? minimumPadding : Math.max(range * 0.1, minimumPadding);
  return [
    lowerBound === undefined ? dataMin - padding : Math.max(lowerBound, dataMin - padding),
    dataMax + padding,
  ] as [number, number];
}

function localDateKey(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, "0")))
    .join("-");
}

function isInDateRange(game: ReplayRow, dateFrom: string, dateTo: string) {
  if (!dateFrom && !dateTo) return true;
  const date = parseTimestamp(game.timestamp);
  if (!date) return false;
  const day = localDateKey(date);
  return (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
}

function buildPerformance(
  games: ReplayRow[],
  poi: string,
  getName: (game: ReplayRow) => string,
): PerformanceRow[] {
  const stats = new Map<string, Omit<PerformanceRow, "name" | "winRate">>();
  for (const game of games) {
    const name = getName(game) || "Unknown";
    const current = stats.get(name) ?? { games: 0, wins: 0, losses: 0 };
    current.games += 1;
    if (isWin(game, poi)) current.wins += 1;
    else if (isLoss(game, poi)) current.losses += 1;
    stats.set(name, current);
  }
  return [...stats.entries()]
    .map(([name, current]) => ({
      name,
      ...current,
      winRate: getWinRate(current.wins, current.losses),
    }))
    .sort((left, right) => right.games - left.games || right.winRate - left.winRate);
}

function buildTimeline(games: ReplayRow[], poi: string): TimelineRow[] {
  const stats = new Map<
    string,
    {
      games: number;
      wins: number;
      losses: number;
      mmr: number | null;
      latestMmrTimestamp: number;
    }
  >();
  for (const game of games) {
    const date = parseTimestamp(game.timestamp);
    if (!date) continue;
    const timestamp = date.getTime();
    date.setDate(date.getDate() - date.getDay());
    const period = localDateKey(date);
    const current = stats.get(period) ?? {
      games: 0,
      wins: 0,
      losses: 0,
      mmr: null,
      latestMmrTimestamp: Number.NEGATIVE_INFINITY,
    };
    current.games += 1;
    if (isWin(game, poi)) current.wins += 1;
    else if (isLoss(game, poi)) current.losses += 1;
    const mmr = getPoiMmr(game, poi);
    if (mmr !== null && timestamp >= current.latestMmrTimestamp) {
      current.mmr = mmr;
      current.latestMmrTimestamp = timestamp;
    }
    stats.set(period, current);
  }
  return [...stats.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, { games, wins, losses, mmr }]) => ({
      period: new Date(`${period}T00:00:00`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      games,
      wins,
      losses,
      winRate: getWinRate(wins, losses),
      mmr,
    }));
}

function buildMatchupData(games: ReplayRow[], poi: string): MatchupData {
  const pairStats = new Map<string, MatchupStats>();
  const rowCounts = new Map<string, number>();
  const columnCounts = new Map<string, number>();
  const supportCounts = new Map<string, Map<string, number>>();
  const opponentSupportCounts = new Map<string, Map<string, number>>();
  for (const game of games) {
    const row = getPoiCharacter(game, poi) || "Unknown";
    const column = getOpponentCharacter(game, poi) || "Unknown";
    const support = getPoiSupport(game, poi) || "Unknown";
    const opponentSupport = getOpponentSupport(game, poi) || "Unknown";
    rowCounts.set(row, (rowCounts.get(row) ?? 0) + 1);
    columnCounts.set(column, (columnCounts.get(column) ?? 0) + 1);
    const characterSupports = supportCounts.get(row) ?? new Map<string, number>();
    characterSupports.set(support, (characterSupports.get(support) ?? 0) + 1);
    supportCounts.set(row, characterSupports);
    const opponentCharacterSupports =
      opponentSupportCounts.get(column) ?? new Map<string, number>();
    opponentCharacterSupports.set(
      opponentSupport,
      (opponentCharacterSupports.get(opponentSupport) ?? 0) + 1,
    );
    opponentSupportCounts.set(column, opponentCharacterSupports);
    const key = getMatchupKey(game, poi);
    const current = pairStats.get(key) ?? { games: 0, wins: 0, losses: 0 };
    current.games += 1;
    if (isWin(game, poi)) current.wins += 1;
    else if (isLoss(game, poi)) current.losses += 1;
    pairStats.set(key, current);
  }
  return {
    rows: [...rowCounts.entries()].sort((left, right) => right[1] - left[1]).map(([name]) => name),
    columns: [...columnCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([name]) => name),
    supportsByCharacter: new Map(
      [...supportCounts.entries()].map(([character, supports]) => [
        character,
        [...supports.entries()]
          .sort((left, right) => right[1] - left[1])
          .map(([name, games]) => ({ name, games })),
      ]),
    ),
    supportsByOpponentCharacter: new Map(
      [...opponentSupportCounts.entries()].map(([character, supports]) => [
        character,
        [...supports.entries()]
          .sort((left, right) => right[1] - left[1])
          .map(([name, games]) => ({ name, games })),
      ]),
    ),
    cells: pairStats,
  };
}

function ChartPanel({
  title,
  subtitle,
  headerAction,
  children,
  height = 270,
}: {
  title: string;
  subtitle?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  height?: number | string;
}) {
  return (
    <Card variant="outlined" sx={{ minWidth: 0 }}>
      <CardContent>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { sm: "flex-start" }, justifyContent: "flex-start" }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          {headerAction}
        </Stack>
        <Box sx={{ width: "100%", height, mt: 1 }}>{children}</Box>
      </CardContent>
    </Card>
  );
}

function EmptyChart() {
  return (
    <Stack sx={{ height: "100%", alignItems: "center", justifyContent: "center" }}>
      <Typography variant="body2" color="text.secondary">
        No data for the current filters
      </Typography>
    </Stack>
  );
}

function MultiSelectFilter({
  label,
  values,
  selected,
  onChange,
}: {
  label: string;
  values: string[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <FormControl size="small" sx={{ minWidth: 190 }}>
      <InputLabel>{label}</InputLabel>
      <Select
        multiple
        value={selected}
        label={label}
        renderValue={(items) => items.join(", ")}
        onChange={(event) => onChange(event.target.value as string[])}
      >
        {values.map((value) => (
          <MenuItem key={value} value={value}>
            <Checkbox checked={selected.includes(value)} />
            <ListItemText primary={value} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function MatchupHeatmap({
  data,
  disabledMatchups,
  disabledOpponentCharacters,
  disabledOpponentSupports,
  disabledPoiSupports,
  onToggle,
  onToggleOpponentCharacter,
  onToggleOpponentSupport,
  onToggleRow,
  onTogglePoiSupport,
}: {
  data: MatchupData;
  disabledMatchups: Set<string>;
  disabledOpponentCharacters: Set<string>;
  disabledOpponentSupports: Set<string>;
  disabledPoiSupports: Set<string>;
  onToggle: (key: string) => void;
  onToggleOpponentCharacter: (value: string) => void;
  onToggleOpponentSupport: (value: string) => void;
  onToggleRow: (row: string, selectAll: boolean) => void;
  onTogglePoiSupport: (value: string) => void;
}) {
  const { rows, columns, supportsByCharacter, supportsByOpponentCharacter, cells } = data;
  if (rows.length === 0 || columns.length === 0) return <EmptyChart />;
  return (
    <Box sx={{ overflowX: "auto", overflowY: rows.length > 1 ? "auto" : "hidden", height: "100%" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `max-content repeat(${columns.length}, minmax(110px, 1fr))`,
          minWidth: 620,
          gap: 0.5,
        }}
      >
        <Box
          sx={{
            minWidth: 190,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-end",
            pb: 0.5,
            pr: 0.5,
            textAlign: "right",
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Player character
          </Typography>
        </Box>
        {columns.map((column) => {
          const supports = supportsByOpponentCharacter.get(column) ?? [];
          const columnDisabled = disabledOpponentCharacters.has(column);
          return (
            <Card
              key={column}
              variant="outlined"
              aria-pressed={!columnDisabled}
              onClick={() => onToggleOpponentCharacter(column)}
              sx={{
                minWidth: 110,
                cursor: "pointer",
                backgroundColor: columnDisabled ? "#424242" : "background.paper",
                "&:hover": { filter: "brightness(1.15)" },
              }}
            >
              <CardContent sx={{ py: 0.5, "&:last-child": { pb: 0.5 } }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={column}>
                  {column}
                </Typography>
                <Stack sx={{ ml: 1 }}>
                  {supports.map((support) => {
                    const supportKey = getPoiSupportKey(column, support.name);
                    return (
                      <FormControlLabel
                        key={supportKey}
                        label={support.name}
                        disabled={columnDisabled}
                        sx={{
                          m: 0,
                          justifyContent: "flex-start",
                          width: "100%",
                          "& .MuiCheckbox-root": { p: 0.25 },
                          "& .MuiFormControlLabel-label": {
                            fontSize: "0.67rem",
                            lineHeight: 1.15,
                          },
                        }}
                        onClick={(event) => event.stopPropagation()}
                        control={
                          <Checkbox
                            size="small"
                            checked={!disabledOpponentSupports.has(supportKey)}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => onToggleOpponentSupport(supportKey)}
                          />
                        }
                      />
                    );
                  })}
                </Stack>
              </CardContent>
            </Card>
          );
        })}
        {rows.map((row) => {
          const supports = supportsByCharacter.get(row) ?? [];
          const rowCells = columns
            .map((column) => {
              const key = `${row}\u0000${column}`;
              return { key, cell: cells.get(key) };
            })
            .filter((entry): entry is { key: string; cell: MatchupStats } => Boolean(entry.cell));
          const rowKeys = rowCells.map(({ key }) => key);
          const rowSelected = rowKeys.every((key) => !disabledMatchups.has(key));
          return (
            <Fragment key={row}>
              <Card
                variant="outlined"
                aria-pressed={rowSelected}
                onClick={() => onToggleRow(row, !rowSelected)}
                sx={{
                  minWidth: 190,
                  cursor: "pointer",
                  backgroundColor: rowSelected ? "background.paper" : "#424242",
                  "&:hover": { filter: "brightness(1.15)" },
                }}
              >
                <CardContent sx={{ py: 0.5, "&:last-child": { pb: 0.5 } }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {row}
                  </Typography>
                  <Stack sx={{ ml: 1 }}>
                    {supports.map((support) => {
                      const supportKey = getPoiSupportKey(row, support.name);
                      return (
                        <FormControlLabel
                          key={supportKey}
                          label={support.name}
                          sx={{
                            m: 0,
                            justifyContent: "flex-start",
                            width: "100%",
                            "& .MuiCheckbox-root": { p: 0.25 },
                            "& .MuiFormControlLabel-label": {
                              fontSize: "0.67rem",
                              lineHeight: 1.15,
                            },
                          }}
                          onClick={(event) => event.stopPropagation()}
                          control={
                            <Checkbox
                              size="small"
                              sx={{ p: 0.25 }}
                              checked={!disabledPoiSupports.has(supportKey)}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => onTogglePoiSupport(supportKey)}
                            />
                          }
                        />
                      );
                    })}
                  </Stack>
                </CardContent>
              </Card>
              {columns.map((column) => {
                const key = `${row}\u0000${column}`;
                const cell = cells.get(key);
                const disabled =
                  cell && (disabledMatchups.has(key) || disabledOpponentCharacters.has(column));
                const rate = cell ? getWinRate(cell.wins, cell.losses) : null;
                const color =
                  rate === null
                    ? "rgba(255,255,255,0.04)"
                    : rate >= 50
                      ? "144,202,249"
                      : "239,154,154";
                const opacity = rate === null ? 1 : 0.2 + Math.abs(rate - 50) / 100;
                return (
                  <Box
                    key={`${row}-${column}`}
                    component="button"
                    type="button"
                    disabled={!cell}
                    aria-pressed={cell ? !disabled : undefined}
                    title={cell ? `${cell.games} games, ${rate}% win rate` : "No games"}
                    onClick={() => cell && onToggle(key)}
                    sx={{
                      minHeight: 42,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: 0,
                      borderRadius: 0.5,
                      color: "inherit",
                      font: "inherit",
                      p: 0,
                      backgroundColor: !cell
                        ? color
                        : disabled
                          ? "#424242"
                          : `rgba(${color}, ${opacity})`,
                      cursor: cell ? "pointer" : "default",
                      "&:hover": cell ? { filter: "brightness(1.15)" } : undefined,
                    }}
                  >
                    <Typography variant="caption">{rate === null ? "—" : `${rate}%`}</Typography>
                  </Box>
                );
              })}
            </Fragment>
          );
        })}
      </Box>
    </Box>
  );
}

export function AnalyticsSection({
  games,
  sessions,
  playerOfInterest,
  dateFrom,
  dateTo,
  invalidDateRange,
  opponentFilterValues,
  selectedOpponentPlayers,
  onOpponentPlayersChange,
  onMatchupGameIdsChange,
  onSummaryChange,
}: AnalyticsSectionProps) {
  const analysisGames = useMemo(
    () => (invalidDateRange ? [] : games.filter((game) => isInDateRange(game, dateFrom, dateTo))),
    [dateFrom, dateTo, games, invalidDateRange],
  );
  const analysisSessionCount = useMemo(() => {
    const gameIds = new Set(analysisGames.map((game) => game.id));
    return sessions.filter((session) => session.games.some((game) => gameIds.has(game.id))).length;
  }, [analysisGames, sessions]);
  const summary = useMemo(() => {
    const wins = playerOfInterest
      ? analysisGames.filter((game) => isWin(game, playerOfInterest)).length
      : 0;
    const losses = playerOfInterest
      ? analysisGames.filter((game) => isLoss(game, playerOfInterest)).length
      : 0;
    return {
      games: analysisGames.length,
      sessions: analysisSessionCount,
      wins,
      losses,
      unknown: analysisGames.length - wins - losses,
      opponents: playerOfInterest
        ? new Set(analysisGames.map((game) => getOpponent(game, playerOfInterest))).size
        : 0,
      winRate: getWinRate(wins, losses),
    };
  }, [analysisGames, analysisSessionCount, playerOfInterest]);
  useEffect(() => {
    onSummaryChange(summary);
  }, [onSummaryChange, summary]);
  const matchupData = useMemo(
    () =>
      playerOfInterest
        ? buildMatchupData(analysisGames, playerOfInterest)
        : {
            rows: [],
            columns: [],
            supportsByCharacter: new Map<string, SupportStats[]>(),
            supportsByOpponentCharacter: new Map<string, SupportStats[]>(),
            cells: new Map<string, MatchupStats>(),
          },
    [analysisGames, playerOfInterest],
  );
  const [disabledMatchups, setDisabledMatchups] = useState<Set<string>>(new Set());
  const [disabledOpponentCharacters, setDisabledOpponentCharacters] = useState<Set<string>>(
    new Set(),
  );
  const [disabledOpponentSupports, setDisabledOpponentSupports] = useState<Set<string>>(new Set());
  const [disabledPoiSupports, setDisabledPoiSupports] = useState<Set<string>>(new Set());
  useEffect(() => {
    setDisabledMatchups((current) => {
      const next = new Set([...current].filter((key) => matchupData.cells.has(key)));
      return next.size === current.size ? current : next;
    });
    setDisabledOpponentCharacters((current) => {
      const next = new Set([...current].filter((value) => matchupData.columns.includes(value)));
      return next.size === current.size ? current : next;
    });
    setDisabledOpponentSupports((current) => {
      const valid = new Set(
        [...matchupData.supportsByOpponentCharacter.entries()].flatMap(([character, supports]) =>
          supports.map((support) => getPoiSupportKey(character, support.name)),
        ),
      );
      const next = new Set([...current].filter((value) => valid.has(value)));
      return next.size === current.size ? current : next;
    });
    setDisabledPoiSupports((current) => {
      const valid = new Set(
        [...matchupData.supportsByCharacter.entries()].flatMap(([character, supports]) =>
          supports.map((support) => getPoiSupportKey(character, support.name)),
        ),
      );
      const next = new Set([...current].filter((value) => valid.has(value)));
      return next.size === current.size ? current : next;
    });
  }, [matchupData]);
  const toggleMatchup = (key: string) => {
    setDisabledMatchups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleOpponentCharacter = (value: string) => {
    setDisabledOpponentCharacters((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };
  const toggleOpponentSupport = (key: string) => {
    setDisabledOpponentSupports((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleMatchupRow = (row: string, selectAll: boolean) => {
    setDisabledMatchups((current) => {
      const next = new Set(current);
      for (const key of matchupData.cells.keys()) {
        if (!key.startsWith(`${row}\u0000`)) continue;
        if (selectAll) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  };
  const togglePoiSupport = (key: string) => {
    setDisabledPoiSupports((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const selectedMatchupGames = useMemo(
    () =>
      playerOfInterest
        ? analysisGames.filter((game) => {
            const character = getPoiCharacter(game, playerOfInterest) || "Unknown";
            const support = getPoiSupport(game, playerOfInterest) || "Unknown";
            const opponentCharacter = getOpponentCharacter(game, playerOfInterest) || "Unknown";
            const opponentSupport = getOpponentSupport(game, playerOfInterest) || "Unknown";
            return (
              !disabledMatchups.has(getMatchupKey(game, playerOfInterest)) &&
              !disabledOpponentCharacters.has(opponentCharacter) &&
              !disabledOpponentSupports.has(getPoiSupportKey(opponentCharacter, opponentSupport)) &&
              !disabledPoiSupports.has(getPoiSupportKey(character, support))
            );
          })
        : [],
    [
      analysisGames,
      disabledMatchups,
      disabledOpponentCharacters,
      disabledOpponentSupports,
      disabledPoiSupports,
      playerOfInterest,
    ],
  );
  const selectedMatchupGameIds = useMemo(() => {
    if (!playerOfInterest) return null;
    return games
      .filter((game) => {
        const character = getPoiCharacter(game, playerOfInterest) || "Unknown";
        const support = getPoiSupport(game, playerOfInterest) || "Unknown";
        const opponentCharacter = getOpponentCharacter(game, playerOfInterest) || "Unknown";
        const opponentSupport = getOpponentSupport(game, playerOfInterest) || "Unknown";
        return (
          !disabledMatchups.has(getMatchupKey(game, playerOfInterest)) &&
          !disabledOpponentCharacters.has(opponentCharacter) &&
          !disabledOpponentSupports.has(getPoiSupportKey(opponentCharacter, opponentSupport)) &&
          !disabledPoiSupports.has(getPoiSupportKey(character, support))
        );
      })
      .map((game) => game.id);
  }, [
    disabledMatchups,
    disabledOpponentCharacters,
    disabledOpponentSupports,
    disabledPoiSupports,
    games,
    playerOfInterest,
  ]);
  useEffect(() => {
    onMatchupGameIdsChange(selectedMatchupGameIds);
  }, [onMatchupGameIdsChange, selectedMatchupGameIds]);
  const chartGames = playerOfInterest ? selectedMatchupGames : analysisGames;
  const opponentData = useMemo(
    () =>
      playerOfInterest
        ? buildPerformance(chartGames, playerOfInterest, (game) =>
            getOpponent(game, playerOfInterest),
          )
        : [],
    [chartGames, playerOfInterest],
  ).slice(0, 8);
  const timelineData = useMemo(
    () => (playerOfInterest ? buildTimeline(chartGames, playerOfInterest) : []),
    [chartGames, playerOfInterest],
  );
  const maxSupportCount = Math.max(
    0,
    ...[...matchupData.supportsByCharacter.values()].map((supports) => supports.length),
    ...[...matchupData.supportsByOpponentCharacter.values()].map((supports) => supports.length),
  );
  const matchupPanelHeight = Math.min(300, Math.max(190, maxSupportCount * 28 + 145));

  return (
    <Stack spacing={2} sx={{ mb: 2, textAlign: "left" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
          gap: 2,
        }}
      >
        <Box sx={{ order: -1, gridColumn: "1 / -1" }}>
          <ChartPanel
            title="Character matchup"
            subtitle="Click character cards, supports, or matchup cells to filter the charts below"
            height={matchupPanelHeight}
            headerAction={
              <MultiSelectFilter
                label="Opponent"
                values={opponentFilterValues.players}
                selected={selectedOpponentPlayers}
                onChange={onOpponentPlayersChange}
              />
            }
          >
            {playerOfInterest ? (
              <MatchupHeatmap
                data={matchupData}
                disabledMatchups={disabledMatchups}
                disabledOpponentCharacters={disabledOpponentCharacters}
                disabledOpponentSupports={disabledOpponentSupports}
                disabledPoiSupports={disabledPoiSupports}
                onToggle={toggleMatchup}
                onToggleOpponentCharacter={toggleOpponentCharacter}
                onToggleOpponentSupport={toggleOpponentSupport}
                onToggleRow={toggleMatchupRow}
                onTogglePoiSupport={togglePoiSupport}
              />
            ) : (
              <EmptyChart />
            )}
          </ChartPanel>
        </Box>
        <ChartPanel
          title="Activity, win rate, and MMR"
          subtitle="Games, win rate, and ranked MMR grouped by week for selected matchups"
        >
          {timelineData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer>
              <LineChart data={timelineData} margin={{ left: 0, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" minTickGap={28} />
                <YAxis
                  yAxisId="games"
                  allowDecimals={false}
                  domain={(domain) => getNormalizedDomain(domain, 0.5, 0)}
                />
                <YAxis
                  yAxisId="mmr"
                  orientation="left"
                  allowDecimals={false}
                  domain={(domain) => getNormalizedDomain(domain, 25)}
                />
                <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} unit="%" />
                <Tooltip />
                <Legend />
                <ReferenceLine
                  yAxisId="rate"
                  y={50}
                  stroke="#b0bec5"
                  strokeDasharray="2 4"
                  label={{ value: "50%", fill: "#b0bec5", position: "insideTopRight" }}
                />
                <Line
                  yAxisId="games"
                  type="monotone"
                  dataKey="games"
                  stroke="#80cbc4"
                  name="Games"
                />
                <Line
                  yAxisId="rate"
                  type="monotone"
                  dataKey="winRate"
                  stroke="#ffcc80"
                  name="Win rate"
                />
                <Line
                  yAxisId="mmr"
                  type="monotone"
                  dataKey="mmr"
                  stroke="#90caf9"
                  name="Ranked MMR"
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>
        <ChartPanel title="Opponent win rate" subtitle="Top opponents by game count">
          {opponentData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer>
              <BarChart data={opponentData} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} unit="%" />
                <YAxis type="category" dataKey="name" width={120} interval={0} />
                <Tooltip />
                <Bar dataKey="winRate" name="Win rate" fill="#ce93d8" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>
      </Box>
    </Stack>
  );
}
