import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
import {
  authorizeComboPreview,
  authorizeEditor,
  handleRequest,
  validateRecord,
  verifyAccessJwt,
  youtubeVideoId,
} from "../src/worker.mjs";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const videoId = "M7lc1UVf-VE";
const sourceCandidateId = "12345678-1234-1234-1234-123456789abc";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  return {
    prepare(sql) {
      let statement = sqlite.prepare(sql);
      return {
        bind(...values) {
          const args = values.map((value) => (value === undefined ? null : value));
          return {
            all: async () => ({ results: statement.all(...args) }),
            run: async () => {
              const result = statement.run(...args);
              return { meta: { changes: Number(result.changes) } };
            },
          };
        },
      };
    },
    close: () => sqlite.close(),
  };
}

function combo(id = "aang-basic") {
  return {
    id,
    characterId: "aang",
    supportId: "gyatso",
    route: "2A > 5B > 236A",
    moveIds: ["aang-2a", "aang-5b", "aang-236a"],
    screenPosition: "midscreen",
    damage: "3200",
    resourceCosts: { pips: 1, flow: 0 },
    mechanics: ["corner carry"],
    youtubeUrl: `https://youtu.be/${videoId}`,
  };
}

function request(path, method = "GET", body, headers = {}) {
  return new Request(`https://api.example.com${path}`, {
    method,
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

test("only YouTube links become video IDs; local media cannot enter the shared record", () => {
  assert.equal(youtubeVideoId(`https://www.youtube.com/watch?v=${videoId}&t=15`), videoId);
  assert.throws(() => youtubeVideoId("file:///C:/clip.mp4"));
  assert.throws(() => youtubeVideoId("https://youtube.com.evil.test/watch?v=M7lc1UVf-VE"));
  const result = validateRecord("combo", combo(), "aang-basic");
  assert.equal(result.youtubeVideoId, videoId);
  assert.equal(result.youtubeUrl, undefined);
  assert.equal(result.recordingId, undefined);
  assert.throws(() =>
    validateRecord("combo", { ...combo(), recordingId: "local-1" }, "aang-basic"),
  );
  assert.throws(() =>
    validateRecord("combo", { ...combo(), mp4: "data:video/mp4;base64,..." }, "aang-basic"),
  );
});

test("editor name and difficulty are public, optional, and validated", () => {
  const named = validateRecord(
    "combo",
    {
      ...combo(),
      name: "Reliable 5B",
      difficulty: 3,
      editorPickReason: "Dependable opener",
      editorPickContext: "Midscreen",
    },
    "aang-basic",
  );
  assert.equal(named.name, "Reliable 5B");
  assert.equal(named.difficulty, 3);
  assert.equal(named.editorPickReason, "Dependable opener");
  assert.equal(
    validateRecord("combo", { ...combo(), sourceCandidateId }, "aang-basic").sourceCandidateId,
    sourceCandidateId,
  );
  assert.throws(
    () => validateRecord("combo", { ...combo(), sourceCandidateId: "queue-1" }, "aang-basic"),
    /sourceCandidateId/,
  );
  const legacy = validateRecord("combo", combo(), "aang-basic");
  assert.equal(legacy.name, "");
  assert.equal(legacy.difficulty, null);
  assert.throws(
    () => validateRecord("combo", { ...combo(), difficulty: 0 }, "aang-basic"),
    /difficulty/,
  );
  assert.throws(
    () => validateRecord("combo", { ...combo(), difficulty: 6 }, "aang-basic"),
    /difficulty/,
  );
  assert.throws(
    () => validateRecord("combo", { ...combo(), difficulty: "3" }, "aang-basic"),
    /difficulty/,
  );
});

test("combo notes publish with their route range and reject stale ranges", () => {
  const note = {
    id: "note-1",
    text: "Delay the last hit",
    category: "execution",
    range: { startToken: 1, endToken: 3, excerpt: "5B > 236A" },
  };
  const record = validateRecord("combo", { ...combo(), notes: [note] }, "aang-basic");
  assert.deepEqual(record.notes, [note]);
  assert.throws(
    () =>
      validateRecord(
        "combo",
        { ...combo(), notes: [{ ...note, range: { ...note.range, excerpt: "5B" } }] },
        "aang-basic",
      ),
    /Combo note range no longer matches the route/,
  );
});

test("the Worker advertises and stores combo notes", async () => {
  const db = database();
  const env = { DB: db };
  try {
    const health = await handleRequest(request("/health"), env);
    assert.deepEqual(await health.json(), {
      ok: true,
      features: { comboNotes: true, comboCandidates: false },
    });
    const notes = [
      {
        id: "note-1",
        text: "Delay the last hit",
        category: "execution",
        range: { startToken: 1, endToken: 3, excerpt: "5B > 236A" },
      },
    ];
    const created = await handleRequest(
      request(
        "/v1/editor/combos/aang-basic",
        "PUT",
        {
          ...combo(),
          notes,
          name: "Reliable 5B",
          difficulty: 3,
          editorPickReason: "Easy to confirm",
          editorPickContext: "Midscreen",
        },
        { "If-None-Match": "*" },
      ),
      env,
      {},
      async () => "editor@example.com",
    );
    assert.equal(created.status, 201);
    const list = await handleRequest(request("/v1/combos"), env);
    const published = (await list.json()).items[0];
    assert.deepEqual(published.notes, notes);
    assert.equal(published.name, "Reliable 5B");
    assert.equal(published.difficulty, 3);
    assert.equal(published.editorPickReason, "Easy to confirm");
    assert.equal(published.editorPickContext, "Midscreen");
  } finally {
    db.close();
  }
});

test("move data keeps public mechanics and rejects local evidence", () => {
  const move = {
    id: "aang-5c",
    characterId: "aang",
    input: "5C",
    resourceCosts: { pips: 0, flow: 1 },
    isCharged: true,
    baseMoveId: "aang-5c-base",
    isFlowStance: true,
    flowStanceMinimumTimeToFollowup: 12,
    flowCancellable: true,
    notApplicable: { block: "This move cannot be blocked." },
    onBlock: -4,
  };
  const result = validateRecord("move", move, move.id);
  assert.equal(result.onBlock, -4);
  assert.equal(result.baseMoveId, "aang-5c-base");
  assert.deepEqual(result.notApplicable, move.notApplicable);
  assert.throws(() => validateRecord("move", { ...move, evidence: { startup: {} } }, move.id));
  assert.throws(() => validateRecord("move", { ...move, recordingId: "local" }, move.id));
});

test("Access identity requires a valid signature, audience, issuer and time", async () => {
  const keys = await webcrypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicKey = {
    ...(await webcrypto.subtle.exportKey("jwk", keys.publicKey)),
    kid: "test-key",
  };
  const fetcher = async () => ({ ok: true, json: async () => ({ keys: [publicKey] }) });
  const env = { ACCESS_TEAM_DOMAIN: "test-team", ACCESS_AUD: "test-audience" };
  const claims = {
    iss: "https://test-team.cloudflareaccess.com",
    aud: ["test-audience"],
    email: "Editor@Example.com",
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const token = async (payload) => {
    const unsigned = `${encode({ alg: "RS256", kid: "test-key" })}.${encode(payload)}`;
    const signature = await webcrypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keys.privateKey,
      new TextEncoder().encode(unsigned),
    );
    return `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
  };
  const valid = await token(claims);
  assert.equal(await verifyAccessJwt(valid, env, fetcher), "editor@example.com");
  const accessRequest = new Request("https://api.example.com/v1/editor/combos", {
    headers: { "Cf-Access-Jwt-Assertion": valid },
  });
  assert.equal(
    await authorizeEditor(accessRequest, { ...env, EDITOR_EMAILS: "editor@example.com" }, fetcher),
    "editor@example.com",
  );
  assert.equal(
    await authorizeComboPreview(
      accessRequest,
      { ...env, EDITOR_EMAILS: "editor@example.com" },
      fetcher,
    ),
    "editor@example.com",
  );
  await assert.rejects(() => authorizeComboPreview(accessRequest, env, fetcher));
  assert.equal(
    await authorizeComboPreview(
      accessRequest,
      { ...env, COMBO_PREVIEW_ACCESS_MODE: "access" },
      fetcher,
    ),
    "editor@example.com",
  );
  await assert.rejects(() =>
    authorizeComboPreview(
      new Request(accessRequest.url),
      { ...env, COMBO_PREVIEW_ACCESS_MODE: "access" },
      fetcher,
    ),
  );
  await assert.rejects(() =>
    authorizeEditor(accessRequest, { ...env, EDITOR_EMAILS: "other@example.com" }, fetcher),
  );
  const [header, , signature] = valid.split(".");
  const tampered = `${header}.${encode({ ...claims, email: "other@example.com" })}.${signature}`;
  await assert.rejects(() => verifyAccessJwt(tampered, env, fetcher));
  await assert.rejects(() => verifyAccessJwt(valid, { ...env, ACCESS_AUD: "wrong" }, fetcher));
  const expired = await token({ ...claims, exp: 1 });
  await assert.rejects(() => verifyAccessJwt(expired, env, fetcher));
});

void test("Combos preview permission is separate from editor permission", async () => {
  const db = database();
  const env = { DB: db };
  const denied = async () => {
    throw new Error("Not an editor.");
  };
  const preview = async () => "tester@example.com";
  try {
    const allowed = await handleRequest(
      request("/v1/editor/combo-preview"),
      env,
      {},
      denied,
      preview,
    );
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { allowed: true });
    assert.equal(
      (await handleRequest(request("/v1/editor/combo-preview"), env, {}, denied, denied)).status,
      403,
    );
    assert.equal((await handleRequest(request("/v1/editor/combos"), env, {}, denied)).status, 401);
  } finally {
    db.close();
  }
});

test("public reads, editor writes, revision conflicts and unpublishing", async () => {
  const db = database();
  const env = { DB: db };
  const editor = async () => "editor@example.com";
  try {
    const empty = await handleRequest(request("/v1/combos"), env);
    assert.deepEqual((await empty.json()).items, []);
    const anonymousWrite = await handleRequest(
      request(
        "/v1/editor/combos/aang-basic",
        "PUT",
        { ...combo(), sourceCandidateId },
        { "If-None-Match": "*" },
      ),
      env,
    );
    assert.equal(anonymousWrite.status, 401);
    const created = await handleRequest(
      request(
        "/v1/editor/combos/aang-basic",
        "PUT",
        { ...combo(), sourceCandidateId },
        { "If-None-Match": "*" },
      ),
      env,
      {},
      editor,
    );
    assert.equal(created.status, 201);
    assert.equal((await created.json()).revision, 1);
    const publicList = await handleRequest(request("/v1/combos?character=aang"), env);
    assert.equal((await publicList.json()).items[0].youtubeVideoId, videoId);
    const sourced = await handleRequest(request("/v1/combos?character=aang"), env);
    assert.equal((await sourced.json()).items[0].sourceCandidateId, sourceCandidateId);
    const duplicate = await handleRequest(
      request("/v1/editor/combos/aang-basic", "PUT", combo(), { "If-None-Match": "*" }),
      env,
      {},
      editor,
    );
    assert.equal(duplicate.status, 409);
    const updated = await handleRequest(
      request(
        "/v1/editor/combos/aang-basic",
        "PUT",
        { ...combo(), damage: "3300" },
        { "If-Match": '"1"' },
      ),
      env,
      {},
      editor,
    );
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).revision, 2);
    const preservedSource = await handleRequest(request("/v1/combos"), env);
    assert.equal((await preservedSource.json()).items[0].sourceCandidateId, sourceCandidateId);
    const changedSource = await handleRequest(
      request(
        "/v1/editor/combos/aang-basic",
        "PUT",
        { ...combo(), sourceCandidateId: crypto.randomUUID() },
        { "If-Match": '"2"' },
      ),
      env,
      {},
      editor,
    );
    assert.equal(changedSource.status, 400);
    assert.match((await changedSource.json()).error, /sourceCandidateId cannot change/);
    const unpublished = await handleRequest(
      request("/v1/editor/combos/aang-basic", "DELETE", undefined, { "If-Match": '"2"' }),
      env,
      {},
      editor,
    );
    assert.equal(unpublished.status, 200);
    const after = await handleRequest(request("/v1/combos"), env);
    assert.deepEqual((await after.json()).items, []);
    const editorList = await handleRequest(request("/v1/editor/combos"), env, {}, editor);
    assert.equal((await editorList.json()).items[0].published, false);
  } finally {
    db.close();
  }
});

test("publisher page and assets require editor authorization", async () => {
  const db = database();
  const paths = [];
  const env = {
    DB: db,
    ASSETS: {
      fetch: async (assetRequest) => {
        paths.push(new URL(assetRequest.url).pathname);
        return new Response("asset", { headers: { "Content-Type": "text/html" } });
      },
    },
  };
  try {
    const denied = await handleRequest(request("/v1/editor/app"), env);
    assert.equal(denied.status, 401);
    assert.deepEqual(paths, []);
    const editor = async () => "editor@example.com";
    const page = await handleRequest(request("/v1/editor/app"), env, {}, editor);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("Cache-Control"), "private, no-store");
    assert.match(page.headers.get("Content-Security-Policy"), /script-src 'self'/);
    const script = await handleRequest(request("/v1/editor/app.js"), env, {}, editor);
    assert.equal(script.status, 200);
    assert.deepEqual(paths, ["/v1/editor/app", "/v1/editor/app.js"]);
  } finally {
    db.close();
  }
});
