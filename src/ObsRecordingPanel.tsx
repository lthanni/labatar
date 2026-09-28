import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { DetectedPlayer, ObsSettings, ObsState } from "./obs-types";

const defaultSettings: ObsSettings = {
  host: "127.0.0.1",
  port: 4455,
  profileName: "Labatar Recording",
  recordDirectory: "",
  passwordSaved: false,
};

const disconnectedState: ObsState = {
  status: "disconnected",
  host: defaultSettings.host,
  port: defaultSettings.port,
  error: null,
  obsVersion: null,
  obsWebSocketVersion: null,
  currentProfileName: null,
  profiles: [],
  recordDirectory: null,
  automation: {
    enabled: false,
    status: "disabled",
    logPath: null,
    currentMatch: null,
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

function formatDetectedPlayer(player: DetectedPlayer | null, label: string) {
  if (!player) {
    return (
      <Stack spacing={0.25}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="caption" color="text.secondary">
          Not detected yet
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={0.25}>
      <Typography variant="body2">{label}</Typography>
      <Typography variant="body2">Character: {player.character || "Unknown"}</Typography>
      <Typography variant="caption" color="text.secondary">
        Steam ID: {player.steamId || "Unknown"}
        {player.glicko ? ` | Glicko rating: ${player.glicko.rating}` : ""}
      </Typography>
    </Stack>
  );
}

export function ObsRecordingPanel() {
  const [state, setState] = useState<ObsState>(disconnectedState);
  const [settings, setSettings] = useState<ObsSettings>(defaultSettings);
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(true);
  const [busy, setBusy] = useState(false);
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

  const prepareProfile = async () => {
    if (!window.electronAPI?.obs) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.electronAPI.obs.prepareProfile({
        profileName: settings.profileName,
        recordDirectory: settings.recordDirectory,
      });
      setNotice(
        `Profile ready: ${result.profileName}. Recordings will go to ${result.recordDirectory}.`,
      );
    } catch (prepareError) {
      setError(displayError(prepareError));
    } finally {
      setBusy(false);
    }
  };

  const connected = state.status === "connected";
  const recording = state.recording.active;
  const manualRecording = recording && state.recording.source === "manual";
  const currentMatch = state.automation.currentMatch;
  const gameDetected = currentMatch !== null;
  const displayedError = error ?? state.error ?? state.automation.error;

  return (
    <Paper variant="outlined" sx={{ p: 3, textAlign: "left" }}>
      <Typography variant="h6">OBS recording</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Connect Labatar to OBS, prepare a dedicated recording profile, then monitor the game logs.
        Detected games start and stop their own recordings automatically.
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2 }}>
        In OBS, enable the WebSocket server under Tools â†’ WebSocket Server Settings. The default
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={connected || busy}
            autoComplete="off"
            placeholder={settings.passwordSaved ? "Saved securely" : undefined}
            sx={{ minWidth: 180 }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={rememberPassword}
                onChange={(event) => setRememberPassword(event.target.checked)}
                disabled={connected || busy}
              />
            }
            label="Remember securely"
          />
          {settings.passwordSaved && !connected && (
            <Button variant="text" onClick={() => void clearPassword()} disabled={busy}>
              Forget saved password
            </Button>
          )}
          <Button
            variant={connected ? "outlined" : "contained"}
            onClick={() => void (connected ? disconnect() : connect())}
            disabled={busy || recording || state.status === "connecting"}
          >
            {state.status === "connecting" ? "Connecting..." : connected ? "Disconnect" : "Connect"}
          </Button>
        </Stack>

        <Typography variant="body2" color={connected ? "success.main" : "text.secondary"}>
          Status: {state.status}
          {state.obsVersion ? ` · OBS ${state.obsVersion}` : ""}
          {state.obsWebSocketVersion ? ` · WebSocket ${state.obsWebSocketVersion}` : ""}
        </Typography>

        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            onClick={() => void toggleAutomaticRecording(true)}
            disabled={!connected || state.automation.enabled || busy}
          >
            Start log monitoring
          </Button>
          <Button
            variant="outlined"
            color="error"
            onClick={() => void toggleAutomaticRecording(false)}
            disabled={!connected || !state.automation.enabled || busy}
          >
            Stop log monitoring
          </Button>
        </Stack>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2">Manual recording</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
            Record directly through OBS without waiting for a detected game. Each recording is saved
            to the configured folder with the start timestamp in its filename.
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button
              variant="contained"
              onClick={() => void startManualRecording()}
              disabled={!connected || recording || busy}
            >
              Start recording
            </Button>
            <Button
              variant="outlined"
              color="error"
              onClick={() => void stopManualRecording()}
              disabled={!manualRecording || busy}
            >
              Stop recording
            </Button>
          </Stack>
          {manualRecording && (
            <Typography variant="caption" color="error.main" sx={{ mt: 1, display: "block" }}>
              Manual recording active
            </Typography>
          )}
        </Paper>

        <Typography variant="caption" color="text.secondary">
          Detection: {state.automation.status}
          {state.automation.currentMatch?.matchId
            ? ` · match ${state.automation.currentMatch.matchId}`
            : ""}
          {state.automation.pendingRecordings > 0
            ? ` · ${state.automation.pendingRecordings} replay awaiting association`
            : ""}
        </Typography>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2">Live log detection</Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Typography variant="body2">
              Monitoring: {state.automation.enabled ? "Active" : "Stopped"}
            </Typography>
            <Typography variant="body2" color={gameDetected ? "success.main" : "text.secondary"}>
              Game detected: {gameDetected ? "Yes" : "No"}
            </Typography>
            {currentMatch && (
              <>
                <Typography variant="body2">Players currently detected:</Typography>
                <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}>
                    {formatDetectedPlayer(currentMatch.player1, "Player 1")}
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}>
                    {formatDetectedPlayer(currentMatch.player2, "Player 2")}
                  </Paper>
                </Stack>
                <Typography variant="body2">Current game metadata</Typography>
                <Typography variant="caption" color="text.secondary">
                  Match ID: {currentMatch.matchId || "Unknown"}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Log time: {currentMatch.logTime || "Unknown"} | Detected at:{" "}
                  {currentMatch.startedAt}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Notes: Player 1: {currentMatch.notes.player1 || "None"} | Player 2:{" "}
                  {currentMatch.notes.player2 || "None"}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Recording trigger:{" "}
                  {currentMatch.recordingStarted ? "Started" : "Waiting for player metadata"}
                </Typography>
              </>
            )}
          </Stack>
        </Paper>

        {connected && (
          <>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <TextField
                label="Labatar profile"
                size="small"
                value={settings.profileName}
                onChange={(event) => updateSetting("profileName", event.target.value)}
                disabled={busy || recording}
                sx={{ minWidth: 220 }}
              />
              <TextField
                label="Recording directory"
                size="small"
                value={settings.recordDirectory}
                onChange={(event) => updateSetting("recordDirectory", event.target.value)}
                disabled={busy || recording}
                fullWidth
              />
              <Button
                variant="outlined"
                onClick={() => void prepareProfile()}
                disabled={busy || recording}
              >
                Prepare profile
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Current OBS profile: {state.currentProfileName ?? "unknown"} · Current output:{" "}
              {state.recordDirectory ?? "unknown"}
            </Typography>
          </>
        )}

        {recording && (
          <Typography variant="body2" color="error.main">
            Recording active{state.recording.sessionId ? ` · ${state.recording.sessionId}` : ""}
          </Typography>
        )}
        {notice && <Alert severity="success">{notice}</Alert>}
        {displayedError && <Alert severity="error">{displayedError}</Alert>}
      </Stack>
    </Paper>
  );
}
