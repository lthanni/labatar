const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const shortHosts = new Set(["youtu.be", "www.youtu.be"]);

function normalizeYouTubeVideoUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Enter a YouTube video URL.");
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid YouTube video URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Use an HTTPS YouTube video URL.");
  }

  let videoId = null;
  if (shortHosts.has(url.hostname)) {
    const match = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname);
    videoId = match?.[1] ?? null;
  } else if (youtubeHosts.has(url.hostname)) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else {
      const match = /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname);
      videoId = match?.[1] ?? null;
    }
  }
  if (!videoIdPattern.test(videoId ?? "")) {
    throw new Error("Enter a link to a single YouTube video.");
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function readYouTubeVideoUrl(value) {
  try {
    return normalizeYouTubeVideoUrl(value);
  } catch {
    return null;
  }
}

module.exports = { normalizeYouTubeVideoUrl, readYouTubeVideoUrl };
