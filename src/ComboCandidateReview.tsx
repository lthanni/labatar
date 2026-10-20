import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControlLabel,
  Paper,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { candidateReviewStatus, type ComboCandidate } from "./combo-candidates";
import { candidateRecordingTitle } from "./combo-recording-name";
import type { RecordedVideo } from "./recording-types";

function playbackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function ComboCandidateReview({
  candidate,
  onChanged,
  savedRecording,
  onRecordingSaved,
  savedVideoShownAbove,
}: {
  candidate: ComboCandidate;
  onChanged: (candidate: ComboCandidate, recording?: RecordedVideo) => Promise<void>;
  savedRecording: RecordedVideo | null;
  onRecordingSaved: (recording: RecordedVideo) => void;
  savedVideoShownAbove: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrubbingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [recentlySaved, setRecentlySaved] = useState<{
    candidateId: string;
    recording: RecordedVideo;
  } | null>(null);
  const recording =
    savedRecording ??
    (recentlySaved?.candidateId === candidate.id ? recentlySaved.recording : null);
  const [videoError, setVideoError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [reason, setReason] = useState(candidate.rejectionReason);
  const [youtubeUrl, setYoutubeUrl] = useState(candidate.youtubeUrl);
  const [title, setTitle] = useState(candidateRecordingTitle(candidate.combo));
  const [description, setDescription] = useState(
    `${candidate.combo.characterId} / ${candidate.combo.supportId}\n${candidate.combo.route}`,
  );
  const [madeForKids, setMadeForKids] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setRecentlySaved(null);
    setVideoError(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    scrubbingRef.current = false;
    setReason(candidate.rejectionReason);
    setYoutubeUrl(candidate.youtubeUrl);
    setTitle(candidateRecordingTitle(candidate.combo));
    setDescription(
      `${candidate.combo.characterId} / ${candidate.combo.supportId}\n${candidate.combo.route}`,
    );
    setMessage("");
    setError("");
  }, [candidate.id]);
  useEffect(() => {
    if (candidate.status !== "pending" && candidate.status !== "approved") return;
    let cancelled = false;
    void window.electronAPI?.recordings
      .getYouTubeUploadStatus({ destination: "combos" })
      .then((status) => {
        if (!cancelled) setConnected(status.connected);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [candidate.id, candidate.status]);

  const act = async (action: () => Promise<string>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Candidate action failed.");
    } finally {
      setBusy(false);
    }
  };
  const localRecording = async () => {
    if (recording) return recording;
    const recordingId = await window.electronAPI!.comboCandidates.download({
      id: candidate.id,
      fileSize: candidate.fileSize,
    });
    const library = await window.electronAPI!.recordings.list({ analysisScope: "none" });
    const imported = library.recordings.find((item) => item.id === recordingId);
    if (!imported) throw new Error("Candidate MP4 did not appear in the recording library.");
    setRecentlySaved({ candidateId: candidate.id, recording: imported });
    onRecordingSaved(imported);
    return imported;
  };
  const download = () =>
    void act(async () => {
      await localRecording();
      return "MP4 saved in the recording library.";
    });
  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    void video.play().catch((cause: unknown) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setVideoError(true);
    });
  };
  const reject = () => {
    if (!window.confirm("Reject this candidate and remove its MP4 from the queue?")) return;
    void act(async () => {
      await onChanged(
        await window.electronAPI!.comboCandidates.reject({
          id: candidate.id,
          reason: reason.trim(),
        }),
      );
      setRecentlySaved(null);
      return "Candidate rejected. Its queued MP4 was removed.";
    });
  };
  const markUploaded = async (url: string) => {
    try {
      return await window.electronAPI!.comboCandidates.markUploaded({
        id: candidate.id,
        youtubeUrl: url,
      });
    } catch (cause) {
      // Older deployed Workers still require a separate approval marker.
      if (
        !(cause instanceof Error) ||
        !cause.message.includes("Approve the candidate before saving its YouTube link.")
      )
        throw cause;
      await onChanged(await window.electronAPI!.comboCandidates.approve({ id: candidate.id }));
      return window.electronAPI!.comboCandidates.markUploaded({
        id: candidate.id,
        youtubeUrl: url,
      });
    }
  };
  const upload = () => {
    void act(async () => {
      const source = await localRecording();
      const result = await window.electronAPI!.recordings.uploadToYouTube({
        destination: "combos",
        recordingId: source.id,
        title: title.trim() || candidateRecordingTitle(candidate.combo),
        description: description.trim(),
        tags: [],
        privacyStatus: "unlisted",
        madeForKids,
      });
      setYoutubeUrl(result.url);
      await onChanged(await markUploaded(result.url), source);
      return "Uploaded to YouTube. Review the combo for catalog publishing.";
    });
  };
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle2">Candidate · {candidateReviewStatus(candidate)}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {message && <Alert severity="success">{message}</Alert>}
        <Typography variant="body2" color="text.secondary">
          {candidate.fileName} ({Math.round(candidate.fileSize / 1024 / 1024)} MB)
        </Typography>
        {(candidate.status === "pending" || candidate.status === "approved") && (
          <>
            {!savedVideoShownAbove && (
              <>
                <Box
                  component="video"
                  key={`${candidate.id}:${recording?.id ?? "remote"}`}
                  ref={videoRef}
                  src={recording?.url ?? `labatar-media://candidate/${candidate.id}`}
                  controls
                  preload="metadata"
                  onError={() => setVideoError(true)}
                  onLoadedMetadata={(event) => {
                    setVideoError(false);
                    setDuration(event.currentTarget.duration);
                    setCurrentTime(0);
                  }}
                  onDurationChange={(event) => setDuration(event.currentTarget.duration)}
                  onTimeUpdate={(event) => {
                    if (!scrubbingRef.current) setCurrentTime(event.currentTarget.currentTime);
                  }}
                  onPlay={() => {
                    setPlaying(true);
                    setVideoError(false);
                  }}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  sx={{ width: "100%", maxHeight: 420, bgcolor: "black" }}
                />
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Button size="small" variant="contained" onClick={togglePlayback}>
                    {playing ? "Pause" : "Play"}
                  </Button>
                  <Slider
                    aria-label="Candidate video position"
                    min={0}
                    max={Number.isFinite(duration) && duration > 0 ? duration : 1}
                    value={Math.min(
                      currentTime,
                      Number.isFinite(duration) && duration > 0 ? duration : 1,
                    )}
                    disabled={!Number.isFinite(duration) || duration <= 0}
                    onChange={(_, value) => {
                      if (typeof value === "number") {
                        scrubbingRef.current = true;
                        setCurrentTime(value);
                      }
                    }}
                    onChangeCommitted={(_, value) => {
                      if (typeof value === "number" && videoRef.current)
                        videoRef.current.currentTime = value;
                      scrubbingRef.current = false;
                    }}
                    sx={{ flex: 1 }}
                  />
                  <Typography variant="caption" sx={{ whiteSpace: "nowrap" }}>
                    {playbackTime(currentTime)} / {playbackTime(duration)}
                  </Typography>
                </Stack>
                {videoError && (
                  <Alert severity="warning">
                    Could not play this MP4. Refresh candidates or sign in to the catalog again.
                  </Alert>
                )}
              </>
            )}
            {recording ? (
              <Alert severity="success">
                MP4 saved in the recording library{savedVideoShownAbove ? "; play it above." : "."}
              </Alert>
            ) : (
              <Button
                size="small"
                variant="outlined"
                onClick={download}
                disabled={busy}
                sx={{ alignSelf: "flex-start" }}
              >
                Save MP4 to recording library
              </Button>
            )}
          </>
        )}
        {(candidate.status === "pending" || candidate.status === "approved") && (
          <>
            <Divider />
            <Typography variant="subtitle2">Upload to YouTube</Typography>
            <Typography variant="body2" color="text.secondary">
              The candidate MP4 will be saved to the recording library automatically when you upload
              it.
            </Typography>
            {!connected && (
              <Button
                size="small"
                variant="outlined"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const result = await window.electronAPI!.recordings.connectYouTube({
                      destination: "combos",
                    });
                    setConnected(result.connected);
                    return "YouTube account connected.";
                  })
                }
                sx={{ alignSelf: "flex-start" }}
              >
                Connect combos YouTube account
              </Button>
            )}
            <TextField
              size="small"
              label="Video title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <TextField
              size="small"
              label="Description"
              multiline
              minRows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={madeForKids}
                  onChange={(event) => setMadeForKids(event.target.checked)}
                />
              }
              label="Made for kids"
            />
            <Button
              size="small"
              variant="contained"
              onClick={upload}
              disabled={busy || !connected}
              sx={{ alignSelf: "flex-start" }}
            >
              Upload to YouTube
            </Button>
            <Typography variant="caption" color="text.secondary">
              If YouTube upload succeeded but updating the queue failed, paste its link below and
              save it.
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                label="YouTube URL"
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                fullWidth
              />
              <Button
                disabled={busy || !youtubeUrl.trim()}
                onClick={() =>
                  void act(async () => {
                    await onChanged(await markUploaded(youtubeUrl.trim()));
                    return "YouTube link saved. Review the combo for catalog publishing.";
                  })
                }
              >
                Save link
              </Button>
            </Stack>
          </>
        )}
        {(candidate.status === "pending" || candidate.status === "approved") && (
          <>
            <Divider />
            <TextField
              size="small"
              label="Rejection reason (optional)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button
              size="small"
              variant="outlined"
              color="error"
              onClick={reject}
              disabled={busy}
              sx={{ alignSelf: "flex-start" }}
            >
              Reject candidate
            </Button>
          </>
        )}
        {candidate.status === "rejected" && candidate.rejectionReason && (
          <Typography variant="body2">Reason: {candidate.rejectionReason}</Typography>
        )}
      </Stack>
    </Paper>
  );
}
