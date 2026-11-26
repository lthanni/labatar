import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { handleRequest } from "../src/worker.mjs";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const editor = async () => "editor@example.com";
const denied = async () => {
  throw new Error("Denied");
};

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

void test("character and support tech are scoped and include ordered YouTube clips", async () => {
  const db = database();
  const env = { DB: db };
  try {
    const section = {
      id: "aang-movement",
      scopeKind: "character",
      subjectId: "aang",
      title: "Movement",
      description: "Air options",
      sortOrder: 1,
    };
    const supportSection = {
      id: "gyatso-assists",
      scopeKind: "support",
      subjectId: "gyatso",
      title: "Assist tools",
      description: "",
      sortOrder: 2,
    };
    assert.equal(
      (
        await handleRequest(
          request("/v1/editor/tech-sections/aang-movement", "PUT", section, {
            "If-None-Match": "*",
          }),
          env,
          {},
          editor,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await handleRequest(
          request("/v1/editor/tech-sections/gyatso-assists", "PUT", supportSection, {
            "If-None-Match": "*",
          }),
          env,
          {},
          editor,
        )
      ).status,
      201,
    );
    const entry = {
      id: "aang-air-stall",
      sectionId: "aang-movement",
      title: "Air stall",
      description: "Briefly delay descent.",
      notation: "j.2B",
      videos: [
        { title: "Setup", description: "Input timing", url: "https://youtu.be/M7lc1UVf-VE" },
        {
          title: "Follow up",
          description: "Conversion",
          url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        },
      ],
      sortOrder: 0,
    };
    assert.equal(
      (
        await handleRequest(
          request("/v1/editor/tech-entries/aang-air-stall", "PUT", entry, { "If-None-Match": "*" }),
          env,
          {},
          denied,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await handleRequest(
          request("/v1/editor/tech-entries/aang-air-stall", "PUT", entry, { "If-None-Match": "*" }),
          env,
          {},
          editor,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await handleRequest(
          request("/v1/editor/tech-entries/aang-air-stall", "PUT", entry, { "If-None-Match": "*" }),
          env,
          {},
          editor,
        )
      ).status,
      409,
    );
    const publicList = await handleRequest(request("/v1/tech?character=aang&support=gyatso"), env);
    assert.equal(publicList.status, 200);
    const body = await publicList.json();
    assert.equal(body.sections.length, 2);
    assert.equal(body.entries[0].videos.length, 2);
    assert.equal(body.entries[0].videos[0].youtubeVideoId, "M7lc1UVf-VE");
    assert.equal(body.entries[0].videos[0].url, undefined);
    const supportOnly = await handleRequest(request("/v1/tech?support=gyatso"), env);
    assert.deepEqual(
      (await supportOnly.json()).sections.map((item) => item.id),
      ["gyatso-assists"],
    );
    assert.equal(
      (await (await handleRequest(request("/v1/tech?character=korra&support=katara"), env)).json())
        .sections.length,
      0,
    );
    const bad = {
      ...entry,
      videos: [
        { title: "Bad", description: "", url: "https://youtube.com.evil.test/watch?v=M7lc1UVf-VE" },
      ],
    };
    assert.equal(
      (
        await handleRequest(
          request("/v1/editor/tech-entries/aang-air-stall", "PUT", bad, { "If-Match": '"1"' }),
          env,
          {},
          editor,
        )
      ).status,
      400,
    );
    const blankVideoText = {
      ...entry,
      videos: [{ title: "", description: "", url: "https://youtu.be/M7lc1UVf-VE" }],
    };
    assert.equal(
      (
        await handleRequest(
          request("/v1/editor/tech-entries/aang-air-stall", "PUT", blankVideoText, {
            "If-Match": '"1"',
          }),
          env,
          {},
          editor,
        )
      ).status,
      200,
    );
    const updatedCatalog = await (
      await handleRequest(request("/v1/tech?character=aang"), env)
    ).json();
    assert.deepEqual(updatedCatalog.entries[0].videos, [
      { title: "", description: "", youtubeVideoId: "M7lc1UVf-VE" },
    ]);
    assert.equal(
      (
        await handleRequest(
          request("/v1/editor/tech-entries/aang-air-stall", "DELETE", undefined, {
            "If-Match": '"2"',
          }),
          env,
          {},
          editor,
        )
      ).status,
      200,
    );
    assert.equal(
      (await (await handleRequest(request("/v1/tech?character=aang"), env)).json()).entries.length,
      0,
    );
    assert.equal(
      (
        await handleRequest(
          request("/v1/editor/tech-sections/gyatso-assists", "DELETE", undefined, {
            "If-Match": '"1"',
          }),
          env,
          {},
          editor,
        )
      ).status,
      200,
    );
    assert.deepEqual(
      (
        await (await handleRequest(request("/v1/tech?character=aang&support=gyatso"), env)).json()
      ).sections.map((item) => item.id),
      ["aang-movement"],
    );
  } finally {
    db.close();
  }
});

void test("Tech editor assets require an editor session", async () => {
  const db = database();
  const paths = [];
  const env = {
    DB: db,
    ASSETS: {
      fetch: async (request) => {
        paths.push(new URL(request.url).pathname);
        return new Response("asset", { headers: { "Content-Type": "text/html" } });
      },
    },
  };
  try {
    assert.equal((await handleRequest(request("/v1/editor/tech"), env, {}, denied)).status, 401);
    assert.deepEqual(paths, []);
    const page = await handleRequest(request("/v1/editor/tech"), env, {}, editor);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("Content-Security-Policy"), /script-src 'self'/);
    assert.equal((await handleRequest(request("/v1/editor/tech.js"), env, {}, editor)).status, 200);
    assert.deepEqual(paths, ["/v1/editor/tech", "/v1/editor/tech.js"]);
  } finally {
    db.close();
  }
});
