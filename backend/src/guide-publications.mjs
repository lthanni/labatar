import { validateTechEntry, handleTechRequest } from "./tech.mjs";
import {
  checkCharacterNoteSection,
  validateCharacterNote,
  handleCharacterNotesRequest,
} from "./character-notes.mjs";

const chunkSize = 8 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const videoId = /^[A-Za-z0-9_-]{11}$/;
const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
const all = async (db, sql, ...args) =>
  (
    await db
      .prepare(sql)
      .bind(...args)
      .all()
  ).results ?? [];
const one = async (db, sql, ...args) => (await all(db, sql, ...args))[0];
const run = (db, sql, ...args) =>
  db
    .prepare(sql)
    .bind(...args)
    .run();

function configured(env) {
  return Boolean(
    env.CANDIDATE_VIDEOS &&
    env.YOUTUBE_CLIENT_ID &&
    env.YOUTUBE_CLIENT_SECRET &&
    env.YOUTUBE_REFRESH_TOKEN &&
    env.YOUTUBE_CHANNEL_ID,
  );
}

async function boundedBody(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A request body is required.");
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
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

async function input(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") ?? ""))
    throw new Error("Content-Type must be application/json.");
  return JSON.parse(new TextDecoder().decode(await boundedBody(request, 64 * 1024)));
}

function view(job) {
  return {
    id: job.id,
    status: job.status,
    error: job.error,
    ...(job.result ? { result: JSON.parse(job.result) } : {}),
  };
}

async function publicationProgress(env, job) {
  const progress = await one(
    env.DB,
    `SELECT COUNT(*) AS total,
      COUNT(upload.youtube_video_id) AS completed,
      COUNT(upload.youtube_session) AS started
    FROM json_each(?, '$.videos') AS video
    LEFT JOIN guide_video_uploads AS upload
      ON upload.id = json_extract(video.value, '$.uploadId') AND upload.editor_email = ?
    WHERE json_extract(video.value, '$.uploadId') IS NOT NULL`,
    job.payload,
    job.editor_email,
  );
  const phase = !configured(env)
    ? "waiting-for-authorization"
    : progress.completed === progress.total
      ? "publishing"
      : progress.started || progress.completed || job.lease_until > Date.now()
        ? "uploading"
        : "queued";
  return { phase, completedVideos: progress.completed, totalVideos: progress.total };
}

function validateDraft(type, item) {
  if (!item || !Array.isArray(item.videos) || item.videos.length > 12)
    throw new Error("Use at most 12 guide videos.");
  const normalized = {
    ...item,
    videos: item.videos.map((video) => {
      if (
        !video ||
        typeof video !== "object" ||
        Array.isArray(video) ||
        Object.keys(video).some((key) => !["title", "description", "url", "uploadId"].includes(key))
      )
        throw new Error("Invalid guide video.");
      if (video.uploadId && (!uuid.test(video.uploadId) || video.url))
        throw new Error("Choose one guide video source.");
      return {
        title: video.title,
        description: video.description,
        url: video.uploadId ? "https://www.youtube.com/watch?v=M7lc1UVf-VE" : video.url,
      };
    }),
  };
  if (type === "tech") return validateTechEntry(normalized, item.id);
  if (type === "note") return validateCharacterNote(normalized, item.id);
  throw new Error("Select a Tech guide or character note.");
}

async function checkRevision(env, type, item, expected) {
  const table = type === "tech" ? "tech_entries" : "character_notes";
  const row = await one(env.DB, `SELECT * FROM ${table} WHERE id = ?`, item.id);
  if ((row?.revision ?? 0) !== expected)
    throw new Error("The guide changed. Refresh before publishing.");
  if (
    row &&
    (type === "tech"
      ? row.section_id !== item.sectionId
      : row.kind !== item.kind ||
        row.character_id !== item.characterId ||
        row.support_id !== item.supportId)
  )
    throw new Error("This ID belongs to another guide.");
  if (
    type === "tech" &&
    !(await one(
      env.DB,
      "SELECT id FROM tech_sections WHERE id = ? AND published = 1",
      item.sectionId,
    ))
  )
    throw new Error("Publish the category before publishing this guide.");
  if (type === "note") await checkCharacterNoteSection(env.DB, item);
}

export async function handleGuidePublications(request, env, getEditor) {
  const url = new URL(request.url);
  const upload =
    /^\/v1\/editor\/guide-videos(?:\/([0-9a-f-]+)(?:\/(parts\/([0-9]+)|complete))?)?$/.exec(
      url.pathname,
    );
  const publication = /^\/v1\/editor\/guide-publications(?:\/([0-9a-f-]+))?$/.exec(url.pathname);
  if (!upload && !publication) return null;
  let email;
  try {
    email = await getEditor(request, env);
  } catch {
    return json({ error: "Editor authentication required." }, 401);
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "Invalid request origin." }, 403);
  try {
    if (publication?.[1] && request.method === "GET") {
      const job = await one(
        env.DB,
        "SELECT * FROM guide_publications WHERE id = ? AND editor_email = ?",
        publication[1],
        email,
      );
      if (!job) return json({ error: "Publication not found." }, 404);
      return json({
        ...view(job),
        ...(job.status === "pending" ? { progress: await publicationProgress(env, job) } : {}),
      });
    }
    if (!configured(env))
      return json({ error: "The owner needs to configure backend YouTube uploads." }, 503);
    if (upload) {
      if (!upload[1] && request.method === "POST") {
        const body = await input(request);
        if (
          !uuid.test(body.id) ||
          !Number.isSafeInteger(body.fileSize) ||
          body.fileSize < 1 ||
          body.fileSize > 2 ** 31
        )
          throw new Error("Select an MP4 of up to 2 GiB.");
        let row = await one(env.DB, "SELECT * FROM guide_video_uploads WHERE id = ?", body.id);
        if (row && (row.editor_email !== email || row.file_size !== body.fileSize))
          return json({ error: "Upload ID is already in use." }, 409);
        if (!row) {
          const queued = await one(
            env.DB,
            "SELECT COALESCE(SUM(file_size), 0) AS bytes FROM guide_video_uploads WHERE status != 'cleaned'",
          );
          if (queued.bytes + body.fileSize > 50 * 2 ** 30)
            return json({ error: "Guide video storage is full." }, 409);
          const key = `guide-videos/${body.id}.mp4`;
          const multipart = await env.CANDIDATE_VIDEOS.createMultipartUpload(key, {
            httpMetadata: { contentType: "video/mp4" },
          });
          try {
            await run(
              env.DB,
              `INSERT INTO guide_video_uploads
              (id, editor_email, file_size, object_key, upload_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
              body.id,
              email,
              body.fileSize,
              key,
              multipart.uploadId,
              new Date().toISOString(),
            );
          } catch (error) {
            await multipart.abort();
            throw error;
          }
          row = { id: body.id, status: "uploading" };
        }
        return json({
          id: row.id,
          status: row.status === "cleaned" ? "uploaded" : row.status,
          partSize: chunkSize,
        });
      }
      const row = await one(
        env.DB,
        "SELECT * FROM guide_video_uploads WHERE id = ? AND editor_email = ?",
        upload[1],
        email,
      );
      if (!row) return json({ error: "Upload not found." }, 404);
      if (upload[3] && request.method === "PUT") {
        if (row.status !== "uploading") return json({ error: "Upload already completed." }, 409);
        const number = Number(upload[3]);
        const expected = Math.min(chunkSize, row.file_size - (number - 1) * chunkSize);
        if (!Number.isSafeInteger(number) || number < 1 || expected <= 0)
          throw new Error("Invalid part number.");
        const bytes = await boundedBody(request, expected);
        if (bytes.byteLength !== expected) throw new Error("Incorrect part size.");
        const multipart = env.CANDIDATE_VIDEOS.resumeMultipartUpload(row.object_key, row.upload_id);
        return json(await multipart.uploadPart(number, bytes));
      }
      if (upload[2] === "complete" && request.method === "POST") {
        if (row.status !== "uploading") return json({ id: row.id, status: row.status });
        const { parts } = await input(request);
        if (
          !Array.isArray(parts) ||
          parts.length !== Math.ceil(row.file_size / chunkSize) ||
          !parts.every(
            (part, i) =>
              part.partNumber === i + 1 && typeof part.etag === "string" && part.etag.length <= 512,
          )
        )
          throw new Error("Invalid upload parts.");
        // A lost completion response is recoverable using the private object metadata.
        let object = await env.CANDIDATE_VIDEOS.head(row.object_key);
        if (!object)
          object = await env.CANDIDATE_VIDEOS.resumeMultipartUpload(
            row.object_key,
            row.upload_id,
          ).complete(parts);
        if (object.size !== row.file_size) throw new Error("Incorrect uploaded file size.");
        await run(env.DB, "UPDATE guide_video_uploads SET status = 'ready' WHERE id = ?", row.id);
        return json({ id: row.id, status: "ready" });
      }
    }
    if (publication && !publication[1] && request.method === "POST") {
      const body = await input(request);
      const { id, type, item, expectedRevision } = body;
      if (!uuid.test(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw new Error("Invalid publication request.");
      validateDraft(type, item);
      const previous = await one(env.DB, "SELECT * FROM guide_publications WHERE id = ?", id);
      if (previous) {
        if (
          previous.editor_email !== email ||
          previous.payload !== JSON.stringify(item) ||
          previous.type !== type ||
          previous.expected_revision !== expectedRevision
        )
          return json({ error: "Publication ID is already in use." }, 409);
        if (previous.status === "failed") {
          await checkRevision(env, type, item, expectedRevision);
          await run(
            env.DB,
            "UPDATE guide_publications SET status = 'pending', error = '', lease_until = 0 WHERE id = ? AND status = 'failed'",
            id,
          );
          return json({ id, status: "pending", error: "" }, 202);
        }
        return json(view(previous));
      }
      await checkRevision(env, type, item, expectedRevision);
      for (const video of item.videos) {
        if (!video.uploadId) continue;
        const source = await one(
          env.DB,
          "SELECT * FROM guide_video_uploads WHERE id = ? AND editor_email = ?",
          video.uploadId,
          email,
        );
        if (!source || !["ready", "uploaded", "cleaned"].includes(source.status))
          throw new Error("Finish uploading every MP4 before publishing.");
      }
      const pending = await one(
        env.DB,
        "SELECT id FROM guide_publications WHERE type = ? AND item_id = ? AND status = 'pending'",
        type,
        item.id,
      );
      if (pending) return json({ error: "This guide already has a pending publication." }, 409);
      await run(
        env.DB,
        `INSERT INTO guide_publications (id, editor_email, type, item_id, expected_revision, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        email,
        type,
        item.id,
        expectedRevision,
        JSON.stringify(item),
        new Date().toISOString(),
      );
      return json({ id, status: "pending", error: "" }, 202);
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    return json({ error: error instanceof SyntaxError ? "Invalid JSON." : error.message }, 400);
  }
}

async function googleToken(env, fetcher) {
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      refresh_token: env.YOUTUBE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token)
    throw new Error("Backend YouTube authorization needs the owner's attention.");
  const channel = await fetcher(
    "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
    {
      headers: { Authorization: `Bearer ${data.access_token}` },
    },
  );
  const channels = await channel.json();
  if (!channel.ok || !channels.items?.some((item) => item.id === env.YOUTUBE_CHANNEL_ID))
    throw new Error("Backend YouTube authorization does not match the configured channel.");
  if (env.YOUTUBE_CHANNEL_HANDLE) {
    const target = await fetcher(
      `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(env.YOUTUBE_CHANNEL_HANDLE)}`,
      {
        headers: { Authorization: `Bearer ${data.access_token}` },
      },
    );
    const expected = await target.json();
    if (
      !target.ok ||
      expected.items?.length !== 1 ||
      expected.items[0].id !== env.YOUTUBE_CHANNEL_ID
    )
      throw new Error("Backend YouTube channel does not match the configured handle.");
  }
  return data.access_token;
}

function sessionUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.googleapis.com" ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("YouTube returned an invalid upload session.");
  return url.toString();
}

async function finishVideo(env, row, response) {
  const body = await response.json();
  if (!videoId.test(body.id ?? "")) throw new Error("YouTube did not return a video ID.");
  if (body.snippet?.channelId !== env.YOUTUBE_CHANNEL_ID)
    throw new Error("Uploaded video does not belong to the configured YouTube channel.");
  await run(
    env.DB,
    "UPDATE guide_video_uploads SET status = 'uploaded', youtube_video_id = ? WHERE id = ?",
    body.id,
    row.id,
  );
  // Retain R2 until the entire guide is published; cleanup can be retried independently.
  return body.id;
}

async function uploadStep(env, row, video, token, fetcher) {
  if (row.youtube_video_id) return row.youtube_video_id;
  let session = row.youtube_session;
  if (!session) {
    const started = await fetcher(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": "video/mp4",
          "X-Upload-Content-Length": String(row.file_size),
        },
        body: JSON.stringify({
          snippet: {
            title: video.title.trim().slice(0, 100) || "Guide video",
            description: video.description,
            categoryId: "20",
          },
          status: { privacyStatus: "unlisted", embeddable: true, selfDeclaredMadeForKids: false },
        }),
      },
    );
    if (!started.ok) throw new Error(`YouTube could not start the upload (${started.status}).`);
    session = sessionUrl(started.headers.get("location"));
    await run(
      env.DB,
      "UPDATE guide_video_uploads SET youtube_session = ?, youtube_channel_id = ? WHERE id = ?",
      session,
      env.YOUTUBE_CHANNEL_ID,
      row.id,
    );
  }
  // Query YouTube's committed offset on every attempt, including after a lost final response.
  // Workers supports manual redirect handling for YouTube's 308 Resume Incomplete responses.
  const probe = await fetcher(sessionUrl(session), {
    method: "PUT",
    redirect: "manual",
    body: new Uint8Array(),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Range": `bytes */${row.file_size}`,
      "Content-Length": "0",
    },
  });
  if (probe.status === 200 || probe.status === 201) return finishVideo(env, row, probe);
  if (probe.status !== 308)
    throw new Error(
      `YouTube upload session needs attention (${probe.status}); no replacement video was created.`,
    );
  const range = probe.headers.get("range");
  const match = range ? /^bytes=0-(\d+)$/.exec(range) : null;
  if (range && !match) throw new Error("YouTube returned an invalid upload offset.");
  const offset = match ? Number(match[1]) + 1 : 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= row.file_size)
    throw new Error("Invalid YouTube upload offset.");
  const length = Math.min(chunkSize, row.file_size - offset);
  const object = await env.CANDIDATE_VIDEOS.get(row.object_key, { range: { offset, length } });
  if (!object) throw new Error("The staged guide MP4 is unavailable.");
  // Workers derives Content-Length from a fixed body; an ordinary R2 stream is chunked.
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  if (bytes.byteLength !== length) throw new Error("The staged guide MP4 has an invalid size.");
  const uploaded = await fetcher(sessionUrl(session), {
    method: "PUT",
    redirect: "manual",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(length),
      "Content-Range": `bytes ${offset}-${offset + length - 1}/${row.file_size}`,
    },
    body: bytes,
  });
  if (uploaded.status === 200 || uploaded.status === 201) return finishVideo(env, row, uploaded);
  if (uploaded.status !== 308)
    throw new Error(`YouTube upload paused (${uploaded.status}). Retry publication to resume.`);
  return null;
}

async function processNextPublication(env, fetcher) {
  if (!configured(env)) return;
  const job = await one(
    env.DB,
    "SELECT * FROM guide_publications WHERE status = 'pending' AND lease_until < ? ORDER BY created_at LIMIT 1",
    Date.now(),
  );
  if (!job) return;
  const lease = Date.now() + 16 * 60_000;
  const claimed = await run(
    env.DB,
    "UPDATE guide_publications SET lease_until = ? WHERE id = ? AND lease_until < ? AND status = 'pending'",
    lease,
    job.id,
    Date.now(),
  );
  if (claimed.meta?.changes !== 1) return;
  try {
    const owners = (env.EDITOR_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase());
    const role = await one(
      env.DB,
      "SELECT role FROM catalog_access_roles WHERE email = ?",
      job.editor_email,
    );
    if (!owners.includes(job.editor_email.toLowerCase()) && role?.role !== "editor")
      throw new Error("Editor access was revoked before publication.");
    const item = JSON.parse(job.payload);
    // Recover a commit whose D1 response was lost before the job receipt was stored.
    const committed = await one(
      env.DB,
      `SELECT * FROM ${job.type === "tech" ? "tech_entries" : "character_notes"} WHERE id = ?`,
      item.id,
    );
    if (
      committed?.revision === job.expected_revision + 1 &&
      committed.updated_by === job.editor_email
    ) {
      const resolved = [];
      for (const video of item.videos) {
        const source = video.uploadId
          ? await one(
              env.DB,
              "SELECT youtube_video_id FROM guide_video_uploads WHERE id = ?",
              video.uploadId,
            )
          : null;
        resolved.push({
          title: video.title,
          description: video.description,
          url: video.uploadId
            ? `https://www.youtube.com/watch?v=${source?.youtube_video_id ?? ""}`
            : video.url,
        });
      }
      const expected = validateDraft(job.type, { ...item, videos: resolved });
      const actual =
        job.type === "tech"
          ? {
              id: committed.id,
              sectionId: committed.section_id,
              title: committed.title,
              description: committed.description,
              notation: committed.notation,
              videos: JSON.parse(committed.videos),
              sortOrder: committed.sort_order,
            }
          : JSON.parse(committed.payload);
      if (JSON.stringify(actual) === JSON.stringify(expected)) {
        await run(
          env.DB,
          "UPDATE guide_publications SET status = 'published', result = ?, error = '' WHERE id = ?",
          JSON.stringify({ id: item.id, revision: committed.revision, videos: resolved }),
          job.id,
        );
        return;
      }
    }
    await checkRevision(env, job.type, item, job.expected_revision);
    const videos = [];
    let token;
    let chunks = 0;
    for (const video of item.videos) {
      if (!video.uploadId) {
        videos.push(video);
        continue;
      }
      const row = await one(
        env.DB,
        "SELECT * FROM guide_video_uploads WHERE id = ? AND editor_email = ?",
        video.uploadId,
        job.editor_email,
      );
      if (!row) throw new Error("Staged video not found.");
      if (row.youtube_session && row.youtube_channel_id !== env.YOUTUBE_CHANNEL_ID)
        throw new Error("Staged video belongs to a different YouTube channel configuration.");
      let id = row.youtube_video_id;
      if (!id) {
        token ??= await googleToken(env, fetcher);
        while (!id && chunks < 8) {
          const current = chunks
            ? await one(env.DB, "SELECT * FROM guide_video_uploads WHERE id = ?", row.id)
            : row;
          id = await uploadStep(env, current, video, token, fetcher);
          chunks++;
        }
      }
      if (!id) return; // Next cron invocation resumes from YouTube's committed offset.
      videos.push({
        title: video.title,
        description: video.description,
        url: `https://www.youtube.com/watch?v=${id}`,
      });
    }
    const publishedItem = { ...item, videos };
    const path = `/v1/editor/${job.type === "tech" ? "tech-entries" : "character-notes"}/${item.id}`;
    const request = new Request(`https://internal.invalid${path}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(job.expected_revision
          ? { "If-Match": `"${job.expected_revision}"` }
          : { "If-None-Match": "*" }),
      },
      body: JSON.stringify(publishedItem),
    });
    const handler = job.type === "tech" ? handleTechRequest : handleCharacterNotesRequest;
    const response = await handler(
      request,
      env.DB,
      new URL(request.url),
      async () => job.editor_email,
    );
    if (!response.ok) throw new Error((await response.json()).error ?? "Guide publication failed.");
    const result = { id: item.id, revision: job.expected_revision + 1, videos };
    await run(
      env.DB,
      "UPDATE guide_publications SET status = 'published', result = ?, error = '' WHERE id = ?",
      JSON.stringify(result),
      job.id,
    );
  } catch (error) {
    // No credentials, upload session URLs, or Google response bodies reach editors.
    const message =
      /^(Backend YouTube|YouTube |Uploaded video|Editor access|The guide changed|This ID|Publish the category|Staged video|The staged|Guide publication failed|The record changed)/.test(
        error.message ?? "",
      )
        ? error.message
        : "Guide publication was interrupted. Retry publishing to resume; completed videos will be reused.";
    await run(
      env.DB,
      "UPDATE guide_publications SET status = 'failed', error = ? WHERE id = ?",
      message,
      job.id,
    );
  } finally {
    await run(env.DB, "UPDATE guide_publications SET lease_until = 0 WHERE id = ?", job.id);
  }
}

export async function processGuidePublications(env, fetcher = fetch) {
  if (!configured(env)) return;
  const claimed = await run(
    env.DB,
    "UPDATE guide_upload_worker_lock SET lease_until = ? WHERE id = 1 AND lease_until < ?",
    Date.now() + 16 * 60_000,
    Date.now(),
  );
  if (claimed.meta?.changes !== 1) return;
  try {
    await processNextPublication(env, (url, options) =>
      fetcher(url, { ...options, signal: AbortSignal.timeout(30_000) }),
    );
  } finally {
    await run(env.DB, "UPDATE guide_upload_worker_lock SET lease_until = 0 WHERE id = 1");
  }
}

export async function cleanGuideVideos(env) {
  if (!env.CANDIDATE_VIDEOS) return;
  const rows = await all(
    env.DB,
    `SELECT * FROM guide_video_uploads WHERE
    status != 'cleaned' AND (status = 'uploaded' OR created_at < ?)
    AND NOT EXISTS (SELECT 1 FROM guide_publications p, json_each(p.payload, '$.videos') v
      WHERE p.status IN ('pending', 'failed') AND json_extract(v.value, '$.uploadId') = guide_video_uploads.id)
    LIMIT 5`,
    new Date(Date.now() - 7 * 86400_000).toISOString(),
  );
  for (const row of rows) {
    if (row.status === "uploading") {
      try {
        await env.CANDIDATE_VIDEOS.resumeMultipartUpload(row.object_key, row.upload_id).abort();
      } catch {
        /* R2 may already have expired the multipart upload. */
      }
    }
    await env.CANDIDATE_VIDEOS.delete(row.object_key);
    // Keep uploaded IDs so future guide edits reuse the existing YouTube video.
    if (!row.youtube_video_id)
      await run(env.DB, "DELETE FROM guide_video_uploads WHERE id = ?", row.id);
    else
      await run(env.DB, "UPDATE guide_video_uploads SET status = 'cleaned' WHERE id = ?", row.id);
  }
}
