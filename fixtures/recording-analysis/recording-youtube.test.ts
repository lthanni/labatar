import { createRequire } from "node:module";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const {
  normalizeYouTubeVideoUrl,
  readYouTubeVideoUrl,
} = require("../../electron/recording-youtube.cjs");
const videoId = "dQw4w9WgXcQ";
const canonical = `https://www.youtube.com/watch?v=${videoId}`;

describe("recording YouTube links", () => {
  it.each([
    `https://www.youtube.com/watch?v=${videoId}&list=some-playlist`,
    `https://m.youtube.com/watch?v=${videoId}`,
    `https://youtu.be/${videoId}?t=10`,
    `https://www.youtube.com/shorts/${videoId}`,
    `https://www.youtube.com/live/${videoId}`,
  ])("normalizes a video URL: %s", (url) => {
    expect(normalizeYouTubeVideoUrl(url)).toBe(canonical);
  });

  it.each([
    "",
    "https://studio.youtube.com/",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/playlist?list=items",
    "https://youtu.be/not-a-video-id",
  ])("rejects non-video or unsafe URLs: %s", (url) => {
    expect(() => normalizeYouTubeVideoUrl(url)).toThrow();
    expect(readYouTubeVideoUrl(url)).toBeNull();
  });

  it("treats old recordings without a link as unlinked", () => {
    expect(readYouTubeVideoUrl(undefined)).toBeNull();
    expect(readYouTubeVideoUrl(null)).toBeNull();
  });
});
