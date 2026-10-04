import type { RecordingAnalysisHitbox } from "./recording-analysis-types";

type OverlayColor = {
  kind: string;
  matches: (red: number, green: number, blue: number) => boolean;
};

const overlayColors: OverlayColor[] = [
  {
    kind: "overlay-red",
    matches: (red, green, blue) => red - green >= 28 && red - blue >= 25,
  },
  {
    kind: "overlay-yellow",
    matches: (red, green, blue) =>
      red - blue >= 35 && green - blue >= 25 && Math.abs(red - green) <= 105,
  },
  {
    kind: "overlay-green",
    matches: (red, green, blue) => green - red >= 30 && green - blue >= 25,
  },
  {
    kind: "overlay-blue",
    matches: (red, green, blue) => blue - red >= 30 && blue - green >= 20,
  },
];

const SAMPLE_STEP = 2;
const MIN_COMPONENT_SAMPLES = 24;
const MIN_BOX_WIDTH_RATIO = 0.04;
const MIN_BOX_HEIGHT_RATIO = 0.03;
const MIN_RECTANGULARITY = 0.2;
const MIN_OUTLINE_EDGE_SUPPORT = 0.3;
const MIN_FIELD_TOP_RATIO = 0.18;
const MAX_FIELD_BOTTOM_RATIO = 0.9;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function componentBox(
  kind: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  area: number,
  width: number,
  height: number,
  matches: (gridX: number, gridY: number) => boolean,
): RecordingAnalysisHitbox | null {
  const boxWidth = (maxX - minX + 1) * SAMPLE_STEP;
  const boxHeight = (maxY - minY + 1) * SAMPLE_STEP;
  if (boxWidth < width * MIN_BOX_WIDTH_RATIO || boxHeight < height * MIN_BOX_HEIGHT_RATIO) {
    return null;
  }
  if (
    minY * SAMPLE_STEP < height * MIN_FIELD_TOP_RATIO ||
    (maxY + 1) * SAMPLE_STEP > height * MAX_FIELD_BOTTOM_RATIO
  ) {
    return null;
  }
  if (minX * SAMPLE_STEP < width * 0.01 || (maxX + 1) * SAMPLE_STEP > width * 0.99) {
    return null;
  }

  const rectangularity = area / Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
  const horizontalEdgeSupport =
    Array.from({ length: maxX - minX + 1 }, (_, index) => minX + index).filter(
      (gridX) => matches(gridX, minY) || matches(gridX, maxY),
    ).length / Math.max(1, maxX - minX + 1);
  const verticalEdgeSupport =
    Array.from({ length: maxY - minY + 1 }, (_, index) => minY + index).filter(
      (gridY) => matches(minX, gridY) || matches(maxX, gridY),
    ).length / Math.max(1, maxY - minY + 1);
  const filledShape = rectangularity >= MIN_RECTANGULARITY;
  const outlinedShape =
    horizontalEdgeSupport >= MIN_OUTLINE_EDGE_SUPPORT &&
    verticalEdgeSupport >= MIN_OUTLINE_EDGE_SUPPORT;
  if (!filledShape && !outlinedShape) return null;

  return {
    x: (minX * SAMPLE_STEP * 100) / width,
    y: (minY * SAMPLE_STEP * 100) / height,
    width: (boxWidth * 100) / width,
    height: (boxHeight * 100) / height,
    kind,
    confidence: clamp(
      filledShape
        ? 0.35 + rectangularity * 0.65
        : 0.25 + (horizontalEdgeSupport + verticalEdgeSupport) * 0.375,
      0,
      1,
    ),
  };
}

export function detectVisibleHitboxesFromPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): RecordingAnalysisHitbox[] {
  const gridWidth = Math.ceil(width / SAMPLE_STEP);
  const gridHeight = Math.ceil(height / SAMPLE_STEP);
  const boxes: RecordingAnalysisHitbox[] = [];

  for (const overlayColor of overlayColors) {
    const visited = new Uint8Array(gridWidth * gridHeight);
    const matches = (gridX: number, gridY: number) => {
      const x = Math.min(width - 1, gridX * SAMPLE_STEP + Math.floor(SAMPLE_STEP / 2));
      const y = Math.min(height - 1, gridY * SAMPLE_STEP + Math.floor(SAMPLE_STEP / 2));
      const offset = (y * width + x) * 4;
      return overlayColor.matches(
        pixels[offset] ?? 0,
        pixels[offset + 1] ?? 0,
        pixels[offset + 2] ?? 0,
      );
    };

    for (let startY = 0; startY < gridHeight; startY += 1) {
      for (let startX = 0; startX < gridWidth; startX += 1) {
        const startIndex = startY * gridWidth + startX;
        if (visited[startIndex] || !matches(startX, startY)) continue;
        visited[startIndex] = 1;
        const queue: Array<[number, number]> = [[startX, startY]];
        let area = 0;
        let minX = startX;
        let maxX = startX;
        let minY = startY;
        let maxY = startY;

        while (queue.length > 0) {
          const [x, y] = queue.pop()!;
          area += 1;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          const neighbors = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ] as const;
          for (const [nextX, nextY] of neighbors) {
            if (nextX < 0 || nextY < 0 || nextX >= gridWidth || nextY >= gridHeight) {
              continue;
            }
            const nextIndex = nextY * gridWidth + nextX;
            if (visited[nextIndex] || !matches(nextX, nextY)) continue;
            visited[nextIndex] = 1;
            queue.push([nextX, nextY]);
          }
        }

        if (area < MIN_COMPONENT_SAMPLES) continue;
        const box = componentBox(
          overlayColor.kind,
          minX,
          minY,
          maxX,
          maxY,
          area,
          width,
          height,
          matches,
        );
        if (box) boxes.push(box);
      }
    }
  }

  return boxes.sort((left, right) => {
    const leftArea = left.width * left.height;
    const rightArea = right.width * right.height;
    return rightArea - leftArea;
  });
}

export function detectVisibleHitboxes(image: ImageData): RecordingAnalysisHitbox[] {
  return detectVisibleHitboxesFromPixels(image.data, image.width, image.height);
}
