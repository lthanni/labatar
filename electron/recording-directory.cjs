const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

function relativeInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    ? relative
    : null;
}

async function inspectRecordingDirectory(source, destination) {
  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  if (
    relativeInside(sourceRoot, destinationRoot) !== null ||
    relativeInside(destinationRoot, sourceRoot) !== null
  ) {
    throw new Error("Choose a recording folder outside the current recording folder.");
  }
  const sourceReal = await fs.promises.realpath(sourceRoot).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const destinationReal = await fs.promises.realpath(destinationRoot);
  if (
    sourceReal &&
    (relativeInside(sourceReal, destinationReal) !== null ||
      relativeInside(destinationReal, sourceReal) !== null)
  ) {
    throw new Error("Choose a recording folder outside the current recording folder.");
  }
  const files = [];
  const directories = [];
  if (!sourceReal) return { files, directories, bytes: 0 };
  async function visit(relativeDirectory) {
    const sourceDirectory = path.join(sourceRoot, relativeDirectory);
    const entries = await fs.promises.readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = path.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `The recording folder contains a link that cannot be copied safely: ${relative}`,
        );
      }
      if (entry.isDirectory()) {
        directories.push(relative);
        await visit(relative);
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(path.join(sourceRoot, relative));
        files.push({
          relative,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          atime: stat.atime,
          mtime: stat.mtime,
        });
      }
    }
  }
  await visit("");
  return { files, directories, bytes: files.reduce((total, file) => total + file.size, 0) };
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function copiedManifestBytes(sourcePath, sourceRoot, destinationRoot) {
  const bytes = await fs.promises.readFile(sourcePath);
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    return bytes;
  }
  if (
    !manifest ||
    typeof manifest.outputPath !== "string" ||
    !path.isAbsolute(manifest.outputPath)
  ) {
    return bytes;
  }
  const relative = relativeInside(sourceRoot, path.resolve(manifest.outputPath));
  if (relative === null) return bytes;
  manifest.outputPath = path.join(destinationRoot, relative);
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
}

async function copyRecordingDirectory(source, destination, inventory) {
  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  const files = inventory.files;
  const planned = [];
  for (const relative of inventory.directories) {
    const target = path.join(destinationRoot, relative);
    const stat = await fs.promises.lstat(target).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat && !stat.isDirectory())
      throw new Error(`Destination has a conflicting item: ${relative}`);
  }
  for (const file of files) {
    const sourcePath = path.join(sourceRoot, file.relative);
    const target = path.join(destinationRoot, file.relative);
    const manifestBytes = file.relative.endsWith(".labatar.json")
      ? await copiedManifestBytes(sourcePath, sourceRoot, destinationRoot)
      : null;
    const existing = await fs.promises.lstat(target).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing) {
      if (!existing.isFile())
        throw new Error(`Destination has a conflicting item: ${file.relative}`);
      const expectedHash = manifestBytes
        ? createHash("sha256").update(manifestBytes).digest("hex")
        : await sha256(sourcePath);
      if ((await sha256(target)) !== expectedHash) {
        throw new Error(`Destination has a different file with the same name: ${file.relative}`);
      }
    }
    planned.push({ ...file, sourcePath, target, manifestBytes, existing: Boolean(existing) });
  }
  for (const relative of inventory.directories) {
    await fs.promises.mkdir(path.join(destinationRoot, relative), { recursive: true });
  }
  let copied = 0;
  for (const file of planned) {
    if (file.existing) continue;
    const before = await fs.promises.stat(file.sourcePath);
    if (before.size !== file.size || before.mtimeMs !== file.mtimeMs) {
      throw new Error(`Recording changed during migration: ${file.relative}`);
    }
    if (file.manifestBytes) {
      await fs.promises.writeFile(file.target, file.manifestBytes, { flag: "wx" });
    } else {
      await fs.promises.copyFile(file.sourcePath, file.target, fs.constants.COPYFILE_EXCL);
    }
    await fs.promises.utimes(file.target, file.atime, file.mtime);
    const after = await fs.promises.stat(file.sourcePath);
    if (after.size !== file.size || after.mtimeMs !== file.mtimeMs) {
      throw new Error(`Recording changed during migration: ${file.relative}`);
    }
    copied += 1;
  }
  return { copied, total: files.length };
}

module.exports = { inspectRecordingDirectory, copyRecordingDirectory };
