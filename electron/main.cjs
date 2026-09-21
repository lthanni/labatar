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

function parseReplayFile(filePath) {
  const content = fs.readFileSync(filePath).toString("latin1");
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

ipcMain.handle("replays:scan-folder", (_, folder) => {
  if (!folder || !fs.existsSync(folder)) return { games: [], playerCounts: {} };
  const games = fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".dlr"))
    .map((entry) => parseReplayFile(path.join(folder, entry.name)));
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
    overlayWindow.show();
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
    if (overlayMonitor) clearInterval(overlayMonitor);
    overlayMonitor = null;
    overlayWindow = null;
  });
  if (isDev) void overlayWindow.loadURL("http://localhost:5173/?overlay=1");
  else
    void overlayWindow.loadFile(path.join(__dirname, "../dist/index.html"), {
      search: "?overlay=1",
    });
  overlayMonitor = setInterval(async () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    if (!overlayEnabled) {
      overlayWindow.hide();
      return;
    }
    const active = await getActiveWindow().catch(() => null);
    const processName = active?.owner?.name?.toLowerCase() ?? "";
    const processPath = active?.owner?.path?.toLowerCase() ?? "";
    const isGame =
      processName === "Atla.exe" ||
      processName === "Avatar Legends: The Fighting Game" ||
      processPath.endsWith("\\atla.exe") ||
      processPath.endsWith("/atla.exe");
    if (isDev && active && overlayWindow._lastActiveWindow !== isGame) {
      console.log("Active window:", {
        title: active.title,
        process: active.owner?.name,
        path: active.owner?.path,
      });
    }
    if (overlayWindow) overlayWindow._lastActiveWindow = isGame;
    if (!isGame) {
      if (onlyShowWhenGameFocused) overlayWindow.hide();
      else if (lastGameBounds) {
        overlayWindow.setBounds(lastGameBounds);
        overlayWindow.showInactive();
      }
      return;
    }
    const { x, y, width, height } = active.bounds;
    lastGameBounds = { x, y, width, height };
    const gameDisplay = screen.getDisplayMatching(active.bounds);
    gameDisplayId = gameDisplay.id;
    overlayWindow.setAlwaysOnTop(true, "floating");
    overlayWindow.setBounds({ x, y, width, height });
    overlayWindow.setPosition(Math.max(gameDisplay.bounds.x, x), Math.max(gameDisplay.bounds.y, y));
    overlayWindow.showInactive();
  }, 500);
}

ipcMain.handle("overlay:show", () => createOverlayWindow());
ipcMain.handle("overlay:hide", () => {
  overlayEnabled = false;
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
  const sources = await desktopCapturer.getSources({ types: ["screen"] });
  const displays = screen.getAllDisplays();
  const matchingIndex = displays.findIndex((display) => display.id === gameDisplayId);
  const source =
    sources.find((candidate) => candidate.display_id === String(gameDisplayId)) ??
    sources[matchingIndex] ??
    sources[0];
  if (isDev) {
    console.log("Capture source:", {
      gameDisplayId,
      sourceId: source?.id,
      sourceDisplayId: source?.display_id,
      availableSources: sources.map((candidate) => ({
        id: candidate.id,
        displayId: candidate.display_id,
      })),
      displays: displays.map((display) => display.id),
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
    return source ? { id: source.id } : null;
  });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
