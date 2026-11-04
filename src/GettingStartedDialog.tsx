import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import type { GuideSection } from "./GuidesDialog";

export type TourStep = {
  title: string;
  purpose: string;
  how: readonly string[];
  tab?: number;
  settingsSection?: "game" | "obs";
  guideSection?: GuideSection;
  exploreLabel?: string;
};

export function GettingStartedDialog({
  open,
  steps,
  stepIndex,
  onStepChange,
  onExplore,
  onOpenGuide,
  onClose,
}: {
  open: boolean;
  steps: readonly TourStep[];
  stepIndex: number;
  onStepChange: (index: number) => void;
  onExplore: (step: TourStep) => void;
  onOpenGuide: (section: GuideSection) => void;
  onClose: () => void;
}) {
  const step = steps[stepIndex];
  if (!step) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="tour-title">
      <DialogTitle id="tour-title">Getting started with Labatar</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {stepIndex + 1} of {steps.length}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={((stepIndex + 1) / steps.length) * 100}
              aria-label="Tour progress"
              sx={{ mt: 0.5 }}
            />
          </Box>
          <Box>
            <Typography variant="h6" gutterBottom>
              {step.title}
            </Typography>
            <Typography variant="body2">{step.purpose}</Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              How to use it
            </Typography>
            <Box component="ol" sx={{ m: 0, pl: 2.5, typography: "body2", "& li + li": { mt: 1 } }}>
              {step.how.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </Box>
          </Box>
          {(step.exploreLabel || step.guideSection) && (
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              {step.exploreLabel && (
                <Button size="small" variant="outlined" onClick={() => onExplore(step)}>
                  {step.exploreLabel}
                </Button>
              )}
              {step.guideSection && (
                <Button size="small" onClick={() => onOpenGuide(step.guideSection!)}>
                  Read detailed guide
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between" }}>
        <Button onClick={onClose}>{stepIndex === steps.length - 1 ? "Close" : "Skip tour"}</Button>
        <Stack direction="row" spacing={1}>
          <Button disabled={stepIndex === 0} onClick={() => onStepChange(stepIndex - 1)}>
            Back
          </Button>
          <Button
            variant="contained"
            onClick={() =>
              stepIndex === steps.length - 1 ? onClose() : onStepChange(stepIndex + 1)
            }
          >
            {stepIndex === steps.length - 1 ? "Finish" : stepIndex === 0 ? "Start tour" : "Next"}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
