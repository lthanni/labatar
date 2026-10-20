const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

const MAX_FILES = 5000;
const MAX_SOURCE_ENTRIES = 25000;
const MAX_REPLAY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function safeReplayName(name) {
  const leaf = String(name).replaceAll("\\", "/").split("/").pop() ?? "";
  if (!leaf.toLowerCase().endsWith(".dlr"))
    throw new Error("Only .dlr replay files can be imported.");
  const stem = leaf
    .slice(0, -4)
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
    .join("")
    .replace(/[. ]+$/, "");
  return `${(stem || "replay").slice(0, 160)}-${randomUUID()}.dlr`;
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function extractZipReplays(archivePath, outputDirectory) {
  const manifestPath = path.join(outputDirectory, "manifest.json");
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archivePath = ${quotePowerShell(archivePath)}
$outputDirectory = ${quotePowerShell(outputDirectory)}
$manifestPath = ${quotePowerShell(manifestPath)}
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
$files = New-Object System.Collections.Generic.List[object]
$total = [long]0
$actualTotal = [long]0
try {
  foreach ($entry in $archive.Entries) {
    $name = $entry.FullName.Replace('\\', '/')
    if ($name -notmatch '(?i)\\.dlr$') { continue }
    if ($name.StartsWith('/') -or $name -match '(^|/)\\.\\.(/|$)' -or $name -match ':') {
      throw 'The ZIP contains an unsafe replay path.'
    }
    if ($files.Count -ge ${MAX_FILES} -or $entry.Length -gt ${MAX_REPLAY_BYTES}) {
      throw 'The ZIP contains too many or oversized replays.'
    }
    $total += $entry.Length
    if ($total -gt ${MAX_TOTAL_BYTES}) { throw 'The ZIP contains too much replay data.' }
    $staged = '{0:D6}.dlr' -f ($files.Count + 1)
    $target = Join-Path $outputDirectory $staged
    $inputStream = $entry.Open()
    $outputStream = [System.IO.File]::Create($target)
    try {
      $buffer = New-Object byte[] 65536
      $written = [long]0
      while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $written += $read
        if ($written -gt ${MAX_REPLAY_BYTES}) { throw 'A replay in the ZIP is too large.' }
        $outputStream.Write($buffer, 0, $read)
      }
    } finally {
      $outputStream.Dispose()
      $inputStream.Dispose()
    }
    $actualTotal += $written
    if ($actualTotal -gt ${MAX_TOTAL_BYTES}) { throw 'The ZIP contains too much replay data.' }
    $files.Add(@{ name = $name; staged = $staged; size = $written })
  }
  if ($files.Count -eq 0) { throw 'The ZIP contains no .dlr replay files.' }
  $json = ConvertTo-Json -InputObject @($files.ToArray()) -Depth 3 -Compress
  [System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
} finally {
  $archive.Dispose()
}
`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", async (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Could not read ZIP archive (PowerShell exit ${code}).`));
        return;
      }
      try {
        resolve(JSON.parse(await fs.promises.readFile(manifestPath, "utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function collectReplayFiles(sourcePath, files, seen) {
  seen.count += 1;
  if (seen.count > MAX_SOURCE_ENTRIES)
    throw new Error("The dropped folder contains too many entries.");
  const stat = await fs.promises.lstat(sourcePath);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const entry of await fs.promises.readdir(sourcePath)) {
      await collectReplayFiles(path.join(sourcePath, entry), files, seen);
    }
    return;
  }
  if (!stat.isFile() || path.extname(sourcePath).toLowerCase() !== ".dlr") return;
  if (stat.size > MAX_REPLAY_BYTES)
    throw new Error(`Replay is too large: ${path.basename(sourcePath)}`);
  if (files.length >= MAX_FILES) throw new Error("Too many replay files were dropped.");
  files.push({ source: sourcePath, name: path.basename(sourcePath), size: stat.size });
}

async function importReplays(paths, gameFolder, extractZip = extractZipReplays) {
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    paths.length > MAX_FILES ||
    paths.some((item) => typeof item !== "string" || !path.isAbsolute(item))
  ) {
    throw new Error("Drop replay files, a replay folder, or a ZIP archive.");
  }
  if (!gameFolder) throw new Error("Choose the game folder in Settings before importing replays.");
  const root = await fs.promises.realpath(gameFolder);
  if (!(await fs.promises.stat(root)).isDirectory())
    throw new Error("The game folder is unavailable.");
  const staging = await fs.promises.mkdtemp(path.join(os.tmpdir(), "labatar-replay-import-"));
  const imported = [];
  try {
    const files = [];
    const seen = { count: 0 };
    for (const sourcePath of paths) {
      if (path.extname(sourcePath).toLowerCase() !== ".zip") {
        await collectReplayFiles(sourcePath, files, seen);
        continue;
      }
      const archive = await fs.promises.realpath(sourcePath);
      const stat = await fs.promises.stat(archive);
      if (!stat.isFile() || stat.size > MAX_TOTAL_BYTES)
        throw new Error("The ZIP archive is too large.");
      const zipStaging = await fs.promises.mkdtemp(path.join(staging, "zip-"));
      const extracted = await extractZip(archive, zipStaging);
      for (const entry of extracted) {
        if (
          !entry ||
          typeof entry.name !== "string" ||
          !/^\d{6}\.dlr$/.test(entry.staged) ||
          !Number.isSafeInteger(entry.size) ||
          entry.size > MAX_REPLAY_BYTES
        ) {
          throw new Error("The ZIP returned an invalid replay entry.");
        }
        files.push({
          source: path.join(zipStaging, entry.staged),
          name: entry.name,
          size: entry.size,
        });
      }
    }
    if (files.length === 0) throw new Error("No .dlr replay files were found.");
    if (
      files.length > MAX_FILES ||
      files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES
    ) {
      throw new Error("Too many replay files were dropped.");
    }
    const replayFolder = path.join(root, "replays");
    await fs.promises.mkdir(replayFolder, { recursive: true });
    if (!within(root, await fs.promises.realpath(replayFolder))) {
      throw new Error("The game replay folder points outside the game folder.");
    }
    const destination = path.join(replayFolder, "Imported by Labatar");
    await fs.promises.mkdir(destination, { recursive: true });
    if (!within(root, await fs.promises.realpath(destination))) {
      throw new Error("The replay import folder points outside the game folder.");
    }
    for (const file of files) {
      const target = path.join(destination, safeReplayName(file.name));
      const temporary = `${target}.partial`;
      try {
        await fs.promises.copyFile(file.source, temporary, fs.constants.COPYFILE_EXCL);
        await fs.promises.rename(temporary, target);
        imported.push(target);
      } finally {
        await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
      }
    }
    return { importedCount: imported.length };
  } catch (error) {
    await Promise.all(imported.map((file) => fs.promises.rm(file, { force: true })));
    throw error;
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
}

module.exports = { importReplays, safeReplayName };
