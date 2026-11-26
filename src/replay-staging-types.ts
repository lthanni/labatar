export type ReplayStagingStatus = {
  active: boolean;
  gameFolder: string | null;
  selectedCount: number;
  newReplayCount: number;
  recoveredCount?: number;
  issue: string | null;
};

export type ReplayStagingPreview = {
  selectedCount: number;
  archivedCount: number;
  switching: boolean;
  gameRunning: boolean;
};

export type ReplayStagingOptions = { closeGame: boolean; openGame: boolean };
export type ReplayStagingResult = ReplayStagingStatus & {
  gameOpened?: boolean;
  gameOpenError?: string;
};

export type RecordedReplayLink = { path: string; contentHash?: string };
export type ReplayStagingRequest = { ids: string[] } | { recordedReplay: RecordedReplayLink };
