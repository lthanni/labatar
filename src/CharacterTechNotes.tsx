import { useEffect, useState } from "react";
import { ScopePortrait, type GetScopePortrait } from "./ScopePortrait";
import {
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Stack,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import {
  CharacterEntryBrowser,
  CharacterEntryActionButton,
  CharacterEntryCard,
  CharacterEntryDetail,
  CharacterEntrySection,
} from "./CharacterEntryBrowser";
import {
  CharacterEntryEditor,
  CharacterEntryTextField,
  CharacterEntryVideoFields,
  entryVideosValid,
} from "./CharacterEntryEditor";
import { CharacterSectionDialog } from "./CharacterSectionDialog";
import { CharacterTabActions } from "./CharacterTabActions";
import {
  characterTechOpenComboEvent,
  characterTechForSelection,
  inheritCharacterTechScope,
  readCharacterTech,
  readLocalNoteSections,
  writeCharacterTech,
  writeLocalNoteSections,
  type CharacterNoteSection,
  type CharacterTechEntry,
  type CharacterTechKind,
  type LocalNoteSection,
} from "./character-tech";
import { readComboWorkspace } from "./combo-gameplan";
import { fetchPublishedCombos, readPublishedCatalogCache } from "./published-catalog";
import { openRecordingInLibrary } from "./tech-types";
import { VideoPicker } from "./VideoPicker";
import { GuideVideoBuilder } from "./GuideVideoBuilder";
import { GuidePublicationFeedback } from "./GuidePublicationFeedback";
import {
  attachLocalGuideVideo,
  guideVideoContent,
  hasUnpublishedChanges,
  mergePublishedVideos,
  videosForPublication,
  type LocalTechVideo,
  type LocalGuideVideoSlot,
} from "./local-tech";
import { useGuidePublications } from "./guide-publication";
import {
  fetchPublishedCharacterTech,
  type PublishedCharacterTechEntry,
  type PublishedNoteSection,
} from "./published-character-tech";

const labels: Record<CharacterTechKind, string> = {
  pressure: "Pressure",
  oki: "Oki",
  guide: "Guides",
};

function sectionPublication({
  id,
  kind,
  characterId,
  supportId,
  title,
  description,
}: CharacterNoteSection) {
  return { id, kind, characterId, supportId, title: title.trim(), description: description.trim() };
}

function blankEntry(kind: CharacterTechKind, characterId: string): CharacterTechEntry {
  return {
    id: crypto.randomUUID(),
    kind,
    characterId,
    supportId: null,
    title: "",
    setup: "",
    sequence: "",
    outcome: "",
    notes: "",
    recordingId: "",
    relatedTechIds: [],
    relatedComboIds: [],
    ...(kind === "guide" ? { videos: [] } : {}),
    updatedAt: new Date().toISOString(),
  };
}

function combineEntryNotes<
  T extends Pick<CharacterTechEntry, "setup" | "sequence" | "outcome" | "notes">,
>(entry: T): T {
  const legacyNotes = [entry.setup, entry.sequence, entry.outcome].filter((value) => value?.trim());
  if (!legacyNotes.length) return entry;
  return {
    ...entry,
    setup: "",
    sequence: "",
    outcome: "",
    notes: [...legacyNotes, entry.notes].filter((value) => value?.trim()).join("\n\n"),
  };
}

function entryPublicationContent(entry: CharacterTechEntry | PublishedCharacterTechEntry) {
  return {
    sectionId: entry.sectionId,
    kind: entry.kind,
    characterId: entry.characterId,
    supportId: entry.supportId,
    title: entry.title.trim(),
    notes: combineEntryNotes(entry).notes?.trim() ?? "",
    relatedTechIds: [...new Set(entry.relatedTechIds)],
    relatedComboIds: [...new Set(entry.relatedComboIds)],
    videos: guideVideoContent(entry.videos),
  };
}

export function CharacterTechNotes({
  active,
  kind,
  characterId,
  supportId,
  getScopePortrait,
  readOnly = false,
  selectedEntryId,
  onSelectEntry,
  onReadingChange,
  onOpenTech,
}: {
  active: boolean;
  kind: CharacterTechKind;
  characterId: string;
  supportId: string;
  getScopePortrait: GetScopePortrait;
  readOnly?: boolean;
  selectedEntryId: string | null;
  onSelectEntry: (id: string | null) => void;
  onReadingChange: (reading: boolean) => void;
  onOpenTech?: (kind: "pressure" | "oki", id: string, supportId: string | null) => void;
}) {
  const [entries, setEntries] = useState(readCharacterTech);
  const [draft, setDraft] = useState<CharacterTechEntry | null>(null);
  const [videoSelectionsBusy, setVideoSelectionsBusy] = useState(0);
  const [sections, setSections] = useState(readLocalNoteSections);
  const [sectionDraft, setSectionDraft] = useState<LocalNoteSection | null>(null);
  const [error, setError] = useState("");
  const [comboOptions, setComboOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [published, setPublished] = useState<PublishedCharacterTechEntry[]>([]);
  const [publishedSections, setPublishedSections] = useState<PublishedNoteSection[]>([]);
  const [publishingId, setPublishingId] = useState("");
  const [publishedTitle, setPublishedTitle] = useState("");
  const [refresh, setRefresh] = useState(0);
  const queuedPublications = readOnly
    ? []
    : entries.flatMap((entry) =>
        entry.pendingPublicationId ? [{ id: entry.pendingPublicationId, title: entry.title }] : [],
      );
  const {
    error: publicationError,
    progress,
    check: checkPublication,
  } = useGuidePublications(
    queuedPublications.map(({ id }) => id),
    (job) => {
      const latest = readCharacterTech();
      const publishedEntry = latest.find((entry) => entry.pendingPublicationId === job.id);
      if (!publishedEntry) return;
      const next = latest.map((entry) => {
        if (entry.pendingPublicationId !== job.id) return entry;
        const { pendingPublicationId: _pending, ...draft } = entry;
        return job.result
          ? {
              ...draft,
              publishedRevision: job.result.revision,
              videos: mergePublishedVideos(draft.videos, job.result.videos),
            }
          : draft;
      });
      try {
        writeCharacterTech(next);
        setEntries(next);
        setRefresh((count) => count + 1);
        if (job.status === "failed")
          setError(job.error || "Guide publication failed. You can retry publishing.");
        else if (job.status === "published") setPublishedTitle(publishedEntry.title);
      } catch {
        setError("Could not save publication status on this device.");
      }
    },
  );
  useEffect(() => {
    let cancelled = false;
    void fetchPublishedCharacterTech(characterId, supportId).then(
      ({ items, sections }) => {
        if (!cancelled) {
          setPublished(items);
          setPublishedSections(sections);
        }
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [characterId, supportId, refresh]);
  useEffect(() => {
    if (kind !== "guide") return;
    let cancelled = false;
    const local = readComboWorkspace()
      .localCombos.filter((combo) => combo.characterId === characterId)
      .map((combo) => ({ id: combo.id, label: combo.name || combo.route || combo.id }));
    setComboOptions(local);
    void readPublishedCatalogCache()
      .catch(() => null)
      .then((cached) => cached?.combos ?? fetchPublishedCombos())
      .then((combos) => {
        if (!cancelled)
          setComboOptions([
            ...local,
            ...combos
              .filter((combo) => combo.characterId === characterId)
              .map((combo) => ({ id: combo.id, label: combo.name || combo.route || combo.id })),
          ]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [draft?.id, kind, characterId]);
  const matchesSelection = (item: {
    kind: CharacterTechEntry["kind"];
    characterId: string;
    supportId: string | null;
  }) =>
    item.kind === kind &&
    item.characterId === characterId &&
    (item.supportId === null || item.supportId === supportId);
  const localSections = readOnly ? [] : sections;
  const localSectionIds = new Set(localSections.map((section) => section.id));
  const publishedSectionsById = new Map(
    publishedSections.filter(matchesSelection).map((section) => [section.id, section]),
  );
  const sectionsById = new Map<string, LocalNoteSection>(
    publishedSections.map(({ revision, ...section }) => [
      section.id,
      { ...section, publishedRevision: revision },
    ]),
  );
  for (const section of localSections) sectionsById.set(section.id, section);
  const visibleSections = [...sectionsById.values()]
    .filter(matchesSelection)
    .sort((a, b) => a.title.localeCompare(b.title));
  const scopedEntries = readOnly
    ? []
    : entries.map((entry) => inheritCharacterTechScope(entry, sectionsById));
  const localEntryIds = new Set(scopedEntries.map((entry) => entry.id));
  const visible = characterTechForSelection(scopedEntries, kind, characterId, supportId);
  const scopedPublished = published.map((entry) => inheritCharacterTechScope(entry, sectionsById));
  const publishedEntriesById = new Map(scopedPublished.map((entry) => [entry.id, entry]));
  const publishedVisible = scopedPublished.filter(
    (entry) => matchesSelection(entry) && !localEntryIds.has(entry.id),
  );
  const displayed = [
    ...visible,
    ...publishedVisible.map(({ revision, ...entry }): CharacterTechEntry => ({
      ...entry,
      videos: entry.videos?.map((video) => ({
        title: video.title,
        description: video.description,
        url: `https://www.youtube.com/watch?v=${video.youtubeVideoId}`,
      })),
      recordingId: "",
      updatedAt: "",
      publishedRevision: revision,
    })),
  ].map(combineEntryNotes);
  const selectedEntry = displayed.find((entry) => entry.id === selectedEntryId);
  const selectedSection = visibleSections.find(
    (section) => section.id === selectedEntry?.sectionId,
  );
  const creatingEntry = Boolean(
    !readOnly &&
    !selectedEntry &&
    draft &&
    matchesSelection(draft) &&
    !draft.publishedRevision &&
    !entries.some((entry) => entry.id === draft.id),
  );
  const reading = active && (Boolean(selectedEntry) || creatingEntry);
  const emptyMessage = `No ${labels[kind].toLowerCase()} for this character and support yet.`;
  const editorOpen = creatingEntry || Boolean(!readOnly && draft && draft.id === selectedEntry?.id);
  const entriesBySection = new Map<string, CharacterTechEntry[]>();
  const unsectioned: CharacterTechEntry[] = [];
  const visibleSectionIds = new Set(visibleSections.map((section) => section.id));
  for (const entry of displayed) {
    if (!entry.sectionId || !visibleSectionIds.has(entry.sectionId)) {
      unsectioned.push(entry);
      continue;
    }
    const group = entriesBySection.get(entry.sectionId) ?? [];
    group.push(entry);
    entriesBySection.set(entry.sectionId, group);
  }
  const relatedTech = new Map(
    [...scopedEntries, ...scopedPublished.filter((entry) => !localEntryIds.has(entry.id))].map(
      (entry) => [entry.id, entry],
    ),
  );
  const relatedTechOptions = [...relatedTech.values()].flatMap((entry) => {
    if (
      entry.characterId !== characterId ||
      (entry.kind !== "pressure" && entry.kind !== "oki") ||
      (entry.supportId !== null && entry.supportId !== supportId)
    )
      return [];
    return [{ id: entry.id, label: `${labels[entry.kind]}: ${entry.title}` }];
  });

  function save(next: CharacterTechEntry[]) {
    try {
      writeCharacterTech(next);
      setEntries(next);
      setDraft(null);
      setError("");
      return true;
    } catch {
      setError("Could not save character tech on this device.");
      return false;
    }
  }

  function attachEntryVideo(
    entry: CharacterTechEntry,
    video: LocalTechVideo,
    slot?: LocalGuideVideoSlot,
  ) {
    const latest = readCharacterTech();
    const saved = latest.find((item) => item.id === entry.id);
    if (slot && !saved) throw new Error("The local guide is no longer available.");
    const current = saved ?? entry;
    if (current.pendingPublicationId) throw new Error("Wait for the entry to finish publishing.");
    const videos = attachLocalGuideVideo(current.videos ?? [], video, slot);
    const updated = { ...current, videos, updatedAt: new Date().toISOString() };
    const next = [...latest.filter((item) => item.id !== current.id), updated];
    writeCharacterTech(next);
    setEntries(next);
  }

  function saveSections(next: LocalNoteSection[]) {
    try {
      writeLocalNoteSections(next);
      setSections(next);
      setSectionDraft(null);
      setError("");
    } catch {
      setError("Could not save sections on this device.");
    }
  }

  function addSection() {
    setSectionDraft({
      id: crypto.randomUUID(),
      kind,
      characterId,
      supportId: null,
      title: "",
      description: "",
    });
  }

  function addEntry(section?: LocalNoteSection) {
    setDraft({
      ...blankEntry(kind, characterId),
      ...(section ? { sectionId: section.id, supportId: section.supportId } : {}),
    });
  }

  function canPublishEntry(entry: CharacterTechEntry) {
    return (
      !entry.sectionId ||
      publishedSectionsById.has(entry.sectionId) ||
      localSections.some((section) => section.id === entry.sectionId && section.publishedRevision)
    );
  }

  async function publishSection(section: LocalNoteSection) {
    const publisher = window.electronAPI?.catalogPublisher;
    if (!publisher?.publishTech) return;
    setPublishingId(section.id);
    setError("");
    try {
      const item = sectionPublication(section);
      const result = await publisher.publishTech({
        type: "note-section",
        item,
        expectedRevision: section.publishedRevision ?? 0,
      });
      if (!result.cancelled && !result.pending) {
        saveSections(
          readLocalNoteSections().map((current) =>
            current.id === section.id
              ? { ...current, publishedRevision: result.revision }
              : current,
          ),
        );
        setPublishedSections((current) => [
          ...current.filter((section) => section.id !== item.id),
          { ...item, revision: result.revision },
        ]);
        setRefresh((count) => count + 1);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPublishingId("");
    }
  }

  async function publish(entry: CharacterTechEntry) {
    const publisher = window.electronAPI?.catalogPublisher;
    if (!publisher?.publishTech || !canPublishEntry(entry)) return;
    setPublishingId(entry.id);
    setPublishedTitle("");
    setError("");
    try {
      const {
        recordingId: _recordingId,
        updatedAt: _updatedAt,
        publishedRevision: _revision,
        pendingPublicationId: _pending,
        ...item
      } = entry;
      const result = await publisher.publishTech({
        type: "note",
        item: { ...item, videos: item.videos && videosForPublication(item.videos) },
        expectedRevision: entry.publishedRevision ?? 0,
      });
      if (!result.cancelled && result.pending) {
        const next = readCharacterTech().map((current) =>
          current.id === entry.id ? { ...current, pendingPublicationId: result.jobId } : current,
        );
        writeCharacterTech(next);
        setEntries(next);
        return;
      }
      if (!result.cancelled) {
        const next = readCharacterTech().map((current) =>
          current.id === entry.id
            ? {
                ...current,
                publishedRevision: result.revision,
                ...(result.videos
                  ? {
                      videos: mergePublishedVideos(current.videos, result.videos),
                    }
                  : {}),
              }
            : current,
        );
        writeCharacterTech(next);
        setEntries(next);
        setRefresh((count) => count + 1);
        setPublishedTitle(entry.title);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPublishingId("");
    }
  }

  function renderCard(entry: CharacterTechEntry) {
    const isLocal = localEntryIds.has(entry.id);
    return (
      <CharacterEntryCard
        key={entry.id}
        entry={{ ...entry, description: entry.notes }}
        compact={reading}
        selected={reading && selectedEntryId === entry.id}
        localDraft={
          isLocal &&
          hasUnpublishedChanges(entry, publishedEntriesById.get(entry.id), entryPublicationContent)
        }
        published={!isLocal || Boolean(entry.publishedRevision)}
        onSelect={() => onSelectEntry(selectedEntryId === entry.id ? null : entry.id)}
      />
    );
  }

  function renderEntryEditor(draft: CharacterTechEntry) {
    // Published entries keep their original scope when moving to a different section.
    const draftSections = draft.publishedRevision
      ? visibleSections.filter((section) => section.supportId === draft.supportId)
      : visibleSections;
    return (
      <CharacterEntryEditor
        key={draft.id}
        id={draft.id}
        heading={`${creatingEntry ? "Add" : "Edit"} ${kind}`}
        category={
          draftSections.length > 0 || draft.sectionId ? (
            <TextField
              select
              variant="standard"
              size="small"
              label="Section"
              value={
                draftSections.some((section) => section.id === draft.sectionId)
                  ? draft.sectionId
                  : ""
              }
              sx={{ mb: 0.5, width: "min(100%, 22rem)" }}
              onChange={(event) => {
                const section = draftSections.find(
                  (candidate) => candidate.id === event.target.value,
                );
                setDraft({
                  ...draft,
                  sectionId: section?.id,
                  supportId: section
                    ? section.supportId
                    : draft.publishedRevision
                      ? draft.supportId
                      : null,
                });
              }}
            >
              <MenuItem value="">Unsectioned</MenuItem>
              {draftSections.map((section) => (
                <MenuItem key={section.id} value={section.id}>
                  {section.title}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            "Unsectioned"
          )
        }
        title={draft.title}
        error={error}
        canSave={
          Boolean(draft.title.trim()) && videoSelectionsBusy === 0 && entryVideosValid(draft.videos)
        }
        onTitleChange={(title) => setDraft((current) => current && { ...current, title })}
        onClose={() => setDraft(null)}
        onSave={() => {
          const updated = {
            ...inheritCharacterTechScope(draft, sectionsById),
            title: draft.title.trim(),
            updatedAt: new Date().toISOString(),
          };
          const saved = save([
            ...readCharacterTech().filter((entry) => entry.id !== updated.id),
            updated,
          ]);
          if (saved && creatingEntry) onSelectEntry(updated.id);
        }}
      >
        <CharacterEntryTextField
          label={kind === "guide" ? "Guide" : "Notes"}
          value={draft.notes}
          minRows={2}
          onChange={(notes) => setDraft({ ...draft, notes })}
        />
        <CharacterEntryVideoFields
          videos={draft.videos ?? []}
          busy={videoSelectionsBusy > 0}
          onBusyChange={(busy) =>
            setVideoSelectionsBusy((count) => Math.max(0, count + (busy ? 1 : -1)))
          }
          onChange={(update) =>
            setDraft((current) =>
              current?.id === draft.id
                ? { ...current, videos: update(current.videos ?? []) }
                : current,
            )
          }
        />
        {kind === "guide" && (
          <>
            <FormControl fullWidth>
              <InputLabel id="guide-related-tech-label">Related pressure and oki</InputLabel>
              <Select<string[]>
                labelId="guide-related-tech-label"
                multiple
                value={draft.relatedTechIds ?? []}
                label="Related pressure and oki"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    relatedTechIds: Array.isArray(event.target.value)
                      ? event.target.value
                      : event.target.value.split(","),
                  })
                }
              >
                {relatedTechOptions.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="guide-related-combos-label">Related combos</InputLabel>
              <Select<string[]>
                labelId="guide-related-combos-label"
                multiple
                value={draft.relatedComboIds ?? []}
                label="Related combos"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    relatedComboIds: Array.isArray(event.target.value)
                      ? event.target.value
                      : event.target.value.split(","),
                  })
                }
              >
                {comboOptions.map((combo) => (
                  <MenuItem key={combo.id} value={combo.id}>
                    {combo.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </>
        )}
        {!readOnly && window.electronAPI?.recordings && (
          <VideoPicker
            label="Recording (optional)"
            onBusyChange={(busy) =>
              setVideoSelectionsBusy((count) => Math.max(0, count + (busy ? 1 : -1)))
            }
            recordingId={draft.recordingId}
            onChange={(selection) =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      recordingId: selection?.kind === "recording" ? selection.recording.id : "",
                    }
                  : current,
              )
            }
          />
        )}
      </CharacterEntryEditor>
    );
  }

  function renderDetail(onClose: () => void) {
    if (editorOpen && draft) return renderEntryEditor(draft);
    if (!selectedEntry) return null;
    const entry = selectedEntry;
    const categoryTitle = selectedSection?.title ?? "Unsectioned";
    const canOpenRecording = Boolean(entry.recordingId && window.electronAPI?.recordings);
    return (
      <CharacterEntryDetail
        key={entry.id}
        entry={{ ...entry, description: entry.notes }}
        categoryTitle={categoryTitle}
        onClose={onClose}
        onFillVideoSlot={
          !readOnly && localEntryIds.has(entry.id)
            ? (video, slot) => attachEntryVideo(entry, video, slot)
            : undefined
        }
        recordingDisabled={Boolean(entry.pendingPublicationId) || publishingId === entry.id}
        actions={
          (!readOnly || canOpenRecording) && (
            <>
              {entry.recordingId && window.electronAPI?.recordings && (
                <Button size="small" onClick={() => openRecordingInLibrary(entry.recordingId)}>
                  Open recording
                </Button>
              )}
              {!readOnly && (
                <Button
                  size="small"
                  variant="outlined"
                  color="info"
                  disabled={Boolean(entry.pendingPublicationId) || publishingId === entry.id}
                  onClick={() => setDraft(entry)}
                >
                  Edit
                </Button>
              )}
              {!readOnly && (
                <GuideVideoBuilder
                  disabled={
                    Boolean(entry.pendingPublicationId) ||
                    publishingId === entry.id ||
                    (entry.videos?.length ?? 0) >= 12
                  }
                  onExport={(video) => attachEntryVideo(entry, video)}
                />
              )}
              {!readOnly &&
                localEntryIds.has(entry.id) &&
                window.electronAPI?.catalogPublisher?.publishTech && (
                  <CharacterEntryActionButton
                    action="publish"
                    disabled={
                      Boolean(publishingId) ||
                      Boolean(entry.pendingPublicationId) ||
                      !canPublishEntry(entry)
                    }
                    onClick={() => void publish(entry)}
                    label={
                      entry.pendingPublicationId
                        ? "Queued for video upload and publication"
                        : publishingId === entry.id
                          ? entry.videos?.some((video) => video.localVideoId && !video.url)
                            ? "Uploading videos and publishing…"
                            : "Publishing…"
                          : !canPublishEntry(entry)
                            ? "Publish section first"
                            : entry.publishedRevision
                              ? "Publish update"
                              : "Publish"
                    }
                  />
                )}
              {!readOnly && localEntryIds.has(entry.id) && (
                <CharacterEntryActionButton
                  action="delete"
                  label={`Delete ${entry.title}`}
                  disabled={Boolean(entry.pendingPublicationId) || publishingId === entry.id}
                  onClick={() => {
                    if (
                      window.confirm(`Delete ${entry.title}?`) &&
                      save(readCharacterTech().filter((item) => item.id !== entry.id))
                    )
                      onSelectEntry(null);
                  }}
                />
              )}
            </>
          )
        }
      >
        {kind === "guide" &&
          ((entry.relatedTechIds?.length ?? 0) > 0 || (entry.relatedComboIds?.length ?? 0) > 0) && (
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
              <Typography variant="caption" color="text.secondary">
                Related
              </Typography>
              {entry.relatedTechIds?.map((id) => {
                const related = relatedTech.get(id);
                const relatedKind = related?.kind;
                const relatedSupportId = related?.supportId ?? null;
                return related && (relatedKind === "pressure" || relatedKind === "oki") ? (
                  <Button
                    key={id}
                    size="small"
                    onClick={() => onOpenTech?.(relatedKind, id, relatedSupportId)}
                  >
                    {labels[relatedKind]}: {related.title}
                  </Button>
                ) : null;
              })}
              {entry.relatedComboIds?.map((id) => (
                <Button
                  key={id}
                  size="small"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent(characterTechOpenComboEvent, { detail: id }),
                    )
                  }
                >
                  Combo: {comboOptions.find((combo) => combo.id === id)?.label ?? id}
                </Button>
              ))}
            </Stack>
          )}
      </CharacterEntryDetail>
    );
  }

  return (
    <>
      <GuidePublicationFeedback
        publishingTitle={entries.find((entry) => entry.id === publishingId)?.title}
        queued={queuedPublications}
        progress={progress}
        error={!sectionDraft && !editorOpen ? error : ""}
        connectionError={publicationError}
        publishedTitle={publishedTitle}
        onCheck={() => void checkPublication()}
        onDismissSuccess={() => setPublishedTitle("")}
      />
      <CharacterEntryBrowser
        label={`Browse ${labels[kind]}`}
        selectedId={selectedEntryId}
        reading={reading}
        editing={Boolean(sectionDraft || editorOpen)}
        onSelect={onSelectEntry}
        onReadingChange={onReadingChange}
        detail={renderDetail}
      >
        <CharacterTabActions>
          {!reading && !readOnly && (
            <Button
              size="small"
              variant="contained"
              color="info"
              onClick={addSection}
              disabled={Boolean(publishingId)}
            >
              Add section
            </Button>
          )}
          <Button size="small" onClick={() => setRefresh((count) => count + 1)}>
            Refresh
          </Button>
        </CharacterTabActions>
        {readOnly && displayed.length === 0 && visibleSections.length === 0 && (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography color="text.secondary">{emptyMessage}</Typography>
          </Paper>
        )}
        {visibleSections.map((section) => {
          const sectionEntries = entriesBySection.get(section.id) ?? [];
          const localSection = localSectionIds.has(section.id);
          const publishedSection = publishedSectionsById.get(section.id);
          const localDraft =
            localSection && hasUnpublishedChanges(section, publishedSection, sectionPublication);
          const hasChanges = !publishedSection || localDraft;
          return (
            <CharacterEntrySection
              key={section.id}
              headingId={`note-section-${section.id}`}
              title={section.title}
              description={section.description}
              compact={reading}
              localDraft={localDraft}
              metadata={
                <ScopePortrait
                  {...getScopePortrait(
                    section.supportId ? "support" : "character",
                    section.supportId || section.characterId,
                  )}
                />
              }
              addEntry={
                readOnly
                  ? undefined
                  : {
                      label: `Add ${kind} to ${section.title}`,
                      onClick: () => addEntry(section),
                    }
              }
              editSection={
                readOnly
                  ? undefined
                  : {
                      label: `Edit section ${section.title}`,
                      disabled: Boolean(publishingId),
                      onClick: () => setSectionDraft(section),
                    }
              }
              headerActions={
                !readOnly && (
                  <>
                    {localSection &&
                      hasChanges &&
                      window.electronAPI?.catalogPublisher?.publishTech && (
                        <CharacterEntryActionButton
                          action="publish"
                          disabled={Boolean(publishingId)}
                          onClick={() => void publishSection(section)}
                          label={
                            publishingId === section.id
                              ? "Publishing…"
                              : section.publishedRevision
                                ? `Publish section update for ${section.title}`
                                : `Publish section ${section.title}`
                          }
                        />
                      )}
                    {localSection && (
                      <CharacterEntryActionButton
                        action="delete"
                        label={`Delete local section ${section.title}`}
                        disabled={Boolean(publishingId)}
                        onClick={() => {
                          const latestEntries = readCharacterTech();
                          if (
                            !section.publishedRevision &&
                            latestEntries.some((entry) => entry.sectionId === section.id)
                          ) {
                            setError(
                              "Move the entries to another section or Unsectioned before deleting this section.",
                            );
                            return;
                          }
                          if (window.confirm(`Delete the local copy of ${section.title}?`))
                            saveSections(
                              readLocalNoteSections().filter((item) => item.id !== section.id),
                            );
                        }}
                      />
                    )}
                  </>
                )
              }
              emptyMessage="No entries in this section yet."
              cards={sectionEntries.map(renderCard)}
            />
          );
        })}
        {(supportId ? [null, supportId] : [null]).map((scope) => {
          const group = unsectioned.filter((entry) => entry.supportId === scope);
          const canAdd = !readOnly && scope === null;
          if (!group.length && (!canAdd || reading)) return null;
          const headingId = scope
            ? `unsectioned-character-notes-${scope}`
            : "unsectioned-character-notes";
          return (
            <CharacterEntrySection
              key={headingId}
              headingId={headingId}
              title="Unsectioned"
              compact={reading}
              metadata={
                <ScopePortrait
                  {...getScopePortrait(scope ? "support" : "character", scope ?? characterId)}
                />
              }
              addEntry={
                canAdd ? { label: `Add unsectioned ${kind}`, onClick: () => addEntry() } : undefined
              }
              emptyMessage={!displayed.length && !visibleSections.length ? emptyMessage : undefined}
              cards={group.map(renderCard)}
            />
          );
        })}
      </CharacterEntryBrowser>
      <CharacterSectionDialog
        label="section"
        draft={sectionDraft}
        editing={Boolean(
          sectionDraft?.publishedRevision || localSectionIds.has(sectionDraft?.id ?? ""),
        )}
        supportOnly={Boolean(sectionDraft?.supportId)}
        supportDisabled={
          !supportId ||
          Boolean(sectionDraft?.publishedRevision) ||
          entries.some(
            (entry) =>
              entry.sectionId === sectionDraft?.id &&
              (entry.publishedRevision || entry.pendingPublicationId),
          )
        }
        error={error}
        onChange={(fields) => setSectionDraft((current) => current && { ...current, ...fields })}
        onSupportChange={(checked) =>
          setSectionDraft(
            (current) => current && { ...current, supportId: checked ? supportId : null },
          )
        }
        onClose={() => setSectionDraft(null)}
        onSave={() => {
          if (!sectionDraft?.title.trim()) return;
          saveSections([
            ...readLocalNoteSections().filter((section) => section.id !== sectionDraft.id),
            {
              ...sectionDraft,
              title: sectionDraft.title.trim(),
              description: sectionDraft.description.trim(),
            },
          ]);
        }}
      />
    </>
  );
}
