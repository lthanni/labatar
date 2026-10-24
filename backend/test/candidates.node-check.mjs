import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { handleRequest } from "../src/worker.mjs";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const videoId = "M7lc1UVf-VE";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            all: async () => ({ results: statement.all(...args) }),
            run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
          };
        },
        all: async () => ({ results: statement.all() }),
      };
    },
    close: () => sqlite.close(),
  };
}

function bucket() {
  const objects = new Map();
  const uploads = new Map();
  return {
    objects,
    async createMultipartUpload(key) {
      const uploadId = crypto.randomUUID();
      uploads.set(uploadId, { key, parts: new Map() });
      return { uploadId, key, abort: async () => uploads.delete(uploadId) };
    },
    resumeMultipartUpload(key, uploadId) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.key !== key) throw new Error("Upload not found.");
      return {
        async uploadPart(partNumber, bytes) {
          const data = Buffer.from(bytes);
          const etag = createHash("md5").update(data).digest("hex");
          upload.parts.set(partNumber, { data, etag });
          return { partNumber, etag };
        },
        async complete(parts) {
          for (const part of parts) {
            if (upload.parts.get(part.partNumber)?.etag !== part.etag)
              throw new Error("Wrong ETag.");
          }
          const data = Buffer.concat(parts.map((part) => upload.parts.get(part.partNumber).data));
          objects.set(key, data);
          uploads.delete(uploadId);
          return { size: data.length };
        },
        async abort() {
          uploads.delete(uploadId);
        },
      };
    },
    async get(key, options) {
      const data = objects.get(key);
      if (!data) return null;
      const offset = options?.range?.offset ?? 0;
      const length = options?.range?.length ?? data.length;
      return { body: data.subarray(offset, offset + length), size: data.length };
    },
    async head(key) {
      const data = objects.get(key);
      return data ? { size: data.length } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

function request(path, method = "GET", body, headers = {}) {
  const isJson = body && typeof body === "object" && !ArrayBuffer.isView(body);
  return new Request(`https://api.example.com${path}`, {
    method,
    headers: { ...(isJson ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(body === undefined ? {} : { body: isJson ? JSON.stringify(body) : body }),
  });
}

function combo() {
  return {
    id: "aang-katara-5b",
    characterId: "aang",
    supportId: "katara",
    route: "5B > 236A",
    moveIds: [],
    screenPosition: "midscreen",
    damage: "302",
    resourceCosts: { pips: 1, flow: 0 },
    mechanics: [],
  };
}

async function submit(env, options = {}) {
  const response = await handleRequest(
    request("/v1/editor/candidates/upload", "POST", {
      combo: options.combo ?? combo(),
      ...(options.originCandidateId ? { originCandidateId: options.originCandidateId } : {}),
      fileName: "test.mp4",
      fileSize: 3,
    }),
    env,
    {},
    undefined,
    undefined,
    undefined,
    async () => "uploader@example.com",
  );
  assert.equal(response.status, 201);
  const created = await response.json();
  const uploaded = await handleRequest(
    request(`/v1/candidates/${created.id}/parts/1`, "PUT", Buffer.from("mp4"), {
      "X-Candidate-Token": created.token,
    }),
    env,
  );
  assert.equal(uploaded.status, 200);
  const part = await uploaded.json();
  const completed = await handleRequest(
    request(
      `/v1/candidates/${created.id}/complete`,
      "POST",
      { parts: [part] },
      {
        "X-Candidate-Token": created.token,
      },
    ),
    env,
  );
  assert.equal(completed.status, 200);
  return created;
}

void test("candidate MP4 enters an editor-only queue and can be rejected with its video removed", async () => {
  const db = database();
  const videos = bucket();
  const env = { DB: db, CANDIDATE_VIDEOS: videos };
  try {
    const body = { combo: combo(), fileName: "test.mp4", fileSize: 3 };
    assert.equal((await handleRequest(request("/v1/candidates", "POST", body), env)).status, 403);
    assert.equal(
      (await handleRequest(request("/v1/editor/candidates/upload", "POST", body), env)).status,
      403,
    );
    assert.equal((await handleRequest(request("/v1/editor/candidates/upload"), env)).status, 403);
    const uploadAccess = await handleRequest(
      request("/v1/editor/candidates/upload"),
      env,
      {},
      undefined,
      undefined,
      undefined,
      async () => "uploader@example.com",
    );
    assert.deepEqual(await uploadAccess.json(), { allowed: true });
    assert.deepEqual((await (await handleRequest(request("/health"), env)).json()).features, {
      comboNotes: true,
      comboCandidates: true,
    });
    const created = await submit(env);
    assert.equal((await handleRequest(request("/v1/editor/candidates"), env)).status, 401);
    const editor = async () => "editor@example.com";
    const list = await handleRequest(request("/v1/editor/candidates"), env, {}, editor);
    const items = (await list.json()).items;
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "pending");
    assert.equal(items[0].combo.youtubeVideoId, undefined);
    const video = await handleRequest(
      request(`/v1/editor/candidates/${created.id}/video`),
      env,
      {},
      editor,
    );
    assert.equal(await video.text(), "mp4");
    const rangedVideo = await handleRequest(
      request(`/v1/editor/candidates/${created.id}/video`, "GET", undefined, {
        Range: "bytes=1-2",
      }),
      env,
      {},
      editor,
    );
    assert.equal(rangedVideo.status, 206);
    assert.equal(rangedVideo.headers.get("Content-Range"), "bytes 1-2/3");
    assert.equal(rangedVideo.headers.get("Content-Length"), "2");
    assert.equal(await rangedVideo.text(), "p4");
    const invalidRange = await handleRequest(
      request(`/v1/editor/candidates/${created.id}/video`, "GET", undefined, {
        Range: "bytes=3-",
      }),
      env,
      {},
      editor,
    );
    assert.equal(invalidRange.status, 416);
    assert.equal(invalidRange.headers.get("Content-Range"), "bytes */3");
    const rejected = await handleRequest(
      request(`/v1/editor/candidates/${created.id}/reject`, "POST", { reason: "Bad spacing" }),
      env,
      {},
      editor,
    );
    assert.equal((await rejected.json()).rejectionReason, "Bad spacing");
    assert.equal(videos.objects.size, 0);
    assert.equal(
      (await handleRequest(request(`/v1/editor/candidates/${created.id}/video`), env, {}, editor))
        .status,
      404,
    );
  } finally {
    db.close();
  }
});

void test("publishing a candidate removes its queued copy and MP4", async () => {
  const db = database();
  const videos = bucket();
  const env = { DB: db, CANDIDATE_VIDEOS: videos };
  const editor = async () => "editor@example.com";
  try {
    const created = await submit(env);
    const duplicate = await submit(env, { originCandidateId: created.id });
    assert.notEqual(created.id, duplicate.id);
    assert.equal(videos.objects.size, 2);
    const path = `/v1/editor/combos/${combo().id}`;
    const payload = {
      ...combo(),
      name: "Editor title",
      moveIds: ["aang-236c"],
      sourceCandidateId: created.id,
      youtubeUrl: `https://youtu.be/${videoId}`,
    };
    const missingPrecondition = await handleRequest(request(path, "PUT", payload), env, {}, editor);
    assert.equal(missingPrecondition.status, 428);
    assert.equal(
      (await (await handleRequest(request("/v1/editor/candidates"), env, {}, editor)).json()).items
        .length,
      2,
    );
    const published = await handleRequest(
      request(path, "PUT", payload, { "If-None-Match": "*" }),
      env,
      {},
      editor,
    );
    assert.equal(published.status, 201);
    assert.equal((await published.json()).sourceCandidateId, created.id);
    assert.deepEqual(
      (await (await handleRequest(request("/v1/editor/candidates"), env, {}, editor)).json()).items,
      [],
    );
    assert.equal(videos.objects.size, 0);
  } finally {
    db.close();
  }
});

void test("edited resubmissions retain the original candidate ID through publication", async () => {
  const db = database();
  const videos = bucket();
  const env = { DB: db, CANDIDATE_VIDEOS: videos };
  const editor = async () => "editor@example.com";
  try {
    const original = await submit(env);
    const updated = await submit(env, {
      originCandidateId: original.id,
      combo: { ...combo(), route: "5B > 236B", damage: "392" },
    });
    const queue = (
      await (await handleRequest(request("/v1/editor/candidates"), env, {}, editor)).json()
    ).items;
    assert.equal(queue.find((item) => item.id === original.id).originCandidateId, original.id);
    assert.equal(queue.find((item) => item.id === updated.id).originCandidateId, original.id);
    assert.equal(queue.find((item) => item.id === updated.id).combo.originCandidateId, undefined);
    const published = await handleRequest(
      request(
        `/v1/editor/combos/${combo().id}`,
        "PUT",
        {
          ...combo(),
          route: "5B > 236C",
          damage: "400",
          sourceCandidateId: original.id,
          youtubeUrl: `https://youtu.be/${videoId}`,
        },
        { "If-None-Match": "*" },
      ),
      env,
      {},
      editor,
    );
    assert.equal(published.status, 201);
    assert.deepEqual(
      (await (await handleRequest(request("/v1/editor/candidates"), env, {}, editor)).json()).items,
      [],
    );
    assert.equal(videos.objects.size, 0);
  } finally {
    db.close();
  }
});

void test("an unrelated submission with identical gameplay keeps its own candidate identity", async () => {
  const db = database();
  const videos = bucket();
  const env = { DB: db, CANDIDATE_VIDEOS: videos };
  const editor = async () => "editor@example.com";
  try {
    const original = await submit(env);
    const independent = await submit(env);
    const published = await handleRequest(
      request(
        `/v1/editor/combos/${combo().id}`,
        "PUT",
        { ...combo(), sourceCandidateId: original.id, youtubeUrl: `https://youtu.be/${videoId}` },
        { "If-None-Match": "*" },
      ),
      env,
      {},
      editor,
    );
    assert.equal(published.status, 201);
    assert.equal(videos.objects.size, 1);
    assert.deepEqual(
      (
        await (await handleRequest(request("/v1/editor/candidates"), env, {}, editor)).json()
      ).items.map((item) => item.id),
      [independent.id],
    );
  } finally {
    db.close();
  }
});

void test("candidate listing reconciles rows left by an earlier catalog publication", async () => {
  const db = database();
  const videos = bucket();
  const env = { DB: db, CANDIDATE_VIDEOS: videos };
  const editor = async () => "editor@example.com";
  try {
    const created = await submit(env);
    await db
      .prepare("UPDATE combo_candidates SET combo_payload = ? WHERE id = ?")
      .bind(JSON.stringify(combo()), created.id)
      .run();
    await db
      .prepare(`
      INSERT INTO catalog_versions
        (kind, id, revision, character_id, support_id, payload, published, editor_email, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        "combo",
        combo().id,
        1,
        combo().characterId,
        combo().supportId,
        JSON.stringify({
          ...combo(),
          sourceCandidateId: crypto.randomUUID(),
          youtubeVideoId: videoId,
        }),
        1,
        "editor@example.com",
        new Date().toISOString(),
      )
      .run();
    const listed = await handleRequest(request("/v1/editor/candidates"), env, {}, editor);
    assert.deepEqual((await listed.json()).items, []);
    assert.equal(videos.objects.size, 0);
    assert.deepEqual(
      (await env.DB.prepare("SELECT * FROM combo_candidates WHERE id = ?").bind(created.id).all())
        .results,
      [],
    );
  } finally {
    db.close();
  }
});

void test("candidate requires a valid MP4 upload and an editor can record its YouTube link", async () => {
  const db = database();
  const videos = bucket();
  const env = { DB: db, CANDIDATE_VIDEOS: videos };
  try {
    const invalid = await handleRequest(
      request("/v1/editor/candidates/upload", "POST", {
        combo: { ...combo(), youtubeUrl: `https://youtu.be/${videoId}` },
        fileName: "test.mp4",
        fileSize: 3,
      }),
      env,
      {},
      undefined,
      undefined,
      undefined,
      async () => "uploader@example.com",
    );
    assert.equal(invalid.status, 400);
    const created = await submit(env);
    const wrongToken = await handleRequest(
      request(`/v1/candidates/${created.id}/parts/1`, "PUT", Buffer.from("mp4"), {
        "X-Candidate-Token": "0".repeat(64),
      }),
      env,
    );
    assert.equal(wrongToken.status, 404);
    const editor = async () => "editor@example.com";
    const unauthorizedUpload = await handleRequest(
      request(`/v1/editor/candidates/${created.id}/uploaded`, "POST", {
        youtubeUrl: `https://youtu.be/${videoId}`,
      }),
      env,
    );
    assert.equal(unauthorizedUpload.status, 401);
    assert.equal(
      (await handleRequest(request(`/v1/editor/candidates/${created.id}/approve`, "POST"), env))
        .status,
      401,
    );
    const listed = await handleRequest(request("/v1/editor/candidates"), env, {}, editor);
    assert.equal((await listed.json()).items[0].status, "pending");
    const pendingVideo = await handleRequest(
      request(`/v1/editor/candidates/${created.id}/video`),
      env,
      {},
      editor,
    );
    assert.equal(await pendingVideo.text(), "mp4");
    assert.equal(
      (
        await handleRequest(
          request(`/v1/editor/candidates/${created.id}`, "DELETE"),
          env,
          {},
          editor,
        )
      ).status,
      409,
    );
    const marked = await handleRequest(
      request(`/v1/editor/candidates/${created.id}/uploaded`, "POST", {
        youtubeUrl: `https://youtu.be/${videoId}`,
      }),
      env,
      {},
      editor,
    );
    assert.equal(marked.status, 200);
    assert.equal((await marked.json()).youtubeUrl, `https://www.youtube.com/watch?v=${videoId}`);
    assert.equal(videos.objects.size, 0);
    assert.equal(
      (await handleRequest(request(`/v1/editor/candidates/${created.id}`, "DELETE"), env)).status,
      401,
    );
    const removed = await handleRequest(
      request(`/v1/editor/candidates/${created.id}`, "DELETE"),
      env,
      {},
      editor,
    );
    assert.deepEqual(await removed.json(), { id: created.id, deleted: true });
    assert.deepEqual(
      (await (await handleRequest(request("/v1/editor/candidates"), env, {}, editor)).json()).items,
      [],
    );
    assert.equal(
      (
        await handleRequest(
          request(`/v1/editor/candidates/${created.id}`, "DELETE"),
          env,
          {},
          editor,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await handleRequest(
          request(`/v1/editor/candidates/${created.id}/reject`, "POST", { reason: "Too late" }),
          env,
          {},
          editor,
        )
      ).status,
      404,
    );
  } finally {
    db.close();
  }
});
