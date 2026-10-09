import { useEffect, useState } from "react";
import { Alert, Button, LinearProgress, Paper, Stack, Typography } from "@mui/material";

type ArtworkProgress = {
  runId: string;
  stage: string;
  message: string;
  current: number | null;
  total: number | null;
};

export function ArtworkPanel({ onImported }: { onImported: () => void }) {
  const api = window.electronAPI?.artwork;
  const [progress, setProgress] = useState<ArtworkProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [savedPortraits, setSavedPortraits] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    return api.onProgress(setProgress);
  }, [api]);

  const importArtwork = async () => {
    if (!api) return;
    setError(null);
    setSavedPortraits(null);
    setBusy(true);
    setCancelling(false);
    setProgress(null);
    try {
      const result = await api.extract();
      setSavedPortraits(result.savedPortraits);
      onImported();
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : String(importError);
      if (message !== "Artwork extraction cancelled.") setError(message);
    } finally {
      setBusy(false);
      setCancelling(false);
    }
  };

  const cancelImport = async () => {
    if (!api || !progress?.runId || cancelling) return;
    setCancelling(true);
    try {
      await api.cancel({ runId: progress.runId });
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
      setCancelling(false);
    }
  };

  if (!api) return <Alert severity="warning">Artwork import is unavailable.</Alert>;

  return (
    <Paper variant="outlined" sx={{ p: 2, maxWidth: 720, mx: "auto", textAlign: "left" }}>
      <Stack spacing={2}>
        <div>
          <Typography variant="h6">Game artwork</Typography>
          <Typography variant="body2" color="text.secondary">
            Decode the game&apos;s encoded files to display character and support portraits. You
            should only need to do this once, or again if a game update adds new characters or
            supports. The app reads the data_packages folder inside your selected game folder
            automatically. Decoded artwork stays on this computer and is not added to the
            repository.
          </Typography>
        </div>
        <Stack direction="row" spacing={1}>
          <Button variant="contained" onClick={() => void importArtwork()} disabled={busy}>
            {busy ? "Importing artwork..." : "Import game artwork"}
          </Button>
          {busy && (
            <Button
              color="error"
              variant="outlined"
              onClick={() => void cancelImport()}
              disabled={!progress?.runId || cancelling}
            >
              {cancelling ? "Cancelling..." : "Cancel"}
            </Button>
          )}
        </Stack>
        {busy && (
          <Stack spacing={0.75} aria-live="polite">
            <Typography variant="body2">{progress?.message ?? "Starting import..."}</Typography>
            <LinearProgress
              variant={progress?.total ? "determinate" : "indeterminate"}
              value={
                progress?.total && progress.current !== null
                  ? (progress.current / progress.total) * 100
                  : undefined
              }
            />
          </Stack>
        )}
        {!busy && progress?.stage === "cancelled" && (
          <Alert severity="info">Artwork import cancelled.</Alert>
        )}
        {savedPortraits !== null && (
          <Alert severity="success">Imported {savedPortraits} portraits.</Alert>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Paper>
  );
}
