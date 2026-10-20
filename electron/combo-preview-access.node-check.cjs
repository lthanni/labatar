const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkComboPreviewAccess } = require("./combo-preview-access.cjs");

void test("Combos preview checks the dedicated permission endpoint", async () => {
  const ses = {
    async fetch(url, options) {
      assert.equal(new URL(url).pathname, "/v1/editor/combo-preview");
      assert.equal(options.credentials, "include");
      assert.equal(options.redirect, "manual");
      return Response.json({ allowed: true });
    },
  };
  assert.equal(await checkComboPreviewAccess(ses), true);
});

void test("Combos preview stays unavailable without permission or sign-in", async () => {
  for (const status of [302, 403]) {
    const ses = { fetch: async () => new Response(null, { status }) };
    assert.equal(await checkComboPreviewAccess(ses), false);
  }
  const redirected = {
    fetch: async () => {
      throw new Error("Redirect was cancelled");
    },
  };
  assert.equal(await checkComboPreviewAccess(redirected), false);
});
