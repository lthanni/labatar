const DEFAULT_TAIL_MS = 2000;
const DEFAULT_PRE_ROLL_MS = 500;

function abortError() {
  const error = new Error("Automatic move capture interrupted");
  error.name = "AbortError";
  return error;
}

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", interrupted);
      resolve();
    }
    function interrupted() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", interrupted);
      reject(abortError());
    }
    signal?.addEventListener("abort", interrupted, { once: true });
  });
}

/** Runs a snapshot of move takes one at a time. Dependencies perform the I/O. */
function createAutomaticMoveRunner({
  reset,
  move,
  arm,
  startRecord,
  stopRecord,
  verifySaved,
  persist = async () => {},
  releaseKeys = async () => {},
  onState = () => {},
  sleep = defaultSleep,
  neutralPreRollMs = DEFAULT_PRE_ROLL_MS,
  tailMs = DEFAULT_TAIL_MS,
}) {
  for (const [name, fn] of Object.entries({
    reset,
    move,
    arm,
    startRecord,
    stopRecord,
    verifySaved,
  })) {
    if (typeof fn !== "function") throw new TypeError(`${name} must be a function`);
  }

  let run = null;
  let view = { status: "idle", index: 0, total: 0, currentMove: null, error: null };

  function publish(status, extra = {}) {
    view = { ...view, status, ...extra };
    onState({ ...view });
  }

  function snapshot() {
    return { ...view };
  }

  function checkInterrupted(activeRun) {
    if (activeRun.intent === "pause") throw abortError();
    if (activeRun.intent === "cancel") throw abortError();
  }

  async function safeStop(activeRun) {
    const failures = [];
    try {
      await releaseKeys();
    } catch (error) {
      failures.push(error);
    }
    if (activeRun.recording) {
      try {
        await stopRecord({ move: activeRun.queue[activeRun.index], interrupted: true });
        activeRun.recording = false;
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) {
      throw new AggregateError(
        failures,
        `Capture cleanup failed: ${failures.map((error) => error.message).join("; ")}`,
      );
    }
  }

  async function loop(activeRun) {
    try {
      while (activeRun.index < activeRun.queue.length) {
        checkInterrupted(activeRun);
        const currentMove = activeRun.queue[activeRun.index];
        activeRun.recording = false;
        publish("running", {
          index: activeRun.index,
          currentMove,
          error: null,
          phase: "reset-before",
        });
        await reset({ move: currentMove, stage: "before" });
        checkInterrupted(activeRun);

        publish("running", { phase: "arm" });
        await arm(currentMove);
        checkInterrupted(activeRun);
        publish("running", { phase: "start-recording" });
        await startRecord({ move: currentMove });
        activeRun.recording = true;
        checkInterrupted(activeRun);

        publish("running", { phase: "pre-roll" });
        await sleep(neutralPreRollMs, activeRun.controller.signal);
        checkInterrupted(activeRun);
        publish("running", { phase: "move" });
        await move(currentMove);
        checkInterrupted(activeRun);
        await releaseKeys();
        checkInterrupted(activeRun);

        publish("running", { phase: "tail" });
        await sleep(tailMs, activeRun.controller.signal);
        checkInterrupted(activeRun);
        publish("running", { phase: "reset-after" });
        await reset({ move: currentMove, stage: "after" });
        checkInterrupted(activeRun);
        publish("running", { phase: "stop-recording" });
        const recording = await stopRecord({ move: currentMove, interrupted: false });
        activeRun.recording = false;

        publish("running", { phase: "verify-saved" });
        const saved = await verifySaved({ move: currentMove, recording });
        if (!saved)
          throw new Error("Recording did not finalize with a verified move-take manifest");
        await persist({ move: currentMove, recording, index: activeRun.index });

        activeRun.index += 1;
        publish("running", {
          index: activeRun.index,
          currentMove: activeRun.queue[activeRun.index] ?? null,
          phase: "advance",
        });
      }
      publish("complete", { index: activeRun.index, currentMove: null, phase: null, error: null });
      run = null;
    } catch (error) {
      let failure = error;
      let cleanupFailed = false;
      try {
        await safeStop(activeRun);
      } catch (cleanupError) {
        cleanupFailed = true;
        failure = new AggregateError(
          [error, cleanupError],
          `Capture failed and cleanup also failed: ${cleanupError.message}`,
        );
      }
      if (cleanupFailed) {
        activeRun.intent = null;
        publish("paused", {
          currentMove: activeRun.queue[activeRun.index] ?? null,
          phase: null,
          error: failure.message,
        });
      } else if (activeRun.intent === "cancel") {
        publish("cancelled", {
          currentMove: activeRun.queue[activeRun.index] ?? null,
          phase: null,
          error: null,
        });
        run = null;
      } else if (activeRun.intent === "pause" || failure?.name === "AbortError") {
        activeRun.intent = null;
        publish("paused", {
          currentMove: activeRun.queue[activeRun.index] ?? null,
          phase: null,
          error: null,
        });
      } else {
        publish("paused", {
          currentMove: activeRun.queue[activeRun.index] ?? null,
          phase: null,
          error: failure?.message ?? String(failure),
        });
      }
    }
  }

  function launch(activeRun) {
    activeRun.controller = new AbortController();
    activeRun.task = loop(activeRun);
    return activeRun.task;
  }

  function start(queue, { index = 0 } = {}) {
    if (run) throw new Error("An automatic move capture run is already active");
    if (!Array.isArray(queue)) throw new TypeError("queue must be an array snapshot");
    if (!Number.isInteger(index) || index < 0 || index > queue.length) {
      throw new RangeError("index must be an integer within the queue");
    }
    run = {
      queue: queue.slice(),
      index,
      intent: null,
      recording: false,
      controller: null,
      task: null,
    };
    publish("running", {
      index,
      total: queue.length,
      currentMove: queue[index] ?? null,
      phase: "starting",
      error: null,
    });
    return launch(run);
  }

  async function pause() {
    if (!run || view.status !== "running") return snapshot();
    const activeRun = run;
    activeRun.intent = "pause";
    activeRun.controller.abort();
    await activeRun.task;
    return snapshot();
  }

  async function cancel() {
    if (!run) return snapshot();
    const activeRun = run;
    if (view.status === "paused") {
      try {
        await safeStop(activeRun);
      } catch (error) {
        publish("paused", { error: error.message });
        throw error;
      }
      publish("cancelled", {
        currentMove: activeRun.queue[activeRun.index] ?? null,
        phase: null,
        error: null,
      });
      run = null;
      return snapshot();
    }
    activeRun.intent = "cancel";
    activeRun.controller.abort();
    await activeRun.task;
    if (view.status === "paused" && view.error) throw new Error(view.error);
    return snapshot();
  }

  function resume() {
    if (!run || view.status !== "paused") throw new Error("There is no paused run to resume");
    run.intent = null;
    publish("running", { phase: "resuming", error: null });
    return launch(run);
  }

  return { start, pause, cancel, resume, status: snapshot };
}

module.exports = { createAutomaticMoveRunner };
