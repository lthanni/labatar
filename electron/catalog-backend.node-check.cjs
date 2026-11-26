const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "catalog-backend.cjs"), "utf8");

function loadBackend(isPackaged, env = {}) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    process: { env },
    URL,
    require: (name) => {
      assert.equal(name, "electron");
      return { app: { isPackaged } };
    },
  });
  return module.exports;
}

void test("development switches catalog requests between hosted and local origins", () => {
  const backend = loadBackend(false);
  assert.equal(backend.getCatalogBackend().mode, "hosted");
  assert.equal(backend.setCatalogBackend("local").origin, "http://127.0.0.1:8787");
  assert.equal(backend.getCatalogOrigin(), "http://127.0.0.1:8787");
  assert.equal(
    backend.setCatalogBackend("hosted").origin,
    "https://labatar-catalog.landenhanni.workers.dev",
  );
});

void test("development accepts only a local HTTP override", () => {
  const custom = loadBackend(false, { VITE_CATALOG_API_URL: "http://localhost:9999" });
  assert.equal(custom.getCatalogBackend().origin, "http://localhost:9999");
  const invalid = loadBackend(false, { VITE_CATALOG_API_URL: "https://example.com" });
  assert.throws(() => invalid.getCatalogBackend(), /local HTTP origin/);
});

void test("packaged builds always use the hosted catalog", () => {
  const backend = loadBackend(true, { VITE_CATALOG_API_URL: "http://127.0.0.1:8787" });
  assert.equal(backend.getCatalogBackend().mode, "hosted");
  assert.throws(() => backend.setCatalogBackend("local"), /only in development/);
});
