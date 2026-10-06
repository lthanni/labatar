import type { RecordedVideo } from "./recording-types";

export type RecordingDisplayRow = {
  recording: RecordedVideo;
  depth: number;
};

export function buildRecordingDisplayRows(
  recordings: RecordedVideo[],
  showFullRecordings: boolean,
  showClips: boolean,
): RecordingDisplayRow[] {
  const visible = recordings.filter(
    (recording) =>
      (showFullRecordings && !recording.clip) || (showClips && Boolean(recording.clip)),
  );
  const ungrouped = visible.map((recording) => ({ recording, depth: 0 }));
  if (!showFullRecordings || !showClips) return ungrouped;

  const clipsBySource = new Map<string, RecordedVideo[]>();
  for (const recording of visible) {
    const sourceId = recording.clip?.sourceRecordingId;
    if (!sourceId) continue;
    const sourceClips = clipsBySource.get(sourceId) ?? [];
    sourceClips.push(recording);
    clipsBySource.set(sourceId, sourceClips);
  }

  const grouped: RecordingDisplayRow[] = [];
  const emitted = new Set<string>();
  const appendChildren = (sourceId: string, depth: number, ancestors: Set<string>) => {
    for (const clip of clipsBySource.get(sourceId) ?? []) {
      if (emitted.has(clip.id) || ancestors.has(clip.id)) continue;
      emitted.add(clip.id);
      grouped.push({ recording: clip, depth });
      appendChildren(clip.id, depth + 1, new Set([...ancestors, clip.id]));
    }
  };

  for (const recording of visible) {
    if (recording.clip) continue;
    emitted.add(recording.id);
    grouped.push({ recording, depth: 0 });
    appendChildren(recording.id, 1, new Set([recording.id]));
  }

  // Keep clips whose source is filtered out, missing, or part of a malformed
  // cycle visible instead of silently dropping them from the selector.
  for (const recording of visible) {
    if (recording.clip && !emitted.has(recording.id)) {
      emitted.add(recording.id);
      grouped.push({ recording, depth: 0 });
      appendChildren(recording.id, 1, new Set([recording.id]));
    }
  }
  return grouped;
}

export function collapseRecordingDisplayRows(
  rows: RecordingDisplayRow[],
  collapsedIds: ReadonlySet<string>,
): RecordingDisplayRow[] {
  const visible: RecordingDisplayRow[] = [];
  let hiddenBelowDepth: number | null = null;
  for (const row of rows) {
    if (hiddenBelowDepth !== null) {
      if (row.depth > hiddenBelowDepth) continue;
      hiddenBelowDepth = null;
    }
    visible.push(row);
    if (collapsedIds.has(row.recording.id)) hiddenBelowDepth = row.depth;
  }
  return visible;
}

export function descendantClipRanges(
  recordings: RecordedVideo[],
  selectedRecordingId: string,
  duration: number,
): Array<[number, number]> {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const clipsBySource = new Map<string, RecordedVideo[]>();
  for (const recording of recordings) {
    const sourceId = recording.clip?.sourceRecordingId;
    if (!sourceId) continue;
    const sourceClips = clipsBySource.get(sourceId) ?? [];
    sourceClips.push(recording);
    clipsBySource.set(sourceId, sourceClips);
  }

  const ranges: Array<[number, number]> = [];
  const visit = (sourceId: string, offset: number, ancestors: Set<string>) => {
    for (const clip of clipsBySource.get(sourceId) ?? []) {
      if (ancestors.has(clip.id)) continue;
      const startTime = Number(clip.clip?.startTime);
      const endTime = Number(clip.clip?.endTime);
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
        continue;
      }

      const absoluteStart = offset + startTime;
      const absoluteEnd = offset + endTime;
      const start = Math.max(0, Math.min(duration, absoluteStart));
      const end = Math.max(0, Math.min(duration, absoluteEnd));
      if (end > start) ranges.push([start, end]);
      visit(clip.id, absoluteStart, new Set([...ancestors, clip.id]));
    }
  };
  visit(selectedRecordingId, 0, new Set([selectedRecordingId]));

  ranges.sort(([left], [right]) => left - right);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
