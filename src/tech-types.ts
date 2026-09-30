export type TechResourceCosts = {
  pips: number;
  flow: number;
  [resource: string]: number;
};

export type TechMove = {
  id: string;
  character: string;
  input: string;
  isRekka: boolean;
  dependsOnMoveId: string | null;
  rekkaMinimumDuration: number | null;
  startup: number | null;
  active: number | null;
  recovery: number | null;
  onBlock: number | null;
  blockstun: number | null;
  hitstun: number | null;
  resourceCosts: TechResourceCosts;
  // Reserved for mechanics that do not fit the generic move frame-data model.
  properties?: Record<string, unknown>;
};

export type TechCombo = {
  id: string;
  character: string;
  support: string;
  moveIds: Array<string | null>;
  route: string;
  screenPosition: string;
  damage: string;
  resourceCosts: TechResourceCosts;
  recordingId: string | null;
  properties?: Record<string, unknown>;
};

export type CharacterTechData = {
  moves: TechMove[];
  combos: TechCombo[];
};

export type TechCatalog = Record<string, CharacterTechData>;
export const techCatalogStorageKey = "labatar-tech-catalog";
export const techCatalogUpdatedEvent = "labatar-tech-catalog-updated";
export const techSelectRecordingEvent = "labatar-select-recording";
export const techSelectComboEvent = "labatar-select-combo";
export const techSelectedRecordingStorageKey = "labatar-selected-recording";
export const techSelectedComboStorageKey = "labatar-selected-combo";
