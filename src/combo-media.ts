import type { ComboItem, ComboRecordingLink } from "./combo-gameplan";
import type { RecordedVideo } from "./recording-types";
import { youtubeVideoId } from "./YouTubeRecordingPlayer";

export type ComboMediaGap = "No video" | "No YouTube video" | null;

export type ComboYouTubeVideo = {
  url: string;
  videoId: string | null;
  source: "Local combo" | "Candidate" | "Linked recording" | "Catalog";
  startSeconds: number;
};

export function comboYouTubeVideo(
  item: ComboItem,
  linkedYouTubeUrl: string | null | undefined = "",
): ComboYouTubeVideo | null {
  const sources = [
    { url: item.local?.youtubeUrl, source: "Local combo" as const, startSeconds: 0 },
    { url: item.candidate?.youtubeUrl, source: "Candidate" as const, startSeconds: 0 },
    { url: linkedYouTubeUrl, source: "Linked recording" as const, startSeconds: 0 },
    {
      url: item.local?.publishedBase?.youtubeVideoId
        ? `https://www.youtube.com/watch?v=${item.local.publishedBase.youtubeVideoId}`
        : "",
      source: "Catalog" as const,
      startSeconds: item.local?.publishedBase?.startSeconds ?? 0,
    },
    {
      url: item.published?.youtubeVideoId
        ? `https://www.youtube.com/watch?v=${item.published.youtubeVideoId}`
        : "",
      source: "Catalog" as const,
      startSeconds: item.published?.startSeconds ?? 0,
    },
  ];
  const chosen = sources.find((source) => source.url?.trim());
  if (!chosen) return null;
  const url = chosen.url!.trim();
  return {
    url,
    videoId: youtubeVideoId(url),
    source: chosen.source,
    startSeconds: chosen.startSeconds,
  };
}

export function isLocalMp4(recording: RecordedVideo): boolean {
  return recording.mediaKind === "local" && /\.mp4$/i.test(recording.name);
}

export function mediaGap(hasLocalMp4: boolean, hasYouTubeVideo: boolean): ComboMediaGap {
  if (!hasLocalMp4 && !hasYouTubeVideo) return "No video";
  if (!hasYouTubeVideo) return "No YouTube video";
  return null;
}

export function comboMediaGap(
  item: ComboItem,
  link: ComboRecordingLink | undefined,
  recording: RecordedVideo | null,
  recordingsLoaded: boolean,
  pendingYouTubeUrl = "",
): ComboMediaGap {
  if (item.candidate)
    return mediaGap(
      item.candidate.status !== "rejected" && item.candidate.status !== "uploaded",
      Boolean(comboYouTubeVideo(item, recording?.youtubeUrl || pendingYouTubeUrl)?.videoId),
    );
  const hasLocalMp4 =
    Boolean(recording && isLocalMp4(recording)) || Boolean(link && !recordingsLoaded);
  const hasYouTubeVideo = Boolean(
    comboYouTubeVideo(item, recording?.youtubeUrl || pendingYouTubeUrl)?.videoId,
  );
  return mediaGap(hasLocalMp4, hasYouTubeVideo);
}
