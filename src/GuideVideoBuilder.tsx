import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import { useObsRecording } from "./ObsRecordingContext";
import { VideoPicker } from "./VideoPicker";
import type { LocalTechVideo } from "./local-tech";
import type { LocalVideo } from "./video-selection";

type Clip = { key: string; video: LocalVideo | null; title: string; caption: string };
const maxClips = 20;
const newClip = (): Clip => ({
  key: crypto.randomUUID(),
  video: null,
  title: "",
  caption: "",
});
const validCaption = (caption: string) =>
  caption.length <= 240 && caption.trim().split("\n").length <= 4;
const readyToExport = (clip: Clip) => clip.video && validCaption(clip.caption);

export function GuideVideoBuilder({
  disabled,
  initialMetadata,
  startRecordingOnOpen = false,
  onExport,
}: {
  disabled?: boolean;
  initialMetadata?: Pick<LocalTechVideo, "title" | "description">;
  startRecordingOnOpen?: boolean;
  onExport: (video: LocalTechVideo) => void;
}) {
  const { state: obs, moveCapture } = useObsRecording();
  const [open, setOpen] = useState(false);
  const [exportTitle, setExportTitle] = useState("");
  const [description, setDescription] = useState("");
  const [clips, setClips] = useState<Clip[]>(() => [newClip()]);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [recordingKey, setRecordingKey] = useState<string | null>(null);
  const session = useRef<{ id: string; clipKey: string } | null>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [selecting, setSelecting] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const api = window.electronAPI?.guideVideo;
  const working = recordingBusy || exporting || selecting > 0;
  const canClose = !working && !recordingKey;

  const updateClip = useCallback((key: string, patch: Partial<Omit<Clip, "key">>) => {
    setClips((current) => current.map((clip) => (clip.key === key ? { ...clip, ...patch } : clip)));
  }, []);
  const moveClip = (index: number, offset: number) => {
    setClips((current) => {
      const next = [...current];
      const target = index + offset;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    const unsubscribe = window.electronAPI?.recordings.onFinalized((result) => {
      const target = session.current;
      if (!target || target.id !== result.sessionId) return;
      session.current = null;
      setRecordingKey(null);
      if (!result.recordingId) {
        setError(
          result.manifestError ||
            "Could not find the recording. Add the MP4 from disk if it was saved.",
        );
        return;
      }
      setSelecting((count) => count + 1);
      void window
        .electronAPI!.videoLibrary.fromRecording(result.recordingId)
        .then((video) => {
          if (!active) return;
          updateClip(target.clipKey, { video });
        })
        .catch((reason: unknown) => {
          if (active)
            setError(reason instanceof Error ? reason.message : "Could not add the recording.");
        })
        .finally(() => {
          if (active) setSelecting((count) => count - 1);
        });
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [open, updateClip]);

  async function toggleRecording(clip: Clip) {
    if (!api || working) return;
    setRecordingBusy(true);
    setError("");
    const stopping = session.current;
    try {
      if (stopping) {
        if (stopping.clipKey === clip.key) await api.stopRecording(stopping.id);
      } else {
        const started = await api.startRecording(clip.title.trim());
        session.current = { id: started.sessionId, clipKey: clip.key };
        setRecordingKey(clip.key);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not control recording.");
      if (stopping && session.current === stopping) {
        const state = await window.electronAPI?.obs.getState().catch(() => null);
        if (state && !state.recording.active && session.current === stopping) {
          session.current = null;
          setRecordingKey(null);
        }
      }
    } finally {
      setRecordingBusy(false);
    }
  }

  async function render() {
    if (!api || !canClose || !clips.every(readyToExport)) return;
    setExporting(true);
    setError("");
    try {
      const name = exportTitle.trim();
      const video = await api.export({
        title: name,
        clips: clips.flatMap((clip) =>
          clip.video
            ? [{ id: clip.video.id, title: clip.title.trim(), caption: clip.caption }]
            : [],
        ),
      });
      onExport({
        title: name,
        description: description.trim(),
        url: "",
        localVideoId: video.id,
        localFileName: video.fileName,
      });
      setOpen(false);
      setExportTitle("");
      setDescription("");
      setClips([newClip()]);
      setPreviewKey(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not export the guide video.");
    } finally {
      setExporting(false);
    }
  }

  if (!api) return null;
  const canRecord =
    obs.status === "connected" &&
    !obs.automation.enabled &&
    !moveCapture.armed &&
    !obs.recording.active;
  return (
    <>
      <Button
        size="small"
        variant="contained"
        color="info"
        sx={{ alignSelf: "flex-start" }}
        disabled={disabled}
        onClick={() => {
          if (initialMetadata) {
            setExportTitle(initialMetadata.title);
            setDescription(initialMetadata.description);
          }
          setOpen(true);
          if (startRecordingOnOpen && canRecord) {
            const emptyClip = clips.find((clip) => !clip.video);
            if (emptyClip) {
              void toggleRecording(emptyClip);
            } else if (clips.length < maxClips) {
              const clip = newClip();
              setClips((current) => [...current, clip]);
              void toggleRecording(clip);
            }
          }
        }}
      >
        {startRecordingOnOpen ? "Start recording" : "Build captioned video"}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (canClose) setOpen(false);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Build captioned video</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Record or select an MP4 for each clip. Export joins the clips in order and places any
              titles and captions below the footage.
            </Typography>
            <TextField
              label="Video heading (optional)"
              value={exportTitle}
              disabled={exporting}
              onChange={(event) => setExportTitle(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 160 } }}
            />
            <TextField
              label="Description (optional)"
              value={description}
              disabled={exporting}
              onChange={(event) => setDescription(event.target.value)}
              multiline
              minRows={2}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: "wrap", alignItems: "center" }}
            >
              {!recordingKey && obs.status !== "connected" && (
                <Typography variant="caption">Connect OBS to record here.</Typography>
              )}
              {!recordingKey && obs.automation.enabled && (
                <Typography variant="caption">
                  Turn off automatic match recording to record a clip.
                </Typography>
              )}
              {!recordingKey && moveCapture.armed && (
                <Typography variant="caption">Disarm the move take to record a clip.</Typography>
              )}
              {!recordingKey && !recordingBusy && obs.recording.active && (
                <Typography variant="caption">
                  Stop the current OBS recording to record a clip.
                </Typography>
              )}
            </Stack>
            {error && <Alert severity="error">{error}</Alert>}
            {exporting && <LinearProgress aria-label="Exporting guide video" />}
            {clips.map((clip, index) => (
              <Paper key={clip.key} variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Typography variant="subtitle2" sx={{ mr: "auto" }}>
                      Clip {index + 1}
                    </Typography>
                    <IconButton
                      size="small"
                      aria-label={`Move clip ${index + 1} up`}
                      disabled={working || index === 0}
                      onClick={() => moveClip(index, -1)}
                    >
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Move clip ${index + 1} down`}
                      disabled={working || index === clips.length - 1}
                      onClick={() => moveClip(index, 1)}
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                    <Button
                      size="small"
                      disabled={!clip.video || exporting}
                      onClick={() =>
                        setPreviewKey((current) => (current === clip.key ? null : clip.key))
                      }
                    >
                      {previewKey === clip.key ? "Hide preview" : "Preview"}
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      disabled={working || Boolean(recordingKey) || clips.length === 1}
                      onClick={() =>
                        setClips((current) => current.filter((item) => item.key !== clip.key))
                      }
                    >
                      Remove
                    </Button>
                  </Stack>
                  <TextField
                    label={`Clip ${index + 1} title (optional)`}
                    value={clip.title}
                    disabled={exporting}
                    slotProps={{ htmlInput: { maxLength: 80 } }}
                    onChange={(event) => updateClip(clip.key, { title: event.target.value })}
                  />
                  <TextField
                    label={`Clip ${index + 1} caption (optional)`}
                    value={clip.caption}
                    disabled={exporting}
                    multiline
                    minRows={2}
                    maxRows={4}
                    slotProps={{ htmlInput: { maxLength: 240 } }}
                    error={Boolean(clip.caption.trim()) && !validCaption(clip.caption)}
                    helperText="Up to 240 characters and four lines."
                    onChange={(event) => updateClip(clip.key, { caption: event.target.value })}
                  />
                  <Button
                    sx={{ alignSelf: "flex-start" }}
                    variant={clip.video && recordingKey !== clip.key ? "outlined" : "contained"}
                    color={recordingKey === clip.key ? "error" : "info"}
                    disabled={working || (recordingKey ? recordingKey !== clip.key : !canRecord)}
                    onClick={() => void toggleRecording(clip)}
                  >
                    {recordingKey === clip.key
                      ? "Stop and add clip"
                      : clip.video
                        ? "Record replacement"
                        : "Record clip"}
                  </Button>
                  <VideoPicker
                    storage="reference"
                    localMp4Only
                    label={`Clip ${index + 1} MP4`}
                    required
                    disabled={working || Boolean(recordingKey)}
                    preview={previewKey === clip.key}
                    value={clip.video ? { kind: "local", video: clip.video } : null}
                    onBusyChange={(busy) => setSelecting((count) => count + (busy ? 1 : -1))}
                    onChange={(selected) =>
                      updateClip(clip.key, {
                        video: selected?.kind === "local" ? selected.video : null,
                      })
                    }
                  />
                  {previewKey === clip.key &&
                    clip.video &&
                    (clip.title.trim() || clip.caption.trim()) && (
                      <Box
                        sx={{
                          bgcolor: "black",
                          color: "white",
                          textAlign: "center",
                          p: 2,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {clip.title.trim() && (
                          <Typography sx={{ fontWeight: 700 }}>{clip.title}</Typography>
                        )}
                        <Typography>{clip.caption}</Typography>
                      </Box>
                    )}
                </Stack>
              </Paper>
            ))}
            <Button
              size="small"
              variant="contained"
              color="info"
              sx={{ alignSelf: "flex-start" }}
              disabled={working || Boolean(recordingKey) || clips.length >= maxClips}
              onClick={() => setClips((current) => [...current, newClip()])}
            >
              Add clip
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={!canClose} onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button
            variant="contained"
            color="info"
            disabled={!canClose || !clips.every(readyToExport)}
            onClick={() => void render()}
          >
            {exporting ? "Exporting…" : "Export and attach"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
