const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { importReplays } = require("./replay-import.cjs");

async function fixture(run) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "labatar-replay-import-test-"));
  try {
    const game = path.join(root, "game");
    await fs.promises.mkdir(path.join(game, "replays"), { recursive: true });
    await run({ root, game });
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

void test("imports loose and folder replays without replacing existing game files", async () => {
  await fixture(async ({ root, game }) => {
    const source = path.join(root, "shared");
    await fs.promises.mkdir(path.join(source, "nested"), { recursive: true });
    await fs.promises.writeFile(
      path.join(source, "nested", "2026-10-19 12-00-00.dlr"),
      "replay one",
    );
    await fs.promises.writeFile(path.join(source, "ignore.txt"), "ignore");
    await fs.promises.writeFile(path.join(game, "replays", "existing.dlr"), "existing");
    assert.deepEqual(await importReplays([source], game), { importedCount: 1 });
    const imported = await fs.promises.readdir(path.join(game, "replays", "Imported by Labatar"));
    assert.equal(imported.length, 1);
    assert.match(imported[0], /^2026-10-19 12-00-00-.*\.dlr$/);
    assert.equal(
      await fs.promises.readFile(path.join(game, "replays", "existing.dlr"), "utf8"),
      "existing",
    );
    assert.equal(
      await fs.promises.readFile(
        path.join(game, "replays", "Imported by Labatar", imported[0]),
        "utf8",
      ),
      "replay one",
    );
  });
});

void test("imports replays from a ZIP while ignoring unrelated entries", async (t) => {
  if (process.platform !== "win32") return t.skip("ZIP extraction uses Windows PowerShell");
  await fixture(async ({ root, game }) => {
    const source = path.join(root, "archive-source");
    await fs.promises.mkdir(path.join(source, "replays", "nested"), { recursive: true });
    await fs.promises.writeFile(path.join(source, "replays", "nested", "match.dlr"), "zip replay");
    await fs.promises.writeFile(path.join(source, "notes.txt"), "not a replay");
    const zip = path.join(root, "replays.zip");
    const command = `Compress-Archive -Path '${source.replaceAll("'", "''")}\\*' -DestinationPath '${zip.replaceAll("'", "''")}'`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await importReplays([zip], game), { importedCount: 1 });
    const imported = await fs.promises.readdir(path.join(game, "replays", "Imported by Labatar"));
    assert.equal(imported.length, 1);
    assert.equal(
      await fs.promises.readFile(
        path.join(game, "replays", "Imported by Labatar", imported[0]),
        "utf8",
      ),
      "zip replay",
    );
  });
});

void test("rejects replay paths that escape a ZIP", async (t) => {
  if (process.platform !== "win32") return t.skip("ZIP extraction uses Windows PowerShell");
  await fixture(async ({ root, game }) => {
    const zip = path.join(root, "unsafe.zip");
    const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $archive = [System.IO.Compression.ZipFile]::Open('${zip.replaceAll("'", "''")}', 'Create'); try { $entry = $archive.CreateEntry('../escape.dlr'); $writer = [System.IO.StreamWriter]::new($entry.Open()); try { $writer.Write('bad replay') } finally { $writer.Dispose() } } finally { $archive.Dispose() }`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(() => importReplays([zip], game), /unsafe replay path/);
    assert.deepEqual(await fs.promises.readdir(path.join(game, "replays")), []);
  });
});

void test("rejects unsupported drops without changing match history", async () => {
  await fixture(async ({ root, game }) => {
    const source = path.join(root, "notes.txt");
    await fs.promises.writeFile(source, "not a replay");
    await assert.rejects(() => importReplays([source], game), /No \.dlr replay files/);
    assert.deepEqual(await fs.promises.readdir(path.join(game, "replays")), []);
  });
});
