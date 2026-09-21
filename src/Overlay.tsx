import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

const overlayConfigKey = "avatar-overlay-config";
type OverlayConfig = {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  targetX: number;
  targetY: number;
  targetWidth: number;
  targetHeight: number;
};

const defaultOverlayConfig: OverlayConfig = {
  sourceX: 51.8,
  sourceY: 91,
  sourceWidth: 41.4,
  sourceHeight: 4.5,
  targetX: 4.9,
  targetY: 94,
  targetWidth: 41.4,
  targetHeight: 4.5,
};

function readOverlayConfig(): OverlayConfig {
  try {
    const saved = JSON.parse(
      localStorage.getItem(overlayConfigKey) ?? "null",
    ) as Partial<OverlayConfig> | null;
    return { ...defaultOverlayConfig, ...saved };
  } catch {
    return defaultOverlayConfig;
  }
}

const configFields: Array<{ key: keyof OverlayConfig; label: string }> = [
  { key: "sourceX", label: "Source X" },
  { key: "sourceY", label: "Source Y" },
  { key: "sourceWidth", label: "Source width" },
  { key: "sourceHeight", label: "Source height" },
  { key: "targetX", label: "Target X" },
  { key: "targetY", label: "Target Y" },
  { key: "targetWidth", label: "Target width" },
  { key: "targetHeight", label: "Target height" },
];

export function VisualOverlay() {
  const [visible, setVisible] = useState(false);
  const [onlyWhenFocused, setOnlyWhenFocused] = useState(true);
  const [config, setConfig] = useState<OverlayConfig>(readOverlayConfig);
  const showOverlay = async () => {
    await window.electronAPI?.overlay.show();
    setVisible(true);
  };
  const hideOverlay = async () => {
    await window.electronAPI?.overlay.hide();
    setVisible(false);
  };
  const changeFocusMode = async (enabled: boolean) => {
    const result = await window.electronAPI?.overlay.setFocusMode(enabled);
    setOnlyWhenFocused(result ?? enabled);
  };
  useEffect(() => {
    void window.electronAPI?.overlay.isVisible().then(setVisible);
  }, []);
  const updateConfig = (key: keyof OverlayConfig, value: string) => {
    const next = { ...config, [key]: Number(value) };
    setConfig(next);
    localStorage.setItem(overlayConfigKey, JSON.stringify(next));
  };
  const resetConfig = () => {
    setConfig(defaultOverlayConfig);
    localStorage.setItem(overlayConfigKey, JSON.stringify(defaultOverlayConfig));
  };
  return (
    <Paper variant="outlined" sx={{ p: 3, textAlign: "left" }}>
      <Typography variant="h6">Visual overlay</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Basic always-on-top overlay test window. Game capture and visual analysis will be added
        next.
      </Typography>
      <Stack direction="row" spacing={1}>
        <Button variant="contained" onClick={showOverlay} disabled={visible}>
          Show overlay
        </Button>
        <Button variant="outlined" onClick={hideOverlay} disabled={!visible}>
          Hide overlay
        </Button>
      </Stack>
      <FormControlLabel
        control={
          <Checkbox
            checked={onlyWhenFocused}
            onChange={(event) => void changeFocusMode(event.target.checked)}
          />
        }
        label="Only show when game is focused"
      />
      <Typography variant="subtitle2" sx={{ mt: 2 }}>
        Mirrored region and destination (percent of screen)
      </Typography>
      <Typography variant="caption" color="text.secondary">
        X/Y are measured from the top-left. Width/height are percentages. Changes are saved
        automatically.
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
        {configFields.map(({ key, label }) => (
          <TextField
            key={key}
            label={label}
            type="number"
            size="small"
            value={config[key]}
            onChange={(event) => updateConfig(key, event.target.value)}
            slotProps={{ htmlInput: { min: 0, max: 100, step: 0.1 } }}
            sx={{ width: 125 }}
          />
        ))}
      </Stack>
      <Button size="small" sx={{ mt: 1 }} onClick={resetConfig}>
        Reset overlay geometry
      </Button>
    </Paper>
  );
}

export function OverlaySurface() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const configRef = useRef<OverlayConfig>(readOverlayConfig());
  useEffect(() => {
    const syncConfig = () => {
      configRef.current = readOverlayConfig();
    };
    window.addEventListener("storage", syncConfig);
    return () => window.removeEventListener("storage", syncConfig);
  }, []);
  useEffect(() => {
    let frame = 0;
    let stream: MediaStream | null = null;
    const start = async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const captureSource = await window.electronAPI?.overlay.getCaptureSource();
      if (!captureSource) throw new Error("No display source is available for the game monitor");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: captureSource.id,
          },
        } as MediaTrackConstraints,
      });
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      const draw = () => {
        const canvas = canvasRef.current;
        if (canvas && video.videoWidth) {
          const width = window.innerWidth;
          const height = window.innerHeight;
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (context) {
            const config = configRef.current;
            const sourceX = video.videoWidth * (config.sourceX / 100);
            const sourceY = video.videoHeight * (config.sourceY / 100);
            const sourceWidth = video.videoWidth * (config.sourceWidth / 100);
            const sourceHeight = Math.max(24, video.videoHeight * (config.sourceHeight / 100));
            const targetX = width * (config.targetX / 100);
            const targetY = height * (config.targetY / 100);
            const targetWidth = width * (config.targetWidth / 100);
            const targetHeight = height * (config.targetHeight / 100);
            context.clearRect(0, 0, width, height);
            context.drawImage(
              video,
              sourceX,
              sourceY,
              sourceWidth,
              sourceHeight,
              targetX,
              targetY,
              targetWidth,
              targetHeight,
            );
          }
        }
        frame = requestAnimationFrame(draw);
      };
      draw();
    };
    void start();
    return () => {
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  return (
    <>
      <Box
        sx={{
          position: "fixed",
          top: 24,
          left: 24,
          zIndex: 2,
          p: 2,
          color: "white",
          backgroundColor: "red",
          fontWeight: 700,
        }}
      >
        OVERLAY WINDOW TEST
      </Box>
      <video ref={videoRef} style={{ display: "none" }} />
      <canvas
        ref={canvasRef}
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%" }}
      />
    </>
  );
}
