import observedFramebarColors from "./config/framebar-colors.json";

export type FramebarColorDefinition = {
  name: string;
  red: number;
  green: number;
  blue: number;
};

// These are representative colors sampled from the verified 2A block capture.
// Runtime calibration entries are still loaded by the processor and can refine
// these values for another capture setup.
export const framebarColorMap = observedFramebarColors as FramebarColorDefinition[];
export const framebarColorDistanceThreshold = 0.18;

export type FramebarColorMatch = FramebarColorDefinition & {
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
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
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

export function findClosestFramebarColor(
  red: number,
  green: number,
  blue: number,
  definitions: FramebarColorDefinition[],
  distanceThreshold = framebarColorDistanceThreshold,
): FramebarColorMatch | null {
  const sample = toColorFeatures(red, green, blue);
  const closest = definitions.reduce<FramebarColorMatch | null>((best, definition) => {
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
      confidence: Math.max(0, 1 - distance / distanceThreshold),
    };
  }, null);
  return closest && closest.distance <= distanceThreshold ? closest : null;
}

// Keep the storage key stable so existing calibrated runtime mappings remain readable.
export const framebarRuntimeMapKey = "avatar-overlay-runtime-color-map";
