const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const originals = {
  "watertribe.pak": "2138e9227a2948fe19fe77cc4bfc1b34c6a9265525b757a856db6f911a98ba78",
  "korra.pak": "b2241aac58acd890026c084e6f2e8e677e995a3bdf3f9c3701ebe0cc338f6559",
  "hud.pak": "24b0d04eb5288f28a9e0d28b6b22985e7e81f3a6ea611ef9f6f192acac0e1ce1",
};
const replacements = {
  "watertribe.pak": "watertribe-no-visuals-no-shadow.pak",
  "korra.pak": "korra-hidden.pak",
  "hud.pak": "hud-hidden.pak",
};

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function gameRunning() {
  if (process.platform !== "win32") throw new Error("Blackout capture requires Windows.");
  const { stdout } = await execFileAsync(
    "tasklist",
    ["/FI", "IMAGENAME eq Atla.exe", "/FO", "CSV", "/NH"],
    { windowsHide: true },
  );
  return /^"Atla\.exe",/im.test(stdout);
}

function sessionPath(backupRoot) {
  return path.join(backupRoot, "active-session.json");
}

function readSession(backupRoot) {
  const filePath = sessionPath(backupRoot);
  if (!fs.existsSync(filePath)) return null;
  const session = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (session.version !== 1 || !Array.isArray(session.files) || session.files.length !== 3) {
    throw new Error(
      "The blackout recovery manifest is invalid; installed files were left untouched.",
    );
  }
  return session;
}

function writeSession(backupRoot, session) {
  fs.mkdirSync(backupRoot, { recursive: true });
  const temporary = `${sessionPath(backupRoot)}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(session, null, 2), "utf8");
  fs.renameSync(temporary, sessionPath(backupRoot));
}

async function prepareSession({ gameRoot, sourceRoot, backupRoot, expectedOriginals = originals }) {
  if (readSession(backupRoot)) throw new Error("Restore the existing blackout session first.");
  const executable = path.join(gameRoot, "Atla.exe");
  if (!(await fs.promises.stat(executable).catch(() => null))?.isFile()) {
    throw new Error("The selected game folder does not contain Atla.exe.");
  }
  const backupDir = path.join(backupRoot, `originals-${Date.now()}-${crypto.randomUUID()}`);
  const files = [];
  for (const [name, replacementName] of Object.entries(replacements)) {
    const target = path.join(gameRoot, "data_packages", name);
    const source = path.join(sourceRoot, replacementName);
    const originalHash = expectedOriginals[name];
    if (!originalHash || (await sha256(target)) !== originalHash) {
      throw new Error(
        `${name} differs from the verified original. Blackout assets were not installed.`,
      );
    }
    const replacementHash = await sha256(source);
    files.push({
      name,
      target,
      source,
      backup: path.join(backupDir, name),
      originalHash,
      replacementHash,
    });
  }
  await fs.promises.mkdir(backupDir, { recursive: true });
  for (const file of files) {
    await fs.promises.copyFile(file.target, file.backup, fs.constants.COPYFILE_EXCL);
    if ((await sha256(file.backup)) !== file.originalHash) {
      throw new Error(`Backup verification failed for ${file.name}.`);
    }
  }
  const session = {
    version: 1,
    gameRoot,
    backupRoot,
    backupDir,
    phase: "installing",
    createdAt: Date.now(),
    files,
  };
  writeSession(backupRoot, session);
  return session;
}

async function installSession(session, checkRunning = gameRunning) {
  for (const file of session.files) {
    if (await checkRunning())
      throw new Error("The game opened while blackout files were being installed.");
    await fs.promises.copyFile(file.source, file.target);
    if ((await sha256(file.target)) !== file.replacementHash) {
      throw new Error(`Blackout installation failed verification for ${file.name}.`);
    }
  }
}

async function verifyInstalled(session) {
  for (const file of session.files) {
    if ((await sha256(file.target)) !== file.replacementHash) return false;
  }
  return true;
}

async function restoreSession(backupRoot, checkRunning = gameRunning) {
  let session = readSession(backupRoot);
  if (!session) return false;
  if (await checkRunning()) throw new Error("Close the game before restoring its original assets.");
  const lockPath = path.join(backupRoot, "restore.lock");
  try {
    await fs.promises.mkdir(lockPath);
  } catch (error) {
    if (error.code === "EEXIST") {
      const lockStat = await fs.promises.stat(lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > 120_000) {
        await fs.promises.rmdir(lockPath);
        return restoreSession(backupRoot, checkRunning);
      }
      return false;
    }
    throw error;
  }
  try {
    session = readSession(backupRoot);
    if (!session) return false;
    if (await checkRunning())
      throw new Error("The game reopened before original assets could be restored.");
    const expectedDir = path.join(backupRoot, path.basename(session.backupDir));
    if (path.resolve(expectedDir) !== path.resolve(session.backupDir)) {
      throw new Error("The blackout backup path is invalid; installed files were left untouched.");
    }
    for (const file of session.files) {
      if (
        !(file.name in originals) ||
        path.basename(file.target) !== file.name ||
        path.resolve(file.target) !== path.resolve(session.gameRoot, "data_packages", file.name) ||
        path.resolve(file.backup) !== path.resolve(session.backupDir, file.name)
      ) {
        throw new Error("The blackout recovery manifest contains an invalid file path.");
      }
      if ((await sha256(file.backup)) !== file.originalHash) {
        throw new Error(`The saved original ${file.name} failed verification; recovery stopped.`);
      }
      if (session.phase === "active") {
        const currentHash = await sha256(file.target);
        if (currentHash !== file.originalHash && currentHash !== file.replacementHash) {
          throw new Error(
            `${file.name} changed during blackout mode; recovery stopped to preserve it.`,
          );
        }
      }
    }
    if (session.phase !== "restoring") {
      session.phase = "restoring";
      writeSession(backupRoot, session);
    }
    for (const file of session.files) {
      if (await checkRunning()) throw new Error("The game reopened during asset restoration.");
      const currentHash = await sha256(file.target);
      if (currentHash !== file.originalHash) await fs.promises.copyFile(file.backup, file.target);
      if ((await sha256(file.target)) !== file.originalHash) {
        throw new Error(`Restored ${file.name} failed verification.`);
      }
    }
    await fs.promises.unlink(sessionPath(backupRoot));
    return true;
  } finally {
    await fs.promises.rmdir(lockPath);
  }
}

async function watchAndRestore(backupRoot, checkRunning = gameRunning, delayMs = 1500) {
  const watcherLock = path.join(backupRoot, "watcher.lock");
  try {
    await fs.promises.mkdir(watcherLock);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = await fs.promises.stat(watcherLock).catch(() => null);
    if (!stat || Date.now() - stat.mtimeMs < 15_000) return;
    await fs.promises.rmdir(watcherLock);
    await fs.promises.mkdir(watcherLock);
  }
  try {
    let stoppedChecks = 0;
    while (true) {
      const now = new Date();
      await fs.promises.utimes(watcherLock, now, now);
      const session = readSession(backupRoot);
      if (!session) return;
      if (session.phase === "installing" && Date.now() - session.createdAt < 60_000) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (
        session.phase === "active" &&
        Date.now() - (session.activeAt ?? session.createdAt) < 20_000
      ) {
        stoppedChecks = 0;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (await checkRunning()) {
        stoppedChecks = 0;
      } else {
        stoppedChecks += 1;
        if (stoppedChecks >= 5 && (await restoreSession(backupRoot, checkRunning))) return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } finally {
    await fs.promises.rmdir(watcherLock).catch(() => undefined);
  }
}

if (require.main === module && process.argv[2] === "--watch") {
  void watchAndRestore(process.argv[3]).catch((error) => {
    fs.appendFileSync(
      path.join(process.argv[3], "restore-error.log"),
      `${new Date().toISOString()} ${error.stack || error}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  originals,
  replacements,
  sha256,
  gameRunning,
  sessionPath,
  readSession,
  writeSession,
  prepareSession,
  installSession,
  verifyInstalled,
  restoreSession,
  watchAndRestore,
};
