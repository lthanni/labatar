const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const { comboInputWorkerPath, startComboInputClient } = require("./combo-input-client.cjs");

void test("the packaged combo input worker is unpacked for PowerShell", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.ok(packageJson.build.asarUnpack.includes("electron/combo-input-worker.ps1"));
});

void test("combo input worker resolves to a real unpacked path in a packaged app", () => {
  const packagedDirectory = path.join("release", "resources", "app.asar", "electron");
  assert.equal(
    comboInputWorkerPath(packagedDirectory),
    path.join("release", "resources", "app.asar.unpacked", "electron", "combo-input-worker.ps1"),
  );
  assert.equal(
    comboInputWorkerPath(path.join("project", "electron")),
    path.join("project", "electron", "combo-input-worker.ps1"),
  );
});

function fakeWorker() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    queueMicrotask(() => child.emit("exit", null, "SIGTERM"));
    return true;
  };
  return child;
}

void test("an intentional stop does not mark controller capture interrupted", async () => {
  const child = fakeWorker();
  const starting = startComboInputClient({ spawnProcess: () => child, platform: "win32" });
  child.stdout.write('{"type":"ready","deviceIndex":0}\n');
  const client = await starting;
  await client.stop();
  assert.equal(client.failure, null);
});

void test("an unexpected controller worker exit is reported", async () => {
  const child = fakeWorker();
  const starting = startComboInputClient({ spawnProcess: () => child, platform: "win32" });
  child.stdout.write('{"type":"ready","deviceIndex":0}\n');
  const client = await starting;
  child.stderr.write("The controller disconnected.");
  child.emit("exit", 1, null);
  assert.match(client.failure.message, /controller disconnected/i);
});
