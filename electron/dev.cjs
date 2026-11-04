const fs = require("node:fs");
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

const youtubeClientPath = path.resolve(__dirname, "..", ".dev", "youtube-client.json");
if (
  !environment.LABATAR_YOUTUBE_CLIENT_ID &&
  !environment.LABATAR_YOUTUBE_CLIENT_SECRET &&
  fs.existsSync(youtubeClientPath)
) {
  const client = JSON.parse(fs.readFileSync(youtubeClientPath, "utf8")).installed;
  if (!client?.client_id || !client?.client_secret) {
    throw new Error(
      "The local YouTube client file must contain installed.client_id and installed.client_secret.",
    );
  }
  environment.LABATAR_YOUTUBE_CLIENT_ID = client.client_id;
  environment.LABATAR_YOUTUBE_CLIENT_SECRET = client.client_secret;
}

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
