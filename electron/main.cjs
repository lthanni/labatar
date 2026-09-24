const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  session,
  desktopCapturer,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
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
const getActiveWindow = async () => (await import("active-win")).activeWindow();

const isDev = !app.isPackaged;
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

async function parseReplayFile(filePath) {
  const content = await fs.promises.readFile(filePath, "latin1");
  const fields = {};
  for (const match of content.match(/[ -~]{3,}/g) ?? []) {
    const separator = match.indexOf(" = ");
    if (separator > 0) fields[match.slice(0, separator)] = match.slice(separator + 3);
  }

  const fileName = path.basename(filePath);
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
    id: fileName,
    timestamp,
    player1: names.player1,
    player2: names.player2,
    player1Character: characters.player1,
    player2Character: characters.player2,
    winner,
    player1Support: formatSupport(characters.player1, fields.P1_SupportCharId),
    player2Support: formatSupport(characters.player2, fields.P2_SupportCharId),
    roundScore:
      fields.TM_WinsT1 && fields.TM_WinsT2
        ? `${fields.TM_WinsT1} - ${fields.TM_WinsT2}`
        : "Unknown",
  };
}

ipcMain.handle("replays:scan-folder", async (event, folder) => {
  if (!folder || !fs.existsSync(folder)) return { games: [], playerCounts: {} };
  const entries = fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".dlr"));
  const total = entries.length;
  const games = [];
  event.sender.send("replays:scan-progress", { completed: 0, total, phase: "scanning" });
  for (const [index, entry] of entries.entries()) {
    games.push(await parseReplayFile(path.join(folder, entry.name)));
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
  return { games, playerCounts };
});

function createOverlayWindow() {
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
}

ipcMain.handle("overlay:show", () => createOverlayWindow());
ipcMain.handle("overlay:hide", () => {
  overlayEnabled = false;
  gameDisplayId = null;
  lastGameBounds = null;
  missedGameFocusChecks = 0;
  overlayWindow?.hide();
});
ipcMain.handle("overlay:is-visible", () =>
  Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()),
);
ipcMain.handle("overlay:set-focus-mode", (_, enabled) => {
  onlyShowWhenGameFocused = Boolean(enabled);
  if (!onlyShowWhenGameFocused && lastGameBounds && overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setBounds(lastGameBounds);
    overlayWindow.showInactive();
  }
  return onlyShowWhenGameFocused;
});

ipcMain.handle("replays:get-folder", () => readSettings().replaysFolder ?? null);

ipcMain.handle("replays:select-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select replay folder",
    properties: ["openDirectory", "createDirectory"],
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

  if (isDev) {
    void window.loadURL("http://localhost:5173");
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

async function getGameCaptureSource() {
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
    const source = await getGameCaptureSource();
    return source
      ? {
          id: source.id,
          mode: source.id.startsWith("window:") ? "game-window" : "unavailable",
          name: source.name,
        }
      : null;
  });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
