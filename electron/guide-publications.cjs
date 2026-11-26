const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");
const {
  publisherRequestWithTimeout,
  readEditorResponse,
  getCatalogOrigin,
} = require("./catalog-publisher.cjs");

async function editorRequest(session, pathname, options = {}) {
  return publisherRequestWithTimeout(
    "Guide publication",
    async (signal) => {
      const response = await session.fetch(`${getCatalogOrigin()}${pathname}`, {
        credentials: "include",
        redirect: "error",
        cache: "no-store",
        signal,
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
      });
      const result = await readEditorResponse(response);
      if (result.authenticationRequired)
        throw new Error("Catalog sign-in expired. Sign in again and retry.");
      return result.body;
    },
    120000,
  );
}

function publicationId(type, item, expectedRevision) {
  const hash = createHash("sha256")
    .update(JSON.stringify({ type, item, expectedRevision }))
    .digest("hex")
    .slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}

async function stageGuideVideo(session, library, video, onProgress) {
  const origin = getCatalogOrigin();
  const source = await library.file(video.localVideoId).catch(() => null);
  const previous = library.remote(video.localVideoId, origin);
  if (!source && !previous) throw new Error("The guide MP4 is unavailable. Choose it again.");
  const stat = source?.stat ?? { size: previous.size, mtimeMs: previous.mtimeMs };
  onProgress?.(0, stat.size);
  const id = source ? library.remoteId(video.localVideoId, origin, stat) : previous.id;
  const endpoint = `/v1/editor/guide-videos/${id}`;
  const created = await editorRequest(session, "/v1/editor/guide-videos", {
    method: "POST",
    body: JSON.stringify({ id, fileSize: stat.size }),
  });
  if (
    created.id !== id ||
    created.partSize !== 8 * 1024 * 1024 ||
    !["uploading", "ready", "uploaded"].includes(created.status)
  )
    throw new Error("Invalid guide upload response.");
  if (created.status !== "uploading") {
    onProgress?.(stat.size, stat.size);
    return id;
  }
  if (!source)
    throw new Error("The guide MP4 is unavailable before staging finished. Choose it again.");
  const file = await fs.open(source.filePath, "r");
  try {
    const parts = [];
    for (
      let offset = 0, number = 1;
      offset < source.stat.size;
      offset += created.partSize, number++
    ) {
      const current = await file.stat();
      if (current.size !== source.stat.size || current.mtimeMs !== source.stat.mtimeMs)
        throw new Error("The MP4 changed during upload. Choose the file again.");
      const bytes = Buffer.alloc(Math.min(created.partSize, source.stat.size - offset));
      let filled = 0;
      while (filled < bytes.length) {
        const { bytesRead } = await file.read(
          bytes,
          filled,
          bytes.length - filled,
          offset + filled,
        );
        if (!bytesRead) throw new Error("The guide MP4 changed during upload.");
        filled += bytesRead;
      }
      const part = await editorRequest(session, `${endpoint}/parts/${number}`, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4" },
        body: bytes,
      });
      if (part.partNumber !== number || typeof part.etag !== "string")
        throw new Error("Invalid guide video part response.");
      parts.push(part);
      onProgress?.(offset + bytes.length, stat.size);
    }
    const final = await file.stat();
    if (final.size !== source.stat.size || final.mtimeMs !== source.stat.mtimeMs)
      throw new Error("The guide MP4 changed during upload.");
    const completed = await editorRequest(session, `${endpoint}/complete`, {
      method: "POST",
      body: JSON.stringify({ parts }),
    });
    if (completed.id !== id || !["ready", "uploaded"].includes(completed.status))
      throw new Error("Guide upload did not complete.");
    return id;
  } finally {
    await file.close();
  }
}

async function queueGuidePublication(session, type, item, expectedRevision) {
  const id = publicationId(type, item, expectedRevision);
  const result = await editorRequest(session, "/v1/editor/guide-publications", {
    method: "POST",
    body: JSON.stringify({ id, type, item, expectedRevision }),
  });
  if (result.id !== id || !["pending", "published", "failed"].includes(result.status))
    throw new Error("Invalid guide publication response.");
  if (result.status === "failed") throw new Error(result.error || "Guide publication failed.");
  if (result.status === "published") return { cancelled: false, ...result.result };
  return { cancelled: false, pending: true, jobId: id };
}

module.exports = { stageGuideVideo, queueGuidePublication, editorRequest, publicationId };
