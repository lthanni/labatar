import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import NewReleasesIcon from "@mui/icons-material/NewReleases";
import SettingsIcon from "@mui/icons-material/Settings";
import discordSymbol from "./discord-symbol.svg";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Paper,
  Slider,
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
import { CombosPage } from "./CombosPage";
import { ArtworkPanel } from "./ArtworkPanel";
import {
  GuidesDialog,
  allGuideEntryIds,
  type GuideEntryId,
  type GuideSection,
} from "./GuidesDialog";
import type { ObsSettings, ObsSourceToggleKey, ObsState, RecordingMetadata } from "./obs-types";
import type { RecordedVideo, RecordingTags } from "./recording-types";
import type { DevBlackoutStatus } from "./dev-blackout-types";
import type { RecordingAnalysis } from "./recording-analysis-types";
import type { ReplayStagingPreview, ReplayStagingStatus } from "./replay-staging-types";
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
import { techSelectRecordingEvent } from "./tech-types";
import {
  forgetPendingYouTubeUpload,
  pendingYouTubeUploadsChangedEvent,
  pendingYouTubeUploadsFromWork,
  pendingYouTubeUploadUrl,
  readPendingYouTubeUploads,
  savePendingYouTubeUpload,
} from "./youtube-pending-uploads";

type AutomaticMoveRunState = {
  status: "idle" | "countdown" | "running" | "paused" | "completed" | "cancelled" | "error";
  index: number;
  total: number;
  currentMove: string | null;
  phase: string;
  error: string | null;
  runId?: string;
  outcome?: MoveTakeOutcome;
};

declare global {
  interface Window {
    electronAPI?: {
      app: {
        getVersion: () => Promise<string>;
        openDiscord: () => Promise<void>;
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
        setChapterSettings: (request: { hotkey: string }) => Promise<CaptureState>;
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
          pressureFramebarReady: boolean;
          profileCreated: boolean;
        }>;
        setScene: (sceneName: string) => Promise<ObsState>;
        setSourceToggle: (key: ObsSourceToggleKey, enabled: boolean) => Promise<ObsState>;
        startRecording: (request: {
          setup: { profileName: string; recordDirectory: string };
          metadata: RecordingMetadata;
        }) => Promise<{ sessionId: string; startedAt: string; metadata: RecordingMetadata }>;
        startManualRecording: (request: {
          setup: { profileName: string; recordDirectory: string };
          fileNameBase?: string;
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
        importDropped: (files: File[]) => Promise<{ importedCount: number }>;
        chooseImport: () => Promise<{ importedCount: number } | null>;
        importLink: (url: string) => Promise<{ importedCount: number }>;
        getGameFolderStatus: () => Promise<{ folder: string | null; issue: string | null }>;
        selectFolder: () => Promise<string | null>;
        getCachedScan: (folder: string) => Promise<{
          games: ReplayRow[];
          playerCounts: Record<string, number>;
          duplicateCount: number;
          interruptedMatchIds?: string[];
        } | null>;
        scanFolder: (folder: string) => Promise<{
          games: ReplayRow[];
          playerCounts: Record<string, number>;
          duplicateCount: number;
          interruptedMatchIds?: string[];
        }>;
        resolvePortraits: (request: {
          pairs: Array<{ character: string; support: string }>;
        }) => Promise<Array<{ portraitUrl: string | null; supportUrl: string | null }>>;
        showInFolder: (request: { ids: string[] }) => Promise<void>;
        zip: (request: { ids: string[]; suggestedName: string }) => Promise<{
          path: string;
          fileCount: number;
        } | null>;
        stagingStatus: () => Promise<ReplayStagingStatus>;
        stagingPreview: (request: { ids: string[] }) => Promise<ReplayStagingPreview>;
        stage: (request: { ids: string[] }) => Promise<ReplayStagingStatus>;
        restoreStaged: () => Promise<ReplayStagingStatus>;
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
        onFinalized: (
          listener: (result: {
            sessionId: string;
            recordingId: string | null;
            manifestError: string | null;
          }) => void,
        ) => () => void;
        list: (request?: { analysisScope?: "none" | "move-takes" | "all" }) => Promise<{
          folder: string;
          recordings: RecordedVideo[];
        }>;
        importComboMp4: () => Promise<string | null>;
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
        trimClip: (request: {
          recordingId: string;
          startTime: number;
          endTime: number;
          mode: "fast" | "precise";
        }) => Promise<{ recording: RecordedVideo; actualStartTime: number }>;
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
        openYouTubeStudio: (request: { recordingId: string; title?: string }) => Promise<void>;
        getYouTubeUploadStatus: (request: { destination: "sets" | "combos" }) => Promise<{
          configured: boolean;
          connected: boolean;
          uploading: boolean;
        }>;
        connectYouTube: (request: { destination: "sets" | "combos" }) => Promise<{
          configured: boolean;
          connected: boolean;
          uploading: boolean;
        }>;
        disconnectYouTube: (request: { destination: "sets" | "combos" }) => Promise<{
          configured: boolean;
          connected: boolean;
          uploading: boolean;
        }>;
        uploadToYouTube: (request: {
          destination: "sets" | "combos";
          recordingId: string;
          title: string;
          description: string;
          tags: string[];
          privacyStatus: "private" | "unlisted" | "public";
          publishAt?: string;
          madeForKids: boolean;
        }) => Promise<{ videoId: string; url: string }>;
        cancelYouTubeUpload: (request: { recordingId: string }) => Promise<void>;
        dismissYouTubeUploadError: (request: { recordingId: string }) => Promise<void>;
        acknowledgeYouTubeUpload: (request: { recordingId: string; url: string }) => Promise<void>;
        openYouTubeTerms: () => Promise<void>;
        openYouTubeUrl: (request: { url: string }) => Promise<void>;
        getYouTubeReplacementInfo: (request: {
          recordingId: string;
        }) => Promise<{ durationMs: number; hasLocalVideo: boolean }>;
        setYouTubeLink: (request: {
          recordingId: string;
          url: string | null;
          youtubeDurationSeconds?: number;
          keepLocalVideo?: boolean;
        }) => Promise<RecordedVideo>;
        openYouTubeVideo: (request: { recordingId: string }) => Promise<void>;
        setTags: (request: { recordingId: string; tags: RecordingTags }) => Promise<RecordedVideo>;
        saveAnalysis: (request: {
          recordingId: string;
          analysis: RecordingAnalysis;
        }) => Promise<RecordedVideo>;
        saveFramebarSequence: (request: {
          recordingId: string;
          sequence: import("./recording-analysis-types").RecordingFramebarSequence;
        }) => Promise<RecordedVideo>;
        reviewFramebarSequence: (request: {
          recordingId: string;
          sequenceId: string;
          action: "approve" | "reject";
        }) => Promise<RecordedVideo>;
        setMoveEvidence: (request: {
          recordingId: string;
          action: "accept" | "archive";
          reason?: string;
        }) => Promise<RecordedVideo>;
        reviewCapture: (request: {
          recordingId: string;
          action: "approve" | "reject";
        }) => Promise<RecordedVideo | { id: string }>;
        deleteRecording: (request: { recordingId: string }) => Promise<{ id: string }>;
        deletePendingMove: (request: { recordingId: string }) => Promise<{ id: string }>;
        deleteMoveTake: (request: { recordingId: string }) => Promise<{ id: string }>;
        startDrag: (request: { recordingId: string }) => void;
        onDragFinished: (listener: () => void) => () => void;
      };
      catalogPublisher: {
        publishCombo: (
          request: import("./publish-combo-draft").PublishComboDraft,
        ) => Promise<{ cancelled: true } | { cancelled: false; id: string; revision: number }>;
      };
      comboCandidates: {
        status: () => Promise<{ available: boolean }>;
        requestUploadAccess: () => Promise<{ sent: boolean; alreadyRequested: boolean }>;
        submit: (request: {
          recordingId: string;
          combo: import("./combo-candidates").CandidateCombo;
          originCandidateId?: string;
        }) => Promise<{ id: string }>;
        onUploadProgress: (
          listener: (progress: { uploadedBytes: number; totalBytes: number }) => void,
        ) => () => void;
        list: (request?: {
          interactive?: boolean;
        }) => Promise<import("./combo-candidates").ComboCandidate[]>;
        approve: (request: { id: string }) => Promise<import("./combo-candidates").ComboCandidate>;
        reject: (request: {
          id: string;
          reason: string;
        }) => Promise<import("./combo-candidates").ComboCandidate>;
        markUploaded: (request: {
          id: string;
          youtubeUrl: string;
        }) => Promise<import("./combo-candidates").ComboCandidate>;
        removeUploaded: (request: { id: string }) => Promise<{ id: string; deleted: true }>;
        download: (request: { id: string; fileSize: number }) => Promise<string>;
      };
      artwork: {
        getStatus: () => Promise<{ ready: boolean; missing: string[] }>;
        extract: () => Promise<{
          savedPortraits: number;
          flowIconImported: boolean;
          pipsIconImported: boolean;
        }>;
        browseMatches: (request: { filenameContains: string }) => Promise<{
          cancelled: boolean;
          folderPath: string | null;
          decoded: number;
          skipped: number;
        }>;
        cancel: (request: { runId: string }) => Promise<{ cancelled: boolean }>;
        onProgress: (
          listener: (progress: {
            runId: string;
            stage: string;
            message: string;
            current: number | null;
            total: number | null;
          }) => void,
        ) => () => void;
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
        automaticStart: (request: {
          variantId: string;
          moves: Array<{ id: string; input: string }>;
          facing: "Right" | "Left";
          outcome: MoveTakeOutcome;
          chargeHoldMs: number;
        }) => Promise<AutomaticMoveRunState>;
        automaticStatus: () => Promise<AutomaticMoveRunState>;
        automaticPause: () => Promise<AutomaticMoveRunState>;
        automaticResume: () => Promise<AutomaticMoveRunState>;
        automaticCancel: () => Promise<AutomaticMoveRunState>;
        onAutomaticState: (listener: (state: AutomaticMoveRunState) => void) => () => void;
        onState: (listener: (state: MoveCaptureState) => void) => () => void;
      };
      devBlackout: {
        status: () => Promise<DevBlackoutStatus>;
        start: (request: { testedCharacter: string }) => Promise<DevBlackoutStatus>;
        restore: () => Promise<DevBlackoutStatus>;
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
  kind?: "youtube-upload";
  phase?: "queued" | "uploading" | "failed" | "ready";
  recordingId?: string;
  url?: string;
};

type UpdateStatus = {
  state: "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";
  version?: string;
  percent?: number;
};

function MatchHistoryFilters({
  dateFrom,
  dateTo,
  availableDateFrom,
  availableDateTo,
  invalidDateRange,
  onDateFromChange,
  onDateToChange,
  onDateRangeChange,
  rankedOnly,
  onRankedOnlyChange,
  rankAffectingOnly,
  onRankAffectingOnlyChange,
  showMmrInUnrankedGames,
  onShowMmrInUnrankedGamesChange,
}: {
  dateFrom: string;
  dateTo: string;
  availableDateFrom: string;
  availableDateTo: string;
  invalidDateRange: boolean;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onDateRangeChange: (from: string, to: string) => void;
  rankedOnly: boolean;
  onRankedOnlyChange: (value: boolean) => void;
  rankAffectingOnly: boolean;
  onRankAffectingOnlyChange: (value: boolean) => void;
  showMmrInUnrankedGames: boolean;
  onShowMmrInUnrankedGamesChange: (value: boolean) => void;
}) {
  const firstAvailableDay = dateKeyToDayIndex(availableDateFrom);
  const lastAvailableDay = dateKeyToDayIndex(availableDateTo);
  const selectedFromDay = dateKeyToDayIndex(dateFrom);
  const selectedToDay = dateKeyToDayIndex(dateTo);
  const sliderMin = Math.min(
    firstAvailableDay ?? 0,
    selectedFromDay ?? firstAvailableDay ?? 0,
    selectedToDay ?? firstAvailableDay ?? 0,
  );
  const sliderMax = Math.max(
    lastAvailableDay ?? 0,
    selectedFromDay ?? lastAvailableDay ?? 0,
    selectedToDay ?? lastAvailableDay ?? 0,
  );
  const sliderValues: [number, number] = [
    selectedFromDay ?? firstAvailableDay ?? 0,
    selectedToDay ?? lastAvailableDay ?? 0,
  ];
  const [draggedValues, setDraggedValues] = useState<[number, number] | null>(null);
  useEffect(() => setDraggedValues(null), [dateFrom, dateTo, availableDateFrom, availableDateTo]);
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1, width: "fit-content", maxWidth: "100%", textAlign: "left" }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          columnGap: 1.5,
          rowGap: 0.5,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
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
              sx={{ width: 160, flexShrink: 0 }}
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
              sx={{ width: 160, flexShrink: 0 }}
            />
          </Box>
          {firstAvailableDay !== null && lastAvailableDay !== null && (
            <Box sx={{ px: 1.5, pt: 0.5 }}>
              <Slider
                value={draggedValues ?? sliderValues}
                min={sliderMin}
                max={sliderMax}
                step={1}
                disableSwap
                disabled={invalidDateRange || sliderMin === sliderMax}
                getAriaLabel={(index) => (index === 0 ? "Start date" : "End date")}
                valueLabelDisplay="auto"
                valueLabelFormat={dayIndexToDateKey}
                onChange={(_, value) => {
                  if (Array.isArray(value)) setDraggedValues([value[0], value[1]]);
                }}
                onChangeCommitted={(_, value) => {
                  setDraggedValues(null);
                  if (Array.isArray(value)) {
                    onDateRangeChange(dayIndexToDateKey(value[0]), dayIndexToDateKey(value[1]));
                  }
                }}
              />
            </Box>
          )}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <FormControlLabel
            sx={{ m: 0 }}
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
            sx={{ m: 0 }}
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
          <FormControlLabel
            sx={{ m: 0 }}
            control={
              <Checkbox
                size="small"
                checked={showMmrInUnrankedGames}
                onChange={(event) => onShowMmrInUnrankedGamesChange(event.target.checked)}
              />
            }
            label="Show MMR in unranked games"
          />
        </Box>
      </Box>
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

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const showMmrInUnrankedGamesStorageKey = "labatar-show-mmr-in-unranked-games-v1";

function dateKeyToDayIndex(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const timestamp = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== dateKey) {
    return null;
  }
  return timestamp / MILLISECONDS_PER_DAY;
}

function dayIndexToDateKey(dayIndex: number) {
  return new Date(Math.round(dayIndex) * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
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
  gameFolder,
  gameFolderRefreshToken,
  onScanError,
  onReplaysChanged,
  onOpenGuide,
}: {
  active: boolean;
  recordingsRefreshToken: number;
  gameFolder: string | null;
  gameFolderRefreshToken: number;
  onScanError: (message: string | null) => void;
  onReplaysChanged: () => void;
  onOpenGuide: (section: GuideSection) => void;
}) {
  const [games, setGames] = useState<ReplayRow[]>([]);
  const [replayFolder, setReplayFolder] = useState<string | null>(null);
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [interruptedMatchIds, setInterruptedMatchIds] = useState<string[]>([]);
  const [overridePlayer, setOverridePlayer] = useState<string | null>(null);
  const [rankedOnly, setRankedOnly] = useState(false);
  const [rankAffectingOnly, setRankAffectingOnly] = useState(false);
  const [showMmrInUnrankedGames, setShowMmrInUnrankedGames] = useState(
    () => localStorage.getItem(showMmrInUnrankedGamesStorageKey) === "true",
  );
  const [scanLoading, setScanLoading] = useState(false);
  const [focusRefreshToken, setFocusRefreshToken] = useState(0);
  const [scanProgress, setScanProgress] = useState<{
    completed: number;
    total: number;
    phase: "logs" | "scanning";
  }>({ completed: 0, total: 0, phase: "scanning" });
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisSummary>({
    games: 0,
    sessions: 0,
    wins: 0,
    losses: 0,
    opponents: 0,
    winRate: 0,
  });
  useEffect(() => {
    if (!active) return;
    const refreshOnFocus = () => setFocusRefreshToken((current) => current + 1);
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [active]);
  const [isGridPending, startGridTransition] = useTransition();
  const lastLoadedFolder = useRef<string | null>(null);
  const onData = useCallback(
    (
      nextGames: ReplayRow[],
      counts: Record<string, number>,
      folder: string,
      nextInterruptedMatchIds: string[] = [],
    ) => {
      const folderChanged = lastLoadedFolder.current !== folder;
      lastLoadedFolder.current = folder;
      startGridTransition(() => {
        setGames((currentGames) => {
          const previousById = new Map(currentGames.map((game) => [game.id, game]));
          const stableGames = nextGames.map((game) => {
            const previous = previousById.get(game.id);
            return previous && JSON.stringify(previous) === JSON.stringify(game) ? previous : game;
          });
          return stableGames.length === currentGames.length &&
            stableGames.every((game, index) => game === currentGames[index])
            ? currentGames
            : stableGames;
        });
        setReplayFolder(folder);
        setInterruptedMatchIds(nextInterruptedMatchIds);
        setPlayerCounts((currentCounts) => {
          const currentKeys = Object.keys(currentCounts);
          const nextKeys = Object.keys(counts);
          return currentKeys.length === nextKeys.length &&
            nextKeys.every((key) => currentCounts[key] === counts[key])
            ? currentCounts
            : counts;
        });
        if (folderChanged) setOverridePlayer(null);
      });
    },
    [],
  );
  useEffect(() => {
    if (!active) return;
    const replays = window.electronAPI?.replays;
    let current = true;
    if (!replays || !gameFolder) {
      onData([], {}, "");
      setScanLoading(false);
      onScanError(null);
      return;
    }
    const showFullLoadProgress = lastLoadedFolder.current !== gameFolder;
    let scanFinished = false;
    let progressTimer: number | null = null;
    if (showFullLoadProgress) {
      progressTimer = window.setTimeout(() => {
        if (current) setScanLoading(true);
      }, 300);
      setScanProgress({ completed: 0, total: 0, phase: "logs" });
      void replays
        .getCachedScan(gameFolder)
        .then((cached) => {
          if (!current || scanFinished || !cached) return;
          if (progressTimer !== null) window.clearTimeout(progressTimer);
          setScanLoading(false);
          onScanError(null);
          onData(cached.games, cached.playerCounts, gameFolder, cached.interruptedMatchIds);
        })
        .catch(() => undefined);
    }
    const unsubscribe = replays.onScanProgress((nextProgress) => {
      if (current && showFullLoadProgress) setScanProgress(nextProgress);
    });
    void replays
      .scanFolder(gameFolder)
      .then((result) => {
        if (!current) return;
        scanFinished = true;
        if (progressTimer !== null) window.clearTimeout(progressTimer);
        setScanLoading(false);
        onScanError(null);
        onData(result.games, result.playerCounts, gameFolder, result.interruptedMatchIds);
        const scannedCount = result.games.length + result.duplicateCount;
        setScanProgress({ completed: scannedCount, total: scannedCount, phase: "scanning" });
      })
      .catch((error) => {
        if (!current) return;
        scanFinished = true;
        if (progressTimer !== null) window.clearTimeout(progressTimer);
        setScanLoading(false);
        if (showFullLoadProgress && lastLoadedFolder.current !== gameFolder) onData([], {}, "");
        onScanError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      current = false;
      if (progressTimer !== null) window.clearTimeout(progressTimer);
      unsubscribe();
    };
  }, [active, gameFolder, gameFolderRefreshToken, focusRefreshToken, onData, onScanError]);
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

  const onPlayerOverride = (nextPlayer: string | null) => {
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
    <Box
      sx={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 1, mb: 1 }}>
        <Box sx={{ flex: "1 1 650px", minWidth: 0 }}>
          <MatchHistoryFilters
            dateFrom={dateFrom}
            dateTo={dateTo}
            availableDateFrom={replayDateRange.from}
            availableDateTo={replayDateRange.to}
            invalidDateRange={invalidDateRange}
            onDateFromChange={setDateFromOverride}
            onDateToChange={setDateToOverride}
            onDateRangeChange={(from, to) => {
              setDateFromOverride(from);
              setDateToOverride(to);
            }}
            rankedOnly={rankedOnly}
            onRankedOnlyChange={(nextRankedOnly) => {
              setRankedOnly(nextRankedOnly);
              if (!nextRankedOnly) setRankAffectingOnly(false);
              setOverridePlayer(null);
            }}
            rankAffectingOnly={rankAffectingOnly}
            onRankAffectingOnlyChange={setRankAffectingOnly}
            showMmrInUnrankedGames={showMmrInUnrankedGames}
            onShowMmrInUnrankedGamesChange={(value) => {
              localStorage.setItem(showMmrInUnrankedGamesStorageKey, String(value));
              setShowMmrInUnrankedGames(value);
            }}
          />
        </Box>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 1,
            flex: "1 1 430px",
            minWidth: 0,
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
      </Box>
      {scanLoading && (
        <Stack spacing={0.5} sx={{ mt: 1, textAlign: "left" }}>
          <LinearProgress
            variant={scanProgress.total > 0 ? "determinate" : "indeterminate"}
            value={
              scanProgress.total > 0
                ? (scanProgress.completed / scanProgress.total) * 100
                : undefined
            }
          />
          <Typography variant="caption" color="text.secondary">
            {scanProgress.phase === "logs"
              ? scanProgress.total > 0
                ? `Loading rating logs ${scanProgress.completed} of ${scanProgress.total}...`
                : "Finding rating logs..."
              : scanProgress.total > 0
                ? `Loading replay ${scanProgress.completed} of ${scanProgress.total}...`
                : "Finding replay files..."}
          </Typography>
        </Stack>
      )}
      {isPreparingGrid && (
        <Stack spacing={0.5} sx={{ mb: 1, textAlign: "left" }}>
          <LinearProgress />
          <Typography variant="caption" color="text.secondary">
            Preparing replay grid… The current grid remains available while this finishes.
          </Typography>
        </Stack>
      )}
      <AvatarGrid
        rowData={relevantGames}
        interruptedMatchIds={interruptedMatchIds}
        replayFolder={replayFolder}
        active={active}
        recordingsRefreshToken={recordingsRefreshToken}
        showMmrInUnrankedGames={showMmrInUnrankedGames}
        playerOfInterest={playerOfInterest}
        playerCounts={visiblePlayerCounts}
        playerOverride={overridePlayer}
        onPlayerOverrideChange={onPlayerOverride}
        dateFrom={dateFrom}
        dateTo={dateTo}
        invalidDateRange={invalidDateRange}
        onSummaryChange={onSummaryChange}
        onReplaysChanged={onReplaysChanged}
        onOpenGuide={onOpenGuide}
      />
    </Box>
  );
}

function App() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [recordingsRefreshToken, setRecordingsRefreshToken] = useState(0);
  const [recordingWork, setRecordingWork] = useState<RecordingWorkItem[]>([]);
  const [pendingYouTubeUploads, setPendingYouTubeUploads] = useState(readPendingYouTubeUploads);
  const [collapsedYouTubeCards, setCollapsedYouTubeCards] = useState<Set<string>>(() => new Set());
  const [youtubeReviewRequest, setYoutubeReviewRequest] = useState<{
    recordingId: string;
    url: string;
    requestId: number;
  } | null>(null);
  const youtubeReviewRequestId = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guidesOpen, setGuidesOpen] = useState(false);
  const [guideSection, setGuideSection] = useState<GuideSection>("matches");
  const [readGuideEntryIds, setReadGuideEntryIds] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("labatar-guide-read-v1") ?? "[]");
      return new Set(
        Array.isArray(stored)
          ? stored.filter((value): value is string => typeof value === "string")
          : [],
      );
    } catch {
      return new Set();
    }
  });
  const unreadGuideCount = allGuideEntryIds.filter((id) => !readGuideEntryIds.has(id)).length;
  const [settingsSection, setSettingsSection] = useState<"game" | "artwork" | "obs" | null>("obs");
  const [gameFolderStatus, setGameFolderStatus] = useState<{
    folder: string | null;
    issue: string | null;
  } | null>(null);
  const [gameFolderStatusToken, setGameFolderStatusToken] = useState(0);
  const [gameFolderRefreshToken, setGameFolderRefreshToken] = useState(0);
  const [replayScanError, setReplayScanError] = useState<string | null>(null);
  const [replayDropActive, setReplayDropActive] = useState(false);
  const outboundRecordingDragRef = useRef(false);
  const [replayImportBusy, setReplayImportBusy] = useState(false);
  const [replayImportMessage, setReplayImportMessage] = useState<{
    severity: "success" | "error";
    text: string;
  } | null>(null);
  const [folderPopupDismissed, setFolderPopupDismissed] = useState(false);
  const [artworkStatus, setArtworkStatus] = useState<{
    ready: boolean;
    missing: string[];
  } | null>(null);
  const [artworkStatusError, setArtworkStatusError] = useState(false);
  const [artworkPopupDismissed, setArtworkPopupDismissed] = useState(false);
  const [artworkStatusToken, setArtworkStatusToken] = useState(0);
  const recordingsTabIndex = 1;
  const captureTabIndex = 2;
  const nerdProcessingTabIndex = 3;
  const techTabIndex = 4;
  const combosTabIndex = 6;
  const recordingTabAvailable = Boolean(window.electronAPI?.recordings);
  const artworkTabAvailable = Boolean(window.electronAPI?.artwork);
  const tabStorageKey = "avatar-app-last-tab-v2";
  const { state: obsState } = useObsRecording();
  const availableTabIndices = [
    0,
    ...(recordingTabAvailable ? [recordingsTabIndex] : []),
    combosTabIndex,
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
    combos: tab === combosTabIndex,
  }));
  const [blackoutStatus, setBlackoutStatus] = useState<DevBlackoutStatus>({
    available: false,
    gameRunning: false,
    active: false,
    busy: false,
    restorePending: false,
    testedCharacter: null,
    error: null,
  });
  const refreshBlackoutStatus = useCallback(async () => {
    const api = window.electronAPI?.devBlackout;
    if (!api) return;
    try {
      setBlackoutStatus(await api.status());
    } catch (error) {
      setBlackoutStatus({
        available: true,
        gameRunning: false,
        active: false,
        busy: false,
        restorePending: false,
        testedCharacter: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);
  useEffect(() => {
    if (!developerTabsAvailable) return;
    if (tab !== captureTabIndex) return;
    void refreshBlackoutStatus();
    const timer = window.setInterval(() => void refreshBlackoutStatus(), 4000);
    return () => window.clearInterval(timer);
  }, [tab, captureTabIndex, refreshBlackoutStatus]);
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
      combos: current.combos || nextTab === combosTabIndex,
    }));
    localStorage.setItem(tabStorageKey, String(nextTab));
  };
  const finishReplayImport = ({ importedCount }: { importedCount: number }) => {
    setReplayImportMessage({
      severity: "success",
      text: `Imported ${importedCount} replay${importedCount === 1 ? "" : "s"} into Match history.`,
    });
    changeTab(0);
    setGameFolderRefreshToken((current) => current + 1);
  };
  const chooseReplayImport = async () => {
    if (replayImportBusy) return;
    setReplayImportBusy(true);
    setReplayImportMessage(null);
    try {
      const result = await window.electronAPI?.replays.chooseImport();
      if (result) finishReplayImport(result);
    } catch (error) {
      setReplayImportMessage({
        severity: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setReplayImportBusy(false);
    }
  };
  useEffect(() => {
    const importDropped = window.electronAPI?.replays.importDropped;
    const importLink = developerTabsAvailable ? window.electronAPI?.replays.importLink : undefined;
    if (!importDropped) return;
    const hasFiles = (event: DragEvent) => {
      const transfer = event.dataTransfer;
      return Boolean(
        transfer &&
        (Array.from(transfer.types).includes("Files") ||
          Array.from(transfer.items).some((item) => item.kind === "file") ||
          transfer.files.length > 0),
      );
    };
    const hasLink = (event: DragEvent) => {
      if (!importLink) return false;
      const types = Array.from(event.dataTransfer?.types ?? []);
      return types.some((type) => ["text/uri-list", "text/plain", "text/html"].includes(type));
    };
    const isEditable = (target: EventTarget | null) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);
    const droppedLink = (transfer: DataTransfer) => {
      const uriList = transfer
        .getData("text/uri-list")
        .split(/\r?\n/)
        .find((line) => line && !line.startsWith("#"));
      const plain = transfer.getData("text/plain").trim();
      const html = transfer.getData("text/html");
      const htmlLink = html
        ? new DOMParser()
            .parseFromString(html, "text/html")
            .querySelector("a[href]")
            ?.getAttribute("href")
        : null;
      const candidates = [uriList, plain, htmlLink].filter((value): value is string =>
        Boolean(value),
      );
      return (
        candidates.find((value) => value.startsWith("https://cdn.discordapp.com/attachments/")) ??
        candidates[0] ??
        ""
      );
    };
    const beginImport = (request: () => Promise<{ importedCount: number }>) => {
      if (replayImportBusy) return;
      setReplayImportBusy(true);
      setReplayImportMessage(null);
      void Promise.resolve()
        .then(request)
        .then(finishReplayImport)
        .catch((error) => {
          setReplayImportMessage({
            severity: "error",
            text: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => setReplayImportBusy(false));
    };
    let hideDropOverlay: number | null = null;
    const finishOutboundDrag = () => {
      outboundRecordingDragRef.current = false;
    };
    const onDragStart = (event: DragEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[draggable="true"]')) return;
      outboundRecordingDragRef.current = true;
      if (hideDropOverlay !== null) window.clearTimeout(hideDropOverlay);
      setReplayDropActive(false);
    };
    const showDropOverlay = () => {
      setReplayDropActive(true);
      if (hideDropOverlay !== null) window.clearTimeout(hideDropOverlay);
      hideDropOverlay = window.setTimeout(() => setReplayDropActive(false), 800);
    };
    const onDragEnter = (event: DragEvent) => {
      if (outboundRecordingDragRef.current) return;
      if (hasFiles(event) || (hasLink(event) && !isEditable(event.target))) showDropOverlay();
    };
    const onDragOver = (event: DragEvent) => {
      if (outboundRecordingDragRef.current) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
        return;
      }
      if (!hasFiles(event) && !(hasLink(event) && !isEditable(event.target))) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      showDropOverlay();
    };
    const onDrop = (event: DragEvent) => {
      if (outboundRecordingDragRef.current) {
        event.preventDefault();
        event.stopPropagation();
        finishOutboundDrag();
        return;
      }
      if (!hasFiles(event) && !hasLink(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (hideDropOverlay !== null) window.clearTimeout(hideDropOverlay);
      setReplayDropActive(false);
      const transfer = event.dataTransfer;
      if (!transfer) return;
      const link = droppedLink(transfer);
      if (
        link &&
        importLink &&
        (link.startsWith("https://cdn.discordapp.com/attachments/") || transfer.files.length === 0)
      ) {
        beginImport(() => importLink(link));
      } else if (transfer.files.length > 0) {
        const files = [...transfer.files];
        beginImport(() => importDropped(files));
      } else {
        setReplayImportMessage({
          severity: "error",
          text: "No files were available in the drop.",
        });
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (isEditable(event.target) || !importLink) return;
      const link = event.clipboardData?.getData("text/plain").trim() ?? "";
      if (!link.startsWith("https://cdn.discordapp.com/attachments/")) return;
      event.preventDefault();
      beginImport(() => importLink(link));
    };
    const removeDragFinished = window.electronAPI?.recordings?.onDragFinished?.(finishOutboundDrag);
    document.addEventListener("dragstart", onDragStart, true);
    document.addEventListener("dragend", finishOutboundDrag, true);
    document.addEventListener("dragenter", onDragEnter, true);
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("paste", onPaste, true);
    return () => {
      if (hideDropOverlay !== null) window.clearTimeout(hideDropOverlay);
      removeDragFinished?.();
      document.removeEventListener("dragstart", onDragStart, true);
      document.removeEventListener("dragend", finishOutboundDrag, true);
      document.removeEventListener("dragenter", onDragEnter, true);
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("paste", onPaste, true);
    };
  }, [replayImportBusy]);
  const refreshRecordings = useCallback(() => {
    setRecordingsRefreshToken((current) => current + 1);
  }, []);

  useEffect(() => {
    const replays = window.electronAPI?.replays;
    if (!replays) return;
    let active = true;
    void replays
      .getGameFolderStatus()
      .then((status) => {
        if (active) setGameFolderStatus(status);
      })
      .catch((error) => {
        if (active) {
          setGameFolderStatus({
            folder: null,
            issue: `Could not check the game folder: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [gameFolderStatusToken]);

  useEffect(() => {
    const artwork = window.electronAPI?.artwork;
    if (!artwork) return;
    let active = true;
    void artwork
      .getStatus()
      .then((status) => {
        if (active) {
          setArtworkStatus(status);
          setArtworkStatusError(false);
        }
      })
      .catch(() => {
        if (active) {
          setArtworkStatus(null);
          setArtworkStatusError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [artworkStatusToken]);

  useEffect(() => {
    const refresh = () => {
      setGameFolderStatusToken((current) => current + 1);
      setArtworkStatusToken((current) => current + 1);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => setFolderPopupDismissed(false), [gameFolderStatus?.issue, replayScanError]);
  const missingArtworkKey = artworkStatus?.missing.join("|") ?? "";
  useEffect(() => setArtworkPopupDismissed(false), [missingArtworkKey]);

  const openSettings = (section: "game" | "artwork" | "obs") => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };
  const openGuide = (section: GuideSection) => {
    setGuideSection(section);
    setGuidesOpen(true);
  };
  const confirmGuideRead = (id: GuideEntryId) => {
    if (readGuideEntryIds.has(id)) return;
    const next = new Set(readGuideEntryIds);
    next.add(id);
    localStorage.setItem("labatar-guide-read-v1", JSON.stringify([...next]));
    setReadGuideEntryIds(next);
  };

  const chooseGameFolder = async () => {
    try {
      const selected = await window.electronAPI?.replays.selectFolder();
      if (!selected) return;
      setGameFolderStatus({ folder: selected, issue: null });
      setReplayScanError(null);
      setFolderPopupDismissed(false);
      setGameFolderRefreshToken((current) => current + 1);
      setGameFolderStatusToken((current) => current + 1);
    } catch (error) {
      setGameFolderStatus({
        folder: gameFolderStatus?.folder ?? null,
        issue: `Could not choose the game folder: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  const artworkImported = () => {
    setArtworkStatusToken((current) => current + 1);
    setArtworkPopupDismissed(false);
    refreshRecordings();
  };

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
    const refresh = () => setPendingYouTubeUploads(readPendingYouTubeUploads());
    window.addEventListener(pendingYouTubeUploadsChangedEvent, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(pendingYouTubeUploadsChangedEvent, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const readyYouTubeUploads = pendingYouTubeUploadsFromWork(recordingWork);
  useEffect(() => {
    for (const upload of pendingYouTubeUploadsFromWork(recordingWork)) {
      try {
        if (pendingYouTubeUploadUrl(upload.recordingId) !== upload.url) {
          savePendingYouTubeUpload(upload);
        }
        void window.electronAPI?.recordings
          .acknowledgeYouTubeUpload({
            recordingId: upload.recordingId,
            url: upload.url,
          })
          .catch(() => undefined);
      } catch {
        // Keep the completed work card until browser storage can save the link.
      }
    }
  }, [recordingWork]);
  const reviewableYouTubeUploadsById = new Map(
    pendingYouTubeUploads.map((upload) => [upload.recordingId, upload] as const),
  );
  for (const upload of readyYouTubeUploads) {
    reviewableYouTubeUploadsById.set(upload.recordingId, upload);
  }
  const reviewableYouTubeUploads = [...reviewableYouTubeUploadsById.values()];

  const youtubeUploadJobs = recordingWork.flatMap((work) =>
    work.kind === "youtube-upload" &&
    work.recordingId &&
    (work.phase === "queued" || work.phase === "uploading")
      ? [{ recordingId: work.recordingId, phase: work.phase }]
      : [],
  );

  useEffect(() => {
    const showRecordings = () => {
      if (recordingTabAvailable) changeTab(recordingsTabIndex);
    };
    window.addEventListener(techSelectRecordingEvent, showRecordings);
    return () => {
      window.removeEventListener(techSelectRecordingEvent, showRecordings);
    };
  }, [recordingTabAvailable, recordingsTabIndex]);

  useEffect(() => window.electronAPI?.updates.onStatus(setUpdateStatus), []);

  return (
    <Box
      sx={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <UpdateStatusBanner status={updateStatus} onClose={() => setUpdateStatus(null)} />
      {replayDropActive && (
        <Box
          role="status"
          sx={{
            position: "fixed",
            inset: 8,
            zIndex: (theme) => theme.zIndex.modal + 1,
            pointerEvents: "auto",
            display: "grid",
            placeItems: "center",
            border: "3px dashed",
            borderColor: "primary.main",
            borderRadius: 2,
            bgcolor: "rgba(12, 20, 31, 0.9)",
          }}
        >
          <Typography variant="h5">
            {developerTabsAvailable
              ? "Drop replay .dlr files, a ZIP, or a Discord attachment link"
              : "Drop replay .dlr files, a replay folder, or a ZIP"}
          </Typography>
        </Box>
      )}
      {(!settingsOpen || replayImportBusy || replayImportMessage) && (
        <Stack
          spacing={1}
          role="status"
          sx={{
            position: "fixed",
            top: 16,
            right: 16,
            width: "min(440px, calc(100vw - 32px))",
            zIndex: (theme) => theme.zIndex.snackbar,
          }}
        >
          {replayImportBusy && <Alert severity="info">Importing replays…</Alert>}
          {replayImportMessage && (
            <Alert
              severity={replayImportMessage.severity}
              onClose={() => setReplayImportMessage(null)}
            >
              {replayImportMessage.text}
            </Alert>
          )}
          {!settingsOpen &&
            (gameFolderStatus?.issue || replayScanError) &&
            !folderPopupDismissed && (
              <Alert severity="warning" onClose={() => setFolderPopupDismissed(true)}>
                {gameFolderStatus?.issue ?? `Could not scan replays: ${replayScanError}`}
                <Button size="small" color="inherit" onClick={() => openSettings("game")}>
                  Open game folder settings
                </Button>
              </Alert>
            )}
          {!settingsOpen &&
            artworkTabAvailable &&
            artworkStatus !== null &&
            artworkStatus.missing.length > 0 &&
            !artworkPopupDismissed && (
              <Alert severity="info" onClose={() => setArtworkPopupDismissed(true)}>
                {artworkStatus.missing.length} artwork image
                {artworkStatus.missing.length === 1 ? " is" : "s are"} missing. Import artwork to
                display the missing images.
                <Button size="small" color="inherit" onClick={() => openSettings("artwork")}>
                  Open artwork settings
                </Button>
              </Alert>
            )}
        </Stack>
      )}
      <Box
        sx={{
          mb: 2,
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1fr) auto minmax(0, 1fr)" },
          alignItems: "center",
          gap: 1.5,
        }}
      >
        <Tabs
          value={tab}
          onChange={(_, nextTab: number) => changeTab(nextTab)}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{ minWidth: 0, maxWidth: "100%" }}
        >
          <Tab label="Match history" />
          {recordingTabAvailable && <Tab label="Recordings" value={recordingsTabIndex} />}
          <Tab label="Combos" value={combosTabIndex} />
          {developerTabsAvailable && <Tab label="Dev-only capture" value={captureTabIndex} />}
          {developerTabsAvailable && <Tab label="Nerd processing" value={nerdProcessingTabIndex} />}
          {developerTabsAvailable && <Tab label="Tech editor" value={techTabIndex} />}
        </Tabs>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", justifySelf: "center" }}>
          {tab === 0 && window.electronAPI?.replays && (
            <Button
              size="small"
              variant="outlined"
              disabled={replayImportBusy}
              onClick={() => void chooseReplayImport()}
            >
              Import replays
            </Button>
          )}
          <Tooltip title={unreadGuideCount ? `${unreadGuideCount} unread guide entries` : "Guides"}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => openGuide(tab === 0 ? "matches" : "recording")}
              aria-label={
                unreadGuideCount ? `Guides, ${unreadGuideCount} unread entries` : "Guides"
              }
              startIcon={
                unreadGuideCount ? (
                  <NewReleasesIcon
                    fontSize="small"
                    sx={{ color: "#111", bgcolor: "#ffd54f", borderRadius: "50%", p: 0.25 }}
                  />
                ) : undefined
              }
            >
              Guides
            </Button>
          </Tooltip>
          <Tooltip title="Settings">
            <IconButton size="small" aria-label="Settings" onClick={() => openSettings("obs")}>
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", justifySelf: { xs: "center", lg: "end" }, minWidth: 0 }}
        >
          <ObsRecordingControls onOpenSettings={() => openSettings("obs")} />
        </Stack>
      </Box>
      <GuidesDialog
        open={guidesOpen}
        section={guideSection}
        readEntryIds={readGuideEntryIds}
        onSectionChange={setGuideSection}
        onConfirmRead={confirmGuideRead}
        onClose={() => setGuidesOpen(false)}
      />
      {(recordingWork.some((work) => work.phase !== "ready") ||
        reviewableYouTubeUploads.length > 0) && (
        <Stack
          spacing={1}
          aria-live="polite"
          sx={{
            position: "fixed",
            right: 16,
            bottom: 56,
            width: "min(480px, calc(100vw - 32px))",
            maxHeight: "45vh",
            overflowY: "auto",
            zIndex: (theme) => theme.zIndex.modal - 1,
          }}
        >
          {recordingWork
            .filter((work) => work.phase !== "ready")
            .map((work) => (
              <Alert
                key={work.id}
                severity={work.phase === "failed" ? "error" : "info"}
                icon={false}
                sx={{ py: 0.5 }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {work.title}: {work.fileName}
                </Typography>
                <Typography variant="caption" component="div">
                  {work.detail}
                </Typography>
                {work.phase !== "failed" && (
                  <LinearProgress
                    variant={work.total ? "determinate" : "indeterminate"}
                    value={work.total ? (100 * (work.completed ?? 0)) / work.total : undefined}
                    sx={{ mt: 0.75 }}
                  />
                )}
                {work.kind === "youtube-upload" &&
                  (work.phase === "queued" || work.phase === "uploading") &&
                  work.recordingId && (
                    <Button
                      size="small"
                      onClick={() =>
                        void window.electronAPI?.recordings.cancelYouTubeUpload({
                          recordingId: work.recordingId!,
                        })
                      }
                    >
                      Cancel upload
                    </Button>
                  )}
                {work.kind === "youtube-upload" && work.phase === "failed" && work.recordingId && (
                  <Button
                    size="small"
                    onClick={() =>
                      void window.electronAPI?.recordings.dismissYouTubeUploadError({
                        recordingId: work.recordingId!,
                      })
                    }
                  >
                    Dismiss
                  </Button>
                )}
              </Alert>
            ))}
          {reviewableYouTubeUploads.map((upload) => (
            <Alert
              key={`youtube-pending:${upload.recordingId}`}
              severity="success"
              icon={false}
              sx={{ py: 0.5 }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
                  YouTube upload ready: {upload.fileName}
                </Typography>
                <Button
                  size="small"
                  aria-expanded={!collapsedYouTubeCards.has(upload.recordingId)}
                  onClick={() =>
                    setCollapsedYouTubeCards((current) => {
                      const next = new Set(current);
                      if (next.has(upload.recordingId)) next.delete(upload.recordingId);
                      else next.add(upload.recordingId);
                      return next;
                    })
                  }
                >
                  {collapsedYouTubeCards.has(upload.recordingId) ? "Expand" : "Shrink"}
                </Button>
              </Stack>
              <Collapse in={!collapsedYouTubeCards.has(upload.recordingId)}>
                <Typography variant="caption" component="div">
                  Review the uploaded video before replacing the local recording. Scheduled or
                  private videos can be linked while the local file stays available.
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                  <Button
                    size="small"
                    onClick={() => {
                      setYoutubeReviewRequest({
                        recordingId: upload.recordingId,
                        url: upload.url,
                        requestId: ++youtubeReviewRequestId.current,
                      });
                      setMountedTabs((current) => ({ ...current, recordings: true }));
                    }}
                  >
                    Review and link
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      try {
                        forgetPendingYouTubeUpload(upload.recordingId);
                      } catch {
                        // The Electron work card can still be dismissed without browser storage.
                      }
                      void window.electronAPI?.recordings
                        .acknowledgeYouTubeUpload({
                          recordingId: upload.recordingId,
                          url: upload.url,
                        })
                        .catch(() => undefined);
                    }}
                  >
                    Forget
                  </Button>
                </Stack>
              </Collapse>
            </Alert>
          ))}
        </Stack>
      )}
      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        maxWidth="md"
        fullWidth
        keepMounted
      >
        <DialogTitle>Settings</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Accordion
            expanded={settingsSection === "game"}
            onChange={(_, expanded) => setSettingsSection(expanded ? "game" : null)}
          >
            <AccordionSummary expandIcon={<span aria-hidden="true">▾</span>}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography>Game folder</Typography>
                <Typography
                  variant="body2"
                  color={gameFolderStatus?.issue ? "warning.main" : "text.secondary"}
                  noWrap
                  title={gameFolderStatus?.folder ?? undefined}
                >
                  {gameFolderStatus === null
                    ? "Checking game folder…"
                    : (gameFolderStatus.folder ?? "No game folder selected")}
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  Select the game&apos;s installation folder. Labatar finds replay files and
                  data_packages artwork inside it.
                </Typography>
                {gameFolderStatus?.issue && (
                  <Alert severity="warning">{gameFolderStatus.issue}</Alert>
                )}
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" onClick={() => void chooseGameFolder()}>
                    Choose game folder
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={!gameFolderStatus?.folder}
                    onClick={() => setGameFolderRefreshToken((current) => current + 1)}
                  >
                    Rescan replays
                  </Button>
                </Stack>
              </Stack>
            </AccordionDetails>
          </Accordion>
          {artworkTabAvailable && (
            <Accordion
              expanded={settingsSection === "artwork"}
              onChange={(_, expanded) => setSettingsSection(expanded ? "artwork" : null)}
            >
              <AccordionSummary expandIcon={<span aria-hidden="true">▾</span>}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography>Artwork</Typography>
                  <Typography
                    variant="body2"
                    color={
                      artworkStatusError
                        ? "warning.main"
                        : artworkStatus?.missing.length
                          ? "warning.main"
                          : "text.secondary"
                    }
                  >
                    {artworkStatusError
                      ? "Status unavailable"
                      : artworkStatus === null
                        ? "Checking artwork…"
                        : artworkStatus.missing.length === 0
                          ? "All known artwork available"
                          : `${artworkStatus.missing.length} artwork image${artworkStatus.missing.length === 1 ? "" : "s"} missing`}
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <ArtworkPanel onImported={artworkImported} />
              </AccordionDetails>
            </Accordion>
          )}
          <Accordion
            expanded={settingsSection === "obs"}
            onChange={(_, expanded) => setSettingsSection(expanded ? "obs" : null)}
          >
            <AccordionSummary expandIcon={<span aria-hidden="true">▾</span>}>
              <Typography>OBS</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <ObsRecordingPanel onOpenGuide={() => openGuide("recording")} />
            </AccordionDetails>
          </Accordion>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      {mountedTabs.replay && (
        <Box
          sx={{
            display: tab === 0 ? "flex" : "none",
            flex: "1 1 auto",
            minHeight: 0,
            flexDirection: "column",
          }}
        >
          <ReplayAnalysis
            active={tab === 0}
            recordingsRefreshToken={recordingsRefreshToken}
            gameFolder={gameFolderStatus?.folder ?? null}
            gameFolderRefreshToken={gameFolderRefreshToken}
            onScanError={setReplayScanError}
            onReplaysChanged={() => {
              setGameFolderRefreshToken((current) => current + 1);
              refreshRecordings();
            }}
            onOpenGuide={openGuide}
          />
        </Box>
      )}
      {recordingTabAvailable && mountedTabs.recordings && (
        <Box
          sx={{
            display: tab === recordingsTabIndex ? "block" : "none",
            flex: "1 1 auto",
            minHeight: 0,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <RecordingViewer
            active={tab === recordingsTabIndex}
            refreshToken={recordingsRefreshToken}
            mode="recordings"
            youtubeReviewRequest={youtubeReviewRequest}
            youtubeUploadJobs={youtubeUploadJobs}
          />
        </Box>
      )}
      {developerTabsAvailable && mountedTabs.capture && (
        <Box sx={{ display: tab === captureTabIndex ? "block" : "none" }}>
          <MoveCapturePanel
            active={tab === captureTabIndex}
            blackoutStatus={blackoutStatus}
            refreshBlackoutStatus={refreshBlackoutStatus}
          />
        </Box>
      )}
      {developerTabsAvailable && mountedTabs.nerdProcessing && (
        <Box
          sx={{
            display: tab === nerdProcessingTabIndex ? "block" : "none",
            flex: "1 1 auto",
            minHeight: 0,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <RecordingViewer
            active={tab === nerdProcessingTabIndex}
            refreshToken={recordingsRefreshToken}
            mode="nerd-processing"
            youtubeUploadJobs={youtubeUploadJobs}
          />
        </Box>
      )}
      {mountedTabs.combos && (
        <Box sx={{ display: tab === combosTabIndex ? "block" : "none" }}>
          <CombosPage active={tab === combosTabIndex} />
        </Box>
      )}
      {developerTabsAvailable && mountedTabs.tech && (
        <Box sx={{ display: tab === techTabIndex ? "block" : "none" }}>
          <TechSection />
        </Box>
      )}
    </Box>
  );
}

function AppFooter() {
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.electronAPI?.app
      .getVersion()
      .then((version) => {
        if (active) setAppVersion(version);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <Box
      component="footer"
      sx={{
        minHeight: 40,
        flexShrink: 0,
        px: 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {appVersion ? `v${appVersion}` : ""}
      </Typography>
      <Tooltip title="Join Discord server">
        <IconButton
          size="small"
          aria-label="Join Discord server"
          onClick={() => void window.electronAPI?.app.openDiscord()}
          sx={{
            width: 30,
            height: 30,
            bgcolor: "#5865F2",
            "&:hover": { bgcolor: "#4752C4" },
          }}
        >
          <Box component="img" src={discordSymbol} alt="" sx={{ width: 20, height: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
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
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          backgroundColor: "background.default",
        }}
      >
        <Box sx={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", p: 2 }}>
          <AgGridProvider modules={agGridModules}>
            <ObsRecordingProvider>
              <App />
            </ObsRecordingProvider>
          </AgGridProvider>
        </Box>
        <AppFooter />
      </Box>
    </ThemeProvider>
  </StrictMode>,
);
