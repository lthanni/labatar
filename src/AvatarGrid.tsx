import { useMemo, useState } from "react";
import type { ColDef, ICellRendererParams, ValueGetterParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import {
  Checkbox,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Stack,
} from "@mui/material";

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
    opponentCharacter: [] as string[],
    opponentSupport: [] as string[],
  });
  const sessionRows = useMemo(
    () => makeSessions(rowData, playerOfInterest),
    [rowData, playerOfInterest],
  );
  const matchesOtherFilters = (session: SessionRow, ignored: keyof typeof filters) =>
    (ignored === "opponent" ||
      filters.opponent.length === 0 ||
      filters.opponent.includes(session.opponent)) &&
    (ignored === "poi" ||
      filters.poi.length === 0 ||
      filters.poi.some((value) => session.playerCharacters.split(", ").includes(value))) &&
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
  const displayRows = useMemo<DisplayRow[]>(
    () =>
      filteredSessions.flatMap((session) => [
        { ...session, kind: "session" as const },
        ...(expandedSessions.has(session.id)
          ? session.games.map((game) => ({ ...game, kind: "game" as const, sessionId: session.id }))
          : []),
      ]),
    [filteredSessions, expandedSessions],
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
          data?.kind === "session" ? data.started : (data?.timestamp ?? ""),
        flex: 1,
      },
      {
        headerName: "Session finished / time",
        valueGetter: ({ data }) =>
          data?.kind === "session" ? data.finished : (data?.timestamp ?? ""),
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
          autoSizeStrategy={{ type: "fitCellContents" }}
          getRowId={({ data }) => data.id}
        />
      </div>
    </>
  );
}
