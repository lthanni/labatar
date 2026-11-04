const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { performance } = require("node:perf_hooks");

const execFileAsync = promisify(execFile);
const originals = {
  "watertribe.pak": "36409c0bd3b7b4e96695b92091b1d628ba814865b4e0cb5a77dff1430ace57c3",
  "aang.pak": "cb7a6978b4706e3201dbb23d52cf01784bb70fdcc4f6e1e3a3590df073ad550e",
  "aang_avchar.pak": "0dd22f7759721539170ca74633a05cb4a8dd94f77b08d197aaf15c10582850a8",
  "korra.pak": "ef1f402b845bd00df0f45117cc00f72579cb7a8096fc835acada0d21f02c7645",
  "korra_nightmare.pak": "87b65612e37039b0f2f2d677d3f57271f66624e4aa27b635dfb1fea3750bf2f7",
  "zuko.pak": "f0f61302702d15a63c8618cb3be8d22846cb38a915303b7d55df49903c86e8a0",
  "katara.pak": "5925b1d0f88781807ea5aa07fc9449b37672f7ffd067a2bfbb50f7cef5ae9131",
  "toph.pak": "ed97c4e4b611af5e2bbc0464fbb28b24e569d22179a3ad79a6c33c5c4c244c3e",
  "sokka.pak": "7078d686689af6d7c7702b958b0f4c50bc2d41d3ffee34b534e6e01046f884f8",
  "azula.pak": "4b24e35321248f752f73657dfd61e11668e723862fc6b171a515a851f9c6c361",
  "kyoshi.pak": "c2dd8ff589b3b381b3e901f219634837f2f4a334c9c461b8f27382a87967dfc9",
  "ozai.pak": "d986de4462e72c34514d82fe6de7b530a18dda82cd4f5db5329f5194c44d8109",
  "zaheer.pak": "8e2779973c2ac23fa775052f1b563e42b22e52185dfc446c273db3defdf526b3",
  "hud.pak": "e5354e6a82988d070d06627a5769f329f2e4fe3d8b584e988526e784e14e1453",
  "hitspark.pak": "5a5854217385313fa80d112d9f0525548342641c73a54772166944d74dae40b0",
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
  const version = crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(expectedOriginals).sort(([left], [right]) => left.localeCompare(right)),
      ),
    )
    .digest("hex")
    .slice(0, 16);
  const backupDir = path.join(backupRoot, `verified-originals-${version}`);
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
