import {
  findClosestFramebarColor,
  framebarColorMap,
  type FramebarColorMatch,
} from "./framebar-color-map";
import {
  detectInputDisplay,
  formatInputDisplayObservation,
  readDigitTemplates,
  resolveNewestInput,
  type InputDisplayObservation,
  type ResolvedInput,
} from "./input-display";
import {
  inputDisplayGeometryFromConfig,
  inputDisplaySegmentLayoutFromConfig,
} from "./input-display-config";
import {
  groupFramebarStates,
  isIdleFramebar,
  calculateOnBlock,
  countPostHitpauseActiveFrames,
  resolveFramebarSampleSpacing,
  scanFramebar,
  stabilizeFramebarStates,
  summarizeDefensivePhases,
  summarizeFramePhases,
  type FramebarPixel,
  type FramebarTimelineSample,
} from "./framebar-detector";
import {
  hasStoredDetectorConfig,
  readDetectorConfig,
  readRuntimeFramebarColorMap,
  type DetectorConfig,
} from "./detector-config";
import {
  createTrainingMeterTracker,
  readTrainingMeterCalibration,
  updateTrainingMeterTracker,
  type TrainingMeterTracker,
} from "./training-meter";
import type {
  RecordingAnalysis,
  RecordingAnalysisDefense,
  RecordingAnalysisHit,
  RecordingAnalysisInputEvent,
  RecordingAnalysisMove,
  RecordingAnalysisPhases,
} from "./recording-analysis-types";
import {
  findInputForFramebarStart,
  INPUT_ASSOCIATION_LOOKAHEAD_SECONDS,
  type RecordingInputCandidate,
} from "./recording-input-association";

export type RecordingProcessorProgress = {
  completed: number;
  total: number;
  time: number;
  duration: number;
};

type InputPoint = RecordingInputCandidate;

type ActiveMove = {
  startTime: number;
  framebarStartTime: number;
  input: InputPoint | null;
};

function waitForVideo(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    const loaded = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      const code = video.error?.code ? ` (media error ${video.error.code})` : "";
      reject(new Error(`The recording could not be decoded for analysis.${code}`));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", loaded);
      video.removeEventListener("error", failed);
    };
    video.addEventListener("loadedmetadata", loaded, { once: true });
    video.addEventListener("error", failed, { once: true });
    video.load();
  });
}

function seekVideo(video: HTMLVideoElement, time: number) {
  return new Promise<number>((resolve) => {
    const target = Math.max(0, Math.min(video.duration, time));
    if (Math.abs(video.currentTime - target) < 0.0005) {
      resolve(video.currentTime);
      return;
    }
    let timeout = 0;
    const finish = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", finish);
      resolve(video.currentTime);
    };
    video.addEventListener("seeked", finish, { once: true });
    video.currentTime = target;
    timeout = window.setTimeout(finish, 2000);
  });
}

function makeReadPixel(pixels: Uint8ClampedArray, width: number, height: number) {
  return (x: number, y: number): FramebarPixel => {
    const safeX = Math.max(0, Math.min(width - 1, Math.round(x)));
    const safeY = Math.max(0, Math.min(height - 1, Math.round(y)));
    const index = (safeY * width + safeX) * 4;
    return {
      red: pixels[index] ?? 0,
      green: pixels[index + 1] ?? 0,
      blue: pixels[index + 2] ?? 0,
    };
  };
}

function drawRegion(
  video: HTMLVideoElement,
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  xPercent: number,
  yPercent: number,
  widthPercent: number,
  heightPercent: number,
) {
  const x = Math.max(0, video.videoWidth * (xPercent / 100));
  const y = Math.max(0, video.videoHeight * (yPercent / 100));
  const width = Math.max(
    1,
    Math.min(video.videoWidth - x, video.videoWidth * (widthPercent / 100)),
  );
  const height = Math.max(
    1,
    Math.min(video.videoHeight - y, video.videoHeight * (heightPercent / 100)),
  );
  const canvasWidth = Math.max(1, Math.round(width));
  const canvasHeight = Math.max(1, Math.round(height));
  if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
  if (canvas.height !== canvasHeight) canvas.height = canvasHeight;
  context.drawImage(video, x, y, width, height, 0, 0, canvasWidth, canvasHeight);
  return { width: canvasWidth, height: canvasHeight };
}

// The overlay's pixel offsets were calibrated against the 2560x1440 OBS
// output. Recordings can be resized by OBS, while the ROI positions remain
// percentage based. Scale only the pixel offsets used inside those ROIs.
function scaleDetectorConfig(config: DetectorConfig, videoWidth: number, videoHeight: number) {
  const widthScale = videoWidth / 2560;
  const heightScale = videoHeight / 1440;
  return {
    ...config,
    baseSampleOffset: config.baseSampleOffset * heightScale,
    yellowSampleOffset: config.yellowSampleOffset * heightScale,
    sampleStartOffset: config.sampleStartOffset * widthScale,
    sampleSpacing: config.sampleSpacing * widthScale,
    gateSampleOffset: config.gateSampleOffset * heightScale,
    gateStartOffset: config.gateStartOffset * widthScale,
    gateSpacing: config.gateSpacing * widthScale,
  };
}

function fallbackFramebarColor(red: number, green: number, blue: number): FramebarColorMatch {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const saturation = maximum - minimum;
  const idle = saturation < 24 || maximum < 58;
  return {
    name: idle ? "idle" : "active",
    red,
    green,
    blue,
    distance: 0,
    confidence: idle ? 0.35 : 0.3,
  };
}

function mappedColorGetter() {
  const mappings = [...framebarColorMap, ...readRuntimeFramebarColorMap()];
  return (red: number, green: number, blue: number): FramebarColorMatch | null =>
    findClosestFramebarColor(red, green, blue, mappings);
}

function bestFramebar(timeline: FramebarTimelineSample[], startTime: number, endTime: number) {
  return timeline
    .filter((sample) => sample.timestamp >= startTime && sample.timestamp <= endTime)
    .reduce<FramebarTimelineSample | null>((best, sample) => {
      if (!best) return sample;
      const bestScore =
        best.player1Phases.startup + best.player1Phases.active + best.player1Phases.recovery;
      const sampleScore =
        sample.player1Phases.startup + sample.player1Phases.active + sample.player1Phases.recovery;
      return sampleScore >= bestScore ? sample : best;
    }, null);
}

function createMove(
  active: ActiveMove,
  endTime: number,
  timeline: FramebarTimelineSample[],
  index: number,
): RecordingAnalysisMove {
  const best = bestFramebar(timeline, active.framebarStartTime, endTime);
  const phases: RecordingAnalysisPhases = best?.player1Phases ?? {
    startup: 0,
    active: 0,
    recovery: 0,
    other: 0,
  };
  const opponentPhases: RecordingAnalysisDefense = best?.player2Phases ?? {
    hitstun: 0,
    blockstun: 0,
    other: 0,
  };
  const onBlock = calculateOnBlock(phases, opponentPhases, best?.postHitpauseActiveFrames ?? 0);
  const status: RecordingAnalysisHit["status"] =
    opponentPhases.blockstun > 0 ? "blocked" : opponentPhases.hitstun > 0 ? "hit" : "unknown";
  const moveId = `processed-move-${index + 1}`;
  const hit: RecordingAnalysisHit = {
    id: `${moveId}-hit-1`,
    index: 1,
    status,
    startTime: active.startTime,
    endTime,
    phases,
    opponentPhases,
    onBlock,
    hitboxTrackIds: [],
  };
  return {
    id: moveId,
    notation: active.input?.input.notation ?? null,
    observedNotation: active.input?.input.notation ?? null,
    inputEventId: active.input?.event?.id,
    confidence: active.input ? active.input.input.confidence : 0,
    startTime: active.startTime,
    endTime,
    phases,
    opponentPhases,
    onBlock,
    hits: [hit],
    hitboxTracks: null,
    hitboxStatus: "unavailable",
    analysisRuleId: null,
  };
}

export async function processRecording(
  url: string,
  onProgress?: (progress: RecordingProcessorProgress) => void,
  fallbackVideo?: HTMLVideoElement,
): Promise<RecordingAnalysis> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  let usingFallbackVideo = false;
  let fallbackState: { time: number; muted: boolean; wasPlaying: boolean } | null = null;
  try {
    await waitForVideo(video);
  } catch (error) {
    if (
      fallbackVideo &&
      fallbackVideo.readyState >= HTMLMediaElement.HAVE_METADATA &&
      (fallbackVideo.currentSrc === url || fallbackVideo.src === url)
    ) {
      usingFallbackVideo = true;
      video.removeAttribute("src");
      video.load();
      // The visible player has already decoded the recording. Reusing it is a
      // fallback for containers/codecs that reject a second hidden decoder.
      fallbackState = {
        time: fallbackVideo.currentTime,
        muted: fallbackVideo.muted,
        wasPlaying: !fallbackVideo.paused,
      };
      fallbackVideo.pause();
    } else {
      throw error;
    }
  }
  const analysisVideo = usingFallbackVideo ? fallbackVideo : video;
  if (usingFallbackVideo && !analysisVideo) throw new Error("No video is available for analysis.");
  const processingVideo = analysisVideo ?? video;
  if (!Number.isFinite(processingVideo.duration) || processingVideo.duration <= 0) {
    throw new Error("The recording has no readable duration.");
  }

  const savedConfig = readDetectorConfig();
  const configSource = hasStoredDetectorConfig() ? "saved" : "default-scaled";
  const config =
    configSource === "saved"
      ? savedConfig
      : scaleDetectorConfig(savedConfig, processingVideo.videoWidth, processingVideo.videoHeight);
  const inputCanvas = document.createElement("canvas");
  const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
  const player1Canvas = document.createElement("canvas");
  const player1Context = player1Canvas.getContext("2d", { willReadFrequently: true });
  const player2Canvas = document.createElement("canvas");
  const player2Context = player2Canvas.getContext("2d", { willReadFrequently: true });
  if (!inputContext || !player1Context || !player2Context) {
    throw new Error("The recording could not be analyzed because canvas is unavailable.");
  }

  const duration = processingVideo.duration;
  const frameRate = 60;
  const total = Math.max(1, Math.ceil(duration * frameRate));
  const inputConfig = inputDisplayGeometryFromConfig(config, readDigitTemplates());
  const mappedColor = mappedColorGetter();
  let usedFallbackFramebarColor = false;
  const getMappedColor = (red: number, green: number, blue: number): FramebarColorMatch => {
    const mapped = mappedColor(red, green, blue);
    if (mapped) return mapped;
    usedFallbackFramebarColor = true;
    return fallbackFramebarColor(red, green, blue);
  };
  const meterTracker: TrainingMeterTracker = createTrainingMeterTracker();
  const calibration = readTrainingMeterCalibration();
  const trainingThresholds = calibration.fitted ?? {
    enterThreshold: 0.4,
    exitThreshold: 0.32,
    oneSidedEnterThreshold: 0.55,
  };
  const p1StableStates: string[] = [];
  const p1CandidateStates: string[] = [];
  const p1CandidateCounts: number[] = [];
  const p2StableStates: string[] = [];
  const p2CandidateStates: string[] = [];
  const p2CandidateCounts: number[] = [];
  const timeline: FramebarTimelineSample[] = [];
  const diagnostics: NonNullable<RecordingAnalysis["diagnostics"]> = [];
  const inputTimeline: InputPoint[] = [];
  const inputEvents: RecordingAnalysisInputEvent[] = [];
  const inputOccurrences = new Map<string, number>();
  const moves: RecordingAnalysisMove[] = [];
  const warnings: string[] = [];
  let stableInputSignature = "";
  let pendingInputSignature = "";
  let pendingInputCount = 0;
  let stableInput: ResolvedInput | null = null;
  let pendingResolvedSignature = "";
  let pendingResolvedCount = 0;
  let lastStableInputNotation: string | null = null;
  let hasInputBaseline = false;
  let previousFramebarSignature = "";
  let lastFramebarChangeTime = 0;
  let activeMove: ActiveMove | null = null;
  let pendingMoveStart: { framebarStartTime: number } | null = null;
  let trainingFrames = 0;
  let maximumSeekErrorSeconds = 0;
  const diagnosticStep = Math.max(1, Math.ceil(total / 1800));

  const finishMove = (endTime: number) => {
    if (!activeMove) return;
    moves.push(createMove(activeMove, endTime, timeline, moves.length));
    activeMove = null;
  };

  const associateInput = (candidate: InputPoint) => {
    if (candidate.event) return candidate;
    const occurrence = (inputOccurrences.get(candidate.input.notation) ?? 0) + 1;
    inputOccurrences.set(candidate.input.notation, occurrence);
    const event: RecordingAnalysisInputEvent = {
      id: `input-event-${inputEvents.length + 1}`,
      time: candidate.time,
      notation: candidate.input.notation,
      direction: candidate.input.direction,
      buttons: [...candidate.input.buttons],
      confidence: candidate.input.confidence,
      occurrence,
    };
    inputEvents.push(event);
    const associated = { ...candidate, event };
    const candidateIndex = inputTimeline.indexOf(candidate);
    if (candidateIndex >= 0) inputTimeline[candidateIndex] = associated;
    return associated;
  };

  for (let frame = 0; frame < total; frame += 1) {
    const time = Math.min(duration, frame / frameRate);
    const actualTime = await seekVideo(processingVideo, time);
    maximumSeekErrorSeconds = Math.max(maximumSeekErrorSeconds, Math.abs(actualTime - time));

    const inputSize = drawRegion(
      processingVideo,
      inputContext,
      inputCanvas,
      config.inputSourceX,
      config.inputSourceY,
      config.inputSourceWidth,
      config.inputSourceHeight,
    );
    const inputObservation: InputDisplayObservation = detectInputDisplay(
      {
        data: inputContext.getImageData(0, 0, inputSize.width, inputSize.height).data,
        width: inputSize.width,
        height: inputSize.height,
      },
      inputConfig,
    );
    const inputSignature = formatInputDisplayObservation(inputObservation);
    if (inputSignature === pendingInputSignature) pendingInputCount += 1;
    else {
      pendingInputSignature = inputSignature;
      pendingInputCount = 1;
    }
    if (stableInputSignature === "" || pendingInputCount >= 3) {
      stableInputSignature = inputSignature;
      // Only the newest history row can introduce a new input. Looking back
      // through older rows resurrects stale buttons after the game has already
      // appended a newer move, which was the source of the 5A -> 2A error.
      stableInput = inputObservation.rows.length ? resolveNewestInput(inputObservation) : null;
    }
    const resolvedSignature = stableInput?.notation ?? "none";
    if (resolvedSignature === pendingResolvedSignature) pendingResolvedCount += 1;
    else {
      pendingResolvedSignature = resolvedSignature;
      pendingResolvedCount = 1;
    }
    if (pendingResolvedCount >= 2) {
      const resolvedInput =
        stableInput && (stableInput.buttons.length > 0 || stableInput.direction !== "5")
          ? stableInput
          : null;
      if (!hasInputBaseline) {
        // The first visible row may predate the clip. Establish a baseline so
        // a button already on screen is not mistaken for an attack in this
        // recording. Keep it as a deferred candidate, though: single-move
        // clips can begin immediately before their first framebar transition.
        hasInputBaseline = true;
        if (resolvedInput) inputTimeline.push({ time, input: resolvedInput, preexisting: true });
      } else if (resolvedInput && resolvedInput.notation !== lastStableInputNotation) {
        // This is only a candidate. It becomes a public input event once a
        // framebar transition associates it with an actual move episode.
        inputTimeline.push({ time, input: resolvedInput });
      }
      lastStableInputNotation = resolvedInput?.notation ?? null;
    }

    const p1Size = drawRegion(
      processingVideo,
      player1Context,
      player1Canvas,
      config.player1SourceX,
      config.player1SourceY,
      config.framebarSourceWidth,
      config.framebarSourceHeight,
    );
    const p2Size = drawRegion(
      processingVideo,
      player2Context,
      player2Canvas,
      config.sourceX,
      config.sourceY,
      config.framebarSourceWidth,
      config.framebarSourceHeight,
    );
    const p1Pixels = player1Context.getImageData(0, 0, p1Size.width, p1Size.height).data;
    const p2Pixels = player2Context.getImageData(0, 0, p2Size.width, p2Size.height).data;
    const p1Reading = scanFramebar({
      config,
      sampleWidth: p1Size.width,
      sampleHeight: p1Size.height,
      readPixel: makeReadPixel(p1Pixels, p1Size.width, p1Size.height),
      getMappedColor,
    });
    const p2Reading = scanFramebar({
      config,
      sampleWidth: p2Size.width,
      sampleHeight: p2Size.height,
      readPixel: makeReadPixel(p2Pixels, p2Size.width, p2Size.height),
      getMappedColor,
    });
    const p1States = stabilizeFramebarStates(
      p1Reading.rawStates,
      p1StableStates,
      p1CandidateStates,
      p1CandidateCounts,
    );
    const p2States = stabilizeFramebarStates(
      p2Reading.rawStates,
      p2StableStates,
      p2CandidateStates,
      p2CandidateCounts,
    );
    const p1Groups = groupFramebarStates(p1States);
    const p2Groups = groupFramebarStates(p2States);
    updateTrainingMeterTracker(
      meterTracker,
      { player1: p1Reading.meterPresence, player2: p2Reading.meterPresence },
      trainingThresholds,
    );
    if (meterTracker.state === "training") trainingFrames += 1;
    const signature = p1Groups.map((group) => `${group.state}:${group.length}`).join("|");
    const changed = previousFramebarSignature !== "" && signature !== previousFramebarSignature;
    if (previousFramebarSignature === "" || changed) {
      previousFramebarSignature = signature;
      lastFramebarChangeTime = time;
    }
    timeline.push({
      timestamp: time,
      player1: p1Groups.map((group) => `${group.state}x${group.length}`).join(" "),
      player2: p2Groups.map((group) => `${group.state}x${group.length}`).join(" "),
      player1Phases: summarizeFramePhases(p1Groups),
      postHitpauseActiveFrames: countPostHitpauseActiveFrames(p1Groups),
      player2Phases: summarizeDefensivePhases(p2Groups),
    });
    let moveEvent: "start" | "end" | null = null;
    const framebarIdle = isIdleFramebar(p1Groups);
    if (changed && !framebarIdle && !activeMove && !pendingMoveStart) {
      // Wait briefly for the input history to append its newest row. This
      // avoids committing an attack from a stale row and also lets a short
      // initial framebar settling artifact disappear without creating a move.
      pendingMoveStart = { framebarStartTime: time };
    }
    if (pendingMoveStart && !activeMove) {
      const candidate = findInputForFramebarStart(
        inputTimeline,
        pendingMoveStart.framebarStartTime,
      );
      const associationWindowExpired =
        time - pendingMoveStart.framebarStartTime > INPUT_ASSOCIATION_LOOKAHEAD_SECONDS;
      if (candidate && (!candidate.preexisting || associationWindowExpired)) {
        const input = associateInput(candidate);
        activeMove = {
          startTime: input.time,
          framebarStartTime: pendingMoveStart.framebarStartTime,
          input,
        };
        pendingMoveStart = null;
        moveEvent = "start";
      } else if (framebarIdle) {
        // The framebar returned to idle before a nearby input appeared. Treat
        // this as a transient transition rather than an unresolved move.
        pendingMoveStart = null;
      } else if (associationWindowExpired) {
        // A real framebar episode with no usable input is still preserved as
        // an unresolved move after the association window expires.
        activeMove = {
          startTime: pendingMoveStart.framebarStartTime,
          framebarStartTime: pendingMoveStart.framebarStartTime,
          input: null,
        };
        pendingMoveStart = null;
        moveEvent = "start";
      }
    }
    if (activeMove && !changed && time - lastFramebarChangeTime >= 0.15) {
      finishMove(time);
      moveEvent = "end";
    }
    if (frame % diagnosticStep === 0 || moveEvent) {
      diagnostics.push({
        time,
        inputSignature,
        inputNotation: stableInput?.notation ?? null,
        inputDirection: stableInput?.direction ?? null,
        inputButtons: stableInput?.buttons ?? [],
        inputSegmentStates: inputObservation.rows.map((row) =>
          row.segmentCheck?.populated ? "populated" : "empty",
        ),
        inputSegmentReasons: inputObservation.rows.map(
          (row) => row.segmentCheck?.reason ?? "missing-joystick-circle",
        ),
        inputSegmentBackgroundCoverage: inputObservation.rows.map(
          (row) => row.backgroundCheck?.coverage ?? 0,
        ),
        inputMarkers: inputObservation.rows.flatMap((row, rowIndex) =>
          row.markers.map((marker) => ({
            row: rowIndex,
            color: marker.color,
            x: marker.x / Math.max(1, inputSize.width),
            y: marker.y / Math.max(1, inputSize.height),
          })),
        ),
        player1States: p1States,
        player2States: p2States,
        player1Groups: p1Groups.map((group) => `${group.state}x${group.length}`).join(" "),
        player2Groups: p2Groups.map((group) => `${group.state}x${group.length}`).join(" "),
        player1Yellow: p1Reading.yellowStates.map((yellow) => (yellow ? "Y" : ".")).join(""),
        player2Yellow: p2Reading.yellowStates.map((yellow) => (yellow ? "Y" : ".")).join(""),
        player1Phases: summarizeFramePhases(p1Groups),
        player2Phases: summarizeDefensivePhases(p2Groups),
        player1Meter: p1Reading.meterPresence,
        player2Meter: p2Reading.meterPresence,
        trainingState: meterTracker.state,
        trainingScore: meterTracker.score,
        framebarChanged: changed,
        moveEvent,
        activeMove: Boolean(activeMove),
      });
    }
    if (frame % 5 === 0) {
      onProgress?.({ completed: frame + 1, total, time, duration });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }
  finishMove(duration);
  const sourceWidth = processingVideo.videoWidth;
  const sourceHeight = processingVideo.videoHeight;
  if (!usingFallbackVideo) {
    processingVideo.removeAttribute("src");
    processingVideo.load();
  } else if (fallbackState && fallbackVideo) {
    fallbackVideo.currentTime = fallbackState.time;
    fallbackVideo.muted = fallbackState.muted;
    if (fallbackState.wasPlaying) void fallbackVideo.play();
  }
  const trainingFrameRatio = trainingFrames / total;
  if (trainingFrameRatio < 0.2)
    warnings.push("Training mode could not be confirmed for most frames.");
  if (moves.length === 0) warnings.push("No move episodes were detected.");
  if (usedFallbackFramebarColor) {
    warnings.push("Framebar color mappings were unavailable; phase labels are approximate.");
  }
  return {
    schemaVersion: 1,
    processedAt: new Date().toISOString(),
    duration,
    sourceWidth,
    sourceHeight,
    sampledFrames: total,
    timing: {
      mode: "logical-60fps-browser-seeking",
      nominalFrameRate: 60,
      sourceFrameRate: null,
      sourceTimestampsAvailable: false,
      requestedFrameCount: total,
      maximumSeekErrorSeconds,
    },
    trainingFrameRatio,
    moves,
    inputEvents,
    warnings,
    detectorConfig: config,
    detectorConfigSource: configSource,
    detectorRegions: {
      input: {
        x: config.inputSourceX,
        y: config.inputSourceY,
        width: config.inputSourceWidth,
        height: config.inputSourceHeight,
      },
      inputSegments: {
        count: config.inputSegmentCount,
        top: config.inputSegmentTop,
        height: config.inputSegmentHeight,
        joystickRegionEnd: config.inputJoystickRegionEndX,
        layout: inputDisplaySegmentLayoutFromConfig(config),
      },
      player1Framebar: {
        x: config.player1SourceX,
        y: config.player1SourceY,
        width: config.framebarSourceWidth,
        height: config.framebarSourceHeight,
      },
      framebarSamples: {
        count: config.sampleCount,
        start:
          (config.sampleStartOffset /
            Math.max(1, (processingVideo.videoWidth * config.framebarSourceWidth) / 100)) *
          100,
        spacing:
          (resolveFramebarSampleSpacing(
            (processingVideo.videoWidth * config.framebarSourceWidth) / 100,
            config.sampleStartOffset,
            config.sampleCount,
            config.sampleSpacing,
          ) /
            Math.max(1, (processingVideo.videoWidth * config.framebarSourceWidth) / 100)) *
          100,
        baseY:
          (config.baseSampleOffset /
            Math.max(1, (processingVideo.videoHeight * config.framebarSourceHeight) / 100)) *
          100,
        yellowY:
          (config.yellowSampleOffset /
            Math.max(1, (processingVideo.videoHeight * config.framebarSourceHeight) / 100)) *
          100,
      },
      player2Framebar: {
        x: config.sourceX,
        y: config.sourceY,
        width: config.framebarSourceWidth,
        height: config.framebarSourceHeight,
      },
    },
    diagnostics,
  };
}
