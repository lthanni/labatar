const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");

async function readOptionalFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function replaceLocalRecordingWithYouTube({
  videoPath,
  manifestPath,
  originalStat,
  originalManifestContent,
  nextManifestContent,
  removeVideo = (filePath) => fs.unlink(filePath),
}) {
  const replacementId = randomUUID();
  const candidatePath = `${manifestPath}.youtube-${replacementId}.tmp`;
  const backupPath = `${manifestPath}.youtube-${replacementId}.bak`;
  let manifestBackedUp = false;
  let candidateInstalled = false;
  let videoRemoved = false;
  try {
    await fs.writeFile(candidatePath, nextManifestContent, "utf8");
    const latestStat = await fs.stat(videoPath);
    const latestContent = await readOptionalFile(manifestPath);
    if (
      latestStat.size !== originalStat.size ||
      latestStat.mtimeMs !== originalStat.mtimeMs ||
      latestContent !== originalManifestContent
    ) {
      throw new Error("The recording changed while the YouTube replacement was prepared.");
    }
    if (originalManifestContent !== null) {
      await fs.rename(manifestPath, backupPath);
      manifestBackedUp = true;
    }
    await fs.rename(candidatePath, manifestPath);
    candidateInstalled = true;
    await removeVideo(videoPath);
    videoRemoved = true;
  } catch (error) {
    if (!videoRemoved) {
      try {
        if (candidateInstalled) await fs.rm(manifestPath, { force: true });
        if (manifestBackedUp) await fs.rename(backupPath, manifestPath);
      } catch (rollbackError) {
        const failure = new Error(
          `The YouTube replacement failed and its metadata could not be fully restored. Backup: ${backupPath}. ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          { cause: error },
        );
        failure.backupPath = backupPath;
        throw failure;
      }
    }
    throw error;
  } finally {
    await fs.rm(candidatePath, { force: true }).catch(() => undefined);
    if (videoRemoved || !manifestBackedUp) {
      await fs.rm(backupPath, { force: true }).catch(() => undefined);
    }
  }
}

module.exports = { replaceLocalRecordingWithYouTube };
