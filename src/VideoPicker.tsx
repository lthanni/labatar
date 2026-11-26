import { useCallback, useEffect, useRef, useState } from "react";
import {
  Autocomplete,
  Alert,
  Box,
  Button,
  CircularProgress,
  createFilterOptions,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { youtubeVideoId } from "./local-tech";
import type { RecordedVideo } from "./recording-types";
import { videoSelectionKey, videoSelectionLabel, type VideoSelection } from "./video-selection";

type Action = { kind: "action"; action: "import" | "youtube"; label: string };
type MissingRecording = { kind: "missing"; id: string };
type Option = VideoSelection | Action | MissingRecording;
const key = (option: Option) =>
  option.kind === "missing"
    ? `recording:${option.id}`
    : option.kind === "action"
      ? option.action
      : videoSelectionKey(option);
const label = (option: Option) =>
  option.kind === "missing"
    ? option.id
    : option.kind === "action"
      ? option.label
      : videoSelectionLabel(option);
const detail = (option: Option) =>
  option.kind === "recording"
    ? option.recording.id
    : option.kind === "local"
      ? "Local MP4"
      : option.kind === "youtube"
        ? "YouTube"
        : option.kind === "missing"
          ? "Unavailable recording"
          : "";
const filter = createFilterOptions<Option>({
  stringify: (option) => `${label(option)} ${detail(option)}`,
  limit: 100,
});

/** Shared video selector. References keep files in place; library imports copy external MP4s. */
export function VideoPicker({
  value = null,
  recordingId = "",
  onChange,
  storage = "library",
  localMp4Only = false,
  label: fieldLabel = "Video",
  recordings,
  onRecordingsChanged,
  onBusyChange,
  disabled = false,
  required = false,
  disableClearable = false,
  autoFocus = false,
  preview = false,
  helperText,
}: {
  value?: VideoSelection | null;
  recordingId?: string;
  onChange: (selection: VideoSelection | null) => void | Promise<void>;
  storage?: "library" | "reference";
  localMp4Only?: boolean;
  label?: string;
  recordings?: RecordedVideo[];
  onRecordingsChanged?: (recordings: RecordedVideo[]) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  disableClearable?: boolean;
  autoFocus?: boolean;
  preview?: boolean;
  helperText?: string;
}) {
  const [loaded, setLoaded] = useState<VideoSelection[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const mounted = useRef(true);
  const selecting = useRef(false);
  const loadingRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const results = await Promise.allSettled([
        window.electronAPI?.recordings?.list({ analysisScope: "none" }),
        storage === "reference" ? window.electronAPI?.videoLibrary?.list() : undefined,
      ]);
      if (!mounted.current) return;
      const choices: VideoSelection[] = [];
      for (const [index, result] of results.entries()) {
        if (result.status === "rejected") {
          setError("Could not load some videos. Open the dropdown again to retry.");
          continue;
        }
        if (!result.value) continue;
        if (index === 0 && "recordings" in result.value)
          choices.push(
            ...result.value.recordings.map((recording): VideoSelection => ({
              kind: "recording",
              recording,
            })),
          );
        else if (Array.isArray(result.value))
          choices.push(...result.value.map((video): VideoSelection => ({ kind: "local", video })));
      }
      setLoaded(choices);
    } finally {
      loadingRef.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [storage]);
  useEffect(() => {
    if (recordingId) void load();
  }, [recordingId, load]);

  async function choose(selection: VideoSelection | null) {
    if (selecting.current) return;
    selecting.current = true;
    setBusy(true);
    setError("");
    onBusyChange?.(true);
    try {
      let next = selection;
      if (storage === "reference" && selection?.kind === "recording") {
        const recording = selection.recording;
        if (recording.mediaKind === "youtube") {
          const url = recording.youtubeUrl || recording.url;
          if (!youtubeVideoId(url))
            throw new Error("This recording does not have a valid YouTube link.");
          next = { kind: "youtube", url };
        } else {
          const video = await window.electronAPI?.videoLibrary.fromRecording(recording.id);
          if (!video) throw new Error("The selected local video is unavailable.");
          next = { kind: "local", video };
        }
      }
      if (mounted.current) await onChange(next);
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : "Could not select video.");
    } finally {
      selecting.current = false;
      if (mounted.current) {
        setBusy(false);
      }
      onBusyChange?.(false);
    }
  }

  async function addMp4() {
    if (selecting.current) return;
    selecting.current = true;
    setBusy(true);
    setError("");
    onBusyChange?.(true);
    try {
      let selected: VideoSelection;
      if (storage === "reference") {
        const video = await window.electronAPI?.videoLibrary.chooseMp4();
        if (!video) return;
        selected = { kind: "local", video };
      } else {
        const api = window.electronAPI?.recordings;
        if (!api) throw new Error("Video import is unavailable.");
        const id = await api.importMp4();
        if (!id) return;
        const latest = await api.list();
        const recording = latest.recordings.find((item) => item.id === id);
        if (!recording) throw new Error("The imported MP4 did not appear in the library.");
        selected = { kind: "recording", recording };
        if (mounted.current) onRecordingsChanged?.(latest.recordings);
      }
      if (!mounted.current) return;
      setLoaded((current) => [...current.filter((item) => key(item) !== key(selected)), selected]);
      await onChange(selected);
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : "Could not add MP4.");
    } finally {
      selecting.current = false;
      if (mounted.current) {
        setBusy(false);
      }
      onBusyChange?.(false);
    }
  }

  const choices = new Map<string, VideoSelection>();
  for (const option of loaded) choices.set(key(option), option);
  for (const recording of recordings ?? [])
    choices.set(`recording:${recording.id}`, { kind: "recording", recording });
  if (value) choices.set(key(value), value);
  const selected: VideoSelection | MissingRecording | null =
    value ??
    (recordingId
      ? (choices.get(`recording:${recordingId}`) ?? { kind: "missing", id: recordingId })
      : null);
  const options: Option[] = [...choices.values()].filter((option) => {
    if (option.kind !== "recording") return true;
    return option.recording.mediaKind === "youtube"
      ? !localMp4Only
      : !(localMp4Only || storage === "reference") || /\.mp4$/i.test(option.recording.name);
  });
  const canImport =
    storage === "reference" ? window.electronAPI?.videoLibrary : window.electronAPI?.recordings;
  const actions: Action[] = [
    ...(canImport
      ? [{ kind: "action" as const, action: "import" as const, label: "Add local MP4…" }]
      : []),
    ...(storage === "reference" && !localMp4Only
      ? [{ kind: "action" as const, action: "youtube" as const, label: "Link YouTube video…" }]
      : []),
  ];
  const previewUrl =
    value?.kind === "local"
      ? `labatar-media://guide/${value.video.id}`
      : value?.kind === "recording"
        ? value.recording.url
        : "";
  const youtube =
    value?.kind === "youtube"
      ? value.url
      : value?.kind === "local"
        ? value.youtubeUrl
        : value?.recording.youtubeUrl;
  const youtubeId = youtubeVideoId(youtube ?? "");
  return (
    <Stack spacing={1}>
      <Autocomplete<Option, false, boolean>
        fullWidth
        disableClearable={disableClearable}
        value={selected}
        options={[...actions, ...options, ...(selected?.kind === "missing" ? [selected] : [])]}
        getOptionLabel={label}
        getOptionKey={key}
        isOptionEqualToValue={(a, b) => key(a) === key(b)}
        getOptionDisabled={(option) => option.kind === "missing"}
        filterOptions={(all, state) => [
          ...actions,
          ...filter(
            all.filter((option) => option.kind !== "action"),
            state,
          ),
        ]}
        onOpen={() => void load()}
        onChange={(_event, option) => {
          if (option?.kind === "missing") return;
          if (option?.kind === "action") {
            if (option.action === "import") void addMp4();
            else {
              setYoutubeUrl(youtube ?? "");
              setYoutubeOpen(true);
            }
          } else void choose(option);
        }}
        disabled={disabled || busy}
        loading={loading || busy}
        loadingText="Loading videos…"
        noOptionsText="No videos match this search."
        renderOption={(props, option) => {
          const { key: optionKey, ...rest } = props;
          const isRecording = option.kind === "recording";
          const isLocal =
            option.kind === "local" || (isRecording && option.recording.mediaKind !== "youtube");
          const name = isRecording ? option.recording.id : label(option);
          const subtitle = isRecording || isLocal ? "" : detail(option);
          return (
            <Box
              component="li"
              key={optionKey}
              {...rest}
              aria-label={isLocal ? `${name}, local MP4` : undefined}
            >
              <Box sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                <Typography
                  variant="body2"
                  color={isLocal ? "info" : option.kind === "action" ? "primary" : undefined}
                >
                  {name}
                </Typography>
                {subtitle && (
                  <Typography variant="caption" color="text.secondary">
                    {subtitle}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={fieldLabel}
            required={required}
            autoFocus={autoFocus}
            helperText={helperText ?? "Search videos or add a local MP4."}
            slotProps={{
              ...params.slotProps,
              input: {
                ...params.slotProps.input,
                endAdornment: (
                  <>
                    {(loading || busy) && <CircularProgress size={16} />}
                    {params.slotProps.input.endAdornment}
                  </>
                ),
              },
            }}
          />
        )}
      />
      {error && <Alert severity="error">{error}</Alert>}
      {preview &&
        value &&
        (youtubeId ? (
          <Box
            component="iframe"
            title="Selected video"
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
            allowFullScreen
            sx={{ width: "100%", aspectRatio: "16 / 9", border: 0 }}
          />
        ) : previewUrl ? (
          <Box
            component="video"
            controls
            preload="metadata"
            src={previewUrl}
            sx={{ width: "100%", maxHeight: 300 }}
          />
        ) : null)}
      {preview && youtubeId && (
        <Link
          href={`https://www.youtube.com/watch?v=${youtubeId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open on YouTube
        </Link>
      )}
      <Dialog open={youtubeOpen} onClose={() => setYoutubeOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Link YouTube video</DialogTitle>
        <DialogContent>
          <TextField
            label="YouTube URL"
            fullWidth
            autoFocus
            value={youtubeUrl}
            sx={{ mt: 1 }}
            error={Boolean(youtubeUrl && !youtubeVideoId(youtubeUrl))}
            helperText="Enter a link to one YouTube video."
            onChange={(event) => setYoutubeUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && youtubeVideoId(youtubeUrl)) {
                event.preventDefault();
                setYoutubeOpen(false);
                void choose({ kind: "youtube", url: youtubeUrl.trim() });
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setYoutubeOpen(false)}>Cancel</Button>
          <Button
            variant={value ? "outlined" : "contained"}
            color="info"
            disabled={!youtubeVideoId(youtubeUrl)}
            onClick={() => {
              setYoutubeOpen(false);
              void choose({ kind: "youtube", url: youtubeUrl.trim() });
            }}
          >
            Link video
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
