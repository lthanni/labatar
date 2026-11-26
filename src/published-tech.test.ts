import { expect, it } from "vite-plus/test";
import { fetchPublishedTech, parsePublishedTech } from "./published-tech";

const section = {
  id: "aang-air",
  scopeKind: "character",
  subjectId: "aang",
  title: "Air movement",
  description: "Options while airborne",
  sortOrder: 0,
  revision: 1,
};
const entry = {
  id: "aang-stall",
  sectionId: "aang-air",
  title: "Air stall",
  description: "Delay descent",
  notation: "j.2B",
  videos: [
    { title: "Setup", description: "Timing", youtubeVideoId: "M7lc1UVf-VE" },
    { title: "Conversion", description: "Follow up", youtubeVideoId: "M7lc1UVf-VE" },
    { title: "", description: "", youtubeVideoId: "M7lc1UVf-VE" },
  ],
  sortOrder: 0,
  revision: 1,
};

it("loads character and support tech and retains each video's heading and description", async () => {
  let requested = "";
  const fetcher = async (input: RequestInfo | URL) => {
    requested = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new Response(JSON.stringify({ sections: [section], entries: [entry] }));
  };
  const result = await fetchPublishedTech(
    "aang",
    "gyatso",
    fetcher as typeof fetch,
    "https://api.example.com",
  );
  expect(requested).toBe("https://api.example.com/v1/tech?character=aang&support=gyatso");
  expect(result.entries[0].videos).toEqual(entry.videos);
});

it("rejects malformed video IDs", () => {
  expect(() =>
    parsePublishedTech({
      sections: [section],
      entries: [{ ...entry, videos: [{ ...entry.videos[0], youtubeVideoId: "bad" }] }],
    }),
  ).toThrow("unexpected format");
});
