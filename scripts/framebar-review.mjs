#!/usr/bin/env node

/** Local framebar review helper. It extracts images; a person or agent reads the bar. */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpeg from "ffmpeg-static";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultGeometry = JSON.parse(
  await fs.readFile(path.join(repositoryRoot, "src/config/detector-defaults.json"), "utf8"),
);
const validStates = new Set([
  "idle",
  "startup",
  "active",
  "multihit-gap",
  "recovery",
  "airborne",
  "flow-stance",
  "blockstun",
  "hitstun",
  "hitpause",
  "unknown",
]);

function fail(message) {
  throw new Error(message);
}

function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) fail(`Expected a value for ${name}.`);
    result[name.slice(2)] = value;
  }
  return result;
}

function runFfmpeg(args, { allowFailure = false } = {}) {
  if (!ffmpeg) fail("The bundled FFmpeg executable is unavailable.");
  const result = spawnSync(ffmpeg, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 4 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    fail(result.stderr?.trim() || `FFmpeg exited with code ${result.status}.`);
  }
  return result.stderr ?? "";
}

function probe(videoPath) {
  const output = runFfmpeg(["-hide_banner", "-i", videoPath], { allowFailure: true });
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
  const videoLine = output.split(/\r?\n/).find((line) => /Stream #\d+:\d+.*Video:/.test(line));
  const size = videoLine && /\b(\d{2,5})x(\d{2,5})\b/.exec(videoLine);
  const rate = videoLine && /\b(\d+(?:\.\d+)?) fps\b/.exec(videoLine);
  if (!duration || !size || !rate) fail(`Could not read video timing and dimensions: ${videoPath}`);
  return {
    duration: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]),
    width: Number(size[1]),
    height: Number(size[2]),
    frameRate: Number(rate[1]),
  };
}

function readManifestPath(videoPath) {
  return `${videoPath}.labatar.json`;
}

async function readManifest(videoPath) {
  return JSON.parse(await fs.readFile(readManifestPath(videoPath), "utf8"));
}

async function walk(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (entry.isFile() && entry.name.endsWith(".mp4.labatar.json")) files.push(child);
  }
  return files;
}

async function listTakes(root) {
  const takes = [];
  for (const manifestPath of await walk(root)) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (!manifest.moveTake) continue;
    takes.push({
      move: manifest.moveTake.moveLabel,
      outcome: manifest.moveTake.outcome,
      status: manifest.framebarSequence?.status ?? "needs-review",
      video: manifestPath.slice(0, -".labatar.json".length),
    });
  }
  text(takes);
}

function text(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function stateName(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  const state = normalized === "gap" ? "multihit-gap" : normalized;
  if (!validStates.has(state)) fail(`Unknown framebar state: ${value}`);
  return state;
}

function countedRuns(value, name) {
  if (!Array.isArray(value) || value.length === 0)
    fail(`${name} must contain state/count entries.`);
  return value.map((entry) => {
    const state = stateName(entry?.state);
    const frames = Number(entry?.frames);
    if (!Number.isInteger(frames) || frames <= 0) fail(`${name} has an invalid frame count.`);
    return { state, frames };
  });
}

function totalFrames(runs) {
  return runs.reduce((count, run) => count + run.frames, 0);
}

function jointSegments(player1, player2, startVideoFrame, sourceFrameRate) {
  const boundaries = new Set([0]);
  for (const runs of [player1, player2]) {
    let offset = 0;
    for (const run of runs) {
      offset += run.frames;
      boundaries.add(offset);
    }
  }
  const offsets = [...boundaries].sort((left, right) => left - right);
  const stateAt = (runs, offset) => {
    let end = 0;
    for (const run of runs) {
      end += run.frames;
      if (offset < end) return run.state;
    }
    fail("The player sequences do not cover the same span.");
  };
  return offsets.slice(0, -1).map((offset, index) => ({
    timestamp: startVideoFrame / sourceFrameRate + offset / 60,
    frames: offsets[index + 1] - offset,
    player1: stateAt(player1, offset),
    player2: stateAt(player2, offset),
  }));
}

async function inspect(videoPath, arguments_) {
  const media = probe(videoPath);
  const manifest = await readManifest(videoPath).catch(() => null);
  const geometry = manifest?.framebarSequence?.detectorConfig ?? defaultGeometry;
  const lastEstimatedFrame = Math.max(0, Math.floor(media.duration * media.frameRate) - 1);
  const frames = arguments_.frames
    ? arguments_.frames.split(",").map((value) => Number(value.trim()))
    : [0.25, 0.5, 0.75, 0.95].map((fraction) => Math.floor(lastEstimatedFrame * fraction));
  if (frames.some((frame) => !Number.isInteger(frame) || frame < 0)) {
    fail("--frames must be comma-separated, zero-based video frame indices.");
  }
  const players =
    arguments_.players === "p1" || arguments_.players === "p2"
      ? [arguments_.players]
      : ["p1", "p2"];
  const digest = createHash("sha1").update(videoPath).digest("hex").slice(0, 10);
  const outputDirectory = path.resolve(
    arguments_.out ?? path.join(repositoryRoot, ".dev/framebar-review", digest),
  );
  await fs.mkdir(outputDirectory, { recursive: true });
  const images = [];
  for (const frame of new Set(frames)) {
    for (const player of players) {
      const x = player === "p1" ? geometry.player1SourceX : geometry.sourceX;
      const y = player === "p1" ? geometry.player1SourceY : geometry.sourceY;
      const filter = `select=eq(n\\,${frame}),crop=iw*${geometry.framebarSourceWidth}/100:ih*${geometry.framebarSourceHeight}/100:iw*${x}/100:ih*${y}/100,scale=iw*3:ih*3:flags=neighbor`;
      const outputPath = path.join(
        outputDirectory,
        `${player}-frame-${String(frame).padStart(6, "0")}.png`,
      );
      runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        videoPath,
        "-vf",
        filter,
        "-frames:v",
        "1",
        "-y",
        outputPath,
      ]);
      const image = await fs.stat(outputPath).catch(() => null);
      if (!image?.isFile() || image.size === 0) {
        fail(`Video frame ${frame} was not available.`);
      }
      images.push({ player, frame, path: outputPath });
    }
  }
  text({ video: videoPath, media, images });
}

async function saveDraft(draftPath) {
  const draft = JSON.parse(await fs.readFile(draftPath, "utf8"));
  const videoPath = path.resolve(String(draft.video ?? ""));
  if (path.extname(videoPath).toLowerCase() !== ".mp4") fail("Draft video must be an MP4.");
  const media = probe(videoPath);
  const manifest = await readManifest(videoPath);
  if (!manifest.moveTake) fail("This video is not a move take.");
  if (
    manifest.moveTake.captureMethod === "automated" &&
    manifest.moveTake.captureReviewStatus !== "approved-for-processing"
  )
    fail("Approve this automated video before saving its framebar sequence.");
  const startVideoFrame = Number(draft.startVideoFrame);
  if (!Number.isInteger(startVideoFrame) || startVideoFrame < 0) {
    fail("Draft startVideoFrame must be a zero-based video frame index.");
  }
  const player1 = countedRuns(draft.player1, "player1");
  const player2 = draft.player2
    ? countedRuns(draft.player2, "player2")
    : [{ state: "idle", frames: totalFrames(player1) }];
  if (totalFrames(player1) !== totalFrames(player2)) {
    fail("Player 1 and Player 2 sequences must have the same game-frame span.");
  }
  const evidenceFrames = [...new Set(draft.evidenceFrames ?? [])];
  const estimatedFrameCount = Math.round(media.duration * media.frameRate);
  if (
    evidenceFrames.length === 0 ||
    evidenceFrames.some(
      (frame) => !Number.isInteger(frame) || frame < 0 || frame >= estimatedFrameCount,
    )
  )
    fail("Draft evidenceFrames must contain inspected, zero-based video frame indices.");
  if (startVideoFrame >= estimatedFrameCount) fail("startVideoFrame is past the video duration.");
  if (manifest.framebarSequence) {
    manifest.framebarSequenceHistory = [
      ...(manifest.framebarSequenceHistory ?? []),
      manifest.framebarSequence,
    ];
  }
  if (manifest.analysis) {
    manifest.analysisHistory = [...(manifest.analysisHistory ?? []), manifest.analysis];
  }
  const sequence = {
    schemaVersion: 1,
    id: randomUUID(),
    status: "awaiting-review",
    observationMethod: "visual-review",
    extractedAt: new Date().toISOString(),
    reviewedAt: null,
    duration: media.duration,
    sourceWidth: media.width,
    sourceHeight: media.height,
    frameRate: 60,
    sampledFrames: evidenceFrames.length,
    evidenceFrames,
    startVideoFrame,
    trainingFrameRatio: 0,
    timing: {
      mode: "logical-source-frame-ffmpeg",
      nominalFrameRate: 60,
      sourceFrameRate: media.frameRate,
      sourceTimestampsAvailable: false,
      requestedFrameCount: estimatedFrameCount,
      maximumSeekErrorSeconds: 0,
    },
    warnings: [
      "Game-frame state counts were transcribed from visible framebar labels. Segment timestamps use nominal video timing.",
      ...(Math.abs(media.frameRate - 60) > 0.01
        ? [
            `The source reports ${media.frameRate} fps; short state runs may be absent from sampled video frames.`,
          ]
        : []),
    ],
    hitboxSamples: [],
    segments: jointSegments(player1, player2, startVideoFrame, media.frameRate),
  };
  manifest.framebarSequence = sequence;
  manifest.analysis = null;
  manifest.moveTake.validation = {
    status: "unprocessed",
    message: "Review and approve the transcribed framebar sequence before determining move data.",
    expectedInputs: manifest.moveTake.expectedInputs ?? [],
    observedInputs: [],
    matchedAnalysisMoveId: null,
    processedAt: null,
  };
  const temporaryPath = `${readManifestPath(videoPath)}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(manifest, null, 2), "utf8");
    await fs.rename(temporaryPath, readManifestPath(videoPath));
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
  text({ video: videoPath, move: manifest.moveTake.moveLabel, sequence });
}

const [command, ...args] = process.argv.slice(2);
try {
  const flags = options(args);
  if (command === "list") {
    await listTakes(path.resolve(flags.root ?? path.join(repositoryRoot, ".dev/recordings")));
  } else if (command === "probe") {
    if (!flags.video) fail("--video is required.");
    text({ video: path.resolve(flags.video), ...probe(path.resolve(flags.video)) });
  } else if (command === "inspect") {
    if (!flags.video) fail("--video is required.");
    await inspect(path.resolve(flags.video), flags);
  } else if (command === "save") {
    if (!flags.draft) fail("--draft is required.");
    await saveDraft(path.resolve(flags.draft));
  } else {
    fail(
      "Usage: framebar-review.mjs list [--root dir] | probe --video file | inspect --video file [--frames 60,90] [--players p1|p2|both] [--out dir] | save --draft file.json",
    );
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
