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

void test("character notes require an editor, preserve guide links, and reject stale updates", async () => {
  const db = database();
  const env = { DB: db };
  const editor = async () => "editor@example.com";
  const note = {
    id: "aang-oki-1",
    kind: "guide",
    characterId: "aang",
    supportId: null,
    title: "Corner plan",
    setup: "",
    sequence: "",
    outcome: "",
    notes: "A detailed plan",
    relatedTechIds: ["aang-pressure-1"],
    relatedComboIds: ["aang-combo-1"],
    videos: [
      {
        title: "Demo",
        description: "Watch the timing",
        url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      },
    ],
  };
  try {
    const denied = await handleRequest(
      request("/v1/editor/character-notes/aang-oki-1", "PUT", note, { "If-None-Match": "*" }),
      env,
    );
    assert.equal(denied.status, 401);
    const created = await handleRequest(
      request("/v1/editor/character-notes/aang-oki-1", "PUT", note, { "If-None-Match": "*" }),
      env,
      {},
      editor,
    );
    assert.equal(created.status, 201);
    const publicList = await handleRequest(request("/v1/character-notes?character=aang"), env);
    const items = (await publicList.json()).items;
    assert.equal(items[0].notes, "A detailed plan");
    assert.deepEqual(items[0].relatedComboIds, ["aang-combo-1"]);
    assert.deepEqual(items[0].videos, [
      { title: "Demo", description: "Watch the timing", youtubeVideoId: "M7lc1UVf-VE" },
    ]);
    assert.equal(items[0].recordingId, undefined);
    const rejectedLocalVideo = await handleRequest(
      request(
        "/v1/editor/character-notes/aang-oki-1",
        "PUT",
        { ...note, videos: [{ ...note.videos[0], localVideoId: "private-file" }] },
        { "If-Match": '"1"' },
      ),
      env,
      {},
      editor,
    );
    assert.equal(rejectedLocalVideo.status, 400);
    const conflict = await handleRequest(
      request(
        "/v1/editor/character-notes/aang-oki-1",
        "PUT",
        { ...note, notes: "old" },
        { "If-None-Match": "*" },
      ),
      env,
      {},
      editor,
    );
    assert.equal(conflict.status, 409);
    const updated = await handleRequest(
      request(
        "/v1/editor/character-notes/aang-oki-1",
        "PUT",
        { ...note, notes: "revised" },
        { "If-Match": '"1"' },
      ),
      env,
      {},
      editor,
    );
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).revision, 2);
    const wrongScope = await handleRequest(
      request(
        "/v1/editor/character-notes/aang-oki-1",
        "PUT",
        { ...note, characterId: "katara" },
        { "If-Match": '"2"' },
      ),
      env,
      {},
      editor,
    );
    assert.equal(wrongScope.status, 409);
  } finally {
    db.close();
  }
});

void test("note sections publish independently and may only contain matching notes", async () => {
  const db = database();
  const env = { DB: db };
  const editor = async () => "editor@example.com";
  const scope = { kind: "oki", characterId: "aang", supportId: "momo" };
  const section = { ...scope, id: "momo-corner", title: "Corner", description: "After a sweep" };
  const note = {
    ...scope,
    id: "momo-sweep",
    title: "Sweep setup",
    videos: [
      {
        title: "Demo",
        description: "Watch the setup",
        url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      },
    ],
  };
  const sectionPath = `/v1/editor/character-note-sections/${section.id}`;
  const notePath = `/v1/editor/character-notes/${note.id}`;
  const call = (req) => handleRequest(req, env, {}, editor);
  const create = { "If-None-Match": "*" };
  try {
    assert.equal(
      (await handleRequest(request(sectionPath, "PUT", section, create), env)).status,
      401,
    );
    assert.equal(
      (await call(request(notePath, "PUT", { ...note, sectionId: section.id }, create))).status,
      400,
    );
    assert.equal((await call(request(sectionPath, "PUT", section, create))).status, 201);
    assert.equal((await call(request(sectionPath, "PUT", section, create))).status, 409);
    for (const mismatch of [{ kind: "pressure" }, { characterId: "katara" }, { supportId: null }]) {
      const result = await call(
        request(notePath, "PUT", { ...note, ...mismatch, sectionId: section.id }, create),
      );
      assert.equal(result.status, 400);
    }
    assert.equal((await call(request(notePath, "PUT", note, create))).status, 201);
    assert.equal(
      (
        await call(
          request(notePath, "PUT", { ...note, sectionId: section.id }, { "If-Match": '"1"' }),
        )
      ).status,
      200,
    );
    const catalog = await (
      await handleRequest(request("/v1/character-notes?character=aang&support=momo"), env)
    ).json();
    assert.deepEqual(catalog.sections, [{ ...section, revision: 1 }]);
    assert.equal(catalog.items[0].sectionId, section.id);
    assert.equal(catalog.items[0].revision, 2);
    assert.deepEqual(catalog.items[0].videos, [
      { title: "Demo", description: "Watch the setup", youtubeVideoId: "M7lc1UVf-VE" },
    ]);
    const otherSupport = await (
      await handleRequest(request("/v1/character-notes?character=aang&support=appa"), env)
    ).json();
    assert.deepEqual(otherSupport, { items: [], sections: [] });
  } finally {
    db.close();
  }
});
