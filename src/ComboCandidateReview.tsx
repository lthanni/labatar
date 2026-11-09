import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  candidateReviewStatus,
  type CandidateCombo,
  type ComboCandidate,
} from "./combo-candidates";
import { candidateRecordingTitle } from "./combo-recording-name";
import { comboRouteFormatError, formatComboRoute, normalizeComboNoteRanges } from "./combo-notes";
import { comboScreenPositions } from "./combo-screen-position";
import type { RecordedVideo } from "./recording-types";

export function ComboCandidateReview({
  candidate,
  onChanged,
  savedRecording,
  onRecordingSaved,
}: {
  candidate: ComboCandidate;
  onChanged: (candidate: ComboCandidate, recording?: RecordedVideo) => Promise<void>;
  savedRecording: RecordedVideo | null;
  onRecordingSaved: (recording: RecordedVideo) => void;
}) {
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
  const [reason, setReason] = useState(candidate.rejectionReason);
  const [youtubeUrl, setYoutubeUrl] = useState(candidate.youtubeUrl);
  const [title, setTitle] = useState(candidateRecordingTitle(candidate.combo));
  const [description, setDescription] = useState(
    `${candidate.combo.characterId} / ${candidate.combo.supportId}\n${candidate.combo.route}`,
  );
  const [madeForKids, setMadeForKids] = useState(false);
  const [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState<CandidateCombo | null>(null);
  const [draftRouteError, setDraftRouteError] = useState("");
  const [moveIdsText, setMoveIdsText] = useState("");
  const [mechanicsText, setMechanicsText] = useState("");

  useEffect(() => {
    setRecentlySaved(null);
    setReason(candidate.rejectionReason);
    setYoutubeUrl(candidate.youtubeUrl);
    setTitle(candidateRecordingTitle(candidate.combo));
    setDescription(
      `${candidate.combo.characterId} / ${candidate.combo.supportId}\n${candidate.combo.route}`,
    );
    setMessage("");
    setError("");
    setDraft(null);
    setDraftRouteError("");
  }, [candidate.id, candidate.updatedAt]);
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
      try {
        const status = await window.electronAPI!.recordings.getYouTubeUploadStatus({
          destination: "combos",
        });
        setConnected(status.connected);
      } catch {
        // Keep the original action error visible if status cannot be checked.
      }
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
  const updateDraft = <K extends keyof CandidateCombo>(key: K, value: CandidateCombo[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const saveDetails = () => {
    if (!draft || busy) return;
    const route = formatComboRoute(draft.route);
    const routeError = comboRouteFormatError(route);
    if (routeError) {
      setDraftRouteError(routeError);
      return;
    }
    setDraftRouteError("");
    void act(async () => {
      const combo: CandidateCombo = {
        ...draft,
        route,
        moveIds: moveIdsText
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean),
        mechanics: mechanicsText
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean),
        notes: normalizeComboNoteRanges(
          draft.route,
          route,
          draft.notes.filter((note) => note.text.trim()),
        ),
      };
      const updated = await window.electronAPI!.comboCandidates.edit({
        id: candidate.id,
        combo,
        updatedAt: candidate.updatedAt,
      });
      await onChanged(updated);
      setDraft(null);
      return "Candidate details updated. Review approval was reset.";
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
    const routeError = comboRouteFormatError(candidate.combo.route);
    if (routeError) {
      setError(`Format the candidate route before uploading: ${routeError}`);
      return;
    }
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
        <Typography variant="subtitle2" color="secondary.main">
          Candidate · {candidateReviewStatus(candidate)}
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {message && <Alert severity="success">{message}</Alert>}
        <Typography variant="body2" color="text.secondary">
          Queued MP4: {candidate.fileName} ({Math.round(candidate.fileSize / 1024 / 1024)} MB)
        </Typography>
        {candidate.processedInput && (
          <Typography variant="body2" color="text.secondary">
            Processed inputs: {candidate.processedInput.presses.length} presses and{" "}
            {candidate.processedInput.directionChanges.length} direction changes (
            {candidate.inputFacing ?? "right"} facing).
          </Typography>
        )}
        {(candidate.status === "pending" || candidate.status === "approved") && (
          <>
            <Button
              size="small"
              variant="outlined"
              color="secondary"
              onClick={() => {
                setDraft({ ...candidate.combo, notes: [...candidate.combo.notes] });
                setMoveIdsText(candidate.combo.moveIds.join("\n"));
                setMechanicsText(candidate.combo.mechanics.join("\n"));
              }}
              disabled={busy}
              sx={{ alignSelf: "flex-start" }}
            >
              Edit candidate details
            </Button>
            {recording ? (
              <Alert severity="success">
                MP4 saved in the recording library. Play it above or open it there to trim it. The
                local copy is used for YouTube upload.
              </Alert>
            ) : (
              <Alert severity="info">
                The candidate MP4 is not in the recording library yet. Refresh candidates to retry
                its download.
              </Alert>
            )}
          </>
        )}
        {(candidate.status === "pending" || candidate.status === "approved") && (
          <>
            <Divider />
            <Typography variant="subtitle2">Upload to YouTube</Typography>
            {!connected && (
              <Button
                size="small"
                variant="outlined"
                color="secondary"
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
              color="secondary"
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
                color="secondary"
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
      <Dialog open={Boolean(draft)} onClose={() => !busy && setDraft(null)} maxWidth="md" fullWidth>
        <DialogTitle>Edit candidate details</DialogTitle>
        <DialogContent dividers>
          {draft && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Save changes to this queued candidate before its YouTube upload and catalog review.
                The candidate ID and MP4 link stay the same.
              </Typography>
              <Box
                sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}
              >
                <TextField
                  label="Public name"
                  value={draft.name ?? ""}
                  onChange={(event) => updateDraft("name", event.target.value)}
                />
                <TextField
                  label="Damage"
                  required
                  value={draft.damage}
                  onChange={(event) => updateDraft("damage", event.target.value)}
                />
                <TextField
                  label="Route"
                  required
                  multiline
                  minRows={2}
                  value={draft.route}
                  error={Boolean(draftRouteError)}
                  helperText={
                    draftRouteError ||
                    "Saved routes use one space between moves; ~ marks a stance followup. Inputs use casing like 2B and j.2C."
                  }
                  onChange={(event) => {
                    setDraftRouteError("");
                    updateDraft("route", event.target.value);
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            notes: current.notes.map(({ range: _range, ...note }) => note),
                          }
                        : current,
                    );
                  }}
                  sx={{ gridColumn: "1 / -1" }}
                />
                {draft.route && draft.route !== formatComboRoute(draft.route) && (
                  <Button
                    size="small"
                    color="secondary"
                    onClick={() => {
                      setDraft((current) => {
                        if (!current) return current;
                        const route = formatComboRoute(current.route);
                        return {
                          ...current,
                          route,
                          notes: normalizeComboNoteRanges(current.route, route, current.notes),
                        };
                      });
                      setDraftRouteError("");
                    }}
                    sx={{ justifySelf: "start" }}
                  >
                    Format route
                  </Button>
                )}
                <TextField
                  select
                  label="Screen position"
                  value={draft.screenPosition}
                  onChange={(event) => updateDraft("screenPosition", event.target.value)}
                  slotProps={{ select: { native: true } }}
                >
                  {comboScreenPositions.map((position) => (
                    <option key={position} value={position}>
                      {position}
                    </option>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Editor difficulty"
                  value={draft.difficulty ?? ""}
                  onChange={(event) =>
                    updateDraft(
                      "difficulty",
                      event.target.value ? Number(event.target.value) : undefined,
                    )
                  }
                  slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                >
                  <option value="">Unrated</option>
                  {[1, 2, 3, 4, 5].map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </TextField>
                <TextField
                  label="Pips"
                  type="number"
                  value={draft.resourceCosts.pips ?? 0}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            resourceCosts: {
                              ...current.resourceCosts,
                              pips: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                            },
                          }
                        : current,
                    )
                  }
                  slotProps={{ htmlInput: { min: 0 } }}
                />
                <TextField
                  label="Flow"
                  type="number"
                  value={draft.resourceCosts.flow ?? 0}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            resourceCosts: {
                              ...current.resourceCosts,
                              flow: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                            },
                          }
                        : current,
                    )
                  }
                  slotProps={{ htmlInput: { min: 0 } }}
                />
                <TextField
                  select
                  label="Routing mode"
                  value={draft.routingMode ?? "autopilot"}
                  onChange={(event) =>
                    updateDraft("routingMode", event.target.value as CandidateCombo["routingMode"])
                  }
                  slotProps={{ select: { native: true } }}
                >
                  <option value="autopilot">Autopilot</option>
                  <option value="unique">Unique routing</option>
                </TextField>
                <TextField
                  label="Move IDs, one per line"
                  multiline
                  minRows={2}
                  value={moveIdsText}
                  onChange={(event) => setMoveIdsText(event.target.value)}
                />
                <TextField
                  label="Mechanics, one per line"
                  multiline
                  minRows={2}
                  value={mechanicsText}
                  onChange={(event) => setMechanicsText(event.target.value)}
                />
                <Stack spacing={1} sx={{ gridColumn: "1 / -1" }}>
                  <Typography variant="subtitle2">Editor notes</Typography>
                  {draft.notes.map((note, index) => (
                    <Stack key={note.id} direction={{ xs: "column", sm: "row" }} spacing={1}>
                      <TextField
                        label={`Note ${index + 1}`}
                        multiline
                        minRows={2}
                        fullWidth
                        value={note.text}
                        onChange={(event) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  notes: current.notes.map((entry, position) => {
                                    if (position !== index) return entry;
                                    const { range: _range, ...plain } = entry;
                                    return { ...plain, text: event.target.value };
                                  }),
                                }
                              : current,
                          )
                        }
                      />
                      <TextField
                        select
                        label="Category"
                        value={note.category}
                        onChange={(event) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  notes: current.notes.map((entry, position) =>
                                    position === index
                                      ? {
                                          ...entry,
                                          category: event.target
                                            .value as CandidateCombo["notes"][number]["category"],
                                        }
                                      : entry,
                                  ),
                                }
                              : current,
                          )
                        }
                        slotProps={{ select: { native: true } }}
                        sx={{ minWidth: 150 }}
                      >
                        <option value="general">General</option>
                        <option value="execution">Execution</option>
                        <option value="situational">Situational</option>
                      </TextField>
                      <Button
                        color="secondary"
                        onClick={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  notes: current.notes.filter((_, position) => position !== index),
                                }
                              : current,
                          )
                        }
                      >
                        Remove
                      </Button>
                    </Stack>
                  ))}
                  <Button
                    color="secondary"
                    onClick={() =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              notes: [
                                ...current.notes,
                                { id: crypto.randomUUID(), text: "", category: "general" },
                              ],
                            }
                          : current,
                      )
                    }
                    disabled={draft.notes.length >= 20}
                    sx={{ alignSelf: "flex-start" }}
                  >
                    Add note
                  </Button>
                </Stack>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {error && (
            <Typography color="error" variant="body2" sx={{ mr: "auto" }}>
              {error}
            </Typography>
          )}
          <Button onClick={() => setDraft(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={saveDetails}
            disabled={busy || !draft?.route.trim() || !draft.damage.trim()}
          >
            Save candidate
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
