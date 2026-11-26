import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { handleRequest } from "../src/worker.mjs";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  return {
    applySchema: () => sqlite.exec(schema),
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            all: async () => ({ results: statement.all(...values) }),
            run: async () => ({ meta: { changes: Number(statement.run(...values).changes) } }),
          };
        },
      };
    },
    close: () => sqlite.close(),
  };
}

function request(path, method = "GET", body, headers = {}) {
  return new Request(`https://api.example.com${path}`, {
    method,
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

void test("legacy channels migrate once and player edits replace the complete link list", async () => {
  const db = database();
  const env = { DB: db };
  const editor = async () => "editor@example.com";
  const scope = { id: "momo-player", scopeKind: "support", subjectId: "momo", title: "Momo" };
  const youtube = "https://www.youtube.com/@momo";
  const twitch = "https://www.twitch.tv/momo";
  const playerPath = `/v1/editor/players/${scope.id}`;
  const publicPath = "/v1/players?character=aang&support=momo";
  const call = (req) => handleRequest(req, env, {}, editor);
  try {
    assert.equal(
      (
        await call(
          request(
            `/v1/editor/channels/${scope.id}`,
            "PUT",
            {
              ...scope,
              platform: "YouTube",
              url: youtube,
            },
            { "If-None-Match": "*" },
          ),
        )
      ).status,
      201,
    );
    db.applySchema();
    assert.deepEqual((await (await call(request(publicPath))).json()).items, [
      { ...scope, links: [youtube], revision: 1 },
    ]);
    assert.deepEqual((await (await call(request("/v1/players?character=aang"))).json()).items, []);

    const update = request(
      playerPath,
      "PUT",
      { ...scope, links: [youtube, twitch] },
      { "If-Match": '"1"' },
    );
    assert.equal((await handleRequest(update.clone(), env)).status, 401);
    for (const invalidLinks of [[], [youtube, youtube], [youtube, "javascript:alert(1)"]]) {
      const invalid = request(
        playerPath,
        "PUT",
        { ...scope, links: invalidLinks },
        { "If-Match": '"1"' },
      );
      assert.equal((await call(invalid)).status, 400);
    }
    assert.equal((await call(update.clone())).status, 200);
    assert.equal((await call(update)).status, 409);
    db.applySchema();
    assert.deepEqual((await (await call(request(publicPath))).json()).items, [
      { ...scope, links: [youtube, twitch], revision: 2 },
    ]);

    const removedLink = await call(
      request(playerPath, "PUT", { ...scope, links: [twitch] }, { "If-Match": '"2"' }),
    );
    assert.equal(removedLink.status, 200);
    assert.deepEqual((await (await call(request(publicPath))).json()).items, [
      { ...scope, links: [twitch], revision: 3 },
    ]);
    assert.equal(
      (await call(request(playerPath, "DELETE", undefined, { "If-Match": '"3"' }))).status,
      200,
    );
    db.applySchema();
    assert.deepEqual((await (await call(request(publicPath))).json()).items, []);
  } finally {
    db.close();
  }
});

void test("channel links are editor managed, scoped, and revision checked", async () => {
  const db = database();
  const env = { DB: db };
  const editor = async () => "editor@example.com";
  const channel = {
    id: "aang-youtube",
    scopeKind: "character",
    subjectId: "aang",
    platform: "YouTube",
    title: "Aang Channel",
    url: "https://www.youtube.com/@aang",
  };
  try {
    const denied = await handleRequest(
      request("/v1/editor/channels/aang-youtube", "PUT", channel, { "If-None-Match": "*" }),
      env,
    );
    assert.equal(denied.status, 401);
    const unsafe = await handleRequest(
      request(
        "/v1/editor/channels/aang-youtube",
        "PUT",
        { ...channel, url: "javascript:alert(1)" },
        { "If-None-Match": "*" },
      ),
      env,
      {},
      editor,
    );
    assert.equal(unsafe.status, 400);
    const created = await handleRequest(
      request("/v1/editor/channels/aang-youtube", "PUT", channel, { "If-None-Match": "*" }),
      env,
      {},
      editor,
    );
    assert.equal(created.status, 201);
    assert.equal((await created.json()).revision, 1);
    assert.equal(
      (await (await handleRequest(request("/v1/channels?character=aang&support=momo"), env)).json())
        .items.length,
      1,
    );
    assert.equal(
      (await (await handleRequest(request("/v1/channels?character=katara"), env)).json()).items
        .length,
      0,
    );
    const stale = await handleRequest(
      request("/v1/editor/channels/aang-youtube", "PUT", channel, { "If-None-Match": "*" }),
      env,
      {},
      editor,
    );
    assert.equal(stale.status, 409);
    const changedScope = await handleRequest(
      request(
        "/v1/editor/channels/aang-youtube",
        "PUT",
        { ...channel, subjectId: "katara" },
        { "If-Match": '"1"' },
      ),
      env,
      {},
      editor,
    );
    assert.equal(changedScope.status, 409);
    const removed = await handleRequest(
      request("/v1/editor/channels/aang-youtube", "DELETE", undefined, { "If-Match": '"1"' }),
      env,
      {},
      editor,
    );
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).revision, 2);
    assert.deepEqual(
      (await (await handleRequest(request("/v1/channels?character=aang"), env)).json()).items,
      [],
    );
    const restored = await handleRequest(
      request("/v1/editor/channels/aang-youtube", "PUT", channel, { "If-Match": '"2"' }),
      env,
      {},
      editor,
    );
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).revision, 3);
  } finally {
    db.close();
  }
});

void test("support channels follow the selected support across characters", async () => {
  const db = database();
  const env = { DB: db };
  const editor = async () => "editor@example.com";
  const support = {
    id: "momo-twitch",
    scopeKind: "support",
    subjectId: "momo",
    platform: "Twitch",
    title: "Momo",
    url: "https://twitch.tv/momo",
  };
  try {
    const created = await handleRequest(
      request("/v1/editor/channels/momo-twitch", "PUT", support, { "If-None-Match": "*" }),
      env,
      {},
      editor,
    );
    assert.equal(created.status, 201);
    assert.equal(
      (await (await handleRequest(request("/v1/channels?character=aang&support=momo"), env)).json())
        .items.length,
      1,
    );
    assert.equal(
      (
        await (
          await handleRequest(request("/v1/channels?character=katara&support=momo"), env)
        ).json()
      ).items.length,
      1,
    );
    assert.equal(
      (await (await handleRequest(request("/v1/channels?character=aang&support=appa"), env)).json())
        .items.length,
      0,
    );
  } finally {
    db.close();
  }
});
