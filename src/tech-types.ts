import type { MoveTakeOutcome } from "./move-capture-types";

export type TechResourceCosts = {
  pips: number;
  flow: number;
  [resource: string]: number;
};

export type TechStanceFollowupPattern = "directional-button";

export type TechMove = {
  id: string;
  character: string;
  input: string;
  isStanceParent: boolean;
  /** This catalog entry is the held/charged version and owns separate capture data. */
  isCharged: boolean;
  /** Excluded from automated capture; the move remains available for manual capture. */
  nonstandard?: boolean;
  nonstandardNote?: string;
  flowCancellable: boolean;
  notApplicable?: Partial<Record<MoveTakeOutcome, string>>;
  stanceFollowupPattern: TechStanceFollowupPattern | null;
  dependsOnMoveId: string | null;
  stanceMinimumDuration: number | null;
  chargedMoveId: string | null;
  baseMoveId: string | null;
  startup: number | null;
  active: number | null;
  recovery: number | null;
  onBlock: number | null;
  blockstun: number | null;
  hitstun: number | null;
  /** Accepted measurements retain the take and analyzed time interval that supports each value. */
  evidence?: Partial<Record<TechMeasuredField, TechMeasurement>>;
  resourceCosts: TechResourceCosts;
  // Reserved for mechanics that do not fit the generic move frame-data model.
  properties?: Record<string, unknown>;
};

export type TechMeasuredField =
  | "startup"
  | "active"
  | "recovery"
  | "onBlock"
  | "blockstun"
  | "hitstunGrounded"
  | "onHitGrounded"
  | "hitstunAirborne"
  | "onHitAirborne";

export type TechMeasurement = {
  value: number;
  recordingId: string;
  analysisMoveId: string;
  startTime: number;
  endTime: number;
  startFrame: number;
  endFrame: number;
  frameRate: number;
};

/** A separately persisted support version; fields absent here inherit the base move. */
export type TechSupportMove = {
  id: string;
  character: string;
  support: string;
  baseMoveId: string;
  /** Provenance for this support, even when its value equals the baseline. */
  sources?: Partial<Record<TechMeasuredField, TechMeasurement>>;
  measurements: Partial<Record<TechMeasuredField, TechMeasurement>>;
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
  supportMoves?: TechSupportMove[];
  combos: TechCombo[];
};

export type TechCatalog = Record<string, CharacterTechData>;
export const techCatalogStorageKey = "labatar-tech-catalog";
export const techCatalogUpdatedEvent = "labatar-tech-catalog-updated";
export const techSelectRecordingEvent = "labatar-select-recording";
export const techSelectComboEvent = "labatar-select-combo";
export const techSelectedRecordingStorageKey = "labatar-selected-recording";
export const techSelectedComboStorageKey = "labatar-selected-combo";
