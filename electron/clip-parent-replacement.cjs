const fs = require("node:fs/promises");
const path = require("node:path");

const replacementFolderPrefix = ".labatar-replace-";

function validateClipParentSelections(pairs) {
  if (pairs.length === 0) throw new Error("Select at least one clip.");
  const clipIds = new Set();
  const parentIds = new Set();
  for (const { clipId, parentId } of pairs) {
    if (!clipId || !parentId || clipIds.has(clipId)) {
      throw new Error("Select clips that still have a parent in the library.");
    }
    if (parentIds.has(parentId)) throw new Error("Choose one clip per parent recording.");
    clipIds.add(clipId);
    parentIds.add(parentId);
  }
  if ([...parentIds].some((parentId) => clipIds.has(parentId))) {
    throw new Error("A recording cannot be both a clip to keep and a parent to remove.");
  }
  return parentIds;
}

async function applyClipParentReplacement({ folder, removals, changes, trashItem }) {
  const backupFolder = await fs.mkdtemp(path.join(folder, replacementFolderPrefix));
  const moves = [];
  const completed = [];
  const stageBackup = async (filePath, group) => {
    const relative = path.relative(folder, filePath);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("A recording file is outside the recordings folder.");
    }
    const backup = path.join(backupFolder, group, relative);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    moves.push([filePath, backup]);
  };

  try {
    for (const { filePath } of removals) await stageBackup(filePath, "original recordings");
    for (const [index, change] of changes.entries()) {
      const staged = path.join(backupFolder, `clip-${index}.tmp`);
      await fs.writeFile(staged, JSON.stringify(change.manifest, null, 2), { flag: "wx" });
      await stageBackup(change.manifestPath, "original clip sidecars");
      moves.push([staged, change.manifestPath]);
    }
    const filesToVerify = [...removals, ...changes.flatMap(({ video }) => (video ? [video] : []))];
    for (const { filePath, stat } of filesToVerify) {
      const current = await fs.lstat(filePath);
      if (
        !current.isFile() ||
        current.ino !== stat.ino ||
        current.mtimeMs !== stat.mtimeMs ||
        current.size !== stat.size
      ) {
        throw new Error("A recording changed during preparation. Review the replacement again.");
      }
    }
    for (const { manifestPath, originalContent } of changes) {
      if ((await fs.readFile(manifestPath, "utf8")) !== originalContent) {
        throw new Error("A clip changed during preparation. Review the replacement again.");
      }
    }
    for (const move of moves) {
      await fs.rename(...move);
      completed.push(move);
    }
  } catch (error) {
    try {
      for (const [from, to] of completed.reverse()) await fs.rename(to, from);
    } catch (rollbackError) {
      throw new Error(
        `The replacement could not be fully restored. The backup is at ${backupFolder}.`,
        {
          cause: rollbackError,
        },
      );
    }
    // Only remove the staging directory created directly inside the recording folder.
    if (
      path.dirname(backupFolder) === folder &&
      path.basename(backupFolder).startsWith(replacementFolderPrefix)
    ) {
      await fs.rm(backupFolder, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }

  try {
    await trashItem(backupFolder);
    return null;
  } catch {
    return backupFolder;
  }
}

module.exports = {
  applyClipParentReplacement,
  replacementFolderPrefix,
  validateClipParentSelections,
};
