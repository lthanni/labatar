export const cornerTemplatesKey = "avatar-overlay-corner-templates";
export const cornerObservationKey = "avatar-overlay-corner-observation";

export type CornerRegionKey = "p1Character" | "p2Character" | "p1Support" | "p2Support";
export type CornerTemplateKind = "character" | "support";
export type CornerSide = "p1" | "p2";

export type CornerRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CornerRegions = Record<CornerRegionKey, CornerRegion>;

export type CornerFingerprint = {
  width: number;
  height: number;
  pixels: number[];
};

export type CornerTemplate = CornerFingerprint & {
  id: string;
  name: string;
  side: CornerSide;
  kind: CornerTemplateKind;
  createdAt: string;
};

export type CornerObservation = {
  timestamp: string;
  regions: Partial<Record<CornerRegionKey, CornerFingerprint>>;
};

export type CornerMatch = {
  name: string;
  score: number;
};

export type CornerMatches = Record<CornerRegionKey, CornerMatch | null>;

export const defaultCornerRegions: CornerRegions = {
  // The game portraits occupy the outside edges of the top HUD. These are
  // deliberately configurable because window scaling and HUD layouts vary.
  p1Character: { x: 0, y: 0, width: 11, height: 9 },
  p2Character: { x: 89, y: 0, width: 11, height: 9 },
  // Keep support regions separate from the portraits. The initial positions
  // cover the small support art just below each portrait in the default HUD.
  p1Support: { x: 0, y: 8, width: 11, height: 8 },
  p2Support: { x: 89, y: 8, width: 11, height: 8 },
};

export const cornerRegionLabels: Record<CornerRegionKey, string> = {
  p1Character: "P1 character",
  p2Character: "P2 character",
  p1Support: "P1 support",
  p2Support: "P2 support",
};

export function cornerRegionParts(key: CornerRegionKey) {
  const side: CornerSide = key.startsWith("p1") ? "p1" : "p2";
  const kind: CornerTemplateKind = key.endsWith("Character") ? "character" : "support";
  return { side, kind };
}

export function readCornerTemplates(): CornerTemplate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(cornerTemplatesKey) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((template): template is CornerTemplate => {
      if (!template || typeof template !== "object") return false;
      const candidate = template as Partial<CornerTemplate>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        (candidate.side === "p1" || candidate.side === "p2") &&
        (candidate.kind === "character" || candidate.kind === "support") &&
        Number.isFinite(candidate.width) &&
        Number.isFinite(candidate.height) &&
        Array.isArray(candidate.pixels)
      );
    });
  } catch {
    return [];
  }
}

export function writeCornerTemplates(templates: CornerTemplate[]) {
  localStorage.setItem(cornerTemplatesKey, JSON.stringify(templates.slice(-200)));
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Samples a region into a small normalized RGB image. Downsampling makes the
 * comparison tolerant of capture scaling and minor portrait animation while
 * retaining enough shape/color information to distinguish portraits.
 */
export function captureCornerFingerprint(
  source: CanvasImageSource,
  context: CanvasRenderingContext2D,
  region: CornerRegion,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth = 24,
  sampleHeight = 16,
): CornerFingerprint {
  const x = Math.max(0, Math.min(sourceWidth, sourceWidth * (region.x / 100)));
  const y = Math.max(0, Math.min(sourceHeight, sourceHeight * (region.y / 100)));
  const width = Math.max(1, Math.min(sourceWidth - x, sourceWidth * (region.width / 100)));
  const height = Math.max(1, Math.min(sourceHeight - y, sourceHeight * (region.height / 100)));
  context.canvas.width = sampleWidth;
  context.canvas.height = sampleHeight;
  context.clearRect(0, 0, sampleWidth, sampleHeight);
  context.drawImage(source, x, y, width, height, 0, 0, sampleWidth, sampleHeight);
  const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const pixels: number[] = [];
  for (let index = 0; index < data.length; index += 4) {
    pixels.push(clampByte(data[index]), clampByte(data[index + 1]), clampByte(data[index + 2]));
  }
  return { width: sampleWidth, height: sampleHeight, pixels };
}

export function compareCornerFingerprints(left: CornerFingerprint, right: CornerFingerprint) {
  if (left.width !== right.width || left.height !== right.height) return 1;
  const count = Math.min(left.pixels.length, right.pixels.length);
  if (count < 3) return 1;
  let total = 0;
  for (let index = 0; index < count; index += 3) {
    const leftRed = left.pixels[index] ?? 0;
    const leftGreen = left.pixels[index + 1] ?? 0;
    const leftBlue = left.pixels[index + 2] ?? 0;
    const rightRed = right.pixels[index] ?? 0;
    const rightGreen = right.pixels[index + 1] ?? 0;
    const rightBlue = right.pixels[index + 2] ?? 0;
    const chromaDistance =
      (Math.abs(leftRed - leftGreen) +
        Math.abs(leftGreen - leftBlue) +
        Math.abs(leftBlue - leftRed) -
        Math.abs(rightRed - rightGreen) -
        Math.abs(rightGreen - rightBlue) -
        Math.abs(rightBlue - rightRed)) /
      (6 * 255);
    const leftLuma = (leftRed * 0.299 + leftGreen * 0.587 + leftBlue * 0.114) / 255;
    const rightLuma = (rightRed * 0.299 + rightGreen * 0.587 + rightBlue * 0.114) / 255;
    total += Math.abs(leftLuma - rightLuma) * 0.7 + Math.abs(chromaDistance) * 0.3;
  }
  return total / Math.ceil(count / 3);
}

export function findCornerMatches(
  observation: CornerObservation,
  templates: CornerTemplate[],
  threshold = 0.2,
): CornerMatches {
  const matches = {} as CornerMatches;
  (Object.keys(cornerRegionLabels) as CornerRegionKey[]).forEach((key) => {
    const fingerprint = observation.regions[key];
    if (!fingerprint) {
      matches[key] = null;
      return;
    }
    const { side, kind } = cornerRegionParts(key);
    const best = templates
      .filter((template) => template.side === side && template.kind === kind)
      .map((template) => ({ template, score: compareCornerFingerprints(fingerprint, template) }))
      .sort((left, right) => left.score - right.score)[0];
    matches[key] =
      best && best.score <= threshold ? { name: best.template.name, score: best.score } : null;
  });
  return matches;
}

export function formatCornerMatch(match: CornerMatch | null) {
  return match ? `${match.name} (${(1 - match.score).toFixed(2)})` : "unknown";
}
