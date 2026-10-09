import type { RecordedVideo, RecordingTags } from "./recording-types";

export type RecordingDisplayRow = {
  recording: RecordedVideo;
  depth: number;
};

export function recordingInheritedTags(
  recording: RecordedVideo,
  byId: ReadonlyMap<string, RecordedVideo>,
): RecordingTags {
  const tags: RecordingTags = { match: [], lab: [], combo: false, pressure: false };
  const seen = new Set<string>();
  let current: RecordedVideo | undefined = recording;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    for (const match of current.tags.match) {
      if (!tags.match.includes(match)) tags.match.push(match);
    }
    for (const lab of current.tags.lab) {
      if (!tags.lab.includes(lab)) tags.lab.push(lab);
    }
    tags.combo ||= current.tags.combo;
    tags.pressure ||= current.tags.pressure;
    current = current.clip ? byId.get(current.clip.sourceRecordingId) : undefined;
  }
  return tags;
}

export function recordingLibraryTab(
  recording: RecordedVideo,
  byId: ReadonlyMap<string, RecordedVideo>,
): "matches" | "other" {
  const seen = new Set<string>();
  let root = recording;
  while (root.clip && !seen.has(root.id)) {
    seen.add(root.id);
    const parent = byId.get(root.clip.sourceRecordingId);
    if (!parent || seen.has(parent.id)) break;
    root = parent;
  }
  return root.tags.match.length || root.games.length ? "matches" : "other";
}

export function buildRecordingDisplayRows(recordings: RecordedVideo[]): RecordingDisplayRow[] {
  const clipsBySource = new Map<string, RecordedVideo[]>();
  for (const recording of recordings) {
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

  for (const recording of recordings) {
    if (recording.clip) continue;
    emitted.add(recording.id);
    grouped.push({ recording, depth: 0 });
    appendChildren(recording.id, 1, new Set([recording.id]));
  }

  // Keep clips whose source is filtered out, missing, or part of a malformed
  // cycle visible instead of silently dropping them from the selector.
  for (const recording of recordings) {
    if (recording.clip && !emitted.has(recording.id)) {
      emitted.add(recording.id);
      grouped.push({ recording, depth: 0 });
      appendChildren(recording.id, 1, new Set([recording.id]));
    }
  }
  return grouped;
}

export function countRecordingClips(rows: RecordingDisplayRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  const ancestors: RecordingDisplayRow[] = [];
  for (const row of rows) {
    while (ancestors.length && ancestors.at(-1)!.depth >= row.depth) ancestors.pop();
    if (row.recording.clip) {
      for (const ancestor of ancestors) {
        counts.set(ancestor.recording.id, (counts.get(ancestor.recording.id) ?? 0) + 1);
      }
    }
    ancestors.push(row);
  }
  return counts;
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
