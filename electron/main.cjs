const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  screen,
  session,
  shell,
  desktopCapturer,
  safeStorage,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const readline = require("node:readline");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { autoUpdater } = require("electron-updater");
const { OBSWebSocket } = require("obs-websocket-js");
const ffmpegStaticPath = require("ffmpeg-static");
const { MatchLogWatcher } = require("./match-watcher.cjs");
const supportMap = require("./support-map.json");
const characterMap = require("./character-map.json");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "labatar-media",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
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
const overlayAvailable = true;
const defaultReplaysFolder = path.join(
  "C:\\",
  "Program Files (x86)",
  "Steam",
  "steamapps",
  "common",
  "Avatar Legends The Fighting Game",
);
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
const obsPasswordFile = () => path.join(app.getPath("userData"), "obs-password.enc");
const recordingDiagnosticLogFile = () => path.join(app.getPath("userData"), "recording-debug.log");
const defaultObsProfileName = "Labatar Recording";
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
let obsClient = null;
let obsConnectionToken = 0;
let preparedObsProfile = null;
let activeObsRecording = null;
let lastFinalizedObsRecording = null;
let matchLogWatcher = null;
let pendingAutoRecordings = [];
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

function sendObsState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
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
    return { version, profiles, sceneCollections, currentScene, recordStatus, recordDirectory };
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

function recordingSetBaseName(metadata) {
  const player1 = safeRecordingNamePart(metadata?.player1, "Player 1");
  const player2 = safeRecordingNamePart(metadata?.player2, "Player 2");
  const setLabel = safeRecordingNamePart(metadata?.setLabel, "set 1");
  return `${player1} - ${player2} - ${setLabel}`;
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

async function finalizeObsRecording(outputPath, reason) {
  if (!activeObsRecording) return lastFinalizedObsRecording;
  const recording = activeObsRecording;
  activeObsRecording = null;
  let manifestPath = null;
  let manifestError = null;
  if (outputPath) {
    const namedOutputPath = await renameObsRecordingFile(
      outputPath,
      recording.metadata,
      null,
      recording.source === "automatic"
        ? recordingSetBaseName(recording.metadata)
        : recording.fileNameBase,
    );
    recording.outputPath = namedOutputPath;
    manifestPath = recordingManifestPath(namedOutputPath);
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
            outputPath: namedOutputPath,
            source: recording.source,
            tags: recording.tags ?? { match: [], lab: [], combo: false, pressure: false },
            metadata: recording.metadata,
            games: recording.games ?? [],
            replays: recording.replays ?? [],
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
    } catch (error) {
      manifestError = obsErrorMessage(error);
    }
  }
  lastFinalizedObsRecording = {
    outputPath: recording.outputPath ?? outputPath ?? null,
    manifestPath,
    manifestError,
  };
  return lastFinalizedObsRecording;
}

async function attachReplayToRecording(recording, replayPath, matchId = null) {
  if (!recording?.manifestPath) return;
  try {
    const manifest = JSON.parse(await fs.promises.readFile(recording.manifestPath, "utf8"));
    const replay = await parseReplayFile(replayPath, path.dirname(replayPath));
    const previousManifestPath = recording.manifestPath;
    const namedOutputPath = recording.outputPath
      ? await renameObsRecordingFile(
          recording.outputPath,
          manifest.metadata,
          replay,
          recording.source === "automatic" ? recordingSetBaseName(manifest.metadata) : null,
        )
      : recording.outputPath;
    const namedManifestPath = namedOutputPath
      ? recordingManifestPath(namedOutputPath)
      : previousManifestPath;
    if (namedManifestPath !== previousManifestPath) {
      await fs.promises.rename(previousManifestPath, namedManifestPath).catch(() => undefined);
    }
    const replayEntry = {
      matchId: matchId ?? null,
      replayPath,
      replayFileName: path.basename(replayPath),
      replay,
    };
    const games = Array.isArray(manifest.games) ? manifest.games : [];
    const game = matchId ? games.find((candidate) => candidate.matchId === matchId) : null;
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
    await fs.promises.writeFile(namedManifestPath, JSON.stringify(manifest, null, 2), "utf8");
    recording.outputPath = namedOutputPath;
    recording.manifestPath = namedManifestPath;
  } catch {
    // The recording remains useful even if the sidecar cannot be updated.
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
  if (
    !recording ||
    recording.source !== "automatic" ||
    (recording.lobbyId && recording.lobbyId !== match.lobbyId)
  ) {
    return null;
  }
  const existing = recording.games.find((game) => game.matchId === match.matchId);
  if (existing) return existing;
  const game = automaticGameRecord(match);
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
  };
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
    activeObsRecording = null;
    if (reusePreparedProfile) invalidatePreparedObsProfile();
    logRecordingDiagnostic("obs-start-record-failed", {
      source,
      matchId: metadata?.matchId ?? null,
      durationMs: Date.now() - startedAtMs,
      error: obsErrorMessage(error),
    });
    throw error;
  }
  setObsState({
    status: "connected",
    recording: { active: true, paused: false, outputPath: null },
  });
  return { sessionId, startedAt, metadata: normalizedMetadata };
}

async function startManualObsRecording(setup = {}) {
  return startObsRecording(null, setup, { manual: true });
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
  logRecordingDiagnostic("obs-stop-record-request", {
    reason,
    durationMs: Date.now() - startedAt,
  });
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
  }
  if (!recordAutomaticMatchStart(match)) {
    setMatchAutomationState({
      status: "error",
      currentMatch: match,
      error: "The detected match does not belong to the active recording lobby.",
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
  if (activeObsRecording?.source === "automatic") {
    pendingAutoRecordings.push({ match, recording: activeObsRecording });
    setMatchAutomationState({ status: "in-set", currentMatch: null, error: null });
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

async function handleAutomaticReplaySaved(replayPath) {
  logRecordingDiagnostic("automatic-replay-saved", {
    replayPath,
    pendingCount: pendingAutoRecordings.length,
  });
  const pending = pendingAutoRecordings.shift();
  if (pending) {
    const recording = pending.recording;
    const game = recording.games?.find((candidate) => candidate.matchId === pending.match.matchId);
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
      await attachReplayToRecording(recording, replayPath, pending.match.matchId);
    }
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
        status: callbackError ? "error" : state.status,
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
      void finalizeObsRecording(recordStatus.outputPath ?? null, "obs");
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
    if (!version.availableRequests?.includes("SetVideoSettings")) return null;
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

    const videoSettings = await client.call("GetVideoSettings");
    if (
      videoSettings.baseWidth === sourceWidth &&
      videoSettings.baseHeight === sourceHeight &&
      videoSettings.outputWidth === sourceWidth &&
      videoSettings.outputHeight === sourceHeight
    ) {
      return { width: sourceWidth, height: sourceHeight };
    }

    const streamStatus = await client.call("GetStreamStatus");
    if (streamStatus.outputActive) {
      throw new Error("Stop the active OBS stream before resizing output to the game source.");
    }
    await client.call("SetVideoSettings", {
      baseWidth: sourceWidth,
      baseHeight: sourceHeight,
      outputWidth: sourceWidth,
      outputHeight: sourceHeight,
    });
    return { width: sourceWidth, height: sourceHeight };
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

function getReplayFolder() {
  const savedFolder = readSettings().replaysFolder;
  if (typeof savedFolder === "string" && savedFolder.trim()) return savedFolder;
  return fs.existsSync(defaultReplaysFolder) ? defaultReplaysFolder : null;
}

function updateInfo(info) {
  return {
    version: info?.version,
    releaseDate: info?.releaseDate,
  };
}

function sendUpdateStatus(state, info = null, details = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
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
  return startObsRecording(request?.metadata, request?.setup ?? {});
});
ipcMain.handle("obs:start-manual-recording", async (_, request) => {
  return startManualObsRecording(request?.setup ?? {});
});
ipcMain.handle("obs:stop-recording", async () => {
  return stopObsRecording("labatar");
});
ipcMain.handle("obs:set-automatic-recording", async (_, enabled) =>
  setAutomaticRecordingEnabled(Boolean(enabled)),
);

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

async function readReplayRatings(folder, onProgress) {
  const logFiles = await findLogFiles(folder);
  const ratingsByReplayName = new Map();
  for (const [index, logFile] of logFiles.entries()) {
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
    onProgress?.(index + 1, logFiles.length);
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
    roundScore:
      fields.TM_WinsT1 != null && fields.TM_WinsT2 != null
        ? `${fields.TM_WinsT1} - ${fields.TM_WinsT2}`
        : "Unknown",
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

async function exportRecordingClip(request = {}) {
  const recordingId = String(request.recordingId ?? "");
  const sourcePath = resolveRecordingPath(recordingId);
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
  const baseName = `${sourceStem} - clip ${rangeLabel}`;
  const outputPath = await availableRecordingPath(folder, baseName);
  const duration = endTime - startTime;

  await runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    sourcePath,
    "-ss",
    startTime.toFixed(3),
    "-t",
    duration.toFixed(3),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-avoid_negative_ts",
    "make_zero",
    outputPath,
  ]);

  const outputId = path.relative(folder, outputPath).split(path.sep).join("/");
  const clip = {
    sourceRecordingId: path.relative(folder, sourcePath).split(path.sep).join("/"),
    sourceRecordingName,
    startTime,
    endTime,
    createdAt: new Date().toISOString(),
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

async function renameRecording(request = {}) {
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

async function deleteRecording(request = {}) {
  const recordingId = String(request.recordingId ?? "");
  const currentPath = resolveRecordingPath(recordingId);
  const currentStat = await fs.promises.stat(currentPath).catch(() => null);
  if (!currentStat?.isFile()) throw new Error("The recording no longer exists.");

  await fs.promises.rm(currentPath, { force: true });
  await fs.promises.rm(recordingManifestPathForVideo(currentPath), { force: true });
  return { id: recordingId };
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

async function readRecordingManifest(videoPath) {
  try {
    const content = await fs.promises.readFile(recordingManifestPathForVideo(videoPath), "utf8");
    const manifest = JSON.parse(content);
    const clip = manifest?.clip;
    const startTime = Number(clip?.startTime);
    const endTime = Number(clip?.endTime);
    return {
      metadata: manifest?.metadata ?? null,
      games: Array.isArray(manifest?.games) ? manifest.games : [],
      replays: Array.isArray(manifest?.replays) ? manifest.replays : [],
      tags: normalizeRecordingTags(manifest?.tags, manifest?.metadata),
      replayPath: typeof manifest?.replayPath === "string" ? manifest.replayPath : null,
      replayFileName: typeof manifest?.replayFileName === "string" ? manifest.replayFileName : null,
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
            }
          : null,
    };
  } catch {
    return {
      metadata: null,
      games: [],
      replays: [],
      tags: { match: [], lab: [], combo: false, pressure: false },
      replayPath: null,
      replayFileName: null,
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

ipcMain.handle("replays:scan-folder", async (event, folder) => {
  if (!folder || !fs.existsSync(folder)) return { games: [], playerCounts: {}, duplicateCount: 0 };
  const resolvedFolder = path.resolve(folder);
  if (!fs.statSync(resolvedFolder).isDirectory()) {
    return { games: [], playerCounts: {}, duplicateCount: 0 };
  }
  writeSettings({ ...readSettings(), replaysFolder: resolvedFolder });
  const replayFiles = await findReplayFiles(resolvedFolder);
  const total = replayFiles.length;
  const games = [];
  const seenReplayHashes = new Set();
  let duplicateCount = 0;
  event.sender.send("replays:scan-progress", { completed: 0, total: 0, phase: "logs" });
  const ratingsByReplayName = await readReplayRatings(resolvedFolder, (completed, logTotal) => {
    event.sender.send("replays:scan-progress", {
      completed,
      total: logTotal,
      phase: "logs",
    });
  });
  event.sender.send("replays:scan-progress", { completed: 0, total, phase: "scanning" });
  for (const [index, filePath] of replayFiles.entries()) {
    const { contentHash, ...game } = await parseReplayFile(
      filePath,
      resolvedFolder,
      ratingsByReplayName,
    );
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

ipcMain.handle("recordings:list", async () => {
  const folder = path.resolve(getObsSettings().recordDirectory);
  await repairDanglingClipLinks(folder);
  const files = await findRecordingFiles(folder);
  const recordings = [];
  for (const filePath of files) {
    const stat = await fs.promises.stat(filePath);
    const manifest = await readRecordingManifest(filePath);
    recordings.push({
      id: path.relative(folder, filePath).split(path.sep).join("/"),
      name: path.basename(filePath),
      url: `labatar-media://recording/${encodeURIComponent(path.relative(folder, filePath).split(path.sep).join("/"))}`,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      ...manifest,
    });
  }
  recordings.sort((left, right) => right.modifiedAt - left.modifiedAt);
  return { folder, recordings };
});

ipcMain.handle("recordings:export-clip", async (_, request) => exportRecordingClip(request));
ipcMain.handle("recordings:rename", async (_, request) => renameRecording(request));
ipcMain.handle("recordings:set-tags", async (_, request) => setRecordingTags(request));
ipcMain.handle("recordings:delete", async (_, request) => deleteRecording(request));
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
  const folder = getReplayFolder();
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
  const folder = getReplayFolder();
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
  return getReplayFolder();
});

ipcMain.handle("replays:select-folder", async () => {
  const savedFolder = getReplayFolder();
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
  protocol.handle("labatar-media", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "recording") return new Response("Not found", { status: 404 });
      const filePath = resolveRecordingPath(url.pathname.replace(/^\/+/, ""));
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return new Response("Not found", { status: 404 });
      return createRecordingResponse(filePath, stat, request);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
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

app.on("before-quit", () => {
  if (matchLogWatcher) void matchLogWatcher.stop();
  if (activeObsRecording && obsClient) void stopObsRecording("app-quit").catch(() => undefined);
  if (obsClient) void obsClient.disconnect().catch(() => undefined);
});
