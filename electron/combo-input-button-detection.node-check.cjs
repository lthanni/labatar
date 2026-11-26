const assert = require("node:assert/strict");
const test = require("node:test");
const { detectComboInputButton } = require("./combo-input-button-detection.cjs");

function fakeClient() {
  let onState;
  let stopped = false;
  return {
    startClient: async (request) => {
      onState = request.onState;
      return {
        stop: async () => {
          stopped = true;
        },
      };
    },
    emit(buttons) {
      onState({ type: "state", buttons });
    },
    get stopped() {
      return stopped;
    },
  };
}

void test("binding detection waits for held buttons to be released before accepting a press", async () => {
  const worker = fakeClient();
  const detection = detectComboInputButton({ startClient: worker.startClient });
  await Promise.resolve();
  worker.emit(["A"]);
  worker.emit(["A", "B"]);
  worker.emit([]);
  worker.emit(["RB"]);
  assert.equal(await detection, "RB");
  assert.equal(worker.stopped, true);
});

void test("binding detection can be cancelled and stops polling", async () => {
  const worker = fakeClient();
  const controller = new AbortController();
  const detection = detectComboInputButton({
    startClient: worker.startClient,
    signal: controller.signal,
  });
  await Promise.resolve();
  worker.emit([]);
  controller.abort();
  await assert.rejects(detection, { name: "AbortError" });
  assert.equal(worker.stopped, true);
});

void test("binding detection times out without changing a binding", async () => {
  const worker = fakeClient();
  await assert.rejects(
    detectComboInputButton({ startClient: worker.startClient, timeoutMs: 5 }),
    /No controller button was pressed/,
  );
  assert.equal(worker.stopped, true);
});
