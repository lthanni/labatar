export type OverlayColorDefinition = {
  name: string;
  red: number;
  green: number;
  blue: number;
};

// Add observed RGB values here as they appear in the overlay debug panel.
export const overlayColorMap: OverlayColorDefinition[] = [];
export const overlayColorTolerance = 8;
// Feature distance is normalized to 0..1. A larger threshold makes mapping
// more tolerant of translucent compositing and display color differences.
export const overlayColorDistanceThreshold = 0.18;

export type OverlayColorMatch = OverlayColorDefinition & {
  distance: number;
  confidence: number;
};

type ColorFeatures = {
  lab: [number, number, number];
  chroma: [number, number, number];
  luminance: number;
};

function toColorFeatures(red: number, green: number, blue: number): ColorFeatures {
  const toLinear = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear(red);
  const g = toLinear(green);
  const b = toLinear(blue);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const labTransform = (value: number) =>
    value > 0.008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116;
  const fx = labTransform(x);
  const fy = labTransform(y);
  const fz = labTransform(z);
  const total = Math.max(1, red + green + blue);
  return {
    lab: [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)],
    chroma: [red / total, green / total, blue / total],
    luminance: y,
  };
}

export function findClosestOverlayColor(
  red: number,
  green: number,
  blue: number,
  definitions: OverlayColorDefinition[],
): OverlayColorMatch | null {
  const sample = toColorFeatures(red, green, blue);
  const closest = definitions.reduce<OverlayColorMatch | null>((best, definition) => {
    const candidate = toColorFeatures(definition.red, definition.green, definition.blue);
    const labDistance =
      Math.hypot(
        sample.lab[0] - candidate.lab[0],
        sample.lab[1] - candidate.lab[1],
        sample.lab[2] - candidate.lab[2],
      ) / 100;
    const chromaDistance = Math.hypot(
      sample.chroma[0] - candidate.chroma[0],
      sample.chroma[1] - candidate.chroma[1],
      sample.chroma[2] - candidate.chroma[2],
    );
    const luminanceDistance = Math.abs(sample.luminance - candidate.luminance);
    const distance = labDistance * 0.55 + chromaDistance * 0.3 + luminanceDistance * 0.15;
    if (best && best.distance <= distance) return best;
    return {
      ...definition,
      distance,
      confidence: Math.max(0, 1 - distance / overlayColorDistanceThreshold),
    };
  }, null);
  return closest && closest.distance <= overlayColorDistanceThreshold ? closest : null;
}
export const overlayRuntimeMapKey = "avatar-overlay-runtime-color-map";
export const overlayUnmappedKey = "avatar-overlay-unmapped-colors";
export const overlayPlayer1UnmappedKey = "avatar-overlay-player1-unmapped-colors";
export const overlayPlayer2UnmappedKey = "avatar-overlay-player2-unmapped-colors";
export const overlayDetectFramebarKey = "avatar-overlay-detect-framebar";
export const overlayCellGroupsKey = "avatar-overlay-cell-groups";
export const overlayCellGroupLogKey = "avatar-overlay-cell-group-log";
export const overlayPlayer1CellGroupsKey = "avatar-overlay-player1-cell-groups";
export const overlayPlayer1CellGroupLogKey = "avatar-overlay-player1-cell-group-log";
export const overlayGateSamplesKey = "avatar-overlay-gate-samples";
export const overlayDetectInputKey = "avatar-overlay-detect-input";
export const overlayInputObservationKey = "avatar-overlay-input-observation";
export const overlayInputEventLogKey = "avatar-overlay-input-event-log";
export const overlayMoveEpisodeLogKey = "avatar-overlay-move-episode-log";
