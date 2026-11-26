import { useEffect, useState } from "react";
import { ScopePortrait, type GetScopePortrait } from "./ScopePortrait";
import {
  Alert,
  Button,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
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
  fetchPublishedTech,
  type PublishedTech,
  type TechEntry,
  type TechSection,
} from "./published-tech";
import { GuideVideoBuilder } from "./GuideVideoBuilder";
import { GuidePublicationFeedback } from "./GuidePublicationFeedback";
import { useGuidePublications } from "./guide-publication";
import {
  attachLocalGuideVideo,
  guideVideoContent,
  hasUnpublishedChanges,
  localTechForSelection,
  mergePublishedVideos,
  readLocalTech,
  removeLocalCategory,
  videosForPublication,
  writeLocalTech,
  type LocalTech,
  type LocalTechCategory,
  type LocalTechGuide,
  type LocalGuideVideoSlot,
  type LocalTechVideo,
} from "./local-tech";

function categoryPublication({
  id,
  scopeKind,
  subjectId,
  title,
  description,
  sortOrder,
}: Omit<TechSection, "revision">) {
  return {
    id,
    scopeKind,
    subjectId,
    title: title.trim(),
    description: description.trim(),
    sortOrder,
  };
}

function guidePublicationContent(guide: LocalTechGuide | TechEntry) {
  return {
    sectionId: guide.sectionId,
    title: guide.title.trim(),
    description: guide.description.trim(),
    notation: guide.notation.trim(),
    sortOrder: guide.sortOrder,
    videos: guideVideoContent(guide.videos),
  };
}

function newCategory(characterId: string): LocalTechCategory {
  return {
    id: crypto.randomUUID(),
    scopeKind: "character",
    subjectId: characterId,
    title: "",
    description: "",
    sortOrder: 0,
    updatedAt: new Date().toISOString(),
  };
}

function newGuide(sectionId: string): LocalTechGuide {
  return {
    id: crypto.randomUUID(),
    sectionId,
    title: "",
    description: "",
    notation: "",
    videos: [],
    sortOrder: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function CharacterTechPage({
  active,
  characterId,
  supportId,
  getScopePortrait,
  selectedEntryId,
  onSelectEntry,
  onReadingChange,
  readOnly = false,
}: {
  active: boolean;
  characterId: string;
  supportId: string;
  getScopePortrait: GetScopePortrait;
  selectedEntryId: string | null;
  onSelectEntry: (id: string | null) => void;
  onReadingChange: (reading: boolean) => void;
  readOnly?: boolean;
}) {
  const [catalog, setCatalog] = useState<PublishedTech | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [local, setLocal] = useState<LocalTech>(readLocalTech);
  const [categoryDraft, setCategoryDraft] = useState<LocalTechCategory | null>(null);
  const [guideDraft, setGuideDraft] = useState<LocalTechGuide | null>(null);
  const [videoSelectionsBusy, setVideoSelectionsBusy] = useState(0);
  const [localError, setLocalError] = useState("");
  const [publishingId, setPublishingId] = useState("");
  const [publishedTitle, setPublishedTitle] = useState("");
  const queuedPublications = readOnly
    ? []
    : local.guides.flatMap((guide) =>
        guide.pendingPublicationId ? [{ id: guide.pendingPublicationId, title: guide.title }] : [],
      );
  const {
    error: publicationError,
    progress,
    check: checkPublication,
  } = useGuidePublications(
    queuedPublications.map(({ id }) => id),
    (job) => {
      const latest = readLocalTech();
      const publishedGuide = latest.guides.find((guide) => guide.pendingPublicationId === job.id);
      if (!publishedGuide) return;
      const next = {
        ...latest,
        guides: latest.guides.map((guide) => {
          if (guide.pendingPublicationId !== job.id) return guide;
          const { pendingPublicationId: _pending, ...draft } = guide;
          return job.result
            ? {
                ...draft,
                publishedRevision: job.result.revision,
                videos: mergePublishedVideos(draft.videos, job.result.videos),
              }
            : draft;
        }),
      };
      try {
        writeLocalTech(next);
        setLocal(next);
        setRefresh((count) => count + 1);
        if (job.status === "failed")
          setLocalError(job.error || "Guide publication failed. You can retry publishing.");
        else if (job.status === "published") setPublishedTitle(publishedGuide.title);
      } catch {
        setLocalError("Could not save publication status on this device.");
      }
    },
  );
  const visibleLocal = readOnly
    ? { categories: [], guides: [] }
    : localTechForSelection(local, characterId, supportId);
  const localCategoryIds = new Set(visibleLocal.categories.map((category) => category.id));
  const localGuideIds = new Set(visibleLocal.guides.map((guide) => guide.id));
  const catalogSections = (catalog?.sections ?? []).filter(
    (section) => section.subjectId === (section.scopeKind === "support" ? supportId : characterId),
  );
  const publishedCategoriesById = new Map(catalogSections.map((section) => [section.id, section]));
  const publishedGuidesById = new Map(catalog?.entries.map((entry) => [entry.id, entry]));
  const publishedSections = catalogSections.filter(
    (section) =>
      !localCategoryIds.has(section.id) ||
      catalog?.entries.some(
        (entry) => entry.sectionId === section.id && !localGuideIds.has(entry.id),
      ),
  );
  const selectedLocalGuide = visibleLocal.guides.find((guide) => guide.id === selectedEntryId);
  const selectedLocalCategory = visibleLocal.categories.find(
    (category) => category.id === selectedLocalGuide?.sectionId,
  );
  const selectedEntry = !selectedLocalGuide
    ? catalog?.entries.find((entry) => entry.id === selectedEntryId)
    : undefined;
  const selectedSection = publishedSections.find(
    (section) => section.id === selectedEntry?.sectionId,
  );
  const hasSelection = Boolean(
    (selectedLocalGuide && selectedLocalCategory) || (selectedEntry && selectedSection),
  );
  const creatingGuide = Boolean(
    !readOnly &&
    !hasSelection &&
    guideDraft &&
    localCategoryIds.has(guideDraft.sectionId) &&
    !local.guides.some((guide) => guide.id === guideDraft.id),
  );
  const reading = active && (hasSelection || creatingGuide);
  const editorOpen =
    creatingGuide || Boolean(guideDraft && guideDraft.id === selectedLocalGuide?.id);
  function toggleGuide(id: string) {
    onSelectEntry(selectedEntryId === id ? null : id);
  }

  function saveLocal(next: LocalTech, close: "category" | "guide") {
    try {
      writeLocalTech(next);
      setLocal(next);
      setLocalError("");
      if (close === "category") setCategoryDraft(null);
      else setGuideDraft(null);
      return true;
    } catch {
      setLocalError(
        "Could not save local Tech on this device. Check available storage and try again.",
      );
      return false;
    }
  }

  function attachGuideVideo(guideId: string, video: LocalTechVideo, slot?: LocalGuideVideoSlot) {
    const latest = readLocalTech();
    const guide = latest.guides.find((item) => item.id === guideId);
    if (!guide) throw new Error("The local guide is no longer available.");
    if (guide.pendingPublicationId) throw new Error("Wait for the guide to finish publishing.");
    const updated = {
      ...guide,
      videos: attachLocalGuideVideo(guide.videos, video, slot),
      updatedAt: new Date().toISOString(),
    };
    const next = {
      ...latest,
      guides: latest.guides.map((item) => (item.id === guideId ? updated : item)),
    };
    writeLocalTech(next);
    setLocal(next);
  }

  function saveCategory() {
    if (!categoryDraft?.title.trim()) return;
    const next = {
      ...categoryDraft,
      title: categoryDraft.title.trim(),
      description: categoryDraft.description.trim(),
      updatedAt: new Date().toISOString(),
    };
    saveLocal(
      { ...local, categories: [...local.categories.filter((item) => item.id !== next.id), next] },
      "category",
    );
  }

  function saveGuide() {
    if (!guideDraft || !guideDraftValid) return;
    const next = {
      ...guideDraft,
      title: guideDraft.title.trim(),
      description: guideDraft.description.trim(),
      videos: guideDraft.videos.map((video) => ({
        ...(video.slotId ? { slotId: video.slotId } : {}),
        title: video.title.trim(),
        description: video.description.trim(),
        url: video.url.trim(),
        ...(video.localVideoId
          ? { localVideoId: video.localVideoId, localFileName: video.localFileName }
          : {}),
      })),
      updatedAt: new Date().toISOString(),
    };
    const saved = saveLocal(
      { ...local, guides: [...local.guides.filter((item) => item.id !== next.id), next] },
      "guide",
    );
    if (saved && creatingGuide) onSelectEntry(next.id);
  }

  const guideDraftValid = Boolean(
    guideDraft?.title.trim() &&
    visibleLocal.categories.some((category) => category.id === guideDraft.sectionId) &&
    Number.isInteger(guideDraft.sortOrder) &&
    guideDraft.sortOrder >= 0 &&
    guideDraft.sortOrder <= 10000 &&
    entryVideosValid(guideDraft.videos),
  );

  async function publishCategory(category: LocalTechCategory) {
    const publisher = window.electronAPI?.catalogPublisher;
    if (!publisher?.publishTech) return;
    setPublishingId(category.id);
    setLocalError("");
    try {
      const item = categoryPublication(category);
      const result = await publisher.publishTech({
        type: "section",
        item,
        expectedRevision: category.publishedRevision ?? 0,
      });
      if (!result.cancelled && !result.pending) {
        const latest = readLocalTech();
        const next = {
          ...latest,
          categories: latest.categories.map((current) =>
            current.id === category.id
              ? { ...current, publishedRevision: result.revision }
              : current,
          ),
        };
        writeLocalTech(next);
        setLocal(next);
        setCatalog((current) => ({
          entries: current?.entries ?? [],
          sections: [
            ...(current?.sections ?? []).filter((section) => section.id !== item.id),
            { ...item, revision: result.revision },
          ],
        }));
        setRefresh((count) => count + 1);
      }
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPublishingId("");
    }
  }

  async function publishGuide(guide: LocalTechGuide) {
    const publisher = window.electronAPI?.catalogPublisher;
    if (!publisher?.publishTech) return;
    setPublishingId(guide.id);
    setPublishedTitle("");
    setLocalError("");
    try {
      const {
        updatedAt: _updatedAt,
        publishedRevision: _revision,
        pendingPublicationId: _pending,
        ...item
      } = guide;
      const result = await publisher.publishTech({
        type: "tech",
        item: { ...item, videos: videosForPublication(item.videos) },
        expectedRevision: guide.publishedRevision ?? 0,
      });
      if (!result.cancelled && result.pending) {
        const latest = readLocalTech();
        const next = {
          ...latest,
          guides: latest.guides.map((current) =>
            current.id === guide.id ? { ...current, pendingPublicationId: result.jobId } : current,
          ),
        };
        writeLocalTech(next);
        setLocal(next);
        return;
      }
      if (!result.cancelled) {
        const latest = readLocalTech();
        const next = {
          ...latest,
          guides: latest.guides.map((current) =>
            current.id === guide.id
              ? {
                  ...current,
                  publishedRevision: result.revision,
                  videos: result.videos
                    ? mergePublishedVideos(current.videos, result.videos)
                    : current.videos,
                }
              : current,
          ),
        };
        writeLocalTech(next);
        setLocal(next);
        setRefresh((count) => count + 1);
        setPublishedTitle(guide.title);
      }
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPublishingId("");
    }
  }

  useEffect(() => {
    if (!active || !characterId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchPublishedTech(characterId, supportId).then(
      (next) => {
        if (!cancelled) {
          setCatalog(next);
          setLoading(false);
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setCatalog(null);
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, characterId, supportId, refresh]);

  function renderGuideEditor(guideDraft: LocalTechGuide) {
    return (
      <CharacterEntryEditor
        key={guideDraft.id}
        id={guideDraft.id}
        heading={creatingGuide ? "Add Tech guide" : "Edit Tech guide"}
        category={
          <TextField
            select
            variant="standard"
            size="small"
            label="Category"
            required
            value={guideDraft.sectionId}
            sx={{ mb: 0.5, width: "min(100%, 22rem)" }}
            onChange={(event) => setGuideDraft({ ...guideDraft, sectionId: event.target.value })}
          >
            {visibleLocal.categories.map((category) => (
              <MenuItem key={category.id} value={category.id}>
                <Stack component="span" direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <span>{category.title}</span>
                  <ScopePortrait {...getScopePortrait(category.scopeKind, category.subjectId)} />
                </Stack>
              </MenuItem>
            ))}
          </TextField>
        }
        title={guideDraft.title}
        error={localError}
        canSave={guideDraftValid && videoSelectionsBusy === 0}
        onTitleChange={(title) => setGuideDraft((current) => current && { ...current, title })}
        onClose={() => setGuideDraft(null)}
        onSave={saveGuide}
      >
        <CharacterEntryTextField
          label="Short description"
          value={guideDraft.description}
          minRows={2}
          maxLength={1200}
          onChange={(description) => setGuideDraft({ ...guideDraft, description })}
        />
        <CharacterEntryVideoFields
          videos={guideDraft.videos}
          busy={videoSelectionsBusy > 0}
          onBusyChange={(busy) =>
            setVideoSelectionsBusy((count) => Math.max(0, count + (busy ? 1 : -1)))
          }
          onChange={(update) =>
            setGuideDraft((current) =>
              current?.id === guideDraft.id
                ? { ...current, videos: update(current.videos) }
                : current,
            )
          }
        />
        <TextField
          label="Display order"
          variant="standard"
          type="number"
          value={guideDraft.sortOrder}
          sx={{ width: 180, maxWidth: "100%" }}
          slotProps={{ htmlInput: { min: 0, max: 10000, step: 1 } }}
          helperText="Lower numbers appear first"
          onChange={(event) =>
            setGuideDraft({ ...guideDraft, sortOrder: Number(event.target.value) })
          }
        />
      </CharacterEntryEditor>
    );
  }

  function renderDetail(onClose: () => void) {
    if (editorOpen && guideDraft) return renderGuideEditor(guideDraft);
    if (selectedLocalGuide && selectedLocalCategory) {
      return (
        <CharacterEntryDetail
          key={selectedLocalGuide.id}
          entry={selectedLocalGuide}
          categoryTitle={selectedLocalCategory.title}
          onClose={onClose}
          onFillVideoSlot={(video, slot) => attachGuideVideo(selectedLocalGuide.id, video, slot)}
          recordingDisabled={
            Boolean(selectedLocalGuide.pendingPublicationId) ||
            publishingId === selectedLocalGuide.id
          }
          actions={
            <>
              <Button
                size="small"
                variant="outlined"
                color="info"
                disabled={
                  Boolean(selectedLocalGuide.pendingPublicationId) ||
                  publishingId === selectedLocalGuide.id
                }
                onClick={() => setGuideDraft(selectedLocalGuide)}
              >
                Edit guide
              </Button>
              <GuideVideoBuilder
                disabled={
                  Boolean(selectedLocalGuide.pendingPublicationId) ||
                  publishingId === selectedLocalGuide.id ||
                  selectedLocalGuide.videos.length >= 12
                }
                onExport={(video) => attachGuideVideo(selectedLocalGuide.id, video)}
              />
              {window.electronAPI?.catalogPublisher?.publishTech && (
                <CharacterEntryActionButton
                  action="publish"
                  disabled={
                    Boolean(publishingId) ||
                    Boolean(selectedLocalGuide.pendingPublicationId) ||
                    !selectedLocalCategory.publishedRevision
                  }
                  onClick={() => void publishGuide(selectedLocalGuide)}
                  label={
                    selectedLocalGuide.pendingPublicationId
                      ? "Queued for video upload and publication"
                      : publishingId === selectedLocalGuide.id
                        ? selectedLocalGuide.videos.some(
                            (video) => video.localVideoId && !video.url,
                          )
                          ? "Uploading videos and publishing…"
                          : "Publishing…"
                        : !selectedLocalCategory.publishedRevision
                          ? "Publish category first"
                          : selectedLocalGuide.publishedRevision
                            ? "Publish update"
                            : "Publish guide"
                  }
                />
              )}
              <CharacterEntryActionButton
                action="delete"
                label={`Delete guide ${selectedLocalGuide.title}`}
                disabled={
                  Boolean(selectedLocalGuide.pendingPublicationId) ||
                  publishingId === selectedLocalGuide.id
                }
                onClick={() => {
                  if (!window.confirm("Delete " + selectedLocalGuide.title + "?")) return;
                  saveLocal(
                    {
                      ...local,
                      guides: local.guides.filter((item) => item.id !== selectedLocalGuide.id),
                    },
                    "guide",
                  );
                  onSelectEntry(null);
                }}
              />
            </>
          }
        />
      );
    }
    if (selectedEntry && selectedSection) {
      return (
        <CharacterEntryDetail
          key={selectedEntry.id}
          entry={selectedEntry}
          categoryTitle={selectedSection.title}
          onClose={onClose}
        />
      );
    }
    return null;
  }

  return (
    <>
      <GuidePublicationFeedback
        publishingTitle={local.guides.find((guide) => guide.id === publishingId)?.title}
        queued={queuedPublications}
        progress={progress}
        error={!categoryDraft && !editorOpen ? localError : ""}
        connectionError={publicationError}
        publishedTitle={publishedTitle}
        onCheck={() => void checkPublication()}
        onDismissSuccess={() => setPublishedTitle("")}
      />
      <CharacterEntryBrowser
        label="Browse Tech guides"
        selectedId={selectedEntryId}
        reading={reading}
        editing={Boolean(categoryDraft || editorOpen)}
        onSelect={onSelectEntry}
        onReadingChange={onReadingChange}
        detail={renderDetail}
      >
        <CharacterTabActions>
          {!reading && !readOnly && (
            <Button
              variant="contained"
              size="small"
              color="info"
              onClick={() => setCategoryDraft(newCategory(characterId))}
            >
              Add category
            </Button>
          )}
          <Button size="small" onClick={() => setRefresh((count) => count + 1)} disabled={loading}>
            Refresh
          </Button>
        </CharacterTabActions>
        {!reading && (
          <Typography color="text.secondary">
            Short tools and techniques for this character and support, grouped by concept.
          </Typography>
        )}
        {!readOnly && visibleLocal.categories.length === 0 && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography color="text.secondary">
              No local Tech categories for this character or support yet. Add one to start drafting
              guides on this device.
            </Typography>
          </Paper>
        )}
        {visibleLocal.categories.map((category) => {
          const guides = visibleLocal.guides.filter((guide) => guide.sectionId === category.id);
          const publishedCategory = publishedCategoriesById.get(category.id);
          const localDraft = hasUnpublishedChanges(
            category,
            publishedCategory,
            categoryPublication,
          );
          const hasChanges = !publishedCategory || localDraft;
          return (
            <CharacterEntrySection
              key={category.id}
              headingId={`local-tech-${category.id}`}
              title={category.title}
              description={category.description}
              compact={reading}
              localDraft={localDraft}
              metadata={
                <ScopePortrait {...getScopePortrait(category.scopeKind, category.subjectId)} />
              }
              addEntry={
                readOnly
                  ? undefined
                  : {
                      label: `Add guide to ${category.title}`,
                      onClick: () => setGuideDraft(newGuide(category.id)),
                    }
              }
              editSection={
                readOnly
                  ? undefined
                  : {
                      label: `Edit category ${category.title}`,
                      onClick: () => setCategoryDraft(category),
                    }
              }
              headerActions={
                <>
                  {!readOnly && hasChanges && window.electronAPI?.catalogPublisher?.publishTech && (
                    <CharacterEntryActionButton
                      action="publish"
                      disabled={Boolean(publishingId)}
                      onClick={() => void publishCategory(category)}
                      label={
                        publishingId === category.id
                          ? "Publishing…"
                          : category.publishedRevision
                            ? `Publish category update for ${category.title}`
                            : `Publish category ${category.title}`
                      }
                    />
                  )}
                  {!readOnly && (
                    <CharacterEntryActionButton
                      action="delete"
                      label={`Delete category ${category.title}`}
                      disabled={
                        Boolean(publishingId) ||
                        guides.some((guide) => Boolean(guide.pendingPublicationId))
                      }
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete ${category.title} and its ${guides.length} local guide${guides.length === 1 ? "" : "s"}?`,
                          )
                        ) {
                          saveLocal(removeLocalCategory(local, category.id), "category");
                          if (selectedLocalCategory?.id === category.id) onSelectEntry(null);
                        }
                      }}
                    />
                  )}
                </>
              }
              emptyMessage="No local guides in this category yet."
              cards={guides.map((guide) => (
                <CharacterEntryCard
                  key={guide.id}
                  entry={guide}
                  compact={reading}
                  selected={reading && selectedEntryId === guide.id}
                  localDraft={hasUnpublishedChanges(
                    guide,
                    publishedGuidesById.get(guide.id),
                    guidePublicationContent,
                  )}
                  published={Boolean(guide.publishedRevision)}
                  onSelect={() => toggleGuide(guide.id)}
                />
              ))}
            />
          );
        })}
        <Typography variant="subtitle2" color="text.secondary">
          Published Tech
        </Typography>
        {loading && <CircularProgress size={24} aria-label="Loading tech" />}
        {error && <Alert severity="warning">{error}</Alert>}
        {!loading && !error && catalog?.sections.length === 0 && (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography color="text.secondary">No published tech yet.</Typography>
          </Paper>
        )}
        {publishedSections.map((section) => {
          const entries = (catalog?.entries ?? []).filter(
            (entry) => entry.sectionId === section.id && !localGuideIds.has(entry.id),
          );
          return (
            <CharacterEntrySection
              key={section.id}
              headingId={`tech-section-${section.id}`}
              title={section.title}
              description={section.description}
              compact={reading}
              metadata={
                <ScopePortrait {...getScopePortrait(section.scopeKind, section.subjectId)} />
              }
              emptyMessage="No published tools in this subsection yet."
              cards={entries.map((entry) => (
                <CharacterEntryCard
                  key={entry.id}
                  entry={entry}
                  compact={reading}
                  selected={reading && selectedEntryId === entry.id}
                  published
                  onSelect={() => toggleGuide(entry.id)}
                />
              ))}
            />
          );
        })}
      </CharacterEntryBrowser>
      <CharacterSectionDialog
        label="category"
        draft={categoryDraft}
        editing={local.categories.some((item) => item.id === categoryDraft?.id)}
        supportOnly={categoryDraft?.scopeKind === "support"}
        supportDisabled={!supportId || Boolean(categoryDraft?.publishedRevision)}
        error={localError}
        onChange={(fields) => setCategoryDraft((current) => current && { ...current, ...fields })}
        onSupportChange={(checked) =>
          setCategoryDraft(
            (current) =>
              current && {
                ...current,
                scopeKind: checked ? "support" : "character",
                subjectId: checked ? supportId : characterId,
              },
          )
        }
        onClose={() => setCategoryDraft(null)}
        onSave={saveCategory}
      />
    </>
  );
}
