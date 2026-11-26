const slug = /^[a-z0-9][a-z0-9-]{0,99}$/;
const maxPlayerLinks = 20;
const publicHeaders = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" };
const privateHeaders = { "Cache-Control": "no-store" };

function json(value, status = 200, editor = false) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(editor ? privateHeaders : publicHeaders),
    },
  });
}

function fail(message, status, editor = false) {
  return json({ error: message }, status, editor);
}

function validId(value) {
  return typeof value === "string" && slug.test(value);
}

function field(value, name, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${name} must be nonempty text of at most ${max} characters.`);
  return value.trim();
}

export function validatePlayer(value, pathId) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a player object.");
  const allowed = ["id", "scopeKind", "subjectId", "title", "links"];
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`Unexpected field: ${key}.`);
  if (!validId(pathId) || value.id !== pathId) throw new Error("Invalid player ID.");
  if (value.scopeKind !== "character" && value.scopeKind !== "support")
    throw new Error("Choose character or support scope.");
  if (!validId(value.subjectId)) throw new Error("Invalid character or support ID.");
  const title = field(value.title, "Player name", 100);
  if (!Array.isArray(value.links) || value.links.length < 1 || value.links.length > maxPlayerLinks)
    throw new Error(`Add 1 to ${maxPlayerLinks} player links.`);
  const links = value.links.map((link) => {
    const rawUrl = field(link, "Player link", 2048);
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error("Enter a valid HTTPS player link.");
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password)
      throw new Error("Enter a valid HTTPS player link without embedded credentials.");
    const normalized = url.toString();
    if (normalized.length > 2048) throw new Error("Player links can be at most 2048 characters.");
    return normalized;
  });
  if (new Set(links).size !== links.length) throw new Error("Use a different URL for each link.");
  return {
    id: pathId,
    scopeKind: value.scopeKind,
    subjectId: value.subjectId,
    title,
    links,
  };
}

function expectedRevision(request) {
  if (request.headers.get("If-None-Match") === "*") return 0;
  const match = /^"([1-9]\d*)"$/.exec(request.headers.get("If-Match") ?? "");
  return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
}

async function list(db, search, editor) {
  const character = search.get("character");
  const support = search.get("support");
  if (character !== null && !validId(character)) throw new Error("Invalid character ID.");
  if (support !== null && !validId(support)) throw new Error("Invalid support ID.");
  const rows = await db
    .prepare(`SELECT id, scope_kind, subject_id, title, links, revision, published
    FROM catalog_players
    WHERE ((? IS NULL AND ? IS NULL) OR (scope_kind = 'character' AND subject_id = ?) OR (scope_kind = 'support' AND subject_id = ?))
    ${editor ? "" : "AND published = 1"}
    ORDER BY title COLLATE NOCASE, id LIMIT 5000`)
    .bind(character, support, character, support)
    .all();
  return {
    items: (rows.results ?? []).map((row) => ({
      id: row.id,
      scopeKind: row.scope_kind,
      subjectId: row.subject_id,
      title: row.title,
      links: JSON.parse(row.links),
      revision: row.revision,
      ...(editor ? { published: Boolean(row.published) } : {}),
    })),
  };
}

async function put(db, request, pathId, email) {
  const expected = expectedRevision(request);
  if (expected === null)
    return fail('Create with If-None-Match: * or update with If-Match: "revision".', 428, true);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? ""))
    return fail("Content-Type must be application/json.", 400, true);
  let value;
  try {
    const raw = await request.text();
    if (raw.length > 64 * 1024) throw new Error("JSON body is too large.");
    value = validatePlayer(JSON.parse(raw), pathId);
  } catch (error) {
    return fail(error instanceof SyntaxError ? "Invalid JSON body." : error.message, 400, true);
  }
  const previous = (
    await db
      .prepare("SELECT revision, scope_kind, subject_id FROM catalog_players WHERE id = ?")
      .bind(pathId)
      .all()
  ).results?.[0];
  if ((previous?.revision ?? 0) !== expected)
    return fail("The player changed. Reload before publishing.", 409, true);
  if (
    previous &&
    (previous.scope_kind !== value.scopeKind || previous.subject_id !== value.subjectId)
  )
    return fail("This ID belongs to another character or support.", 409, true);
  const result = await db
    .prepare(`INSERT INTO catalog_players
    (id, scope_kind, subject_id, title, links, revision, published, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title,
    links = excluded.links, revision = excluded.revision, published = 1,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at
    WHERE catalog_players.revision = ?`)
    .bind(
      pathId,
      value.scopeKind,
      value.subjectId,
      value.title,
      JSON.stringify(value.links),
      expected + 1,
      email,
      new Date().toISOString(),
      expected,
    )
    .run();
  if (result.meta?.changes !== 1)
    return fail("The player changed. Reload before publishing.", 409, true);
  return json({ ...value, revision: expected + 1, published: true }, expected ? 200 : 201, true);
}

async function unpublish(db, request, pathId, email) {
  const expected = expectedRevision(request);
  if (!expected) return fail('Use If-Match: "revision".', 428, true);
  const result = await db
    .prepare(`UPDATE catalog_players
    SET published = 0, revision = revision + 1, updated_by = ?, updated_at = ?
    WHERE id = ? AND revision = ? AND published = 1`)
    .bind(email, new Date().toISOString(), pathId, expected)
    .run();
  if (result.meta?.changes !== 1)
    return fail("The player changed. Reload before removing.", 409, true);
  return json({ id: pathId, revision: expected + 1, published: false }, 200, true);
}

export async function handlePlayersRequest(request, db, url, getEditor) {
  const publicRoute = url.pathname === "/v1/players";
  const editorRoute = /^\/v1\/editor\/players(?:\/([a-z0-9][a-z0-9-]{0,99}))?$/.exec(url.pathname);
  if (!publicRoute && !editorRoute) return null;
  if (publicRoute && request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: { ...publicHeaders, "Access-Control-Allow-Methods": "GET, OPTIONS" },
    });
  let email;
  if (editorRoute) {
    try {
      email = await getEditor(request);
    } catch {
      return fail("Editor authentication required.", 401, true);
    }
  }
  if (request.method === "GET" && !editorRoute?.[1]) {
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
  if (editorRoute?.[1] && request.method === "PUT") return put(db, request, editorRoute[1], email);
  if (editorRoute?.[1] && request.method === "DELETE")
    return unpublish(db, request, editorRoute[1], email);
  return fail("Method not allowed.", 405, Boolean(editorRoute));
}
