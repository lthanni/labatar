import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Typography,
} from "@mui/material";
import type { ReplayStagingOptions, ReplayStagingPreview } from "./replay-staging-types";

const openGamePreference = "labatar.replays.openGameAfterPreparing";

export function ReplayStagingDialog({
  preview,
  selectionLabel,
  busy,
  onClose,
  onConfirm,
}: {
  preview: ReplayStagingPreview | null;
  selectionLabel: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (options: ReplayStagingOptions) => void;
}) {
  const open = preview !== null;
  const closeGame = preview?.gameRunning ?? false;
  const [openGame, setOpenGame] = useState(false);
  useEffect(() => {
    if (!open) return;
    try {
      setOpenGame(localStorage.getItem(openGamePreference) === "true");
    } catch {
      // Keep the current choice if storage is unavailable.
    }
  }, [open]);

  function changeOpenGame(checked: boolean) {
    setOpenGame(checked);
    try {
      localStorage.setItem(openGamePreference, String(checked));
    } catch {
      // The current prompt can still use the choice.
    }
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()}>
      <DialogTitle>Prepare replays for in-game playback</DialogTitle>
      <DialogContent>
        {closeGame && (
          <Typography variant="body2" sx={{ mb: 1 }}>
            Avatar Legends is running. Labatar will ask it to close before preparing the replays.
          </Typography>
        )}
        <Typography variant="body2">
          Labatar will preserve the existing replay folder and place only the{" "}
          {preview?.selectedCount} replay{preview?.selectedCount === 1 ? "" : "s"} from{" "}
          {selectionLabel} in the game’s replay folder.
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          {preview?.switching
            ? "The original replay tree remains preserved."
            : `${preview?.archivedCount} existing replays will remain available in Labatar.`}{" "}
          Any new replays saved afterward will be kept when you switch or restore.
        </Typography>
        <FormControlLabel
          sx={{ mt: 1 }}
          label="Open game after preparing"
          control={
            <Checkbox
              checked={openGame}
              disabled={busy}
              onChange={(event) => changeOpenGame(event.target.checked)}
            />
          }
        />
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          color={closeGame ? "error" : "primary"}
          variant={closeGame ? "contained" : "text"}
          disabled={busy}
          onClick={() => onConfirm({ closeGame, openGame })}
        >
          {busy ? "Preparing…" : closeGame ? "Close game and prepare" : "Prepare replays"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
