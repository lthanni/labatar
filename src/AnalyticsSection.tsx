import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Autocomplete,
  Box,
  Card,
  CardContent,
  Checkbox,
  Pagination,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
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
import { summarizeOpponents } from "./opponent-summary";
import supportMap from "../electron/support-map.json";

const ENABLE_OPPONENT_WIN_RATE_CHART = false;
const OPPONENTS_PER_PAGE = 20;
const AUTOCOMPLETE_RESULT_LIMIT = 100;

type AnalyticsSectionProps = {
  fillHeight?: boolean;
  tableContent: ReactNode;
  games: ReplayRow[];
  sessions: Array<{ games: ReplayRow[] }>;
  getPortrait: (
    character: string,
    support: string,
  ) => { portraitUrl: string | null; supportUrl: string | null } | undefined;
  playerOfInterest: string | null;
  playerCounts: Record<string, number>;
  playerOverride: string | null;
  onPlayerOverrideChange: (value: string | null) => void;
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

export const OPPONENT_CHARACTER_ROSTER = [
  "Aang",
  "Korra",
  "Nightmare Korra",
  "Zuko",
  "Katara",
  "Toph",
  "Sokka",
  "Azula",
  "Kyoshi",
  "Ozai",
  "Zaheer",
  "Avatar Aang",
];

function displayCharacterName(name: string) {
  return name === "Nightmare Korra" ? "N. Korra" : name;
}

type MatchupData = {
  rows: string[];
  columns: string[];
  playerCharacterCounts: Map<string, number>;
  opponentCharacterCounts: Map<string, number>;
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

export function isInDateRange(game: ReplayRow, dateFrom: string, dateTo: string) {
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
    columns: [...new Set([...OPPONENT_CHARACTER_ROSTER, ...columnCounts.keys()])].sort(
      (left, right) =>
        (columnCounts.get(right) ?? 0) - (columnCounts.get(left) ?? 0) ||
        (OPPONENT_CHARACTER_ROSTER.indexOf(left) >= 0
          ? OPPONENT_CHARACTER_ROSTER.indexOf(left)
          : OPPONENT_CHARACTER_ROSTER.length) -
          (OPPONENT_CHARACTER_ROSTER.indexOf(right) >= 0
            ? OPPONENT_CHARACTER_ROSTER.indexOf(right)
            : OPPONENT_CHARACTER_ROSTER.length) ||
        left.localeCompare(right),
    ),
    playerCharacterCounts: rowCounts,
    opponentCharacterCounts: columnCounts,
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
  children,
  height = 270,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  height?: number | string;
}) {
  return (
    <Card variant="outlined" sx={{ minWidth: 0 }}>
      <CardContent>
        {(title || subtitle) && (
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: { sm: "flex-start" }, justifyContent: "flex-start" }}
          >
            <Box sx={{ minWidth: 0 }}>
              {title && (
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {title}
                </Typography>
              )}
              {subtitle && (
                <Typography variant="caption" color="text.secondary">
                  {subtitle}
                </Typography>
              )}
            </Box>
          </Stack>
        )}
        <Box sx={{ width: "100%", height, mt: title || subtitle ? 1 : 0 }}>{children}</Box>
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

function OpponentAutocomplete({
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
  const [inputValue, setInputValue] = useState("");
  const options = useMemo(() => {
    const selectedValues = new Set(selected);
    const matches = [...selected];
    const query = inputValue.trim().toLowerCase();
    let resultCount = 0;
    for (const value of values) {
      if (selectedValues.has(value) || (query && !value.toLowerCase().includes(query))) continue;
      matches.push(value);
      resultCount += 1;
      if (resultCount === AUTOCOMPLETE_RESULT_LIMIT) break;
    }
    return matches;
  }, [inputValue, selected, values]);
  return (
    <Autocomplete
      size="small"
      sx={{ minWidth: 190, width: "100%" }}
      options={options}
      value={selected}
      inputValue={inputValue}
      onInputChange={(_, value) => setInputValue(value)}
      onChange={(_, value) => onChange(value)}
      filterOptions={(available) => available}
      noOptionsText="No opponents found"
      renderInput={(params) => <TextField {...params} label={label} />}
      limitTags={2}
      multiple
    />
  );
}

function PlayerAutocomplete({
  playerCounts,
  playerOfInterest,
  playerOverride,
  onChange,
}: {
  playerCounts: Record<string, number>;
  playerOfInterest: string | null;
  playerOverride: string | null;
  onChange: (value: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const sortedPlayers = useMemo(
    () => Object.entries(playerCounts).sort((a, b) => b[1] - a[1]),
    [playerCounts],
  );
  const options = useMemo(() => {
    const matches = [""];
    if (playerOverride) matches.push(playerOverride);
    const query = search.trim().toLowerCase();
    let resultCount = 0;
    for (const [name] of sortedPlayers) {
      if (name === playerOverride || (query && !name.toLowerCase().includes(query))) continue;
      matches.push(name);
      resultCount += 1;
      if (resultCount === AUTOCOMPLETE_RESULT_LIMIT) break;
    }
    return matches;
  }, [playerOverride, search, sortedPlayers]);
  return (
    <Autocomplete
      size="small"
      sx={{ width: "100%", backgroundColor: "background.paper" }}
      options={options}
      value={playerOverride ?? ""}
      onInputChange={(_, value, reason) => setSearch(reason === "input" ? value : "")}
      onChange={(_, value) => {
        setSearch("");
        onChange(value || null);
      }}
      filterOptions={(available) => available}
      getOptionLabel={(name) =>
        name
          ? `${name} (${playerCounts[name] ?? 0})`
          : playerOfInterest
            ? `${playerOfInterest} (auto)`
            : "Auto-detected"
      }
      renderInput={(params) => <TextField {...params} label="Player" />}
      noOptionsText="No players found"
    />
  );
}

const SUPPORT_SLOTS = [1, 2, 3] as const;
const supportNamesByCharacter = supportMap as Record<string, Record<string, string>>;

export function supportFilters(character: string, supports: SupportStats[]) {
  const used = new Set<string>();
  const slots = SUPPORT_SLOTS.map((slot) => {
    const mappedName = supportNamesByCharacter[character]?.[String(slot)] ?? `Support #${slot}`;
    const support =
      supports.find(({ name }) => name.toLowerCase() === mappedName.toLowerCase()) ??
      supports.find(({ name }) => name.toLowerCase() === `support #${slot}`);
    if (support) used.add(support.name);
    return { slot, name: support?.name ?? mappedName, games: support?.games ?? 0 };
  });
  return { slots, extra: supports.filter(({ name }) => !used.has(name)) };
}

function PortraitFilterButton({
  label,
  count,
  src,
  fallback,
  selected,
  onClick,
  size,
  disabled = false,
}: {
  label: string;
  count: number;
  src: string | null;
  fallback: string;
  selected: boolean;
  onClick: () => void;
  size: number;
  disabled?: boolean;
}) {
  const inactive = disabled || count === 0;
  const active = selected && !inactive;
  return (
    <Box
      component="button"
      type="button"
      aria-label={`${label}: ${count} ${count === 1 ? "game" : "games"}`}
      aria-pressed={active}
      title={`${label} (${count})`}
      disabled={inactive}
      onClick={onClick}
      sx={{
        width: size + 8,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.25,
        p: 0.25,
        color: "text.primary",
        bgcolor: active ? "action.selected" : "background.default",
        border: "1px solid",
        borderColor: active ? "primary.main" : "grey.800",
        borderRadius: 1,
        cursor: inactive ? "default" : "pointer",
        "&:hover": inactive ? undefined : { borderColor: "primary.light" },
        "&:focus-visible": { outline: "2px solid", outlineColor: "primary.light" },
      }}
    >
      {src ? (
        <Box
          component="img"
          src={src}
          alt=""
          loading="lazy"
          sx={{
            width: size,
            height: size,
            objectFit: "contain",
            filter: active ? "none" : "grayscale(1)",
            opacity: active ? 1 : 0.5,
          }}
        />
      ) : (
        <Box
          sx={{
            width: size,
            height: size,
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            fontSize: "0.65rem",
            lineHeight: 1.1,
            overflow: "hidden",
            opacity: active ? 1 : 0.5,
          }}
        >
          {fallback}
        </Box>
      )}
      <Typography component="span" variant="caption" sx={{ lineHeight: 1 }}>
        {count}
      </Typography>
    </Box>
  );
}

function CollapsedCharacterRows({
  rows,
  data,
  getPortrait,
  disabledMatchups,
  disabledPoiSupports,
  onExpand,
}: {
  rows: string[];
  data: MatchupData;
  getPortrait: AnalyticsSectionProps["getPortrait"];
  disabledMatchups: Set<string>;
  disabledPoiSupports: Set<string>;
  onExpand: () => void;
}) {
  const visibleRows = rows.slice(0, 3);
  const cardHeight = 70;
  const reveal = 28;
  return (
    <Box
      component="button"
      type="button"
      aria-label={`Expand ${rows.length} character rows`}
      aria-expanded={false}
      title={`Expand character rows: ${rows.join(", ")}`}
      onClick={onExpand}
      sx={{
        position: "relative",
        width: "100%",
        height: cardHeight + reveal * (visibleRows.length - 1) + 20,
        p: 0,
        border: 0,
        bgcolor: "transparent",
        color: "text.primary",
        cursor: "pointer",
        textAlign: "left",
        "&:focus-visible": { outline: "2px solid", outlineColor: "primary.light" },
        "&:hover .collapsed-character-card": { borderColor: "primary.light" },
      }}
    >
      {visibleRows.map((row, index) => {
        const supports = supportFilters(row, data.supportsByCharacter.get(row) ?? []);
        const portraitUrl = getPortrait(row, "Support #1")?.portraitUrl ?? null;
        const selected = data.columns.some(
          (column) =>
            data.cells.has(`${row}\u0000${column}`) &&
            !disabledMatchups.has(`${row}\u0000${column}`),
        );
        return (
          <Box
            key={row}
            className="collapsed-character-card"
            aria-hidden="true"
            sx={{
              position: "absolute",
              top: index * reveal,
              left: 0,
              zIndex: visibleRows.length - index,
              width: "100%",
              height: cardHeight,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              gap: 0.25,
              p: 0.5,
              border: "1px solid",
              borderColor: selected ? "primary.main" : "grey.800",
              borderRadius: 1,
              bgcolor: "background.paper",
            }}
          >
            <Box
              sx={{
                width: 48,
                height: 58,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid",
                borderColor: selected ? "primary.main" : "grey.800",
                borderRadius: 0.5,
                bgcolor: selected ? "action.selected" : "background.default",
              }}
            >
              {portraitUrl ? (
                <Box
                  component="img"
                  src={portraitUrl}
                  alt=""
                  loading="lazy"
                  sx={{
                    width: 43,
                    height: 43,
                    objectFit: "contain",
                    filter: selected ? "none" : "grayscale(1)",
                    opacity: selected ? 1 : 0.5,
                  }}
                />
              ) : (
                <Typography
                  variant="caption"
                  sx={{ fontSize: "0.6rem", lineHeight: 1, textAlign: "center" }}
                >
                  {displayCharacterName(row)}
                </Typography>
              )}
              <Typography variant="caption" sx={{ lineHeight: 1 }}>
                {data.playerCharacterCounts.get(row) ?? 0}
              </Typography>
            </Box>
            {supports.slots.map((support) => {
              const supportUrl = getPortrait(row, `Support #${support.slot}`)?.supportUrl ?? null;
              const supportSelected =
                selected && !disabledPoiSupports.has(getPoiSupportKey(row, support.name));
              return (
                <Box
                  key={support.slot}
                  sx={{
                    width: 43,
                    height: 58,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid",
                    borderColor: supportSelected ? "primary.main" : "grey.800",
                    borderRadius: 0.5,
                    bgcolor: supportSelected ? "action.selected" : "background.default",
                  }}
                >
                  {supportUrl ? (
                    <Box
                      component="img"
                      src={supportUrl}
                      alt=""
                      loading="lazy"
                      sx={{
                        width: 36,
                        height: 42,
                        objectFit: "contain",
                        filter: supportSelected ? "none" : "grayscale(1)",
                        opacity: supportSelected ? 1 : 0.5,
                      }}
                    />
                  ) : (
                    <Typography variant="caption" sx={{ fontSize: "0.6rem" }}>
                      #{support.slot}
                    </Typography>
                  )}
                  <Typography variant="caption" sx={{ lineHeight: 1 }}>
                    {support.games}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        );
      })}
      <Typography
        component="span"
        variant="caption"
        sx={{ position: "absolute", bottom: 0, left: 4, color: "primary.light", lineHeight: 1.2 }}
      >
        {rows.length > 3 ? `+${rows.length - 3} more · ` : ""}Expand {rows.length} characters
      </Typography>
    </Box>
  );
}

function MatchupHeatmap({
  data,
  getPortrait,
  playerOfInterest,
  playerCounts,
  playerOverride,
  onPlayerOverrideChange,
  opponentPlayers,
  selectedOpponentPlayers,
  onOpponentPlayersChange,
  disabledMatchups,
  disabledOpponentCharacters,
  disabledOpponentSupports,
  disabledPoiSupports,
  charactersCollapsed,
  onCharactersCollapsedChange,
  onToggle,
  onToggleOpponentCharacter,
  onToggleAllOpponentCharacters,
  onToggleOpponentSupport,
  onToggleRow,
  onTogglePoiSupport,
}: {
  data: MatchupData;
  getPortrait: AnalyticsSectionProps["getPortrait"];
  playerOfInterest: string | null;
  playerCounts: Record<string, number>;
  playerOverride: string | null;
  onPlayerOverrideChange: (value: string | null) => void;
  opponentPlayers: string[];
  selectedOpponentPlayers: string[];
  onOpponentPlayersChange: (value: string[]) => void;
  disabledMatchups: Set<string>;
  disabledOpponentCharacters: Set<string>;
  disabledOpponentSupports: Set<string>;
  disabledPoiSupports: Set<string>;
  charactersCollapsed: boolean;
  onCharactersCollapsedChange: (collapsed: boolean) => void;
  onToggle: (key: string) => void;
  onToggleOpponentCharacter: (value: string) => void;
  onToggleAllOpponentCharacters: (selectAll: boolean) => void;
  onToggleOpponentSupport: (value: string) => void;
  onToggleRow: (row: string, selectAll: boolean) => void;
  onTogglePoiSupport: (value: string) => void;
}) {
  const {
    rows,
    columns,
    playerCharacterCounts,
    opponentCharacterCounts,
    supportsByCharacter,
    supportsByOpponentCharacter,
    cells,
  } = data;
  const activeOpponentColumns = columns.filter(
    (column) => opponentCharacterCounts.get(column) ?? 0,
  );
  const allOpponentCharactersSelected =
    activeOpponentColumns.length > 0 &&
    activeOpponentColumns.every((column) => !disabledOpponentCharacters.has(column));
  const collapsedStats = columns.map((column) => {
    const stats = rows
      .filter((row) => !disabledMatchups.has(`${row}\u0000${column}`))
      .map((row) => cells.get(`${row}\u0000${column}`))
      .filter((cell): cell is MatchupStats => Boolean(cell));
    return {
      column,
      games: stats.reduce((total, cell) => total + cell.games, 0),
      wins: stats.reduce((total, cell) => total + cell.wins, 0),
      losses: stats.reduce((total, cell) => total + cell.losses, 0),
    };
  });
  const collapsedOverall = collapsedStats.reduce(
    (total, cell) => ({
      games: total.games + cell.games,
      wins: total.wins + cell.wins,
      losses: total.losses + cell.losses,
    }),
    { games: 0, wins: 0, losses: 0 },
  );
  const visibleRows = charactersCollapsed && rows.length > 1 ? [] : rows;
  const collapsedRateCell = (stats: MatchupStats, label: string, disabled = false) => {
    const rate = stats.wins + stats.losses ? getWinRate(stats.wins, stats.losses) : null;
    const description = `${label}: ${stats.games} games in enabled character matchups, ${rate === null ? "no decided games" : `${rate}% win rate`}`;
    const color =
      rate === null ? "rgba(255,255,255,0.04)" : rate >= 50 ? "144,202,249" : "239,154,154";
    const opacity = rate === null ? 1 : 0.2 + Math.abs(rate - 50) / 100;
    return (
      <Box
        role="img"
        aria-label={description}
        title={description}
        sx={{
          minHeight: 116,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 0.5,
          bgcolor: disabled || !stats.games ? "#424242" : `rgba(${color}, ${opacity})`,
          color: "text.primary",
        }}
      >
        <Typography variant="caption">{rate === null ? "—" : `${rate}%`}</Typography>
      </Box>
    );
  };
  const corner = (
    <Box
      sx={{
        minWidth: 212,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 0.75,
        p: 0.5,
        textAlign: "left",
      }}
    >
      <OpponentAutocomplete
        label="Opponent"
        values={opponentPlayers}
        selected={selectedOpponentPlayers}
        onChange={onOpponentPlayersChange}
      />
      <PlayerAutocomplete
        playerCounts={playerCounts}
        playerOfInterest={playerOfInterest}
        playerOverride={playerOverride}
        onChange={onPlayerOverrideChange}
      />
      {rows.length > 1 && (
        <Box
          component="button"
          type="button"
          aria-expanded={!charactersCollapsed}
          onClick={() => onCharactersCollapsedChange(!charactersCollapsed)}
          sx={{
            alignSelf: "flex-start",
            border: 0,
            bgcolor: "transparent",
            color: "primary.light",
            font: "inherit",
            fontSize: "0.75rem",
            cursor: "pointer",
            "&:hover": { textDecoration: "underline" },
            "&:focus-visible": { outline: "2px solid", outlineColor: "primary.light" },
          }}
        >
          {charactersCollapsed ? "Expand characters" : "Collapse characters"}
        </Box>
      )}
    </Box>
  );
  if (columns.length === 0) {
    return (
      <Box sx={{ display: "flex", height: "100%", gap: 2 }}>
        {corner}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <EmptyChart />
        </Box>
      </Box>
    );
  }
  return (
    <Box sx={{ overflowX: "auto", overflowY: rows.length > 1 ? "auto" : "hidden", height: "100%" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `212px 56px repeat(${columns.length}, 160px)`,
          gap: 0.5,
        }}
      >
        {corner}
        <Box
          component="button"
          type="button"
          disabled={activeOpponentColumns.length === 0}
          aria-label={
            allOpponentCharactersSelected
              ? "Deselect all opponent characters"
              : "Select all opponent characters"
          }
          aria-pressed={allOpponentCharactersSelected}
          title={
            allOpponentCharactersSelected
              ? "Deselect all opponent characters"
              : "Select all opponent characters"
          }
          onClick={() => onToggleAllOpponentCharacters(!allOpponentCharactersSelected)}
          sx={{
            width: "100%",
            height: "100%",
            minHeight: 42,
            p: 0,
            border: "1px solid",
            borderColor: allOpponentCharactersSelected ? "grey.700" : "grey.900",
            borderRadius: 1,
            bgcolor: allOpponentCharactersSelected ? "background.paper" : "#424242",
            cursor: activeOpponentColumns.length ? "pointer" : "default",
            "&:hover": activeOpponentColumns.length ? { filter: "brightness(1.15)" } : undefined,
            "&:focus-visible": { outline: "2px solid", outlineColor: "primary.light" },
          }}
        />
        {columns.map((column) => {
          const supports = supportsByOpponentCharacter.get(column) ?? [];
          const supportOptions = supportFilters(column, supports);
          const games = opponentCharacterCounts.get(column) ?? 0;
          const displayColumn = displayCharacterName(column);
          const columnDisabled = disabledOpponentCharacters.has(column);
          return (
            <Card key={column} variant="outlined" sx={{ minWidth: 160 }}>
              <CardContent sx={{ p: 0.5, "&:last-child": { pb: 0.5 } }}>
                <Stack spacing={0.5} sx={{ alignItems: "center" }}>
                  <PortraitFilterButton
                    label={column}
                    count={games}
                    src={getPortrait(column, "Support #1")?.portraitUrl ?? null}
                    fallback={displayColumn}
                    selected={!columnDisabled}
                    onClick={() => onToggleOpponentCharacter(column)}
                    size={54}
                  />
                  <Stack direction="row" spacing={0.25}>
                    {supportOptions.slots.map((support) => {
                      const supportKey = getPoiSupportKey(column, support.name);
                      return (
                        <PortraitFilterButton
                          key={support.slot}
                          label={`${column} / ${support.name}`}
                          count={support.games}
                          src={getPortrait(column, `Support #${support.slot}`)?.supportUrl ?? null}
                          fallback={`#${support.slot}`}
                          selected={!columnDisabled && !disabledOpponentSupports.has(supportKey)}
                          disabled={columnDisabled}
                          onClick={() => onToggleOpponentSupport(supportKey)}
                          size={36}
                        />
                      );
                    })}
                  </Stack>
                  {supportOptions.extra.length > 0 && (
                    <Stack direction="row" spacing={0.25} sx={{ flexWrap: "wrap" }}>
                      {supportOptions.extra.map((support) => {
                        const supportKey = getPoiSupportKey(column, support.name);
                        return (
                          <PortraitFilterButton
                            key={supportKey}
                            label={`${column} / ${support.name}`}
                            count={support.games}
                            src={null}
                            fallback={support.name}
                            selected={!columnDisabled && !disabledOpponentSupports.has(supportKey)}
                            disabled={columnDisabled}
                            onClick={() => onToggleOpponentSupport(supportKey)}
                            size={36}
                          />
                        );
                      })}
                    </Stack>
                  )}
                </Stack>
              </CardContent>
            </Card>
          );
        })}
        {charactersCollapsed && rows.length > 1 && (
          <Fragment>
            <CollapsedCharacterRows
              rows={rows}
              data={data}
              getPortrait={getPortrait}
              disabledMatchups={disabledMatchups}
              disabledPoiSupports={disabledPoiSupports}
              onExpand={() => onCharactersCollapsedChange(false)}
            />
            {collapsedRateCell(collapsedOverall, "All characters")}
            {collapsedStats.map((stats) => (
              <Fragment key={stats.column}>
                {collapsedRateCell(
                  stats,
                  `All characters vs ${stats.column}`,
                  disabledOpponentCharacters.has(stats.column),
                )}
              </Fragment>
            ))}
          </Fragment>
        )}
        {visibleRows.map((row) => {
          const supports = supportsByCharacter.get(row) ?? [];
          const supportOptions = supportFilters(row, supports);
          const rowCells = columns
            .map((column) => {
              const key = `${row}\u0000${column}`;
              return { key, cell: cells.get(key) };
            })
            .filter((entry): entry is { key: string; cell: MatchupStats } => Boolean(entry.cell));
          const rowKeys = rowCells.map(({ key }) => key);
          const rowSelected = rowKeys.some((key) => !disabledMatchups.has(key));
          const rowWins = rowCells.reduce((total, { cell }) => total + cell.wins, 0);
          const rowLosses = rowCells.reduce((total, { cell }) => total + cell.losses, 0);
          const overallRate = rowWins + rowLosses > 0 ? getWinRate(rowWins, rowLosses) : null;
          const rateColor =
            overallRate === null
              ? "rgba(255,255,255,0.04)"
              : overallRate >= 50
                ? "144,202,249"
                : "239,154,154";
          const rateOpacity = overallRate === null ? 1 : 0.2 + Math.abs(overallRate - 50) / 100;
          return (
            <Fragment key={row}>
              <Card variant="outlined" sx={{ minWidth: 212 }}>
                <CardContent sx={{ p: 0.5, "&:last-child": { pb: 0.5 } }}>
                  <Stack spacing={0.25}>
                    <Stack direction="row" spacing={0.25} sx={{ alignItems: "center" }}>
                      <PortraitFilterButton
                        label={row}
                        count={playerCharacterCounts.get(row) ?? 0}
                        src={getPortrait(row, "Support #1")?.portraitUrl ?? null}
                        fallback={displayCharacterName(row)}
                        selected={rowSelected}
                        onClick={() => onToggleRow(row, !rowSelected)}
                        size={48}
                      />
                      {supportOptions.slots.map((support) => {
                        const supportKey = getPoiSupportKey(row, support.name);
                        return (
                          <PortraitFilterButton
                            key={support.slot}
                            label={`${row} / ${support.name}`}
                            count={support.games}
                            src={getPortrait(row, `Support #${support.slot}`)?.supportUrl ?? null}
                            fallback={`#${support.slot}`}
                            selected={rowSelected && !disabledPoiSupports.has(supportKey)}
                            disabled={!rowSelected}
                            onClick={() => onTogglePoiSupport(supportKey)}
                            size={36}
                          />
                        );
                      })}
                    </Stack>
                    {supportOptions.extra.length > 0 && (
                      <Stack direction="row" spacing={0.25} sx={{ flexWrap: "wrap" }}>
                        {supportOptions.extra.map((support) => {
                          const supportKey = getPoiSupportKey(row, support.name);
                          return (
                            <PortraitFilterButton
                              key={supportKey}
                              label={`${row} / ${support.name}`}
                              count={support.games}
                              src={null}
                              fallback={support.name}
                              selected={rowSelected && !disabledPoiSupports.has(supportKey)}
                              disabled={!rowSelected}
                              onClick={() => onTogglePoiSupport(supportKey)}
                              size={36}
                            />
                          );
                        })}
                      </Stack>
                    )}
                  </Stack>
                </CardContent>
              </Card>
              <Box
                component="button"
                type="button"
                disabled={rowKeys.length === 0}
                aria-label={`${displayCharacterName(row)} overall win rate: ${overallRate === null ? "no decided games" : `${overallRate}%`}`}
                aria-pressed={rowSelected}
                title={`${displayCharacterName(row)} overall: ${overallRate === null ? "no decided games" : `${overallRate}% win rate`} (${rowWins} wins, ${rowLosses} losses). Click to deselect all matchup percentages in this row.`}
                onClick={() => onToggleRow(row, false)}
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
                  backgroundColor: rowSelected ? `rgba(${rateColor}, ${rateOpacity})` : "#424242",
                  cursor: rowKeys.length ? "pointer" : "default",
                  "&:hover": rowKeys.length ? { filter: "brightness(1.15)" } : undefined,
                  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.light" },
                }}
              >
                <Typography variant="caption">
                  {overallRate === null ? "—" : `${overallRate}%`}
                </Typography>
              </Box>
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
  fillHeight = false,
  tableContent,
  games,
  sessions,
  getPortrait,
  playerOfInterest,
  playerCounts,
  playerOverride,
  onPlayerOverrideChange,
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
            playerCharacterCounts: new Map<string, number>(),
            opponentCharacterCounts: new Map<string, number>(),
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
  const [disabledOpponents, setDisabledOpponents] = useState<Set<string>>(new Set());
  const [charactersCollapsed, setCharactersCollapsed] = useState(false);
  useEffect(() => {
    setDisabledOpponents(new Set());
  }, [playerOfInterest]);
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
  const toggleAllOpponentCharacters = (selectAll: boolean) => {
    setDisabledOpponentCharacters((current) => {
      const next = new Set(current);
      for (const column of matchupData.columns) {
        if (!matchupData.opponentCharacterCounts.get(column)) continue;
        if (selectAll) next.delete(column);
        else next.add(column);
      }
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
          !disabledOpponents.has(getOpponent(game, playerOfInterest)) &&
          !disabledMatchups.has(getMatchupKey(game, playerOfInterest)) &&
          !disabledOpponentCharacters.has(opponentCharacter) &&
          !disabledOpponentSupports.has(getPoiSupportKey(opponentCharacter, opponentSupport)) &&
          !disabledPoiSupports.has(getPoiSupportKey(character, support))
        );
      })
      .map((game) => game.id);
  }, [
    disabledMatchups,
    disabledOpponents,
    disabledOpponentCharacters,
    disabledOpponentSupports,
    disabledPoiSupports,
    games,
    playerOfInterest,
  ]);
  useEffect(() => {
    onMatchupGameIdsChange(selectedMatchupGameIds);
  }, [onMatchupGameIdsChange, selectedMatchupGameIds]);
  const opponentRows = useMemo(
    () =>
      playerOfInterest ? summarizeOpponents(selectedMatchupGames, sessions, playerOfInterest) : [],
    [playerOfInterest, selectedMatchupGames, sessions],
  );
  const toggleOpponent = (name: string) => {
    setDisabledOpponents((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const selectedOpponentCount = opponentRows.filter(
    (row) => !disabledOpponents.has(row.name),
  ).length;
  const [opponentPage, setOpponentPage] = useState(1);
  const opponentPageCount = Math.max(1, Math.ceil(opponentRows.length / OPPONENTS_PER_PAGE));
  const currentOpponentPage = Math.min(opponentPage, opponentPageCount);
  useEffect(() => {
    if (opponentPage > opponentPageCount) setOpponentPage(opponentPageCount);
  }, [opponentPage, opponentPageCount]);
  const pagedOpponentRows = useMemo(
    () =>
      opponentRows.slice(
        (currentOpponentPage - 1) * OPPONENTS_PER_PAGE,
        currentOpponentPage * OPPONENTS_PER_PAGE,
      ),
    [currentOpponentPage, opponentRows],
  );
  const chartGames = useMemo(
    () =>
      playerOfInterest
        ? selectedMatchupGames.filter(
            (game) => !disabledOpponents.has(getOpponent(game, playerOfInterest)),
          )
        : analysisGames,
    [analysisGames, disabledOpponents, playerOfInterest, selectedMatchupGames],
  );
  const chartMatchupData = useMemo(
    () =>
      playerOfInterest && disabledOpponents.size > 0
        ? buildMatchupData(
            analysisGames.filter(
              (game) => !disabledOpponents.has(getOpponent(game, playerOfInterest)),
            ),
            playerOfInterest,
          )
        : matchupData,
    [analysisGames, disabledOpponents, matchupData, playerOfInterest],
  );
  const opponentData = useMemo(
    () =>
      ENABLE_OPPONENT_WIN_RATE_CHART && playerOfInterest
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
  const matchupPanelHeight = charactersCollapsed
    ? 320
    : Math.min(500, Math.max(320, chartMatchupData.rows.length * 72 + 175));

  return (
    <Stack
      spacing={2}
      sx={{
        mb: 2,
        textAlign: "left",
        ...(fillHeight && { flex: "1 1 0", minHeight: 0 }),
      }}
    >
      <ChartPanel height={matchupPanelHeight}>
        <MatchupHeatmap
          data={chartMatchupData}
          getPortrait={getPortrait}
          playerOfInterest={playerOfInterest}
          playerCounts={playerCounts}
          playerOverride={playerOverride}
          onPlayerOverrideChange={onPlayerOverrideChange}
          opponentPlayers={opponentFilterValues.players}
          selectedOpponentPlayers={selectedOpponentPlayers}
          onOpponentPlayersChange={onOpponentPlayersChange}
          disabledMatchups={disabledMatchups}
          disabledOpponentCharacters={disabledOpponentCharacters}
          disabledOpponentSupports={disabledOpponentSupports}
          disabledPoiSupports={disabledPoiSupports}
          charactersCollapsed={charactersCollapsed}
          onCharactersCollapsedChange={setCharactersCollapsed}
          onToggle={toggleMatchup}
          onToggleOpponentCharacter={toggleOpponentCharacter}
          onToggleAllOpponentCharacters={toggleAllOpponentCharacters}
          onToggleOpponentSupport={toggleOpponentSupport}
          onToggleRow={toggleMatchupRow}
          onTogglePoiSupport={togglePoiSupport}
        />
      </ChartPanel>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" },
          gap: 2,
          alignItems: fillHeight ? "stretch" : "start",
          ...(fillHeight && {
            flex: "1 1 0",
            minHeight: 260,
            overflow: "hidden",
          }),
        }}
      >
        <Box sx={{ minWidth: 0, minHeight: 0, height: fillHeight ? "100%" : undefined }}>
          {tableContent}
        </Box>
        <Stack
          spacing={2}
          sx={{
            minWidth: 0,
            minHeight: 0,
            height: fillHeight ? "100%" : undefined,
            overflowY: fillHeight ? "auto" : undefined,
          }}
        >
          <ChartPanel height={230}>
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
          <Card variant="outlined" sx={{ minWidth: 0 }}>
            <CardContent>
              <TableContainer sx={{ maxHeight: 360 }}>
                <Table
                  size="small"
                  stickyHeader
                  aria-label="Opponents matching the current filters"
                >
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          slotProps={{
                            input: {
                              "aria-label": "Include all opponents in charts and match table",
                            },
                          }}
                          checked={
                            opponentRows.length > 0 && selectedOpponentCount === opponentRows.length
                          }
                          indeterminate={
                            selectedOpponentCount > 0 && selectedOpponentCount < opponentRows.length
                          }
                          disabled={opponentRows.length === 0}
                          onChange={(_, checked) =>
                            setDisabledOpponents((current) => {
                              const next = new Set(current);
                              for (const row of opponentRows) {
                                if (checked) next.delete(row.name);
                                else next.add(row.name);
                              }
                              return next;
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>Opponent</TableCell>
                      <TableCell align="right">Sets</TableCell>
                      <TableCell align="right">Games</TableCell>
                      <TableCell>Characters played</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pagedOpponentRows.map((row) => (
                      <TableRow
                        key={row.name}
                        hover
                        selected={!disabledOpponents.has(row.name)}
                        onClick={() => toggleOpponent(row.name)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell padding="checkbox">
                          <Checkbox
                            size="small"
                            slotProps={{
                              input: {
                                "aria-label": `Include ${row.name} in charts and match table`,
                              },
                            }}
                            checked={!disabledOpponents.has(row.name)}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => toggleOpponent(row.name)}
                          />
                        </TableCell>
                        <TableCell component="th" scope="row" sx={{ whiteSpace: "nowrap" }}>
                          {row.name}
                        </TableCell>
                        <TableCell align="right">{row.sets}</TableCell>
                        <TableCell align="right">{row.games}</TableCell>
                        <TableCell>{row.characters.map(({ name }) => name).join(", ")}</TableCell>
                      </TableRow>
                    ))}
                    {opponentRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center">
                          No opponents match the current filters.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              {opponentRows.length > OPPONENTS_PER_PAGE && (
                <Stack
                  direction="row"
                  sx={{
                    mt: 1,
                    flexWrap: "wrap",
                    gap: 1,
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {`${(currentOpponentPage - 1) * OPPONENTS_PER_PAGE + 1}-${Math.min(
                      currentOpponentPage * OPPONENTS_PER_PAGE,
                      opponentRows.length,
                    )} of ${opponentRows.length} opponents`}
                  </Typography>
                  <Pagination
                    aria-label="Opponent pages"
                    count={opponentPageCount}
                    page={currentOpponentPage}
                    onChange={(_, nextPage) => setOpponentPage(nextPage)}
                    size="small"
                    showFirstButton
                    showLastButton
                  />
                </Stack>
              )}
            </CardContent>
          </Card>
          {ENABLE_OPPONENT_WIN_RATE_CHART && (
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
          )}
        </Stack>
      </Box>
    </Stack>
  );
}
