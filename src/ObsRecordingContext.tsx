import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button, Chip, Stack } from "@mui/material";
import type { ObsSettings, ObsState } from "./obs-types";
import type { MoveCaptureState, MoveTakeOutcome } from "./move-capture-types";

const defaultSettings: ObsSettings = {
  host: "127.0.0.1",
  port: 4455,
  profileName: "Labatar Recording",
  recordDirectory: "",
  passwordSaved: false,
};

const savedPasswordMask = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

const disconnectedState: ObsState = {
  status: "disconnected",
  host: defaultSettings.host,
  port: defaultSettings.port,
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
    sessionId: null,
    source: null,
    metadata: null,
    startedAt: null,
  },
};

const labatarSceneNames = [
  "Labatar - Game Only",
  "Labatar - Game + Desktop + Mic",
  "Labatar - Game + Mic",
];

type RecordingStartPurpose = "manual" | "extraction";
const inactiveMoveCapture: MoveCaptureState = { armed: null, active: null };

type ObsRecordingContextValue = {
  state: ObsState;
  settings: ObsSettings;
  password: string;
  passwordFocused: boolean;
  rememberPassword: boolean;
  busy: boolean;
  extractionCaptureActive: boolean;
  moveCapture: MoveCaptureState;
  notice: string | null;
  error: string | null;
  savedPasswordMask: string;
  labatarSceneNames: string[];
  updateSetting: <K extends keyof ObsSettings>(key: K, value: ObsSettings[K]) => void;
  setPassword: (password: string) => void;
  setPasswordFocused: (focused: boolean) => void;
  setRememberPassword: (remember: boolean) => void;
  connect: () => Promise<void>;
  clearPassword: () => Promise<void>;
  disconnect: () => Promise<void>;
  startManualRecording: (purpose?: RecordingStartPurpose) => Promise<void>;
  stopManualRecording: () => Promise<void>;
  armMoveCapture: (request: {
    characterId: string;
    moveId: string;
    moveInput: string;
    isStance: boolean;
    isCharged: boolean;
    outcome: MoveTakeOutcome;
  }) => Promise<boolean>;
  disarmMoveCapture: () => Promise<void>;
  toggleAutomaticRecording: (enabled: boolean) => Promise<void>;
  setupScenes: () => Promise<void>;
  setScene: (sceneName: string) => Promise<void>;
};

const ObsRecordingContext = createContext<ObsRecordingContextValue | null>(null);

function displayError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ObsRecordingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ObsState>(disconnectedState);
  const [settings, setSettings] = useState<ObsSettings>(defaultSettings);
  const [password, setPassword] = useState("");
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [extractionCaptureActive, setExtractionCaptureActive] = useState(false);
  const [moveCapture, setMoveCapture] = useState<MoveCaptureState>(inactiveMoveCapture);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.obs) return;
    let active = true;
    const unsubscribe = window.electronAPI.obs.onState((nextState) => {
      if (active) setState(nextState);
    });
    void Promise.all([
      window.electronAPI.obs.getState(),
      window.electronAPI.obs.getSettings(),
    ]).then(([nextState, nextSettings]) => {
      if (!active) return;
      setState(nextState);
      setSettings(nextSettings);
      setRememberPassword(nextSettings.passwordSaved);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.moveCapture) return;
    let active = true;
    const unsubscribe = window.electronAPI.moveCapture.onState((nextState) => {
      if (active) setMoveCapture(nextState);
    });
    void window.electronAPI.moveCapture.getState().then((nextState) => {
      if (active) setMoveCapture(nextState);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const updateSetting = useCallback(
    <K extends keyof ObsSettings>(key: K, value: ObsSettings[K]) => {
      setSettings((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const connect = useCallback(async () => {
    if (!window.electronAPI?.obs) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await window.electronAPI.obs.connect({
        host: settings.host,
        port: Number(settings.port),
        password,
        rememberPassword,
      });
      setSettings((current) => ({
        ...current,
        passwordSaved: rememberPassword && (current.passwordSaved || Boolean(password)),
      }));
      setNotice("Connected to OBS.");
    } catch (connectError) {
      setError(displayError(connectError));
    } finally {
      setBusy(false);
    }
  }, [password, rememberPassword, settings.host, settings.port]);

  const clearPassword = useCallback(async () => {
    if (!window.electronAPI?.obs) return;
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.obs.clearPassword();
      setSettings((current) => ({ ...current, passwordSaved: false }));
      setPassword("");
      setPasswordFocused(false);
      setNotice("Saved OBS password removed.");
    } catch (clearError) {
      setError(displayError(clearError));
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (!window.electronAPI?.obs) return;
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.obs.disconnect();
      setNotice("Disconnected from OBS.");
    } catch (disconnectError) {
      setError(displayError(disconnectError));
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleAutomaticRecording = useCallback(async (enabled: boolean) => {
    if (!window.electronAPI?.obs) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await window.electronAPI.obs.setAutomaticRecording(enabled);
      setNotice(
        enabled
          ? "Log monitoring is active. OBS will record detected games automatically."
          : "Log monitoring stopped.",
      );
    } catch (toggleError) {
      setError(displayError(toggleError));
    } finally {
      setBusy(false);
    }
  }, []);

  const startManualRecording = useCallback(
    async (purpose: RecordingStartPurpose = "manual") => {
      if (!window.electronAPI?.obs) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        if (purpose === "extraction" && window.electronAPI.capture) {
          await window.electronAPI.capture.toggle();
        } else {
          await window.electronAPI.obs.startManualRecording({
            setup: {
              profileName: settings.profileName,
              recordDirectory: settings.recordDirectory,
            },
          });
        }
        setExtractionCaptureActive(purpose === "extraction");
        setNotice(
          purpose === "extraction"
            ? `Extraction recording started. Stop it when the move is complete; the nerd-processing pipeline will use the captured clip.`
            : moveCapture.armed
              ? `Move take started: ${moveCapture.armed.characterLabel} · ${moveCapture.armed.moveLabel} · ${moveCapture.armed.outcome}.`
              : `Manual recording started. Videos will be saved to ${settings.recordDirectory}.`,
        );
      } catch (startError) {
        setError(displayError(startError));
      } finally {
        setBusy(false);
      }
    },
    [moveCapture.armed, settings.profileName, settings.recordDirectory],
  );

  const stopManualRecording = useCallback(async () => {
    if (!window.electronAPI?.obs) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result =
        extractionCaptureActive && window.electronAPI.capture
          ? await window.electronAPI.capture.toggle()
          : await window.electronAPI.obs.stopRecording();
      setExtractionCaptureActive(false);
      setNotice(
        result.outputPath
          ? `Manual recording saved: ${result.outputPath}`
          : "Manual recording stopped.",
      );
    } catch (stopError) {
      setError(displayError(stopError));
    } finally {
      setBusy(false);
    }
  }, []);

  const armMoveCapture = useCallback(
    async (request: {
      characterId: string;
      moveId: string;
      moveInput: string;
      isStance: boolean;
      isCharged: boolean;
      outcome: MoveTakeOutcome;
    }) => {
      if (!window.electronAPI?.moveCapture) return false;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        setMoveCapture(await window.electronAPI.moveCapture.arm(request));
        setNotice(
          "Move take armed. The header controls and F9 will use this move until you disarm it.",
        );
        return true;
      } catch (armError) {
        setError(displayError(armError));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const disarmMoveCapture = useCallback(async () => {
    if (!window.electronAPI?.moveCapture) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setMoveCapture(await window.electronAPI.moveCapture.disarm());
      setNotice("Move take disarmed. New recordings will be ordinary manual recordings.");
    } catch (disarmError) {
      setError(displayError(disarmError));
    } finally {
      setBusy(false);
    }
  }, []);

  const setupScenes = useCallback(async () => {
    if (!window.electronAPI?.obs) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.electronAPI.obs.setupScenes({
        profileName: settings.profileName,
        recordDirectory: settings.recordDirectory,
      });
      setNotice(
        `Labatar profile and ${result.scenes.length} scenes are ready in the ${result.sceneCollectionName} scene collection. Game audio uses ${result.gameAudioMode === "separate" ? "a separate application audio source" : "the window capture source"}. ${result.outputResolution ? `Output resized to ${result.outputResolution.width}×${result.outputResolution.height}.` : "Open the game and run setup again to resize output to the game source."}`,
      );
    } catch (setupError) {
      setError(displayError(setupError));
    } finally {
      setBusy(false);
    }
  }, [settings.profileName, settings.recordDirectory]);

  const setScene = useCallback(async (sceneName: string) => {
    if (!window.electronAPI?.obs) return;
    setBusy(true);
    setError(null);
    try {
      const nextState = await window.electronAPI.obs.setScene(sceneName);
      setState(nextState);
    } catch (sceneError) {
      setError(displayError(sceneError));
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo<ObsRecordingContextValue>(
    () => ({
      state,
      settings,
      password,
      passwordFocused,
      rememberPassword,
      busy,
      extractionCaptureActive,
      moveCapture,
      notice,
      error,
      savedPasswordMask,
      labatarSceneNames,
      updateSetting,
      setPassword,
      setPasswordFocused,
      setRememberPassword,
      connect,
      clearPassword,
      disconnect,
      startManualRecording,
      stopManualRecording,
      armMoveCapture,
      disarmMoveCapture,
      toggleAutomaticRecording,
      setupScenes,
      setScene,
    }),
    [
      busy,
      clearPassword,
      connect,
      disconnect,
      error,
      extractionCaptureActive,
      moveCapture,
      notice,
      password,
      passwordFocused,
      rememberPassword,
      setScene,
      settings,
      setupScenes,
      startManualRecording,
      state,
      stopManualRecording,
      armMoveCapture,
      disarmMoveCapture,
      toggleAutomaticRecording,
      updateSetting,
    ],
  );

  return <ObsRecordingContext.Provider value={value}>{children}</ObsRecordingContext.Provider>;
}

export function useObsRecording() {
  const context = useContext(ObsRecordingContext);
  if (!context) throw new Error("useObsRecording must be used inside ObsRecordingProvider");
  return context;
}

export function ObsRecordingControls() {
  const {
    busy,
    state,
    connect,
    disconnect,
    startManualRecording,
    stopManualRecording,
    moveCapture,
    disarmMoveCapture,
    toggleAutomaticRecording,
  } = useObsRecording();
  const connected = state.status === "connected";
  const recording = state.recording.active;
  const manualRecording = recording && state.recording.source === "manual";

  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: "stretch" }}>
      <Button
        size="small"
        variant={connected ? "outlined" : "contained"}
        onClick={() => void (connected ? disconnect() : connect())}
        disabled={busy || recording || state.status === "connecting"}
      >
        {state.status === "connecting"
          ? "Connecting..."
          : connected
            ? "Disconnect OBS"
            : "Connect to OBS"}
      </Button>
      {state.automation.enabled ? (
        <Button
          size="small"
          variant="outlined"
          color="error"
          onClick={() => void toggleAutomaticRecording(false)}
          disabled={!connected || busy || manualRecording}
        >
          Stop automatic recording
        </Button>
      ) : (
        <Button
          size="small"
          variant="contained"
          onClick={() => void toggleAutomaticRecording(true)}
          disabled={!connected || busy || recording}
        >
          Start automatic recording
        </Button>
      )}
      <Button
        size="small"
        variant={manualRecording ? "outlined" : "contained"}
        color={manualRecording ? "error" : "primary"}
        onClick={() => void (manualRecording ? stopManualRecording() : startManualRecording())}
        disabled={
          !connected || busy || (!manualRecording && (recording || state.automation.enabled))
        }
      >
        {manualRecording
          ? "Stop recording"
          : moveCapture.armed
            ? `Start ${moveCapture.armed.moveLabel} ${moveCapture.armed.outcome} take`
            : "Start recording"}
      </Button>
      {moveCapture.armed && (
        <Chip
          size="small"
          label={`Armed: ${moveCapture.armed.characterLabel} · ${moveCapture.armed.moveLabel} · ${moveCapture.armed.outcome}`}
          onDelete={() => void disarmMoveCapture()}
          disabled={busy || recording}
        />
      )}
    </Stack>
  );
}

export { savedPasswordMask, labatarSceneNames };
