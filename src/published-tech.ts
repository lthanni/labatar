import { currentCatalogApiUrl } from "./published-catalog";

export type TechSection = {
  id: string;
  scopeKind: "character" | "support";
  subjectId: string;
  title: string;
  description: string;
  sortOrder: number;
  revision: number;
};

export type TechVideo = {
  title: string;
  description: string;
  youtubeVideoId: string;
};

export type TechEntry = {
  id: string;
  sectionId: string;
  title: string;
  description: string;
  notation: string;
  videos: TechVideo[];
  sortOrder: number;
  revision: number;
};

export type PublishedTech = { sections: TechSection[]; entries: TechEntry[] };

const slug = /^[a-z0-9][a-z0-9-]{0,99}$/;
const videoId = /^[A-Za-z0-9_-]{11}$/;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function validSection(value: unknown): value is TechSection {
  return (
    record(value) &&
    typeof value.id === "string" &&
    slug.test(value.id) &&
    (value.scopeKind === "character" || value.scopeKind === "support") &&
    typeof value.subjectId === "string" &&
    slug.test(value.subjectId) &&
    typeof value.title === "string" &&
    value.title.length > 0 &&
    typeof value.description === "string" &&
    Number.isInteger(value.sortOrder) &&
    (value.sortOrder as number) >= 0 &&
    Number.isInteger(value.revision) &&
    (value.revision as number) >= 1
  );
}

function validEntry(value: unknown): value is TechEntry {
  return (
    record(value) &&
    typeof value.id === "string" &&
    slug.test(value.id) &&
    typeof value.sectionId === "string" &&
    slug.test(value.sectionId) &&
    typeof value.title === "string" &&
    value.title.length > 0 &&
    typeof value.description === "string" &&
    typeof value.notation === "string" &&
    Number.isInteger(value.sortOrder) &&
    (value.sortOrder as number) >= 0 &&
    Number.isInteger(value.revision) &&
    (value.revision as number) >= 1 &&
    Array.isArray(value.videos) &&
    value.videos.length <= 12 &&
    value.videos.every(
      (video) =>
        record(video) &&
        typeof video.title === "string" &&
        typeof video.description === "string" &&
        typeof video.youtubeVideoId === "string" &&
        videoId.test(video.youtubeVideoId),
    )
  );
}

export function parsePublishedTech(value: unknown): PublishedTech {
  if (
    !record(value) ||
    !Array.isArray(value.sections) ||
    !value.sections.every(validSection) ||
    !Array.isArray(value.entries) ||
    !value.entries.every(validEntry)
  )
    throw new Error("The published tech response has an unexpected format.");
  return { sections: value.sections, entries: value.entries };
}

export async function fetchPublishedTech(
  characterId: string,
  supportId: string,
  fetcher: typeof fetch = fetch,
  apiUrl?: string,
): Promise<PublishedTech> {
  apiUrl ??= await currentCatalogApiUrl();
  const url = new URL(`${apiUrl}/v1/tech`);
  url.searchParams.set("character", characterId);
  if (supportId) url.searchParams.set("support", supportId);
  const response = await fetcher(url.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error("Published tech could not be loaded.");
  return parsePublishedTech(await response.json());
}
