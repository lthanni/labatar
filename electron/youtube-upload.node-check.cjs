const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createYouTubeUploadService } = require("./youtube-upload.cjs");

void test("Desktop OAuth connects with PKCE and the configured client secret", async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "labatar-youtube-test-"));
  const resolved = fs.realpathSync(userData);
  const tempRoot = fs.realpathSync(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(tempRoot)) throw new Error("Test directory escaped the temp folder.");
  const previousId = process.env.LABATAR_YOUTUBE_CLIENT_ID;
  const previousSecret = process.env.LABATAR_YOUTUBE_CLIENT_SECRET;
  const previousFetch = global.fetch;
  process.env.LABATAR_YOUTUBE_CLIENT_ID = "12345-labatar.apps.googleusercontent.com";
  process.env.LABATAR_YOUTUBE_CLIENT_SECRET = "desktop-client-secret";
  const requests = [];
  global.fetch = async (url, options) => {
    if (
      url ===
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"
    ) {
      throw new Error("Upload stopped after token refresh.");
    }
    assert.equal(url, "https://oauth2.googleapis.com/token");
    requests.push(Object.fromEntries(options.body));
    return {
      ok: true,
      json: async () =>
        requests.length === 1
          ? { access_token: "access", refresh_token: "refresh", expires_in: 0 }
          : { access_token: "refreshed-access", expires_in: 3600 },
    };
  };
  const service = createYouTubeUploadService({
    app: { getPath: () => userData },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString("utf8"),
    },
    shell: {
      openExternal: async (authorization) => {
        const url = new URL(authorization);
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        const callback = new URL(url.searchParams.get("redirect_uri"));
        callback.searchParams.set("state", url.searchParams.get("state"));
        callback.searchParams.set("code", "code-from-google");
        await new Promise((resolve, reject) => {
          http
            .get(callback, (response) => {
              response.resume();
              response.on("end", resolve);
            })
            .on("error", reject);
        });
      },
    },
  });
  try {
    assert.equal(service.status().configured, true);
    assert.equal(service.status().connected, false);
    const result = await service.connect();
    assert.equal(result.connected, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].client_id, process.env.LABATAR_YOUTUBE_CLIENT_ID);
    assert.equal(requests[0].code, "code-from-google");
    assert.ok(requests[0].code_verifier);
    assert.equal(requests[0].client_secret, process.env.LABATAR_YOUTUBE_CLIENT_SECRET);
    const videoPath = path.join(userData, "test.mp4");
    fs.writeFileSync(videoPath, "test-video");
    await assert.rejects(
      service.upload({
        filePath: videoPath,
        title: "Test video",
        description: "",
        privacyStatus: "unlisted",
        madeForKids: false,
      }),
      /Upload stopped after token refresh/,
    );
    assert.equal(requests.length, 2);
    assert.equal(requests[1].grant_type, "refresh_token");
    assert.equal(requests[1].client_secret, process.env.LABATAR_YOUTUBE_CLIENT_SECRET);
  } finally {
    global.fetch = previousFetch;
    if (previousId === undefined) delete process.env.LABATAR_YOUTUBE_CLIENT_ID;
    else process.env.LABATAR_YOUTUBE_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.LABATAR_YOUTUBE_CLIENT_SECRET;
    else process.env.LABATAR_YOUTUBE_CLIENT_SECRET = previousSecret;
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
