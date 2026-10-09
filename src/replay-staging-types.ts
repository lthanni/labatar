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
};
