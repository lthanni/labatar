import type { RecordedVideo } from "./recording-types";

export type LocalVideo = { id: string; fileName: string };
export type VideoSelection =
  | { kind: "recording"; recording: RecordedVideo }
  | { kind: "local"; video: LocalVideo; youtubeUrl?: string }
  | { kind: "youtube"; url: string };

export function videoSelectionKey(selection: VideoSelection): string {
  if (selection.kind === "recording") return `recording:${selection.recording.id}`;
  if (selection.kind === "local") return `local:${selection.video.id}`;
  return `youtube:${selection.url}`;
}

export function videoSelectionLabel(selection: VideoSelection): string {
  if (selection.kind === "recording") return selection.recording.name;
  if (selection.kind === "local") return selection.video.fileName;
  return selection.url;
}

export function attachmentVideoSelection(video: {
  url: string;
  localVideoId?: string;
  localFileName?: string;
}): VideoSelection | null {
  if (video.localVideoId)
    return {
      kind: "local",
      video: { id: video.localVideoId, fileName: video.localFileName || "Local MP4" },
      youtubeUrl: video.url || undefined,
    };
  return video.url ? { kind: "youtube", url: video.url } : null;
}

export function attachmentVideoSource(selection: VideoSelection | null): {
  url: string;
  localVideoId?: string;
  localFileName?: string;
} {
  if (selection?.kind === "local")
    return {
      url: selection.youtubeUrl ?? "",
      localVideoId: selection.video.id,
      localFileName: selection.video.fileName,
    };
  return {
    url: selection?.kind === "youtube" ? selection.url : "",
    localVideoId: undefined,
    localFileName: undefined,
  };
}
