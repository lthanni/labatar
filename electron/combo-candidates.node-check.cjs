const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  requestComboUploadAccess,
  submitComboCandidate,
  previewComboCandidate,
  requestCandidateEditor,
  checkCandidateAccess,
  checkCandidateUploadAccess,
  listComboCandidates,
  downloadComboCandidate,
} = require("./combo-candidates.cjs");

void test("upload access request uses the signed-in catalog session", async () => {
  const requests = [];
  const ses = {
    async fetch(url, options) {
      requests.push({ url, options });
      return Response.json({ sent: true, alreadyRequested: false });
    },
  };
  assert.deepEqual(await requestComboUploadAccess(ses), {
    sent: true,
    alreadyRequested: false,
  });
  assert.equal(new URL(requests[0].url).pathname, "/v1/editor/upload-access-request");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.credentials, "include");
  assert.equal(requests[0].options.headers["X-Labatar-Access-Request"], "1");
});

void test("candidate list closes stalled session connections and retries its read once", async () => {
  let requests = 0;
  let resets = 0;
  const ses = {
    async fetch(_url, options) {
      requests += 1;
      if (requests === 1) {
        assert.equal(options.method ?? "GET", "GET");
        return new Promise(() => {});
      }
      return Response.json({ items: [{ id: "candidate-1" }] });
    },
    async closeAllConnections() {
      resets += 1;
    },
  };
  const [first, second] = await Promise.all([
    listComboCandidates(null, ses, 5),
    listComboCandidates(null, ses, 5),
  ]);
  assert.deepEqual(first, [{ id: "candidate-1" }]);
  assert.deepEqual(second, first);
  assert.equal(requests, 2);
  assert.equal(resets, 1);
});

void test("candidate write requests do not retry after a timeout", async () => {
  let requests = 0;
  const ses = {
    async fetch() {
      requests += 1;
      return new Promise(() => {});
    },
  };
  await assert.rejects(
    requestCandidateEditor(ses, null, "/candidate-1/approve", { method: "POST" }, undefined, 5),
    /Candidate request timed out/,
  );
  assert.equal(requests, 1);
});

void test("candidate list stops after one failed connection reset retry", async () => {
  let requests = 0;
  let resets = 0;
  const ses = {
    async fetch() {
      requests += 1;
      return new Promise(() => {});
    },
    async closeAllConnections() {
      resets += 1;
    },
  };
  await assert.rejects(
    listComboCandidates(null, ses, 5),
    /Candidate request still timed out after reconnecting/,
  );
  assert.equal(requests, 2);
  assert.equal(resets, 1);
});

void test("candidate loading goes directly to the candidate endpoint", async () => {
  const requests = [];
  const result = await requestCandidateEditor(
    {
      async fetch(url, options) {
        requests.push(new URL(url).pathname);
        assert.equal(options.credentials, "include");
        return Response.json({ items: [{ id: "candidate-1" }] });
      },
    },
    null,
    "",
    {},
    () => {
      throw new Error("Sign-in should not be needed.");
    },
  );
  assert.deepEqual(requests, ["/v1/editor/candidates"]);
  assert.deepEqual(result.items, [{ id: "candidate-1" }]);
});

void test("automatic candidate refresh does not open a blocking sign-in window", async () => {
  let requests = 0;
  const ses = {
    async fetch() {
      requests += 1;
      return Response.json({ error: "Editor authentication required." }, { status: 401 });
    },
  };
  await assert.rejects(
    listComboCandidates(null, ses, 15000, () => {}, false),
    /Candidate sign-in required/,
  );
  assert.equal(requests, 1);
});

void test("automatic candidate refresh translates an Electron cancelled redirect", async () => {
  const ses = {
    async fetch() {
      throw new Error("Redirect was cancelled");
    },
  };
  await assert.rejects(
    listComboCandidates(null, ses, 15000, () => {}, false),
    /Candidate sign-in required/,
  );
});

void test("interactive candidate request signs in after an Electron cancelled redirect", async () => {
  let signedIn = false;
  let signIns = 0;
  const result = await requestCandidateEditor(
    {
      async fetch() {
        if (!signedIn) throw new Error("Redirect was cancelled");
        return Response.json({ items: [{ id: "candidate-1" }] });
      },
    },
    null,
    "",
    {},
    async (_session, _parent, verifyAccess) => {
      signIns += 1;
      signedIn = true;
      assert.equal(await verifyAccess(), true);
    },
  );
  assert.equal(signIns, 1);
  assert.deepEqual(result.items, [{ id: "candidate-1" }]);
});

void test("interactive candidate load is separate from a pending automatic load", async () => {
  let resolveAutomatic;
  let requests = 0;
  const ses = {
    async fetch() {
      requests += 1;
      if (requests === 1) {
        return new Promise((resolve) => {
          resolveAutomatic = resolve;
        });
      }
      return Response.json({ items: [{ id: "interactive" }] });
    },
  };
  const automatic = listComboCandidates(null, ses, 15000, () => {}, false);
  await Promise.resolve();
  const interactive = listComboCandidates(null, ses, 15000, () => {}, true);
  assert.notEqual(interactive, automatic);
  assert.deepEqual(await interactive, [{ id: "interactive" }]);
  resolveAutomatic(Response.json({ items: [] }));
  assert.deepEqual(await automatic, []);
  assert.equal(requests, 2);
});

void test("candidate sign-in check recovers a stalled publisher session", async () => {
  let requests = 0;
  let resets = 0;
  const ses = {
    async fetch() {
      requests += 1;
      return requests === 1 ? new Promise(() => {}) : Response.json({ items: [] });
    },
    async closeAllConnections() {
      resets += 1;
    },
  };
  assert.equal(await checkCandidateAccess(ses, 5), true);
  assert.equal(requests, 2);
  assert.equal(resets, 1);
});

void test("combo upload checks its own email permission instead of editor access", async () => {
  const paths = [];
  const ses = {
    async fetch(url) {
      paths.push(new URL(url).pathname);
      return Response.json({ allowed: true });
    },
  };
  assert.equal(await checkCandidateUploadAccess(ses), true);
  assert.deepEqual(paths, ["/v1/editor/candidates/upload"]);
});

void test("candidate GET recovers without repeating a write", async () => {
  let requests = 0;
  let resets = 0;
  const ses = {
    async fetch(_url, options) {
      requests += 1;
      assert.equal(options.method ?? "GET", "GET");
      return requests === 1 ? new Promise(() => {}) : Response.json({ items: [] });
    },
    async closeAllConnections() {
      resets += 1;
    },
  };
  assert.deepEqual((await requestCandidateEditor(ses, null, "", {}, undefined, 5)).items, []);
  assert.equal(requests, 2);
  assert.equal(resets, 1);
});

void test("candidate sign-in checks access without repeating an editor action", async () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  const requests = [];
  let signedIn = false;
  const result = await requestCandidateEditor(
    {
      async fetch(url, options) {
        const path = new URL(url).pathname;
        requests.push([options.method ?? "GET", path]);
        if (!signedIn) return Response.json({ error: "Sign-in required." }, { status: 401 });
        return Response.json(
          path.endsWith("/approve") ? { id, status: "approved" } : { items: [] },
        );
      },
    },
    null,
    `/${id}/approve`,
    { method: "POST" },
    async (_session, _parent, verifyAccess) => {
      signedIn = true;
      assert.equal(await verifyAccess(), true);
    },
  );
  assert.deepEqual(requests, [
    ["POST", `/v1/editor/candidates/${id}/approve`],
    ["GET", "/v1/editor/candidates"],
    ["POST", `/v1/editor/candidates/${id}/approve`],
  ]);
  assert.deepEqual(result, { id, status: "approved" });
});

void test("candidate MP4 download uses the video endpoint and retries after sign-in", async () => {
  const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "labatar-candidate-download-"));
  const id = "12345678-1234-1234-1234-123456789abc";
  const requests = [];
  let signedIn = false;
  try {
    const recordingId = await downloadComboCandidate(
      null,
      id,
      folder,
      3,
      {
        async fetch(url, options) {
          const route = new URL(url).pathname;
          requests.push(route);
          assert.equal(options.credentials, "include");
          if (!signedIn) return Response.json({ error: "Sign-in required." }, { status: 401 });
          if (route === "/v1/editor/candidates") return Response.json({ items: [] });
          return new Response(Buffer.from([1, 2, 3]), {
            headers: { "Content-Type": "video/mp4", "Content-Length": "3" },
          });
        },
      },
      async (_session, _parent, verifyAccess) => {
        signedIn = true;
        assert.equal(await verifyAccess(), true);
      },
    );
    assert.equal(recordingId, `candidate-${id}.mp4`);
    assert.deepEqual(requests, [
      `/v1/editor/candidates/${id}/video`,
      "/v1/editor/candidates",
      `/v1/editor/candidates/${id}/video`,
    ]);
    assert.deepEqual(
      await fs.promises.readFile(path.join(folder, recordingId)),
      Buffer.from([1, 2, 3]),
    );
  } finally {
    await fs.promises.rm(folder, { recursive: true, force: true });
  }
});

void test("candidate MP4 download signs in after an Electron cancelled redirect", async () => {
  const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "labatar-candidate-redirect-"));
  const id = "12345678-1234-1234-1234-123456789abc";
  let signedIn = false;
  try {
    const recordingId = await downloadComboCandidate(
      null,
      id,
      folder,
      3,
      {
        async fetch(url) {
          if (!signedIn) throw new Error("Redirect was cancelled");
          if (new URL(url).pathname === "/v1/editor/candidates") {
            return Response.json({ items: [] });
          }
          return new Response(Buffer.from([1, 2, 3]), {
            headers: { "Content-Type": "video/mp4", "Content-Length": "3" },
          });
        },
      },
      async (_session, _parent, verifyAccess) => {
        signedIn = true;
        assert.equal(await verifyAccess(), true);
      },
    );
    assert.equal(recordingId, `candidate-${id}.mp4`);
  } finally {
    await fs.promises.rm(folder, { recursive: true, force: true });
  }
});

void test("candidate MP4 download recovers a stalled read", async () => {
  const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "labatar-candidate-retry-"));
  const id = "12345678-1234-1234-1234-123456789abc";
  let requests = 0;
  let resets = 0;
  try {
    const recordingId = await downloadComboCandidate(
      null,
      id,
      folder,
      3,
      {
        async fetch() {
          requests += 1;
          return requests === 1
            ? new Promise(() => {})
            : new Response(Buffer.from([1, 2, 3]), {
                headers: { "Content-Type": "video/mp4", "Content-Length": "3" },
              });
        },
        async closeAllConnections() {
          resets += 1;
        },
      },
      undefined,
      5,
    );
    assert.equal(recordingId, `candidate-${id}.mp4`);
    assert.equal(requests, 2);
    assert.equal(resets, 1);
  } finally {
    await fs.promises.rm(folder, { recursive: true, force: true });
  }
});

void test("candidate preview forwards byte ranges through the editor session", async () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  const request = new Request(`labatar-media://candidate/${id}`, {
    headers: { Range: "bytes=2-4" },
  });
  const ses = {
    async fetch(url, options) {
      assert.equal(new URL(url).pathname, `/v1/editor/candidates/${id}/video`);
      assert.equal(options.headers.Range, "bytes=2-4");
      assert.equal(options.credentials, "include");
      return new Response("abc", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": "3",
          "Content-Range": "bytes 2-4/10",
          "Accept-Ranges": "bytes",
        },
      });
    },
  };
  const response = await previewComboCandidate(id, request, ses);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 2-4/10");
  assert.equal(await response.text(), "abc");
});

void test("candidate preview does not expose catalog sign-in HTML as video", async () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  const response = await previewComboCandidate(id, new Request(`labatar-media://candidate/${id}`), {
    fetch: async () =>
      new Response("<html>Sign in</html>", { headers: { "Content-Type": "text/html" } }),
  });
  assert.equal(response.status, 401);
  assert.equal(await response.text(), "");
});

void test("candidate preview treats an Electron cancelled redirect as sign-in required", async () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  const response = await previewComboCandidate(id, new Request(`labatar-media://candidate/${id}`), {
    async fetch() {
      throw new Error("Redirect was cancelled");
    },
  });
  assert.equal(response.status, 401);
});

void test("candidate MP4 preview retries a stalled read after reconnecting", async () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  let requests = 0;
  let resets = 0;
  const ses = {
    async fetch() {
      requests += 1;
      return requests === 1
        ? new Promise(() => {})
        : new Response("abc", { headers: { "Content-Type": "video/mp4" } });
    },
    async closeAllConnections() {
      resets += 1;
    },
  };
  const response = await previewComboCandidate(
    id,
    new Request(`labatar-media://candidate/${id}`),
    ses,
    5,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "abc");
  assert.equal(requests, 2);
  assert.equal(resets, 1);
});

void test("candidate client uploads every MP4 byte in ordered chunks before completing", async () => {
  const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "labatar-candidate-test-"));
  const filePath = path.join(folder, "combo.mp4");
  const bytes = Buffer.alloc(8 * 1024 * 1024 + 3, 7);
  bytes[bytes.length - 3] = 1;
  bytes[bytes.length - 2] = 2;
  bytes[bytes.length - 1] = 3;
  await fs.promises.writeFile(filePath, bytes);
  const previousFetch = global.fetch;
  const id = "12345678-1234-1234-1234-123456789abc";
  const originCandidateId = "87654321-4321-4321-4321-cba987654321";
  const token = "a".repeat(64);
  const parts = [];
  const progress = [];
  try {
    let signedIn = false;
    const ses = {
      async fetch(url, options) {
        assert.equal(new URL(url).pathname, "/v1/editor/candidates/upload");
        assert.equal(options.credentials, "include");
        if ((options.method ?? "GET") === "GET")
          return signedIn
            ? Response.json({ allowed: true })
            : Response.redirect("https://example.com");
        const body = JSON.parse(options.body);
        assert.equal(body.fileSize, bytes.length);
        assert.equal(body.fileName, "combo.mp4");
        assert.deepEqual(body.combo, { id: "aang-5b" });
        assert.equal(body.originCandidateId, originCandidateId);
        return Response.json(
          { id, token, partSize: 8 * 1024 * 1024, partCount: 2 },
          { status: 201 },
        );
      },
    };
    global.fetch = async (url, options) => {
      const pathname = new URL(url).pathname;
      if (pathname.startsWith(`/v1/candidates/${id}/parts/`)) {
        assert.equal(options.headers["X-Candidate-Token"], token);
        const number = Number(pathname.split("/").at(-1));
        const chunk = Buffer.from(options.body);
        parts[number - 1] = chunk;
        return Response.json({
          partNumber: number,
          etag: createHash("md5").update(chunk).digest("hex"),
        });
      }
      if (pathname === `/v1/candidates/${id}/complete`) {
        assert.equal(JSON.parse(options.body).parts.length, 2);
        return Response.json({ status: "pending" });
      }
      throw new Error(`Unexpected candidate request: ${pathname}`);
    };
    const result = await submitComboCandidate({
      recordingPath: filePath,
      combo: { id: "aang-5b" },
      originCandidateId,
      onProgress: (item) => progress.push(item),
      ses,
      signIn: async (_session, _parent, verifyAccess, targetUrl) => {
        assert.equal(new URL(targetUrl).pathname, "/v1/editor/candidates/upload");
        signedIn = true;
        assert.equal(await verifyAccess(ses), true);
      },
    });
    assert.deepEqual(result, { id });
    assert.deepEqual(Buffer.concat(parts), bytes);
    assert.deepEqual(
      progress.map((item) => item.uploadedBytes),
      [8 * 1024 * 1024, bytes.length],
    );
  } finally {
    global.fetch = previousFetch;
    await fs.promises.rm(folder, { recursive: true, force: true });
  }
});
