const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  readApprovedHashes,
  inspectGameHashes,
  saveApprovedHashes,
} = require("./blackout-approval.cjs");

void test("changed game hashes require approval and the approval persists", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-blackout-approval-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const approvalFile = path.join(root, "approval.json");
  const baseline = { "hud.pak": "a".repeat(64), "watertribe.pak": "b".repeat(64) };
  const current = { "hud.pak": "c".repeat(64), "watertribe.pak": "b".repeat(64) };
  const hashFile = async (filePath) => current[path.basename(filePath)];

  assert.equal(readApprovedHashes(approvalFile, baseline), null);
  const pending = await inspectGameHashes(root, baseline, hashFile);
  assert.deepEqual(pending.changes, [
    { name: "hud.pak", approvedHash: baseline["hud.pak"], actualHash: current["hud.pak"] },
  ]);
  await saveApprovedHashes(approvalFile, pending.current, baseline);
  const approved = readApprovedHashes(approvalFile, baseline);
  assert.deepEqual(approved, current);
  assert.deepEqual((await inspectGameHashes(root, approved, hashFile)).changes, []);
  const later = { ...current, "watertribe.pak": "d".repeat(64) };
  await saveApprovedHashes(approvalFile, later, baseline);
  assert.deepEqual(readApprovedHashes(approvalFile, baseline), later);
  await fs.writeFile(approvalFile, JSON.stringify({ version: 1, files: { "hud.pak": "bad" } }));
  assert.throws(() => readApprovedHashes(approvalFile, baseline), /approval is invalid/);
});
