import type { ComboItem, ComboWorkspaceData, LocalCombo } from "./combo-gameplan";
import { comboItems, localRevisionDraft, slugComboText } from "./combo-gameplan";
import { comboStarterFromRoute } from "./combo-starter";
import { normalizeComboNotes } from "./combo-notes";
import type { TechResourceCosts } from "./tech-types";
import type { RecordedVideo } from "./recording-types";
import type { PublishedCombo } from "./published-catalog";

export type CandidateCombo = {
  id: string;
  characterId: string;
  supportId: string;
  name?: string;
  difficulty?: number;
  editorPickReason?: string;
  editorPickContext?: string;
  route: string;
  starterIsNonAttackStance?: boolean;
  routingMode?: "autopilot" | "unique";
  moveIds: string[];
  screenPosition: string;
  damage: string;
  notes: ReturnType<typeof normalizeComboNotes>;
  resourceCosts: TechResourceCosts;
  mechanics: string[];
};

export type ComboCandidate = {
  id: string;
  originCandidateId?: string;
  combo: CandidateCombo;
  fileName: string;
  fileSize: number;
  status: "pending" | "approved" | "rejected" | "uploaded";
  rejectionReason: string;
  youtubeUrl: string;
  createdAt: string;
  updatedAt: string;
};

export function candidateReviewStatus(candidate: ComboCandidate): string {
  if (candidate.status === "pending" || candidate.status === "approved")
    return "Awaiting YouTube upload";
  return candidate.status === "rejected" ? "Rejected" : "Uploaded";
}

function sameComboIdentity(combo: CandidateCombo, published: PublishedCombo): boolean {
  const sortedEntries = (costs: Record<string, number>) =>
    JSON.stringify(Object.entries(costs).sort(([a], [b]) => a.localeCompare(b)));
  const sortedMechanics = (mechanics: string[]) => JSON.stringify([...mechanics].sort());
  return (
    combo.characterId === published.characterId &&
    combo.supportId === published.supportId &&
    combo.route.trim().replace(/\s+/g, " ") === published.route.trim().replace(/\s+/g, " ") &&
    combo.damage === published.damage &&
    combo.screenPosition === published.screenPosition &&
    Boolean(combo.starterIsNonAttackStance) === Boolean(published.starterIsNonAttackStance) &&
    sortedEntries(combo.resourceCosts) === sortedEntries(published.resourceCosts) &&
    sortedMechanics(combo.mechanics) === sortedMechanics(published.mechanics)
  );
}

export function candidateMatchesPublishedCombo(
  candidate: ComboCandidate,
  published: PublishedCombo,
): boolean {
  return (
    candidate.id === published.sourceCandidateId ||
    candidate.originCandidateId === published.sourceCandidateId ||
    (!candidate.originCandidateId && sameComboIdentity(candidate.combo, published))
  );
}

/** Match submitted drafts and editor-held candidate copies to their published catalog record. */
export function candidatePublicationMatches(
  workspace: ComboWorkspaceData,
  publishedCombos: PublishedCombo[],
): Array<{ localId: string; published: PublishedCombo; readyToReplace: boolean }> {
  return workspace.localCombos.flatMap((local) => {
    const submission = workspace.candidateSubmissions[local.id];
    if (!submission && !local.needsCatalogPublication) return [];
    const candidateId = submission?.originCandidateId ?? submission?.id ?? local.candidateOriginId;
    if (!candidateId) return [];
    const localDraft = candidateComboFromItem(comboItems([], [], [local])[0]);
    const matchesById = publishedCombos.filter((combo) => combo.sourceCandidateId === candidateId);
    const matches =
      matchesById.length || submission?.originCandidateId || local.candidateOriginId
        ? matchesById
        : publishedCombos.filter((combo) => sameComboIdentity(localDraft, combo));
    if (matches.length !== 1) return [];
    const published = matches[0];
    const readyToReplace =
      Boolean(local.candidateOriginId === candidateId && local.needsCatalogPublication) ||
      (submission?.draftSignature
        ? JSON.stringify(localDraft) === submission.draftSignature
        : local.characterId === published.characterId &&
          local.supportId === published.supportId &&
          local.route === published.route &&
          local.damage === published.damage &&
          local.screenPosition === published.screenPosition);
    return [{ localId: local.id, published, readyToReplace }];
  });
}

export function savedCandidateRecording(
  candidate: ComboCandidate,
  recordings: RecordedVideo[],
  recordingLinks: ComboWorkspaceData["recordingLinks"],
): RecordedVideo | null {
  const linkedId = recordingLinks[`candidate:${candidate.id}`]?.recordingId;
  const downloadedIds = [
    `candidate-${candidate.id}.mp4`,
    `Imported Combos/candidate-${candidate.id}.mp4`,
  ];
  const usable = (recording: RecordedVideo) =>
    recording.mediaKind === "local" &&
    /\.mp4$/i.test(recording.name) &&
    recording.size === candidate.fileSize;
  return (
    recordings.find((recording) => recording.id === linkedId && usable(recording)) ??
    downloadedIds
      .map((id) => recordings.find((recording) => recording.id === id && usable(recording)))
      .find((recording) => recording !== undefined) ??
    null
  );
}

export function countCandidates(
  candidates: ComboCandidate[],
  characterId: string,
  supportId?: string,
  starter?: string,
): number {
  return candidates.filter(
    (candidate) =>
      isActiveCandidate(candidate) &&
      candidate.combo.characterId === characterId &&
      (!supportId || candidate.combo.supportId === supportId) &&
      (!starter ||
        comboStarterFromRoute(candidate.combo.route, candidate.combo.starterIsNonAttackStance) ===
          starter),
  ).length;
}

export function isActiveCandidate(candidate: ComboCandidate): boolean {
  return candidate.status === "pending" || candidate.status === "approved";
}

export function candidateItem(candidate: ComboCandidate): ComboItem {
  const combo = candidate.combo;
  return {
    id: `candidate:${candidate.id}`,
    source: "Candidate",
    characterId: combo.characterId,
    supportId: combo.supportId,
    starter: comboStarterFromRoute(combo.route, combo.starterIsNonAttackStance),
    name: combo.name?.trim() ?? "",
    route: combo.route,
    screenPosition: combo.screenPosition,
    damage: combo.damage,
    pips: combo.resourceCosts.pips ?? 0,
    flow: combo.resourceCosts.flow ?? 0,
    difficulty: combo.difficulty ?? null,
    hitconfirm: combo.mechanics.some((mechanic) =>
      /initial conversion hitconfirmable/i.test(mechanic),
    )
      ? "yes"
      : "unknown",
    counterhit: combo.mechanics.some((mechanic) =>
      /^(?:requires\s+)?counterhit$/i.test(mechanic.trim()),
    )
      ? "yes"
      : "unknown",
    candidate,
  };
}

export function candidateMatchesItem(item: ComboItem, candidate: ComboCandidate): boolean {
  return (
    item.characterId === candidate.combo.characterId &&
    item.supportId === candidate.combo.supportId &&
    item.route === candidate.combo.route &&
    item.damage === candidate.combo.damage &&
    item.pips === (candidate.combo.resourceCosts.pips ?? 0) &&
    item.flow === (candidate.combo.resourceCosts.flow ?? 0)
  );
}

/** Keep a submitted combo's personal gameplan identity when its upstream snapshot still matches. */
export function mergeCandidateItems(
  items: ComboItem[],
  candidates: ComboCandidate[],
  submissions: Record<string, { id: string }>,
): ComboItem[] {
  const activeCandidates = candidates.filter((candidate) => candidate.status !== "uploaded");
  const candidateById = new Map(activeCandidates.map((candidate) => [candidate.id, candidate]));
  const mergedIds = new Set<string>();
  const merged = items.map((item) => {
    const candidate = candidateById.get(submissions[item.id]?.id ?? "");
    if (!candidate || !candidateMatchesItem(item, candidate)) return item;
    mergedIds.add(candidate.id);
    return { ...item, candidate };
  });
  return [
    ...merged,
    ...activeCandidates.filter((candidate) => !mergedIds.has(candidate.id)).map(candidateItem),
  ];
}

export function localComboFromUploadedCandidate(candidate: ComboCandidate, id: string): LocalCombo {
  const item = candidateItem(candidate);
  const combo = candidate.combo;
  return {
    id,
    characterId: item.characterId,
    supportId: item.supportId,
    starter: item.starter,
    name: item.name,
    route: item.route,
    screenPosition: item.screenPosition,
    damage: item.damage,
    pips: item.pips,
    flow: item.flow,
    difficulty: item.difficulty,
    hitconfirm: item.hitconfirm,
    counterhit: item.counterhit === "yes",
    youtubeUrl: candidate.youtubeUrl,
    editorName: combo.name ?? "",
    editorDifficulty: combo.difficulty ?? null,
    editorPickReason: combo.editorPickReason ?? "",
    editorPickContext: combo.editorPickContext ?? "",
    moveIds: [...combo.moveIds],
    routingMode: combo.routingMode ?? "autopilot",
    editorNotes: normalizeComboNotes(combo.notes),
  };
}

/** Preserve the combo and its tracking before its uploaded candidate row is removed. */
export function finishUploadedCandidate(
  workspace: ComboWorkspaceData,
  candidate: ComboCandidate,
  items: ComboItem[],
  recordingLink?: { recordingId: string; name: string },
): { workspace: ComboWorkspaceData; targetId: string } {
  if (candidate.status !== "uploaded" || !candidate.youtubeUrl) {
    throw new Error("The candidate needs a saved YouTube URL before cleanup.");
  }
  const candidateItemId = `candidate:${candidate.id}`;
  const originCandidateId = candidate.originCandidateId ?? candidate.id;
  const candidateLocalId = `local-candidate-${originCandidateId}`;
  const existingCandidateLocal = workspace.localCombos.find(
    (combo) => combo.id === candidateLocalId,
  );
  const submittedId = Object.entries(workspace.candidateSubmissions).find(
    ([, submission]) => submission.id === candidate.id,
  )?.[0];
  const submittedItem = items.find(
    (item) => item.id === submittedId && candidateMatchesItem(item, candidate),
  );
  let targetId = candidateLocalId;
  let local: LocalCombo;
  if (existingCandidateLocal) {
    local = { ...existingCandidateLocal, youtubeUrl: candidate.youtubeUrl };
  } else if (submittedItem?.local) {
    targetId = submittedItem.id;
    local = { ...submittedItem.local, youtubeUrl: candidate.youtubeUrl };
  } else if (submittedItem?.published) {
    const revision = localRevisionDraft(submittedItem, targetId);
    local = {
      ...(revision ?? localComboFromUploadedCandidate(candidate, targetId)),
      ...localComboFromUploadedCandidate(candidate, targetId),
    };
  } else {
    local = localComboFromUploadedCandidate(candidate, targetId);
  }
  const candidateSubmissions = Object.fromEntries(
    Object.entries(workspace.candidateSubmissions).filter(
      ([, submission]) => submission.id !== candidate.id,
    ),
  );
  const entries = { ...workspace.entries };
  if (entries[candidateItemId] && !entries[targetId]) {
    entries[targetId] = entries[candidateItemId];
  }
  delete entries[candidateItemId];
  const recordingLinks = { ...workspace.recordingLinks };
  const preservedRecording = recordingLink ?? recordingLinks[candidateItemId];
  if (preservedRecording && !recordingLinks[targetId]) {
    recordingLinks[targetId] = preservedRecording;
  }
  delete recordingLinks[candidateItemId];
  local = { ...local, candidateOriginId: originCandidateId, needsCatalogPublication: true };
  return {
    targetId,
    workspace: {
      ...workspace,
      localCombos: [...workspace.localCombos.filter((combo) => combo.id !== targetId), local],
      entries,
      candidateSubmissions,
      recordingLinks,
    },
  };
}

/** Only catalog-facing combo details leave the device. Personal tracking is never included. */
export function candidateComboFromItem(item: ComboItem): CandidateCombo {
  const base = item.published ?? item.local?.publishedBase;
  const local = item.local;
  const id =
    (local?.publishedId ??
      (item.published
        ? item.id
        : slugComboText(`${item.characterId}-${item.supportId}-${item.route}`).slice(0, 100))) ||
    "combo";
  const name = local?.editorName ?? base?.name ?? local?.name ?? "";
  const difficulty = local?.editorDifficulty ?? base?.difficulty ?? undefined;
  const mechanics = (base?.mechanics ?? []).filter(
    (value) =>
      !/^(?:requires\s+)?counterhit$/i.test(value.trim()) &&
      !/initial conversion hitconfirmable/i.test(value),
  );
  return {
    id,
    characterId: item.characterId,
    supportId: item.supportId,
    ...(name.trim() ? { name: name.trim() } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...((local?.editorPickReason ?? base?.editorPickReason)
      ? { editorPickReason: local?.editorPickReason ?? base?.editorPickReason }
      : {}),
    ...((local?.editorPickContext ?? base?.editorPickContext)
      ? { editorPickContext: local?.editorPickContext ?? base?.editorPickContext }
      : {}),
    route: item.route,
    ...(base?.starterIsNonAttackStance ? { starterIsNonAttackStance: true } : {}),
    routingMode: local?.routingMode ?? base?.routingMode ?? "autopilot",
    moveIds: local?.moveIds ?? base?.moveIds ?? [],
    screenPosition: item.screenPosition,
    damage: item.damage,
    notes: normalizeComboNotes(local?.editorNotes ?? base?.notes),
    resourceCosts: { ...base?.resourceCosts, pips: item.pips, flow: item.flow },
    mechanics: [
      ...mechanics,
      ...(item.counterhit === "yes" ? ["Requires counterhit"] : []),
      ...(item.hitconfirm === "yes" ? ["Initial conversion hitconfirmable"] : []),
    ],
  };
}
