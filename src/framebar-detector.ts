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
  player1Groups: FramebarGroup[];
  player2: string;
  player1Phases: FramePhaseCounts;
  postHitpauseActiveFrames?: number;
  player2Phases?: DefensivePhaseCounts;
};

/** A rolling meter can hide early startup cells before recovery is complete. */
export function summarizeMoveFramebarTimeline(samples: FramebarTimelineSample[]) {
  if (samples.length === 0) return null;
  const visibleScore = (sample: FramebarTimelineSample) =>
    sample.player1Phases.startup + sample.player1Phases.active + sample.player1Phases.recovery;
  const best = samples.reduce((winner, sample) =>
    visibleScore(sample) >= visibleScore(winner) ? sample : winner,
  );
  const startup = Math.max(...samples.map((sample) => sample.player1Phases.startup));
  const active = Math.max(...samples.map((sample) => sample.player1Phases.active));
  const recovery = Math.max(...samples.map((sample) => sample.player1Phases.recovery));
  const rolled = samples.some(
    (sample) =>
      sample.player1Phases.recovery === recovery && sample.player1Phases.startup < startup,
  );
  if (!rolled) return best;
  const structural = samples.reduce((winner, sample) => {
    const score = (candidate: FramebarTimelineSample) =>
      candidate.player1Phases.startup + candidate.player1Phases.active;
    return score(sample) >= score(winner) ? sample : winner;
  });
  return {
    ...best,
    player1: structural.player1,
    player1Groups: structural.player1Groups,
    player1Phases: { ...best.player1Phases, startup, active, recovery },
    postHitpauseActiveFrames: Math.max(
      ...samples.map((sample) => sample.postHitpauseActiveFrames ?? 0),
    ),
    player2Phases: {
      hitstun: Math.max(...samples.map((sample) => sample.player2Phases?.hitstun ?? 0)),
      blockstun: Math.max(...samples.map((sample) => sample.player2Phases?.blockstun ?? 0)),
      other: best.player2Phases?.other ?? 0,
    },
  };
}

/** Remove the jump's blue meter cells before measuring an airborne attack. */
export function airborneAttackTimeline(samples: FramebarTimelineSample[]) {
  const firstStartup = samples.findIndex((sample) =>
    sample.player1Groups.some((group) => group.state.toLowerCase().includes("startup")),
  );
  if (firstStartup < 0) return samples;
  const firstActive = samples.findIndex((sample) =>
    sample.player1Groups.some((group) => group.state.toLowerCase().includes("active")),
  );
  return samples.slice(firstStartup).flatMap((sample, index) => {
    const attackStart = sample.player1Groups.findIndex((group) =>
      /startup|active/i.test(group.state),
    );
    if (attackStart < 0 && firstStartup + index < firstActive) return [];
    const groups = attackStart < 0 ? sample.player1Groups : sample.player1Groups.slice(attackStart);
    const offset = groups[0]?.start ?? 0;
    const player1Groups = groups.map((group) => ({ ...group, start: group.start - offset }));
    return [
      {
        ...sample,
        player1Groups,
        player1: player1Groups.map((group) => `${group.state}x${group.length}`).join(" "),
        player1Phases: summarizeFramePhases(player1Groups),
        postHitpauseActiveFrames: countPostHitpauseActiveFrames(player1Groups),
      },
    ];
  });
}

export type FramebarHitWindow = {
  activeStart: number;
  activeFrames: number;
  gapBeforeFrames: number;
};

/** Only a calibrated orange gap separates attack windows; unmapped pixels do not. */
export function splitFramebarHitWindows(groups: FramebarGroup[]): FramebarHitWindow[] {
  const windows: FramebarHitWindow[] = [];
  let current: FramebarHitWindow | null = null;
  let gapBeforeNext = 0;
  for (const group of groups) {
    const state = group.state.toLowerCase();
    if (state === "multihit-gap" && current) {
      gapBeforeNext += group.length;
    } else if (
      state !== "multihit-gap" &&
      (state.includes("active") || (state.includes("hit") && !state.includes("hitpause")))
    ) {
      if (current && gapBeforeNext > 0) {
        windows.push(current);
        current = null;
      }
      current ??= {
        activeStart: group.start,
        activeFrames: 0,
        gapBeforeFrames: windows.length > 0 ? gapBeforeNext : 0,
      };
      current.activeFrames += group.length;
      gapBeforeNext = 0;
    }
  }
  if (current) windows.push(current);
  return windows;
}

export type FramebarScan = {
  rawStates: string[];
  confidences: number[];
  yellowStates: boolean[];
  pinkStripeStates: boolean[];
  groups: FramebarGroup[];
  yellowPixels: number;
  idlePixels: number;
  hitpausePixels: number;
  unmappedColors: Map<string, number>;
  sampleWidth: number;
  sampleHeight: number;
  baseSampleY: number;
  bottomSampleY: number;
  stripeSampleY: number;
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
  // intended to represent the whole bar, place the final sample inside the
  // final cell. Sampling the ROI edge loses the rightmost meter cells.
  return (safeWidth - safeStart) / safeCount;
}

function medianPatchColor(
  readPixel: (x: number, y: number) => FramebarPixel,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
): FramebarPixel {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -radiusX; dx <= radiusX; dx += 1) {
      const pixel = readPixel(
        Math.min(width - 1, Math.max(0, Math.round(x) + dx)),
        Math.min(height - 1, Math.max(0, y + dy)),
      );
      reds.push(pixel.red);
      greens.push(pixel.green);
      blues.push(pixel.blue);
    }
  }
  const middle = (values: number[]) =>
    values.sort((left, right) => left - right)[Math.floor(values.length / 2)];
  return { red: middle(reds), green: middle(greens), blue: middle(blues) };
}

export function summarizeFramePhases(groups: FramebarGroup[]): FramePhaseCounts {
  const phases: FramePhaseCounts = { startup: 0, active: 0, recovery: 0, other: 0 };
  let startupStarted = false;
  let startupEnded = false;
  groups.forEach((group, index) => {
    const state = group.state.toLowerCase();
    const isStartup = state.includes("startup") || state.includes("start");
    if (!isStartup && startupStarted) startupEnded = true;
    const recoveryWaitingGap =
      state === "multihit-gap" &&
      groups[index - 1]?.state.toLowerCase().includes("recovery") &&
      groups[index + 1]?.state.toLowerCase().includes("recovery") &&
      !groups.slice(index + 1).some((later) => later.state.toLowerCase().includes("active"));
    // Hitpause is commonly represented as a three-frame state and its name
    // contains "hit". Check it before the active-state match so those frames
    // are excluded from active rather than counted as attack frames.
    if (recoveryWaitingGap) phases.recovery += group.length;
    else if (state.includes("hitpause") || state === "multihit-gap") phases.other += group.length;
    else if (isStartup && !startupEnded) {
      phases.startup += group.length;
      startupStarted = true;
    } else if (isStartup) phases.other += group.length;
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
      state !== "multihit-gap" &&
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
  const bottomSampleY = Math.min(sampleHeight - 1, Math.round(sampleHeight * 0.22));
  const stripeSampleY = Math.min(sampleHeight - 1, Math.round(sampleHeight * 0.14));
  const sampleCount = Math.min(1000, Math.max(1, Math.round(config.sampleCount)));
  const configuredStartOffset = Math.max(0, Math.round(config.sampleStartOffset));
  const sampleSpacing = resolveFramebarSampleSpacing(
    sampleWidth,
    configuredStartOffset,
    sampleCount,
    config.sampleSpacing,
  );
  // When an old pixel calibration spans only half of a larger meter, scale
  // the inset into each cell too. Keeping the old inset lands on cell borders.
  const sampleStartOffset = Math.min(
    sampleWidth - 1,
    configuredStartOffset * (sampleSpacing / Math.max(1, config.sampleSpacing)),
  );
  const patchRadiusX = sampleSpacing >= 4 ? 1 : 0;
  const rawStates: string[] = [];
  const confidences: number[] = [];
  const yellowStates: boolean[] = [];
  const pinkStripeStates: boolean[] = [];
  const unmappedColors = new Map<string, number>();
  let yellowPixels = 0;
  let idlePixels = 0;
  let hitpausePixels = 0;
  let mappedPixels = 0;
  const isYellow = (red: number, green: number, blue: number) =>
    red > 150 && green > 105 && blue < 120 && red > blue * 1.4;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const x = Math.min(sampleWidth - 1, sampleStartOffset + sample * sampleSpacing);
    const topColor = medianPatchColor(
      readPixel,
      x,
      baseSampleY,
      sampleWidth,
      sampleHeight,
      patchRadiusX,
    );
    const bottomColor = medianPatchColor(
      readPixel,
      x,
      bottomSampleY,
      sampleWidth,
      sampleHeight,
      patchRadiusX,
    );
    const stripeColor = medianPatchColor(
      readPixel,
      x,
      stripeSampleY,
      sampleWidth,
      sampleHeight,
      patchRadiusX,
    );
    const yellowColor = readPixel(x, yellowSampleY);
    const topMatch = getMappedColor(topColor.red, topColor.green, topColor.blue);
    const bottomMatch = getMappedColor(bottomColor.red, bottomColor.green, bottomColor.blue);
    const mappedColor =
      bottomMatch && (!topMatch || bottomMatch.confidence > topMatch.confidence)
        ? bottomMatch
        : topMatch;
    const stripe =
      stripeColor.red > 180 &&
      stripeColor.blue > 170 &&
      stripeColor.red > stripeColor.green * 1.8 &&
      stripeColor.blue > stripeColor.green * 1.8;
    const yellow = isYellow(yellowColor.red, yellowColor.green, yellowColor.blue);
    rawStates.push(mappedColor?.name ?? "Unmapped");
    confidences.push(mappedColor?.confidence ?? 0);
    if (mappedColor) mappedPixels += 1;
    yellowStates.push(yellow);
    pinkStripeStates.push(stripe);
    if (mappedColor?.name === "idle") idlePixels += 1;
    if (mappedColor?.name === "hitpause") hitpausePixels += 1;
    if (!mappedColor) {
      const key = `${topColor.red},${topColor.green},${topColor.blue}`;
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
    pinkStripeStates,
    groups,
    yellowPixels,
    idlePixels,
    hitpausePixels,
    unmappedColors,
    sampleWidth,
    sampleHeight,
    baseSampleY,
    bottomSampleY,
    stripeSampleY,
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
