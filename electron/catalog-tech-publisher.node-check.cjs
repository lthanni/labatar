const { test } = require("node:test");
const assert = require("node:assert/strict");
const { publishCatalogTech, unpublishCatalogPlayer } = require("./catalog-tech-publisher.cjs");

void test("local Tech publication checks the revision before sending a PUT", async () => {
  const requests = [];
  const session = {
    async fetch(url, options) {
      requests.push({ path: new URL(url).pathname, options });
      if (options.method === "PUT")
        return Response.json({ id: "aang-movement", revision: 3, published: true });
      return Response.json({
        sections: [{ id: "aang-movement", scopeKind: "character", subjectId: "aang", revision: 2 }],
      });
    },
  };
  const item = {
    id: "aang-movement",
    scopeKind: "character",
    subjectId: "aang",
    title: "Movement",
    description: "",
    sortOrder: 0,
  };
  const result = await publishCatalogTech({ type: "section", item, expectedRevision: 2 }, null, {
    session,
    showMessageBox: async () => ({ response: 0 }),
  });
  assert.deepEqual(result, { cancelled: false, id: "aang-movement", revision: 3 });
  assert.equal(requests[1].path, "/v1/editor/tech-sections/aang-movement");
  assert.equal(requests[1].options.headers["If-Match"], '"2"');
  assert.deepEqual(JSON.parse(requests[1].options.body), item);
  await assert.rejects(
    publishCatalogTech({ type: "section", item, expectedRevision: 1 }, null, {
      session,
      showMessageBox: async () => ({ response: 0 }),
    }),
    /changed since this local draft/,
  );
  assert.equal(requests.length, 3);
});

void test("players publish all links and unpublish with revision checks", async () => {
  const requests = [];
  const item = {
    id: "aang-youtube",
    scopeKind: "character",
    subjectId: "aang",
    title: "Aang",
    links: ["https://youtube.com/@aang", "https://www.twitch.tv/aang"],
  };
  let published = false;
  const session = {
    async fetch(url, options) {
      requests.push({ path: new URL(url).pathname, options });
      if (options.method === "PUT") {
        published = true;
        return Response.json({ id: item.id, revision: 1 });
      }
      if (options.method === "DELETE") {
        published = false;
        return Response.json({ id: item.id, revision: 2, published: false });
      }
      return Response.json({ items: published ? [{ ...item, revision: 1, published: true }] : [] });
    },
  };
  const dependencies = { session, showMessageBox: async () => ({ response: 0 }) };
  assert.deepEqual(await publishCatalogTech({ type: "player", item }, null, dependencies), {
    cancelled: false,
    id: item.id,
    revision: 1,
  });
  assert.equal(requests[1].path, "/v1/editor/players/aang-youtube");
  assert.equal(requests[1].options.headers["If-None-Match"], "*");
  assert.deepEqual(JSON.parse(requests[1].options.body), item);
  assert.deepEqual(
    await unpublishCatalogPlayer({ id: item.id, expectedRevision: 1 }, null, dependencies),
    { cancelled: false, id: item.id, revision: 2 },
  );
  assert.equal(requests[3].options.headers["If-Match"], '"1"');
});

void test("guide publication stages MP4s after confirmation and queues backend publication", async () => {
  const requests = [];
  const uploads = [];
  const item = {
    id: "air-stall",
    sectionId: "movement",
    title: "Air stall",
    description: "",
    notation: "",
    sortOrder: 0,
    videos: [
      { title: "Demo", description: "Watch the timing", url: "", localVideoId: "local-id" },
      {
        title: "Reference",
        description: "Another example",
        url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      },
    ],
  };
  const session = {
    async fetch(url, options) {
      requests.push({ url, options });
      return options.method === "PUT"
        ? Response.json({ id: item.id, revision: 1 })
        : Response.json({ entries: [] });
    },
  };
  const dependencies = {
    session,
    showMessageBox: async () => ({ response: 0 }),
    stageGuideVideo: async (_session, video) => {
      uploads.push(video.localVideoId);
      return "staged-id";
    },
    queueGuidePublication: async (_session, type, publishedItem, revision) => {
      assert.equal(type, "tech");
      assert.equal(revision, 0);
      requests.push({ queued: publishedItem });
      return { cancelled: false, pending: true, jobId: "job-id" };
    },
  };
  const result = await publishCatalogTech({ type: "tech", item }, null, dependencies);
  assert.deepEqual(uploads, ["local-id"]);
  assert.deepEqual(requests[1].queued.videos, [
    {
      title: "Demo",
      description: "Watch the timing",
      uploadId: "staged-id",
    },
    item.videos[1],
  ]);
  assert.deepEqual(result, { cancelled: false, pending: true, jobId: "job-id" });
  assert.deepEqual(item.videos[0].url, "");

  let cancelledUpload = false;
  const cancelled = await publishCatalogTech({ type: "tech", item }, null, {
    ...dependencies,
    showMessageBox: async () => ({ response: 1 }),
    stageGuideVideo: async () => {
      cancelledUpload = true;
    },
  });
  assert.deepEqual(cancelled, { cancelled: true });
  assert.equal(cancelledUpload, false);
});

void test("Oki entries use the same upload flow as Tech guides", async () => {
  const requests = [];
  const item = {
    id: "aang-oki",
    kind: "oki",
    characterId: "aang",
    supportId: null,
    title: "Corner setup",
    setup: "",
    sequence: "",
    outcome: "",
    notes: "",
    relatedTechIds: [],
    relatedComboIds: [],
    videos: [{ title: "Demo", description: "Timing", url: "", localVideoId: "selected" }],
  };
  const result = await publishCatalogTech({ type: "note", item }, null, {
    session: {
      async fetch(_url, options) {
        requests.push(options);
        return options.method === "PUT"
          ? Response.json({ id: item.id, revision: 1 })
          : Response.json({ items: [] });
      },
    },
    showMessageBox: async () => ({ response: 0 }),
    stageGuideVideo: async () => "staged-note-id",
    queueGuidePublication: async (_session, type, staged) => {
      assert.equal(type, "note");
      assert.equal(staged.kind, "oki");
      assert.equal(staged.videos[0].uploadId, "staged-note-id");
      assert.equal(staged.videos[0].localVideoId, undefined);
      return { cancelled: false, pending: true, jobId: "note-job" };
    },
  });
  assert.equal(result.jobId, "note-job");
  assert.equal(requests.length, 1);
});
