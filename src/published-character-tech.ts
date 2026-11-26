import { currentCatalogApiUrl } from "./published-catalog";
import {
  isCharacterTechKind,
  isNoteSection,
  type CharacterTechEntry,
  type CharacterNoteSection,
} from "./character-tech";
import type { TechVideo } from "./published-tech";

export type PublishedCharacterTechEntry = Omit<
  CharacterTechEntry,
  "recordingId" | "updatedAt" | "videos"
> & {
  revision: number;
  videos?: TechVideo[];
};

export type PublishedNoteSection = CharacterNoteSection & { revision: number };

export async function fetchPublishedCharacterTech(
  characterId: string,
  supportId: string,
): Promise<{ items: PublishedCharacterTechEntry[]; sections: PublishedNoteSection[] }> {
  const url = new URL(`${await currentCatalogApiUrl()}/v1/character-notes`);
  url.searchParams.set("character", characterId);
  if (supportId) url.searchParams.set("support", supportId);
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok)
    throw new Error(`Published character notes could not be loaded (${response.status}).`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !Array.isArray((body as { items?: unknown }).items))
    throw new Error("The published character notes response has an unexpected format.");
  const { items, sections } = body as {
    items: PublishedCharacterTechEntry[];
    sections?: unknown[];
  };
  const visibleItems = items.filter(
    (entry) =>
      entry &&
      typeof entry.id === "string" &&
      typeof entry.title === "string" &&
      isCharacterTechKind(entry.kind) &&
      Number.isInteger(entry.revision),
  );
  return {
    items: visibleItems,
    sections: Array.isArray(sections)
      ? sections.filter(
          (section): section is PublishedNoteSection =>
            isNoteSection(section) &&
            isCharacterTechKind(section.kind) &&
            Number.isInteger((section as PublishedNoteSection).revision),
        )
      : [],
  };
}
