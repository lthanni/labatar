const { spawn } = require("node:child_process");
const path = require("node:path");
const { createInterface } = require("node:readline");

const recoveryDirections = new Set([
  "up-left",
  "up",
  "up-right",
  "left",
  "right",
  "down-left",
  "down",
  "down-right",
]);

function validateRecoverySettings(settings) {
  const { directions, delayMs, holdMs, flowMode = "never" } = settings ?? {};
  if (
    !Array.isArray(directions) ||
    directions.length === 0 ||
    directions.some((direction) => !recoveryDirections.has(direction))
  ) {
    throw new Error("Select at least one recovery direction.");
  }
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
    throw new Error("Enter a recovery delay of zero seconds or more.");
  }
  if (!Number.isSafeInteger(holdMs) || holdMs < 1) {
    throw new Error("Enter a recovery hold of at least one millisecond.");
  }
  if (!["always", "random", "never"].includes(flowMode)) {
    throw new Error("Choose a valid Flow setting for P2 Recovery Mode.");
  }
  return { directions: [...new Set(directions)], delayMs, holdMs, flowMode };
}

function createLabbingSession(onState) {
  let child = null;
  let state = { status: "off", direction: null, error: null, flowHeld: false };

  function publish(status, { direction = null, error = null, flowHeld = false } = {}) {
    state = { status, direction, error, flowHeld };
    onState(state);
  }

  return {
    getState: () => state,
    startRecovery(settings, gameRoot) {
      if (child) throw new Error("Turn off P2 Recovery Mode before starting it again.");
      if (process.platform !== "win32")
        throw new Error("P2 Recovery Mode requires Windows XInput.");
      const config = validateRecoverySettings(settings);
      const worker = path
        .join(__dirname, "training-input-worker.ps1")
        .replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
      const processHandle = spawn(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          worker,
          "-Recovery",
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      child = processHandle;
      let error = null;
      let stderr = "";
      processHandle.once("error", (failure) => {
        error = failure.message;
      });
      processHandle.stdin.on("error", (failure) => {
        if (failure.code !== "EPIPE") error ??= failure.message;
      });
      processHandle.stderr.setEncoding("utf8");
      processHandle.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-4096);
      });
      const lines = createInterface({ input: processHandle.stdout });
      lines.on("line", (line) => {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.error) error = event.error;
        if (event.status !== "off" && state.status !== "stopping") {
          publish(event.status, { direction: event.direction, flowHeld: event.flowHeld });
        }
      });
      processHandle.once("close", (code) => {
        child = null;
        const expected = state.status === "stopping" && code === 0;
        publish("off", {
          error:
            error || (expected ? null : stderr.trim() || "P2 Recovery Mode stopped unexpectedly."),
        });
      });
      publish("starting");
      processHandle.stdin.write(`${JSON.stringify({ ...config, gameRoot })}\n`);
      return state;
    },
    stop() {
      if (child && state.status !== "stopping") {
        publish("stopping");
        // EOF signals the worker to release held keys before exiting.
        child.stdin.end();
      }
      return state;
    },
  };
}

module.exports = { createLabbingSession };
