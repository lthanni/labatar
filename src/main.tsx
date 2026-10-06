import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
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
import { ObsRecordingPanel } from "./ObsRecordingPanel";
import { ObsRecordingControls, ObsRecordingProvider, useObsRecording } from "./ObsRecordingContext";
import { MoveCapturePanel } from "./MoveCapturePanel";
import { RecordingViewer } from "./RecordingViewer";
import { TechSection } from "./TechSection";
import type { ObsSettings, ObsState, RecordingMetadata } from "./obs-types";
import type { RecordedVideo, RecordingTags } from "./recording-types";
import type { RecordingAnalysis } from "./recording-analysis-types";
import type {
  KnownMoveCaptureVariant,
  MoveCaptureState,
  MoveCatalog,
  MoveTakeOutcome,
} from "./move-capture-types";
import type {
  ProcessingConfiguration,
  ProcessingConfigurationResult,
} from "./processing-config-types";
import { techSelectComboEvent, techSelectRecordingEvent } from "./tech-types";

declare global {
  interface Window {
    electronAPI?: {
      app: {
        getVersion: () => Promise<string>;
      };
      processingConfiguration: {
        load: () => Promise<ProcessingConfigurationResult>;
        save: (request: {
          configuration: ProcessingConfiguration;
          expectedRevision: number;
        }) => Promise<ProcessingConfigurationResult>;
        export: () => Promise<string | null>;
        import: (request: {
          expectedRevision: number | null;
        }) => Promise<ProcessingConfigurationResult | null>;
      };
      capture: {
        getState: () => Promise<CaptureState>;
        setSettings: (request: { hotkey: string }) => Promise<CaptureState>;
        toggle: () => Promise<{ outputPath?: string | null }>;
        addChapter: () => Promise<{ at: string }>;
        setAutoGameChapters: (enabled: boolean) => Promise<CaptureState>;
        setAutoClipManualChapters: (enabled: boolean) => Promise<CaptureState>;
        onState: (listener: (state: CaptureState) => void) => () => void;
      };
      obs: {
        getState: () => Promise<ObsState>;
        getSettings: () => Promise<ObsSettings>;
        connect: (request: {
          host: string;
          port: number;
          password?: string;
          rememberPassword?: boolean;
        }) => Promise<ObsState>;
        openApp: () => Promise<boolean>;
        clearPassword: () => Promise<boolean>;
        disconnect: () => Promise<ObsState>;
        prepareProfile: (request: {
          profileName: string;
          recordDirectory: string;
        }) => Promise<{ profileName: string; recordDirectory: string; created: boolean }>;
        setupScenes: (request: { profileName: string; recordDirectory: string }) => Promise<{
          profileName: string;
          recordDirectory: string;
          sceneCollectionName: string;
          scenes: string[];
          gameAudioMode: "separate" | "window-capture";
          outputResolution: { width: number; height: number } | null;
          profileCreated: boolean;
        }>;
        setScene: (sceneName: string) => Promise<ObsState>;
        startRecording: (request: {
          setup: { profileName: string; recordDirectory: string };
          metadata: RecordingMetadata;
        }) => Promise<{ sessionId: string; startedAt: string; metadata: RecordingMetadata }>;
        startManualRecording: (request: {
          setup: { profileName: string; recordDirectory: string };
        }) => Promise<{ sessionId: string; startedAt: string; metadata: null }>;
        stopRecording: () => Promise<{
          outputPath: string | null;
          manifestPath: string | null;
          manifestError: string | null;
        }>;
        setAutomaticRecording: (enabled: boolean) => Promise<ObsState>;
        onState: (listener: (state: ObsState) => void) => () => void;
      };
      updates: {
        onStatus: (listener: (status: UpdateStatus) => void) => () => void;
      };
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
          listener: (progress: {
            completed: number;
            total: number;
            phase: "logs" | "scanning";
          }) => void,
        ) => () => void;
      };
      recordings: {
        getWorkState: () => Promise<RecordingWorkItem[]>;
        onWorkState: (listener: (work: RecordingWorkItem[]) => void) => () => void;
        onChanged: (listener: () => void) => () => void;
        list: (request?: { analysisScope?: "none" | "move-takes" | "all" }) => Promise<{
          folder: string;
          recordings: RecordedVideo[];
        }>;
        getChapters: (request: {
          recordingId: string;
        }) => Promise<Array<{ startMs: number; title: string }>>;
        openFrameReader: (request: { recordingId: string }) => Promise<{
          sessionId: string;
          frameRate: number;
        }>;
        readFrame: (request: { sessionId: string; frameIndex: number }) => Promise<{
          frameIndex: number;
          data: string;
        }>;
        closeFrameReader: (request: { sessionId: string }) => Promise<boolean>;
        exportClip: (request: {
          recordingId: string;
          startTime: number;
          endTime: number;
        }) => Promise<RecordedVideo>;
        createF10Clips: (request: { recordingId: string }) => Promise<{
          total: number;
          created: number;
          alreadyExisting: number;
          failures: Array<{ chapterStartMs: number; error: string }>;
        }>;
        renameRecording: (request: { recordingId: string; name: string }) => Promise<RecordedVideo>;
        reprocessName: (request: { recordingId: string }) => Promise<RecordedVideo>;
        addGameChapters: (request: {
          recordingId: string;
        }) => Promise<{ added: number; skipped: string[]; backupPath: string | null }>;
        openYouTubeStudio: (request: { recordingId: string }) => Promise<void>;
        setTags: (request: { recordingId: string; tags: RecordingTags }) => Promise<RecordedVideo>;
        saveAnalysis: (request: {
          recordingId: string;
          analysis: RecordingAnalysis;
        }) => Promise<RecordedVideo>;
        setMoveEvidence: (request: {
          recordingId: string;
          action: "accept" | "archive";
          reason?: string;
        }) => Promise<RecordedVideo>;
        deleteRecording: (request: { recordingId: string }) => Promise<{ id: string }>;
        startDrag: (request: { recordingId: string }) => void;
      };
      moveCatalog: {
        load: () => Promise<{
          catalog: MoveCatalog;
          path: string;
          recoveredFromBackup: boolean;
        }>;
        knownVariants: () => Promise<KnownMoveCaptureVariant[]>;
        save: (request: { catalog: MoveCatalog; expectedRevision: number }) => Promise<{
          catalog: MoveCatalog;
          path: string;
          recoveredFromBackup: boolean;
        }>;
      };
      moveCapture: {
        getState: () => Promise<MoveCaptureState>;
        arm: (request: {
          characterId: string;
          moveId: string;
          moveInput: string;
          isStance: boolean;
          isCharged: boolean;
          outcome: MoveTakeOutcome;
        }) => Promise<MoveCaptureState>;
        disarm: () => Promise<MoveCaptureState>;
        onState: (listener: (state: MoveCaptureState) => void) => () => void;
      };
    };
  }
}

type CaptureState = {
  hotkey: string;
  hotkeyRegistered: boolean;
  lastAction: "started" | "stopped" | null;
  error: string | null;
  chapterHotkey: string;
  chapterHotkeyRegistered: boolean;
  chapterLastAddedAt: string | null;
  chapterError: string | null;
  autoGameChapters: boolean;
  autoClipManualChapters: boolean;
};

type RecordingWorkItem = {
  id: string;
  title: string;
  fileName: string;
  detail: string;
  completed?: number;
  total?: number;
};

type UpdateStatus = {
  state: "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";
  version?: string;
  percent?: number;
};

function ReplayFolderPicker({
  onData,
  dateFrom,
  dateTo,
  invalidDateRange,
  onDateFromChange,
  onDateToChange,
  rankedOnly,
  onRankedOnlyChange,
  rankAffectingOnly,
  onRankAffectingOnlyChange,
}: {
  onData: (games: ReplayRow[], counts: Record<string, number>, folder: string) => void;
  dateFrom: string;
  dateTo: string;
  invalidDateRange: boolean;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  rankedOnly: boolean;
  onRankedOnlyChange: (value: boolean) => void;
  rankAffectingOnly: boolean;
  onRankAffectingOnlyChange: (value: boolean) => void;
}) {
  const [folder, setFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
    phase: "logs" | "scanning";
  }>({ completed: 0, total: 0, phase: "scanning" });
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
      setProgress({ completed: 0, total: 0, phase: "logs" });
      try {
        const result = await window.electronAPI.replays.scanFolder(selectedFolder);
        if (generation !== scanGeneration.current) return;
        onData(result.games, result.playerCounts, selectedFolder);
        setDuplicateCount(result.duplicateCount);
        const scannedCount = result.games.length + result.duplicateCount;
        setProgress({ completed: scannedCount, total: scannedCount, phase: "scanning" });
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
      setProgress(nextProgress);
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
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={rankedOnly}
                onChange={(event) => onRankedOnlyChange(event.target.checked)}
              />
            }
            label="Ranked only"
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={rankAffectingOnly}
                disabled={!rankedOnly}
                onChange={(event) => onRankAffectingOnlyChange(event.target.checked)}
              />
            }
            label="Games which affect rank only"
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
            {progress.phase === "logs"
              ? progress.total > 0
                ? `Loading rating logs ${progress.completed} of ${progress.total}...`
                : "Finding rating logs..."
              : progress.total > 0
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

function isRankedReplay(game: ReplayRow) {
  return game.ratings?.mode.trim().toLowerCase() === "ranked";
}

function affectsRank(game: ReplayRow) {
  return game.ratings?.affectsRank !== false;
}

function getPlayerCounts(games: ReplayRow[]) {
  const counts: Record<string, number> = {};
  for (const game of games) {
    counts[game.player1] = (counts[game.player1] ?? 0) + 1;
    counts[game.player2] = (counts[game.player2] ?? 0) + 1;
  }
  return counts;
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

function UpdateStatusBanner({
  status,
  onClose,
}: {
  status: UpdateStatus | null;
  onClose: () => void;
}) {
  if (!status) return null;

  const isDownloading = status.state === "downloading";
  const percent = Math.max(0, Math.min(100, status.percent ?? 0));
  const message = {
    checking: "Checking for updates…",
    available: `Update${status.version ? ` v${status.version}` : ""} is available.`,
    downloading: `Downloading update${status.percent == null ? "…" : ` (${Math.round(status.percent)}%)`}…`,
    downloaded: "Update downloaded and ready to install.",
    "not-available": "Labatar is up to date.",
    error: "Labatar could not check for updates.",
  }[status.state];
  const severity =
    status.state === "error" ? "error" : status.state === "not-available" ? "success" : "info";

  return (
    <Alert severity={severity} onClose={onClose} sx={{ mb: 2 }}>
      <Typography variant="body2">{message}</Typography>
      {isDownloading && (
        <LinearProgress
          variant={status.percent == null ? "indeterminate" : "determinate"}
          value={percent}
          sx={{ mt: 1, minWidth: 240 }}
        />
      )}
    </Alert>
  );
}

function ReplayAnalysis({
  active,
  recordingsRefreshToken,
}: {
  active: boolean;
  recordingsRefreshToken: number;
}) {
  const [games, setGames] = useState<ReplayRow[]>([]);
  const [replayFolder, setReplayFolder] = useState<string | null>(null);
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [overridePlayer, setOverridePlayer] = useState<string | null>(null);
  const [rankedOnly, setRankedOnly] = useState(false);
  const [rankAffectingOnly, setRankAffectingOnly] = useState(false);
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisSummary>({
    games: 0,
    sessions: 0,
    wins: 0,
    losses: 0,
    opponents: 0,
    winRate: 0,
  });
  const [isGridPending, startGridTransition] = useTransition();
  const onData = useCallback(
    (nextGames: ReplayRow[], counts: Record<string, number>, folder: string) => {
      startGridTransition(() => {
        setGames(nextGames);
        setReplayFolder(folder);
        setPlayerCounts(counts);
        setOverridePlayer(null);
      });
    },
    [],
  );
  const deferredGames = useDeferredValue(games);
  const isGridStale = deferredGames !== games;
  const isPreparingGrid = isGridPending || isGridStale;
  const modeFilteredGames = useMemo(() => {
    const modeGames = rankedOnly ? deferredGames.filter(isRankedReplay) : deferredGames;
    return rankedOnly && rankAffectingOnly ? modeGames.filter(affectsRank) : modeGames;
  }, [deferredGames, rankedOnly, rankAffectingOnly]);
  const visiblePlayerCounts = useMemo(
    () => (rankedOnly ? getPlayerCounts(modeFilteredGames) : playerCounts),
    [modeFilteredGames, playerCounts, rankedOnly],
  );
  const automaticPlayer =
    Object.entries(visiblePlayerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const playerOfInterest = overridePlayer ?? automaticPlayer;
  const relevantGames = useMemo(
    () =>
      modeFilteredGames.filter(
        (game) => game.player1 === playerOfInterest || game.player2 === playerOfInterest,
      ),
    [modeFilteredGames, playerOfInterest],
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
        rankedOnly={rankedOnly}
        onRankedOnlyChange={(nextRankedOnly) => {
          setRankedOnly(nextRankedOnly);
          if (!nextRankedOnly) setRankAffectingOnly(false);
          setOverridePlayer(null);
        }}
        rankAffectingOnly={rankAffectingOnly}
        onRankAffectingOnlyChange={setRankAffectingOnly}
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
            <InputLabel id="player-override-label">Player</InputLabel>
            <Select
              labelId="player-override-label"
              value={playerOfInterest ?? ""}
              label="Player"
              onChange={(event) => onPlayerOverride(event.target.value)}
            >
              {Object.entries(visiblePlayerCounts)
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
        replayFolder={replayFolder}
        active={active}
        recordingsRefreshToken={recordingsRefreshToken}
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
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [recordingsRefreshToken, setRecordingsRefreshToken] = useState(0);
  const [recordingWork, setRecordingWork] = useState<RecordingWorkItem[]>([]);
  const [obsSettingsOpen, setObsSettingsOpen] = useState(false);
  const recordingsTabIndex = 1;
  const captureTabIndex = 2;
  const nerdProcessingTabIndex = 3;
  const techTabIndex = 4;
  const recordingTabAvailable = Boolean(window.electronAPI?.recordings);
  const tabStorageKey = "avatar-app-last-tab-v2";
  const { state: obsState } = useObsRecording();
  const availableTabIndices = [
    0,
    ...(recordingTabAvailable ? [recordingsTabIndex] : []),
    ...(developerTabsAvailable ? [captureTabIndex, nerdProcessingTabIndex, techTabIndex] : []),
  ];
  const [tab, setTab] = useState(() => {
    const storedTab = localStorage.getItem(tabStorageKey);
    const legacyTab = Number(localStorage.getItem("avatar-app-last-tab"));
    const savedTab = Number(storedTab ?? (legacyTab === 2 ? techTabIndex : legacyTab));
    return availableTabIndices.includes(savedTab) ? savedTab : 0;
  });
  const [mountedTabs, setMountedTabs] = useState(() => ({
    replay: tab === 0,
    recordings: recordingTabAvailable && tab === recordingsTabIndex,
    capture: developerTabsAvailable && tab === captureTabIndex,
    nerdProcessing: developerTabsAvailable && tab === nerdProcessingTabIndex,
    tech: tab === techTabIndex,
  }));
  const changeTab = (nextTab: number) => {
    if (!availableTabIndices.includes(nextTab)) return;
    setTab(nextTab);
    setMountedTabs((current) => ({
      replay: current.replay || nextTab === 0,
      recordings: recordingTabAvailable && (current.recordings || nextTab === recordingsTabIndex),
      capture: developerTabsAvailable && (current.capture || nextTab === captureTabIndex),
      nerdProcessing:
        developerTabsAvailable && (current.nerdProcessing || nextTab === nerdProcessingTabIndex),
      tech: current.tech || nextTab === techTabIndex,
    }));
    localStorage.setItem(tabStorageKey, String(nextTab));
  };
  const refreshRecordings = useCallback(() => {
    setRecordingsRefreshToken((current) => current + 1);
  }, []);

  const previousRecordingActive = useRef(false);
  useEffect(() => {
    if (previousRecordingActive.current && !obsState.recording.active) refreshRecordings();
    previousRecordingActive.current = obsState.recording.active;
  }, [obsState.recording.active, refreshRecordings]);

  useEffect(() => window.electronAPI?.recordings.onChanged(refreshRecordings), [refreshRecordings]);
  useEffect(() => {
    const recordings = window.electronAPI?.recordings;
    if (!recordings) return;
    let active = true;
    let receivedEvent = false;
    const unsubscribe = recordings.onWorkState((work) => {
      if (active) {
        receivedEvent = true;
        setRecordingWork(work);
      }
    });
    void recordings
      .getWorkState()
      .then((work) => {
        if (active && !receivedEvent) setRecordingWork(work);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const showRecordings = () => {
      if (recordingTabAvailable) changeTab(recordingsTabIndex);
    };
    const showTech = () => changeTab(techTabIndex);
    window.addEventListener(techSelectRecordingEvent, showRecordings);
    window.addEventListener(techSelectComboEvent, showTech);
    return () => {
      window.removeEventListener(techSelectRecordingEvent, showRecordings);
      window.removeEventListener(techSelectComboEvent, showTech);
    };
  }, [recordingTabAvailable, recordingsTabIndex, techTabIndex]);

  useEffect(() => window.electronAPI?.updates.onStatus(setUpdateStatus), []);
  useEffect(() => {
    void window.electronAPI?.app.getVersion().then(setAppVersion);
  }, []);

  return (
    <>
      <UpdateStatusBanner status={updateStatus} onClose={() => setUpdateStatus(null)} />
      <Stack
        direction={{ xs: "column", lg: "row" }}
        spacing={1.5}
        sx={{ mb: 2, alignItems: { lg: "center" }, justifyContent: "space-between" }}
      >
        <Tabs value={tab} onChange={(_, nextTab: number) => changeTab(nextTab)}>
          <Tab label="Match history" />
          {recordingTabAvailable && <Tab label="Recordings" value={recordingsTabIndex} />}
          {developerTabsAvailable && <Tab label="Dev-only capture" value={captureTabIndex} />}
          {developerTabsAvailable && <Tab label="Nerd processing" value={nerdProcessingTabIndex} />}
          {developerTabsAvailable && <Tab label="Tech" value={techTabIndex} />}
        </Tabs>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: "center" }}>
          <ObsRecordingControls onOpenSettings={() => setObsSettingsOpen(true)} />
          {appVersion && (
            <Typography variant="caption" color="text.secondary">
              v{appVersion}
            </Typography>
          )}
        </Stack>
      </Stack>
      {recordingWork.length > 0 && (
        <Stack
          spacing={1}
          aria-live="polite"
          sx={{
            position: "fixed",
            right: 16,
            bottom: 16,
            width: "min(480px, calc(100vw - 32px))",
            maxHeight: "45vh",
            overflowY: "auto",
            zIndex: (theme) => theme.zIndex.snackbar,
          }}
        >
          {recordingWork.map((work) => (
            <Alert key={work.id} severity="info" icon={false} sx={{ py: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {work.title}: {work.fileName}
              </Typography>
              <Typography variant="caption" component="div">
                {work.detail}
              </Typography>
              <LinearProgress
                variant={work.total ? "determinate" : "indeterminate"}
                value={work.total ? (100 * (work.completed ?? 0)) / work.total : undefined}
                sx={{ mt: 0.75 }}
              />
            </Alert>
          ))}
        </Stack>
      )}
      <Dialog
        open={obsSettingsOpen}
        onClose={() => setObsSettingsOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>OBS settings</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <ObsRecordingPanel />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setObsSettingsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      {mountedTabs.replay && (
        <Box sx={{ display: tab === 0 ? "block" : "none" }}>
          <ReplayAnalysis active={tab === 0} recordingsRefreshToken={recordingsRefreshToken} />
        </Box>
      )}
      {recordingTabAvailable && mountedTabs.recordings && (
        <Box
          sx={{
            display: tab === recordingsTabIndex ? "block" : "none",
            height: "calc(100vh - 96px)",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <RecordingViewer
            active={tab === recordingsTabIndex}
            refreshToken={recordingsRefreshToken}
            mode="recordings"
          />
        </Box>
      )}
      {developerTabsAvailable && mountedTabs.capture && (
        <Box sx={{ display: tab === captureTabIndex ? "block" : "none" }}>
          <MoveCapturePanel />
        </Box>
      )}
      {developerTabsAvailable && mountedTabs.nerdProcessing && (
        <Box
          sx={{
            display: tab === nerdProcessingTabIndex ? "block" : "none",
            height: "calc(100vh - 96px)",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <RecordingViewer
            active={tab === nerdProcessingTabIndex}
            refreshToken={recordingsRefreshToken}
            mode="nerd-processing"
          />
        </Box>
      )}
      {developerTabsAvailable && mountedTabs.tech && (
        <Box sx={{ display: tab === techTabIndex ? "block" : "none" }}>
          <TechSection />
        </Box>
      )}
    </>
  );
}

if (!root) {
  throw new Error("Root element not found");
}

const developerTabsAvailable = import.meta.env.DEV;
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
          overflowY: "auto",
          p: 2,
          backgroundColor: "background.default",
        }}
      >
        <AgGridProvider modules={agGridModules}>
          <ObsRecordingProvider>
            <App />
          </ObsRecordingProvider>
        </AgGridProvider>
      </Box>
    </ThemeProvider>
  </StrictMode>,
);
