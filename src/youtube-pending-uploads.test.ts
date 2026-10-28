import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  pendingYouTubeUploadsFromWork,
  readPendingYouTubeUploads,
  savePendingYouTubeUpload,
} from "./youtube-pending-uploads";

afterEach(() => vi.unstubAllGlobals());

it("recovers a completed upload after the page refreshes during upload", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });

  const work = {
    kind: "youtube-upload",
    recordingId: "match.mp4",
    fileName: "match.mp4",
    url: "https://www.youtube.com/watch?v=uploaded123",
  };
  expect(pendingYouTubeUploadsFromWork([{ ...work, phase: "uploading" }])).toEqual([]);
  expect(readPendingYouTubeUploads()).toEqual([]);

  const completed = pendingYouTubeUploadsFromWork([{ ...work, phase: "ready" }]);
  expect(completed).toEqual([
    { recordingId: work.recordingId, fileName: work.fileName, url: work.url },
  ]);
  savePendingYouTubeUpload(completed[0]);
  expect(readPendingYouTubeUploads()).toEqual(completed);
});
