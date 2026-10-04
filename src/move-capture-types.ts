export const moveTakeOutcomes = ["whiff", "block", "hit-grounded", "hit-airborne"] as const;

export type MoveTakeOutcome = (typeof moveTakeOutcomes)[number] | "hit";

export type MoveCatalogMove = {
  id: string;
  label: string;
  /** Raw notations expected in the visible input history, not inferred move names. */
  expectedInputs: string[];
  /** A bare canonical button, such as A, that may be visibly recorded as 5A or 6A. */
  isStance: boolean;
  /** This entry is the held/charged version of its input and has independent takes. */
  isCharged: boolean;
};

export type MoveCatalogCharacter = {
  id: string;
  label: string;
  moves: MoveCatalogMove[];
};

export type MoveCatalog = {
  schemaVersion: 1;
  revision: number;
  characters: MoveCatalogCharacter[];
};

/** A game-supported character/support pairing supplied by the existing lookup data. */
export type KnownMoveCaptureVariant = {
  id: string;
  label: string;
  character: string;
  support: string;
  supportId: string;
};

export type ArmedMoveCapture = {
  catalogMoveId: string;
  characterId: string;
  characterLabel: string;
  moveId: string;
  moveLabel: string;
  expectedInputs: string[];
  isStance: boolean;
  isCharged: boolean;
  outcome: MoveTakeOutcome;
  armedAt: string;
};

export type MoveTakeValidationStatus =
  | "unprocessed"
  | "verified"
  | "mismatch"
  | "ambiguous"
  | "unresolved";

export type MoveTakeValidation = {
  status: MoveTakeValidationStatus;
  message: string;
  expectedInputs: string[];
  observedInputs: string[];
  matchedAnalysisMoveId: string | null;
  processedAt: string | null;
};

export type RecordingMoveTake = ArmedMoveCapture & {
  id: string;
  status: "recording" | "captured";
  recordedAt: string | null;
  storageError?: string | null;
  evidenceStatus: "pending" | "active" | "archived";
  evidenceReason?: string | null;
  reviewedAt?: string | null;
  validation: MoveTakeValidation;
};

export type MoveCaptureState = {
  armed: ArmedMoveCapture | null;
  active: RecordingMoveTake | null;
};
