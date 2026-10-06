const manualChapterTitle = /^Unnamed\s+\d+$/i;

function planManualChapterClips(chapters, durationMs, clipLengthMs = 30_000) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("The MP4 has no playable duration for chapter clips.");
  }
  if (!Number.isFinite(clipLengthMs) || clipLengthMs <= 0) {
    throw new Error("The chapter clip length is invalid.");
  }

  const seenStarts = new Set();
  return (Array.isArray(chapters) ? chapters : [])
    .filter((chapter) => manualChapterTitle.test(String(chapter?.title ?? "")))
    .map((chapter) => Number(chapter.startMs))
    .filter((startMs) => Number.isFinite(startMs) && startMs > 0 && startMs < durationMs)
    .sort((left, right) => left - right)
    .filter((startMs) => {
      if (seenStarts.has(startMs)) return false;
      seenStarts.add(startMs);
      return true;
    })
    .map((startMs) => ({
      chapterStartMs: startMs,
      startTime: Math.max(0, startMs - clipLengthMs) / 1000,
      endTime: startMs / 1000,
    }));
}

async function createMissingManualChapterClips(
  chapters,
  durationMs,
  existingStarts,
  exportClip,
  onProgress = () => {},
) {
  const planned = planManualChapterClips(chapters, durationMs);
  const seenStarts = new Set(existingStarts);
  const result = { total: planned.length, created: 0, alreadyExisting: 0, failures: [] };
  for (const [index, range] of planned.entries()) {
    if (seenStarts.has(range.chapterStartMs)) {
      result.alreadyExisting += 1;
      onProgress({ index: index + 1, total: planned.length, range, phase: "existing" });
      continue;
    }
    onProgress({ index: index + 1, total: planned.length, range, phase: "creating" });
    try {
      await exportClip(range);
      seenStarts.add(range.chapterStartMs);
      result.created += 1;
      onProgress({ index: index + 1, total: planned.length, range, phase: "created" });
    } catch (error) {
      result.failures.push({
        chapterStartMs: range.chapterStartMs,
        error: error instanceof Error ? error.message : String(error),
      });
      onProgress({ index: index + 1, total: planned.length, range, phase: "failed" });
    }
  }
  return result;
}

module.exports = { planManualChapterClips, createMissingManualChapterClips };
