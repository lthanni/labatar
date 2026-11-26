import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { AnchoredGuide, type AnchoredGuideStep } from "./GettingStartedDialog";

const directionOptions = [
  ["up-left", "Up-left"],
  ["up", "Up"],
  ["up-right", "Up-right"],
  ["left", "Left"],
  null,
  ["right", "Right"],
  ["down-left", "Down-left"],
  ["down", "Down"],
  ["down-right", "Down-right"],
] as const;

const flowOptions = [
  ["always", "Always Flow"],
  ["random", "Random Flow"],
  ["never", "Never Flow"],
] as const;

type Direction = NonNullable<(typeof directionOptions)[number]>[0];
type FlowMode = (typeof flowOptions)[number][0];
type RecoverySettings = {
  directions: Direction[];
  delayMs: number;
  holdMs: number;
  flowMode: FlowMode;
};
type RecoveryPreferences = {
  directions: Direction[];
  delay: string;
  hold: string;
  flowMode: FlowMode;
};

const statusLabels = {
  off: "Off",
  starting: "Starting…",
  "waiting-for-controller": "Waiting for an XInput controller…",
  ready: "Ready. Press Back/Select in the game to start.",
  delay: "Waiting to hold a direction…",
  holding: "Holding direction",
  stopping: "Stopping…",
};

type RecoveryState = {
  status: keyof typeof statusLabels;
  direction: Direction | null;
  flowHeld: boolean;
  error: string | null;
};

export type LabbingApi = {
  getState: () => Promise<RecoveryState>;
  setRecovery: (
    request: { enabled: false } | { enabled: true; settings: RecoverySettings },
  ) => Promise<RecoveryState>;
  onState: (listener: (state: RecoveryState) => void) => () => void;
};

const preferencesKey = "labatar-labbing-recovery-v1";
const defaultDirections = directionOptions.flatMap((option) => (option ? [option[0]] : []));

export function hasVisitedLabbing() {
  return localStorage.getItem(preferencesKey) !== null;
}

function readPreferences(): RecoveryPreferences {
  const defaults: RecoveryPreferences = {
    directions: defaultDirections,
    delay: "1",
    hold: "12",
    flowMode: "never",
  };
  try {
    const saved = JSON.parse(localStorage.getItem(preferencesKey) ?? "null");
    return {
      directions: Array.isArray(saved?.directions)
        ? defaultDirections.filter((direction) => saved.directions.includes(direction))
        : defaults.directions,
      delay: typeof saved?.delay === "string" ? saved.delay : defaults.delay,
      hold: typeof saved?.hold === "string" ? saved.hold : defaults.hold,
      flowMode: flowOptions.find(([mode]) => mode === saved?.flowMode)?.[0] ?? defaults.flowMode,
    };
  } catch {
    return defaults;
  }
}

function RecoveryInputDisplay({ state }: { state: RecoveryState | null }) {
  const direction = state?.direction ?? null;
  const index = directionOptions.findIndex((option) => option?.[0] === direction);
  const directionLabel = directionOptions[index]?.[1];
  const x = directionLabel ? (index % 3) - 1 : 0;
  const y = directionLabel ? Math.floor(index / 3) - 1 : 0;
  const travel = x && y ? 14 : 20;
  const flowHeld = Boolean(state?.flowHeld);

  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }} role="status">
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }} aria-hidden="true">
        <Box
          sx={{
            position: "relative",
            display: "grid",
            placeItems: "center",
            width: 64,
            height: 64,
            border: 1,
            borderColor: "divider",
            borderRadius: "50%",
            bgcolor: "background.default",
            "&::before": {
              content: '""',
              position: "absolute",
              inset: 12,
              border: 1,
              borderColor: "divider",
              borderRadius: "50%",
            },
          }}
        >
          <Box
            sx={{
              position: "relative",
              width: 20,
              height: 20,
              borderRadius: "50%",
              bgcolor: directionLabel ? "primary.main" : "text.disabled",
              boxShadow: 1,
              transform: `translate(${x * travel}px, ${y * travel}px)`,
              transition: "transform 90ms ease-out, background-color 90ms ease-out",
              "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            }}
          />
        </Box>
        <Typography
          component="span"
          variant="caption"
          sx={{
            display: "grid",
            placeItems: "center",
            width: 42,
            height: 42,
            border: 1,
            borderColor: flowHeld ? "primary.main" : "divider",
            borderRadius: "50%",
            bgcolor: flowHeld ? "primary.main" : "background.default",
            color: flowHeld ? "primary.contrastText" : "text.secondary",
            fontWeight: 700,
          }}
        >
          Flow
        </Typography>
      </Stack>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={
          directionLabel
            ? {
                position: "absolute",
                width: "1px",
                height: "1px",
                overflow: "hidden",
                clipPath: "inset(50%)",
              }
            : undefined
        }
      >
        {directionLabel
          ? `Holding ${directionLabel.toLowerCase()}${flowHeld ? " and Flow" : ""}.`
          : state
            ? statusLabels[state.status]
            : "Loading…"}
      </Typography>
    </Stack>
  );
}

const displayAnchor = "labbing-input-display";
const recoveryGuideSteps = [
  {
    section: "Labbing guide",
    title: "Choose directions",
    instruction:
      "Labatar lets you lab different recovery directions when the in-game recovery options are broken. Toggle the directions you want Player 2 to use.",
    anchor: "labbing-directions",
  },
  {
    section: "Labbing guide",
    title: "Choose a Flow mode",
    instruction: "Choose when to add Flow. Random Flow gives it a 50% chance on each hold.",
    anchor: "labbing-flow",
  },
  {
    section: "Labbing guide",
    title: "Set the timing",
    instruction: "Delay is the wait after Back/Select. Hold is how long Player 2 keeps the input.",
    anchor: "labbing-timing",
  },
  {
    section: "Labbing guide",
    title: "Try the input display",
    instruction: "Preview a hold to see how the stick and Flow button respond.",
    anchor: displayAnchor,
  },
  {
    section: "Labbing guide",
    title: "Start a drill",
    instruction:
      "Turn on P2 Recovery Mode and focus the game in training mode. Press Back/Select on your XInput controller to reset to your save point. After the delay, Labatar sends a Player 2 input to force ground recovery.",
    anchor: "labbing-enable",
  },
] satisfies readonly AnchoredGuideStep[];

const inputPreview: RecoveryState = {
  status: "holding",
  direction: "down-right",
  flowHeld: true,
  error: null,
};

export function LabbingPage({
  api,
  guideOpen,
  onGuideOpenChange,
}: {
  api: LabbingApi;
  guideOpen: boolean;
  onGuideOpenChange: (open: boolean) => void;
}) {
  const [prefs, setPrefs] = useState(readPreferences);
  const [state, setState] = useState<RecoveryState | null>(null);
  const [changing, setChanging] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [guideStep, setGuideStep] = useState(0);
  const [previewHeld, setPreviewHeld] = useState(false);
  const hasGuideSpace = useMediaQuery("(min-width: 1120px)");
  const dockGuide = guideOpen && !hasGuideSpace;

  useEffect(() => {
    let active = true;
    let receivedUpdate = false;
    const unsubscribe = api.onState((update) => {
      receivedUpdate = true;
      setState(update);
    });
    void api.getState().then(
      (initial) => {
        if (active && !receivedUpdate) setState(initial);
      },
      (error) => {
        if (active && !receivedUpdate) setRequestError(String(error));
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  useEffect(() => {
    localStorage.setItem(preferencesKey, JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => {
    if (!guideOpen) {
      setGuideStep(0);
      setPreviewHeld(false);
    }
  }, [guideOpen]);

  const enabled = state !== null && state.status !== "off" && state.status !== "stopping";
  const canEdit = state?.status === "off" && !changing;
  const delayMs = Math.round(Number(prefs.delay) * 1000);
  const holdMs = Math.round(Number(prefs.hold) * 1000);
  const validDelay = prefs.delay !== "" && Number.isSafeInteger(delayMs) && delayMs >= 0;
  const validHold = Number.isSafeInteger(holdMs) && holdMs > 0;
  const canStart = prefs.directions.length > 0 && validDelay && validHold;
  const error = requestError ?? state?.error;
  const canPreview = state?.status === "off" && !changing;
  const showPreview = guideOpen && previewHeld && canPreview;

  async function setEnabled(next: boolean) {
    setPreviewHeld(false);
    setChanging(true);
    setRequestError(null);
    try {
      await api.setRecovery(
        next
          ? {
              enabled: true,
              settings: { directions: prefs.directions, delayMs, holdMs, flowMode: prefs.flowMode },
            }
          : { enabled: false },
      );
    } catch (failure) {
      setRequestError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setChanging(false);
    }
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 680, height: dockGuide ? "100%" : undefined }}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}
      >
        <Typography variant="h5" component="h1">
          Labbing
        </Typography>
        <Button
          size="small"
          aria-expanded={guideOpen}
          onClick={() => onGuideOpenChange(!guideOpen)}
        >
          Guide
        </Button>
      </Stack>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, sm: 3 },
          ...(dockGuide && { flex: "1 1 auto", minHeight: 0, overflowY: "auto", scrollPadding: 1 }),
        }}
      >
        <Stack spacing={2.5}>
          <Box>
            <FormControlLabel
              data-guide-anchor="labbing-enable"
              control={
                <Switch
                  checked={enabled}
                  disabled={
                    !state || changing || state.status === "stopping" || (!enabled && !canStart)
                  }
                  onChange={(_, checked) => void setEnabled(checked)}
                />
              }
              label={
                <Typography variant="h6" component="h2">
                  P2 Recovery Mode
                </Typography>
              }
            />
            <Typography variant="body2" color="text.secondary">
              Each Back/Select press releases Player 2’s held input and restarts the delay before
              the next random direction.
            </Typography>
          </Box>
          <Box
            component="fieldset"
            data-guide-anchor="labbing-directions"
            sx={{ border: 0, p: 0, m: 0, minWidth: 0, maxWidth: 360 }}
          >
            <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>
              Directions
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 1,
              }}
            >
              {directionOptions.map((option) => {
                if (option === null) return <Box key="center" aria-hidden />;
                const [direction, label] = option;
                return (
                  <ToggleButton
                    key={direction}
                    value={direction}
                    size="small"
                    color="primary"
                    selected={prefs.directions.includes(direction)}
                    disabled={!canEdit}
                    onChange={() =>
                      setPrefs((current) => ({
                        ...current,
                        directions: current.directions.includes(direction)
                          ? current.directions.filter((item) => item !== direction)
                          : [...current.directions, direction],
                      }))
                    }
                    sx={{ textTransform: "none" }}
                  >
                    {label}
                  </ToggleButton>
                );
              })}
            </Box>
            {prefs.directions.length === 0 && (
              <Typography variant="caption" color="error">
                Select at least one direction.
              </Typography>
            )}
          </Box>
          <ToggleButtonGroup
            aria-label="Flow for P2 Recovery Mode"
            data-guide-anchor="labbing-flow"
            value={prefs.flowMode}
            exclusive
            size="small"
            color="primary"
            disabled={!canEdit}
            sx={{ alignSelf: "flex-start" }}
            onChange={(_, flowMode: FlowMode | null) => {
              if (flowMode !== null) setPrefs((current) => ({ ...current, flowMode }));
            }}
          >
            {flowOptions.map(([mode, label]) => (
              <ToggleButton key={mode} value={mode} sx={{ textTransform: "none" }}>
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Stack
            data-guide-anchor="labbing-timing"
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{ alignSelf: "flex-start", maxWidth: "100%" }}
          >
            <TextField
              size="small"
              label="Delay (seconds)"
              type="number"
              value={prefs.delay}
              disabled={!canEdit}
              error={!validDelay}
              helperText={!validDelay ? "Enter zero seconds or more." : undefined}
              slotProps={{ htmlInput: { min: 0, step: 0.001 } }}
              onChange={(event) => setPrefs({ ...prefs, delay: event.target.value })}
            />
            <TextField
              size="small"
              label="Hold (seconds)"
              type="number"
              value={prefs.hold}
              disabled={!canEdit}
              error={!validHold}
              helperText={!validHold ? "Enter at least 0.001 seconds." : undefined}
              slotProps={{ htmlInput: { min: 0.001, step: 0.001 } }}
              onChange={(event) => setPrefs({ ...prefs, hold: event.target.value })}
            />
          </Stack>
          <Box data-guide-anchor={displayAnchor} sx={{ alignSelf: "flex-start" }}>
            {showPreview && (
              <Typography variant="caption" color="info.main">
                Preview
              </Typography>
            )}
            <RecoveryInputDisplay state={showPreview ? inputPreview : state} />
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </Paper>
      {guideOpen && (
        <AnchoredGuide
          label="Labbing guide"
          steps={recoveryGuideSteps}
          stepIndex={guideStep}
          placement={dockGuide ? "inline" : "right-start"}
          onStepChange={(index) => {
            setPreviewHeld(false);
            setGuideStep(index);
          }}
          onClose={() => onGuideOpenChange(false)}
          action={
            recoveryGuideSteps[guideStep].anchor === displayAnchor && (
              <Box>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={!canPreview}
                  onClick={() => setPreviewHeld((held) => !held)}
                >
                  {showPreview ? "Release preview" : "Preview hold"}
                </Button>
                {enabled && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 0.5 }}
                  >
                    Turn off P2 Recovery Mode to preview.
                  </Typography>
                )}
              </Box>
            )
          }
        />
      )}
    </Stack>
  );
}
