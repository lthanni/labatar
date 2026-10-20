import type { RecordingAnalysis } from "./recording-analysis-types";
import { processMoveTakeFramebarSequence } from "./recording-processor";
import type { RecordedVideo } from "./recording-types";

function analysisFromSequence(recording: RecordedVideo): RecordingAnalysis {
  const sequence = recording.framebarSequence;
  const take = recording.moveTake;
  if (!sequence || !take)
    throw new Error("Capture a framebar sequence before determining move data.");
  if (sequence.status !== "approved")
    throw new Error("Approve the framebar sequence before processing it.");
  const moves = processMoveTakeFramebarSequence(sequence, take.moveLabel);
  return {
    schemaVersion: 1,
    processingMode: "move-take",
    framebarSequenceId: sequence.id,
    interpretationVersion: "move-take-framebar-v2",
    processedAt: new Date().toISOString(),
    duration: sequence.duration,
    sourceWidth: sequence.sourceWidth,
    sourceHeight: sequence.sourceHeight,
    sampledFrames: sequence.sampledFrames,
    timing: sequence.timing,
    trainingFrameRatio: sequence.trainingFrameRatio,
    moves,
    inputEvents: [],
    warnings: [...sequence.warnings],
    processingSnapshot: sequence.processingSnapshot,
    detectorConfig: sequence.detectorConfig,
    detectorConfigSource: sequence.detectorConfig ? "persistent" : undefined,
  };
}

/** Determine move data from the saved approved sequence; this never opens the video. */
export async function processMoveTake(recording: RecordedVideo): Promise<RecordedVideo> {
  const recordingsApi = window.electronAPI?.recordings;
  if (!recordingsApi) throw new Error("Recording processing requires the desktop app.");
  return await recordingsApi.saveAnalysis({
    recordingId: recording.id,
    analysis: analysisFromSequence(recording),
  });
}
