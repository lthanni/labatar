import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { handleRequest } from "../src/worker.mjs";
import { processGuidePublications, cleanGuideVideos } from "../src/guide-publications.mjs";

const editor = async () => "editor@example.com";
const denied = async () => {
  throw new Error("Denied");
};
const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  sqlite
    .prepare("INSERT INTO catalog_access_roles VALUES (?, 'editor', 'now', 'owner')")
    .run("editor@example.com");
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            all: async () => ({ results: statement.all(...args) }),
            run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
          };
        },
      };
    },
  };
  const objects = new Map();
  const multipart = new Map();
  const bucket = {
    async createMultipartUpload(key) {
      const uploadId = crypto.randomUUID();
      multipart.set(uploadId, { key, parts: new Map() });
      return { uploadId, abort: async () => multipart.delete(uploadId) };
    },
    resumeMultipartUpload(key, id) {
      const upload = multipart.get(id);
      assert.equal(upload?.key, key);
      return {
        async uploadPart(number, bytes) {
          upload.parts.set(number, bytes);
          return { partNumber: number, etag: `part-${number}` };
        },
        async complete(parts) {
          const data = Buffer.concat(
            parts.map((part) => Buffer.from(upload.parts.get(part.partNumber))),
          );
          objects.set(key, data);
          multipart.delete(id);
          return { size: data.length };
        },
        async abort() {
          multipart.delete(id);
        },
      };
    },
    async head(key) {
      const data = objects.get(key);
      return data ? { size: data.length } : null;
    },
    async get(key, options) {
      const data = objects.get(key);
      if (!data) return null;
      const offset = options?.range?.offset ?? 0;
      const length = options?.range?.length ?? data.length;
      return { body: data.subarray(offset, offset + length), size: data.length };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  const env = {
    DB: db,
    CANDIDATE_VIDEOS: bucket,
    YOUTUBE_CLIENT_ID: "client",
    YOUTUBE_CLIENT_SECRET: "secret",
    YOUTUBE_REFRESH_TOKEN: "never-expose-this",
    YOUTUBE_CHANNEL_ID: "target-channel",
    YOUTUBE_CHANNEL_HANDLE: "@ATLAbatar",
  };
  async function call(path, method = "GET", body, identity = editor) {
    return handleRequest(
      new Request(`https://api.example.com/v1/editor/${path}`, {
        method,
        ...(body !== undefined
          ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }
          : {}),
      }),
      env,
      {},
      identity,
    );
  }
  return { sqlite, env, call, objects };
}

async function stage(f) {
  const id = crypto.randomUUID();
  assert.equal((await f.call("guide-videos", "POST", { id, fileSize: 4 })).status, 200);
  const response = await handleRequest(
    new Request(`https://api.example.com/v1/editor/guide-videos/${id}/parts/1`, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
      body: new Uint8Array([1, 2, 3, 4]),
    }),
    f.env,
    {},
    editor,
  );
  const part = await response.json();
  assert.equal(response.status, 200);
  assert.equal(
    (await f.call(`guide-videos/${id}/complete`, "POST", { parts: [part] })).status,
    200,
  );
  return id;
}

function note(uploadId) {
  return {
    id: "guide-one",
    kind: "guide",
    characterId: "aang",
    supportId: null,
    title: "Guide",
    setup: "",
    sequence: "",
    outcome: "",
    notes: "Description",
    relatedTechIds: [],
    relatedComboIds: [],
    videos: [{ title: "Demo", description: "Timing", uploadId }],
  };
}

function google({ channel = "target-channel", loseFinal = false } = {}) {
  const calls = [];
  let complete = false;
  const video = () => Response.json({ id: "M7lc1UVf-VE", snippet: { channelId: channel } });
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/token")) return Response.json({ access_token: "private-token" });
    if (url.includes("/channels?")) return Response.json({ items: [{ id: channel }] });
    if (options.method === "POST")
      return new Response(null, {
        headers: { location: "https://www.googleapis.com/upload/session" },
      });
    if (options.redirect !== "manual")
      throw new TypeError("Cloudflare Workers rejects this redirect mode for YouTube uploads.");
    if (options.headers["Content-Range"].startsWith("bytes */"))
      return complete ? video() : new Response(null, { status: 308 });
    assert.deepEqual(Buffer.from(options.body), Buffer.from([1, 2, 3, 4]));
    complete = true;
    if (loseFinal) {
      loseFinal = false;
      throw new Error("Lost final response");
    }
    return video();
  };
  return { calls, fetcher };
}

void test("the backend publishes a staged Pressure video after the editor disconnects", async () => {
  const f = fixture();
  try {
    assert.equal((await f.call("guide-videos", "POST", {}, denied)).status, 401);
    const uploadId = await stage(f);
    assert.equal(
      (
        await f.call(
          "guide-videos",
          "POST",
          { id: uploadId, fileSize: 4 },
          async () => "other@example.com",
        )
      ).status,
      409,
    );
    const id = crypto.randomUUID();
    const section = {
      id: "strategy",
      kind: "pressure",
      characterId: "aang",
      supportId: null,
      title: "Strategy",
      description: "",
    };
    const body = {
      id,
      type: "note",
      item: {
        ...note(uploadId),
        kind: section.kind,
        sectionId: section.id,
        videos: [{ title: "", description: "", uploadId }],
      },
      expectedRevision: 0,
    };
    const blocked = await f.call("guide-publications", "POST", body);
    assert.match((await blocked.json()).error, /published section/);
    const publishedSection = await handleRequest(
      new Request(`https://api.example.com/v1/editor/character-note-sections/${section.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-None-Match": "*" },
        body: JSON.stringify(section),
      }),
      f.env,
      {},
      editor,
    );
    assert.equal(publishedSection.status, 201);
    assert.equal((await f.call("guide-publications", "POST", body)).status, 202);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM character_notes").get().n, 0);
    const getStatus = async () => (await f.call(`guide-publications/${id}`)).json();
    assert.deepEqual((await getStatus()).progress, {
      phase: "queued",
      completedVideos: 0,
      totalVideos: 1,
    });
    assert.equal(
      (await f.call(`guide-publications/${id}`, "GET", undefined, async () => "other@example.com"))
        .status,
      404,
    );
    const refreshToken = f.env.YOUTUBE_REFRESH_TOKEN;
    f.env.YOUTUBE_REFRESH_TOKEN = "";
    assert.equal((await getStatus()).progress.phase, "waiting-for-authorization");
    f.env.YOUTUBE_REFRESH_TOKEN = refreshToken;
    const transport = google();
    await processGuidePublications(f.env, async (url, options) => {
      if (typeof url === "string" && url.startsWith("https://oauth2.googleapis.com/")) {
        const status = await getStatus();
        assert.equal(status.progress.phase, "uploading");
        assert.equal(JSON.stringify(status).includes(refreshToken), false);
      }
      return transport.fetcher(url, options);
    });
    const upload = transport.calls.find(({ url }) => url.includes("/upload/youtube/v3/videos"));
    assert.equal(JSON.parse(upload.options.body).snippet.title, "Guide video");
    assert.equal(JSON.parse(upload.options.body).snippet.description, "");
    const status = await (await f.call(`guide-publications/${id}`)).json();
    assert.equal(status.status, "published");
    assert.equal(status.result.videos[0].url, "https://www.youtube.com/watch?v=M7lc1UVf-VE");
    assert.equal(JSON.stringify(status).includes("private-token"), false);
    assert.equal(JSON.stringify(status).includes("upload/session"), false);
    const stored = JSON.parse(
      f.sqlite.prepare("SELECT payload FROM character_notes").get().payload,
    );
    assert.equal(stored.sectionId, section.id);
    assert.equal(stored.kind, "pressure");
    assert.deepEqual(stored.videos, [
      { title: "", description: "", youtubeVideoId: "M7lc1UVf-VE" },
    ]);
    assert.equal((await f.call("guide-publications", "POST", body)).status, 200);
    await cleanGuideVideos(f.env);
    assert.equal(f.objects.size, 0);
    assert.equal(
      (await (await f.call("guide-videos", "POST", { id: uploadId, fileSize: 4 })).json()).status,
      "uploaded",
    );
  } finally {
    f.sqlite.close();
  }
});

void test("wrong channel blocks upload; failed publication can resume without duplicating a completed video", async () => {
  const f = fixture();
  try {
    const uploadId = await stage(f);
    const id = crypto.randomUUID();
    const body = { id, type: "note", item: note(uploadId), expectedRevision: 0 };
    await f.call("guide-publications", "POST", body);
    const wrong = google({ channel: "editors-own-channel" });
    await processGuidePublications(f.env, wrong.fetcher);
    assert.equal(
      wrong.calls.some((call) => call.url.includes("upload/youtube")),
      false,
    );
    assert.equal((await (await f.call(`guide-publications/${id}`)).json()).status, "failed");
    assert.equal((await f.call("guide-publications", "POST", body)).status, 202);
    const transport = google({ loseFinal: true });
    await processGuidePublications(f.env, transport.fetcher);
    assert.equal((await (await f.call(`guide-publications/${id}`)).json()).status, "failed");
    await f.call("guide-publications", "POST", body);
    await processGuidePublications(f.env, transport.fetcher);
    assert.equal((await (await f.call(`guide-publications/${id}`)).json()).status, "published");
    assert.equal(transport.calls.filter((call) => call.url.includes("upload/youtube")).length, 1);
    // Simulate a crash between the catalog commit and the job receipt.
    f.sqlite
      .prepare("UPDATE guide_publications SET status = 'pending', result = NULL WHERE id = ?")
      .run(id);
    await processGuidePublications(f.env, async () => {
      throw new Error("Must not upload again");
    });
    assert.equal((await (await f.call(`guide-publications/${id}`)).json()).status, "published");
    assert.equal(f.sqlite.prepare("SELECT revision FROM character_notes").get().revision, 1);
  } finally {
    f.sqlite.close();
  }
});

void test("Tech guides use the same queue and stop on revision conflict or revoked editor access", async () => {
  const f = fixture();
  try {
    f.sqlite
      .prepare(
        `INSERT INTO tech_sections (id,scope_kind,subject_id,title,updated_by,updated_at) VALUES ('movement','character','aang','Movement','owner','now')`,
      )
      .run();
    const uploadId = await stage(f);
    const id = crypto.randomUUID();
    const item = {
      id: "tech-guide",
      sectionId: "movement",
      title: "Tool",
      description: "",
      notation: "",
      sortOrder: 0,
      videos: [{ title: "Demo", description: "Timing", uploadId }],
    };
    const body = { id, type: "tech", item, expectedRevision: 0 };
    assert.equal((await f.call("guide-publications", "POST", body)).status, 202);
    f.sqlite.prepare("DELETE FROM catalog_access_roles").run();
    const transport = google();
    await processGuidePublications(f.env, transport.fetcher);
    assert.equal(transport.calls.length, 0);
    assert.match((await (await f.call(`guide-publications/${id}`)).json()).error, /revoked/);
    f.sqlite
      .prepare(
        "INSERT INTO catalog_access_roles VALUES ('editor@example.com','editor','now','owner')",
      )
      .run();
    await f.call("guide-publications", "POST", body);
    await processGuidePublications(f.env, transport.fetcher);
    assert.equal((await (await f.call(`guide-publications/${id}`)).json()).status, "published");
    const next = {
      ...body,
      id: crypto.randomUUID(),
      expectedRevision: 1,
      item: { ...item, title: "Updated" },
    };
    await f.call("guide-publications", "POST", next);
    f.sqlite.prepare("UPDATE tech_entries SET revision = 2, title = 'Someone else edited'").run();
    const callsBefore = transport.calls.length;
    await processGuidePublications(f.env, transport.fetcher);
    assert.equal(transport.calls.length, callsBefore);
    assert.equal((await (await f.call(`guide-publications/${next.id}`)).json()).status, "failed");
    assert.equal(
      f.sqlite.prepare("SELECT title FROM tech_entries").get().title,
      "Someone else edited",
    );
  } finally {
    f.sqlite.close();
  }
});
