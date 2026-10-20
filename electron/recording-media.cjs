const fs = require("node:fs/promises");
const path = require("node:path");

const READ_CHUNK_BYTES = 64 * 1024;
const mediaStreamMetrics = {
  active: 0,
  requests: 0,
  completed: 0,
  cancelled: 0,
  failed: 0,
  bytesRead: 0,
};

function recordingContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mkv":
      return "video/x-matroska";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".avi":
      return "video/x-msvideo";
    default:
      return "video/mp4";
  }
}

function getMediaStreamMetrics() {
  return { ...mediaStreamMetrics };
}

function createRecordingResponse(filePath, stat, request) {
  const fileSize = stat.size;
  const rangeHeader = request.headers.get("range");
  let start = 0;
  let end = Math.max(0, fileSize - 1);
  let status = 200;

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match || fileSize === 0) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }
    if (match[1] === "") {
      const suffixLength = Number(match[2]);
      start = Math.max(0, fileSize - suffixLength);
    } else {
      start = Number(match[1]);
      end = match[2] === "" ? end : Number(match[2]);
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= fileSize) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }
    end = Math.min(end, fileSize - 1);
    status = 206;
  }

  const contentLength = Math.max(0, end - start + 1);
  const headers = {
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
    "Content-Length": String(contentLength),
    "Content-Type": recordingContentType(filePath),
  };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${fileSize}`;
  if (request.method === "HEAD" || contentLength === 0) {
    return new Response(null, { status, headers });
  }

  let nextByte = start;
  let handlePromise = null;
  let finishPromise = null;
  let abortListener = null;
  const finish = (result) => {
    if (finishPromise) return finishPromise;
    if (abortListener) request.signal.removeEventListener("abort", abortListener);
    mediaStreamMetrics.active -= 1;
    mediaStreamMetrics[result] += 1;
    finishPromise = (async () => {
      const handle = await handlePromise?.catch(() => null);
      if (handle) await handle.close();
    })();
    return finishPromise;
  };
  mediaStreamMetrics.active += 1;
  mediaStreamMetrics.requests += 1;
  const body = new ReadableStream(
    {
      start(controller) {
        abortListener = () => {
          if (finishPromise) return;
          controller.error(request.signal.reason ?? new Error("Recording playback was cancelled."));
          void finish("cancelled");
        };
        request.signal.addEventListener("abort", abortListener, { once: true });
        if (request.signal.aborted) abortListener();
      },
      async pull(controller) {
        if (finishPromise) return;
        try {
          handlePromise ??= fs.open(filePath, "r");
          const handle = await handlePromise;
          if (finishPromise) return;
          const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, end - nextByte + 1));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, nextByte);
          if (finishPromise) return;
          if (bytesRead === 0) throw new Error("The recording changed during playback.");
          nextByte += bytesRead;
          mediaStreamMetrics.bytesRead += bytesRead;
          controller.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead));
          if (nextByte > end) {
            controller.close();
            await finish("completed");
          }
        } catch (error) {
          if (!finishPromise) {
            controller.error(error);
            await finish("failed");
          }
        }
      },
      cancel() {
        return finish("cancelled");
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status, headers });
}

module.exports = { createRecordingResponse, getMediaStreamMetrics };
