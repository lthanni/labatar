export type TrainingMeterPixel = { red: number; green: number; blue: number };

export type TrainingMeterGeometryConfig = {
  gateSampleOffset: number;
  gateStartOffset: number;
  gateSpacing: number;
  gateSampleCount: number;
  gateRed: number;
  gateGreen: number;
  gateBlue: number;
  gateTolerance: number;
};

export type TrainingMeterScore = {
  score: number;
  colorScore: number;
  edgeScore: number;
  mappedScore: number;
  gateMatches: number;
  gateCount: number;
};

export type TrainingMeterState = "unknown" | "training" | "not-training";

export type TrainingMeterTracker = {
  state: TrainingMeterState;
  score: number;
  positiveStreak: number;
  negativeStreak: number;
};

export type TrainingMeterThresholds = {
  enterThreshold: number;
  exitThreshold: number;
  oneSidedEnterThreshold: number;
};

export type TrainingMeterCalibrationSample = {
  timestamp: string;
  score: number;
  player1: TrainingMeterScore | null;
  player2: TrainingMeterScore | null;
};

export type TrainingMeterCalibration = {
  positive: TrainingMeterCalibrationSample[];
  negative: TrainingMeterCalibrationSample[];
  fitted: (TrainingMeterThresholds & { accuracy: number; trainedAt: string }) | null;
};

export const trainingMeterCalibrationKey = "avatar-overlay-training-meter-calibration";
export const trainingMeterCalibrationModeKey = "avatar-overlay-training-meter-calibration-mode";
export type TrainingMeterCalibrationMode = "positive" | "negative" | "idle";

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function luma(pixel: TrainingMeterPixel) {
  return pixel.red * 0.299 + pixel.green * 0.587 + pixel.blue * 0.114;
}

function colorSimilarity(pixel: TrainingMeterPixel, target: TrainingMeterPixel, tolerance: number) {
  const distance = Math.hypot(
    pixel.red - target.red,
    pixel.green - target.green,
    pixel.blue - target.blue,
  );
  // A transparent black/white UI line can be substantially lighter than its
  // configured sample. Keep the comparison soft, while still rejecting a
  // normal background color when it is far from the configured line.
  const scale = Math.max(24, tolerance * 5, 255 * 0.22);
  return clamp(1 - distance / scale);
}

function scoreHorizontalEdges({
  sampleWidth,
  sampleHeight,
  gateY,
  gateStart,
  gateSpacing,
  gateCount,
  readPixel,
}: {
  sampleWidth: number;
  sampleHeight: number;
  gateY: number;
  gateStart: number;
  gateSpacing: number;
  gateCount: number;
  readPixel: (x: number, y: number) => TrainingMeterPixel;
}) {
  if (sampleHeight < 5 || sampleWidth < 2 || gateCount < 2) return 0;
  const firstY = Math.max(2, gateY - 5);
  const lastY = Math.min(sampleHeight - 3, gateY + 5);
  let best = 0;
  for (let y = firstY; y <= lastY; y += 1) {
    let totalContrast = 0;
    let strongEdges = 0;
    let samples = 0;
    for (let index = 0; index < gateCount; index += 1) {
      const x = Math.min(sampleWidth - 1, gateStart + index * gateSpacing);
      const center = luma(readPixel(x, y));
      const above = luma(readPixel(x, y - 2));
      const below = luma(readPixel(x, y + 2));
      const contrast = (Math.abs(center - above) + Math.abs(center - below)) / 2;
      totalContrast += clamp(contrast / 64);
      if (contrast >= 10) strongEdges += 1;
      samples += 1;
    }
    if (samples === 0) continue;
    const averageContrast = totalContrast / samples;
    const edgeCoverage = strongEdges / samples;
    best = Math.max(best, averageContrast * 0.65 + edgeCoverage * 0.35);
  }
  return clamp(best);
}

export function scoreTrainingMeterPresence({
  config,
  sampleWidth,
  sampleHeight,
  readPixel,
  mappedScore = 0,
}: {
  config: TrainingMeterGeometryConfig;
  sampleWidth: number;
  sampleHeight: number;
  readPixel: (x: number, y: number) => TrainingMeterPixel;
  mappedScore?: number;
}): TrainingMeterScore {
  const gateY = Math.min(sampleHeight - 1, Math.max(0, Math.round(config.gateSampleOffset)));
  const gateStart = Math.max(0, Math.round(config.gateStartOffset));
  const gateSpacing = Math.max(1, Math.round(config.gateSpacing));
  const gateCount = Math.min(1000, Math.max(1, Math.round(config.gateSampleCount)));
  const target = {
    red: config.gateRed,
    green: config.gateGreen,
    blue: config.gateBlue,
  };
  let colorTotal = 0;
  let gateMatches = 0;
  for (let index = 0; index < gateCount; index += 1) {
    const x = Math.min(sampleWidth - 1, gateStart + index * gateSpacing);
    const pixel = readPixel(x, gateY);
    colorTotal += colorSimilarity(pixel, target, config.gateTolerance);
    if (
      Math.abs(pixel.red - target.red) <= config.gateTolerance &&
      Math.abs(pixel.green - target.green) <= config.gateTolerance &&
      Math.abs(pixel.blue - target.blue) <= config.gateTolerance
    ) {
      gateMatches += 1;
    }
  }
  const colorScore = colorTotal / gateCount;
  const edgeScore = scoreHorizontalEdges({
    sampleWidth,
    sampleHeight,
    gateY,
    gateStart,
    gateSpacing,
    gateCount,
    readPixel,
  });
  const normalizedMappedScore = clamp(mappedScore);
  return {
    // Geometry carries most of the weight because it survives translucent
    // compositing. Color and known frame-state mappings are supporting signals.
    score: colorScore * 0.5 + edgeScore * 0.35 + normalizedMappedScore * 0.15,
    colorScore,
    edgeScore,
    mappedScore: normalizedMappedScore,
    gateMatches,
    gateCount,
  };
}

export function createTrainingMeterTracker(): TrainingMeterTracker {
  return { state: "unknown", score: 0, positiveStreak: 0, negativeStreak: 0 };
}

export function readTrainingMeterCalibration(): TrainingMeterCalibration {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(trainingMeterCalibrationKey) ?? "null",
    ) as Partial<TrainingMeterCalibration> | null;
    return {
      positive: Array.isArray(parsed?.positive) ? parsed.positive : [],
      negative: Array.isArray(parsed?.negative) ? parsed.negative : [],
      fitted: parsed?.fitted ?? null,
    };
  } catch {
    return { positive: [], negative: [], fitted: null };
  }
}

export function writeTrainingMeterCalibration(calibration: TrainingMeterCalibration) {
  localStorage.setItem(
    trainingMeterCalibrationKey,
    JSON.stringify({
      ...calibration,
      positive: calibration.positive.slice(-300),
      negative: calibration.negative.slice(-300),
    }),
  );
}

function scoreFromSides(scores: {
  player1: TrainingMeterScore | null;
  player2: TrainingMeterScore | null;
}) {
  const available = [scores.player1, scores.player2].filter(
    (score): score is TrainingMeterScore => score !== null,
  );
  if (available.length === 0) return 0;
  const average = available.reduce((total, score) => total + score.score, 0) / available.length;
  return scores.player1 && scores.player2 ? average : average * 0.85;
}

export function appendTrainingMeterSample(
  mode: Exclude<TrainingMeterCalibrationMode, "idle">,
  scores: { player1: TrainingMeterScore | null; player2: TrainingMeterScore | null },
) {
  const calibration = readTrainingMeterCalibration();
  const sample: TrainingMeterCalibrationSample = {
    timestamp: new Date().toISOString(),
    score: scoreFromSides(scores),
    player1: scores.player1,
    player2: scores.player2,
  };
  calibration[mode].push(sample);
  writeTrainingMeterCalibration(calibration);
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * fraction)),
  );
  return sorted[index] ?? 0;
}

export function fitTrainingMeterCalibration(calibration: TrainingMeterCalibration) {
  const positive = calibration.positive.map((sample) => sample.score);
  const negative = calibration.negative.map((sample) => sample.score);
  if (positive.length < 8 || negative.length < 8) return null;
  const candidates = [...new Set([...positive, ...negative])].sort((left, right) => left - right);
  let bestThreshold = 0.5;
  let bestAccuracy = -1;
  candidates.forEach((threshold) => {
    const correct =
      positive.filter((score) => score >= threshold).length +
      negative.filter((score) => score < threshold).length;
    const accuracy = correct / (positive.length + negative.length);
    if (accuracy > bestAccuracy) {
      bestAccuracy = accuracy;
      bestThreshold = threshold;
    }
  });
  const positiveFloor = percentile(positive, 0.1);
  const negativeCeiling = percentile(negative, 0.9);
  const enterThreshold =
    negativeCeiling < positiveFloor ? (negativeCeiling + positiveFloor) / 2 : bestThreshold;
  const fitted = {
    enterThreshold,
    exitThreshold: Math.max(0, enterThreshold - 0.08),
    oneSidedEnterThreshold: Math.min(1, enterThreshold + 0.18),
    accuracy: bestAccuracy,
    trainedAt: new Date().toISOString(),
  };
  calibration.fitted = fitted;
  return fitted;
}

export function updateTrainingMeterTracker(
  tracker: TrainingMeterTracker,
  scores: { player1: TrainingMeterScore | null; player2: TrainingMeterScore | null },
  thresholds: Partial<TrainingMeterThresholds> = {},
) {
  const available = [scores.player1, scores.player2].filter(
    (score): score is TrainingMeterScore => score !== null,
  );
  if (available.length === 0) return tracker;
  const average = available.reduce((total, score) => total + score.score, 0) / available.length;
  const bothSides = scores.player1 !== null && scores.player2 !== null;
  const combinedScore = bothSides ? average : average * 0.85;
  tracker.score = combinedScore;

  // Requiring both bars when both are available prevents a single unrelated
  // dark strip from declaring training mode. The one-sided path is useful
  // during capture startup, but is deliberately discounted.
  const enterThreshold = thresholds.enterThreshold ?? 0.5;
  const exitThreshold = thresholds.exitThreshold ?? enterThreshold;
  const oneSidedEnterThreshold = thresholds.oneSidedEnterThreshold ?? 0.68;
  const positive = bothSides
    ? combinedScore >= (tracker.state === "training" ? exitThreshold : enterThreshold)
    : combinedScore >= oneSidedEnterThreshold;
  if (positive) {
    tracker.positiveStreak += 1;
    tracker.negativeStreak = 0;
    if (tracker.positiveStreak >= 8) tracker.state = "training";
  } else {
    tracker.negativeStreak += 1;
    tracker.positiveStreak = 0;
    if (tracker.negativeStreak >= 20) tracker.state = "not-training";
  }
  return tracker;
}

export function formatTrainingMeterStatus(
  tracker: TrainingMeterTracker,
  scores: { player1: TrainingMeterScore | null; player2: TrainingMeterScore | null },
) {
  const format = (score: TrainingMeterScore | null) =>
    score
      ? `${score.score.toFixed(2)} c${score.colorScore.toFixed(2)} e${score.edgeScore.toFixed(2)}`
      : "n/a";
  return `training meter: ${tracker.state} score=${tracker.score.toFixed(2)} p1=${format(scores.player1)} p2=${format(scores.player2)} +${tracker.positiveStreak}/-${tracker.negativeStreak}`;
}
