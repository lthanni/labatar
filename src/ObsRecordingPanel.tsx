import {
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
  chapterHotkey: string;
  chapterHotkeyRegistered: boolean;
  chapterLastAddedAt: string | null;
  chapterError: string | null;
  autoGameChapters: boolean;
  autoClipManualChapters: boolean;
};

export function ObsRecordingPanel({ onOpenGuide }: { onOpenGuide: () => void }) {
  const {
    state,
    settings,
    password,
    passwordFocused,
    rememberPassword,
    busy,
    notice,
    error,
    connectFailed,
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
  const [chapterHotkey, setChapterHotkey] = useState("F10");
  const [captureBusy, setCaptureBusy] = useState(false);
  const [chapterShortcutBusy, setChapterShortcutBusy] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [chapterShortcutNotice, setChapterShortcutNotice] = useState<string | null>(null);
  const [chapterShortcutError, setChapterShortcutError] = useState<string | null>(null);
  const [chapterBusy, setChapterBusy] = useState(false);
  const [gameChapterBusy, setGameChapterBusy] = useState(false);
  const [gameChapterError, setGameChapterError] = useState<string | null>(null);
  const [autoClipBusy, setAutoClipBusy] = useState(false);
  const [autoClipError, setAutoClipError] = useState<string | null>(null);
  const [obsLaunchBusy, setObsLaunchBusy] = useState(false);
  const [obsLaunchNotice, setObsLaunchNotice] = useState<string | null>(null);
  const [obsLaunchError, setObsLaunchError] = useState<string | null>(null);

  useEffect(() => {
    if (connected) {
      setObsLaunchNotice(null);
      setObsLaunchError(null);
    }
  }, [connected]);

  useEffect(() => {
    if (!window.electronAPI?.capture) return;
    let active = true;
    const unsubscribe = window.electronAPI.capture.onState((nextState) => {
      if (!active) return;
      setCaptureState(nextState);
      setCaptureHotkey(nextState.hotkey);
      setChapterHotkey(nextState.chapterHotkey);
    });
    void window.electronAPI.capture.getState().then((nextState) => {
      if (!active) return;
      setCaptureState(nextState);
      setCaptureHotkey(nextState.hotkey);
      setChapterHotkey(nextState.chapterHotkey);
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

  const addChapter = async () => {
    if (!window.electronAPI?.capture) return;
    setChapterBusy(true);
    try {
      await window.electronAPI.capture.addChapter();
    } catch {
      // The capture state displays the OBS error sent by the main process.
    } finally {
      setChapterBusy(false);
    }
  };

  const saveChapterShortcut = async () => {
    if (!window.electronAPI?.capture) return;
    setChapterShortcutBusy(true);
    setChapterShortcutNotice(null);
    setChapterShortcutError(null);
    try {
      const nextState = await window.electronAPI.capture.setChapterSettings({
        hotkey: chapterHotkey,
      });
      setCaptureState(nextState);
      setChapterHotkey(nextState.chapterHotkey);
      setChapterShortcutNotice(
        `Recording chapter shortcut ${nextState.chapterHotkey} ${nextState.chapterHotkeyRegistered ? "registered" : "not registered"}.`,
      );
    } catch (saveError) {
      setChapterShortcutError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setChapterShortcutBusy(false);
    }
  };

  const setAutoGameChapters = async (enabled: boolean) => {
    if (!window.electronAPI?.capture) return;
    setGameChapterBusy(true);
    setGameChapterError(null);
    try {
      setCaptureState(await window.electronAPI.capture.setAutoGameChapters(enabled));
    } catch (settingError) {
      setGameChapterError(
        settingError instanceof Error ? settingError.message : String(settingError),
      );
    } finally {
      setGameChapterBusy(false);
    }
  };

  const setAutoClipManualChapters = async (enabled: boolean) => {
    if (!window.electronAPI?.capture) return;
    setAutoClipBusy(true);
    setAutoClipError(null);
    try {
      setCaptureState(await window.electronAPI.capture.setAutoClipManualChapters(enabled));
    } catch (settingError) {
      setAutoClipError(settingError instanceof Error ? settingError.message : String(settingError));
    } finally {
      setAutoClipBusy(false);
    }
  };

  const openObsApp = async () => {
    if (!window.electronAPI?.obs) return;
    setObsLaunchBusy(true);
    setObsLaunchNotice(null);
    setObsLaunchError(null);
    try {
      if (await window.electronAPI.obs.openApp()) {
        setObsLaunchNotice(
          "OBS launch requested. Once OBS is running and its WebSocket server is ready, retry the connection.",
        );
      }
    } catch (launchError) {
      setObsLaunchError(launchError instanceof Error ? launchError.message : String(launchError));
    } finally {
      setObsLaunchBusy(false);
    }
  };

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        textAlign: "left",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, px: 3, pt: 2, pb: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6">Capture configuration</Typography>
          <Typography color="text.secondary">
            Connect Labatar to OBS and configure the profile, scenes, and automatic recording.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
          <Button size="small" onClick={onOpenGuide}>
            Recording guide
          </Button>
          <Typography
            variant="caption"
            color={recording ? "error.main" : connected ? "success.main" : "text.secondary"}
          >
            {recording ? "Recording active" : state.status}
          </Typography>
        </Stack>
      </Box>
      <Box sx={{ px: 3, pb: 3 }}>
        {connectFailed && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={
              <Button
                color="secondary"
                variant="outlined"
                size="small"
                sx={{ textTransform: "none" }}
                onClick={() => void openObsApp()}
                disabled={obsLaunchBusy || busy}
              >
                attempt to open OBS
              </Button>
            }
          >
            Could not connect to OBS. Is OBS running? If it is, check its WebSocket server, port,
            and password, then retry the connection.
            {displayedError && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                {displayedError}
              </Typography>
            )}
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2 }}>
          In OBS, enable the WebSocket server under Tools: WebSocket Server Settings. The default
          port is 4455; use the password configured there.
        </Typography>

        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap" }}
          >
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
            {!connected && !connectFailed && (
              <Button
                variant="outlined"
                color="secondary"
                sx={{ textTransform: "none" }}
                onClick={() => void openObsApp()}
                disabled={obsLaunchBusy || busy}
              >
                attempt to open OBS
              </Button>
            )}
          </Stack>

          {obsLaunchNotice && <Alert severity="success">{obsLaunchNotice}</Alert>}
          {obsLaunchError && <Alert severity="error">{obsLaunchError}</Alert>}

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

          <Box sx={{ borderTop: 1, borderColor: "divider", pt: 2 }}>
            <Typography variant="subtitle2">Recording chapter marker</Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              Use this global shortcut while recording, even when Labatar is not focused, to add an
              unnamed chapter directly to the OBS Hybrid MP4. OBS saves chapters when the recording
              stops.
            </Typography>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1}
              sx={{ alignItems: "center", mb: 1 }}
            >
              <TextField
                label="Chapter shortcut"
                size="small"
                value={chapterHotkey}
                onChange={(event) => setChapterHotkey(event.target.value)}
                disabled={chapterShortcutBusy || recording}
                helperText="Examples: F10 or CommandOrControl+Shift+C"
                sx={{ minWidth: 260 }}
              />
              <Button
                variant="outlined"
                onClick={() => void saveChapterShortcut()}
                disabled={chapterShortcutBusy || recording}
              >
                Save shortcut
              </Button>
            </Stack>
            <Button
              variant="outlined"
              onClick={() => void addChapter()}
              disabled={!connected || !recording || state.recording.paused || chapterBusy}
            >
              Add chapter marker ({captureState?.chapterHotkey ?? "F10"})
            </Button>
            <Typography
              variant="caption"
              color={captureState?.chapterHotkeyRegistered ? "success.main" : "warning.main"}
              component="div"
              sx={{ mt: 1 }}
            >
              {captureState
                ? `${captureState.chapterHotkey}: ${captureState.chapterHotkeyRegistered ? "registered" : "not registered"}`
                : "Loading chapter shortcut status..."}
            </Typography>
            {chapterShortcutNotice && (
              <Alert severity="success" sx={{ mt: 1 }}>
                {chapterShortcutNotice}
              </Alert>
            )}
            {chapterShortcutError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {chapterShortcutError}
              </Alert>
            )}
            {captureState?.chapterLastAddedAt && recording && (
              <Alert severity="success" sx={{ mt: 1 }}>
                OBS accepted a chapter marker at{" "}
                {new Date(captureState.chapterLastAddedAt).toLocaleTimeString()}.
              </Alert>
            )}
            {captureState?.chapterError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {captureState.chapterError}
              </Alert>
            )}
            <FormControlLabel
              sx={{ mt: 1 }}
              control={
                <Checkbox
                  checked={captureState?.autoGameChapters ?? false}
                  disabled={!captureState || gameChapterBusy}
                  onChange={(_, checked) => void setAutoGameChapters(checked)}
                />
              }
              label="Add game-start chapters to future automatic MP4 recordings"
            />
            <Typography variant="caption" color="text.secondary" component="div">
              After OBS stops and replay linking finishes, Labatar copies the MP4 streams into a
              chaptered file without re-encoding. Existing F10 chapters are kept. This may take time
              and needs temporary free space roughly equal to the recording size.
            </Typography>
            {gameChapterError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {gameChapterError}
              </Alert>
            )}
            <FormControlLabel
              sx={{ mt: 1 }}
              control={
                <Checkbox
                  checked={captureState?.autoClipManualChapters ?? true}
                  disabled={!captureState || autoClipBusy}
                  onChange={(_, checked) => void setAutoClipManualChapters(checked)}
                />
              }
              label="Auto-clip 30 seconds before manual chapters"
            />
            <Typography variant="caption" color="text.secondary" component="div">
              After a recording stops, create clips for its F10 chapters. Turning this off does not
              disable F10 chapters or the manual clip action. Changes apply to recordings stopped
              after the switch is changed.
            </Typography>
            {autoClipError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {autoClipError}
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
          {!connectFailed && displayedError && <Alert severity="error">{displayedError}</Alert>}
        </Stack>
      </Box>
    </Box>
  );
}
