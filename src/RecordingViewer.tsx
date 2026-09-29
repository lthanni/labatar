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
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Slider,
  Stack,
  SvgIcon,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { RecordedVideo } from "./recording-types";

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

const FRAME_STEP_SECONDS = 1 / 60;
const PLAYBACK_POSITIONS_STORAGE_KEY = "labatar-recording-playback-positions";
const MINIMUM_SAVED_POSITION_SECONDS = 5;

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

export function RecordingViewer({
  active = true,
  refreshToken = 0,
}: {
  active?: boolean;
  refreshToken?: number;
}) {
  const [folder, setFolder] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<RecordedVideo[]>([]);
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const focusPlayerAfterSelection = useRef(false);
  const steppingFrame = useRef(false);
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

  const visibleRecordings = useMemo(
    () =>
      recordings.filter(
        (recording) =>
          (showFullRecordings && !recording.clip) || (showClips && Boolean(recording.clip)),
      ),
    [recordings, showClips, showFullRecordings],
  );

  const displayedRecordings = useMemo(() => {
    const ungrouped = visibleRecordings.map((recording) => ({ recording, nested: false }));
    if (!showFullRecordings || !showClips) return ungrouped;

    const clipsBySource = new Map<string, RecordedVideo[]>();
    for (const recording of visibleRecordings) {
      const sourceId = recording.clip?.sourceRecordingId;
      if (!sourceId) continue;
      const sourceClips = clipsBySource.get(sourceId) ?? [];
      sourceClips.push(recording);
      clipsBySource.set(sourceId, sourceClips);
    }

    const grouped: Array<{ recording: RecordedVideo; nested: boolean }> = [];
    const nestedIds = new Set<string>();
    for (const recording of visibleRecordings) {
      if (recording.clip) continue;
      grouped.push({ recording, nested: false });
      for (const clip of clipsBySource.get(recording.id) ?? []) {
        grouped.push({ recording: clip, nested: true });
        nestedIds.add(clip.id);
      }
    }

    // Keep clips whose original is unavailable visible at the bottom of the list.
    for (const recording of visibleRecordings) {
      if (recording.clip && !nestedIds.has(recording.id)) {
        grouped.push({ recording, nested: false });
      }
    }
    return grouped;
  }, [showClips, showFullRecordings, visibleRecordings]);

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

  const clippedRegions = useMemo(() => {
    if (!selectedRecording || linkedClips.length === 0 || !Number.isFinite(duration)) return [];
    const ranges = linkedClips
      .map(
        (clip) =>
          [
            Math.max(0, Math.min(duration, clip.clip?.startTime ?? 0)),
            Math.max(0, Math.min(duration, clip.clip?.endTime ?? 0)),
          ] as const,
      )
      .filter(([start, end]) => end > start)
      .sort(([left], [right]) => left - right);
    const merged: Array<[number, number]> = [];
    for (const [start, end] of ranges) {
      const previous = merged[merged.length - 1];
      if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
      else merged.push([start, end]);
    }
    return merged;
  }, [duration, linkedClips, selectedRecording]);

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
        setCurrentTime(clipRange[0]);
      }
      void video.play();
    } else video.pause();
  }, [clipMode, clipRange]);

  const seekTo = useCallback(
    (nextTime: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = nextTime;
      setCurrentTime(nextTime);
      if (selectedRecording) {
        savePlaybackPosition(selectedRecording.id, nextTime);
      }
    },
    [savePlaybackPosition, selectedRecording],
  );

  const stepFrame = useCallback(async (direction: 1 | -1) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || steppingFrame.current) return;
    steppingFrame.current = true;
    const startingTime = video.currentTime;
    video.pause();
    const wasMuted = video.muted;
    video.muted = true;
    try {
      if (direction < 0) {
        video.currentTime = Math.max(0, startingTime - FRAME_STEP_SECONDS);
      } else {
        const videoWithFrameCallback = video as HTMLVideoElement & {
          requestVideoFrameCallback?: (
            callback: (now: number, metadata: { mediaTime: number }) => void,
          ) => number;
        };
        if (typeof videoWithFrameCallback.requestVideoFrameCallback === "function") {
          const nextFrame = new Promise<number>((resolve) => {
            videoWithFrameCallback.requestVideoFrameCallback?.call(
              videoWithFrameCallback,
              (_, metadata) => resolve(metadata.mediaTime),
            );
          });
          await video.play();
          const frameTime = await nextFrame;
          video.pause();
          video.currentTime =
            frameTime > startingTime
              ? frameTime
              : Math.min(video.duration, startingTime + FRAME_STEP_SECONDS);
        } else {
          video.currentTime = Math.min(video.duration, startingTime + FRAME_STEP_SECONDS);
        }
      }
      setCurrentTime(video.currentTime);
    } catch {
      video.pause();
      video.currentTime =
        direction < 0
          ? Math.max(0, startingTime - FRAME_STEP_SECONDS)
          : Math.min(video.duration, startingTime + FRAME_STEP_SECONDS);
      setCurrentTime(video.currentTime);
    } finally {
      video.muted = wasMuted;
      steppingFrame.current = false;
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
      void stepFrame(key === "e" ? 1 : -1);
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
            width: { xs: "100%", md: 330 },
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
            <Stack direction={{ xs: "column", sm: "row", md: "column" }}>
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
          </Stack>
          {recordings.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 2, textAlign: "left" }}>
              No recordings found.
            </Typography>
          ) : visibleRecordings.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 2, textAlign: "left" }}>
              No recordings match the selected filters.
            </Typography>
          ) : (
            <List dense disablePadding sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {displayedRecordings.map(({ recording, nested }) => (
                <ListItemButton
                  key={recording.id}
                  selected={recording.id === selectedId}
                  draggable={editingRecordingId !== recording.id}
                  onClick={() => {
                    if (editingRecordingId !== recording.id) selectRecording(recording.id);
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
                    pl: nested ? 4.5 : 2,
                    cursor: editingRecordingId === recording.id ? "default" : "grab",
                    "&:active": {
                      cursor: editingRecordingId === recording.id ? "default" : "grabbing",
                    },
                    ...(nested
                      ? {
                          position: "relative",
                          "&::before": {
                            content: '""',
                            position: "absolute",
                            left: 20,
                            top: 0,
                            bottom: 0,
                            borderLeft: 1,
                            borderColor: "divider",
                          },
                          "&::after": {
                            content: '""',
                            position: "absolute",
                            left: 20,
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
              <Typography variant="subtitle1" sx={{ overflowWrap: "anywhere" }}>
                {selectedRecording.name}
              </Typography>
              <Box
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
                    const nextDuration = video.duration;
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
                    setCurrentTime(video.currentTime);
                  }}
                  onTimeUpdate={(event) => {
                    const video = event.currentTarget;
                    const nextTime = video.currentTime;
                    if (clipMode && !video.paused && nextTime >= clipRange[1]) {
                      video.currentTime = clipRange[0];
                      setCurrentTime(clipRange[0]);
                      return;
                    }
                    if (!scrubbing.current) {
                      setCurrentTime(nextTime);
                      savePlaybackPosition(selectedRecording.id, nextTime);
                    }
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={(event) => {
                    if (clipMode && duration > 0) {
                      event.currentTarget.currentTime = clipRange[0];
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
                        if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
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
