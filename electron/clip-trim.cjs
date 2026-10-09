const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

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

async function replaceClipWithBackup({
  videoPath,
  manifestPath,
  candidateVideoPath,
  candidateManifestPath,
  originalStat,
  originalManifestContent,
}) {
  const backupPath = path.join(path.dirname(videoPath), `.labatar-trim-backup-${randomUUID()}.bak`);
  const backupManifestPath = `${backupPath}.labatar.json`;
  const latestStat = await fs.stat(videoPath);
  const latestManifestContent = await fs.readFile(manifestPath, "utf8");
  if (
    latestStat.size !== originalStat.size ||
    latestStat.mtimeMs !== originalStat.mtimeMs ||
    latestManifestContent !== originalManifestContent
  ) {
    throw new Error("The clip changed while the trim was being prepared. Nothing was replaced.");
  }

  let videoBackedUp = false;
  let manifestBackedUp = false;
  let newVideoInstalled = false;
  let newManifestInstalled = false;
  try {
    await fs.rename(videoPath, backupPath);
    videoBackedUp = true;
    await fs.rename(manifestPath, backupManifestPath);
    manifestBackedUp = true;
    await fs.rename(candidateVideoPath, videoPath);
    newVideoInstalled = true;
    await fs.rename(candidateManifestPath, manifestPath);
    newManifestInstalled = true;
    return { backupPath, backupManifestPath };
  } catch (error) {
    try {
      if (newManifestInstalled) await fs.unlink(manifestPath);
      if (manifestBackedUp) await fs.rename(backupManifestPath, manifestPath);
      if (newVideoInstalled) await fs.unlink(videoPath);
      if (videoBackedUp) await fs.rename(backupPath, videoPath);
    } catch (rollbackError) {
      throw new Error(
        `The trim failed and could not be fully rolled back. Original files may be at ${backupPath} and ${backupManifestPath}. ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        { cause: error },
      );
    }
    throw error;
  }
}

module.exports = { planClipTrim, replaceClipWithBackup };
