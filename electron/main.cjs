const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  desktopCapturer,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { autoUpdater } = require("electron-updater");
const supportMap = require("./support-map.json");
const characterMap = require("./character-map.json");
let overlayWindow = null;
let overlayMonitor = null;
let gameDisplayId = null;
let onlyShowWhenGameFocused = true;
let lastGameBounds = null;
let lastGameWindowTitle = null;
let missedGameFocusChecks = 0;
let overlayEnabled = false;
let updateCheckPromise = null;
let updateDownloadPromise = null;
let updateMenuItem = null;
let updateState = "idle";
let latestUpdateInfo = null;
let mainWindow = null;
const getActiveWindow = async () => (await import("active-win")).activeWindow();

const isDev = !app.isPackaged;
const overlayAvailable = isDev;
const defaultReplaysFolder = path.join(
  "C:\\",
  "Program Files (x86)",
  "Steam",
  "steamapps",
  "common",
  "Avatar Legends The Fighting Game",
);
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

function watchElectronFiles() {
  if (!isDev) return;

  const watchedFiles = [
    __filename,
    path.join(__dirname, "preload.cjs"),
    path.join(__dirname, "support-map.json"),
    path.join(__dirname, "character-map.json"),
  ];
  let restarting = false;
  for (const file of watchedFiles) {
    fs.watchFile(file, { interval: 250 }, (current, previous) => {
      if (restarting || current.mtimeMs === previous.mtimeMs) return;
      restarting = true;
      app.relaunch();
      app.exit(0);
    });
  }
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

function updateInfo(info) {
  return {
    version: info?.version,
    releaseDate: info?.releaseDate,
  };
}

function setUpdateMenuState(state, info = null) {
  updateState = state;
  latestUpdateInfo = info ? updateInfo(info) : latestUpdateInfo;
  if (!updateMenuItem) return;

  const labels = {
    idle: "Check for Updates...",
    checking: "Checking for Updates...",
    available: `Download Update${latestUpdateInfo?.version ? ` (v${latestUpdateInfo.version})` : ""}...`,
    downloading: "Downloading Update...",
    downloaded: "Restart and Install Update",
    error: "Check for Updates...",
  };
  updateMenuItem.label = labels[state] ?? labels.idle;
  updateMenuItem.enabled = !["checking", "downloading"].includes(state);
}

async function showUpdateError(error) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Update check failed",
    message: "Labatar could not check for updates.",
    detail: error instanceof Error ? error.message : String(error),
    buttons: ["OK"],
  });
}

async function promptDownloadUpdate(info) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Update available",
    message: `Labatar ${info?.version ? `v${info.version} ` : ""}is available.`,
    detail: "Download the update now? Labatar will ask before restarting to install it.",
    buttons: ["Download Update", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0) void downloadUpdate();
}

async function promptInstallUpdate() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Update ready",
    message: "The Labatar update is ready to install.",
    detail: "Restart Labatar now to finish updating?",
    buttons: ["Restart and Install", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0) autoUpdater.quitAndInstall(true, true);
}

function downloadUpdate() {
  if (isDev) return Promise.resolve(null);
  if (updateDownloadPromise) return updateDownloadPromise;
  setUpdateMenuState("downloading");
  updateDownloadPromise = autoUpdater
    .downloadUpdate()
    .catch((error) => {
      setUpdateMenuState("error");
      void showUpdateError(error);
      return null;
    })
    .finally(() => {
      updateDownloadPromise = null;
    });
  return updateDownloadPromise;
}

function handleUpdateMenuClick() {
  if (updateState === "available") return void downloadUpdate();
  if (updateState === "downloaded") return void promptInstallUpdate();
  void checkForUpdates(true);
}

async function checkForUpdates(showErrors = false) {
  if (isDev) {
    if (showErrors) await showUpdateError("Updates are only available in installed builds.");
    return null;
  }
  if (updateCheckPromise) return updateCheckPromise;

  setUpdateMenuState("checking");
  updateCheckPromise = autoUpdater
    .checkForUpdates()
    .then((result) => result)
    .catch((error) => {
      setUpdateMenuState("error");
      if (showErrors) void showUpdateError(error);
      return null;
    })
    .finally(() => {
      updateCheckPromise = null;
    });
  return updateCheckPromise;
}

function configureAutoUpdater() {
  if (isDev) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableDifferentialDownload = false;
  autoUpdater.on("checking-for-update", () => {
    setUpdateMenuState("checking");
  });
  autoUpdater.on("update-available", (info) => {
    setUpdateMenuState("available", info);
    void promptDownloadUpdate(info);
  });
  autoUpdater.on("update-not-available", (info) => {
    setUpdateMenuState("idle", info);
  });
  autoUpdater.on("download-progress", (progress) => {
    setUpdateMenuState("downloading");
    if (updateMenuItem)
      updateMenuItem.label = `Downloading Update (${Math.round(progress.percent)}%)...`;
  });
  autoUpdater.on("update-downloaded", (info) => {
    setUpdateMenuState("downloaded", info);
    void promptInstallUpdate();
  });
  autoUpdater.on("error", () => {
    setUpdateMenuState("error");
  });
}

function cleanReplayName(value) {
  return value
    .replace(/^.*?@@/, "")
    .replace(/\\_@@/g, " ")
    .replace(/\\/g, "")
    .trim();
}

function formatSupport(character, supportId) {
  if (!supportId || supportId === "0") return "None";
  const aliases = {
    korra_nightmare: "Nightmare Korra",
    aang_avchar: "Aang",
    avatar_aang: "Avatar Aang",
  };
  const normalized = character
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const mappedCharacter =
    aliases[character.trim().toLowerCase()] ??
    Object.keys(supportMap).find(
      (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized,
    );
  return supportMap[mappedCharacter]?.[supportId] || `Support #${supportId}`;
}

function formatCharacter(character) {
  return (
    characterMap[character] ??
    characterMap[character.toUpperCase()] ??
    characterMap[
      Object.keys(characterMap).find((key) => key.toLowerCase() === character.toLowerCase())
    ] ??
    character
  );
}

async function parseReplayFile(filePath, rootFolder = path.dirname(filePath)) {
  const contentBuffer = await fs.promises.readFile(filePath);
  const content = contentBuffer.toString("latin1");
  const contentHash = createHash("sha256").update(contentBuffer).digest("hex");
  const fields = {};
  for (const match of content.match(/[ -~]{3,}/g) ?? []) {
    const separator = match.indexOf(" = ");
    if (separator > 0) fields[match.slice(0, separator)] = match.slice(separator + 3);
  }

  const fileName = path.basename(filePath);
  const replayId = path.relative(rootFolder, filePath).split(path.sep).join("/");
  const names = {
    player1: cleanReplayName(fields.ReplayInfo_P1Name ?? "Player 1"),
    player2: cleanReplayName(fields.ReplayInfo_P2Name ?? "Player 2"),
  };
  const characters = {
    player1: formatCharacter(fields["P1"] ?? fields.PreFight_MainChar ?? "Unknown"),
    player2: formatCharacter(fields["P2"] ?? "Unknown"),
  };
  const winner =
    fields.ReplayInfo_Winner === "1"
      ? names.player1
      : fields.ReplayInfo_Winner === "2"
        ? names.player2
        : "Unknown";
  const timestampMatch = fileName.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})/);
  const timestamp = timestampMatch
    ? `${timestampMatch[1]}-${timestampMatch[2]}-${timestampMatch[3]} ${timestampMatch[4]}:${timestampMatch[5]}:${timestampMatch[6]}`
    : null;

  return {
    id: replayId,
    contentHash,
    timestamp,
    player1: names.player1,
    player2: names.player2,
    player1Character: characters.player1,
    player2Character: characters.player2,
    winner,
    player1Support: formatSupport(
      characters.player1,
      fields.P1_SupportCharId ??
        fields.P1_SupportCharID ??
        fields.SupportCharIdP1 ??
        fields.SupportCharIDP1,
    ),
    player2Support: formatSupport(
      characters.player2,
      fields.P2_SupportCharId ??
        fields.P2_SupportCharID ??
        fields.SupportCharIdP2 ??
        fields.SupportCharIDP2,
    ),
    roundScore:
      fields.TM_WinsT1 && fields.TM_WinsT2
        ? `${fields.TM_WinsT1} - ${fields.TM_WinsT2}`
        : "Unknown",
  };
}

async function findReplayFiles(folder) {
  const replayFiles = [];
  const directories = [folder];

  while (directories.length > 0) {
    const currentDirectory = directories.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(currentDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) directories.push(entryPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".dlr")) {
        replayFiles.push(entryPath);
      }
    }
  }

  return replayFiles.sort((left, right) => left.localeCompare(right));
}

ipcMain.handle("replays:scan-folder", async (event, folder) => {
  if (!folder || !fs.existsSync(folder)) return { games: [], playerCounts: {}, duplicateCount: 0 };
  const replayFiles = await findReplayFiles(folder);
  const total = replayFiles.length;
  const games = [];
  const seenReplayHashes = new Set();
  let duplicateCount = 0;
  event.sender.send("replays:scan-progress", { completed: 0, total, phase: "scanning" });
  for (const [index, filePath] of replayFiles.entries()) {
    const { contentHash, ...game } = await parseReplayFile(filePath, folder);
    if (seenReplayHashes.has(contentHash)) duplicateCount += 1;
    else {
      seenReplayHashes.add(contentHash);
      games.push(game);
    }
    event.sender.send("replays:scan-progress", {
      completed: index + 1,
      total,
      phase: "scanning",
    });
    // Give Electron a turn between batches so the window and progress events
    // remain responsive during large replay-folder scans.
    if ((index + 1) % 10 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  const playerCounts = {};
  for (const game of games) {
    playerCounts[game.player1] = (playerCounts[game.player1] ?? 0) + 1;
    playerCounts[game.player2] = (playerCounts[game.player2] ?? 0) + 1;
  }
  return { games, playerCounts, duplicateCount };
});

function safeZipName(value) {
  const name = String(value ?? "Labatar replays")
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .filter((character) => character.charCodeAt(0) >= 0x20)
    .join("")
    .trim()
    .replace(/[. ]+$/, "");
  return name || "Labatar replays";
}

function quotePowerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPowerShellZip(sourceFolder, destination) {
  return new Promise((resolve, reject) => {
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `$sourceFolder = ${quotePowerShellString(sourceFolder)}`,
      `$destination = ${quotePowerShellString(destination)}`,
      "$source = Join-Path $sourceFolder '*'",
      "Compress-Archive -Path $source -DestinationPath $destination -CompressionLevel Optimal -Force",
    ].join("; ");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: true },
    );
    let errorOutput = "";
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || `PowerShell exited with code ${code}`));
    });
  });
}

async function resolveReplayPath(rootFolder, replayId) {
  const normalizedId = replayId.replaceAll("/", path.sep);
  const candidate = path.resolve(rootFolder, normalizedId);
  const relativeCandidate = path.relative(rootFolder, candidate);
  if (
    relativeCandidate.startsWith(".." + path.sep) ||
    relativeCandidate === ".." ||
    path.isAbsolute(relativeCandidate)
  ) {
    throw new Error("A selected replay is outside the replay folder.");
  }
  const realCandidate = await fs.promises.realpath(candidate);
  const realRelativeCandidate = path.relative(rootFolder, realCandidate);
  if (
    realRelativeCandidate.startsWith(".." + path.sep) ||
    realRelativeCandidate === ".." ||
    path.isAbsolute(realRelativeCandidate)
  ) {
    throw new Error("A selected replay is outside the replay folder.");
  }
  const stat = await fs.promises.stat(realCandidate);
  if (!stat.isFile()) throw new Error(`Replay file not found: ${replayId}`);
  return realCandidate;
}

ipcMain.handle("replays:show-in-folder", async (_, request) => {
  const folder = readSettings().replaysFolder;
  const requestedIds = [
    ...new Set(
      Array.isArray(request?.ids)
        ? request.ids.filter((id) => typeof id === "string" && id.length > 0)
        : [],
    ),
  ];
  if (!folder) throw new Error("Select a replay folder before opening Explorer.");
  if (requestedIds.length === 0) throw new Error("No replay files were selected.");

  const rootFolder = await fs.promises.realpath(folder);
  const replayPath = await resolveReplayPath(rootFolder, requestedIds[0]);
  if (requestedIds.length === 1) shell.showItemInFolder(replayPath);
  else await shell.openPath(path.dirname(replayPath));
});

ipcMain.handle("replays:zip", async (_, request) => {
  const folder = readSettings().replaysFolder;
  const requestedIds = [
    ...new Set(
      Array.isArray(request?.ids)
        ? request.ids.filter((id) => typeof id === "string" && id.length > 0)
        : [],
    ),
  ];
  if (!folder) throw new Error("Select a replay folder before exporting replays.");
  if (requestedIds.length === 0) throw new Error("No replay files were selected.");

  const rootFolder = await fs.promises.realpath(folder);
  const files = [];
  for (const replayId of requestedIds) {
    const normalizedId = replayId.replaceAll("/", path.sep);
    const candidate = path.resolve(rootFolder, normalizedId);
    const relativeCandidate = path.relative(rootFolder, candidate);
    if (
      relativeCandidate.startsWith(".." + path.sep) ||
      relativeCandidate === ".." ||
      path.isAbsolute(relativeCandidate)
    ) {
      throw new Error("A selected replay is outside the replay folder.");
    }
    const realCandidate = await fs.promises.realpath(candidate);
    const realRelativeCandidate = path.relative(rootFolder, realCandidate);
    if (
      realRelativeCandidate.startsWith(".." + path.sep) ||
      realRelativeCandidate === ".." ||
      path.isAbsolute(realRelativeCandidate)
    ) {
      throw new Error("A selected replay is outside the replay folder.");
    }
    const stat = await fs.promises.stat(realCandidate);
    if (!stat.isFile()) throw new Error(`Replay file not found: ${replayId}`);
    files.push({ source: realCandidate, relative: realRelativeCandidate });
  }

  const defaultName = `${safeZipName(request?.suggestedName)}.zip`;
  const result = await dialog.showSaveDialog({
    title: "Export replays as ZIP",
    defaultPath: path.join(app.getPath("downloads"), defaultName),
    filters: [{ name: "ZIP archive", extensions: ["zip"] }],
  });
  if (result.canceled || !result.filePath) return null;

  const destination = result.filePath.toLowerCase().endsWith(".zip")
    ? result.filePath
    : `${result.filePath}.zip`;
  const stagingFolder = await fs.promises.mkdtemp(
    path.join(app.getPath("temp"), "labatar-replays-"),
  );
  try {
    for (const file of files) {
      const stagedPath = path.join(stagingFolder, file.relative);
      await fs.promises.mkdir(path.dirname(stagedPath), { recursive: true });
      await fs.promises.copyFile(file.source, stagedPath);
    }
    await runPowerShellZip(stagingFolder, destination);
    return { path: destination, fileCount: files.length };
  } finally {
    await fs.promises.rm(stagingFolder, { recursive: true, force: true });
  }
});

function createOverlayWindow() {
  if (!overlayAvailable) return false;
  overlayEnabled = true;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return;
  }
  const display = screen.getPrimaryDisplay();
  const width = Math.min(900, display.workAreaSize.width - 80);
  overlayWindow = new BrowserWindow({
    width,
    height: display.workAreaSize.height,
    x: Math.round((display.workAreaSize.width - width) / 2),
    y: display.bounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.setVisibleOnAllWorkspaces(false);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.on("closed", () => {
    overlayEnabled = false;
    gameDisplayId = null;
    lastGameBounds = null;
    lastGameWindowTitle = null;
    missedGameFocusChecks = 0;
    if (overlayMonitor) clearInterval(overlayMonitor);
    overlayMonitor = null;
    overlayWindow = null;
  });
  if (isDev) void overlayWindow.loadURL("http://localhost:5173/?overlay=1");
  else
    void overlayWindow.loadFile(path.join(__dirname, "../dist/index.html"), {
      search: "?overlay=1",
    });
  let monitorBusy = false;
  let appliedBounds = null;
  let appliedDisplayId = null;
  const sameBounds = (left, right) =>
    left &&
    right &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height;
  const applyOverlayTarget = (display) => {
    const bounds = { ...display.bounds };
    const targetChanged = !sameBounds(appliedBounds, bounds) || appliedDisplayId !== display.id;
    gameDisplayId = display.id;
    lastGameBounds = bounds;
    if (targetChanged) {
      overlayWindow.setAlwaysOnTop(true, "screen-saver");
      overlayWindow.setBounds(bounds);
      appliedBounds = bounds;
      appliedDisplayId = display.id;
    }
    if (!overlayWindow.isVisible()) overlayWindow.showInactive();
  };
  const syncOverlayWindow = async () => {
    if (monitorBusy || !overlayWindow || overlayWindow.isDestroyed()) return;
    monitorBusy = true;
    try {
      if (!overlayEnabled) {
        overlayWindow.hide();
        return;
      }
      const active = await getActiveWindow().catch(() => null);
      const processName = active?.owner?.name?.toLowerCase() ?? "";
      const processPath = active?.owner?.path?.toLowerCase() ?? "";
      const isGame =
        processName === "atla.exe" ||
        processName === "avatar legends: the fighting game" ||
        processPath.endsWith("\\atla.exe") ||
        processPath.endsWith("/atla.exe") ||
        processName.includes("atla") ||
        processPath.includes("\\atla") ||
        processPath.includes("/atla");
      if (isDev && active && overlayWindow._lastActiveWindow !== isGame) {
        console.log("Active window:", {
          title: active.title,
          process: active.owner?.name,
          path: active.owner?.path,
        });
      }
      overlayWindow._lastActiveWindow = isGame;
      if (!isGame || !active?.bounds) {
        if (!onlyShowWhenGameFocused) {
          const display = lastGameBounds
            ? screen.getDisplayMatching(lastGameBounds)
            : screen.getPrimaryDisplay();
          missedGameFocusChecks = 0;
          applyOverlayTarget(display);
          return;
        }
        missedGameFocusChecks += 1;
        if (onlyShowWhenGameFocused && missedGameFocusChecks >= 4) overlayWindow.hide();
        else if (lastGameBounds) {
          const display = screen.getDisplayMatching(lastGameBounds);
          applyOverlayTarget(display);
          if (!overlayWindow.isVisible()) overlayWindow.showInactive();
        }
        return;
      }
      missedGameFocusChecks = 0;
      lastGameWindowTitle = active.title || lastGameWindowTitle;
      // The capture and overlay coordinates are display-based. Use Electron's
      // display bounds instead of active-win's native window rectangle so DPI
      // scaling cannot move or resize the overlay incorrectly.
      const gameDisplay = screen.getDisplayMatching(active.bounds);
      applyOverlayTarget(gameDisplay);
    } finally {
      monitorBusy = false;
    }
  };
  overlayMonitor = setInterval(() => void syncOverlayWindow(), 250);
  void syncOverlayWindow();
  return true;
}

ipcMain.handle("overlay:show", () => createOverlayWindow());
ipcMain.handle("overlay:hide", () => {
  if (!overlayAvailable) return false;
  overlayEnabled = false;
  gameDisplayId = null;
  lastGameBounds = null;
  missedGameFocusChecks = 0;
  overlayWindow?.hide();
  return true;
});
ipcMain.handle(
  "overlay:is-visible",
  () =>
    overlayAvailable &&
    Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()),
);
ipcMain.handle("overlay:set-focus-mode", (_, enabled) => {
  if (!overlayAvailable) return false;
  onlyShowWhenGameFocused = Boolean(enabled);
  if (!onlyShowWhenGameFocused && lastGameBounds && overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setBounds(lastGameBounds);
    overlayWindow.showInactive();
  }
  return onlyShowWhenGameFocused;
});

ipcMain.handle("overlay:finalize-capture", () => {
  if (!overlayAvailable) return false;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("overlay:finalize-capture");
  }
  return true;
});

ipcMain.handle("overlay:begin-capture", () => {
  if (!overlayAvailable) return false;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("overlay:begin-capture");
  }
  return true;
});

function safeCaptureName(value, fallback) {
  const name = String(value ?? "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+$/, "");
  return name || fallback;
}

function captureSessionDirectory(sessionId) {
  return path.join(captureRootDirectory(), safeCaptureName(sessionId, "session"));
}

function captureRootDirectory() {
  return path.join(app.getPath("videos"), "Labatar", "captures");
}

ipcMain.handle("overlay:get-capture-folder", () => captureRootDirectory());

ipcMain.handle("overlay:open-capture-folder", async () => {
  const directory = captureRootDirectory();
  await fs.promises.mkdir(directory, { recursive: true });
  const error = await shell.openPath(directory);
  if (error) throw new Error(error);
  return directory;
});

ipcMain.handle("overlay:save-capture-screenshot", async (_, request) => {
  const directory = captureSessionDirectory(request?.sessionId);
  const filename = safeCaptureName(request?.filename, "capture.png");
  const data = request?.data;
  if (!data || (!ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer))) {
    throw new Error("Capture screenshot data is missing or invalid");
  }
  const bytes = ArrayBuffer.isView(data)
    ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    : Buffer.from(new Uint8Array(data));
  await fs.promises.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, filename);
  await fs.promises.writeFile(filePath, bytes);
  return { path: filePath };
});

ipcMain.handle("overlay:save-capture-video", async (_, request) => {
  const directory = captureSessionDirectory(request?.sessionId);
  const data = request?.data;
  if (!data || (!ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer))) {
    throw new Error("Capture video data is missing or invalid");
  }
  const bytes = ArrayBuffer.isView(data)
    ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    : Buffer.from(new Uint8Array(data));
  await fs.promises.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, "session.webm");
  await fs.promises.writeFile(filePath, bytes);
  return { path: filePath };
});

ipcMain.handle("overlay:save-capture-session", async (_, request) => {
  const directory = captureSessionDirectory(request?.sessionId);
  await fs.promises.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, "session.json");
  await fs.promises.writeFile(filePath, JSON.stringify(request?.manifest ?? {}, null, 2), "utf8");
  return { path: filePath };
});

ipcMain.handle("replays:get-folder", () => {
  const savedFolder = readSettings().replaysFolder;
  if (savedFolder) return savedFolder;
  return fs.existsSync(defaultReplaysFolder) ? defaultReplaysFolder : null;
});

ipcMain.handle("replays:select-folder", async () => {
  const savedFolder = readSettings().replaysFolder;
  const defaultPath =
    (savedFolder && fs.existsSync(savedFolder) && savedFolder) ||
    (fs.existsSync(defaultReplaysFolder) && defaultReplaysFolder) ||
    app.getPath("home");
  const result = await dialog.showOpenDialog({
    title: "Select replay folder",
    properties: ["openDirectory", "createDirectory"],
    defaultPath,
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const folder = result.filePaths[0];
  writeSettings({ ...readSettings(), replaysFolder: folder });
  return folder;
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  if (isDev) {
    void window.loadURL("http://localhost:5173");
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function buildApplicationMenu() {
  const template = [
    {
      label: "File",
      submenu: [{ role: "quit", label: "Exit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools", enabled: isDev },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for Updates...",
          click: handleUpdateMenuClick,
        },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  updateMenuItem = menu.items.at(-1)?.submenu?.items[0] ?? null;
  setUpdateMenuState(updateState);
  Menu.setApplicationMenu(menu);
}

async function getGameCaptureSource() {
  if (!overlayAvailable) return null;
  const sources = await desktopCapturer.getSources({ types: ["window"] });
  const displays = screen.getAllDisplays();
  // `display_id` is the authoritative mapping. Source order is not guaranteed
  // to match screen.getAllDisplays(), especially with monitors arranged left of
  // the primary display. Some Electron versions also expose the same ID only
  // in the source ID (`screen:<display-id>:<index>`), so support both forms.
  const gameDisplay = lastGameBounds ? screen.getDisplayMatching(lastGameBounds) : null;
  const overlayDisplay =
    overlayWindow && !overlayWindow.isDestroyed()
      ? screen.getDisplayMatching(overlayWindow.getBounds())
      : null;
  if (gameDisplay) gameDisplayId = gameDisplay.id;
  if (!gameDisplayId && overlayDisplay) gameDisplayId = overlayDisplay.id;
  const wantedDisplayId = String(gameDisplayId ?? screen.getPrimaryDisplay().id);
  const sourceDisplayMatches = (candidate) => {
    const sourceDisplayId = String(candidate.display_id ?? "");
    const sourceIdDisplayId = String(candidate.id ?? "").match(/^screen:([^:]+):/i)?.[1] ?? "";
    return sourceDisplayId === wantedDisplayId || sourceIdDisplayId === wantedDisplayId;
  };
  const normalizeTitle = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase();
  const gameTitle = normalizeTitle(lastGameWindowTitle);
  const windowSources = sources.filter((candidate) => {
    if (!String(candidate.id ?? "").startsWith("window:")) return false;
    const sourceTitle = normalizeTitle(candidate.name);
    return (
      gameTitle &&
      (sourceTitle === gameTitle ||
        sourceTitle.includes(gameTitle) ||
        gameTitle.includes(sourceTitle))
    );
  });
  const windowSource = windowSources.find(sourceDisplayMatches) ?? windowSources[0] ?? null;
  const source = windowSource;
  // Deliberately disabled for now: a screen source can contain this overlay
  // window and feed the overlay's own pixels back into the scanners.
  // const screenSources = await desktopCapturer.getSources({ types: ["screen"] });
  // const screenSource = screenSources.find(sourceDisplayMatches);
  // const source = windowSource ?? screenSource;
  if (isDev) {
    console.log("Capture source:", {
      gameDisplayId,
      sourceId: source?.id,
      sourceType: source?.id?.startsWith("window:") ? "game-window" : "unavailable",
      sourceName: source?.name,
      sourceDisplayId: source?.display_id,
      availableSources: sources.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        displayId: candidate.display_id,
      })),
      displays: displays.map((display) => display.id),
      matched: Boolean(source),
    });
  }
  return source ?? null;
}

void app.whenReady().then(() => {
  watchElectronFiles();
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const source = await getGameCaptureSource();
    callback({ video: source });
  });
  ipcMain.handle("overlay:get-capture-source", async () => {
    if (!overlayAvailable) return null;
    const source = await getGameCaptureSource();
    return source
      ? {
          id: source.id,
          mode: source.id.startsWith("window:") ? "game-window" : "unavailable",
          name: source.name,
        }
      : null;
  });
  buildApplicationMenu();
  createWindow();
  configureAutoUpdater();
  if (!isDev) setTimeout(() => void checkForUpdates(), 4000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
