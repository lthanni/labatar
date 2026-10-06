import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Slider,
  Stack,
  SvgIcon,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { RecordedVideo, RecordingTagCategory, RecordingTags } from "./recording-types";
import { timelineChapterMarkers, type RecordingChapter } from "./recording-chapters";
import type {
  RecordingAnalysisDiagnosticFrame,
  RecordingAnalysisHitbox,
  RecordingAnalysisState,
  RecordingAnalysisStateOverride,
} from "./recording-analysis-types";
import { applyManualInputStateOverrides, stateOverrideForEvent } from "./recording-analysis-state";
import {
  processRecording,
  type RecordingFrameProvider,
  type RecordingProcessorProgress,
} from "./recording-processor";
import type { DetectorConfig } from "./detector-config";
import {
  effectiveDetectorConfig,
  importProcessingConfiguration,
  loadProcessingConfiguration,
  reloadProcessingConfiguration,
  updateProcessingConfiguration,
  recordingProcessorFingerprint,
} from "./processing-config";
import type { ProcessingConfigurationResult } from "./processing-config-types";
import {
  techCatalogStorageKey,
  techCatalogUpdatedEvent,
  techSelectComboEvent,
  techSelectRecordingEvent,
  techSelectedComboStorageKey,
  techSelectedRecordingStorageKey,
} from "./tech-types";
import type { TechCatalog, TechCombo, TechMove } from "./tech-types";
import {
  isDirectionalButtonFollowup,
  moveNotationsMatch,
  normalizeMoveNotation,
  stanceFollowupMatches,
} from "./move-notation";
import { inputButtonDisplayColors, inputButtonSlotRatios } from "./input-display-config";
import {
  buildRecordingDisplayRows,
  collapseRecordingDisplayRows,
  descendantClipRanges,
} from "./recording-hierarchy";
import { useObsRecording } from "./ObsRecordingContext";
import { CalibrationNumberField } from "./CalibrationNumberField";

function readTechCatalog(): TechCatalog {
  try {
    const stored = JSON.parse(localStorage.getItem(techCatalogStorageKey) ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).map(([character, data]) => [
        character,
        {
          ...(data as TechCatalog[string]),
          moves: ((data as TechCatalog[string]).moves ?? []).map((move) => {
            const legacy = move as TechMove & {
              isRekka?: boolean;
              rekkaFollowupPattern?: "directional-button";
            };
            return {
              ...move,
              isStanceParent: move.isStanceParent === true || legacy.isRekka === true,
              stanceFollowupPattern:
                move.stanceFollowupPattern ?? legacy.rekkaFollowupPattern ?? null,
            };
          }),
        },
      ]),
    );
  } catch {
    return {};
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModifiedAt(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function formatVideoTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00";
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function hitboxOverlayColor(kind: string | undefined) {
  if (kind?.includes("green")) return "#35e58b";
  if (kind?.includes("blue")) return "#42a5ff";
  if (kind?.includes("red")) return "#ff5c6c";
  if (kind?.includes("yellow")) return "#ffe066";
  return "#ffffff";
}

function formatParsedInputRoute(
  inputEvents: NonNullable<RecordedVideo["analysis"]>["inputEvents"],
  catalog: TechCatalog,
) {
  if (!inputEvents || inputEvents.length === 0) return [];
  const moves: TechMove[] = Object.values(catalog).flatMap((data) => data.moves ?? []);
  const route: string[] = [];
  let activeStanceParent: TechMove | null = null;

  for (const event of inputEvents) {
    const matchingMoves = moves.filter((move) => moveNotationsMatch(move.input, event.notation));
    const stanceParent = matchingMoves.find((move) => move.isStanceParent);
    if (stanceParent) {
      route.push(normalizeMoveNotation(stanceParent.input) ?? event.notation);
      activeStanceParent = stanceParent;
      continue;
    }
    const followupMove = moves.find(
      (move) =>
        move.dependsOnMoveId === activeStanceParent?.id &&
        (moveNotationsMatch(move.input, event.notation) ||
          stanceFollowupMatches(move.input, event.notation)),
    );
    if (
      activeStanceParent &&
      (followupMove ||
        (activeStanceParent.stanceFollowupPattern === "directional-button" &&
          isDirectionalButtonFollowup(event.notation)))
    ) {
      const notation =
        normalizeMoveNotation(followupMove?.input ?? event.notation, {
          allowDirectionless: Boolean(followupMove),
        }) ?? event.notation;
      route[route.length - 1] = `${route.at(-1) ?? ""}~${notation}`;
      continue;
    }
    route.push(event.notation);
    activeStanceParent = null;
  }
  return route;
}

const FRAME_RATE = 60;
const FRAME_STEP_QUEUE_LIMIT = 60;
const PLAYBACK_POSITIONS_STORAGE_KEY = "labatar-recording-playback-positions";
const MINIMUM_SAVED_POSITION_SECONDS = 5;
const emptyRecordingTags: RecordingTags = { match: [], lab: [], combo: false, pressure: false };

type FrameStepTrigger = {
  key: string;
  repeat: boolean;
};

type ExactReviewFrame = {
  frameIndex: number;
  data: string;
};

function frameIndexForTime(time: number) {
  return Math.max(0, Math.round(time * FRAME_RATE));
}

function lastFrameIndexForDuration(duration: number) {
  return Math.max(0, Math.floor(Math.max(0, duration) * FRAME_RATE) - 1);
}

const calibrationGroups: Array<{
  title: string;
  fields: Array<{ key: keyof DetectorConfig; label: string; step?: number }>;
}> = [
  {
    title: "Input capture and segments",
    fields: [
      { key: "inputSourceX", label: "Input X" },
      { key: "inputSourceY", label: "Input Y" },
      { key: "inputSourceWidth", label: "Input width" },
      { key: "inputSourceHeight", label: "Input height" },
      { key: "inputSegmentCount", label: "Segments", step: 1 },
      { key: "inputSegmentTop", label: "Segment top %" },
      { key: "inputSegmentHeight", label: "Segment height %" },
    ],
  },
  {
    title: "Input control positions",
    fields: [
      { key: "inputJoystickCenterX", label: "Joystick X %" },
      { key: "inputJoystickRegionEndX", label: "Joystick end %" },
      { key: "inputButtonStartX", label: "Button start X %" },
      { key: "inputButtonStartY", label: "Button start Y %" },
      { key: "inputButtonSpacingX", label: "Button spacing X %" },
      { key: "inputButtonSecondaryOffsetX", label: "Secondary offset X %" },
      { key: "inputButtonSecondaryOffsetY", label: "Secondary offset Y %" },
      { key: "inputButtonRegionRadius", label: "Button radius %" },
    ],
  },
  {
    title: "Input number reading",
    fields: [
      { key: "inputNumberStartX", label: "Number start X %" },
      { key: "inputNumberEndX", label: "Number end X %" },
      { key: "inputNumberTop", label: "Number top %" },
      { key: "inputNumberHeight", label: "Number height %" },
      { key: "inputNumberDigit1X", label: "Digit 1 X %" },
      { key: "inputNumberDigitWidth", label: "Digit width %" },
      { key: "inputNumberDigitGap", label: "Digit gap %" },
      { key: "inputNumberDigitTop", label: "Digit top %" },
      { key: "inputNumberDigitHeight", label: "Digit height %" },
    ],
  },
  {
    title: "Framebar regions and scanlines",
    fields: [
      { key: "player1SourceX", label: "P1 X" },
      { key: "player1SourceY", label: "P1 Y" },
      { key: "sourceX", label: "P2 X" },
      { key: "sourceY", label: "P2 Y" },
      { key: "framebarSourceWidth", label: "Framebar width" },
      { key: "framebarSourceHeight", label: "Framebar height" },
      { key: "sampleStartOffset", label: "Sample X offset", step: 1 },
      { key: "sampleSpacing", label: "Sample X spacing", step: 1 },
      { key: "baseSampleOffset", label: "Base scanline Y", step: 1 },
      { key: "yellowSampleOffset", label: "Yellow scanline Y", step: 1 },
      { key: "sampleCount", label: "Sample count", step: 1 },
    ],
  },
];
const recordingTagCategories: Array<{
  key: RecordingTagCategory;
  label: string;
  subtags?: string[];
  exclusive?: boolean;
}> = [
  { key: "match", label: "Match", subtags: ["ranked", "casual"], exclusive: true },
  { key: "lab", label: "Lab", subtags: ["practice", "new combos", "new pressure"] },
  { key: "combo", label: "Combo" },
  { key: "pressure", label: "Pressure" },
];

function recordingSubtagValue(subtag: string) {
  return subtag.replaceAll(" ", "-");
}

function SceneMarkerIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24">
      <path d="M4 4h16a2 2 0 0 1 2 2v2H2V6a2 2 0 0 1 2-2Zm-2 6h20v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8Zm4-6 2 4h3L9 4H6Zm6 0 2 4h3l-2-4h-3ZM5 13v4h2v-4H5Zm4 0v4h2v-4H9Zm4 0v4h2v-4h-2Zm4 0v4h2v-4h-2Z" />
    </SvgIcon>
  );
}

function CheckIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24">
      <path d="m9 16.17-3.88-3.88L3.7 13.71 9 19l12-12-1.41-1.41L9 16.17Z" />
    </SvgIcon>
  );
}

function CloseIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24">
      <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.41 4.3 19.71 2.89 18.3 9.17 12 2.89 5.7 4.3 4.29l6.29 6.3 6.3-6.3 1.41 1.42Z" />
    </SvgIcon>
  );
}

function RefreshIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24">
      <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z" />
    </SvgIcon>
  );
}

const currentPositionMarkerSx = {
  "& .MuiSlider-mark": {
    width: 3,
    height: 18,
    borderRadius: 1,
    backgroundColor: "#ffffff",
    top: "50%",
    transform: "translate(-1px, -50%)",
  },
  "& .MuiSlider-markActive": {
    backgroundColor: "#ffffff",
  },
};

function debugFramebarColor(state: string | undefined) {
  if (state === "idle") return "#00ccff";
  if (state === "hitpause") return "#ff66ff";
  if (state === "active") return "#ff0066";
  return "#ffffff";
}

function debugRegionsFromConfig(config: DetectorConfig, width: number, height: number) {
  const framebarWidth = Math.max(1, (width * config.framebarSourceWidth) / 100);
  const framebarHeight = Math.max(1, (height * config.framebarSourceHeight) / 100);
  return {
    input: {
      x: config.inputSourceX,
      y: config.inputSourceY,
      width: config.inputSourceWidth,
      height: config.inputSourceHeight,
    },
    inputSegments: {
      count: config.inputSegmentCount,
      top: config.inputSegmentTop,
      height: config.inputSegmentHeight,
      joystickRegionEnd: config.inputJoystickRegionEndX,
    },
    player1Framebar: {
      x: config.player1SourceX,
      y: config.player1SourceY,
      width: config.framebarSourceWidth,
      height: config.framebarSourceHeight,
    },
    player2Framebar: {
      x: config.sourceX,
      y: config.sourceY,
      width: config.framebarSourceWidth,
      height: config.framebarSourceHeight,
    },
    framebarSamples: {
      count: config.sampleCount,
      start: (config.sampleStartOffset / framebarWidth) * 100,
      spacing: (config.sampleSpacing / framebarWidth) * 100,
      baseY: (config.baseSampleOffset / framebarHeight) * 100,
      yellowY: (config.yellowSampleOffset / framebarHeight) * 100,
    },
  };
}

export function RecordingViewer({
  active = true,
  refreshToken = 0,
  mode = "recordings",
}: {
  active?: boolean;
  refreshToken?: number;
  mode?: "recordings" | "nerd-processing";
}) {
  const {
    state: obsState,
    extractionCaptureActive,
    startManualRecording,
    stopManualRecording,
  } = useObsRecording();
  const [folder, setFolder] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<RecordedVideo[]>([]);
  const [techCatalog, setTechCatalog] = useState<TechCatalog>(readTechCatalog);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [chapters, setChapters] = useState<RecordingChapter[]>([]);
  const [chapterLoadError, setChapterLoadError] = useState<string | null>(null);
  const [chapterRefreshToken, setChapterRefreshToken] = useState(0);
  const [reviewFrame, setReviewFrame] = useState<ExactReviewFrame | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [clipRange, setClipRange] = useState<[number, number]>([0, 0]);
  const [clipMode, setClipMode] = useState(false);
  const [exportingClip, setExportingClip] = useState(false);
  const [clipExportNotice, setClipExportNotice] = useState<string | null>(null);
  const [clipExportError, setClipExportError] = useState<string | null>(null);
  const [showFullRecordings, setShowFullRecordings] = useState(true);
  const [showClips, setShowClips] = useState(true);
  const [collapsedRecordingIds, setCollapsedRecordingIds] = useState<Set<string>>(() => new Set());
  const [selectedTagFilters, setSelectedTagFilters] = useState<RecordingTags>(emptyRecordingTags);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [editingRecordingId, setEditingRecordingId] = useState<string | null>(null);
  const [editingRecordingName, setEditingRecordingName] = useState("");
  const [renamingRecordingId, setRenamingRecordingId] = useState<string | null>(null);
  const [reprocessingNameId, setReprocessingNameId] = useState<string | null>(null);
  const [gameChaptersId, setGameChaptersId] = useState<string | null>(null);
  const [gameChaptersNotice, setGameChaptersNotice] = useState<string | null>(null);
  const [gameChaptersError, setGameChaptersError] = useState<string | null>(null);
  const [f10ClipsId, setF10ClipsId] = useState<string | null>(null);
  const [f10ClipsNotice, setF10ClipsNotice] = useState<string | null>(null);
  const [f10ClipsError, setF10ClipsError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    recording: RecordedVideo;
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecordedVideo | null>(null);
  const [deletingRecordingId, setDeletingRecordingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [updatingTagsId, setUpdatingTagsId] = useState<string | null>(null);
  const [processingRecordingId, setProcessingRecordingId] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<RecordingProcessorProgress | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [showAnalysisDebug, setShowAnalysisDebug] = useState(false);
  const [showHitboxOverlay, setShowHitboxOverlay] = useState(true);
  const [debugFrameIndex, setDebugFrameIndex] = useState(0);
  const [videoContentBox, setVideoContentBox] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const focusPlayerAfterSelection = useRef(false);
  const steppingFrame = useRef(false);
  const currentFrameIndex = useRef<number | null>(null);
  const queuedFrameSteps = useRef<Array<1 | -1>>([]);
  const scrubbing = useRef(false);
  const restoredRecordingId = useRef<string | null>(null);
  const playbackPositions = useRef<Record<string, number>>({});
  const frameReaderSession = useRef<string | null>(null);
  const frameReaderRecordingId = useRef<string | null>(null);
  const reviewRequestId = useRef(0);
  const loadGeneration = useRef(0);
  const extractionRecording = extractionCaptureActive && obsState.recording.active;

  useEffect(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem(PLAYBACK_POSITIONS_STORAGE_KEY) ?? "{}",
      ) as unknown;
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        playbackPositions.current = Object.fromEntries(
          Object.entries(stored).filter(
            ([, value]) => typeof value === "number" && Number.isFinite(value) && value > 0,
          ),
        );
      }
    } catch {
      playbackPositions.current = {};
    }
  }, []);

  const positionKey = useCallback(
    (recordingId: string) => `${folder ?? "default"}::${recordingId}`,
    [folder],
  );

  const savePlaybackPosition = useCallback(
    (recordingId: string, time: number) => {
      const key = positionKey(recordingId);
      if (time > MINIMUM_SAVED_POSITION_SECONDS && Number.isFinite(time)) {
        playbackPositions.current[key] = time;
      } else {
        delete playbackPositions.current[key];
      }
      try {
        localStorage.setItem(
          PLAYBACK_POSITIONS_STORAGE_KEY,
          JSON.stringify(playbackPositions.current),
        );
      } catch {
        // Playback should continue normally if local storage is unavailable.
      }
    },
    [positionKey],
  );

  const loadRecordings = useCallback(async () => {
    if (!window.electronAPI?.recordings) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.recordings.list({
        analysisScope: mode === "nerd-processing" ? "all" : "none",
      });
      if (generation !== loadGeneration.current) return;
      const tabRecordings =
        mode === "recordings"
          ? result.recordings.filter(
              (recording) => !recording.moveTake && !recording.id.startsWith("moves/"),
            )
          : result.recordings;
      setFolder(result.folder);
      setRecordings(tabRecordings);
      setSelectedId((current) =>
        tabRecordings.some((recording) => recording.id === current)
          ? current
          : (tabRecordings[0]?.id ?? null),
      );
    } catch (loadError) {
      if (generation === loadGeneration.current) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    if (active) void loadRecordings();
    return () => {
      loadGeneration.current += 1;
    };
  }, [active, loadRecordings, refreshToken]);

  const selectedRecording = useMemo(
    () => recordings.find((recording) => recording.id === selectedId) ?? null,
    [recordings, selectedId],
  );

  useEffect(() => {
    let cancelled = false;
    setChapters([]);
    setChapterLoadError(null);
    if (
      !active ||
      !selectedRecording?.name.toLowerCase().endsWith(".mp4") ||
      !window.electronAPI?.recordings
    ) {
      return () => {
        cancelled = true;
      };
    }
    void window.electronAPI.recordings.getChapters({ recordingId: selectedRecording.id }).then(
      (nextChapters) => {
        if (!cancelled) setChapters(nextChapters);
      },
      (loadError) => {
        if (!cancelled)
          setChapterLoadError(loadError instanceof Error ? loadError.message : String(loadError));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, selectedRecording?.id, selectedRecording?.modifiedAt, chapterRefreshToken]);

  const timelineChapters = useMemo(
    () => timelineChapterMarkers(chapters, duration),
    [chapters, duration],
  );

  const closeFrameReader = useCallback(async () => {
    const sessionId = frameReaderSession.current;
    frameReaderSession.current = null;
    frameReaderRecordingId.current = null;
    if (!sessionId || !window.electronAPI?.recordings) return;
    try {
      await window.electronAPI.recordings.closeFrameReader({ sessionId });
    } catch {
      // Closing a reader is best-effort during recording changes and unmounts.
    }
  }, []);

  const loadExactReviewFrame = useCallback(
    async (frameIndex: number) => {
      if (!selectedRecording || !window.electronAPI?.recordings) {
        throw new Error("Exact frame review is only available in the desktop app.");
      }
      const requestId = ++reviewRequestId.current;
      const openReader = async () => {
        const reader = await window.electronAPI!.recordings.openFrameReader({
          recordingId: selectedRecording.id,
        });
        if (requestId !== reviewRequestId.current) {
          await window
            .electronAPI!.recordings.closeFrameReader({ sessionId: reader.sessionId })
            .catch(() => undefined);
          throw new Error("Frame review was cancelled.");
        }
        frameReaderSession.current = reader.sessionId;
        frameReaderRecordingId.current = selectedRecording.id;
        return reader.sessionId;
      };
      const readFromReader = async (sessionId: string) =>
        window.electronAPI!.recordings.readFrame({ sessionId, frameIndex });

      let sessionId = frameReaderSession.current;
      if (frameReaderRecordingId.current !== selectedRecording.id) {
        await closeFrameReader();
        sessionId = null;
      }
      if (!sessionId) sessionId = await openReader();

      let decodedFrame;
      try {
        decodedFrame = await readFromReader(sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("outside the review cache")) throw error;
        await closeFrameReader();
        sessionId = await openReader();
        decodedFrame = await readFromReader(sessionId);
      }
      if (requestId !== reviewRequestId.current || sessionId !== frameReaderSession.current) {
        return;
      }

      const nextTime = frameIndex / FRAME_RATE;
      const video = videoRef.current;
      video?.pause();
      if (video && Math.abs(video.currentTime - nextTime) > 0.0001) {
        video.currentTime = nextTime;
      }
      currentFrameIndex.current = decodedFrame.frameIndex;
      setCurrentTime(nextTime);
      setPlaybackError(null);
      setReviewFrame({ frameIndex: decodedFrame.frameIndex, data: decodedFrame.data });
    },
    [closeFrameReader, selectedRecording],
  );

  useEffect(() => {
    reviewRequestId.current += 1;
    setReviewFrame(null);
    void closeFrameReader();
    return () => {
      reviewRequestId.current += 1;
      void closeFrameReader();
    };
  }, [closeFrameReader, selectedRecording?.id]);

  useEffect(() => {
    if (active) return;
    reviewRequestId.current += 1;
    const video = videoRef.current;
    if (video && selectedRecording) {
      savePlaybackPosition(selectedRecording.id, video.currentTime);
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    void closeFrameReader();
    setRecordings((current) => (current.length ? [] : current));
    setChapters((current) => (current.length ? [] : current));
    setReviewFrame(null);
    setLoading(false);
    setIsPlaying(false);
    restoredRecordingId.current = null;
  }, [active, closeFrameReader, savePlaybackPosition, selectedRecording]);

  useEffect(() => {
    setShowAnalysisDebug(false);
    setDebugFrameIndex(0);
  }, [selectedRecording?.id]);

  const visibleRecordings = useMemo(
    () =>
      recordings.filter(
        (recording) =>
          (showFullRecordings && !recording.clip) || (showClips && Boolean(recording.clip)),
      ),
    [recordings, showClips, showFullRecordings],
  );

  const tagFilteredRecordings = useMemo(
    () =>
      visibleRecordings.filter((recording) => {
        const activeCategories = recordingTagCategories.filter((category) => {
          const selected = selectedTagFilters[category.key];
          return Array.isArray(selected) ? selected.length > 0 : selected;
        });
        if (activeCategories.length === 0) return true;
        return activeCategories.some((category) => {
          const selected = selectedTagFilters[category.key];
          if (!Array.isArray(selected)) return recording.tags?.[category.key] === true;
          const tags = recording.tags?.[category.key];
          const selectedSubtags = selected as string[];
          const recordedSubtags = Array.isArray(tags) ? (tags as string[]) : [];
          return selectedSubtags.some((subtag) => recordedSubtags.includes(subtag));
        });
      }),
    [selectedTagFilters, visibleRecordings],
  );

  const groupedRecordingRows = useMemo(
    () => buildRecordingDisplayRows(tagFilteredRecordings, showFullRecordings, showClips),
    [showClips, showFullRecordings, tagFilteredRecordings],
  );
  const expandableRecordingIds = useMemo(() => {
    const ids = new Set<string>();
    for (let index = 0; index < groupedRecordingRows.length - 1; index += 1) {
      if (groupedRecordingRows[index + 1].depth > groupedRecordingRows[index].depth) {
        ids.add(groupedRecordingRows[index].recording.id);
      }
    }
    return ids;
  }, [groupedRecordingRows]);
  const displayedRecordings = useMemo(
    () => collapseRecordingDisplayRows(groupedRecordingRows, collapsedRecordingIds),
    [groupedRecordingRows, collapsedRecordingIds],
  );

  const toggleRecordingExpanded = useCallback((recordingId: string) => {
    setCollapsedRecordingIds((current) => {
      const next = new Set(current);
      if (next.has(recordingId)) next.delete(recordingId);
      else next.add(recordingId);
      return next;
    });
  }, []);

  const selectRecording = useCallback(
    (recordingId: string) => {
      // A clip can also be opened from its source's detail pane. Reveal its row if needed.
      const byId = new Map(recordings.map((recording) => [recording.id, recording]));
      setCollapsedRecordingIds((current) => {
        const next = new Set(current);
        const seen = new Set<string>([recordingId]);
        let parentId = byId.get(recordingId)?.clip?.sourceRecordingId;
        while (parentId && !seen.has(parentId)) {
          next.delete(parentId);
          seen.add(parentId);
          parentId = byId.get(parentId)?.clip?.sourceRecordingId;
        }
        return next.size === current.size ? current : next;
      });
      if (selectedRecording && videoRef.current) {
        savePlaybackPosition(selectedRecording.id, videoRef.current.currentTime);
      }
      setPlaybackError(null);
      setClipExportNotice(null);
      setClipExportError(null);
      setRenameError(null);
      setIsPlaying(false);
      setCurrentTime(0);
      setReviewFrame(null);
      currentFrameIndex.current = 0;
      setDuration(0);
      setClipRange([0, 0]);
      setClipMode(false);
      restoredRecordingId.current = null;
      focusPlayerAfterSelection.current = true;
      setSelectedId(recordingId);
    },
    [recordings, savePlaybackPosition, selectedRecording],
  );

  useEffect(() => {
    const syncTechCatalog = () => setTechCatalog(readTechCatalog());
    const handleTechRecordingSelection = (event: Event) => {
      const recordingId = (event as CustomEvent<string>).detail;
      if (typeof recordingId !== "string") return;
      if (recordings.some((recording) => recording.id === recordingId)) {
        setShowFullRecordings(true);
        setSelectedTagFilters(emptyRecordingTags);
        selectRecording(recordingId);
        localStorage.removeItem(techSelectedRecordingStorageKey);
      } else {
        localStorage.setItem(techSelectedRecordingStorageKey, recordingId);
      }
    };
    window.addEventListener(techCatalogUpdatedEvent, syncTechCatalog);
    window.addEventListener("storage", syncTechCatalog);
    window.addEventListener(techSelectRecordingEvent, handleTechRecordingSelection);
    return () => {
      window.removeEventListener(techCatalogUpdatedEvent, syncTechCatalog);
      window.removeEventListener("storage", syncTechCatalog);
      window.removeEventListener(techSelectRecordingEvent, handleTechRecordingSelection);
    };
  }, [recordings, selectRecording]);

  useEffect(() => {
    const pendingRecordingId = localStorage.getItem(techSelectedRecordingStorageKey);
    if (
      !pendingRecordingId ||
      !recordings.some((recording) => recording.id === pendingRecordingId)
    ) {
      return;
    }
    setShowFullRecordings(true);
    setSelectedTagFilters(emptyRecordingTags);
    selectRecording(pendingRecordingId);
    localStorage.removeItem(techSelectedRecordingStorageKey);
  }, [recordings, selectRecording]);

  useEffect(() => {
    if (!focusPlayerAfterSelection.current || !selectedId) return;
    const focusFrame = requestAnimationFrame(() => {
      if (!videoRef.current) return;
      videoRef.current.focus({ preventScroll: true });
      focusPlayerAfterSelection.current = false;
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [selectedId]);

  useEffect(() => {
    if (!active || loading || recordings.length === 0) return;
    if (selectedId && visibleRecordings.some((recording) => recording.id === selectedId)) return;
    if (visibleRecordings[0]) selectRecording(visibleRecordings[0].id);
    else if (selectedId) setSelectedId(null);
  }, [active, loading, recordings.length, selectRecording, selectedId, visibleRecordings]);

  const exportClip = useCallback(async () => {
    if (!window.electronAPI?.recordings || !selectedRecording || clipRange[1] <= clipRange[0]) {
      return;
    }
    setExportingClip(true);
    setClipExportNotice(null);
    setClipExportError(null);
    try {
      const exported = await window.electronAPI.recordings.exportClip({
        recordingId: selectedRecording.id,
        startTime: clipRange[0],
        endTime: clipRange[1],
      });
      await loadRecordings();
      setClipMode(false);
      // The freshly exported clip is nested under the current recording.
      setCollapsedRecordingIds((current) => {
        if (!current.has(selectedRecording.id)) return current;
        const next = new Set(current);
        next.delete(selectedRecording.id);
        return next;
      });
      setSelectedId(exported.id);
      setClipExportNotice(`Clip exported: ${exported.name}`);
    } catch (exportError) {
      setClipExportError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setExportingClip(false);
    }
  }, [clipRange, loadRecordings, selectedRecording]);

  const beginRename = useCallback((recording: RecordedVideo) => {
    const extensionStart = recording.name.lastIndexOf(".");
    const currentName =
      extensionStart > 0 ? recording.name.slice(0, extensionStart) : recording.name;
    setContextMenu(null);
    setRenameError(null);
    setEditingRecordingId(recording.id);
    setEditingRecordingName(currentName);
  }, []);

  const cancelRename = useCallback(() => {
    if (renamingRecordingId) return;
    setEditingRecordingId(null);
    setEditingRecordingName("");
    setRenameError(null);
  }, [renamingRecordingId]);

  const finishRecordingRename = useCallback(
    async (renamed: RecordedVideo) => {
      await loadRecordings();
      videoRef.current?.pause();
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setClipRange([0, 0]);
      setClipMode(false);
      restoredRecordingId.current = null;
      setSelectedId(renamed.id);
    },
    [loadRecordings],
  );

  const renameRecording = useCallback(async () => {
    if (!window.electronAPI?.recordings || !editingRecordingId) return;
    const requestedName = editingRecordingName.trim();
    if (!requestedName) {
      setRenameError("A recording name is required.");
      return;
    }
    setRenameError(null);
    setRenamingRecordingId(editingRecordingId);
    try {
      const renamed = await window.electronAPI.recordings.renameRecording({
        recordingId: editingRecordingId,
        name: requestedName,
      });
      await finishRecordingRename(renamed);
      setEditingRecordingId(null);
      setEditingRecordingName("");
    } catch (renameActionError) {
      setRenameError(
        renameActionError instanceof Error ? renameActionError.message : String(renameActionError),
      );
    } finally {
      setRenamingRecordingId(null);
    }
  }, [editingRecordingId, editingRecordingName, finishRecordingRename]);

  const reprocessRecordingName = useCallback(
    async (recording: RecordedVideo) => {
      if (!window.electronAPI?.recordings || reprocessingNameId) return;
      setContextMenu(null);
      setRenameError(null);
      setReprocessingNameId(recording.id);
      try {
        const renamed = await window.electronAPI.recordings.reprocessName({
          recordingId: recording.id,
        });
        await finishRecordingRename(renamed);
      } catch (reprocessError) {
        setRenameError(
          reprocessError instanceof Error ? reprocessError.message : String(reprocessError),
        );
      } finally {
        setReprocessingNameId(null);
      }
    },
    [finishRecordingRename, reprocessingNameId],
  );

  const addGameChapters = useCallback(
    async (recording: RecordedVideo) => {
      if (!window.electronAPI?.recordings || gameChaptersId) return;
      setContextMenu(null);
      setGameChaptersId(recording.id);
      setGameChaptersNotice(null);
      setGameChaptersError(null);
      try {
        if (selectedRecording?.id === recording.id) {
          videoRef.current?.pause();
          await closeFrameReader();
        }
        const result = await window.electronAPI.recordings.addGameChapters({
          recordingId: recording.id,
        });
        await loadRecordings();
        setChapterRefreshToken((token) => token + 1);
        if (selectedRecording?.id === recording.id) videoRef.current?.load();
        setGameChaptersNotice(
          `Added ${result.added} game-start chapter${result.added === 1 ? "" : "s"} to ${recording.name}.${result.skipped.length ? ` Skipped ${result.skipped.length} game${result.skipped.length === 1 ? "" : "s"} with uncertain timing.` : ""}${result.backupPath ? ` The original backup could not be removed; it remains at ${result.backupPath}.` : ""}`,
        );
      } catch (chapterError) {
        setGameChaptersError(
          chapterError instanceof Error ? chapterError.message : String(chapterError),
        );
      } finally {
        setGameChaptersId(null);
      }
    },
    [closeFrameReader, gameChaptersId, loadRecordings, selectedRecording?.id],
  );

  const createF10Clips = useCallback(
    async (recording: RecordedVideo) => {
      if (!window.electronAPI?.recordings || f10ClipsId) return;
      setContextMenu(null);
      setF10ClipsId(recording.id);
      setF10ClipsNotice(null);
      setF10ClipsError(null);
      try {
        const result = await window.electronAPI.recordings.createF10Clips({
          recordingId: recording.id,
        });
        await loadRecordings();
        if (result.total === 0) {
          setF10ClipsNotice(`No unnamed manual chapters were found in ${recording.name}.`);
        } else {
          setF10ClipsNotice(
            `Created ${result.created} clip${result.created === 1 ? "" : "s"} from manual chapters in ${recording.name}.${result.alreadyExisting ? ` ${result.alreadyExisting} already existed.` : ""}`,
          );
        }
        if (result.failures.length) {
          setF10ClipsError(
            `${result.failures.length} manual-chapter clip${result.failures.length === 1 ? "" : "s"} failed: ${result.failures.map(({ chapterStartMs, error }) => `${(chapterStartMs / 1000).toFixed(1)}s (${error})`).join("; ")}`,
          );
        }
      } catch (clipError) {
        setF10ClipsError(clipError instanceof Error ? clipError.message : String(clipError));
      } finally {
        setF10ClipsId(null);
      }
    },
    [f10ClipsId, loadRecordings],
  );

  const openYouTubeStudio = useCallback(async (recording: RecordedVideo) => {
    if (!window.electronAPI?.recordings) return;
    setContextMenu(null);
    setYoutubeError(null);
    try {
      await window.electronAPI.recordings.openYouTubeStudio({ recordingId: recording.id });
    } catch (openError) {
      setYoutubeError(openError instanceof Error ? openError.message : String(openError));
    }
  }, []);

  const updateRecordingTags = useCallback(
    async (nextTags: RecordingTags) => {
      if (!window.electronAPI?.recordings || !selectedRecording) return;
      setTagError(null);
      setUpdatingTagsId(selectedRecording.id);
      try {
        const updated = await window.electronAPI.recordings.setTags({
          recordingId: selectedRecording.id,
          tags: nextTags,
        });
        setRecordings((current) =>
          current.map((recording) => (recording.id === updated.id ? updated : recording)),
        );
      } catch (tagActionError) {
        setTagError(
          tagActionError instanceof Error ? tagActionError.message : String(tagActionError),
        );
      } finally {
        setUpdatingTagsId(null);
      }
    },
    [selectedRecording],
  );

  const processSelectedRecording = useCallback(
    async (useSavedCalibration = false) => {
      if (!window.electronAPI?.recordings || !selectedRecording) return;
      setProcessingRecordingId(selectedRecording.id);
      setAnalysisProgress(null);
      setAnalysisError(null);
      let processingFrameReaderId: string | null = null;
      try {
        await closeFrameReader();
        const reader = await window.electronAPI.recordings.openFrameReader({
          recordingId: selectedRecording.id,
        });
        processingFrameReaderId = reader.sessionId;
        const frameProvider: RecordingFrameProvider = {
          frameRate: reader.frameRate,
          readFrame: async (frameIndex) => {
            let encodedFrame;
            try {
              encodedFrame = await window.electronAPI!.recordings.readFrame({
                sessionId: reader.sessionId,
                frameIndex,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (message.includes("past the end of the recording")) return null;
              throw error;
            }
            const binary = atob(encodedFrame.data);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) {
              bytes[index] = binary.charCodeAt(index);
            }
            return createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
          },
        };
        const analysis = await processRecording(
          selectedRecording.url,
          setAnalysisProgress,
          videoRef.current ?? undefined,
          frameProvider,
          useSavedCalibration
            ? selectedRecording.analysis?.processingSnapshot?.configuration
            : undefined,
        );
        const analysisWithOverrides = applyManualInputStateOverrides(
          analysis,
          selectedRecording.analysis?.stateOverrides ?? [],
        );
        const updated = await window.electronAPI.recordings.saveAnalysis({
          recordingId: selectedRecording.id,
          analysis: analysisWithOverrides,
        });
        setRecordings((current) =>
          current.map((recording) => (recording.id === updated.id ? updated : recording)),
        );
      } catch (processingError) {
        setAnalysisError(
          processingError instanceof Error ? processingError.message : String(processingError),
        );
      } finally {
        if (processingFrameReaderId) {
          await window.electronAPI.recordings.closeFrameReader({
            sessionId: processingFrameReaderId,
          });
        }
        setProcessingRecordingId(null);
        setAnalysisProgress(null);
      }
    },
    [selectedRecording],
  );

  const updateInputStateOverride = useCallback(
    async (inputEventId: string, state: RecordingAnalysisState | null) => {
      if (!window.electronAPI?.recordings || !selectedRecording?.analysis) return;
      const event = selectedRecording.analysis.inputEvents?.find(
        (candidate) => candidate.id === inputEventId,
      );
      if (!event) return;

      const existingOverrides = selectedRecording.analysis.stateOverrides ?? [];
      const nextOverrides: RecordingAnalysisStateOverride[] = existingOverrides.filter(
        (override) => override.inputEventId !== inputEventId,
      );
      if (state) {
        nextOverrides.push({
          inputEventId,
          state,
          notation: event.notation,
          occurrence: event.occurrence,
          time: event.time,
        });
      }

      setAnalysisError(null);
      try {
        const analysis = applyManualInputStateOverrides(selectedRecording.analysis, nextOverrides);
        const updated = await window.electronAPI.recordings.saveAnalysis({
          recordingId: selectedRecording.id,
          analysis,
        });
        setRecordings((current) =>
          current.map((recording) => (recording.id === updated.id ? updated : recording)),
        );
      } catch (overrideError) {
        setAnalysisError(
          overrideError instanceof Error ? overrideError.message : String(overrideError),
        );
      }
    },
    [selectedRecording],
  );

  const requestDelete = useCallback((recording: RecordedVideo) => {
    setContextMenu(null);
    setDeleteError(null);
    setDeleteTarget(recording);
  }, []);

  const cancelDelete = useCallback(() => {
    if (deletingRecordingId) return;
    setDeleteTarget(null);
    setDeleteError(null);
  }, [deletingRecordingId]);

  const deleteRecording = useCallback(async () => {
    if (!window.electronAPI?.recordings || !deleteTarget) return;
    const recordingId = deleteTarget.id;
    const wasSelected = selectedId === recordingId;
    setDeletingRecordingId(recordingId);
    setDeleteError(null);
    try {
      await window.electronAPI.recordings.deleteRecording({ recordingId });
      if (wasSelected) {
        videoRef.current?.pause();
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setClipRange([0, 0]);
        setClipMode(false);
        restoredRecordingId.current = null;
        focusPlayerAfterSelection.current = false;
        setSelectedId(null);
      }
      if (editingRecordingId === recordingId) {
        setEditingRecordingId(null);
        setEditingRecordingName("");
      }
      setDeleteTarget(null);
      await loadRecordings();
    } catch (deleteActionError) {
      setDeleteError(
        deleteActionError instanceof Error ? deleteActionError.message : String(deleteActionError),
      );
    } finally {
      setDeletingRecordingId(null);
    }
  }, [deleteTarget, editingRecordingId, loadRecordings, selectedId]);

  const sourceRecording = useMemo(
    () =>
      selectedRecording?.clip
        ? (recordings.find(
            (recording) => recording.id === selectedRecording.clip?.sourceRecordingId,
          ) ?? null)
        : null,
    [recordings, selectedRecording],
  );

  const linkedClips = useMemo(
    () =>
      selectedRecording
        ? recordings.filter(
            (recording) => recording.clip?.sourceRecordingId === selectedRecording.id,
          )
        : [],
    [recordings, selectedRecording],
  );

  const linkedTechCombos = useMemo(
    () =>
      selectedRecording
        ? Object.entries(techCatalog).flatMap(([character, data]) =>
            (data?.combos ?? [])
              .filter((combo) => combo.recordingId === selectedRecording.id)
              .map((combo) => ({ character, combo })),
          )
        : [],
    [selectedRecording, techCatalog],
  );

  const selectLinkedCombo = (combo: TechCombo) => {
    localStorage.setItem(techSelectedComboStorageKey, combo.id);
    window.dispatchEvent(new CustomEvent(techSelectComboEvent, { detail: combo.id }));
  };

  const clippedRegions = useMemo(
    () =>
      selectedRecording ? descendantClipRanges(recordings, selectedRecording.id, duration) : [],
    [duration, recordings, selectedRecording],
  );

  const clippedTimelineBackground = useMemo(() => {
    if (!duration || clippedRegions.length === 0) return undefined;
    const stops: string[] = [];
    let cursor = 0;
    for (const [start, end] of clippedRegions) {
      const startPercent = (start / duration) * 100;
      const endPercent = (end / duration) * 100;
      if (start > cursor) {
        stops.push(`#1976d2 ${(cursor / duration) * 100}% ${startPercent}%`);
      }
      stops.push(`#f57c00 ${startPercent}% ${endPercent}%`);
      cursor = end;
    }
    if (cursor < duration) stops.push(`#1976d2 ${(cursor / duration) * 100}% 100%`);
    return `linear-gradient(to right, ${stops.join(", ")})`;
  }, [clippedRegions, duration]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (reviewFrame) {
      const reviewTime = reviewFrame.frameIndex / FRAME_RATE;
      video.currentTime = reviewTime;
      currentFrameIndex.current = reviewFrame.frameIndex;
      setCurrentTime(reviewTime);
      setReviewFrame(null);
      void video.play();
      return;
    }
    if (video.paused) {
      if (clipMode && video.currentTime >= clipRange[1]) {
        video.currentTime = clipRange[0];
        currentFrameIndex.current = frameIndexForTime(clipRange[0]);
        setCurrentTime(clipRange[0]);
      }
      void video.play();
    } else {
      currentFrameIndex.current = frameIndexForTime(video.currentTime);
      video.pause();
    }
  }, [clipMode, clipRange, reviewFrame]);

  const seekTo = useCallback(
    (nextTime: number) => {
      const video = videoRef.current;
      if (!video) return;
      setReviewFrame(null);
      video.currentTime = nextTime;
      currentFrameIndex.current = frameIndexForTime(nextTime);
      setCurrentTime(nextTime);
      if (selectedRecording) {
        savePlaybackPosition(selectedRecording.id, nextTime);
      }
    },
    [savePlaybackPosition, selectedRecording],
  );

  const debugFrames = selectedRecording?.analysis?.diagnostics ?? [];
  const inputEvents = selectedRecording?.analysis?.inputEvents ?? [];
  const parsedInputRoute = formatParsedInputRoute(inputEvents, techCatalog);
  const debugFrame: RecordingAnalysisDiagnosticFrame | null = debugFrames[debugFrameIndex] ?? null;
  const analysisConfig = selectedRecording?.analysis?.detectorConfig ?? null;
  const [calibrationConfig, setCalibrationConfig] = useState<DetectorConfig | null>(null);
  const [processingConfigResult, setProcessingConfigResult] =
    useState<ProcessingConfigurationResult | null>(null);
  const [processingConfigError, setProcessingConfigError] = useState<string | null>(null);
  const [processingConfigNotice, setProcessingConfigNotice] = useState<string | null>(null);
  const [calibrationSaves, setCalibrationSaves] = useState(0);
  const [previewCurrentCalibration, setPreviewCurrentCalibration] = useState(false);
  const applyProcessingConfigResult = useCallback((result: ProcessingConfigurationResult) => {
    setProcessingConfigResult(result);
    setCalibrationConfig(result.configuration?.detector ?? null);
    setProcessingConfigError(null);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void loadProcessingConfiguration()
      .then((result) => {
        if (!cancelled) applyProcessingConfigResult(result);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setProcessingConfigError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [applyProcessingConfigResult]);
  const persistentConfig = processingConfigResult?.configuration;
  const currentPreviewConfig =
    persistentConfig && calibrationConfig
      ? effectiveDetectorConfig(
          { ...persistentConfig, detector: calibrationConfig },
          selectedRecording?.analysis?.sourceWidth ?? persistentConfig.referenceSize.width,
          selectedRecording?.analysis?.sourceHeight ?? persistentConfig.referenceSize.height,
        )
      : null;
  const debugConfig = previewCurrentCalibration
    ? currentPreviewConfig
    : (analysisConfig ?? currentPreviewConfig);
  const debugRegions = debugConfig
    ? debugRegionsFromConfig(
        debugConfig,
        selectedRecording?.analysis?.sourceWidth ?? 2560,
        selectedRecording?.analysis?.sourceHeight ?? 1440,
      )
    : (selectedRecording?.analysis?.detectorRegions ?? null);
  const analysisDebugReady = Boolean(
    debugFrame &&
    debugRegions?.inputSegments &&
    debugRegions.framebarSamples &&
    Array.isArray(debugFrame.player1States),
  );
  const hitboxOverlayBoxes = useMemo<Array<RecordingAnalysisHitbox & { id: string }>>(() => {
    if (mode !== "nerd-processing" || !selectedRecording?.analysis) return [];
    const maximumSampleDistance = 2 / FRAME_RATE;
    return selectedRecording.analysis.moves.flatMap((move) => {
      if (currentTime < move.startTime - maximumSampleDistance || currentTime > move.endTime) {
        return [];
      }
      return (move.hitboxTracks ?? []).flatMap((track) => {
        const sample = track.samples.reduce<(typeof track.samples)[number] | null>(
          (nearest, candidate) => {
            if (!nearest) return candidate;
            return Math.abs(candidate.time - currentTime) < Math.abs(nearest.time - currentTime)
              ? candidate
              : nearest;
          },
          null,
        );
        if (!sample || Math.abs(sample.time - currentTime) > maximumSampleDistance) return [];
        return sample.boxes.map((box, boxIndex) => ({
          ...box,
          id: `${track.id}-${sample.frame}-${boxIndex}`,
        }));
      });
    });
  }, [currentTime, mode, selectedRecording]);

  const saveProcessingCalibration = useCallback(
    async (edit: Parameters<typeof updateProcessingConfiguration>[0]) => {
      setCalibrationSaves((count) => count + 1);
      try {
        applyProcessingConfigResult(await updateProcessingConfiguration(edit));
      } catch (error) {
        setProcessingConfigError(error instanceof Error ? error.message : String(error));
      } finally {
        setCalibrationSaves((count) => count - 1);
      }
    },
    [applyProcessingConfigResult],
  );
  const updateCalibration = useCallback(
    (key: keyof DetectorConfig, value: string) => {
      if (!value.trim()) return;
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return;
      setPreviewCurrentCalibration(true);
      void saveProcessingCalibration((configuration) => ({
        ...configuration,
        detector: { ...configuration.detector, [key]: numericValue },
      }));
    },
    [saveProcessingCalibration],
  );
  const runConfigurationAction = useCallback(
    async (action: "reload" | "import" | "export") => {
      try {
        if (action === "export") {
          const exportedPath = await window.electronAPI!.processingConfiguration.export();
          if (exportedPath) setProcessingConfigNotice(`Configuration exported to ${exportedPath}`);
        } else {
          const result =
            action === "import"
              ? await importProcessingConfiguration()
              : await reloadProcessingConfiguration();
          if (result) applyProcessingConfigResult(result);
        }
      } catch (error) {
        setProcessingConfigError(error instanceof Error ? error.message : String(error));
      }
    },
    [applyProcessingConfigResult],
  );

  const updateVideoContentBox = useCallback(() => {
    const video = videoRef.current;
    const container = videoContainerRef.current;
    if (!video || !container) return;
    const videoWidth = video.videoWidth || 16;
    const videoHeight = video.videoHeight || 9;
    const containerRect = container.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    const elementWidth = videoRect.width || container.clientWidth;
    const elementHeight = videoRect.height || container.clientHeight;
    if (!elementWidth || !elementHeight) return;
    const scale = Math.min(elementWidth / videoWidth, elementHeight / videoHeight);
    const width = videoWidth * scale;
    const height = videoHeight * scale;
    setVideoContentBox({
      left: videoRect.left - containerRect.left + (elementWidth - width) / 2,
      top: videoRect.top - containerRect.top + (elementHeight - height) / 2,
      width,
      height,
    });
  }, []);

  useEffect(() => {
    const container = videoContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(updateVideoContentBox);
    observer.observe(container);
    updateVideoContentBox();
    return () => observer.disconnect();
  }, [selectedRecording?.id, updateVideoContentBox]);

  useEffect(() => {
    if (!showAnalysisDebug || !debugFrame) return;
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    void loadExactReviewFrame(frameIndexForTime(debugFrame.time)).catch((error) => {
      setPlaybackError(
        error instanceof Error ? `Exact frame review failed: ${error.message}` : String(error),
      );
    });
  }, [debugFrame, loadExactReviewFrame, showAnalysisDebug]);

  const exportAnalysisDiagnostics = useCallback(() => {
    if (!selectedRecording?.analysis) return;
    const blob = new Blob([JSON.stringify(selectedRecording.analysis, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedRecording.name.replace(/\.[^.]+$/, "")}-analysis.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [selectedRecording]);

  const stepFrame = useCallback(
    async (direction: 1 | -1, trigger: FrameStepTrigger) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration)) return;
      if (steppingFrame.current) {
        if (queuedFrameSteps.current.length < FRAME_STEP_QUEUE_LIMIT) {
          queuedFrameSteps.current.push(direction);
          console.debug("[RecordingViewer] frame-step queued", {
            direction,
            key: trigger.key,
            queueLength: queuedFrameSteps.current.length,
          });
        } else {
          console.debug("[RecordingViewer] frame-step queue-full", {
            direction,
            key: trigger.key,
            queueLength: queuedFrameSteps.current.length,
          });
        }
        return;
      }
      steppingFrame.current = true;
      setReviewLoading(true);
      const stepStartedAt = performance.now();
      const startingTime = reviewFrame ? reviewFrame.frameIndex / FRAME_RATE : video.currentTime;
      const durationFrame = lastFrameIndexForDuration(video.duration);
      const trackedFrame = currentFrameIndex.current;
      const startingFrame = Math.min(
        durationFrame,
        trackedFrame == null ? frameIndexForTime(startingTime) : trackedFrame,
      );
      const targetFrame = Math.min(durationFrame, Math.max(0, startingFrame + direction));
      const targetTime = targetFrame / FRAME_RATE;
      const startingQuality = video.getVideoPlaybackQuality?.();
      console.debug("[RecordingViewer] frame-step start", {
        direction,
        duration: video.duration,
        key: trigger.key,
        repeat: trigger.repeat,
        startingTime,
        startingFrame,
        targetTime,
        targetFrame,
        readyState: video.readyState,
        seeking: video.seeking,
        paused: video.paused,
        totalVideoFrames: startingQuality?.totalVideoFrames,
        droppedVideoFrames: startingQuality?.droppedVideoFrames,
      });
      video.pause();
      try {
        console.debug("[RecordingViewer] frame-step exact-read", {
          startingTime,
          startingFrame,
          targetTime,
          targetFrame,
          direction,
        });
        await loadExactReviewFrame(targetFrame);
        currentFrameIndex.current = targetFrame;
        setCurrentTime(targetTime);
      } catch (error) {
        console.debug("[RecordingViewer] frame-step error-fallback", {
          direction,
          error: error instanceof Error ? error.message : String(error),
          startingTime,
          startingFrame,
          targetTime,
          targetFrame,
          currentTime: video.currentTime,
          readyState: video.readyState,
          seeking: video.seeking,
          paused: video.paused,
        });
        video.pause();
        setReviewFrame(null);
        setPlaybackError(
          error instanceof Error ? `Exact frame review failed: ${error.message}` : String(error),
        );
        setCurrentTime(video.currentTime);
      } finally {
        steppingFrame.current = false;
        setReviewLoading(false);
        const endingQuality = video.getVideoPlaybackQuality?.();
        const queuedDirection = queuedFrameSteps.current.shift();
        console.debug("[RecordingViewer] frame-step end", {
          direction,
          startingTime,
          endingTime: reviewFrame ? reviewFrame.frameIndex / FRAME_RATE : video.currentTime,
          deltaSeconds:
            (reviewFrame ? reviewFrame.frameIndex / FRAME_RATE : video.currentTime) - startingTime,
          deltaFrames:
            currentFrameIndex.current != null
              ? currentFrameIndex.current - startingFrame
              : undefined,
          timestampDeltaFrames: (video.currentTime - startingTime) * FRAME_RATE,
          elapsedMilliseconds: performance.now() - stepStartedAt,
          readyState: video.readyState,
          seeking: video.seeking,
          paused: video.paused,
          totalVideoFrames: endingQuality?.totalVideoFrames,
          droppedVideoFrames: endingQuality?.droppedVideoFrames,
          droppedFramesDuringStep:
            endingQuality && startingQuality
              ? endingQuality.droppedVideoFrames - startingQuality.droppedVideoFrames
              : undefined,
        });
        if (queuedDirection !== undefined) {
          queueMicrotask(() => void stepFrame(queuedDirection, { key: "queued", repeat: false }));
        }
      }
    },
    [loadExactReviewFrame, reviewFrame],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!active || !selectedRecording) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        beginRename(selectedRecording);
        return;
      }
      if (event.code === "Space") {
        // Let focused controls keep their normal Space behavior. Otherwise Space
        // is the player-wide play/pause shortcut and must not scroll the page.
        if (target?.closest("button, a, [role=button], [role=slider]")) return;
        event.preventDefault();
        togglePlayback();
        return;
      }
      if (key !== "e" && key !== "q") return;
      event.preventDefault();
      console.debug("[RecordingViewer] frame-step keydown", {
        key,
        repeat: event.repeat,
        timeStamp: event.timeStamp,
      });
      if (event.repeat) return;
      void stepFrame(key === "e" ? 1 : -1, { key, repeat: event.repeat });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, beginRename, selectedRecording, stepFrame, togglePlayback]);

  return (
    <Stack spacing={2} sx={{ height: "100%", minHeight: 0, overflow: "hidden" }}>
      {error && <Alert severity="error">{error}</Alert>}
      {renameError && <Alert severity="error">{renameError}</Alert>}
      {gameChaptersError && <Alert severity="error">{gameChaptersError}</Alert>}
      {gameChaptersNotice && <Alert severity="success">{gameChaptersNotice}</Alert>}
      {f10ClipsError && <Alert severity="error">{f10ClipsError}</Alert>}
      {f10ClipsNotice && <Alert severity="success">{f10ClipsNotice}</Alert>}
      {youtubeError && <Alert severity="error">{youtubeError}</Alert>}
      {mode === "nerd-processing" && processingConfigError && (
        <Alert severity="error">{processingConfigError}</Alert>
      )}
      {mode === "nerd-processing" && (
        <Paper variant="outlined" sx={{ p: 1.5, flexShrink: 0, textAlign: "left" }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ alignItems: { sm: "center" } }}
          >
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1">Nerd processing</Typography>
              <Typography variant="body2" color="text.secondary">
                Record a move with OBS, then run the FFmpeg frame-analysis workflow against the
                captured clip.
              </Typography>
            </Box>
            <Button
              variant={extractionRecording ? "outlined" : "contained"}
              color={extractionRecording ? "error" : "primary"}
              onClick={() =>
                void (extractionRecording
                  ? stopManualRecording()
                  : startManualRecording("extraction"))
              }
              disabled={
                obsState.status !== "connected" ||
                (!extractionRecording && (obsState.recording.active || obsState.automation.enabled))
              }
            >
              {extractionRecording
                ? "Stop recording move for extraction"
                : "Start recording move for extraction"}
            </Button>
          </Stack>
          <Box component="details" sx={{ mt: 1, maxHeight: 280, overflow: "auto" }}>
            <Typography component="summary" sx={{ cursor: "pointer" }}>
              Processing configuration
              {persistentConfig ? ` · revision ${persistentConfig.revision}` : ""}
              {calibrationSaves > 0 ? " · saving…" : ""}
            </Typography>
            <Stack spacing={1} sx={{ mt: 1 }}>
              {processingConfigResult?.warnings.map((warning) => (
                <Alert severity="warning" key={warning}>
                  {warning}
                </Alert>
              ))}
              {processingConfigNotice && (
                <Alert severity="success" onClose={() => setProcessingConfigNotice(null)}>
                  {processingConfigNotice}
                </Alert>
              )}
              <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                {processingConfigResult?.path ?? "Loading saved calibration…"}
              </Typography>
              <Stack direction="row" spacing={1}>
                {(["export", "import", "reload"] as const).map((action) => (
                  <Button
                    key={action}
                    size="small"
                    disabled={calibrationSaves > 0 || Boolean(processingRecordingId)}
                    onClick={() => void runConfigurationAction(action)}
                  >
                    {action === "export"
                      ? "Export configuration"
                      : action === "import"
                        ? "Import configuration"
                        : "Reload configuration"}
                  </Button>
                ))}
              </Stack>
              {persistentConfig && (
                <>
                  <Typography variant="caption" color="text.secondary">
                    Saved calibration is independent of browser storage. Each edit keeps the
                    previous revision. Unmatched framebar colors remain unknown. Import an exported
                    revision to restore it.
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    {(["width", "height"] as const).map((dimension) => (
                      <CalibrationNumberField
                        key={dimension}
                        label={`Calibration reference ${dimension}`}
                        min={1}
                        max={32768}
                        step={1}
                        width={190}
                        value={persistentConfig.referenceSize[dimension]}
                        onCommit={(value) => {
                          void saveProcessingCalibration((configuration) => ({
                            ...configuration,
                            referenceSize: { ...configuration.referenceSize, [dimension]: value },
                          }));
                        }}
                      />
                    ))}
                    <CalibrationNumberField
                      label="Color distance threshold"
                      min={0.001}
                      max={1}
                      step={0.01}
                      width={190}
                      value={persistentConfig.framebar.distanceThreshold}
                      onCommit={(value) => {
                        void saveProcessingCalibration((configuration) => ({
                          ...configuration,
                          framebar: { ...configuration.framebar, distanceThreshold: value },
                        }));
                      }}
                    />
                  </Stack>
                  {persistentConfig.framebar.colors.map((color, index) => (
                    <Stack
                      key={`${color.name}-${index}`}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center" }}
                    >
                      <Typography variant="caption" sx={{ minWidth: 90 }}>
                        {color.name}
                      </Typography>
                      {(["red", "green", "blue"] as const).map((channel) => (
                        <CalibrationNumberField
                          key={channel}
                          label={channel}
                          value={color[channel]}
                          width={94}
                          max={255}
                          step={1}
                          onCommit={(value) => {
                            void saveProcessingCalibration((configuration) => ({
                              ...configuration,
                              framebar: {
                                ...configuration.framebar,
                                colors: configuration.framebar.colors.map((entry, colorIndex) =>
                                  colorIndex === index ? { ...entry, [channel]: value } : entry,
                                ),
                              },
                            }));
                          }}
                        />
                      ))}
                    </Stack>
                  ))}
                </>
              )}
            </Stack>
          </Box>
        </Paper>
      )}

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        sx={{ flex: 1, minHeight: 0, minWidth: 0, alignItems: "stretch", overflow: "hidden" }}
      >
        <Paper
          variant="outlined"
          sx={{
            width: { xs: "100%", md: 660 },
            flexShrink: 0,
            display: { xs: "block", md: "flex" },
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{
              p: 1.5,
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <Typography variant="body2" color="text.secondary" noWrap title={folder ?? undefined}>
              {folder ?? "No recording folder configured"}
            </Typography>
            <Tooltip title={loading ? "Refreshing recordings" : "Refresh recordings"}>
              <span>
                <IconButton
                  aria-label="Refresh recordings"
                  onClick={() => void loadRecordings()}
                  disabled={loading}
                  size="small"
                >
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
          <Stack sx={{ p: 1.5, borderBottom: 1, borderColor: "divider" }}>
            <Typography variant="subtitle2">Show recordings</Typography>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ alignItems: "center" }}
            >
              <Stack direction={{ xs: "column", sm: "row" }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={showFullRecordings}
                      onChange={(event) => setShowFullRecordings(event.target.checked)}
                    />
                  }
                  label="Full recordings"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={showClips}
                      onChange={(event) => setShowClips(event.target.checked)}
                    />
                  }
                  label="Clips"
                />
              </Stack>
              <Stack direction="row" spacing={1} sx={{ flex: 1, flexWrap: "wrap", gap: 1 }}>
                {recordingTagCategories.map((category) => {
                  const selected = selectedTagFilters[category.key];
                  if (!category.subtags) {
                    return (
                      <FormControlLabel
                        key={category.key}
                        control={
                          <Checkbox
                            size="small"
                            checked={selected === true}
                            onChange={(event) =>
                              setSelectedTagFilters(
                                (current) =>
                                  ({
                                    ...current,
                                    [category.key]: event.target.checked,
                                  }) as RecordingTags,
                              )
                            }
                          />
                        }
                        label={category.label}
                      />
                    );
                  }
                  const selectedSubtags = Array.isArray(selected) ? (selected as string[]) : [];
                  return (
                    <FormControl
                      key={category.key}
                      size="small"
                      sx={{ minWidth: 145, flex: "1 1 145px" }}
                    >
                      <InputLabel id={`recording-${category.key}-filter-label`}>
                        {category.label}
                      </InputLabel>
                      <Select
                        labelId={`recording-${category.key}-filter-label`}
                        multiple
                        value={selectedSubtags}
                        onChange={(event) => {
                          const value = event.target.value;
                          const nextSubtags = (
                            typeof value === "string" ? value.split(",") : value
                          ) as string[];
                          setSelectedTagFilters(
                            (current) =>
                              ({
                                ...current,
                                [category.key]: nextSubtags,
                              }) as RecordingTags,
                          );
                        }}
                        input={<OutlinedInput label={category.label} />}
                        renderValue={(selected) => {
                          const values = selected as string[];
                          if (values.length === 0) return `All ${category.label.toLowerCase()}`;
                          return values
                            .map(
                              (value) =>
                                category.subtags?.find(
                                  (subtag) => recordingSubtagValue(subtag) === value,
                                ) ?? value,
                            )
                            .join(", ");
                        }}
                      >
                        {category.subtags.map((subtag) => {
                          const value = recordingSubtagValue(subtag);
                          return (
                            <MenuItem key={value} value={value}>
                              <Checkbox checked={selectedSubtags.includes(value)} size="small" />
                              <ListItemText primary={subtag} />
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </FormControl>
                  );
                })}
              </Stack>
            </Stack>
          </Stack>
          {recordings.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 2, textAlign: "left" }}>
              No recordings found.
            </Typography>
          ) : tagFilteredRecordings.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 2, textAlign: "left" }}>
              No recordings match the selected filters.
            </Typography>
          ) : (
            <List dense disablePadding sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {displayedRecordings.map(({ recording, depth }) => (
                <Box
                  component="li"
                  key={recording.id}
                  sx={{ position: "relative", listStyle: "none" }}
                >
                  <ListItemButton
                    component="div"
                    role={editingRecordingId === recording.id ? undefined : "button"}
                    tabIndex={editingRecordingId === recording.id ? -1 : 0}
                    selected={recording.id === selectedId}
                    draggable={editingRecordingId !== recording.id}
                    onClick={() => {
                      if (editingRecordingId !== recording.id) selectRecording(recording.id);
                    }}
                    onKeyDown={(event) => {
                      if (
                        editingRecordingId === recording.id ||
                        event.target !== event.currentTarget
                      )
                        return;
                      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                        event.preventDefault();
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setContextMenu({
                          recording,
                          mouseX: bounds.left + 16,
                          mouseY: bounds.top + 16,
                        });
                        return;
                      }
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      selectRecording(recording.id);
                    }}
                    onDragStart={(event) => {
                      if (editingRecordingId === recording.id || !window.electronAPI?.recordings) {
                        event.preventDefault();
                        return;
                      }
                      event.preventDefault();
                      window.electronAPI.recordings.startDrag({ recordingId: recording.id });
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({
                        recording,
                        mouseX: event.clientX + 2,
                        mouseY: event.clientY - 6,
                      });
                    }}
                    sx={{
                      alignItems: "flex-start",
                      pl: (showFullRecordings && showClips ? 5 : 2) + depth * 2.5,
                      cursor: editingRecordingId === recording.id ? "default" : "grab",
                      "&:active": {
                        cursor: editingRecordingId === recording.id ? "default" : "grabbing",
                      },
                      ...(depth > 0
                        ? {
                            position: "relative",
                            "&::before": {
                              content: '""',
                              position: "absolute",
                              left: 20 + (depth - 1) * 20,
                              top: 0,
                              bottom: 0,
                              borderLeft: 1,
                              borderColor: "divider",
                            },
                            "&::after": {
                              content: '""',
                              position: "absolute",
                              left: 20 + (depth - 1) * 20,
                              top: "50%",
                              width: 12,
                              borderTop: 1,
                              borderColor: "divider",
                            },
                          }
                        : {}),
                    }}
                    title={
                      editingRecordingId === recording.id
                        ? undefined
                        : "Click to select · Right-click for actions · Drag to share"
                    }
                  >
                    {editingRecordingId === recording.id ? (
                      <Stack direction="row" spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
                        <TextField
                          autoFocus
                          fullWidth
                          size="small"
                          value={editingRecordingName}
                          disabled={renamingRecordingId === recording.id}
                          aria-label={`New name for ${recording.name}`}
                          onChange={(event) => setEditingRecordingName(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void renameRecording();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              cancelRename();
                            }
                          }}
                        />
                        <Tooltip title="Save name">
                          <span>
                            <IconButton
                              size="small"
                              aria-label="Save recording name"
                              disabled={renamingRecordingId === recording.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                void renameRecording();
                              }}
                            >
                              <CheckIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Cancel rename">
                          <span>
                            <IconButton
                              size="small"
                              aria-label="Cancel rename"
                              disabled={renamingRecordingId === recording.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                cancelRename();
                              }}
                            >
                              <CloseIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    ) : (
                      <ListItemText
                        primary={recording.name}
                        secondary={`${recording.moveTake ? `${recording.moveTake.moveLabel} · ${recording.moveTake.outcome} · ${recording.moveTake.validation.status} | ` : ""}${formatFileSize(recording.size)} | ${formatModifiedAt(recording.modifiedAt)}`}
                        slotProps={{ primary: { sx: { overflowWrap: "anywhere" } } }}
                      />
                    )}
                  </ListItemButton>
                  {expandableRecordingIds.has(recording.id) && (
                    <Tooltip
                      title={`${collapsedRecordingIds.has(recording.id) ? "Expand" : "Collapse"} clips for ${recording.name}`}
                    >
                      <IconButton
                        size="small"
                        aria-label={`${collapsedRecordingIds.has(recording.id) ? "Expand" : "Collapse"} clips for ${recording.name}`}
                        aria-expanded={!collapsedRecordingIds.has(recording.id)}
                        onClick={() => toggleRecordingExpanded(recording.id)}
                        sx={{
                          position: "absolute",
                          left: 12 + depth * 20,
                          top: "50%",
                          transform: "translateY(-50%)",
                          width: 26,
                          height: 26,
                          zIndex: 1,
                        }}
                      >
                        {collapsedRecordingIds.has(recording.id) ? (
                          <ChevronRightIcon fontSize="small" />
                        ) : (
                          <ExpandMoreIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              ))}
            </List>
          )}
        </Paper>

        <Menu
          open={Boolean(contextMenu)}
          onClose={() => setContextMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={
            contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined
          }
        >
          <MenuItem onClick={() => contextMenu && beginRename(contextMenu.recording)}>
            Rename
          </MenuItem>
          <MenuItem onClick={() => contextMenu && void openYouTubeStudio(contextMenu.recording)}>
            Open YouTube Studio in browser
          </MenuItem>
          {contextMenu?.recording.source === "automatic" && (
            <MenuItem
              disabled={Boolean(reprocessingNameId)}
              onClick={() => void reprocessRecordingName(contextMenu.recording)}
            >
              Rebuild name and set number
            </MenuItem>
          )}
          {contextMenu?.recording.source === "automatic" &&
            contextMenu.recording.name.toLowerCase().endsWith(".mp4") &&
            contextMenu.recording.games.length > 0 && (
              <MenuItem
                disabled={Boolean(gameChaptersId)}
                onClick={() => void addGameChapters(contextMenu.recording)}
              >
                {gameChaptersId === contextMenu.recording.id
                  ? "Adding game chapters..."
                  : "Add/rebuild game-start chapters"}
              </MenuItem>
            )}
          {contextMenu?.recording.name.toLowerCase().endsWith(".mp4") &&
            !contextMenu.recording.clip && (
              <MenuItem
                disabled={Boolean(f10ClipsId) || Boolean(gameChaptersId)}
                onClick={() => void createF10Clips(contextMenu.recording)}
              >
                {f10ClipsId === contextMenu.recording.id
                  ? "Creating clips from manual chapters..."
                  : "Create 30-second clips from manual chapters"}
              </MenuItem>
            )}
          <MenuItem
            sx={{ color: "error.main" }}
            onClick={() => contextMenu && requestDelete(contextMenu.recording)}
          >
            Delete
          </MenuItem>
        </Menu>

        <Dialog open={Boolean(deleteTarget)} onClose={cancelDelete}>
          <DialogTitle>Delete recording?</DialogTitle>
          <DialogContent>
            <Stack spacing={1}>
              <Typography>
                This will permanently delete{" "}
                {deleteTarget ? `“${deleteTarget.name}”` : "this recording"}.
              </Typography>
              {deleteTarget &&
                recordings.some(
                  (recording) => recording.clip?.sourceRecordingId === deleteTarget.id,
                ) && (
                  <Alert severity="warning">
                    Clips made from this recording will remain, but their original recording link
                    will no longer be available.
                  </Alert>
                )}
              {deleteError && <Alert severity="error">{deleteError}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={cancelDelete} disabled={Boolean(deletingRecordingId)}>
              Cancel
            </Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => void deleteRecording()}
              disabled={Boolean(deletingRecordingId)}
            >
              {deletingRecordingId ? "Deleting..." : "Delete"}
            </Button>
          </DialogActions>
        </Dialog>

        <Paper
          variant="outlined"
          sx={{ p: 2, flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", textAlign: "left" }}
        >
          {selectedRecording ? (
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ alignItems: { sm: "center" } }}
              >
                <Typography variant="subtitle1" sx={{ flex: 1, overflowWrap: "anywhere" }}>
                  {selectedRecording.name}
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => void openYouTubeStudio(selectedRecording)}
                >
                  Open YouTube Studio in browser
                </Button>
                {mode === "nerd-processing" && (
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => void processSelectedRecording()}
                    disabled={
                      Boolean(processingRecordingId) ||
                      calibrationSaves > 0 ||
                      !persistentConfig ||
                      Boolean(processingConfigError)
                    }
                  >
                    {processingRecordingId === selectedRecording.id
                      ? "Processing recording..."
                      : "Process current calibration"}
                  </Button>
                )}
                {mode === "nerd-processing" && selectedRecording.analysis?.processingSnapshot && (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={Boolean(processingRecordingId) || calibrationSaves > 0}
                    onClick={() => void processSelectedRecording(true)}
                  >
                    Reprocess saved calibration
                  </Button>
                )}
              </Stack>
              {selectedRecording.moveTake && (
                <Alert
                  severity={
                    selectedRecording.moveTake.validation.status === "verified"
                      ? "success"
                      : selectedRecording.moveTake.validation.status === "mismatch"
                        ? "error"
                        : selectedRecording.moveTake.validation.status === "ambiguous"
                          ? "warning"
                          : "info"
                  }
                >
                  Move take: {selectedRecording.moveTake.characterLabel} ·{" "}
                  {selectedRecording.moveTake.moveLabel} · {selectedRecording.moveTake.outcome}.{" "}
                  {selectedRecording.moveTake.validation.message}
                  {selectedRecording.moveTake.validation.observedInputs.length > 0
                    ? ` Observed: ${selectedRecording.moveTake.validation.observedInputs.join(", ")}.`
                    : ""}
                  {selectedRecording.moveTake.storageError
                    ? ` File organization warning: ${selectedRecording.moveTake.storageError}`
                    : ""}
                </Alert>
              )}
              {mode === "nerd-processing" && selectedRecording.analysis && (
                <Typography variant="caption" color="text.secondary">
                  {selectedRecording.analysis.processingSnapshot
                    ? `Analysis used configuration revision ${selectedRecording.analysis.processingSnapshot.configuration.revision} · ${selectedRecording.analysis.processingSnapshot.processorVersion}`
                    : "Older analysis: the full color/template calibration was not saved. Reprocess to capture it."}
                </Typography>
              )}
              {mode === "nerd-processing" && Boolean(selectedRecording.analysisHistory?.length) && (
                <details>
                  <summary>
                    Previous analysis runs ({selectedRecording.analysisHistory?.length})
                  </summary>
                  {selectedRecording.analysisHistory?.map((run, index) => (
                    <Typography
                      key={`${run.processedAt}-${index}`}
                      component="div"
                      variant="caption"
                      sx={{ overflowWrap: "anywhere" }}
                    >
                      {run.processedAt} · {run.processorVersion ?? "older processor"} · inputs{" "}
                      {run.inputs.join(", ") || "none"} · moves{" "}
                      {run.moves.map((move) => move.notation ?? "?").join(", ") || "none"}
                    </Typography>
                  ))}
                </details>
              )}
              {mode === "nerd-processing" &&
                selectedRecording.analysis?.processingSnapshot &&
                selectedRecording.analysis.processingSnapshot.processorFingerprint !==
                  recordingProcessorFingerprint && (
                  <Alert severity="warning">
                    Detector code changed since this analysis. Saved calibration can be reused, but
                    results may differ with the current detector.
                  </Alert>
                )}
              {mode === "nerd-processing" &&
                processingRecordingId === selectedRecording.id &&
                analysisProgress && (
                  <Stack spacing={0.5}>
                    <LinearProgress
                      variant="determinate"
                      value={
                        (analysisProgress.completed / Math.max(1, analysisProgress.total)) * 100
                      }
                    />
                    <Typography variant="caption" color="text.secondary">
                      Analyzing {formatVideoTime(analysisProgress.time)} of{" "}
                      {formatVideoTime(analysisProgress.duration)}
                    </Typography>
                  </Stack>
                )}
              {mode === "nerd-processing" && analysisError && (
                <Alert severity="error">{analysisError}</Alert>
              )}
              {mode === "nerd-processing" && selectedRecording.analysis && (
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2">
                    Detected moves ({selectedRecording.analysis.moves.length})
                  </Typography>
                  {selectedRecording.analysis.warnings.map((warning) => (
                    <Typography key={warning} variant="caption" color="warning.main">
                      {warning}
                    </Typography>
                  ))}
                  {parsedInputRoute.length > 0 && (
                    <Paper variant="outlined" sx={{ p: 1.25, mt: 0.5 }}>
                      <Typography variant="subtitle2">Parsed input route</Typography>
                      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                        {parsedInputRoute.join(" → ")}
                      </Typography>
                      {parsedInputRoute.some((part) => part.includes("~")) && (
                        <Typography variant="caption" color="text.secondary">
                          ~ indicates a followup in a configured stance sequence.
                        </Typography>
                      )}
                    </Paper>
                  )}
                  {selectedRecording.analysis.moves.map((move) => (
                    <Button
                      key={move.id}
                      variant="text"
                      size="small"
                      onClick={() => seekTo(move.startTime)}
                      sx={{ justifyContent: "flex-start", overflowWrap: "anywhere" }}
                    >
                      {move.notation ?? "Unresolved input"} · {formatVideoTime(move.startTime)}–
                      {formatVideoTime(move.endTime)} · startup {move.phases.startup}, active{" "}
                      {move.phases.active}, recovery {move.phases.recovery} · blockstun{" "}
                      {move.opponentPhases.blockstun} · on block{" "}
                      {move.onBlock == null
                        ? "?"
                        : `${move.onBlock >= 0 ? "+" : ""}${move.onBlock}`}{" "}
                      · on hit{" "}
                      {move.onHit == null ? "?" : `${move.onHit >= 0 ? "+" : ""}${move.onHit}`} Â·
                      hits {move.hits?.length ?? "?"} Â· hitboxes{" "}
                      {move.hitboxStatus === "detected"
                        ? "available"
                        : move.hitboxStatus === "not-found"
                          ? "none visible"
                          : "not analyzed"}{" "}
                      {move.hitboxTracks?.length ? `(${move.hitboxTracks.length} tracks)` : ""}
                    </Button>
                  ))}
                  {inputEvents.length > 0 && (
                    <Paper variant="outlined" sx={{ p: 1.25, mt: 0.5 }}>
                      <Stack spacing={1}>
                        <Box>
                          <Typography variant="subtitle2">State transitions</Typography>
                          <Typography variant="caption" color="text.secondary">
                            Inputs are treated as grounded by default. Mark the input where the
                            character becomes airborne or grounded again; frame-meter resets do not
                            change this state.
                          </Typography>
                        </Box>
                        {inputEvents.map((inputEvent, index) => {
                          const override = stateOverrideForEvent(
                            selectedRecording.analysis!,
                            inputEvent.id,
                          );
                          return (
                            <Stack
                              key={inputEvent.id}
                              direction={{ xs: "column", sm: "row" }}
                              spacing={1}
                              sx={{ alignItems: { sm: "center" } }}
                            >
                              <Button
                                variant="text"
                                size="small"
                                onClick={() => seekTo(inputEvent.time)}
                                sx={{
                                  justifyContent: "flex-start",
                                  minWidth: { sm: 190 },
                                  overflowWrap: "anywhere",
                                }}
                              >
                                Input {index + 1}: {inputEvent.notation} ·{" "}
                                {formatVideoTime(inputEvent.time)}
                              </Button>
                              <ToggleButtonGroup
                                exclusive
                                size="small"
                                value={override?.state ?? null}
                                onChange={(_, value: RecordingAnalysisState | null) => {
                                  void updateInputStateOverride(inputEvent.id, value);
                                }}
                                aria-label={"State from input " + (index + 1)}
                              >
                                <ToggleButton value="airborne">Airborne from here</ToggleButton>
                                <ToggleButton value="grounded">Grounded from here</ToggleButton>
                              </ToggleButtonGroup>
                              {override && (
                                <Button
                                  size="small"
                                  onClick={() => void updateInputStateOverride(inputEvent.id, null)}
                                >
                                  Clear
                                </Button>
                              )}
                            </Stack>
                          );
                        })}
                      </Stack>
                    </Paper>
                  )}
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1}
                    sx={{ alignItems: "center" }}
                  >
                    <Button
                      size="small"
                      variant={showHitboxOverlay ? "contained" : "outlined"}
                      onClick={() => setShowHitboxOverlay((current) => !current)}
                      disabled={
                        !selectedRecording.analysis.moves.some((move) => move.hitboxTracks?.length)
                      }
                    >
                      {showHitboxOverlay ? "Hide CV hitboxes" : "Show CV hitboxes"}
                    </Button>
                    <Button
                      size="small"
                      variant={showAnalysisDebug ? "contained" : "outlined"}
                      onClick={() => setShowAnalysisDebug((current) => !current)}
                      disabled={!analysisDebugReady}
                    >
                      {showAnalysisDebug ? "Hide analysis debugger" : "Show analysis debugger"}
                    </Button>
                    {!analysisDebugReady && (
                      <Typography variant="caption" color="text.secondary">
                        Reprocess this recording to generate frame diagnostics.
                      </Typography>
                    )}
                  </Stack>
                  {showAnalysisDebug && calibrationConfig && (
                    <Paper component="details" variant="outlined" sx={{ p: 1.5, mt: 0.5 }}>
                      <Typography component="summary" sx={{ cursor: "pointer", mb: 1 }}>
                        Calibration controls
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="div"
                        sx={{ mb: 1 }}
                      >
                        Press Enter or leave a field to save it to the persistent configuration.
                        Pixel offsets use the reference resolution shown above. Process current
                        calibration to apply them.
                      </Typography>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={previewCurrentCalibration}
                            onChange={(_, checked) => setPreviewCurrentCalibration(checked)}
                          />
                        }
                        label="Preview current calibration (otherwise show the analysis snapshot)"
                      />
                      <Stack spacing={1.25}>
                        {calibrationGroups.map((group) => (
                          <Box key={group.title}>
                            <Typography variant="caption" color="text.secondary">
                              {group.title}
                            </Typography>
                            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap" }}>
                              {group.fields.map(({ key, label, step }) => (
                                <CalibrationNumberField
                                  key={key}
                                  label={label}
                                  value={calibrationConfig[key]}
                                  onCommit={(value) => updateCalibration(key, String(value))}
                                  step={step ?? 0.1}
                                />
                              ))}
                            </Stack>
                          </Box>
                        ))}
                      </Stack>
                    </Paper>
                  )}
                  {showAnalysisDebug && debugFrame && (
                    <Paper variant="outlined" sx={{ p: 1.5, mt: 0.5 }}>
                      <Stack spacing={1}>
                        <Stack
                          direction={{ xs: "column", sm: "row" }}
                          spacing={1}
                          sx={{ alignItems: "center" }}
                        >
                          <Typography variant="caption" sx={{ minWidth: 150 }}>
                            Frame {debugFrameIndex + 1} / {debugFrames.length} ·{" "}
                            {formatVideoTime(debugFrame.time)}
                          </Typography>
                          <Slider
                            size="small"
                            min={0}
                            max={Math.max(0, debugFrames.length - 1)}
                            step={1}
                            value={debugFrameIndex}
                            onChange={(_, value) =>
                              setDebugFrameIndex(Array.isArray(value) ? value[0] : value)
                            }
                            sx={{ flex: 1, minWidth: 180 }}
                          />
                          <Button size="small" onClick={exportAnalysisDiagnostics}>
                            Export JSON
                          </Button>
                        </Stack>
                        <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                          Input: {debugFrame.inputNotation ?? "none"}
                          {debugFrame.inputButtons.length > 0
                            ? " (" + debugFrame.inputButtons.join(", ") + ")"
                            : ""}{" "}
                          · training: {debugFrame.trainingState} (
                          {debugFrame.trainingScore.toFixed(2)}) · framebar:{" "}
                          {debugFrame.framebarChanged ? "changed" : "stable"} · move:{" "}
                          {debugFrame.moveEvent ?? (debugFrame.activeMove ? "active" : "idle")}
                        </Typography>
                        <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                          P1: {debugFrame.player1Groups || "none"}
                        </Typography>
                        <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                          P2: {debugFrame.player2Groups || "none"}
                        </Typography>
                        <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                          Meter P1 {debugFrame.player1Meter.score.toFixed(2)} (color{" "}
                          {debugFrame.player1Meter.colorScore.toFixed(2)}, edges{" "}
                          {debugFrame.player1Meter.edgeScore.toFixed(2)}) · P2{" "}
                          {debugFrame.player2Meter.score.toFixed(2)} (color{" "}
                          {debugFrame.player2Meter.colorScore.toFixed(2)}, edges{" "}
                          {debugFrame.player2Meter.edgeScore.toFixed(2)})
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ overflowWrap: "anywhere" }}
                        >
                          Input signature: {debugFrame.inputSignature || "none"}
                        </Typography>
                        {debugFrame.inputSegmentStates && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ overflowWrap: "anywhere" }}
                          >
                            Input segments (newest → oldest):{" "}
                            {debugFrame.inputSegmentStates
                              .map((state) => (state === "populated" ? "●" : "·"))
                              .join(" ")}
                          </Typography>
                        )}
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ overflowWrap: "anywhere" }}
                        >
                          Calibration:{" "}
                          {selectedRecording.analysis.detectorConfigSource ?? "unknown"}
                          {debugConfig
                            ? ` · input ${debugConfig.inputSourceX},${debugConfig.inputSourceY} ${debugConfig.inputSourceWidth}×${debugConfig.inputSourceHeight}% · framebar ${debugConfig.framebarSourceWidth}×${debugConfig.framebarSourceHeight}%`
                            : " · reprocess to capture the exact calibration snapshot"}
                        </Typography>
                      </Stack>
                    </Paper>
                  )}
                </Stack>
              )}
              <Box
                ref={videoContainerRef}
                sx={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "16 / 9",
                  minHeight: 180,
                  maxHeight: "65vh",
                  overflow: "hidden",
                  backgroundColor: "#000",
                }}
              >
                <Box
                  component="video"
                  key={selectedRecording.url}
                  ref={videoRef}
                  src={selectedRecording.url}
                  tabIndex={0}
                  aria-label={`Player for ${selectedRecording.name}`}
                  controls={false}
                  preload="metadata"
                  onLoadedMetadata={(event) => {
                    if (!active) return;
                    const video = event.currentTarget;
                    updateVideoContentBox();
                    const nextDuration = video.duration;
                    console.debug("[RecordingViewer] video-loaded-metadata", {
                      duration: nextDuration,
                      currentTime: video.currentTime,
                      readyState: video.readyState,
                      videoWidth: video.videoWidth,
                      videoHeight: video.videoHeight,
                    });
                    setDuration(nextDuration);
                    setClipRange([0, Number.isFinite(nextDuration) ? nextDuration : 0]);
                    if (restoredRecordingId.current !== selectedRecording.id) {
                      restoredRecordingId.current = selectedRecording.id;
                      const savedTime =
                        playbackPositions.current[positionKey(selectedRecording.id)];
                      if (
                        typeof savedTime === "number" &&
                        savedTime > MINIMUM_SAVED_POSITION_SECONDS &&
                        Number.isFinite(nextDuration)
                      ) {
                        video.currentTime = Math.min(savedTime, nextDuration);
                      }
                    }
                    currentFrameIndex.current = frameIndexForTime(video.currentTime);
                    setCurrentTime(video.currentTime);
                  }}
                  onSeeking={(event) => {
                    const video = event.currentTarget;
                    console.debug("[RecordingViewer] video-seeking", {
                      currentTime: video.currentTime,
                      readyState: video.readyState,
                      seeking: video.seeking,
                      paused: video.paused,
                    });
                  }}
                  onSeeked={(event) => {
                    const video = event.currentTarget;
                    if (!steppingFrame.current) {
                      currentFrameIndex.current = frameIndexForTime(video.currentTime);
                    }
                    console.debug("[RecordingViewer] video-seeked", {
                      currentTime: video.currentTime,
                      readyState: video.readyState,
                      seeking: video.seeking,
                      paused: video.paused,
                    });
                  }}
                  onTimeUpdate={(event) => {
                    if (!active) return;
                    const video = event.currentTarget;
                    const nextTime = video.currentTime;
                    if (clipMode && !video.paused && nextTime >= clipRange[1]) {
                      video.currentTime = clipRange[0];
                      currentFrameIndex.current = frameIndexForTime(clipRange[0]);
                      setCurrentTime(clipRange[0]);
                      return;
                    }
                    if (!scrubbing.current && !reviewFrame) {
                      if (!steppingFrame.current) {
                        currentFrameIndex.current = frameIndexForTime(nextTime);
                      }
                      setCurrentTime(nextTime);
                      savePlaybackPosition(selectedRecording.id, nextTime);
                    }
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={(event) => {
                    if (clipMode && duration > 0) {
                      event.currentTarget.currentTime = clipRange[0];
                      currentFrameIndex.current = frameIndexForTime(clipRange[0]);
                      setCurrentTime(clipRange[0]);
                      void event.currentTarget.play();
                    } else {
                      setIsPlaying(false);
                    }
                  }}
                  onClick={togglePlayback}
                  onError={() => {
                    if (!active) return;
                    setPlaybackError(
                      "This video could not be played by the built-in player. The recording container or codec may not be supported yet.",
                    );
                  }}
                  sx={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    backgroundColor: "#000",
                    visibility: reviewFrame ? "hidden" : "visible",
                  }}
                />
                {reviewFrame && (
                  <Box
                    component="img"
                    src={`data:image/jpeg;base64,${reviewFrame.data}`}
                    alt={`Exact decoded frame ${reviewFrame.frameIndex}`}
                    onClick={togglePlayback}
                    sx={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      backgroundColor: "#000",
                      cursor: "pointer",
                    }}
                  />
                )}
                {showHitboxOverlay &&
                  hitboxOverlayBoxes.length > 0 &&
                  videoContentBox.width > 0 && (
                    <Box
                      sx={{
                        position: "absolute",
                        left: videoContentBox.left,
                        top: videoContentBox.top,
                        width: videoContentBox.width,
                        height: videoContentBox.height,
                        pointerEvents: "none",
                      }}
                    >
                      {hitboxOverlayBoxes.map((box) => {
                        const color = hitboxOverlayColor(box.kind);
                        return (
                          <Box
                            key={box.id}
                            sx={{
                              position: "absolute",
                              left: `${box.x}%`,
                              top: `${box.y}%`,
                              width: `${box.width}%`,
                              height: `${box.height}%`,
                              border: `2px solid ${color}`,
                              backgroundColor: `${color}22`,
                              boxSizing: "border-box",
                            }}
                          >
                            <Typography
                              component="span"
                              sx={{
                                position: "absolute",
                                left: 2,
                                top: 1,
                                px: 0.25,
                                color,
                                backgroundColor: "rgba(0, 0, 0, 0.72)",
                                font: "10px monospace",
                                lineHeight: 1.2,
                              }}
                            >
                              {box.kind?.replace("overlay-", "") ?? "hitbox"}
                            </Typography>
                          </Box>
                        );
                      })}
                    </Box>
                  )}
                {showAnalysisDebug &&
                  analysisDebugReady &&
                  debugFrame &&
                  debugRegions &&
                  videoContentBox.width > 0 && (
                    <Box
                      sx={{
                        position: "absolute",
                        left: videoContentBox.left,
                        top: videoContentBox.top,
                        width: videoContentBox.width,
                        height: videoContentBox.height,
                        pointerEvents: "none",
                      }}
                    >
                      <Box
                        sx={{
                          position: "absolute",
                          left: debugRegions.input.x + "%",
                          top: debugRegions.input.y + "%",
                          width: debugRegions.input.width + "%",
                          height: debugRegions.input.height + "%",
                          border: "2px solid #00e5ff",
                          pointerEvents: "none",
                        }}
                      />
                      {debugConfig &&
                        Array.from(
                          { length: Math.max(1, Math.round(debugConfig.inputSegmentCount)) },
                          (_, visualRowIndex) => {
                            const rowTop =
                              debugConfig.inputSegmentTop +
                              visualRowIndex * debugConfig.inputSegmentHeight;
                            const rowIndex =
                              Math.round(debugConfig.inputSegmentCount) - visualRowIndex - 1;
                            const buttonSlots = inputButtonSlotRatios(debugConfig).map(
                              ({ slot, ratio, yRatio }) =>
                                [
                                  slot,
                                  ratio * 100,
                                  yRatio * 100,
                                  inputButtonDisplayColors[slot],
                                ] as const,
                            );
                            return (
                              <Box
                                key={`input-zones-${visualRowIndex}`}
                                sx={{ position: "absolute", inset: 0 }}
                              >
                                <Box
                                  sx={{
                                    position: "absolute",
                                    left:
                                      debugRegions.input.x +
                                      (debugConfig.inputJoystickCenterX *
                                        debugRegions.input.width) /
                                        100 +
                                      "%",
                                    top:
                                      debugRegions.input.y +
                                      ((rowTop + debugConfig.inputSegmentHeight / 2) *
                                        debugRegions.input.height) /
                                        100 +
                                      "%",
                                    width: (36 * debugRegions.input.width) / 100 + "%",
                                    aspectRatio: "1",
                                    transform: "translate(-50%, -50%)",
                                    border: "1px dotted rgba(41, 121, 255, 0.95)",
                                    borderRadius: "50%",
                                    boxSizing: "border-box",
                                  }}
                                />
                                {buttonSlots.map(([slot, x, y, color]) => (
                                  <Box
                                    key={`${slot}-${rowIndex}`}
                                    sx={{
                                      position: "absolute",
                                      left: `calc(${debugRegions.input.x + (x * debugRegions.input.width) / 100}% - ${(debugConfig.inputButtonRegionRadius * videoContentBox.width * debugRegions.input.width) / 10000}px)`,
                                      top: `calc(${debugRegions.input.y + ((rowTop + (y * debugConfig.inputSegmentHeight) / 100) * debugRegions.input.height) / 100}% - ${(debugConfig.inputButtonRegionRadius * videoContentBox.width * debugRegions.input.width) / 10000}px)`,
                                      width: `${(2 * debugConfig.inputButtonRegionRadius * debugRegions.input.width) / 100}%`,
                                      aspectRatio: "1",
                                      border: `1px dashed ${color}`,
                                      borderRadius: "50%",
                                      boxSizing: "border-box",
                                    }}
                                  />
                                ))}
                                <Box
                                  sx={{
                                    position: "absolute",
                                    left:
                                      debugRegions.input.x +
                                      (debugConfig.inputNumberStartX * debugRegions.input.width) /
                                        100 +
                                      "%",
                                    top:
                                      debugRegions.input.y +
                                      ((rowTop +
                                        (debugConfig.inputNumberTop *
                                          debugConfig.inputSegmentHeight) /
                                          100) *
                                        debugRegions.input.height) /
                                        100 +
                                      "%",
                                    width:
                                      ((debugConfig.inputNumberEndX -
                                        debugConfig.inputNumberStartX) *
                                        debugRegions.input.width) /
                                        100 +
                                      "%",
                                    height:
                                      (debugConfig.inputSegmentHeight *
                                        (debugConfig.inputNumberHeight / 100) *
                                        debugRegions.input.height) /
                                        100 +
                                      "%",
                                    border: "2px dashed rgba(255, 64, 220, 0.95)",
                                    backgroundColor: "rgba(255, 64, 220, 0.08)",
                                    boxSizing: "border-box",
                                  }}
                                >
                                  <Typography
                                    component="span"
                                    sx={{
                                      position: "absolute",
                                      right: 2,
                                      bottom: 1,
                                      px: 0.25,
                                      color: "#ff9bea",
                                      backgroundColor: "rgba(0, 0, 0, 0.75)",
                                      font: "10px monospace",
                                      lineHeight: 1.2,
                                    }}
                                  >
                                    number
                                  </Typography>
                                  {[0, 1, 2].map((digitIndex) => (
                                    <Box
                                      key={`digit-zone-${rowIndex}-${digitIndex}`}
                                      sx={{
                                        position: "absolute",
                                        left:
                                          ((debugConfig.inputNumberDigit1X +
                                            digitIndex *
                                              (debugConfig.inputNumberDigitWidth +
                                                debugConfig.inputNumberDigitGap) -
                                            debugConfig.inputNumberStartX) /
                                            (debugConfig.inputNumberEndX -
                                              debugConfig.inputNumberStartX)) *
                                            100 +
                                          "%",
                                        top:
                                          ((debugConfig.inputNumberDigitTop -
                                            debugConfig.inputNumberTop) /
                                            debugConfig.inputNumberHeight) *
                                            100 +
                                          "%",
                                        width:
                                          (debugConfig.inputNumberDigitWidth /
                                            (debugConfig.inputNumberEndX -
                                              debugConfig.inputNumberStartX)) *
                                            100 +
                                          "%",
                                        height:
                                          (debugConfig.inputNumberDigitHeight /
                                            debugConfig.inputNumberHeight) *
                                            100 +
                                          "%",
                                        border: "1px solid rgba(255, 190, 245, 0.95)",
                                        boxSizing: "border-box",
                                      }}
                                    />
                                  ))}
                                </Box>
                              </Box>
                            );
                          },
                        )}
                      {Array.from(
                        { length: Math.max(1, Math.round(debugRegions.inputSegments.count)) },
                        (_, visualRowIndex) => {
                          const rowTop =
                            debugRegions.inputSegments.top +
                            visualRowIndex * debugRegions.inputSegments.height;
                          const rowIndex =
                            Math.round(debugRegions.inputSegments.count) - visualRowIndex - 1;
                          return (
                            <Box
                              key={`input-segment-${visualRowIndex}`}
                              sx={{
                                position: "absolute",
                                left: debugRegions.input.x + "%",
                                top:
                                  debugRegions.input.y +
                                  (rowTop * debugRegions.input.height) / 100 +
                                  "%",
                                width: debugRegions.input.width + "%",
                                height:
                                  (debugRegions.inputSegments.height * debugRegions.input.height) /
                                    100 +
                                  "%",
                                border: "1px solid rgba(255, 255, 255, 0.55)",
                                boxSizing: "border-box",
                                pointerEvents: "none",
                              }}
                            >
                              <Typography
                                component="span"
                                sx={{
                                  position: "absolute",
                                  left: 2,
                                  top: 1,
                                  px: 0.25,
                                  color: "#fff",
                                  backgroundColor: "rgba(0, 0, 0, 0.65)",
                                  font: "10px monospace",
                                  lineHeight: 1.2,
                                }}
                              >
                                r{rowIndex}
                              </Typography>
                            </Box>
                          );
                        },
                      )}
                      <Box
                        sx={{
                          position: "absolute",
                          left: debugRegions.player1Framebar.x + "%",
                          top: debugRegions.player1Framebar.y + "%",
                          width: debugRegions.player1Framebar.width + "%",
                          height: debugRegions.player1Framebar.height + "%",
                          border: "2px solid #ff4081",
                          pointerEvents: "none",
                        }}
                      />
                      <Box
                        sx={{
                          position: "absolute",
                          left: debugRegions.player2Framebar.x + "%",
                          top: debugRegions.player2Framebar.y + "%",
                          width: debugRegions.player2Framebar.width + "%",
                          height: debugRegions.player2Framebar.height + "%",
                          border: "2px solid #ff9800",
                          pointerEvents: "none",
                        }}
                      />
                      {[
                        {
                          key: "p1",
                          region: debugRegions.player1Framebar,
                          states: debugFrame.player1States,
                          yellow: debugFrame.player1Yellow,
                        },
                        {
                          key: "p2",
                          region: debugRegions.player2Framebar,
                          states: debugFrame.player2States,
                          yellow: debugFrame.player2Yellow,
                        },
                      ].map((framebar) => (
                        <Box
                          key={framebar.key}
                          sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                        >
                          {Array.from(
                            { length: Math.max(1, Math.round(debugRegions.framebarSamples.count)) },
                            (_, sampleIndex) => {
                              const sampleX = Math.min(
                                100,
                                debugRegions.framebarSamples.start +
                                  sampleIndex * debugRegions.framebarSamples.spacing,
                              );
                              const state = framebar.states[sampleIndex];
                              return (
                                <Box key={`${framebar.key}-sample-${sampleIndex}`}>
                                  <Box
                                    sx={{
                                      position: "absolute",
                                      left:
                                        framebar.region.x +
                                        (sampleX * framebar.region.width) / 100 +
                                        "%",
                                      top:
                                        framebar.region.y +
                                        (debugRegions.framebarSamples.baseY *
                                          framebar.region.height) /
                                          100 +
                                        "%",
                                      width: 2,
                                      height: 5,
                                      backgroundColor: debugFramebarColor(state),
                                    }}
                                  />
                                  <Box
                                    sx={{
                                      position: "absolute",
                                      left:
                                        framebar.region.x +
                                        (sampleX * framebar.region.width) / 100 +
                                        "%",
                                      top:
                                        framebar.region.y +
                                        (debugRegions.framebarSamples.yellowY *
                                          framebar.region.height) /
                                          100 +
                                        "%",
                                      width: 2,
                                      height: 3,
                                      backgroundColor:
                                        framebar.yellow[sampleIndex] === "Y"
                                          ? "#ffff00"
                                          : "#0088ff",
                                    }}
                                  />
                                </Box>
                              );
                            },
                          )}
                        </Box>
                      ))}
                      {debugFrame.inputMarkers.map((marker, index) => (
                        <Box
                          key={marker.row + "-" + marker.color + "-" + index}
                          sx={{
                            position: "absolute",
                            left:
                              "calc(" +
                              (debugRegions.input.x + marker.x * debugRegions.input.width) +
                              "% - 4px)",
                            top:
                              "calc(" +
                              (debugRegions.input.y + marker.y * debugRegions.input.height) +
                              "% - 4px)",
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            backgroundColor:
                              marker.color === "cyan"
                                ? "#00e5ff"
                                : marker.color === "yellow"
                                  ? "#ffeb3b"
                                  : marker.color === "blue"
                                    ? "#2979ff"
                                    : "#f44336",
                            border: "1px solid #fff",
                            pointerEvents: "none",
                          }}
                        />
                      ))}
                    </Box>
                  )}
                <Button
                  variant="contained"
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    togglePlayback();
                  }}
                  disabled={!duration}
                  sx={{ position: "absolute", bottom: 12, left: 12, minWidth: 92 }}
                >
                  {isPlaying ? "Pause" : "Play"}
                </Button>
              </Box>
              <Stack spacing={0.5}>
                {timelineChapters.length > 0 && (
                  <Box
                    aria-label="Recording chapters"
                    sx={{ position: "relative", height: 22, mx: "6px", mt: 0.5 }}
                  >
                    <Box
                      sx={{
                        position: "absolute",
                        bottom: 2,
                        left: 0,
                        right: 0,
                        borderBottom: 1,
                        borderColor: "divider",
                      }}
                    />
                    {timelineChapters.map((marker, index) => (
                      <Tooltip
                        key={`${marker.time}-${index}`}
                        arrow
                        placement="top"
                        title={
                          <>
                            {marker.titles.map((title, titleIndex) => (
                              <Typography
                                key={`${title}-${titleIndex}`}
                                variant="caption"
                                component="div"
                              >
                                {title}
                              </Typography>
                            ))}
                            <Typography variant="caption" component="div" sx={{ opacity: 0.75 }}>
                              {formatVideoTime(marker.time)}
                            </Typography>
                          </>
                        }
                      >
                        <Box
                          component="button"
                          type="button"
                          aria-label={`Seek to ${marker.titles.join(" and ")} at ${formatVideoTime(marker.time)}`}
                          onClick={() => seekTo(marker.time)}
                          sx={{
                            position: "absolute",
                            left: `${marker.positionPercent}%`,
                            bottom: 0,
                            transform: "translateX(-50%)",
                            width: 12,
                            height: 22,
                            p: 0,
                            border: 0,
                            borderRadius: 0.5,
                            background: "transparent",
                            cursor: "pointer",
                            "&::after": {
                              content: '""',
                              position: "absolute",
                              left: "50%",
                              bottom: 1,
                              transform: "translateX(-50%)",
                              width: 3,
                              height: 17,
                              borderRadius: 1,
                              bgcolor: marker.gameStart ? "warning.main" : "info.light",
                            },
                            "&:hover::after, &:focus-visible::after": { width: 5, height: 20 },
                            "&:focus-visible": {
                              outline: "2px solid",
                              outlineColor: "primary.main",
                            },
                          }}
                        />
                      </Tooltip>
                    ))}
                  </Box>
                )}
                {clipMode ? (
                  <>
                    <Slider
                      aria-label="Clip start and end"
                      size="small"
                      value={clipRange}
                      marks={duration ? [{ value: Math.min(currentTime, duration) }] : undefined}
                      min={0}
                      max={duration || 0}
                      step={0.01}
                      disableSwap
                      valueLabelDisplay="auto"
                      valueLabelFormat={(value) => formatVideoTime(value)}
                      onChange={(_, value) => {
                        if (!Array.isArray(value)) return;
                        const [start, end] = value;
                        if (start == null || end == null) return;
                        setClipRange([start, end]);
                        if (start !== clipRange[0]) {
                          seekTo(start);
                        } else if (currentTime > end) {
                          seekTo(end);
                        }
                      }}
                      sx={{
                        ...currentPositionMarkerSx,
                        ...(clippedTimelineBackground
                          ? {
                              "& .MuiSlider-rail": {
                                opacity: 1,
                                background: clippedTimelineBackground,
                                height: 4,
                              },
                              "& .MuiSlider-track": {
                                backgroundColor: "transparent",
                                borderColor: "transparent",
                              },
                            }
                          : {}),
                      }}
                      disabled={!duration}
                    />
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      sx={{ alignItems: { sm: "center" } }}
                    >
                      <Typography variant="body2" sx={{ minWidth: 150 }}>
                        Clip {formatVideoTime(clipRange[0])} – {formatVideoTime(clipRange[1])}
                        <Box component="span" color="text.secondary" sx={{ ml: 0.5 }}>
                          {`(${formatVideoTime(Math.max(0, clipRange[1] - clipRange[0]))})`}
                        </Box>
                      </Typography>
                      <Button
                        variant="text"
                        size="small"
                        onClick={() => {
                          setClipRange([0, duration]);
                          setClipMode(false);
                        }}
                        disabled={!duration}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() => void exportClip()}
                        disabled={exportingClip || !duration || clipRange[1] <= clipRange[0]}
                      >
                        {exportingClip ? "Exporting..." : "Export clip"}
                      </Button>
                    </Stack>
                  </>
                ) : (
                  <>
                    <Slider
                      aria-label="Video timeline"
                      size="small"
                      marks={duration ? [{ value: Math.min(currentTime, duration) }] : undefined}
                      min={0}
                      max={duration || 0}
                      step={0.01}
                      value={Math.min(currentTime, duration || 0)}
                      onChange={(_, value) => {
                        scrubbing.current = true;
                        seekTo(Array.isArray(value) ? value[0] : value);
                      }}
                      onChangeCommitted={() => {
                        scrubbing.current = false;
                        if (videoRef.current) {
                          currentFrameIndex.current = frameIndexForTime(
                            videoRef.current.currentTime,
                          );
                          setCurrentTime(videoRef.current.currentTime);
                        }
                      }}
                      sx={{
                        ...currentPositionMarkerSx,
                        ...(clippedTimelineBackground
                          ? {
                              "& .MuiSlider-rail": {
                                opacity: 1,
                                background: clippedTimelineBackground,
                                height: 4,
                              },
                              "& .MuiSlider-track": {
                                backgroundColor: "transparent",
                                borderColor: "transparent",
                              },
                            }
                          : {}),
                      }}
                      disabled={!duration}
                    />
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      sx={{ alignItems: { sm: "center" } }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
                      </Typography>
                      {reviewFrame && (
                        <Typography variant="caption" color="primary.main">
                          Exact decoded frame {reviewFrame.frameIndex}
                        </Typography>
                      )}
                      {reviewLoading && (
                        <Typography variant="caption" color="text.secondary">
                          Decoding exact frame…
                        </Typography>
                      )}
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ ml: { sm: "auto" } }}
                      >
                        E: forward frame | Q: backward frame
                      </Typography>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<SceneMarkerIcon />}
                        onClick={() => {
                          setClipRange([0, duration]);
                          setClipMode(true);
                        }}
                        disabled={!duration}
                      >
                        Create a clip
                      </Button>
                      {selectedRecording?.name.toLowerCase().endsWith(".mp4") &&
                        !selectedRecording.clip && (
                          <Button
                            variant="outlined"
                            size="small"
                            disabled={Boolean(f10ClipsId) || Boolean(gameChaptersId)}
                            onClick={() => void createF10Clips(selectedRecording)}
                          >
                            {f10ClipsId === selectedRecording.id
                              ? "Creating clips from manual chapters..."
                              : "Create 30-second clips from manual chapters"}
                          </Button>
                        )}
                    </Stack>
                  </>
                )}
              </Stack>
              {clipExportNotice && <Alert severity="success">{clipExportNotice}</Alert>}
              {clipExportError && <Alert severity="error">{clipExportError}</Alert>}
              {chapterLoadError && (
                <Alert severity="warning">Could not read MP4 chapters: {chapterLoadError}</Alert>
              )}
              {playbackError && <Alert severity="warning">{playbackError}</Alert>}
              {(selectedRecording.clip || linkedClips.length > 0) && (
                <>
                  <Divider />
                  <Stack spacing={0.75}>
                    <Typography variant="subtitle2">Related recordings</Typography>
                    {selectedRecording.clip && (
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <Typography variant="body2" color="text.secondary">
                          Original video:
                        </Typography>
                        {sourceRecording ? (
                          <Button
                            variant="text"
                            size="small"
                            onClick={() => selectRecording(sourceRecording.id)}
                            sx={{ justifyContent: "flex-start", overflowWrap: "anywhere" }}
                          >
                            {sourceRecording.name}
                          </Button>
                        ) : (
                          <Typography variant="body2">
                            {selectedRecording.clip.sourceRecordingName} (not found)
                          </Typography>
                        )}
                        <Typography variant="caption" color="text.secondary">
                          {formatVideoTime(selectedRecording.clip.startTime)} –{" "}
                          {formatVideoTime(selectedRecording.clip.endTime)}
                        </Typography>
                      </Stack>
                    )}
                    {linkedClips.length > 0 && (
                      <Stack spacing={0.25}>
                        <Typography variant="body2" color="text.secondary">
                          Clips from this video:
                        </Typography>
                        {linkedClips.map((clip) => (
                          <Button
                            key={clip.id}
                            variant="text"
                            size="small"
                            onClick={() => selectRecording(clip.id)}
                            sx={{ justifyContent: "flex-start", overflowWrap: "anywhere" }}
                          >
                            {clip.name} ({formatVideoTime(clip.clip?.startTime ?? 0)} –{" "}
                            {formatVideoTime(clip.clip?.endTime ?? 0)})
                          </Button>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </>
              )}
              {linkedTechCombos.length > 0 && (
                <>
                  <Divider />
                  <Stack spacing={0.75}>
                    <Typography variant="subtitle2">Linked tech</Typography>
                    {linkedTechCombos.map(({ character, combo }) => (
                      <Button
                        key={`${character}-${combo.id}`}
                        variant="text"
                        size="small"
                        onClick={() => selectLinkedCombo(combo)}
                        sx={{ justifyContent: "flex-start", overflowWrap: "anywhere" }}
                      >
                        {character} · {combo.support} · {combo.route || "Unnamed combo"}
                      </Button>
                    ))}
                  </Stack>
                </>
              )}
              {selectedRecording && (
                <>
                  <Divider />
                  <Stack spacing={0.75}>
                    <Typography variant="subtitle2">Tags</Typography>
                    {recordingTagCategories.map((category) => {
                      const selectedTags = selectedRecording.tags ?? emptyRecordingTags;
                      const selected = selectedTags[category.key];
                      if (!category.subtags) {
                        return (
                          <FormControlLabel
                            key={category.key}
                            control={
                              <Checkbox
                                size="small"
                                checked={selected === true}
                                onChange={(event) =>
                                  void updateRecordingTags({
                                    ...selectedTags,
                                    [category.key]: event.target.checked,
                                  } as RecordingTags)
                                }
                                disabled={updatingTagsId === selectedRecording.id}
                              />
                            }
                            label={category.label}
                          />
                        );
                      }
                      const selectedSubtags = Array.isArray(selected) ? (selected as string[]) : [];
                      return (
                        <Stack
                          key={category.key}
                          direction={{ xs: "column", sm: "row" }}
                          spacing={1}
                          sx={{ alignItems: { sm: "center" } }}
                        >
                          <Typography variant="body2" sx={{ minWidth: 64 }}>
                            {category.label}
                          </Typography>
                          <ToggleButtonGroup
                            size="small"
                            exclusive={category.exclusive}
                            value={
                              category.exclusive ? (selectedSubtags[0] ?? null) : selectedSubtags
                            }
                            onChange={(_, nextValue) => {
                              const nextSubtags = category.exclusive
                                ? nextValue
                                  ? [nextValue]
                                  : []
                                : (nextValue as string[]);
                              void updateRecordingTags({
                                ...selectedTags,
                                [category.key]: nextSubtags,
                              } as RecordingTags);
                            }}
                            aria-label={`${category.label} tags`}
                            disabled={updatingTagsId === selectedRecording.id}
                          >
                            {category.subtags.map((subtag) => (
                              <ToggleButton
                                key={subtag}
                                value={subtag.replaceAll(" ", "-")}
                                aria-label={subtag}
                              >
                                {subtag}
                              </ToggleButton>
                            ))}
                          </ToggleButtonGroup>
                        </Stack>
                      );
                    })}
                    {tagError && <Alert severity="error">{tagError}</Alert>}
                  </Stack>
                </>
              )}
              {selectedRecording.metadata && (
                <>
                  <Divider />
                  <Stack spacing={0.35}>
                    <Typography variant="subtitle2">Match metadata</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Match ID: {selectedRecording.metadata.matchId || "Unknown"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Players: {selectedRecording.metadata.player1 || "Unknown"} vs{" "}
                      {selectedRecording.metadata.player2 || "Unknown"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Game {selectedRecording.metadata.gameNumber || "Unknown"} | Mode:{" "}
                      {selectedRecording.metadata.mode || "Unknown"}
                    </Typography>
                    {selectedRecording.replayFileName && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ overflowWrap: "anywhere" }}
                      >
                        Replay: {selectedRecording.replayFileName}
                      </Typography>
                    )}
                  </Stack>
                </>
              )}
            </Stack>
          ) : (
            <Typography color="text.secondary">Select a recorded video to watch it.</Typography>
          )}
        </Paper>
      </Stack>
    </Stack>
  );
}
