const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const {
  publisherSession,
  publisherRequestWithTimeout,
  publisherReadWithRecovery,
  fetchEditorResponse,
  isCancelledEditorRedirect,
  catalogOrigin,
  signInToCatalog,
} = require("./catalog-publisher.cjs");

const api = `${catalogOrigin}/v1/candidates`;
const editorApi = `${catalogOrigin}/v1/editor/candidates`;
const candidateIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const maxFileSize = 2 * 1024 * 1024 * 1024;

async function checkCandidateAccess(ses, timeoutMs = 15000) {
  return publisherReadWithRecovery(
    ses,
    "Candidate sign-in check",
    async (signal) => {
      const result = await fetchEditorResponse(ses, editorApi, {
        credentials: "include",
        redirect: "manual",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal,
      });
      return result.authenticationRequired ? null : true;
    },
    timeoutMs,
  );
}

async function candidateServiceStatus() {
  const response = await fetch(`${catalogOrigin}/health`, { cache: "no-store" });
  if (!response.ok) return { available: false };
  const health = await response.json();
  return { available: health?.features?.comboCandidates === true };
}

function candidateId(value) {
  if (typeof value !== "string" || !candidateIdPattern.test(value)) {
    throw new Error("Invalid candidate ID.");
  }
  return value;
}

async function responseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Candidate request failed (${response.status}).`);
  return data;
}

async function submitComboCandidate({ recordingPath, combo, originCandidateId, onProgress }) {
  if (path.extname(recordingPath).toLowerCase() !== ".mp4") {
    throw new Error("Link a local MP4 before submitting this combo.");
  }
  const file = await fs.promises.open(recordingPath, "r");
  let created = null;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maxFileSize) {
      throw new Error("The linked MP4 must be between 1 byte and 2 GiB.");
    }
    created = await responseJson(
      await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          combo,
          ...(originCandidateId ? { originCandidateId: candidateId(originCandidateId) } : {}),
          fileName: path.basename(recordingPath),
          fileSize: stat.size,
        }),
      }),
    );
    if (
      !candidateIdPattern.test(created.id ?? "") ||
      !/^[0-9a-f]{64}$/.test(created.token ?? "") ||
      !Number.isSafeInteger(created.partSize) ||
      created.partSize < 5 * 1024 * 1024 ||
      created.partSize > 32 * 1024 * 1024 ||
      created.partCount !== Math.ceil(stat.size / created.partSize)
    )
      throw new Error("The candidate upload response is invalid.");
    const parts = [];
    for (let number = 1; number <= created.partCount; number += 1) {
      const offset = (number - 1) * created.partSize;
      const expected = Math.min(created.partSize, stat.size - offset);
      const buffer = Buffer.allocUnsafe(expected);
      let filled = 0;
      while (filled < expected) {
        const { bytesRead } = await file.read(buffer, filled, expected - filled, offset + filled);
        if (!bytesRead) throw new Error("The MP4 changed during upload.");
        filled += bytesRead;
      }
      const part = await responseJson(
        await fetch(`${api}/${created.id}/parts/${number}`, {
          method: "PUT",
          headers: { "X-Candidate-Token": created.token, "Content-Type": "video/mp4" },
          body: buffer,
        }),
      );
      if (part.partNumber !== number || typeof part.etag !== "string") {
        throw new Error("The candidate upload returned an invalid part.");
      }
      parts.push(part);
      onProgress?.({ uploadedBytes: offset + expected, totalBytes: stat.size });
    }
    const current = await file.stat();
    if (current.size !== stat.size || current.mtimeMs !== stat.mtimeMs) {
      throw new Error("The MP4 changed during upload. Submit it again.");
    }
    const finished = await responseJson(
      await fetch(`${api}/${created.id}/complete`, {
        method: "POST",
        headers: {
          "X-Candidate-Token": created.token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ parts }),
      }),
    );
    if (finished.status !== "pending")
      throw new Error("The candidate did not reach the review queue.");
    return { id: created.id };
  } catch (error) {
    if (created?.id && created?.token) {
      await fetch(`${api}/${created.id}/abort`, {
        method: "POST",
        headers: { "X-Candidate-Token": created.token },
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    await file.close();
  }
}

async function requestCandidateEditor(
  ses,
  parent,
  pathSuffix = "",
  options = {},
  signIn = signInToCatalog,
  timeoutMs = 15000,
  onConnectionReset,
  interactive = true,
) {
  const request = (suffix, requestOptions) => {
    const action = async (signal) => {
      return fetchEditorResponse(ses, `${editorApi}${suffix}`, {
        credentials: "include",
        redirect: "manual",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
        },
        ...requestOptions,
        signal,
      });
    };
    return requestOptions.method === undefined || requestOptions.method === "GET"
      ? publisherReadWithRecovery(ses, "Candidate request", action, timeoutMs, onConnectionReset)
      : publisherRequestWithTimeout("Candidate request", action, timeoutMs);
  };
  let result = await request(pathSuffix, options);
  if (result.authenticationRequired) {
    if (!interactive) {
      throw new Error("Candidate sign-in required. Open Upstream candidates to sign in.");
    }
    await signIn(ses, parent, () => checkCandidateAccess(ses));
    result = await request(pathSuffix, options);
  }
  if (result.authenticationRequired) throw new Error("Catalog sign-in expired. Sign in again.");
  return result.body;
}

function editorRequest(parent, pathSuffix = "", options = {}) {
  return requestCandidateEditor(publisherSession(), parent, pathSuffix, options);
}

const candidateListInFlight = new Map();
async function listComboCandidates(
  parent,
  ses = publisherSession(),
  timeoutMs = 15000,
  onConnectionReset = () => {},
  interactive = true,
) {
  if (!candidateListInFlight.has(interactive)) {
    const requestList = async () => {
      const result = await requestCandidateEditor(
        ses,
        parent,
        "",
        {},
        signInToCatalog,
        timeoutMs,
        onConnectionReset,
        interactive,
      );
      if (!Array.isArray(result.items)) throw new Error("Invalid candidate list.");
      return result.items;
    };
    const inFlight = requestList().finally(() => {
      candidateListInFlight.delete(interactive);
    });
    candidateListInFlight.set(interactive, inFlight);
  }
  return candidateListInFlight.get(interactive);
}

async function approveComboCandidate(parent, id) {
  candidateId(id);
  return editorRequest(parent, `/${id}/approve`, { method: "POST" });
}

async function rejectComboCandidate(parent, id, reason) {
  candidateId(id);
  if (typeof reason !== "string" || reason.length > 1000)
    throw new Error("Invalid rejection reason.");
  return editorRequest(parent, `/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

async function markComboCandidateUploaded(parent, id, youtubeUrl) {
  candidateId(id);
  return editorRequest(parent, `/${id}/uploaded`, {
    method: "POST",
    body: JSON.stringify({ youtubeUrl }),
  });
}

async function removeUploadedComboCandidate(parent, id) {
  candidateId(id);
  return editorRequest(parent, `/${id}`, { method: "DELETE" });
}

async function downloadComboCandidate(
  parent,
  id,
  recordingFolder,
  expectedSize,
  ses = publisherSession(),
  signIn = signInToCatalog,
  requestTimeoutMs = 30000,
) {
  candidateId(id);
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > maxFileSize) {
    throw new Error("Invalid candidate MP4 size.");
  }
  const root = path.resolve(recordingFolder);
  await fs.promises.mkdir(root, { recursive: true });
  if ((await fs.promises.realpath(root)) !== root) {
    throw new Error("The recording folder has moved. Choose another recording directory.");
  }
  const name = `candidate-${id}.mp4`;
  const target = path.join(root, name);
  const recordingId = path.relative(root, target).split(path.sep).join("/");
  const existing = await fs.promises.stat(target).catch(() => null);
  if (existing?.isFile() && existing.size === expectedSize) return recordingId;
  const requestVideo = async () => {
    try {
      return await publisherReadWithRecovery(
        ses,
        "Candidate MP4 request",
        (signal) =>
          ses.fetch(`${editorApi}/${id}/video`, {
            credentials: "include",
            redirect: "manual",
            cache: "no-store",
            headers: { Accept: "video/mp4" },
            signal,
          }),
        requestTimeoutMs,
      );
    } catch (error) {
      if (isCancelledEditorRedirect(error)) return new Response(null, { status: 401 });
      throw error;
    }
  };
  let response = await requestVideo();
  if (response.status === 401 || (response.status >= 300 && response.status < 400)) {
    await signIn(ses, parent, () => checkCandidateAccess(ses));
    response = await requestVideo();
  }
  if (
    !response.ok ||
    !response.body ||
    !(response.headers.get("Content-Type") ?? "").includes("video/mp4")
  ) {
    throw new Error(`Could not download candidate MP4 (${response.status}).`);
  }
  if (Number(response.headers.get("Content-Length")) !== expectedSize) {
    throw new Error("Candidate MP4 size changed. Refresh the review queue.");
  }
  const temporary = path.join(root, `.${name}.${randomUUID()}.partial`);
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      fs.createWriteStream(temporary, { flags: "wx" }),
    );
    if ((await fs.promises.stat(temporary)).size !== expectedSize) {
      throw new Error("Candidate MP4 download was incomplete.");
    }
    await fs.promises.rm(target, { force: true });
    await fs.promises.rename(temporary, target);
    return recordingId;
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function previewComboCandidate(id, request, ses = publisherSession(), timeoutMs = 15000) {
  candidateId(id);
  const range = request.headers.get("Range");
  let response;
  try {
    response = await publisherReadWithRecovery(
      ses,
      "Candidate MP4 preview",
      (signal) =>
        ses.fetch(`${editorApi}/${id}/video`, {
          credentials: "include",
          redirect: "manual",
          cache: "no-store",
          headers: { Accept: "video/mp4", ...(range ? { Range: range } : {}) },
          signal: AbortSignal.any([request.signal, signal]),
        }),
      timeoutMs,
    );
  } catch (error) {
    if (isCancelledEditorRedirect(error)) return new Response(null, { status: 401 });
    throw error;
  }
  if (response.status === 416) {
    return new Response(null, {
      status: 416,
      headers: {
        "Cache-Control": "no-store",
        ...(response.headers.get("Content-Range")
          ? { "Content-Range": response.headers.get("Content-Range") }
          : {}),
      },
    });
  }
  if (
    ![200, 206].includes(response.status) ||
    !response.body ||
    !(response.headers.get("Content-Type") ?? "").includes("video/mp4")
  ) {
    return new Response(null, { status: response.status === 404 ? 404 : 401 });
  }
  const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": "no-store" });
  for (const name of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

module.exports = {
  requestCandidateEditor,
  checkCandidateAccess,
  candidateServiceStatus,
  submitComboCandidate,
  listComboCandidates,
  approveComboCandidate,
  rejectComboCandidate,
  markComboCandidateUploaded,
  removeUploadedComboCandidate,
  downloadComboCandidate,
  previewComboCandidate,
};
