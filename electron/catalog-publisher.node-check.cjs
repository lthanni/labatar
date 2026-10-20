const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertExpectedRevision,
  publisherRequestWithTimeout,
  publisherReadWithRecovery,
  listEditorCombos,
} = require("./catalog-publisher.cjs");

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
