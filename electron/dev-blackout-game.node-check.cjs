const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const {
  replacements,
  sha256,
  waitForStableGame,
  readSession,
  writeSession,
  prepareSession,
  installSession,
  verifyInstalled,
  verifyInstalledAssets,
  restoreSession,
  watchAndRestore,
} = require("./dev-blackout-game.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-blackout-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const gameRoot = path.join(root, "game");
  const sourceRoot = path.join(root, "patches");
  const backupRoot = path.join(root, "backups");
  await fs.mkdir(path.join(gameRoot, "data_packages"), { recursive: true });
  await fs.mkdir(sourceRoot);
  await fs.writeFile(path.join(gameRoot, "Atla.exe"), "test executable");
  const expectedOriginals = {};
  for (const [name, replacementName] of Object.entries(replacements)) {
    const target = path.join(gameRoot, "data_packages", name);
    await fs.writeFile(target, `original ${name}`);
    await fs.writeFile(path.join(sourceRoot, replacementName), `blackout ${name}`);
    expectedOriginals[name] = await sha256(target);
  }
  return { gameRoot, sourceRoot, backupRoot, expectedOriginals };
}

void test("launch confirmation waits through a transient process sighting", async () => {
  const observations = [true, false, true, true];
  const confirmed = await waitForStableGame(async () => observations.shift() ?? false, {
    timeoutMs: 100,
    pollMs: 1,
  });
  assert.equal(confirmed, true);
  assert.equal(observations.length, 0);
});

void test("launch confirmation tolerates a failed process check", async () => {
  const observations = [new Error("tasklist unavailable"), true, true];
  const errors = [];
  const confirmed = await waitForStableGame(
    async () => {
      const result = observations.shift();
      if (result instanceof Error) throw result;
      return result ?? false;
    },
    { timeoutMs: 100, pollMs: 1, onCheckError: (error) => errors.push(error) },
  );
  assert.equal(confirmed, true);
  assert.equal(errors.length, 1);
});

void test("installs verified blackout files, keeps backups, and restores all originals", async (t) => {
  const setup = await fixture(t);
  const session = await prepareSession(setup);
  await installSession(session, async () => false);
  assert.equal(await verifyInstalled(session), true);
  assert.equal(await verifyInstalledAssets(setup), true);
  session.phase = "active";
  writeSession(setup.backupRoot, session);
  await assert.rejects(
    restoreSession(setup.backupRoot, async () => true),
    /Close the game/,
  );
  assert.equal(await restoreSession(setup.backupRoot, async () => false), true);
  assert.equal(readSession(setup.backupRoot), null);
  for (const [name, expectedHash] of Object.entries(setup.expectedOriginals)) {
    assert.equal(await sha256(path.join(setup.gameRoot, "data_packages", name)), expectedHash);
    assert.equal(await sha256(path.join(session.backupDir, name)), expectedHash);
  }
});

void test("recognizes matching blackout assets without a launcher session", async (t) => {
  const setup = await fixture(t);
  assert.equal(await verifyInstalledAssets(setup), false);
  for (const [name, replacementName] of Object.entries(replacements)) {
    await fs.copyFile(
      path.join(setup.sourceRoot, replacementName),
      path.join(setup.gameRoot, "data_packages", name),
    );
  }
  assert.equal(readSession(setup.backupRoot), null);
  assert.equal(await verifyInstalledAssets(setup), true);
  await fs.writeFile(path.join(setup.gameRoot, "data_packages", "hud.pak"), "different HUD");
  assert.equal(await verifyInstalledAssets(setup), false);
});

void test("restores a three-PAK session created before the shadow patch", async (t) => {
  const setup = await fixture(t);
  const session = await prepareSession(setup);
  session.files = session.files.filter((file) => file.name !== "hitspark.pak");
  writeSession(setup.backupRoot, session);
  await installSession(session, async () => false);
  session.phase = "active";
  writeSession(setup.backupRoot, session);
  assert.equal(await restoreSession(setup.backupRoot, async () => false), true);
  for (const file of session.files) {
    assert.equal(await sha256(file.target), file.originalHash);
  }
});

void test("refuses an unknown game version before changing any PAK", async (t) => {
  const setup = await fixture(t);
  setup.expectedOriginals["korra.pak"] = "0".repeat(64);
  await assert.rejects(prepareSession(setup), /differs from the verified original/);
  assert.equal(readSession(setup.backupRoot), null);
});

void test("recovers a partially copied PAK from an interrupted installation", async (t) => {
  const setup = await fixture(t);
  const session = await prepareSession(setup);
  await fs.writeFile(session.files[0].target, "partial copy");
  assert.equal(await restoreSession(setup.backupRoot, async () => false), true);
  assert.equal(await sha256(session.files[0].target), session.files[0].originalHash);
});

void test("recovers an interrupted restore but preserves an unrelated active-session change", async (t) => {
  const setup = await fixture(t);
  const session = await prepareSession(setup);
  await installSession(session, async () => false);
  session.phase = "active";
  writeSession(setup.backupRoot, session);
  await fs.writeFile(session.files[0].target, "unexpected third-party change");
  await assert.rejects(
    restoreSession(setup.backupRoot, async () => false),
    /changed during blackout mode/,
  );
  session.phase = "restoring";
  writeSession(setup.backupRoot, session);
  assert.equal(await restoreSession(setup.backupRoot, async () => false), true);
  assert.equal(await sha256(session.files[0].target), session.files[0].originalHash);
});

void test("watcher waits for a stable game exit before restoring", async (t) => {
  const setup = await fixture(t);
  const session = await prepareSession(setup);
  await installSession(session, async () => false);
  session.phase = "active";
  writeSession(setup.backupRoot, session);
  const observations = [true, false, true, false, false, false, false, false];
  await watchAndRestore(
    setup.backupRoot,
    async () => observations.shift() ?? false,
    1,
    restoreSession,
    { active: 0 },
  );
  assert.equal(readSession(setup.backupRoot), null);
  assert.equal(await sha256(session.files[0].target), session.files[0].originalHash);
});

void test("watcher retries a PAK temporarily locked after game exit", async (t) => {
  const setup = await fixture(t);
  const session = await prepareSession(setup);
  await installSession(session, async () => false);
  session.phase = "active";
  writeSession(setup.backupRoot, session);
  let attempts = 0;
  await watchAndRestore(
    setup.backupRoot,
    async () => false,
    1,
    async (...args) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("PAK temporarily locked");
        error.code = "EBUSY";
        throw error;
      }
      return restoreSession(...args);
    },
    { active: 0 },
  );
  assert.equal(attempts, 2);
  assert.equal(readSession(setup.backupRoot), null);
  for (const file of session.files) {
    assert.equal(await sha256(file.target), file.originalHash);
  }
});

void test("watcher leaves installed PAKs alone while the game is launching", async (t) => {
  const setup = await fixture(t);
  const session = await prepareSession(setup);
  await installSession(session, async () => false);
  session.phase = "launching";
  writeSession(setup.backupRoot, session);
  const startedAt = performance.now();
  await watchAndRestore(
    setup.backupRoot,
    async () => false,
    1,
    async (...args) => {
      assert.ok(performance.now() - startedAt >= 30);
      return restoreSession(...args);
    },
    { launching: 30 },
  );
  assert.equal(readSession(setup.backupRoot), null);
});
