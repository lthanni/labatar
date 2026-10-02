import detectorDefaults from "./config/detector-defaults.json";
import {
  framebarColorMap,
  framebarRuntimeMapKey,
  type FramebarColorDefinition,
} from "./framebar-color-map";
import { inputButtonSlotRatios } from "./input-display-config";

// This storage key predates the recording processor. Keep it unchanged so
// existing user calibration is still loaded after the live overlay removal.
export const detectorConfigKey = "avatar-overlay-config";

export type DetectorConfig = {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  framebarSourceWidth: number;
  framebarSourceHeight: number;
  targetX: number;
  targetY: number;
  targetWidth: number;
  targetHeight: number;
  baseSampleOffset: number;
  yellowSampleOffset: number;
  sampleStartOffset: number;
  sampleSpacing: number;
  sampleCount: number;
  gateSampleOffset: number;
  gateStartOffset: number;
  gateSpacing: number;
  gateSampleCount: number;
  gateRed: number;
  gateGreen: number;
  gateBlue: number;
  gateTolerance: number;
  inputSourceX: number;
  inputSourceY: number;
  inputSourceWidth: number;
  inputSourceHeight: number;
  inputSegmentCount: number;
  inputSegmentTop: number;
  inputSegmentHeight: number;
  inputJoystickCenterX: number;
  inputJoystickRegionEndX: number;
  inputButtonStartX: number;
  inputButtonStartY: number;
  inputButtonSpacingX: number;
  inputButtonSecondaryOffsetX: number;
  inputButtonSecondaryOffsetY: number;
  inputButtonRegionRadius: number;
  inputNumberStartX: number;
  inputNumberEndX: number;
  inputNumberDigit1X: number;
  inputNumberDigitWidth: number;
  inputNumberDigitGap: number;
  inputNumberDigitTop: number;
  inputNumberDigitHeight: number;
  inputNumberTop: number;
  inputNumberHeight: number;
  player1SourceX: number;
  player1SourceY: number;
  p1CharacterX: number;
  p1CharacterY: number;
  p1CharacterWidth: number;
  p1CharacterHeight: number;
  p2CharacterX: number;
  p2CharacterY: number;
  p2CharacterWidth: number;
  p2CharacterHeight: number;
  p1SupportX: number;
  p1SupportY: number;
  p1SupportWidth: number;
  p1SupportHeight: number;
  p2SupportX: number;
  p2SupportY: number;
  p2SupportWidth: number;
  p2SupportHeight: number;
};

export const defaultDetectorConfig = detectorDefaults as DetectorConfig;

export { inputButtonSlotRatios };

export function cornerRegionsFromConfig(config: DetectorConfig) {
  return {
    p1Character: {
      x: config.p1CharacterX,
      y: config.p1CharacterY,
      width: config.p1CharacterWidth,
      height: config.p1CharacterHeight,
    },
    p2Character: {
      x: config.p2CharacterX,
      y: config.p2CharacterY,
      width: config.p2CharacterWidth,
      height: config.p2CharacterHeight,
    },
    p1Support: {
      x: config.p1SupportX,
      y: config.p1SupportY,
      width: config.p1SupportWidth,
      height: config.p1SupportHeight,
    },
    p2Support: {
      x: config.p2SupportX,
      y: config.p2SupportY,
      width: config.p2SupportWidth,
      height: config.p2SupportHeight,
    },
  };
}

type LegacyDetectorConfig = Partial<DetectorConfig> & {
  inputSegmentBottom?: number;
  inputButtonAX?: number;
  inputButtonAY?: number;
  inputButtonBX?: number;
  inputButtonBY?: number;
  inputButtonCX?: number;
  inputButtonCY?: number;
  inputButtonSX?: number;
  inputButtonSY?: number;
};

export function readDetectorConfig(): DetectorConfig {
  try {
    const saved = JSON.parse(
      localStorage.getItem(detectorConfigKey) ?? "null",
    ) as LegacyDetectorConfig | null;
    const merged = { ...defaultDetectorConfig, ...saved };
    const hasOldFullScreenInputDefaults =
      saved?.inputSourceX === 0 &&
      saved.inputSourceY === 0 &&
      saved.inputSourceWidth === 22 &&
      saved.inputSourceHeight === 100;
    const hasPreviousInputDefaults =
      saved?.inputSourceX === 0 &&
      saved.inputSourceY === 34 &&
      saved.inputSourceWidth === 9 &&
      saved.inputSourceHeight === 27;
    if (hasOldFullScreenInputDefaults || hasPreviousInputDefaults) {
      merged.inputSourceX = defaultDetectorConfig.inputSourceX;
      merged.inputSourceY = defaultDetectorConfig.inputSourceY;
      merged.inputSourceWidth = defaultDetectorConfig.inputSourceWidth;
      merged.inputSourceHeight = defaultDetectorConfig.inputSourceHeight;
    }
    const legacyButtonAX = saved?.inputButtonAX;
    const legacyButtonAY = saved?.inputButtonAY;
    const legacyButtonBX = saved?.inputButtonBX;
    const legacyButtonCX = saved?.inputButtonCX;
    const legacyButtonSX = saved?.inputButtonSX;
    const legacyButtonSY = saved?.inputButtonSY;
    const hasLegacyButtonLayout =
      typeof legacyButtonAX === "number" &&
      typeof legacyButtonAY === "number" &&
      typeof legacyButtonBX === "number" &&
      typeof legacyButtonCX === "number" &&
      typeof legacyButtonSX === "number" &&
      typeof legacyButtonSY === "number";
    if (saved?.inputButtonStartX === undefined && hasLegacyButtonLayout) {
      merged.inputButtonStartX = legacyButtonAX;
      merged.inputButtonStartY = legacyButtonAY;
      merged.inputButtonSpacingX =
        (legacyButtonBX - legacyButtonAX + (legacyButtonCX - legacyButtonBX)) / 2;
      merged.inputButtonSecondaryOffsetX = legacyButtonSX - legacyButtonAX;
      merged.inputButtonSecondaryOffsetY = legacyButtonSY - legacyButtonAY;
    }
    const hasOldHorizontalButtonDefaults =
      saved?.inputButtonAX === 49 &&
      saved.inputButtonBX === 58 &&
      saved.inputButtonCX === 67 &&
      saved.inputButtonSX === 76;
    if (hasOldHorizontalButtonDefaults) {
      merged.inputButtonStartX = defaultDetectorConfig.inputButtonStartX;
      merged.inputButtonStartY = defaultDetectorConfig.inputButtonStartY;
      merged.inputButtonSpacingX = defaultDetectorConfig.inputButtonSpacingX;
      merged.inputButtonSecondaryOffsetX = defaultDetectorConfig.inputButtonSecondaryOffsetX;
      merged.inputButtonSecondaryOffsetY = defaultDetectorConfig.inputButtonSecondaryOffsetY;
    }
    if (
      saved?.inputSegmentHeight === undefined &&
      typeof saved?.inputSegmentBottom === "number" &&
      typeof saved?.inputSegmentTop === "number" &&
      typeof saved?.inputSegmentCount === "number" &&
      saved.inputSegmentCount > 0
    ) {
      merged.inputSegmentHeight =
        (saved.inputSegmentBottom - saved.inputSegmentTop) / saved.inputSegmentCount;
    }
    return merged;
  } catch {
    return defaultDetectorConfig;
  }
}

export function hasStoredDetectorConfig() {
  try {
    return Boolean(localStorage.getItem(detectorConfigKey));
  } catch {
    return false;
  }
}

export function readRuntimeFramebarColorMap(): FramebarColorDefinition[] {
  try {
    return JSON.parse(
      localStorage.getItem(framebarRuntimeMapKey) ?? "[]",
    ) as FramebarColorDefinition[];
  } catch {
    return [...framebarColorMap];
  }
}
