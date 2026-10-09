const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
  safeStorage,
  globalShortcut,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const readline = require("node:readline");
const { createHash, randomUUID } = require("node:crypto");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { deflateSync } = require("node:zlib");
const { autoUpdater } = require("electron-updater");
const { OBSWebSocket } = require("obs-websocket-js");
const ffmpegStaticPath = require("ffmpeg-static");
const { MatchLogWatcher } = require("./match-watcher.cjs");
const { createUnnamedRecordChapter } = require("./record-chapter.cjs");
const { addGameChaptersToMp4, probeChapters } = require("./game-chapters.cjs");
const { buildClipExportFfmpegArgs } = require("./clip-export.cjs");
const { planClipTrim, replaceClipWithBackup } = require("./clip-trim.cjs");
const { createMissingManualChapterClips } = require("./manual-chapter-clips.cjs");
const { noGameStartedRecordingBaseName } = require("./automatic-recording-outcome.cjs");
const { normalizeYouTubeVideoUrl, readYouTubeVideoUrl } = require("./recording-youtube.cjs");
const {
  takePendingReplayMatch,
  replayMatchesGame,
  replayRoundScore,
} = require("./automatic-replay-association.cjs");
const {
  canRecordLobbylessMatch,
  recordingMatchesAutomaticGame,
} = require("./lobbyless-recording.cjs");
const { normalizeRendererSnapshot, summarizeProcessMetric } = require("./renderer-profile.cjs");
const supportMap = require("./support-map.json");
const characterMap = require("./character-map.json");
const { createProcessingConfigurationStore } = require("./processing-config.cjs");
const { createMoveCatalogStore } = require("./move-catalog.cjs");
const { validateMoveTake } = require("./move-take-validation.cjs");
const { createAutomaticMoveRunner } = require("./automatic-move-runner.cjs");
const { createTrainingInputClient } = require("./training-input-client.cjs");
const {
  gameRunning: blackoutGameRunning,
  sha256: sha256BlackoutFile,
  readSession: readBlackoutSession,
  writeSession: writeBlackoutSession,
  prepareSession: prepareBlackoutSession,
  installSession: installBlackoutSession,
  verifyInstalled: verifyBlackoutInstalled,
  restoreSession: restoreBlackoutSession,
} = require("./dev-blackout-game.cjs");
const { createOpponentSetHistory } = require("./opponent-set-history.cjs");
const {
  createReplayStagingStore,
  logicalReplayId,
  orderReplayFilesForScan,
} = require("./replay-staging.cjs");
const detectorKeys = require("./detector-config-keys.json");
const { configureDevelopmentUserData } = require("./dev-user-data.cjs");
const {
  publishPortraits,
  readPortraitCatalog,
  portraitPlayerNameHints,
  portraitArtwork,
  missingPortraitArtwork,
  portraitMatchup,
} = require("./portrait-library.cjs");
const {
  parsePakHeader,
  parsePakDirectory,
  portraitPakRelativePath,
  decodePortraitMunged,
  encodePngRgba,
} = app.isPackaged
  ? require("./generated/artwork-extractor.cjs")
  : require("./artwork-extractor.ts");
const isDev = !app.isPackaged;
const rendererProfilingEnabled =
  process.env.LABATAR_RENDERER_PROFILE === "1" ||
  (isDev && process.env.LABATAR_RENDERER_PROFILE !== "0");
const developmentUserData = isDev
  ? configureDevelopmentUserData(app, path.resolve(__dirname, ".."))
  : null;
const processingConfigurationStore = () =>
  createProcessingConfigurationStore(app.getPath("userData"), detectorKeys);
const moveCatalogStore = () => createMoveCatalogStore(app.getPath("userData"));
const replayStagingStore = () => createReplayStagingStore(app.getPath("userData"));
const execFileAsync = promisify(execFile);

function startupDiagnosticLogFile() {
  try {
    return path.join(app.getPath("userData"), "startup-debug.log");
  } catch {
    const appData = process.env.APPDATA || process.cwd();
    return path.join(appData, "Labatar", "startup-debug.log");
  }
}

function startupDiagnostic(event, details = {}) {
  try {
    const logPath = startupDiagnosticLogFile();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`,
      "utf8",
    );
  } catch (error) {
    console.error("Could not write Labatar startup diagnostic:", error);
  }
}

let rendererProfileWriteFailureReported = false;
function rendererProfileDiagnostic(event, details = {}) {
  if (!rendererProfilingEnabled) return;
  try {
    const logPath = path.join(app.getPath("userData"), "renderer-profile.jsonl");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    if (fs.existsSync(logPath) && fs.statSync(logPath).size >= 8 * 1024 * 1024) {
      const archivePath = logPath.replace(
        /\.jsonl$/,
        `-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
      );
      fs.renameSync(logPath, archivePath);
    }
    fs.appendFileSync(
      logPath,
      `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`,
      "utf8",
    );
    rendererProfileWriteFailureReported = false;
  } catch (error) {
    if (!rendererProfileWriteFailureReported) {
      console.warn("Could not write renderer profile:", error);
      rendererProfileWriteFailureReported = true;
    }
  }
}

function startupErrorDetails(error) {
  return {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : null,
  };
}

process.on("uncaughtException", (error) => {
  startupDiagnostic("uncaught-exception", startupErrorDetails(error));
});
process.on("unhandledRejection", (reason) => {
  startupDiagnostic("unhandled-rejection", startupErrorDetails(reason));
});
startupDiagnostic("main-module-loaded", {
  isDev: !app.isPackaged,
  electronVersion: process.versions.electron ?? null,
  chromeVersion: process.versions.chrome ?? null,
});

protocol.registerSchemesAsPrivileged([
  {
    scheme: "labatar-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
let updateCheckPromise = null;
let updateDownloadPromise = null;
let updateMenuItem = null;
let updateState = "idle";
let latestUpdateInfo = null;
let mainWindow = null;
let latestRendererSnapshot = null;
let latestRendererSnapshotAt = null;
ipcMain.on("diagnostics:renderer-profile", (event, snapshot) => {
  if (!rendererProfilingEnabled || event.sender !== mainWindow?.webContents) return;
  latestRendererSnapshot = normalizeRendererSnapshot(snapshot);
  latestRendererSnapshotAt = Date.now();
});
let captureShortcut = null;
let chapterShortcut = null;
let captureTogglePromise = null;
let captureState = {
  hotkey: "F9",
  hotkeyRegistered: false,
  lastAction: null,
  error: null,
  chapterHotkey: "F10",
  chapterHotkeyRegistered: false,
  chapterLastAddedAt: null,
  chapterError: null,
  autoGameChapters: false,
  autoClipManualChapters: true,
};
let armedMoveCapture = null;
let automaticMoveRun = null;
let automaticMoveInput = null;
let automaticMoveRunner = null;
let automaticMoveCountdown = null;
let blackoutBusy = false;
let blackoutRecoveryBusy = false;
let blackoutWatcherStarting = null;
let devCaptureTabActive = false;

const defaultReplaysFolder = path.join(
  "C:\\",
  "Program Files (x86)",
  "Steam",
  "steamapps",
  "common",
  "Avatar Legends The Fighting Game",
);
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
// Keep credentials outside the repository. Dev state is intentionally visible
// to local tooling; the OS-encrypted OBS password is not diagnostic state.
const obsPasswordFile = () =>
  isDev && developmentUserData
    ? developmentUserData.credentialPath
    : path.join(app.getPath("userData"), "obs-password.enc");
const recordingDiagnosticLogFile = () => path.join(app.getPath("userData"), "recording-debug.log");
const defaultObsProfileName = "Labatar Recording";
const labatarRecordingFrameRate = { numerator: 60, denominator: 1 };
const labatarSceneCollectionName = "Labatar";
const labatarSceneNames = {
  gameOnly: "Labatar - Game Only",
  gameDesktopMic: "Labatar - Game + Desktop + Mic",
  gameMic: "Labatar - Game + Mic",
};
const labatarGameCaptureWindow = "Avatar Legends#3A The Fighting Game:ABAREENGINE:Atla.exe";
const labatarGameAudioWindow = labatarGameCaptureWindow;
const recordingTagOptions = {
  match: new Set(["ranked", "casual"]),
  lab: new Set(["practice", "new-combos", "new-pressure"]),
};
const productionObsRecordDirectory = () =>
  path.join(app.getPath("videos"), "Labatar", "recordings");
const defaultObsRecordDirectory = () =>
  isDev ? path.resolve(__dirname, "..", ".dev", "recordings") : productionObsRecordDirectory();

function isDevelopmentObsRecordDirectory(directory) {
  const segments = path.resolve(directory).split(path.sep).filter(Boolean);
  return (
    segments.length >= 2 &&
    segments.at(-2).toLowerCase() === ".dev" &&
    segments.at(-1).toLowerCase() === "recordings"
  );
}

let obsClient = null;
let obsConnectionToken = 0;
let preparedObsProfile = null;
let activeObsRecording = null;
let lastFinalizedObsRecording = null;
let finalizingObsRecording = null;
let requestedObsStopReason = null;
let matchLogWatcher = null;
const opponentSetHistory = createOpponentSetHistory({
  cachePath: () => path.join(app.getPath("userData"), "opponent-set-history.json"),
  getLogsDirectory: findMatchLogDirectory,
});
let pendingAutoRecordings = [];
const replayAttachmentsInProgress = new Map();
const gameChapterJobs = new Set();
const manualChapterClipJobs = new Map();
const recordingWork = new Map();
function sendRecordingWork() {
  if (canSendToRenderer()) {
    mainWindow.webContents.send("recordings:work-state", [...recordingWork.values()]);
  }
}
function setRecordingWork(id, patch) {
  recordingWork.set(id, { ...recordingWork.get(id), id, ...patch });
  sendRecordingWork();
}
function clearRecordingWork(id) {
  if (recordingWork.delete(id)) sendRecordingWork();
}
const pendingReplayTimeoutMs = 120_000;
let recordingDiagnosticQueue = Promise.resolve();
let obsState = {
  status: "disconnected",
  host: "127.0.0.1",
  port: 4455,
  error: null,
  obsVersion: null,
  obsWebSocketVersion: null,
  currentProfileName: null,
  profiles: [],
  currentSceneCollectionName: null,
  currentSceneName: null,
  recordDirectory: null,
  videoSettings: null,
  automation: {
    enabled: false,
    status: "disabled",
    logPath: null,
    lobbyId: null,
    currentMatch: null,
    setNumber: 0,
    gameNumber: 0,
    lastReplayPath: null,
    pendingRecordings: 0,
    error: null,
  },
  recording: {
    active: false,
    paused: false,
    outputPath: null,
  },
};

function logRecordingDiagnostic(event, details = {}) {
  const entry = JSON.stringify({ at: new Date().toISOString(), event, ...details });
  recordingDiagnosticQueue = recordingDiagnosticQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(recordingDiagnosticLogFile()), { recursive: true });
        await fs.promises.appendFile(recordingDiagnosticLogFile(), `${entry}\n`, "utf8");
      } catch (error) {
        console.warn("Could not write recording diagnostic log:", obsErrorMessage(error));
      }
    });
}

function getObsSettings() {
  const saved = readSettings().obs ?? {};
  const savedRecordDirectory =
    typeof saved.recordDirectory === "string" && saved.recordDirectory.trim()
      ? saved.recordDirectory.trim()
      : null;
  const recordDirectory =
    isDev &&
    (!savedRecordDirectory ||
      path.resolve(savedRecordDirectory) === path.resolve(productionObsRecordDirectory()))
      ? defaultObsRecordDirectory()
      : !isDev && savedRecordDirectory && isDevelopmentObsRecordDirectory(savedRecordDirectory)
        ? productionObsRecordDirectory()
        : (savedRecordDirectory ?? defaultObsRecordDirectory());
  return {
    host: typeof saved.host === "string" && saved.host.trim() ? saved.host.trim() : "127.0.0.1",
    port: Number.isInteger(Number(saved.port)) ? Number(saved.port) : 4455,
    profileName:
      typeof saved.profileName === "string" && saved.profileName.trim()
        ? saved.profileName.trim()
        : defaultObsProfileName,
    recordDirectory,
  };
}

function readStoredObsPassword() {
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(obsPasswordFile())) return null;
    return safeStorage.decryptString(fs.readFileSync(obsPasswordFile()));
  } catch {
    return null;
  }
}

function hasStoredObsPassword() {
  return readStoredObsPassword() !== null;
}

function saveObsPassword(password) {
  if (!password) return clearStoredObsPassword();
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure password storage is unavailable on this system.");
  }
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(obsPasswordFile(), safeStorage.encryptString(password));
}

function clearStoredObsPassword() {
  fs.rmSync(obsPasswordFile(), { force: true });
}

function publicObsState() {
  return {
    ...obsState,
    recording: {
      ...obsState.recording,
      sessionId: activeObsRecording?.sessionId ?? null,
      source: activeObsRecording?.source ?? null,
      metadata: activeObsRecording?.metadata ?? null,
      startedAt: activeObsRecording?.startedAt ?? null,
    },
  };
}

function canSendToRenderer() {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed() &&
    !mainWindow.webContents.isCrashed(),
  );
}

function sendObsState() {
  if (!canSendToRenderer()) return;
  mainWindow.webContents.send("obs:state", publicObsState());
}

function setObsState(patch) {
  obsState = { ...obsState, ...patch };
  sendObsState();
}

function obsErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function getObsClient() {
  if (!obsClient) throw new Error("OBS is not connected.");
  return obsClient;
}

function invalidatePreparedObsProfile() {
  preparedObsProfile = null;
}

function getObsProfileTarget(request = {}) {
  const settings = getObsSettings();
  return {
    profileName: String(request.profileName ?? settings.profileName).trim() || settings.profileName,
    recordDirectory:
      String(request.recordDirectory ?? settings.recordDirectory).trim() ||
      settings.recordDirectory,
  };
}

function hasPreparedObsProfile(request = {}) {
  const target = getObsProfileTarget(request);
  return (
    preparedObsProfile?.client === obsClient &&
    preparedObsProfile?.connectionToken === obsConnectionToken &&
    preparedObsProfile.profileName === target.profileName &&
    preparedObsProfile.recordDirectory === target.recordDirectory
  );
}

function rememberPreparedObsProfile(target, result) {
  preparedObsProfile = {
    client: obsClient,
    connectionToken: obsConnectionToken,
    ...target,
    result,
  };
}

async function refreshObsState(client = getObsClient()) {
  const startedAt = Date.now();
  logRecordingDiagnostic("obs-refresh-start");
  try {
    const version = await client.call("GetVersion");
    const profiles = await client.call("GetProfileList");
    const sceneCollections = version.availableRequests?.includes("GetSceneCollectionList")
      ? await client.call("GetSceneCollectionList")
      : null;
    const currentScene = version.availableRequests?.includes("GetCurrentProgramScene")
      ? await client.call("GetCurrentProgramScene")
      : null;
    const videoSettings = version.availableRequests?.includes("GetVideoSettings")
      ? await client.call("GetVideoSettings")
      : null;
    const recordStatus = await client.call("GetRecordStatus");
    let recordDirectory = null;
    if (version.availableRequests?.includes("GetRecordDirectory")) {
      recordDirectory = (await client.call("GetRecordDirectory")).recordDirectory;
    }
    setObsState({
      status: "connected",
      error: null,
      obsVersion: version.obsVersion,
      obsWebSocketVersion: version.obsWebSocketVersion,
      currentProfileName: profiles.currentProfileName,
      profiles: profiles.profiles,
      currentSceneCollectionName: sceneCollections?.currentSceneCollectionName ?? null,
      currentSceneName: currentScene?.sceneName ?? currentScene?.currentProgramSceneName ?? null,
      recordDirectory,
      videoSettings: videoSettings
        ? {
            fpsNumerator: Number(videoSettings.fpsNumerator) || null,
            fpsDenominator: Number(videoSettings.fpsDenominator) || null,
            baseWidth: Number(videoSettings.baseWidth) || null,
            baseHeight: Number(videoSettings.baseHeight) || null,
            outputWidth: Number(videoSettings.outputWidth) || null,
            outputHeight: Number(videoSettings.outputHeight) || null,
          }
        : null,
      recording: {
        active: Boolean(recordStatus.outputActive),
        paused: recordStatus.outputState === "OBS_WEBSOCKET_OUTPUT_PAUSED",
        outputPath: recordStatus.outputPath ?? null,
      },
    });
    logRecordingDiagnostic("obs-refresh-complete", {
      durationMs: Date.now() - startedAt,
      recordingActive: Boolean(recordStatus.outputActive),
      profileName: profiles.currentProfileName,
    });
    return {
      version,
      profiles,
      sceneCollections,
      currentScene,
      videoSettings,
      recordStatus,
      recordDirectory,
    };
  } catch (error) {
    logRecordingDiagnostic("obs-refresh-failed", {
      durationMs: Date.now() - startedAt,
      error: obsErrorMessage(error),
    });
    throw error;
  }
}

function normalizeRecordingMetadata(value) {
  const metadata = value && typeof value === "object" ? value : {};
  const text = (key) => {
    const next = metadata[key];
    return typeof next === "string" ? next.trim().slice(0, 200) : "";
  };
  return {
    player: text("player"),
    opponent: text("opponent"),
    setLabel: text("setLabel"),
    gameNumber: text("gameNumber"),
    mode: text("mode"),
    notes: text("notes"),
    matchId: text("matchId"),
    lobbyId: text("lobbyId"),
    player1: text("player1"),
    player2: text("player2"),
    player1SteamId: text("player1SteamId"),
    player2SteamId: text("player2SteamId"),
    player1Character: text("player1Character"),
    player2Character: text("player2Character"),
    player1Rating: text("player1Rating"),
    player2Rating: text("player2Rating"),
  };
}

function normalizeRecordingTags(value, metadata = null) {
  const tags = { match: [], lab: [], combo: false, pressure: false };
  if (Array.isArray(value)) {
    for (const legacyTag of value) {
      const tag = String(legacyTag).trim().toLowerCase();
      if (tag === "match") {
        const mode = metadata?.mode;
        if (mode === "ranked" || mode === "casual") tags.match = [mode];
      } else if (tag === "combo" || tag === "pressure") {
        tags[tag] = true;
      }
    }
    return tags;
  }
  if (!value || typeof value !== "object") return tags;
  const legacyTech = Array.isArray(value.tech) ? value.tech : [];
  for (const category of ["match", "lab"]) {
    const allowed = recordingTagOptions[category];
    const subtags = Array.isArray(value[category]) ? value[category] : [];
    tags[category] = [
      ...new Set(
        subtags
          .map((subtag) => String(subtag).trim().toLowerCase())
          .filter((subtag) => allowed.has(subtag)),
      ),
    ];
  }
  tags.combo = value.combo === true || (Array.isArray(value.combo) && value.combo.length > 0);
  tags.pressure =
    value.pressure === true || (Array.isArray(value.pressure) && value.pressure.length > 0);
  if (legacyTech.includes("combo")) tags.combo = true;
  if (legacyTech.includes("pressure")) tags.pressure = true;
  tags.match = tags.match.slice(0, 1);
  return tags;
}

function recordingManifestPath(outputPath) {
  return path.join(path.dirname(outputPath), `${path.basename(outputPath)}.labatar.json`);
}

function safeRecordingNamePart(value, fallback) {
  const cleaned = String(value ?? "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .filter((character) => character.charCodeAt(0) >= 0x20)
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return cleaned || fallback;
}

function moveCatalogIdPart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function knownMoveCaptureVariants() {
  return Object.entries(supportMap)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([character, supports]) =>
      Object.entries(supports)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([supportId, support]) => ({
          id: `${moveCatalogIdPart(character)}-${moveCatalogIdPart(support)}`,
          label: `${character} / ${support}`,
          character,
          support,
          supportId,
        })),
    );
}

function publicArmedMoveCapture() {
  return armedMoveCapture
    ? { ...armedMoveCapture, expectedInputs: [...armedMoveCapture.expectedInputs] }
    : null;
}

function publicMoveCaptureState() {
  const active = activeObsRecording?.moveTake;
  return {
    armed: publicArmedMoveCapture(),
    active: active ? { ...active, expectedInputs: [...active.expectedInputs] } : null,
  };
}

function sendMoveCaptureState() {
  if (!canSendToRenderer()) return;
  mainWindow.webContents.send("move-capture:state", publicMoveCaptureState());
}

function armMoveCapture(request = {}) {
  if (activeObsRecording) throw new Error("Stop the active recording before arming a move take.");
  const characterId = String(request.characterId ?? "").trim();
  const moveId = String(request.moveId ?? "").trim();
  const moveInput = String(request.moveInput ?? "").trim();
  const isStance = request.isStance === true;
  const outcome = String(request.outcome ?? "").trim();
  if (!new Set(["whiff", "block", "hit-grounded", "hit-airborne"]).has(outcome)) {
    throw new Error("Select whiff, block, hit grounded, or hit airborne.");
  }
  const knownVariant = knownMoveCaptureVariants().find((variant) => variant.id === characterId);
  if (!knownVariant)
    throw new Error("The selected character or variant is not in Labatar's known data.");
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(moveId) || moveId.length > 100) {
    throw new Error("The selected Tech move has an invalid id.");
  }
  if (
    !/^(?:j\.)?(?:214|236|22|[1-9])?(?:\[(?:EX|SUP|A|B|C|F|X)\]|EX|SUP|A|B|C|F|X)$/i.test(moveInput)
  ) {
    throw new Error("The selected Tech move has an invalid input.");
  }
  if (!isStance && /^(?:\[(?:EX|SUP|A|B|C|F|X)\]|EX|SUP|A|B|C|F|X)$/i.test(moveInput)) {
    throw new Error("Only stance followups can use a directionless input.");
  }
  armedMoveCapture = {
    catalogMoveId: `${characterId}/${moveId}`,
    characterId,
    characterLabel: knownVariant.label,
    moveId,
    moveLabel: moveInput,
    expectedInputs: [moveInput],
    isStance,
    isCharged: request.isCharged === true,
    outcome,
    armedAt: new Date().toISOString(),
  };
  sendMoveCaptureState();
  return publicMoveCaptureState();
}

function disarmMoveCapture() {
  if (activeObsRecording?.moveTake) {
    throw new Error("The active move take remains associated with its recording.");
  }
  armedMoveCapture = null;
  sendMoveCaptureState();
  return publicMoveCaptureState();
}

const automaticMoveRunFile = () => path.join(app.getPath("userData"), "automatic-move-run.json");
let automaticMoveRunLoaded = false;

function loadAutomaticMoveRun() {
  if (automaticMoveRunLoaded) return automaticMoveRun;
  automaticMoveRunLoaded = true;
  try {
    const saved = JSON.parse(fs.readFileSync(automaticMoveRunFile(), "utf8"));
    if (
      !Array.isArray(saved.queue) ||
      !Array.isArray(saved.completed) ||
      typeof saved.runId !== "string" ||
      typeof saved.obsSetup?.recordDirectory !== "string"
    ) {
      return null;
    }
    automaticMoveRun = {
      ...saved,
      status: ["running", "countdown"].includes(saved.status) ? "paused" : saved.status,
      error: ["running", "countdown"].includes(saved.status)
        ? "Labatar restarted during the capture pass. Resume after checking the game and OBS."
        : (saved.error ?? null),
    };
  } catch {
    automaticMoveRun = null;
  }
  return automaticMoveRun;
}

function saveAutomaticMoveRun() {
  if (!automaticMoveRun) return;
  const target = automaticMoveRunFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(automaticMoveRun, null, 2), "utf8");
  const retryWait = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(temporary, target);
      return;
    } catch (error) {
      if (attempt >= 5 || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
      Atomics.wait(retryWait, 0, 0, 25 * 2 ** attempt);
    }
  }
}

function publicAutomaticMoveRun() {
  const run = loadAutomaticMoveRun();
  if (!run) {
    return { status: "idle", index: 0, total: 0, currentMove: null, phase: "", error: null };
  }
  return {
    status: run.status,
    index: run.index,
    total: run.queue.length,
    currentMove: run.queue[run.index]?.input ?? null,
    phase: run.phase ?? "",
    error: run.error ?? null,
    runId: run.runId,
  };
}

function automaticMoveRunIsOpen() {
  return ["running", "countdown", "paused"].includes(loadAutomaticMoveRun()?.status);
}

function publishAutomaticMoveRun(patch = {}) {
  const run = loadAutomaticMoveRun();
  if (!run) return publicAutomaticMoveRun();
  Object.assign(run, patch);
  saveAutomaticMoveRun();
  const state = publicAutomaticMoveRun();
  if (canSendToRenderer()) mainWindow.webContents.send("move-capture:automatic-state", state);
  return state;
}

async function getAutomaticMoveInput() {
  if (!automaticMoveInput) {
    automaticMoveInput = await createTrainingInputClient({ gameRoot: automaticMoveRun.gameRoot });
  }
  return automaticMoveInput;
}

async function closeAutomaticMoveInput() {
  const client = automaticMoveInput;
  automaticMoveInput = null;
  if (client) await client.close();
}

function validateAutomaticMoveQueue(request = {}) {
  const variantId = String(request.variantId ?? "");
  const variant = knownMoveCaptureVariants().find((entry) => entry.id === variantId);
  if (!variant) throw new Error("Select a known character and support before automatic capture.");
  const facing = request.facing === "Left" ? "Left" : "Right";
  if (!Array.isArray(request.moves) || request.moves.length < 1 || request.moves.length > 200) {
    throw new Error("The automatic capture queue must contain 1 to 200 moves.");
  }
  const seen = new Set();
  const queue = request.moves.map((move) => {
    const id = String(move?.id ?? "");
    const input = String(move?.input ?? "").toUpperCase();
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id) || seen.has(id)) {
      throw new Error("The automatic capture queue has an invalid or repeated move ID.");
    }
    if (!/^(?:236|214|[1-9])(?:EX|[ABCF])$/.test(input)) {
      throw new Error(`No supported grounded whiff recipe for ${input}.`);
    }
    seen.add(id);
    return { id, input };
  });
  return { variant, facing, queue };
}

async function reconcileAutomaticMoveRun() {
  const run = loadAutomaticMoveRun();
  if (run?.status !== "paused") return publicAutomaticMoveRun();
  const completedByMove = new Map();
  for (const filePath of await findRecordingFiles(run.obsSetup.recordDirectory)) {
    let manifest;
    try {
      manifest = JSON.parse(
        await fs.promises.readFile(recordingManifestPathForVideo(filePath), "utf8"),
      );
    } catch {
      continue;
    }
    const take = readMoveTake(manifest.moveTake);
    if (
      take?.captureRunId !== run.runId ||
      take.status !== "captured" ||
      take.storageError ||
      manifest.stopReason !== "automatic-move-capture" ||
      manifest.capture?.fpsNumerator !== 60 ||
      manifest.capture?.fpsDenominator !== 1
    ) {
      continue;
    }
    const previous = completedByMove.get(take.moveId);
    if (!previous || String(manifest.stoppedAt) > String(previous.stoppedAt)) {
      completedByMove.set(take.moveId, {
        moveId: take.moveId,
        outputPath: filePath,
        manifestPath: recordingManifestPathForVideo(filePath),
        stoppedAt: manifest.stoppedAt,
      });
    }
  }
  const completed = [];
  for (const item of run.queue) {
    const saved = completedByMove.get(item.id);
    if (!saved) break;
    completed.push({
      moveId: saved.moveId,
      outputPath: saved.outputPath,
      manifestPath: saved.manifestPath,
    });
  }
  if (completed.length !== run.index || completed.length !== run.completed.length) {
    // A recording may have finalized before a transient state-file write failed.
    // The paused runner still has its old index; rebuild it from the manifests.
    automaticMoveRunner = null;
    return publishAutomaticMoveRun({ index: completed.length, completed });
  }
  return publicAutomaticMoveRun();
}

function automaticMoveRunnerForCurrentRun() {
  if (automaticMoveRunner) return automaticMoveRunner;
  automaticMoveRunner = createAutomaticMoveRunner({
    reset: async () => {
      const client = await getAutomaticMoveInput();
      await client.send({ kind: "reset" });
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    move: async (item) => {
      const client = await getAutomaticMoveInput();
      await client.send({ kind: "move", notation: item.input, facing: automaticMoveRun.facing });
    },
    arm: async (item) => {
      armMoveCapture({
        characterId: automaticMoveRun.variantId,
        moveId: item.id,
        moveInput: item.input,
        isStance: false,
        isCharged: false,
        outcome: "whiff",
      });
      armedMoveCapture.captureMethod = "automated";
      armedMoveCapture.captureRunId = automaticMoveRun.runId;
      armedMoveCapture.captureRecipe = {
        notation: item.input,
        facing: automaticMoveRun.facing,
        reset: "Back/Select tap",
        neutralPreRollMs: 500,
        tailMs: 2000,
      };
      sendMoveCaptureState();
    },
    startRecord: async () => {
      await requireDevBlackoutCapture();
      return startObsRecording(null, automaticMoveRun.obsSetup, {
        manual: true,
        moveTake: publicArmedMoveCapture(),
        reusePreparedProfile: true,
      });
    },
    stopRecord: async ({ interrupted }) =>
      stopObsRecording(interrupted ? "automatic-move-interrupted" : "automatic-move-capture"),
    verifySaved: async ({ move: item, recording }) => {
      if (!recording?.outputPath || !recording?.manifestPath || recording.manifestError)
        return false;
      const stat = await fs.promises.stat(recording.outputPath).catch(() => null);
      if (!stat?.isFile() || stat.size === 0) return false;
      const manifest = JSON.parse(await fs.promises.readFile(recording.manifestPath, "utf8"));
      const take = readMoveTake(manifest.moveTake);
      return (
        take?.captureRunId === automaticMoveRun.runId &&
        take.moveId === item.id &&
        take.status === "captured" &&
        !take.storageError &&
        manifest.capture?.fpsNumerator === 60 &&
        manifest.capture?.fpsDenominator === 1
      );
    },
    persist: async ({ move: item, recording }) => {
      automaticMoveRun.completed.push({
        moveId: item.id,
        outputPath: recording.outputPath,
        manifestPath: recording.manifestPath,
      });
      saveAutomaticMoveRun();
    },
    onState: (state) => {
      publishAutomaticMoveRun({
        status: state.status === "complete" ? "completed" : state.status,
        index: state.index,
        phase: state.phase ?? "",
        error: state.error,
      });
      if (state.status === "complete" || state.status === "cancelled") {
        armedMoveCapture = null;
        sendMoveCaptureState();
        void closeAutomaticMoveInput().catch(() => undefined);
      }
    },
  });
  return automaticMoveRunner;
}

function launchAutomaticMoveRun(resume = false) {
  const run = loadAutomaticMoveRun();
  if (!run) throw new Error("There is no automatic capture run.");
  publishAutomaticMoveRun({ status: "countdown", phase: "focus-game", error: null });
  automaticMoveCountdown = setTimeout(() => {
    automaticMoveCountdown = null;
    if (automaticMoveRun?.status !== "countdown") return;
    const runner = automaticMoveRunnerForCurrentRun();
    const task =
      resume && runner.status().status === "paused"
        ? runner.resume()
        : runner.start(run.queue, { index: run.index });
    void task.catch((error) => {
      publishAutomaticMoveRun({ status: "paused", phase: "", error: obsErrorMessage(error) });
    });
  }, 5000);
  return publicAutomaticMoveRun();
}

async function startAutomaticMoveRun(request = {}) {
  await requireDevBlackoutCapture();
  const existing = loadAutomaticMoveRun();
  if (existing && ["running", "countdown", "paused"].includes(existing.status)) {
    throw new Error("Pause, resume, or cancel the existing capture pass first.");
  }
  if (obsState.status !== "connected" || obsState.recording.active || activeObsRecording) {
    throw new Error("Connect OBS and stop any active recording before starting the pass.");
  }
  const { variant, facing, queue } = validateAutomaticMoveQueue(request);
  const gameRoot = getReplayFolder();
  if (!gameRoot || !fs.existsSync(path.join(gameRoot, "data", "button_config.ini"))) {
    throw new Error("Select the game installation folder with Player 1 controls in Settings.");
  }
  const settings = getObsSettings();
  const queuedIds = new Set(queue.map((item) => item.id));
  for (const filePath of await findRecordingFiles(settings.recordDirectory)) {
    const manifestPath = recordingManifestPathForVideo(filePath);
    let take;
    try {
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
      take = readMoveTake(manifest.moveTake);
    } catch {
      continue;
    }
    if (
      take?.characterId === variant.id &&
      take.outcome === "whiff" &&
      queuedIds.has(take.moveId) &&
      ["active", "pending"].includes(take.evidenceStatus)
    ) {
      throw new Error(`A whiff take for ${take.moveLabel} already exists. Refresh the queue.`);
    }
  }
  const obsSetup = { profileName: settings.profileName, recordDirectory: settings.recordDirectory };
  await prepareObsProfile(obsSetup);
  if (obsState.videoSettings?.fpsNumerator !== 60 || obsState.videoSettings?.fpsDenominator !== 1) {
    throw new Error("The managed OBS profile must report 60 fps before move capture.");
  }
  automaticMoveRunner = null;
  automaticMoveRun = {
    runId: randomUUID(),
    variantId: variant.id,
    gameRoot,
    facing,
    queue,
    completed: [],
    index: 0,
    status: "countdown",
    phase: "focus-game",
    error: null,
    obsSetup,
  };
  saveAutomaticMoveRun();
  return launchAutomaticMoveRun();
}

async function pauseAutomaticMoveRun() {
  const run = loadAutomaticMoveRun();
  if (automaticMoveCountdown) {
    clearTimeout(automaticMoveCountdown);
    automaticMoveCountdown = null;
    return publishAutomaticMoveRun({ status: "paused", phase: "" });
  }
  if (automaticMoveRunner && run?.status === "running") await automaticMoveRunner.pause();
  return publicAutomaticMoveRun();
}

async function resumeAutomaticMoveRun() {
  await requireDevBlackoutCapture();
  await reconcileAutomaticMoveRun();
  const run = loadAutomaticMoveRun();
  if (run?.status !== "paused") throw new Error("There is no paused capture pass.");
  if (run.index >= run.queue.length) {
    return publishAutomaticMoveRun({ status: "completed", phase: "", error: null });
  }
  if (obsState.status !== "connected" || obsState.recording.active || activeObsRecording) {
    throw new Error("Connect OBS and stop any active recording before resuming.");
  }
  await prepareObsProfile(run.obsSetup);
  return launchAutomaticMoveRun(true);
}

async function cancelAutomaticMoveRun() {
  if (!automaticMoveRunIsOpen()) return publicAutomaticMoveRun();
  if (automaticMoveCountdown) {
    clearTimeout(automaticMoveCountdown);
    automaticMoveCountdown = null;
  }
  if (automaticMoveRunner && ["running", "paused"].includes(loadAutomaticMoveRun()?.status)) {
    await automaticMoveRunner.cancel();
  } else {
    publishAutomaticMoveRun({ status: "cancelled", phase: "", error: null });
  }
  armedMoveCapture = null;
  sendMoveCaptureState();
  await closeAutomaticMoveInput();
  return publicAutomaticMoveRun();
}

function createRecordingMoveTake(armed) {
  if (!armed) return null;
  return {
    ...armed,
    expectedInputs: [...armed.expectedInputs],
    id: randomUUID(),
    status: "recording",
    recordedAt: null,
    evidenceStatus: "pending",
    evidenceReason: null,
    reviewedAt: null,
    captureMethod: armed.captureMethod === "automated" ? "automated" : null,
    captureRunId: typeof armed.captureRunId === "string" ? armed.captureRunId : null,
    captureRecipe: armed.captureRecipe ?? null,
    captureReviewStatus: armed.captureMethod === "automated" ? "awaiting-video-review" : null,
    captureReviewReason: null,
    captureReviewedAt: null,
    validation: {
      status: "unprocessed",
      message: "Processing has not yet compared this take with its expected input.",
      expectedInputs: [...armed.expectedInputs],
      observedInputs: [],
      matchedAnalysisMoveId: null,
      processedAt: null,
    },
  };
}

function moveTakeDirectory(moveTake) {
  const recordDirectory = path.resolve(getObsSettings().recordDirectory);
  return path.join(
    recordDirectory,
    "moves",
    safeRecordingNamePart(moveTake.characterId, "unknown-character"),
    safeRecordingNamePart(moveTake.moveId, "unknown-move"),
    moveTake.isCharged ? "charged" : "standard",
    moveTake.outcome,
  );
}

async function moveRecordingToMoveTakeDirectory(outputPath, recording) {
  const directory = moveTakeDirectory(recording.moveTake);
  await fs.promises.mkdir(directory, { recursive: true });
  const extension = path.extname(outputPath) || ".mp4";
  const timestamp = new Date(recording.startedAt)
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/[:T]/g, "-");
  const targetPath = await availableRecordingPath(directory, `take-${timestamp}`, extension);
  await fs.promises.rename(outputPath, targetPath);
  return targetPath;
}

async function archiveEarlierPendingMoveTakes(currentPath, take) {
  const folder = path.resolve(getObsSettings().recordDirectory);
  const files = await findRecordingFiles(folder);
  for (const filePath of files) {
    if (path.resolve(filePath) === path.resolve(currentPath)) continue;
    const manifestPath = recordingManifestPathForVideo(filePath);
    let manifest;
    try {
      manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
    } catch {
      continue;
    }
    const oldTake = readMoveTake(manifest.moveTake);
    if (
      oldTake?.catalogMoveId !== take.catalogMoveId ||
      oldTake.outcome !== take.outcome ||
      oldTake.evidenceStatus !== "pending"
    )
      continue;
    manifest.moveTake.evidenceStatus = "archived";
    manifest.moveTake.evidenceReason = `Superseded by pending take ${take.id}.`;
    manifest.moveTake.reviewedAt = new Date().toISOString();
    if (manifest.moveTake.captureReviewStatus === "awaiting-video-review") {
      manifest.moveTake.captureReviewStatus = "rejected";
      manifest.moveTake.captureReviewReason = manifest.moveTake.evidenceReason;
      manifest.moveTake.captureReviewedAt = manifest.moveTake.reviewedAt;
    }
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }
}

function recordingScore(replay) {
  const score = replay?.roundScore;
  if (typeof score !== "string") return "Unknown";
  const match = score.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  return match ? `${match[1]}-${match[2]}` : safeRecordingNamePart(score, "Unknown");
}

function recordingBaseName(metadata, replay = null) {
  const player1 = safeRecordingNamePart(replay?.player1 || metadata?.player1, "Player 1");
  const player2 = safeRecordingNamePart(replay?.player2 || metadata?.player2, "Player 2");
  const setLabel = safeRecordingNamePart(metadata?.setLabel, "set 1");
  return `${player1} - ${player2} - ${setLabel} - ${recordingScore(replay)}`;
}

function recordingSetBaseName(metadata, replay = null) {
  const setLabel = safeRecordingNamePart(metadata?.setLabel, "set 1").replace(
    /^set\s+(\d+)$/i,
    "set$1",
  );
  if (!replay) {
    const player1 = safeRecordingNamePart(metadata?.player1, "Player 1");
    const player2 = safeRecordingNamePart(metadata?.player2, "Player 2");
    return `${player1} - ${player2} - ${setLabel}`;
  }
  const playerName = (number) => {
    const name = safeRecordingNamePart(replay[`player${number}`], `Player ${number}`);
    const character = safeRecordingNamePart(
      replay[`player${number}Character`],
      metadata?.[`player${number}`] || "Unknown",
    );
    const support = safeRecordingNamePart(replay[`player${number}Support`], "None");
    return `${name} (${character}-${support})`;
  };
  return `${playerName(1)} - ${playerName(2)} - ${setLabel}`;
}

function manualRecordingBaseName(startedAt) {
  const timestamp = new Date(startedAt)
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/[:T]/g, "-");
  return `recording-${safeRecordingNamePart(timestamp, "unknown-time")}`;
}

async function recordingPathWithAvailableName(
  outputPath,
  metadata,
  replay = null,
  baseName = null,
) {
  const extension = path.extname(outputPath) || ".mp4";
  const directory = path.dirname(outputPath);
  const requestedBaseName = baseName ?? recordingBaseName(metadata, replay);
  let candidate = path.join(directory, `${requestedBaseName}${extension}`);
  let suffix = 2;
  while (path.resolve(candidate).toLowerCase() !== path.resolve(outputPath).toLowerCase()) {
    try {
      await fs.promises.access(candidate);
      candidate = path.join(directory, `${requestedBaseName} (${suffix})${extension}`);
      suffix += 1;
    } catch {
      break;
    }
  }
  return candidate;
}

async function renameObsRecordingFile(outputPath, metadata, replay = null, baseName = null) {
  if (!outputPath) return outputPath;
  const targetPath = await recordingPathWithAvailableName(outputPath, metadata, replay, baseName);
  if (path.resolve(targetPath).toLowerCase() === path.resolve(outputPath).toLowerCase()) {
    return outputPath;
  }
  try {
    await fs.promises.rename(outputPath, targetPath);
    return targetPath;
  } catch {
    return outputPath;
  }
}

function finalizeObsRecording(outputPath, reason) {
  if (!activeObsRecording) {
    return finalizingObsRecording ?? Promise.resolve(lastFinalizedObsRecording);
  }
  const pending = finalizeObsRecordingOnce(outputPath, reason);
  finalizingObsRecording = pending;
  void pending.then(
    () => {
      if (finalizingObsRecording === pending) finalizingObsRecording = null;
      if (!requestedObsStopReason) clearRecordingWork("obs-save");
    },
    () => {
      if (finalizingObsRecording === pending) finalizingObsRecording = null;
      if (!requestedObsStopReason) clearRecordingWork("obs-save");
    },
  );
  return pending;
}

async function finalizeObsRecordingOnce(outputPath, reason) {
  const recording = activeObsRecording;
  activeObsRecording = null;
  const noGameStartedName = noGameStartedRecordingBaseName(recording);
  setRecordingWork("obs-save", {
    title: "Saving recording",
    fileName: path.basename(outputPath || recording.outputPath || "OBS recording"),
    detail: "Naming the MP4 and saving its metadata",
  });
  if (recording.source === "automatic") {
    let setNumber = null;
    if (recording.lobbyId && !noGameStartedName) {
      try {
        setNumber = await opponentSetHistory.setNumberForLobby(recording.lobbyId);
      } catch (error) {
        logRecordingDiagnostic("opponent-set-history-failed", {
          lobbyId: recording.lobbyId,
          error: obsErrorMessage(error),
        });
      }
      if (!setNumber) {
        logRecordingDiagnostic("opponent-set-number-unavailable", { lobbyId: recording.lobbyId });
      }
    }
    const setLabel = noGameStartedName
      ? "no game started"
      : recording.fallbackMatchId
        ? "match"
        : setNumber
          ? `set ${setNumber}`
          : "set unknown";
    recording.metadata = { ...recording.metadata, setLabel };
    for (const game of recording.games ?? []) {
      if (setNumber) game.setNumber = setNumber;
      else if (recording.fallbackMatchId) game.setNumber = null;
      game.metadata = { ...game.metadata, setLabel };
    }
  }
  if (noGameStartedName) {
    logRecordingDiagnostic("automatic-no-game-recording", {
      sessionId: recording.sessionId,
      lobbyId: recording.lobbyId,
      reason,
    });
  }
  let manifestPath = null;
  let manifestError = null;
  if (outputPath) {
    let namedOutputPath = await renameObsRecordingFile(
      outputPath,
      recording.metadata,
      null,
      recording.source === "automatic"
        ? (noGameStartedName ?? recordingSetBaseName(recording.metadata))
        : recording.fileNameBase,
    );
    if (recording.moveTake) {
      try {
        namedOutputPath = await moveRecordingToMoveTakeDirectory(namedOutputPath, recording);
        recording.moveTake.status = "captured";
        recording.moveTake.recordedAt = new Date().toISOString();
        recording.moveTake.storageError = null;
      } catch (error) {
        recording.moveTake.status = "captured";
        recording.moveTake.recordedAt = new Date().toISOString();
        recording.moveTake.storageError = obsErrorMessage(error);
        logRecordingDiagnostic("move-take-file-move-failed", {
          sessionId: recording.sessionId,
          error: recording.moveTake.storageError,
          outputPath: namedOutputPath,
        });
      }
    }
    recording.outputPath = namedOutputPath;
    manifestPath = recordingManifestPath(namedOutputPath);
    const captureSettings = recording.videoSettings ?? obsState.videoSettings;
    const capture = captureSettings
      ? {
          fpsNumerator: Number(captureSettings.fpsNumerator) || null,
          fpsDenominator: Number(captureSettings.fpsDenominator) || null,
          sourceWidth: Number(captureSettings.baseWidth) || null,
          sourceHeight: Number(captureSettings.baseHeight) || null,
          outputWidth: Number(captureSettings.outputWidth) || null,
          outputHeight: Number(captureSettings.outputHeight) || null,
          outputNormalized:
            Number(captureSettings.baseWidth) !== Number(captureSettings.outputWidth) ||
            Number(captureSettings.baseHeight) !== Number(captureSettings.outputHeight),
          normalization:
            Number(captureSettings.baseWidth) !== Number(captureSettings.outputWidth) ||
            Number(captureSettings.baseHeight) !== Number(captureSettings.outputHeight)
              ? "even-output-dimensions"
              : null,
        }
      : null;
    try {
      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            sessionId: recording.sessionId,
            startedAt: recording.startedAt,
            stoppedAt: new Date().toISOString(),
            stopReason: reason,
            recordingStatus: noGameStartedName ? "no-game-started" : null,
            outputPath: namedOutputPath,
            source: recording.source,
            tags: recording.tags ?? { match: [], lab: [], combo: false, pressure: false },
            metadata: recording.metadata,
            games: recording.games ?? [],
            replays: recording.replays ?? [],
            capture,
            moveTake: recording.moveTake ?? null,
            obs: {
              version: obsState.obsVersion,
              webSocketVersion: obsState.obsWebSocketVersion,
              profileName: obsState.currentProfileName,
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      recording.manifestPath = manifestPath;
      for (const replay of recording.replays ?? []) {
        await attachReplayToRecording(recording, replay.replayPath, replay.matchId);
      }
      namedOutputPath = recording.outputPath;
      manifestPath = recording.manifestPath;
      if (recording.moveTake) {
        await archiveEarlierPendingMoveTakes(namedOutputPath, recording.moveTake);
      }
    } catch (error) {
      manifestError = obsErrorMessage(error);
    }
  }
  lastFinalizedObsRecording = {
    outputPath: recording.outputPath ?? outputPath ?? null,
    manifestPath,
    manifestError,
  };
  setRecordingWork("obs-save", {
    fileName: path.basename(lastFinalizedObsRecording.outputPath || "OBS recording"),
    detail: manifestError
      ? `Metadata could not be saved: ${manifestError}`
      : "Finalizing recording",
  });
  if (recording.outputPath && path.extname(recording.outputPath).toLowerCase() === ".mp4") {
    queueFinalizedChapterJobs(recording);
  }
  sendMoveCaptureState();
  return lastFinalizedObsRecording;
}

async function attachReplayToRecording(recording, replayPath, matchId = null) {
  if (!recording?.manifestPath) return;
  let renamedOutputPath = null;
  let renamedManifestPath = null;
  let temporaryManifestPath = null;
  const originalOutputPath = recording.outputPath;
  const originalManifestPath = recording.manifestPath;
  try {
    const manifest = JSON.parse(await fs.promises.readFile(recording.manifestPath, "utf8"));
    const replay = await parseReplayFile(replayPath, path.dirname(replayPath));
    const previousManifestPath = recording.manifestPath;
    const games = Array.isArray(manifest.games) ? manifest.games : [];
    const game = matchId ? games.find((candidate) => candidate.matchId === matchId) : null;
    if (
      recording.source === "automatic" &&
      (!game || !replayMatchesGame(game, replay, formatCharacter))
    ) {
      throw new Error("Replay characters do not match the recorded game; no replay was attached.");
    }
    const firstGameMatchId = manifest.games?.[0]?.matchId;
    const namesFirstGame =
      recording.source === "automatic" && firstGameMatchId && firstGameMatchId === matchId;
    const namedOutputPath = recording.outputPath
      ? namesFirstGame
        ? await renameObsRecordingFile(
            recording.outputPath,
            manifest.metadata,
            replay,
            recordingSetBaseName(manifest.metadata, replay),
          )
        : recording.outputPath
      : recording.outputPath;
    const namedManifestPath = namedOutputPath
      ? recordingManifestPath(namedOutputPath)
      : previousManifestPath;
    if (namedOutputPath !== originalOutputPath) renamedOutputPath = namedOutputPath;
    if (namedManifestPath !== previousManifestPath) {
      if (
        await fs.promises.access(namedManifestPath).then(
          () => true,
          () => false,
        )
      ) {
        throw new Error("The target recording metadata path already exists.");
      }
      await fs.promises.rename(previousManifestPath, namedManifestPath);
      renamedManifestPath = namedManifestPath;
    }
    const replayEntry = {
      matchId: matchId ?? null,
      replayPath,
      replayFileName: path.basename(replayPath),
      replay,
    };
    if (game) {
      game.replayPath = replayPath;
      game.replayFileName = path.basename(replayPath);
      game.replay = replay;
    }
    const replays = Array.isArray(manifest.replays) ? manifest.replays : [];
    manifest.games = games;
    manifest.replays = [
      ...replays.filter((candidate) => candidate.matchId !== replayEntry.matchId),
      replayEntry,
    ];
    manifest.replayPath = replayPath;
    manifest.replayFileName = path.basename(replayPath);
    manifest.outputPath = namedOutputPath;
    manifest.replay = replay;
    temporaryManifestPath = `${namedManifestPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(temporaryManifestPath, JSON.stringify(manifest, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.promises.rename(temporaryManifestPath, namedManifestPath);
    temporaryManifestPath = null;
    recording.outputPath = namedOutputPath;
    recording.manifestPath = namedManifestPath;
  } catch (error) {
    if (temporaryManifestPath) {
      await fs.promises.unlink(temporaryManifestPath).catch(() => undefined);
    }
    if (renamedManifestPath) {
      await fs.promises.rename(renamedManifestPath, originalManifestPath).catch((rollbackError) => {
        logRecordingDiagnostic("replay-attach-rollback-failed", {
          path: renamedManifestPath,
          error: obsErrorMessage(rollbackError),
        });
      });
    }
    if (renamedOutputPath) {
      await fs.promises.rename(renamedOutputPath, originalOutputPath).catch((rollbackError) => {
        logRecordingDiagnostic("replay-attach-rollback-failed", {
          path: renamedOutputPath,
          error: obsErrorMessage(rollbackError),
        });
      });
    }
    logRecordingDiagnostic("replay-attach-failed", {
      replayPath,
      matchId,
      error: obsErrorMessage(error),
    });
    throw error;
  }
}

function findMatchLogDirectory() {
  const savedFolder = readSettings().replaysFolder;
  const candidates = new Set();
  if (savedFolder) {
    const folderName = path.basename(savedFolder).toLowerCase();
    candidates.add(folderName === "logs" ? savedFolder : path.join(savedFolder, "logs"));
    candidates.add(path.join(path.dirname(savedFolder), "logs"));
    candidates.add(path.join(savedFolder, "..", "logs"));
  }
  candidates.add(path.join(defaultReplaysFolder, "logs"));
  return [...candidates]
    .map((candidate) => path.resolve(candidate))
    .find((candidate) => {
      try {
        return fs.statSync(candidate).isDirectory();
      } catch {
        return false;
      }
    });
}

function setMatchAutomationState(nextState) {
  setObsState({
    automation: {
      ...obsState.automation,
      ...nextState,
      pendingRecordings: pendingAutoRecordings.length,
    },
  });
}

function matchToRecordingMetadata(match, setNumber, gameNumber) {
  const player1Rating = match.player1?.glicko?.rating;
  const player2Rating = match.player2?.glicko?.rating;
  const numericSetNumber = Number.parseInt(String(setNumber), 10);
  const numericGameNumber = Number.parseInt(String(gameNumber), 10);
  const normalizedSetNumber =
    Number.isFinite(numericSetNumber) && numericSetNumber > 0 ? numericSetNumber : 1;
  const normalizedGameNumber =
    Number.isFinite(numericGameNumber) && numericGameNumber > 0 ? numericGameNumber : 1;
  return normalizeRecordingMetadata({
    player: "Player 1",
    opponent: "Player 2",
    setLabel: `set ${normalizedSetNumber}`,
    gameNumber: String(normalizedGameNumber),
    mode: match.mode ?? "",
    notes: [match.notes?.player1, match.notes?.player2].filter(Boolean).join(" / "),
    matchId: match.matchId,
    lobbyId: match.lobbyId ?? "",
    player1: match.player1?.character ?? "",
    player2: match.player2?.character ?? "",
    player1SteamId: match.player1?.steamId ?? "",
    player2SteamId: match.player2?.steamId ?? "",
    player1Character: match.player1?.character ?? "",
    player2Character: match.player2?.character ?? "",
    player1Rating: player1Rating == null ? "" : String(player1Rating),
    player2Rating: player2Rating == null ? "" : String(player2Rating),
  });
}

function lobbyToRecordingMetadata(lobbyId, setNumber) {
  return normalizeRecordingMetadata({
    player: "Player 1",
    opponent: "Player 2",
    setLabel: `set ${setNumber > 0 ? setNumber : 1}`,
    gameNumber: "",
    mode: "",
    notes: "",
    matchId: "",
    lobbyId: lobbyId ?? "",
    player1: "",
    player2: "",
    player1SteamId: "",
    player2SteamId: "",
    player1Character: "",
    player2Character: "",
    player1Rating: "",
    player2Rating: "",
  });
}

function automaticGameRecord(match) {
  const setNumber = matchLogWatcher?.setNumber ?? 0;
  const gameNumber = matchLogWatcher?.gameNumber ?? 0;
  return {
    matchId: match.matchId,
    lobbyId: match.lobbyId ?? "",
    setNumber,
    gameNumber,
    logTime: match.logTime,
    detectedAt: match.startedAt,
    endedAt: null,
    endReason: null,
    metadata: matchToRecordingMetadata(match, setNumber, gameNumber),
    replayPath: null,
    replayFileName: null,
  };
}

function recordAutomaticMatchStart(match) {
  const recording = activeObsRecording;
  if (!recordingMatchesAutomaticGame(recording, match)) return null;
  const existing = recording.games.find((game) => game.matchId === match.matchId);
  if (existing) return existing;
  const game = automaticGameRecord(match);
  if (recording.fallbackMatchId) {
    game.setNumber = null;
    game.metadata = { ...game.metadata, setLabel: "match" };
  }
  recording.games.push(game);
  if (!recording.metadata?.matchId) {
    recording.metadata = game.metadata;
  }
  recording.tags = {
    ...recording.tags,
    match:
      game.metadata.mode === "ranked" || game.metadata.mode === "casual"
        ? [game.metadata.mode]
        : [],
  };
  setObsState({ recording: { ...obsState.recording, active: true } });
  return game;
}

function recordAutomaticMatchEnd(match, reason) {
  const recording = activeObsRecording;
  const game = recording?.games.find((candidate) => candidate.matchId === match.matchId);
  if (!game) return;
  game.endedAt = new Date().toISOString();
  game.endReason = reason;
}

async function startObsRecording(metadata, setup = {}, options = {}) {
  const client = getObsClient();
  const reusePreparedProfile = options.reusePreparedProfile === true;
  const source = options.manual ? "manual" : "automatic";
  const startedAtMs = Date.now();
  logRecordingDiagnostic("recording-start-request", {
    source,
    matchId: metadata?.matchId ?? null,
    reusePreparedProfile,
  });
  if (reusePreparedProfile) {
    if (!hasPreparedObsProfile(setup)) {
      const preparationStartedAt = Date.now();
      logRecordingDiagnostic("obs-profile-preparation-needed", { source });
      await prepareObsProfile(setup);
      logRecordingDiagnostic("obs-profile-preparation-complete", {
        source,
        durationMs: Date.now() - preparationStartedAt,
      });
    }
    if (obsState.recording.active) throw new Error("OBS is already recording.");
  } else {
    const current = await refreshObsState(client);
    if (current.recordStatus.outputActive) throw new Error("OBS is already recording.");
    const preparationStartedAt = Date.now();
    await prepareObsProfile(setup);
    logRecordingDiagnostic("obs-profile-preparation-complete", {
      source,
      durationMs: Date.now() - preparationStartedAt,
    });
  }
  const normalizedMetadata = metadata ? normalizeRecordingMetadata(metadata) : null;
  const tags = normalizeRecordingTags(options.tags);
  const startedAt = new Date().toISOString();
  const sessionId = `${options.manual ? "manual" : "set"}-${Date.now()}`;
  const moveTake = options.moveTake ? createRecordingMoveTake(options.moveTake) : null;
  lastFinalizedObsRecording = null;
  activeObsRecording = {
    sessionId,
    startedAt,
    source: options.manual ? "manual" : "automatic",
    metadata: normalizedMetadata,
    tags,
    fileNameBase: options.manual ? manualRecordingBaseName(startedAt) : null,
    games: [],
    replays: [],
    lobbyId: normalizedMetadata?.lobbyId || null,
    fallbackMatchId: options.fallbackMatchId ?? null,
    videoSettings: obsState.videoSettings ? { ...obsState.videoSettings } : null,
    moveTake,
  };
  sendMoveCaptureState();
  try {
    logRecordingDiagnostic("obs-start-record-request", {
      source,
      matchId: metadata?.matchId ?? null,
      preparationDurationMs: Date.now() - startedAtMs,
    });
    await client.call("StartRecord");
    logRecordingDiagnostic("obs-start-record-complete", {
      source,
      matchId: metadata?.matchId ?? null,
      durationMs: Date.now() - startedAtMs,
    });
  } catch (error) {
    if (reusePreparedProfile) invalidatePreparedObsProfile();
    let recoveryError = null;
    try {
      const status = await client.call("GetRecordStatus");
      if (status.outputActive) {
        await stopObsRecording("start-acknowledgment-failed");
      } else {
        activeObsRecording = null;
        sendMoveCaptureState();
      }
    } catch (statusOrStopError) {
      recoveryError = statusOrStopError;
      // Keep the take context so a later OBS stop can still finalize its manifest.
    }
    logRecordingDiagnostic("obs-start-record-failed", {
      source,
      matchId: metadata?.matchId ?? null,
      durationMs: Date.now() - startedAtMs,
      error: obsErrorMessage(error),
      recoveryError: recoveryError ? obsErrorMessage(recoveryError) : null,
    });
    if (recoveryError) {
      throw new AggregateError(
        [error, recoveryError],
        `OBS start failed and recording status could not be recovered: ${obsErrorMessage(recoveryError)}`,
      );
    }
    throw error;
  }
  setObsState({
    status: "connected",
    recording: { active: true, paused: false, outputPath: null },
  });
  return { sessionId, startedAt, metadata: normalizedMetadata, moveTake };
}

async function startManualObsRecording(setup = {}) {
  if (automaticMoveRunIsOpen()) {
    throw new Error("Finish or cancel the automatic move capture pass first.");
  }
  if (publicArmedMoveCapture() || devCaptureTabActive) await requireDevBlackoutCapture();
  return startObsRecording(null, setup, { manual: true, moveTake: publicArmedMoveCapture() });
}

async function waitForObsRecordingState(client, expectedActive, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const recordStatus = await client.call("GetRecordStatus");
    if (Boolean(recordStatus.outputActive) === expectedActive) return recordStatus;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    expectedActive
      ? "OBS did not start recording within the expected time."
      : "OBS did not finish stopping the recording within the expected time.",
  );
}

async function stopObsRecording(reason = "labatar") {
  const client = getObsClient();
  const startedAt = Date.now();
  logRecordingDiagnostic("recording-stop-request", {
    reason,
    matchId: activeObsRecording?.metadata?.matchId ?? null,
    sessionId: activeObsRecording?.sessionId ?? null,
  });
  const current = await refreshObsState(client);
  if (!current.recordStatus.outputActive) {
    logRecordingDiagnostic("recording-stop-skipped", {
      reason,
      durationMs: Date.now() - startedAt,
      error: "OBS is not recording.",
    });
    throw new Error("OBS is not recording.");
  }
  lastFinalizedObsRecording = null;
  setRecordingWork("obs-save", {
    title: "Saving recording",
    fileName: path.basename(
      activeObsRecording?.outputPath || current.recordStatus.outputPath || "OBS recording",
    ),
    detail: "Waiting for OBS to finish the MP4",
  });
  logRecordingDiagnostic("obs-stop-record-request", {
    reason,
    durationMs: Date.now() - startedAt,
  });
  requestedObsStopReason = reason;
  try {
    const result = await client.call("StopRecord");
    const stopped = await waitForObsRecordingState(client, false);
    const finalized = await finalizeObsRecording(
      result.outputPath ?? stopped.outputPath ?? null,
      reason,
    );
    setObsState({
      status: "connected",
      recording: { active: false, paused: false, outputPath: result.outputPath ?? null },
    });
    logRecordingDiagnostic("obs-stop-record-complete", {
      reason,
      durationMs: Date.now() - startedAt,
      outputPath: finalized?.outputPath ?? result.outputPath ?? stopped.outputPath ?? null,
    });
    return finalized;
  } finally {
    requestedObsStopReason = null;
    // OBS can report STOPPED before StopRecord resolves; keep the indicator until both finish.
    if (finalizingObsRecording) {
      void finalizingObsRecording
        .finally(() => clearRecordingWork("obs-save"))
        .catch(() => undefined);
    } else {
      clearRecordingWork("obs-save");
    }
  }
}

async function handleAutomaticLobbyStarted({ lobbyId, recovered = false } = {}) {
  if (!obsState.automation.enabled || !lobbyId) return false;
  logRecordingDiagnostic("automatic-lobby-start-handler", { lobbyId, recovered });
  if (obsState.status !== "connected") {
    setMatchAutomationState({
      status: "waiting-for-obs",
      error: "Connect OBS before the next lobby starts.",
    });
    return false;
  }
  if (activeObsRecording?.source === "automatic" && activeObsRecording.lobbyId === lobbyId) {
    return true;
  }
  if (
    activeObsRecording?.source === "automatic" &&
    activeObsRecording.fallbackMatchId &&
    matchLogWatcher?.currentMatch?.matchId === activeObsRecording.fallbackMatchId
  ) {
    const recording = activeObsRecording;
    recording.lobbyId = lobbyId;
    recording.fallbackMatchId = null;
    recording.metadata = { ...recording.metadata, lobbyId };
    matchLogWatcher.currentMatch.lobbyId = lobbyId;
    for (const game of recording.games) {
      game.lobbyId = lobbyId;
      game.metadata = { ...game.metadata, lobbyId };
    }
    return true;
  }
  if (activeObsRecording) {
    try {
      await stopObsRecording("lobby-changed");
    } catch (error) {
      setMatchAutomationState({ status: "error", error: obsErrorMessage(error) });
      return false;
    }
  }
  try {
    const setNumber = matchLogWatcher?.setNumber ?? 0;
    await startObsRecording(
      lobbyToRecordingMetadata(lobbyId, setNumber),
      {},
      {
        reusePreparedProfile: true,
        tags: { match: [], lab: [], combo: false, pressure: false },
      },
    );
    setMatchAutomationState({
      status: recovered ? "in-set-recovered" : "in-set",
      error: null,
    });
    return true;
  } catch (error) {
    invalidatePreparedObsProfile();
    setMatchAutomationState({ status: "error", error: obsErrorMessage(error) });
    return false;
  }
}

async function handleAutomaticMatchStarted(match, { recovered = false } = {}) {
  if (!obsState.automation.enabled) return false;
  logRecordingDiagnostic("automatic-match-start-handler", {
    matchId: match.matchId,
    logTime: match.logTime,
    lobbyId: match.lobbyId,
    recovered,
  });
  if (!activeObsRecording && match.lobbyId) {
    const started = await handleAutomaticLobbyStarted({ lobbyId: match.lobbyId, recovered });
    if (!started) return false;
  } else if (!activeObsRecording && canRecordLobbylessMatch(match)) {
    if (obsState.status !== "connected") {
      setMatchAutomationState({
        status: "waiting-for-obs",
        currentMatch: match,
        error: "Connect OBS to record this match.",
      });
      return false;
    }
    try {
      await startObsRecording(
        { ...matchToRecordingMetadata(match, null, 1), setLabel: "match" },
        {},
        {
          reusePreparedProfile: true,
          fallbackMatchId: match.matchId,
          tags: { match: [], lab: [], combo: false, pressure: false },
        },
      );
    } catch (error) {
      invalidatePreparedObsProfile();
      setMatchAutomationState({
        status: "error",
        currentMatch: match,
        error: obsErrorMessage(error),
      });
      return false;
    }
  }
  if (!recordAutomaticMatchStart(match)) {
    setMatchAutomationState({
      status: "error",
      currentMatch: match,
      error: "The detected match cannot be linked to the active recording.",
    });
    return false;
  }
  setMatchAutomationState({
    status: recovered ? "in-set-recovered" : "in-set",
    currentMatch: match,
    error: null,
  });
  return true;
}

async function handleAutomaticMatchEnded(match, reason) {
  if (!obsState.automation.enabled) return;
  logRecordingDiagnostic("automatic-match-end-handler", {
    matchId: match.matchId,
    logTime: match.logTime,
    lobbyId: match.lobbyId,
    reason,
  });
  recordAutomaticMatchEnd(match, reason);
  if (recordingMatchesAutomaticGame(activeObsRecording, match)) {
    const pending = { match, recording: activeObsRecording, timeout: null };
    pending.timeout = setTimeout(() => {
      const index = pendingAutoRecordings.indexOf(pending);
      if (index < 0) return;
      pendingAutoRecordings.splice(index, 1);
      logRecordingDiagnostic("automatic-replay-timeout", { matchId: match.matchId, reason });
      if (!pendingAutoRecordings.length && obsState.automation.status === "waiting-for-replay") {
        setMatchAutomationState({ status: "watching" });
      } else {
        setMatchAutomationState({});
      }
    }, pendingReplayTimeoutMs);
    pendingAutoRecordings.push(pending);
    if (activeObsRecording.fallbackMatchId) {
      try {
        await stopObsRecording(`match-${reason}-no-lobby`);
        setMatchAutomationState({ status: "waiting-for-replay", currentMatch: null, error: null });
      } catch (error) {
        setMatchAutomationState({
          status: "error",
          currentMatch: null,
          error: obsErrorMessage(error),
        });
      }
    } else {
      setMatchAutomationState({ status: "in-set", currentMatch: null, error: null });
    }
  } else {
    setMatchAutomationState({ status: "watching", currentMatch: null, error: null });
  }
}

async function handleAutomaticLobbyEnded({ lobbyId, reason, currentMatch } = {}) {
  if (!obsState.automation.enabled || !lobbyId) return;
  logRecordingDiagnostic("automatic-lobby-end-handler", { lobbyId, reason });
  if (activeObsRecording?.source !== "automatic" || activeObsRecording.lobbyId !== lobbyId) {
    return;
  }
  if (currentMatch) recordAutomaticMatchEnd(currentMatch, `lobby-${reason ?? "ended"}`);
  try {
    await stopObsRecording(`lobby-${reason ?? "ended"}`);
    setMatchAutomationState({
      status: pendingAutoRecordings.length ? "waiting-for-replay" : "watching",
      currentMatch: null,
      error: null,
    });
  } catch (error) {
    setMatchAutomationState({ status: "error", currentMatch: null, error: obsErrorMessage(error) });
  }
}

async function handleAutomaticReplaySaved(replayPath, matchId) {
  logRecordingDiagnostic("automatic-replay-saved", {
    replayPath,
    matchId,
    pendingCount: pendingAutoRecordings.length,
  });
  const pending = takePendingReplayMatch(pendingAutoRecordings, matchId);
  if (pending) {
    clearTimeout(pending.timeout);
    const recording = pending.recording;
    replayAttachmentsInProgress.set(
      recording,
      (replayAttachmentsInProgress.get(recording) ?? 0) + 1,
    );
    try {
      const game = recording.games?.find(
        (candidate) => candidate.matchId === pending.match.matchId,
      );
      let replay;
      try {
        replay = await parseReplayFile(replayPath, path.dirname(replayPath));
      } catch (error) {
        logRecordingDiagnostic("automatic-replay-parse-failed", {
          replayPath,
          error: obsErrorMessage(error),
        });
        setMatchAutomationState({
          status: "error",
          error: `Could not read the saved replay: ${obsErrorMessage(error)}`,
        });
        return;
      }
      if (!replayMatchesGame(game, replay, formatCharacter)) {
        logRecordingDiagnostic("automatic-replay-mismatch", { replayPath, matchId });
        setMatchAutomationState({
          status: "error",
          error: "A replay did not match the recorded game's characters and was left unlinked.",
        });
        return;
      }
      if (game) {
        game.replayPath = replayPath;
        game.replayFileName = path.basename(replayPath);
      }
      recording.replays ??= [];
      recording.replays.push({
        matchId: pending.match.matchId,
        replayPath,
        replayFileName: path.basename(replayPath),
      });
      if (recording.manifestPath) {
        try {
          await attachReplayToRecording(recording, replayPath, pending.match.matchId);
        } catch (error) {
          setMatchAutomationState({
            status: "error",
            error: `Could not save the replay link: ${obsErrorMessage(error)}`,
          });
          return;
        }
      }
    } finally {
      const remaining = (replayAttachmentsInProgress.get(recording) ?? 1) - 1;
      if (remaining) replayAttachmentsInProgress.set(recording, remaining);
      else replayAttachmentsInProgress.delete(recording);
    }
  } else {
    logRecordingDiagnostic("automatic-replay-unmatched", { replayPath, matchId });
  }
  setMatchAutomationState({
    status: pending
      ? pendingAutoRecordings.length
        ? "waiting-for-replay"
        : activeObsRecording?.source === "automatic"
          ? "in-set"
          : "watching"
      : obsState.automation.status,
    lastReplayPath: replayPath,
    error: null,
  });
}

function ensureMatchLogWatcher() {
  if (matchLogWatcher) return matchLogWatcher;
  matchLogWatcher = new MatchLogWatcher({
    getLogsDirectory: async () => findMatchLogDirectory(),
    onDiagnostic: (event, details) => logRecordingDiagnostic(`watcher-${event}`, details),
    onLobbyStarted: handleAutomaticLobbyStarted,
    onLobbyEnded: handleAutomaticLobbyEnded,
    onState: (state) => {
      const callbackError =
        obsState.automation.status === "error" &&
        obsState.automation.currentMatch?.matchId === state.currentMatch?.matchId
          ? obsState.automation.error
          : null;
      setMatchAutomationState({
        status: callbackError
          ? "error"
          : pendingAutoRecordings.length && state.status === "watching"
            ? "waiting-for-replay"
            : state.status,
        logPath: state.logPath,
        lobbyId: state.lobbyId,
        currentMatch: state.currentMatch,
        setNumber: state.setNumber,
        gameNumber: state.gameNumber,
        lastReplayPath: state.lastReplayPath,
        error: state.error ?? callbackError,
      });
    },
    onMatchStarted: handleAutomaticMatchStarted,
    onMatchEnded: handleAutomaticMatchEnded,
    onReplaySaved: handleAutomaticReplaySaved,
  });
  return matchLogWatcher;
}

async function setAutomaticRecordingEnabled(enabled) {
  const watcher = ensureMatchLogWatcher();
  if (enabled) {
    if (obsState.status !== "connected")
      throw new Error("Connect OBS before enabling automatic recording.");
    try {
      await prepareObsProfile();
      await opponentSetHistory.refresh().catch((error) => {
        logRecordingDiagnostic("opponent-set-history-failed", {
          error: obsErrorMessage(error),
        });
      });
      setMatchAutomationState({ enabled: true, error: null });
      await watcher.start();
    } catch (error) {
      setMatchAutomationState({ enabled: false, status: "error", error: obsErrorMessage(error) });
      throw error;
    }
  } else {
    await watcher.stop();
    if (activeObsRecording?.source === "automatic") {
      await stopObsRecording("automation-disabled").catch(() => undefined);
    }
    for (const pending of pendingAutoRecordings) clearTimeout(pending.timeout);
    pendingAutoRecordings = [];
    setMatchAutomationState({
      enabled: false,
      status: "disabled",
      currentMatch: null,
      error: null,
    });
  }
  return publicObsState();
}

async function connectToObs(request = {}) {
  const settings = getObsSettings();
  const host = String(request.host ?? settings.host).trim() || settings.host;
  const port = Number(request.port ?? settings.port);
  const providedPassword =
    typeof request.password === "string" && request.password.length > 0 ? request.password : null;
  const password = providedPassword ?? readStoredObsPassword() ?? "";
  const rememberPassword = request.rememberPassword !== false;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("OBS WebSocket port must be between 1 and 65535.");
  }

  if (obsClient) {
    const previous = obsClient;
    invalidatePreparedObsProfile();
    obsClient = null;
    await previous.disconnect().catch(() => undefined);
  }
  const token = ++obsConnectionToken;
  setObsState({ status: "connecting", host, port, error: null });
  const client = new OBSWebSocket();
  obsClient = client;
  client.on("RecordStateChanged", (recordStatus) => {
    if (obsClient !== client) return;
    if (recordStatus.outputState === "OBS_WEBSOCKET_OUTPUT_STARTED") {
      setCaptureState({ chapterLastAddedAt: null });
    }
    const transitioning = [
      "OBS_WEBSOCKET_OUTPUT_STARTING",
      "OBS_WEBSOCKET_OUTPUT_STOPPING",
    ].includes(recordStatus.outputState);
    const active = Boolean(recordStatus.outputActive) || transitioning;
    setObsState({
      recording: {
        active,
        paused: recordStatus.outputState === "OBS_WEBSOCKET_OUTPUT_PAUSED",
        outputPath: recordStatus.outputPath ?? null,
      },
    });
    if (
      !active &&
      recordStatus.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED" &&
      activeObsRecording
    ) {
      void finalizeObsRecording(recordStatus.outputPath ?? null, requestedObsStopReason ?? "obs");
      sendObsState();
    }
  });
  client.on("ConnectionClosed", (error) => {
    if (obsClient !== client || token !== obsConnectionToken) return;
    invalidatePreparedObsProfile();
    obsClient = null;
    setObsState({ status: "disconnected", error: error?.message ?? "OBS connection closed." });
  });
  client.on("CurrentProfileChanged", () => {
    if (obsClient !== client) return;
    invalidatePreparedObsProfile();
  });
  client.on("ConnectionError", (error) => {
    if (obsClient !== client || token !== obsConnectionToken) return;
    setObsState({ error: error?.message ?? "OBS connection error." });
  });

  try {
    await client.connect(`ws://${host}:${port}`, password);
    if (obsClient !== client || token !== obsConnectionToken)
      throw new Error("OBS connection superseded.");
    const currentSettings = readSettings();
    writeSettings({
      ...currentSettings,
      obs: { ...getObsSettings(), host, port },
    });
    if (rememberPassword && providedPassword) saveObsPassword(providedPassword);
    if (!rememberPassword) clearStoredObsPassword();
    await refreshObsState(client);
    if (obsState.automation.enabled && matchLogWatcher?.lobbyId) {
      void handleAutomaticLobbyStarted({ lobbyId: matchLogWatcher.lobbyId, recovered: true });
    } else if (obsState.automation.enabled && matchLogWatcher?.currentMatch) {
      void handleAutomaticMatchStarted(matchLogWatcher.currentMatch, { recovered: true });
    }
    return publicObsState();
  } catch (error) {
    invalidatePreparedObsProfile();
    if (obsClient === client) obsClient = null;
    setObsState({ status: "error", error: obsErrorMessage(error) });
    await client.disconnect().catch(() => undefined);
    throw error;
  }
}

async function openObsApp() {
  if (process.platform !== "win32") {
    throw new Error("Opening OBS from Labatar is currently supported on Windows only.");
  }

  const installRoots = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs"),
  ].filter(Boolean);
  let executable = installRoots
    .map((root) => path.join(root, "obs-studio", "bin", "64bit", "obs64.exe"))
    .find((candidate) => fs.existsSync(candidate));

  if (!executable) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Locate OBS Studio",
      properties: ["openFile"],
      filters: [{ name: "OBS Studio", extensions: ["exe"] }],
    });
    if (result.canceled || !result.filePaths[0]) return false;
    executable = result.filePaths[0];
    if (path.basename(executable).toLowerCase() !== "obs64.exe") {
      throw new Error("Select the OBS Studio executable (obs64.exe).");
    }
  }

  await new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      cwd: path.dirname(executable),
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return true;
}

async function ensureLabatarVideoSettings(client, version, dimensions = null) {
  if (
    !version.availableRequests?.includes("GetVideoSettings") ||
    !version.availableRequests?.includes("SetVideoSettings")
  ) {
    throw new Error("This OBS WebSocket version cannot configure video frame rate.");
  }

  const current = await client.call("GetVideoSettings");
  const currentFpsNumerator = Number(current.fpsNumerator);
  const currentFpsDenominator = Number(current.fpsDenominator);
  const currentFps = currentFpsNumerator / currentFpsDenominator;
  const request = {};
  if (currentFps !== labatarRecordingFrameRate.numerator) {
    request.fpsNumerator = labatarRecordingFrameRate.numerator;
    request.fpsDenominator = labatarRecordingFrameRate.denominator;
  }

  const targetBase = dimensions?.base ?? null;
  const targetOutput = dimensions?.output ?? null;
  if (targetBase) {
    const targetBaseWidth = Math.round(Number(targetBase.width));
    const targetBaseHeight = Math.round(Number(targetBase.height));
    if (
      targetBaseWidth > 0 &&
      targetBaseHeight > 0 &&
      (Number(current.baseWidth) !== targetBaseWidth ||
        Number(current.baseHeight) !== targetBaseHeight)
    ) {
      request.baseWidth = targetBaseWidth;
      request.baseHeight = targetBaseHeight;
    }
  }
  if (targetOutput) {
    const targetOutputWidth = Math.round(Number(targetOutput.width));
    const targetOutputHeight = Math.round(Number(targetOutput.height));
    if (
      targetOutputWidth > 0 &&
      targetOutputHeight > 0 &&
      (Number(current.outputWidth) !== targetOutputWidth ||
        Number(current.outputHeight) !== targetOutputHeight)
    ) {
      request.outputWidth = targetOutputWidth;
      request.outputHeight = targetOutputHeight;
    }
  }

  if (Object.keys(request).length === 0) return current;

  const [recordStatus, streamStatus] = await Promise.all([
    client.call("GetRecordStatus"),
    client.call("GetStreamStatus"),
  ]);
  if (recordStatus.outputActive) {
    throw new Error("Stop the active OBS recording before changing video settings.");
  }
  if (streamStatus.outputActive) {
    throw new Error("Stop the active OBS stream before changing video settings.");
  }

  await client.call("SetVideoSettings", request);
  const updated = await client.call("GetVideoSettings");
  const updatedFps = Number(updated.fpsNumerator) / Number(updated.fpsDenominator);
  if (updatedFps !== labatarRecordingFrameRate.numerator) {
    throw new Error(
      `OBS did not accept the required ${labatarRecordingFrameRate.numerator} fps setting.`,
    );
  }
  if (targetBase) {
    const targetBaseWidth = Math.round(Number(targetBase.width));
    const targetBaseHeight = Math.round(Number(targetBase.height));
    if (
      Number(updated.baseWidth) !== targetBaseWidth ||
      Number(updated.baseHeight) !== targetBaseHeight
    ) {
      throw new Error("OBS did not accept the required base resolution.");
    }
  }
  if (targetOutput) {
    const targetOutputWidth = Math.round(Number(targetOutput.width));
    const targetOutputHeight = Math.round(Number(targetOutput.height));
    if (
      Number(updated.outputWidth) !== targetOutputWidth ||
      Number(updated.outputHeight) !== targetOutputHeight
    ) {
      throw new Error("OBS did not accept the required output resolution.");
    }
  }
  if (dimensions) {
    logRecordingDiagnostic("obs-video-settings-applied", {
      requestedBase: targetBase,
      requestedOutput: targetOutput,
      actual: {
        fpsNumerator: Number(updated.fpsNumerator) || null,
        fpsDenominator: Number(updated.fpsDenominator) || null,
        baseWidth: Number(updated.baseWidth) || null,
        baseHeight: Number(updated.baseHeight) || null,
        outputWidth: Number(updated.outputWidth) || null,
        outputHeight: Number(updated.outputHeight) || null,
      },
      outputNormalized:
        targetBase && targetOutput
          ? Number(targetBase.width) !== Number(targetOutput.width) ||
            Number(targetBase.height) !== Number(targetOutput.height)
          : false,
    });
  }
  return updated;
}

async function prepareObsProfile(request = {}) {
  const client = getObsClient();
  invalidatePreparedObsProfile();
  const { profileName, recordDirectory } = getObsProfileTarget(request);
  const current = await refreshObsState(client);
  if (current.recordStatus.outputActive) {
    throw new Error("Stop the active OBS recording before preparing the profile.");
  }
  let profiles = current.profiles;
  let created = false;
  if (!profiles.profiles.includes(profileName)) {
    await client.call("CreateProfile", { profileName });
    created = true;
  } else if (profiles.currentProfileName !== profileName) {
    await client.call("SetCurrentProfile", { profileName });
  }
  await fs.promises.mkdir(recordDirectory, { recursive: true });
  const version = current.version;
  if (version.availableRequests?.includes("SetRecordDirectory")) {
    await client.call("SetRecordDirectory", { recordDirectory });
  }
  await ensureLabatarVideoSettings(client, version);
  const currentSettings = readSettings();
  writeSettings({
    ...currentSettings,
    obs: { ...getObsSettings(), profileName, recordDirectory },
  });
  const refreshed = await refreshObsState(client);
  const result = { ...refreshed, created };
  rememberPreparedObsProfile({ profileName, recordDirectory }, result);
  return result;
}

async function setupLabatarObsScenes(request = {}) {
  const client = getObsClient();
  invalidatePreparedObsProfile();
  const { profileName, recordDirectory } = getObsProfileTarget(request);
  const current = await refreshObsState(client);
  if (current.recordStatus.outputActive) {
    throw new Error("Stop the active OBS recording before setting up Labatar scenes.");
  }

  let profiles = current.profiles;
  let profileCreated = false;
  if (!profiles.profiles.includes(profileName)) {
    await client.call("CreateProfile", { profileName });
    profileCreated = true;
  } else if (profiles.currentProfileName !== profileName) {
    await client.call("SetCurrentProfile", { profileName });
  }

  let sceneCollections = await client.call("GetSceneCollectionList");
  if (!sceneCollections.sceneCollections.includes(labatarSceneCollectionName)) {
    await client.call("CreateSceneCollection", {
      sceneCollectionName: labatarSceneCollectionName,
    });
  } else if (sceneCollections.currentSceneCollectionName !== labatarSceneCollectionName) {
    await client.call("SetCurrentSceneCollection", {
      sceneCollectionName: labatarSceneCollectionName,
    });
  }

  await fs.promises.mkdir(recordDirectory, { recursive: true });
  const version = current.version;
  if (version.availableRequests?.includes("SetRecordDirectory")) {
    await client.call("SetRecordDirectory", { recordDirectory });
  }

  const inputKinds = await client.call("GetInputKindList");
  const availableInputKinds = new Set(inputKinds.inputKinds ?? []);
  for (const requiredKind of ["game_capture", "wasapi_output_capture", "wasapi_input_capture"]) {
    if (!availableInputKinds.has(requiredKind)) {
      throw new Error(`OBS does not provide the required source type: ${requiredKind}.`);
    }
  }
  const separateGameAudio = availableInputKinds.has("wasapi_process_output_capture");
  const gameCaptureSettings = {
    capture_mode: "window",
    window: labatarGameCaptureWindow,
    priority: 2,
    capture_cursor: false,
    limit_framerate: false,
    capture_overlays: false,
    capture_audio: !separateGameAudio,
  };
  const gameAudioSettings = {
    window: labatarGameAudioWindow,
    priority: 2,
  };
  const desktopAudioSettings = {
    device_id: "default",
    use_device_timing: true,
  };
  const micAudioSettings = {
    device_id: "default",
    use_device_timing: false,
  };

  const gameScene = labatarSceneNames.gameOnly;
  const desktopMicScene = labatarSceneNames.gameDesktopMic;
  const micScene = labatarSceneNames.gameMic;
  const gameInputName = "Labatar - Atla.exe Game Capture";
  const gameAudioInputName = "Labatar - Atla.exe Audio";
  const desktopAudioInputName = "Labatar - Desktop Audio";
  const micInputName = "Labatar - Microphone";
  const managedInputNames = new Set([
    gameInputName,
    ...(separateGameAudio ? [gameAudioInputName] : []),
    desktopAudioInputName,
    micInputName,
  ]);
  const desiredSceneInputs = new Map([
    [gameScene, [gameInputName, ...(separateGameAudio ? [gameAudioInputName] : [])]],
    [desktopMicScene, [gameInputName, desktopAudioInputName, micInputName]],
    [micScene, [gameInputName, ...(separateGameAudio ? [gameAudioInputName] : []), micInputName]],
  ]);

  const sceneList = await client.call("GetSceneList");
  const desiredSceneNames = new Set(Object.values(labatarSceneNames));
  const existingSceneNames = new Set((sceneList.scenes ?? []).map((scene) => scene.sceneName));
  for (const sceneName of Object.values(labatarSceneNames)) {
    if (!existingSceneNames.has(sceneName)) {
      await client.call("CreateScene", { sceneName });
    }
  }
  await client.call("SetCurrentProgramScene", { sceneName: gameScene });
  for (const scene of sceneList.scenes ?? []) {
    if (!desiredSceneNames.has(scene.sceneName)) {
      await client.call("RemoveScene", { sceneName: scene.sceneName });
    }
  }

  async function ensureInput(sceneName, inputName, inputKind, inputSettings) {
    const inputList = await client.call("GetInputList");
    const existingInput = (inputList.inputs ?? []).find((input) => input.inputName === inputName);
    if (!existingInput) {
      await client.call("CreateInput", {
        sceneName,
        inputName,
        inputKind,
        inputSettings,
        sceneItemEnabled: true,
      });
      return;
    }
    if (existingInput.inputKind !== inputKind && existingInput.unversionedInputKind !== inputKind) {
      throw new Error(
        `Labatar source "${inputName}" already exists with a different OBS source type.`,
      );
    }
    await client.call("SetInputSettings", {
      inputName,
      inputSettings,
      overlay: false,
    });
    const items = await client.call("GetSceneItemList", { sceneName });
    if (!(items.sceneItems ?? []).some((item) => item.sourceName === inputName)) {
      await client.call("CreateSceneItem", {
        sceneName,
        sourceName: inputName,
        sceneItemEnabled: true,
      });
    }
  }

  async function resizeOutputToSourceSize(sceneName, inputName) {
    const items = await client.call("GetSceneItemList", { sceneName });
    const sourceItem = (items.sceneItems ?? []).find((item) => item.sourceName === inputName);
    if (!sourceItem) return null;
    const transform = await client.call("GetSceneItemTransform", {
      sceneName,
      sceneItemId: sourceItem.sceneItemId,
    });
    const sourceWidth = Math.round(Number(transform.sceneItemTransform?.sourceWidth ?? 0));
    const sourceHeight = Math.round(Number(transform.sceneItemTransform?.sourceHeight ?? 0));
    if (sourceWidth < 8 || sourceHeight < 8) return null;
    const outputWidth = sourceWidth - (sourceWidth % 2);
    const outputHeight = sourceHeight - (sourceHeight % 2);
    await ensureLabatarVideoSettings(client, version, {
      base: { width: sourceWidth, height: sourceHeight },
      output: { width: outputWidth, height: outputHeight },
    });
    return {
      width: outputWidth,
      height: outputHeight,
      sourceWidth,
      sourceHeight,
      outputNormalized: outputWidth !== sourceWidth || outputHeight !== sourceHeight,
    };
  }

  async function normalizeGameCaptureTransform(sceneName) {
    const items = await client.call("GetSceneItemList", { sceneName });
    const sourceItem = (items.sceneItems ?? []).find((item) => item.sourceName === gameInputName);
    if (!sourceItem) return;
    await client.call("SetSceneItemTransform", {
      sceneName,
      sceneItemId: sourceItem.sceneItemId,
      sceneItemTransform: {
        alignment: 5,
        positionX: 0,
        positionY: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        cropLeft: 0,
        cropTop: 0,
        cropRight: 0,
        cropBottom: 0,
        boundsType: "OBS_BOUNDS_NONE",
        boundsAlignment: 0,
      },
    });
  }

  const existingInputs = await client.call("GetInputList");
  for (const input of existingInputs.inputs ?? []) {
    const inputKind = input.inputKind ?? input.unversionedInputKind;
    const expectedKind =
      input.inputName === gameInputName
        ? "game_capture"
        : input.inputName === gameAudioInputName
          ? "wasapi_process_output_capture"
          : input.inputName === desktopAudioInputName
            ? "wasapi_output_capture"
            : input.inputName === micInputName
              ? "wasapi_input_capture"
              : null;
    if (!managedInputNames.has(input.inputName) || inputKind !== expectedKind) {
      await client.call("RemoveInput", { inputName: input.inputName });
    }
  }

  for (const sceneName of [gameScene, desktopMicScene, micScene]) {
    await ensureInput(sceneName, gameInputName, "game_capture", gameCaptureSettings);
  }
  await ensureLabatarVideoSettings(client, version);
  const outputResolution = await resizeOutputToSourceSize(gameScene, gameInputName);
  if (outputResolution) {
    for (const sceneName of [gameScene, desktopMicScene, micScene]) {
      await normalizeGameCaptureTransform(sceneName);
    }
  }
  if (separateGameAudio) {
    for (const sceneName of [gameScene, micScene]) {
      await ensureInput(
        sceneName,
        gameAudioInputName,
        "wasapi_process_output_capture",
        gameAudioSettings,
      );
    }
  }
  await ensureInput(
    desktopMicScene,
    desktopAudioInputName,
    "wasapi_output_capture",
    desktopAudioSettings,
  );
  await ensureInput(desktopMicScene, micInputName, "wasapi_input_capture", micAudioSettings);
  await ensureInput(micScene, micInputName, "wasapi_input_capture", micAudioSettings);

  for (const [sceneName, desiredInputs] of desiredSceneInputs) {
    const desiredInputSet = new Set(desiredInputs);
    const items = await client.call("GetSceneItemList", { sceneName });
    for (const item of items.sceneItems ?? []) {
      if (!desiredInputSet.has(item.sourceName)) {
        await client.call("RemoveSceneItem", {
          sceneName,
          sceneItemId: item.sceneItemId,
        });
      } else if (!item.sceneItemEnabled) {
        await client.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: true,
        });
      }
    }
    const finalItems = await client.call("GetSceneItemList", { sceneName });
    const itemBySourceName = new Map(
      (finalItems.sceneItems ?? []).map((item) => [item.sourceName, item]),
    );
    for (const [sceneItemIndex, inputName] of desiredInputs.entries()) {
      const item = itemBySourceName.get(inputName);
      if (!item) continue;
      await client.call("SetSceneItemIndex", {
        sceneName,
        sceneItemId: item.sceneItemId,
        sceneItemIndex,
      });
    }
  }
  await client.call("SetCurrentProgramScene", { sceneName: gameScene });

  const currentSettings = readSettings();
  writeSettings({
    ...currentSettings,
    obs: { ...getObsSettings(), profileName, recordDirectory },
  });
  const refreshed = await refreshObsState(client);
  rememberPreparedObsProfile({ profileName, recordDirectory }, refreshed);
  return {
    profileName,
    recordDirectory,
    sceneCollectionName: labatarSceneCollectionName,
    scenes: Object.values(labatarSceneNames),
    gameAudioMode: separateGameAudio ? "separate" : "window-capture",
    outputResolution,
    profileCreated,
    ...refreshed,
  };
}

function watchElectronFiles() {
  if (!isDev) return;

  const watchedFiles = [
    __filename,
    path.join(__dirname, "preload.cjs"),
    path.join(__dirname, "match-watcher.cjs"),
    path.join(__dirname, "artwork-extractor.ts"),
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

function getCaptureSettings() {
  const saved = readSettings().capture ?? {};
  const hotkey =
    typeof saved.hotkey === "string" && saved.hotkey.trim() ? saved.hotkey.trim() : "F9";
  const chapterHotkey =
    typeof saved.chapterHotkey === "string" && saved.chapterHotkey.trim()
      ? saved.chapterHotkey.trim()
      : "F10";
  return {
    hotkey,
    chapterHotkey,
    autoGameChapters: saved.autoGameChapters === true,
    autoClipManualChapters: saved.autoClipManualChapters !== false,
  };
}

function publicCaptureState() {
  return captureState;
}

function sendCaptureState() {
  if (!canSendToRenderer()) return;
  mainWindow.webContents.send("capture:state", publicCaptureState());
}

function setCaptureState(patch) {
  captureState = { ...captureState, ...patch };
  sendCaptureState();
}

function saveCaptureSettings(nextSettings) {
  const current = readSettings();
  writeSettings({
    ...current,
    capture: {
      ...getCaptureSettings(),
      ...nextSettings,
    },
  });
}

async function toggleLabatarCapture(trigger = "hotkey") {
  if (automaticMoveRunIsOpen()) {
    throw new Error("The F9 recording shortcut is unavailable during automatic move capture.");
  }
  if (captureTogglePromise) return captureTogglePromise;
  captureTogglePromise = (async () => {
    if (activeObsRecording) {
      const result = await stopObsRecording(`capture-${trigger}`);
      setCaptureState({ lastAction: "stopped", error: null });
      return result;
    }

    const obsSettings = getObsSettings();
    const result = await startManualObsRecording({
      profileName: obsSettings.profileName,
      recordDirectory: obsSettings.recordDirectory,
    });
    setCaptureState({ lastAction: "started", error: null });
    return result;
  })()
    .catch((error) => {
      setCaptureState({ error: obsErrorMessage(error) });
      throw error;
    })
    .finally(() => {
      captureTogglePromise = null;
    });
  return captureTogglePromise;
}

async function addRecordingChapter(trigger = "hotkey") {
  try {
    await createUnnamedRecordChapter(getObsClient());
    const at = new Date().toISOString();
    logRecordingDiagnostic("recording-chapter-request-accepted", {
      trigger,
      sessionId: activeObsRecording?.sessionId ?? null,
    });
    setCaptureState({ chapterLastAddedAt: at, chapterError: null });
    return { at };
  } catch (error) {
    const message = obsErrorMessage(error);
    logRecordingDiagnostic("recording-chapter-failed", { trigger, error: message });
    setCaptureState({ chapterError: message });
    throw error;
  }
}

function registerChapterShortcut(hotkey) {
  if (hotkey.toUpperCase() === getCaptureSettings().hotkey.toUpperCase()) {
    throw new Error("The chapter shortcut must be different from the global capture shortcut.");
  }
  const previousShortcut = chapterShortcut;
  if (previousShortcut) {
    globalShortcut.unregister(previousShortcut);
    chapterShortcut = null;
  }
  const registered = globalShortcut.register(hotkey, () => {
    void addRecordingChapter("hotkey").catch(() => undefined);
  });
  chapterShortcut = registered ? hotkey : null;
  setCaptureState({
    chapterHotkey: hotkey,
    chapterHotkeyRegistered: registered,
    chapterError: registered
      ? null
      : `Could not register global shortcut ${hotkey}. It may already be in use.`,
  });
  if (!registered) {
    if (previousShortcut) {
      const restored = globalShortcut.register(previousShortcut, () => {
        void addRecordingChapter("hotkey").catch(() => undefined);
      });
      chapterShortcut = restored ? previousShortcut : null;
      setCaptureState({
        chapterHotkey: previousShortcut,
        chapterHotkeyRegistered: restored,
      });
    }
    throw new Error(`Could not register global shortcut ${hotkey}. It may already be in use.`);
  }
  return publicCaptureState();
}

function registerCaptureShortcut(hotkey) {
  if (hotkey.toUpperCase() === getCaptureSettings().chapterHotkey.toUpperCase()) {
    throw new Error("The capture shortcut must be different from the recording chapter shortcut.");
  }
  if (captureShortcut) {
    globalShortcut.unregister(captureShortcut);
    captureShortcut = null;
  }
  const registered = globalShortcut.register(hotkey, () => {
    void toggleLabatarCapture("hotkey").catch(() => undefined);
  });
  if (!registered) {
    setCaptureState({
      hotkey,
      hotkeyRegistered: false,
      error: `Could not register global shortcut ${hotkey}.`,
    });
    throw new Error(`Could not register global shortcut ${hotkey}. It may already be in use.`);
  }
  captureShortcut = hotkey;
  setCaptureState({ hotkey, hotkeyRegistered: true, error: null });
  return publicCaptureState();
}

function getReplayFolder() {
  const savedFolder = readSettings().replaysFolder;
  if (typeof savedFolder === "string" && savedFolder.trim()) return savedFolder;
  return fs.existsSync(defaultReplaysFolder) ? defaultReplaysFolder : null;
}

function blackoutBackupRoot() {
  return path.join(app.getPath("userData"), "blackout-game-backups");
}

function blackoutSourceRoot() {
  return path.resolve(__dirname, "..", ".dev", "installer", "black-stage");
}

async function startBlackoutWatcher(session) {
  if (blackoutWatcherStarting?.backupDir === session.backupDir) {
    return blackoutWatcherStarting.promise;
  }
  const watcherLock = path.join(blackoutBackupRoot(), "watcher.lock");
  const watcherLockStat = fs.existsSync(watcherLock) ? fs.statSync(watcherLock) : null;
  if (watcherLockStat && Date.now() - watcherLockStat.mtimeMs < 15_000) return;
  const promise = (async () => {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(__dirname, "start-blackout-watcher.ps1"),
        process.execPath,
        path.join(__dirname, "dev-blackout-game.cjs"),
        blackoutBackupRoot(),
      ],
      { windowsHide: true },
    );
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (fs.existsSync(watcherLock)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("The blackout restore watcher did not start.");
  })();
  blackoutWatcherStarting = { backupDir: session.backupDir, promise };
  try {
    await promise;
  } finally {
    blackoutWatcherStarting = null;
  }
}

async function devBlackoutStatus() {
  if (!isDev)
    return {
      available: false,
      gameRunning: false,
      active: false,
      busy: false,
      restorePending: false,
      error: "Development build only.",
    };
  const running = await blackoutGameRunning();
  let current = readBlackoutSession(blackoutBackupRoot());
  const selectedRoot = getReplayFolder();
  if (
    current?.phase === "restoring" &&
    running &&
    !blackoutRecoveryBusy &&
    selectedRoot &&
    path.resolve(current.gameRoot) === path.resolve(selectedRoot) &&
    !fs.existsSync(path.join(blackoutBackupRoot(), "restore.lock"))
  ) {
    blackoutRecoveryBusy = true;
    try {
      if (
        (await verifyBlackoutInstalled(current)) &&
        (await Promise.all(current.files.map((file) => sha256BlackoutFile(file.backup)))).every(
          (hash, index) => hash === current.files[index].originalHash,
        ) &&
        (await blackoutGameRunning())
      ) {
        current.phase = "active";
        current.activeAt = Date.now();
        writeBlackoutSession(blackoutBackupRoot(), current);
        await startBlackoutWatcher(current);
      }
    } finally {
      blackoutRecoveryBusy = false;
    }
  }
  const restoreLog = path.join(blackoutBackupRoot(), "restore-error.log");
  const restoreErrorStat = current ? await fs.promises.stat(restoreLog).catch(() => null) : null;
  const restoreFailed = Boolean(
    current && !running && restoreErrorStat && restoreErrorStat.mtimeMs >= current.createdAt,
  );
  const active = Boolean(
    current?.phase === "active" &&
    running &&
    selectedRoot &&
    path.resolve(current.gameRoot) === path.resolve(selectedRoot) &&
    (await verifyBlackoutInstalled(current)),
  );
  if (active) await startBlackoutWatcher(current);
  return {
    available: true,
    gameRunning: running,
    active,
    busy: blackoutBusy || Boolean(current && !running),
    restorePending: Boolean(current && !running),
    error: restoreFailed
      ? "Automatic restoration failed. Use Retry restore after checking the game is closed."
      : current && running && !active
        ? "The game is open, but its blackout files could not be verified."
        : null,
  };
}

async function retryDevBlackoutRestore() {
  if (!isDev) throw new Error("Blackout restoration is available only in development builds.");
  if (blackoutBusy) throw new Error("Blackout setup is already running.");
  if (await blackoutGameRunning())
    throw new Error("Close the game before restoring original assets.");
  const restored = await restoreBlackoutSession(blackoutBackupRoot());
  if (!restored && readBlackoutSession(blackoutBackupRoot())) {
    throw new Error("The restore watcher is still working. Try again shortly.");
  }
  return devBlackoutStatus();
}

async function requireDevBlackoutCapture() {
  const status = await devBlackoutStatus();
  if (!status.active) {
    throw new Error(
      "Start the game in blackout mode from Dev-only capture before recording move data.",
    );
  }
}

async function startDevBlackoutGame() {
  if (!isDev) throw new Error("Blackout game launch is available only in development builds.");
  if (blackoutBusy) throw new Error("Blackout setup is already running.");
  blackoutBusy = true;
  let session = null;
  try {
    if (readBlackoutSession(blackoutBackupRoot())) {
      throw new Error(
        "The previous blackout session must be restored before starting another game.",
      );
    }
    if (await blackoutGameRunning())
      throw new Error("Close the already open game before starting blackout mode.");
    const gameRoot = getReplayFolder();
    if (!gameRoot) throw new Error("Select the game installation folder in Settings first.");
    session = await prepareBlackoutSession({
      gameRoot: path.resolve(gameRoot),
      sourceRoot: blackoutSourceRoot(),
      backupRoot: blackoutBackupRoot(),
    });
    await startBlackoutWatcher(session);
    await installBlackoutSession(session);
    if (!(await verifyBlackoutInstalled(session)))
      throw new Error("Blackout installation could not be verified.");
    if (await blackoutGameRunning()) {
      throw new Error("The game opened during blackout setup. Close it to restore the originals.");
    }
    const child = spawn(path.join(session.gameRoot, "Atla.exe"), [], {
      cwd: session.gameRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    let launchError = null;
    child.on("error", (error) => {
      launchError = error;
    });
    child.unref();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (await blackoutGameRunning()) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!(await blackoutGameRunning())) throw new Error("The game did not open within 20 seconds.");
    session.phase = "active";
    session.activeAt = Date.now();
    writeBlackoutSession(blackoutBackupRoot(), session);
    return devBlackoutStatus();
  } catch (error) {
    if (session && !(await blackoutGameRunning().catch(() => true))) {
      try {
        await restoreBlackoutSession(blackoutBackupRoot());
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `Game launch failed and original assets could not be restored: ${obsErrorMessage(restoreError)}`,
        );
      }
    }
    throw error;
  } finally {
    blackoutBusy = false;
  }
}

async function getGameFolderStatus() {
  const folder = getReplayFolder();
  if (!folder) {
    return {
      folder: null,
      issue: "Game folder not found. Choose the game's installation folder in Settings.",
    };
  }
  const folderStat = await fs.promises.stat(folder).catch(() => null);
  if (!folderStat?.isDirectory()) {
    return {
      folder,
      issue:
        "The selected game folder is unavailable. Choose the game's installation folder in Settings.",
    };
  }
  const packagesFolder = path.join(folder, "data_packages");
  const packagesStat = await fs.promises.stat(packagesFolder).catch(() => null);
  if (!packagesStat?.isDirectory()) {
    return {
      folder,
      issue:
        "The selected game folder has no data_packages folder. Choose the game's installation folder in Settings.",
    };
  }
  const pakFiles = await findDevArtworkPakFiles(packagesFolder).catch(() => null);
  if (!pakFiles?.length) {
    return {
      folder,
      issue:
        "No readable game .pak files were found in data_packages. Choose the game's installation folder in Settings.",
    };
  }
  return { folder, issue: null };
}

function updateInfo(info) {
  return {
    version: info?.version,
    releaseDate: info?.releaseDate,
  };
}

function sendUpdateStatus(state, info = null, details = {}) {
  if (!canSendToRenderer()) return;
  mainWindow.webContents.send("updates:status", {
    state,
    ...updateInfo(info ?? latestUpdateInfo),
    ...details,
  });
}

function setUpdateMenuState(state, info = null, details = {}) {
  updateState = state;
  latestUpdateInfo = info ? updateInfo(info) : latestUpdateInfo;
  sendUpdateStatus(state, latestUpdateInfo, details);
  if (!updateMenuItem) return;

  const labels = {
    idle: "Check for Updates...",
    checking: "Checking for Updates...",
    available: `Download Update${latestUpdateInfo?.version ? ` (v${latestUpdateInfo.version})` : ""}...`,
    downloading: "Downloading Update...",
    downloaded: "Restart and Install Update",
    "not-available": "Check for Updates...",
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
    setUpdateMenuState("not-available", info);
  });
  autoUpdater.on("download-progress", (progress) => {
    setUpdateMenuState("downloading", null, { percent: progress.percent });
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

ipcMain.handle("app:get-version", () => app.getVersion());

ipcMain.handle("capture:get-state", () => publicCaptureState());
ipcMain.handle("capture:set-settings", (_, request) => {
  const current = getCaptureSettings();
  const hotkey = String(request?.hotkey ?? current.hotkey).trim();
  if (!hotkey) throw new Error("Enter a global shortcut, such as F9 or CommandOrControl+Shift+R.");
  const nextSettings = { hotkey };
  saveCaptureSettings(nextSettings);
  try {
    return registerCaptureShortcut(nextSettings.hotkey);
  } catch (error) {
    saveCaptureSettings(current);
    try {
      registerCaptureShortcut(current.hotkey);
    } catch {
      // Keep the failed registration visible if the previous shortcut is no longer available.
    }
    setCaptureState({ error: obsErrorMessage(error) });
    throw error;
  }
});
ipcMain.handle("capture:set-chapter-settings", (_, request) => {
  const current = getCaptureSettings();
  const chapterHotkey = String(request?.hotkey ?? current.chapterHotkey).trim();
  if (!chapterHotkey)
    throw new Error("Enter a global shortcut, such as F10 or CommandOrControl+Shift+C.");
  saveCaptureSettings({ chapterHotkey });
  try {
    return registerChapterShortcut(chapterHotkey);
  } catch (error) {
    saveCaptureSettings(current);
    try {
      registerChapterShortcut(current.chapterHotkey);
    } catch {
      // Keep the failed registration visible if the previous shortcut is no longer available.
    }
    setCaptureState({ chapterError: obsErrorMessage(error) });
    throw error;
  }
});
ipcMain.handle("capture:toggle", async () => toggleLabatarCapture("labatar"));
ipcMain.handle("capture:set-dev-tab-active", (_, active) => {
  devCaptureTabActive = isDev && active === true;
});
ipcMain.handle("capture:add-chapter", async () => addRecordingChapter("labatar"));
ipcMain.handle("capture:set-auto-game-chapters", (_, request) => {
  if (typeof request?.enabled !== "boolean") throw new Error("Invalid game chapter setting.");
  saveCaptureSettings({ autoGameChapters: request.enabled });
  setCaptureState({ autoGameChapters: request.enabled });
  return publicCaptureState();
});
ipcMain.handle("capture:set-auto-clip-manual-chapters", (_, request) => {
  if (typeof request?.enabled !== "boolean") throw new Error("Invalid automatic clip setting.");
  saveCaptureSettings({ autoClipManualChapters: request.enabled });
  setCaptureState({ autoClipManualChapters: request.enabled });
  return publicCaptureState();
});

ipcMain.handle("obs:get-state", () => publicObsState());
ipcMain.handle("obs:get-settings", () => {
  const settings = getObsSettings();
  return {
    host: settings.host,
    port: settings.port,
    profileName: settings.profileName,
    recordDirectory: settings.recordDirectory,
    passwordSaved: hasStoredObsPassword(),
  };
});
ipcMain.handle("obs:connect", async (_, request) => connectToObs(request));
ipcMain.handle("obs:open-app", () => openObsApp());
ipcMain.handle("obs:clear-password", () => {
  clearStoredObsPassword();
  return true;
});
ipcMain.handle("obs:disconnect", async () => {
  if (obsState.automation.enabled) await setAutomaticRecordingEnabled(false);
  if (activeObsRecording) await stopObsRecording("disconnect").catch(() => undefined);
  ++obsConnectionToken;
  invalidatePreparedObsProfile();
  const client = obsClient;
  obsClient = null;
  if (client) await client.disconnect().catch(() => undefined);
  setObsState({
    status: "disconnected",
    error: null,
    currentSceneCollectionName: null,
    currentSceneName: null,
    videoSettings: null,
    recording: { active: false, paused: false, outputPath: null },
  });
  return publicObsState();
});
ipcMain.handle("obs:prepare-profile", async (_, request) => {
  const result = await prepareObsProfile(request);
  return {
    profileName: result.profiles.currentProfileName,
    recordDirectory: result.recordDirectory,
    created: result.created,
  };
});
ipcMain.handle("obs:setup-scenes", async (_, request) => setupLabatarObsScenes(request));
ipcMain.handle("obs:set-scene", async (_, sceneName) => {
  const requestedSceneName = String(sceneName ?? "");
  if (!Object.values(labatarSceneNames).includes(requestedSceneName)) {
    throw new Error("Unknown Labatar scene.");
  }
  const client = getObsClient();
  await client.call("SetCurrentProgramScene", { sceneName: requestedSceneName });
  await refreshObsState(client);
  return publicObsState();
});
ipcMain.handle("obs:start-recording", async (_, request) => {
  if (devCaptureTabActive) await requireDevBlackoutCapture();
  return startObsRecording(request?.metadata, request?.setup ?? {});
});
ipcMain.handle("obs:start-manual-recording", async (_, request) => {
  return startManualObsRecording(request?.setup ?? {});
});
ipcMain.handle("obs:stop-recording", async () => {
  if (automaticMoveRunIsOpen()) {
    throw new Error("Pause or cancel the automatic move capture pass to stop its recording.");
  }
  return stopObsRecording("labatar");
});
ipcMain.handle("obs:set-automatic-recording", async (_, enabled) => {
  if (enabled && devCaptureTabActive) await requireDevBlackoutCapture();
  return setAutomaticRecordingEnabled(Boolean(enabled));
});

function formatSupport(character, supportId) {
  if (!supportId || supportId === "0") return "None";
  const aliases = {
    korra_nightmare: "Nightmare Korra",
    aang_avchar: "Avatar Aang",
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

function parseNumericValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseReplayRatings(value, pendingVolatility, pendingMmrChange, pendingCharacters) {
  const match = value.match(
    /^\s*([^|]+?)\s*\|\s*P1 glicko\s+([^/|]+)\/([^|]+)\s+charMMR\s+([^|]+)\s*\|\s*P2 glicko\s+([^/|]+)\/([^|]+)\s+charMMR\s+([^|]+)\s*$/i,
  );
  if (!match) return null;

  const makeRating = (rating, deviation, characterMmr, volatility) => ({
    rating: parseNumericValue(rating),
    deviation: parseNumericValue(deviation),
    volatility: volatility ?? null,
    characterMmr: parseNumericValue(characterMmr),
  });
  const makePlayerRating = (rating, deviation, characterMmr, volatility, mmrChange) => ({
    ...makeRating(rating, deviation, characterMmr, volatility),
    mmrChange: mmrChange ?? null,
  });
  const playerMmr = [parseNumericValue(match[4]), parseNumericValue(match[7])];
  const mmrChanges = assignMmrChangesToPlayers(pendingMmrChange, pendingCharacters, playerMmr);
  return {
    mode: match[1].trim(),
    affectsRank: pendingMmrChange?.affectsRank ?? null,
    player1: makePlayerRating(
      match[2],
      match[3],
      match[4],
      pendingVolatility?.player1 ?? null,
      mmrChanges.player1,
    ),
    player2: makePlayerRating(
      match[5],
      match[6],
      match[7],
      pendingVolatility?.player2 ?? null,
      mmrChanges.player2,
    ),
  };
}

function parseCharacterMmrChange(line) {
  const match = line.match(
    /Character rating recompute:\s*(.*?)\s+(-?\d+(?:\.\d+)?)\/rd[^\s]+\s*->\s*(-?\d+(?:\.\d+)?)\/rd[^\s]+\s*\(([+-]?\d+(?:\.\d+)?)\)\s+vs\s+(.*?)\s+(-?\d+(?:\.\d+)?)\/rd[^\s]+\s*->\s*(-?\d+(?:\.\d+)?)\/rd[^\s]+/i,
  );
  if (!match) return null;
  return {
    characters: [match[1].trim(), match[5].trim()],
    newRatings: [parseNumericValue(match[3]), parseNumericValue(match[7])],
    affectsRank: !/dead game:\s*set scoring over/i.test(line),
    changes: [
      parseNumericValue(match[4]),
      parseNumericValue(match[7]) - parseNumericValue(match[6]),
    ],
  };
}

function normalizeMatchCharacter(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function assignMmrChangesToPlayers(matchChange, pendingCharacters = {}, playerMmr = []) {
  const changes = [null, null];
  const matchedIndexes = [null, null];
  const used = new Set();
  if (!matchChange) return { player1: null, player2: null };
  for (const [playerIndex, mmr] of playerMmr.entries()) {
    if (mmr === null || mmr < 0) continue;
    const matchedIndex = matchChange.newRatings.findIndex(
      (candidate, candidateIndex) => !used.has(candidateIndex) && candidate === mmr,
    );
    if (matchedIndex >= 0) {
      matchedIndexes[playerIndex] = matchedIndex;
      used.add(matchedIndex);
    }
  }
  for (const [playerIndex, playerKey] of ["player1", "player2"].entries()) {
    if (matchedIndexes[playerIndex] !== null) continue;
    const character = pendingCharacters[playerKey];
    const normalizedCharacter = character ? normalizeMatchCharacter(character) : null;
    if (!normalizedCharacter) continue;
    const changeIndex = matchChange.characters.findIndex(
      (candidate, candidateIndex) =>
        !used.has(candidateIndex) && normalizeMatchCharacter(candidate) === normalizedCharacter,
    );
    if (changeIndex >= 0) {
      matchedIndexes[playerIndex] = changeIndex;
      used.add(changeIndex);
    }
  }
  let fallbackIndex = 0;
  for (const playerIndex of [0, 1]) {
    if (matchedIndexes[playerIndex] !== null) continue;
    while (used.has(fallbackIndex)) fallbackIndex += 1;
    matchedIndexes[playerIndex] = fallbackIndex;
    used.add(fallbackIndex);
  }
  for (const [playerIndex, changeIndex] of matchedIndexes.entries()) {
    changes[playerIndex] = matchChange.changes[changeIndex] ?? null;
  }
  return { player1: changes[0], player2: changes[1] };
}

function parseSetNewMatchGlicko(line) {
  const playerMatch = line.match(/SetNewMatch:\s*Player\s+([12]):\s*(.*?)\s*\(SteamID:/i);
  if (!playerMatch) return null;
  const glickoMatch = line.match(
    /Glicko:\s*\[\s*R:\s*([^:]+):\s*D:\s*([^:]+):\s*Vol:\s*([^\]]+)\]/i,
  );
  return {
    player: playerMatch[1] === "1" ? "player1" : "player2",
    character: playerMatch[2].trim(),
    volatility: glickoMatch ? parseNumericValue(glickoMatch[3]) : null,
  };
}

async function findLogFiles(folder) {
  const folderName = path.basename(folder).toLowerCase();
  const candidates = new Set([
    folderName === "logs" ? folder : path.join(folder, "logs"),
    folderName === "replays" ? path.join(path.dirname(folder), "logs") : null,
  ]);
  const logFiles = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    let entries;
    try {
      entries = await fs.promises.readdir(candidate, { withFileTypes: true });
    } catch {
      continue;
    }
    const directories = [candidate];
    while (directories.length > 0) {
      const currentDirectory = directories.pop();
      let currentEntries;
      try {
        currentEntries =
          currentDirectory === candidate
            ? entries
            : await fs.promises.readdir(currentDirectory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of currentEntries) {
        const entryPath = path.join(currentDirectory, entry.name);
        if (entry.isDirectory()) directories.push(entryPath);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) {
          logFiles.push(entryPath);
        }
      }
    }
  }
  return [...new Set(logFiles)].sort((left, right) => left.localeCompare(right));
}

async function readReplayRatingsFromLog(logFile) {
  const ratingsByReplayName = new Map();
  let pendingRatings = null;
  const pendingVolatility = {};
  const pendingCharacters = {};
  let pendingMmrChange = null;
  const input = fs.createReadStream(logFile, { encoding: "latin1" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    const glicko = parseSetNewMatchGlicko(line);
    if (glicko) {
      if (glicko.player === "player1") {
        pendingCharacters.player1 = null;
        pendingCharacters.player2 = null;
        pendingMmrChange = null;
      }
      pendingVolatility[glicko.player] = glicko.volatility;
      pendingCharacters[glicko.player] = glicko.character;
    }

    const mmrChange = parseCharacterMmrChange(line);
    if (mmrChange) {
      pendingMmrChange = mmrChange;
    }

    const gatheredRatings = line.match(/Gathered ratings for header:\s*(.*)$/i);
    const writtenRatings = line.match(/Wrote ratings to header\s*\(([^)]*glicko[^)]*)\)/i);
    if (gatheredRatings || writtenRatings) {
      pendingRatings = parseReplayRatings(
        gatheredRatings?.[1] ?? writtenRatings[1],
        pendingVolatility,
        pendingMmrChange,
        pendingCharacters,
      );
    }

    const replayMatch = line.match(/Successfully wrote replay file:\s*(.*?\.dlr)/i);
    if (replayMatch && pendingRatings) {
      ratingsByReplayName.set(path.win32.basename(replayMatch[1]), pendingRatings);
      pendingRatings = null;
      pendingVolatility.player1 = null;
      pendingVolatility.player2 = null;
      pendingCharacters.player1 = null;
      pendingCharacters.player2 = null;
      pendingMmrChange = null;
    }
  }
  return ratingsByReplayName;
}

async function readReplayRatings(folder, onProgress, cache) {
  const logFiles = await findLogFiles(folder);
  const ratingsByReplayName = new Map();
  const currentLogKeys = new Set();
  for (const [index, logFile] of logFiles.entries()) {
    const cacheKey = path.resolve(logFile).toLowerCase();
    currentLogKeys.add(cacheKey);
    let ratings = null;
    try {
      const stat = await fs.promises.stat(logFile);
      const fingerprint = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      const cached = cache?.ratingLogs.get(cacheKey);
      if (cached?.fingerprint === fingerprint) {
        ratings = cached.ratings;
        cache.ratingLogs.delete(cacheKey);
        cache.ratingLogs.set(cacheKey, cached);
      } else {
        ratings = await readReplayRatingsFromLog(logFile);
        if (cache) {
          cache.ratingLogs.set(cacheKey, { fingerprint, ratings });
          cache.dirty = true;
        }
      }
    } catch {
      // A rotating or deleted log should not prevent replay history from loading.
    }
    for (const [replayName, replayRatings] of ratings ?? []) {
      ratingsByReplayName.set(replayName, replayRatings);
    }
    onProgress?.(index + 1, logFiles.length);
  }
  if (cache) {
    for (const cacheKey of cache.ratingLogs.keys()) {
      if (!currentLogKeys.has(cacheKey)) {
        cache.ratingLogs.delete(cacheKey);
        cache.dirty = true;
      }
    }
    while (cache.ratingLogs.size > 512) {
      cache.ratingLogs.delete(cache.ratingLogs.keys().next().value);
      cache.dirty = true;
    }
  }
  return ratingsByReplayName;
}

async function parseReplayFile(
  filePath,
  rootFolder = path.dirname(filePath),
  ratingsByReplayName = new Map(),
) {
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
    roundScore: replayRoundScore(fields),
    ratings: ratingsByReplayName.get(fileName) ?? null,
  };
}

const recordingExtensions = new Set([".avi", ".flv", ".mkv", ".mov", ".mp4", ".ts", ".webm"]);

async function findRecordingFiles(folder) {
  const files = [];
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
      if (entry.isDirectory()) {
        directories.push(entryPath);
      } else if (
        entry.isFile() &&
        recordingExtensions.has(path.extname(entry.name).toLowerCase())
      ) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

function recordingIdForPath(filePath, folder) {
  return path.relative(folder, filePath).split(path.sep).join("/");
}

async function updateLinkedClipManifests(folder, previousId, nextId, nextName) {
  const updatedManifests = [];
  try {
    for (const filePath of await findRecordingFiles(folder)) {
      const manifestPath = recordingManifestPathForVideo(filePath);
      let originalContent;
      let manifest;
      try {
        originalContent = await fs.promises.readFile(manifestPath, "utf8");
        manifest = JSON.parse(originalContent);
      } catch {
        continue;
      }
      if (manifest?.clip?.sourceRecordingId !== previousId) continue;

      manifest.clip.sourceRecordingId = nextId;
      manifest.clip.sourceRecordingName = nextName;
      await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
      updatedManifests.push({ manifestPath, originalContent });
    }
    return updatedManifests;
  } catch (error) {
    for (const { manifestPath, originalContent } of updatedManifests.reverse()) {
      await fs.promises.writeFile(manifestPath, originalContent, "utf8").catch(() => undefined);
    }
    throw error;
  }
}

function legacyRecordingStartTime(recordingId) {
  const name = path.basename(recordingId, path.extname(recordingId));
  const match = /^recording-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(name);
  if (!match) return null;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

async function repairDanglingClipLinks(folder) {
  const entries = [];
  for (const filePath of await findRecordingFiles(folder)) {
    const manifestPath = recordingManifestPathForVideo(filePath);
    try {
      const content = await fs.promises.readFile(manifestPath, "utf8");
      entries.push({
        filePath,
        manifestPath,
        manifest: JSON.parse(content),
      });
    } catch {
      // Recordings without readable metadata cannot be repaired here.
    }
  }

  const ids = new Set(entries.map(({ filePath }) => recordingIdForPath(filePath, folder)));
  for (const entry of entries) {
    const clip = entry.manifest?.clip;
    if (!clip || typeof clip.sourceRecordingId !== "string" || ids.has(clip.sourceRecordingId)) {
      continue;
    }
    const legacyStartTime = legacyRecordingStartTime(clip.sourceRecordingId);
    if (legacyStartTime == null) continue;

    const candidates = entries.filter((candidate) => {
      if (candidate.manifest?.clip) return false;
      const startedAt = Date.parse(String(candidate.manifest?.startedAt ?? ""));
      return Number.isFinite(startedAt) && Math.abs(startedAt - legacyStartTime) <= 2000;
    });
    if (candidates.length !== 1) continue;

    const source = candidates[0];
    clip.sourceRecordingId = recordingIdForPath(source.filePath, folder);
    clip.sourceRecordingName = path.basename(source.filePath);
    await fs.promises.writeFile(
      entry.manifestPath,
      JSON.stringify(entry.manifest, null, 2),
      "utf8",
    );
  }
}

function resolveRecordingPath(recordingId) {
  const folder = path.resolve(getObsSettings().recordDirectory);
  const decodedId = decodeURIComponent(String(recordingId ?? ""));
  const candidate = path.resolve(folder, decodedId);
  const relativeCandidate = path.relative(folder, candidate);
  if (
    !decodedId ||
    relativeCandidate.startsWith(".." + path.sep) ||
    relativeCandidate === ".." ||
    path.isAbsolute(relativeCandidate) ||
    !recordingExtensions.has(path.extname(candidate).toLowerCase())
  ) {
    throw new Error("Invalid recording path.");
  }
  return candidate;
}

async function processGameChapters(videoPath) {
  if (path.extname(videoPath).toLowerCase() !== ".mp4") {
    throw new Error("Game chapters are supported only for MP4 recordings.");
  }
  if (gameChapterJobs.has(videoPath))
    throw new Error("Game chapters are already being added to this recording.");
  if (manualChapterClipJobs.has(videoPath))
    throw new Error("Wait for F10 clip creation to finish before adding game chapters.");
  if (clipTrimJobs.has(videoPath)) throw new Error("Wait for the clip trim to finish.");
  if (
    pendingAutoRecordings.some(({ recording }) => recording.outputPath === videoPath) ||
    [...replayAttachmentsInProgress.keys()].some((recording) => recording.outputPath === videoPath)
  ) {
    throw new Error("Wait for replay linking to finish before adding game chapters.");
  }
  gameChapterJobs.add(videoPath);
  try {
    const manifest = JSON.parse(
      await fs.promises.readFile(recordingManifestPathForVideo(videoPath), "utf8"),
    );
    return await addGameChaptersToMp4({ executable: resolveFfmpegPath(), videoPath, manifest });
  } finally {
    gameChapterJobs.delete(videoPath);
  }
}

function queueFinalizedChapterJobs(recording) {
  // Snapshot this choice at stop, before replay linking can delay clip creation.
  const { autoClipManualChapters } = getCaptureSettings();
  const attempt = async () => {
    if (
      pendingAutoRecordings.some((pending) => pending.recording === recording) ||
      replayAttachmentsInProgress.has(recording) ||
      gameChapterJobs.has(recording.outputPath)
    ) {
      setTimeout(() => void attempt(), 2000);
      return;
    }
    if (!recording.outputPath) return;
    if (
      recording.source === "automatic" &&
      recording.manifestPath &&
      getCaptureSettings().autoGameChapters
    ) {
      const workId = `game-chapters:${recording.sessionId}`;
      setRecordingWork(workId, {
        title: "Adding game-start chapters",
        fileName: path.basename(recording.outputPath),
        detail: "Updating MP4 chapters",
      });
      try {
        const result = await processGameChapters(recording.outputPath);
        logRecordingDiagnostic("automatic-game-chapters-added", {
          outputPath: recording.outputPath,
          added: result.added,
          skipped: result.skipped,
          backupPath: result.backupPath,
        });
      } catch (error) {
        logRecordingDiagnostic("automatic-game-chapters-failed", {
          outputPath: recording.outputPath,
          error: obsErrorMessage(error),
        });
      } finally {
        clearRecordingWork(workId);
      }
    }
    if (!autoClipManualChapters) return;
    try {
      const result = await processManualChapterClips(recording.outputPath);
      logRecordingDiagnostic("automatic-manual-chapter-clips-complete", {
        outputPath: recording.outputPath,
        ...result,
      });
      if (result.created && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("recordings:changed");
      }
    } catch (error) {
      logRecordingDiagnostic("automatic-manual-chapter-clips-failed", {
        outputPath: recording.outputPath,
        error: obsErrorMessage(error),
      });
    }
  };
  setTimeout(() => void attempt(), 2000);
}

function recordingContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mkv":
      return "video/x-matroska";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".avi":
      return "video/x-msvideo";
    default:
      return "video/mp4";
  }
}

function createRecordingResponse(filePath, stat, request) {
  const fileSize = stat.size;
  const rangeHeader = request.headers.get("range");
  let start = 0;
  let end = Math.max(0, fileSize - 1);
  let status = 200;

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match || fileSize === 0) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }
    if (match[1] === "") {
      const suffixLength = Number(match[2]);
      start = Math.max(0, fileSize - suffixLength);
    } else {
      start = Number(match[1]);
      end = match[2] === "" ? end : Number(match[2]);
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= fileSize) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }
    end = Math.min(end, fileSize - 1);
    status = 206;
  }

  const contentLength = Math.max(0, end - start + 1);
  const headers = {
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
    "Content-Length": String(contentLength),
    "Content-Type": recordingContentType(filePath),
  };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${fileSize}`;
  if (request.method === "HEAD") return new Response(null, { status, headers });

  const fileStream = fs.createReadStream(filePath, { start, end });
  const body = new ReadableStream({
    start(controller) {
      fileStream.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
      fileStream.on("end", () => controller.close());
      fileStream.on("error", (error) => controller.error(error));
    },
    cancel() {
      fileStream.destroy();
    },
  });
  return new Response(body, { status, headers });
}

function recordingManifestPathForVideo(videoPath) {
  return path.join(path.dirname(videoPath), `${path.basename(videoPath)}.labatar.json`);
}

function resolveFfmpegPath() {
  if (typeof ffmpegStaticPath !== "string" || !ffmpegStaticPath) {
    throw new Error("The bundled FFmpeg encoder is unavailable.");
  }
  const unpackedPath = ffmpegStaticPath.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
  return fs.existsSync(unpackedPath) ? unpackedPath : ffmpegStaticPath;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), args, { windowsHide: true });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || `FFmpeg exited with code ${code}`));
    });
  });
}

const recordingFrameReaders = new Map();
let nextRecordingFrameReaderId = 1;
const MAX_CACHED_RECORDING_FRAMES = 120;
const MAX_BUFFERED_RECORDING_FRAMES = 24;

function rejectFrameReaderWaiters(reader, error) {
  for (const waiter of reader.waiters.values()) waiter.reject(error);
  reader.waiters.clear();
}

function pauseFrameReaderIfBuffered(reader) {
  if (
    reader.waiters.size === 0 &&
    !reader.stdoutPaused &&
    reader.frames.size >= MAX_BUFFERED_RECORDING_FRAMES
  ) {
    reader.child.stdout.pause();
    reader.stdoutPaused = true;
  }
}

function resolveRecordingFrame(reader, frame) {
  const frameIndex = reader.nextFrameIndex;
  reader.nextFrameIndex += 1;
  reader.frames.set(frameIndex, frame);
  while (reader.frames.size > MAX_CACHED_RECORDING_FRAMES) {
    const oldestFrameIndex = reader.frames.keys().next().value;
    reader.frames.delete(oldestFrameIndex);
  }

  const waiter = reader.waiters.get(frameIndex);
  if (waiter) {
    reader.waiters.delete(frameIndex);
    waiter.resolve({ frameIndex, data: frame.toString("base64") });
  }
  pauseFrameReaderIfBuffered(reader);
}

function consumeRecordingFrameBytes(reader, chunk) {
  reader.buffer = Buffer.concat([reader.buffer, chunk]);
  while (true) {
    const start = reader.buffer.indexOf(Buffer.from([0xff, 0xd8]));
    if (start < 0) {
      reader.buffer = reader.buffer.subarray(Math.max(0, reader.buffer.length - 1));
      return;
    }
    const end = reader.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
    if (end < 0) {
      if (start > 0) reader.buffer = reader.buffer.subarray(start);
      return;
    }
    resolveRecordingFrame(reader, reader.buffer.subarray(start, end + 2));
    reader.buffer = reader.buffer.subarray(end + 2);
  }
}

function closeRecordingFrameReader(sessionId) {
  const reader = recordingFrameReaders.get(sessionId);
  if (!reader) return false;
  recordingFrameReaders.delete(sessionId);
  rejectFrameReaderWaiters(reader, new Error("The frame reader was closed."));
  reader.child.stdout.removeAllListeners();
  reader.child.stderr.removeAllListeners();
  reader.child.removeAllListeners();
  if (!reader.child.killed) reader.child.kill();
  return true;
}

function openRecordingFrameReader(sourcePath) {
  const sessionId = `frame-reader-${nextRecordingFrameReaderId++}`;
  const child = spawn(
    resolveFfmpegPath(),
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-map",
      "0:v:0",
      "-an",
      "-fps_mode",
      "passthrough",
      "-f",
      "image2pipe",
      "-c:v",
      "mjpeg",
      "-q:v",
      "3",
      "pipe:1",
    ],
    { windowsHide: true },
  );
  const reader = {
    sessionId,
    child,
    buffer: Buffer.alloc(0),
    frames: new Map(),
    nextFrameIndex: 0,
    waiters: new Map(),
    stderr: "",
    stdoutPaused: false,
    ended: false,
  };
  recordingFrameReaders.set(sessionId, reader);
  child.stdout.on("data", (chunk) => consumeRecordingFrameBytes(reader, chunk));
  child.stderr.on("data", (chunk) => {
    reader.stderr += chunk.toString();
  });
  child.once("error", (error) => {
    reader.ended = true;
    rejectFrameReaderWaiters(reader, error);
  });
  child.once("close", (code) => {
    reader.ended = true;
    const error =
      code === 0
        ? new Error("The requested frame is past the end of the recording.")
        : new Error(reader.stderr.trim() || `FFmpeg exited with code ${code}`);
    rejectFrameReaderWaiters(reader, error);
  });
  return reader;
}

async function readRecordingFrame(request = {}) {
  const sessionId = String(request.sessionId ?? "");
  const frameIndex = Number(request.frameIndex);
  const reader = recordingFrameReaders.get(sessionId);
  if (!reader) throw new Error("The frame reader is no longer available.");
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new Error("The requested frame index is invalid.");
  }

  const cachedFrame = reader.frames.get(frameIndex);
  if (cachedFrame) return { frameIndex, data: cachedFrame.toString("base64") };
  if (frameIndex < reader.nextFrameIndex) {
    throw new Error("The requested frame is outside the review cache.");
  }
  if (reader.ended) throw new Error("The requested frame is past the end of the recording.");

  const result = new Promise((resolve, reject) => {
    reader.waiters.set(frameIndex, { resolve, reject });
  });
  if (reader.stdoutPaused) {
    reader.child.stdout.resume();
    reader.stdoutPaused = false;
  }
  return result;
}

function clipTimeForFilename(seconds) {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const milliseconds = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const second = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minute = totalMinutes % 60;
  const hour = Math.floor(totalMinutes / 60);
  return `${String(hour).padStart(2, "0")}-${String(minute).padStart(2, "0")}-${String(second).padStart(2, "0")}-${String(milliseconds).padStart(3, "0")}`;
}

async function availableRecordingPath(directory, baseName, extension = ".mp4") {
  let candidate = path.join(directory, `${baseName}${extension}`);
  let suffix = 2;
  while (true) {
    try {
      await fs.promises.access(candidate);
      candidate = path.join(directory, `${baseName} (${suffix})${extension}`);
      suffix += 1;
      continue;
    } catch {
      // Continue below and also avoid colliding with an orphaned sidecar.
    }
    try {
      await fs.promises.access(recordingManifestPathForVideo(candidate));
      candidate = path.join(directory, `${baseName} (${suffix})${extension}`);
      suffix += 1;
    } catch {
      return candidate;
    }
  }
}

const clipExportSourceCounts = new Map();

async function exportRecordingClip(request = {}, options = {}) {
  const recordingId = String(request.recordingId ?? "");
  const sourcePath = resolveRecordingPath(recordingId);
  if (clipTrimJobs.has(sourcePath)) {
    throw new Error("Wait for this clip's trim to finish before exporting from it.");
  }
  clipExportSourceCounts.set(sourcePath, (clipExportSourceCounts.get(sourcePath) ?? 0) + 1);
  try {
    return await exportRecordingClipFromSource(request, options, sourcePath);
  } finally {
    const remaining = (clipExportSourceCounts.get(sourcePath) ?? 1) - 1;
    if (remaining > 0) clipExportSourceCounts.set(sourcePath, remaining);
    else clipExportSourceCounts.delete(sourcePath);
  }
}

async function exportRecordingClipFromSource(request, options, sourcePath) {
  const sourceStat = await fs.promises.stat(sourcePath).catch(() => null);
  if (!sourceStat?.isFile()) throw new Error("The source recording no longer exists.");

  const startTime = Number(request.startTime);
  const endTime = Number(request.endTime);
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    startTime < 0 ||
    endTime <= startTime
  ) {
    throw new Error("The clip range is invalid.");
  }

  const folder = path.resolve(getObsSettings().recordDirectory);
  await fs.promises.mkdir(folder, { recursive: true });
  const sourceRecordingName = path.basename(sourcePath);
  const sourceStem = safeRecordingNamePart(
    path.basename(sourcePath, path.extname(sourcePath)),
    "recording",
  );
  const rangeLabel = `${clipTimeForFilename(startTime)} to ${clipTimeForFilename(endTime)}`;
  const baseName = `${sourceStem} - ${Number.isFinite(options.manualChapterStartMs) ? "F10 clip" : "clip"} ${rangeLabel}`;
  const outputPath = await availableRecordingPath(folder, baseName);
  const duration = endTime - startTime;

  try {
    await runFfmpeg(buildClipExportFfmpegArgs({ sourcePath, startTime, duration, outputPath }));
  } catch (error) {
    await fs.promises.rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  }

  const outputId = path.relative(folder, outputPath).split(path.sep).join("/");
  const clip = {
    sourceRecordingId: path.relative(folder, sourcePath).split(path.sep).join("/"),
    sourceRecordingName,
    startTime,
    endTime,
    createdAt: new Date().toISOString(),
    ...(Number.isFinite(options.manualChapterStartMs)
      ? { manualChapterStartMs: options.manualChapterStartMs }
      : {}),
  };
  const manifestPath = recordingManifestPathForVideo(outputPath);
  try {
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          createdAt: clip.createdAt,
          outputPath,
          metadata: null,
          games: [],
          replays: [],
          tags: { match: [], lab: [], combo: false, pressure: false },
          clip,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (error) {
    await fs.promises.rm(outputPath, { force: true }).catch(() => undefined);
    throw new Error(
      `Clip was encoded but its metadata could not be saved: ${obsErrorMessage(error)}`,
    );
  }

  const stat = await fs.promises.stat(outputPath);
  return {
    id: outputId,
    name: path.basename(outputPath),
    url: `labatar-media://recording/${encodeURIComponent(outputId)}`,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    metadata: null,
    games: [],
    replays: [],
    tags: { match: [], lab: [], combo: false, pressure: false },
    replayPath: null,
    replayFileName: null,
    clip,
  };
}

const clipTrimJobs = new Set();

async function trimRecordingClip(request = {}) {
  const videoPath = resolveRecordingPath(String(request.recordingId ?? ""));
  if (path.extname(videoPath).toLowerCase() !== ".mp4") {
    throw new Error("Only MP4 clips can be trimmed in place.");
  }
  if (clipTrimJobs.has(videoPath)) throw new Error("This clip is already being trimmed.");
  if (clipExportSourceCounts.has(videoPath)) {
    throw new Error("Wait for clip export to finish before trimming its source.");
  }
  if (gameChapterJobs.has(videoPath) || manualChapterClipJobs.has(videoPath)) {
    throw new Error("Wait for chapter or clip processing to finish before trimming.");
  }
  if (
    obsState.recording.active &&
    [obsState.recording.outputPath, activeObsRecording?.outputPath].includes(videoPath)
  ) {
    throw new Error("Stop recording before trimming this clip.");
  }
  clipTrimJobs.add(videoPath);
  let tempFolder = null;
  try {
    const sourceEntry = await fs.promises.lstat(videoPath);
    if (!sourceEntry.isFile()) throw new Error("The clip must be a regular file, not a link.");
    const originalStat = await fs.promises.stat(videoPath);
    if (!originalStat.isFile()) throw new Error("The clip no longer exists.");
    const manifestPath = recordingManifestPathForVideo(videoPath);
    const manifestEntry = await fs.promises.lstat(manifestPath);
    if (!manifestEntry.isFile()) throw new Error("The clip metadata must be a regular file.");
    const originalManifestContent = await fs.promises.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(originalManifestContent);
    if (!manifest?.clip) throw new Error("Only clips can be trimmed in place.");
    const folder = path.resolve(getObsSettings().recordDirectory);
    const recordingId = recordingIdForPath(videoPath, folder);
    for (const filePath of await findRecordingFiles(folder)) {
      if (filePath === videoPath) continue;
      const childManifest = await fs.promises
        .readFile(recordingManifestPathForVideo(filePath), "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (childManifest?.clip?.sourceRecordingId === recordingId) {
        throw new Error("This clip has child clips. Remove or export them before trimming it.");
      }
    }
    const executable = resolveFfmpegPath();
    const probe = await probeChapters(executable, videoPath);
    const startTime = Number(request.startTime);
    const endTime = Number(request.endTime);
    const nextManifest = planClipTrim(manifest, startTime, endTime, probe.durationMs);
    tempFolder = await fs.promises.mkdtemp(path.join(path.dirname(videoPath), ".labatar-trim-"));
    const candidateVideoPath = path.join(tempFolder, "clip.mp4");
    const candidateManifestPath = path.join(tempFolder, "clip.labatar.json");
    await runFfmpeg(
      buildClipExportFfmpegArgs({
        sourcePath: videoPath,
        startTime,
        duration: endTime - startTime,
        outputPath: candidateVideoPath,
      }),
    );
    const candidateStat = await fs.promises.stat(candidateVideoPath);
    const candidateProbe = await probeChapters(executable, candidateVideoPath);
    if (
      !candidateStat.isFile() ||
      candidateStat.size === 0 ||
      !Number.isFinite(candidateProbe.durationMs) ||
      Math.abs(candidateProbe.durationMs - (endTime - startTime) * 1000) > 500 ||
      candidateProbe.chapters.length > 0
    ) {
      throw new Error("The trimmed clip failed verification; the original was not replaced.");
    }
    await fs.promises.writeFile(
      candidateManifestPath,
      JSON.stringify(nextManifest, null, 2),
      "utf8",
    );
    const backup = await replaceClipWithBackup({
      videoPath,
      manifestPath,
      candidateVideoPath,
      candidateManifestPath,
      originalStat,
      originalManifestContent,
    });
    return { recording: await getRecordedVideoForPath(videoPath), ...backup };
  } finally {
    clipTrimJobs.delete(videoPath);
    if (tempFolder) {
      await fs.promises.unlink(path.join(tempFolder, "clip.mp4")).catch(() => undefined);
      await fs.promises.unlink(path.join(tempFolder, "clip.labatar.json")).catch(() => undefined);
      await fs.promises.rmdir(tempFolder).catch(() => undefined);
    }
  }
}

async function processManualChapterClips(videoPath) {
  if (path.extname(videoPath).toLowerCase() !== ".mp4") {
    throw new Error("F10 chapter clips require an MP4 recording.");
  }
  if (clipTrimJobs.has(videoPath)) throw new Error("Wait for the clip trim to finish.");
  if (manualChapterClipJobs.has(videoPath)) return manualChapterClipJobs.get(videoPath);
  if (gameChapterJobs.has(videoPath)) {
    throw new Error("Wait for game chapter processing to finish before creating F10 clips.");
  }
  if (
    pendingAutoRecordings.some(({ recording }) => recording.outputPath === videoPath) ||
    [...replayAttachmentsInProgress.keys()].some((recording) => recording.outputPath === videoPath)
  ) {
    throw new Error("Wait for replay linking to finish before creating F10 clips.");
  }
  if (
    obsState.recording.active &&
    [obsState.recording.outputPath, activeObsRecording?.outputPath].some(
      (currentPath) => currentPath && path.resolve(currentPath) === path.resolve(videoPath),
    )
  ) {
    throw new Error("Stop the recording before creating F10 clips.");
  }
  const workId = `manual-clips:${videoPath}`;
  setRecordingWork(workId, {
    title: "Creating clips from manual chapters",
    fileName: path.basename(videoPath),
    detail: "Finding manual chapters and existing clips",
  });
  const job = (async () => {
    const sourceStat = await fs.promises.stat(videoPath).catch(() => null);
    if (!sourceStat?.isFile()) throw new Error("The source recording no longer exists.");
    const { chapters, durationMs } = await probeChapters(resolveFfmpegPath(), videoPath);
    const folder = path.resolve(getObsSettings().recordDirectory);
    const sourceId = recordingIdForPath(videoPath, folder);
    const existingStarts = new Set();
    for (const filePath of await findRecordingFiles(folder)) {
      if (path.extname(filePath).toLowerCase() !== ".mp4") continue;
      let manifest;
      try {
        manifest = JSON.parse(
          await fs.promises.readFile(recordingManifestPathForVideo(filePath), "utf8"),
        );
      } catch {
        continue;
      }
      if (
        manifest.clip?.sourceRecordingId === sourceId &&
        Number.isFinite(manifest.clip.manualChapterStartMs)
      ) {
        existingStarts.add(manifest.clip.manualChapterStartMs);
      }
    }
    return createMissingManualChapterClips(
      chapters,
      durationMs,
      existingStarts,
      (range) =>
        exportRecordingClip(
          { recordingId: sourceId, startTime: range.startTime, endTime: range.endTime },
          { manualChapterStartMs: range.chapterStartMs },
        ),
      ({ index, total, range, phase }) => {
        const time = `${clipTimeForFilename(range.startTime)}–${clipTimeForFilename(range.endTime)}`;
        setRecordingWork(workId, {
          detail:
            phase === "creating"
              ? `Encoding clip ${index} of ${total} (${time})`
              : `${index} of ${total} checked (${time}; ${phase})`,
          completed: phase === "creating" ? index - 1 : index,
          total,
        });
      },
    );
  })();
  manualChapterClipJobs.set(videoPath, job);
  try {
    return await job;
  } finally {
    if (manualChapterClipJobs.get(videoPath) === job) manualChapterClipJobs.delete(videoPath);
    clearRecordingWork(workId);
  }
}

async function renameRecording(request = {}, updateManifest = null) {
  const recordingId = String(request.recordingId ?? "");
  const currentPath = resolveRecordingPath(recordingId);
  const currentStat = await fs.promises.stat(currentPath).catch(() => null);
  if (!currentStat?.isFile()) throw new Error("The recording no longer exists.");

  const manifestPath = recordingManifestPathForVideo(currentPath);
  const hasManifest = await fs.promises
    .access(manifestPath)
    .then(() => true)
    .catch(() => false);
  let manifest = null;
  if (hasManifest) {
    try {
      manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
    } catch {
      throw new Error("The recording metadata could not be read.");
    }
    updateManifest?.(manifest);
  }

  const requestedName = String(request.name ?? "").trim();
  if (!requestedName) throw new Error("A recording name is required.");
  const extension = path.extname(currentPath);
  const requestedExtension = path.extname(requestedName);
  const requestedBaseName =
    extension && requestedExtension.toLowerCase() === extension.toLowerCase()
      ? requestedName.slice(0, -requestedExtension.length)
      : requestedName;
  const baseName = safeRecordingNamePart(requestedBaseName, "");
  if (!baseName) throw new Error("A valid recording name is required.");

  const folder = path.resolve(getObsSettings().recordDirectory);
  const previousId = recordingIdForPath(currentPath, folder);
  const targetPath = path.resolve(folder, `${baseName}${extension}`);
  if (path.resolve(targetPath).toLowerCase() === path.resolve(currentPath).toLowerCase()) {
    if (updateManifest) {
      await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    }
    return getRecordedVideoForPath(targetPath, folder);
  }
  const availableTargetPath = await availableRecordingPath(folder, baseName, extension);
  const nextId = recordingIdForPath(availableTargetPath, folder);
  const nextName = path.basename(availableTargetPath);
  const targetManifestPath = recordingManifestPathForVideo(availableTargetPath);

  await fs.promises.rename(currentPath, availableTargetPath);
  let updatedLinkedManifests = [];
  try {
    if (hasManifest) {
      await fs.promises.rename(manifestPath, targetManifestPath);
      manifest.outputPath = availableTargetPath;
      manifest.outputFileName = path.basename(availableTargetPath);
      await fs.promises.writeFile(targetManifestPath, JSON.stringify(manifest, null, 2), "utf8");
    }
    updatedLinkedManifests = await updateLinkedClipManifests(folder, previousId, nextId, nextName);
  } catch (error) {
    for (const { manifestPath, originalContent } of updatedLinkedManifests.reverse()) {
      await fs.promises.writeFile(manifestPath, originalContent, "utf8").catch(() => undefined);
    }
    await fs.promises.rename(availableTargetPath, currentPath).catch(() => undefined);
    if (hasManifest) {
      await fs.promises.rename(targetManifestPath, manifestPath).catch(() => undefined);
    }
    throw new Error(`The recording was not fully renamed: ${obsErrorMessage(error)}`);
  }
  return getRecordedVideoForPath(availableTargetPath, folder);
}

async function reprocessAutomaticRecordingName(request = {}) {
  const recordingId = String(request.recordingId ?? "");
  const currentPath = resolveRecordingPath(recordingId);
  const currentStat = await fs.promises.stat(currentPath).catch(() => null);
  if (!currentStat?.isFile()) throw new Error("The recording no longer exists.");
  let manifest;
  try {
    manifest = JSON.parse(
      await fs.promises.readFile(recordingManifestPathForVideo(currentPath), "utf8"),
    );
  } catch {
    throw new Error("The recording metadata could not be read.");
  }
  if (manifest.source !== "automatic") {
    throw new Error("Only automatic recordings can rebuild their names.");
  }
  const firstGame = manifest.games?.[0];
  if (!firstGame?.matchId) {
    throw new Error("This recording has no first game in its metadata.");
  }
  const savedReplay = manifest.replays?.find((entry) => entry.matchId === firstGame.matchId);
  const replayPath = firstGame.replayPath || savedReplay?.replayPath;
  if (
    firstGame.replayPath &&
    savedReplay?.replayPath &&
    path.resolve(firstGame.replayPath) !== path.resolve(savedReplay.replayPath)
  ) {
    throw new Error("The first game's replay links disagree. The recording was not changed.");
  }
  let replay = null;
  if (replayPath) {
    const alternate = replayStagingStore().alternateSavedPath(replayPath);
    for (const candidate of [replayPath, alternate].filter(Boolean)) {
      const parsed = await parseReplayFile(candidate, path.dirname(candidate)).catch(() => null);
      if (parsed && replayMatchesGame(firstGame, parsed, formatCharacter)) {
        replay = parsed;
        break;
      }
    }
  }
  replay ??= firstGame.replay ?? savedReplay?.replay ?? null;
  if (!replay) {
    throw new Error("The first game's replay is unavailable. Its name cannot be rebuilt.");
  }
  if (!replayMatchesGame(firstGame, replay, formatCharacter)) {
    throw new Error(
      "The first game's replay does not match its recorded characters. The recording was not changed.",
    );
  }
  const lobbyId = firstGame.lobbyId || manifest.metadata?.lobbyId;
  const setNumber = await opponentSetHistory.historicalSetNumberForLobby(lobbyId);
  if (!setNumber) {
    throw new Error(
      "The historical set number could not be verified from available game logs. The recording was not changed.",
    );
  }
  const setLabel = `set ${setNumber}`;
  const name = recordingSetBaseName(
    { ...(manifest.metadata ?? firstGame.metadata), setLabel },
    replay,
  );
  const updateManifest = (currentManifest) => {
    currentManifest.metadata = {
      ...(currentManifest.metadata ?? currentManifest.games?.[0]?.metadata),
      setLabel,
    };
    for (const game of currentManifest.games ?? []) {
      game.setNumber = setNumber;
      game.metadata = { ...game.metadata, setLabel };
    }
  };
  const currentBaseName = path.basename(currentPath, path.extname(currentPath));
  if (
    currentBaseName === name ||
    (currentBaseName.startsWith(`${name} (`) &&
      /^\d+\)$/.test(currentBaseName.slice(name.length + 2)))
  ) {
    return renameRecording({ recordingId, name: currentBaseName }, updateManifest);
  }
  return renameRecording(
    {
      recordingId,
      name,
    },
    updateManifest,
  );
}

async function deleteRecording(request = {}) {
  const recordingId = String(request.recordingId ?? "");
  const currentPath = resolveRecordingPath(recordingId);
  const currentStat = await fs.promises.stat(currentPath).catch(() => null);
  if (!currentStat?.isFile()) throw new Error("The recording no longer exists.");

  await fs.promises.rm(currentPath, { force: true });
  await fs.promises.rm(recordingManifestPathForVideo(currentPath), { force: true });
  return { id: recordingId };
}

async function deletePendingMoveRecording(request = {}) {
  if (automaticMoveRunIsOpen()) {
    throw new Error("Finish or cancel the automatic capture pass before deleting a move video.");
  }
  const recordingId = String(request.recordingId ?? "");
  const currentPath = resolveRecordingPath(recordingId);
  const currentStat = await fs.promises.stat(currentPath).catch(() => null);
  if (!currentStat?.isFile()) throw new Error("The recording no longer exists.");
  let manifest;
  try {
    manifest = JSON.parse(
      await fs.promises.readFile(recordingManifestPathForVideo(currentPath), "utf8"),
    );
  } catch {
    throw new Error("The move recording metadata could not be read.");
  }
  const take = readMoveTake(manifest.moveTake);
  if (take?.status !== "captured" || take.evidenceStatus !== "pending" || manifest.analysis) {
    throw new Error("Only captured, pending, unprocessed move recordings can be deleted here.");
  }
  const result = await deleteRecording({ recordingId });
  if (canSendToRenderer()) mainWindow.webContents.send("recordings:changed");
  return result;
}

async function setRecordingTags(request = {}) {
  const recordingId = String(request.recordingId ?? "");
  const currentPath = resolveRecordingPath(recordingId);
  const currentStat = await fs.promises.stat(currentPath).catch(() => null);
  if (!currentStat?.isFile()) throw new Error("The recording no longer exists.");

  const manifestPath = recordingManifestPathForVideo(currentPath);
  let manifest;
  try {
    manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  } catch {
    manifest = {
      schemaVersion: 1,
      outputPath: currentPath,
      metadata: null,
      games: [],
      replays: [],
    };
  }
  manifest.tags = normalizeRecordingTags(request.tags);
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return getRecordedVideoForPath(currentPath);
}

async function setRecordingYouTubeLink(request = {}) {
  const recordingId = String(request.recordingId ?? "");
  const currentPath = resolveRecordingPath(recordingId);
  const currentStat = await fs.promises.stat(currentPath).catch(() => null);
  if (!currentStat?.isFile()) throw new Error("The recording no longer exists.");

  const youtubeUrl = request.url === null ? null : normalizeYouTubeVideoUrl(request.url);
  const manifestPath = recordingManifestPathForVideo(currentPath);
  let manifest;
  try {
    manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error("The recording metadata could not be read.");
    }
    manifest = {
      schemaVersion: 1,
      outputPath: currentPath,
      metadata: null,
      games: [],
      replays: [],
    };
  }
  if (youtubeUrl) manifest.youtubeUrl = youtubeUrl;
  else delete manifest.youtubeUrl;
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return getRecordedVideoForPath(currentPath);
}

async function saveRecordingAnalysis(request = {}) {
  const recordingId = String(request.recordingId ?? "");
  const currentPath = resolveRecordingPath(recordingId);
  const currentStat = await fs.promises.stat(currentPath).catch(() => null);
  if (!currentStat?.isFile()) throw new Error("The recording no longer exists.");

  const analysis = request.analysis;
  if (!analysis || analysis.schemaVersion !== 1 || !Array.isArray(analysis.moves)) {
    throw new Error("Invalid recording analysis.");
  }
  const manifestPath = recordingManifestPathForVideo(currentPath);
  let manifest;
  try {
    manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  } catch {
    manifest = {
      schemaVersion: 1,
      outputPath: currentPath,
      metadata: null,
      games: [],
      replays: [],
    };
  }
  if (manifest.analysis) {
    manifest.analysisHistory = Array.isArray(manifest.analysisHistory)
      ? [...manifest.analysisHistory, manifest.analysis]
      : [manifest.analysis];
  }
  if (
    manifest.moveTake?.captureMethod === "automated" &&
    manifest.moveTake.captureReviewStatus !== "approved-for-processing"
  ) {
    throw new Error("Review and approve this automated video before processing it.");
  }
  manifest.analysis = analysis;
  if (manifest.moveTake && typeof manifest.moveTake === "object") {
    manifest.moveTake.validation = validateMoveTake(manifest.moveTake, analysis);
  }
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return getRecordedVideoForPath(currentPath);
}

async function setMoveTakeEvidence(request = {}) {
  const recordingId = String(request.recordingId ?? "");
  const action = String(request.action ?? "");
  if (action !== "accept" && action !== "archive") throw new Error("Invalid evidence action.");
  const currentPath = resolveRecordingPath(recordingId);
  const currentStat = await fs.promises.stat(currentPath).catch(() => null);
  if (!currentStat?.isFile()) throw new Error("The recording no longer exists.");
  const manifestPath = recordingManifestPathForVideo(currentPath);
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  const take = readMoveTake(manifest.moveTake);
  if (!take) throw new Error("This recording is not a move take.");
  if (action === "accept") {
    if (
      take.captureMethod === "automated" &&
      take.captureReviewStatus !== "approved-for-processing"
    ) {
      throw new Error("Review and approve this automated video before accepting evidence.");
    }
    if (!manifest.analysis) throw new Error("Process this take before accepting its evidence.");
    if (
      !take.validation.matchedAnalysisMoveId ||
      !manifest.analysis.moves.some((move) => move.id === take.validation.matchedAnalysisMoveId)
    ) {
      throw new Error("No analyzed move is linked to this take. Reprocess or record it again.");
    }
    if (take.validation.status === "mismatch") {
      throw new Error("The observed input differs from the selected move. Review or retry it.");
    }
    const folder = path.resolve(getObsSettings().recordDirectory);
    const files = await findRecordingFiles(folder);
    for (const filePath of files) {
      if (path.resolve(filePath) === path.resolve(currentPath)) continue;
      const otherManifestPath = recordingManifestPathForVideo(filePath);
      let other;
      try {
        other = JSON.parse(await fs.promises.readFile(otherManifestPath, "utf8"));
      } catch {
        continue;
      }
      const otherTake = readMoveTake(other.moveTake);
      if (
        otherTake?.catalogMoveId !== take.catalogMoveId ||
        otherTake.outcome !== take.outcome ||
        otherTake.evidenceStatus !== "active"
      )
        continue;
      other.moveTake.evidenceStatus = "archived";
      other.moveTake.evidenceReason = `Replaced by ${take.id}.`;
      other.moveTake.reviewedAt = new Date().toISOString();
      await fs.promises.writeFile(otherManifestPath, JSON.stringify(other, null, 2), "utf8");
    }
  }
  manifest.moveTake.evidenceStatus = action === "accept" ? "active" : "archived";
  manifest.moveTake.evidenceReason =
    action === "archive" ? String(request.reason ?? "Retake requested.").trim() : null;
  manifest.moveTake.reviewedAt = new Date().toISOString();
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return getRecordedVideoForPath(currentPath);
}

async function reviewAutomaticMoveVideo(request = {}) {
  const recordingId = String(request.recordingId ?? "");
  const action = String(request.action ?? "");
  if (action !== "approve" && action !== "reject") throw new Error("Invalid video review action.");
  const currentPath = resolveRecordingPath(recordingId);
  const currentStat = await fs.promises.stat(currentPath).catch(() => null);
  if (!currentStat?.isFile()) throw new Error("The recording no longer exists.");
  const manifestPath = recordingManifestPathForVideo(currentPath);
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  const take = readMoveTake(manifest.moveTake);
  if (take?.captureMethod !== "automated") {
    throw new Error("This is not an automated move video.");
  }
  if (take.evidenceStatus !== "pending") {
    throw new Error("Only pending automated videos can be reviewed here.");
  }
  if (action === "reject") {
    const reason = String(request.reason ?? "").trim();
    if (!reason) throw new Error("Give a reason before rejecting the video.");
    manifest.moveTake.captureReviewStatus = "rejected";
    manifest.moveTake.captureReviewReason = reason;
    manifest.moveTake.evidenceStatus = "archived";
    manifest.moveTake.evidenceReason = `Video review: ${reason}`;
  } else {
    manifest.moveTake.captureReviewStatus = "approved-for-processing";
    manifest.moveTake.captureReviewReason = null;
  }
  manifest.moveTake.captureReviewedAt = new Date().toISOString();
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return getRecordedVideoForPath(currentPath);
}

async function getRecordedVideoForPath(
  filePath,
  folder = path.resolve(getObsSettings().recordDirectory),
) {
  const stat = await fs.promises.stat(filePath);
  const id = path.relative(folder, filePath).split(path.sep).join("/");
  const manifest = await readRecordingManifest(filePath);
  return {
    id,
    name: path.basename(filePath),
    url: `labatar-media://recording/${encodeURIComponent(id)}`,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    ...manifest,
  };
}

function readMoveTake(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const expectedInputs = Array.isArray(value.expectedInputs)
    ? value.expectedInputs.filter((input) => typeof input === "string" && input.trim())
    : [];
  const outcome = typeof value.outcome === "string" ? value.outcome : "";
  if (
    !["whiff", "block", "hit", "hit-grounded", "hit-airborne"].includes(outcome) ||
    typeof value.id !== "string" ||
    typeof value.catalogMoveId !== "string" ||
    typeof value.characterId !== "string" ||
    typeof value.characterLabel !== "string" ||
    typeof value.moveId !== "string" ||
    typeof value.moveLabel !== "string" ||
    typeof value.armedAt !== "string" ||
    expectedInputs.length === 0
  ) {
    return null;
  }
  const validation =
    value.validation && typeof value.validation === "object" ? value.validation : {};
  const statuses = new Set(["unprocessed", "verified", "mismatch", "ambiguous", "unresolved"]);
  const validationStatus = statuses.has(validation.status) ? validation.status : "unprocessed";
  return {
    id: value.id,
    catalogMoveId: value.catalogMoveId,
    characterId: value.characterId,
    characterLabel: value.characterLabel,
    moveId: value.moveId,
    moveLabel: value.moveLabel,
    expectedInputs,
    // Historical takes predate stance and charge metadata.
    isStance: value.isStance === true,
    isCharged: value.isCharged === true,
    outcome,
    armedAt: value.armedAt,
    status: value.status === "recording" ? "recording" : "captured",
    recordedAt: typeof value.recordedAt === "string" ? value.recordedAt : null,
    storageError: typeof value.storageError === "string" ? value.storageError : null,
    evidenceStatus: ["pending", "active", "archived"].includes(value.evidenceStatus)
      ? value.evidenceStatus
      : "pending",
    evidenceReason: typeof value.evidenceReason === "string" ? value.evidenceReason : null,
    reviewedAt: typeof value.reviewedAt === "string" ? value.reviewedAt : null,
    captureMethod: value.captureMethod === "automated" ? "automated" : null,
    captureRunId: typeof value.captureRunId === "string" ? value.captureRunId : null,
    captureRecipe:
      value.captureRecipe && typeof value.captureRecipe === "object" ? value.captureRecipe : null,
    captureReviewStatus:
      value.captureMethod === "automated" &&
      ["awaiting-video-review", "approved-for-processing", "rejected"].includes(
        value.captureReviewStatus,
      )
        ? value.captureReviewStatus
        : value.captureMethod === "automated"
          ? "awaiting-video-review"
          : null,
    captureReviewReason:
      typeof value.captureReviewReason === "string" ? value.captureReviewReason : null,
    captureReviewedAt: typeof value.captureReviewedAt === "string" ? value.captureReviewedAt : null,
    validation: {
      status: validationStatus,
      message:
        typeof validation.message === "string"
          ? validation.message
          : "Processing has not yet compared this take with its expected input.",
      expectedInputs: Array.isArray(validation.expectedInputs)
        ? validation.expectedInputs.filter((input) => typeof input === "string" && input.trim())
        : expectedInputs,
      observedInputs: Array.isArray(validation.observedInputs)
        ? validation.observedInputs.filter((input) => typeof input === "string" && input.trim())
        : [],
      matchedAnalysisMoveId:
        typeof validation.matchedAnalysisMoveId === "string"
          ? validation.matchedAnalysisMoveId
          : null,
      processedAt: typeof validation.processedAt === "string" ? validation.processedAt : null,
    },
  };
}

async function readRecordingManifest(videoPath, analysisScope = "all") {
  try {
    const content = await fs.promises.readFile(recordingManifestPathForVideo(videoPath), "utf8");
    const manifest = JSON.parse(content);
    const clip = manifest?.clip;
    const startTime = Number(clip?.startTime);
    const endTime = Number(clip?.endTime);
    const moveTake = readMoveTake(manifest?.moveTake);
    return {
      source:
        manifest?.source === "automatic"
          ? "automatic"
          : manifest?.source === "manual"
            ? "manual"
            : null,
      metadata: manifest?.metadata ?? null,
      games: Array.isArray(manifest?.games) ? manifest.games : [],
      replays: Array.isArray(manifest?.replays) ? manifest.replays : [],
      analysis:
        (analysisScope === "all" || (analysisScope === "move-takes" && moveTake)) &&
        manifest?.analysis?.schemaVersion === 1
          ? manifest.analysis
          : null,
      analysisHistory: (analysisScope === "all" && Array.isArray(manifest?.analysisHistory)
        ? manifest.analysisHistory
        : []
      )
        .filter((analysis) => analysis?.schemaVersion === 1)
        .map((analysis) => ({
          processedAt: typeof analysis.processedAt === "string" ? analysis.processedAt : "unknown",
          inputs: Array.isArray(analysis.inputEvents)
            ? analysis.inputEvents
                .map((event) => event.notation)
                .filter((value) => typeof value === "string")
            : [],
          moves: Array.isArray(analysis.moves)
            ? analysis.moves.map((move) => ({
                notation: typeof move.notation === "string" ? move.notation : null,
                startTime: Number(move.startTime) || 0,
                endTime: Number(move.endTime) || 0,
              }))
            : [],
          warnings: Array.isArray(analysis.warnings) ? analysis.warnings : [],
          processorVersion: analysis.processingSnapshot?.processorVersion ?? null,
          processorFingerprint: analysis.processingSnapshot?.processorFingerprint ?? null,
        })),
      tags: normalizeRecordingTags(manifest?.tags, manifest?.metadata),
      replayPath: typeof manifest?.replayPath === "string" ? manifest.replayPath : null,
      replayFileName: typeof manifest?.replayFileName === "string" ? manifest.replayFileName : null,
      youtubeUrl: readYouTubeVideoUrl(manifest?.youtubeUrl),
      moveTake,
      clip:
        typeof clip?.sourceRecordingId === "string" &&
        clip.sourceRecordingId.trim() &&
        typeof clip?.sourceRecordingName === "string" &&
        clip.sourceRecordingName.trim() &&
        Number.isFinite(startTime) &&
        Number.isFinite(endTime) &&
        endTime >= startTime
          ? {
              sourceRecordingId: clip.sourceRecordingId.trim(),
              sourceRecordingName: clip.sourceRecordingName.trim(),
              startTime: Math.max(0, startTime),
              endTime: Math.max(0, endTime),
              createdAt: typeof clip.createdAt === "string" ? clip.createdAt : null,
              ...(Number.isFinite(clip.manualChapterStartMs)
                ? { manualChapterStartMs: clip.manualChapterStartMs }
                : {}),
            }
          : null,
    };
  } catch {
    return {
      source: null,
      metadata: null,
      games: [],
      replays: [],
      analysis: null,
      analysisHistory: [],
      tags: { match: [], lab: [], combo: false, pressure: false },
      replayPath: null,
      replayFileName: null,
      youtubeUrl: null,
      moveTake: null,
      clip: null,
    };
  }
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

const REPLAY_SCAN_CACHE_VERSION = 1;

let replayScanCache = {
  folderKey: null,
  folderPath: null,
  replayFiles: new Map(),
  ratingLogs: new Map(),
  snapshot: null,
  loaded: false,
  loadPromise: null,
  dirty: false,
};

function replayScanCacheFor(folder) {
  const folderKey = path.resolve(folder).toLowerCase();
  if (replayScanCache.folderKey !== folderKey) {
    replayScanCache = {
      folderKey,
      folderPath: path.resolve(folder),
      replayFiles: new Map(),
      ratingLogs: new Map(),
      snapshot: null,
      loaded: false,
      loadPromise: null,
      dirty: false,
    };
  }
  return replayScanCache;
}

function replayScanCachePath(folder) {
  const key = createHash("sha256")
    .update(path.resolve(folder).toLowerCase())
    .digest("hex")
    .slice(0, 20);
  return path.join(app.getPath("userData"), `replay-scan-cache-${key}.json`);
}

async function loadReplayScanCache(folder) {
  const cache = replayScanCacheFor(folder);
  if (cache.loaded) return cache;
  if (!cache.loadPromise) {
    cache.loadPromise = (async () => {
      try {
        const stored = JSON.parse(await fs.promises.readFile(replayScanCachePath(folder), "utf8"));
        if (
          stored?.version !== REPLAY_SCAN_CACHE_VERSION ||
          typeof stored.folder !== "string" ||
          path.resolve(stored.folder).toLowerCase() !== cache.folderKey ||
          !Array.isArray(stored.replayFiles) ||
          !Array.isArray(stored.ratingLogs) ||
          !Array.isArray(stored.snapshot?.games) ||
          !stored.snapshot.playerCounts ||
          typeof stored.snapshot.playerCounts !== "object"
        ) {
          return cache;
        }
        cache.replayFiles = new Map(stored.replayFiles);
        cache.ratingLogs = new Map(
          stored.ratingLogs.map(([key, entry]) => [
            key,
            { ...entry, ratings: new Map(entry.ratings) },
          ]),
        );
        cache.snapshot = stored.snapshot;
      } catch {
        // A missing or unreadable cache falls back to a regular first scan.
      } finally {
        cache.loaded = true;
      }
      return cache;
    })();
  }
  await Promise.resolve(cache.loadPromise);
  return cache;
}

async function saveReplayScanCache(cache) {
  if (!cache.dirty || !cache.folderPath) return;
  const filePath = replayScanCachePath(cache.folderPath);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const stored = {
    version: REPLAY_SCAN_CACHE_VERSION,
    folder: cache.folderPath,
    replayFiles: [...cache.replayFiles],
    ratingLogs: [...cache.ratingLogs].map(([key, entry]) => [
      key,
      { fingerprint: entry.fingerprint, ratings: [...entry.ratings] },
    ]),
    snapshot: cache.snapshot,
  };
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.promises.writeFile(temporaryPath, JSON.stringify(stored));
    await fs.promises.rename(temporaryPath, filePath);
    cache.dirty = false;
  } finally {
    await fs.promises.unlink(temporaryPath).catch(() => {});
  }
}

function replayFileCacheKey(filePath, stat) {
  const hasFileIdentity = Number.isFinite(stat.ino) && stat.ino !== 0;
  return hasFileIdentity ? `${stat.dev}:${stat.ino}` : path.resolve(filePath).toLowerCase();
}

function replayFileFingerprint(stat) {
  return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

let replayScanCount = 0;
let replayStagingBusy = false;
ipcMain.handle("replays:get-cached-scan", async (_, folder) => {
  if (!folder || !fs.existsSync(folder)) return null;
  const resolvedFolder = path.resolve(folder);
  if (!fs.statSync(resolvedFolder).isDirectory()) return null;
  const cache = await loadReplayScanCache(resolvedFolder);
  return cache.snapshot;
});

ipcMain.handle("replays:scan-folder", async (event, folder) => {
  if (replayStagingBusy)
    throw new Error("Replay staging is in progress. Try scanning again shortly.");
  if (!folder || !fs.existsSync(folder)) return { games: [], playerCounts: {}, duplicateCount: 0 };
  const resolvedFolder = path.resolve(folder);
  if (!fs.statSync(resolvedFolder).isDirectory()) {
    return { games: [], playerCounts: {}, duplicateCount: 0 };
  }
  replayScanCount += 1;
  try {
    writeSettings({ ...readSettings(), replaysFolder: resolvedFolder });
    const scanCache = await loadReplayScanCache(resolvedFolder);
    const replayFiles = await findReplayFiles(resolvedFolder);
    let stagingState = null;
    try {
      stagingState = replayStagingStore().stateForFolder(resolvedFolder);
    } catch {
      // An unreadable staging journal must not hide otherwise readable replay files.
    }
    orderReplayFilesForScan(resolvedFolder, replayFiles, stagingState);
    const total = replayFiles.length;
    const games = [];
    const seenReplayHashes = new Set();
    const seenReplayIds = new Set();
    let duplicateCount = 0;
    event.sender.send("replays:scan-progress", { completed: 0, total: 0, phase: "logs" });
    const ratingsByReplayName = await readReplayRatings(
      resolvedFolder,
      (completed, logTotal) => {
        event.sender.send("replays:scan-progress", {
          completed,
          total: logTotal,
          phase: "logs",
        });
      },
      scanCache,
    );
    event.sender.send("replays:scan-progress", { completed: 0, total, phase: "scanning" });
    const currentReplayCacheKeys = new Set();
    for (const [index, filePath] of replayFiles.entries()) {
      const stat = await fs.promises.stat(filePath);
      const cacheKey = replayFileCacheKey(filePath, stat);
      currentReplayCacheKeys.add(cacheKey);
      const fingerprint = replayFileFingerprint(stat);
      let cached = scanCache.replayFiles.get(cacheKey);
      if (cached?.fingerprint !== fingerprint) {
        cached = {
          fingerprint,
          replay: await parseReplayFile(filePath, resolvedFolder, new Map()),
        };
        scanCache.dirty = true;
      }
      scanCache.replayFiles.delete(cacheKey);
      scanCache.replayFiles.set(cacheKey, cached);
      if (scanCache.replayFiles.size > 50000) {
        scanCache.replayFiles.delete(scanCache.replayFiles.keys().next().value);
        scanCache.dirty = true;
      }
      const game = {
        ...cached.replay,
        ratings: ratingsByReplayName.get(path.basename(filePath)) ?? null,
      };
      game.id = logicalReplayId(resolvedFolder, filePath, seenReplayIds, stagingState);
      if (seenReplayHashes.has(game.contentHash)) duplicateCount += 1;
      else {
        seenReplayHashes.add(game.contentHash);
        seenReplayIds.add(game.id);
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
    for (const cacheKey of scanCache.replayFiles.keys()) {
      if (!currentReplayCacheKeys.has(cacheKey)) {
        scanCache.replayFiles.delete(cacheKey);
        scanCache.dirty = true;
      }
    }
    const playerCounts = {};
    for (const game of games) {
      playerCounts[game.player1] = (playerCounts[game.player1] ?? 0) + 1;
      playerCounts[game.player2] = (playerCounts[game.player2] ?? 0) + 1;
    }
    const result = { games, playerCounts, duplicateCount };
    if (JSON.stringify(scanCache.snapshot) !== JSON.stringify(result)) scanCache.dirty = true;
    scanCache.snapshot = result;
    await saveReplayScanCache(scanCache).catch((error) => {
      startupDiagnostic("replay-scan-cache-write-failed", {
        folder: resolvedFolder,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return result;
  } finally {
    replayScanCount -= 1;
  }
});

async function isGameRunning() {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await execFileAsync(
      "tasklist",
      ["/FI", "IMAGENAME eq Atla.exe", "/FO", "CSV", "/NH"],
      { windowsHide: true },
    );
    return /^"Atla\.exe",/im.test(stdout);
  } catch {
    return false;
  }
}

async function runReplayStagingMutation(operation) {
  if (replayStagingBusy) throw new Error("A replay staging operation is already in progress.");
  if (replayScanCount > 0)
    throw new Error("Wait for the replay scan to finish before changing in-game replays.");
  replayStagingBusy = true;
  try {
    if (
      obsState.recording.active ||
      pendingAutoRecordings.length ||
      replayAttachmentsInProgress.size
    ) {
      throw new Error(
        "Wait for recording and replay linking to finish before changing in-game replays.",
      );
    }
    if (await isGameRunning()) {
      throw new Error("Close Avatar Legends before changing in-game replays.");
    }
    return await operation();
  } finally {
    replayStagingBusy = false;
  }
}

ipcMain.handle("replays:staging-status", async () =>
  replayStagingStore().status(getReplayFolder()),
);

ipcMain.handle("replays:staging-preview", async (_, request) => {
  const folder = getReplayFolder();
  if (!folder) throw new Error("Choose the game folder before staging replays.");
  return replayStagingStore().preview(folder, request?.ids);
});

ipcMain.handle("replays:stage", async (_, request) =>
  runReplayStagingMutation(async () => {
    const folder = getReplayFolder();
    if (!folder) throw new Error("Choose the game folder before staging replays.");
    return replayStagingStore().stage(folder, request?.ids);
  }),
);

ipcMain.handle("replays:restore-staged", async () =>
  runReplayStagingMutation(() => replayStagingStore().restore()),
);

async function hydrateFirstPortraitReplay(manifest) {
  const game = manifest.games?.find(
    (entry) => entry?.replay?.player1Character || entry?.metadata?.player1Character,
  );
  if (!game || (game.replay?.player1 && game.replay?.player2)) return;
  const replayEntry = game.matchId
    ? manifest.replays?.find((entry) => entry.matchId === game.matchId)
    : null;
  const replayPath = game.replayPath || replayEntry?.replayPath;
  if (typeof replayPath !== "string" || !replayPath) return;
  const alternate = replayStagingStore().alternateSavedPath(replayPath);
  for (const candidate of [replayPath, alternate].filter(Boolean)) {
    const stat = await fs.promises.stat(candidate).catch(() => null);
    if (!stat?.isFile() || stat.size > 16 * 1024 * 1024) continue;
    const replay = await parseReplayFile(candidate).catch(() => null);
    if (replayMatchesGame(game, replay, formatCharacter)) {
      game.replay = replay;
      return;
    }
  }
}

ipcMain.handle("recordings:list", async (_, request) => {
  const analysisScope =
    request?.analysisScope === "all" || request?.analysisScope === "move-takes"
      ? request.analysisScope
      : "none";
  const folder = path.resolve(getObsSettings().recordDirectory);
  await ensurePortraitLibrary();
  const portraitCatalog = await readPortraitCatalog(portraitLibraryRoot());
  await repairDanglingClipLinks(folder);
  const files = await findRecordingFiles(folder);
  const recordings = [];
  for (const filePath of files) {
    const stat = await fs.promises.stat(filePath);
    const manifest = await readRecordingManifest(filePath, analysisScope);
    await hydrateFirstPortraitReplay(manifest);
    recordings.push({
      id: path.relative(folder, filePath).split(path.sep).join("/"),
      name: path.basename(filePath),
      url: `labatar-media://recording/${encodeURIComponent(path.relative(folder, filePath).split(path.sep).join("/"))}`,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      ...manifest,
    });
  }
  const playerNameHints = portraitPlayerNameHints(recordings);
  for (const recording of recordings) {
    recording.portraitMatchup = portraitMatchup(recording, portraitCatalog, playerNameHints);
  }
  const byId = new Map(recordings.map((recording) => [recording.id, recording]));
  for (const recording of recordings) {
    if (recording.portraitMatchup || !recording.clip) continue;
    const source = byId.get(recording.clip.sourceRecordingId);
    if (source?.portraitMatchup?.gameCount <= 1) {
      recording.portraitMatchup = source.portraitMatchup;
    }
  }
  recordings.sort((left, right) => right.modifiedAt - left.modifiedAt);
  return { folder, recordings };
});

ipcMain.handle("replays:resolve-portraits", async (_, request) => {
  const pairs = request?.pairs;
  if (!Array.isArray(pairs) || pairs.length > 512) {
    throw new Error("Invalid replay portrait request.");
  }
  for (const pair of pairs) {
    if (
      typeof pair?.character !== "string" ||
      pair.character.length > 100 ||
      typeof pair?.support !== "string" ||
      pair.support.length > 100
    ) {
      throw new Error("Invalid replay portrait request.");
    }
  }
  if (!pairs.length) return [];
  await ensurePortraitLibrary();
  const catalog = await readPortraitCatalog(portraitLibraryRoot());
  return pairs.map(({ character, support }) => portraitArtwork(character, support, catalog));
});

ipcMain.handle("recordings:get-chapters", async (_, request) => {
  const videoPath = resolveRecordingPath(String(request?.recordingId ?? ""));
  if (path.extname(videoPath).toLowerCase() !== ".mp4") return [];
  const stat = await fs.promises.stat(videoPath).catch(() => null);
  if (!stat?.isFile()) throw new Error("The recording no longer exists.");
  const { chapters } = await probeChapters(resolveFfmpegPath(), videoPath);
  return chapters;
});

ipcMain.handle("recordings:frame-reader-open", async (event, request) => {
  const recordingId = String(request?.recordingId ?? "");
  const sourcePath = resolveRecordingPath(recordingId);
  const sourceStat = await fs.promises.stat(sourcePath).catch(() => null);
  if (!sourceStat?.isFile()) throw new Error("The recording no longer exists.");
  if (event.sender.isDestroyed() || event.sender.isCrashed()) {
    throw new Error("The recording view is no longer available.");
  }
  const reader = openRecordingFrameReader(sourcePath);
  return { sessionId: reader.sessionId, frameRate: 60 };
});

ipcMain.handle("recordings:frame-reader-read", (_, request) => readRecordingFrame(request));
ipcMain.handle("recordings:frame-reader-close", (_, request) =>
  closeRecordingFrameReader(String(request?.sessionId ?? "")),
);

ipcMain.handle("recordings:get-work-state", () => [...recordingWork.values()]);

const devArtworkRoot = () => path.join(app.getPath("userData"), "dev-artwork");
const portraitLibraryRoot = () => path.join(app.getPath("userData"), "portraits");
const artworkJobs = new Map();
let portraitLibraryInitialization = null;

function ensurePortraitLibrary() {
  if (!isDev) return Promise.resolve();
  if (!portraitLibraryInitialization) {
    portraitLibraryInitialization = (async () => {
      const existing = await readPortraitCatalog(portraitLibraryRoot());
      if (Object.keys(existing).length > 0) return;
      const runs = await fs.promises
        .readdir(devArtworkRoot(), { withFileTypes: true })
        .catch((error) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
      for (const run of runs
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
        .sort((a, b) => b.name.localeCompare(a.name))) {
        const decoded = path.join(devArtworkRoot(), run.name, "decoded");
        const stat = await fs.promises.stat(decoded).catch(() => null);
        if (!stat?.isDirectory()) continue;
        if (await publishPortraits(decoded, portraitLibraryRoot())) return;
      }
    })().catch((error) => {
      portraitLibraryInitialization = null;
      console.warn(`Could not import existing portrait artwork: ${error.message}`);
    });
  }
  return portraitLibraryInitialization;
}

async function artworkSourceDirectory() {
  const gameFolder = getReplayFolder();
  if (!gameFolder)
    throw new Error("Choose your game folder in Match history before importing artwork.");
  const resolved = await fs.promises
    .realpath(path.join(gameFolder, "data_packages"))
    .catch(() => null);
  if (!resolved) {
    throw new Error(
      "The selected game folder has no data_packages folder. Choose the game's installation folder in Match history.",
    );
  }
  const stat = await fs.promises.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("The game's data_packages path is not a folder.");
  return resolved;
}

function createArtworkCancelledError() {
  const error = new Error("Artwork extraction cancelled.");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

async function findDevArtworkPakFiles(directory, current = directory, signal) {
  if (signal?.aborted) throw createArtworkCancelledError();
  const entries = await fs.promises.readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (signal?.aborted) throw createArtworkCancelledError();
    const filePath = path.join(current, entry.name);
    if (entry.isDirectory())
      files.push(...(await findDevArtworkPakFiles(directory, filePath, signal)));
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".pak") {
      files.push(filePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function readDevArtworkPakBytes(handle, length, position, signal) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    if (signal.aborted) throw createArtworkCancelledError();
    const { bytesRead } = await handle.read(bytes, offset, length - offset, position + offset);
    if (!bytesRead) throw new Error("The PAK file ended unexpectedly.");
    offset += bytesRead;
  }
  return bytes;
}

async function extractDevArtworkPak(
  pakFile,
  filters,
  decodedDirectory,
  signal,
  report,
  decodedSoFar,
) {
  const handle = await fs.promises.open(pakFile, "r");
  try {
    const stat = await handle.stat();
    const header = await readDevArtworkPakBytes(handle, 12, 0, signal);
    const { directoryOffset, directoryBytes } = parsePakHeader(header, stat.size);
    const directory = await readDevArtworkPakBytes(handle, directoryBytes, directoryOffset, signal);
    const entries = parsePakDirectory(directory, stat.size);
    let decodedCount = 0;
    for (const entry of entries) {
      if (signal.aborted) throw createArtworkCancelledError();
      const relativePath = portraitPakRelativePath(entry.name, filters);
      if (!relativePath) continue;
      if (entry.size > 16 * 1024 * 1024)
        throw new Error(`Portrait asset is too large: ${entry.name}`);
      report(
        "decoding",
        `Decoding ${path.basename(relativePath)} from ${path.basename(pakFile)}...`,
      );
      const raw = await readDevArtworkPakBytes(handle, entry.size, entry.offset, signal);
      const image = decodePortraitMunged(raw);
      const imageBytes = encodePngRgba(image.width, image.height, image.pixels, deflateSync);
      const decodedPath = path.join(
        decodedDirectory,
        ...relativePath.replace(/\.munged$/i, ".png").split("/"),
      );
      await fs.promises.mkdir(path.dirname(decodedPath), { recursive: true });
      await fs.promises.writeFile(decodedPath, imageBytes);
      decodedCount += 1;
      report("decoding", `Decoded ${decodedSoFar + decodedCount} portrait images.`);
    }
    return decodedCount;
  } finally {
    await handle.close();
  }
}

function sendArtworkProgress(event, progress) {
  if (!event.sender.isDestroyed()) event.sender.send("artwork:progress", progress);
}

ipcMain.handle("artwork:get-status", async () => {
  await ensurePortraitLibrary();
  const catalog = await readPortraitCatalog(portraitLibraryRoot());
  const missing = missingPortraitArtwork(catalog);
  return {
    ready: missing.length === 0,
    missing,
  };
});
ipcMain.handle("artwork:extract", async (event) => {
  const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const controller = new AbortController();
  artworkJobs.set(runId, controller);
  const report = (stage, message, current = null, total = null) =>
    sendArtworkProgress(event, { runId, stage, message, current, total });
  report("preparing", "Checking the game PAK files...");
  let runDirectory = null;
  try {
    const sourceDirectory = await artworkSourceDirectory();
    const assetFilters = ["~hud~art~portraitart", "~hud~art~support"];
    const pakFiles = await findDevArtworkPakFiles(
      sourceDirectory,
      sourceDirectory,
      controller.signal,
    );
    if (pakFiles.length === 0) throw new Error("No .pak files found in the source folder.");
    report("preparing", `Found ${pakFiles.length} PAK file${pakFiles.length === 1 ? "" : "s"}.`);
    runDirectory = await fs.promises.mkdtemp(path.join(app.getPath("temp"), "labatar-artwork-"));
    const decodedDirectory = path.join(runDirectory, "decoded");
    let decodedCount = 0;
    for (const [index, pakFile] of pakFiles.entries()) {
      report(
        "extracting",
        `Scanning ${path.basename(pakFile)} (${index + 1}/${pakFiles.length})...`,
        index,
        pakFiles.length,
      );
      const count = await extractDevArtworkPak(
        pakFile,
        assetFilters,
        decodedDirectory,
        controller.signal,
        report,
        decodedCount,
      );
      decodedCount += count;
      report(
        "extracting",
        `Scanned ${index + 1}/${pakFiles.length} PAK files; decoded ${decodedCount} images.`,
        index + 1,
        pakFiles.length,
      );
    }
    if (decodedCount === 0) throw new Error("No character or support portraits were found.");
    report("saving", "Saving character and support portraits to the local library...");
    const savedPortraits = await publishPortraits(
      decodedDirectory,
      portraitLibraryRoot(),
      controller.signal,
    );
    report("complete", `Imported ${savedPortraits} portraits.`, 1, 1);
    return {
      savedPortraits,
    };
  } catch (error) {
    report(
      controller.signal.aborted ? "cancelled" : "error",
      controller.signal.aborted
        ? "Artwork extraction cancelled."
        : error instanceof Error
          ? error.message
          : String(error),
    );
    throw error;
  } finally {
    artworkJobs.delete(runId);
    if (runDirectory) {
      await fs.promises.rm(runDirectory, { recursive: true, force: true }).catch((error) => {
        console.warn(`Could not remove temporary artwork files: ${error.message}`);
      });
    }
  }
});
ipcMain.handle("artwork:cancel", (_, request) => {
  const runId = String(request?.runId ?? "");
  const controller = artworkJobs.get(runId);
  if (!controller) return { cancelled: false };
  controller.abort();
  return { cancelled: true };
});

ipcMain.handle("recordings:export-clip", async (_, request) => {
  const workId = `clip-export:${randomUUID()}`;
  let fileName = "Recording";
  try {
    fileName = path.basename(resolveRecordingPath(String(request?.recordingId ?? "")));
  } catch {
    // The export call will report an invalid recording ID.
  }
  setRecordingWork(workId, {
    title: "Creating clip",
    fileName,
    detail: `${clipTimeForFilename(Number(request?.startTime) || 0)}–${clipTimeForFilename(Number(request?.endTime) || 0)}`,
  });
  try {
    return await exportRecordingClip(request);
  } finally {
    clearRecordingWork(workId);
  }
});
ipcMain.handle("recordings:trim-clip", async (_, request) => {
  const workId = `clip-trim:${randomUUID()}`;
  let fileName = "Clip";
  try {
    fileName = path.basename(resolveRecordingPath(String(request?.recordingId ?? "")));
  } catch {
    // The trim call will report an invalid ID.
  }
  setRecordingWork(workId, { title: "Trimming clip", fileName, detail: "Keeping original backup" });
  try {
    return await trimRecordingClip(request);
  } finally {
    clearRecordingWork(workId);
  }
});
ipcMain.handle("recordings:create-f10-clips", async (_, request) => {
  const videoPath = resolveRecordingPath(String(request?.recordingId ?? ""));
  return processManualChapterClips(videoPath);
});
ipcMain.handle("recordings:rename", async (_, request) => renameRecording(request));
ipcMain.handle("recordings:reprocess-name", async (_, request) =>
  reprocessAutomaticRecordingName(request),
);
ipcMain.handle("recordings:add-game-chapters", async (_, request) => {
  const videoPath = resolveRecordingPath(String(request?.recordingId ?? ""));
  return processGameChapters(videoPath);
});
ipcMain.handle("recordings:open-youtube-studio", async (_, request) => {
  const filePath = resolveRecordingPath(String(request?.recordingId ?? ""));
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new Error("The recording no longer exists.");
  await shell.openExternal("https://studio.youtube.com/");
  shell.showItemInFolder(filePath);
});
ipcMain.handle("recordings:set-youtube-link", async (_, request) =>
  setRecordingYouTubeLink(request),
);
ipcMain.handle("recordings:open-youtube-video", async (_, request) => {
  const filePath = resolveRecordingPath(String(request?.recordingId ?? ""));
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new Error("The recording no longer exists.");
  const { youtubeUrl } = await readRecordingManifest(filePath, "none");
  if (!youtubeUrl) throw new Error("This recording has no linked YouTube video.");
  await shell.openExternal(youtubeUrl);
});
ipcMain.handle("recordings:set-tags", async (_, request) => setRecordingTags(request));
ipcMain.handle("recordings:save-analysis", async (_, request) => saveRecordingAnalysis(request));
ipcMain.handle("recordings:set-move-evidence", async (_, request) => setMoveTakeEvidence(request));
ipcMain.handle("recordings:review-capture", async (_, request) =>
  reviewAutomaticMoveVideo(request),
);
ipcMain.handle("move-catalog:load", () => moveCatalogStore().load());
ipcMain.handle("move-catalog:known-variants", () => knownMoveCaptureVariants());
ipcMain.handle("move-catalog:save", (_, request) =>
  moveCatalogStore().save(request?.catalog, request?.expectedRevision),
);
ipcMain.handle("move-capture:get-state", () => publicMoveCaptureState());
ipcMain.handle("move-capture:arm", async (_, request) => {
  if (automaticMoveRunIsOpen()) throw new Error("Finish or cancel the automatic pass first.");
  await requireDevBlackoutCapture();
  return armMoveCapture(request);
});
ipcMain.handle("move-capture:disarm", () => {
  if (automaticMoveRunIsOpen()) throw new Error("Finish or cancel the automatic pass first.");
  return disarmMoveCapture();
});
ipcMain.handle("move-capture:automatic-start", (_, request) => startAutomaticMoveRun(request));
ipcMain.handle("move-capture:automatic-status", () => reconcileAutomaticMoveRun());
ipcMain.handle("move-capture:automatic-pause", () => pauseAutomaticMoveRun());
ipcMain.handle("move-capture:automatic-resume", () => resumeAutomaticMoveRun());
ipcMain.handle("move-capture:automatic-cancel", () => cancelAutomaticMoveRun());
ipcMain.handle("dev-blackout:status", () => devBlackoutStatus());
ipcMain.handle("dev-blackout:start", () => startDevBlackoutGame());
ipcMain.handle("dev-blackout:restore", () => retryDevBlackoutRestore());
ipcMain.handle("processing-config:load", () => processingConfigurationStore().load());
ipcMain.handle("processing-config:save", (_, request) =>
  processingConfigurationStore().save(request.configuration, request.expectedRevision),
);
ipcMain.handle("processing-config:export", async () => {
  const store = processingConfigurationStore();
  const { configuration } = store.load();
  if (!configuration) throw new Error("No processing configuration has been saved.");
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `labatar-processing-revision-${configuration.revision}.json`,
    filters: [{ name: "Processing configuration", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.promises.writeFile(result.filePath, JSON.stringify(configuration, null, 2), "utf8");
  return result.filePath;
});
ipcMain.handle("processing-config:import", async (_, request) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Processing configuration", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const configuration = JSON.parse(await fs.promises.readFile(result.filePaths[0], "utf8"));
  return processingConfigurationStore().restore(configuration, request.expectedRevision);
});
ipcMain.handle("recordings:delete", async (_, request) => deleteRecording(request));
ipcMain.handle("recordings:delete-pending-move", async (_, request) =>
  deletePendingMoveRecording(request),
);
ipcMain.on("recordings:start-drag", async (event, request) => {
  try {
    const filePath = resolveRecordingPath(String(request?.recordingId ?? ""));
    if (!fs.existsSync(filePath)) return;
    const fileIcon = await app.getFileIcon(filePath, { size: "small" });
    if (event.sender.isDestroyed()) return;
    event.sender.startDrag({
      file: filePath,
      icon: fileIcon.isEmpty() ? app.getPath("exe") : fileIcon,
    });
  } catch (error) {
    console.warn("Could not start recording drag:", obsErrorMessage(error));
  }
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
  return replayStagingStore().resolveSource(rootFolder, replayId);
}

ipcMain.handle("replays:show-in-folder", async (_, request) => {
  const folder = getReplayFolder();
  const requestedIds = [
    ...new Set(
      Array.isArray(request?.ids)
        ? request.ids.filter((id) => typeof id === "string" && id.length > 0)
        : [],
    ),
  ];
  if (!folder) throw new Error("Select a game folder before opening Explorer.");
  if (requestedIds.length === 0) throw new Error("No replay files were selected.");

  const rootFolder = await fs.promises.realpath(folder);
  const replayPath = await resolveReplayPath(rootFolder, requestedIds[0]);
  if (requestedIds.length === 1) shell.showItemInFolder(replayPath);
  else await shell.openPath(path.dirname(replayPath));
});

ipcMain.handle("replays:zip", async (_, request) => {
  const folder = getReplayFolder();
  const requestedIds = [
    ...new Set(
      Array.isArray(request?.ids)
        ? request.ids.filter((id) => typeof id === "string" && id.length > 0)
        : [],
    ),
  ];
  if (!folder) throw new Error("Select a game folder before exporting replays.");
  if (requestedIds.length === 0) throw new Error("No replay files were selected.");

  const rootFolder = await fs.promises.realpath(folder);
  const files = [];
  for (const replayId of requestedIds) {
    const source = await resolveReplayPath(rootFolder, replayId);
    const relative = path.normalize(replayId.replaceAll("/", path.sep));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("A selected replay is outside the game folder.");
    }
    files.push({ source, relative });
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

ipcMain.handle("replays:get-folder", () => {
  return getReplayFolder();
});

ipcMain.handle("replays:get-game-folder-status", () => getGameFolderStatus());

ipcMain.handle("replays:select-folder", async () => {
  const savedFolder = getReplayFolder();
  const defaultPath =
    (savedFolder && fs.existsSync(savedFolder) && savedFolder) ||
    (fs.existsSync(defaultReplaysFolder) && defaultReplaysFolder) ||
    app.getPath("home");
  const result = await dialog.showOpenDialog({
    title: "Select game folder",
    properties: ["openDirectory", "createDirectory"],
    defaultPath,
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const folder = result.filePaths[0];
  writeSettings({ ...readSettings(), replaysFolder: folder });
  return folder;
});

function createWindow() {
  startupDiagnostic("create-window-start");
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
  latestRendererSnapshot = null;
  latestRendererSnapshotAt = null;
  let lastRendererPid = null;
  let lastProfileSample = null;
  const sampleRendererProfile = () => {
    if (!rendererProfilingEnabled || window.isDestroyed()) return;
    try {
      const contents = window.webContents;
      const currentPid = contents.isDestroyed() ? null : contents.getOSProcessId();
      if (currentPid > 0) lastRendererPid = currentPid;
      const processes = app.getAppMetrics().map(summarizeProcessMetric);
      lastProfileSample = {
        rendererPid: lastRendererPid,
        rendererAlive: !contents.isDestroyed() && !contents.isCrashed(),
        recordingActive: obsState.recording.active,
        automationEnabled: obsState.automation.enabled,
        snapshotAgeMs:
          latestRendererSnapshotAt == null ? null : Date.now() - latestRendererSnapshotAt,
        renderer: latestRendererSnapshot,
        processes,
      };
      rendererProfileDiagnostic("sample", lastProfileSample);
    } catch (error) {
      rendererProfileDiagnostic("sample-failed", startupErrorDetails(error));
    }
  };
  const profileTimer = rendererProfilingEnabled ? setInterval(sampleRendererProfile, 10_000) : null;
  profileTimer?.unref();
  if (rendererProfilingEnabled) {
    window.webContents.on("did-finish-load", sampleRendererProfile);
  }
  window.webContents.on("did-fail-load", (_, errorCode, errorDescription, validatedURL) => {
    startupDiagnostic("renderer-load-failed", {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });
  window.webContents.on("render-process-gone", (_, details) => {
    startupDiagnostic("renderer-process-gone", details);
    for (const sessionId of recordingFrameReaders.keys()) closeRecordingFrameReader(sessionId);
    rendererProfileDiagnostic("renderer-process-gone", {
      ...details,
      lastSample: lastProfileSample,
    });
  });
  window.webContents.on("child-process-gone", (_, details) => {
    startupDiagnostic("renderer-child-process-gone", details);
  });
  window.on("unresponsive", () => startupDiagnostic("window-unresponsive"));
  window.on("closed", () => {
    startupDiagnostic("window-closed");
    for (const sessionId of recordingFrameReaders.keys()) closeRecordingFrameReader(sessionId);
    if (profileTimer) clearInterval(profileTimer);
    if (mainWindow === window) mainWindow = null;
  });

  if (isDev) {
    void window
      .loadURL("http://localhost:5173")
      .then(() => startupDiagnostic("renderer-loaded", { url: "http://localhost:5173" }))
      .catch((error) => startupDiagnostic("renderer-load-error", startupErrorDetails(error)));
  } else {
    const indexPath = path.join(__dirname, "../dist/index.html");
    void window
      .loadFile(indexPath)
      .then(() => startupDiagnostic("renderer-loaded", { path: indexPath }))
      .catch((error) => startupDiagnostic("renderer-load-error", startupErrorDetails(error)));
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

void app.whenReady().then(() => {
  startupDiagnostic("app-ready");
  protocol.handle("labatar-media", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname === "portrait") {
        const match = /^\/([a-z0-9_]+)\/(portrait|support[1-3](?:-[a-z0-9_-]+)?)\.png$/.exec(
          url.pathname,
        );
        if (!match) return new Response("Not found", { status: 404 });
        const filePath = path.join(
          portraitLibraryRoot(),
          "characters",
          match[1],
          `${match[2]}.png`,
        );
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile() || stat.size > 12 * 1024 * 1024) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(await fs.promises.readFile(filePath), {
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
        });
      }
      if (url.hostname !== "recording") return new Response("Not found", { status: 404 });
      const filePath = resolveRecordingPath(url.pathname.replace(/^\/+/, ""));
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return new Response("Not found", { status: 404 });
      return createRecordingResponse(filePath, stat, request);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  startupDiagnostic("media-protocol-registered");
  watchElectronFiles();
  startupDiagnostic("electron-file-watchers-started");
  buildApplicationMenu();
  startupDiagnostic("application-menu-built");
  const captureSettings = getCaptureSettings();
  setCaptureState({
    hotkey: captureSettings.hotkey,
    chapterHotkey: captureSettings.chapterHotkey,
    autoGameChapters: captureSettings.autoGameChapters,
    autoClipManualChapters: captureSettings.autoClipManualChapters,
  });
  try {
    registerCaptureShortcut(captureSettings.hotkey);
    startupDiagnostic("capture-shortcut-registered", { hotkey: captureSettings.hotkey });
  } catch (error) {
    startupDiagnostic("capture-shortcut-registration-failed", startupErrorDetails(error));
    console.warn(`Global capture shortcut unavailable: ${obsErrorMessage(error)}`);
  }
  try {
    registerChapterShortcut(captureSettings.chapterHotkey);
    startupDiagnostic("chapter-shortcut-registered", { hotkey: captureSettings.chapterHotkey });
  } catch (error) {
    startupDiagnostic("chapter-shortcut-registration-failed", startupErrorDetails(error));
    console.warn(`Global chapter shortcut unavailable: ${obsErrorMessage(error)}`);
  }
  createWindow();
  if (isDev) {
    try {
      const existingBlackout = readBlackoutSession(blackoutBackupRoot());
      if (existingBlackout)
        void startBlackoutWatcher(existingBlackout).catch((error) =>
          startupDiagnostic("blackout-watcher-start-failed", { error: obsErrorMessage(error) }),
        );
    } catch (error) {
      startupDiagnostic("blackout-recovery-failed", { error: obsErrorMessage(error) });
    }
    void devBlackoutStatus().catch((error) =>
      startupDiagnostic("blackout-recovery-failed", { error: obsErrorMessage(error) }),
    );
  }
  startupDiagnostic("window-created");
  configureAutoUpdater();
  if (!isDev) setTimeout(() => void checkForUpdates(), 4000);

  app.on("activate", () => {
    startupDiagnostic("app-activated");
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("gpu-process-crashed", (_, killed, exitCode, reason) => {
  startupDiagnostic("gpu-process-crashed", { killed, exitCode, reason });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  startupDiagnostic("before-quit");
  if (automaticMoveCountdown) clearTimeout(automaticMoveCountdown);
  if (["running", "countdown"].includes(automaticMoveRun?.status)) {
    publishAutomaticMoveRun({
      status: "paused",
      phase: "",
      error: "Labatar closed during capture.",
    });
  }
  void closeAutomaticMoveInput().catch(() => undefined);
  if (captureShortcut) globalShortcut.unregister(captureShortcut);
  if (chapterShortcut) globalShortcut.unregister(chapterShortcut);
  for (const sessionId of recordingFrameReaders.keys()) closeRecordingFrameReader(sessionId);
  if (matchLogWatcher) void matchLogWatcher.stop();
  if (activeObsRecording && obsClient) void stopObsRecording("app-quit").catch(() => undefined);
  if (obsClient) void obsClient.disconnect().catch(() => undefined);
});
