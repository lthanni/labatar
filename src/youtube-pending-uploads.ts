export type PendingYouTubeUpload = {
  recordingId: string;
  fileName: string;
  url: string;
};

const storageKey = "labatar.youtube-pending-uploads";
const legacyPrefix = "labatar.youtube-pending-upload.";
export const pendingYouTubeUploadsChangedEvent = "labatar:youtube-pending-uploads-changed";

export function readPendingYouTubeUploads(): PendingYouTubeUpload[] {
  const uploads = new Map<string, PendingYouTubeUpload>();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
    if (Array.isArray(saved)) {
      for (const item of saved) {
        if (
          item &&
          typeof item === "object" &&
          typeof item.recordingId === "string" &&
          typeof item.fileName === "string" &&
          typeof item.url === "string" &&
          item.url.startsWith("https://www.youtube.com/watch?v=")
        ) {
          uploads.set(item.recordingId, item as PendingYouTubeUpload);
        }
      }
    }
  } catch {
    // Older per-recording links can still be read below.
  }
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(legacyPrefix)) continue;
      const recordingId = key.slice(legacyPrefix.length);
      const url = localStorage.getItem(key);
      if (url?.startsWith("https://www.youtube.com/watch?v=") && !uploads.has(recordingId)) {
        uploads.set(recordingId, {
          recordingId,
          fileName: recordingId.split(/[\\/]/).pop() || recordingId,
          url,
        });
      }
    }
  } catch {
    // A missing browser store should not block the recordings view.
  }
  return [...uploads.values()];
}

export function pendingYouTubeUploadUrl(recordingId: string): string | null {
  return readPendingYouTubeUploads().find((item) => item.recordingId === recordingId)?.url ?? null;
}

export function savePendingYouTubeUpload(upload: PendingYouTubeUpload): void {
  const uploads = readPendingYouTubeUploads().filter(
    (item) => item.recordingId !== upload.recordingId,
  );
  uploads.push(upload);
  localStorage.setItem(storageKey, JSON.stringify(uploads));
  localStorage.removeItem(`${legacyPrefix}${upload.recordingId}`);
  window.dispatchEvent(new Event(pendingYouTubeUploadsChangedEvent));
}

export function forgetPendingYouTubeUpload(recordingId: string): void {
  const uploads = readPendingYouTubeUploads().filter((item) => item.recordingId !== recordingId);
  localStorage.setItem(storageKey, JSON.stringify(uploads));
  localStorage.removeItem(`${legacyPrefix}${recordingId}`);
  window.dispatchEvent(new Event(pendingYouTubeUploadsChangedEvent));
}
