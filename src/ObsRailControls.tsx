import { useEffect, useState, type ReactNode } from "react";
import { Box, Button, Tooltip, Typography } from "@mui/material";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import MicIcon from "@mui/icons-material/Mic";
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows";
import MonitorIcon from "@mui/icons-material/Monitor";
import ViewStreamIcon from "@mui/icons-material/ViewStream";
import AutoModeIcon from "@mui/icons-material/AutoMode";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import { useObsRecording } from "./ObsRecordingContext";

function RailButton({
  label,
  icon,
  expanded,
  onClick,
  disabled,
  active = false,
  danger = false,
  tooltip,
}: {
  label: string;
  icon: ReactNode;
  expanded: boolean;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  tooltip?: string;
}) {
  return (
    <Tooltip title={tooltip || label} placement="right" arrow>
      <span style={{ display: "block" }}>
        <Button
          fullWidth
          size="small"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          sx={{
            minWidth: 0,
            minHeight: 42,
            px: expanded ? 1.25 : 0,
            justifyContent: expanded ? "flex-start" : "center",
            gap: expanded ? 1.5 : 0,
            color: danger ? "error.main" : active ? "primary.main" : "text.secondary",
            bgcolor: active ? "action.selected" : "transparent",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textTransform: "none",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Box sx={{ width: 24, height: 24, flex: "0 0 24px" }}>{icon}</Box>
          {expanded && (
            <Typography variant="body2" noWrap>
              {label}
            </Typography>
          )}
        </Button>
      </span>
    </Tooltip>
  );
}

export function ObsRailControls({
  expanded,
  onOpenSettings,
}: {
  expanded: boolean;
  onOpenSettings: () => void;
}) {
  const {
    busy,
    state,
    obsAppRunning,
    obsLaunchBusy,
    openObsApp,
    connect,
    disconnect,
    startManualRecording,
    stopManualRecording,
    moveCapture,
    disarmMoveCapture,
    setSourceToggle,
    toggleAutomaticRecording,
  } = useObsRecording();
  const [automaticMoveRunOpen, setAutomaticMoveRunOpen] = useState(false);

  useEffect(() => {
    const api = window.electronAPI?.moveCapture;
    if (!api?.automaticStatus || !api.onAutomaticState) return;
    let active = true;
    const updateRun = (run: { status: string }) => {
      if (active) setAutomaticMoveRunOpen(["countdown", "running", "paused"].includes(run.status));
    };
    const unsubscribe = api.onAutomaticState(updateRun);
    void api
      .automaticStatus()
      .then(updateRun)
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const connected = state.status === "connected";
  const recording = state.recording.active;
  const manualRecording = recording && state.recording.source === "manual";
  const sceneReady =
    connected && state.currentSceneName === "Labatar - Game" && Boolean(state.sourceToggles);
  const monitorCapture = state.sourceToggles?.monitorCapture ?? false;
  const gameOnly = state.sourceToggles?.gameOnly ?? false;
  const connectLabel =
    state.status === "connecting"
      ? "Connecting..."
      : connected
        ? "Disconnect OBS"
        : obsAppRunning === false
          ? "Open OBS"
          : "Connect OBS";

  return (
    <Box aria-label="OBS controls" sx={{ display: "grid", gap: 0.25 }}>
      {expanded && (
        <Typography variant="overline" sx={{ px: 1.25, color: "text.secondary" }}>
          OBS
        </Typography>
      )}
      <RailButton
        label={connectLabel}
        icon={<PowerSettingsNewIcon />}
        expanded={expanded}
        active={connected}
        disabled={
          busy ||
          obsLaunchBusy ||
          recording ||
          state.status === "connecting" ||
          (connected && automaticMoveRunOpen)
        }
        onClick={() => {
          if (connected) void disconnect();
          else if (obsAppRunning === false)
            void openObsApp().then((opened) => {
              if (!opened) onOpenSettings();
            });
          else
            void connect().then((succeeded) => {
              if (!succeeded) onOpenSettings();
            });
        }}
      />
      {sceneReady && (
        <RailButton
          label={monitorCapture ? "Monitor capture" : gameOnly ? "Game only" : "Video source"}
          icon={<MonitorIcon />}
          expanded={expanded}
          active={monitorCapture}
          disabled={busy || recording}
          tooltip={
            recording
              ? "Stop recording before changing the video source."
              : monitorCapture
                ? "Monitor capture · Switch to Game only"
                : gameOnly
                  ? "Game only · Switch to Monitor capture"
                  : "Choose a video source."
          }
          onClick={() => {
            if (!monitorCapture && !gameOnly) {
              onOpenSettings();
              return;
            }
            void setSourceToggle("monitorCapture", !monitorCapture).then((changed) => {
              if (!changed) onOpenSettings();
            });
          }}
        />
      )}
      {(
        [
          { key: "microphone", label: "Microphone", icon: <MicIcon /> },
          { key: "desktopAudio", label: "Desktop audio", icon: <DesktopWindowsIcon /> },
          { key: "pressureFramebar", label: "P2 framebar", icon: <ViewStreamIcon /> },
        ] as const
      ).map(({ key, label, icon }) => {
        const enabled = state.sourceToggles?.[key] ?? false;
        const unavailable =
          key === "pressureFramebar" && !state.sourceToggles?.pressureFramebarReady;
        const automaticFramebar = key === "pressureFramebar" && state.automation.enabled;
        const monitorFramebar = key === "pressureFramebar" && monitorCapture;
        return (
          <RailButton
            key={key}
            label={label}
            icon={icon}
            expanded={expanded}
            active={enabled}
            disabled={
              busy ||
              recording ||
              !sceneReady ||
              unavailable ||
              automaticFramebar ||
              monitorFramebar
            }
            tooltip={
              !connected
                ? "Connect to OBS to change scene sources."
                : !sceneReady
                  ? "Select the Labatar - Game scene to change its sources."
                  : recording
                    ? "Stop recording before changing scene sources."
                    : automaticFramebar
                      ? "Stop automatic recording before turning on the P2 framebar."
                      : monitorFramebar
                        ? "Select Game only to use the P2 framebar."
                        : unavailable
                          ? "Open the game and apply OBS setup again to place the P2 crop."
                          : `${label}: ${enabled ? "on" : "off"}`
            }
            onClick={() => void setSourceToggle(key, !enabled)}
          />
        );
      })}
      <RailButton
        label={state.automation.enabled ? "Stop automatic recording" : "Start automatic recording"}
        icon={<AutoModeIcon />}
        expanded={expanded}
        active={state.automation.enabled}
        danger={state.automation.enabled && state.automation.status === "error"}
        disabled={
          !connected ||
          busy ||
          manualRecording ||
          (!state.automation.enabled && (recording || automaticMoveRunOpen))
        }
        tooltip={
          automaticMoveRunOpen && !state.automation.enabled
            ? "Finish or cancel the automatic move capture pass first."
            : state.automation.error || `Automatic recording: ${state.automation.status}`
        }
        onClick={() => void toggleAutomaticRecording(!state.automation.enabled)}
      />
      <RailButton
        label={
          manualRecording
            ? "Stop recording"
            : moveCapture.armed
              ? `Record ${moveCapture.armed.moveLabel} ${moveCapture.armed.outcome} take`
              : "Start recording"
        }
        icon={<FiberManualRecordIcon />}
        expanded={expanded}
        active={manualRecording}
        danger={manualRecording}
        disabled={
          !connected ||
          busy ||
          automaticMoveRunOpen ||
          (!manualRecording && (recording || state.automation.enabled))
        }
        tooltip={
          automaticMoveRunOpen
            ? "Finish or cancel the automatic move capture pass first."
            : state.automation.enabled && !manualRecording
              ? "Stop automatic recording before starting a manual recording."
              : undefined
        }
        onClick={() => void (manualRecording ? stopManualRecording() : startManualRecording())}
      />
      {expanded && state.automation.enabled && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.25 }}>
          Auto: {state.automation.status}
          {state.recording.source === "automatic" ? " · REC" : ""}
        </Typography>
      )}
      {expanded && moveCapture.armed && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.25 }}>
          Armed: {moveCapture.armed.characterLabel} · {moveCapture.armed.moveLabel}
        </Typography>
      )}
      {moveCapture.armed && (
        <RailButton
          label="Disarm move take"
          icon={<CancelOutlinedIcon />}
          expanded={expanded}
          disabled={busy || recording}
          onClick={() => void disarmMoveCapture()}
        />
      )}
    </Box>
  );
}
