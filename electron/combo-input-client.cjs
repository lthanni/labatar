const { spawn } = require("node:child_process");
const path = require("node:path");

async function startComboInputClient({
  onState,
  powershell = "powershell.exe",
  readyTimeoutMs = 10000,
  spawnProcess = spawn,
  platform = process.platform,
} = {}) {
  if (platform !== "win32") throw new Error("Controller combo capture requires Windows.");
  const child = spawnProcess(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(__dirname, "combo-input-worker.ps1"),
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false },
  );
  let stderr = "";
  let output = "";
  let deviceIndex = null;
  let closed = false;
  let stopRequested = false;
  let failure = null;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const timer = setTimeout(() => {
    const error = new Error("Controller capture did not initialize in time.");
    failure = error;
    readyReject(error);
    child.kill();
  }, readyTimeoutMs);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    for (;;) {
      const end = output.indexOf("\n");
      if (end < 0) break;
      const line = output.slice(0, end).trim();
      output = output.slice(end + 1);
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "ready") {
        deviceIndex = event.deviceIndex;
        clearTimeout(timer);
        readyResolve(deviceIndex);
      } else if (event.type === "state") {
        onState?.(event);
      } else if (event.type === "error") {
        failure = new Error(event.message || "Controller capture failed.");
        clearTimeout(timer);
        readyReject(failure);
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4096);
  });
  child.on("error", (error) => {
    failure = error;
    clearTimeout(timer);
    readyReject(error);
  });
  child.on("exit", (code) => {
    closed = true;
    clearTimeout(timer);
    if (code !== 0 && !stopRequested && !failure)
      failure = new Error(stderr || `Controller capture exited (${code}).`);
    if (deviceIndex === null)
      readyReject(failure ?? new Error("Controller capture stopped before it was ready."));
  });
  try {
    await ready;
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    deviceIndex,
    get failure() {
      return failure;
    },
    async stop() {
      if (!closed) {
        stopRequested = true;
        child.kill();
        await new Promise((resolve) => child.once("exit", resolve));
      }
    },
  };
}

module.exports = { startComboInputClient };
