import { useEffect, useMemo, useState } from "react";
import type { ColDef, ICellRendererParams, ValueGetterParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import {
  Checkbox,
  FormControl,
  InputLabel,
  LinearProgress,
  ListItemText,
  MenuItem,
  Pagination,
  Select,
  Stack,
  Typography,
} from "@mui/material";

const SETS_PER_PAGE = 50;

export type ReplayRow = {
  id: string;
  timestamp: string | null;
  player1: string;
  player2: string;
  player1Character: string;
  player2Character: string;
  winner: string;
  player1Support: string;
  player2Support: string;
  roundScore: string;
};
type SessionRow = {
  id: string;
  started: string;
  finished: string;
  record: string;
  opponent: string;
  playerCharacters: string;
  playerSupports: string;
  opponentCharacters: string;
  opponentSupports: string;
  games: ReplayRow[];
};
type DisplayRow =
  | (SessionRow & { kind: "session" })
  | (ReplayRow & { kind: "game"; sessionId: string });

function formatReplayTimestamp(timestamp: string | null) {
  if (!timestamp) return "";
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!match) return timestamp;
  const [, year, month, day, hour, minute] = match;
  const currentYear = new Date().getFullYear().toString();
  return `${year === currentYear ? "" : `${year} `}${month}/${day} ${hour}:${minute}`;
}

function SetFilter({
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
    <FormControl
      size="small"
      sx={{ minWidth: 190, backgroundColor: "background.paper", borderRadius: 1 }}
    >
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

function makeSessions(games: ReplayRow[], poi: string | null): SessionRow[] {
  const sessions: ReplayRow[][] = [];
  const sortedGames = [...games].sort((a, b) =>
    (b.timestamp ?? "").localeCompare(a.timestamp ?? ""),
  );
  for (const game of sortedGames) {
    const previous = sessions.at(-1)?.at(-1);
    const opponent = poi === game.player1 ? game.player2 : game.player1;
    const previousOpponent = previous
      ? poi === previous.player1
        ? previous.player2
        : previous.player1
      : null;
    if (!previous || opponent !== previousOpponent) sessions.push([game]);
    else sessions.at(-1)?.push(game);
  }
  return sessions.map((sessionGames, index) => {
    const wins = sessionGames.filter((game) => game.winner === poi).length;
    const losses = sessionGames.filter(
      (game) => game.winner !== "Unknown" && game.winner !== poi,
    ).length;
    const first = sessionGames[0];
    return {
      id: `session-${index}-${first.id}`,
      started: first.timestamp ?? "Unknown",
      finished: sessionGames.at(-1)?.timestamp ?? "Unknown",
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
      games: sessionGames,
    };
  });
}

function makeSessionsAsync(
  games: ReplayRow[],
  poi: string | null,
  onProgress: (completed: number, total: number) => void,
): Promise<SessionRow[]> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      const sortedGames = [...games].sort((a, b) =>
        (b.timestamp ?? "").localeCompare(a.timestamp ?? ""),
      );
      const sessions: ReplayRow[][] = [];
      let index = 0;

      const processBatch = () => {
        const end = Math.min(index + 250, sortedGames.length);
        for (; index < end; index += 1) {
          const game = sortedGames[index];
          const previous = sessions.at(-1)?.at(-1);
          const opponent = poi === game.player1 ? game.player2 : game.player1;
          const previousOpponent = previous
            ? poi === previous.player1
              ? previous.player2
              : previous.player1
            : null;
          if (!previous || opponent !== previousOpponent) sessions.push([game]);
          else sessions.at(-1)?.push(game);
        }
        onProgress(index, sortedGames.length);
        if (index < sortedGames.length) {
          window.setTimeout(processBatch, 0);
        } else {
          resolve(
            sessions.map((sessionGames, sessionIndex) => {
              const wins = sessionGames.filter((game) => game.winner === poi).length;
              const losses = sessionGames.filter(
                (game) => game.winner !== "Unknown" && game.winner !== poi,
              ).length;
              const first = sessionGames[0];
              return {
                id: `session-${sessionIndex}-${first.id}`,
                started: first.timestamp ?? "Unknown",
                finished: sessionGames.at(-1)?.timestamp ?? "Unknown",
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

export function AvatarGrid({
  rowData,
  playerOfInterest,
}: {
  rowData: ReplayRow[];
  playerOfInterest: string | null;
}) {
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({
    opponent: [] as string[],
    poi: [] as string[],
    poiSupport: [] as string[],
    opponentCharacter: [] as string[],
    opponentSupport: [] as string[],
  });
  const [page, setPage] = useState(1);
  const [sessionRows, setSessionRows] = useState<SessionRow[]>(() =>
    makeSessions(rowData, playerOfInterest),
  );
  const [sessionProgress, setSessionProgress] = useState({ completed: 0, total: 0 });
  const [isPreparingSessions, setIsPreparingSessions] = useState(false);
  useEffect(() => {
    let active = true;
    setIsPreparingSessions(true);
    setSessionProgress({ completed: 0, total: rowData.length });
    void makeSessionsAsync(rowData, playerOfInterest, (completed, total) => {
      if (active) setSessionProgress({ completed, total });
    }).then((nextSessions) => {
      if (!active) return;
      setSessionRows(nextSessions);
      setIsPreparingSessions(false);
    });
    return () => {
      active = false;
    };
  }, [rowData, playerOfInterest]);
  const matchesOtherFilters = (session: SessionRow, ignored: keyof typeof filters) =>
    (ignored === "opponent" ||
      filters.opponent.length === 0 ||
      filters.opponent.includes(session.opponent)) &&
    (ignored === "poi" ||
      filters.poi.length === 0 ||
      filters.poi.some((value) => session.playerCharacters.split(", ").includes(value))) &&
    (ignored === "poiSupport" ||
      filters.poiSupport.length === 0 ||
      filters.poiSupport.some((value) => session.playerSupports.split(", ").includes(value))) &&
    (ignored === "opponentCharacter" ||
      filters.opponentCharacter.length === 0 ||
      filters.opponentCharacter.some((value) =>
        session.opponentCharacters.split(", ").includes(value),
      )) &&
    (ignored === "opponentSupport" ||
      filters.opponentSupport.length === 0 ||
      filters.opponentSupport.some((value) =>
        session.opponentSupports.split(", ").includes(value),
      ));
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
      poi: valuesFor("poi", (session) => session.playerCharacters.split(", ")),
      poiSupport: valuesFor("poiSupport", (session) => session.playerSupports.split(", ")),
      opponentCharacter: valuesFor("opponentCharacter", (session) =>
        session.opponentCharacters.split(", "),
      ),
      opponentSupport: valuesFor("opponentSupport", (session) =>
        session.opponentSupports.split(", "),
      ),
    };
  }, [sessionRows, filters]);
  const filteredSessions = useMemo(
    () =>
      sessionRows.filter(
        (session) =>
          (filters.opponent.length === 0 || filters.opponent.includes(session.opponent)) &&
          (filters.poi.length === 0 ||
            filters.poi.some((value) => session.playerCharacters.split(", ").includes(value))) &&
          (filters.poiSupport.length === 0 ||
            filters.poiSupport.some((value) =>
              session.playerSupports.split(", ").includes(value),
            )) &&
          (filters.opponentCharacter.length === 0 ||
            filters.opponentCharacter.some((value) =>
              session.opponentCharacters.split(", ").includes(value),
            )) &&
          (filters.opponentSupport.length === 0 ||
            filters.opponentSupport.some((value) =>
              session.opponentSupports.split(", ").includes(value),
            )),
      ),
    [sessionRows, filters],
  );
  const pageCount = Math.max(1, Math.ceil(filteredSessions.length / SETS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pagedSessions = useMemo(
    () => filteredSessions.slice((currentPage - 1) * SETS_PER_PAGE, currentPage * SETS_PER_PAGE),
    [currentPage, filteredSessions],
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
  const columnDefs = useMemo<ColDef<DisplayRow>[]>(
    () => [
      {
        headerName: "",
        width: 76,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<DisplayRow>) => {
          const data = params.data;
          if (!data || data.kind !== "session") return null;
          return (
            <button
              type="button"
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
          );
        },
      },
      {
        headerName: "Session started / time",
        valueGetter: ({ data }) =>
          data?.kind === "session"
            ? formatReplayTimestamp(data.started)
            : formatReplayTimestamp(data?.timestamp ?? null),
        flex: 1,
      },
      {
        headerName: "Session finished / time",
        valueGetter: ({ data }) =>
          data?.kind === "session"
            ? formatReplayTimestamp(data.finished)
            : formatReplayTimestamp(data?.timestamp ?? null),
        flex: 1,
      },
      {
        headerName: "Record / winner",
        valueGetter: ({ data }) => (data?.kind === "session" ? data.record : (data?.winner ?? "")),
        flex: 1,
      },
      {
        headerName: "Opponent",
        valueGetter: ({ data }: ValueGetterParams<DisplayRow>) =>
          !data
            ? ""
            : data.kind === "session"
              ? data.opponent
              : playerOfInterest === data.player1
                ? data.player2
                : data.player1,
        flex: 1,
      },
      {
        headerName: "POI character",
        valueGetter: ({ data }: ValueGetterParams<DisplayRow>) =>
          !data
            ? ""
            : data.kind === "session"
              ? data.playerCharacters
              : playerOfInterest === data.player1
                ? data.player1Character
                : data.player2Character,
        flex: 1,
      },
      {
        headerName: "POI support",
        valueGetter: ({ data }: ValueGetterParams<DisplayRow>) =>
          !data
            ? ""
            : data.kind === "session"
              ? data.playerSupports
              : playerOfInterest === data.player1
                ? data.player1Support
                : data.player2Support,
        flex: 1,
      },
      {
        headerName: "Opponent character",
        valueGetter: ({ data }: ValueGetterParams<DisplayRow>) =>
          !data
            ? ""
            : data.kind === "session"
              ? data.opponentCharacters
              : playerOfInterest === data.player1
                ? data.player2Character
                : data.player1Character,
        flex: 1,
      },
      {
        headerName: "Opponent support",
        valueGetter: ({ data }: ValueGetterParams<DisplayRow>) =>
          !data
            ? ""
            : data.kind === "session"
              ? data.opponentSupports
              : playerOfInterest === data.player1
                ? data.player2Support
                : data.player1Support,
        flex: 1,
      },
    ],
    [expandedSessions, playerOfInterest],
  );
  return (
    <>
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
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1}
        sx={{
          mb: 1,
          p: 1,
          textAlign: "left",
          backgroundColor: "background.paper",
          borderRadius: 1,
        }}
      >
        <SetFilter
          label="Opponent"
          values={filterValues.opponent}
          selected={filters.opponent}
          onChange={(value) => setFilters((current) => ({ ...current, opponent: value }))}
        />
        <SetFilter
          label="POI character / support"
          values={filterValues.poi}
          selected={filters.poi}
          onChange={(value) => setFilters((current) => ({ ...current, poi: value }))}
        />
        <SetFilter
          label="POI support"
          values={filterValues.poiSupport}
          selected={filters.poiSupport}
          onChange={(value) => setFilters((current) => ({ ...current, poiSupport: value }))}
        />
        <SetFilter
          label="Opponent character"
          values={filterValues.opponentCharacter}
          selected={filters.opponentCharacter}
          onChange={(value) =>
            setFilters((current) => ({ ...current, opponentCharacter: value, opponentSupport: [] }))
          }
        />
        <SetFilter
          label="Opponent support"
          values={filterValues.opponentSupport}
          selected={filters.opponentSupport}
          onChange={(value) => setFilters((current) => ({ ...current, opponentSupport: value }))}
        />
      </Stack>
      <div className="ag-theme-quartz-dark" style={{ height: 500, width: "100%" }}>
        <AgGridReact<DisplayRow>
          columnDefs={columnDefs}
          rowData={displayRows}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          autoSizeStrategy={{ type: "fitGridWidth" }}
          getRowId={({ data }) => data.id}
        />
      </div>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ mt: 1, alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        <Typography variant="caption" color="text.secondary">
          {filteredSessions.length === 0
            ? "No sets"
            : `Showing ${(currentPage - 1) * SETS_PER_PAGE + 1}-${Math.min(
                currentPage * SETS_PER_PAGE,
                filteredSessions.length,
              )} of ${filteredSessions.length} sets`}
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
    </>
  );
}
