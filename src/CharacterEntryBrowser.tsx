import {
  useCallback,
  useEffect,
  useLayoutEffect,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { Box, Button, ButtonBase, Chip, Link, Paper, Stack, Typography } from "@mui/material";
import { lighten } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import UploadIcon from "@mui/icons-material/Upload";
import { GuideVideoBuilder } from "./GuideVideoBuilder";
import {
  isEmptyVideoSlot,
  youtubeVideoId,
  type LocalGuideVideoSlot,
  type LocalTechVideo,
} from "./local-tech";
import type { TechVideo } from "./published-tech";

type EntryContent = {
  id: string;
  title: string;
  description?: string;
  videos?: readonly (LocalTechVideo | TechVideo)[];
};

export function CharacterEntryBrowser({
  label,
  selectedId,
  reading,
  editing,
  onSelect,
  onReadingChange,
  children,
  detail,
}: {
  label: string;
  selectedId: string | null;
  reading: boolean;
  editing: boolean;
  onSelect: (id: string | null) => void;
  onReadingChange: (reading: boolean) => void;
  children: ReactNode;
  detail: (onClose: () => void) => ReactNode;
}) {
  useLayoutEffect(() => {
    onReadingChange(reading);
    return () => onReadingChange(false);
  }, [reading, onReadingChange]);

  const close = useCallback(() => {
    onSelect(null);
    document.getElementById(`character-entry-card-${selectedId}`)?.focus();
  }, [onSelect, selectedId]);

  useEffect(() => {
    if (!reading || editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reading, editing, close]);

  useEffect(() => {
    if (!reading || !selectedId) return;
    const frame = requestAnimationFrame(() =>
      document
        .getElementById(`character-entry-card-${selectedId}`)
        ?.scrollIntoView({ block: "nearest" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [reading, selectedId]);

  return (
    <Box
      sx={
        reading
          ? {
              display: "grid",
              flex: 1,
              minHeight: { xs: 340, md: 240 },
              minWidth: 0,
              gap: 1.5,
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                md: "minmax(220px, 300px) minmax(0, 1fr)",
              },
              gridTemplateRows: {
                xs: "minmax(0, min(28%, 12rem)) minmax(0, 1fr)",
                md: "minmax(0, 1fr)",
              },
            }
          : undefined
      }
    >
      <Stack
        component="section"
        aria-label={label}
        spacing={reading ? 1.5 : 2}
        sx={
          reading
            ? { minHeight: 0, minWidth: 0, overflowY: "auto", overscrollBehavior: "contain", pr: 1 }
            : undefined
        }
      >
        {children}
      </Stack>
      {reading && detail(close)}
    </Box>
  );
}

type EntryAction = { label: string; onClick: () => void; disabled?: boolean };
const entryActions = {
  add: { Icon: AddIcon, variant: "contained", color: "info" },
  edit: { Icon: EditOutlinedIcon, variant: "outlined", color: "info" },
  publish: { Icon: UploadIcon, variant: "contained", color: "secondary" },
  delete: { Icon: DeleteOutlinedIcon, variant: "text", color: "error" },
} as const;

export function CharacterEntryActionButton({
  action,
  label,
  onClick,
  disabled,
}: EntryAction & { action: keyof typeof entryActions }) {
  const { Icon, variant, color } = entryActions[action];
  return (
    <Box component="span" title={label} sx={{ display: "inline-flex", flexShrink: 0 }}>
      <Button
        size="small"
        variant={variant}
        color={color}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        sx={{ width: 32, height: 32, minWidth: 0, p: 0 }}
      >
        <Icon fontSize="small" />
      </Button>
    </Box>
  );
}

export function CharacterEntrySection({
  headingId,
  title,
  description,
  compact,
  localDraft = false,
  metadata,
  addEntry,
  editSection,
  headerActions,
  cards,
  emptyMessage,
}: {
  headingId: string;
  title: string;
  description?: string;
  compact: boolean;
  localDraft?: boolean;
  metadata?: ReactNode;
  addEntry?: EntryAction;
  editSection?: EntryAction;
  headerActions?: ReactNode;
  cards: ReactNode[];
  emptyMessage?: string;
}) {
  return (
    <Stack
      component="section"
      spacing={1.5}
      aria-labelledby={headingId}
      aria-description={localDraft ? "Local draft" : undefined}
    >
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: "center", minWidth: 0, maxWidth: "100%" }}
        >
          <Typography
            id={headingId}
            variant="h6"
            color={localDraft ? "info" : undefined}
            sx={{ minWidth: 0, overflowWrap: "anywhere" }}
          >
            {title}
          </Typography>
          {metadata}
          {!compact && addEntry && <CharacterEntryActionButton action="add" {...addEntry} />}
          {!compact && editSection && <CharacterEntryActionButton action="edit" {...editSection} />}
        </Stack>
        {!compact && headerActions}
      </Stack>
      {!compact && description && (
        <Typography color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
          {description}
        </Typography>
      )}
      {cards.length > 0 ? (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: compact
              ? "minmax(0, 1fr)"
              : "repeat(auto-fill, minmax(min(100%, 260px), 1fr))",
            gap: compact ? 1 : 1.5,
          }}
        >
          {cards}
        </Box>
      ) : (
        emptyMessage && <Typography color="text.secondary">{emptyMessage}</Typography>
      )}
    </Stack>
  );
}

export function CharacterEntryCard({
  entry,
  compact,
  selected,
  localDraft = false,
  published = false,
  onSelect,
}: {
  entry: EntryContent;
  compact: boolean;
  selected: boolean;
  localDraft?: boolean;
  published?: boolean;
  onSelect: () => void;
}) {
  const placeholderCount =
    entry.videos?.filter((video) => "url" in video && isEmptyVideoSlot(video)).length ?? 0;

  return (
    <Paper
      variant="outlined"
      sx={{
        borderColor: selected ? "primary.main" : undefined,
        borderWidth: selected ? 2 : 1,
        overflow: "hidden",
      }}
    >
      <ButtonBase
        id={`character-entry-card-${entry.id}`}
        onClick={onSelect}
        aria-expanded={selected}
        aria-controls={selected ? `character-entry-detail-${entry.id}` : undefined}
        aria-description={
          localDraft ? (published ? "Unpublished changes" : "Local draft") : undefined
        }
        sx={{ display: "block", width: "100%", p: compact ? 1 : 2, textAlign: "left" }}
      >
        <Stack spacing={1}>
          <Typography
            variant="subtitle1"
            color={localDraft ? "info" : undefined}
            sx={{ fontWeight: 700 }}
          >
            {entry.title}
          </Typography>
          {!compact && entry.description && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
              }}
            >
              {entry.description}
            </Typography>
          )}
          {placeholderCount > 0 && (
            <Chip
              size="small"
              color={localDraft ? "info" : "default"}
              variant="outlined"
              label={`${placeholderCount} video placeholder${placeholderCount === 1 ? "" : "s"}`}
              sx={{ alignSelf: "flex-start" }}
            />
          )}
        </Stack>
      </ButtonBase>
    </Paper>
  );
}

export function CharacterEntryPanel({
  id,
  title,
  category,
  titleField,
  actions,
  headerAction,
  onKeyDown,
  children,
}: {
  id: string;
  title: string;
  category: ReactNode;
  titleField?: ReactNode;
  actions?: ReactNode;
  headerAction?: ReactNode;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  children?: ReactNode;
}) {
  return (
    <Paper
      id={`character-entry-detail-${id}`}
      component="section"
      variant="outlined"
      aria-label={titleField ? title : undefined}
      aria-labelledby={titleField ? undefined : `character-entry-title-${id}`}
      onKeyDown={onKeyDown}
      sx={{
        display: "flex",
        flexDirection: "column",
        borderColor: "primary.main",
        borderWidth: 2,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        sx={{
          p: { xs: 1.5, md: 2 },
          justifyContent: "space-between",
          alignItems: "start",
          gap: 2,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {typeof category === "string" ? (
            <Typography variant="overline" color="text.secondary">
              {category}
            </Typography>
          ) : (
            category
          )}
          {titleField ?? (
            <Typography
              id={`character-entry-title-${id}`}
              variant="h5"
              sx={{ overflowWrap: "anywhere" }}
            >
              {title}
            </Typography>
          )}
        </Box>
        {headerAction}
      </Stack>
      <Stack
        spacing={2.5}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          p: { xs: 1.5, md: 2 },
        }}
      >
        {children}
      </Stack>
      {actions && (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ p: { xs: 1, md: 1.5 }, borderTop: 1, borderColor: "divider", flexWrap: "wrap" }}
        >
          {actions}
        </Stack>
      )}
    </Paper>
  );
}

export function CharacterEntryVideoStrip({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  return (
    <Box
      role="region"
      aria-label="Guide videos"
      tabIndex={count > 1 ? 0 : undefined}
      sx={{
        display: "grid",
        gridAutoFlow: "column",
        gridAutoColumns: count === 1 ? "min(100%, 36rem)" : "min(85%, 36rem)",
        flexShrink: 0,
        minWidth: 0,
        gap: 1.5,
        p: 1.5,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.default",
        overflowX: "auto",
        overscrollBehaviorX: "contain",
      }}
    >
      {children}
    </Box>
  );
}

export function CharacterEntryVideoCard({ children }: { children: ReactNode }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        overflow: "hidden",
        overflowWrap: "anywhere",
        bgcolor: (theme) => lighten(theme.palette.background.paper, 0.05),
      }}
    >
      {children}
    </Paper>
  );
}

export function CharacterEntryDetail({
  entry,
  categoryTitle,
  actions,
  onClose,
  onFillVideoSlot,
  recordingDisabled,
  children,
}: {
  entry: EntryContent;
  categoryTitle: string;
  actions?: ReactNode;
  onClose: () => void;
  onFillVideoSlot?: (video: LocalTechVideo, slot: LocalGuideVideoSlot) => void;
  recordingDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <CharacterEntryPanel
      id={entry.id}
      title={entry.title}
      category={categoryTitle}
      actions={actions}
      headerAction={
        <Button size="small" onClick={onClose} aria-label={`Close ${entry.title} detail`}>
          Close
        </Button>
      }
    >
      {entry.description && (
        <Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {entry.description}
        </Typography>
      )}
      {entry.videos && entry.videos.length > 0 && (
        <CharacterEntryVideoStrip count={entry.videos.length}>
          {entry.videos.map((video, index) => {
            const id = "url" in video ? youtubeVideoId(video.url) : video.youtubeVideoId;
            const localVideoId = "localVideoId" in video ? video.localVideoId : undefined;
            const emptySlot = !id && !localVideoId;
            const title = video.title.trim() || (emptySlot ? `Video slot ${index + 1}` : "");
            const description = video.description.trim();
            return (
              <CharacterEntryVideoCard
                key={"slotId" in video && video.slotId ? video.slotId : `${id ?? index}-${index}`}
              >
                {(title || description || id) && (
                  <Stack spacing={1} sx={{ p: { xs: 1.5, md: 2 } }}>
                    {title && (
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        {title}
                      </Typography>
                    )}
                    {description && (
                      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                        {description}
                      </Typography>
                    )}
                    {emptySlot && (
                      <Typography variant="caption" color="text.secondary">
                        No video attached yet.
                      </Typography>
                    )}
                    {onFillVideoSlot && "url" in video && isEmptyVideoSlot(video) && (
                      <GuideVideoBuilder
                        disabled={recordingDisabled}
                        initialMetadata={video}
                        startRecordingOnOpen
                        onExport={(recorded) => onFillVideoSlot(recorded, { index, video })}
                      />
                    )}
                    {id && (
                      <Link
                        href={`https://www.youtube.com/watch?v=${id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="caption"
                      >
                        Open on YouTube
                      </Link>
                    )}
                  </Stack>
                )}
                {id && (
                  <Box
                    component="iframe"
                    title={`${entry.title}: ${title || `Video ${index + 1}`}`}
                    src={`https://www.youtube-nocookie.com/embed/${id}`}
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    sx={{ width: "100%", aspectRatio: "16 / 9", border: 0, mt: "auto" }}
                  />
                )}
                {localVideoId && !id && (
                  <Box
                    component="video"
                    controls
                    preload="metadata"
                    src={`labatar-media://guide/${localVideoId}`}
                    sx={{ width: "100%", height: "auto", mt: "auto" }}
                  />
                )}
              </CharacterEntryVideoCard>
            );
          })}
        </CharacterEntryVideoStrip>
      )}
      {children}
    </CharacterEntryPanel>
  );
}
