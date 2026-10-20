import type { RecordedVideo } from "./recording-types";
import type { TechCombo, TechMove } from "./tech-types";
import type { PublishedCombo } from "./published-catalog";
import { normalizeComboNotes } from "./combo-notes";
import { youtubeVideoId } from "./YouTubeRecordingPlayer";

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function makePublishComboDraft(
  combo: TechCombo,
  recording: RecordedVideo | null,
  moves: TechMove[] = [],
) {
  const warnings: string[] = [];
  const notes = (combo.notes ?? [])
    .map((note) => ({ ...note, text: note.text.trim() }))
    .filter((note) => note.text);
  const moveIds = combo.moveIds.filter((id): id is string => Boolean(id) && Boolean(id?.trim()));
  const unresolved = combo.moveIds.length - moveIds.length;
  const starterMove = moves.find((move) => move.id === combo.moveIds[0]);
  const starterIsNonAttackStance =
    starterMove?.isStanceParent === true && starterMove.isNonAttack === true;
  if (unresolved > 0) {
    warnings.push(
      `${unresolved} route entry or entries have no matched move ID. Review move links before publishing.`,
    );
  }
  if (!recording?.youtubeUrl) {
    warnings.push("Add a YouTube link before publishing. The local recording is only a reference.");
  }
  if (moveIds.some((id) => id.length > 100 || slug(id) !== id)) {
    warnings.push("Some move IDs are not backend slugs. Correct them in the publisher.");
  }
  return {
    schemaVersion: 1,
    source: "labatar-desktop-tech",
    combo: {
      id: slug(combo.id),
      characterId: slug(combo.character),
      supportId: slug(combo.support),
      ...(combo.name?.trim() ? { name: combo.name.trim() } : {}),
      ...(combo.difficulty != null ? { difficulty: combo.difficulty } : {}),
      ...(combo.editorPickReason?.trim()
        ? { editorPickReason: combo.editorPickReason.trim() }
        : {}),
      ...(combo.editorPickContext?.trim()
        ? { editorPickContext: combo.editorPickContext.trim() }
        : {}),
      route: combo.route,
      ...(starterIsNonAttackStance ? { starterIsNonAttackStance: true } : {}),
      ...(combo.routingMode === "unique" ? { routingMode: "unique" as const } : {}),
      moveIds,
      screenPosition: combo.screenPosition,
      damage: combo.damage,
      ...(notes.length ? { notes } : {}),
      resourceCosts: combo.resourceCosts,
      mechanics: [
        ...(combo.requiresCounterhit ? ["Requires counterhit"] : []),
        ...(combo.initialConversionHitconfirmable ? ["Initial conversion hitconfirmable"] : []),
        ...(combo.initialConversionSafeOnBlock ? ["Initial conversion safe on block"] : []),
      ],
      youtubeUrl: recording?.youtubeUrl ?? "",
      startSeconds: 0,
    },
    warnings,
  };
}

export type PublishComboDraft = Omit<ReturnType<typeof makePublishComboDraft>, "combo"> & {
  combo: ReturnType<typeof makePublishComboDraft>["combo"] & { sourceCandidateId?: string };
  /** Zero creates a new combo; a positive value updates exactly that catalog revision. */
  expectedRevision?: number;
};

export function publishedComboFromDraft(draft: PublishComboDraft): PublishedCombo | null {
  const videoId = youtubeVideoId(draft.combo.youtubeUrl);
  if (!videoId) return null;
  return {
    id: draft.combo.id,
    ...(draft.combo.sourceCandidateId ? { sourceCandidateId: draft.combo.sourceCandidateId } : {}),
    characterId: draft.combo.characterId,
    supportId: draft.combo.supportId,
    name: draft.combo.name ?? "",
    difficulty: draft.combo.difficulty ?? null,
    editorPickReason: draft.combo.editorPickReason ?? "",
    editorPickContext: draft.combo.editorPickContext ?? "",
    route: draft.combo.route.trim(),
    ...(draft.combo.starterIsNonAttackStance ? { starterIsNonAttackStance: true } : {}),
    routingMode: draft.combo.routingMode ?? "autopilot",
    moveIds: draft.combo.moveIds,
    screenPosition: draft.combo.screenPosition.trim(),
    damage: draft.combo.damage.trim(),
    notes: draft.combo.notes ?? [],
    resourceCosts: draft.combo.resourceCosts,
    mechanics: draft.combo.mechanics,
    youtubeVideoId: videoId,
    startSeconds: draft.combo.startSeconds,
  };
}

export function matchesPublishedCombo(
  draft: PublishComboDraft,
  published: PublishedCombo | undefined,
): boolean {
  if (!published) return false;
  const combo = draft.combo;
  const costs = Object.entries(combo.resourceCosts);
  const publishedCosts = Object.entries(published.resourceCosts);
  const publishedNotes = normalizeComboNotes(published.notes);
  return (
    combo.id === published.id &&
    (combo.sourceCandidateId ?? "") === (published.sourceCandidateId ?? "") &&
    combo.characterId === published.characterId &&
    combo.supportId === published.supportId &&
    (combo.name ?? "") === (published.name ?? "") &&
    (combo.difficulty ?? null) === (published.difficulty ?? null) &&
    (combo.editorPickReason ?? "") === (published.editorPickReason ?? "") &&
    (combo.editorPickContext ?? "") === (published.editorPickContext ?? "") &&
    combo.route.trim() === published.route &&
    Boolean(combo.starterIsNonAttackStance) === (published.starterIsNonAttackStance ?? false) &&
    (combo.routingMode ?? "autopilot") === (published.routingMode ?? "autopilot") &&
    combo.moveIds.length === published.moveIds.length &&
    combo.moveIds.every((id, index) => id === published.moveIds[index]) &&
    combo.screenPosition.trim() === (published.screenPosition ?? "") &&
    combo.damage.trim() === published.damage &&
    (combo.notes ?? []).length === publishedNotes.length &&
    (combo.notes ?? []).every((note, index) => {
      const other = publishedNotes[index];
      return (
        other &&
        note.id === other.id &&
        note.text === other.text &&
        note.category === other.category &&
        (note.range?.startToken ?? null) === (other.range?.startToken ?? null) &&
        (note.range?.endToken ?? null) === (other.range?.endToken ?? null) &&
        (note.range?.excerpt ?? null) === (other.range?.excerpt ?? null)
      );
    }) &&
    costs.length === publishedCosts.length &&
    costs.every(([key, amount]) => published.resourceCosts[key] === amount) &&
    combo.mechanics.length === published.mechanics.length &&
    combo.mechanics.every((mechanic, index) => mechanic === published.mechanics[index]) &&
    youtubeVideoId(combo.youtubeUrl) === published.youtubeVideoId &&
    combo.startSeconds === published.startSeconds
  );
}
