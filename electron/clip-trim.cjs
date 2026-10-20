const fs = require("node:fs/promises");
const path = require("node:path");

function planClipTrim(manifest, startTime, endTime, durationMs) {
  const clip = manifest?.clip;
  if (
    !clip ||
    typeof clip.sourceRecordingId !== "string" ||
    !clip.sourceRecordingId.trim() ||
    !Number.isFinite(clip.startTime) ||
    !Number.isFinite(clip.endTime) ||
    clip.endTime <= clip.startTime
  ) {
    throw new Error("Only clips with valid source timing can be trimmed in place.");
  }
  if (
    manifest.metadata ||
    manifest.capture ||
    manifest.moveTake ||
    manifest.analysis ||
    (Array.isArray(manifest.analysisHistory) && manifest.analysisHistory.length > 0) ||
    (Array.isArray(manifest.games) && manifest.games.length > 0) ||
    (Array.isArray(manifest.replays) && manifest.replays.length > 0) ||
    manifest.replayPath ||
    manifest.replayFileName
  ) {
    throw new Error("This clip has linked match or analysis data; trimming would invalidate it.");
  }
  if (manifest.youtubeUrl) {
    throw new Error("Remove the YouTube link before trimming this clip.");
  }
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    !Number.isFinite(durationMs) ||
    startTime < 0 ||
    endTime <= startTime ||
    endTime * 1000 > durationMs + 150 ||
    endTime > clip.endTime - clip.startTime + 0.15 ||
    Math.abs((clip.endTime - clip.startTime) * 1000 - durationMs) > 1000
  ) {
    throw new Error("The trim range is outside this clip.");
  }
  if (startTime < 0.05 && endTime * 1000 >= durationMs - 50) {
    throw new Error("Select a shorter range before trimming the clip.");
  }
  const nextClip = {
    ...clip,
    startTime: Math.round((clip.startTime + startTime) * 1000) / 1000,
    endTime: Math.min(clip.endTime, Math.round((clip.startTime + endTime) * 1000) / 1000),
  };
  // The original F10 marker is still at the end only if the clip's end was retained.
  if (endTime * 1000 < durationMs - 50) delete nextClip.manualChapterStartMs;
  return { ...manifest, clip: nextClip };
}

function planRecordingTrim(manifest, startTime, endTime, durationMs, _chapters) {
  if (manifest?.clip) throw new Error("Use clip trimming for an exported clip.");
  if (
    manifest?.moveTake ||
    manifest?.analysis ||
    (Array.isArray(manifest?.analysisHistory) && manifest.analysisHistory.length > 0) ||
    manifest?.framebarSequence ||
    (Array.isArray(manifest?.framebarSequenceHistory) &&
      manifest.framebarSequenceHistory.length > 0)
  ) {
    throw new Error(
      "This recording has linked move or analysis data; trimming would invalidate it.",
    );
  }
  if (manifest?.youtubeUrl) {
    throw new Error("Remove the YouTube link before trimming this recording.");
  }
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    !Number.isFinite(durationMs) ||
    startTime < 0 ||
    endTime <= startTime ||
    endTime * 1000 > durationMs + 150
  ) {
    throw new Error("The trim range is outside this recording.");
  }
  if (startTime < 0.05 && endTime * 1000 >= durationMs - 50) {
    throw new Error("Select a shorter range before trimming the recording.");
  }
  return { ...manifest };
}

function mapChaptersToTrim(chapters, startTime, endTime) {
  const startMs = Math.round(startTime * 1000);
  const endMs = Math.round(endTime * 1000);
  const ordered = [...chapters].sort((left, right) => left.startMs - right.startMs);
  const mapped = ordered
    .filter((chapter) => chapter.startMs >= startMs && chapter.startMs < endMs)
    .map((chapter) => ({ ...chapter, startMs: chapter.startMs - startMs }));
  const hasStartChapter = mapped.some((chapter) => chapter.startMs === 0);
  const activeChapter = ordered.filter((chapter) => chapter.startMs < startMs).at(-1);
  if (activeChapter && !hasStartChapter) {
    mapped.unshift({ ...activeChapter, startMs: 0 });
  } else if (mapped.length > 0 && !hasStartChapter) {
    // MP4 remuxing moves a lone first chapter to zero. Anchor it so its time is preserved.
    mapped.unshift({ startMs: 0, title: "Recording start" });
  }
  return mapped;
}

function planChildClipMapping(clip, parentStartTime, parentEndTime) {
  if (
    !clip ||
    !Number.isFinite(clip.startTime) ||
    !Number.isFinite(clip.endTime) ||
    clip.endTime <= clip.startTime
  ) {
    throw new Error("A linked clip has invalid source timing; the recording was not changed.");
  }
  const overlapStart = Math.round(Math.max(clip.startTime, parentStartTime) * 1000) / 1000;
  const overlapEnd = Math.round(Math.min(clip.endTime, parentEndTime) * 1000) / 1000;
  if (overlapEnd <= overlapStart) return { detached: true };
  const nextClip = {
    ...clip,
    startTime: Math.round((overlapStart - parentStartTime) * 1000) / 1000,
    endTime: Math.round((overlapEnd - parentStartTime) * 1000) / 1000,
  };
  if (Number.isFinite(clip.manualChapterStartMs)) {
    const markerSeconds = clip.manualChapterStartMs / 1000;
    if (markerSeconds < parentStartTime || markerSeconds > parentEndTime) {
      delete nextClip.manualChapterStartMs;
    } else {
      nextClip.manualChapterStartMs = Math.round((markerSeconds - parentStartTime) * 1000);
    }
  }
  return {
    detached: false,
    localStartTime: Math.round((overlapStart - clip.startTime) * 1000) / 1000,
    localEndTime: Math.round((overlapEnd - clip.startTime) * 1000) / 1000,
    partial: overlapStart > clip.startTime + 0.001 || overlapEnd < clip.endTime - 0.001,
    clip: nextClip,
  };
}

async function readOptionalManifest(manifestPath) {
  try {
    return await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function replaceClipAndRollback({
  videoPath,
  manifestPath,
  candidateVideoPath,
  candidateManifestPath,
  temporaryOriginalVideoPath,
  temporaryOriginalManifestPath,
  originalStat,
  originalManifestContent,
}) {
  const latestStat = await fs.stat(videoPath);
  const latestManifestContent = await readOptionalManifest(manifestPath);
  if (
    latestStat.size !== originalStat.size ||
    latestStat.mtimeMs !== originalStat.mtimeMs ||
    latestManifestContent !== originalManifestContent
  ) {
    throw new Error(
      "The recording changed while the trim was being prepared. Nothing was replaced.",
    );
  }

  let originalVideoMoved = false;
  let originalManifestMoved = false;
  let newVideoInstalled = false;
  let newManifestInstalled = false;
  try {
    await fs.rename(videoPath, temporaryOriginalVideoPath);
    originalVideoMoved = true;
    if (originalManifestContent !== null) {
      await fs.rename(manifestPath, temporaryOriginalManifestPath);
      originalManifestMoved = true;
    }
    await fs.rename(candidateVideoPath, videoPath);
    newVideoInstalled = true;
    await fs.rename(candidateManifestPath, manifestPath);
    newManifestInstalled = true;
  } catch (error) {
    try {
      if (newManifestInstalled) await fs.unlink(manifestPath);
      if (originalManifestMoved) await fs.rename(temporaryOriginalManifestPath, manifestPath);
      if (newVideoInstalled) await fs.unlink(videoPath);
      if (originalVideoMoved) await fs.rename(temporaryOriginalVideoPath, videoPath);
    } catch (rollbackError) {
      const failure = new Error(
        `The trim failed and could not be fully rolled back. Temporary originals may remain in ${path.dirname(temporaryOriginalVideoPath)}. ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        { cause: error },
      );
      failure.preserveTempFolder = true;
      throw failure;
    }
    throw error;
  }
}

async function replaceTrimmedFiles(items) {
  for (const item of items) {
    const latestStat = await fs.stat(item.videoPath);
    const latestManifestContent = await readOptionalManifest(item.manifestPath);
    if (
      latestStat.size !== item.originalStat.size ||
      latestStat.mtimeMs !== item.originalStat.mtimeMs ||
      latestManifestContent !== item.originalManifestContent
    ) {
      throw new Error(
        "A linked recording changed while the trim was being prepared. Nothing was replaced.",
      );
    }
  }

  const moved = [];
  const installed = [];
  try {
    for (const item of items) {
      const backup = { item, video: false, manifest: false };
      moved.push(backup);
      if (item.candidateVideoPath) {
        await fs.rename(item.videoPath, item.backupVideoPath);
        backup.video = true;
      }
      if (item.originalManifestContent !== null) {
        await fs.rename(item.manifestPath, item.backupManifestPath);
        backup.manifest = true;
      }
    }
    for (const item of items) {
      if (item.candidateVideoPath) {
        await fs.rename(item.candidateVideoPath, item.videoPath);
        installed.push(item.videoPath);
      }
      await fs.rename(item.candidateManifestPath, item.manifestPath);
      installed.push(item.manifestPath);
    }
  } catch (error) {
    try {
      for (const filePath of installed.reverse()) {
        await fs.rm(filePath, { force: true });
      }
      for (const backup of moved.reverse()) {
        if (backup.manifest)
          await fs.rename(backup.item.backupManifestPath, backup.item.manifestPath);
        if (backup.video) await fs.rename(backup.item.backupVideoPath, backup.item.videoPath);
      }
    } catch (rollbackError) {
      const failure = new Error(
        `The trim failed and linked recordings could not be fully restored. Temporary originals may remain in ${path.dirname(items[0].backupVideoPath)}. ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        { cause: error },
      );
      failure.preserveTempFolder = true;
      throw failure;
    }
    throw error;
  }
}

module.exports = {
  mapChaptersToTrim,
  planChildClipMapping,
  planClipTrim,
  planRecordingTrim,
  replaceClipAndRollback,
  replaceTrimmedFiles,
};
