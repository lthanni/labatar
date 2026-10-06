import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static") as string;
const {
  addGameChaptersToMp4,
  chapterTimeForGame,
  planGameChapters,
  probeChapters,
} = require("../../electron/game-chapters.cjs");

function runFfmpeg(args: string[]) {
  const result = spawnSync(ffmpeg, ["-nostdin", "-v", "error", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
}

describe("automatic MP4 game chapters", () => {
  it("uses the log's UTC clock time, including around midnight", () => {
    const start = Date.parse("2026-10-04T23:59:55.000Z");
    expect(chapterTimeForGame("00:00:05", start, 20_000)).toBe(10_000);
    expect(chapterTimeForGame("23:59:50", start, 20_000)).toBe(-5_000);
    expect(chapterTimeForGame("02:37:51", Date.parse("2026-10-05T02:37:54.000Z"), 60_000)).toBe(
      -3_000,
    );
  });

  it("rejects mismatched or implausible games and labels starts before capture", () => {
    const start = "2026-10-04T19:37:54.000Z";
    const manifest = {
      source: "automatic",
      metadata: { lobbyId: "lobby-1" },
      games: [
        { matchId: "a", lobbyId: "lobby-1", gameNumber: 1, logTime: "19:37:51" },
        { matchId: "b", lobbyId: "other", gameNumber: 2, logTime: "19:38:05" },
        { matchId: "c", lobbyId: "lobby-1", gameNumber: 3, logTime: "20:45:05" },
      ],
    };
    const plan = planGameChapters(manifest, start, 60_000);
    expect(plan.chapters).toEqual([{ startMs: 0, title: "Labatar Game 1 (start not captured)" }]);
    expect(plan.skipped).toHaveLength(2);
  });

  it("still chapters later games when capture missed the first game's start", () => {
    const plan = planGameChapters(
      {
        source: "automatic",
        metadata: { lobbyId: "same" },
        games: [
          { matchId: "first", lobbyId: "same", gameNumber: 1, logTime: "04:57:05" },
          { matchId: "second", lobbyId: "same", gameNumber: 2, logTime: "04:59:17" },
        ],
      },
      "2026-10-04T04:58:32.000Z",
      300_000,
    );
    expect(plan.chapters).toEqual([{ startMs: 45_000, title: "Labatar Game 2" }]);
    expect(plan.skipped).toHaveLength(1);
  });

  it("reports incomplete MP4s separately from out-of-range log times", () => {
    expect(() =>
      planGameChapters({ source: "automatic", games: [] }, "2026-10-05T02:37:19Z", null),
    ).toThrow("no playable duration");
  });

  it("remuxes game chapters without losing existing chapters or media duration", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "labatar-game-chapters-test-"));
    try {
      const base = path.join(directory, "base.mp4");
      const source = path.join(directory, "recording.mp4");
      const metadata = path.join(directory, "existing.ffmeta");
      const start = new Date("2026-10-04T19:37:54.000Z");
      runFfmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=size=64x64:rate=30:color=black",
        "-t",
        "3",
        "-c:v",
        "mpeg4",
        "-metadata",
        `creation_time=${start.toISOString()}`,
        "-y",
        base,
      ]);
      await writeFile(
        metadata,
        ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=3000\ntitle=Unnamed 1\n",
      );
      runFfmpeg([
        "-i",
        base,
        "-f",
        "ffmetadata",
        "-i",
        metadata,
        "-map",
        "0",
        "-map_metadata",
        "0",
        "-map_chapters",
        "1",
        "-c",
        "copy",
        "-y",
        source,
      ]);
      const before = await probeChapters(ffmpeg, source);
      expect(before.chapters.map((chapter: { title: string }) => chapter.title)).toContain(
        "Unnamed 1",
      );
      const manifest = {
        source: "automatic",
        metadata: { lobbyId: "lobby-1" },
        games: [{ matchId: "a", lobbyId: "lobby-1", gameNumber: 1, logTime: "19:37:55" }],
      };
      expect(
        (await addGameChaptersToMp4({ executable: ffmpeg, videoPath: source, manifest })).added,
      ).toBe(1);
      const after = await probeChapters(ffmpeg, source);
      expect(after.chapters.map((chapter: { title: string }) => chapter.title).sort()).toEqual([
        "Labatar Game 1",
        "Unnamed 1",
      ]);
      expect(Math.abs(after.durationMs - before.durationMs)).toBeLessThan(1000);
      await addGameChaptersToMp4({ executable: ffmpeg, videoPath: source, manifest });
      expect((await probeChapters(ffmpeg, source)).chapters).toHaveLength(2);
      expect((await readFile(source)).length).toBeGreaterThan(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
