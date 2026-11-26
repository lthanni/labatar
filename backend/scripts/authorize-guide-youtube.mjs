import http from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { readFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Owner-run setup. Google tokens travel directly to Wrangler's stdin, never to the desktop app.
async function readClient(relative) {
  const value = await readFile(new URL(relative, import.meta.url), "utf8")
    .then(JSON.parse)
    .catch(() => ({}));
  return value.installed ?? value;
}
const development = await readClient("../../.dev/youtube-client.json");
const bundled = await readClient("../../electron/youtube-client.json");
const clientId =
  process.env.LABATAR_YOUTUBE_CLIENT_ID ||
  development.client_id ||
  development.clientId ||
  bundled.client_id ||
  bundled.clientId;
const clientSecret =
  process.env.LABATAR_YOUTUBE_CLIENT_SECRET ||
  development.client_secret ||
  development.clientSecret ||
  bundled.client_secret ||
  bundled.clientSecret;
if (!clientId || !clientSecret)
  throw new Error(
    "Set LABATAR_YOUTUBE_CLIENT_ID and LABATAR_YOUTUBE_CLIENT_SECRET to your Google Desktop OAuth client credentials.",
  );

async function findWrangler() {
  if (process.env.LABATAR_WRANGLER_CLI) {
    await access(process.env.LABATAR_WRANGLER_CLI);
    return process.env.LABATAR_WRANGLER_CLI;
  }
  // Reuse the owner's existing CLI without running another dlx installation after Google consent.
  if (process.env.LOCALAPPDATA) {
    const cache = path.join(process.env.LOCALAPPDATA, "pnpm-cache", "dlx");
    const entries = await readdir(cache, { withFileTypes: true }).catch(() => []);
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(cache, entry.name, "pkg", "node_modules", "wrangler");
      const metadata = await readFile(path.join(directory, "package.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (!metadata?.version) continue;
      const cli = path.join(directory, "bin", "wrangler.js");
      if (
        await access(cli).then(
          () => true,
          () => false,
        )
      )
        candidates.push({ cli, version: metadata.version });
    }
    candidates.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    if (candidates.length) return candidates[0].cli;
  }
  return null;
}
const wranglerCli = await findWrangler();

if (process.argv.includes("--check")) {
  console.log("Google OAuth client found. No Google authorization or secret changes were made.");
  console.log(wranglerCli ? `Wrangler CLI: ${wranglerCli}` : "Wrangler will run through vp dlx.");
} else {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirect = `http://127.0.0.1:${server.address().port}/oauth2callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope:
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    access_type: "offline",
    prompt: "consent select_account",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  try {
    console.log(
      "Open this URL and authorize the Labatar channel owner's account:\n" + url.toString(),
    );
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Google authorization timed out.")),
        5 * 60_000,
      );
      server.on("request", (request, response) => {
        const callback = new URL(request.url, redirect);
        if (
          callback.pathname !== "/oauth2callback" ||
          callback.searchParams.get("state") !== state
        ) {
          response.writeHead(400).end("Invalid callback.");
          return;
        }
        clearTimeout(timer);
        const code = callback.searchParams.get("code");
        response
          .writeHead(code ? 200 : 400, { "Content-Type": "text/plain" })
          .end("Return to the setup terminal.");
        if (code) resolve(code);
        else reject(new Error("Google authorization cancelled."));
      });
    });
    const exchanged = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await exchanged.json();
    if (!exchanged.ok || !tokens.refresh_token)
      throw new Error(
        "Google did not provide persistent authorization. Run setup again and grant both requested scopes.",
      );
    const response = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    );
    const channels = await response.json();
    if (!response.ok || channels.items?.length !== 1)
      throw new Error("Select exactly one YouTube channel when authorizing.");
    const channel = channels.items[0];
    console.log(`Authorized channel: ${channel.snippet.title} (${channel.id}).`);
    const handle = process.env.LABATAR_YOUTUBE_CHANNEL_HANDLE || "@ATLAbatar";
    const targetResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}`,
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    );
    const target = await targetResponse.json();
    if (
      !targetResponse.ok ||
      target.items?.length !== 1 ||
      target.items[0].id !== channel.id ||
      (process.env.LABATAR_YOUTUBE_CHANNEL_ID &&
        process.env.LABATAR_YOUTUBE_CHANNEL_ID !== channel.id)
    )
      throw new Error(
        `The authorized account does not match ${handle}. No Worker secrets were changed.`,
      );
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const config = fileURLToPath(new URL("../wrangler.toml", import.meta.url));
    const windows = process.platform === "win32";
    // This command is constant; secret values are sent as stdin data.
    const command = wranglerCli ? process.execPath : windows ? "powershell.exe" : "vp";
    const args = wranglerCli
      ? [wranglerCli, "secret", "bulk", "--config", config]
      : windows
        ? [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$input | vp dlx wrangler secret bulk --config backend/wrangler.toml",
          ]
        : ["dlx", "wrangler", "secret", "bulk", "--config", config];
    const child = spawn(command, args, {
      cwd: root,
      windowsHide: true,
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.stdin.end(
      JSON.stringify({
        YOUTUBE_CLIENT_ID: clientId,
        YOUTUBE_CLIENT_SECRET: clientSecret,
        YOUTUBE_REFRESH_TOKEN: tokens.refresh_token,
        YOUTUBE_CHANNEL_ID: channel.id,
      }),
    );
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("Worker secret configuration failed.")),
      );
    });
    console.log(
      "Backend YouTube authorization configured. If the Worker and schema are already deployed, setup is complete. Test publishing a small MP4 guide.",
    );
  } finally {
    server.close();
  }
}
