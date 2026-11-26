import type { TechVideo } from "./published-tech";

export type LocalTechCategory = {
  id: string;
  scopeKind: "character" | "support";
  subjectId: string;
  title: string;
  description: string;
  sortOrder: number;
  updatedAt: string;
  publishedRevision?: number;
};

export type LocalTechVideo = {
  slotId?: string;
  title: string;
  description: string;
  url: string;
  localVideoId?: string;
  localFileName?: string;
};

export function isEmptyVideoSlot(video: LocalTechVideo): boolean {
  return !video.localVideoId && !video.url.trim();
}

export type LocalGuideVideoSlot = { index: number; video: LocalTechVideo };

export function attachLocalGuideVideo(
  videos: LocalTechVideo[],
  video: LocalTechVideo,
  slot?: LocalGuideVideoSlot,
): LocalTechVideo[] {
  if (!slot) {
    if (videos.length >= 12) throw new Error("This guide already has 12 videos.");
    return [...videos, video];
  }
  const { slotId, title, description } = slot.video;
  const index = slotId ? videos.findIndex((item) => item.slotId === slotId) : slot.index;
  const current = videos[index];
  if (
    !current ||
    !isEmptyVideoSlot(current) ||
    (!slotId && (current.slotId || current.title !== title || current.description !== description))
  ) {
    throw new Error("This video slot changed. Choose an empty slot to attach the recording.");
  }
  return videos.map((item, position) =>
    position === index ? { ...video, ...(slotId ? { slotId } : {}) } : item,
  );
}

export function videosForPublication(slots: LocalTechVideo[]) {
  return slots
    .filter((slot) => !isEmptyVideoSlot(slot))
    .map(({ slotId: _slotId, ...video }) => video);
}

export function guideVideoContent(videos: readonly (LocalTechVideo | TechVideo)[] = []) {
  return videos.flatMap((video) =>
    "url" in video && isEmptyVideoSlot(video)
      ? []
      : [
          {
            title: video.title.trim(),
            description: video.description.trim(),
            youtubeVideoId: "url" in video ? youtubeVideoId(video.url) : video.youtubeVideoId,
          },
        ],
  );
}

export function hasUnpublishedChanges<T>(
  local: T & { publishedRevision?: number },
  published: (T & { revision: number }) | undefined,
  content: (entry: T) => object,
): boolean {
  if (!published || published.revision < (local.publishedRevision ?? 0))
    return !local.publishedRevision;
  return JSON.stringify(content(local)) !== JSON.stringify(content(published));
}

export function mergePublishedVideos(
  slots: LocalTechVideo[] = [],
  published: Pick<LocalTechVideo, "title" | "description" | "url">[],
): LocalTechVideo[] {
  if (slots.filter((slot) => !isEmptyVideoSlot(slot)).length !== published.length) return slots;
  let index = 0;
  return slots.map((slot) => (isEmptyVideoSlot(slot) ? slot : { ...slot, ...published[index++] }));
}

export type LocalTechGuide = {
  id: string;
  sectionId: string;
  title: string;
  description: string;
  notation: string;
  videos: LocalTechVideo[];
  sortOrder: number;
  updatedAt: string;
  publishedRevision?: number;
  pendingPublicationId?: string;
};

export type LocalTech = { categories: LocalTechCategory[]; guides: LocalTechGuide[] };

export const localTechStorageKey = "labatar-local-tech-v1";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const slug = /^[a-z0-9][a-z0-9-]{0,99}$/;

function validCategory(value: unknown): value is LocalTechCategory {
  return (
    record(value) &&
    typeof value.id === "string" &&
    slug.test(value.id) &&
    (value.scopeKind === "character" || value.scopeKind === "support") &&
    typeof value.subjectId === "string" &&
    slug.test(value.subjectId) &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    Number.isInteger(value.sortOrder) &&
    typeof value.updatedAt === "string" &&
    (value.publishedRevision === undefined ||
      (Number.isInteger(value.publishedRevision) && (value.publishedRevision as number) > 0))
  );
}

function validGuide(value: unknown): value is LocalTechGuide {
  return (
    record(value) &&
    typeof value.id === "string" &&
    slug.test(value.id) &&
    typeof value.sectionId === "string" &&
    slug.test(value.sectionId) &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    typeof value.notation === "string" &&
    Array.isArray(value.videos) &&
    value.videos.every(
      (video) =>
        record(video) &&
        typeof video.title === "string" &&
        typeof video.description === "string" &&
        typeof video.url === "string" &&
        (video.slotId === undefined || typeof video.slotId === "string") &&
        (video.localVideoId === undefined || typeof video.localVideoId === "string") &&
        (video.localFileName === undefined || typeof video.localFileName === "string"),
    ) &&
    Number.isInteger(value.sortOrder) &&
    typeof value.updatedAt === "string" &&
    (value.publishedRevision === undefined ||
      (Number.isInteger(value.publishedRevision) && (value.publishedRevision as number) > 0))
  );
}

export function readLocalTech(): LocalTech {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(localTechStorageKey) ?? "null");
    if (!record(value)) return { categories: [], guides: [] };
    const categories = Array.isArray(value.categories)
      ? value.categories.filter(validCategory)
      : [];
    const categoryIds = new Set(categories.map((category) => category.id));
    const guides = Array.isArray(value.guides)
      ? value.guides.filter(
          (guide): guide is LocalTechGuide => validGuide(guide) && categoryIds.has(guide.sectionId),
        )
      : [];
    return { categories, guides };
  } catch {
    return { categories: [], guides: [] };
  }
}

export function writeLocalTech(value: LocalTech): void {
  localStorage.setItem(localTechStorageKey, JSON.stringify(value));
}

export function localTechForSelection(
  value: LocalTech,
  characterId: string,
  supportId: string,
): LocalTech {
  const categories = value.categories
    .filter((category) =>
      category.scopeKind === "character"
        ? category.subjectId === characterId
        : category.subjectId === supportId,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  const categoryIds = new Set(categories.map((category) => category.id));
  return {
    categories,
    guides: value.guides
      .filter((guide) => categoryIds.has(guide.sectionId))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)),
  };
}

export function removeLocalCategory(value: LocalTech, categoryId: string): LocalTech {
  return {
    categories: value.categories.filter((category) => category.id !== categoryId),
    guides: value.guides.filter((guide) => guide.sectionId !== categoryId),
  };
}

export function youtubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.hash
    )
      return null;
    let id: string | null | undefined;
    if (["youtu.be", "www.youtu.be"].includes(parsed.hostname))
      id = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(parsed.pathname)?.[1];
    else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(parsed.hostname))
      id =
        parsed.pathname === "/watch"
          ? parsed.searchParams.get("v")
          : /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(parsed.pathname)?.[1];
    return /^[A-Za-z0-9_-]{11}$/.test(id ?? "") ? id! : null;
  } catch {
    return null;
  }
}
