const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { performance } = require("node:perf_hooks");

const execFileAsync = promisify(execFile);
const originals = {
  "watertribe.pak": "2138e9227a2948fe19fe77cc4bfc1b34c6a9265525b757a856db6f911a98ba78",
  "aang.pak": "7dd391498a460b7c17478caf66565bc58f3c0e3e6e7888a655ce564e31a36dca",
  "aang_avchar.pak": "7f6a32b5b1b1a14eb28132e3ffc8d9e0548f621b24215907bcbd7d9bf6f91e8a",
  "korra.pak": "b2241aac58acd890026c084e6f2e8e677e995a3bdf3f9c3701ebe0cc338f6559",
  "korra_nightmare.pak": "841110a58e855cdc24723b6c31a43666dceea13bc8f6fd3b357732a925b2f9bd",
  "zuko.pak": "1eb34e107cefe54ac64d2edf9aeb760020ba981782c7d3fa12902eb64a9c61df",
  "katara.pak": "20172cab2412a67baca64d0fcc0488f5671da419cb30e70a934631de6b5262fe",
  "toph.pak": "fa3be37815653520b7e07f711c49e24c8ec03dff9e38887068f7359c57cec547",
  "sokka.pak": "e7cc1cee06aaf4e52d1f9da20ee485fb2fb076fcbea1ea3407d99d357f6e8205",
  "azula.pak": "1777db294988fc6c0a34a0a154d5f5d4c630b90d54d6c1b45363cdaa14b35655",
  "kyoshi.pak": "bc42257f9c888c210cdb00d1e957cc239d74d85cb478eb7ac6c92b9efa9ccf25",
  "ozai.pak": "fc428470788cbade023dc2763ae6412e4cd8b3b3053800ae68685448a3669f38",
  "zaheer.pak": "f8fc45e31b39b91426a7f1fbccb02abefaecdbd92c8a138d3343bcf25bff812c",
  "hud.pak": "24b0d04eb5288f28a9e0d28b6b22985e7e81f3a6ea611ef9f6f192acac0e1ce1",
  "hitspark.pak": "968d716ac1f14ff00544712e5e1ab768ca32d4b50ec2b0a7ca4a085fa6cc2aa8",
};
const characterPackages = {
  Aang: "aang.pak",
  "Avatar Aang": "aang_avchar.pak",
  Korra: "korra.pak",
  "Nightmare Korra": "korra_nightmare.pak",
  Zuko: "zuko.pak",
  Katara: "katara.pak",
  Toph: "toph.pak",
  Sokka: "sokka.pak",
  Azula: "azula.pak",
  Kyoshi: "kyoshi.pak",
  Ozai: "ozai.pak",
  Zaheer: "zaheer.pak",
};

function replacementPlan(testedCharacter = "Aang") {
  if (!Object.hasOwn(characterPackages, testedCharacter)) {
    throw new Error("Select a supported test character before blackout launch.");
  }
  const testedPackage = characterPackages[testedCharacter];
  const plan = {
    "hud.pak": "hud-hidden.pak",
  };
  for (const packageName of Object.values(characterPackages)) {
    const base = path.basename(packageName, ".pak");
    const keepFighter =
      packageName === testedPackage || (testedCharacter === "Korra" && packageName === "zuko.pak");
    plan[packageName] = `${base}-${keepFighter ? "supports" : "all"}-hidden.pak`;
  }
  plan["hitspark.pak"] = "hitspark-no-blob-shadow.pak";
  plan["watertribe.pak"] = "watertribe-no-visuals-no-shadow.pak";
  return plan;
}

const replacements = replacementPlan();

function sessionMatchesProfile(session) {
  if (!session?.testedCharacter) return false;
  let plan;
  try {
    plan = replacementPlan(session.testedCharacter);
  } catch {
    return false;
  }
  return (
    session.files?.length === Object.keys(plan).length &&
    session.files.every((file) => plan[file.name] === path.basename(file.source))
  );
}

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

async function waitForStableGame(
  checkRunning,
  { timeoutMs = 30_000, pollMs = 300, checkAbort = () => null, onCheckError = () => {} } = {},
) {
  const deadline = performance.now() + timeoutMs;
  let consecutiveChecks = 0;
  do {
    const abortError = checkAbort();
    if (abortError) throw abortError;
    try {
      consecutiveChecks = (await checkRunning()) ? consecutiveChecks + 1 : 0;
      if (consecutiveChecks >= 2) return true;
    } catch (error) {
      consecutiveChecks = 0;
      onCheckError(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (performance.now() < deadline);
  return false;
}

function sessionPath(backupRoot) {
  return path.join(backupRoot, "active-session.json");
}

function readSession(backupRoot) {
  const filePath = sessionPath(backupRoot);
  if (!fs.existsSync(filePath)) return null;
  const session = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (
    session.version !== 1 ||
    !Array.isArray(session.files) ||
    session.files.length < 3 ||
    session.files.length > Object.keys(originals).length
  ) {
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

async function prepareSession({
  gameRoot,
  sourceRoot,
  backupRoot,
  testedCharacter = "Aang",
  expectedOriginals = originals,
}) {
  if (readSession(backupRoot)) throw new Error("Restore the existing blackout session first.");
  const executable = path.join(gameRoot, "Atla.exe");
  if (!(await fs.promises.stat(executable).catch(() => null))?.isFile()) {
    throw new Error("The selected game folder does not contain Atla.exe.");
  }
  const backupDir = path.join(backupRoot, "verified-originals");
  const files = [];
  for (const [name, replacementName] of Object.entries(replacementPlan(testedCharacter))) {
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
    if (!(await fs.promises.stat(file.backup).catch(() => null))) {
      const temporary = `${file.backup}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.promises.copyFile(file.target, temporary, fs.constants.COPYFILE_EXCL);
        if ((await sha256(temporary)) !== file.originalHash) {
          throw new Error(`Backup verification failed for ${file.name}.`);
        }
        if (!(await fs.promises.stat(file.backup).catch(() => null))) {
          await fs.promises.rename(temporary, file.backup);
        }
      } finally {
        await fs.promises.rm(temporary, { force: true });
      }
    }
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
    testedCharacter,
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

async function matchingReplacementPlan(gameRoot, sourceRoot, plan, hashCache = new Map()) {
  const cachedHash = async (filePath) => {
    if (!hashCache.has(filePath)) hashCache.set(filePath, sha256(filePath));
    return hashCache.get(filePath);
  };
  for (const [name, replacementName] of Object.entries(plan)) {
    const target = path.join(gameRoot, "data_packages", name);
    const source = path.join(sourceRoot, replacementName);
    try {
      const [targetStat, sourceStat] = await Promise.all([
        fs.promises.stat(target),
        fs.promises.stat(source),
      ]);
      if (!targetStat.isFile() || !sourceStat.isFile() || targetStat.size !== sourceStat.size) {
        return false;
      }
      const [targetHash, sourceHash] = await Promise.all([cachedHash(target), cachedHash(source)]);
      if (targetHash !== sourceHash) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function verifyInstalledAssets({ gameRoot, sourceRoot, testedCharacter = "Aang" }) {
  return matchingReplacementPlan(gameRoot, sourceRoot, replacementPlan(testedCharacter));
}

async function detectInstalledProfile({ gameRoot, sourceRoot }) {
  const hashCache = new Map();
  for (const testedCharacter of Object.keys(characterPackages)) {
    if (
      await matchingReplacementPlan(
        gameRoot,
        sourceRoot,
        replacementPlan(testedCharacter),
        hashCache,
      )
    ) {
      return testedCharacter;
    }
  }
  return null;
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
        !Object.hasOwn(originals, file.name) ||
        path.basename(file.target) !== file.name ||
        path.resolve(file.target) !== path.resolve(session.gameRoot, "data_packages", file.name) ||
        path.resolve(file.backup) !== path.resolve(session.backupDir, file.name)
      ) {
        throw new Error("The blackout recovery manifest contains an invalid file path.");
      }
      if ((await sha256(file.backup)) !== file.originalHash) {
        throw new Error(`The saved original ${file.name} failed verification; recovery stopped.`);
      }
      if (session.phase === "active" || session.phase === "launching") {
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

async function watchAndRestore(
  backupRoot,
  checkRunning = gameRunning,
  delayMs = 1500,
  restore = restoreSession,
  graceMs = { installing: 60_000, launching: 60_000, active: 20_000 },
) {
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
    let observedPhase = null;
    let phaseStartedAt = performance.now();
    while (true) {
      const now = new Date();
      await fs.promises.utimes(watcherLock, now, now);
      const session = readSession(backupRoot);
      if (!session) return;
      const phase = `${session.backupDir}:${session.phase}`;
      if (phase !== observedPhase) {
        observedPhase = phase;
        phaseStartedAt = performance.now();
        stoppedChecks = 0;
      }
      if (
        Object.hasOwn(graceMs, session.phase) &&
        performance.now() - phaseStartedAt < graceMs[session.phase]
      ) {
        stoppedChecks = 0;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (await checkRunning()) {
        stoppedChecks = 0;
      } else {
        stoppedChecks += 1;
        if (stoppedChecks >= 5) {
          try {
            if (await restore(backupRoot, checkRunning)) return;
          } catch (error) {
            // Windows may keep a PAK handle briefly after Atla.exe exits.
            if (error.code !== "EBUSY") throw error;
          }
        }
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
  characterPackages,
  replacementPlan,
  sessionMatchesProfile,
  replacements,
  sha256,
  gameRunning,
  waitForStableGame,
  sessionPath,
  readSession,
  writeSession,
  prepareSession,
  installSession,
  verifyInstalled,
  verifyInstalledAssets,
  detectInstalledProfile,
  restoreSession,
  watchAndRestore,
};
