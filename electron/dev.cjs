const path = require("node:path");
const { spawn } = require("node:child_process");
const { assertElectronDistComplete } = require("./check-dist.cjs");

const electronBinary = require("electron");
if (typeof electronBinary !== "string") {
  throw new Error("The Electron dev launcher must be started by Node.");
}
assertElectronDistComplete(electronBinary);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [path.resolve(__dirname, ".."), ...process.argv.slice(2)], {
  env: environment,
  stdio: "inherit",
  windowsHide: false,
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
