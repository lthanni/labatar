import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
  createTheme,
} from "@mui/material";
import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AgGridProvider } from "ag-grid-react";
import { AllCommunityModule } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { AvatarGrid, type ReplayRow } from "./AvatarGrid";
import type { AnalysisSummary } from "./AnalyticsSection";
import { useCallback } from "react";
import { OverlaySurface, VisualOverlay } from "./Overlay";

declare global {
  interface Window {
    electronAPI?: {
      replays: {
        getFolder: () => Promise<string | null>;
        selectFolder: () => Promise<string | null>;
        scanFolder: (folder: string) => Promise<{
          games: ReplayRow[];
          playerCounts: Record<string, number>;
          duplicateCount: number;
        }>;
        showInFolder: (request: { ids: string[] }) => Promise<void>;
        zip: (request: { ids: string[]; suggestedName: string }) => Promise<{
          path: string;
          fileCount: number;
        } | null>;
        onScanProgress: (
          listener: (progress: { completed: number; total: number; phase: "scanning" }) => void,
        ) => () => void;
      };
      overlay: {
        show: () => Promise<void>;
        hide: () => Promise<void>;
        isVisible: () => Promise<boolean>;
        setFocusMode: (enabled: boolean) => Promise<boolean>;
        getCaptureSource: () => Promise<{
          id: string;
          mode?: "game-window" | "unavailable";
          name?: string;
        } | null>;
        getCaptureFolder: () => Promise<string>;
        openCaptureFolder: () => Promise<string>;
        finalizeCapture: () => Promise<boolean>;
        beginCapture: () => Promise<boolean>;
        onCaptureFinalize: (listener: () => void) => () => void;
        onCaptureBegin: (listener: () => void) => () => void;
        saveCaptureScreenshot: (request: {
          sessionId: string;
          filename: string;
          data: Uint8Array;
        }) => Promise<{ path: string }>;
        saveCaptureVideo: (request: {
          sessionId: string;
          data: Uint8Array;
        }) => Promise<{ path: string }>;
        saveCaptureSession: (request: {
          sessionId: string;
          manifest: unknown;
        }) => Promise<{ path: string }>;
      };
    };
  }
}

function ReplayFolderPicker({
  onData,
  dateFrom,
  dateTo,
  invalidDateRange,
  onDateFromChange,
  onDateToChange,
}: {
  onData: (games: ReplayRow[], counts: Record<string, number>) => void;
  dateFrom: string;
  dateTo: string;
  invalidDateRange: boolean;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
}) {
  const [folder, setFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const scanGeneration = useRef(0);
  const scan = useCallback(
    async (selectedFolder: string | null) => {
      if (!selectedFolder || !window.electronAPI) return;
      const generation = ++scanGeneration.current;
      setLoading(true);
      setError(null);
      setDuplicateCount(0);
      setProgress({ completed: 0, total: 0 });
      try {
        const result = await window.electronAPI.replays.scanFolder(selectedFolder);
        if (generation !== scanGeneration.current) return;
        onData(result.games, result.playerCounts);
        setDuplicateCount(result.duplicateCount);
        const scannedCount = result.games.length + result.duplicateCount;
        setProgress({ completed: scannedCount, total: scannedCount });
      } catch (scanError) {
        if (generation !== scanGeneration.current) return;
        setError(scanError instanceof Error ? scanError.message : String(scanError));
      } finally {
        if (generation === scanGeneration.current) setLoading(false);
      }
    },
    [onData],
  );

  useEffect(() => {
    let active = true;
    const unsubscribe = window.electronAPI?.replays.onScanProgress((nextProgress) => {
      setProgress({ completed: nextProgress.completed, total: nextProgress.total });
    });
    void window.electronAPI?.replays.getFolder().then((savedFolder) => {
      if (!active) return;
      setFolder(savedFolder);
      void scan(savedFolder);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [scan]);

  const chooseFolder = async () => {
    const selected = await window.electronAPI?.replays.selectFolder();
    if (selected) {
      setFolder(selected);
      void scan(selected);
    }
  };

  const refreshFolder = () => {
    void scan(folder);
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, textAlign: "left" }}>
      <Stack
        direction={{ xs: "column", lg: "row" }}
        spacing={2}
        sx={{ alignItems: { lg: "center" } }}
      >
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", minWidth: 0 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Replay folder
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap title={folder ?? undefined}>
              {folder ?? "No replay folder selected"}
            </Typography>
          </Box>
          <Button variant="contained" onClick={chooseFolder} disabled={loading}>
            Choose folder
          </Button>
          <Tooltip title="Refresh replay files">
            <span>
              <IconButton
                aria-label="Refresh replay files"
                onClick={refreshFolder}
                disabled={!folder || loading}
                size="small"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 11a8.1 8.1 0 0 0-14.8-4.5L3 9" />
                  <path d="M3 4v5h5" />
                  <path d="M4 13a8.1 8.1 0 0 0 14.8 4.5L21 15" />
                  <path d="M21 20v-5h-5" />
                </svg>
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", justifyContent: "flex-end", ml: { lg: "auto" } }}
        >
          <Typography variant="caption" color="text.secondary">
            Date range
          </Typography>
          <TextField
            label="From"
            type="date"
            size="small"
            value={dateFrom}
            onChange={(event) => onDateFromChange(event.target.value)}
            error={invalidDateRange}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: 145 }}
          />
          <Typography variant="body2" color="text.secondary">
            –
          </Typography>
          <TextField
            label="To"
            type="date"
            size="small"
            value={dateTo}
            onChange={(event) => onDateToChange(event.target.value)}
            error={invalidDateRange}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: 145 }}
          />
        </Stack>
      </Stack>
      {loading && (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          <LinearProgress
            variant={progress.total > 0 ? "determinate" : "indeterminate"}
            value={progress.total > 0 ? (progress.completed / progress.total) * 100 : undefined}
          />
          <Typography variant="caption" color="text.secondary">
            {progress.total > 0
              ? `Loading replay ${progress.completed} of ${progress.total}...`
              : "Finding replay files..."}
          </Typography>
        </Stack>
      )}
      {duplicateCount > 0 && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          Ignored {duplicateCount} duplicate replay file{duplicateCount === 1 ? "" : "s"}.
        </Typography>
      )}
      {error && (
        <Typography variant="caption" color="error" component="div" sx={{ mt: 1 }}>
          Replay loading failed: {error}
        </Typography>
      )}
    </Paper>
  );
}

const root = document.getElementById("app");

const agGridModules = [AllCommunityModule];
const darkTheme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#121318", paper: "#1d2028" },
    primary: { main: "#90caf9" },
  },
});

function getLocalDateKey(timestamp: string | null) {
  if (!timestamp) return null;
  const date = new Date(timestamp.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return null;
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, "0")))
    .join("-");
}

function getReplayDateRange(games: ReplayRow[]) {
  const dates = games
    .map((game) => getLocalDateKey(game.timestamp))
    .filter((date): date is string => Boolean(date))
    .sort();
  return { from: dates[0] ?? "", to: dates.at(-1) ?? "" };
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ py: 1.25, "&:last-child": { pb: 1.25 } }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
          {value}
        </Typography>
        {detail && (
          <Typography variant="caption" color="text.secondary">
            {detail}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

function ReplayAnalysis() {
  const [games, setGames] = useState<ReplayRow[]>([]);
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [overridePlayer, setOverridePlayer] = useState<string | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisSummary>({
    games: 0,
    sessions: 0,
    wins: 0,
    losses: 0,
    opponents: 0,
    winRate: 0,
  });
  const [isGridPending, startGridTransition] = useTransition();
  const onData = useCallback((nextGames: ReplayRow[], counts: Record<string, number>) => {
    startGridTransition(() => {
      setGames(nextGames);
      setPlayerCounts(counts);
      setOverridePlayer(null);
    });
  }, []);
  const deferredGames = useDeferredValue(games);
  const isGridStale = deferredGames !== games;
  const isPreparingGrid = isGridPending || isGridStale;
  const automaticPlayer = Object.entries(playerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const playerOfInterest = overridePlayer ?? automaticPlayer;
  const relevantGames = useMemo(
    () =>
      deferredGames.filter(
        (game) => game.player1 === playerOfInterest || game.player2 === playerOfInterest,
      ),
    [deferredGames, playerOfInterest],
  );

  const onPlayerOverride = (nextPlayer: string) => {
    startGridTransition(() => {
      setOverridePlayer(nextPlayer);
    });
  };
  const replayDateRange = useMemo(() => getReplayDateRange(relevantGames), [relevantGames]);
  const [dateFromOverride, setDateFromOverride] = useState<string | null>(null);
  const [dateToOverride, setDateToOverride] = useState<string | null>(null);
  const dateFrom = dateFromOverride ?? replayDateRange.from;
  const dateTo = dateToOverride ?? replayDateRange.to;
  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const onSummaryChange = useCallback((nextSummary: AnalysisSummary) => {
    setAnalysisSummary(nextSummary);
  }, []);

  return (
    <>
      <ReplayFolderPicker
        onData={onData}
        dateFrom={dateFrom}
        dateTo={dateTo}
        invalidDateRange={invalidDateRange}
        onDateFromChange={setDateFromOverride}
        onDateToChange={setDateToOverride}
      />
      {isPreparingGrid && (
        <Stack spacing={0.5} sx={{ mb: 1, textAlign: "left" }}>
          <LinearProgress />
          <Typography variant="caption" color="text.secondary">
            Preparing replay grid… The current grid remains available while this finishes.
          </Typography>
        </Stack>
      )}
      <Stack
        direction={{ xs: "column", lg: "row" }}
        spacing={2}
        sx={{ mb: 1, alignItems: { lg: "center" }, justifyContent: "flex-start" }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ alignItems: { sm: "center" }, flexWrap: "wrap" }}
        >
          <FormControl
            size="small"
            sx={{ minWidth: 240, backgroundColor: "background.paper", borderRadius: 1 }}
          >
            <InputLabel id="player-override-label">Player of interest</InputLabel>
            <Select
              labelId="player-override-label"
              value={playerOfInterest ?? ""}
              label="Player of interest"
              onChange={(event) => onPlayerOverride(event.target.value)}
            >
              {Object.entries(playerCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => (
                  <MenuItem key={name} value={name}>
                    {name} ({count})
                  </MenuItem>
                ))}
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            disabled={!overridePlayer}
            onClick={() => setOverridePlayer(null)}
          >
            Use auto-detected
          </Button>
          <Typography variant="caption" color="text.secondary">
            {overridePlayer ? "Overridden" : "Auto-determined"}
          </Typography>
        </Stack>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(2, minmax(0, 1fr))",
              sm: "repeat(3, minmax(0, 180px))",
            },
            gap: 1,
          }}
        >
          <SummaryCard
            label="Games"
            value={String(analysisSummary.games)}
            detail={`${analysisSummary.sessions} sets`}
          />
          <SummaryCard
            label="Record"
            value={`${analysisSummary.wins}–${analysisSummary.losses}`}
            detail={`${analysisSummary.winRate}% (${analysisSummary.wins + analysisSummary.losses} total)`}
          />
          <SummaryCard label="Opponents" value={String(analysisSummary.opponents)} />
        </Box>
      </Stack>
      <AvatarGrid
        rowData={relevantGames}
        playerOfInterest={playerOfInterest}
        dateFrom={dateFrom}
        dateTo={dateTo}
        invalidDateRange={invalidDateRange}
        onSummaryChange={onSummaryChange}
      />
    </>
  );
}

function App() {
  const [tab, setTab] = useState(() => {
    const savedTab = Number(localStorage.getItem("avatar-app-last-tab"));
    return overlayAvailable && savedTab === 1 ? 1 : 0;
  });
  const [mountedTabs, setMountedTabs] = useState(() => ({
    replay: tab === 0,
    overlay: overlayAvailable && tab === 1,
  }));
  const changeTab = (nextTab: number) => {
    if (nextTab === 1 && !overlayAvailable) return;
    setTab(nextTab);
    setMountedTabs((current) => ({
      replay: current.replay || nextTab === 0,
      overlay: overlayAvailable && (current.overlay || nextTab === 1),
    }));
    localStorage.setItem("avatar-app-last-tab", String(nextTab));
  };

  return (
    <>
      <Tabs value={tab} onChange={(_, nextTab: number) => changeTab(nextTab)} sx={{ mb: 2 }}>
        <Tab label="Match history" />
        {overlayAvailable && <Tab label="Visual overlay" />}
      </Tabs>
      {mountedTabs.replay && (
        <Box sx={{ display: tab === 0 ? "block" : "none" }}>
          <ReplayAnalysis />
        </Box>
      )}
      {overlayAvailable && mountedTabs.overlay && (
        <Box sx={{ display: tab === 1 ? "block" : "none" }}>
          <VisualOverlay />
        </Box>
      )}
    </>
  );
}

if (!root) {
  throw new Error("Root element not found");
}

const overlayAvailable = import.meta.env.DEV;
const isOverlay = overlayAvailable && new URLSearchParams(window.location.search).has("overlay");
if (isOverlay) document.documentElement.classList.add("overlay-mode");
createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={darkTheme}>
      <Box
        sx={{
          height: "100vh",
          minHeight: 0,
          width: "100%",
          boxSizing: "border-box",
          overflowX: "hidden",
          overflowY: isOverlay ? "hidden" : "auto",
          p: isOverlay ? 0 : 2,
          backgroundColor: isOverlay ? "transparent" : "background.default",
        }}
      >
        {isOverlay ? (
          <OverlaySurface />
        ) : (
          <AgGridProvider modules={agGridModules}>
            <App />
          </AgGridProvider>
        )}
      </Box>
    </ThemeProvider>
  </StrictMode>,
);
