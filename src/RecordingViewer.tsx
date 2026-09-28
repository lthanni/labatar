import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Slider,
  Stack,
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

export function RecordingViewer({ active = true }: { active?: boolean }) {
  const [folder, setFolder] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<RecordedVideo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const steppingFrame = useRef(false);
  const scrubbing = useRef(false);

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
  }, [loadRecordings]);

  const selectedRecording = useMemo(
    () => recordings.find((recording) => recording.id === selectedId) ?? null,
    [recordings, selectedId],
  );

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  const seekTo = useCallback((nextTime: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, []);

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
      if (!active || (key !== "e" && key !== "q") || !selectedRecording) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return;
      }
      event.preventDefault();
      void stepFrame(key === "e" ? 1 : -1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, selectedRecording, stepFrame]);

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2, textAlign: "left" }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1}
          sx={{ alignItems: { md: "center" }, justifyContent: "space-between" }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Recorded videos
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap title={folder ?? undefined}>
              {folder ?? "No recording folder configured"}
            </Typography>
          </Box>
          <Button variant="outlined" onClick={() => void loadRecordings()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh videos"}
          </Button>
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: "stretch" }}>
        <Paper variant="outlined" sx={{ width: { xs: "100%", md: 330 }, flexShrink: 0 }}>
          {recordings.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 2, textAlign: "left" }}>
              No recorded videos found.
            </Typography>
          ) : (
            <List dense disablePadding sx={{ maxHeight: 560, overflowY: "auto" }}>
              {recordings.map((recording) => (
                <ListItemButton
                  key={recording.id}
                  selected={recording.id === selectedId}
                  onClick={() => {
                    setPlaybackError(null);
                    setIsPlaying(false);
                    setCurrentTime(0);
                    setDuration(0);
                    setSelectedId(recording.id);
                  }}
                  sx={{ alignItems: "flex-start" }}
                >
                  <ListItemText
                    primary={recording.name}
                    secondary={`${formatFileSize(recording.size)} | ${formatModifiedAt(recording.modifiedAt)}`}
                    slotProps={{
                      primary: { sx: { overflowWrap: "anywhere" } },
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 0, textAlign: "left" }}>
          {selectedRecording ? (
            <Stack spacing={1.5}>
              <Typography variant="subtitle1" sx={{ overflowWrap: "anywhere" }}>
                {selectedRecording.name}
              </Typography>
              <Box sx={{ position: "relative" }}>
                <Box
                  component="video"
                  key={selectedRecording.url}
                  ref={videoRef}
                  src={selectedRecording.url}
                  controls={false}
                  preload="metadata"
                  onLoadedMetadata={(event) => {
                    setDuration(event.currentTarget.duration);
                    setCurrentTime(event.currentTarget.currentTime);
                  }}
                  onTimeUpdate={(event) => {
                    if (!scrubbing.current) setCurrentTime(event.currentTarget.currentTime);
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onClick={togglePlayback}
                  onError={() =>
                    setPlaybackError(
                      "This video could not be played by the built-in player. The recording container or codec may not be supported yet.",
                    )
                  }
                  sx={{
                    display: "block",
                    width: "100%",
                    maxHeight: "65vh",
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
                <Slider
                  aria-label="Video timeline"
                  size="small"
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
                  disabled={!duration}
                />
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={togglePlayback}
                    disabled={!duration}
                  >
                    {isPlaying ? "Pause" : "Play"}
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                    E: forward frame | Q: backward frame
                  </Typography>
                </Stack>
              </Stack>
              {playbackError && <Alert severity="warning">{playbackError}</Alert>}
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
