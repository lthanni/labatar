const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const electronBinary = require("electron");
if (typeof electronBinary !== "string") {
  throw new Error("The Electron dev launcher must be started by Node.");
}

const environment = { ...process.env };
const launchedAsNode = Boolean(environment.ELECTRON_RUN_AS_NODE);
delete environment.ELECTRON_RUN_AS_NODE;
const electronDist = path.dirname(electronBinary);
const needsGpuFallback =
  launchedAsNode || !fs.existsSync(path.join(electronDist, "chrome_100_percent.pak"));
const chromiumArguments = needsGpuFallback ? ["--disable-gpu", "--in-process-gpu"] : [];

const child = spawn(
  electronBinary,
  [...chromiumArguments, path.resolve(__dirname, ".."), ...process.argv.slice(2)],
  {
    env: environment,
    stdio: "inherit",
    windowsHide: false,
  },
);

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
