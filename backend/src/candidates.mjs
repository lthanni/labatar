const privateHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const partSize = 8 * 1024 * 1024;
const maxFileSize = 2 * 1024 * 1024 * 1024;
const maxQueuedBytes = 50 * 1024 * 1024 * 1024;
const candidateIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const approvalPrefix = "approved:";

function isApproved(row) {
  return (
    row.status === "pending" &&
    ((row.rejection_reason ?? "").startsWith(approvalPrefix) || Boolean(row.approved_at))
  );
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...privateHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function fail(message, status = 400) {
  return json({ error: message }, status);
}

async function bodyJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") ?? "")) {
    throw new Error("Content-Type must be application/json.");
  }
  const bytes = await boundedBytes(request, 128 * 1024);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function boundedBytes(request, maximum) {
  const length = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(length) && length > maximum) throw new Error("Request body is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A request body is required.");
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error("Request body is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function one(db, sql, ...values) {
  const result = await db
    .prepare(sql)
    .bind(...values)
    .all();
  return result.results?.[0] ?? null;
}

async function tokenHash(token) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function candidateView(row) {
  const { originCandidateId, ...combo } = JSON.parse(row.combo_payload);
  return {
    id: row.id,
    originCandidateId: originCandidateId ?? row.id,
    combo,
    fileName: row.file_name,
    fileSize: row.file_size,
    status: isApproved(row) ? "approved" : row.status,
    rejectionReason: row.status === "rejected" ? row.rejection_reason : "",
    youtubeUrl: row.youtube_video_id
      ? `https://www.youtube.com/watch?v=${row.youtube_video_id}`
      : "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function candidate(db, id) {
  return one(db, "SELECT * FROM combo_candidates WHERE id = ?", id);
}

function sameComboIdentity(candidateCombo, publishedCombo) {
  if (
    candidateCombo.characterId !== publishedCombo.characterId ||
    candidateCombo.supportId !== publishedCombo.supportId ||
    candidateCombo.route?.trim().replace(/\s+/g, " ") !==
      publishedCombo.route?.trim().replace(/\s+/g, " ") ||
    candidateCombo.damage !== publishedCombo.damage ||
    candidateCombo.screenPosition !== publishedCombo.screenPosition ||
    Boolean(candidateCombo.starterIsNonAttackStance) !==
      Boolean(publishedCombo.starterIsNonAttackStance)
  )
    return false;
  const sortedEntries = (value) =>
    JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const sortedMechanics = (value) => JSON.stringify([...(value ?? [])].sort());
  return (
    sortedEntries(candidateCombo.resourceCosts) === sortedEntries(publishedCombo.resourceCosts) &&
    sortedMechanics(candidateCombo.mechanics) === sortedMechanics(publishedCombo.mechanics)
  );
}

function matchesPublishedCombo(row, publishedCombo) {
  const stored = JSON.parse(row.combo_payload);
  return (
    row.id === publishedCombo.sourceCandidateId ||
    (stored.originCandidateId ?? row.id) === publishedCombo.sourceCandidateId ||
    (!stored.originCandidateId && sameComboIdentity(stored, publishedCombo))
  );
}

async function authorizedSubmission(request, env, candidateId) {
  const row = await candidate(env.DB, candidateId);
  const token = request.headers.get("X-Candidate-Token") ?? "";
  if (!row || !/^[0-9a-f]{64}$/.test(token) || (await tokenHash(token)) !== row.upload_token_hash)
    return null;
  return row;
}

async function createCandidate(request, env, validateRecord) {
  let input;
  try {
    input = await bodyJson(request);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid submission.");
    if (
      Object.keys(input).some(
        (key) => !["combo", "fileName", "fileSize", "originCandidateId"].includes(key),
      )
    ) {
      throw new Error("Unexpected submission field.");
    }
    if (
      input.originCandidateId !== undefined &&
      !candidateIdPattern.test(input.originCandidateId)
    ) {
      throw new Error("originCandidateId must be a candidate UUID.");
    }
    if (!input.combo || typeof input.combo !== "object" || Array.isArray(input.combo)) {
      throw new Error("Combo details are required.");
    }
    if ("youtubeUrl" in input.combo || "youtubeVideoId" in input.combo) {
      throw new Error("Candidates must be submitted with their MP4, before YouTube upload.");
    }
    if (
      !Number.isSafeInteger(input.fileSize) ||
      input.fileSize < 1 ||
      input.fileSize > maxFileSize
    ) {
      throw new Error("MP4 must be between 1 byte and 2 GiB.");
    }
    if (
      typeof input.fileName !== "string" ||
      !/\.mp4$/i.test(input.fileName) ||
      input.fileName.length > 180 ||
      /[\\/]/.test(input.fileName) ||
      Array.from(input.fileName).some((character) => character.charCodeAt(0) < 32)
    ) {
      throw new Error("Use an MP4 file name without a path.");
    }
    const validated = validateRecord(
      "combo",
      { ...input.combo, youtubeVideoId: "M7lc1UVf-VE" },
      input.combo.id,
    );
    delete validated.youtubeVideoId;
    delete validated.startSeconds;
    delete validated.sourceCandidateId;
    input.combo = validated;
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid submission.");
  }
  // R2 aborts incomplete multipart uploads after seven days by default.
  await env.DB.prepare("DELETE FROM combo_candidates WHERE status = 'uploading' AND created_at < ?")
    .bind(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString())
    .run();
  const queue = await one(
    env.DB,
    "SELECT COALESCE(SUM(file_size), 0) AS total FROM combo_candidates WHERE status IN ('uploading', 'pending')",
  );
  if (Number(queue?.total ?? 0) + input.fileSize > maxQueuedBytes) {
    return fail(
      "The candidate review queue is full. Try again after some videos are reviewed.",
      429,
    );
  }
  const id = crypto.randomUUID();
  const token = newToken();
  const objectKey = `combo-candidates/${id}.mp4`;
  const now = new Date().toISOString();
  let upload;
  try {
    upload = await env.CANDIDATE_VIDEOS.createMultipartUpload(objectKey, {
      httpMetadata: { contentType: "video/mp4" },
    });
    await env.DB.prepare(`
      INSERT INTO combo_candidates
        (id, combo_payload, file_name, file_size, object_key, upload_id,
         upload_token_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)
    `)
      .bind(
        id,
        JSON.stringify({ ...input.combo, originCandidateId: input.originCandidateId ?? id }),
        input.fileName,
        input.fileSize,
        objectKey,
        upload.uploadId,
        await tokenHash(token),
        now,
        now,
      )
      .run();
  } catch {
    if (upload) await upload.abort().catch(() => undefined);
    return fail("Could not start candidate upload.", 500);
  }
  return json({ id, token, partSize, partCount: Math.ceil(input.fileSize / partSize) }, 201);
}

async function uploadPart(request, env, id, number) {
  const row = await authorizedSubmission(request, env, id);
  if (!row) return fail("Candidate upload not found.", 404);
  if (row.status !== "uploading") return fail("Candidate upload is already complete.", 409);
  const partNumber = Number(number);
  const partCount = Math.ceil(row.file_size / partSize);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount)
    return fail("Invalid part number.");
  const expected = Math.min(partSize, row.file_size - (partNumber - 1) * partSize);
  const bytes = await boundedBytes(request, expected);
  if (bytes.byteLength !== expected) return fail("Part size does not match the MP4 size.");
  const upload = env.CANDIDATE_VIDEOS.resumeMultipartUpload(row.object_key, row.upload_id);
  const part = await upload.uploadPart(partNumber, bytes);
  return json({ partNumber: part.partNumber, etag: part.etag });
}

async function completeCandidate(request, env, id) {
  const row = await authorizedSubmission(request, env, id);
  if (!row) return fail("Candidate upload not found.", 404);
  if (row.status === "pending") return json(candidateView(row));
  if (row.status !== "uploading") return fail("Candidate upload is already closed.", 409);
  let parts;
  try {
    parts = (await bodyJson(request)).parts;
    const count = Math.ceil(row.file_size / partSize);
    if (
      !Array.isArray(parts) ||
      parts.length !== count ||
      parts.some(
        (part, index) =>
          part?.partNumber !== index + 1 ||
          typeof part.etag !== "string" ||
          !/^[a-f0-9]{32}$/i.test(part.etag),
      )
    )
      throw new Error("Upload parts are incomplete.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid upload parts.");
  }
  const upload = env.CANDIDATE_VIDEOS.resumeMultipartUpload(row.object_key, row.upload_id);
  let object;
  try {
    object = await upload.complete(parts);
  } catch (error) {
    // A previous completion may have succeeded while its response was lost.
    object = await env.CANDIDATE_VIDEOS.head(row.object_key);
    if (!object) throw error;
  }
  if (object.size !== row.file_size) {
    await env.CANDIDATE_VIDEOS.delete(row.object_key);
    await env.DB.prepare("DELETE FROM combo_candidates WHERE id = ? AND status = 'uploading'")
      .bind(id)
      .run();
    return fail("Uploaded MP4 size does not match the submission.", 409);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE combo_candidates SET status = 'pending', updated_at = ?
    WHERE id = ? AND status = 'uploading'
  `)
    .bind(now, id)
    .run();
  return json({ ...candidateView(row), status: "pending", updatedAt: now });
}

async function abortCandidate(request, env, id) {
  const row = await authorizedSubmission(request, env, id);
  if (!row) return fail("Candidate upload not found.", 404);
  if (row.status !== "uploading") return fail("Only an unfinished upload can be aborted.", 409);
  await env.CANDIDATE_VIDEOS.resumeMultipartUpload(row.object_key, row.upload_id).abort();
  await env.DB.prepare("DELETE FROM combo_candidates WHERE id = ? AND status = 'uploading'")
    .bind(id)
    .run();
  return json({ aborted: true });
}

async function listCandidates(env) {
  const result = await env.DB.prepare(`
    SELECT * FROM combo_candidates WHERE status != 'uploading' ORDER BY created_at DESC LIMIT 500
  `).all();
  const rows = result.results ?? [];
  if (!rows.length) return json({ items: [] });
  const published = await env.DB.prepare(`
    SELECT v.payload FROM catalog_versions AS v
    WHERE v.kind = 'combo' AND v.published = 1
      AND v.revision = (
        SELECT MAX(revision) FROM catalog_versions WHERE kind = v.kind AND id = v.id
      )
  `).all();
  const publishedCombos = (published.results ?? []).map((row) => JSON.parse(row.payload));
  const staleRows = rows.filter((row) =>
    publishedCombos.some((combo) => matchesPublishedCombo(row, combo)),
  );
  const staleIds = new Set(staleRows.map((row) => row.id));
  for (const row of staleRows) {
    try {
      await removePublishedCandidate(env, row.id);
    } catch (error) {
      console.error("Could not reconcile published combo candidate", error);
    }
  }
  return json({
    items: rows.filter((row) => !staleIds.has(row.id)).map(candidateView),
  });
}

async function candidateVideo(request, env, id) {
  const row = await candidate(env.DB, id);
  if (!row || row.status !== "pending") return fail("Candidate video not found.", 404);
  const rangeHeader = request.headers.get("Range");
  let start = 0;
  let end = row.file_size - 1;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match || (!match[1] && !match[2])) {
      return new Response(null, {
        status: 416,
        headers: { ...privateHeaders, "Content-Range": `bytes */${row.file_size}` },
      });
    }
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix < 1) start = row.file_size;
      else start = Math.max(0, row.file_size - suffix);
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : end;
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= row.file_size
    ) {
      return new Response(null, {
        status: 416,
        headers: { ...privateHeaders, "Content-Range": `bytes */${row.file_size}` },
      });
    }
    end = Math.min(end, row.file_size - 1);
  }
  const object = await env.CANDIDATE_VIDEOS.get(
    row.object_key,
    rangeHeader ? { range: { offset: start, length: end - start + 1 } } : undefined,
  );
  if (!object) return fail("Candidate video is unavailable.", 404);
  return new Response(object.body, {
    status: rangeHeader ? 206 : 200,
    headers: {
      ...privateHeaders,
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
      ...(rangeHeader ? { "Content-Range": `bytes ${start}-${end}/${row.file_size}` } : {}),
      "Content-Disposition": `inline; filename="candidate-${id}.mp4"`,
    },
  });
}

async function rejectCandidate(request, env, id) {
  const row = await candidate(env.DB, id);
  if (!row) return fail("Candidate not found.", 404);
  if (row.status !== "pending") return fail("Only pending candidates can be rejected.", 409);
  let reason;
  try {
    reason = (await bodyJson(request)).reason ?? "";
    if (typeof reason !== "string" || reason.length > 1000)
      throw new Error("Invalid rejection reason.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid rejection reason.");
  }
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
    UPDATE combo_candidates SET status = 'rejected', rejection_reason = ?, updated_at = ?
    WHERE id = ? AND status = 'pending'
  `)
    .bind(reason.trim(), now, id)
    .run();
  if (result.meta?.changes !== 1) return fail("Candidate changed. Refresh the queue.", 409);
  await env.CANDIDATE_VIDEOS.delete(row.object_key);
  return json({
    ...candidateView(row),
    status: "rejected",
    rejectionReason: reason.trim(),
    updatedAt: now,
  });
}

async function approveCandidate(env, id) {
  const row = await candidate(env.DB, id);
  if (!row) return fail("Candidate not found.", 404);
  if (row.status !== "pending") return fail("Only pending candidates can be approved.", 409);
  if (isApproved(row)) return json(candidateView(row));
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
    UPDATE combo_candidates SET rejection_reason = ?, updated_at = ?
    WHERE id = ? AND status = 'pending' AND rejection_reason = ''
  `)
    .bind(`${approvalPrefix}${now}`, now, id)
    .run();
  if (result.meta?.changes !== 1) return fail("Candidate changed. Refresh the queue.", 409);
  return json({ ...candidateView(row), status: "approved", updatedAt: now });
}

async function markUploaded(request, env, id, youtubeVideoId) {
  const row = await candidate(env.DB, id);
  if (!row) return fail("Candidate not found.", 404);
  if (row.status !== "pending") return fail("Only pending candidates can be uploaded.", 409);
  let videoId;
  try {
    videoId = youtubeVideoId((await bodyJson(request)).youtubeUrl);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid YouTube URL.");
  }
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
    UPDATE combo_candidates SET status = 'uploaded', youtube_video_id = ?, updated_at = ?
    WHERE id = ? AND status = 'pending'
  `)
    .bind(videoId, now, id)
    .run();
  if (result.meta?.changes !== 1) return fail("Candidate changed. Refresh the queue.", 409);
  await env.CANDIDATE_VIDEOS.delete(row.object_key);
  return json({
    ...candidateView(row),
    status: "uploaded",
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    updatedAt: now,
  });
}

async function deleteUploadedCandidate(env, id) {
  const row = await candidate(env.DB, id);
  if (!row) return json({ id, deleted: true });
  if (row.status !== "uploaded") return fail("Upload the candidate before removing it.", 409);
  await env.CANDIDATE_VIDEOS.delete(row.object_key);
  const result = await env.DB.prepare(
    "DELETE FROM combo_candidates WHERE id = ? AND status = 'uploaded'",
  )
    .bind(id)
    .run();
  if (result.meta?.changes !== 1) return fail("Candidate changed. Refresh the queue.", 409);
  return json({ id, deleted: true });
}

/** A published catalog record supersedes its candidate, regardless of queue status. */
export async function removePublishedCandidate(env, id) {
  if (!env.CANDIDATE_VIDEOS || !candidateIdPattern.test(id)) return false;
  const row = await candidate(env.DB, id);
  if (!row || row.status === "uploading") return false;
  await env.CANDIDATE_VIDEOS.delete(row.object_key);
  const result = await env.DB.prepare(
    "DELETE FROM combo_candidates WHERE id = ? AND status != 'uploading'",
  )
    .bind(id)
    .run();
  return result.meta?.changes === 1;
}

export async function removeCandidatesForPublishedCombo(env, publishedCombo) {
  if (!env.CANDIDATE_VIDEOS) return 0;
  const result = await env.DB.prepare(
    "SELECT * FROM combo_candidates WHERE status != 'uploading'",
  ).all();
  let removed = 0;
  for (const row of result.results ?? []) {
    if (matchesPublishedCombo(row, publishedCombo) && (await removePublishedCandidate(env, row.id)))
      removed += 1;
  }
  return removed;
}

export async function handleCandidateRequest(
  request,
  env,
  getEditor,
  getComboUpload,
  validateRecord,
  youtubeVideoId,
) {
  const path = new URL(request.url).pathname;
  const publicRoot = path === "/v1/candidates";
  const uploadRoot = path === "/v1/editor/candidates/upload";
  const part = /^\/v1\/candidates\/([^/]+)\/parts\/([^/]+)$/.exec(path);
  const finish = /^\/v1\/candidates\/([^/]+)\/(complete|abort)$/.exec(path);
  const editorRoot = path === "/v1/editor/candidates";
  const editorDelete = uploadRoot ? null : /^\/v1\/editor\/candidates\/([^/]+)$/.exec(path);
  const editorItem = /^\/v1\/editor\/candidates\/([^/]+)\/(video|approve|reject|uploaded)$/.exec(
    path,
  );
  if (!publicRoot && !uploadRoot && !part && !finish && !editorRoot && !editorDelete && !editorItem)
    return null;
  if (!env.CANDIDATE_VIDEOS) return fail("Candidate video storage is unavailable.", 503);
  const candidateId = part?.[1] ?? finish?.[1] ?? editorDelete?.[1] ?? editorItem?.[1];
  if (candidateId && !candidateIdPattern.test(candidateId))
    return fail("Candidate not found.", 404);
  if (editorRoot || editorDelete || editorItem) {
    try {
      await getEditor(request, env);
    } catch {
      return fail("Editor authentication required.", 401);
    }
  }
  if (uploadRoot) {
    try {
      await getComboUpload(request, env);
    } catch {
      return fail("Combo upload permission required.", 403);
    }
  }
  try {
    if (publicRoot && request.method === "POST")
      return fail("Sign in with an approved email to upload combos. Update the desktop app.", 403);
    if (uploadRoot && request.method === "GET") return json({ allowed: true });
    if (uploadRoot && request.method === "POST")
      return createCandidate(request, env, validateRecord);
    if (part && request.method === "PUT") return uploadPart(request, env, part[1], part[2]);
    if (finish?.[2] === "complete" && request.method === "POST")
      return completeCandidate(request, env, finish[1]);
    if (finish?.[2] === "abort" && request.method === "POST")
      return abortCandidate(request, env, finish[1]);
    if (editorRoot && request.method === "GET") return listCandidates(env);
    if (editorDelete && request.method === "DELETE")
      return deleteUploadedCandidate(env, editorDelete[1]);
    if (editorItem?.[2] === "video" && request.method === "GET")
      return candidateVideo(request, env, editorItem[1]);
    if (editorItem?.[2] === "approve" && request.method === "POST")
      return await approveCandidate(env, editorItem[1]);
    if (editorItem?.[2] === "reject" && request.method === "POST")
      return rejectCandidate(request, env, editorItem[1]);
    if (editorItem?.[2] === "uploaded" && request.method === "POST")
      return markUploaded(request, env, editorItem[1], youtubeVideoId);
    return fail("Method not allowed.", 405);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Candidate request failed.", 500);
  }
}

export const candidatePartSize = partSize;
