import { expect, it } from "vite-plus/test";
import {
  attachmentVideoSelection,
  attachmentVideoSource,
  videoSelectionKey,
} from "./video-selection";

it("restores a saved local attachment and its already uploaded YouTube URL", () => {
  const saved = {
    url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    localVideoId: "local-id",
    localFileName: "demo.mp4",
  };
  const selected = attachmentVideoSelection(saved);
  expect(selected?.kind).toBe("local");
  expect(attachmentVideoSource(selected)).toEqual(saved);
});

it("switching an attachment from an MP4 to YouTube clears the old file reference", () => {
  const saved = {
    title: "Demo",
    description: "Timing",
    url: "",
    localVideoId: "old-id",
    localFileName: "old.mp4",
  };
  const next = {
    ...saved,
    ...attachmentVideoSource({ kind: "youtube", url: "https://youtu.be/M7lc1UVf-VE" }),
  };
  expect(JSON.parse(JSON.stringify(next))).toEqual({
    title: "Demo",
    description: "Timing",
    url: "https://youtu.be/M7lc1UVf-VE",
  });
  expect(JSON.parse(JSON.stringify({ ...saved, ...attachmentVideoSource(null) }))).toEqual({
    title: "Demo",
    description: "Timing",
    url: "",
  });
});

it("keeps attachment identity separate from its filename", () => {
  const first = { kind: "local" as const, video: { id: "first", fileName: "demo.mp4" } };
  const second = { kind: "local" as const, video: { id: "second", fileName: "demo.mp4" } };
  expect(videoSelectionKey(first)).not.toBe(videoSelectionKey(second));
  expect(attachmentVideoSelection({ url: "" })).toBeNull();
});
