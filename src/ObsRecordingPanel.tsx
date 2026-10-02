import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ObsSettings, ObsState } from "./obs-types";

const defaultSettings: ObsSettings = {
  host: "127.0.0.1",
  port: 4455,
  profileName: "Labatar Recording",
  recordDirectory: "",
  passwordSaved: false,
};

const savedPasswordMask = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
const labatarSceneNames = [
  "Labatar - Game Only",
  "Labatar - Game + Desktop + Mic",
  "Labatar - Game + Mic",
];

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

function displayError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ObsRecordingPanel({ onRecordingStopped }: { onRecordingStopped?: () => void }) {
  const [state, setState] = useState<ObsState>(disconnectedState);
  const [settings, setSettings] = useState<ObsSettings>(defaultSettings);
  const [password, setPassword] = useState("");
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previousRecordingActive = useRef(false);

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
    if (previousRecordingActive.current && !state.recording.active) {
      onRecordingStopped?.();
    }
    previousRecordingActive.current = state.recording.active;
  }, [onRecordingStopped, state.recording.active]);

  const updateSetting = <K extends keyof ObsSettings>(key: K, value: ObsSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const connect = async () => {
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
  };

  const clearPassword = async () => {
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
  };

  const disconnect = async () => {
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
  };

  const toggleAutomaticRecording = async (enabled: boolean) => {
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
  };

  const startManualRecording = async () => {
    if (!window.electronAPI?.obs) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await window.electronAPI.obs.startManualRecording({
        setup: {
          profileName: settings.profileName,
          recordDirectory: settings.recordDirectory,
        },
      });
      setNotice(`Manual recording started. Videos will be saved to ${settings.recordDirectory}.`);
    } catch (startError) {
      setError(displayError(startError));
    } finally {
      setBusy(false);
    }
  };

  const stopManualRecording = async () => {
    if (!window.electronAPI?.obs) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.electronAPI.obs.stopRecording();
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
  };

  const setupScenes = async () => {
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
  };

  const setScene = async (sceneName: string) => {
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
  };

  const connected = state.status === "connected";
  const recording = state.recording.active;
  const manualRecording = recording && state.recording.source === "manual";
  const automaticRecordingActive = recording && state.recording.source === "automatic";
  const displayedError = error ?? state.error ?? state.automation.error;
  const expectedProfileName = settings.profileName.trim();
  const expectedProfileMissing =
    connected &&
    Boolean(expectedProfileName) &&
    state.profiles.length > 0 &&
    !state.profiles.includes(expectedProfileName);
  const activeProfileMismatch =
    connected &&
    Boolean(expectedProfileName) &&
    Boolean(state.currentProfileName) &&
    state.currentProfileName !== expectedProfileName;
  const configuredFps =
    state.videoSettings?.fpsNumerator && state.videoSettings.fpsDenominator
      ? state.videoSettings.fpsNumerator / state.videoSettings.fpsDenominator
      : null;
  const recordingFpsMismatch = connected && configuredFps !== 60;

  return (
    <Accordion
      disableGutters
      defaultExpanded
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        textAlign: "left",
        "&:before": { display: "none" },
      }}
    >
      <AccordionSummary
        component="div"
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            (event.key !== "Enter" && event.key !== " ")
          ) {
            return;
          }
          event.preventDefault();
          event.currentTarget.click();
        }}
        expandIcon={<span aria-hidden="true">v</span>}
        sx={{ "& .MuiAccordionSummary-content": { alignItems: "center" } }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6">Recording configuration</Typography>
          <Typography color="text.secondary">
            Connect Labatar to OBS and configure automatic or manual recording.
          </Typography>
        </Box>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ ml: 1, mr: 1, flexShrink: 0 }}
        >
          {state.automation.enabled ? (
            <Paper variant="outlined" sx={{ px: 1, py: 0.5, mr: 1 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Box>
                  <Typography variant="caption" color="success.main" sx={{ display: "block" }}>
                    Automatic recording active
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {automaticRecordingActive ? "Recording in progress" : "Waiting for game"}
                    {" | Detection: " + state.automation.status}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleAutomaticRecording(false);
                  }}
                  onFocus={(event) => event.stopPropagation()}
                  disabled={!connected || busy || manualRecording}
                >
                  Stop recording
                </Button>
              </Stack>
            </Paper>
          ) : (
            <Button
              size="small"
              variant="contained"
              onClick={(event) => {
                event.stopPropagation();
                void toggleAutomaticRecording(true);
              }}
              onFocus={(event) => event.stopPropagation()}
              disabled={!connected || busy || manualRecording}
              sx={{ mr: 1 }}
            >
              Start automatic recording
            </Button>
          )}
          <Button
            size="small"
            variant={manualRecording ? "outlined" : "contained"}
            color={manualRecording ? "error" : "primary"}
            onClick={(event) => {
              event.stopPropagation();
              void (manualRecording ? stopManualRecording() : startManualRecording());
            }}
            onFocus={(event) => event.stopPropagation()}
            disabled={
              !connected || busy || (!manualRecording && (recording || state.automation.enabled))
            }
          >
            {manualRecording ? "Stop recording" : "Start recording"}
          </Button>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 3, pb: 3 }}>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2 }}>
          In OBS, enable the WebSocket server under Tools: WebSocket Server Settings. The default
          port is 4455; use the password configured there.
        </Typography>

        <Stack spacing={1.5}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <TextField
              label="OBS host"
              size="small"
              value={settings.host}
              onChange={(event) => updateSetting("host", event.target.value)}
              disabled={connected || busy}
              sx={{ minWidth: 180 }}
            />
            <TextField
              label="Port"
              type="number"
              size="small"
              value={settings.port}
              onChange={(event) => updateSetting("port", Number(event.target.value))}
              disabled={connected || busy}
              sx={{ width: 110 }}
            />
            <TextField
              label="Password"
              type="password"
              size="small"
              value={passwordFocused || !settings.passwordSaved ? password : savedPasswordMask}
              onChange={(event) => setPassword(event.target.value)}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => {
                if (!password) setPasswordFocused(false);
              }}
              disabled={connected || busy}
              autoComplete="off"
              sx={{ minWidth: 180 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={rememberPassword}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setRememberPassword(checked);
                    if (!checked && settings.passwordSaved) void clearPassword();
                  }}
                  disabled={connected || busy}
                />
              }
              label="Remember securely"
            />
            <Button
              variant={connected ? "outlined" : "contained"}
              onClick={() => void (connected ? disconnect() : connect())}
              disabled={busy || recording || state.status === "connecting"}
            >
              {state.status === "connecting"
                ? "Connecting..."
                : connected
                  ? "Disconnect"
                  : "Connect"}
            </Button>
          </Stack>

          <Typography variant="body2" color={connected ? "success.main" : "text.secondary"}>
            Status: {state.status}
            {state.obsVersion ? ` | OBS ${state.obsVersion}` : ""}
            {state.obsWebSocketVersion ? ` | WebSocket ${state.obsWebSocketVersion}` : ""}
          </Typography>

          {connected && (
            <>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                <TextField
                  label="Labatar profile"
                  size="small"
                  value={settings.profileName}
                  onChange={(event) => updateSetting("profileName", event.target.value)}
                  disabled
                  sx={{ minWidth: 220 }}
                />
                <TextField
                  label="Recording directory"
                  size="small"
                  value={settings.recordDirectory}
                  onChange={(event) => updateSetting("recordDirectory", event.target.value)}
                  disabled
                  fullWidth
                />
                <Button
                  variant="contained"
                  onClick={() => void setupScenes()}
                  disabled={busy || recording}
                >
                  Apply Labatar OBS setup
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Current OBS profile: {state.currentProfileName ?? "unknown"} | Current output:{" "}
                {state.recordDirectory ?? "unknown"}
              </Typography>
              <Typography
                variant="caption"
                color={recordingFpsMismatch ? "warning.main" : "text.secondary"}
              >
                Capture frame rate: {configuredFps ? `${configuredFps} fps` : "unknown"}
                {recordingFpsMismatch ? " (Labatar requires 60 fps)" : ""}
              </Typography>
              <Typography variant="caption" color="warning.main">
                Applying the setup manages the Labatar scene collection and removes extra scenes,
                sources, and scene items from it.
              </Typography>
              {expectedProfileMissing && (
                <Alert severity="warning">
                  Expected OBS profile &quot;{expectedProfileName}&quot; is not present. Use Prepare
                  profile to create it.
                </Alert>
              )}
              {!expectedProfileMissing && activeProfileMismatch && (
                <Alert severity="warning">
                  OBS is using &quot;{state.currentProfileName}&quot; instead of expected profile{" "}
                  &quot;{expectedProfileName}&quot;. Apply the Labatar OBS setup to switch.
                </Alert>
              )}
              {recordingFpsMismatch && (
                <Alert severity="warning">
                  This profile is not configured for 60 fps. Apply the Labatar OBS setup before
                  recording analysis clips.
                </Alert>
              )}
              {state.currentSceneCollectionName === "Labatar" && (
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Scenes:
                  </Typography>
                  {labatarSceneNames.map((sceneName) => (
                    <Button
                      key={sceneName}
                      size="small"
                      variant={state.currentSceneName === sceneName ? "contained" : "outlined"}
                      onClick={() => void setScene(sceneName)}
                      disabled={busy || recording}
                    >
                      {sceneName.replace("Labatar - ", "")}
                    </Button>
                  ))}
                </Stack>
              )}
            </>
          )}

          {recording && (
            <Typography variant="body2" color="error.main">
              Recording active
              {state.recording.sessionId ? ` | ${state.recording.sessionId}` : ""}
            </Typography>
          )}
          {notice && <Alert severity="success">{notice}</Alert>}
          {displayedError && <Alert severity="error">{displayedError}</Alert>}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
