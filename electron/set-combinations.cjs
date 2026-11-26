const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { buildChapterMetadata } = require("./game-chapters.cjs");

function manifestPath(videoPath) {
  return `${videoPath}.labatar.json`;
}

function replayKey(replay) {
  return typeof replay?.contentHash === "string" && /^[a-f0-9]{64}$/i.test(replay.contentHash)
    ? `sha256:${replay.contentHash.toLowerCase()}`
    : null;
}

function ffconcatPath(filePath) {
  return `file '${filePath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

function sourceIdsHiddenByCombinations(recordings) {
  const hidden = new Set();
  for (const recording of recordings) {
    if (recording.combinedSets?.schemaVersion !== 1) continue;
    for (const source of recording.combinedSets.sourceSets ?? []) {
      if (typeof source.recordingId === "string") hidden.add(source.recordingId);
    }
  }
  return hidden;
}

async function combineSetRecordings({
  sets,
  folder,
  executable,
  runFfmpeg,
  probeChapters,
  probeVideoDimensions,
  findRecordingFiles,
}) {
  if (!Array.isArray(sets) || sets.length < 2 || sets.length > 12) {
    throw new Error("Select between 2 and 12 sets to combine.");
  }
  const ids = sets.map((set) => set?.recordingId);
  if (new Set(ids).size !== sets.length) {
    throw new Error("Each selected set needs its own recording.");
  }
  const files = await findRecordingFiles(folder);
  const knownFiles = new Map(
    files.map((file) => [path.relative(folder, file).split(path.sep).join("/"), file]),
  );
  const existing = [];
  for (const [id, file] of knownFiles) {
    const manifest = await fs
      .readFile(manifestPath(file), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (manifest) existing.push({ id, manifest });
  }
  const hidden = sourceIdsHiddenByCombinations(
    existing.map(({ id, manifest }) => ({ id, combinedSets: manifest.combinedSets })),
  );
  const sources = [];
  for (const set of sets) {
    const id = set?.recordingId;
    const file = typeof id === "string" ? knownFiles.get(id) : null;
    if (!file || path.extname(file).toLowerCase() !== ".mp4") {
      throw new Error("Each set needs an available local MP4 recording.");
    }
    const manifest = existing.find((entry) => entry.id === id)?.manifest;
    if (!manifest || manifest.source !== "automatic" || manifest.clip || manifest.combinedSets) {
      throw new Error(`Recording ${id} is not an original automatic set recording.`);
    }
    if (hidden.has(id)) throw new Error(`Recording ${id} already belongs to a combined set.`);
    if (existing.some((entry) => entry.manifest.clip?.sourceRecordingId === id)) {
      throw new Error(
        `Recording ${id} has clips. Keep those clips linked by combining a set without child clips.`,
      );
    }
    const requestedKeys = set.replayKeys;
    if (
      !Array.isArray(requestedKeys) ||
      !requestedKeys.length ||
      requestedKeys.some((key) => typeof key !== "string" || !/^sha256:[a-f0-9]{64}$/.test(key))
    ) {
      throw new Error(
        "The selected set has no stable replay identities. Rescan replays and try again.",
      );
    }
    const recordedKeys = new Set(
      (manifest.replays ?? []).map((entry) => replayKey(entry.replay)).filter(Boolean),
    );
    if (
      requestedKeys.some((key) => !recordedKeys.has(key)) ||
      recordedKeys.size !== new Set(requestedKeys).size
    ) {
      throw new Error(`Recording ${id} does not match the selected set's replays exactly.`);
    }
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error(`Recording ${id} is not a regular file.`);
    const probe = await probeChapters(executable, file);
    if (!Number.isFinite(probe.durationMs) || probe.durationMs <= 0) {
      throw new Error(`Recording ${id} has no playable duration.`);
    }
    const dimensions = await probeVideoDimensions(executable, file);
    sources.push({
      id,
      file,
      manifest,
      dimensions,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      durationMs: probe.durationMs,
      replayKeys: [...requestedKeys],
    });
  }
  if (
    new Set(sources.map(({ dimensions }) => `${dimensions.width}x${dimensions.height}`)).size > 1
  ) {
    throw new Error(
      "These recordings have different video dimensions and cannot be joined without re-encoding.",
    );
  }
  const captureSignatures = sources
    .map(({ manifest }) => manifest.capture)
    .filter((capture) => capture && capture.outputWidth && capture.outputHeight)
    .map(
      (capture) =>
        `${capture.outputWidth}x${capture.outputHeight}@${capture.fpsNumerator}/${capture.fpsDenominator}`,
    );
  if (new Set(captureSignatures).size > 1) {
    throw new Error(
      "These recordings use different capture dimensions or frame rates and cannot be joined without re-encoding.",
    );
  }
  const jobId = randomUUID();
  const outputPath = path.join(
    folder,
    `Combined sets - ${new Date().toISOString().slice(0, 10)} - ${jobId.slice(0, 8)}.mp4`,
  );
  const temporaryPath = path.join(folder, `.labatar-combine-${jobId}.mp4`);
  const chapteredPath = path.join(folder, `.labatar-combine-chapters-${jobId}.mp4`);
  const listPath = path.join(folder, `.labatar-combine-${jobId}.ffconcat`);
  const chapterPath = path.join(folder, `.labatar-combine-${jobId}.ffmetadata`);
  let outputCreated = false;
  try {
    await fs.writeFile(
      listPath,
      `ffconcat version 1.0\n${sources.map((source) => ffconcatPath(source.file)).join("\n")}\n`,
      { flag: "wx" },
    );
    await runFfmpeg([
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      temporaryPath,
    ]);
    const combinedProbe = await probeChapters(executable, temporaryPath);
    const totalDurationMs = sources.reduce((sum, source) => sum + source.durationMs, 0);
    if (
      !Number.isFinite(combinedProbe.durationMs) ||
      Math.abs(combinedProbe.durationMs - totalDurationMs) > Math.max(3000, sources.length * 1000)
    ) {
      throw new Error("The combined video's duration does not match its source recordings.");
    }
    const chapters = [];
    let startMs = 0;
    for (const [index, source] of sources.entries()) {
      chapters.push({ startMs, title: `Set ${index + 1}` });
      startMs += source.durationMs;
    }
    await fs.writeFile(
      chapterPath,
      buildChapterMetadata([], chapters, combinedProbe.durationMs).text,
      { flag: "wx" },
    );
    await runFfmpeg([
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      temporaryPath,
      "-f",
      "ffmetadata",
      "-i",
      chapterPath,
      "-map",
      "0",
      "-map_metadata",
      "0",
      "-map_chapters",
      "1",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      chapteredPath,
    ]);
    const verified = await probeChapters(executable, chapteredPath);
    if (
      !Number.isFinite(verified.durationMs) ||
      Math.abs(verified.durationMs - totalDurationMs) > Math.max(3000, sources.length * 1000) ||
      verified.chapters.filter((chapter) => /^Set \d+$/.test(chapter.title)).length !==
        sources.length
    ) {
      throw new Error("The combined video did not retain its duration and set chapters.");
    }
    await runFfmpeg([
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-xerror",
      "-i",
      chapteredPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-f",
      "null",
      "-",
    ]);
    for (const source of sources) {
      const current = await fs.stat(source.file);
      const currentManifest = await fs.readFile(manifestPath(source.file), "utf8").then(JSON.parse);
      if (
        current.size !== source.size ||
        current.mtimeMs !== source.mtimeMs ||
        JSON.stringify(currentManifest) !== JSON.stringify(source.manifest)
      ) {
        throw new Error(
          `Recording ${source.id} changed while the combined video was being created.`,
        );
      }
    }
    let sourceStartMs = 0;
    const combinedSets = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      sourceSets: sources.map((source) => {
        const entry = {
          recordingId: source.id,
          replayKeys: source.replayKeys,
          startMs: sourceStartMs,
          durationMs: source.durationMs,
        };
        sourceStartMs += source.durationMs;
        return entry;
      }),
    };
    const first = sources[0].manifest;
    const manifest = {
      schemaVersion: 1,
      createdAt: combinedSets.createdAt,
      outputPath,
      source: "automatic",
      metadata: {
        ...first.metadata,
        setLabel: `Combined ${sources.length} sets`,
        gameNumber: "",
      },
      games: sources.flatMap((source) => source.manifest.games ?? []),
      replays: sources.flatMap((source) => source.manifest.replays ?? []),
      tags: {
        match: [...new Set(sources.flatMap((source) => source.manifest.tags?.match ?? []))],
        lab: [...new Set(sources.flatMap((source) => source.manifest.tags?.lab ?? []))],
        combo: sources.some((source) => source.manifest.tags?.combo === true),
        pressure: sources.some((source) => source.manifest.tags?.pressure === true),
      },
      combinedSets,
    };
    await fs.copyFile(chapteredPath, outputPath, fs.constants.COPYFILE_EXCL);
    outputCreated = true;
    await fs.writeFile(manifestPath(outputPath), JSON.stringify(manifest, null, 2), { flag: "wx" });
    return {
      recordingId: path.relative(folder, outputPath).split(path.sep).join("/"),
      combinedSets,
    };
  } catch (error) {
    if (outputCreated) await fs.rm(outputPath, { force: true }).catch(() => {});
    await fs.rm(manifestPath(outputPath), { force: true }).catch(() => {});
    throw error;
  } finally {
    for (const file of [temporaryPath, chapteredPath, listPath, chapterPath]) {
      await fs.rm(file, { force: true }).catch(() => {});
    }
  }
}

async function splitSetRecording({ recordingId, folder, findRecordingFiles }) {
  const files = await findRecordingFiles(folder);
  const file = files.find(
    (candidate) => path.relative(folder, candidate).split(path.sep).join("/") === recordingId,
  );
  if (!file) throw new Error("The combined recording no longer exists.");
  const manifest = await fs.readFile(manifestPath(file), "utf8").then(JSON.parse);
  const sourceSets = manifest.combinedSets?.sourceSets;
  if (
    manifest.combinedSets?.schemaVersion !== 1 ||
    !Array.isArray(sourceSets) ||
    sourceSets.length < 2
  ) {
    throw new Error("This recording is not a combined set.");
  }
  const known = new Set(
    files.map((candidate) => path.relative(folder, candidate).split(path.sep).join("/")),
  );
  for (const source of sourceSets) {
    if (!known.has(source.recordingId))
      throw new Error(`Original recording ${source.recordingId} is missing.`);
    const sourcePath = files.find(
      (candidate) =>
        path.relative(folder, candidate).split(path.sep).join("/") === source.recordingId,
    );
    await fs.access(manifestPath(sourcePath));
  }
  if (files.some((candidate) => candidate !== file)) {
    for (const candidate of files) {
      if (candidate === file) continue;
      const child = await fs
        .readFile(manifestPath(candidate), "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (child?.clip?.sourceRecordingId === recordingId) {
        throw new Error(
          "This combined recording has clips. Remove or export them before splitting sets.",
        );
      }
    }
  }
  // Restore the sidecar if Windows has the generated MP4 open and refuses to remove it.
  const sidecar = await fs.readFile(manifestPath(file));
  await fs.rm(manifestPath(file));
  try {
    await fs.rm(file);
  } catch (error) {
    await fs.writeFile(manifestPath(file), sidecar, { flag: "wx" });
    throw error;
  }
  return { sourceCount: sourceSets.length };
}

module.exports = {
  combineSetRecordings,
  splitSetRecording,
  sourceIdsHiddenByCombinations,
  ffconcatPath,
};
