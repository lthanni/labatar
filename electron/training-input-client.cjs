const { spawn } = require("node:child_process");
const { readFile, mkdtemp, writeFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_GAME_ROOT =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Avatar Legends The Fighting Game";

async function createTrainingInputClient({
  gameRoot = DEFAULT_GAME_ROOT,
  dryRun = false,
  powershell = "powershell.exe",
} = {}) {
  if (process.platform !== "win32" && !dryRun)
    throw new Error("Training input can only send keys on Windows.");
  const workerSource = await readFile(path.join(__dirname, "training-input-worker.ps1"), "utf8");
  const workerDir = await mkdtemp(path.join(os.tmpdir(), "labatar-training-input-"));
  const workerPath = path.join(workerDir, "worker.ps1");
  await writeFile(workerPath, workerSource, "utf8");
  const child = spawn(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", workerPath],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], shell: false },
  );
  let nextId = 1;
  let stdout = "";
  let stderr = "";
  let closed = false;
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    for (;;) {
      const ix = stdout.indexOf("\n");
      if (ix < 0) break;
      const line = stdout.slice(0, ix).trim();
      stdout = stdout.slice(ix + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = pending.get(msg.id);
      if (waiter) {
        pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error(msg.error));
        else waiter.resolve(msg.result);
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-8192);
  });
  child.on("error", (err) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  });
  child.on("exit", (code, signal) => {
    closed = true;
    const err = new Error(`Training input worker exited (${code ?? signal}). ${stderr}`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  });

  function request(payload) {
    if (closed) return Promise.reject(new Error("Training input worker is closed."));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, gameRoot, dryRun, ...payload })}\n`, (err) => {
        if (err) {
          pending.delete(id);
          reject(err);
        }
      });
    });
  }
  return {
    send({ kind, notation, facing } = {}) {
      if (kind !== "reset" && kind !== "move")
        return Promise.reject(new Error("kind must be 'reset' or 'move'."));
      return request({ kind, ...(notation ? { notation } : {}), ...(facing ? { facing } : {}) });
    },
    async close() {
      if (!closed) {
        child.stdin.end();
        await new Promise((resolve) => child.once("exit", resolve));
      }
      await rm(workerDir, { recursive: true, force: true });
    },
  };
}

module.exports = { createTrainingInputClient };
