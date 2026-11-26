import { useEffect, useState, type ReactNode } from "react";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { VideoPicker } from "./VideoPicker";
import { GuideVideoBuilder } from "./GuideVideoBuilder";
import {
  CharacterEntryPanel,
  CharacterEntryVideoCard,
  CharacterEntryVideoStrip,
} from "./CharacterEntryBrowser";
import { attachmentVideoSelection, attachmentVideoSource } from "./video-selection";
import { isEmptyVideoSlot, youtubeVideoId, type LocalTechVideo } from "./local-tech";
import { openRecordingInLibrary } from "./tech-types";
import { isInRecordingsLibrary } from "./recording-hierarchy";

export function entryVideosValid(videos: LocalTechVideo[] = []) {
  return videos.every(
    (video) => isEmptyVideoSlot(video) || video.localVideoId || youtubeVideoId(video.url),
  );
}

export function CharacterEntryEditor({
  id,
  heading,
  category,
  title,
  error,
  canSave,
  onTitleChange,
  onClose,
  onSave,
  children,
}: {
  id: string;
  heading: string;
  category: ReactNode;
  title: string;
  error: string;
  canSave: boolean;
  onTitleChange: (title: string) => void;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <CharacterEntryPanel
      id={id}
      title={heading}
      category={category}
      titleField={
        <TextField
          variant="standard"
          placeholder="Title"
          required
          fullWidth
          autoFocus
          value={title}
          slotProps={{
            htmlInput: { "aria-label": "Title", maxLength: 160 },
            input: { sx: { typography: "h5" } },
          }}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      }
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" color="info" disabled={!canSave} onClick={onSave}>
            Save locally
          </Button>
        </>
      }
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          event.target instanceof Node &&
          event.currentTarget.contains(event.target)
        ) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {error && <Alert severity="warning">{error}</Alert>}
      {children}
    </CharacterEntryPanel>
  );
}

export function CharacterEntryTextField({
  label,
  value,
  onChange,
  minRows,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
  maxLength?: number;
}) {
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <TextField
        variant="standard"
        fullWidth
        multiline
        minRows={minRows}
        value={value}
        slotProps={{ htmlInput: { "aria-label": label, maxLength } }}
        onChange={(event) => onChange(event.target.value)}
      />
    </Box>
  );
}

export function CharacterEntryVideoFields({
  videos,
  busy,
  onBusyChange,
  onChange,
}: {
  videos: LocalTechVideo[];
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onChange: (update: (current: LocalTechVideo[]) => LocalTechVideo[]) => void;
}) {
  const [addedSlotId, setAddedSlotId] = useState<string>();
  const [recordingLinks, setRecordingLinks] = useState<{
    local: Map<string, string>;
    youtube: Map<string, string | null>;
  }>();
  const localIds = videos
    .flatMap((video) => (video.localVideoId ? [video.localVideoId] : []))
    .join("\n");
  const hasYouTubeVideos = videos.some((video) => youtubeVideoId(video.url));

  useEffect(() => {
    const api = window.electronAPI?.recordings;
    if (!api || (!localIds && !hasYouTubeVideos)) return;
    let currentRequest = 0;
    const load = () => {
      const request = ++currentRequest;
      void api
        .list({ analysisScope: "none", guideVideoIds: localIds ? localIds.split("\n") : [] })
        .then(({ recordings, guideVideoRecordingIds }) => {
          if (request !== currentRequest) return;
          const available = recordings.filter(isInRecordingsLibrary);
          const recordingIds = new Set(available.map(({ id }) => id));
          const local = new Map(
            Object.entries(guideVideoRecordingIds ?? {}).filter(([, id]) => recordingIds.has(id)),
          );
          const youtube = new Map<string, string | null>();
          if (hasYouTubeVideos) {
            for (const recording of available) {
              const id = youtubeVideoId(recording.youtubeUrl || recording.url);
              if (id) youtube.set(id, youtube.has(id) ? null : recording.id);
            }
          }
          setRecordingLinks({ local, youtube });
        })
        .catch(() => {
          if (request === currentRequest) setRecordingLinks(undefined);
        });
    };
    load();
    const unsubscribe = api.onChanged(load);
    return () => {
      currentRequest++;
      unsubscribe();
    };
  }, [localIds, hasYouTubeVideos]);

  function updateVideo(index: number, fields: Partial<LocalTechVideo>) {
    onChange((current) =>
      current.map((video, position) => (position === index ? { ...video, ...fields } : video)),
    );
  }

  return (
    <Stack spacing={1.5}>
      {videos.length > 0 && (
        <CharacterEntryVideoStrip count={videos.length}>
          {videos.map((video, index) => {
            const youtubeId = youtubeVideoId(video.url);
            const localRecordingId =
              video.localVideoId && recordingLinks?.local.get(video.localVideoId);
            const recordingId =
              localRecordingId || (youtubeId && recordingLinks?.youtube.get(youtubeId));
            return (
              <CharacterEntryVideoCard key={video.slotId ?? index}>
                <Stack spacing={1.5} sx={{ p: { xs: 1.5, md: 2 } }}>
                  <TextField
                    variant="standard"
                    placeholder={`Video slot ${index + 1} heading (optional)`}
                    autoFocus={addedSlotId !== undefined && video.slotId === addedSlotId}
                    value={video.title}
                    slotProps={{
                      htmlInput: {
                        "aria-label": `Video slot ${index + 1} heading`,
                        maxLength: 160,
                      },
                      input: { sx: { fontWeight: 700 } },
                    }}
                    onChange={(event) => updateVideo(index, { title: event.target.value })}
                  />
                  <TextField
                    variant="standard"
                    placeholder="Description (optional)"
                    value={video.description}
                    multiline
                    slotProps={{
                      htmlInput: {
                        "aria-label": `Video slot ${index + 1} description`,
                        maxLength: 500,
                      },
                      input: { sx: { typography: "body2" } },
                    }}
                    onChange={(event) => updateVideo(index, { description: event.target.value })}
                  />
                  <VideoPicker
                    storage="reference"
                    onBusyChange={onBusyChange}
                    label="Video"
                    preview
                    value={attachmentVideoSelection(video)}
                    onChange={(selection) => updateVideo(index, attachmentVideoSource(selection))}
                  />
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                    {isEmptyVideoSlot(video) && (
                      <GuideVideoBuilder
                        disabled={busy}
                        initialMetadata={video}
                        onExport={(exported) => updateVideo(index, exported)}
                      />
                    )}
                    {recordingId && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="info"
                        disabled={busy}
                        onClick={() => openRecordingInLibrary(recordingId)}
                      >
                        Go to recording
                      </Button>
                    )}
                    <Button
                      size="small"
                      color="error"
                      disabled={busy}
                      onClick={() =>
                        onChange((current) => current.filter((_, position) => position !== index))
                      }
                    >
                      Remove slot
                    </Button>
                  </Stack>
                </Stack>
              </CharacterEntryVideoCard>
            );
          })}
        </CharacterEntryVideoStrip>
      )}
      {videos.length < 12 && (
        <Button
          size="small"
          variant="contained"
          color="info"
          sx={{ alignSelf: "flex-start" }}
          onClick={() => {
            const slotId = crypto.randomUUID();
            setAddedSlotId(slotId);
            onChange((current) => [...current, { slotId, title: "", description: "", url: "" }]);
          }}
        >
          Add video slot
        </Button>
      )}
      {videos.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          Empty slots stay local. Publishing uploads attached MP4s to YouTube as unlisted videos.
        </Typography>
      )}
    </Stack>
  );
}
