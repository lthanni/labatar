const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  replacements,
  sha256,
  readSession,
  writeSession,
  prepareSession,
  installSession,
  verifyInstalled,
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

void test("installs verified blackout files, keeps backups, and restores all originals", async (t) => {
  const setup = await fixture(t);
  const session = await prepareSession(setup);
  await installSession(session, async () => false);
  assert.equal(await verifyInstalled(session), true);
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
  session.activeAt = Date.now() - 21_000;
  writeSession(setup.backupRoot, session);
  const observations = [true, false, true, false, false, false, false, false];
  await watchAndRestore(setup.backupRoot, async () => observations.shift() ?? false, 1);
  assert.equal(readSession(setup.backupRoot), null);
  assert.equal(await sha256(session.files[0].target), session.files[0].originalHash);
});
