import type { InputDisplaySegmentLayout } from "./input-display-config";
import type { InputSegmentCheckReason } from "./input-display";

export type RecordingAnalysisPhases = {
  startup: number;
  active: number;
  recovery: number;
  other: number;
};

export type RecordingAnalysisDefense = {
  hitstun: number;
  blockstun: number;
  other: number;
};

export type RecordingAnalysisHitStatus = "hit" | "blocked" | "unknown";

export type RecordingAnalysisHit = {
  id: string;
  index: number;
  status: RecordingAnalysisHitStatus;
  startTime: number;
  endTime: number;
  phases: RecordingAnalysisPhases;
  opponentPhases: RecordingAnalysisDefense;
  onBlock?: number | null;
  hitboxTrackIds: string[];
};

export type RecordingAnalysisHitbox = {
  x: number;
  y: number;
  width: number;
  height: number;
  kind?: string;
  confidence?: number;
};

export type RecordingAnalysisHitboxSample = {
  frame: number;
  time: number;
  boxes: RecordingAnalysisHitbox[];
};

/** A temporal hitbox track; each sample may contain multiple simultaneous boxes. */
export type RecordingAnalysisHitboxTrack = {
  id: string;
  hitId: string | null;
  samples: RecordingAnalysisHitboxSample[];
};

export type RecordingAnalysisHitboxStatus = "unavailable" | "detected" | "not-found";

export type RecordingAnalysisMove = {
  id: string;
  notation: string | null;
  /** The notation observed directly in the input history before state resolution. */
  observedNotation?: string | null;
  /** The input event that caused this move, when one was available. */
  inputEventId?: string;
  confidence: number;
  startTime: number;
  endTime: number;
  phases: RecordingAnalysisPhases;
  opponentPhases: RecordingAnalysisDefense;
  /** Defender blockstun minus attacker recovery; positive means plus on block. */
  onBlock?: number | null;
  /** Distinct contact events; legacy analyses may not contain this field. */
  hits?: RecordingAnalysisHit[];
  /** Null means hitbox extraction was not available for this analysis. */
  hitboxTracks?: RecordingAnalysisHitboxTrack[] | null;
  hitboxStatus?: RecordingAnalysisHitboxStatus;
  /** Reserved for a move-specific interpretation rule. */
  analysisRuleId?: string | null;
};

export type RecordingAnalysisInputEvent = {
  id: string;
  time: number;
  notation: string;
  direction: string;
  buttons: string[];
  confidence: number;
  occurrence: number;
};

export type RecordingAnalysisState = "grounded" | "airborne";

export type RecordingAnalysisStateOverride = {
  inputEventId: string;
  state: RecordingAnalysisState;
  notation: string;
  occurrence: number;
  time: number;
};

export type RecordingAnalysisRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RecordingAnalysisInputSegments = {
  count: number;
  top: number;
  height: number;
  joystickRegionEnd: number;
  layout: InputDisplaySegmentLayout;
};

export type RecordingAnalysisFramebarSamples = {
  count: number;
  start: number;
  spacing: number;
  baseY: number;
  yellowY: number;
};

export type RecordingAnalysisDiagnosticMarker = {
  row: number;
  color: string;
  x: number;
  y: number;
};

export type RecordingAnalysisDiagnosticFrame = {
  time: number;
  inputSignature: string;
  inputNotation: string | null;
  inputDirection: string | null;
  inputButtons: string[];
  inputSegmentStates?: Array<"populated" | "empty">;
  inputSegmentReasons?: InputSegmentCheckReason[];
  inputSegmentBackgroundCoverage?: number[];
  inputMarkers: RecordingAnalysisDiagnosticMarker[];
  player1States: string[];
  player2States: string[];
  player1Groups: string;
  player2Groups: string;
  player1Yellow: string;
  player2Yellow: string;
  player1Phases: RecordingAnalysisPhases;
  player2Phases: RecordingAnalysisDefense;
  player1Meter: {
    score: number;
    colorScore: number;
    edgeScore: number;
    mappedScore: number;
  };
  player2Meter: {
    score: number;
    colorScore: number;
    edgeScore: number;
    mappedScore: number;
  };
  trainingState: "unknown" | "training" | "not-training";
  trainingScore: number;
  framebarChanged: boolean;
  moveEvent: "start" | "end" | null;
  activeMove: boolean;
};

export type RecordingAnalysisTiming = {
  /** The current browser adapter samples a logical timeline by seeking the video. */
  mode: "logical-60fps-browser-seeking";
  nominalFrameRate: 60;
  sourceFrameRate: number | null;
  sourceTimestampsAvailable: false;
  requestedFrameCount: number;
  maximumSeekErrorSeconds: number;
};

export type RecordingAnalysis = {
  schemaVersion: 1;
  processedAt: string;
  duration: number;
  sourceWidth: number;
  sourceHeight: number;
  sampledFrames: number;
  timing?: RecordingAnalysisTiming;
  trainingFrameRatio: number;
  moves: RecordingAnalysisMove[];
  /** Ordered input events used as stable anchors for manual state corrections. */
  inputEvents?: RecordingAnalysisInputEvent[];
  /** Manual state changes; grounded is the implicit default. */
  stateOverrides?: RecordingAnalysisStateOverride[];
  warnings: string[];
  /** The exact calibration used for this analysis, retained for debugging. */
  detectorConfig?: DetectorConfig;
  detectorConfigSource?: "saved" | "default-scaled";
  detectorRegions?: {
    input: RecordingAnalysisRegion;
    inputSegments: RecordingAnalysisInputSegments;
    player1Framebar: RecordingAnalysisRegion;
    player2Framebar: RecordingAnalysisRegion;
    framebarSamples: RecordingAnalysisFramebarSamples;
  };
  diagnostics?: RecordingAnalysisDiagnosticFrame[];
};
import type { DetectorConfig } from "./detector-config";
