const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");

function parseDurationMs(output) {
  const match = output.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return match
    ? Math.round((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000)
    : null;
}

function parseChapterMetadata(text) {
  const globals = text.split(/^\[CHAPTER\]\s*$/m, 1)[0];
  const creationTime = globals.match(/^creation_time=(.+)$/m)?.[1]?.trim() ?? null;
  const chapters = [];
  for (const section of text.split(/^\[CHAPTER\]\s*$/m).slice(1)) {
    const timebase = section.match(/^TIMEBASE=(\d+)\/(\d+)$/m);
    const start = section.match(/^START=(\d+)$/m);
    if (!start) continue;
    const numerator = timebase ? Number(timebase[1]) : 1;
    const denominator = timebase ? Number(timebase[2]) : 1_000_000_000;
    if (!denominator) continue;
    chapters.push({
      startMs: Math.round((Number(start[1]) * numerator * 1000) / denominator),
      title: (section.match(/^title=(.*)$/m)?.[1] ?? "").replace(/\\([\\=;#])/g, "$1"),
    });
  }
  return { creationTime, chapters };
}

function chapterTimeForGame(logTime, videoStartMs, durationMs) {
  if (!/^\d{2}:\d{2}:\d{2}$/.test(logTime ?? "")) return null;
  const [hours, minutes, seconds] = logTime.split(":").map(Number);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const recordingDate = new Date(videoStartMs);
  const offsets = [-1, 0, 1].map(
    (day) =>
      Date.UTC(
        recordingDate.getUTCFullYear(),
        recordingDate.getUTCMonth(),
        recordingDate.getUTCDate() + day,
        hours,
        minutes,
        seconds,
      ) - videoStartMs,
  );
  const distance = (offset) =>
    offset < 0 ? -offset : offset > durationMs ? offset - durationMs : 0;
  return offsets.sort((a, b) => distance(a) - distance(b))[0];
}

function planGameChapters(manifest, creationTime, durationMs) {
  const videoStartMs = Date.parse(creationTime ?? "");
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("The MP4 has no playable duration; it may be incomplete or empty.");
  }
  if (!Number.isFinite(videoStartMs)) {
    throw new Error("The MP4 has no creation time for chapter placement.");
  }
  if (manifest?.source !== "automatic" || !Array.isArray(manifest.games)) {
    throw new Error("Game chapters require an automatic recording with game metadata.");
  }
  const chapters = [];
  const skipped = [];
  const seenMatches = new Set();
  for (const game of manifest.games) {
    if (!game?.matchId || seenMatches.has(game.matchId)) continue;
    seenMatches.add(game.matchId);
    if (manifest.metadata?.lobbyId && game.lobbyId !== manifest.metadata.lobbyId) {
      skipped.push(`Game ${game.gameNumber ?? "?"}: lobby mismatch`);
      continue;
    }
    const offset = chapterTimeForGame(game.logTime, videoStartMs, durationMs);
    if (offset == null || offset < -30_000 || offset >= durationMs) {
      skipped.push(`Game ${game.gameNumber ?? "?"}: start time outside recording`);
      continue;
    }
    const number = Number(game.gameNumber) > 0 ? Number(game.gameNumber) : chapters.length + 1;
    chapters.push({
      startMs: Math.max(0, offset),
      title: `Labatar Game ${number}${offset < -1_000 ? " (start not captured)" : ""}`,
    });
  }
  if (!chapters.length) {
    throw new Error(
      `No trustworthy game start falls within this recording.${skipped.length ? ` ${skipped.slice(0, 3).join("; ")}${skipped.length > 3 ? `; and ${skipped.length - 3} more` : ""}.` : ""}`,
    );
  }
  return { chapters, skipped };
}

function escapeMetadata(value) {
  return value.replace(/([\\=;#])/g, "\\$1").replace(/\r?\n/g, "\\\n");
}

function buildChapterMetadata(existing, generated, durationMs) {
  const chapters = existing
    .filter((chapter) => !/^Labatar Game \d+(?: \(start not captured\))?$/.test(chapter.title))
    .concat(generated)
    .filter(
      (chapter) =>
        Number.isFinite(chapter.startMs) && chapter.startMs >= 0 && chapter.startMs < durationMs,
    )
    .sort((a, b) => a.startMs - b.startMs);
  const lines = [";FFMETADATA1"];
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    const next = chapters[index + 1];
    const end = Math.max(chapter.startMs + 1, Math.min(durationMs, next?.startMs ?? durationMs));
    lines.push(
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${chapter.startMs}`,
      `END=${end}`,
      `title=${escapeMetadata(chapter.title)}`,
    );
  }
  return { text: `${lines.join("\n")}\n`, chapters };
}

function runFfmpeg(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`FFmpeg failed: ${stderr.slice(-2000)}`)),
    );
  });
}

async function probeChapters(executable, videoPath) {
  const result = await runFfmpeg(executable, [
    "-nostdin",
    "-hide_banner",
    "-i",
    videoPath,
    "-map_metadata",
    "0",
    "-map_chapters",
    "0",
    "-f",
    "ffmetadata",
    "-",
  ]);
  const durationMs = parseDurationMs(result.stderr);
  const metadata = parseChapterMetadata(result.stdout);
  return { ...metadata, durationMs };
}

async function addGameChaptersToMp4({ executable, videoPath, manifest }) {
  if (path.extname(videoPath).toLowerCase() !== ".mp4")
    throw new Error("Only MP4 recordings support game chapter processing.");
  const originalStat = await fs.stat(videoPath);
  if (!originalStat.isFile()) throw new Error("The recording is not a file.");
  const probe = await probeChapters(executable, videoPath);
  const plan = planGameChapters(manifest, probe.creationTime, probe.durationMs);
  const metadata = buildChapterMetadata(probe.chapters, plan.chapters, probe.durationMs);
  const folder = path.dirname(videoPath);
  const tempFolder = await fs.mkdtemp(path.join(folder, ".labatar-chapters-"));
  const tempVideo = path.join(tempFolder, "recording.partial");
  const tempMetadata = path.join(tempFolder, "chapters.ffmeta");
  const backupPath = path.join(folder, `.labatar-chapter-backup-${randomUUID()}.bak`);
  let originalMoved = false;
  try {
    await fs.writeFile(tempMetadata, metadata.text, "utf8");
    await runFfmpeg(executable, [
      "-nostdin",
      "-v",
      "error",
      "-i",
      videoPath,
      "-f",
      "ffmetadata",
      "-i",
      tempMetadata,
      "-map",
      "0",
      "-map_metadata",
      "0",
      "-map_chapters",
      "1",
      "-c",
      "copy",
      "-f",
      "mp4",
      tempVideo,
    ]);
    const candidateStat = await fs.stat(tempVideo);
    if (!candidateStat.isFile() || candidateStat.size === 0)
      throw new Error("The chaptered MP4 was empty.");
    const verified = await probeChapters(executable, tempVideo);
    const expectedChapters = [...metadata.chapters].sort(
      (a, b) => a.title.localeCompare(b.title) || a.startMs - b.startMs,
    );
    const actualChapters = [...verified.chapters].sort(
      (a, b) => a.title.localeCompare(b.title) || a.startMs - b.startMs,
    );
    if (
      actualChapters.length !== expectedChapters.length ||
      expectedChapters.some(
        (chapter, index) =>
          chapter.title !== actualChapters[index].title ||
          Math.abs(chapter.startMs - actualChapters[index].startMs) > 1000,
      ) ||
      Math.abs(verified.durationMs - probe.durationMs) > 1000
    ) {
      throw new Error("The chaptered MP4 did not preserve the expected chapters or duration.");
    }
    const latestStat = await fs.stat(videoPath);
    if (latestStat.size !== originalStat.size || latestStat.mtimeMs !== originalStat.mtimeMs) {
      throw new Error("The recording changed while chapters were being prepared.");
    }
    await fs.rename(videoPath, backupPath);
    originalMoved = true;
    await fs.rename(tempVideo, videoPath);
    originalMoved = false;
    const backupRemovalFailed = await fs.unlink(backupPath).then(
      () => false,
      () => true,
    );
    return {
      added: plan.chapters.length,
      skipped: plan.skipped,
      backupPath: backupRemovalFailed ? backupPath : null,
    };
  } catch (error) {
    if (originalMoved) {
      try {
        await fs.rename(backupPath, videoPath);
      } catch (rollbackError) {
        throw new Error(
          `Could not restore the original recording; it is still at ${backupPath}. ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          { cause: error },
        );
      }
    }
    throw error;
  } finally {
    await fs.unlink(tempVideo).catch(() => undefined);
    await fs.unlink(tempMetadata).catch(() => undefined);
    await fs.rmdir(tempFolder).catch(() => undefined);
  }
}

module.exports = {
  chapterTimeForGame,
  planGameChapters,
  parseChapterMetadata,
  buildChapterMetadata,
  probeChapters,
  addGameChaptersToMp4,
};
