const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createReplayStagingStore } = require("./replay-staging.cjs");

void test("prepares only the linked recording replay and verifies its identity when switching", async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-replay-staging-test-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const game = await fs.realpath(fixture);
  const live = path.join(game, "replays");
  await Promise.all([fs.mkdir(live), fs.mkdir(path.join(game, "data_packages"))]);
  const store = createReplayStagingStore(path.join(game, "labatar"));
  const matchPath = path.join(live, "match.dlr");
  const otherPath = path.join(live, "other.dlr");
  const linked = (data) => ({
    path: matchPath,
    contentHash: createHash("sha256").update(data).digest("hex"),
  });
  await Promise.all([fs.writeFile(matchPath, "original"), fs.writeFile(otherPath, "other")]);

  const original = linked("original");
  assert.deepEqual(await store.preview(game, undefined, original), {
    selectedCount: 1,
    archivedCount: 2,
    switching: false,
  });
  await assert.rejects(store.stage(game, undefined, linked("missing")), /missing or has changed/);
  assert.deepEqual((await fs.readdir(live)).sort(), ["match.dlr", "other.dlr"]);

  await store.stage(game, ["replays/other.dlr"]);
  await fs.writeFile(matchPath, "new replay with the same name");
  const newReplay = linked("new replay with the same name");
  await store.stage(game, undefined, newReplay);
  assert.deepEqual(await fs.readdir(live), ["match.dlr"]);
  assert.equal(await fs.readFile(matchPath, "utf8"), "new replay with the same name");

  await store.stage(game, undefined, original);
  assert.equal(await fs.readFile(matchPath, "utf8"), "original");
  await store.restore();
  assert.equal(await fs.readFile(otherPath, "utf8"), "other");
});
