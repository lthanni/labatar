import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";

export type ControllerBindings = Record<string, string>;
type Artwork = Record<string, string>;
type GameButton = "A" | "B" | "C" | "F";

const mainButtons = ["X", "Y", "B", "A", "RB", "RT", "LB", "LT"] as const;
const extraButtons = ["Start", "Back"] as const;
const buttons: readonly string[] = [...mainButtons, ...extraButtons];
const padArtKey: Record<string, string> = Object.fromEntries(
  ["a", "b", "x", "y", "rb", "rt", "lb", "lt", "start", "back"].map((name) => [
    name.toUpperCase() === "START"
      ? "Start"
      : name.toUpperCase() === "BACK"
        ? "Back"
        : name.toUpperCase(),
    `pad-${name}`,
  ]),
);
const actions: readonly { id: string; label: string; detail: string; glyphs: GameButton[] }[] = [
  { id: "Atk1", label: "Attack A", detail: "A", glyphs: ["A"] },
  { id: "Atk2", label: "Attack B", detail: "B", glyphs: ["B"] },
  { id: "Atk3", label: "Attack C", detail: "C", glyphs: ["C"] },
  { id: "Atk4", label: "Flow", detail: "F", glyphs: ["F"] },
  { id: "DashShortcut", label: "Dash", detail: "B+C", glyphs: ["B", "C"] },
  { id: "SuperShortcut", label: "Super", detail: "A+B+C", glyphs: ["A", "B", "C"] },
  { id: "ThrowShortcut", label: "Throw", detail: "A+F", glyphs: ["A", "F"] },
  { id: "GuardReversalShortcut", label: "Guard Reversal", detail: "C+F", glyphs: ["C", "F"] },
];
const knownActions = new Map(actions.map((action) => [action.id, action]));
const fallbackColors: Record<GameButton, string> = {
  A: "#2c64a0",
  B: "#c79a22",
  C: "#c7491d",
  F: "#138e90",
};

function editableBindings(bindings: ControllerBindings): ControllerBindings {
  return Object.fromEntries(
    Object.entries(bindings).filter(([button, action]) => buttons.includes(button) && !!action),
  );
}

function GameGlyphs({ glyphs, artwork }: { glyphs: readonly GameButton[]; artwork: Artwork }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 0.25, sm: 0.5 }, minWidth: 0 }}>
      {glyphs.map((glyph, index) => (
        <Box
          key={`${glyph}-${index}`}
          sx={{ display: "flex", alignItems: "center", gap: { xs: 0.25, sm: 0.5 } }}
        >
          {index > 0 && (
            <Typography
              component="span"
              sx={{ color: "white", fontSize: { xs: 18, sm: 23 }, fontWeight: 900 }}
            >
              +
            </Typography>
          )}
          {artwork[`game-${glyph.toLowerCase()}`] ? (
            <Box
              component="img"
              src={artwork[`game-${glyph.toLowerCase()}`]}
              alt=""
              sx={{ width: { xs: 29, sm: 42 }, height: { xs: 29, sm: 42 }, objectFit: "contain" }}
            />
          ) : (
            <Box
              aria-hidden="true"
              sx={{
                width: { xs: 27, sm: 40 },
                height: { xs: 27, sm: 40 },
                borderRadius: "50%",
                bgcolor: fallbackColors[glyph],
                border: "2px solid #241b14",
                color: "white",
                display: "grid",
                placeItems: "center",
                fontSize: { xs: 15, sm: 22 },
                fontWeight: 900,
                textShadow: "0 1px 2px #111",
              }}
            >
              {glyph}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

function PadGlyph({ button, artwork }: { button: string; artwork: Artwork }) {
  const src = artwork[padArtKey[button]];
  return src ? (
    <Box component="img" src={src} alt="" sx={{ width: 49, height: 49, objectFit: "contain" }} />
  ) : (
    <Box
      aria-hidden="true"
      sx={{
        width: 45,
        height: 39,
        borderRadius: button.length > 2 ? "8px" : "50%",
        border: "2px solid #131313",
        bgcolor: "#252626",
        color: "#d7dedb",
        display: "grid",
        placeItems: "center",
        fontSize: button.length > 2 ? 12 : 22,
        fontWeight: 900,
      }}
    >
      {button}
    </Box>
  );
}

export function ControllerBindingsDialog({
  open,
  bindings,
  busy = false,
  onClose,
  onSave,
}: {
  open: boolean;
  bindings: ControllerBindings;
  busy?: boolean;
  onClose: () => void;
  onSave: (bindings: ControllerBindings) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ControllerBindings>(() => editableBindings(bindings));
  const [artwork, setArtwork] = useState<Artwork>({});
  const [showExtra, setShowExtra] = useState(false);
  const [showControllerSetup, setShowControllerSetup] = useState(false);
  const [listeningAction, setListeningAction] = useState<string | null>(null);
  const [detectionMessage, setDetectionMessage] = useState("");
  const [detectionError, setDetectionError] = useState("");
  const listeningRef = useRef(false);
  const cancellationRequestedRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  const [error, setError] = useState("");
  function cancelDetection() {
    cancellationRequestedRef.current = true;
    void window.electronAPI?.obs.cancelControllerButtonDetection().catch(() => undefined);
  }
  useEffect(() => {
    if (!open) return;
    setDraft(editableBindings(bindings));
    setShowExtra(Boolean(bindings.Start || bindings.Back));
    setShowControllerSetup(false);
    setDetectionMessage("");
    setDetectionError("");
    setError("");
  }, [open, bindings]);
  useEffect(() => {
    if (!open) return;
    return () => {
      if (listeningRef.current) {
        cancelDetection();
      }
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void window.electronAPI?.obs.getControllerBindingArtwork().then(
      (images) => {
        if (active) setArtwork(images);
      },
      () => {
        if (active) setArtwork({});
      },
    );
    return () => {
      active = false;
    };
  }, [open]);

  function listenForAction(actionId: string) {
    const api = window.electronAPI?.obs;
    if (!api || listeningRef.current) return;
    const action = knownActions.get(actionId);
    if (!action) return;
    listeningRef.current = true;
    cancellationRequestedRef.current = false;
    setListeningAction(actionId);
    setDetectionMessage("");
    setDetectionError("");
    setError("");
    void api
      .detectControllerButton()
      .then(
        (button) => {
          if (!openRef.current || cancellationRequestedRef.current) return;
          const previousAction = knownActions.get(draft[button] ?? "")?.label;
          setDraft((current) => {
            const next = Object.fromEntries(
              Object.entries(current).filter(([, assigned]) => assigned !== actionId),
            );
            next[button] = actionId;
            return next;
          });
          if (button === "Start" || button === "Back") setShowExtra(true);
          setDetectionMessage(
            `${button} assigned to ${action.label}${previousAction && previousAction !== action.label ? `; ${previousAction} is now unassigned` : ""}.`,
          );
        },
        (reason) => {
          if (!openRef.current || cancellationRequestedRef.current || reason?.name === "AbortError")
            return;
          setDetectionError(reason instanceof Error ? reason.message : String(reason));
        },
      )
      .finally(() => {
        listeningRef.current = false;
        cancellationRequestedRef.current = false;
        setListeningAction(null);
      });
  }

  function closeDialog() {
    if (listeningRef.current) {
      cancelDetection();
    }
    onClose();
  }

  function renderRow(button: string) {
    const actionId = draft[button] ?? "";
    const action = knownActions.get(actionId);
    return (
      <Select
        key={button}
        value={actionId}
        displayEmpty
        aria-label={`${button} action`}
        disabled={busy || listeningAction !== null}
        onChange={(event) => {
          const value = event.target.value;
          setDraft((current) => {
            const next = { ...current };
            if (value) next[button] = value;
            else delete next[button];
            return next;
          });
        }}
        renderValue={() => (
          <Box
            sx={{
              display: "grid",
              width: "100%",
              alignItems: "center",
              px: { xs: 1.5, sm: 2 },
              gridTemplateColumns: {
                xs: "minmax(112px, 36%) minmax(0, 1fr) 52px",
                sm: "minmax(158px, 39%) minmax(0, 1fr) 58px",
              },
            }}
          >
            <GameGlyphs glyphs={action?.glyphs ?? []} artwork={artwork} />
            <Typography
              component="span"
              sx={{
                color: "white",
                fontFamily: '"Trebuchet MS", system-ui, sans-serif',
                fontSize: { xs: 17, sm: 24 },
                fontWeight: 900,
                lineHeight: 1.05,
                textShadow: "0 1px 2px #41240f",
              }}
            >
              {action?.label ?? (actionId ? `Saved: ${actionId}` : "Unassigned")}
            </Typography>
            <PadGlyph button={button} artwork={artwork} />
          </Box>
        )}
        sx={{
          width: "100%",
          height: { xs: 65, sm: 74 },
          bgcolor: "#6c3c17",
          backgroundImage: artwork.row
            ? `url("${artwork.row}")`
            : "linear-gradient(90deg, #743e15, #8e511c)",
          backgroundSize: "100% 100%",
          borderRadius: 0,
          "&:hover, &.Mui-focused": {
            backgroundImage: artwork["row-focused"]
              ? `url("${artwork["row-focused"]}")`
              : undefined,
          },
          "& .MuiOutlinedInput-notchedOutline": {
            border: artwork.row ? "none" : "2px solid #b18b62",
          },
          "& .MuiSelect-select": {
            display: "flex",
            alignItems: "center",
            padding: "0 !important",
            height: "100% !important",
          },
          "& .MuiSelect-icon": { display: "none" },
        }}
      >
        <MenuItem value="">Unassigned</MenuItem>
        {actionId && !action && (
          <MenuItem value={actionId}>Keep saved action ({actionId})</MenuItem>
        )}
        {actions.map((choice) => (
          <MenuItem key={choice.id} value={choice.id} sx={{ gap: 1.5 }}>
            <GameGlyphs glyphs={choice.glyphs} artwork={artwork} />
            <Typography sx={{ ml: "auto" }}>
              {choice.label} ({choice.detail})
            </Typography>
          </MenuItem>
        ))}
      </Select>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : closeDialog}
      fullWidth
      maxWidth="sm"
      slotProps={{
        paper: { sx: { bgcolor: "#1e2b32", border: "2px solid #b98a50", color: "#f7f0e4" } },
      }}
    >
      <DialogTitle
        sx={{
          fontFamily: '"Trebuchet MS", system-ui, sans-serif',
          fontWeight: 900,
          letterSpacing: 0.5,
        }}
      >
        Controller button bindings
      </DialogTitle>
      <DialogContent sx={{ px: { xs: 1.5, sm: 2.5 } }}>
        <Typography variant="body2" sx={{ mb: 2, color: "#d6d4cb" }}>
          Choose the game action for each controller button. Shortcuts show their underlying buttons
          in routes and subtitles.
        </Typography>
        <Button
          size="small"
          onClick={() => setShowControllerSetup((current) => !current)}
          disabled={listeningAction !== null}
          sx={{ mb: 1.5, color: "#f1c788" }}
          aria-expanded={showControllerSetup}
        >
          {showControllerSetup ? "Hide controller setup" : "Set bindings with controller"}
        </Button>
        {showControllerSetup && (
          <Box sx={{ mb: 2, p: 1.5, border: "1px solid #a77c49", bgcolor: "#172228" }}>
            <Typography variant="body2" sx={{ color: "#d6d4cb", mb: 1 }}>
              Choose an action, release all buttons, then press the button on the first connected
              XInput controller.
            </Typography>
            <Stack spacing={0.5}>
              {actions.map((action) => {
                const assigned = Object.entries(draft)
                  .filter(([, value]) => value === action.id)
                  .map(([button]) => button);
                return (
                  <Box
                    key={action.id}
                    sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: 43 }}
                  >
                    <Box sx={{ width: 140, flexShrink: 0 }}>
                      <GameGlyphs glyphs={action.glyphs} artwork={artwork} />
                    </Box>
                    <Typography sx={{ flex: 1, fontWeight: 700, fontSize: { xs: 14, sm: 16 } }}>
                      {action.label}
                    </Typography>
                    <Typography variant="body2" sx={{ color: "#d6d4cb", minWidth: 48 }}>
                      {assigned.join(", ") || "—"}
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy || listeningAction !== null}
                      onClick={() => listenForAction(action.id)}
                      sx={{ color: "#f1c788", borderColor: "#a77c49", minWidth: 70 }}
                    >
                      {listeningAction === action.id ? "Waiting…" : "Press"}
                    </Button>
                  </Box>
                );
              })}
            </Stack>
            {listeningAction && (
              <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2" sx={{ flex: 1, color: "#f1c788" }}>
                  Waiting for {knownActions.get(listeningAction)?.label}. Release, then press a
                  button.
                </Typography>
                <Button size="small" onClick={cancelDetection} sx={{ color: "#f1c788" }}>
                  Cancel listening
                </Button>
              </Box>
            )}
            {detectionMessage && (
              <Alert severity="success" sx={{ mt: 1 }}>
                {detectionMessage}
              </Alert>
            )}
            {detectionError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {detectionError}
              </Alert>
            )}
          </Box>
        )}
        <Stack spacing={0.5}>{mainButtons.map(renderRow)}</Stack>
        <Button
          size="small"
          onClick={() => setShowExtra((current) => !current)}
          sx={{ mt: 1.5, color: "#f1c788" }}
          aria-expanded={showExtra}
        >
          {showExtra ? "Hide Start and Back" : "Show Start and Back"}
        </Button>
        {showExtra && (
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            {extraButtons.map(renderRow)}
          </Stack>
        )}
        <Typography variant="caption" sx={{ display: "block", mt: 1.5, color: "#c3c5c3" }}>
          These labels affect Labatar input processing. Change your actual controls in the game.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 2 }}>
        <Button onClick={closeDialog} disabled={busy} sx={{ color: "#e6d6be" }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy || listeningAction !== null}
          sx={{
            bgcolor: "#b36b2a",
            color: "white",
            fontWeight: 800,
            "&:hover": { bgcolor: "#ca8237" },
          }}
          onClick={() => {
            void onSave(draft).catch((reason) =>
              setError(reason instanceof Error ? reason.message : String(reason)),
            );
          }}
        >
          {busy ? "Saving…" : "Save bindings"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
