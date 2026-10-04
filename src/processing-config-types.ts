import type { DetectorConfig } from "./detector-config";
import type { FramebarColorDefinition } from "./framebar-color-map";
import type { DigitTemplate } from "./input-display";
import type { TrainingMeterCalibration, TrainingMeterThresholds } from "./training-meter";
import type inputDisplayProfile from "./config/input-display-profile.json";

export type ProcessingConfiguration = {
  schemaVersion: 1;
  /** Absent is the original persisted palette profile. */
  calibrationProfileVersion?: 1 | 2;
  revision: number;
  updatedAt: string;
  origin: "legacy-migration" | "defaults" | "edited" | "imported";
  detector: DetectorConfig;
  /** Percentage ROIs stay fixed; only source-pixel offsets scale from this size. */
  referenceSize: { width: number; height: number };
  framebar: {
    colors: FramebarColorDefinition[];
    distanceThreshold: number;
    unmappedPolicy: "unknown";
  };
  digitTemplates: DigitTemplate[];
  trainingMeter: {
    calibration: TrainingMeterCalibration;
    thresholds: TrainingMeterThresholds;
  };
  /** Freeze the bundled input rules too, and reject incompatible rule changes. */
  inputDisplayProfile: typeof inputDisplayProfile;
};

export type ProcessingConfigurationResult = {
  configuration: ProcessingConfiguration | null;
  path: string;
  warnings: string[];
};

export type ProcessingSnapshot = {
  processorVersion: string;
  processorFingerprint: string;
  configuration: ProcessingConfiguration;
  effectiveDetector: DetectorConfig;
  sourceSize: { width: number; height: number };
};
