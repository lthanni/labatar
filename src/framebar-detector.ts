import type { FramebarColorMatch } from "./framebar-color-map";
import type { DetectorConfig } from "./detector-config";
import { scoreTrainingMeterPresence, type TrainingMeterScore } from "./training-meter";

export type FramebarPixel = { red: number; green: number; blue: number };
export type FramebarGroup = { state: string; start: number; length: number };
export type FramePhaseCounts = {
  startup: number;
  active: number;
  recovery: number;
  other: number;
};
export type DefensivePhaseCounts = {
  hitstun: number;
  blockstun: number;
  other: number;
};

export function calculateOnBlock(
  phases: Pick<FramePhaseCounts, "recovery">,
  opponentPhases: Pick<DefensivePhaseCounts, "blockstun">,
  postHitpauseActiveFrames = 0,
) {
  if (phases.recovery <= 0 || opponentPhases.blockstun <= 0) return null;
  return opponentPhases.blockstun - phases.recovery - postHitpauseActiveFrames;
}

export function calculateOnHit(
  phases: Pick<FramePhaseCounts, "recovery">,
  opponentPhases: Pick<DefensivePhaseCounts, "hitstun">,
  postHitpauseActiveFrames = 0,
) {
  if (phases.recovery <= 0 || opponentPhases.hitstun <= 0) return null;
  return opponentPhases.hitstun - phases.recovery - postHitpauseActiveFrames;
}
export type FramebarTimelineSample = {
  timestamp: number;
  player1: string;
  player2: string;
  player1Phases: FramePhaseCounts;
  postHitpauseActiveFrames?: number;
  player2Phases?: DefensivePhaseCounts;
};

export type FramebarScan = {
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

export function resolveFramebarSampleSpacing(
  sampleWidth: number,
  sampleStartOffset: number,
  sampleCount: number,
  configuredSpacing: number,
) {
  const safeWidth = Math.max(1, sampleWidth);
  const safeStart = Math.max(0, Math.min(safeWidth - 1, sampleStartOffset));
  const safeCount = Math.max(1, Math.round(sampleCount));
  const safeConfiguredSpacing = Math.max(1, configuredSpacing);
  if (safeCount <= 1) return safeConfiguredSpacing;

  const configuredEnd = safeStart + (safeCount - 1) * safeConfiguredSpacing;
  const configuredCoverage = configuredEnd / Math.max(1, safeWidth - 1);
  if (configuredCoverage >= 0.8) return safeConfiguredSpacing;

  // A saved calibration from a smaller source can contain a pixel spacing
  // that only covers part of a larger recording. When the configured count is
  // intended to represent the whole bar, distribute those samples across the
  // actual ROI so one sample corresponds to one displayed frame cell.
  return (safeWidth - 1 - safeStart) / (safeCount - 1);
}

export function summarizeFramePhases(groups: FramebarGroup[]): FramePhaseCounts {
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

export function countPostHitpauseActiveFrames(groups: FramebarGroup[]) {
  let hitpauseSeen = false;
  let frames = 0;
  groups.forEach((group) => {
    const state = group.state.toLowerCase();
    if (state.includes("hitpause")) {
      hitpauseSeen = true;
      return;
    }
    if (
      hitpauseSeen &&
      (state.includes("active") || (state.includes("hit") && !state.includes("hitpause")))
    ) {
      frames += group.length;
    }
  });
  return frames;
}

export function summarizeDefensivePhases(groups: FramebarGroup[]): DefensivePhaseCounts {
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

export function scanFramebar({
  config,
  sampleWidth,
  sampleHeight,
  readPixel,
  getMappedColor,
}: {
  config: DetectorConfig;
  sampleWidth: number;
  sampleHeight: number;
  readPixel: (x: number, y: number) => FramebarPixel;
  getMappedColor: (red: number, green: number, blue: number) => FramebarColorMatch | null;
}): FramebarScan {
  const baseSampleY = Math.min(sampleHeight - 1, Math.max(0, Math.round(config.baseSampleOffset)));
  const yellowSampleY = Math.min(
    sampleHeight - 1,
    Math.max(0, Math.round(config.yellowSampleOffset)),
  );
  const sampleCount = Math.min(1000, Math.max(1, Math.round(config.sampleCount)));
  const sampleStartOffset = Math.max(0, Math.round(config.sampleStartOffset));
  const sampleSpacing = resolveFramebarSampleSpacing(
    sampleWidth,
    sampleStartOffset,
    sampleCount,
    config.sampleSpacing,
  );
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

export function stabilizeFramebarStates(
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

export function groupFramebarStates(states: string[]): FramebarGroup[] {
  const groups: FramebarGroup[] = [];
  states.forEach((state, index) => {
    const previous = groups.at(-1);
    if (previous?.state === state) previous.length += 1;
    else groups.push({ state, start: index, length: 1 });
  });
  return groups;
}

export function isIdleFramebar(groups: FramebarGroup[]) {
  return groups.length === 1 && groups[0]?.state === "idle";
}
