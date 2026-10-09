import { Box, Stack, Tooltip, Typography } from "@mui/material";
import YouTubeIcon from "@mui/icons-material/YouTube";
import type { RecordingPortraitMatchup, RecordingPortraitSide } from "./recording-types";

function PortraitSide({ side, align }: { side: RecordingPortraitSide; align: "left" | "right" }) {
  const right = align === "right";
  return (
    <Stack
      direction={right ? "row-reverse" : "row"}
      spacing={0.75}
      sx={{
        flex: 1,
        minWidth: 0,
        alignItems: "center",
        justifyContent: "flex-start",
      }}
    >
      {side.portraitUrl ? (
        <Box
          component="img"
          src={side.portraitUrl}
          alt={`${side.character} portrait`}
          loading="lazy"
          sx={{ width: 48, height: 48, objectFit: "contain", flexShrink: 0, borderRadius: 1 }}
        />
      ) : (
        <Box
          sx={{ width: 48, height: 48, flexShrink: 0, borderRadius: 1, bgcolor: "action.hover" }}
        />
      )}
      {side.supportUrl && (
        <Box
          component="img"
          src={side.supportUrl}
          alt={`${side.support} support portrait`}
          loading="lazy"
          sx={{ width: 38, height: 48, objectFit: "contain", flexShrink: 0 }}
        />
      )}
      <Box sx={{ minWidth: 0, textAlign: right ? "right" : "left" }}>
        <Typography variant="body2" noWrap title={side.playerName}>
          {side.playerName}
        </Typography>
      </Box>
    </Stack>
  );
}

export function RecordingPortraitMatchupView({
  matchup,
  detail,
  fileName,
  youtubeLinked = false,
}: {
  matchup: RecordingPortraitMatchup;
  detail: string;
  fileName?: string;
  youtubeLinked?: boolean;
}) {
  return (
    <Stack spacing={0.35} sx={{ flex: 1, minWidth: 0, py: 0.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
        <PortraitSide side={matchup.players[0]} align="left" />
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          vs
        </Typography>
        <PortraitSide side={matchup.players[1]} align="right" />
      </Stack>
      {fileName && (
        <Typography variant="caption" color="text.secondary" noWrap title={fileName}>
          {fileName}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" noWrap>
          {detail}
        </Typography>
        {(youtubeLinked || matchup.gameCount > 1) && (
          <Stack
            direction="row"
            spacing={0.75}
            sx={{ alignItems: "center", ml: "auto", flexShrink: 0 }}
          >
            {youtubeLinked && (
              <Tooltip title="YouTube video linked">
                <YouTubeIcon
                  color="error"
                  titleAccess="YouTube video linked"
                  sx={{ fontSize: 18 }}
                />
              </Tooltip>
            )}
            {matchup.gameCount > 1 && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {matchup.gameCount} games
              </Typography>
            )}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
