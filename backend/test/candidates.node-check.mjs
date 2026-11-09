import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { handleRequest } from "../src/worker.mjs";

const { processComboInputCapture } = createRequire(import.meta.url)(
  "../../electron/combo-input-processing.cjs",
);

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const submitterMigration = readFileSync(
  new URL("../migrations/001_candidate_submitter_email.sql", import.meta.url),
  "utf8",
);
const videoId = "M7lc1UVf-VE";

void test("submitter migration keeps existing candidate rows", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(schema.replace(/^  submitter_email TEXT,\r?\n/m, ""));
    sqlite
      .prepare(`
      INSERT INTO combo_candidates
        (id, combo_payload, file_name, file_size, object_key, upload_id,
         upload_token_hash, status, created_at, updated_at)
      VALUES (?, '{}', 'old.mp4', 1, ?, 'upload', 'hash', 'uploading', 'now', 'now')
    `)
      .run("old-id", "combo-candidates/old-id.mp4");
    sqlite.exec(submitterMigration);
    const row = sqlite.prepare("SELECT id, submitter_email FROM combo_candidates").get();
    assert.equal(row.id, "old-id");
    assert.equal(row.submitter_email, null);
  } finally {
    sqlite.close();
  }
});

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

function processedInput() {
  return {
    schemaVersion: 1,
    processorVersion: 10,
    processedAt: "2026-11-06T00:00:00.000Z",
    source: {
      kind: "comboInputCapture",
      sha256: "a".repeat(64),
      durationMs: 1000,
      stateCount: 2,
      timing: "approximate",
      rawStartMs: 0,
      editsSha256: "b".repeat(64),
    },
    context: { defaultFacing: "right", defaultPosition: "grounded" },
    directionChanges: [
      {
        timeMs: 0,
        sourceStateIndex: 0,
        direction: 5,
        heldButtons: [],
        heldGameButtons: [],
      },
    ],
    presses: [
      {
        timeMs: 100,
        sourceStateIndex: 1,
        physicalButton: "Y",
        gameAction: "Atk2",
        gameButton: "B",
        context: { facing: "right", position: "grounded" },
        positionAfter: null,
        manualEdit: null,
        interpretations: {
          right: {
            direction: 5,
            motion: null,
            directionPath: null,
            suggestedNotation: "5B",
            notation: "5B",
          },
          left: {
            direction: 5,
            motion: null,
            directionPath: null,
            suggestedNotation: "5B",
            notation: "5B",
          },
        },
      },
    ],
    routes: { right: "5B > 236A", left: "5B > 214A" },
  };
}

async function submit(env, options = {}) {
  const response = await handleRequest(
    request("/v1/editor/candidates/upload", "POST", {
      combo: options.processedInput
        ? { ...(options.combo ?? combo()), route: undefined }
        : (options.combo ?? combo()),
      ...(options.originCandidateId ? { originCandidateId: options.originCandidateId } : {}),
      ...(options.processedInput
        ? { processedInput: options.processedInput, inputFacing: options.inputFacing ?? "right" }
        : {}),
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
    options.context ?? {},
    undefined,
    undefined,
    undefined,
    undefined,
    options.fetchDiscord,
  );
  assert.equal(completed.status, 200);
  return created;
}

void test("a completed candidate sends one Discord alert after entering the review queue", async () => {
  const db = database();
  const videos = bucket();
  const tasks = [];
  const sent = [];
  const env = {
    DB: db,
    CANDIDATE_VIDEOS: videos,
    DISCORD_ALERT_WEBHOOK_URL: "https://discord.com/api/webhooks/123/token",
  };
  const context = { waitUntil: (promise) => tasks.push(promise) };
  const fetchDiscord = async (url, options) => {
    sent.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(null, { status: 204 });
  };
  try {
    const created = await submit(env, { context, fetchDiscord });
    await Promise.all(tasks);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, env.DISCORD_ALERT_WEBHOOK_URL);
    assert.equal(
      sent[0].body.content,
      `New combo candidate from uploader@example.com ready for review: candidate ID: ${created.id}\naang / katara (302): 5B > 236A`,
    );
    const row = await db
      .prepare("SELECT submitter_email FROM combo_candidates WHERE id = ?")
      .bind(created.id)
      .all();
    assert.equal(row.results[0].submitter_email, "uploader@example.com");
    assert.deepEqual(sent[0].body.allowed_mentions, { parse: [] });
    const repeated = await handleRequest(
      request(
        `/v1/candidates/${created.id}/complete`,
        "POST",
        { parts: [] },
        {
          "X-Candidate-Token": created.token,
        },
      ),
      env,
      context,
      undefined,
      undefined,
      undefined,
      undefined,
      fetchDiscord,
    );
    assert.equal(repeated.status, 200);
    assert.equal(sent.length, 1);
  } finally {
    db.close();
  }
});

void test("a Discord delivery failure does not fail a completed candidate", async () => {
  const db = database();
  const videos = bucket();
  const tasks = [];
  const env = {
    DB: db,
    CANDIDATE_VIDEOS: videos,
    DISCORD_ALERT_WEBHOOK_URL: "https://discord.com/api/webhooks/123/token",
  };
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    const created = await submit(env, {
      context: { waitUntil: (promise) => tasks.push(promise) },
      fetchDiscord: async () => new Response(null, { status: 500 }),
    });
    await Promise.all(tasks);
    const row = await db
      .prepare("SELECT status FROM combo_candidates WHERE id = ?")
      .bind(created.id)
      .all();
    assert.equal(row.results[0].status, "pending");
    assert.match(errors[0][1], /Discord rejected the alert/);
  } finally {
    console.error = originalError;
    db.close();
  }
});

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
    const inputs = processedInput();
    const duplicate = await submit(env, {
      originCandidateId: created.id,
      processedInput: inputs,
    });
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
    const publishedCombo = await published.json();
    assert.equal(publishedCombo.sourceCandidateId, created.id);
    assert.deepEqual(publishedCombo.processedInput, inputs);
    assert.equal(publishedCombo.inputFacing, "right");
    const publicCatalog = await handleRequest(request("/v1/combos"), env);
    assert.equal((await publicCatalog.json()).items[0].processedInput, undefined);
    const publicInputs = await handleRequest(request(`/v1/combos/${combo().id}/inputs`), env);
    assert.equal(publicInputs.status, 200);
    assert.deepEqual((await publicInputs.json()).processedInput, inputs);
    assert.deepEqual(
      (await (await handleRequest(request("/v1/editor/candidates"), env, {}, editor)).json()).items,
      [],
    );
    assert.equal(videos.objects.size, 0);
    const revised = await handleRequest(
      request(path, "PUT", { ...payload, damage: "400" }, { "If-Match": '"1"' }),
      env,
      {},
      editor,
    );
    assert.equal(revised.status, 200);
    assert.deepEqual((await revised.json()).processedInput, inputs);
    assert.deepEqual(
      (await (await handleRequest(request(`/v1/combos/${combo().id}/inputs`), env)).json())
        .processedInput,
      inputs,
    );
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

void test("processed combo inputs accompany a candidate and survive route revisions", async () => {
  const db = database();
  const env = { DB: db, CANDIDATE_VIDEOS: bucket() };
  const editor = async () => "editor@example.com";
  try {
    const inputs = processedInput();
    const created = await submit(env, { processedInput: inputs });
    const initial = (
      await (await handleRequest(request("/v1/editor/candidates"), env, {}, editor)).json()
    ).items[0];
    assert.deepEqual(initial.processedInput, inputs);
    assert.equal(initial.inputFacing, "right");
    assert.equal(initial.combo.route, inputs.routes.right);
    const revised = await handleRequest(
      request(`/v1/editor/candidates/${created.id}`, "PATCH", {
        combo: { ...combo(), route: "5B > 236A > 5B" },
        updatedAt: initial.updatedAt,
      }),
      env,
      {},
      editor,
    );
    assert.equal(revised.status, 200);
    assert.deepEqual((await revised.json()).processedInput, inputs);
    const published = await handleRequest(
      request(
        `/v1/editor/combos/${combo().id}`,
        "PUT",
        {
          ...combo(),
          route: "5B > 236A > 5B",
          sourceCandidateId: created.id,
          youtubeUrl: `https://youtu.be/${videoId}`,
        },
        { "If-None-Match": "*" },
      ),
      env,
      {},
      editor,
    );
    assert.equal(published.status, 201);
    assert.deepEqual((await published.json()).processedInput, inputs);

    const mismatch = await handleRequest(
      request("/v1/editor/candidates/upload", "POST", {
        combo: combo(),
        processedInput: { ...inputs, routes: { ...inputs.routes, right: "5A" } },
        inputFacing: "right",
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
    assert.equal(mismatch.status, 400);
    assert.match((await mismatch.json()).error, /processed input route/);
  } finally {
    db.close();
  }
});

void test("candidate upload accepts the local processor's event artifact", async () => {
  const db = database();
  const env = { DB: db, CANDIDATE_VIDEOS: bucket() };
  try {
    const processed = processComboInputCapture(
      {
        schemaVersion: 1,
        source: "xinput",
        deviceIndex: 0,
        bindings: { X: "Atk1" },
        status: "complete",
        timing: "approximate",
        durationMs: 300,
        states: [
          { timeMs: 0, direction: 5, stickDirection: 5, buttons: [], actions: [] },
          { timeMs: 100, direction: 5, stickDirection: 5, buttons: ["X"], actions: ["Atk1"] },
        ],
      },
      "2026-11-06T00:00:00.000Z",
      0,
      { schemaVersion: 1, presses: { "100:X": { charged: true, directionOverride: "236" } } },
    );
    const created = await submit(env, { processedInput: processed });
    const listed = await handleRequest(
      request("/v1/editor/candidates"),
      env,
      {},
      async () => "editor@example.com",
    );
    assert.equal(listed.status, 200);
    const candidate = (await listed.json()).items[0];
    assert.equal(candidate.id, created.id);
    assert.equal(candidate.combo.route, "236[A]");
    assert.deepEqual(candidate.processedInput.presses, processed.presses);
  } finally {
    db.close();
  }
});

void test("an editor revises a queued candidate in place before publication", async () => {
  const db = database();
  const videos = bucket();
  const env = { DB: db, CANDIDATE_VIDEOS: videos };
  const editor = async () => "editor@example.com";
  try {
    const created = await submit(env);
    const url = `/v1/editor/candidates/${created.id}`;
    const initial = (
      await (await handleRequest(request("/v1/editor/candidates"), env, {}, editor)).json()
    ).items[0];
    const editedCombo = { ...combo(), name: "Trimmed route", route: "5B > 236A > 5B" };
    const denied = await handleRequest(
      request(url, "PATCH", { combo: editedCombo, updatedAt: initial.updatedAt }),
      env,
    );
    assert.equal(denied.status, 401);
    const approved = await handleRequest(request(`${url}/approve`, "POST"), env, {}, editor);
    const approvedCandidate = await approved.json();
    assert.equal(approvedCandidate.status, "approved");
    const revised = await handleRequest(
      request(url, "PATCH", { combo: editedCombo, updatedAt: approvedCandidate.updatedAt }),
      env,
      {},
      editor,
    );
    assert.equal(revised.status, 200);
    const next = await revised.json();
    assert.equal(next.id, created.id);
    assert.equal(next.originCandidateId, created.id);
    assert.equal(next.status, "pending");
    assert.equal(next.combo.name, "Trimmed route");
    assert.equal(next.combo.route, "5B > 236A > 5B");
    assert.equal(videos.objects.size, 1);
    assert.equal(
      await (await handleRequest(request(`${url}/video`), env, {}, editor)).text(),
      "mp4",
    );
    const stale = await handleRequest(
      request(url, "PATCH", {
        combo: { ...editedCombo, damage: "400" },
        updatedAt: initial.updatedAt,
      }),
      env,
      {},
      editor,
    );
    assert.equal(stale.status, 409);
    const invalid = await handleRequest(
      request(url, "PATCH", {
        combo: { ...editedCombo, youtubeUrl: `https://youtu.be/${videoId}` },
        updatedAt: next.updatedAt,
      }),
      env,
      {},
      editor,
    );
    assert.equal(invalid.status, 400);
    const listed = (
      await (await handleRequest(request("/v1/editor/candidates"), env, {}, editor)).json()
    ).items;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].combo.route, editedCombo.route);
  } finally {
    db.close();
  }
});
