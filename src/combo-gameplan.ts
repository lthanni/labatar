import { comboStarterFromRoute } from "./combo-starter";
import { normalizeComboNotes } from "./combo-notes";
import { isPublishedCombo } from "./published-catalog";
import type { ComboNote } from "./tech-types";
import type { PublishedCombo, PublishedMove } from "./published-catalog";
import type { ComboCandidate } from "./combo-candidates";

export const comboWorkspaceKey = "labatar-combo-workspace-v1";
const candidateIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const comboStatuses = [
  "Saved for later",
  "Maybe someday",
  "Considering",
  "Learning",
  "Using",
  "Retired",
  "Dismissed",
] as const;
export type ComboStatus = "" | (typeof comboStatuses)[number];
export type ComboRole = "" | "Autopilot" | "Situational";
export type ConfirmFact = "unknown" | "yes" | "no";

export type PersonalComboEntry = {
  status: ComboStatus;
  name: string;
  difficulty: number | null;
  role: ComboRole;
  condition: string;
  tags: string[];
  note: string;
  dismissalReason: string;
};

export type LocalCombo = {
  id: string;
  characterId: string;
  supportId: string;
  starter: string;
  name: string;
  route: string;
  screenPosition: string;
  damage: string;
  pips: number;
  flow: number;
  difficulty: number | null;
  hitconfirm: ConfirmFact;
  counterhit: boolean;
  youtubeUrl: string;
  candidateOriginId?: string;
  needsCatalogPublication?: boolean;
  publishedId?: string;
  publishedRevision?: number;
  publishedBase?: PublishedCombo;
  originCatalog?: boolean;
  editorName?: string;
  editorDifficulty?: number | null;
  editorPickReason?: string;
  editorPickContext?: string;
  moveIds?: string[];
  routingMode?: "autopilot" | "unique";
  editorNotes?: ComboNote[];
};

export type ComboRecordingLink = { recordingId: string; name: string };

export type ComboWorkspaceData = {
  localCombos: LocalCombo[];
  entries: Record<string, PersonalComboEntry>;
  recordingLinks: Record<string, ComboRecordingLink>;
  removedYouTubeVideoIds: Record<string, string[]>;
  candidateSubmissions: Record<
    string,
    { id: string; originCandidateId?: string; submittedAt: string; draftSignature?: string }
  >;
  snapshots: Record<string, CatalogComboSnapshot>;
  characterId: string;
  supportId: string;
  starter: string;
};

export type ComboItem = {
  id: string;
  source: "Catalog" | "Local" | "Unavailable" | "Candidate";
  characterId: string;
  supportId: string;
  starter: string;
  name: string;
  route: string;
  screenPosition: string;
  damage: string;
  pips: number;
  flow: number;
  difficulty: number | null;
  hitconfirm: ConfirmFact;
  counterhit: ConfirmFact;
  published?: PublishedCombo;
  local?: LocalCombo;
  candidate?: ComboCandidate;
};

export type CatalogComboSnapshot = Pick<
  ComboItem,
  | "id"
  | "characterId"
  | "supportId"
  | "starter"
  | "name"
  | "route"
  | "screenPosition"
  | "damage"
  | "pips"
  | "flow"
  | "difficulty"
  | "hitconfirm"
  | "counterhit"
>;

export function catalogSnapshot(item: ComboItem): CatalogComboSnapshot {
  return {
    id: item.id,
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
    counterhit: item.counterhit,
  };
}

const statuses = new Set<string>(["", ...comboStatuses]);
const roles = new Set<string>(["", "Autopilot", "Situational"]);

export function emptyPersonalEntry(): PersonalComboEntry {
  return {
    status: "",
    name: "",
    difficulty: null,
    role: "",
    condition: "",
    tags: [],
    note: "",
    dismissalReason: "",
  };
}

export function emptyComboWorkspace(): ComboWorkspaceData {
  return {
    localCombos: [],
    entries: {},
    recordingLinks: {},
    removedYouTubeVideoIds: {},
    candidateSubmissions: {},
    snapshots: {},
    characterId: "",
    supportId: "",
    starter: "",
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function rating(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5 ? Number(value) : null;
}

function nonnegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function parseComboWorkspace(value: unknown): ComboWorkspaceData {
  if (!record(value) || value.version !== 1) return emptyComboWorkspace();
  const entries: Record<string, PersonalComboEntry> = {};
  if (record(value.entries)) {
    for (const [id, entry] of Object.entries(value.entries)) {
      if (!record(entry)) continue;
      entries[id] = {
        status: statuses.has(text(entry.status)) ? (entry.status as ComboStatus) : "",
        name: text(entry.name),
        difficulty: rating(entry.difficulty),
        role: roles.has(text(entry.role)) ? (entry.role as ComboRole) : "",
        condition: text(entry.condition),
        tags: Array.isArray(entry.tags)
          ? [...new Set(entry.tags.filter((tag): tag is string => typeof tag === "string"))]
          : [],
        note: text(entry.note),
        dismissalReason: text(entry.dismissalReason),
      };
    }
  }
  const localCombos = Array.isArray(value.localCombos)
    ? value.localCombos.flatMap((item): LocalCombo[] => {
        if (!record(item) || !text(item.id).startsWith("local-")) return [];
        if (!text(item.characterId) || !text(item.supportId) || !text(item.route)) return [];
        return [
          {
            id: text(item.id),
            characterId: text(item.characterId),
            supportId: text(item.supportId),
            starter: comboStarterFromRoute(
              text(item.route),
              isPublishedCombo(item.publishedBase) && item.publishedBase.starterIsNonAttackStance,
            ),
            name: text(item.name),
            route: text(item.route),
            screenPosition: text(item.screenPosition),
            damage: text(item.damage),
            pips: nonnegative(item.pips),
            flow: nonnegative(item.flow),
            difficulty: rating(item.difficulty),
            hitconfirm:
              item.hitconfirm === "yes" || item.hitconfirm === "no" ? item.hitconfirm : "unknown",
            counterhit: item.counterhit === true,
            youtubeUrl: text(item.youtubeUrl),
            ...(typeof item.candidateOriginId === "string" &&
            candidateIdPattern.test(item.candidateOriginId)
              ? { candidateOriginId: item.candidateOriginId }
              : item.needsCatalogPublication === true &&
                  candidateIdPattern.test(text(item.id).replace(/^local-candidate-/, "")) &&
                  text(item.id).startsWith("local-candidate-")
                ? { candidateOriginId: text(item.id).slice("local-candidate-".length) }
                : {}),
            ...(item.needsCatalogPublication === true ? { needsCatalogPublication: true } : {}),
            ...(typeof item.publishedId === "string" ? { publishedId: item.publishedId } : {}),
            ...(Number.isInteger(item.publishedRevision)
              ? { publishedRevision: Number(item.publishedRevision) }
              : {}),
            ...(isPublishedCombo(item.publishedBase) && item.publishedBase.id === item.publishedId
              ? { publishedBase: item.publishedBase }
              : {}),
            ...(item.originCatalog === true ? { originCatalog: true } : {}),
            ...(typeof item.editorName === "string" ? { editorName: item.editorName } : {}),
            ...(item.editorDifficulty === null || rating(item.editorDifficulty) !== null
              ? { editorDifficulty: rating(item.editorDifficulty) }
              : {}),
            ...(typeof item.editorPickReason === "string"
              ? { editorPickReason: item.editorPickReason }
              : {}),
            ...(typeof item.editorPickContext === "string"
              ? { editorPickContext: item.editorPickContext }
              : {}),
            ...(Array.isArray(item.moveIds) && item.moveIds.every((id) => typeof id === "string")
              ? { moveIds: item.moveIds as string[] }
              : {}),
            ...(item.routingMode === "autopilot" || item.routingMode === "unique"
              ? { routingMode: item.routingMode }
              : {}),
            ...(Array.isArray(item.editorNotes)
              ? { editorNotes: normalizeComboNotes(item.editorNotes) }
              : {}),
          },
        ];
      })
    : [];
  const snapshots: Record<string, CatalogComboSnapshot> = {};
  const recordingLinks: Record<string, ComboRecordingLink> = {};
  const removedYouTubeVideoIds: Record<string, string[]> = {};
  const candidateSubmissions: ComboWorkspaceData["candidateSubmissions"] = {};
  if (record(value.recordingLinks)) {
    for (const [id, link] of Object.entries(value.recordingLinks)) {
      if (!id || !record(link) || !text(link.recordingId)) continue;
      recordingLinks[id] = { recordingId: text(link.recordingId), name: text(link.name) };
    }
  }
  if (record(value.removedYouTubeVideoIds)) {
    for (const [comboId, ids] of Object.entries(value.removedYouTubeVideoIds)) {
      if (!comboId || !Array.isArray(ids)) continue;
      const validIds = [
        ...new Set(
          ids.filter(
            (id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id),
          ),
        ),
      ];
      if (validIds.length) removedYouTubeVideoIds[comboId] = validIds;
    }
  }
  if (record(value.candidateSubmissions)) {
    for (const [comboId, submission] of Object.entries(value.candidateSubmissions)) {
      if (!comboId || !record(submission) || !text(submission.id)) continue;
      candidateSubmissions[comboId] = {
        id: text(submission.id),
        ...(candidateIdPattern.test(text(submission.originCandidateId))
          ? { originCandidateId: text(submission.originCandidateId) }
          : {}),
        submittedAt: text(submission.submittedAt),
        ...(typeof submission.draftSignature === "string"
          ? { draftSignature: submission.draftSignature }
          : {}),
      };
    }
  }
  if (record(value.snapshots)) {
    for (const [id, item] of Object.entries(value.snapshots)) {
      if (
        !record(item) ||
        id.startsWith("local-") ||
        !text(item.characterId) ||
        !text(item.supportId) ||
        !text(item.route)
      )
        continue;
      snapshots[id] = {
        id,
        characterId: text(item.characterId),
        supportId: text(item.supportId),
        starter: comboStarterFromRoute(text(item.route), text(item.starter).includes("~")),
        name: text(item.name) === text(item.route) ? "" : text(item.name),
        route: text(item.route),
        screenPosition: text(item.screenPosition),
        damage: text(item.damage),
        pips: nonnegative(item.pips),
        flow: nonnegative(item.flow),
        difficulty: rating(item.difficulty),
        hitconfirm:
          item.hitconfirm === "yes" || item.hitconfirm === "no" ? item.hitconfirm : "unknown",
        counterhit:
          item.counterhit === "yes" || item.counterhit === "no" ? item.counterhit : "unknown",
      };
    }
  }
  return {
    localCombos,
    entries,
    recordingLinks,
    removedYouTubeVideoIds,
    candidateSubmissions,
    snapshots,
    characterId: text(value.characterId),
    supportId: text(value.supportId),
    starter: text(value.starter),
  };
}

export function readComboWorkspace(): ComboWorkspaceData {
  try {
    return parseComboWorkspace(JSON.parse(localStorage.getItem(comboWorkspaceKey) ?? "null"));
  } catch {
    return emptyComboWorkspace();
  }
}

export function writeComboWorkspace(data: ComboWorkspaceData): void {
  localStorage.setItem(comboWorkspaceKey, JSON.stringify({ version: 1, ...data }));
}

export function slugComboText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function localRevisionDraft(item: ComboItem, id: string): LocalCombo | null {
  const base = item.published;
  if (!base || !Number.isSafeInteger(base.revision) || Number(base.revision) < 1) return null;
  return {
    id,
    characterId: item.characterId,
    supportId: item.supportId,
    starter: item.starter,
    name: base.name?.trim() || "",
    route: item.route,
    screenPosition: item.screenPosition,
    damage: item.damage,
    pips: item.pips,
    flow: item.flow,
    difficulty: null,
    hitconfirm: item.hitconfirm,
    counterhit: item.counterhit === "yes",
    youtubeUrl: `https://www.youtube.com/watch?v=${base.youtubeVideoId}`,
    ...(base.sourceCandidateId ? { candidateOriginId: base.sourceCandidateId } : {}),
    publishedId: base.id,
    publishedRevision: base.revision,
    publishedBase: base,
    originCatalog: true,
    editorName: base.name ?? "",
    editorDifficulty: base.difficulty ?? null,
    editorPickReason: base.editorPickReason ?? "",
    editorPickContext: base.editorPickContext ?? "",
    moveIds: [...base.moveIds],
    routingMode: base.routingMode ?? "autopilot",
    editorNotes: normalizeComboNotes(base.notes),
  };
}

export function comboItems(
  published: PublishedCombo[],
  moves: PublishedMove[],
  local: LocalCombo[],
  snapshots: Record<string, CatalogComboSnapshot> = {},
): ComboItem[] {
  const movesById = new Map(moves.map((move) => [move.id, move]));
  const publishedIds = new Set(published.map((combo) => combo.id));
  return [
    ...published.map((combo): ComboItem => {
      const starterMove = movesById.get(combo.moveIds[0]);
      return {
        id: combo.id,
        source: "Catalog",
        characterId: combo.characterId,
        supportId: combo.supportId,
        starter: comboStarterFromRoute(
          combo.route,
          combo.starterIsNonAttackStance ??
            (starterMove?.isStanceParent === true && starterMove.isNonAttack === true),
        ),
        name: combo.name?.trim() || "",
        route: combo.route,
        screenPosition: combo.screenPosition ?? "",
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
        published: combo,
      };
    }),
    ...local.map((combo): ComboItem => ({
      id: combo.id,
      source: "Local",
      characterId: combo.characterId,
      supportId: combo.supportId,
      starter: comboStarterFromRoute(
        combo.route,
        combo.publishedBase?.starterIsNonAttackStance ?? false,
      ),
      name: combo.originCatalog
        ? (combo.editorName ?? combo.publishedBase?.name ?? "").trim()
        : combo.name.trim(),
      route: combo.route,
      screenPosition: combo.screenPosition,
      damage: combo.damage,
      pips: combo.pips,
      flow: combo.flow,
      difficulty: combo.editorDifficulty ?? combo.difficulty,
      hitconfirm: combo.hitconfirm,
      counterhit: combo.counterhit ? "yes" : "no",
      local: combo,
    })),
    ...Object.values(snapshots)
      .filter((item) => !publishedIds.has(item.id))
      .map((item): ComboItem => ({ ...item, source: "Unavailable" })),
  ];
}

/** Transfer a submitted local draft's personal state to its catalog identity. */
export function replaceLocalComboWithCatalog(
  workspace: ComboWorkspaceData,
  localId: string,
  published: PublishedCombo,
): ComboWorkspaceData {
  const local = workspace.localCombos.find((combo) => combo.id === localId);
  if (!local || localId === published.id) return workspace;
  const entries = { ...workspace.entries };
  const sourceEntry = entries[localId];
  const targetEntry = entries[published.id];
  if (sourceEntry && !local.originCatalog) {
    entries[published.id] = targetEntry
      ? {
          ...targetEntry,
          ...sourceEntry,
          name: sourceEntry.name || targetEntry.name,
          difficulty: sourceEntry.difficulty ?? targetEntry.difficulty,
          role: sourceEntry.role || targetEntry.role,
          condition: sourceEntry.condition || targetEntry.condition,
          tags: [...new Set([...targetEntry.tags, ...sourceEntry.tags])],
          note: [targetEntry.note, sourceEntry.note]
            .filter((note, index, notes) => note && notes.indexOf(note) === index)
            .join("\n\n"),
          dismissalReason: sourceEntry.dismissalReason || targetEntry.dismissalReason,
        }
      : sourceEntry;
  }
  delete entries[localId];
  const recordingLinks = { ...workspace.recordingLinks };
  if (recordingLinks[localId] && !local.originCatalog)
    recordingLinks[published.id] = recordingLinks[localId];
  delete recordingLinks[localId];
  const candidateSubmissions = { ...workspace.candidateSubmissions };
  delete candidateSubmissions[localId];
  return {
    ...workspace,
    localCombos: workspace.localCombos.filter((combo) => combo.id !== localId),
    entries,
    recordingLinks,
    candidateSubmissions,
    snapshots: {
      ...workspace.snapshots,
      [published.id]: catalogSnapshot(comboItems([published], [], [])[0]),
    },
  };
}

export function countLocalCombos(
  combos: LocalCombo[],
  characterId: string,
  supportId?: string,
  starter?: string,
): number {
  return combos.filter(
    (combo) =>
      combo.characterId === characterId &&
      (!supportId || combo.supportId === supportId) &&
      (!starter ||
        comboStarterFromRoute(
          combo.route,
          combo.publishedBase?.starterIsNonAttackStance ?? false,
        ) === starter),
  ).length;
}

export function effectiveDifficulty(item: ComboItem, entry?: PersonalComboEntry): number | null {
  return entry?.difficulty ?? item.difficulty;
}

export function numericDamage(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function replaceComboEntries(
  entries: Record<string, PersonalComboEntry>,
  oldId: string,
  nextId: string,
): Record<string, PersonalComboEntry> {
  const old = entries[oldId] ?? emptyPersonalEntry();
  const next = entries[nextId] ?? emptyPersonalEntry();
  return {
    ...entries,
    [oldId]: { ...old, status: "Retired" },
    [nextId]: { ...next, status: "Using", role: old.role, condition: old.condition },
  };
}
