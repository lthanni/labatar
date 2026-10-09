const test = require("node:test");
const assert = require("node:assert/strict");
const { createAutomaticMoveRunner } = require("./automatic-move-runner.cjs");

function deps(log, overrides = {}) {
  return {
    reset: async ({ stage }) => log.push(`reset:${stage}`),
    arm: async (item) => log.push(`arm:${item.id}`),
    startRecord: async ({ move }) => {
      log.push(`start:${move.id}`);
      return `recording:${move.id}`;
    },
    move: async (item) => log.push(`move:${item.id}`),
    stopRecord: async ({ move }) => {
      log.push(`stop:${move.id}`);
      return `recording:${move.id}`;
    },
    verifySaved: async ({ move }) => {
      log.push(`verify:${move.id}`);
      return true;
    },
    persist: async ({ move }) => log.push(`persist:${move.id}`),
    releaseKeys: async () => log.push("release"),
    sleep: async (ms) => log.push(`sleep:${ms}`),
    ...overrides,
  };
}

void test("runs the documented capture order and advances only after verified save", async () => {
  const log = [];
  const runner = createAutomaticMoveRunner(deps(log, { neutralPreRollMs: 300, tailMs: 2000 }));
  await runner.start([{ id: "jab" }, { id: "special" }]);
  assert.equal(runner.status().status, "complete");
  assert.deepEqual(log.slice(0, 14), [
    "reset:before",
    "arm:jab",
    "start:jab",
    "sleep:300",
    "move:jab",
    "release",
    "sleep:2000",
    "reset:after",
    "stop:jab",
    "verify:jab",
    "persist:jab",
    "reset:before",
    "arm:special",
    "start:special",
  ]);
  assert.equal(log.filter((line) => line === "persist:jab").length, 1);
});

void test("pause aborts a sleep, releases keys, stops OBS, and resumes the same move", async () => {
  const log = [];
  let enterSleep;
  let sleepCount = 0;
  const sleeping = new Promise((resolve) => {
    enterSleep = resolve;
  });
  const runner = createAutomaticMoveRunner(
    deps(log, {
      sleep: (_ms, signal) => {
        sleepCount += 1;
        if (sleepCount > 1) return Promise.resolve();
        return new Promise((resolve, reject) => {
          enterSleep();
          signal.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      },
    }),
  );
  const firstRun = runner.start([{ id: "jab" }]);
  await sleeping;
  await runner.pause();
  await firstRun;
  assert.equal(runner.status().status, "paused");
  assert.equal(runner.status().currentMove.id, "jab");
  assert.ok(log.includes("release"));
  assert.equal(log.filter((line) => line === "stop:jab").length, 1);
  await runner.resume();
});

void test("a failed save pauses without persisting or advancing", async () => {
  const log = [];
  let save = false;
  const runner = createAutomaticMoveRunner(
    deps(log, {
      verifySaved: async () => save,
      sleep: async () => {},
    }),
  );
  await runner.start([{ id: "jab" }, { id: "kick" }]);
  assert.equal(runner.status().status, "paused");
  assert.equal(runner.status().currentMove.id, "jab");
  assert.equal(runner.status().index, 0);
  assert.equal(
    log.some((line) => line.startsWith("persist:")),
    false,
  );
  save = true;
  const resumed = runner.resume();
  await resumed;
  assert.equal(runner.status().status, "complete");
  assert.equal(log.filter((line) => line === "persist:jab").length, 1);
});

void test("pause during save verification waits for commit, then pauses before the next move", async () => {
  const log = [];
  let enteredVerify;
  const verifying = new Promise((resolve) => {
    enteredVerify = resolve;
  });
  let finishVerify;
  const runner = createAutomaticMoveRunner(
    deps(log, {
      verifySaved: async ({ move }) => {
        log.push(`verify:${move.id}`);
        enteredVerify();
        await new Promise((resolve) => {
          finishVerify = resolve;
        });
        return true;
      },
      sleep: async () => {},
    }),
  );
  const runTask = runner.start([{ id: "jab" }, { id: "kick" }]);
  await verifying;
  const pauseTask = runner.pause();
  assert.equal(log.includes("persist:jab"), false);
  finishVerify();
  await Promise.all([runTask, pauseTask]);
  assert.equal(runner.status().status, "paused");
  assert.equal(runner.status().index, 1);
  assert.equal(runner.status().currentMove.id, "kick");
  assert.equal(log.filter((line) => line === "persist:jab").length, 1);
  assert.equal(
    log.some((line) => line.includes(":kick")),
    false,
  );
});

void test("start can resume from a supplied index in the original queue snapshot", async () => {
  const log = [];
  const queue = [{ id: "jab" }, { id: "kick" }, { id: "special" }];
  const runner = createAutomaticMoveRunner(deps(log, { sleep: async () => {} }));
  await runner.start(queue, { index: 1 });
  assert.equal(runner.status().total, 3);
  assert.equal(runner.status().index, 3);
  assert.deepEqual(
    log.filter((line) => line.startsWith("move:")),
    ["move:kick", "move:special"],
  );
  assert.equal(
    log.some((line) => line.includes(":jab")),
    false,
  );
});

void test("failed cleanup stays paused, reports the error, and permits a later cancel", async () => {
  const log = [];
  let stopFails = true;
  const runner = createAutomaticMoveRunner(
    deps(log, {
      move: async () => {
        throw new Error("input failed");
      },
      stopRecord: async () => {
        log.push("stop");
        if (stopFails) throw new Error("OBS stop failed");
      },
    }),
  );
  await runner.start([{ id: "jab" }]);
  assert.equal(runner.status().status, "paused");
  assert.match(runner.status().error, /OBS stop failed/);
  await assert.rejects(runner.cancel(), /Capture cleanup failed/);
  assert.equal(runner.status().status, "paused");
  stopFails = false;
  await runner.cancel();
  assert.equal(runner.status().status, "cancelled");
  assert.equal(log.filter((line) => line === "stop").length, 3);
});
