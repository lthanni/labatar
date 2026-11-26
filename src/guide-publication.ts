import { useCallback, useEffect, useRef, useState } from "react";

export type GuidePublication = {
  id: string;
  status: "pending" | "published" | "failed";
  error: string;
  progress?: {
    phase: "queued" | "uploading" | "publishing" | "waiting-for-authorization";
    completedVideos: number;
    totalVideos: number;
  };
  result?: {
    id: string;
    revision: number;
    videos: Array<{ title: string; description: string; url: string }>;
  };
};

export function isGuideYouTubeAuthorizationError(message: string) {
  return /Backend YouTube (authorization|channel)|owner needs to configure backend YouTube uploads/i.test(
    message,
  );
}

export function useGuidePublications(ids: string[], onResult: (job: GuidePublication) => void) {
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Record<string, GuidePublication["progress"]>>({});
  const callback = useRef(onResult);
  callback.current = onResult;
  const key = ids.join(",");
  const update = useCallback((job: GuidePublication) => {
    setProgress((current) => {
      if (job.status === "pending") return { ...current, [job.id]: job.progress };
      const { [job.id]: _finished, ...pending } = current;
      return pending;
    });
    if (job.status !== "pending") callback.current(job);
  }, []);
  useEffect(() => {
    if (!key) {
      setError("");
      setProgress({});
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let failed = false;
      for (const id of key.split(",")) {
        try {
          const job = await window.electronAPI?.catalogPublisher.getGuidePublication(id);
          if (!cancelled && job) update(job);
        } catch {
          failed = true;
          // Preserve pending state across sign-in expiry, offline periods, and app restarts.
        }
      }
      if (!cancelled) {
        setError(
          failed
            ? "Could not check queued guide publication. Check your connection and catalog sign-in. It may still finish in the background."
            : "",
        );
        timer = setTimeout(() => void poll(), 10_000);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, update]);
  async function check() {
    try {
      for (const id of ids) {
        const job = await window.electronAPI?.catalogPublisher.getGuidePublication(id, true);
        if (job) update(job);
      }
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  return { error, progress, check };
}
