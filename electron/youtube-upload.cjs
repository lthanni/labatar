const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");

const uploadScope = "https://www.googleapis.com/auth/youtube.upload";
const chunkSize = 8 * 1024 * 1024;
const clientIdPattern = /^\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i;
const destinations = ["sets", "combos"];

function validateDestination(value) {
  if (!destinations.includes(value)) throw new Error("Choose a YouTube destination.");
  return value;
}

function parseApiError(body, fallback) {
  try {
    const parsed = JSON.parse(body);
    return parsed.error?.message || parsed.error_description || fallback;
  } catch {
    return fallback;
  }
}

function uploadSessionUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com") {
    throw new Error("YouTube returned an unexpected upload address.");
  }
  return url;
}

function uploadedVideoId(body) {
  try {
    const id = JSON.parse(body).id;
    if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
  } catch {
    // A completed upload must include a valid video ID.
  }
  throw new Error("YouTube completed the upload without a video ID.");
}

function acknowledgedBytes(headers, total) {
  const match = /^bytes=0-(\d+)$/.exec(String(headers.range ?? ""));
  return match ? Math.min(Number(match[1]) + 1, total) : 0;
}

function putUpload(url, filePath, start, end, total, token, signal, onBytes) {
  return new Promise((resolve, reject) => {
    const length = end < start ? 0 : end - start + 1;
    const request = https.request(
      url,
      {
        method: "PUT",
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "video/mp4",
          "Content-Length": length,
          "Content-Range": length ? `bytes ${start}-${end}/${total}` : `bytes */${total}`,
        },
      },
      (response) => {
        const parts = [];
        response.on("data", (part) => parts.push(part));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(parts).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    if (!length) {
      request.end();
      return;
    }
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on("data", (part) => onBytes(start + stream.bytesRead, part.length));
    stream.on("error", (error) => request.destroy(error));
    request.on("close", () => stream.destroy());
    stream.pipe(request);
  });
}

function createYouTubeUploadService({ app, safeStorage, shell }) {
  const settingsPath = path.join(app.getPath("userData"), "youtube-client.json");
  const bundledClientPath = path.join(__dirname, "youtube-client.json");
  const secretPath = path.join(app.getPath("userData"), "youtube-client-secret.bin");
  const tokenPaths = {
    sets: path.join(app.getPath("userData"), "youtube-token.bin"),
    combos: path.join(app.getPath("userData"), "youtube-combos-token.bin"),
  };
  let activeUpload = null;

  function clientId() {
    if (process.env.LABATAR_YOUTUBE_CLIENT_ID) return process.env.LABATAR_YOUTUBE_CLIENT_ID.trim();
    try {
      const value = JSON.parse(fs.readFileSync(settingsPath, "utf8")).clientId;
      if (typeof value === "string" && value.trim()) return value.trim();
    } catch {
      // A packaged release can provide its public OAuth client ID below.
    }
    try {
      const value = JSON.parse(fs.readFileSync(bundledClientPath, "utf8")).clientId;
      return typeof value === "string" ? value.trim() : "";
    } catch {
      return "";
    }
  }

  function readTokens(destination) {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const value = JSON.parse(
        safeStorage.decryptString(fs.readFileSync(tokenPaths[validateDestination(destination)])),
      );
      return value.clientId === clientId() ? value : null;
    } catch {
      return null;
    }
  }

  function clientSecret() {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(secretPath)));
        if (saved.clientId === clientId() && typeof saved.clientSecret === "string") {
          return saved.clientSecret;
        }
      }
    } catch {
      // The environment can supply credentials until they are set in the app.
    }
    return process.env.LABATAR_YOUTUBE_CLIENT_SECRET?.trim() || "";
  }

  function tokenError(data, fallback) {
    const description = typeof data?.error_description === "string" ? data.error_description : "";
    if (data?.error === "invalid_client" && /client secret/i.test(description)) {
      return new Error(
        "Google rejected the client secret. Use Change OAuth credentials to enter the client ID and secret from the same Desktop OAuth client's downloaded JSON.",
      );
    }
    return new Error(description || fallback);
  }

  async function saveTokens(destination, tokens) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure Google account storage is unavailable on this system.");
    }
    const tokenPath = tokenPaths[validateDestination(destination)];
    await fsp.mkdir(path.dirname(tokenPath), { recursive: true });
    await fsp.writeFile(tokenPath, safeStorage.encryptString(JSON.stringify(tokens)));
  }

  function status(destination = "sets") {
    validateDestination(destination);
    return {
      clientId: clientId(),
      hasClientSecret: Boolean(clientSecret()),
      connected: Boolean(clientSecret() && readTokens(destination)?.refreshToken),
      uploading: Boolean(activeUpload),
    };
  }

  async function configure(request = {}) {
    const next = String(request.clientId ?? "").trim();
    const secret = String(request.clientSecret ?? "").trim();
    if (!clientIdPattern.test(next)) throw new Error("Enter a Google Desktop OAuth client ID.");
    if (!secret) throw new Error("Enter the client secret for the same Desktop OAuth client.");
    if (
      process.env.LABATAR_YOUTUBE_CLIENT_ID &&
      next !== process.env.LABATAR_YOUTUBE_CLIENT_ID.trim()
    ) {
      throw new Error("The YouTube client ID is set by the app environment.");
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure Google account storage is unavailable on this system.");
    }
    if (activeUpload) throw new Error("Wait for the current upload to finish.");
    if (next !== clientId() || secret !== clientSecret()) {
      await Promise.all(
        Object.values(tokenPaths).map((tokenPath) => fsp.rm(tokenPath, { force: true })),
      );
    }
    await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
    if (!process.env.LABATAR_YOUTUBE_CLIENT_ID) {
      await fsp.writeFile(settingsPath, JSON.stringify({ clientId: next }), "utf8");
    }
    await fsp.writeFile(
      secretPath,
      safeStorage.encryptString(JSON.stringify({ clientId: next, clientSecret: secret })),
    );
    return status(request.destination ?? "sets");
  }

  async function exchangeCode(destination, code, redirectUri, verifier) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token || !data.refresh_token) {
      throw tokenError(data, "Google did not grant offline upload access.");
    }
    await saveTokens(destination, {
      clientId: clientId(),
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });
    return status(destination);
  }

  async function connect(destination = "sets") {
    validateDestination(destination);
    const id = clientId();
    if (!clientIdPattern.test(id))
      throw new Error("Configure a Google Desktop OAuth client ID first.");
    if (!clientSecret()) {
      throw new Error("Configure the Desktop OAuth client secret before connecting.");
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure Google account storage is unavailable on this system.");
    }
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(24).toString("base64url");
    const server = http.createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
    const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorization.search = new URLSearchParams({
      client_id: id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: uploadScope,
      access_type: "offline",
      prompt: "consent select_account",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    try {
      const code = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Google sign-in timed out.")),
          5 * 60 * 1000,
        );
        server.on("request", (request, response) => {
          const url = new URL(request.url, redirectUri);
          if (url.pathname !== "/oauth2callback") {
            response.writeHead(404).end();
            return;
          }
          if (url.searchParams.get("state") !== state) {
            response.writeHead(400).end("Invalid sign-in state.");
            return;
          }
          const error = url.searchParams.get("error");
          const receivedCode = url.searchParams.get("code");
          response.writeHead(error || !receivedCode ? 400 : 200, {
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end(
            error || !receivedCode
              ? "YouTube sign-in was cancelled."
              : "Authorization received. Return to Labatar to finish connecting.",
          );
          clearTimeout(timeout);
          if (error || !receivedCode) reject(new Error("YouTube sign-in was cancelled."));
          else resolve(receivedCode);
        });
        shell.openExternal(authorization.toString()).catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      return await exchangeCode(destination, code, redirectUri, verifier);
    } finally {
      server.close();
    }
  }

  async function accessToken(destination) {
    const tokens = readTokens(destination);
    if (!tokens?.refreshToken) throw new Error("Connect your YouTube account first.");
    if (tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) {
      throw tokenError(data, "YouTube authorization expired. Reconnect your account.");
    }
    const updated = {
      ...tokens,
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    await saveTokens(destination, updated);
    return updated.accessToken;
  }

  async function disconnect(destination = "sets") {
    validateDestination(destination);
    if (activeUpload) throw new Error("Cancel the upload before disconnecting YouTube.");
    await fsp.rm(tokenPaths[destination], { force: true });
    return status(destination);
  }

  async function upload({
    destination = "sets",
    filePath,
    title,
    description,
    tags = [],
    privacyStatus,
    publishAt,
    madeForKids,
    onProgress,
    shouldCancel = () => false,
  }) {
    validateDestination(destination);
    if (activeUpload) throw new Error("A YouTube upload is already running.");
    if (typeof title !== "string" || !title.trim() || title.length > 100) {
      throw new Error("Enter a video title of up to 100 characters.");
    }
    if (typeof description !== "string" || description.length > 5000) {
      throw new Error("The video description is too long.");
    }
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
      throw new Error("Enter YouTube tags separated by commas.");
    }
    const uploadTags = tags.map((tag) => tag.trim()).filter(Boolean);
    const tagCharacters =
      uploadTags.reduce((count, tag) => count + tag.length + (/\s/.test(tag) ? 2 : 0), 0) +
      Math.max(0, uploadTags.length - 1);
    if (tagCharacters > 500) throw new Error("YouTube tags can use up to 500 characters.");
    if (
      !["private", "unlisted", "public"].includes(privacyStatus) ||
      typeof madeForKids !== "boolean"
    ) {
      throw new Error("Choose the video privacy and audience.");
    }
    if (publishAt != null) {
      const publishTime = typeof publishAt === "string" ? new Date(publishAt) : null;
      if (
        destination !== "sets" ||
        privacyStatus !== "private" ||
        !publishTime ||
        !Number.isFinite(publishTime.getTime()) ||
        publishTime.toISOString() !== publishAt ||
        publishTime.getTime() <= Date.now() + 60_000
      ) {
        throw new Error("Choose a future public release time for a scheduled set upload.");
      }
    }
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || !stat.size) throw new Error("The local recording is unavailable.");
    if (shouldCancel()) throw new Error("Upload cancelled.");
    const controller = new AbortController();
    activeUpload = controller;
    try {
      const token = await accessToken(destination);
      if (controller.signal.aborted) throw new Error("Upload cancelled.");
      const response = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(stat.size),
            "X-Upload-Content-Type": "video/mp4",
          },
          body: JSON.stringify({
            snippet: {
              title: title.trim(),
              description,
              categoryId: "20",
              ...(uploadTags.length ? { tags: uploadTags } : {}),
            },
            status: {
              privacyStatus,
              ...(publishAt != null ? { publishAt } : {}),
              selfDeclaredMadeForKids: madeForKids,
              embeddable: true,
            },
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          parseApiError(await response.text(), "Could not start the YouTube upload."),
        );
      const session = uploadSessionUrl(response.headers.get("location"));
      let offset = 0;
      let failures = 0;
      onProgress({ uploadedBytes: 0, totalBytes: stat.size });
      while (offset < stat.size) {
        if (controller.signal.aborted) throw new Error("Upload cancelled.");
        const latest = await fsp.stat(filePath);
        if (latest.size !== stat.size || latest.mtimeMs !== stat.mtimeMs) {
          throw new Error(
            "The recording changed during upload. Start again with the current file.",
          );
        }
        const end = Math.min(offset + chunkSize, stat.size) - 1;
        const chunkToken = await accessToken(destination);
        let result;
        try {
          result = await putUpload(
            session,
            filePath,
            offset,
            end,
            stat.size,
            chunkToken,
            controller.signal,
            (bytes) => onProgress({ uploadedBytes: bytes, totalBytes: stat.size }),
          );
        } catch (error) {
          if (controller.signal.aborted) throw new Error("Upload cancelled.");
          if (error?.message === "Connect your YouTube account first.") throw error;
        }
        if (result) {
          if (result.status === 200 || result.status === 201) {
            onProgress({ uploadedBytes: stat.size, totalBytes: stat.size });
            return { videoId: uploadedVideoId(result.body) };
          }
          if (result.status === 308) {
            const nextOffset = acknowledgedBytes(result.headers, stat.size);
            failures = nextOffset > offset ? 0 : failures + 1;
            if (failures > 5) throw new Error("YouTube did not accept the uploaded bytes.");
            offset = nextOffset;
            onProgress({ uploadedBytes: offset, totalBytes: stat.size });
            continue;
          }
          if (result.status < 500 && result.status !== 429) {
            throw new Error(
              parseApiError(result.body, `YouTube upload failed (${result.status}).`),
            );
          }
        }
        failures += 1;
        if (failures > 5) throw new Error("YouTube upload failed after several retries.");
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** failures, 15000)));
        const statusResult = await putUpload(
          session,
          filePath,
          0,
          -1,
          stat.size,
          await accessToken(destination),
          controller.signal,
          () => {},
        );
        if (statusResult.status === 200 || statusResult.status === 201) {
          onProgress({ uploadedBytes: stat.size, totalBytes: stat.size });
          return { videoId: uploadedVideoId(statusResult.body) };
        }
        if (statusResult.status !== 308)
          throw new Error(parseApiError(statusResult.body, "Could not resume the YouTube upload."));
        offset = acknowledgedBytes(statusResult.headers, stat.size);
        onProgress({ uploadedBytes: offset, totalBytes: stat.size });
      }
      const completion = await putUpload(
        session,
        filePath,
        0,
        -1,
        stat.size,
        await accessToken(destination),
        controller.signal,
        () => {},
      );
      if (completion.status === 200 || completion.status === 201) {
        return { videoId: uploadedVideoId(completion.body) };
      }
      throw new Error("YouTube did not confirm the uploaded video.");
    } finally {
      activeUpload = null;
    }
  }

  function cancel() {
    if (activeUpload) activeUpload.abort();
  }

  return { status, configure, connect, disconnect, upload, cancel };
}

module.exports = { createYouTubeUploadService };
