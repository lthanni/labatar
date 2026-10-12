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

/**
 * Count frames beyond the visible meter when a full bar stays in one state.
 * Timeline samples are decoded one per video frame. The first all-one-state
 * snapshot accounts for the visible capacity; subsequent snapshots add the
 * elapsed frames until a different color appears.
 */
function saturatedStateExtensions(samples: FramebarTimelineSample[]) {
  const capacity = Math.max(
    0,
    ...samples.map((sample) =>
      sample.player1Groups.reduce((count, group) => count + group.length, 0),
    ),
  );
  const extensions = new Map<string, number>();
  if (capacity === 0) return extensions;

  let run: { state: string; start: number; length: number } | null = null;
  const finishRun = (followedByDifferentState: boolean) => {
    if (!run) return;
    const previousGroups = samples[run.start - 1]?.player1Groups ?? [];
    const stateWasAlreadyVisible = previousGroups.some(
      (group) => group.state.toLowerCase() === run!.state,
    );
    if (followedByDifferentState && stateWasAlreadyVisible && run.length > 1) {
      extensions.set(run.state, (extensions.get(run.state) ?? 0) + run.length - 1);
    }
    run = null;
  };

  samples.forEach((sample, index) => {
    const group = sample.player1Groups.length === 1 ? sample.player1Groups[0] : undefined;
    const state = group?.state.toLowerCase() ?? "";
    const isSaturatedState = group?.length === capacity && state !== "idle" && state !== "unmapped";
    if (!isSaturatedState) {
      finishRun(true);
      return;
    }
    if (run?.state === state) {
      run.length += 1;
      return;
    }
    finishRun(true);
    run = { state, start: index, length: 1 };
  });
  // Without a later color transition, the observed run may be clipped by the
  // end of the video, so it is only a lower bound and is not extended here.
  finishRun(false);
  return extensions;
}

function phaseExtensions(extensions: Map<string, number>): FramePhaseCounts {
  const phases: FramePhaseCounts = { startup: 0, active: 0, recovery: 0, other: 0 };
  for (const [state, frames] of extensions) {
    if (state.includes("hitpause") || state === "multihit-gap") phases.other += frames;
    else if (state.includes("startup") || state.includes("start")) phases.startup += frames;
    else if (state.includes("active") || state.includes("hit")) phases.active += frames;
    else if (state.includes("recovery") || state.includes("recover")) phases.recovery += frames;
    else phases.other += frames;
  }
  return phases;
}

/** A rolling meter can hide early startup cells before recovery is complete. */
export function summarizeMoveFramebarTimeline(samples: FramebarTimelineSample[]) {
  if (samples.length === 0) return null;
  const extensions = phaseExtensions(saturatedStateExtensions(samples));
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
  if (!rolled) {
    return {
      ...best,
      player1Phases: {
        startup: best.player1Phases.startup + extensions.startup,
        active: best.player1Phases.active + extensions.active,
        recovery: best.player1Phases.recovery + extensions.recovery,
        other: best.player1Phases.other + extensions.other,
      },
    };
  }
  const structural = samples.reduce((winner, sample) => {
    const score = (candidate: FramebarTimelineSample) =>
      candidate.player1Phases.startup + candidate.player1Phases.active;
    return score(sample) >= score(winner) ? sample : winner;
  });
  return {
    ...best,
    player1: structural.player1,
    player1Groups: structural.player1Groups,
    player1Phases: {
      startup: startup + extensions.startup,
      active: active + extensions.active,
      recovery: recovery + extensions.recovery,
      other: best.player1Phases.other + extensions.other,
    },
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

/** Count distinct meter states from stitched snapshots, excluding idle cells. */
export function summarizeMoveDurationFrames(
  samples: FramebarTimelineSample[],
  { includeTrailingAirborne = false }: { includeTrailingAirborne?: boolean } = {},
) {
  const summary = summarizeMoveFramebarTimeline(samples);
  if (!summary) return null;
  const extensions = saturatedStateExtensions(samples);
  const maximumStateFrames = (state: string) =>
    Math.max(
      0,
      ...samples.map((sample) =>
        sample.player1Groups
          .filter((group) => group.state.toLowerCase() === state)
          .reduce((count, group) => count + group.length, 0),
      ),
    ) + (extensions.get(state) ?? 0);
  const flowStance = maximumStateFrames("flow-stance");
  const multihitGap = Math.max(
    0,
    ...samples.map((sample) =>
      sample.player1Groups.reduce(
        (count, group, index) =>
          count +
          (group.state.toLowerCase() === "multihit-gap" &&
          !isRecoveryWaitingGap(sample.player1Groups, index)
            ? group.length
            : 0),
        0,
      ),
    ),
  );
  // A gray patch can appear in otherwise idle cells while startup is filling
  // the bar. Hitpause belongs to this move only after an active cell has been
  // observed; counting every gray patch inflated 236A by 19 frames.
  let activeSeen = false;
  const hitpauseVisible = Math.max(
    0,
    ...samples.map((sample) => {
      let frames = 0;
      for (const group of sample.player1Groups) {
        const state = group.state.toLowerCase();
        if (state.includes("active") || (state.includes("hit") && !state.includes("hitpause"))) {
          activeSeen = true;
        } else if (state === "hitpause" && activeSeen) {
          frames += group.length;
        }
      }
      return frames;
    }),
  );
  const hitpause = hitpauseVisible > 0 ? hitpauseVisible + (extensions.get("hitpause") ?? 0) : 0;
  // A grounded move may finish in the air. Count blue cells that follow one
  // of its own phases, while airborne attacks still exclude their jump and
  // post-attack airborne cells.
  const trailingAirborne = includeTrailingAirborne
    ? Math.max(
        0,
        ...samples.map((sample) => {
          let movePhaseSeen = false;
          return sample.player1Groups.reduce((frames, group) => {
            const state = group.state.toLowerCase();
            if (/startup|active|recovery|flow-stance|multihit-gap/.test(state)) {
              movePhaseSeen = true;
            }
            return frames + (state === "airborne" && movePhaseSeen ? group.length : 0);
          }, 0);
        }),
      )
    : 0;
  const { startup, active, recovery } = summary.player1Phases;
  return {
    flowStance,
    total: startup + active + recovery + flowStance + multihitGap + hitpause + trailingAirborne,
  };
}

/** Split an AA cancel at the end of the base A's first active window. */
export function splitAaFollowupFramebarTimeline(samples: FramebarTimelineSample[]) {
  const groups = samples.at(-1)?.player1Groups;
  if (!groups) return null;
  const firstActiveIndex = groups.findIndex((group) =>
    group.state.toLowerCase().includes("active"),
  );
  if (firstActiveIndex < 0) return null;
  if (
    !groups
      .slice(0, firstActiveIndex)
      .some((group) => group.state.toLowerCase().includes("startup"))
  )
    return null;
  let firstActiveEndIndex = firstActiveIndex;
  while (groups[firstActiveEndIndex + 1]?.state.toLowerCase().includes("active"))
    firstActiveEndIndex += 1;
  const firstActiveEnd = groups[firstActiveEndIndex].start + groups[firstActiveEndIndex].length;
  const followupActiveIndex = groups.findIndex(
    (group) => group.start >= firstActiveEnd && group.state.toLowerCase().includes("active"),
  );
  if (followupActiveIndex < 0) return null;
  const followupActiveStart = groups[followupActiveIndex].start;
  const cancelStartup = groups.filter(
    (group) => group.start >= firstActiveEnd && group.start < followupActiveStart,
  );
  if (
    cancelStartup.length === 0 ||
    cancelStartup.some((group) => !/startup|recovery/i.test(group.state))
  )
    return null;

  const withGroups = (sample: FramebarTimelineSample, player1Groups: FramebarGroup[]) => ({
    ...sample,
    player1: player1Groups.map((group) => `${group.state}x${group.length}`).join(" "),
    player1Groups,
    player1Phases: summarizeFramePhases(player1Groups),
    postHitpauseActiveFrames: countPostHitpauseActiveFrames(player1Groups),
  });
  const followup = samples.flatMap((sample) => {
    const suffix = sample.player1Groups
      .filter((group) => group.start >= firstActiveEnd)
      .map((group) => ({
        ...group,
        start: group.start - firstActiveEnd,
        state:
          group.start < followupActiveStart && /startup|recovery/i.test(group.state)
            ? "startup"
            : group.state,
      }));
    if (!suffix.some((group) => group.state !== "idle" && group.state !== "Unmapped")) return [];
    return [withGroups(sample, suffix)];
  });
  const followupStartTime = followup[0]?.timestamp;
  if (followupStartTime == null) return null;
  const base = samples
    .filter((sample) => sample.timestamp <= followupStartTime)
    .map((sample) =>
      withGroups(
        sample,
        sample.player1Groups.filter((group) => group.start < firstActiveEnd),
      ),
    );
  return { base, followup, followupStartTime };
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

function isRecoveryWaitingGap(groups: FramebarGroup[], index: number) {
  return (
    groups[index]?.state.toLowerCase() === "multihit-gap" &&
    groups[index - 1]?.state.toLowerCase().includes("recovery") &&
    groups[index + 1]?.state.toLowerCase().includes("recovery") &&
    !groups.slice(index + 1).some((later) => later.state.toLowerCase().includes("active"))
  );
}

export function summarizeFramePhases(groups: FramebarGroup[]): FramePhaseCounts {
  const phases: FramePhaseCounts = { startup: 0, active: 0, recovery: 0, other: 0 };
  let startupStarted = false;
  let startupEnded = false;
  groups.forEach((group, index) => {
    const state = group.state.toLowerCase();
    const isStartup = state.includes("startup") || state.includes("start");
    if (!isStartup && startupStarted) startupEnded = true;
    // Hitpause is commonly represented as a three-frame state and its name
    // contains "hit". Check it before the active-state match so those frames
    // are excluded from active rather than counted as attack frames.
    if (isRecoveryWaitingGap(groups, index)) phases.recovery += group.length;
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

export function isSaturatedSingleStateFramebar(groups: FramebarGroup[], visibleCellCount: number) {
  const [group] = groups;
  const state = group?.state.toLowerCase();
  return (
    groups.length === 1 &&
    group?.length === Math.round(visibleCellCount) &&
    state !== "idle" &&
    state !== "unmapped"
  );
}

export function isIdleFramebar(groups: FramebarGroup[]) {
  return groups.length === 1 && groups[0]?.state === "idle";
}
