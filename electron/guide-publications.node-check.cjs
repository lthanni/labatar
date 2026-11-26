const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createGuideVideoLibrary } = require("./guide-video-library.cjs");
const { stageGuideVideo, queueGuidePublication } = require("./guide-publications.cjs");

void test("MP4 staging uses catalog authentication, survives a lost response, and reuses staged bytes after local deletion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-guide-stage-"));
  try {
    const filePath = path.join(root, "guide.mp4");
    await fs.writeFile(filePath, "mp4 bytes");
    const library = createGuideVideoLibrary(path.join(root, "library"));
    const selected = await library.add(filePath);
    let ready = false;
    let failQueueResponse = true;
    let partRequests = 0;
    let createdId;
    let publicationId;
    const session = {
      async fetch(url, options) {
        assert.equal(options.credentials, "include");
        const pathname = new URL(url).pathname;
        assert.equal(pathname.startsWith("/v1/editor/guide-"), true);
        if (pathname.endsWith("guide-videos")) {
          const input = JSON.parse(options.body);
          createdId ??= input.id;
          assert.equal(input.id, createdId);
          return Response.json({
            id: createdId,
            status: ready ? "ready" : "uploading",
            partSize: 8 * 1024 * 1024,
          });
        }
        if (pathname.includes("/parts/")) {
          partRequests++;
          assert.equal(Buffer.from(options.body).toString(), "mp4 bytes");
          return Response.json({ partNumber: 1, etag: "opaque-r2-etag" });
        }
        if (pathname.endsWith("/complete")) {
          ready = true;
          return Response.json({ id: createdId, status: "ready" });
        }
        const input = JSON.parse(options.body);
        publicationId ??= input.id;
        assert.equal(input.id, publicationId);
        if (failQueueResponse) {
          failQueueResponse = false;
          throw new Error("Lost queue response");
        }
        return Response.json({ id: input.id, status: "pending" }, { status: 202 });
      },
    };
    const progress = [];
    const report = (completed, total) => progress.push([completed, total]);
    const video = { localVideoId: selected.id };
    const uploadId = await stageGuideVideo(session, library, video, report);
    assert.deepEqual(progress, [
      [0, 9],
      [9, 9],
    ]);
    await fs.rm(filePath);
    progress.length = 0;
    assert.equal(await stageGuideVideo(session, library, video, report), uploadId);
    assert.deepEqual(progress, [
      [0, 9],
      [9, 9],
    ]);
    assert.equal(partRequests, 1);
    const item = { id: "guide", videos: [{ title: "Demo", description: "Timing", uploadId }] };
    await assert.rejects(queueGuidePublication(session, "tech", item, 0), /Lost queue response/);
    const pending = await queueGuidePublication(session, "tech", item, 0);
    assert.equal(pending.pending, true);
    assert.equal(pending.jobId, publicationId);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
