import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { isGuideYouTubeAuthorizationError, type GuidePublication } from "./guide-publication";

export function GuidePublicationFeedback({
  publishingTitle,
  queued,
  progress,
  error,
  connectionError,
  publishedTitle,
  onCheck,
  onDismissSuccess,
}: {
  publishingTitle?: string;
  queued: { id: string; title: string }[];
  progress: Record<string, GuidePublication["progress"]>;
  error: string;
  connectionError: string;
  publishedTitle: string;
  onCheck: () => void;
  onDismissSuccess: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [target, setTarget] = useState<"hosted" | "local" | null>(null);
  const needsAuthorization = isGuideYouTubeAuthorizationError(error);

  function openHelp() {
    setHelpOpen(true);
    void window.electronAPI?.catalogBackend?.get().then(
      ({ mode }) => setTarget(mode),
      () => setTarget(null),
    );
  }

  if (!publishingTitle && !queued.length && !error && !connectionError && !publishedTitle)
    return null;

  return (
    <>
      <Stack
        spacing={1}
        aria-live="polite"
        sx={{ flexShrink: 0, maxHeight: "35vh", overflowY: "auto" }}
      >
        {publishingTitle && (
          <Alert severity="info">
            Preparing publication for {publishingTitle}…
            <LinearProgress aria-label="Preparing guide publication" sx={{ mt: 0.75 }} />
          </Alert>
        )}
        {queued.map(({ id, title }) => {
          const status = progress[id];
          const waiting = status?.phase === "waiting-for-authorization";
          const uploading = status?.phase === "uploading";
          const message = waiting
            ? "Waiting for backend YouTube authorization."
            : status?.phase === "publishing"
              ? "Publishing to the catalog…"
              : uploading
                ? `Uploading to YouTube. ${status.completedVideos} of ${status.totalVideos} videos uploaded.`
                : "Queued for YouTube upload. The backend will pick it up automatically.";
          return (
            <Alert
              key={id}
              severity={waiting ? "warning" : "info"}
              action={
                waiting && (
                  <Button color="inherit" size="small" onClick={openHelp}>
                    Recovery steps
                  </Button>
                )
              }
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {title}
              </Typography>
              {message}
              {!waiting && (
                <LinearProgress aria-label="Guide publication in progress" sx={{ mt: 0.75 }} />
              )}
            </Alert>
          );
        })}
        {connectionError && (
          <Alert
            severity="warning"
            action={
              <Button size="small" color="inherit" onClick={onCheck}>
                Check publication
              </Button>
            }
          >
            {connectionError}
          </Alert>
        )}
        {error && (
          <Alert
            severity="warning"
            action={
              needsAuthorization && (
                <Button color="inherit" size="small" onClick={openHelp}>
                  Recovery steps
                </Button>
              )
            }
          >
            {error}
            {needsAuthorization && (
              <Typography variant="body2">
                The catalog owner can reconnect the backend YouTube account.
              </Typography>
            )}
          </Alert>
        )}
        {publishedTitle && (
          <Alert severity="success" onClose={onDismissSuccess}>
            Published {publishedTitle}.
          </Alert>
        )}
      </Stack>
      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Restore guide uploads to YouTube</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            {target !== "local" && (
              <>
                <Typography variant="subtitle2">Hosted catalog</Typography>
                <Typography variant="body2">
                  The catalog owner needs access to the Labatar repository, the Google Desktop OAuth
                  client, and the Cloudflare account for the catalog Worker.
                </Typography>
                <Typography
                  variant="body2"
                  component="ol"
                  sx={{ pl: 3, my: 0, "& li + li": { mt: 1 } }}
                >
                  <li>
                    From the repository root, check that the OAuth client is available with{" "}
                    <code>node backend/scripts/authorize-guide-youtube.mjs --check</code>.
                  </li>
                  <li>
                    Sign Wrangler in to the Cloudflare account that owns the catalog Worker. Run{" "}
                    <code>node backend/scripts/authorize-guide-youtube.mjs</code>.
                  </li>
                  <li>
                    Open the Google authorization URL printed by the script and choose{" "}
                    <strong>@ATLAbatar</strong>. Wait for the script to confirm the Worker secrets
                    were updated.
                  </li>
                </Typography>
              </>
            )}
            {target !== "hosted" && (
              <>
                <Typography variant="subtitle2">Local Wrangler</Typography>
                <Typography variant="body2">
                  Update <code>YOUTUBE_CLIENT_ID</code>, <code>YOUTUBE_CLIENT_SECRET</code>,{" "}
                  <code>YOUTUBE_REFRESH_TOKEN</code>, and <code>YOUTUBE_CHANNEL_ID</code> in{" "}
                  <code>backend/.dev.vars</code> using the local test credentials. Restart the local
                  Worker.
                </Typography>
              </>
            )}
            <Typography variant="body2">
              Return to the guide and choose Publish again if the job failed. A queued job can
              resume automatically. The backend reuses videos it already uploaded.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHelpOpen(false)}>Done</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
