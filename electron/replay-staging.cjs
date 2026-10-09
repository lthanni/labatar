const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const ARCHIVE_NAME = ".labatar-original-replays";
const LIVE_ID_PREFIX = "replays/.labatar-live/";
const STATE_FILE_NAME = "replay-staging.json";
const MARKER_NAME = ".labatar-replay-staging-marker.json";

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function orderReplayFilesForScan(gameFolder, files, stagingState) {
  if (!stagingState) return files;
  const archive = path.join(gameFolder, ARCHIVE_NAME);
  return files.sort((left, right) => {
    const leftArchived = isWithin(archive, left);
    const rightArchived = isWithin(archive, right);
    return Number(rightArchived) - Number(leftArchived) || left.localeCompare(right);
  });
}

function logicalReplayId(gameFolder, filePath, seenIds, stagingState) {
  const originalId = path.relative(gameFolder, filePath).split(path.sep).join("/");
  if (!stagingState) return originalId;
  const archive = path.join(gameFolder, ARCHIVE_NAME);
  if (isWithin(archive, filePath)) {
    return `replays/${path.relative(archive, filePath).split(path.sep).join("/")}`;
  }
  if (seenIds.has(originalId) && originalId.startsWith("replays/")) {
    return `${LIVE_ID_PREFIX}${originalId.slice("replays/".length)}`;
  }
  return originalId;
}

async function exists(candidate) {
  return fs.promises.access(candidate).then(
    () => true,
    () => false,
  );
}

async function fileHash(filePath) {
  const bytes = await fs.promises.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function walkFiles(folder, { skipSymlinks = false } = {}) {
  if (!(await exists(folder))) return [];
  const files = [];
  const pending = [folder];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        if (skipSymlinks) continue;
        throw new Error(`Replay staging cannot safely manage a symbolic link: ${entryPath}`);
      }
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  return files;
}

async function removeEmptyDirectories(folder) {
  if (!(await exists(folder))) return;
  for (const entry of await fs.promises.readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) await removeEmptyDirectories(path.join(folder, entry.name));
  }
  await fs.promises.rmdir(folder);
}

function createReplayStagingStore(userDataFolder) {
  const statePath = path.join(userDataFolder, STATE_FILE_NAME);

  function readState() {
    if (!fs.existsSync(statePath)) return null;
    let state;
    try {
      state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch {
      throw new Error(
        "Replay staging metadata is unreadable. The replay folders were not changed.",
      );
    }
    if (
      state?.version !== 1 ||
      typeof state.gameFolder !== "string" ||
      typeof state.token !== "string" ||
      !["prepared", "active", "restoring", "restored"].includes(state.phase) ||
      !Array.isArray(state.staged)
    ) {
      throw new Error("Replay staging metadata is invalid. The replay folders were not changed.");
    }
    return state;
  }

  async function writeState(state) {
    await fs.promises.mkdir(userDataFolder, { recursive: true });
    const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
    await fs.promises.writeFile(temporaryPath, JSON.stringify(state, null, 2));
    try {
      await fs.promises.rename(temporaryPath, statePath);
    } finally {
      await fs.promises.unlink(temporaryPath).catch(() => {});
    }
  }

  function archiveFolder(gameFolder) {
    return path.join(gameFolder, ARCHIVE_NAME);
  }

  function markerPath(folder) {
    return path.join(folder, MARKER_NAME);
  }

  async function markerMatches(folder, token) {
    try {
      const marker = JSON.parse(await fs.promises.readFile(markerPath(folder), "utf8"));
      return marker?.version === 1 && marker.token === token;
    } catch {
      return false;
    }
  }

  async function ensureMarker(folder, state) {
    if (await exists(markerPath(folder))) {
      if (!(await markerMatches(folder, state.token))) {
        throw new Error(
          "The replay archive contains an unexpected Labatar marker. No files were changed.",
        );
      }
      return;
    }
    await fs.promises.writeFile(
      markerPath(folder),
      JSON.stringify({ version: 1, token: state.token }),
      { flag: "wx" },
    );
  }

  function stateForFolder(gameFolder) {
    const state = readState();
    return state && samePath(state.gameFolder, gameFolder) ? state : null;
  }

  function alternateSavedPath(savedPath) {
    let state;
    try {
      state = readState();
    } catch {
      return null;
    }
    if (!state || typeof savedPath !== "string") return null;
    const liveFolder = path.join(state.gameFolder, "replays");
    const relative = path.relative(liveFolder, savedPath);
    if (!relative || !isWithin(liveFolder, savedPath)) return null;
    const archived = path.join(archiveFolder(state.gameFolder), relative);
    return fs.existsSync(archived) ? archived : null;
  }

  async function resolveSource(gameFolder, replayId, state = stateForFolder(gameFolder)) {
    if (typeof replayId !== "string" || !replayId || !replayId.toLowerCase().endsWith(".dlr")) {
      throw new Error("Select a replay file from match history.");
    }
    const normalizedId = replayId.replaceAll("\\", "/");
    let candidate;
    if (state && normalizedId.startsWith(LIVE_ID_PREFIX)) {
      const liveFolder = path.join(gameFolder, "replays");
      candidate = path.resolve(liveFolder, normalizedId.slice(LIVE_ID_PREFIX.length));
      if (!isWithin(liveFolder, candidate)) {
        throw new Error("A replay is outside the game replay folder.");
      }
    } else {
      candidate = path.resolve(gameFolder, normalizedId.replaceAll("/", path.sep));
      if (state && normalizedId.startsWith("replays/")) {
        const archived = path.resolve(
          archiveFolder(gameFolder),
          normalizedId.slice("replays/".length).replaceAll("/", path.sep),
        );
        if (isWithin(archiveFolder(gameFolder), archived) && (await exists(archived))) {
          candidate = archived;
        }
      }
    }
    if (!isWithin(gameFolder, candidate)) throw new Error("A replay is outside the game folder.");
    const resolved = await fs.promises.realpath(candidate);
    if (!isWithin(gameFolder, resolved)) throw new Error("A replay is outside the game folder.");
    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile()) throw new Error(`Replay file not found: ${replayId}`);
    return resolved;
  }

  async function selectedFiles(gameFolder, ids, state) {
    const requested = [...new Set(Array.isArray(ids) ? ids : [])];
    if (requested.length === 0) throw new Error("No replay files were selected.");
    const names = new Set();
    const selected = [];
    for (const id of requested) {
      const source = await resolveSource(gameFolder, id, state);
      const name = path.basename(source);
      const key = name.toLowerCase();
      if (names.has(key)) {
        throw new Error(`Selected replays share the filename ${name}. Stage them separately.`);
      }
      names.add(key);
      selected.push({ id, source, name, hash: await fileHash(source) });
    }
    return selected;
  }

  async function status(gameFolder) {
    const state = readState();
    if (!state) {
      const orphanedArchive = gameFolder && (await exists(archiveFolder(path.resolve(gameFolder))));
      return {
        active: false,
        gameFolder: null,
        selectedCount: 0,
        newReplayCount: 0,
        issue: orphanedArchive
          ? "A previous Labatar replay archive exists without staging metadata. Restore it manually before staging."
          : null,
      };
    }
    const liveFolder = path.join(state.gameFolder, "replays");
    const archive = archiveFolder(state.gameFolder);
    const archiveExists = await exists(archive);
    const liveFiles = await walkFiles(liveFolder);
    const stagedByName = new Map(state.staged.map((item) => [item.name.toLowerCase(), item.hash]));
    let newReplayCount = 0;
    const presentStaged = new Set();
    for (const file of liveFiles) {
      if (!file.toLowerCase().endsWith(".dlr")) continue;
      const stagedHash =
        path.dirname(file) === liveFolder
          ? stagedByName.get(path.basename(file).toLowerCase())
          : null;
      if (stagedHash && (await fileHash(file)) === stagedHash) {
        presentStaged.add(path.basename(file).toLowerCase());
      } else {
        newReplayCount += 1;
      }
    }
    return {
      active: true,
      gameFolder: state.gameFolder,
      selectedCount: state.staged.length,
      newReplayCount,
      issue: !archiveExists
        ? state.phase === "prepared"
          ? "Replay staging was interrupted before files moved. Restore to clear it."
          : "The Labatar replay archive is missing. No replay files were changed."
        : state.phase !== "active"
          ? "Replay staging was interrupted. Restore the original replay folder before staging again."
          : presentStaged.size !== state.staged.length
            ? "Replay preparation is incomplete. Prepare the selection again or restore the original folder."
            : null,
    };
  }

  async function preview(gameFolder, ids) {
    const root = await fs.promises.realpath(gameFolder);
    const packages = await fs.promises.stat(path.join(root, "data_packages")).catch(() => null);
    if (!packages?.isDirectory()) {
      throw new Error("Choose a valid game folder with data_packages before staging replays.");
    }
    const state = readState();
    if (state && !samePath(state.gameFolder, root)) {
      throw new Error("Restore the staged replays for the other game folder first.");
    }
    if (state?.phase !== "active" && state) {
      throw new Error("Replay staging was interrupted. Restore the original replay folder first.");
    }
    const liveFolder = path.join(root, "replays");
    const liveStat = await fs.promises.lstat(liveFolder);
    if (!liveStat.isDirectory() || liveStat.isSymbolicLink()) {
      throw new Error("The game replay folder is not a regular directory.");
    }
    if (!state && (await exists(archiveFolder(root)))) {
      throw new Error(
        "A Labatar replay archive already exists without metadata. No files were changed.",
      );
    }
    if (!state && (await exists(markerPath(liveFolder)))) {
      throw new Error("The replay folder already contains a Labatar staging marker.");
    }
    if (state && !(await exists(archiveFolder(root)))) {
      throw new Error("The original replay archive is missing. No files were changed.");
    }
    const selected = await selectedFiles(root, ids, state);
    const archivedCount = state
      ? (await walkFiles(archiveFolder(root), { skipSymlinks: true })).filter((file) =>
          file.toLowerCase().endsWith(".dlr"),
        ).length
      : (await walkFiles(liveFolder, { skipSymlinks: true })).filter((file) =>
          file.toLowerCase().endsWith(".dlr"),
        ).length;
    return { selectedCount: selected.length, archivedCount, switching: Boolean(state) };
  }

  async function ingestLiveFiles(state) {
    const liveFolder = path.join(state.gameFolder, "replays");
    const archive = archiveFolder(state.gameFolder);
    const stagedByName = new Map(state.staged.map((item) => [item.name.toLowerCase(), item.hash]));
    const moved = new Map();
    let newReplayCount = 0;
    let recoveredCount = 0;
    for (const file of await walkFiles(liveFolder)) {
      const relative = path.relative(liveFolder, file);
      const stagedHash =
        path.dirname(file) === liveFolder
          ? stagedByName.get(path.basename(file).toLowerCase())
          : null;
      if (stagedHash && (await fileHash(file)) === stagedHash) {
        await fs.promises.unlink(file);
        continue;
      }
      let destination = path.join(archive, relative);
      if (await exists(destination)) {
        destination = path.join(archive, "Recovered while staged", randomUUID(), relative);
        recoveredCount += 1;
      }
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.rename(file, destination);
      moved.set(file.toLowerCase(), destination);
      if (file.toLowerCase().endsWith(".dlr")) newReplayCount += 1;
    }
    return { moved, newReplayCount, recoveredCount };
  }

  async function stage(gameFolder, ids) {
    const root = await fs.promises.realpath(gameFolder);
    const state = readState();
    await preview(root, ids);
    const selected = await selectedFiles(root, ids, state);
    const liveFolder = path.join(root, "replays");
    const archive = archiveFolder(root);
    let current = state;
    let moved = new Map();
    if (!current) {
      current = {
        version: 1,
        gameFolder: root,
        token: randomUUID(),
        phase: "prepared",
        staged: [],
      };
      await writeState(current);
      await fs.promises.rename(liveFolder, archive);
      await ensureMarker(archive, current);
      await fs.promises.mkdir(liveFolder);
    } else {
      const result = await ingestLiveFiles(current);
      moved = result.moved;
      current = { ...current, staged: [] };
      await writeState(current);
    }
    const staged = selected.map((item) => {
      let source = moved.get(item.source.toLowerCase()) ?? item.source;
      if (isWithin(liveFolder, source)) {
        source = path.join(archive, path.relative(liveFolder, source));
      }
      return { ...item, source };
    });
    current = {
      ...current,
      phase: "active",
      staged: staged.map(({ name, hash }) => ({ name, hash })),
    };
    await writeState(current);
    for (const item of staged) {
      await fs.promises.copyFile(
        item.source,
        path.join(liveFolder, item.name),
        fs.constants.COPYFILE_EXCL,
      );
    }
    return status(root);
  }

  async function restore() {
    const state = readState();
    if (!state) return status(null);
    const liveFolder = path.join(state.gameFolder, "replays");
    const archive = archiveFolder(state.gameFolder);
    if (!(await exists(archive))) {
      if (state.phase === "restored" && (await exists(liveFolder))) {
        if (await exists(markerPath(liveFolder))) {
          if (!(await markerMatches(liveFolder, state.token))) {
            throw new Error(
              "The restored replay folder has an unexpected marker. No files were changed.",
            );
          }
          await fs.promises.unlink(markerPath(liveFolder));
        }
        await fs.promises.unlink(statePath);
        return status(state.gameFolder);
      }
      if (state.phase === "restoring") {
        if (!(await markerMatches(liveFolder, state.token))) {
          throw new Error("The original replay archive is missing. No files were changed.");
        }
        await writeState({ ...state, phase: "restored" });
        await fs.promises.unlink(markerPath(liveFolder));
        await fs.promises.unlink(statePath);
        return status(state.gameFolder);
      }
      if (state.phase !== "prepared") {
        throw new Error("The original replay archive is missing. No files were changed.");
      }
      if (!(await exists(liveFolder))) {
        throw new Error("Both replay folders are missing. No files were changed.");
      }
      await fs.promises.unlink(statePath);
      return status(state.gameFolder);
    }
    await ensureMarker(archive, state);
    const restoring = { ...state, phase: "restoring" };
    await writeState(restoring);
    let newReplayCount = 0;
    let recoveredCount = 0;
    if (await exists(liveFolder)) {
      const result = await ingestLiveFiles(restoring);
      newReplayCount = result.newReplayCount;
      recoveredCount = result.recoveredCount;
      await removeEmptyDirectories(liveFolder);
    }
    await fs.promises.rename(archive, liveFolder);
    await writeState({ ...restoring, phase: "restored" });
    await fs.promises.unlink(markerPath(liveFolder));
    await fs.promises.unlink(statePath);
    return { ...(await status(state.gameFolder)), newReplayCount, recoveredCount };
  }

  return {
    alternateSavedPath,
    archiveFolder,
    preview,
    readState,
    resolveSource,
    restore,
    stage,
    stateForFolder,
    status,
  };
}

module.exports = {
  ARCHIVE_NAME,
  LIVE_ID_PREFIX,
  createReplayStagingStore,
  logicalReplayId,
  orderReplayFilesForScan,
};
