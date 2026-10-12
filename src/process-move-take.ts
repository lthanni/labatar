import { processRecording, type RecordingFrameProvider } from "./recording-processor";
import type { RecordedVideo } from "./recording-types";

export async function processMoveTake(recording: RecordedVideo): Promise<RecordedVideo> {
  const recordingsApi = window.electronAPI?.recordings;
  if (!recordingsApi) throw new Error("Recording processing requires the desktop app.");
  const take = recording.moveTake;
  if (!take) throw new Error("This recording is not a move take.");
  if (
    take.captureMethod === "automated" &&
    take.captureReviewStatus !== "approved-for-processing"
  ) {
    throw new Error("Review and approve this automated video before processing it.");
  }
  const reader = await recordingsApi.openFrameReader({ recordingId: recording.id });
  try {
    const provider: RecordingFrameProvider = {
      frameRate: reader.frameRate,
      readFrame: async (frameIndex) => {
        let encodedFrame;
        try {
          encodedFrame = await recordingsApi.readFrame({ sessionId: reader.sessionId, frameIndex });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("past the end of the recording")) return null;
          throw error;
        }
        const binary = atob(encodedFrame.data);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1)
          bytes[index] = binary.charCodeAt(index);
        return createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
      },
    };
    const analysis = await processRecording(
      recording.url,
      undefined,
      undefined,
      provider,
      undefined,
      take.moveLabel,
    );
    return await recordingsApi.saveAnalysis({ recordingId: recording.id, analysis });
  } finally {
    await recordingsApi.closeFrameReader({ sessionId: reader.sessionId });
  }
}
