import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  overlayColorMap,
  findClosestOverlayColor,
  type OverlayColorMatch,
  overlayCellGroupsKey,
  overlayCellGroupLogKey,
  overlayPlayer1CellGroupsKey,
  overlayPlayer1CellGroupLogKey,
  overlayDetectInputKey,
  overlayInputObservationKey,
  overlayInputEventLogKey,
  overlayMoveEpisodeLogKey,
  overlayRuntimeMapKey,
  overlayUnmappedKey,
  overlayPlayer1UnmappedKey,
  overlayPlayer2UnmappedKey,
} from "./overlay-color-map";
import {
  detectInputDisplay,
  formatInputDisplayObservation,
  formatInputDisplayDebug,
  readDigitTemplates,
  resolveRecentInput,
  writeDigitTemplates,
  type InputDisplayObservation,
  type DigitTemplate,
  type NumberGlyphSample,
  type ResolvedInput,
} from "./input-display";
import {
  captureCornerFingerprint,
  cornerObservationKey,
  cornerRegionLabels,
  cornerRegionParts,
  defaultCornerRegions,
  findCornerMatches,
  formatCornerMatch,
  readCornerTemplates,
  writeCornerTemplates,
  type CornerObservation,
  type CornerRegionKey,
  type CornerTemplate,
} from "./corner-detection";
import {
  appendTrainingMeterSample,
  createTrainingMeterTracker,
  fitTrainingMeterCalibration,
  formatTrainingMeterStatus,
  readTrainingMeterCalibration,
  scoreTrainingMeterPresence,
  trainingMeterCalibrationModeKey,
  updateTrainingMeterTracker,
  writeTrainingMeterCalibration,
  type TrainingMeterScore,
  type TrainingMeterTracker,
} from "./training-meter";

const overlayConfigKey = "avatar-overlay-config";
const overlayOverrideKey = "avatar-overlay-allow-override";
const overlayDetectCornersKey = "avatar-overlay-detect-corners";
const overlayTextDebugKey = "avatar-overlay-show-text-debug";
const overlayCaptureEnabledKey = "avatar-overlay-capture-enabled";
const overlayCaptureRequestedKey = "avatar-overlay-capture-requested";
const overlayCaptureSessionKey = "avatar-overlay-capture-session";
type OverlayConfig = {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  framebarSourceWidth: number;
  framebarSourceHeight: number;
  targetX: number;
  targetY: number;
  targetWidth: number;
  targetHeight: number;
  baseSampleOffset: number;
  yellowSampleOffset: number;
  sampleStartOffset: number;
  sampleSpacing: number;
  sampleCount: number;
  gateSampleOffset: number;
  gateStartOffset: number;
  gateSpacing: number;
  gateSampleCount: number;
  gateRed: number;
  gateGreen: number;
  gateBlue: number;
  gateTolerance: number;
  inputSourceX: number;
  inputSourceY: number;
  inputSourceWidth: number;
  inputSourceHeight: number;
  inputSegmentCount: number;
  inputSegmentTop: number;
  inputSegmentHeight: number;
  inputJoystickCenterX: number;
  inputJoystickRegionEndX: number;
  inputButtonStartX: number;
  inputButtonStartY: number;
  inputButtonSpacingX: number;
  inputButtonSecondaryOffsetX: number;
  inputButtonSecondaryOffsetY: number;
  inputButtonRegionRadius: number;
  inputNumberStartX: number;
  inputNumberEndX: number;
  inputNumberDigit1X: number;
  inputNumberDigitWidth: number;
  inputNumberDigitGap: number;
  inputNumberDigitTop: number;
  inputNumberDigitHeight: number;
  player1SourceX: number;
  player1SourceY: number;
  p1CharacterX: number;
  p1CharacterY: number;
  p1CharacterWidth: number;
  p1CharacterHeight: number;
  p2CharacterX: number;
  p2CharacterY: number;
  p2CharacterWidth: number;
  p2CharacterHeight: number;
  p1SupportX: number;
  p1SupportY: number;
  p1SupportWidth: number;
  p1SupportHeight: number;
  p2SupportX: number;
  p2SupportY: number;
  p2SupportWidth: number;
  p2SupportHeight: number;
};

const defaultOverlayConfig: OverlayConfig = {
  sourceX: 53.8,
  sourceY: 91,
  sourceWidth: 39.4,
  sourceHeight: 4.5,
  framebarSourceWidth: 39.4,
  framebarSourceHeight: 4.5,
  targetX: 6.9,
  targetY: 94,
  targetWidth: 39.4,
  targetHeight: 4.5,
  baseSampleOffset: 3,
  yellowSampleOffset: 9,
  sampleStartOffset: 7,
  sampleSpacing: 16,
  sampleCount: 63,
  gateSampleOffset: 25,
  gateStartOffset: 0,
  gateSpacing: 10,
  gateSampleCount: 61,
  gateRed: 0,
  gateGreen: 0,
  gateBlue: 0,
  gateTolerance: 8,
  inputSourceX: 0,
  inputSourceY: 29,
  inputSourceWidth: 10.5,
  inputSourceHeight: 50,
  inputSegmentCount: 13,
  inputSegmentTop: 2,
  inputSegmentHeight: 96 / 13,
  inputJoystickCenterX: 38,
  inputJoystickRegionEndX: 44,
  inputButtonStartX: 43,
  inputButtonStartY: 30,
  inputButtonSpacingX: 7,
  inputButtonSecondaryOffsetX: 0,
  inputButtonSecondaryOffsetY: 40,
  inputButtonRegionRadius: 6.5,
  inputNumberStartX: 68,
  inputNumberEndX: 98,
  inputNumberDigit1X: 70,
  inputNumberDigitWidth: 8,
  inputNumberDigitGap: 1,
  inputNumberDigitTop: 10,
  inputNumberDigitHeight: 80,
  player1SourceX: 6.9,
  player1SourceY: 91,
  p1CharacterX: defaultCornerRegions.p1Character.x,
  p1CharacterY: defaultCornerRegions.p1Character.y,
  p1CharacterWidth: defaultCornerRegions.p1Character.width,
  p1CharacterHeight: defaultCornerRegions.p1Character.height,
  p2CharacterX: defaultCornerRegions.p2Character.x,
  p2CharacterY: defaultCornerRegions.p2Character.y,
  p2CharacterWidth: defaultCornerRegions.p2Character.width,
  p2CharacterHeight: defaultCornerRegions.p2Character.height,
  p1SupportX: defaultCornerRegions.p1Support.x,
  p1SupportY: defaultCornerRegions.p1Support.y,
  p1SupportWidth: defaultCornerRegions.p1Support.width,
  p1SupportHeight: defaultCornerRegions.p1Support.height,
  p2SupportX: defaultCornerRegions.p2Support.x,
  p2SupportY: defaultCornerRegions.p2Support.y,
  p2SupportWidth: defaultCornerRegions.p2Support.width,
  p2SupportHeight: defaultCornerRegions.p2Support.height,
};

function inputButtonSlotRatios(config: OverlayConfig) {
  return [
    {
      slot: "A" as const,
      ratio: config.inputButtonStartX / 100,
      yRatio: config.inputButtonStartY / 100,
    },
    {
      slot: "B" as const,
      ratio: (config.inputButtonStartX + config.inputButtonSpacingX) / 100,
      yRatio: config.inputButtonStartY / 100,
    },
    {
      slot: "C" as const,
      ratio: (config.inputButtonStartX + config.inputButtonSpacingX * 2) / 100,
      yRatio: config.inputButtonStartY / 100,
    },
    {
      slot: "S" as const,
      ratio: (config.inputButtonStartX + config.inputButtonSecondaryOffsetX) / 100,
      yRatio: (config.inputButtonStartY + config.inputButtonSecondaryOffsetY) / 100,
    },
  ];
}

function cornerRegionsFromConfig(config: OverlayConfig) {
  return {
    p1Character: {
      x: config.p1CharacterX,
      y: config.p1CharacterY,
      width: config.p1CharacterWidth,
      height: config.p1CharacterHeight,
    },
    p2Character: {
      x: config.p2CharacterX,
      y: config.p2CharacterY,
      width: config.p2CharacterWidth,
      height: config.p2CharacterHeight,
    },
    p1Support: {
      x: config.p1SupportX,
      y: config.p1SupportY,
      width: config.p1SupportWidth,
      height: config.p1SupportHeight,
    },
    p2Support: {
      x: config.p2SupportX,
      y: config.p2SupportY,
      width: config.p2SupportWidth,
      height: config.p2SupportHeight,
    },
  };
}

function readOverlayConfig(): OverlayConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(overlayConfigKey) ?? "null") as
      | (Partial<OverlayConfig> & {
          inputSegmentBottom?: number;
          inputButtonAX?: number;
          inputButtonAY?: number;
          inputButtonBX?: number;
          inputButtonBY?: number;
          inputButtonCX?: number;
          inputButtonCY?: number;
          inputButtonSX?: number;
          inputButtonSY?: number;
        })
      | null;
    const merged = { ...defaultOverlayConfig, ...saved };
    // Older builds used the whole screen as the input ROI. Keep the user's
    // framebar calibration, but migrate that known default so background art
    // cannot flood the input detector with false markers.
    const hasOldFullScreenInputDefaults =
      saved?.inputSourceX === 0 &&
      saved.inputSourceY === 0 &&
      saved.inputSourceWidth === 22 &&
      saved.inputSourceHeight === 100;
    const hasPreviousInputDefaults =
      saved?.inputSourceX === 0 &&
      saved.inputSourceY === 34 &&
      saved.inputSourceWidth === 9 &&
      saved.inputSourceHeight === 27;
    if (hasOldFullScreenInputDefaults || hasPreviousInputDefaults) {
      merged.inputSourceX = defaultOverlayConfig.inputSourceX;
      merged.inputSourceY = defaultOverlayConfig.inputSourceY;
      merged.inputSourceWidth = defaultOverlayConfig.inputSourceWidth;
      merged.inputSourceHeight = defaultOverlayConfig.inputSourceHeight;
    }
    const legacyButtonAX = saved?.inputButtonAX;
    const legacyButtonAY = saved?.inputButtonAY;
    const legacyButtonBX = saved?.inputButtonBX;
    const legacyButtonCX = saved?.inputButtonCX;
    const legacyButtonSX = saved?.inputButtonSX;
    const legacyButtonSY = saved?.inputButtonSY;
    const hasLegacyButtonLayout =
      typeof legacyButtonAX === "number" &&
      typeof legacyButtonAY === "number" &&
      typeof legacyButtonBX === "number" &&
      typeof legacyButtonCX === "number" &&
      typeof legacyButtonSX === "number" &&
      typeof legacyButtonSY === "number";
    if (saved?.inputButtonStartX === undefined && hasLegacyButtonLayout) {
      merged.inputButtonStartX = legacyButtonAX;
      merged.inputButtonStartY = legacyButtonAY;
      merged.inputButtonSpacingX =
        (legacyButtonBX - legacyButtonAX + (legacyButtonCX - legacyButtonBX)) / 2;
      merged.inputButtonSecondaryOffsetX = legacyButtonSX - legacyButtonAX;
      merged.inputButtonSecondaryOffsetY = legacyButtonSY - legacyButtonAY;
    }
    const hasOldHorizontalButtonDefaults =
      saved?.inputButtonAX === 49 &&
      saved.inputButtonBX === 58 &&
      saved.inputButtonCX === 67 &&
      saved.inputButtonSX === 76;
    if (hasOldHorizontalButtonDefaults) {
      merged.inputButtonStartX = defaultOverlayConfig.inputButtonStartX;
      merged.inputButtonStartY = defaultOverlayConfig.inputButtonStartY;
      merged.inputButtonSpacingX = defaultOverlayConfig.inputButtonSpacingX;
      merged.inputButtonSecondaryOffsetX = defaultOverlayConfig.inputButtonSecondaryOffsetX;
      merged.inputButtonSecondaryOffsetY = defaultOverlayConfig.inputButtonSecondaryOffsetY;
    }
    if (
      saved?.inputSegmentHeight === undefined &&
      typeof saved?.inputSegmentBottom === "number" &&
      typeof saved?.inputSegmentTop === "number" &&
      typeof saved?.inputSegmentCount === "number" &&
      saved.inputSegmentCount > 0
    ) {
      merged.inputSegmentHeight =
        (saved.inputSegmentBottom - saved.inputSegmentTop) / saved.inputSegmentCount;
    }
    return merged;
  } catch {
    return defaultOverlayConfig;
  }
}

function readRuntimeColorMap() {
  try {
    return JSON.parse(localStorage.getItem(overlayRuntimeMapKey) ?? "[]") as typeof overlayColorMap;
  } catch {
    return [];
  }
}

type UnmappedColorRecord = { red: number; green: number; blue: number; count: number };

function readUnmappedColors(key: string): UnmappedColorRecord[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as UnmappedColorRecord[];
  } catch {
    return [];
  }
}

function combineUnmappedColors(...lists: UnmappedColorRecord[][]) {
  const combined = new Map<string, UnmappedColorRecord>();
  lists.flat().forEach((color) => {
    const key = `${color.red},${color.green},${color.blue}`;
    const previous = combined.get(key);
    combined.set(key, {
      ...color,
      count: (previous?.count ?? 0) + color.count,
    });
  });
  return [...combined.values()].sort((left, right) => right.count - left.count).slice(0, 20);
}

type FramebarPixel = { red: number; green: number; blue: number };
type FramebarGroup = { state: string; start: number; length: number };
type FramePhaseCounts = {
  startup: number;
  active: number;
  recovery: number;
  other: number;
};
type DefensivePhaseCounts = {
  hitstun: number;
  blockstun: number;
  other: number;
};
type FramebarTimelineSample = {
  timestamp: number;
  player1: string;
  player2: string;
  player1Phases: FramePhaseCounts;
  player2Phases?: DefensivePhaseCounts;
};
type MovePhase = "startup" | "active" | "recovery" | "other";
type MoveKeyframeCapture = {
  index: number;
  phase: MovePhase;
  captureFrame: number;
  timestamp: string;
  mediaTime: number;
  durationFrames: number;
  durationMs: number;
  similarity: number;
  screenshotPath?: string;
};
type CaptureSessionSample = {
  captureFrame: number;
  timestamp: string;
  timestampMs: number;
  mediaTime: number;
  player1: string;
  player2: string;
  player1Phases: FramePhaseCounts;
  player2Phases: DefensivePhaseCounts;
  player1Phase: MovePhase;
  input?: string;
};
type CaptureQuality = {
  requestedFrameRate: number;
  sourceFrameRate: number | null;
  observedFrameRate: number | null;
  framesCaptured: number;
  droppedFrames: number;
  duplicateFrames: number;
  quality: "measuring" | "good" | "degraded";
  warning?: string;
};
type CaptureSessionManifest = {
  sessionId: string;
  startedAt: string;
  updatedAt?: string;
  status: "active" | "processing" | "complete";
  captureSourceId: string | null;
  captureSourceMode: string;
  sourceWidth: number;
  sourceHeight: number;
  videoPath?: string;
  videoMimeType?: string;
  captureQuality: CaptureQuality;
  samples: CaptureSessionSample[];
  moves: MoveEpisode[];
};
type CaptureSessionStatus = Pick<
  CaptureSessionManifest,
  "sessionId" | "status" | "updatedAt" | "captureQuality"
>;
type FramebarResolution = FramebarTimelineSample & { offsetMs: number };
type InputEventRecord = {
  timestamp: string;
  signature: string;
  rawSignature?: string;
  observation?: InputDisplayObservation;
  resolvedInput?: ResolvedInput;
  framebar?: FramebarResolution;
};
type TimedInputEvent = InputEventRecord & { timestampMs: number };
type MoveEpisode = {
  startedAt: string;
  endedAt: string | null;
  inputEvents: InputEventRecord[];
  framebarSamples: Array<{ timestamp: string; player1: string; player2: string }>;
  keyframes?: MoveKeyframeCapture[];
  captureSessionId?: string;
  captureStartFrame?: number;
  captureEndFrame?: number;
  mediaStartTime?: number;
  mediaEndTime?: number;
  resolvedMove?: {
    notation: string;
    phases: FramePhaseCounts;
    opponentPhases?: DefensivePhaseCounts;
    framebarTimestamp: string;
  };
};

function createCaptureSessionId() {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `session-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}-${suffix}`;
}

function createCaptureQuality(): CaptureQuality {
  return {
    requestedFrameRate: 60,
    sourceFrameRate: null,
    observedFrameRate: null,
    framesCaptured: 0,
    droppedFrames: 0,
    duplicateFrames: 0,
    quality: "measuring",
  };
}

function currentMovePhase(groups: FramebarGroup[]): MovePhase {
  for (const group of [...groups].reverse()) {
    const state = group.state.toLowerCase().replace(/[\s_-]+/g, "");
    if (state === "idle" || state === "empty" || state === "unmapped") continue;
    if (state.includes("recovery") || state.includes("recover")) return "recovery";
    if (state.includes("active") || state.includes("hit") || state.includes("hitpause")) {
      return "active";
    }
    if (state.includes("startup") || state.includes("start")) return "startup";
  }
  return "other";
}

function resolveFramebarAt(
  timeline: FramebarTimelineSample[],
  inputTimestamp: number,
): FramebarResolution | null {
  const nearest = timeline.reduce<FramebarTimelineSample | null>((best, sample) => {
    if (!best) return sample;
    return Math.abs(sample.timestamp - inputTimestamp) < Math.abs(best.timestamp - inputTimestamp)
      ? sample
      : best;
  }, null);
  if (!nearest) return null;
  const offsetMs = Math.round(nearest.timestamp - inputTimestamp);
  // If capture was interrupted, do not attach an unrelated old framebar state
  // to a new input event.
  if (Math.abs(offsetMs) > 750) return null;
  return { ...nearest, offsetMs };
}

function formatFramebarResolution(resolution: FramebarResolution | null) {
  if (!resolution) return "unresolved";
  const { startup, active, recovery } = resolution.player1Phases;
  const { hitstun, blockstun } = resolution.player2Phases ?? {
    hitstun: 0,
    blockstun: 0,
    other: 0,
  };
  return `offset=${resolution.offsetMs}ms startup=${startup} active=${active} recovery=${recovery} hitstun=${hitstun} blockstun=${blockstun}`;
}

function summarizeFramePhases(groups: FramebarGroup[]): FramePhaseCounts {
  const phases: FramePhaseCounts = { startup: 0, active: 0, recovery: 0, other: 0 };
  groups.forEach((group) => {
    const state = group.state.toLowerCase();
    // Hitpause is commonly represented as a three-frame state and its name
    // contains "hit". Check it before the active-state match so those frames
    // are excluded from active rather than counted as attack frames.
    if (state.includes("hitpause")) phases.other += group.length;
    else if (state.includes("startup") || state.includes("start")) phases.startup += group.length;
    else if (state.includes("active") || state.includes("hit")) phases.active += group.length;
    else if (state.includes("recovery") || state.includes("recover")) {
      phases.recovery += group.length;
    } else phases.other += group.length;
  });
  return phases;
}

function summarizeDefensivePhases(groups: FramebarGroup[]): DefensivePhaseCounts {
  const phases: DefensivePhaseCounts = { hitstun: 0, blockstun: 0, other: 0 };
  groups.forEach((group) => {
    const state = group.state.toLowerCase().replace(/[\s_-]+/g, "");
    if (
      state.includes("blockstun") ||
      state.includes("guardstun") ||
      (state.includes("block") && !state.includes("immunity"))
    ) {
      phases.blockstun += group.length;
    } else if (
      state.includes("hitstun") ||
      (state.includes("hit") && !state.includes("hitpause"))
    ) {
      phases.hitstun += group.length;
    } else {
      phases.other += group.length;
    }
  });
  return phases;
}

function formatResolvedMove(input: ResolvedInput | null, framebar: FramebarResolution | null) {
  if (!input) return "unresolved input";
  if (!framebar) return `${input.notation}: framebar unresolved`;
  const { startup, active, recovery } = framebar.player1Phases;
  const { hitstun, blockstun } = framebar.player2Phases ?? {
    hitstun: 0,
    blockstun: 0,
    other: 0,
  };
  return `${input.notation}: startup ${startup}, active ${active}, recovery ${recovery}, hitstun ${hitstun}, blockstun ${blockstun}`;
}

function findBestDefensiveFramebar(
  timeline: FramebarTimelineSample[],
  startedAt: number,
  endedAt: number,
) {
  return timeline
    .filter((sample) => sample.timestamp >= startedAt && sample.timestamp <= endedAt)
    .reduce<FramebarTimelineSample | null>((best, sample) => {
      if (!best) return sample;
      const bestScore = (best.player2Phases?.hitstun ?? 0) + (best.player2Phases?.blockstun ?? 0);
      const sampleScore =
        (sample.player2Phases?.hitstun ?? 0) + (sample.player2Phases?.blockstun ?? 0);
      return sampleScore >= bestScore ? sample : best;
    }, null);
}

function findBestMoveFramebar(
  timeline: FramebarTimelineSample[],
  startedAt: number,
  endedAt: number,
) {
  return timeline
    .filter((sample) => sample.timestamp >= startedAt && sample.timestamp <= endedAt)
    .reduce<FramebarTimelineSample | null>((best, sample) => {
      if (!best) return sample;
      const bestScore =
        best.player1Phases.startup + best.player1Phases.active + best.player1Phases.recovery;
      const sampleScore =
        sample.player1Phases.startup + sample.player1Phases.active + sample.player1Phases.recovery;
      return sampleScore >= bestScore ? sample : best;
    }, null);
}

function findPrecedingButtonInput(timeline: TimedInputEvent[], framebarTimestamp: number) {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const event = timeline[index];
    const age = framebarTimestamp - event.timestampMs;
    if (age < 0) continue;
    if (age > 1000) break;
    if (event.resolvedInput?.buttons.length) return event;
  }
  return null;
}
type FramebarScan = {
  rawStates: string[];
  confidences: number[];
  yellowStates: boolean[];
  groups: FramebarGroup[];
  yellowPixels: number;
  idlePixels: number;
  hitpausePixels: number;
  unmappedColors: Map<string, number>;
  sampleWidth: number;
  sampleHeight: number;
  baseSampleY: number;
  yellowSampleY: number;
  sampleStartOffset: number;
  sampleSpacing: number;
  meterPresence: TrainingMeterScore;
};

function scanFramebar({
  config,
  sampleWidth,
  sampleHeight,
  readPixel,
  getMappedColor,
}: {
  config: OverlayConfig;
  sampleWidth: number;
  sampleHeight: number;
  readPixel: (x: number, y: number) => FramebarPixel;
  getMappedColor: (red: number, green: number, blue: number) => OverlayColorMatch | null;
}): FramebarScan {
  const baseSampleY = Math.min(sampleHeight - 1, Math.max(0, Math.round(config.baseSampleOffset)));
  const yellowSampleY = Math.min(
    sampleHeight - 1,
    Math.max(0, Math.round(config.yellowSampleOffset)),
  );
  const sampleCount = Math.min(1000, Math.max(1, Math.round(config.sampleCount)));
  const sampleStartOffset = Math.max(0, Math.round(config.sampleStartOffset));
  const sampleSpacing = Math.max(1, Math.round(config.sampleSpacing));
  const rawStates: string[] = [];
  const confidences: number[] = [];
  const yellowStates: boolean[] = [];
  const unmappedColors = new Map<string, number>();
  let yellowPixels = 0;
  let idlePixels = 0;
  let hitpausePixels = 0;
  let mappedPixels = 0;
  const isYellow = (red: number, green: number, blue: number) =>
    red > 150 && green > 105 && blue < 120 && red > blue * 1.4;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const x = Math.min(sampleWidth - 1, sampleStartOffset + sample * sampleSpacing);
    const baseColor = readPixel(x, baseSampleY);
    const yellowColor = readPixel(x, yellowSampleY);
    const mappedColor = getMappedColor(baseColor.red, baseColor.green, baseColor.blue);
    const yellow = isYellow(yellowColor.red, yellowColor.green, yellowColor.blue);
    rawStates.push(mappedColor?.name ?? "Unmapped");
    confidences.push(mappedColor?.confidence ?? 0);
    if (mappedColor) mappedPixels += 1;
    yellowStates.push(yellow);
    if (mappedColor?.name === "idle") idlePixels += 1;
    if (mappedColor?.name === "hitpause") hitpausePixels += 1;
    if (!mappedColor) {
      const key = `${baseColor.red},${baseColor.green},${baseColor.blue}`;
      unmappedColors.set(key, (unmappedColors.get(key) ?? 0) + 1);
    }
    if (yellow) yellowPixels += 1;
  }
  const groups: FramebarGroup[] = [];
  rawStates.forEach((state, index) => {
    const previous = groups.at(-1);
    if (previous?.state === state) previous.length += 1;
    else groups.push({ state, start: index, length: 1 });
  });
  const mappedScore = sampleCount === 0 ? 0 : mappedPixels / sampleCount;
  const meterPresence = scoreTrainingMeterPresence({
    config,
    sampleWidth,
    sampleHeight,
    readPixel,
    mappedScore,
  });
  return {
    rawStates,
    confidences,
    yellowStates,
    groups,
    yellowPixels,
    idlePixels,
    hitpausePixels,
    unmappedColors,
    sampleWidth,
    sampleHeight,
    baseSampleY,
    yellowSampleY,
    sampleStartOffset,
    sampleSpacing,
    meterPresence,
  };
}

function stabilizeFramebarStates(
  rawStates: string[],
  stableStates: string[],
  candidateStates: string[],
  candidateCounts: number[],
) {
  return rawStates.map((rawState, index) => {
    if (stableStates[index] === undefined) {
      stableStates[index] = rawState;
      candidateStates[index] = rawState;
      candidateCounts[index] = 0;
      return rawState;
    }
    if (rawState === stableStates[index]) {
      candidateStates[index] = rawState;
      candidateCounts[index] = 0;
      return stableStates[index];
    }
    if (candidateStates[index] === rawState) candidateCounts[index] += 1;
    else {
      candidateStates[index] = rawState;
      candidateCounts[index] = 1;
    }
    if (candidateCounts[index] >= 3) {
      stableStates[index] = rawState;
      candidateCounts[index] = 0;
    }
    return stableStates[index];
  });
}

function groupFramebarStates(states: string[]): FramebarGroup[] {
  const groups: FramebarGroup[] = [];
  states.forEach((state, index) => {
    const previous = groups.at(-1);
    if (previous?.state === state) previous.length += 1;
    else groups.push({ state, start: index, length: 1 });
  });
  return groups;
}

function formatFramebarGroups(groups: FramebarGroup[]) {
  return groups.map((group) => `${group.state}x${group.length}`).join(" ");
}

function formatPairedFramebarStates(states: string[], yellowStates: boolean[]) {
  const groups: Array<{ token: string; length: number }> = [];
  states.forEach((state, index) => {
    const token = `${state}${yellowStates[index] ? "+Y" : ""}`;
    const previous = groups.at(-1);
    if (previous?.token === token) previous.length += 1;
    else groups.push({ token, length: 1 });
  });
  return groups.map((group) => `${group.token}x${group.length}`).join(" ");
}

function truncateDebugText(value: string, maxLength = 240) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isIdleFramebar(groups: FramebarGroup[]) {
  return groups.length === 1 && groups[0]?.state === "idle";
}

const configFields: Array<{ key: keyof OverlayConfig; label: string }> = [
  { key: "sourceX", label: "P2 source X" },
  { key: "sourceY", label: "P2 source Y" },
  { key: "sourceWidth", label: "P2 mirror source width" },
  { key: "sourceHeight", label: "P2 mirror source height" },
  { key: "targetX", label: "P2 mirror X" },
  { key: "targetY", label: "P2 mirror Y" },
  { key: "targetWidth", label: "P2 mirror width" },
  { key: "targetHeight", label: "P2 mirror height" },
];

const inputConfigGroups: Array<{
  title: string;
  fields: Array<{ key: keyof OverlayConfig; label: string }>;
}> = [
  {
    title: "Capture region",
    fields: [
      { key: "inputSourceX", label: "Input X" },
      { key: "inputSourceY", label: "Input Y" },
      { key: "inputSourceWidth", label: "Input width" },
      { key: "inputSourceHeight", label: "Input height" },
    ],
  },
  {
    title: "Segments",
    fields: [
      { key: "inputSegmentCount", label: "Segments" },
      { key: "inputSegmentTop", label: "Segment top %" },
      { key: "inputSegmentHeight", label: "Segment height %" },
    ],
  },
  {
    title: "Controls",
    fields: [
      { key: "inputJoystickCenterX", label: "Joystick X %" },
      { key: "inputJoystickRegionEndX", label: "Joystick end %" },
      { key: "inputButtonStartX", label: "Button start X %" },
      { key: "inputButtonStartY", label: "Button start Y %" },
      { key: "inputButtonSpacingX", label: "Button spacing X %" },
      { key: "inputButtonSecondaryOffsetX", label: "Secondary offset X %" },
      { key: "inputButtonSecondaryOffsetY", label: "Secondary offset Y %" },
      { key: "inputButtonRegionRadius", label: "Button radius %" },
    ],
  },
  {
    title: "Number reading",
    fields: [
      { key: "inputNumberDigit1X", label: "Digit 1 X %" },
      { key: "inputNumberDigitWidth", label: "Digit width %" },
      { key: "inputNumberDigitGap", label: "Digit gap %" },
      { key: "inputNumberDigitTop", label: "Digit top %" },
      { key: "inputNumberDigitHeight", label: "Digit height %" },
    ],
  },
];

const cornerConfigGroups: Array<{
  title: string;
  fields: Array<{ key: keyof OverlayConfig; label: string }>;
}> = [
  {
    title: "Character portraits",
    fields: [
      { key: "p1CharacterX", label: "P1 X" },
      { key: "p1CharacterY", label: "P1 Y" },
      { key: "p1CharacterWidth", label: "P1 width" },
      { key: "p1CharacterHeight", label: "P1 height" },
      { key: "p2CharacterX", label: "P2 X" },
      { key: "p2CharacterY", label: "P2 Y" },
      { key: "p2CharacterWidth", label: "P2 width" },
      { key: "p2CharacterHeight", label: "P2 height" },
    ],
  },
  {
    title: "Support images",
    fields: [
      { key: "p1SupportX", label: "P1 X" },
      { key: "p1SupportY", label: "P1 Y" },
      { key: "p1SupportWidth", label: "P1 width" },
      { key: "p1SupportHeight", label: "P1 height" },
      { key: "p2SupportX", label: "P2 X" },
      { key: "p2SupportY", label: "P2 Y" },
      { key: "p2SupportWidth", label: "P2 width" },
      { key: "p2SupportHeight", label: "P2 height" },
    ],
  },
];

const cornerRegionKeys = Object.keys(cornerRegionLabels) as CornerRegionKey[];

const accordionStoragePrefix = "avatar-overlay-accordion-";

function StoredAccordion({
  id,
  title,
  defaultExpanded = false,
  disabled = false,
  children,
}: {
  id: string;
  title: string;
  defaultExpanded?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(() => {
    const saved = localStorage.getItem(`${accordionStoragePrefix}${id}`);
    return saved === null ? defaultExpanded : saved === "true";
  });
  const changeExpanded = (_event: SyntheticEvent, nextExpanded: boolean) => {
    setExpanded(nextExpanded);
    localStorage.setItem(`${accordionStoragePrefix}${id}`, String(nextExpanded));
  };
  return (
    <Accordion
      disableGutters
      disabled={disabled}
      expanded={disabled ? false : expanded}
      onChange={changeExpanded}
      sx={{ mt: 1, "&:before": { display: "none" } }}
    >
      <AccordionSummary expandIcon={<span aria-hidden="true">▾</span>}>
        <Typography variant="subtitle1">{title}</Typography>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}

export function VisualOverlay() {
  const [visible, setVisible] = useState(false);
  const [onlyWhenFocused, setOnlyWhenFocused] = useState(true);
  const [config, setConfig] = useState<OverlayConfig>(readOverlayConfig);
  const [showTextDebug, setShowTextDebug] = useState(
    () => localStorage.getItem(overlayTextDebugKey) !== "false",
  );
  const [captureEnabled, setCaptureEnabled] = useState(
    () => localStorage.getItem(overlayCaptureEnabledKey) !== "false",
  );
  const [captureRequested, setCaptureRequested] = useState(
    () => localStorage.getItem(overlayCaptureRequestedKey) === "true",
  );
  const [captureSession, setCaptureSession] = useState<CaptureSessionStatus | null>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(overlayCaptureSessionKey) ?? "null",
      ) as CaptureSessionStatus | null;
    } catch {
      return null;
    }
  });
  const [captureFolder, setCaptureFolder] = useState<string | null>(null);
  const [captureFolderError, setCaptureFolderError] = useState<string | null>(null);
  const [allowOverride, setAllowOverride] = useState(
    () => localStorage.getItem(overlayOverrideKey) === "true",
  );
  const [detectInput, setDetectInput] = useState(
    () => localStorage.getItem(overlayDetectInputKey) !== "false",
  );
  const [detectCorners, setDetectCorners] = useState(
    () => localStorage.getItem(overlayDetectCornersKey) !== "false",
  );
  const [inputObservation, setInputObservation] = useState<InputDisplayObservation | null>(null);
  const [digitTemplates, setDigitTemplates] = useState<DigitTemplate[]>(readDigitTemplates);
  const [digitCalibrationRow, setDigitCalibrationRow] = useState(0);
  const [inputEventLog, setInputEventLog] = useState<InputEventRecord[]>([]);
  const [moveEpisodeLog, setMoveEpisodeLog] = useState<MoveEpisode[]>([]);
  const [cornerObservation, setCornerObservation] = useState<CornerObservation | null>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(cornerObservationKey) ?? "null",
      ) as CornerObservation | null;
    } catch {
      return null;
    }
  });
  const [cornerTemplates, setCornerTemplates] = useState<CornerTemplate[]>(readCornerTemplates);
  const [cornerNames, setCornerNames] = useState<Record<CornerRegionKey, string>>(
    () =>
      Object.fromEntries(cornerRegionKeys.map((key) => [key, ""])) as Record<
        CornerRegionKey,
        string
      >,
  );
  const [unmappedColors, setUnmappedColors] = useState<
    Array<{ red: number; green: number; blue: number; count: number }>
  >([]);
  const [cellGroupLog, setCellGroupLog] = useState<
    Array<{
      timestamp: string;
      groups: Array<{ state: string; start: number; length: number }>;
    }>
  >([]);
  const [player1CellGroupLog, setPlayer1CellGroupLog] = useState<
    Array<{
      timestamp: string;
      groups: Array<{ state: string; start: number; length: number }>;
    }>
  >([]);
  const [trainingCalibration, setTrainingCalibration] = useState(readTrainingMeterCalibration);
  const [trainingCalibrationMode, setTrainingCalibrationMode] = useState<
    "positive" | "negative" | "idle"
  >(() => {
    const mode = localStorage.getItem(trainingMeterCalibrationModeKey);
    return mode === "positive" || mode === "negative" ? mode : "idle";
  });
  const [definitions, setDefinitions] = useState<Record<string, string>>({});
  const showOverlay = async () => {
    await window.electronAPI?.overlay.show();
    setVisible(true);
  };
  const hideOverlay = async () => {
    await window.electronAPI?.overlay.hide();
    setVisible(false);
  };
  const changeFocusMode = async (enabled: boolean) => {
    const result = await window.electronAPI?.overlay.setFocusMode(enabled);
    setOnlyWhenFocused(result ?? enabled);
  };
  useEffect(() => {
    void window.electronAPI?.overlay.isVisible().then(setVisible);
    const refreshUnmapped = () => {
      try {
        setUnmappedColors(
          combineUnmappedColors(
            readUnmappedColors(overlayPlayer1UnmappedKey),
            readUnmappedColors(overlayPlayer2UnmappedKey),
          ),
        );
        setCellGroupLog(JSON.parse(localStorage.getItem(overlayCellGroupLogKey) ?? "[]"));
        setPlayer1CellGroupLog(
          JSON.parse(localStorage.getItem(overlayPlayer1CellGroupLogKey) ?? "[]"),
        );
        setTrainingCalibration(readTrainingMeterCalibration());
        setInputObservation(JSON.parse(localStorage.getItem(overlayInputObservationKey) ?? "null"));
        setDigitTemplates(readDigitTemplates());
        setInputEventLog(JSON.parse(localStorage.getItem(overlayInputEventLogKey) ?? "[]"));
        setMoveEpisodeLog(JSON.parse(localStorage.getItem(overlayMoveEpisodeLogKey) ?? "[]"));
        setCaptureSession(
          JSON.parse(
            localStorage.getItem(overlayCaptureSessionKey) ?? "null",
          ) as CaptureSessionStatus | null,
        );
        setCaptureRequested(localStorage.getItem(overlayCaptureRequestedKey) === "true");
        setCornerObservation(
          JSON.parse(
            localStorage.getItem(cornerObservationKey) ?? "null",
          ) as CornerObservation | null,
        );
        setCornerTemplates(readCornerTemplates());
      } catch {
        setUnmappedColors([]);
      }
    };
    refreshUnmapped();
    const timer = window.setInterval(refreshUnmapped, 500);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    void window.electronAPI?.overlay
      .getCaptureFolder()
      .then(setCaptureFolder)
      .catch(() => undefined);
  }, []);
  const updateConfig = (key: keyof OverlayConfig, value: string) => {
    const next = { ...config, [key]: Number(value) };
    setConfig(next);
    localStorage.setItem(overlayConfigKey, JSON.stringify(next));
  };
  const resetConfig = () => {
    setConfig(defaultOverlayConfig);
    localStorage.setItem(overlayConfigKey, JSON.stringify(defaultOverlayConfig));
  };
  const changeOverride = (enabled: boolean) => {
    setAllowOverride(enabled);
    localStorage.setItem(overlayOverrideKey, String(enabled));
  };
  const changeTextDebug = (enabled: boolean) => {
    setShowTextDebug(enabled);
    localStorage.setItem(overlayTextDebugKey, String(enabled));
  };
  const changeCaptureEnabled = (enabled: boolean) => {
    setCaptureEnabled(enabled);
    localStorage.setItem(overlayCaptureEnabledKey, String(enabled));
    if (!enabled) {
      setCaptureSession(null);
      setCaptureRequested(false);
      localStorage.setItem(overlayCaptureRequestedKey, "false");
    }
  };
  const beginCapture = async () => {
    if (!captureEnabled) return;
    setCaptureRequested(true);
    localStorage.setItem(overlayCaptureRequestedKey, "true");
    if (!visible) await showOverlay();
    await window.electronAPI?.overlay.beginCapture();
  };
  const openCaptureFolder = async () => {
    try {
      const folder = await window.electronAPI?.overlay.openCaptureFolder();
      if (folder) {
        setCaptureFolder(folder);
        setCaptureFolderError(null);
      }
    } catch (error) {
      setCaptureFolderError(error instanceof Error ? error.message : String(error));
    }
  };
  const finalizeCapture = async () => {
    setCaptureRequested(false);
    localStorage.setItem(overlayCaptureRequestedKey, "false");
    await window.electronAPI?.overlay.finalizeCapture();
  };
  const changeInputDetection = (enabled: boolean) => {
    setDetectInput(enabled);
    localStorage.setItem(overlayDetectInputKey, String(enabled));
  };
  const saveDigitTemplate = (sample: NumberGlyphSample, digit: string) => {
    const next = [
      ...digitTemplates,
      {
        id: `digit-${digit}-${Date.now()}`,
        digit,
        mask: sample.mask,
        capturedAt: new Date().toISOString(),
      },
    ];
    writeDigitTemplates(next);
    setDigitTemplates(next);
  };
  const removeDigitTemplate = (id: string) => {
    const next = digitTemplates.filter((template) => template.id !== id);
    writeDigitTemplates(next);
    setDigitTemplates(next);
  };
  const clearDigitTemplates = () => {
    writeDigitTemplates([]);
    setDigitTemplates([]);
  };
  const changeCornerDetection = (enabled: boolean) => {
    setDetectCorners(enabled);
    localStorage.setItem(overlayDetectCornersKey, String(enabled));
  };
  const registerCornerTemplate = (key: CornerRegionKey) => {
    const name = cornerNames[key]?.trim();
    const fingerprint = cornerObservation?.regions[key];
    if (!name || !fingerprint) return;
    const { side, kind } = cornerRegionParts(key);
    const template: CornerTemplate = {
      ...fingerprint,
      id: `${key}-${Date.now()}`,
      name,
      side,
      kind,
      createdAt: new Date().toISOString(),
    };
    const next = [
      ...cornerTemplates.filter(
        (entry) => !(entry.side === side && entry.kind === kind && entry.name === name),
      ),
      template,
    ];
    writeCornerTemplates(next);
    setCornerTemplates(next);
  };
  const removeCornerTemplate = (id: string) => {
    const next = cornerTemplates.filter((template) => template.id !== id);
    writeCornerTemplates(next);
    setCornerTemplates(next);
  };
  const changeTrainingCalibrationMode = (mode: "positive" | "negative" | "idle") => {
    localStorage.setItem(trainingMeterCalibrationModeKey, mode);
    setTrainingCalibrationMode(mode);
  };
  const fitTrainingCalibration = () => {
    const next = readTrainingMeterCalibration();
    if (!fitTrainingMeterCalibration(next)) return;
    writeTrainingMeterCalibration(next);
    setTrainingCalibration(next);
  };
  const clearTrainingCalibration = () => {
    const next = { positive: [], negative: [], fitted: null };
    writeTrainingMeterCalibration(next);
    setTrainingCalibration(next);
    localStorage.setItem(trainingMeterCalibrationModeKey, "idle");
  };
  const addColorMapping = (color: (typeof unmappedColors)[number]) => {
    const name = definitions[`${color.red},${color.green},${color.blue}`]?.trim();
    if (!name) return;
    addColorMappingWithName(color, name);
  };
  const addColorMappingWithName = (color: (typeof unmappedColors)[number], name: string) => {
    const current = readRuntimeColorMap().filter(
      (entry) =>
        !(entry.red === color.red && entry.green === color.green && entry.blue === color.blue),
    );
    localStorage.setItem(
      overlayRuntimeMapKey,
      JSON.stringify([...current, { name, red: color.red, green: color.green, blue: color.blue }]),
    );
    setUnmappedColors((previous) =>
      previous.filter(
        (entry) =>
          entry.red !== color.red || entry.green !== color.green || entry.blue !== color.blue,
      ),
    );
  };
  const availableMappings = [...overlayColorMap, ...readRuntimeColorMap()];
  const getClosestMapping = (color: (typeof unmappedColors)[number]) =>
    findClosestOverlayColor(color.red, color.green, color.blue, availableMappings);
  const cornerMatches = cornerObservation
    ? findCornerMatches(cornerObservation, cornerTemplates)
    : null;
  const digitCalibrationRowCount = Math.max(
    1,
    inputObservation?.rows.length ?? Math.round(config.inputSegmentCount),
  );
  const digitCalibrationSamples =
    inputObservation?.rows[digitCalibrationRow]?.numberReading?.glyphs ?? [];
  return (
    <Paper variant="outlined" sx={{ p: 3, textAlign: "left" }}>
      <Typography variant="h6">Visual overlay</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Basic always-on-top overlay test window. Game capture and visual analysis will be added
        next.
      </Typography>
      <FormControlLabel
        control={
          <Checkbox
            checked={allowOverride}
            onChange={(event) => changeOverride(event.target.checked)}
          />
        }
        label="Allow configuration overrides"
      />
      <StoredAccordion id="overlay-controls" title="Overlay controls" defaultExpanded>
        <Stack direction="row" spacing={1}>
          <Button variant="contained" onClick={showOverlay} disabled={visible}>
            Show overlay
          </Button>
          <Button variant="outlined" onClick={hideOverlay} disabled={!visible}>
            Hide overlay
          </Button>
        </Stack>
        <FormControlLabel
          control={
            <Checkbox
              checked={onlyWhenFocused}
              onChange={(event) => void changeFocusMode(event.target.checked)}
            />
          }
          label="Only show when game is focused"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={showTextDebug}
              onChange={(event) => changeTextDebug(event.target.checked)}
            />
          }
          label="Show text debug overlay"
        />
      </StoredAccordion>
      <StoredAccordion id="capture-recording" title="Capture recording" defaultExpanded>
        <FormControlLabel
          control={
            <Checkbox
              checked={captureEnabled}
              onChange={(event) => changeCaptureEnabled(event.target.checked)}
            />
          }
          label="Save capture sessions and move screenshots"
        />
        <Typography variant="caption" color="text.secondary" component="div">
          The raw game capture is recorded while the overlay runs. When capture stops, each move is
          decoded and visually distinct poses are saved as screenshots with their durations.
        </Typography>
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          <Typography variant="body2">
            Status:{" "}
            {captureEnabled ? (captureSession?.status ?? "waiting for capture") : "disabled"}
          </Typography>
          {captureSession?.captureQuality && (
            <Stack spacing={0.25}>
              <Typography
                variant="caption"
                color={
                  captureSession.captureQuality.quality === "degraded"
                    ? "warning.main"
                    : "text.secondary"
                }
              >
                Capture quality:{" "}
                {captureSession.captureQuality.quality === "good"
                  ? "60 FPS verified"
                  : captureSession.captureQuality.quality === "degraded"
                    ? "60 FPS not verified"
                    : "measuring…"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Source {captureSession.captureQuality.sourceFrameRate?.toFixed(1) ?? "?"} FPS ·
                observed {captureSession.captureQuality.observedFrameRate?.toFixed(1) ?? "?"} FPS ·{" "}
                {captureSession.captureQuality.framesCaptured} frames ·{" "}
                {captureSession.captureQuality.droppedFrames} dropped ·{" "}
                {captureSession.captureQuality.duplicateFrames} duplicated
              </Typography>
              {captureSession.captureQuality.warning && (
                <Typography variant="caption" color="warning.main">
                  {captureSession.captureQuality.warning}
                </Typography>
              )}
            </Stack>
          )}
          {captureSession && (
            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
              Session: {captureSession.sessionId}
              {captureSession.updatedAt
                ? ` — updated ${new Date(captureSession.updatedAt).toLocaleTimeString()}`
                : ""}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            Output: {captureFolder ?? "Resolving capture folder…"}
          </Typography>
        </Stack>
        {captureSession?.status === "processing" && (
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            <LinearProgress />
            <Typography variant="caption" color="text.secondary">
              Extracting unique keyframes from the recorded video… This may take a moment.
            </Typography>
          </Stack>
        )}
        <Button
          variant="outlined"
          size="small"
          sx={{ mt: 1 }}
          onClick={() => void openCaptureFolder()}
        >
          Open capture folder
        </Button>
        <Button
          variant="contained"
          size="small"
          sx={{ mt: 1, ml: 1 }}
          disabled={!captureEnabled || captureRequested || captureSession?.status === "processing"}
          onClick={() => void beginCapture()}
        >
          Begin capture
        </Button>
        <Button
          variant="contained"
          size="small"
          sx={{ mt: 1, ml: 1 }}
          disabled={!captureEnabled || !captureRequested || captureSession?.status !== "active"}
          onClick={() => void finalizeCapture()}
        >
          Finalize recording and extract keyframes
        </Button>
        {captureFolderError && (
          <Typography variant="caption" color="error" component="div" sx={{ mt: 0.5 }}>
            {captureFolderError}
          </Typography>
        )}
      </StoredAccordion>
      <StoredAccordion
        id="mirror-settings"
        title="P2 mirror settings"
        defaultExpanded
        disabled={!allowOverride}
      >
        <Typography variant="caption" color="text.secondary" component="div">
          X/Y are measured from the top-left. Width/height are percentages. Changes are saved
          automatically.
        </Typography>
        {allowOverride && (
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
            {configFields.map(({ key, label }) => (
              <TextField
                key={key}
                label={label}
                type="number"
                size="small"
                value={config[key]}
                onChange={(event) => updateConfig(key, event.target.value)}
                slotProps={{ htmlInput: { min: 0, max: 100, step: 0.1 } }}
                sx={{ width: 125 }}
              />
            ))}
          </Stack>
        )}
      </StoredAccordion>
      <StoredAccordion id="input-detection" title="Input detection" defaultExpanded>
        <FormControlLabel
          control={
            <Checkbox
              checked={detectInput}
              onChange={(event) => changeInputDetection(event.target.checked)}
            />
          }
          label="Detect input display"
        />
        {allowOverride && detectInput && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              Input display scan region (percent of screen)
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Segment and control geometry is relative to this ROI. Buttons use a relative layout: A
              is the start point, B/C use horizontal spacing, and S uses an offset from A.
            </Typography>
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              {inputConfigGroups.map((group) => (
                <Box key={group.title}>
                  <Typography variant="caption" color="text.secondary">
                    {group.title}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap" }}>
                    {group.fields.map(({ key, label }) => (
                      <TextField
                        key={key}
                        label={label}
                        type="number"
                        size="small"
                        value={config[key]}
                        onChange={(event) => updateConfig(key, event.target.value)}
                        slotProps={{ htmlInput: { min: 0, max: 100, step: 0.1 } }}
                        sx={{ width: 145 }}
                      />
                    ))}
                  </Stack>
                </Box>
              ))}
            </Stack>
          </>
        )}
        <StoredAccordion id="input-diagnostics" title="Input detection diagnostics" defaultExpanded>
          <Typography variant="subtitle2">Input display resolver</Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {inputObservation
              ? `${inputObservation.rows.length} segments detected: ${formatInputDisplayDebug(inputObservation)}`
              : "No input display snapshot detected yet."}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: "center" }}>
            <Button
              size="small"
              color="warning"
              onClick={() => {
                localStorage.removeItem(overlayInputEventLogKey);
                setInputEventLog([]);
              }}
              disabled={inputEventLog.length === 0}
            >
              Clear input events
            </Button>
          </Stack>
          {inputEventLog.length > 0 ? (
            <Stack spacing={0.5} sx={{ mt: 1, maxHeight: 180, overflowY: "auto" }}>
              {inputEventLog
                .slice(-20)
                .reverse()
                .map((entry, index) => (
                  <Typography key={`${entry.timestamp}-${index}`} variant="caption" component="div">
                    {new Date(entry.timestamp).toLocaleTimeString()} — {entry.signature}
                    {entry.resolvedInput ? ` => ${entry.resolvedInput.notation}` : ""}
                    {entry.framebar ? ` (${formatFramebarResolution(entry.framebar)})` : ""}
                  </Typography>
                ))}
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
              No input events resolved yet.
            </Typography>
          )}
        </StoredAccordion>
        <StoredAccordion
          id="digit-calibration"
          title="Digit calibration"
          defaultExpanded
          disabled={!allowOverride}
        >
          <Typography variant="caption" color="text.secondary" component="div">
            Show a visible input-history row, then label the detected glyph samples below. Capture
            several variants of each digit at the current game scale; the reader will use all saved
            variants together.
          </Typography>
          <Typography variant="subtitle2" sx={{ mt: 1 }}>
            Segment to calibrate
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap" }}>
            {Array.from({ length: digitCalibrationRowCount }, (_, rowIndex) => (
              <Button
                key={rowIndex}
                size="small"
                variant={digitCalibrationRow === rowIndex ? "contained" : "outlined"}
                onClick={() => setDigitCalibrationRow(rowIndex)}
              >
                r{rowIndex}
              </Button>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            r0 is the newest row; higher numbers are older rows.
          </Typography>
          <Typography variant="subtitle2" sx={{ mt: 1 }}>
            Glyphs from r{digitCalibrationRow}
          </Typography>
          {digitCalibrationSamples.length === 0 ? (
            <Typography variant="caption" color="text.secondary" component="div">
              No glyph samples detected in this segment. Choose another row or adjust the digit
              boxes.
            </Typography>
          ) : (
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
              {digitCalibrationSamples.map((sample, index) => (
                <Box
                  key={`${sample.x}-${index}`}
                  sx={{
                    p: 1,
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1,
                    minWidth: 150,
                  }}
                >
                  <Typography variant="caption" color="text.secondary" component="div">
                    Glyph {index + 1}
                  </Typography>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "repeat(5, 8px)",
                      gap: "1px",
                      my: 1,
                    }}
                  >
                    {sample.mask.map((value, cellIndex) => (
                      <Box
                        key={cellIndex}
                        sx={{
                          width: 8,
                          height: 8,
                          backgroundColor: `rgba(255,255,255,${Math.max(0.08, Math.min(1, value))})`,
                          border: "1px solid rgba(255,255,255,0.15)",
                        }}
                      />
                    ))}
                  </Box>
                  <Stack direction="row" spacing={0.25} sx={{ flexWrap: "wrap" }}>
                    {["blank", ...Array.from({ length: 10 }, (_, digit) => String(digit))].map(
                      (digit) => (
                        <Button
                          key={digit}
                          size="small"
                          sx={{ minWidth: 24, px: 0.5 }}
                          onClick={() => saveDigitTemplate(sample, digit)}
                        >
                          {digit === "blank" ? "Blank" : digit}
                        </Button>
                      ),
                    )}
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
          <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: "center" }}>
            <Typography variant="caption" color="text.secondary">
              Saved samples: {digitTemplates.length}
            </Typography>
            <Button
              size="small"
              color="warning"
              onClick={clearDigitTemplates}
              disabled={digitTemplates.length === 0}
            >
              Clear digit samples
            </Button>
          </Stack>
          {digitTemplates.length > 0 && (
            <Stack spacing={0.5} sx={{ mt: 1, maxHeight: 160, overflowY: "auto" }}>
              {digitTemplates
                .slice()
                .reverse()
                .map((template) => (
                  <Stack
                    key={template.id}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center" }}
                  >
                    <Typography variant="caption" sx={{ width: 55 }}>
                      {template.digit === "blank" ? "Blank" : `Digit ${template.digit}`}
                    </Typography>
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5, 4px)",
                        gap: "1px",
                      }}
                    >
                      {template.mask.map((value, index) => (
                        <Box
                          key={index}
                          sx={{
                            width: 4,
                            height: 4,
                            backgroundColor: `rgba(255,255,255,${Math.max(0.08, Math.min(1, value))})`,
                          }}
                        />
                      ))}
                    </Box>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => removeDigitTemplate(template.id)}
                    >
                      Remove
                    </Button>
                  </Stack>
                ))}
            </Stack>
          )}
        </StoredAccordion>
      </StoredAccordion>
      <StoredAccordion id="corner-detection" title="Character/support detection" defaultExpanded>
        <FormControlLabel
          control={
            <Checkbox
              checked={detectCorners}
              onChange={(event) => changeCornerDetection(event.target.checked)}
            />
          }
          label="Detect character/support images"
        />
        {detectCorners && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              Character/support image detection
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              Detection compares the raw game capture against named templates. Configure each corner
              region if your HUD or scaling differs, then register the visible image once. Scores
              are similarity scores from 0 to 1; higher is better.
            </Typography>
            {allowOverride && (
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                {cornerConfigGroups.map((group) => (
                  <Box key={group.title}>
                    <Typography variant="caption" color="text.secondary">
                      {group.title} (percent of captured screen)
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap" }}>
                      {group.fields.map(({ key, label }) => (
                        <TextField
                          key={key}
                          label={label}
                          type="number"
                          size="small"
                          value={config[key]}
                          onChange={(event) => updateConfig(key, event.target.value)}
                          slotProps={{ htmlInput: { min: 0, max: 100, step: 0.1 } }}
                          sx={{ width: 110 }}
                        />
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
            <Stack spacing={0.75} sx={{ mt: 1 }}>
              {cornerRegionKeys.map((key) => {
                const fingerprint = cornerObservation?.regions[key];
                const match = cornerMatches?.[key] ?? null;
                return (
                  <Stack
                    key={key}
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1}
                    sx={{ alignItems: { sm: "center" } }}
                  >
                    <Typography sx={{ width: 120, flexShrink: 0 }} variant="body2">
                      {cornerRegionLabels[key]}
                    </Typography>
                    <Typography
                      variant="caption"
                      color={match ? "success.main" : "text.secondary"}
                      sx={{ minWidth: 150 }}
                    >
                      {fingerprint ? `current: ${formatCornerMatch(match)}` : "waiting for capture"}
                    </Typography>
                    <TextField
                      size="small"
                      label="Template name"
                      value={cornerNames[key]}
                      onChange={(event) =>
                        setCornerNames((previous) => ({ ...previous, [key]: event.target.value }))
                      }
                      sx={{ width: 165 }}
                    />
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!fingerprint || !cornerNames[key]?.trim()}
                      onClick={() => registerCornerTemplate(key)}
                    >
                      Register current
                    </Button>
                  </Stack>
                );
              })}
            </Stack>
            {cornerTemplates.length > 0 && (
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Registered templates
                </Typography>
                {cornerTemplates.map((template) => (
                  <Stack
                    key={template.id}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center" }}
                  >
                    <Typography variant="caption" sx={{ minWidth: 210 }}>
                      {template.side.toUpperCase()} {template.kind}: {template.name}
                    </Typography>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => removeCornerTemplate(template.id)}
                    >
                      Remove
                    </Button>
                  </Stack>
                ))}
              </Stack>
            )}
          </>
        )}
      </StoredAccordion>
      <StoredAccordion
        id="framebar-detection"
        title="Framebar settings"
        defaultExpanded
        disabled={!allowOverride}
      >
        {allowOverride && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              Player 1 framebar scan origin
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              Player 1 reuses Player 2&apos;s dimensions, gate, spacing, sample count, and color
              mappings. Only its screen-space origin is separate.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
              {(
                [
                  ["player1SourceX", "P1 source X"],
                  ["player1SourceY", "P1 source Y"],
                ] as Array<[keyof OverlayConfig, string]>
              ).map(([key, label]) => (
                <TextField
                  key={key}
                  label={label}
                  type="number"
                  size="small"
                  value={config[key]}
                  onChange={(event) => updateConfig(key, event.target.value)}
                  slotProps={{ htmlInput: { min: 0, max: 100, step: 0.1 } }}
                  sx={{ width: 125 }}
                />
              ))}
            </Stack>
          </>
        )}
        {allowOverride && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              Framebar detection region
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              These dimensions control only the P1/P2 framebar scanners. They are independent of the
              P2 mirror source and mirror destination dimensions above.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
              {(
                [
                  ["framebarSourceWidth", "Detection width"],
                  ["framebarSourceHeight", "Detection height"],
                ] as Array<[keyof OverlayConfig, string]>
              ).map(([key, label]) => (
                <TextField
                  key={key}
                  label={label}
                  type="number"
                  size="small"
                  value={config[key]}
                  onChange={(event) => updateConfig(key, event.target.value)}
                  slotProps={{ htmlInput: { min: 0.1, max: 100, step: 0.1 } }}
                  sx={{ width: 140 }}
                />
              ))}
            </Stack>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              Automatic framebar gate
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Every gate sample must match the configured segment color before framebar detection
              runs.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
              {(
                [
                  ["gateSampleOffset", "Meter sample Y"],
                  ["gateStartOffset", "Meter sample X"],
                  ["gateSpacing", "Meter sample spacing"],
                  ["gateSampleCount", "Meter sample count"],
                  ["gateRed", "Meter anchor red"],
                  ["gateGreen", "Meter anchor green"],
                  ["gateBlue", "Meter anchor blue"],
                  ["gateTolerance", "Meter color tolerance"],
                ] as Array<[keyof OverlayConfig, string]>
              ).map(([key, label]) => (
                <TextField
                  key={key}
                  label={label}
                  type="number"
                  size="small"
                  value={config[key]}
                  onChange={(event) => updateConfig(key, event.target.value)}
                  slotProps={{ htmlInput: { min: 0, step: 1 } }}
                  sx={{ width: 125 }}
                />
              ))}
            </Stack>
            <Button size="small" sx={{ mt: 1 }} onClick={resetConfig}>
              Reset overlay geometry
            </Button>
          </>
        )}
      </StoredAccordion>
      <StoredAccordion
        id="training-calibration"
        title="Training meter calibration"
        defaultExpanded
        disabled={!allowOverride}
      >
        <Typography variant="caption" color="text.secondary" component="div">
          Show the overlay before capturing. Capture several seconds while the frame meter is
          visible, then several seconds while it is absent. The detector learns thresholds from the
          raw game-window capture.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
          <Button
            size="small"
            variant={trainingCalibrationMode === "positive" ? "contained" : "outlined"}
            onClick={() => changeTrainingCalibrationMode("positive")}
            disabled={!visible}
          >
            Capture training mode
          </Button>
          <Button
            size="small"
            variant={trainingCalibrationMode === "negative" ? "contained" : "outlined"}
            onClick={() => changeTrainingCalibrationMode("negative")}
            disabled={!visible}
          >
            Capture non-training
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => changeTrainingCalibrationMode("idle")}
            disabled={trainingCalibrationMode === "idle"}
          >
            Stop capture
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={fitTrainingCalibration}
            disabled={
              trainingCalibration.positive.length < 8 || trainingCalibration.negative.length < 8
            }
          >
            Fit detector
          </Button>
          <Button size="small" color="warning" onClick={clearTrainingCalibration}>
            Clear samples
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          {trainingCalibrationMode === "idle"
            ? "Capture stopped."
            : `Capturing ${trainingCalibrationMode === "positive" ? "training-mode" : "non-training"} samples.`}{" "}
          Positive: {trainingCalibration.positive.length}; negative:{" "}
          {trainingCalibration.negative.length}
          {trainingCalibration.fitted
            ? `; fitted accuracy ${(trainingCalibration.fitted.accuracy * 100).toFixed(1)}%`
            : "; detector not fitted"}
        </Typography>
      </StoredAccordion>
      <StoredAccordion id="diagnostics" title="Diagnostics and logs">
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle2">Unmapped colors</Typography>
          <Button
            size="small"
            color="warning"
            onClick={() => {
              localStorage.removeItem(overlayUnmappedKey);
              localStorage.removeItem(overlayPlayer1UnmappedKey);
              localStorage.removeItem(overlayPlayer2UnmappedKey);
              setUnmappedColors([]);
            }}
            disabled={unmappedColors.length === 0}
          >
            Clear unmapped colors
          </Button>
        </Stack>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {unmappedColors.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              No unmapped colors detected yet.
            </Typography>
          ) : (
            unmappedColors.map((color) => {
              const key = `${color.red},${color.green},${color.blue}`;
              const closest = getClosestMapping(color);
              return (
                <Stack key={key} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Box
                    sx={{
                      width: 24,
                      height: 24,
                      backgroundColor: `rgb(${key})`,
                      border: "1px solid white",
                    }}
                  />
                  <Typography variant="caption" sx={{ minWidth: 125 }}>
                    rgb({key}) × {color.count}
                  </Typography>
                  {closest && (
                    <Typography variant="caption" sx={{ minWidth: 190 }}>
                      Similar: {closest.name} (rgb({closest.red},{closest.green},{closest.blue}))
                    </Typography>
                  )}
                  <TextField
                    label="Definition"
                    size="small"
                    value={definitions[key] ?? ""}
                    onChange={(event) =>
                      setDefinitions((previous) => ({ ...previous, [key]: event.target.value }))
                    }
                    sx={{ width: 150 }}
                  />
                  {closest && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => addColorMappingWithName(color, closest.name)}
                    >
                      Use similar
                    </Button>
                  )}
                  <Button size="small" variant="outlined" onClick={() => addColorMapping(color)}>
                    Add mapping
                  </Button>
                  {(["startup", "active", "recovery"] as const).map((phase) => (
                    <Button
                      key={phase}
                      size="small"
                      variant="text"
                      onClick={() => addColorMappingWithName(color, phase)}
                    >
                      {phase}
                    </Button>
                  ))}
                </Stack>
              );
            })
          )}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: "center" }}>
          <Typography variant="subtitle2">Contiguous cell-group log</Typography>
          <Button
            size="small"
            color="warning"
            onClick={() => {
              localStorage.removeItem(overlayCellGroupLogKey);
              setCellGroupLog([]);
            }}
            disabled={cellGroupLog.length === 0}
          >
            Clear log
          </Button>
        </Stack>
        {cellGroupLog.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            No discrete sequences detected yet.
          </Typography>
        ) : (
          <Stack spacing={0.5} sx={{ mt: 1, maxHeight: 180, overflowY: "auto" }}>
            {cellGroupLog
              .slice()
              .reverse()
              .map((entry, index) => (
                <Typography key={`${entry.timestamp}-${index}`} variant="caption" component="div">
                  {new Date(entry.timestamp).toLocaleTimeString()} —{" "}
                  {entry.groups.map((group) => `${group.state} × ${group.length}`).join(" → ")}
                </Typography>
              ))}
          </Stack>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: "center" }}>
          <Typography variant="subtitle2">Player 1 contiguous cell-group log</Typography>
          <Button
            size="small"
            color="warning"
            onClick={() => {
              localStorage.removeItem(overlayPlayer1CellGroupLogKey);
              setPlayer1CellGroupLog([]);
            }}
            disabled={player1CellGroupLog.length === 0}
          >
            Clear P1 log
          </Button>
        </Stack>
        {player1CellGroupLog.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            No Player 1 sequences detected yet.
          </Typography>
        ) : (
          <Stack spacing={0.5} sx={{ mt: 1, maxHeight: 180, overflowY: "auto" }}>
            {player1CellGroupLog
              .slice()
              .reverse()
              .map((entry, index) => (
                <Typography key={`${entry.timestamp}-${index}`} variant="caption" component="div">
                  {new Date(entry.timestamp).toLocaleTimeString()} —{" "}
                  {entry.groups.map((group) => `${group.state} × ${group.length}`).join(" → ")}
                </Typography>
              ))}
          </Stack>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: "center" }}>
          <Typography variant="subtitle2">Move episodes from idle</Typography>
          <Button
            size="small"
            color="warning"
            onClick={() => {
              localStorage.removeItem(overlayMoveEpisodeLogKey);
              setMoveEpisodeLog([]);
            }}
            disabled={moveEpisodeLog.length === 0}
          >
            Clear moves
          </Button>
        </Stack>
        {moveEpisodeLog.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            No move episodes detected yet.
          </Typography>
        ) : (
          <Stack spacing={0.5} sx={{ mt: 1, maxHeight: 220, overflowY: "auto" }}>
            {moveEpisodeLog
              .slice()
              .reverse()
              .map((episode, index) => (
                <Typography key={`${episode.startedAt}-${index}`} variant="caption" component="div">
                  {new Date(episode.startedAt).toLocaleTimeString()} —{" "}
                  {episode.resolvedMove
                    ? `${episode.resolvedMove.notation}: startup ${episode.resolvedMove.phases.startup}, active ${episode.resolvedMove.phases.active}, recovery ${episode.resolvedMove.phases.recovery}, hitstun ${episode.resolvedMove.opponentPhases?.hitstun ?? 0}, blockstun ${episode.resolvedMove.opponentPhases?.blockstun ?? 0}`
                    : episode.inputEvents
                        .map((event) =>
                          event.resolvedInput
                            ? formatResolvedMove(event.resolvedInput, event.framebar ?? null)
                            : event.signature || "none",
                        )
                        .join(" → ")}
                </Typography>
              ))}
          </Stack>
        )}
        {allowOverride && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              Debug scan settings (source pixels)
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
              <TextField
                label="Sample X offset"
                type="number"
                size="small"
                value={config.sampleStartOffset}
                onChange={(event) => updateConfig("sampleStartOffset", event.target.value)}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
                sx={{ width: 140 }}
              />
              <TextField
                label="Sample X spacing"
                type="number"
                size="small"
                value={config.sampleSpacing}
                onChange={(event) => updateConfig("sampleSpacing", event.target.value)}
                slotProps={{ htmlInput: { min: 1, step: 1 } }}
                sx={{ width: 140 }}
              />
              <TextField
                label="Base offset from top"
                type="number"
                size="small"
                value={config.baseSampleOffset}
                onChange={(event) => updateConfig("baseSampleOffset", event.target.value)}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
                sx={{ width: 170 }}
              />
              <TextField
                label="Yellow offset from top"
                type="number"
                size="small"
                value={config.yellowSampleOffset}
                onChange={(event) => updateConfig("yellowSampleOffset", event.target.value)}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
                sx={{ width: 170 }}
              />
              <TextField
                label="Sample count"
                type="number"
                size="small"
                value={config.sampleCount}
                onChange={(event) => updateConfig("sampleCount", event.target.value)}
                slotProps={{ htmlInput: { min: 1, max: 1000, step: 1 } }}
                sx={{ width: 130 }}
              />
            </Stack>
          </>
        )}
      </StoredAccordion>
    </Paper>
  );
}

export function OverlaySurface() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const debugRef = useRef<HTMLDivElement>(null);
  const inputSummaryRef = useRef("disabled");
  const inputEventSummaryRef = useRef("none yet");
  const inputAlignmentSummaryRef = useRef("unresolved");
  const moveResolutionSummaryRef = useRef("none yet");
  const player1SummaryRef = useRef("disabled");
  const cornerSummaryRef = useRef("disabled");
  const trainingMeterRef = useRef<TrainingMeterTracker>(createTrainingMeterTracker());
  const trainingMeterSummaryRef = useRef("unknown");
  const lastTrainingMeterStateRef = useRef<TrainingMeterTracker["state"]>("unknown");
  const pendingInputSignatureRef = useRef("");
  const pendingInputCountRef = useRef(0);
  const stableInputObservationRef = useRef<InputDisplayObservation | null>(null);
  const latestInputObservationRef = useRef<InputDisplayObservation | null>(null);
  const latestInputObservationAtRef = useRef(0);
  const pendingResolvedInputSignatureRef = useRef("");
  const pendingResolvedInputCountRef = useRef(0);
  const stableResolvedInputRef = useRef<ResolvedInput | null>(null);
  const lastResolvedInputSignatureRef = useRef("");
  const lastGroupSignatureRef = useRef("");
  const pendingGroupSignatureRef = useRef("");
  const pendingGroupCountRef = useRef(0);
  const stableStatesRef = useRef<string[]>([]);
  const candidateStatesRef = useRef<string[]>([]);
  const candidateCountsRef = useRef<number[]>([]);
  const lastPlayer1GroupSignatureRef = useRef("");
  const pendingPlayer1GroupSignatureRef = useRef("");
  const pendingPlayer1GroupCountRef = useRef(0);
  const stablePlayer1StatesRef = useRef<string[]>([]);
  const candidatePlayer1StatesRef = useRef<string[]>([]);
  const candidatePlayer1CountsRef = useRef<number[]>([]);
  const framebarStateRef = useRef({
    player1: [] as FramebarGroup[],
    player2: [] as FramebarGroup[],
  });
  const waitingForPlayer1IdleRef = useRef(true);
  const activeMoveEpisodeRef = useRef<MoveEpisode | null>(null);
  const captureSessionRef = useRef<CaptureSessionManifest>({
    sessionId: createCaptureSessionId(),
    startedAt: new Date().toISOString(),
    status: "active",
    captureSourceId: null,
    captureSourceMode: "unknown",
    sourceWidth: 0,
    sourceHeight: 0,
    captureQuality: createCaptureQuality(),
    samples: [],
    moves: [],
  });
  const captureSaveChainRef = useRef(Promise.resolve());
  const captureFrameSequenceRef = useRef(0);
  const moveStatusRef = useRef("waiting for P1 framebar idle");
  const inputTimelineRef = useRef<TimedInputEvent[]>([]);
  const lastPlayer1FramebarSignatureRef = useRef("");
  const lastPlayer1FramebarChangeAtRef = useRef(0);
  const framebarTimelineRef = useRef<FramebarTimelineSample[]>([]);
  const configRef = useRef<OverlayConfig>(readOverlayConfig());
  useEffect(() => {
    const syncConfig = () => {
      configRef.current = readOverlayConfig();
    };
    window.addEventListener("storage", syncConfig);
    return () => window.removeEventListener("storage", syncConfig);
  }, []);
  useEffect(() => {
    const syncTextDebugVisibility = () => {
      if (debugRef.current) {
        debugRef.current.style.display =
          localStorage.getItem(overlayTextDebugKey) === "false" ? "none" : "block";
      }
    };
    syncTextDebugVisibility();
    window.addEventListener("storage", syncTextDebugVisibility);
    return () => window.removeEventListener("storage", syncTextDebugVisibility);
  }, []);
  useEffect(() => {
    let frame = 0;
    let retryTimer = 0;
    let stopped = false;
    let captureSourceId = "";
    let captureSourceMode = "unknown";
    let captureCheckPending = false;
    let reconnecting = false;
    let tick = 0;
    let stream: MediaStream | null = null;
    let stopRecording: (() => void) | null = null;
    let beginRecording: (() => void) | null = null;
    let recordingFinalized = false;
    let qualityWindowStartedAt = 0;
    let qualityWindowFrameCount = 0;
    let lastMediaTime: number | null = null;
    let lastPresentedFrames: number | null = null;
    const finalizeSubscription = window.electronAPI?.overlay.onCaptureFinalize(() => {
      stopRecording?.();
    });
    const beginSubscription = window.electronAPI?.overlay.onCaptureBegin(() => {
      beginRecording?.();
    });
    const analysisCanvas = document.createElement("canvas");
    const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
    const inputAnalysisCanvas = document.createElement("canvas");
    const inputAnalysisContext = inputAnalysisCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const player1AnalysisCanvas = document.createElement("canvas");
    const player1AnalysisContext = player1AnalysisCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const cornerAnalysisCanvas = document.createElement("canvas");
    const cornerAnalysisContext = cornerAnalysisCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const persistCaptureSession = (status: CaptureSessionManifest["status"]) => {
      if (localStorage.getItem(overlayCaptureEnabledKey) === "false") return;
      const session = captureSessionRef.current;
      session.status = status;
      const updatedAt = new Date().toISOString();
      localStorage.setItem(
        overlayCaptureSessionKey,
        JSON.stringify({
          sessionId: session.sessionId,
          status,
          updatedAt,
          captureQuality: session.captureQuality,
        }),
      );
      const manifest: CaptureSessionManifest = {
        ...session,
        updatedAt,
        samples: session.samples.slice(-3600),
        moves: session.moves.slice(-100),
      };
      const save = window.electronAPI?.overlay.saveCaptureSession({
        sessionId: session.sessionId,
        manifest,
      });
      captureSaveChainRef.current = captureSaveChainRef.current
        .catch(() => undefined)
        .then(() => save)
        .then(() => undefined);
    };
    const updateCaptureQuality = (
      callbackNow: number,
      frameMetadata?: { mediaTime: number; presentedFrames?: number },
    ) => {
      if (localStorage.getItem(overlayCaptureRequestedKey) !== "true") return;
      const quality = captureSessionRef.current.captureQuality;
      const mediaTime = frameMetadata?.mediaTime;
      if (mediaTime !== undefined && lastMediaTime !== null) {
        const sourceFrameRate = quality.sourceFrameRate ?? quality.requestedFrameRate;
        const expectedFrameDuration = 1 / Math.max(1, sourceFrameRate);
        const mediaDelta = mediaTime - lastMediaTime;
        const presentedDelta =
          frameMetadata?.presentedFrames !== undefined && lastPresentedFrames !== null
            ? frameMetadata.presentedFrames - lastPresentedFrames
            : null;
        if (mediaDelta <= 0.0001) {
          quality.duplicateFrames += 1;
        } else if (presentedDelta === null && mediaDelta > expectedFrameDuration * 1.75) {
          quality.droppedFrames += Math.max(1, Math.round(mediaDelta / expectedFrameDuration) - 1);
        }
        if (presentedDelta !== null && presentedDelta > 1) {
          quality.droppedFrames += presentedDelta - 1;
        }
      }
      if (mediaTime !== undefined) lastMediaTime = mediaTime;
      if (frameMetadata?.presentedFrames !== undefined) {
        lastPresentedFrames = frameMetadata.presentedFrames;
      }
      quality.framesCaptured += 1;
      qualityWindowFrameCount += 1;
      if (!qualityWindowStartedAt) qualityWindowStartedAt = callbackNow;
      const windowDuration = callbackNow - qualityWindowStartedAt;
      if (windowDuration < 1000) return;
      quality.observedFrameRate = (qualityWindowFrameCount / windowDuration) * 1000;
      qualityWindowStartedAt = callbackNow;
      qualityWindowFrameCount = 0;
      const sourceIsStable = quality.sourceFrameRate === null || quality.sourceFrameRate >= 59.5;
      const observedIsStable = quality.observedFrameRate >= 58.5;
      quality.quality =
        sourceIsStable &&
        observedIsStable &&
        quality.droppedFrames === 0 &&
        quality.duplicateFrames === 0
          ? "good"
          : "degraded";
      if (quality.sourceFrameRate !== null && quality.sourceFrameRate < 59.5) {
        quality.warning = `Capture source reports ${quality.sourceFrameRate.toFixed(1)} FPS; 60 FPS is unavailable from this source.`;
      } else if (quality.observedFrameRate < 58.5) {
        quality.warning = `Observed ${quality.observedFrameRate.toFixed(1)} FPS; the capture is dropping or delaying frames.`;
      } else if (quality.droppedFrames > 0) {
        quality.warning = `${quality.droppedFrames} frame${quality.droppedFrames === 1 ? "" : "s"} appear to have been dropped.`;
      } else if (quality.duplicateFrames > 0) {
        quality.warning = `${quality.duplicateFrames} duplicate frame${quality.duplicateFrames === 1 ? "" : "s"} appear in the capture.`;
      } else {
        quality.warning = "60 FPS capture verified over the latest sample window.";
      }
      persistCaptureSession("active");
    };
    const start = async () => {
      let sourceFrameRate: number | null = null;
      try {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (stopped) return;
        const captureSource = await window.electronAPI?.overlay.getCaptureSource();
        if (!captureSource) throw new Error("No display source is available yet");
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: captureSource.id,
              maxFrameRate: 60,
            },
          } as MediaTrackConstraints,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        captureSourceId = captureSource.id;
        captureSourceMode = captureSource.mode ?? "unknown";
        reconnecting = false;
        const captureTrack = stream.getVideoTracks()[0];
        try {
          await captureTrack?.applyConstraints({ frameRate: { ideal: 60, max: 60 } });
        } catch {
          // Some desktop capture providers reject post-acquisition constraints.
        }
        const captureSettings = captureTrack?.getSettings();
        sourceFrameRate =
          typeof captureSettings?.frameRate === "number" ? captureSettings.frameRate : null;
        const video = videoRef.current;
        if (!video) throw new Error("Capture video element is unavailable");
        video.srcObject = stream;
        await video.play();
      } catch (error) {
        stream?.getTracks().forEach((track) => track.stop());
        stream = null;
        if (!stopped) {
          const message = error instanceof Error ? error.message : String(error);
          if (debugRef.current) {
            debugRef.current.style.display =
              localStorage.getItem(overlayTextDebugKey) === "false" ? "none" : "block";
            debugRef.current.textContent = `Capture unavailable\n${message}\nRetrying...`;
          }
          retryTimer = window.setTimeout(() => void start(), 1000);
        }
        return;
      }
      const video = videoRef.current;
      if (!video || stopped) return;
      captureSessionRef.current.status = "active";
      captureSessionRef.current.captureSourceId = captureSourceId || null;
      captureSessionRef.current.captureSourceMode = captureSourceMode;
      captureSessionRef.current.sourceWidth = video.videoWidth;
      captureSessionRef.current.sourceHeight = video.videoHeight;
      captureSessionRef.current.captureQuality.sourceFrameRate = sourceFrameRate;
      captureSessionRef.current.captureQuality.quality = "measuring";
      captureSessionRef.current.captureQuality.warning =
        sourceFrameRate !== null && sourceFrameRate < 59.5
          ? `Capture source reports ${sourceFrameRate.toFixed(1)} FPS; measuring actual delivery.`
          : undefined;
      if (localStorage.getItem(overlayCaptureRequestedKey) === "true") {
        persistCaptureSession("active");
      }

      let recordingChunks: Blob[] = [];
      let recordingMimeType = "video/webm";
      let mediaRecorder: MediaRecorder | null = null;
      const screenshotCanvas = document.createElement("canvas");
      const screenshotContext = screenshotCanvas.getContext("2d");
      const saveCanvasAsScreenshot = async (canvas: HTMLCanvasElement, filename: string) => {
        if (
          !window.electronAPI?.overlay ||
          localStorage.getItem(overlayCaptureEnabledKey) === "false"
        ) {
          return null;
        }
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        if (!blob) return null;
        const result = await window.electronAPI.overlay.saveCaptureScreenshot({
          sessionId: captureSessionRef.current.sessionId,
          filename,
          data: new Uint8Array(await blob.arrayBuffer()),
        });
        return result.path;
      };
      const seekVideo = (target: HTMLVideoElement, time: number) =>
        new Promise<void>((resolve) => {
          if (Math.abs(target.currentTime - time) < 0.0005) {
            resolve();
            return;
          }
          let timeout = 0;
          const finish = () => {
            window.clearTimeout(timeout);
            target.removeEventListener("seeked", finish);
            resolve();
          };
          target.addEventListener("seeked", finish, { once: true });
          target.currentTime = time;
          timeout = window.setTimeout(finish, 1000);
        });
      const phaseAtTime = (time: number) => {
        const sample = captureSessionRef.current.samples.reduce<CaptureSessionSample | null>(
          (best, candidate) => {
            if (candidate.mediaTime > time) return best;
            return !best || candidate.mediaTime > best.mediaTime ? candidate : best;
          },
          null,
        );
        return sample?.player1Phase ?? "other";
      };
      const sampleAtTime = (time: number) =>
        captureSessionRef.current.samples.reduce<CaptureSessionSample | null>(
          (best, candidate) =>
            !best || Math.abs(candidate.mediaTime - time) < Math.abs(best.mediaTime - time)
              ? candidate
              : best,
          null,
        );
      const processRecordedMove = async (recordedVideo: Blob, move: MoveEpisode) => {
        if (move.mediaStartTime === undefined || move.mediaEndTime === undefined) return move;
        const extractedVideo = document.createElement("video");
        extractedVideo.muted = true;
        extractedVideo.preload = "auto";
        const objectUrl = URL.createObjectURL(recordedVideo);
        extractedVideo.src = objectUrl;
        try {
          await new Promise<void>((resolve, reject) => {
            extractedVideo.addEventListener("loadedmetadata", () => resolve(), { once: true });
            extractedVideo.addEventListener(
              "error",
              () => reject(new Error("Recorded video could not be decoded")),
              { once: true },
            );
            extractedVideo.load();
          });
          const start = Math.max(0, move.mediaStartTime - 0.02);
          const recordedEnd = Number.isFinite(extractedVideo.duration)
            ? extractedVideo.duration
            : move.mediaEndTime + 0.02;
          const end = Math.min(recordedEnd, move.mediaEndTime + 0.02);
          if (end <= start) return move;
          const analysisCanvas = document.createElement("canvas");
          analysisCanvas.width = 80;
          analysisCanvas.height = 80;
          const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
          if (!analysisContext || !screenshotContext) return move;
          screenshotCanvas.width = extractedVideo.videoWidth;
          screenshotCanvas.height = extractedVideo.videoHeight;
          const config = configRef.current;
          const roiX = extractedVideo.videoWidth * (config.p1CharacterX / 100);
          const roiY = extractedVideo.videoHeight * (config.p1CharacterY / 100);
          const roiWidth = extractedVideo.videoWidth * (config.p1CharacterWidth / 100);
          const roiHeight = extractedVideo.videoHeight * (config.p1CharacterHeight / 100);
          const measuredTimes = captureSessionRef.current.samples
            .filter((sample) => sample.mediaTime >= start && sample.mediaTime <= end)
            .map((sample) => sample.mediaTime)
            .filter((time, index, times) => index === 0 || time > times[index - 1]);
          const frameRate =
            captureSessionRef.current.captureQuality.observedFrameRate ??
            captureSessionRef.current.captureQuality.sourceFrameRate ??
            60;
          const analysisTimes =
            measuredTimes.length >= 2
              ? [start, ...measuredTimes.filter((time) => time > start && time < end), end]
              : Array.from(
                  { length: Math.max(1, Math.ceil((end - start) * frameRate)) },
                  (_, index) => Math.min(end, start + index / frameRate),
                );
          const frameCount = analysisTimes.length;
          const visualChangeThreshold = 0.035;
          let previousPixels: Uint8ClampedArray | null = null;
          let representative: {
            canvas: HTMLCanvasElement;
            time: number;
            similarity: number;
          } | null = null;
          let representativeIndex = 0;
          const keyframes: MoveKeyframeCapture[] = [];
          const saveRepresentative = async (endTime: number, durationFrames: number) => {
            if (!representative) return;
            const sample = sampleAtTime(representative.time);
            const index = keyframes.length + 1;
            const filename = `keyframe-${String(index).padStart(3, "0")}-frame-${sample?.captureFrame ?? representativeIndex}.png`;
            const screenshotPath = await saveCanvasAsScreenshot(representative.canvas, filename);
            keyframes.push({
              index,
              phase: phaseAtTime(representative.time),
              captureFrame: sample?.captureFrame ?? move.captureStartFrame ?? 0,
              timestamp: sample?.timestamp ?? move.startedAt,
              mediaTime: representative.time,
              durationFrames: Math.max(1, durationFrames),
              durationMs: Math.max(1, Math.round((endTime - representative.time) * 1000)),
              similarity: representative.similarity,
              screenshotPath: screenshotPath ?? undefined,
            });
          };
          for (let index = 0; index < frameCount; index += 1) {
            const time = analysisTimes[index];
            await seekVideo(extractedVideo, time);
            analysisContext.drawImage(
              extractedVideo,
              roiX,
              roiY,
              roiWidth,
              roiHeight,
              0,
              0,
              analysisCanvas.width,
              analysisCanvas.height,
            );
            const pixels = analysisContext.getImageData(
              0,
              0,
              analysisCanvas.width,
              analysisCanvas.height,
            ).data;
            let difference = 1;
            if (previousPixels) {
              let totalDifference = 0;
              for (let pixel = 0; pixel < pixels.length; pixel += 4) {
                totalDifference +=
                  Math.abs(pixels[pixel] - previousPixels[pixel]) +
                  Math.abs(pixels[pixel + 1] - previousPixels[pixel + 1]) +
                  Math.abs(pixels[pixel + 2] - previousPixels[pixel + 2]);
              }
              difference = totalDifference / ((pixels.length / 4) * 3 * 255);
            }
            if (!representative || difference >= visualChangeThreshold) {
              if (representative) await saveRepresentative(time, index - representativeIndex);
              screenshotContext.clearRect(0, 0, screenshotCanvas.width, screenshotCanvas.height);
              screenshotContext.drawImage(
                extractedVideo,
                0,
                0,
                screenshotCanvas.width,
                screenshotCanvas.height,
              );
              representative = {
                canvas: document.createElement("canvas"),
                time,
                similarity: 1 - difference,
              };
              representative.canvas.width = screenshotCanvas.width;
              representative.canvas.height = screenshotCanvas.height;
              representative.canvas.getContext("2d")?.drawImage(screenshotCanvas, 0, 0);
              representativeIndex = index;
            }
            previousPixels = new Uint8ClampedArray(pixels);
          }
          await saveRepresentative(end, frameCount - representativeIndex);
          return { ...move, keyframes };
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };
      const updateStoredMove = (move: MoveEpisode) => {
        let moveLog: MoveEpisode[] = [];
        try {
          moveLog = JSON.parse(localStorage.getItem(overlayMoveEpisodeLogKey) ?? "[]");
        } catch {
          moveLog = [];
        }
        const index = moveLog.findIndex((entry) => entry.startedAt === move.startedAt);
        if (index >= 0) moveLog[index] = move;
        else moveLog.push(move);
        localStorage.setItem(overlayMoveEpisodeLogKey, JSON.stringify(moveLog.slice(-100)));
      };
      const processRecordedSession = async () => {
        persistCaptureSession("processing");
        if (!recordingChunks.length) {
          persistCaptureSession("complete");
          return;
        }
        const recordedVideo = new Blob(recordingChunks, { type: recordingMimeType });
        try {
          const videoResult = await window.electronAPI?.overlay.saveCaptureVideo({
            sessionId: captureSessionRef.current.sessionId,
            data: new Uint8Array(await recordedVideo.arrayBuffer()),
          });
          captureSessionRef.current.videoPath = videoResult?.path;
        } catch {
          captureSessionRef.current.videoPath = undefined;
        }
        captureSessionRef.current.videoMimeType = recordingMimeType;
        for (const move of captureSessionRef.current.moves) {
          try {
            const processedMove = await processRecordedMove(recordedVideo, move);
            Object.assign(move, processedMove);
            updateStoredMove(move);
          } catch {
            // Preserve the move timing and framebar data if video decoding fails.
          }
          persistCaptureSession("active");
        }
        persistCaptureSession("complete");
      };
      const startRecording = () => {
        if (mediaRecorder?.state === "inactive") mediaRecorder = null;
        if (recordingFinalized) {
          recordingChunks = [];
          recordingFinalized = false;
          captureSessionRef.current = {
            sessionId: createCaptureSessionId(),
            startedAt: new Date().toISOString(),
            status: "active",
            captureSourceId: captureSourceId || null,
            captureSourceMode,
            sourceWidth: video.videoWidth,
            sourceHeight: video.videoHeight,
            captureQuality: createCaptureQuality(),
            samples: [],
            moves: [],
          };
          captureSessionRef.current.captureQuality.sourceFrameRate = sourceFrameRate;
          qualityWindowStartedAt = 0;
          qualityWindowFrameCount = 0;
          lastMediaTime = null;
          lastPresentedFrames = null;
          persistCaptureSession("active");
        }
        if (
          localStorage.getItem(overlayCaptureEnabledKey) === "false" ||
          localStorage.getItem(overlayCaptureRequestedKey) !== "true" ||
          !stream ||
          typeof MediaRecorder === "undefined" ||
          mediaRecorder
        ) {
          return;
        }
        const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
          (candidate) => MediaRecorder.isTypeSupported(candidate),
        );
        try {
          mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
          recordingMimeType = mediaRecorder.mimeType || mimeType || "video/webm";
          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) recordingChunks.push(event.data);
          };
          mediaRecorder.onstop = () => void processRecordedSession();
          mediaRecorder.start(1000);
        } catch {
          mediaRecorder = null;
        }
      };
      beginRecording = startRecording;
      if (localStorage.getItem(overlayCaptureRequestedKey) === "true") startRecording();
      stopRecording = () => {
        if (recordingFinalized) return;
        recordingFinalized = true;
        localStorage.setItem(overlayCaptureRequestedKey, "false");
        if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
        else void processRecordedSession();
      };
      const draw = (
        frameMetadata?: { mediaTime: number; presentedFrames?: number },
        callbackNow = performance.now(),
      ) => {
        if (reconnecting || stopped) return;
        tick += 1;
        const captureFrame = ++captureFrameSequenceRef.current;
        const captureTimestampMs = Date.now();
        const mediaTime = frameMetadata?.mediaTime ?? video.currentTime;
        updateCaptureQuality(callbackNow, {
          mediaTime,
          presentedFrames: frameMetadata?.presentedFrames,
        });
        if (debugRef.current) {
          debugRef.current.style.display =
            localStorage.getItem(overlayTextDebugKey) === "false" ? "none" : "block";
        }
        // Keep the capture window synchronized with settings edited in the main window.
        if (tick % 10 === 0) configRef.current = readOverlayConfig();
        const canvas = canvasRef.current;
        if (canvas && video.videoWidth) {
          const width = window.innerWidth;
          const height = window.innerHeight;
          if (canvas.width !== width) canvas.width = width;
          if (canvas.height !== height) canvas.height = height;
          const context = canvas.getContext("2d");
          if (context) {
            let player1MeterPresence: TrainingMeterScore | null = null;
            if (tick % 60 === 0 && !captureCheckPending) {
              captureCheckPending = true;
              void window.electronAPI?.overlay
                .getCaptureSource()
                .then((currentSource) => {
                  if (
                    currentSource &&
                    captureSourceId &&
                    currentSource.id !== captureSourceId &&
                    !stopped
                  ) {
                    reconnecting = true;
                    cancelAnimationFrame(frame);
                    stream?.getTracks().forEach((track) => track.stop());
                    stream = null;
                    void start();
                  }
                })
                .finally(() => {
                  captureCheckPending = false;
                });
            }
            const config = configRef.current;
            const sourceX = video.videoWidth * (config.sourceX / 100);
            const sourceY = video.videoHeight * (config.sourceY / 100);
            const sourceWidth = video.videoWidth * (config.sourceWidth / 100);
            const sourceHeight = Math.max(24, video.videoHeight * (config.sourceHeight / 100));
            const framebarSourceWidth = video.videoWidth * (config.framebarSourceWidth / 100);
            const framebarSourceHeight = Math.max(
              24,
              video.videoHeight * (config.framebarSourceHeight / 100),
            );
            const targetX = width * (config.targetX / 100);
            const targetY = height * (config.targetY / 100);
            const targetWidth = width * (config.targetWidth / 100);
            const targetHeight = height * (config.targetHeight / 100);
            const sourceDisplayX = width * (config.sourceX / 100);
            const sourceDisplayY = height * (config.sourceY / 100);
            const framebarDisplayWidth = width * (config.framebarSourceWidth / 100);
            const framebarDisplayHeight = height * (config.framebarSourceHeight / 100);
            const player1DisplayX = width * (config.player1SourceX / 100);
            const player1DisplayY = height * (config.player1SourceY / 100);
            context.clearRect(0, 0, width, height);
            const drawInputDiagnostics = () => {
              if (
                localStorage.getItem(overlayDetectInputKey) === "false" ||
                trainingMeterRef.current.state !== "training"
              ) {
                return;
              }
              const inputDisplayX = width * (config.inputSourceX / 100);
              const inputDisplayY = height * (config.inputSourceY / 100);
              const inputDisplayWidth = width * (config.inputSourceWidth / 100);
              const inputDisplayHeight = height * (config.inputSourceHeight / 100);
              const segmentCount = Math.max(1, Math.round(config.inputSegmentCount));
              const segmentTop = inputDisplayHeight * (config.inputSegmentTop / 100);
              const segmentHeight = Math.max(
                1,
                inputDisplayHeight * (config.inputSegmentHeight / 100),
              );
              const observation = latestInputObservationRef.current;
              const buttonSlots = inputButtonSlotRatios(config);
              const buttonColors: Record<string, string> = {
                A: "#2f72ff",
                B: "#ffd21f",
                C: "#ff3b30",
                S: "#22e6e6",
              };
              const markerColors: Record<string, string> = {
                blue: "#2f72ff",
                yellow: "#ffd21f",
                red: "#ff3b30",
                cyan: "#22e6e6",
              };
              const toDisplayX = (sourceX: number) =>
                inputDisplayX +
                (sourceX / Math.max(1, observation?.width ?? 100)) * inputDisplayWidth;
              const toDisplayY = (sourceY: number) =>
                inputDisplayY +
                (sourceY / Math.max(1, observation?.height ?? 100)) * inputDisplayHeight;

              context.save();
              context.lineWidth = 1.5;
              context.font = "11px monospace";
              context.textBaseline = "middle";
              context.strokeStyle = "rgba(0, 229, 255, 0.9)";
              context.strokeRect(
                inputDisplayX,
                inputDisplayY,
                inputDisplayWidth,
                inputDisplayHeight,
              );
              context.fillStyle = "rgba(0, 0, 0, 0.7)";
              context.fillRect(inputDisplayX, Math.max(0, inputDisplayY - 16), 190, 15);
              context.fillStyle = "#22e6e6";
              context.fillText(
                "INPUT CAPTURE DEBUG (display only)",
                inputDisplayX + 4,
                Math.max(8, inputDisplayY - 8),
              );

              for (let visualRowIndex = 0; visualRowIndex < segmentCount; visualRowIndex += 1) {
                const rowTop = inputDisplayY + segmentTop + visualRowIndex * segmentHeight;
                const rowBottom = rowTop + segmentHeight;
                const newestRowIndex = segmentCount - visualRowIndex - 1;
                const row = observation?.rows[newestRowIndex];

                context.strokeStyle = "rgba(255, 255, 255, 0.55)";
                context.strokeRect(inputDisplayX, rowTop, inputDisplayWidth, segmentHeight);
                context.fillStyle = "rgba(0, 0, 0, 0.65)";
                context.fillRect(inputDisplayX + 2, rowTop + 2, 24, 13);
                context.fillStyle = "white";
                context.fillText(`r${newestRowIndex}`, inputDisplayX + 5, rowTop + 8);

                const observedJoystick = row?.joystick;
                const joystickCenterX = observedJoystick
                  ? toDisplayX(observedJoystick.centerX)
                  : inputDisplayX + inputDisplayWidth * (config.inputJoystickCenterX / 100);
                const joystickCenterY = observedJoystick
                  ? toDisplayY(observedJoystick.centerY)
                  : rowTop + segmentHeight / 2;
                const joystickRegionEndX =
                  inputDisplayX + inputDisplayWidth * (config.inputJoystickRegionEndX / 100);
                context.strokeStyle = "rgba(77, 142, 255, 0.8)";
                context.setLineDash([4, 3]);
                context.strokeRect(
                  inputDisplayX,
                  rowTop,
                  joystickRegionEndX - inputDisplayX,
                  segmentHeight,
                );
                context.setLineDash([]);
                context.beginPath();
                context.arc(
                  joystickCenterX,
                  joystickCenterY,
                  observedJoystick
                    ? Math.max(
                        6,
                        (observedJoystick.width / Math.max(1, observation?.width ?? 100)) *
                          inputDisplayWidth *
                          0.5,
                      )
                    : Math.max(5, inputDisplayWidth * 0.025),
                  0,
                  Math.PI * 2,
                );
                context.strokeStyle = row?.joystickCheck?.detected
                  ? "#45ff7a"
                  : "rgba(77, 142, 255, 0.9)";
                context.stroke();
                if (
                  row?.joystickCheck?.markerX !== undefined &&
                  row.joystickCheck.markerY !== undefined
                ) {
                  context.beginPath();
                  context.arc(
                    toDisplayX(row.joystickCheck.markerX),
                    toDisplayY(row.joystickCheck.markerY),
                    4,
                    0,
                    Math.PI * 2,
                  );
                  context.fillStyle = "#ff3b30";
                  context.fill();
                }

                buttonSlots.forEach(({ slot, ratio, yRatio }) => {
                  const buttonX = inputDisplayX + inputDisplayWidth * ratio;
                  const buttonY = rowTop + segmentHeight * yRatio;
                  const check = row?.buttonChecks?.find((candidate) => candidate.slot === slot);
                  const color = buttonColors[slot];
                  context.beginPath();
                  context.arc(
                    buttonX,
                    buttonY,
                    Math.max(6, inputDisplayWidth * (config.inputButtonRegionRadius / 100)),
                    0,
                    Math.PI * 2,
                  );
                  context.strokeStyle = check?.detected ? "#45ff7a" : color;
                  context.fillStyle = check?.detected
                    ? "rgba(69, 255, 122, 0.22)"
                    : "rgba(0, 0, 0, 0.3)";
                  context.fill();
                  context.stroke();
                  context.fillStyle = color;
                  context.fillText(slot, buttonX - 3, buttonY);
                  if (check?.marker) {
                    context.beginPath();
                    context.arc(
                      toDisplayX(check.marker.x),
                      toDisplayY(check.marker.y),
                      4,
                      0,
                      Math.PI * 2,
                    );
                    context.fillStyle = markerColors[check.marker.color] ?? color;
                    context.fill();
                  }
                });

                const numberText = row?.numberReading?.text ?? "";
                const numberDigitXs = Array.from(
                  { length: 3 },
                  (_, digitIndex) =>
                    config.inputNumberDigit1X +
                    digitIndex * (config.inputNumberDigitWidth + config.inputNumberDigitGap),
                );
                numberDigitXs.forEach((digitX) => {
                  const boxX = inputDisplayX + inputDisplayWidth * (digitX / 100);
                  const boxY = rowTop + segmentHeight * (config.inputNumberDigitTop / 100);
                  const boxWidth = inputDisplayWidth * (config.inputNumberDigitWidth / 100);
                  const boxHeight = segmentHeight * (config.inputNumberDigitHeight / 100);
                  const glyph = row?.numberReading?.glyphs?.find((sample) => {
                    const sampleX = (sample.x / Math.max(1, observation?.width ?? 100)) * 100;
                    return sampleX >= digitX && sampleX <= digitX + config.inputNumberDigitWidth;
                  });
                  context.strokeStyle = glyph
                    ? "rgba(255, 215, 0, 0.95)"
                    : "rgba(255, 215, 0, 0.45)";
                  context.strokeRect(boxX, boxY, boxWidth, boxHeight);
                });
                if (row?.numberReading && numberText) {
                  const numberGroupX =
                    inputDisplayX + inputDisplayWidth * (config.inputNumberDigit1X / 100);
                  const numberGroupWidth =
                    inputDisplayWidth *
                    ((config.inputNumberDigitWidth * 3 + config.inputNumberDigitGap * 2) / 100);
                  context.fillStyle = "#ffd21f";
                  context.textAlign = "center";
                  context.fillText(
                    `${numberText} (${row.numberReading.confidence.toFixed(2)})`,
                    numberGroupX + numberGroupWidth / 2,
                    rowTop +
                      segmentHeight *
                        ((config.inputNumberDigitTop + config.inputNumberDigitHeight) / 100) +
                      8,
                  );
                  context.textAlign = "start";
                }

                if (row?.markers.length) {
                  row.markers.forEach((marker) => {
                    context.beginPath();
                    context.arc(toDisplayX(marker.x), toDisplayY(marker.y), 2.5, 0, Math.PI * 2);
                    context.fillStyle = markerColors[marker.color] ?? "white";
                    context.fill();
                  });
                }

                context.strokeStyle = "rgba(255, 255, 255, 0.2)";
                context.beginPath();
                context.moveTo(inputDisplayX, rowBottom);
                context.lineTo(inputDisplayX + inputDisplayWidth, rowBottom);
                context.stroke();
              }
              context.restore();
            };
            // P2 is sampled directly from the raw game-window video. The
            // mirrored copy below is output only and is never used as input.
            if (trainingMeterRef.current.state === "training") {
              context.drawImage(
                video,
                sourceX,
                sourceY,
                sourceWidth,
                sourceHeight,
                targetX,
                targetY,
                targetWidth,
                targetHeight,
              );
            }

            if (
              inputAnalysisContext &&
              localStorage.getItem(overlayDetectInputKey) !== "false" &&
              trainingMeterRef.current.state === "training" &&
              tick % 6 === 0
            ) {
              const inputSourceX = Math.max(0, video.videoWidth * (config.inputSourceX / 100));
              const inputSourceY = Math.max(0, video.videoHeight * (config.inputSourceY / 100));
              const inputSourceWidth = Math.max(
                1,
                Math.min(
                  video.videoWidth - inputSourceX,
                  video.videoWidth * (config.inputSourceWidth / 100),
                ),
              );
              const inputSourceHeight = Math.max(
                1,
                Math.min(
                  video.videoHeight - inputSourceY,
                  video.videoHeight * (config.inputSourceHeight / 100),
                ),
              );
              const inputWidth = Math.max(1, Math.round(inputSourceWidth));
              const inputHeight = Math.max(1, Math.round(inputSourceHeight));
              inputAnalysisCanvas.width = inputWidth;
              inputAnalysisCanvas.height = inputHeight;
              inputAnalysisContext.drawImage(
                video,
                inputSourceX,
                inputSourceY,
                inputSourceWidth,
                inputSourceHeight,
                0,
                0,
                inputWidth,
                inputHeight,
              );
              const inputObservation = detectInputDisplay(
                {
                  data: inputAnalysisContext.getImageData(0, 0, inputWidth, inputHeight).data,
                  width: inputWidth,
                  height: inputHeight,
                },
                {
                  segmentCount: config.inputSegmentCount,
                  segmentTop: config.inputSegmentTop,
                  segmentHeight: config.inputSegmentHeight,
                  joystickCenterX: config.inputJoystickCenterX,
                  joystickRegionEndX: config.inputJoystickRegionEndX,
                  buttonSlotRatios: inputButtonSlotRatios(config),
                  buttonRegionRadius: config.inputButtonRegionRadius,
                  numberStartX: config.inputNumberStartX,
                  numberEndX: config.inputNumberEndX,
                  numberDigitXs: Array.from(
                    { length: 3 },
                    (_, digitIndex) =>
                      config.inputNumberDigit1X +
                      digitIndex * (config.inputNumberDigitWidth + config.inputNumberDigitGap),
                  ),
                  numberDigitWidth: config.inputNumberDigitWidth,
                  numberDigitTop: config.inputNumberDigitTop,
                  numberDigitHeight: config.inputNumberDigitHeight,
                  digitTemplates: readDigitTemplates(),
                },
              );
              const inputSignature = formatInputDisplayObservation(inputObservation);
              if (inputSignature === pendingInputSignatureRef.current) {
                pendingInputCountRef.current += 1;
              } else {
                pendingInputSignatureRef.current = inputSignature;
                pendingInputCountRef.current = 1;
              }
              if (stableInputObservationRef.current === null || pendingInputCountRef.current >= 3) {
                stableInputObservationRef.current = inputObservation;
              }
              const stableInputObservation = stableInputObservationRef.current;
              latestInputObservationRef.current = stableInputObservation ?? inputObservation;
              latestInputObservationAtRef.current = Date.now();
              inputSummaryRef.current = `${stableInputObservation?.rows.length ?? 0} rows; ${truncateDebugText(formatInputDisplayObservation(stableInputObservation ?? inputObservation) || "no markers")}`;
              const stableInputSignature = formatInputDisplayObservation(
                stableInputObservation ?? inputObservation,
              );
              const observedResolvedInput = resolveRecentInput(
                stableInputObservation ?? inputObservation,
                6,
              );
              const observedResolvedSignature = observedResolvedInput?.notation ?? "none";
              if (observedResolvedSignature === pendingResolvedInputSignatureRef.current) {
                pendingResolvedInputCountRef.current += 1;
              } else {
                pendingResolvedInputSignatureRef.current = observedResolvedSignature;
                pendingResolvedInputCountRef.current = 1;
              }
              if (
                stableResolvedInputRef.current === null ||
                pendingResolvedInputCountRef.current >= 2
              ) {
                stableResolvedInputRef.current = observedResolvedInput;
              }
              const resolvedInput = stableResolvedInputRef.current;
              const resolvedInputSignature = resolvedInput?.notation ?? "none";
              const stableInputChanged =
                resolvedInputSignature !== lastResolvedInputSignatureRef.current;
              const inputFramebarResolution = stableInputChanged
                ? resolveFramebarAt(framebarTimelineRef.current, Date.now())
                : null;
              if (stableInputChanged) {
                lastResolvedInputSignatureRef.current = resolvedInputSignature;
                inputEventSummaryRef.current = `${resolvedInputSignature}; ${truncateDebugText(stableInputSignature || "none")}`;
                inputAlignmentSummaryRef.current =
                  formatFramebarResolution(inputFramebarResolution);
                moveResolutionSummaryRef.current = resolvedInput
                  ? `${resolvedInput.notation}: waiting for P1 framebar activity`
                  : "waiting for P1 framebar activity";
                let inputEvents: InputEventRecord[] = [];
                try {
                  inputEvents = JSON.parse(localStorage.getItem(overlayInputEventLogKey) ?? "[]");
                } catch {
                  inputEvents = [];
                }
                inputEvents.push({
                  timestamp: new Date().toISOString(),
                  signature: resolvedInputSignature,
                  rawSignature: stableInputSignature || "none",
                  observation: inputObservation,
                  resolvedInput: resolvedInput ?? undefined,
                  framebar: inputFramebarResolution ?? undefined,
                });
                localStorage.setItem(
                  overlayInputEventLogKey,
                  JSON.stringify(inputEvents.slice(-200)),
                );
                inputTimelineRef.current.push({
                  timestamp: new Date().toISOString(),
                  timestampMs: Date.now(),
                  signature: resolvedInputSignature,
                  rawSignature: stableInputSignature || "none",
                  observation: inputObservation,
                  resolvedInput: resolvedInput ?? undefined,
                  framebar: inputFramebarResolution ?? undefined,
                });
                if (inputTimelineRef.current.length > 100) {
                  inputTimelineRef.current.splice(0, inputTimelineRef.current.length - 100);
                }
              }
              localStorage.setItem(
                overlayInputObservationKey,
                JSON.stringify(stableInputObservation ?? inputObservation),
              );
            } else if (localStorage.getItem(overlayDetectInputKey) === "false") {
              inputSummaryRef.current = "disabled";
            } else if (trainingMeterRef.current.state !== "training") {
              inputSummaryRef.current = `training mode required (${trainingMeterRef.current.state})`;
            }

            drawInputDiagnostics();

            if (
              cornerAnalysisContext &&
              localStorage.getItem(overlayDetectCornersKey) !== "false" &&
              tick % 12 === 0
            ) {
              const regions = cornerRegionsFromConfig(config);
              const observation: CornerObservation = {
                timestamp: new Date().toISOString(),
                regions: {},
              };
              (Object.keys(regions) as CornerRegionKey[]).forEach((key) => {
                observation.regions[key] = captureCornerFingerprint(
                  video,
                  cornerAnalysisContext,
                  regions[key],
                  video.videoWidth,
                  video.videoHeight,
                );
              });
              try {
                localStorage.setItem(cornerObservationKey, JSON.stringify(observation));
              } catch {
                // Corner snapshots are optional; the other detectors should continue.
              }
              const matches = findCornerMatches(observation, readCornerTemplates());
              cornerSummaryRef.current = cornerRegionKeys
                .map((key) => `${cornerRegionLabels[key]}=${formatCornerMatch(matches[key])}`)
                .join("; ");
            } else if (localStorage.getItem(overlayDetectCornersKey) === "false") {
              cornerSummaryRef.current = "disabled";
            }

            if (player1AnalysisContext) {
              const player1SourceX = Math.max(0, video.videoWidth * (config.player1SourceX / 100));
              const player1SourceY = Math.max(0, video.videoHeight * (config.player1SourceY / 100));
              const player1SourceWidth = Math.max(
                1,
                Math.min(video.videoWidth - player1SourceX, framebarSourceWidth),
              );
              const player1SourceHeight = Math.max(
                1,
                Math.min(video.videoHeight - player1SourceY, framebarSourceHeight),
              );
              const player1Width = Math.max(1, Math.round(player1SourceWidth));
              const player1Height = Math.max(1, Math.round(player1SourceHeight));
              player1AnalysisCanvas.width = player1Width;
              player1AnalysisCanvas.height = player1Height;
              player1AnalysisContext.drawImage(
                video,
                player1SourceX,
                player1SourceY,
                player1SourceWidth,
                player1SourceHeight,
                0,
                0,
                player1Width,
                player1Height,
              );
              const player1Pixels = player1AnalysisContext.getImageData(
                0,
                0,
                player1Width,
                player1Height,
              ).data;
              const player1ReadPixel = (x: number, y: number): FramebarPixel => {
                const index = (y * player1Width + x) * 4;
                return {
                  red: player1Pixels[index],
                  green: player1Pixels[index + 1],
                  blue: player1Pixels[index + 2],
                };
              };
              const player1RuntimeColorMap = [...overlayColorMap, ...readRuntimeColorMap()];
              const player1GetMappedColor = (red: number, green: number, blue: number) =>
                findClosestOverlayColor(red, green, blue, player1RuntimeColorMap);
              const player1Reading = scanFramebar({
                config,
                sampleWidth: player1Width,
                sampleHeight: player1Height,
                readPixel: player1ReadPixel,
                getMappedColor: player1GetMappedColor,
              });
              player1MeterPresence = player1Reading.meterPresence;
              const player1MeterReady = trainingMeterRef.current.state === "training";
              if (!player1MeterReady) {
                player1SummaryRef.current = `meter inactive score=${player1Reading.meterPresence.score.toFixed(2)}`;
              } else {
                for (let sample = 0; sample < player1Reading.rawStates.length; sample += 1) {
                  const x = Math.min(
                    player1Reading.sampleWidth - 1,
                    player1Reading.sampleStartOffset + sample * player1Reading.sampleSpacing,
                  );
                  const markerX =
                    player1DisplayX + (x / player1Reading.sampleWidth) * framebarDisplayWidth;
                  context.fillStyle =
                    player1Reading.rawStates[sample] === "idle"
                      ? "#00ccff"
                      : player1Reading.rawStates[sample] === "hitpause"
                        ? "#ff66ff"
                        : "#ff0066";
                  context.fillRect(
                    markerX,
                    player1DisplayY +
                      (player1Reading.baseSampleY / player1Reading.sampleHeight) *
                        framebarDisplayHeight,
                    1,
                    1,
                  );
                  context.fillStyle = player1Reading.yellowStates[sample] ? "#ffff00" : "#0088ff";
                  context.fillRect(
                    markerX,
                    player1DisplayY +
                      (player1Reading.yellowSampleY / player1Reading.sampleHeight) *
                        framebarDisplayHeight,
                    1,
                    1,
                  );
                }
                const player1States = stabilizeFramebarStates(
                  player1Reading.rawStates,
                  stablePlayer1StatesRef.current,
                  candidatePlayer1StatesRef.current,
                  candidatePlayer1CountsRef.current,
                );
                const player1Groups = groupFramebarStates(player1States);
                framebarStateRef.current.player1 = player1Groups;
                const player1Signature = player1Groups
                  .map((group) => `${group.state}:${group.length}`)
                  .join("|");
                if (player1Signature === pendingPlayer1GroupSignatureRef.current) {
                  pendingPlayer1GroupCountRef.current += 1;
                } else {
                  pendingPlayer1GroupSignatureRef.current = player1Signature;
                  pendingPlayer1GroupCountRef.current = 1;
                }
                if (
                  tick % 10 === 0 &&
                  pendingPlayer1GroupCountRef.current >= 3 &&
                  player1Signature !== lastPlayer1GroupSignatureRef.current
                ) {
                  lastPlayer1GroupSignatureRef.current = player1Signature;
                  let player1Log: Array<{
                    timestamp: string;
                    groups: FramebarGroup[];
                  }> = [];
                  try {
                    player1Log = JSON.parse(
                      localStorage.getItem(overlayPlayer1CellGroupLogKey) ?? "[]",
                    );
                  } catch {
                    player1Log = [];
                  }
                  player1Log.push({ timestamp: new Date().toISOString(), groups: player1Groups });
                  localStorage.setItem(
                    overlayPlayer1CellGroupLogKey,
                    JSON.stringify(player1Log.slice(-200)),
                  );
                }
                if (tick % 10 === 0) {
                  localStorage.setItem(
                    overlayPlayer1CellGroupsKey,
                    JSON.stringify({
                      timestamp: new Date().toISOString(),
                      groups: player1Groups,
                    }),
                  );
                }
                const player1UnmappedSummary = [...player1Reading.unmappedColors.entries()]
                  .sort((left, right) => right[1] - left[1])
                  .slice(0, 3)
                  .map(([rgb, count]) => `${rgb} (${count})`)
                  .join(", ");
                player1SummaryRef.current = `frames ${formatPairedFramebarStates(player1States, player1Reading.yellowStates)}${player1UnmappedSummary ? `; unmapped ${player1UnmappedSummary}` : ""}`;
                framebarTimelineRef.current.push({
                  timestamp: Date.now(),
                  player1: formatFramebarGroups(player1Groups),
                  player2: formatFramebarGroups(framebarStateRef.current.player2),
                  player1Phases: summarizeFramePhases(player1Groups),
                  player2Phases: summarizeDefensivePhases(framebarStateRef.current.player2),
                });
                if (framebarTimelineRef.current.length > 600) {
                  framebarTimelineRef.current.splice(0, framebarTimelineRef.current.length - 600);
                }
                const now = Date.now();
                const previousPlayer1Signature = lastPlayer1FramebarSignatureRef.current;
                const player1FramebarChanged =
                  previousPlayer1Signature !== "" && previousPlayer1Signature !== player1Signature;
                if (previousPlayer1Signature === "" || player1FramebarChanged) {
                  lastPlayer1FramebarSignatureRef.current = player1Signature;
                  lastPlayer1FramebarChangeAtRef.current = now;
                }
                const player1IsIdle = isIdleFramebar(player1Groups);
                if (player1IsIdle) waitingForPlayer1IdleRef.current = true;
                if (
                  player1FramebarChanged &&
                  !player1IsIdle &&
                  waitingForPlayer1IdleRef.current &&
                  !activeMoveEpisodeRef.current
                ) {
                  const latestInputObservation = latestInputObservationRef.current;
                  const recentInput =
                    latestInputObservation && now - latestInputObservationAtRef.current <= 250
                      ? resolveRecentInput(latestInputObservation, 6)
                      : null;
                  const recentButtonInput = recentInput?.buttons.length ? recentInput : null;
                  const recentInputEvent: TimedInputEvent | null = recentButtonInput
                    ? {
                        timestamp: new Date(now).toISOString(),
                        timestampMs: now,
                        signature: recentButtonInput.notation,
                        rawSignature: latestInputObservation
                          ? formatInputDisplayObservation(latestInputObservation)
                          : undefined,
                        observation: latestInputObservation ?? undefined,
                        resolvedInput: recentButtonInput,
                      }
                    : null;
                  const precipitatingInput =
                    recentInputEvent ?? findPrecedingButtonInput(inputTimelineRef.current, now);
                  waitingForPlayer1IdleRef.current = false;
                  if (precipitatingInput) {
                    const startedEpisode: MoveEpisode = {
                      startedAt: new Date(now).toISOString(),
                      endedAt: null,
                      inputEvents: [precipitatingInput],
                      framebarSamples: [],
                      captureSessionId: captureSessionRef.current.sessionId,
                      captureStartFrame: captureFrame,
                      mediaStartTime: mediaTime,
                    };
                    activeMoveEpisodeRef.current = startedEpisode;
                    moveResolutionSummaryRef.current = `${precipitatingInput.resolvedInput?.notation ?? precipitatingInput.signature}: waiting for P1 framebar to stop`;
                    moveStatusRef.current = "P1 framebar activity; resolving preceding input";
                  } else {
                    moveStatusRef.current = "P1 startup; no button in recent r0-r5 input history";
                  }
                }
                if (activeMoveEpisodeRef.current) {
                  if (player1FramebarChanged) {
                    activeMoveEpisodeRef.current.framebarSamples.push({
                      timestamp: new Date(now).toISOString(),
                      player1: formatFramebarGroups(player1Groups),
                      player2: formatFramebarGroups(framebarStateRef.current.player2),
                    });
                  }
                  const framebarStopped =
                    !player1FramebarChanged && now - lastPlayer1FramebarChangeAtRef.current >= 150;
                  if (framebarStopped) {
                    const episode = activeMoveEpisodeRef.current;
                    const endedAt = new Date(now).toISOString();
                    const bestFramebar = findBestMoveFramebar(
                      framebarTimelineRef.current,
                      Date.parse(episode.startedAt),
                      now,
                    );
                    const bestDefensiveFramebar = findBestDefensiveFramebar(
                      framebarTimelineRef.current,
                      Date.parse(episode.startedAt),
                      now,
                    );
                    const notation = episode.inputEvents.find((event) => event.resolvedInput)
                      ?.resolvedInput?.notation;
                    const resolvedMove =
                      notation && bestFramebar
                        ? {
                            notation,
                            phases: bestFramebar.player1Phases,
                            opponentPhases: bestDefensiveFramebar?.player2Phases ?? {
                              hitstun: 0,
                              blockstun: 0,
                              other: 0,
                            },
                            framebarTimestamp: new Date(bestFramebar.timestamp).toISOString(),
                          }
                        : undefined;
                    const completedMove: MoveEpisode = {
                      ...episode,
                      endedAt,
                      framebarSamples: episode.framebarSamples.slice(-200),
                      resolvedMove,
                      captureEndFrame: captureFrame,
                      mediaEndTime: mediaTime,
                    };
                    if (resolvedMove) {
                      const { startup, active, recovery } = resolvedMove.phases;
                      const { hitstun, blockstun } = resolvedMove.opponentPhases;
                      moveResolutionSummaryRef.current = `${resolvedMove.notation}: startup ${startup}, active ${active}, recovery ${recovery}, hitstun ${hitstun}, blockstun ${blockstun}`;
                    }
                    updateStoredMove(completedMove);
                    captureSessionRef.current.moves.push(completedMove);
                    persistCaptureSession(stopped ? "complete" : "active");
                    activeMoveEpisodeRef.current = null;
                    moveStatusRef.current = "P1 framebar stopped; move ended";
                  }
                }
                if (tick % 10 === 0) {
                  localStorage.setItem(
                    overlayPlayer1UnmappedKey,
                    JSON.stringify(
                      [...player1Reading.unmappedColors.entries()]
                        .sort((left, right) => right[1] - left[1])
                        .slice(0, 20)
                        .map(([rgb, count]) => {
                          const [red, green, blue] = rgb.split(",").map(Number);
                          return { red, green, blue, count };
                        }),
                    ),
                  );
                }
              }
            } else {
              player1SummaryRef.current = "unavailable";
            }

            if (analysisContext) {
              const sampleWidth = Math.max(1, Math.round(framebarSourceWidth));
              const sampleHeight = Math.max(1, Math.round(framebarSourceHeight));
              analysisCanvas.width = sampleWidth;
              analysisCanvas.height = sampleHeight;
              analysisContext.drawImage(
                video,
                sourceX,
                sourceY,
                framebarSourceWidth,
                framebarSourceHeight,
                0,
                0,
                sampleWidth,
                sampleHeight,
              );
              const pixels = analysisContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
              const readPixel = (x: number, y: number) => {
                const index = (y * sampleWidth + x) * 4;
                return { red: pixels[index], green: pixels[index + 1], blue: pixels[index + 2] };
              };
              const player2MeterPresence = scoreTrainingMeterPresence({
                config,
                sampleWidth,
                sampleHeight,
                readPixel,
              });
              const trainingMeterScores = {
                player1: player1MeterPresence,
                player2: player2MeterPresence,
              };
              const trainingCalibration = readTrainingMeterCalibration();
              updateTrainingMeterTracker(
                trainingMeterRef.current,
                trainingMeterScores,
                trainingCalibration.fitted ?? undefined,
              );
              if (trainingMeterRef.current.state !== lastTrainingMeterStateRef.current) {
                lastTrainingMeterStateRef.current = trainingMeterRef.current.state;
                // Do not carry transient observations or frame timelines across
                // a training-mode boundary. Historical logs remain available,
                // but live resolution starts cleanly when training resumes.
                stableInputObservationRef.current = null;
                latestInputObservationRef.current = null;
                latestInputObservationAtRef.current = 0;
                pendingInputSignatureRef.current = "";
                pendingInputCountRef.current = 0;
                stableResolvedInputRef.current = null;
                pendingResolvedInputSignatureRef.current = "";
                pendingResolvedInputCountRef.current = 0;
                lastResolvedInputSignatureRef.current = "";
                inputTimelineRef.current = [];
                framebarStateRef.current = { player1: [], player2: [] };
                framebarTimelineRef.current = [];
                stableStatesRef.current = [];
                candidateStatesRef.current = [];
                candidateCountsRef.current = [];
                stablePlayer1StatesRef.current = [];
                candidatePlayer1StatesRef.current = [];
                candidatePlayer1CountsRef.current = [];
                lastGroupSignatureRef.current = "";
                pendingGroupSignatureRef.current = "";
                pendingGroupCountRef.current = 0;
                lastPlayer1GroupSignatureRef.current = "";
                pendingPlayer1GroupSignatureRef.current = "";
                pendingPlayer1GroupCountRef.current = 0;
                lastPlayer1FramebarSignatureRef.current = "";
                lastPlayer1FramebarChangeAtRef.current = 0;
                waitingForPlayer1IdleRef.current = true;
                activeMoveEpisodeRef.current = null;
                inputEventSummaryRef.current = "training mode required";
                inputAlignmentSummaryRef.current = "unresolved";
                moveResolutionSummaryRef.current = "training mode required";
                moveStatusRef.current = "waiting for training mode";
                localStorage.removeItem(overlayInputObservationKey);
                localStorage.removeItem(overlayCellGroupsKey);
                localStorage.removeItem(overlayPlayer1CellGroupsKey);
              }
              trainingMeterSummaryRef.current = formatTrainingMeterStatus(
                trainingMeterRef.current,
                trainingMeterScores,
              );
              const calibrationMode = localStorage.getItem(trainingMeterCalibrationModeKey);
              if (
                tick % 6 === 0 &&
                (calibrationMode === "positive" || calibrationMode === "negative")
              ) {
                appendTrainingMeterSample(calibrationMode, trainingMeterScores);
              }
              const meterReady = trainingMeterRef.current.state === "training";
              if (!meterReady) {
                if (debugRef.current) {
                  debugRef.current.textContent = `Training meter inactive\n${trainingMeterSummaryRef.current}\ninput: ${inputSummaryRef.current}\ninput event: ${inputEventSummaryRef.current}\ninput alignment: ${inputAlignmentSummaryRef.current}\ncorners: ${cornerSummaryRef.current}\nresolved move: ${moveResolutionSummaryRef.current}\nmove framebar source: P1 (P2 reserved for defense)\nP1: ${player1SummaryRef.current}\nmove: ${moveStatusRef.current}`;
                }
                scheduleFrame();
                return;
              }
              let idlePixels = 0;
              let hitpausePixels = 0;
              let confidenceTotal = 0;
              let confidenceSamples = 0;
              const unmappedColors = new Map<string, number>();
              const baseSampleY = Math.min(
                sampleHeight - 1,
                Math.max(0, Math.round(config.baseSampleOffset)),
              );
              const yellowSampleY = Math.min(
                sampleHeight - 1,
                Math.max(0, Math.round(config.yellowSampleOffset)),
              );
              const sampleCount = Math.min(1000, Math.max(1, Math.round(config.sampleCount)));
              const sampleStartOffset = Math.max(0, Math.round(config.sampleStartOffset));
              const sampleSpacing = Math.max(1, Math.round(config.sampleSpacing));
              const rawStates: string[] = [];
              const yellowStates: boolean[] = [];
              const isYellow = (red: number, green: number, blue: number) =>
                red > 150 && green > 105 && blue < 120 && red > blue * 1.4;
              const runtimeColorMap = readRuntimeColorMap();
              const getMappedColor = (red: number, green: number, blue: number) =>
                findClosestOverlayColor(red, green, blue, [...overlayColorMap, ...runtimeColorMap]);
              for (let sample = 0; sample < sampleCount; sample += 1) {
                const x = Math.min(sampleWidth - 1, sampleStartOffset + sample * sampleSpacing);
                const baseColor = readPixel(x, baseSampleY);
                const yellowColor = readPixel(x, yellowSampleY);
                const baseRed = baseColor.red;
                const baseGreen = baseColor.green;
                const baseBlue = baseColor.blue;
                const mappedMatch = getMappedColor(baseRed, baseGreen, baseBlue);
                const mappedColor = mappedMatch?.name;
                const idle = mappedColor === "idle";
                const hitpause = mappedColor === "hitpause";
                const yellow = isYellow(yellowColor.red, yellowColor.green, yellowColor.blue);
                rawStates.push(mappedColor ?? "Unmapped");
                yellowStates.push(yellow);
                if (mappedMatch) {
                  confidenceTotal += mappedMatch.confidence;
                  confidenceSamples += 1;
                }
                if (idle) idlePixels += 1;
                if (hitpause) hitpausePixels += 1;
                if (!mappedColor) {
                  const key = `${baseRed},${baseGreen},${baseBlue}`;
                  unmappedColors.set(key, (unmappedColors.get(key) ?? 0) + 1);
                }

                context.fillStyle = idle ? "#00ff66" : hitpause ? "#ff9900" : "#ff0066";
                context.fillRect(
                  sourceDisplayX + (x / sampleWidth) * framebarDisplayWidth,
                  sourceDisplayY + (baseSampleY / sampleHeight) * framebarDisplayHeight,
                  1,
                  1,
                );
                context.fillStyle = yellow ? "#ffff00" : "#0088ff";
                context.fillRect(
                  sourceDisplayX + (x / sampleWidth) * framebarDisplayWidth,
                  sourceDisplayY + (yellowSampleY / sampleHeight) * framebarDisplayHeight,
                  1,
                  1,
                );
              }
              const states = rawStates.map((rawState, index) => {
                if (stableStatesRef.current[index] === undefined) {
                  stableStatesRef.current[index] = rawState;
                  candidateStatesRef.current[index] = rawState;
                  candidateCountsRef.current[index] = 0;
                  return rawState;
                }
                if (rawState === stableStatesRef.current[index]) {
                  candidateStatesRef.current[index] = rawState;
                  candidateCountsRef.current[index] = 0;
                  return stableStatesRef.current[index];
                }
                if (candidateStatesRef.current[index] === rawState) {
                  candidateCountsRef.current[index] += 1;
                } else {
                  candidateStatesRef.current[index] = rawState;
                  candidateCountsRef.current[index] = 1;
                }
                if (candidateCountsRef.current[index] >= 3) {
                  stableStatesRef.current[index] = rawState;
                  candidateCountsRef.current[index] = 0;
                }
                return stableStatesRef.current[index];
              });
              const groups: Array<{ state: string; start: number; length: number }> = [];
              states.forEach((state, index) => {
                const previous = groups[groups.length - 1];
                if (previous?.state === state) previous.length += 1;
                else groups.push({ state, start: index, length: 1 });
              });
              framebarStateRef.current.player2 = groups;
              const player2Phases = summarizeDefensivePhases(groups);
              if (localStorage.getItem(overlayCaptureEnabledKey) !== "false") {
                captureSessionRef.current.samples.push({
                  captureFrame,
                  timestamp: new Date(captureTimestampMs).toISOString(),
                  timestampMs: captureTimestampMs,
                  mediaTime,
                  player1: formatFramebarGroups(framebarStateRef.current.player1),
                  player2: formatFramebarGroups(groups),
                  player1Phases: summarizeFramePhases(framebarStateRef.current.player1),
                  player2Phases,
                  player1Phase: currentMovePhase(framebarStateRef.current.player1),
                  input: stableResolvedInputRef.current?.notation,
                });
                if (captureSessionRef.current.samples.length > 3600) {
                  captureSessionRef.current.samples.splice(
                    0,
                    captureSessionRef.current.samples.length - 3600,
                  );
                }
              }
              if (debugRef.current) {
                const unmappedSummary = [...unmappedColors.entries()]
                  .sort((left, right) => right[1] - left[1])
                  .slice(0, 5)
                  .map(([color, count]) => `${color} (${count})`)
                  .join(", ");
                if (tick % 10 === 0) {
                  localStorage.setItem(
                    overlayCellGroupsKey,
                    JSON.stringify({ timestamp: new Date().toISOString(), groups }),
                  );
                  const signature = groups
                    .map((group) => `${group.state}:${group.length}`)
                    .join("|");
                  if (signature === pendingGroupSignatureRef.current) {
                    pendingGroupCountRef.current += 1;
                  } else {
                    pendingGroupSignatureRef.current = signature;
                    pendingGroupCountRef.current = 1;
                  }
                  if (
                    pendingGroupCountRef.current >= 3 &&
                    signature !== lastGroupSignatureRef.current
                  ) {
                    lastGroupSignatureRef.current = signature;
                    lastGroupSignatureRef.current = signature;
                    let log: Array<{
                      timestamp: string;
                      groups: Array<{ state: string; start: number; length: number }>;
                    }> = [];
                    try {
                      log = JSON.parse(localStorage.getItem(overlayCellGroupLogKey) ?? "[]");
                    } catch {
                      log = [];
                    }
                    log.push({ timestamp: new Date().toISOString(), groups });
                    localStorage.setItem(overlayCellGroupLogKey, JSON.stringify(log.slice(-200)));
                  }
                  localStorage.setItem(
                    overlayPlayer2UnmappedKey,
                    JSON.stringify(
                      [...unmappedColors.entries()]
                        .sort((left, right) => right[1] - left[1])
                        .slice(0, 20)
                        .map(([rgb, count]) => {
                          const [red, green, blue] = rgb.split(",").map(Number);
                          return { red, green, blue, count };
                        }),
                    ),
                  );
                }
                debugRef.current.textContent = [
                  "P2 frame-bar debug",
                  trainingMeterSummaryRef.current,
                  `scan: raw game-window source x=${Math.round(sourceX)}, y=${Math.round(sourceY)}, w=${Math.round(framebarSourceWidth)}, h=${Math.round(framebarSourceHeight)}`,
                  `mirror output: x=${Math.round(targetX)}, y=${Math.round(targetY)}, w=${Math.round(targetWidth)}, h=${Math.round(targetHeight)}`,
                  `source: ${sampleWidth} x ${sampleHeight}px`,
                  `base scanline: y=${baseSampleY}px, idle=${idlePixels}, hitpause=${hitpausePixels}/${sampleCount}`,
                  `frames: ${formatPairedFramebarStates(states, yellowStates)}`,
                  `defense: hitstun=${player2Phases.hitstun} blockstun=${player2Phases.blockstun}`,
                  `x samples: start=${sampleStartOffset}px, spacing=${sampleSpacing}px`,
                  `unmapped RGB: ${unmappedSummary || "none"}`,
                  `mapping confidence: ${confidenceSamples ? (confidenceTotal / confidenceSamples).toFixed(2) : "none"}`,
                  `meter features: color=${player2MeterPresence.colorScore.toFixed(2)}, edge=${player2MeterPresence.edgeScore.toFixed(2)}, mapped=${player2MeterPresence.mappedScore.toFixed(2)}`,
                  `input: ${inputSummaryRef.current}`,
                  `capture: ${captureSourceMode}`,
                  `input event: ${inputEventSummaryRef.current}`,
                  `input alignment: ${inputAlignmentSummaryRef.current}`,
                  `corners: ${cornerSummaryRef.current}`,
                  `resolved move: ${moveResolutionSummaryRef.current}`,
                  "move framebar source: P1 (P2 reserved for defense)",
                  `P1: ${player1SummaryRef.current}`,
                  `move: ${moveStatusRef.current}`,
                ].join("\n");
              }
              context.strokeStyle = "rgba(0, 255, 255, 0.9)";
              context.lineWidth = 2;
              context.strokeRect(
                sourceDisplayX,
                sourceDisplayY,
                framebarDisplayWidth,
                framebarDisplayHeight,
              );
              context.strokeStyle = "rgba(255, 0, 0, 0.9)";
              context.lineWidth = 2;
              context.strokeRect(targetX, targetY, targetWidth, targetHeight);
            } else if (debugRef.current) {
              debugRef.current.textContent = `Framebar analysis unavailable\ncapture: ${captureSourceMode}\ninput: ${inputSummaryRef.current}\ninput event: ${inputEventSummaryRef.current}\ninput alignment: ${inputAlignmentSummaryRef.current}\ncorners: ${cornerSummaryRef.current}\nresolved move: ${moveResolutionSummaryRef.current}\nmove framebar source: P1 (P2 reserved for defense)\nP1: ${player1SummaryRef.current}\nmove: ${moveStatusRef.current}`;
            }
          }
        }
        scheduleFrame();
      };
      const scheduleFrame = () => {
        // Keep the analysis loop alive even when the capture video is hidden
        // from the compositor. Some Chromium builds do not deliver
        // requestVideoFrameCallback callbacks for non-visible video elements.
        frame = requestAnimationFrame((now) => draw(undefined, now));
      };
      draw();
    };
    void start();
    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      cancelAnimationFrame(frame);
      stopRecording?.();
      finalizeSubscription?.();
      beginSubscription?.();
      stream?.getTracks().forEach((track) => track.stop());
      if (!stopRecording) persistCaptureSession("complete");
    };
  }, []);
  return (
    <>
      <Box
        sx={{
          position: "fixed",
          top: 24,
          left: 24,
          zIndex: 2,
          pointerEvents: "none",
          p: 2,
          color: "white",
          backgroundColor: "red",
          fontWeight: 700,
        }}
      >
        OVERLAY WINDOW TEST
      </Box>
      <Box
        ref={debugRef}
        component="pre"
        sx={{
          position: "fixed",
          top: 24,
          right: 24,
          zIndex: 2,
          display: localStorage.getItem(overlayTextDebugKey) === "false" ? "none" : "block",
          m: 0,
          p: 1,
          boxSizing: "border-box",
          maxWidth: "calc(100vw - 48px)",
          maxHeight: "calc(100vh - 48px)",
          overflow: "auto",
          color: "white",
          backgroundColor: "rgba(0, 0, 0, 0.7)",
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 1.35,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        Waiting for capture...
      </Box>
      <video
        ref={videoRef}
        muted
        aria-hidden="true"
        style={{
          position: "fixed",
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
    </>
  );
}
