import { useEffect, useMemo, useState } from "react";
import type { ColDef, ICellRendererParams, ValueGetterParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { AnalyticsSection, type AnalysisSummary } from "./AnalyticsSection";
import {
  Alert,
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
type ExportMessage = { severity: "success" | "error"; text: string };
type ContextMenuState = { data: DisplayRow; mouseX: number; mouseY: number } | null;

function formatReplayTimestamp(timestamp: string | null) {
  if (!timestamp) return "";
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!match) return timestamp;
  const [, year, month, day, hour, minute] = match;
  const currentYear = new Date().getFullYear().toString();
  return `${year === currentYear ? "" : `${year} `}${month}/${day} ${hour}:${minute}`;
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
    games,
  };
}

export function AvatarGrid({
  rowData,
  playerOfInterest,
  dateFrom,
  dateTo,
  invalidDateRange,
  onSummaryChange,
}: {
  rowData: ReplayRow[];
  playerOfInterest: string | null;
  dateFrom: string;
  dateTo: string;
  invalidDateRange: boolean;
  onSummaryChange: (summary: AnalysisSummary) => void;
}) {
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
  const [selectedMatchupGameIds, setSelectedMatchupGameIds] = useState<string[] | null>(null);
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
  useEffect(() => {
    setSelectedMatchupGameIds(null);
  }, [playerOfInterest, rowData]);
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
    if (selectedMatchupGameIds === null) return filteredSessions;
    const selectedIds = new Set(selectedMatchupGameIds);
    return filteredSessions.flatMap((session) => {
      const matchingGames = session.games.filter((game) => selectedIds.has(game.id));
      return matchingGames.length > 0
        ? [projectSession(session, matchingGames, playerOfInterest)]
        : [];
    });
  }, [filteredSessions, playerOfInterest, selectedMatchupGameIds]);
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
        headerName: "Session started / replay time",
        valueGetter: ({ data }) =>
          data?.kind === "session"
            ? formatReplayTimestamp(data.started)
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
        headerName: "Player of interest character",
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
        headerName: "Player of interest support",
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
      <AnalyticsSection
        games={filteredGames}
        sessions={filteredSessions}
        playerOfInterest={playerOfInterest}
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
      <div className="ag-theme-quartz-dark" style={{ height: 500, width: "100%" }}>
        <AgGridReact<DisplayRow>
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
      </Menu>
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
    </>
  );
}
