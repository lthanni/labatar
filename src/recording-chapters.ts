export type RecordingChapter = { startMs: number; title: string };

export type TimelineChapterMarker = {
  time: number;
  positionPercent: number;
  titles: string[];
  gameStart: boolean;
};

export function timelineChapterMarkers(
  chapters: RecordingChapter[],
  durationSeconds: number,
): TimelineChapterMarker[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const durationMs = durationSeconds * 1000;
  const sorted = chapters
    .filter(
      (chapter) =>
        Number.isFinite(chapter.startMs) && chapter.startMs >= 0 && chapter.startMs <= durationMs,
    )
    .sort((left, right) => left.startMs - right.startMs);
  const markers: TimelineChapterMarker[] = [];
  for (const chapter of sorted) {
    const previous = markers.at(-1);
    if (previous && Math.abs(chapter.startMs / 1000 - previous.time) < 0.5) {
      previous.titles.push(chapter.title.trim() || "Untitled chapter");
      previous.gameStart ||= /^Labatar Game \d+/.test(chapter.title);
      continue;
    }
    markers.push({
      time: chapter.startMs / 1000,
      positionPercent: Math.min(99.5, Math.max(0.5, (chapter.startMs / durationMs) * 100)),
      titles: [chapter.title.trim() || "Untitled chapter"],
      gameStart: /^Labatar Game \d+/.test(chapter.title),
    });
  }
  return markers;
}
