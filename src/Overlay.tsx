import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
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
  overlayGateSamplesKey,
  overlayDetectFramebarKey,
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
  resolveRecentInput,
  type InputMarker,
  type InputDisplayObservation,
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
  createTrainingMeterTracker,
  formatTrainingMeterStatus,
  scoreTrainingMeterPresence,
  updateTrainingMeterTracker,
  type TrainingMeterScore,
  type TrainingMeterTracker,
} from "./training-meter";

const overlayConfigKey = "avatar-overlay-config";
const overlayOverrideKey = "avatar-overlay-allow-override";
const overlayInputDebugKey = "avatar-overlay-input-debug";
const overlayInputDebugImageKey = "avatar-overlay-input-debug-image";
const overlayDetectCornersKey = "avatar-overlay-detect-corners";
type OverlayConfig = {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
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
  gateRequiredMatches: number;
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
  gateRequiredMatches: 61,
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
  resolvedMove?: {
    notation: string;
    phases: FramePhaseCounts;
    opponentPhases?: DefensivePhaseCounts;
    framebarTimestamp: string;
  };
};

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
  gateActive: boolean;
  gateMatches: number;
  gateCount: number;
  requiredGateMatches: number;
  gateSamples: FramebarPixel[];
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
  const gateY = Math.min(sampleHeight - 1, Math.max(0, Math.round(config.gateSampleOffset)));
  const gateStart = Math.max(0, Math.round(config.gateStartOffset));
  const gateSpacing = Math.max(1, Math.round(config.gateSpacing));
  const gateCount = Math.min(1000, Math.max(1, Math.round(config.gateSampleCount)));
  const gateTolerance = Math.max(0, Math.round(config.gateTolerance));
  const gateSamples: FramebarPixel[] = [];
  let gateMatches = 0;
  for (let gateIndex = 0; gateIndex < gateCount; gateIndex += 1) {
    const gateX = Math.min(sampleWidth - 1, gateStart + gateIndex * gateSpacing);
    const gateColor = readPixel(gateX, gateY);
    gateSamples.push(gateColor);
    if (
      Math.abs(gateColor.red - config.gateRed) <= gateTolerance &&
      Math.abs(gateColor.green - config.gateGreen) <= gateTolerance &&
      Math.abs(gateColor.blue - config.gateBlue) <= gateTolerance
    ) {
      gateMatches += 1;
    }
  }
  const requiredGateMatches = Math.min(
    gateCount,
    Math.max(1, Math.round(config.gateRequiredMatches)),
  );
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
    // Keep the legacy gate fields for diagnostics, but make the active gate
    // tolerant of translucent UI compositing and small background changes.
    gateActive: meterPresence.score >= 0.42,
    gateMatches,
    gateCount,
    requiredGateMatches,
    gateSamples,
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

function sameInputMarker(left: InputMarker, right: InputMarker) {
  return (
    left.color === right.color &&
    Math.abs(left.x - right.x) <= 1 &&
    Math.abs(left.y - right.y) <= 1 &&
    Math.abs(left.area - right.area) <= 2
  );
}

function drawInputObservationDebug(
  context: CanvasRenderingContext2D,
  observation: InputDisplayObservation,
  target: { x: number; y: number; width: number; height: number },
  config: OverlayConfig,
) {
  const mapX = (x: number) => target.x + (x / observation.width) * target.width;
  const mapY = (y: number) => target.y + (y / observation.height) * target.height;
  context.save();
  context.font = "11px monospace";
  context.lineWidth = 1;
  observation.rows.forEach((row, index) => {
    const rowTop = mapY(row.top);
    const rowBottom = mapY(row.bottom);
    const rowHeight = Math.max(2, rowBottom - rowTop);
    context.strokeStyle = "rgba(255, 255, 255, 0.65)";
    context.strokeRect(target.x + 1, rowTop, target.width - 2, rowHeight);
    context.fillStyle = "rgba(255, 255, 255, 0.9)";
    context.fillText(`r${index}`, target.x + 3, rowTop + 11);

    if (row.joystickCheck) {
      const joystickX = mapX(row.joystickCheck.centerX);
      const joystickY = mapY(row.joystickCheck.centerY);
      context.strokeStyle = row.joystickCheck.detected ? "#00ff66" : "#ff6060";
      context.beginPath();
      context.arc(joystickX, joystickY, Math.max(5, target.width * 0.018), 0, Math.PI * 2);
      context.stroke();
      if (row.joystickCheck.markerX !== undefined && row.joystickCheck.markerY !== undefined) {
        context.fillStyle = "#00ff66";
        context.beginPath();
        context.arc(
          mapX(row.joystickCheck.markerX),
          mapY(row.joystickCheck.markerY),
          Math.max(2, target.width * 0.008),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    }

    inputButtonSlotRatios(config).forEach((slot) => {
      const check = row.buttonChecks?.find((candidate) => candidate.slot === slot.slot);
      const centerX = mapX(observation.width * slot.ratio);
      const centerY = mapY(row.top + slot.yRatio * (row.bottom - row.top));
      const radius = Math.max(5, target.width * (config.inputButtonRegionRadius / 100));
      context.strokeStyle = check?.detected ? "#00ff66" : "rgba(255, 100, 100, 0.75)";
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = context.strokeStyle;
      context.fillText(slot.slot, centerX - 3, centerY + 4);
    });

    const numberX = mapX(observation.width * (config.inputNumberStartX / 100));
    context.strokeStyle = "rgba(255, 176, 0, 0.9)";
    context.strokeRect(
      numberX,
      rowTop,
      target.width * ((config.inputNumberEndX - config.inputNumberStartX) / 100),
      rowHeight,
    );
    if (row.numberReading) {
      context.fillStyle = "#ffb000";
      context.fillText(row.numberReading.text, numberX + 2, rowBottom - 2);
    }
  });
  context.restore();
}

function isIdleFramebar(groups: FramebarGroup[]) {
  return groups.length === 1 && groups[0]?.state === "idle";
}

const configFields: Array<{ key: keyof OverlayConfig; label: string }> = [
  { key: "sourceX", label: "P2 source X" },
  { key: "sourceY", label: "P2 source Y" },
  { key: "sourceWidth", label: "P2 source width" },
  { key: "sourceHeight", label: "P2 source height" },
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
      { key: "inputNumberStartX", label: "Number start %" },
      { key: "inputNumberEndX", label: "Number end %" },
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

export function VisualOverlay() {
  const [visible, setVisible] = useState(false);
  const [onlyWhenFocused, setOnlyWhenFocused] = useState(true);
  const [config, setConfig] = useState<OverlayConfig>(readOverlayConfig);
  const [allowOverride, setAllowOverride] = useState(
    () => localStorage.getItem(overlayOverrideKey) === "true",
  );
  const [detectFramebar, setDetectFramebar] = useState(
    () => localStorage.getItem(overlayDetectFramebarKey) !== "false",
  );
  const [detectInput, setDetectInput] = useState(
    () => localStorage.getItem(overlayDetectInputKey) !== "false",
  );
  const [showInputDebug, setShowInputDebug] = useState(
    () => localStorage.getItem(overlayInputDebugKey) !== "false",
  );
  const [detectCorners, setDetectCorners] = useState(
    () => localStorage.getItem(overlayDetectCornersKey) !== "false",
  );
  const [inputDebugImage, setInputDebugImage] = useState(
    () => localStorage.getItem(overlayInputDebugImageKey) ?? "",
  );
  const [inputObservation, setInputObservation] = useState<InputDisplayObservation | null>(null);
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
  const [gateSamples, setGateSamples] = useState<
    Array<{ red: number; green: number; blue: number }>
  >([]);
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
        setGateSamples(JSON.parse(localStorage.getItem(overlayGateSamplesKey) ?? "[]"));
        setInputObservation(JSON.parse(localStorage.getItem(overlayInputObservationKey) ?? "null"));
        setInputDebugImage(localStorage.getItem(overlayInputDebugImageKey) ?? "");
        setInputEventLog(JSON.parse(localStorage.getItem(overlayInputEventLogKey) ?? "[]"));
        setMoveEpisodeLog(JSON.parse(localStorage.getItem(overlayMoveEpisodeLogKey) ?? "[]"));
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
  const changeFramebarDetection = (enabled: boolean) => {
    setDetectFramebar(enabled);
    localStorage.setItem(overlayDetectFramebarKey, String(enabled));
  };
  const changeInputDetection = (enabled: boolean) => {
    setDetectInput(enabled);
    localStorage.setItem(overlayDetectInputKey, String(enabled));
  };
  const changeInputDebug = (enabled: boolean) => {
    setShowInputDebug(enabled);
    localStorage.setItem(overlayInputDebugKey, String(enabled));
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
  const snapshotGateColor = () => {
    if (gateSamples.length === 0) return;
    const counts = new Map<string, number>();
    gateSamples.forEach(({ red, green, blue }) => {
      const key = `${red},${green},${blue}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    const [key] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0] ?? [];
    if (!key) return;
    const [red, green, blue] = key.split(",").map(Number);
    const next = { ...config, gateRed: red, gateGreen: green, gateBlue: blue };
    setConfig(next);
    localStorage.setItem(overlayConfigKey, JSON.stringify(next));
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
  return (
    <Paper variant="outlined" sx={{ p: 3, textAlign: "left" }}>
      <Typography variant="h6">Visual overlay</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Basic always-on-top overlay test window. Game capture and visual analysis will be added
        next.
      </Typography>
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
      <Typography variant="subtitle2" sx={{ mt: 2 }}>
        Mirrored region and destination (percent of screen)
      </Typography>
      <Typography variant="caption" color="text.secondary">
        X/Y are measured from the top-left. Width/height are percentages. Changes are saved
        automatically.
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
      <FormControlLabel
        control={
          <Checkbox
            checked={detectFramebar}
            onChange={(event) => changeFramebarDetection(event.target.checked)}
          />
        }
        label="Detect framebar"
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={detectInput}
            onChange={(event) => changeInputDetection(event.target.checked)}
          />
        }
        label="Detect input display"
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={showInputDebug}
            onChange={(event) => changeInputDebug(event.target.checked)}
            disabled={!detectInput}
          />
        }
        label="Visualize input blobs"
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={detectCorners}
            onChange={(event) => changeCornerDetection(event.target.checked)}
          />
        }
        label="Detect character/support images"
      />
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
      {detectCorners && (
        <>
          <Typography variant="subtitle2" sx={{ mt: 2 }}>
            Character/support image detection
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            Detection compares the raw game capture against named templates. Configure each corner
            region if your HUD or scaling differs, then register the visible image once. Scores are
            similarity scores from 0 to 1; higher is better.
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
                <Stack key={template.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
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
      {detectInput && showInputDebug && (
        <>
          <Typography variant="subtitle2" sx={{ mt: 2 }}>
            Input blob preview
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            This preview is rendered outside the capture overlay, so its annotations cannot feed
            back into detection.
          </Typography>
          <Box
            sx={{
              position: "relative",
              mt: 1,
              width: 280,
              height: 560,
              maxWidth: "100%",
              overflowY: "auto",
              overflowX: "hidden",
              backgroundColor: "#101010",
              border: "1px solid rgba(0, 229, 255, 0.8)",
            }}
          >
            {inputDebugImage && (
              <Box
                component="img"
                src={inputDebugImage}
                alt="Captured input display"
                sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
              />
            )}
            {inputObservation?.rows.map((row, index) => {
              const top = `${(row.top / inputObservation.height) * 100}%`;
              const height = `${Math.max(0.5, ((row.bottom - row.top) / inputObservation.height) * 100)}%`;
              return (
                <Box
                  key={`input-debug-row-${index}`}
                  sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top,
                    height,
                    border: "1px solid rgba(255,255,255,.75)",
                  }}
                >
                  <Box
                    component="span"
                    sx={{ position: "absolute", left: 2, top: 0, color: "white", fontSize: 10 }}
                  >
                    r{index}
                  </Box>
                  {row.markers.map((marker, markerIndex) => {
                    const buttonCheck = row.buttonChecks?.find(
                      (check) => check.marker && sameInputMarker(check.marker, marker),
                    );
                    if (buttonCheck) return null;
                    const isJoystickMarker =
                      row.joystickCheck?.detected &&
                      row.joystickCheck.markerX !== undefined &&
                      row.joystickCheck.markerY !== undefined &&
                      Math.abs(row.joystickCheck.markerX - marker.x) <= 1 &&
                      Math.abs(row.joystickCheck.markerY - marker.y) <= 1;
                    const markerColor = isJoystickMarker ? "#00ff66" : "#aa66ff";
                    const markerLabel = isJoystickMarker ? "J" : "N";
                    return (
                      <Box
                        key={`input-debug-marker-${index}-${markerIndex}`}
                        component="span"
                        sx={{
                          position: "absolute",
                          left: `${(marker.x / inputObservation.width) * 100}%`,
                          top: `${((marker.y - row.top) / Math.max(1, row.bottom - row.top)) * 100}%`,
                          width: `${Math.max(1, (marker.width / inputObservation.width) * 100)}%`,
                          height: `${Math.max(3, (marker.height / Math.max(1, row.bottom - row.top)) * 100)}%`,
                          transform: "translate(-50%, -50%)",
                          border: `2px solid ${markerColor}`,
                          color: markerColor,
                          fontSize: 9,
                          lineHeight: 1,
                          textAlign: "center",
                        }}
                      >
                        {markerLabel}
                      </Box>
                    );
                  })}
                  {row.joystickCheck && (
                    <Box
                      component="span"
                      sx={{
                        position: "absolute",
                        left: `${(row.joystickCheck.centerX / inputObservation.width) * 100}%`,
                        top: `${((row.joystickCheck.centerY - row.top) / Math.max(1, row.bottom - row.top)) * 100}%`,
                        width: "10%",
                        aspectRatio: "1",
                        transform: "translate(-50%, -50%)",
                        border: `1px solid ${row.joystickCheck.detected ? "#00ff66" : "#ff6060"}`,
                        borderRadius: "50%",
                      }}
                    />
                  )}
                  {row.buttonChecks?.map((check) => {
                    const slot = inputButtonSlotRatios(config).find(
                      (candidate) => candidate.slot === check.slot,
                    );
                    const slotRatio = slot?.ratio ?? 0;
                    const slotYRatio = slot?.yRatio ?? 0;
                    return (
                      <Box
                        key={`input-debug-slot-${index}-${check.slot}`}
                        component="span"
                        sx={{
                          position: "absolute",
                          left: `${slotRatio * 100}%`,
                          top: `${slotYRatio * 100}%`,
                          width: `${config.inputButtonRegionRadius * 2}%`,
                          height: `${(config.inputButtonRegionRadius * 2 * inputObservation.width) / Math.max(1, row.bottom - row.top)}%`,
                          transform: "translate(-50%, -50%)",
                          border: `1px solid ${check.detected ? "#00ff66" : "rgba(255,100,100,.8)"}`,
                          borderRadius: "50%",
                          color: check.detected ? "#00ff66" : "rgba(255,100,100,.8)",
                          fontSize: 9,
                          textAlign: "center",
                        }}
                      >
                        {check.slot}
                      </Box>
                    );
                  })}
                  <Box
                    component="span"
                    sx={{
                      position: "absolute",
                      left: `${config.inputNumberStartX}%`,
                      top: 0,
                      bottom: 0,
                      width: `${config.inputNumberEndX - config.inputNumberStartX}%`,
                      border: "1px solid #ffb000",
                      color: "#ffb000",
                      fontSize: 9,
                    }}
                  >
                    {row.numberReading?.text ?? "?"}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </>
      )}
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
            Automatic framebar gate
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Every gate sample must match the configured segment color before framebar detection
            runs.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
            {(
              [
                ["gateSampleOffset", "Gate Y offset"],
                ["gateStartOffset", "Gate X offset"],
                ["gateSpacing", "Gate spacing"],
                ["gateSampleCount", "Gate sample count"],
                ["gateRequiredMatches", "Required matches"],
                ["gateRed", "Gate red"],
                ["gateGreen", "Gate green"],
                ["gateBlue", "Gate blue"],
                ["gateTolerance", "Gate tolerance"],
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
            <Button
              variant="outlined"
              size="small"
              onClick={snapshotGateColor}
              disabled={gateSamples.length === 0}
            >
              Snapshot current gate color
            </Button>
          </Stack>
          <Button size="small" sx={{ mt: 1 }} onClick={resetConfig}>
            Reset overlay geometry
          </Button>
        </>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: "center" }}>
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
      <Typography variant="subtitle2" sx={{ mt: 2 }}>
        Input display resolver
      </Typography>
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
      {inputEventLog.length > 0 && (
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
    let frame = 0;
    let retryTimer = 0;
    let stopped = false;
    let captureSourceId = "";
    let captureSourceMode = "unknown";
    let captureCheckPending = false;
    let reconnecting = false;
    let tick = 0;
    let stream: MediaStream | null = null;
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
    const start = async () => {
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
        const video = videoRef.current;
        if (!video) throw new Error("Capture video element is unavailable");
        video.srcObject = stream;
        await video.play();
      } catch (error) {
        stream?.getTracks().forEach((track) => track.stop());
        stream = null;
        if (!stopped) {
          const message = error instanceof Error ? error.message : String(error);
          if (debugRef.current)
            debugRef.current.textContent = `Capture unavailable\n${message}\nRetrying...`;
          retryTimer = window.setTimeout(() => void start(), 1000);
        }
        return;
      }
      const video = videoRef.current;
      if (!video || stopped) return;
      const draw = () => {
        if (reconnecting || stopped) return;
        tick += 1;
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
            const targetX = width * (config.targetX / 100);
            const targetY = height * (config.targetY / 100);
            const targetWidth = width * (config.targetWidth / 100);
            const targetHeight = height * (config.targetHeight / 100);
            const sourceDisplayX = width * (config.sourceX / 100);
            const sourceDisplayY = height * (config.sourceY / 100);
            const sourceDisplayWidth = width * (config.sourceWidth / 100);
            const sourceDisplayHeight = height * (config.sourceHeight / 100);
            context.clearRect(0, 0, width, height);
            // P2 is sampled directly from the raw game-window video. The
            // mirrored copy below is output only and is never used as input.
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

            if (
              inputAnalysisContext &&
              localStorage.getItem(overlayDetectInputKey) !== "false" &&
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
                },
              );
              if (localStorage.getItem(overlayInputDebugKey) !== "false" && tick % 30 === 0) {
                try {
                  localStorage.setItem(
                    overlayInputDebugImageKey,
                    inputAnalysisCanvas.toDataURL("image/jpeg", 0.65),
                  );
                } catch {
                  // Debug snapshots are optional; detection should continue if storage is full.
                }
              }
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
            }

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

            if (localStorage.getItem(overlayDetectInputKey) !== "false") {
              context.strokeStyle = "rgba(0, 255, 255, 0.9)";
              context.lineWidth = 2;
              context.strokeRect(
                width * (config.inputSourceX / 100),
                height * (config.inputSourceY / 100),
                width * (config.inputSourceWidth / 100),
                height * (config.inputSourceHeight / 100),
              );
            }
            // The preview is drawn only after detection has read the raw
            // game-window frame.  It is therefore output-only and cannot
            // feed any of the input or framebar detectors back into itself.
            if (
              localStorage.getItem(overlayInputDebugKey) !== "false" &&
              captureSourceMode === "game-window" &&
              stableInputObservationRef.current
            ) {
              drawInputObservationDebug(
                context,
                stableInputObservationRef.current,
                {
                  x: width * (config.inputSourceX / 100),
                  y: height * (config.inputSourceY / 100),
                  width: width * (config.inputSourceWidth / 100),
                  height: height * (config.inputSourceHeight / 100),
                },
                config,
              );
            }
            if (
              player1AnalysisContext &&
              localStorage.getItem(overlayDetectFramebarKey) === "true"
            ) {
              const player1SourceX = Math.max(0, video.videoWidth * (config.player1SourceX / 100));
              const player1SourceY = Math.max(0, video.videoHeight * (config.player1SourceY / 100));
              const player1SourceWidth = Math.max(
                1,
                Math.min(
                  video.videoWidth - player1SourceX,
                  video.videoWidth * (config.sourceWidth / 100),
                ),
              );
              const player1SourceHeight = Math.max(
                1,
                Math.min(
                  video.videoHeight - player1SourceY,
                  video.videoHeight * (config.sourceHeight / 100),
                ),
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
              const player1TargetX = width * (config.player1SourceX / 100);
              const player1TargetY = height * (config.player1SourceY / 100);
              for (let sample = 0; sample < player1Reading.rawStates.length; sample += 1) {
                const x = Math.min(
                  player1Reading.sampleWidth - 1,
                  player1Reading.sampleStartOffset + sample * player1Reading.sampleSpacing,
                );
                const markerX = player1TargetX + (x / player1Reading.sampleWidth) * targetWidth;
                context.fillStyle =
                  player1Reading.rawStates[sample] === "idle"
                    ? "#00ccff"
                    : player1Reading.rawStates[sample] === "hitpause"
                      ? "#ff66ff"
                      : "#ff0066";
                context.fillRect(
                  markerX,
                  player1TargetY +
                    (player1Reading.baseSampleY / player1Reading.sampleHeight) * targetHeight,
                  1,
                  1,
                );
                context.fillStyle = player1Reading.yellowStates[sample] ? "#ffff00" : "#0088ff";
                context.fillRect(
                  markerX,
                  player1TargetY +
                    (player1Reading.yellowSampleY / player1Reading.sampleHeight) * targetHeight,
                  1,
                  1,
                );
              }
              const player1MeterReady =
                trainingMeterRef.current.state === "training" ||
                (trainingMeterRef.current.state === "unknown" && player1Reading.gateActive);
              if (!player1MeterReady) {
                player1SummaryRef.current = `gate inactive ${player1Reading.gateMatches}/${player1Reading.gateCount}`;
              } else {
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
                    activeMoveEpisodeRef.current = {
                      startedAt: new Date(now).toISOString(),
                      endedAt: null,
                      inputEvents: [precipitatingInput],
                      framebarSamples: [],
                    };
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
                    };
                    if (resolvedMove) {
                      const { startup, active, recovery } = resolvedMove.phases;
                      const { hitstun, blockstun } = resolvedMove.opponentPhases;
                      moveResolutionSummaryRef.current = `${resolvedMove.notation}: startup ${startup}, active ${active}, recovery ${recovery}, hitstun ${hitstun}, blockstun ${blockstun}`;
                    }
                    let moveLog: MoveEpisode[] = [];
                    try {
                      moveLog = JSON.parse(localStorage.getItem(overlayMoveEpisodeLogKey) ?? "[]");
                    } catch {
                      moveLog = [];
                    }
                    moveLog.push(completedMove);
                    localStorage.setItem(
                      overlayMoveEpisodeLogKey,
                      JSON.stringify(moveLog.slice(-100)),
                    );
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
              player1SummaryRef.current = "disabled";
            }

            if (analysisContext && localStorage.getItem(overlayDetectFramebarKey) === "true") {
              const sampleWidth = Math.max(1, Math.round(sourceWidth));
              const sampleHeight = Math.max(1, Math.round(sourceHeight));
              analysisCanvas.width = sampleWidth;
              analysisCanvas.height = sampleHeight;
              analysisContext.drawImage(
                video,
                sourceX,
                sourceY,
                sourceWidth,
                sourceHeight,
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
              const gateY = Math.min(
                sampleHeight - 1,
                Math.max(0, Math.round(config.gateSampleOffset)),
              );
              const gateStart = Math.max(0, Math.round(config.gateStartOffset));
              const gateSpacing = Math.max(1, Math.round(config.gateSpacing));
              const gateCount = Math.min(1000, Math.max(1, Math.round(config.gateSampleCount)));
              const gateTolerance = Math.max(0, Math.round(config.gateTolerance));
              let gateMatches = 0;
              const currentGateSamples: Array<{ red: number; green: number; blue: number }> = [];
              for (let gateIndex = 0; gateIndex < gateCount; gateIndex += 1) {
                const gateX = Math.min(sampleWidth - 1, gateStart + gateIndex * gateSpacing);
                const gateColor = readPixel(gateX, gateY);
                currentGateSamples.push(gateColor);
                if (
                  Math.abs(gateColor.red - config.gateRed) <= gateTolerance &&
                  Math.abs(gateColor.green - config.gateGreen) <= gateTolerance &&
                  Math.abs(gateColor.blue - config.gateBlue) <= gateTolerance
                ) {
                  gateMatches += 1;
                }
              }
              const requiredGateMatches = Math.min(
                gateCount,
                Math.max(1, Math.round(config.gateRequiredMatches)),
              );
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
              updateTrainingMeterTracker(trainingMeterRef.current, trainingMeterScores);
              trainingMeterSummaryRef.current = formatTrainingMeterStatus(
                trainingMeterRef.current,
                trainingMeterScores,
              );
              const gateActive =
                trainingMeterRef.current.state === "training" ||
                (trainingMeterRef.current.state === "unknown" &&
                  player2MeterPresence.score >= 0.42);
              if (tick % 10 === 0) {
                localStorage.setItem(overlayGateSamplesKey, JSON.stringify(currentGateSamples));
              }
              for (let gateIndex = 0; gateIndex < gateCount; gateIndex += 1) {
                const gateX = Math.min(sampleWidth - 1, gateStart + gateIndex * gateSpacing);
                const gateColor = readPixel(gateX, gateY);
                const matched =
                  Math.abs(gateColor.red - config.gateRed) <= gateTolerance &&
                  Math.abs(gateColor.green - config.gateGreen) <= gateTolerance &&
                  Math.abs(gateColor.blue - config.gateBlue) <= gateTolerance;
                context.fillStyle = matched ? "#00ff66" : "#ff0044";
                context.fillRect(
                  sourceDisplayX + (gateX / sampleWidth) * sourceDisplayWidth,
                  sourceDisplayY + (gateY / sampleHeight) * sourceDisplayHeight,
                  1,
                  1,
                );
              }
              if (!gateActive) {
                if (debugRef.current) {
                  debugRef.current.textContent = `Framebar gate inactive\n${trainingMeterSummaryRef.current}\nmatched gate samples: ${gateMatches}/${gateCount}\nrequired matches: ${requiredGateMatches}\ngate RGB: ${config.gateRed},${config.gateGreen},${config.gateBlue}\ninput: ${inputSummaryRef.current}\ninput event: ${inputEventSummaryRef.current}\ninput alignment: ${inputAlignmentSummaryRef.current}\ncorners: ${cornerSummaryRef.current}\nresolved move: ${moveResolutionSummaryRef.current}\nmove framebar source: P1 (P2 reserved for defense)\nP1: ${player1SummaryRef.current}\nmove: ${moveStatusRef.current}`;
                }
                frame = requestAnimationFrame(draw);
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
                  sourceDisplayX + (x / sampleWidth) * sourceDisplayWidth,
                  sourceDisplayY + (baseSampleY / sampleHeight) * sourceDisplayHeight,
                  1,
                  1,
                );
                context.fillStyle = yellow ? "#ffff00" : "#0088ff";
                context.fillRect(
                  sourceDisplayX + (x / sampleWidth) * sourceDisplayWidth,
                  sourceDisplayY + (yellowSampleY / sampleHeight) * sourceDisplayHeight,
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
                  `scan: raw game-window source x=${Math.round(sourceX)}, y=${Math.round(sourceY)}, w=${Math.round(sourceWidth)}, h=${Math.round(sourceHeight)}`,
                  `mirror output: x=${Math.round(targetX)}, y=${Math.round(targetY)}, w=${Math.round(targetWidth)}, h=${Math.round(targetHeight)}`,
                  `source: ${sampleWidth} x ${sampleHeight}px`,
                  `base scanline: y=${baseSampleY}px, idle=${idlePixels}, hitpause=${hitpausePixels}/${sampleCount}`,
                  `frames: ${formatPairedFramebarStates(states, yellowStates)}`,
                  `defense: hitstun=${player2Phases.hitstun} blockstun=${player2Phases.blockstun}`,
                  `x samples: start=${sampleStartOffset}px, spacing=${sampleSpacing}px`,
                  `unmapped RGB: ${unmappedSummary || "none"}`,
                  `mapping confidence: ${confidenceSamples ? (confidenceTotal / confidenceSamples).toFixed(2) : "none"}`,
                  `gate: ${gateMatches}/${gateCount} matched, required=${requiredGateMatches}`,
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
                sourceDisplayWidth,
                sourceDisplayHeight,
              );
              context.strokeStyle = "rgba(255, 0, 0, 0.9)";
              context.lineWidth = 2;
              context.strokeRect(targetX, targetY, targetWidth, targetHeight);
            } else if (debugRef.current) {
              debugRef.current.textContent = `Framebar detection disabled\ncapture: ${captureSourceMode}\ninput: ${inputSummaryRef.current}\ninput event: ${inputEventSummaryRef.current}\ninput alignment: ${inputAlignmentSummaryRef.current}\ncorners: ${cornerSummaryRef.current}\nresolved move: ${moveResolutionSummaryRef.current}\nmove framebar source: P1 (P2 reserved for defense)\nP1: ${player1SummaryRef.current}\nmove: ${moveStatusRef.current}`;
            }
          }
        }
        frame = requestAnimationFrame(draw);
      };
      draw();
    };
    void start();
    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
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
      <video ref={videoRef} style={{ display: "none" }} />
      <canvas
        ref={canvasRef}
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%" }}
      />
    </>
  );
}
