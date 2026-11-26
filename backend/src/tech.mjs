const slug = /^[a-z0-9][a-z0-9-]{0,99}$/;
const videoId = /^[A-Za-z0-9_-]{11}$/;
const publicHeaders = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" };
const privateHeaders = { "Cache-Control": "no-store" };

function json(value, status = 200, privateResponse = false) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(privateResponse ? privateHeaders : publicHeaders),
    },
  });
}

function fail(message, status, privateResponse = false) {
  return json({ error: message }, status, privateResponse);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value, keys) {
  if (!object(value)) throw new Error("Expected a JSON object.");
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw new Error(`Unexpected field: ${key}.`);
}

function id(value, field) {
  if (typeof value !== "string" || !slug.test(value))
    throw new Error(`${field} must be a lowercase slug of at most 100 characters.`);
  return value;
}

function text(value, field, max, required = false) {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim()))
    throw new Error(
      `${field} must be ${required ? "nonempty " : ""}text of at most ${max} characters.`,
    );
  return value.trim();
}

function order(value) {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > 10000)
    throw new Error("sortOrder must be an integer from 0 to 10000.");
  return value;
}

export function youtubeId(value) {
  if (typeof value !== "string") throw new Error("A YouTube URL is required.");
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Invalid YouTube URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash)
    throw new Error("Use an HTTPS YouTube URL.");
  let result = null;
  if (["youtu.be", "www.youtu.be"].includes(url.hostname))
    result = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
  else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname))
    result =
      url.pathname === "/watch"
        ? url.searchParams.get("v")
        : /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
  if (!videoId.test(result ?? "")) throw new Error("Link to a single YouTube video.");
  return result;
}

export function validateTechSection(value, pathId) {
  exact(value, ["id", "scopeKind", "subjectId", "title", "description", "sortOrder"]);
  if (id(value.id, "id") !== pathId) throw new Error("Body and path IDs differ.");
  if (!["character", "support"].includes(value.scopeKind))
    throw new Error("Choose character or support scope.");
  return {
    id: pathId,
    scopeKind: value.scopeKind,
    subjectId: id(value.subjectId, "subjectId"),
    title: text(value.title, "title", 100, true),
    description: text(value.description ?? "", "description", 500),
    sortOrder: order(value.sortOrder),
  };
}

export function validateTechEntry(value, pathId) {
  exact(value, ["id", "sectionId", "title", "description", "notation", "videos", "sortOrder"]);
  if (id(value.id, "id") !== pathId) throw new Error("Body and path IDs differ.");
  if (!Array.isArray(value.videos) || value.videos.length > 12)
    throw new Error("Use at most 12 YouTube videos.");
  return {
    id: pathId,
    sectionId: id(value.sectionId, "sectionId"),
    title: text(value.title, "title", 160, true),
    description: text(value.description ?? "", "description", 1200),
    notation: text(value.notation ?? "", "notation", 500),
    videos: value.videos.map((video) => {
      exact(video, ["title", "description", "url"]);
      return {
        title: text(video.title, "video title", 160),
        description: text(video.description, "video description", 500),
        youtubeVideoId: youtubeId(video.url),
      };
    }),
    sortOrder: order(value.sortOrder),
  };
}

function section(row, editor) {
  return {
    id: row.id,
    scopeKind: row.scope_kind,
    subjectId: row.subject_id,
    title: row.title,
    description: row.description,
    sortOrder: row.sort_order,
    revision: row.revision,
    ...(editor ? { published: Boolean(row.published) } : {}),
  };
}

function entry(row, editor) {
  return {
    id: row.id,
    sectionId: row.section_id,
    title: row.title,
    description: row.description,
    notation: row.notation,
    videos: JSON.parse(row.videos),
    sortOrder: row.sort_order,
    revision: row.revision,
    ...(editor ? { published: Boolean(row.published) } : {}),
  };
}

async function list(db, search, editor) {
  const character = search.get("character");
  const support = search.get("support");
  if (character !== null) id(character, "character");
  if (support !== null) id(support, "support");
  const clauses = editor ? "" : "AND s.published = 1";
  const sections = await db
    .prepare(`
    SELECT s.* FROM tech_sections s
    WHERE ((? IS NULL AND ? IS NULL) OR (s.scope_kind = 'character' AND s.subject_id = ?) OR (s.scope_kind = 'support' AND s.subject_id = ?))
      ${clauses}
    ORDER BY s.sort_order, s.title, s.id LIMIT 5000
  `)
    .bind(character, support, character, support)
    .all();
  const entries = await db
    .prepare(`
    SELECT e.* FROM tech_entries e JOIN tech_sections s ON s.id = e.section_id
    WHERE ((? IS NULL AND ? IS NULL) OR (s.scope_kind = 'character' AND s.subject_id = ?) OR (s.scope_kind = 'support' AND s.subject_id = ?))
      ${editor ? "" : "AND s.published = 1 AND e.published = 1"}
    ORDER BY e.sort_order, e.title, e.id LIMIT 5000
  `)
    .bind(character, support, character, support)
    .all();
  return {
    sections: (sections.results ?? []).map((row) => section(row, editor)),
    entries: (entries.results ?? []).map((row) => entry(row, editor)),
  };
}

function expectedRevision(request) {
  if (request.headers.get("If-None-Match") === "*") return 0;
  const match = /^"([1-9]\d*)"$/.exec(request.headers.get("If-Match") ?? "");
  return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
}

async function readBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? ""))
    throw new Error("Content-Type must be application/json.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A JSON body is required.");
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 64 * 1024) {
      await reader.cancel();
      throw new Error("JSON body is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

async function put(db, request, type, pathId, email) {
  const expected = expectedRevision(request);
  if (expected === null)
    return fail('Create with If-None-Match: * or update with If-Match: "revision".', 428, true);
  let value;
  try {
    value =
      type === "sections"
        ? validateTechSection(await readBody(request), pathId)
        : validateTechEntry(await readBody(request), pathId);
    if (type === "entries") {
      const parent = await db
        .prepare("SELECT id FROM tech_sections WHERE id = ? AND published = 1")
        .bind(value.sectionId)
        .all();
      if (!parent.results?.length)
        throw new Error("Publish the subsection before adding tech to it.");
    }
  } catch (error) {
    return fail(error.message, 400, true);
  }
  const now = new Date().toISOString();
  const existing = await db
    .prepare(`SELECT revision FROM tech_${type} WHERE id = ?`)
    .bind(pathId)
    .all();
  const current = existing.results?.[0]?.revision ?? 0;
  if (current !== expected) return fail("The record changed. Reload before saving.", 409, true);
  const result =
    type === "sections"
      ? await db
          .prepare(`INSERT INTO tech_sections (id, scope_kind, subject_id, title, description, sort_order, revision, published, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET scope_kind = excluded.scope_kind, subject_id = excluded.subject_id,
      title = excluded.title, description = excluded.description, sort_order = excluded.sort_order,
      revision = excluded.revision, published = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      WHERE tech_sections.revision = ?`)
          .bind(
            pathId,
            value.scopeKind,
            value.subjectId,
            value.title,
            value.description,
            value.sortOrder,
            expected + 1,
            email,
            now,
            expected,
          )
          .run()
      : await db
          .prepare(`INSERT INTO tech_entries (id, section_id, title, description, notation, videos, sort_order, revision, published, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET section_id = excluded.section_id, title = excluded.title,
      description = excluded.description, notation = excluded.notation, videos = excluded.videos,
      sort_order = excluded.sort_order, revision = excluded.revision, published = 1,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at
      WHERE tech_entries.revision = ?`)
          .bind(
            pathId,
            value.sectionId,
            value.title,
            value.description,
            value.notation,
            JSON.stringify(value.videos),
            value.sortOrder,
            expected + 1,
            email,
            now,
            expected,
          )
          .run();
  if (result.meta?.changes !== 1)
    return fail("The record changed. Reload before saving.", 409, true);
  return json(
    { ...value, revision: expected + 1, published: true },
    expected === 0 ? 201 : 200,
    true,
  );
}

async function unpublish(db, request, type, pathId) {
  const expected = expectedRevision(request);
  if (!expected) return fail('Use If-Match: "revision".', 428, true);
  const result = await db
    .prepare(`UPDATE tech_${type} SET published = 0, revision = revision + 1
    WHERE id = ? AND revision = ? AND published = 1`)
    .bind(pathId, expected)
    .run();
  if (result.meta?.changes !== 1)
    return fail("The record changed. Reload before saving.", 409, true);
  return json({ id: pathId, revision: expected + 1, published: false }, 200, true);
}

export async function handleTechRequest(request, db, url, getEditor) {
  const path = url.pathname;
  const publicRoute = path === "/v1/tech";
  const editorRoute =
    /^\/v1\/editor\/tech-(sections|entries)(?:\/([a-z0-9][a-z0-9-]{0,99}))?$/.exec(path);
  if (!publicRoute && !editorRoute) return null;
  if (request.method === "OPTIONS" && publicRoute)
    return new Response(null, {
      status: 204,
      headers: { ...publicHeaders, "Access-Control-Allow-Methods": "GET, OPTIONS" },
    });
  let email = null;
  if (editorRoute) {
    try {
      email = await getEditor(request);
    } catch {
      return fail("Editor authentication required.", 401, true);
    }
  }
  if (request.method === "GET" && !editorRoute?.[2]) {
    try {
      return json(
        await list(db, url.searchParams, Boolean(editorRoute)),
        200,
        Boolean(editorRoute),
      );
    } catch (error) {
      return fail(error.message, 400, Boolean(editorRoute));
    }
  }
  if (editorRoute?.[2] && request.method === "PUT")
    return put(db, request, editorRoute[1], editorRoute[2], email);
  if (editorRoute?.[2] && request.method === "DELETE")
    return unpublish(db, request, editorRoute[1], editorRoute[2]);
  return fail("Method not allowed.", 405, Boolean(editorRoute));
}
