const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const { startComboInputClient } = require("./combo-input-client.cjs");

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
