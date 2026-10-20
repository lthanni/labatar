import { createRequire } from "node:module";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const {
  createRecordingResponse,
  getMediaStreamMetrics,
} = require("../../electron/recording-media.cjs");

describe("recording media responses", () => {
  it("serves exact byte ranges and finishes the request", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "labatar-media-test-"));
    try {
      const filePath = path.join(directory, "recording.mp4");
      await writeFile(filePath, Buffer.from("0123456789"));
      const before = getMediaStreamMetrics();
      const response = createRecordingResponse(
        filePath,
        await stat(filePath),
        new Request("https://example.test/video", { headers: { range: "bytes=2-5" } }),
      );
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
      expect(response.headers.get("content-length")).toBe("4");
      expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("2345");
      const after = getMediaStreamMetrics();
      expect(after).toMatchObject({
        active: before.active,
        requests: before.requests + 1,
        completed: before.completed + 1,
        bytesRead: before.bytesRead + 4,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reads only requested chunks and closes a cancelled request", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "labatar-media-test-"));
    try {
      const filePath = path.join(directory, "recording.mp4");
      await writeFile(filePath, Buffer.alloc(256 * 1024, 7));
      const before = getMediaStreamMetrics();
      const response = createRecordingResponse(
        filePath,
        await stat(filePath),
        new Request("https://example.test/video", { headers: { range: "bytes=0-" } }),
      );
      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(first.value?.byteLength).toBe(64 * 1024);
      expect(getMediaStreamMetrics().bytesRead - before.bytesRead).toBe(64 * 1024);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(getMediaStreamMetrics().bytesRead - before.bytesRead).toBe(64 * 1024);
      await reader.cancel();
      expect(getMediaStreamMetrics()).toMatchObject({
        active: before.active,
        requests: before.requests + 1,
        cancelled: before.cancelled + 1,
        bytesRead: before.bytesRead + 64 * 1024,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not open a stream for HEAD or unsatisfiable ranges", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "labatar-media-test-"));
    try {
      const filePath = path.join(directory, "recording.mp4");
      await writeFile(filePath, Buffer.from("0123456789"));
      const fileStat = await stat(filePath);
      const before = getMediaStreamMetrics();
      expect(
        createRecordingResponse(
          filePath,
          fileStat,
          new Request("https://example.test/video", { method: "HEAD" }),
        ).body,
      ).toBeNull();
      expect(
        createRecordingResponse(
          filePath,
          fileStat,
          new Request("https://example.test/video", { headers: { range: "bytes=20-" } }),
        ).status,
      ).toBe(416);
      expect(getMediaStreamMetrics()).toEqual(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("closes an abandoned response when its request is aborted", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "labatar-media-test-"));
    try {
      const filePath = path.join(directory, "recording.mp4");
      await writeFile(filePath, Buffer.alloc(256 * 1024, 7));
      const controller = new AbortController();
      const before = getMediaStreamMetrics();
      const response = createRecordingResponse(
        filePath,
        await stat(filePath),
        new Request("https://example.test/video", { signal: controller.signal }),
      );
      const reader = response.body!.getReader();
      await reader.read();
      controller.abort();
      await expect(reader.read()).rejects.toThrow();
      expect(getMediaStreamMetrics()).toMatchObject({
        active: before.active,
        cancelled: before.cancelled + 1,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
