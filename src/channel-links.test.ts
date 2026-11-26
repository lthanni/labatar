import { afterEach, expect, it, vi } from "vite-plus/test";
import { readLocalPlayers, writeLocalPlayers } from "./players";
import {
  inferChannelPlatform,
  linksForSelection,
  normalizedChannelUrl,
  readLocalChannelLinks,
  writeLocalChannelLinks,
  type LocalChannelLink,
} from "./channel-links";

afterEach(() => vi.unstubAllGlobals());

it("shows character links across supports and support links only for the selected support", () => {
  const character: LocalChannelLink = {
    id: "aang-youtube",
    scopeKind: "character",
    subjectId: "aang",
    platform: "YouTube",
    title: "Aang",
    url: "https://youtube.com/@aang",
    updatedAt: "2026-01-01",
    publishedRevision: 2,
  };
  const support = {
    ...character,
    id: "momo-twitch",
    scopeKind: "support" as const,
    subjectId: "momo",
    platform: "Twitch",
    url: "https://twitch.tv/momo",
  };
  expect(linksForSelection([character, support], "aang", "momo")).toHaveLength(2);
  expect(linksForSelection([character, support], "aang", "appa")).toEqual([character]);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  writeLocalChannelLinks([character]);
  expect(readLocalChannelLinks()).toEqual([character]);
  const { platform: _platform, url, ...legacyPlayer } = character;
  expect(readLocalPlayers()).toEqual([{ ...legacyPlayer, links: [url] }]);
  const player = { ...legacyPlayer, links: [url, "https://twitch.tv/aang"] };
  writeLocalPlayers([player]);
  expect(readLocalPlayers()).toEqual([player]);
  writeLocalPlayers([]);
  expect(readLocalPlayers()).toEqual([]);
});

it("accepts HTTPS channel URLs and rejects unsafe schemes or embedded credentials", () => {
  expect(normalizedChannelUrl("https://www.youtube.com/@aang")).toBe(
    "https://www.youtube.com/@aang",
  );
  expect(normalizedChannelUrl("javascript:alert(1)")).toBeNull();
  expect(normalizedChannelUrl("http://twitch.tv/aang")).toBeNull();
  expect(normalizedChannelUrl("https://user:pass@twitch.tv/aang")).toBeNull();
});

it("infers the platform from a channel URL without trusting lookalike hostnames", () => {
  expect(inferChannelPlatform("https://www.youtube.com/@aang")).toBe("YouTube");
  expect(inferChannelPlatform("https://clips.twitch.tv/example")).toBe("Twitch");
  expect(inferChannelPlatform("https://twitter.com/aang")).toBe("X");
  expect(inferChannelPlatform("https://youtube.com.example.org/@aang")).toBe(
    "youtube.com.example.org",
  );
  expect(inferChannelPlatform("https://www.example.org/@aang")).toBe("example.org");
  expect(inferChannelPlatform("http://youtube.com/@aang")).toBeNull();
});
