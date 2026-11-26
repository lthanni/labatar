import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  attachLocalGuideVideo,
  guideVideoContent,
  hasUnpublishedChanges,
  isEmptyVideoSlot,
  localTechForSelection,
  localTechStorageKey,
  mergePublishedVideos,
  readLocalTech,
  removeLocalCategory,
  videosForPublication,
  writeLocalTech,
  youtubeVideoId,
  type LocalTech,
} from "./local-tech";

afterEach(() => vi.unstubAllGlobals());

const local: LocalTech = {
  categories: [
    {
      id: "movement",
      scopeKind: "character",
      subjectId: "aang",
      title: "Movement",
      description: "",
      sortOrder: 0,
      updatedAt: "2026-01-01",
      publishedRevision: 2,
    },
    {
      id: "assist",
      scopeKind: "support",
      subjectId: "gyatso",
      title: "Assist",
      description: "",
      sortOrder: 1,
      updatedAt: "2026-01-01",
      publishedRevision: 1,
    },
  ],
  guides: [
    {
      id: "air-stall",
      sectionId: "movement",
      title: "Air stall",
      description: "Delay landing",
      notation: "j.2B",
      videos: [
        {
          slotId: "follow-up",
          title: "Planned follow-up",
          description: "Record the corner version",
          url: "",
        },
      ],
      sortOrder: 0,
      updatedAt: "2026-01-01",
      publishedRevision: 4,
    },
    {
      id: "assist-call",
      sectionId: "assist",
      title: "Assist call",
      description: "",
      notation: "",
      videos: [],
      sortOrder: 0,
      updatedAt: "2026-01-01",
    },
  ],
};

it("shows character categories with every support and support categories only when selected", () => {
  expect(localTechForSelection(local, "aang", "gyatso").categories.map((item) => item.id)).toEqual([
    "movement",
    "assist",
  ]);
  expect(localTechForSelection(local, "aang", "appa").guides.map((item) => item.id)).toEqual([
    "air-stall",
  ]);
  expect(localTechForSelection(local, "katara", "gyatso").guides.map((item) => item.id)).toEqual([
    "assist-call",
  ]);
});

it("persists local drafts and removes guides with their category", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  writeLocalTech(local);
  expect(readLocalTech()).toEqual(local);
  expect(removeLocalCategory(local, "movement").guides.map((item) => item.id)).toEqual([
    "assist-call",
  ]);
  values.set(
    localTechStorageKey,
    JSON.stringify({
      ...local,
      guides: [...local.guides, { ...local.guides[0], id: "orphan", sectionId: "missing" }],
    }),
  );
  expect(readLocalTech().guides).toEqual(local.guides);
});

it("accepts only supported single-video YouTube links", () => {
  expect(youtubeVideoId("https://youtu.be/M7lc1UVf-VE")).toBe("M7lc1UVf-VE");
  expect(youtubeVideoId("https://www.youtube.com/watch?v=M7lc1UVf-VE")).toBe("M7lc1UVf-VE");
  expect(youtubeVideoId("https://example.com/watch?v=M7lc1UVf-VE")).toBeNull();
});

it("keeps planned slots in order when attached videos finish publishing", () => {
  const firstSlot = { title: "Planned setup", description: "Record this next", url: "" };
  const secondSlot = { title: "", description: "", url: "   " };
  const localVideo = {
    title: "Demo",
    description: "",
    url: "",
    localVideoId: "demo",
    slotId: "second",
  };
  const linkedVideo = { title: "Reference", description: "", url: "https://youtu.be/M7lc1UVf-VE" };
  const slots = [firstSlot, localVideo, secondSlot, linkedVideo];
  const published = [
    { title: "Demo", description: "", url: "https://www.youtube.com/watch?v=abcdefghijk" },
    { ...linkedVideo, url: "https://www.youtube.com/watch?v=M7lc1UVf-VE" },
  ];
  expect(slots.filter(isEmptyVideoSlot)).toEqual([firstSlot, secondSlot]);
  expect(videosForPublication(slots)).toEqual([
    { title: "Demo", description: "", url: "", localVideoId: "demo" },
    linkedVideo,
  ]);
  expect(mergePublishedVideos(slots, published)).toEqual([
    firstSlot,
    { ...localVideo, ...published[0] },
    secondSlot,
    published[1],
  ]);
  expect(mergePublishedVideos(slots, published.slice(0, 1))).toEqual(slots);
});

it("compares visible guide changes against the current published content", () => {
  const localVideo = { title: "Demo", description: "", url: "https://youtu.be/M7lc1UVf-VE" };
  const publishedVideo = { title: "Demo", description: "", youtubeVideoId: "M7lc1UVf-VE" };
  const planned = { title: "Next", description: "Film later", url: "" };
  const draft = { title: "Guide", videos: [planned, localVideo], publishedRevision: 4 };
  const catalog = { title: "Guide", videos: [publishedVideo], revision: 4 };
  const content = (entry: { title: string; videos: Parameters<typeof guideVideoContent>[0] }) => ({
    title: entry.title,
    videos: guideVideoContent(entry.videos),
  });

  expect(hasUnpublishedChanges(draft, catalog, content)).toBe(false);
  expect(hasUnpublishedChanges({ ...draft, title: "New title" }, catalog, content)).toBe(true);
  expect(
    hasUnpublishedChanges(
      { ...draft, videos: [...draft.videos, { ...planned, localVideoId: "new-mp4" }] },
      catalog,
      content,
    ),
  ).toBe(true);
  expect(hasUnpublishedChanges(draft, { ...catalog, revision: 3, videos: [] }, content)).toBe(
    false,
  );
  expect(hasUnpublishedChanges(draft, undefined, content)).toBe(false);
  expect(
    hasUnpublishedChanges({ ...draft, publishedRevision: undefined }, undefined, content),
  ).toBe(true);
});

it("fills the selected placeholder in place, including in a guide with 12 slots", () => {
  const planned = { slotId: "planned", title: "", description: "", url: "" };
  const other = { ...planned, slotId: "other", title: "Another example" };
  const recorded = { title: "", description: "", url: "", localVideoId: "recorded-mp4" };
  const slots = [
    other,
    planned,
    ...Array.from({ length: 10 }, (_, index) => ({ ...other, slotId: `slot-${index}` })),
  ];
  const next = attachLocalGuideVideo(slots, recorded, { index: 0, video: planned });
  expect(next).toEqual([other, { ...recorded, slotId: "planned" }, ...slots.slice(2)]);
  expect(() => attachLocalGuideVideo(next, recorded, { index: 0, video: planned })).toThrow(
    "This video slot changed.",
  );
  const legacy = { title: "Legacy slot", description: "", url: "" };
  expect(attachLocalGuideVideo([legacy], recorded, { index: 0, video: legacy })).toEqual([
    recorded,
  ]);
});
