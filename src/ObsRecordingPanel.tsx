import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useObsRecording } from "./ObsRecordingContext";

type CaptureState = {
  hotkey: string;
  hotkeyRegistered: boolean;
  lastAction: "started" | "stopped" | null;
  error: string | null;
};

export function ObsRecordingPanel() {
  const {
    state,
    settings,
    password,
    passwordFocused,
    rememberPassword,
    busy,
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
    setupScenes,
    setScene,
  } = useObsRecording();
  const connected = state.status === "connected";
  const recording = state.recording.active;
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
  const displayedError = error ?? state.error ?? state.automation.error;
  const [captureState, setCaptureState] = useState<CaptureState | null>(null);
  const [captureHotkey, setCaptureHotkey] = useState("F9");
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.capture) return;
    let active = true;
    const unsubscribe = window.electronAPI.capture.onState((nextState) => {
      if (!active) return;
      setCaptureState(nextState);
      setCaptureHotkey(nextState.hotkey);
    });
    void window.electronAPI.capture.getState().then((nextState) => {
      if (!active) return;
      setCaptureState(nextState);
      setCaptureHotkey(nextState.hotkey);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const saveCaptureSettings = async () => {
    if (!window.electronAPI?.capture) return;
    setCaptureBusy(true);
    setCaptureNotice(null);
    setCaptureError(null);
    try {
      const nextState = await window.electronAPI.capture.setSettings({
        hotkey: captureHotkey,
      });
      setCaptureState(nextState);
      setCaptureNotice(
        `Global capture shortcut ${nextState.hotkey} ${nextState.hotkeyRegistered ? "registered" : "not registered"}.`,
      );
    } catch (saveError) {
      setCaptureError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setCaptureBusy(false);
    }
  };

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
        expandIcon={<span aria-hidden="true">v</span>}
        sx={{ "& .MuiAccordionSummary-content": { alignItems: "center" } }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6">Capture configuration</Typography>
          <Typography color="text.secondary">
            Connect Labatar to OBS and configure the profile, scenes, and automatic recording.
          </Typography>
        </Box>
        <Typography
          variant="caption"
          color={recording ? "error.main" : connected ? "success.main" : "text.secondary"}
          sx={{ mr: 2, flexShrink: 0 }}
        >
          {recording ? "Recording active" : state.status}
        </Typography>
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

          <Box sx={{ borderTop: 1, borderColor: "divider", pt: 2 }}>
            <Typography variant="subtitle2">Global capture shortcut</Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              This shortcut starts and stops the OBS recording without requiring Labatar to be
              focused.
            </Typography>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1}
              sx={{ alignItems: "center" }}
            >
              <TextField
                label="Shortcut"
                size="small"
                value={captureHotkey}
                onChange={(event) => setCaptureHotkey(event.target.value)}
                disabled={captureBusy || recording}
                helperText="Examples: F9 or CommandOrControl+Shift+R"
                sx={{ minWidth: 260 }}
              />
              <Button
                variant="outlined"
                onClick={() => void saveCaptureSettings()}
                disabled={captureBusy || recording}
              >
                Save shortcut
              </Button>
            </Stack>
            <Typography
              variant="caption"
              color={captureState?.hotkeyRegistered ? "success.main" : "warning.main"}
              component="div"
              sx={{ mt: 1 }}
            >
              {captureState
                ? `${captureState.hotkey}: ${captureState.hotkeyRegistered ? "registered" : "not registered"}`
                : "Loading shortcut status..."}
            </Typography>
            {captureNotice && (
              <Alert severity="success" sx={{ mt: 1 }}>
                {captureNotice}
              </Alert>
            )}
            {captureError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {captureError}
              </Alert>
            )}
          </Box>

          {connected && (
            <>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                <TextField
                  label="Labatar profile"
                  size="small"
                  value={settings.profileName}
                  disabled
                  sx={{ minWidth: 220 }}
                />
                <TextField
                  label="Recording directory"
                  size="small"
                  value={settings.recordDirectory}
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
              Recording active{state.recording.sessionId ? ` | ${state.recording.sessionId}` : ""}
            </Typography>
          )}
          {notice && <Alert severity="success">{notice}</Alert>}
          {displayedError && <Alert severity="error">{displayedError}</Alert>}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
