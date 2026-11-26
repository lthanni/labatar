import { Box, Typography } from "@mui/material";
import { framebarColorMap, type FramebarColorDefinition } from "./framebar-color-map";

const legendEntries = [
  { label: "Idle", meaning: "No move in progress", colors: ["idle"] },
  { label: "Startup", meaning: "Move begins", colors: ["startup", "startup-bright"] },
  { label: "Active", meaning: "Attack can connect", colors: ["active", "active-bright"] },
  { label: "Gap between hits", meaning: "Pause between active windows", colors: ["multihit-gap"] },
  { label: "Recovery", meaning: "Move finishes", colors: ["recovery", "recovery-bright"] },
  { label: "Flow stance", meaning: "Stance state", colors: ["flow-stance"] },
  { label: "Airborne", meaning: "Character is in the air", colors: ["airborne"] },
  { label: "Blockstun", meaning: "Defender recovers from blocking", colors: ["blockstun"] },
  { label: "Hit pause", meaning: "Brief freeze on contact", colors: ["hitpause"] },
] as const;

export function FramebarLegend({
  colors = framebarColorMap,
}: {
  colors?: FramebarColorDefinition[];
}) {
  return (
    <Box component="section" aria-label="Framebar color legend" sx={{ px: 1, py: 0.75 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        Framebar colors
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 2, rowGap: 0.75 }}>
        {legendEntries.map((entry) => {
          const swatches = entry.colors
            .map(
              (name) =>
                colors.find((color) => color.name === name) ??
                framebarColorMap.find((color) => color.name === name),
            )
            .filter((color): color is FramebarColorDefinition => Boolean(color));
          if (swatches.length === 0) return null;
          return (
            <Box key={entry.label} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
              <Box sx={{ display: "inline-flex", gap: 0.25 }} aria-hidden="true">
                {swatches.map((color) => (
                  <Box
                    key={color.name}
                    sx={{
                      width: 14,
                      height: 14,
                      borderRadius: 0.5,
                      border: "1px solid",
                      borderColor: "text.secondary",
                      backgroundColor: `rgb(${color.red}, ${color.green}, ${color.blue})`,
                    }}
                  />
                ))}
              </Box>
              <Typography variant="caption">
                {entry.label}{" "}
                <Box component="span" sx={{ color: "text.secondary" }}>
                  ({entry.meaning})
                </Box>
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
