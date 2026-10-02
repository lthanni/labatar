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
import type { RecordedVideo, RecordingTagCategory, RecordingTags } from "./recording-types";
import type {
  RecordingAnalysisDiagnosticFrame,
  RecordingAnalysisState,
  RecordingAnalysisStateOverride,
} from "./recording-analysis-types";
import { applyManualInputStateOverrides, stateOverrideForEvent } from "./recording-analysis-state";
import { processRecording, type RecordingProcessorProgress } from "./recording-processor";
import { readDetectorConfig, type DetectorConfig } from "./detector-config";
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
} from "./move-notation";
import { inputButtonDisplayColors, inputButtonSlotRatios } from "./input-display-config";
import { buildRecordingDisplayRows, descendantClipRanges } from "./recording-hierarchy";

function readTechCatalog(): TechCatalog {
  try {
    const stored = JSON.parse(localStorage.getItem(techCatalogStorageKey) ?? "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as TechCatalog)
      : {};
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

function formatParsedInputRoute(
  inputEvents: NonNullable<RecordedVideo["analysis"]>["inputEvents"],
  catalog: TechCatalog,
) {
  if (!inputEvents || inputEvents.length === 0) return [];
  const moves: TechMove[] = Object.values(catalog).flatMap((data) => data.moves ?? []);
  const route: string[] = [];
  let activeRekkaParent: TechMove | null = null;

  for (const event of inputEvents) {
    const matchingMoves = moves.filter((move) => moveNotationsMatch(move.input, event.notation));
    const rekkaParent = matchingMoves.find(
      (move) => move.rekkaFollowupPattern === "directional-button",
    );
    if (rekkaParent) {
      route.push(normalizeMoveNotation(rekkaParent.input) ?? event.notation);
      activeRekkaParent = rekkaParent;
      continue;
    }
    const followupMove = matchingMoves.find(
      (move) => move.dependsOnMoveId === activeRekkaParent?.id,
    );
    if (
      activeRekkaParent &&
      isDirectionalButtonFollowup(event.notation) &&
      (activeRekkaParent.rekkaFollowupPattern === "directional-button" || followupMove)
    ) {
      const notation =
        normalizeMoveNotation(followupMove?.input ?? event.notation) ?? event.notation;
      route[route.length - 1] = `${route.at(-1) ?? ""}~${notation}`;
      continue;
    }
    route.push(event.notation);
    activeRekkaParent = null;
  }
  return route;
}

const FRAME_RATE = 60;
const FRAME_SEEK_TIMEOUT_MS = 2000;
const FRAME_STEP_QUEUE_LIMIT = 60;
const PLAYBACK_POSITIONS_STORAGE_KEY = "labatar-recording-playback-positions";
const MINIMUM_SAVED_POSITION_SECONDS = 5;
const DETECTOR_CONFIG_STORAGE_KEY = "avatar-overlay-config";
const emptyRecordingTags: RecordingTags = { match: [], lab: [], combo: false, pressure: false };

type FrameStepTrigger = {
  key: string;
  repeat: boolean;
};

function frameIndexForTime(time: number) {
  return Math.max(0, Math.round(time * FRAME_RATE));
}

function seekVideoToTime(video: HTMLVideoElement, targetTime: number) {
  if (!video.seeking && Math.abs(video.currentTime - targetTime) < 0.0001) {
    return Promise.resolve(video.currentTime);
  }

  return new Promise<number>((resolve, reject) => {
    let timeoutId: number | undefined;
    const cleanup = () => {
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
    const handleSeeked = () => {
      cleanup();
      resolve(video.currentTime);
    };
    const handleError = () => {
      cleanup();
      reject(new Error("The video seek failed."));
    };

    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("The video seek timed out."));
    }, FRAME_SEEK_TIMEOUT_MS);

    try {
      video.currentTime = targetTime;
      if (!video.seeking && Math.abs(video.currentTime - targetTime) < 0.0001) {
        handleSeeked();
      }
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
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

function PencilIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24">
      <path d="m3 17.25 9.06-9.06 3.75 3.75L6.75 21H3v-3.75ZM14.06 7.94l1.42-1.42a2 2 0 0 1 2.83 0l.17.17a2 2 0 0 1 0 2.83l-1.42 1.42-3-3ZM3 3h8v2H5v14h14v-6h2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
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
}: {
  active?: boolean;
  refreshToken?: number;
}) {
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
  const [clipRange, setClipRange] = useState<[number, number]>([0, 0]);
  const [clipMode, setClipMode] = useState(false);
  const [exportingClip, setExportingClip] = useState(false);
  const [clipExportNotice, setClipExportNotice] = useState<string | null>(null);
  const [clipExportError, setClipExportError] = useState<string | null>(null);
  const [showFullRecordings, setShowFullRecordings] = useState(true);
  const [showClips, setShowClips] = useState(true);
  const [selectedTagFilters, setSelectedTagFilters] = useState<RecordingTags>(emptyRecordingTags);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [editingRecordingId, setEditingRecordingId] = useState<string | null>(null);
  const [editingRecordingName, setEditingRecordingName] = useState("");
  const [renamingRecordingId, setRenamingRecordingId] = useState<string | null>(null);
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
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.recordings.list();
      setFolder(result.folder);
      setRecordings(result.recordings);
      setSelectedId((current) =>
        result.recordings.some((recording) => recording.id === current)
          ? current
          : (result.recordings[0]?.id ?? null),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecordings();
  }, [loadRecordings, refreshToken]);

  const selectedRecording = useMemo(
    () => recordings.find((recording) => recording.id === selectedId) ?? null,
    [recordings, selectedId],
  );

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

  const displayedRecordings = useMemo(
    () => buildRecordingDisplayRows(tagFilteredRecordings, showFullRecordings, showClips),
    [showClips, showFullRecordings, tagFilteredRecordings],
  );

  const selectRecording = useCallback(
    (recordingId: string) => {
      if (selectedRecording && videoRef.current) {
        savePlaybackPosition(selectedRecording.id, videoRef.current.currentTime);
      }
      setPlaybackError(null);
      setClipExportNotice(null);
      setClipExportError(null);
      setRenameError(null);
      setIsPlaying(false);
      setCurrentTime(0);
      currentFrameIndex.current = 0;
      setDuration(0);
      setClipRange([0, 0]);
      setClipMode(false);
      restoredRecordingId.current = null;
      focusPlayerAfterSelection.current = true;
      setSelectedId(recordingId);
    },
    [savePlaybackPosition, selectedRecording],
  );

  useEffect(() => {
    const syncTechCatalog = () => setTechCatalog(readTechCatalog());
    const handleTechRecordingSelection = (event: Event) => {
      const recordingId = (event as CustomEvent<string>).detail;
      if (typeof recordingId !== "string") return;
      if (recordings.some((recording) => recording.id === recordingId)) {
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
    if (selectedId && visibleRecordings.some((recording) => recording.id === selectedId)) return;
    if (visibleRecordings[0]) selectRecording(visibleRecordings[0].id);
    else if (selectedId) setSelectedId(null);
  }, [selectRecording, selectedId, visibleRecordings]);

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
      await loadRecordings();
      videoRef.current?.pause();
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setClipRange([0, 0]);
      setClipMode(false);
      restoredRecordingId.current = null;
      setSelectedId(renamed.id);
      setEditingRecordingId(null);
      setEditingRecordingName("");
    } catch (renameActionError) {
      setRenameError(
        renameActionError instanceof Error ? renameActionError.message : String(renameActionError),
      );
    } finally {
      setRenamingRecordingId(null);
    }
  }, [editingRecordingId, editingRecordingName, loadRecordings]);

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

  const processSelectedRecording = useCallback(async () => {
    if (!window.electronAPI?.recordings || !selectedRecording) return;
    setProcessingRecordingId(selectedRecording.id);
    setAnalysisProgress(null);
    setAnalysisError(null);
    try {
      const analysis = await processRecording(
        selectedRecording.url,
        setAnalysisProgress,
        videoRef.current ?? undefined,
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
      setProcessingRecordingId(null);
      setAnalysisProgress(null);
    }
  }, [selectedRecording]);

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
  }, [clipMode, clipRange]);

  const seekTo = useCallback(
    (nextTime: number) => {
      const video = videoRef.current;
      if (!video) return;
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
  useEffect(() => {
    const currentConfig = readDetectorConfig();
    setCalibrationConfig(analysisConfig ? { ...currentConfig, ...analysisConfig } : currentConfig);
  }, [selectedRecording?.id, analysisConfig]);
  const debugConfig = calibrationConfig ?? analysisConfig;
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

  const updateCalibration = useCallback((key: keyof DetectorConfig, value: string) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;
    setCalibrationConfig((current) => {
      const next = { ...(current ?? readDetectorConfig()), [key]: numericValue };
      localStorage.setItem(DETECTOR_CONFIG_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

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
    video.currentTime = debugFrame.time;
    currentFrameIndex.current = frameIndexForTime(debugFrame.time);
    setCurrentTime(debugFrame.time);
  }, [debugFrame, showAnalysisDebug]);

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

  const stepFrame = useCallback(async (direction: 1 | -1, trigger: FrameStepTrigger) => {
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
    const stepStartedAt = performance.now();
    const startingTime = video.currentTime;
    const durationFrame = frameIndexForTime(video.duration);
    const trackedFrame = currentFrameIndex.current;
    const startingFrame = Math.min(
      durationFrame,
      trackedFrame == null ? frameIndexForTime(startingTime) : trackedFrame,
    );
    const targetFrame = Math.min(durationFrame, Math.max(0, startingFrame + direction));
    const targetTime = Math.min(video.duration, targetFrame / FRAME_RATE);
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
      console.debug("[RecordingViewer] frame-step seek", {
        startingTime,
        startingFrame,
        targetTime,
        targetFrame,
        direction,
        seeking: video.seeking,
        readyState: video.readyState,
      });
      const settledTime = await seekVideoToTime(video, targetTime);
      const settledFrame = Math.round(settledTime * FRAME_RATE);
      console.debug("[RecordingViewer] frame-step seek-settled", {
        startingTime,
        startingFrame,
        targetTime,
        targetFrame,
        settledTime,
        settledFrame,
        deltaFrames: targetFrame - startingFrame,
        settledTimestampFrameDelta: settledFrame - startingFrame,
        errorSeconds: settledTime - targetTime,
        errorFrames: (settledTime - targetTime) * FRAME_RATE,
        readyState: video.readyState,
        seeking: video.seeking,
        paused: video.paused,
      });
      currentFrameIndex.current = targetFrame;
      setCurrentTime(settledTime);
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
      setCurrentTime(video.currentTime);
    } finally {
      steppingFrame.current = false;
      const endingQuality = video.getVideoPlaybackQuality?.();
      const queuedDirection = queuedFrameSteps.current.shift();
      console.debug("[RecordingViewer] frame-step end", {
        direction,
        startingTime,
        endingTime: video.currentTime,
        deltaSeconds: video.currentTime - startingTime,
        deltaFrames:
          currentFrameIndex.current != null ? currentFrameIndex.current - startingFrame : undefined,
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
  }, []);

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
                <ListItemButton
                  key={recording.id}
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
                      event.target !== event.currentTarget ||
                      (event.key !== "Enter" && event.key !== " ")
                    ) {
                      return;
                    }
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
                    pl: 2 + depth * 2.5,
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
                  title={editingRecordingId === recording.id ? undefined : "Drag to share"}
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
                    <>
                      <ListItemText
                        primary={recording.name}
                        secondary={`${formatFileSize(recording.size)} | ${formatModifiedAt(recording.modifiedAt)}`}
                        slotProps={{
                          primary: { sx: { overflowWrap: "anywhere" } },
                        }}
                      />
                      <Tooltip title="Rename recording">
                        <IconButton
                          edge="end"
                          size="small"
                          aria-label={`Rename ${recording.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            beginRename(recording);
                          }}
                        >
                          <PencilIcon />
                        </IconButton>
                      </Tooltip>
                    </>
                  )}
                </ListItemButton>
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
                  onClick={() => void processSelectedRecording()}
                  disabled={processingRecordingId === selectedRecording.id}
                >
                  {processingRecordingId === selectedRecording.id
                    ? "Processing recording..."
                    : "Process recording"}
                </Button>
              </Stack>
              {processingRecordingId === selectedRecording.id && analysisProgress && (
                <Stack spacing={0.5}>
                  <LinearProgress
                    variant="determinate"
                    value={(analysisProgress.completed / Math.max(1, analysisProgress.total)) * 100}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Analyzing {formatVideoTime(analysisProgress.time)} of{" "}
                    {formatVideoTime(analysisProgress.duration)}
                  </Typography>
                </Stack>
              )}
              {analysisError && <Alert severity="error">{analysisError}</Alert>}
              {selectedRecording.analysis && (
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
                          ~ indicates a followup in a configured rekka sequence.
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
                      Â· hits {move.hits?.length ?? "?"} Â· hitboxes{" "}
                      {move.hitboxStatus === "detected" ? "available" : "not analyzed"}
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
                  {showAnalysisDebug && debugConfig && (
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
                        Values are saved automatically and update the region preview immediately.
                        Reprocess the recording after tuning to apply them to detection.
                      </Typography>
                      <Stack spacing={1.25}>
                        {calibrationGroups.map((group) => (
                          <Box key={group.title}>
                            <Typography variant="caption" color="text.secondary">
                              {group.title}
                            </Typography>
                            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap" }}>
                              {group.fields.map(({ key, label, step }) => (
                                <TextField
                                  key={key}
                                  label={label}
                                  type="number"
                                  size="small"
                                  value={debugConfig[key]}
                                  onChange={(event) => updateCalibration(key, event.target.value)}
                                  slotProps={{ htmlInput: { min: 0, step: step ?? 0.1 } }}
                                  sx={{ width: 132 }}
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
                    const video = event.currentTarget;
                    const nextTime = video.currentTime;
                    if (clipMode && !video.paused && nextTime >= clipRange[1]) {
                      video.currentTime = clipRange[0];
                      currentFrameIndex.current = frameIndexForTime(clipRange[0]);
                      setCurrentTime(clipRange[0]);
                      return;
                    }
                    if (!scrubbing.current) {
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
                  }}
                />
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
                    </Stack>
                  </>
                )}
              </Stack>
              {clipExportNotice && <Alert severity="success">{clipExportNotice}</Alert>}
              {clipExportError && <Alert severity="error">{clipExportError}</Alert>}
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
