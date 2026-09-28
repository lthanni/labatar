import type { RecordingMetadata } from "./obs-types";

export type RecordedVideo = {
  id: string;
  name: string;
  url: string;
  size: number;
  modifiedAt: number;
  metadata: RecordingMetadata | null;
  replayPath: string | null;
  replayFileName: string | null;
};
