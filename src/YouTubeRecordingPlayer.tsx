import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

type YouTubePlayerInstance = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
};

type YouTubeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      events: {
        onReady: () => void;
        onStateChange: (event: { data: number }) => void;
        onError: (event: { data: number }) => void;
      };
    },
  ) => YouTubePlayerInstance;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("The YouTube player did not initialize."));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("The YouTube player could not be loaded."));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    apiPromise = null;
    throw error;
  });
  return apiPromise;
}

export function youtubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
      return null;
    }
    const id =
      parsed.hostname === "youtu.be" || parsed.hostname === "www.youtu.be"
        ? /^\/([A-Za-z0-9_-]{11})\/?$/.exec(parsed.pathname)?.[1]
        : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(parsed.hostname)
          ? parsed.pathname === "/watch"
            ? parsed.searchParams.get("v")
            : /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(parsed.pathname)?.[1]
          : null;
    return /^[A-Za-z0-9_-]{11}$/.test(id ?? "") ? (id ?? null) : null;
  } catch {
    return null;
  }
}

export type YouTubePlaybackHandle = {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
};

export const YouTubeRecordingPlayer = forwardRef<
  YouTubePlaybackHandle,
  {
    videoId: string;
    title: string;
    onDuration?: (seconds: number) => void;
    onTime?: (seconds: number) => void;
    onPlayingChange?: (playing: boolean) => void;
    onError?: (message: string) => void;
  }
>(function YouTubeRecordingPlayer(
  { videoId, title, onDuration, onTime, onPlayingChange, onError },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const callbacks = useRef({ onDuration, onTime, onPlayingChange, onError });
  callbacks.current = { onDuration, onTime, onPlayingChange, onError };

  useImperativeHandle(ref, () => ({
    play: () => playerRef.current?.playVideo(),
    pause: () => playerRef.current?.pauseVideo(),
    seekTo: (seconds) => playerRef.current?.seekTo(seconds, true),
    getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
  }));

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let reportedDuration = 0;
    let reportedTime = -1;
    const host = hostRef.current;
    if (!host) return;
    const frame = document.createElement("iframe");
    const origin = window.location.origin;
    const playerUrl = new URL(`https://www.youtube.com/embed/${videoId}`);
    playerUrl.searchParams.set("enablejsapi", "1");
    playerUrl.searchParams.set("controls", "1");
    playerUrl.searchParams.set("playsinline", "1");
    if (origin.startsWith("http")) playerUrl.searchParams.set("origin", origin);
    frame.title = title;
    frame.allow = "autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.border = "0";
    frame.src = playerUrl.toString();
    host.appendChild(frame);
    void loadYouTubeApi().then(
      (api) => {
        if (cancelled) return;
        playerRef.current = new api.Player(frame, {
          events: {
            onReady: () => {
              if (cancelled) return;
              interval = setInterval(() => {
                const player = playerRef.current;
                if (!player) return;
                const duration = player.getDuration();
                if (Number.isFinite(duration) && duration > 0 && duration !== reportedDuration) {
                  reportedDuration = duration;
                  callbacks.current.onDuration?.(duration);
                }
                const time = player.getCurrentTime();
                if (Number.isFinite(time) && Math.abs(time - reportedTime) >= 0.05) {
                  reportedTime = time;
                  callbacks.current.onTime?.(time);
                }
              }, 250);
            },
            onStateChange: (event) => {
              if (cancelled) return;
              callbacks.current.onPlayingChange?.(event.data === 1);
            },
            onError: (event) => {
              if (cancelled) return;
              const message =
                event.data === 101 || event.data === 150
                  ? "This YouTube video does not allow embedded playback."
                  : event.data === 100
                    ? "This YouTube video is unavailable or private."
                    : event.data === 153
                      ? "YouTube could not identify this desktop player."
                      : `YouTube playback failed (error ${event.data}).`;
              callbacks.current.onError?.(message);
            },
          },
        });
      },
      (error: unknown) => {
        if (!cancelled) {
          callbacks.current.onError?.(error instanceof Error ? error.message : String(error));
        }
      },
    );
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      playerRef.current?.destroy();
      playerRef.current = null;
      host.replaceChildren();
    };
  }, [videoId]);

  return <div ref={hostRef} title={title} style={{ width: "100%", height: "100%" }} />;
});
