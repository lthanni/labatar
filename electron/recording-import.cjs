const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

async function importComboMp4(sourcePath, recordingFolder) {
  if (path.extname(sourcePath).toLowerCase() !== ".mp4") {
    throw new Error("Choose an MP4 file.");
  }
  const source = await fs.promises.realpath(sourcePath);
  const stat = await fs.promises.stat(source);
  if (!stat.isFile()) throw new Error("Choose an MP4 file.");
  const root = await fs.promises.realpath(recordingFolder);
  const relative = path.relative(root, source);
  if (
    relative &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  ) {
    return { recordingId: relative.split(path.sep).join("/"), imported: false };
  }

  const targetDirectory = path.join(root, "Imported Combos");
  await fs.promises.mkdir(targetDirectory, { recursive: true });
  const resolvedTargetDirectory = await fs.promises.realpath(targetDirectory);
  if (resolvedTargetDirectory !== targetDirectory) {
    throw new Error("The recording import folder has moved. Choose another recording directory.");
  }
  const base = path.basename(source, path.extname(source));
  const uniqueName = `${base}-${randomUUID()}.mp4`;
  const target = path.join(targetDirectory, uniqueName);
  const temporary = path.join(targetDirectory, `.${uniqueName}.partial`);
  try {
    await fs.promises.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
    await fs.promises.rename(temporary, target);
    return { recordingId: path.relative(root, target).split(path.sep).join("/"), imported: true };
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
  }
}

module.exports = { importComboMp4 };
