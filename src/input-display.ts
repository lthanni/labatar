export type InputMarkerColor = "red" | "cyan" | "blue" | "yellow";

export type InputMarker = {
  color: InputMarkerColor;
  x: number;
  y: number;
  area: number;
  width: number;
  height: number;
  fillRatio: number;
};

export type InputDisplayRow = {
  top: number;
  bottom: number;
  markers: InputMarker[];
  joystick?: {
    centerX: number;
    centerY: number;
    width: number;
    markerX: number;
    markerY: number;
  };
  joystickCheck?: {
    detected: boolean;
    confidence: number;
    centerX: number;
    centerY: number;
    markerX?: number;
    markerY?: number;
  };
  buttonChecks?: Array<{
    slot: "A" | "B" | "C" | "S";
    detected: boolean;
    confidence: number;
    marker?: InputMarker;
  }>;
  numberReading?: {
    text: string;
    confidence: number;
    glyphs?: NumberGlyphSample[];
  };
};

export type NumberGlyphSample = {
  x: number;
  width: number;
  height: number;
  mask: number[];
};

export type DigitTemplate = {
  id: string;
  digit: string;
  mask: number[];
  capturedAt: string;
};

export const digitTemplatesKey = "avatar-overlay-digit-templates";

export function readDigitTemplates(): DigitTemplate[] {
  try {
    const saved = JSON.parse(localStorage.getItem(digitTemplatesKey) ?? "[]") as unknown;
    if (!Array.isArray(saved)) return [];
    return saved.filter(
      (entry): entry is DigitTemplate =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as DigitTemplate).id === "string" &&
        typeof (entry as DigitTemplate).digit === "string" &&
        ((entry as DigitTemplate).digit === "blank" ||
          /^[0-9]$/.test((entry as DigitTemplate).digit)) &&
        Array.isArray((entry as DigitTemplate).mask) &&
        (entry as DigitTemplate).mask.length === 35,
    );
  } catch {
    return [];
  }
}

export function writeDigitTemplates(templates: DigitTemplate[]) {
  localStorage.setItem(digitTemplatesKey, JSON.stringify(templates.slice(-100)));
}

export type InputDisplayObservation = {
  width: number;
  height: number;
  rows: InputDisplayRow[];
};

export type ResolvedInput = {
  notation: string;
  direction: string;
  buttons: string[];
  confidence: number;
  rowIndex?: number;
};

type RgbImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

type ColorRule = {
  color: InputMarkerColor;
  matches: (red: number, green: number, blue: number) => boolean;
};

type LightComponent = {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
};

type NumberReading = {
  text: string;
  confidence: number;
  glyphs: NumberGlyphSample[];
};

type NumberDigitBox = {
  x: number;
  width: number;
  top: number;
  height: number;
};

export const inputButtonSlotRatios = [
  { slot: "A" as const, ratio: 0.43, yRatio: 0.3 },
  { slot: "B" as const, ratio: 0.5, yRatio: 0.3 },
  { slot: "C" as const, ratio: 0.57, yRatio: 0.3 },
  { slot: "S" as const, ratio: 0.43, yRatio: 0.7 },
];

export type InputDisplayGeometry = {
  segmentCount: number;
  segmentTop: number;
  segmentHeight: number;
  joystickCenterX: number;
  joystickRegionEndX: number;
  buttonSlotRatios: typeof inputButtonSlotRatios;
  buttonRegionRadius: number;
  numberStartX: number;
  numberEndX: number;
  numberDigitXs?: number[];
  numberDigitWidth?: number;
  numberDigitTop?: number;
  numberDigitHeight?: number;
  digitTemplates?: DigitTemplate[];
};

export const defaultInputDisplayGeometry: InputDisplayGeometry = {
  segmentCount: 13,
  segmentTop: 2,
  // Segment height is expressed as a percentage of the input ROI. This is
  // equivalent to the previous 2%-to-98% span divided across 13 rows.
  segmentHeight: 96 / 13,
  joystickCenterX: 38,
  joystickRegionEndX: 44,
  buttonSlotRatios: inputButtonSlotRatios,
  buttonRegionRadius: 6.5,
  numberStartX: 68,
  numberEndX: 98,
  numberDigitXs: [70, 79, 88],
  numberDigitWidth: 8,
  numberDigitTop: 10,
  numberDigitHeight: 80,
};

const colorRules: ColorRule[] = [
  {
    color: "red",
    matches: (red, green, blue) => red > 150 && red > green * 1.35 && red > blue * 1.35,
  },
  {
    color: "cyan",
    matches: (red, green, blue) => red < 125 && green > 135 && blue > 135 && blue <= green * 1.2,
  },
  {
    color: "blue",
    matches: (red, green, blue) => red < 125 && blue > 145 && blue > green * 1.2,
  },
  {
    color: "yellow",
    matches: (red, green, blue) =>
      red > 150 &&
      green > 130 &&
      blue < 115 &&
      red > blue * 1.35 &&
      green > blue * 1.35 &&
      red <= green * 1.4,
  },
];

function pixelIndex(width: number, x: number, y: number) {
  return (y * width + x) * 4;
}

function classifyPixel(red: number, green: number, blue: number): InputMarkerColor | null {
  // Evaluate rules in priority order. Anti-aliased red/orange joystick pixels
  // can also satisfy the broad yellow rule, but a pixel must belong to only
  // one input color.
  return colorRules.find((rule) => rule.matches(red, green, blue))?.color ?? null;
}

function findComponents(image: RgbImage, rule: ColorRule): InputMarker[] {
  const visited = new Uint8Array(image.width * image.height);
  const components: InputMarker[] = [];
  const queue: Array<[number, number]> = [];

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const visitIndex = y * image.width + x;
      if (visited[visitIndex]) continue;
      visited[visitIndex] = 1;
      const index = pixelIndex(image.width, x, y);
      if (
        classifyPixel(image.data[index], image.data[index + 1], image.data[index + 2]) !==
        rule.color
      ) {
        continue;
      }

      queue.length = 0;
      queue.push([x, y]);
      let queueIndex = 0;
      let area = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (queueIndex < queue.length) {
        const [currentX, currentY] = queue[queueIndex++];
        area += 1;
        sumX += currentX;
        sumY += currentY;
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);
        for (const [nextX, nextY] of [
          [currentX - 1, currentY],
          [currentX + 1, currentY],
          [currentX, currentY - 1],
          [currentX, currentY + 1],
        ] as Array<[number, number]>) {
          if (nextX < 0 || nextY < 0 || nextX >= image.width || nextY >= image.height) {
            continue;
          }
          const nextVisitIndex = nextY * image.width + nextX;
          if (visited[nextVisitIndex]) continue;
          visited[nextVisitIndex] = 1;
          const nextPixelIndex = pixelIndex(image.width, nextX, nextY);
          if (
            classifyPixel(
              image.data[nextPixelIndex],
              image.data[nextPixelIndex + 1],
              image.data[nextPixelIndex + 2],
            ) === rule.color
          ) {
            queue.push([nextX, nextY]);
          }
        }
      }

      // Tiny components are usually compression noise. Very large components
      // are usually game art rather than an input marker. The input markers
      // are compact dots; hitbox rectangles and the cyan ROI outline are long,
      // thin components even when their color matches one of the rules.
      const componentWidth = maxX - minX + 1;
      const componentHeight = maxY - minY + 1;
      const aspectRatio =
        Math.max(componentWidth, componentHeight) /
        Math.max(1, Math.min(componentWidth, componentHeight));
      const fillRatio = area / (componentWidth * componentHeight);
      const maxMarkerDimension = Math.max(18, Math.min(image.width * 0.18, image.height * 0.12));
      if (
        area >= 8 &&
        area <= image.width * image.height * 0.08 &&
        componentWidth >= 3 &&
        componentHeight >= 3 &&
        componentWidth <= maxMarkerDimension &&
        componentHeight <= maxMarkerDimension &&
        aspectRatio <= 3.5 &&
        fillRatio >= 0.15
      ) {
        components.push({
          color: rule.color,
          x: sumX / area,
          y: sumY / area,
          area,
          width: componentWidth,
          height: componentHeight,
          fillRatio,
        });
      }
    }
  }
  return components;
}

function mergeNearbyMarkers(markers: InputMarker[], image: RgbImage): InputMarker[] {
  const merged: InputMarker[] = [];
  const proximity = Math.max(5, Math.min(image.width * 0.04, image.height * 0.025));
  const colorPriority: Record<InputMarkerColor, number> = {
    red: 0,
    yellow: 1,
    blue: 2,
    cyan: 3,
  };

  for (const marker of [...markers].sort((left, right) => right.area - left.area)) {
    const nearby = merged.find(
      (candidate) =>
        Math.abs(candidate.x - marker.x) <= proximity &&
        Math.abs(candidate.y - marker.y) <= proximity,
    );
    if (!nearby) {
      merged.push(marker);
      continue;
    }

    // A single anti-aliased marker can produce small fragments in a second
    // color. Keep the dominant semantic color, with red taking precedence for
    // the joystick/C button over its orange edge pixels.
    if (colorPriority[marker.color] < colorPriority[nearby.color]) {
      const index = merged.indexOf(nearby);
      merged[index] = marker;
    }
  }
  return merged;
}

function findLightComponents(image: RgbImage, maxXRatio = 0.55): LightComponent[] {
  const visited = new Uint8Array(image.width * image.height);
  const components: LightComponent[] = [];
  const queue: Array<[number, number]> = [];
  const isLight = (red: number, green: number, blue: number) =>
    red > 155 &&
    green > 155 &&
    blue > 155 &&
    Math.max(red, green, blue) - Math.min(red, green, blue) < 45;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const visitIndex = y * image.width + x;
      if (visited[visitIndex]) continue;
      visited[visitIndex] = 1;
      if (x > image.width * maxXRatio) continue;
      const index = pixelIndex(image.width, x, y);
      if (!isLight(image.data[index], image.data[index + 1], image.data[index + 2])) continue;

      queue.length = 0;
      queue.push([x, y]);
      let queueIndex = 0;
      let area = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (queueIndex < queue.length) {
        const [currentX, currentY] = queue[queueIndex++];
        area += 1;
        sumX += currentX;
        sumY += currentY;
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);
        for (const [nextX, nextY] of [
          [currentX - 1, currentY],
          [currentX + 1, currentY],
          [currentX, currentY - 1],
          [currentX, currentY + 1],
        ] as Array<[number, number]>) {
          if (nextX < 0 || nextY < 0 || nextX >= image.width || nextY >= image.height) continue;
          const nextVisitIndex = nextY * image.width + nextX;
          if (visited[nextVisitIndex]) continue;
          visited[nextVisitIndex] = 1;
          const nextPixelIndex = pixelIndex(image.width, nextX, nextY);
          if (
            isLight(
              image.data[nextPixelIndex],
              image.data[nextPixelIndex + 1],
              image.data[nextPixelIndex + 2],
            )
          ) {
            queue.push([nextX, nextY]);
          }
        }
      }
      const componentWidth = maxX - minX + 1;
      const componentHeight = maxY - minY + 1;
      if (area >= 40 && componentWidth >= 12 && componentHeight >= 12) {
        components.push({
          x: sumX / area,
          y: sumY / area,
          width: componentWidth,
          height: componentHeight,
          area,
        });
      }
    }
  }
  return components;
}

function numberPixelScore(red: number, green: number, blue: number) {
  const brightness = (red + green + blue) / 3;
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
  if (brightness < 115 || chroma > 125) return 0;
  const brightnessScore = Math.min(1, Math.max(0, (brightness - 115) / 125));
  const neutralityScore = Math.min(1, Math.max(0, 1 - Math.max(0, chroma - 30) / 95));
  return brightnessScore * neutralityScore;
}

function isNumberPixel(red: number, green: number, blue: number) {
  return numberPixelScore(red, green, blue) >= 0.42;
}

const fallbackDigitTemplates: Record<string, string[]> = {
  // Keep the middle of 0 open. This is important when anti-aliasing blends
  // the glyph with the changing game background.
  "0": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
};

function normalizeGlyphMask(image: RgbImage, range: [number, number], top: number, bottom: number) {
  const width = range[1] - range[0] + 1;
  const height = bottom - top + 1;
  return Array.from({ length: 35 }, (_, index) => {
    const targetY = Math.floor(index / 5);
    const targetX = index % 5;
    const sourceXStart = range[0] + Math.floor((targetX * width) / 5);
    const sourceXEnd = Math.max(
      sourceXStart + 1,
      range[0] + Math.ceil(((targetX + 1) * width) / 5),
    );
    const sourceYStart = top + Math.floor((targetY * height) / 7);
    const sourceYEnd = Math.max(sourceYStart + 1, top + Math.ceil(((targetY + 1) * height) / 7));
    let ink = 0;
    let samples = 0;
    for (let y = sourceYStart; y < sourceYEnd; y += 1) {
      for (let x = sourceXStart; x < sourceXEnd; x += 1) {
        const pixel = pixelIndex(image.width, x, y);
        ink += numberPixelScore(image.data[pixel], image.data[pixel + 1], image.data[pixel + 2]);
        samples += 1;
      }
    }
    return ink / Math.max(1, samples);
  });
}

function readNumberInSegment(
  image: RgbImage,
  centerY: number,
  halfHeight: number,
  numberStartX: number,
  numberEndX: number,
  calibratedTemplates: DigitTemplate[] = [],
  digitBoxes: NumberDigitBox[] = [],
): NumberReading | null {
  const startX = Math.floor(image.width * (numberStartX / 100));
  const endX = Math.floor(image.width * (numberEndX / 100));
  const startY = Math.max(0, Math.floor(centerY - halfHeight));
  const endY = Math.min(image.height, Math.ceil(centerY + halfHeight));
  const glyphs: Array<{ range: [number, number]; top: number; bottom: number }> = [];
  if (digitBoxes.length > 0) {
    const segmentHeight = halfHeight / 0.48;
    const segmentTop = centerY - segmentHeight / 2;
    for (const box of digitBoxes) {
      const boxStartX = Math.max(0, Math.floor(image.width * (box.x / 100)));
      const boxEndX = Math.min(image.width, Math.ceil(image.width * ((box.x + box.width) / 100)));
      const boxStartY = Math.max(0, Math.floor(segmentTop + segmentHeight * (box.top / 100)));
      const boxEndY = Math.min(
        image.height,
        Math.ceil(segmentTop + segmentHeight * ((box.top + box.height) / 100)),
      );
      let top = boxEndY;
      let bottom = boxStartY;
      let left = boxEndX;
      let right = boxStartX;
      let ink = 0;
      for (let y = boxStartY; y < boxEndY; y += 1) {
        for (let x = boxStartX; x < boxEndX; x += 1) {
          const index = pixelIndex(image.width, x, y);
          const score = numberPixelScore(
            image.data[index],
            image.data[index + 1],
            image.data[index + 2],
          );
          ink += score;
          if (score >= 0.42) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
      const boxWidth = boxEndX - boxStartX;
      const boxHeight = boxEndY - boxStartY;
      if (
        ink >= Math.max(2, boxWidth * boxHeight * 0.04) &&
        left < boxEndX &&
        right >= left &&
        top < boxEndY &&
        bottom >= top &&
        bottom - top + 1 >= 5
      ) {
        glyphs.push({ range: [left, right], top, bottom });
      }
    }
  } else {
    const rowHeight = Math.max(1, endY - startY);
    const columns: number[] = [];
    for (let x = startX; x < endX; x += 1) {
      let ink = 0;
      for (let y = startY; y < endY; y += 1) {
        const index = pixelIndex(image.width, x, y);
        ink += numberPixelScore(image.data[index], image.data[index + 1], image.data[index + 2]);
      }
      // Require vertical evidence so bright background pixels do not become
      // one-pixel glyphs or split a real glyph into fragments.
      if (ink >= Math.max(0.75, rowHeight * 0.06)) columns.push(x);
    }
    if (columns.length === 0) return null;

    const glyphRanges: Array<[number, number]> = [];
    let glyphStart = columns[0];
    let previous = columns[0];
    for (let index = 1; index <= columns.length; index += 1) {
      const current = columns[index];
      if (current !== undefined && current - previous <= 1) {
        previous = current;
        continue;
      }
      glyphRanges.push([glyphStart, previous]);
      glyphStart = current;
      previous = current;
    }

    for (const range of glyphRanges) {
      let top = endY;
      let bottom = startY;
      for (let y = startY; y < endY; y += 1) {
        for (let x = range[0]; x <= range[1]; x += 1) {
          const index = pixelIndex(image.width, x, y);
          if (isNumberPixel(image.data[index], image.data[index + 1], image.data[index + 2])) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
      const width = range[1] - range[0] + 1;
      const height = bottom - top + 1;
      if (width >= 1 && width <= image.width * 0.12 && height >= 5 && height <= halfHeight * 2) {
        glyphs.push({ range, top, bottom });
      }
    }
  }
  if (glyphs.length === 0) return null;

  const glyphSamples = glyphs.map(({ range, top, bottom }) => ({
    x: range[0],
    width: range[1] - range[0] + 1,
    height: bottom - top + 1,
    mask: normalizeGlyphMask(image, range, top, bottom),
  }));
  const templateEntries = [
    ...Object.entries(fallbackDigitTemplates).map(([digit, template]) => ({
      digit,
      mask: template.flatMap((row) => row.split("").map((cell) => (cell === "1" ? 0.72 : 0.06))),
      calibrated: false,
    })),
    ...calibratedTemplates.map((template) => ({
      digit: template.digit,
      mask: template.mask,
      calibrated: true,
    })),
  ];
  let totalConfidence = 0;
  const text = glyphs
    .map(({ range, top, bottom }) => {
      const glyphMask = normalizeGlyphMask(image, range, top, bottom);
      let bestDigit = "?";
      let bestScore = -Infinity;
      let secondBestScore = -Infinity;
      for (const { digit, mask, calibrated } of templateEntries) {
        let error = 0;
        let totalWeight = 0;
        for (let targetY = 0; targetY < 7; targetY += 1) {
          for (let targetX = 0; targetX < 5; targetX += 1) {
            const cellIndex = targetY * 5 + targetX;
            const cellInk = glyphMask[cellIndex];
            const expectedInk = calibrated
              ? Math.max(0, Math.min(1, mask[cellIndex] ?? 0))
              : mask[cellIndex];
            const weight = targetY === 0 || targetY === 6 ? 1.1 : 1;
            error += Math.abs(cellInk - expectedInk) * weight;
            totalWeight += weight;
          }
        }
        const score = 1 - error / (totalWeight * 0.72);
        if (score > bestScore) {
          secondBestScore = bestScore;
          bestScore = score;
          bestDigit = digit;
        } else if (score > secondBestScore) {
          secondBestScore = score;
        }
      }
      totalConfidence += bestScore;
      const margin = bestScore - secondBestScore;
      if (bestScore < 0.42 || (bestScore < 0.58 && margin < 0.04)) return "?";
      return bestDigit === "blank" ? "" : bestDigit;
    })
    .join("");
  return { text, confidence: Math.max(0, totalConfidence / glyphs.length), glyphs: glyphSamples };
}

function buildButtonChecks(
  row: InputDisplayRow,
  image: RgbImage,
  buttonSlotRatios: typeof inputButtonSlotRatios,
  geometryButtonRegionRadius: number,
) {
  const segmentHeight = Math.max(1, row.bottom - row.top);
  const buttonRegionRadius = Math.max(7, image.width * (geometryButtonRegionRadius / 100));
  const buttonColorBySlot: Record<
    (typeof inputButtonSlotRatios)[number]["slot"],
    InputMarkerColor
  > = {
    A: "blue",
    B: "yellow",
    C: "red",
    S: "cyan",
  };
  const candidates = row.markers
    .filter(
      (candidate) =>
        candidate.x > image.width * 0.38 &&
        candidate.area >= 8 &&
        candidate.width >= 3 &&
        candidate.height >= 3 &&
        candidate.fillRatio >= (candidate.color === "yellow" ? 0.42 : 0.25),
    )
    .sort((left, right) => right.area - left.area);
  const assignments = new Map<(typeof inputButtonSlotRatios)[number]["slot"], InputMarker>();
  for (const candidate of candidates) {
    const matchingSlots = buttonSlotRatios.filter(
      ({ slot }) => buttonColorBySlot[slot] === candidate.color,
    );
    if (matchingSlots.length === 0) continue;
    const nearestSlot = matchingSlots.reduce((best, current) => {
      const currentDistance = Math.hypot(
        current.ratio * image.width - candidate.x,
        row.top + current.yRatio * segmentHeight - candidate.y,
      );
      const bestDistance = Math.hypot(
        best.ratio * image.width - candidate.x,
        row.top + best.yRatio * segmentHeight - candidate.y,
      );
      return currentDistance < bestDistance ? current : best;
    });
    const slotDistance = Math.hypot(
      nearestSlot.ratio * image.width - candidate.x,
      row.top + nearestSlot.yRatio * segmentHeight - candidate.y,
    );
    if (slotDistance <= buttonRegionRadius && !assignments.has(nearestSlot.slot)) {
      assignments.set(nearestSlot.slot, candidate);
    }
  }
  return buttonSlotRatios.map(({ slot }) => {
    const marker = assignments.get(slot);
    return {
      slot,
      detected: Boolean(marker),
      confidence: marker
        ? Math.min(1, 0.65 + marker.area / Math.max(1, image.width * image.height * 0.002))
        : 0,
      marker,
    };
  });
}

export function detectInputDisplay(
  image: RgbImage,
  geometry: InputDisplayGeometry = defaultInputDisplayGeometry,
): InputDisplayObservation {
  const markers = mergeNearbyMarkers(
    colorRules.flatMap((rule) => findComponents(image, rule)),
    image,
  );
  const segmentCount = Math.max(1, Math.round(geometry.segmentCount));
  const segmentTop = image.height * (Math.max(0, Math.min(100, geometry.segmentTop)) / 100);
  const segmentHeight = Math.max(1, image.height * (Math.max(0, geometry.segmentHeight) / 100));
  const joystickComponents = findLightComponents(
    image,
    Math.max(0.45, Math.min(0.7, geometry.joystickRegionEndX / 100 + 0.1)),
  );
  const rows = Array.from({ length: segmentCount }, (_, segmentIndex) => {
    const top = segmentTop + segmentIndex * segmentHeight;
    const bottom = top + segmentHeight;
    const center = (top + bottom) / 2;
    const rowMarkers = markers
      .filter((marker) => marker.y >= top && marker.y < bottom)
      .sort((left, right) => left.x - right.x);
    const row: InputDisplayRow = {
      top,
      bottom,
      markers: rowMarkers,
    };
    const joystickComponent = joystickComponents
      .filter((candidate) => candidate.y >= top && candidate.y < bottom)
      .sort((left, right) => Math.abs(left.y - center) - Math.abs(right.y - center))[0];
    const joystickCenterX = joystickComponent?.x ?? image.width * (geometry.joystickCenterX / 100);
    const joystickMarker = rowMarkers
      .filter(
        (marker) =>
          marker.color === "red" &&
          marker.x <= image.width * (geometry.joystickRegionEndX / 100) &&
          Math.abs(marker.x - joystickCenterX) <= image.width * 0.18,
      )
      .sort(
        (left, right) => Math.abs(left.x - joystickCenterX) - Math.abs(right.x - joystickCenterX),
      )[0];
    if (joystickComponent && joystickMarker) {
      row.joystick = {
        centerX: joystickComponent.x,
        centerY: joystickComponent.y,
        width: joystickComponent.width,
        markerX: joystickMarker.x,
        markerY: joystickMarker.y,
      };
    }
    row.joystickCheck = {
      detected: Boolean(joystickMarker),
      confidence: joystickMarker ? (joystickComponent ? 0.95 : 0.7) : joystickComponent ? 0.35 : 0,
      centerX: joystickComponent?.x ?? joystickCenterX,
      centerY: joystickComponent?.y ?? center,
      markerX: joystickMarker?.x,
      markerY: joystickMarker?.y,
    };
    row.buttonChecks = buildButtonChecks(
      row,
      image,
      geometry.buttonSlotRatios,
      geometry.buttonRegionRadius,
    );
    const acceptedMarkers = new Set<InputMarker>();
    if (joystickMarker) acceptedMarkers.add(joystickMarker);
    row.buttonChecks.forEach((check) => {
      if (check.marker) acceptedMarkers.add(check.marker);
    });
    // Keep only blobs that belong to a fixed control location. Components
    // elsewhere in the ROI are background/debug-art noise, not input data.
    row.markers = rowMarkers.filter((marker) => acceptedMarkers.has(marker));
    row.numberReading =
      readNumberInSegment(
        image,
        center,
        segmentHeight * 0.48,
        geometry.numberStartX,
        geometry.numberEndX,
        geometry.digitTemplates,
        (geometry.numberDigitXs ?? []).map((x) => ({
          x,
          width: geometry.numberDigitWidth ?? 8,
          top: geometry.numberDigitTop ?? 10,
          height: geometry.numberDigitHeight ?? 80,
        })),
      ) ?? undefined;
    return row;
  });

  return {
    width: image.width,
    height: image.height,
    // The game appends newer input rows at the bottom. Expose newest first so
    // the resolver does not confuse a scrolling history with a new move.
    rows: rows.reverse(),
  };
}

export function formatInputDisplayObservation(observation: InputDisplayObservation) {
  return observation.rows
    .map(
      (row, index) =>
        `r${index}:` +
        row.markers
          // Row index and horizontal marker positions are stable as the history
          // scrolls; absolute Y positions are not.
          .map((marker) => `${marker.color}@${Math.round(marker.x)}`)
          .join(" "),
    )
    .join(" | ");
}

export function formatInputDisplayDebug(observation: InputDisplayObservation) {
  return observation.rows
    .map((row, index) => {
      const buttons =
        row.buttonChecks
          ?.filter((check) => check.detected && check.marker)
          .map((check) => `${check.slot}:${check.marker?.color}`)
          .join(",") || "-";
      const joystick = row.joystickCheck
        ? `${row.joystickCheck.detected ? "ok" : "-"}@${Math.round(row.joystickCheck.centerX)},${Math.round(row.joystickCheck.centerY)}`
        : "-";
      const number = row.numberReading
        ? `${row.numberReading.text}(${row.numberReading.confidence.toFixed(2)})`
        : "-";
      return `r${index} j=${joystick} b=${buttons} n=${number}`;
    })
    .join(" | ");
}

const buttonByColor: Record<InputMarkerColor, string> = {
  blue: "A",
  yellow: "B",
  red: "C",
  cyan: "S",
};

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Resolve the newest visible input row into fighting-game notation.
 *
 * The current display layout puts the joystick marker on the left and button
 * markers to its right. The joystick marker is compared with the detected
 * white circle center and converted to standard numpad notation.
 */
function resolveInputRow(
  observation: InputDisplayObservation,
  row: InputDisplayRow | undefined,
): ResolvedInput | null {
  if (!row || row.markers.length === 0) return null;

  const joystickCenterX =
    row.joystick?.centerX ??
    median(
      observation.rows
        .flatMap((candidateRow) => candidateRow.markers)
        .filter((marker) => marker.color === "red" && marker.x <= observation.width * 0.55)
        .map((marker) => marker.x),
    );
  const fallbackJoystickMarker = row.markers.find(
    (marker) => marker.color === "red" && marker.x <= observation.width * 0.55,
  );
  const joystickCenterY = row.joystick?.centerY ?? fallbackJoystickMarker?.y ?? row.top;
  const joystickMarkerX = row.joystick?.markerX;
  const joystickMarkerY = row.joystick?.markerY;
  const joystickRadius = row.joystick?.width ?? observation.width * 0.1;
  const buttonThreshold =
    joystickCenterX + Math.max(joystickRadius * 0.75, observation.width * 0.08);
  const checkedButtonMarkers = row.buttonChecks
    ?.filter((check) => check.detected && check.marker)
    .map((check) => check.marker as InputMarker);
  const buttonMarkers = row.buttonChecks
    ? (checkedButtonMarkers ?? [])
    : row.markers.filter((marker) => marker.x > buttonThreshold);
  const buttons = buttonMarkers
    .sort((left, right) => left.x - right.x)
    .map((marker) => buttonByColor[marker.color]);
  const joystickMarker = row.joystick
    ? { x: joystickMarkerX ?? joystickCenterX, y: joystickMarkerY ?? joystickCenterY }
    : row.markers
        .filter((marker) => marker.color === "red" && marker.x <= buttonThreshold)
        .sort(
          (left, right) => Math.abs(left.x - joystickCenterX) - Math.abs(right.x - joystickCenterX),
        )[0];
  const threshold = Math.max(4, joystickRadius * 0.18);
  const horizontal = joystickMarker
    ? joystickMarker.x - joystickCenterX > threshold
      ? "6"
      : joystickMarker.x - joystickCenterX < -threshold
        ? "4"
        : ""
    : "";
  const vertical = joystickMarker
    ? joystickMarker.y - joystickCenterY > threshold
      ? "2"
      : joystickMarker.y - joystickCenterY < -threshold
        ? "8"
        : ""
    : "";
  const direction =
    vertical === "2" && horizontal === "4"
      ? "1"
      : vertical === "2" && horizontal === "6"
        ? "3"
        : vertical === "8" && horizontal === "4"
          ? "7"
          : vertical === "8" && horizontal === "6"
            ? "9"
            : vertical || horizontal || "5";
  if (!joystickMarker && buttons.length === 0) return null;
  const notation = `${direction}${buttons.join("")}`;
  const confidence = (joystickMarker ? 0.7 : 0.2) + (buttons.length > 0 ? 0.25 : 0.05);
  return { notation, direction, buttons, confidence: Math.min(1, confidence) };
}

const motionPatterns = [
  "236236",
  "214214",
  "63214",
  "41236",
  "623",
  "421",
  "236",
  "214",
  "22",
  "66",
];

function compactDirectionHistory(rows: Array<ResolvedInput | null>) {
  const directions: string[] = [];
  let neutralSinceLastDirection = false;
  rows.forEach((resolved) => {
    if (!resolved || resolved.direction === "5") {
      neutralSinceLastDirection = true;
      return;
    }
    const previous = directions.at(-1);
    if (previous !== resolved.direction || neutralSinceLastDirection) {
      directions.push(resolved.direction);
    }
    neutralSinceLastDirection = false;
  });
  return directions.join("");
}

function findMotionSuffix(directionHistory: string) {
  return motionPatterns.find((pattern) => directionHistory.endsWith(pattern)) ?? null;
}

export function resolveNewestInput(observation: InputDisplayObservation): ResolvedInput | null {
  return resolveInputRow(observation, observation.rows[0]);
}

/**
 * Resolve the most recent button-bearing input in the visible history.
 *
 * The game appends new rows at the bottom, so rows[0] is the newest row. A
 * button can be visible for several input-history rows while the framebar is
 * entering startup; scan that short window in newest-first order rather than
 * assuming the button must still be in r0.
 */
export function resolveRecentInput(
  observation: InputDisplayObservation,
  maxRows = 6,
): ResolvedInput | null {
  const rowLimit = Math.min(Math.max(1, Math.round(maxRows)), observation.rows.length);
  let buttonRowIndex = -1;
  let buttonInput: ResolvedInput | null = null;
  const resolvedRows = observation.rows.map((row) => resolveInputRow(observation, row));
  for (let rowIndex = 0; rowIndex < rowLimit; rowIndex += 1) {
    const resolved = resolvedRows[rowIndex];
    if (!resolved) continue;
    if (resolved.buttons.length > 0) {
      buttonRowIndex = rowIndex;
      buttonInput = { ...resolved, rowIndex };
      break;
    }
  }
  if (!buttonInput) {
    const newestDirectionalIndex = resolvedRows.findIndex((resolved) => resolved !== null);
    const newestDirectionalInput =
      newestDirectionalIndex >= 0 ? resolvedRows[newestDirectionalIndex] : null;
    return newestDirectionalInput
      ? { ...newestDirectionalInput, rowIndex: newestDirectionalIndex }
      : null;
  }

  // Rows are newest-first. Reverse the rows from the oldest visible segment
  // through the button row so the input sequence is read chronologically. A
  // bounded window prevents an old motion elsewhere in the 13-row history
  // from being paired with a new button.
  const motionHistoryLimit = 8;
  const historyStart = Math.min(
    observation.rows.length - 1,
    buttonRowIndex + motionHistoryLimit - 1,
  );
  const motionRows: Array<ResolvedInput | null> = [];
  for (let rowIndex = historyStart; rowIndex >= buttonRowIndex; rowIndex -= 1) {
    motionRows.push(resolvedRows[rowIndex]);
  }
  const motion = findMotionSuffix(compactDirectionHistory(motionRows));
  const direction = motion ?? buttonInput.direction;
  return {
    ...buttonInput,
    direction,
    notation: `${direction}${buttonInput.buttons.join("")}`,
    confidence: Math.min(1, buttonInput.confidence + (motion ? 0.05 : 0)),
  };
}
