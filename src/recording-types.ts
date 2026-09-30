import type { RecordingMetadata } from "./obs-types";

export type RecordingTagCategory = "match" | "lab" | "combo" | "pressure";
export type RecordingTagSubtag = "ranked" | "casual" | "practice" | "new-combos" | "new-pressure";

export type RecordingTags = {
  match: Array<"ranked" | "casual">;
  lab: Array<"practice" | "new-combos" | "new-pressure">;
  combo: boolean;
  pressure: boolean;
};

export type RecordingClipMetadata = {
  sourceRecordingId: string;
  sourceRecordingName: string;
  startTime: number;
  endTime: number;
  createdAt: string | null;
};

export type RecordedGame = {
  matchId: string;
  lobbyId: string;
  setNumber: number;
  gameNumber: number;
  logTime: string | null;
  detectedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  metadata: RecordingMetadata | null;
  replayPath: string | null;
  replayFileName: string | null;
};

export type RecordedVideo = {
  id: string;
  name: string;
  url: string;
  size: number;
  modifiedAt: number;
  metadata: RecordingMetadata | null;
  tags: RecordingTags;
  games: RecordedGame[];
  replays: Array<{
    matchId: string | null;
    replayPath: string;
    replayFileName: string;
    replay?: unknown;
  }>;
  replayPath: string | null;
  replayFileName: string | null;
  clip: RecordingClipMetadata | null;
};
