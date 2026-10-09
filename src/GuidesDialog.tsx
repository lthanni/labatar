import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";

export type GuideSection = "matches" | "staging" | "recording";

// Change an entry's ID when its guidance changes enough to need a fresh confirmation.
export const guideEntryIds = {
  matches: ["matches-overview-v1", "matches-context-menu-v1", "matches-prepare-v1"],
  staging: ["staging-changes-v1", "staging-restore-v1", "staging-recovery-v1"],
  recording: [
    "recording-modes-v1",
    "recording-frame-analysis-v1",
    "recording-chapters-v1",
    "recording-library-v1",
    "recording-performance-v1",
    "recording-timing-v1",
  ],
} as const;

export type GuideEntryId = (typeof guideEntryIds)[GuideSection][number];
export const allGuideEntryIds: readonly GuideEntryId[] = Object.values(guideEntryIds).flat();

function GuideTopic({
  title,
  children,
  read,
  onConfirmRead,
}: {
  title: string;
  children: ReactNode;
  read: boolean;
  onConfirmRead: () => void;
}) {
  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Button
          size="small"
          variant={read ? "text" : "outlined"}
          disabled={read}
          onClick={onConfirmRead}
          sx={{ flexShrink: 0 }}
        >
          {read ? "Read ✓" : "Mark as read"}
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {children}
      </Typography>
    </Box>
  );
}

export function GuidesDialog({
  open,
  section,
  readEntryIds,
  onSectionChange,
  onConfirmRead,
  onClose,
}: {
  open: boolean;
  section: GuideSection;
  readEntryIds: ReadonlySet<string>;
  onSectionChange: (section: GuideSection) => void;
  onConfirmRead: (id: GuideEntryId) => void;
  onClose: () => void;
}) {
  const unreadCount = (topic: GuideSection) =>
    guideEntryIds[topic].filter((id) => !readEntryIds.has(id)).length;
  const entryProps = (id: GuideEntryId) => ({
    read: readEntryIds.has(id),
    onConfirmRead: () => onConfirmRead(id),
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="guides-title">
      <DialogTitle id="guides-title">Guides</DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 2, sm: 3 } }}>
        <Tabs
          value={section}
          onChange={(_, value: GuideSection) => onSectionChange(value)}
          variant="scrollable"
          allowScrollButtonsMobile
          aria-label="Guide topics"
          sx={{ mb: 2 }}
        >
          <Tab
            value="matches"
            label={`Match history${unreadCount("matches") ? ` (${unreadCount("matches")})` : ""}`}
          />
          <Tab
            value="staging"
            label={`Replay staging${unreadCount("staging") ? ` (${unreadCount("staging")})` : ""}`}
          />
          <Tab
            value="recording"
            label={`Recording${unreadCount("recording") ? ` (${unreadCount("recording")})` : ""}`}
          />
        </Tabs>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 2 }}>
          Mark each entry as read after reviewing it. Confirmations are saved on this device.
        </Typography>
        {section === "matches" && (
          <Stack spacing={2} role="tabpanel" aria-label="Match history guide">
            <GuideTopic title="Explore sets and games" {...entryProps(guideEntryIds.matches[0])}>
              A set row groups its games. Open a set to see the individual games; the table's
              filters and date range narrow what you see.
            </GuideTopic>
            <GuideTopic title="Right-click a row" {...entryProps(guideEntryIds.matches[1])}>
              Right-click a set or a game in the table to open its actions. You can show its files
              in File Explorer, export the set or replay as a ZIP, or prepare its replays for
              playback inside the game. Actions on a set include every game in that set.
            </GuideTopic>
            <GuideTopic title="Prepare for playback" {...entryProps(guideEntryIds.matches[2])}>
              The preparation action temporarily puts only the selected replays in the game's replay
              folder. Read the Replay staging guide before using it.
            </GuideTopic>
          </Stack>
        )}
        {section === "staging" && (
          <Stack spacing={2} role="tabpanel" aria-label="Replay staging guide">
            <GuideTopic title="What staging changes" {...entryProps(guideEntryIds.staging[0])}>
              In Match History, right-click a game or set and choose Prepare for in-game playback.
              Labatar preserves the existing replay folder beside it and creates a temporary replay
              folder containing copies of the selected files. The preserved replays remain visible
              in Match History.
            </GuideTopic>
            <GuideTopic title="When you are done" {...entryProps(guideEntryIds.staging[1])}>
              Use Restore original replays in the Match History banner. You can also prepare another
              game or set directly. New replays saved while staged are kept when you switch or
              restore; a same-name file is kept separately instead of replacing an older replay.
            </GuideTopic>
            <GuideTopic title="Safety and recovery" {...entryProps(guideEntryIds.staging[2])}>
              Close the game before preparing, switching, or restoring replays. If Labatar reports a
              missing archive or invalid staging state, keep both replay folders intact and back
              them up before attempting manual recovery.
            </GuideTopic>
          </Stack>
        )}
        {section === "recording" && (
          <Stack spacing={2} role="tabpanel" aria-label="Recording guide">
            <GuideTopic
              title="Manual and automatic recording"
              {...entryProps(guideEntryIds.recording[0])}
            >
              Connect OBS first. Start recording captures immediately until you stop it. Start
              automatic recording watches game events and controls OBS around supported matches; it
              may begin before the first game to retain pre-game footage. If the needed event or
              match identity is missing, automatic capture or replay linking may be incomplete.
            </GuideTopic>
            <GuideTopic
              title="Set up OBS for frame analysis"
              {...entryProps(guideEntryIds.recording[1])}
            >
              In Settings, apply the Labatar OBS setup and confirm Capture frame rate shows 60 fps.
              Exact frame timing requires an original 60 fps recording. A 30 fps recording can still
              be useful for reviewing play, but cannot establish exact frame boundaries. Analysis
              results should be checked against the video.
            </GuideTopic>
            <GuideTopic title="Chapters and clips" {...entryProps(guideEntryIds.recording[2])}>
              While OBS is recording, F10 adds a chapter to a Hybrid MP4. OBS saves chapters when it
              finalizes the file. Labatar can create a separate clip of the 30 seconds before each
              manual chapter. Optional game-start chapters are added after automatic recording and
              replay linking; existing OBS chapters are kept.
            </GuideTopic>
            <GuideTopic
              title="In the recording library"
              {...entryProps(guideEntryIds.recording[3])}
            >
              Select a recording to watch it. Expand a recording to see its clips. Right-click a
              recording to rename it, manage its YouTube link, rebuild eligible chapters or clips,
              or delete it. With a recording selected, Space plays or pauses and Q/E step backward
              or forward by a frame.
            </GuideTopic>
            <GuideTopic
              title="Time, storage, and performance"
              {...entryProps(guideEntryIds.recording[4])}
            >
              Recording video uses OBS encoding resources and disk space. Creating F10 clips encodes
              new video files in the background, so it can take time and add substantial storage
              use. Adding game-start chapters copies the MP4 streams without re-encoding, but needs
              temporary free space roughly equal to the recording size. If storage or processing
              time is a concern, turn off automatic F10 clips or game-start chapters in Capture
              configuration. Frame analysis reads video frames and can take time; short clips are
              easier to review and process.
            </GuideTopic>
            <GuideTopic title="Timing limits" {...entryProps(guideEntryIds.recording[5])}>
              OBS must finalize the MP4 for its chapters to be available. Game-start chapter times
              come from game logs and can be inaccurate after pauses or clock changes.
            </GuideTopic>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
