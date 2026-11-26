import type { LocalTechVideo } from "./local-tech";

const kinds = ["pressure", "oki", "guide"] as const;
export type CharacterTechKind = (typeof kinds)[number];

// Keep drafts from the removed tab when the app rewrites the local notes or sections list.
type StoredCharacterTechKind = CharacterTechKind | "counterplay";

export function isCharacterTechKind(kind: unknown): kind is CharacterTechKind {
  return kinds.some((value) => value === kind);
}

function isStoredCharacterTechKind(kind: unknown): kind is StoredCharacterTechKind {
  return isCharacterTechKind(kind) || kind === "counterplay";
}

export type CharacterTechEntry = {
  id: string;
  kind: StoredCharacterTechKind;
  characterId: string;
  supportId: string | null;
  sectionId?: string;
  title: string;
  setup: string;
  sequence: string;
  outcome: string;
  notes: string;
  recordingId: string;
  relatedTechIds?: string[];
  relatedComboIds?: string[];
  videos?: LocalTechVideo[];
  updatedAt: string;
  publishedRevision?: number;
  pendingPublicationId?: string;
};

export type CharacterNoteSection = Pick<
  CharacterTechEntry,
  "id" | "kind" | "characterId" | "supportId" | "title"
> & {
  description: string;
};

export type LocalNoteSection = CharacterNoteSection & { publishedRevision?: number };

export const characterTechStorageKey = "labatar-character-tech-v1";
export const characterTechOpenComboEvent = "labatar-character-tech-open-combo";

const noteSectionsKey = "labatar-character-note-sections-v1";

export function isNoteSection(value: unknown): value is CharacterNoteSection {
  if (!value || typeof value !== "object") return false;
  const section = value as Partial<CharacterNoteSection>;
  return (
    typeof section.id === "string" &&
    isStoredCharacterTechKind(section.kind) &&
    typeof section.characterId === "string" &&
    (section.supportId === null || typeof section.supportId === "string") &&
    typeof section.title === "string" &&
    typeof section.description === "string"
  );
}

export function readLocalNoteSections(): LocalNoteSection[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(noteSectionsKey) ?? "[]");
    return Array.isArray(value) ? value.filter(isNoteSection) : [];
  } catch {
    return [];
  }
}

export function writeLocalNoteSections(sections: LocalNoteSection[]): void {
  localStorage.setItem(noteSectionsKey, JSON.stringify(sections));
}

function isCharacterTechEntry(value: unknown): value is CharacterTechEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CharacterTechEntry>;
  return (
    typeof entry.id === "string" &&
    isStoredCharacterTechKind(entry.kind) &&
    typeof entry.characterId === "string" &&
    (entry.supportId === null || typeof entry.supportId === "string") &&
    (entry.sectionId === undefined || typeof entry.sectionId === "string") &&
    typeof entry.title === "string" &&
    typeof entry.setup === "string" &&
    typeof entry.sequence === "string" &&
    typeof entry.outcome === "string" &&
    typeof entry.notes === "string" &&
    typeof entry.recordingId === "string" &&
    (entry.relatedTechIds === undefined ||
      (Array.isArray(entry.relatedTechIds) &&
        entry.relatedTechIds.every((id) => typeof id === "string"))) &&
    (entry.relatedComboIds === undefined ||
      (Array.isArray(entry.relatedComboIds) &&
        entry.relatedComboIds.every((id) => typeof id === "string"))) &&
    (entry.videos === undefined ||
      (Array.isArray(entry.videos) &&
        entry.videos.length <= 12 &&
        entry.videos.every(
          (video) =>
            video &&
            typeof video.title === "string" &&
            typeof video.description === "string" &&
            typeof video.url === "string" &&
            (video.slotId === undefined || typeof video.slotId === "string") &&
            (video.localVideoId === undefined || typeof video.localVideoId === "string"),
        ))) &&
    typeof entry.updatedAt === "string" &&
    (entry.publishedRevision === undefined ||
      (Number.isInteger(entry.publishedRevision) && entry.publishedRevision > 0))
  );
}

export function readCharacterTech(): CharacterTechEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(characterTechStorageKey) ?? "[]");
    return Array.isArray(value) ? value.filter(isCharacterTechEntry) : [];
  } catch {
    return [];
  }
}

export function writeCharacterTech(entries: CharacterTechEntry[]): void {
  localStorage.setItem(characterTechStorageKey, JSON.stringify(entries));
}

export function inheritCharacterTechScope<
  T extends Pick<CharacterTechEntry, "kind" | "characterId" | "sectionId" | "supportId">,
>(entry: T, sections: ReadonlyMap<string, CharacterNoteSection>): T {
  const section = entry.sectionId ? sections.get(entry.sectionId) : undefined;
  if (section?.characterId !== entry.characterId || section.kind !== entry.kind) return entry;
  return entry.supportId === section.supportId ? entry : { ...entry, supportId: section.supportId };
}

export function characterTechForSelection(
  entries: CharacterTechEntry[],
  kind: CharacterTechKind,
  characterId: string,
  supportId: string,
): CharacterTechEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.kind === kind &&
        entry.characterId === characterId &&
        (entry.supportId === null || entry.supportId === supportId),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
