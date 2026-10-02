import type { DigitTemplate } from "./input-display";
import inputDisplayProfile from "./config/input-display-profile.json";

export type InputMarkerColor = "red" | "cyan" | "blue" | "yellow";
export type InputButtonSlot = "A" | "B" | "C" | "F";

export type InputButtonSlotRatio = {
  slot: InputButtonSlot;
  ratio: number;
  yRatio: number;
};

export type InputButtonLayoutConfig = {
  inputButtonStartX: number;
  inputButtonStartY: number;
  inputButtonSpacingX: number;
  inputButtonSecondaryOffsetX: number;
  inputButtonSecondaryOffsetY: number;
};

export type InputDisplayGeometryConfig = InputButtonLayoutConfig & {
  inputSegmentCount: number;
  inputSegmentTop: number;
  inputSegmentHeight: number;
  inputJoystickCenterX: number;
  inputJoystickRegionEndX: number;
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
};

export type InputDisplaySegmentLayout = {
  segment: {
    top: number;
    height: number;
  };
  joystick: {
    centerX: number;
    centerY: number;
    regionEndX: number;
    radius: number;
  };
  background: {
    startX: number;
    endX: number;
    darkPixelThreshold: number;
    minimumCoverage: number;
  };
  buttons: Array<{
    slot: InputButtonSlot;
    color: InputMarkerColor;
    centerX: number;
    centerY: number;
    radius: number;
  }>;
  number: {
    startX: number;
    endX: number;
    top: number;
    height: number;
    digitXs: number[];
    digitWidth: number;
    digitGap: number;
    digitTop: number;
    digitHeight: number;
  };
};

type InputColorRuleDefinition = {
  color: InputMarkerColor;
  redMin?: number;
  redMaxExclusive?: number;
  greenMin?: number;
  blueMin?: number;
  blueMaxExclusive?: number;
  redDominance?: number;
  blueDominance?: number;
  blueToGreenMax?: number;
  redToBlueMin?: number;
  greenToBlueMin?: number;
  redToGreenMax?: number;
};

type InputDisplayProfile = {
  version: number;
  buttonSlots: Array<{
    slot: InputButtonSlot;
    xRatio: number;
    yRatio: number;
    markerColor: InputMarkerColor;
  }>;
  displayColors: Record<InputMarkerColor, string>;
  colorRules: InputColorRuleDefinition[];
  segmentBackground: {
    startXRatio: number;
    endXRatio: number;
    darkPixelThreshold: number;
    minimumCoverage: number;
  };
};

const profile = inputDisplayProfile as InputDisplayProfile;

export const defaultInputButtonSlotRatios: InputButtonSlotRatio[] = profile.buttonSlots.map(
  ({ slot, xRatio, yRatio }) => ({ slot, ratio: xRatio, yRatio }),
);

export const inputButtonDisplayColors: Record<InputButtonSlot, string> = Object.fromEntries(
  profile.buttonSlots.map(({ slot, markerColor }) => [slot, profile.displayColors[markerColor]]),
) as Record<InputButtonSlot, string>;

export const inputMarkerDisplayColors = profile.displayColors;

export const inputButtonByMarkerColor: Record<InputMarkerColor, InputButtonSlot> =
  Object.fromEntries(
    profile.buttonSlots.map(({ slot, markerColor }) => [markerColor, slot]),
  ) as Record<InputMarkerColor, InputButtonSlot>;

const inputButtonColorBySlot: Record<InputButtonSlot, InputMarkerColor> = Object.fromEntries(
  profile.buttonSlots.map(({ slot, markerColor }) => [slot, markerColor]),
) as Record<InputButtonSlot, InputMarkerColor>;

function passesMinimum(value: number, minimum: number | undefined) {
  return minimum === undefined || value > minimum;
}

function passesMaximum(value: number, maximum: number | undefined) {
  return maximum === undefined || value < maximum;
}

export const inputColorRules = profile.colorRules.map(({ color, ...rule }) => ({
  color,
  matches: (red: number, green: number, blue: number) =>
    passesMinimum(red, rule.redMin) &&
    passesMaximum(red, rule.redMaxExclusive) &&
    passesMinimum(green, rule.greenMin) &&
    passesMinimum(blue, rule.blueMin) &&
    passesMaximum(blue, rule.blueMaxExclusive) &&
    (rule.redDominance === undefined ||
      (red > green * rule.redDominance && red > blue * rule.redDominance)) &&
    (rule.blueDominance === undefined || blue > green * rule.blueDominance) &&
    (rule.blueToGreenMax === undefined || blue <= green * rule.blueToGreenMax) &&
    (rule.redToBlueMin === undefined || red > blue * rule.redToBlueMin) &&
    (rule.greenToBlueMin === undefined || green > blue * rule.greenToBlueMin) &&
    (rule.redToGreenMax === undefined || red <= green * rule.redToGreenMax),
}));

export function inputButtonSlotRatios(config: InputButtonLayoutConfig): InputButtonSlotRatio[] {
  return [
    {
      slot: "A",
      ratio: config.inputButtonStartX / 100,
      yRatio: config.inputButtonStartY / 100,
    },
    {
      slot: "B",
      ratio: (config.inputButtonStartX + config.inputButtonSpacingX) / 100,
      yRatio: config.inputButtonStartY / 100,
    },
    {
      slot: "C",
      ratio: (config.inputButtonStartX + config.inputButtonSpacingX * 2) / 100,
      yRatio: config.inputButtonStartY / 100,
    },
    {
      slot: "F",
      ratio: (config.inputButtonStartX + config.inputButtonSecondaryOffsetX) / 100,
      yRatio: (config.inputButtonStartY + config.inputButtonSecondaryOffsetY) / 100,
    },
  ];
}

export function inputDisplaySegmentLayoutFromConfig(
  config: InputDisplayGeometryConfig,
): InputDisplaySegmentLayout {
  const buttonSlots = inputButtonSlotRatios(config);
  return {
    segment: {
      top: config.inputSegmentTop,
      height: config.inputSegmentHeight,
    },
    joystick: {
      centerX: config.inputJoystickCenterX,
      centerY: 50,
      regionEndX: config.inputJoystickRegionEndX,
      radius: 18,
    },
    background: {
      startX: profile.segmentBackground.startXRatio * 100,
      endX: profile.segmentBackground.endXRatio * 100,
      darkPixelThreshold: profile.segmentBackground.darkPixelThreshold,
      minimumCoverage: profile.segmentBackground.minimumCoverage,
    },
    buttons: buttonSlots.map(({ slot, ratio, yRatio }) => ({
      slot,
      color: inputButtonColorBySlot[slot],
      centerX: ratio * 100,
      centerY: yRatio * 100,
      radius: config.inputButtonRegionRadius,
    })),
    number: {
      startX: config.inputNumberStartX,
      endX: config.inputNumberEndX,
      top: config.inputNumberTop,
      height: config.inputNumberHeight,
      digitXs: Array.from(
        { length: 3 },
        (_, index) =>
          config.inputNumberDigit1X +
          index * (config.inputNumberDigitWidth + config.inputNumberDigitGap),
      ),
      digitWidth: config.inputNumberDigitWidth,
      digitGap: config.inputNumberDigitGap,
      digitTop: config.inputNumberDigitTop,
      digitHeight: config.inputNumberDigitHeight,
    },
  };
}

export function inputDisplayGeometryFromConfig(
  config: InputDisplayGeometryConfig,
  digitTemplates: DigitTemplate[],
) {
  const segmentLayout = inputDisplaySegmentLayoutFromConfig(config);
  return {
    segmentCount: config.inputSegmentCount,
    segmentTop: config.inputSegmentTop,
    segmentHeight: config.inputSegmentHeight,
    joystickCenterX: config.inputJoystickCenterX,
    joystickRegionEndX: config.inputJoystickRegionEndX,
    buttonSlotRatios: inputButtonSlotRatios(config),
    buttonRegionRadius: config.inputButtonRegionRadius,
    numberStartX: config.inputNumberStartX,
    numberEndX: config.inputNumberEndX,
    numberTop: config.inputNumberTop,
    numberHeight: config.inputNumberHeight,
    segmentLayout,
    numberDigitXs: segmentLayout.number.digitXs,
    numberDigitWidth: config.inputNumberDigitWidth,
    numberDigitTop: config.inputNumberDigitTop,
    numberDigitHeight: config.inputNumberDigitHeight,
    digitTemplates,
  };
}
