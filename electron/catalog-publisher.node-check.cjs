const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertExpectedRevision,
  publisherRequestWithTimeout,
  publisherReadWithRecovery,
  listEditorCombos,
  isCatalogOwner,
  unpublishCombo,
} = require("./catalog-publisher.cjs");

void test("route audit owner check fails closed without revealing access roles", async () => {
  const ses = {
    async fetch(url, options) {
      assert.equal(new URL(url).pathname, "/v1/editor/access-roles");
      assert.equal(options.credentials, "include");
      return Response.json({ owner: "owner@example.com", items: [] });
    },
  };
  assert.equal(await isCatalogOwner(ses), true);
  ses.fetch = async () => Response.json({ error: "Not owner" }, { status: 403 });
  assert.equal(await isCatalogOwner(ses), false);
  ses.fetch = async () => new Response("Sign in", { status: 200 });
  assert.equal(await isCatalogOwner(ses), false);
  ses.fetch = async () => {
    throw new Error("Offline");
  };
  assert.equal(await isCatalogOwner(ses), false);
});

void test("catalog requests time out and abort instead of leaving the modal waiting", async () => {
  let signal;
  await assert.rejects(
    publisherRequestWithTimeout(
      "Candidate request",
      (requestSignal) => {
        signal = requestSignal;
        return new Promise(() => {});
      },
      5,
    ),
    /Candidate request timed out/,
  );
  assert.equal(signal.aborted, true);
});

void test("a local catalog revision cannot overwrite a newer revision", () => {
  assert.doesNotThrow(() => assertExpectedRevision(3, { revision: 3 }));
  assert.throws(() => assertExpectedRevision(3, { revision: 4 }), /changed since this local draft/);
  assert.throws(() => assertExpectedRevision(3, undefined), /changed since this local draft/);
  assert.throws(() => assertExpectedRevision(0, { revision: 1 }), /changed since this local draft/);
  assert.doesNotThrow(() => assertExpectedRevision(0, undefined));
});

void test("catalog sign-in preflight resets a stalled session and retries its read", async () => {
  let requests = 0;
  let resets = 0;
  const ses = {
    async fetch(_url, options) {
      requests += 1;
      assert.equal(options.method ?? "GET", "GET");
      if (requests === 1) return new Promise(() => {});
      return Response.json({ items: [{ id: "catalog-combo" }] });
    },
    async closeAllConnections() {
      resets += 1;
    },
  };
  const items = await listEditorCombos(ses, 5);
  assert.deepEqual(items, [{ id: "catalog-combo" }]);
  assert.equal(requests, 2);
  assert.equal(resets, 1);
});

void test("catalog preflight reports a persistent timeout after one connection reset", async () => {
  let resets = 0;
  const ses = {
    fetch: async () => new Promise(() => {}),
    closeAllConnections: async () => {
      resets += 1;
    },
  };
  await assert.rejects(
    publisherReadWithRecovery(ses, "Catalog sign-in check", () => ses.fetch(), 5),
    /Catalog sign-in check still timed out after reconnecting/,
  );
  assert.equal(resets, 1);
});

void test("catalog sign-in preflight uses the editor catalog endpoint", async () => {
  const ses = {
    async fetch(url, options) {
      assert.equal(new URL(url).pathname, "/v1/editor/combos");
      assert.equal(options.credentials, "include");
      return Response.json({ items: [{ id: "catalog-combo" }] });
    },
  };
  assert.deepEqual(await listEditorCombos(ses), [{ id: "catalog-combo" }]);
});

void test("catalog sign-in preflight treats an Electron cancelled redirect as sign-in required", async () => {
  const ses = {
    async fetch() {
      throw new Error("Redirect was cancelled");
    },
  };
  assert.equal(await listEditorCombos(ses), null);
});

void test("catalog delete confirms the current combo and sends a revision-checked DELETE", async () => {
  const requests = [];
  const ses = {
    async fetch(url, options) {
      requests.push({ url, options });
      if (options.method === "DELETE") {
        return Response.json({ id: "aang-basic", revision: 4, published: false });
      }
      return Response.json({
        items: [
          {
            id: "aang-basic",
            revision: 3,
            published: true,
            characterId: "aang",
            supportId: "katara",
            route: "5A 5B",
          },
        ],
      });
    },
  };
  let confirmation;
  const result = await unpublishCombo(
    { id: "aang-basic", expectedRevision: 3 },
    null,
    undefined,
    ses,
    async (options) => {
      confirmation = options;
      return { response: 0 };
    },
  );
  assert.deepEqual(result, { cancelled: false, id: "aang-basic", revision: 4 });
  assert.match(confirmation.message, /aang-basic/);
  assert.equal(confirmation.defaultId, 1);
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1].url).pathname, "/v1/editor/combos/aang-basic");
  assert.equal(requests[1].options.method, "DELETE");
  assert.equal(requests[1].options.headers["If-Match"], '"3"');
});

void test("catalog delete does not send a write when cancelled or the revision changed", async () => {
  let writes = 0;
  const ses = {
    async fetch(_url, options) {
      if (options.method === "DELETE") writes += 1;
      return Response.json({
        items: [{ id: "aang-basic", revision: 3, published: true }],
      });
    },
  };
  assert.deepEqual(
    await unpublishCombo(
      { id: "aang-basic", expectedRevision: 3 },
      null,
      undefined,
      ses,
      async () => ({ response: 1 }),
    ),
    { cancelled: true },
  );
  await assert.rejects(
    unpublishCombo({ id: "aang-basic", expectedRevision: 2 }, null, undefined, ses),
    /changed/,
  );
  assert.equal(writes, 0);
});

void test("catalog delete does not send a write when editor access is denied", async () => {
  let writes = 0;
  const ses = {
    async fetch(_url, options) {
      if (options.method === "DELETE") writes += 1;
      return Response.json({ error: "Editor authentication required." }, { status: 403 });
    },
  };
  await assert.rejects(
    unpublishCombo({ id: "aang-basic", expectedRevision: 3 }, null, undefined, ses),
    /Editor authentication required/,
  );
  assert.equal(writes, 0);
});
