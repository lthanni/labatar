import { youtubeId } from "./tech.mjs";

const slug = /^[a-z0-9][a-z0-9-]{0,99}$/;
const kinds = new Set(["pressure", "oki", "guide"]);
const privateHeaders = { "Cache-Control": "no-store" };
const publicHeaders = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" };

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

function field(value, name, max, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim()))
    throw new Error(
      `${name} must be ${required ? "nonempty " : ""}text of at most ${max} characters.`,
    );
  return value.trim();
}

function validateScope(value, pathId, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a character note or section object.");
  const keys = ["id", "kind", "characterId", "supportId", ...allowed];
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw new Error(`Unexpected field: ${key}.`);
  if (value.id !== pathId || !validId(pathId)) throw new Error("Invalid record ID.");
  if (!kinds.has(value.kind)) throw new Error("Invalid note kind.");
  if (!validId(value.characterId) || (value.supportId !== null && !validId(value.supportId)))
    throw new Error("Invalid character or support ID.");
  return {
    id: pathId,
    kind: value.kind,
    characterId: value.characterId,
    supportId: value.supportId,
  };
}

function validateSection(value, pathId) {
  const scope = validateScope(value, pathId, ["title", "description"]);
  return {
    ...scope,
    title: field(value.title, "title", 100, true),
    description: field(value.description ?? "", "description", 500),
  };
}

export function validateCharacterNote(value, pathId) {
  const scope = validateScope(value, pathId, [
    "sectionId",
    "title",
    "setup",
    "sequence",
    "outcome",
    "notes",
    "relatedTechIds",
    "relatedComboIds",
    "videos",
  ]);
  if (value.sectionId != null && !validId(value.sectionId)) throw new Error("Invalid section ID.");
  const related = (name) => {
    const ids = value[name] ?? [];
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every(validId))
      throw new Error(`${name} must contain at most 100 valid IDs.`);
    return [...new Set(ids)];
  };
  const videos = value.videos ?? [];
  if (!Array.isArray(videos) || videos.length > 12)
    throw new Error("Use at most 12 videos per entry.");
  return {
    ...scope,
    ...(value.sectionId ? { sectionId: value.sectionId } : {}),
    title: field(value.title, "title", 160, true),
    setup: field(value.setup ?? "", "setup", 1000),
    sequence: field(value.sequence ?? "", "sequence", 3000),
    outcome: field(value.outcome ?? "", "outcome", 1000),
    notes: field(value.notes ?? "", "notes", value.kind === "guide" ? 20000 : 3000),
    relatedTechIds: related("relatedTechIds"),
    relatedComboIds: related("relatedComboIds"),
    ...(value.kind === "guide" || videos.length > 0
      ? {
          videos: videos.map((video) => {
            if (!video || typeof video !== "object" || Array.isArray(video))
              throw new Error("Invalid guide video.");
            for (const key of Object.keys(video))
              if (!["title", "description", "url"].includes(key))
                throw new Error(`Unexpected guide video field: ${key}.`);
            return {
              title: field(video.title, "video title", 160),
              description: field(video.description, "video description", 500),
              youtubeVideoId: youtubeId(video.url),
            };
          }),
        }
      : {}),
  };
}

export async function checkCharacterNoteSection(db, note) {
  if (!note.sectionId) return;
  const parent = await db
    .prepare(`SELECT id FROM character_note_sections
      WHERE id = ? AND kind = ? AND character_id = ? AND support_id IS ? AND published = 1`)
    .bind(note.sectionId, note.kind, note.characterId, note.supportId)
    .all();
  if (!parent.results?.length)
    throw new Error("Choose a published section for this note's kind and scope.");
}

function expectedRevision(request) {
  if (request.headers.get("If-None-Match") === "*") return 0;
  const match = /^"([1-9]\d*)"$/.exec(request.headers.get("If-Match") ?? "");
  return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
}

async function list(db, search, editor, table) {
  const character = search.get("character");
  const support = search.get("support");
  if (character !== null && !validId(character)) throw new Error("Invalid character ID.");
  if (support !== null && !validId(support)) throw new Error("Invalid support ID.");
  const rows = await db
    .prepare(`SELECT payload, revision, published FROM ${table}
    WHERE ((? IS NULL AND ? IS NULL) OR (character_id = ? AND (support_id IS NULL OR support_id = ?)))
    ${editor ? "" : "AND published = 1"}
    ORDER BY updated_at DESC LIMIT 5000`)
    .bind(character, support, character, support)
    .all();
  return {
    items: (rows.results ?? []).map((row) => ({
      ...JSON.parse(row.payload),
      revision: row.revision,
      ...(editor ? { published: Boolean(row.published) } : {}),
    })),
  };
}

async function put(db, request, pathId, email, section) {
  const table = section ? "character_note_sections" : "character_notes";
  const expected = expectedRevision(request);
  if (expected === null)
    return fail('Create with If-None-Match: * or update with If-Match: "revision".', 428, true);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? ""))
    return fail("Content-Type must be application/json.", 400, true);
  let value;
  try {
    const raw = await request.text();
    if (raw.length > 64 * 1024) throw new Error("JSON body is too large.");
    const body = JSON.parse(raw);
    value = section ? validateSection(body, pathId) : validateCharacterNote(body, pathId);
    if (!section) await checkCharacterNoteSection(db, value);
  } catch (error) {
    return fail(error instanceof SyntaxError ? "Invalid JSON body." : error.message, 400, true);
  }
  const previous = (
    await db
      .prepare(`SELECT revision, kind, character_id, support_id FROM ${table} WHERE id = ?`)
      .bind(pathId)
      .all()
  ).results?.[0];
  if ((previous?.revision ?? 0) !== expected)
    return fail("The record changed. Reload before publishing.", 409, true);
  if (
    previous &&
    (previous.kind !== value.kind ||
      previous.character_id !== value.characterId ||
      previous.support_id !== value.supportId)
  )
    return fail("This ID belongs to another kind, character, or support.", 409, true);
  const result = await db
    .prepare(`INSERT INTO ${table}
    (id, kind, character_id, support_id, payload, revision, published, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, revision = excluded.revision,
    published = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    WHERE ${table}.revision = ?`)
    .bind(
      pathId,
      value.kind,
      value.characterId,
      value.supportId,
      JSON.stringify(value),
      expected + 1,
      email,
      new Date().toISOString(),
      expected,
    )
    .run();
  if (result.meta?.changes !== 1)
    return fail("The record changed. Reload before publishing.", 409, true);
  return json({ ...value, revision: expected + 1, published: true }, expected ? 200 : 201, true);
}

export async function handleCharacterNotesRequest(request, db, url, getEditor) {
  const publicRoute = url.pathname === "/v1/character-notes";
  const editorRoute =
    /^\/v1\/editor\/(character-notes|character-note-sections)(?:\/([a-z0-9][a-z0-9-]{0,99}))?$/.exec(
      url.pathname,
    );
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
  const section = editorRoute?.[1] === "character-note-sections";
  if (request.method === "GET" && !editorRoute?.[2]) {
    try {
      const items = await list(
        db,
        url.searchParams,
        Boolean(editorRoute),
        section ? "character_note_sections" : "character_notes",
      );
      const sections = publicRoute
        ? (await list(db, url.searchParams, false, "character_note_sections")).items
        : undefined;
      return json({ ...items, ...(sections ? { sections } : {}) }, 200, Boolean(editorRoute));
    } catch (error) {
      return fail(error.message, 400, Boolean(editorRoute));
    }
  }
  if (editorRoute?.[2] && request.method === "PUT")
    return put(db, request, editorRoute[2], email, section);
  return fail("Method not allowed.", 405, Boolean(editorRoute));
}
