import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  ThemeProvider,
  Typography,
  createTheme,
} from "@mui/material";
import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AgGridProvider } from "ag-grid-react";
import { AllCommunityModule } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { AvatarGrid, type ReplayRow } from "./AvatarGrid";
import { useCallback } from "react";
import { OverlaySurface, VisualOverlay } from "./Overlay";

declare global {
  interface Window {
    electronAPI?: {
      replays: {
        getFolder: () => Promise<string | null>;
        selectFolder: () => Promise<string | null>;
        scanFolder: (
          folder: string,
        ) => Promise<{ games: ReplayRow[]; playerCounts: Record<string, number> }>;
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
}: {
  onData: (games: ReplayRow[], counts: Record<string, number>) => void;
}) {
  const [folder, setFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const scanGeneration = useRef(0);
  const scan = useCallback(
    async (selectedFolder: string | null) => {
      if (!selectedFolder || !window.electronAPI) return;
      const generation = ++scanGeneration.current;
      setLoading(true);
      setError(null);
      setProgress({ completed: 0, total: 0 });
      try {
        const result = await window.electronAPI.replays.scanFolder(selectedFolder);
        if (generation !== scanGeneration.current) return;
        onData(result.games, result.playerCounts);
        setProgress({ completed: result.games.length, total: result.games.length });
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

  return (
    <Paper variant="outlined" sx={{ p: 2, textAlign: "left" }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { sm: "center" } }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
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

function ReplayAnalysis() {
  const [games, setGames] = useState<ReplayRow[]>([]);
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [overridePlayer, setOverridePlayer] = useState<string | null>(null);
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

  return (
    <>
      <ReplayFolderPicker onData={onData} />
      <Typography variant="body2" sx={{ my: 1, textAlign: "left" }}>
        {playerOfInterest
          ? `Player of interest: ${playerOfInterest} (${playerCounts[playerOfInterest]} appearances)`
          : "No replay data loaded"}
      </Typography>
      {isPreparingGrid && (
        <Stack spacing={0.5} sx={{ mb: 1, textAlign: "left" }}>
          <LinearProgress />
          <Typography variant="caption" color="text.secondary">
            Preparing replay grid… The current grid remains available while this finishes.
          </Typography>
        </Stack>
      )}
      <Stack direction="row" spacing={2} sx={{ mb: 1, alignItems: "center" }}>
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
      <AvatarGrid rowData={relevantGames} playerOfInterest={playerOfInterest} />
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
        <Tab label="Replay analysis" />
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
