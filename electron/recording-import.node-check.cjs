const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { importComboMp4 } = require("./recording-import.cjs");

void test("imports an MP4 into the recording library and reuses files already there", async () => {
  const sandbox = await fs.promises.mkdtemp(path.join(os.tmpdir(), "labatar-combo-import-"));
  const root = path.resolve(sandbox);
  try {
    const library = path.join(root, "library");
    await fs.promises.mkdir(library);
    const source = path.join(root, "route.mp4");
    await fs.promises.writeFile(source, "sample video data");

    const first = await importComboMp4(source, library);
    assert.equal(first.imported, true);
    assert.match(first.recordingId, /^Imported Combos\/route-.*\.mp4$/);
    assert.equal(
      await fs.promises.readFile(path.join(library, first.recordingId), "utf8"),
      "sample video data",
    );

    const second = await importComboMp4(path.join(library, first.recordingId), library);
    assert.deepEqual(second, { recordingId: first.recordingId, imported: false });
    const third = await importComboMp4(source, library);
    assert.equal(third.imported, true);
    assert.notEqual(third.recordingId, first.recordingId);
    assert.deepEqual(
      (await fs.promises.readdir(path.join(library, "Imported Combos"))).filter((name) =>
        name.endsWith(".partial"),
      ),
      [],
    );
    await assert.rejects(() => importComboMp4(path.join(root, "route.txt"), library), /MP4/);
  } finally {
    if (
      root.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(root).startsWith("labatar-combo-import-")
    ) {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  }
});
