import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Popper,
  Stack,
  Typography,
} from "@mui/material";

export type GuideStep = {
  section: "OBS" | "Record a combo" | "Submit a candidate";
  title: string;
  instruction: string;
  why?: string;
  images?: readonly { src: string; alt: string; caption: string }[];
  anchor: string;
  fallbackAnchor?: string;
  fallbackInstruction?: string;
  tab?: number;
  settingsSection?: "obs";
};

function visibleAnchor(name: string | undefined): HTMLElement | null {
  if (!name) return null;
  const element = document.querySelector<HTMLElement>(`[data-guide-anchor="${name}"]`);
  return element?.getClientRects().length && getComputedStyle(element).visibility === "visible"
    ? element
    : null;
}

export function GettingStartedGuide({
  open,
  steps,
  stepIndex,
  onStepChange,
  onClose,
}: {
  open: boolean;
  steps: readonly GuideStep[];
  stepIndex: number;
  onStepChange: (index: number) => void;
  onClose: () => void;
}) {
  const step = steps[stepIndex];
  const targetName = step?.anchor;
  const fallbackName = step?.fallbackAnchor;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [onTarget, setOnTarget] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const preview = step?.images?.[previewIndex ?? -1];
  const sections = (["OBS", "Record a combo", "Submit a candidate"] as const)
    .map((name) => ({ name, index: steps.findIndex((item) => item.section === name) }))
    .filter(({ index }) => index >= 0);

  useEffect(() => {
    if (!open || !targetName) return;
    let highlighted: HTMLElement | null = null;
    const locate = () => {
      const target = visibleAnchor(targetName);
      const next = target ?? visibleAnchor(fallbackName) ?? visibleAnchor("guide-launcher");
      if (highlighted !== target) {
        highlighted?.classList.remove("labatar-guide-target");
        target?.classList.add("labatar-guide-target");
        highlighted = target;
        target?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      setAnchor((current) => (current === next ? current : next));
      setOnTarget(Boolean(target));
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "aria-hidden"],
    });
    window.addEventListener("resize", locate);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", locate);
      highlighted?.classList.remove("labatar-guide-target");
    };
  }, [open, stepIndex, targetName, fallbackName]);

  useEffect(() => setPreviewIndex(null), [stepIndex, open]);

  if (!step) return null;

  return (
    <>
      <Popper
        open={open && Boolean(anchor)}
        anchorEl={anchor}
        placement="bottom-start"
        modifiers={[{ name: "offset", options: { offset: [0, 14] } }]}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 1, maxWidth: "calc(100vw - 24px)" }}
      >
        <Paper
          elevation={12}
          role="region"
          aria-label="Getting started guide"
          sx={{
            width: { xs: "min(340px, calc(100vw - 24px))", sm: 360 },
            p: 2,
            border: 1,
            borderColor: "info.main",
            animation: "labatar-guide-enter 180ms ease-out",
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        >
          <Stack spacing={1.5}>
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
              <Typography variant="overline" color="info.main">
                {step.section} · {stepIndex + 1} of {steps.length}
              </Typography>
              <Button size="small" onClick={onClose} aria-label="Close getting started guide">
                Close
              </Button>
            </Stack>
            <Box component="nav" aria-label="Guide sections" sx={{ display: "flex", gap: 0.5 }}>
              {sections.map(({ name, index }) => (
                <Button
                  key={name}
                  size="small"
                  variant={step.section === name ? "contained" : "text"}
                  color="info"
                  onClick={() => onStepChange(index)}
                  sx={{ textTransform: "none", px: 1 }}
                >
                  {name === "Record a combo"
                    ? "Combo"
                    : name === "Submit a candidate"
                      ? "Candidate"
                      : name}
                </Button>
              ))}
            </Box>
            <Box component="nav" aria-label="Guide steps" sx={{ display: "flex", gap: 0.5 }}>
              {steps.map((item, index) => (
                <Button
                  key={item.title}
                  size="small"
                  variant={index === stepIndex ? "contained" : "outlined"}
                  color={index === stepIndex ? "info" : "inherit"}
                  aria-label={`${index + 1}. ${item.title}`}
                  aria-current={index === stepIndex ? "step" : undefined}
                  title={item.title}
                  onClick={() => onStepChange(index)}
                  sx={{ minWidth: 0, width: 29, height: 29, p: 0, borderRadius: "50%" }}
                >
                  {index + 1}
                </Button>
              ))}
            </Box>
            <Box aria-live="polite">
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }} gutterBottom>
                {step.title}
              </Typography>
              <Typography variant="body2">
                {onTarget ? step.instruction : (step.fallbackInstruction ?? step.instruction)}
              </Typography>
            </Box>
            {step.images && (
              <Stack direction="row" spacing={1} sx={{ alignItems: "stretch" }}>
                {step.images.map((item, index) => (
                  <Button
                    key={item.caption}
                    size="small"
                    variant="outlined"
                    onClick={() => setPreviewIndex(index)}
                    aria-label={`Enlarge ${item.caption}`}
                    sx={{ width: "50%", minWidth: 0, p: 0.75, textTransform: "none" }}
                  >
                    <Stack spacing={0.5} sx={{ alignItems: "center" }}>
                      <Box
                        component="img"
                        src={item.src}
                        alt=""
                        sx={{ maxWidth: "100%", height: 90, objectFit: "contain" }}
                      />
                      <Typography variant="caption">{item.caption}</Typography>
                    </Stack>
                  </Button>
                ))}
              </Stack>
            )}
            {step.why && (
              <Box sx={{ p: 1.25, bgcolor: "action.hover", borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {step.why}
                </Typography>
              </Box>
            )}
            <Stack direction="row" sx={{ justifyContent: "space-between" }}>
              <Button
                size="small"
                disabled={stepIndex === 0}
                onClick={() => onStepChange(stepIndex - 1)}
              >
                Back
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={() =>
                  stepIndex === steps.length - 1 ? onClose() : onStepChange(stepIndex + 1)
                }
              >
                {stepIndex === steps.length - 1 ? "Finish" : "Next"}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Popper>
      <Dialog
        open={open && Boolean(preview)}
        onClose={() => setPreviewIndex(null)}
        maxWidth="lg"
        sx={{ zIndex: (theme) => theme.zIndex.modal + 2 }}
      >
        <DialogTitle>{preview?.caption}</DialogTitle>
        <DialogContent>
          {preview && (
            <Box
              component="img"
              src={preview.src}
              alt={preview.alt}
              sx={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "calc(100vh - 160px)",
                objectFit: "contain",
              }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewIndex(null)}>Close image</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
