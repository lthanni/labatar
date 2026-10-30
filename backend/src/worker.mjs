import { handleCandidateRequest, removeCandidatesForPublishedCombo } from "./candidates.mjs";
import { sendDiscordAlert } from "./discord-alerts.mjs";

const idPattern = /^[a-z0-9][a-z0-9-]{0,99}$/;
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const candidateIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const maxBodyBytes = 128 * 1024;
const frameFields = ["startup", "active", "recovery", "onBlock", "blockstun", "hitstun"];
const allowedMoveFields = new Set([
  "id",
  "characterId",
  "input",
  "label",
  "supportId",
  "resourceCosts",
  "mechanics",
  "isStanceParent",
  "isNonAttack",
  "isFlowStance",
  "flowStanceOverride",
  "flowStanceMinimumTimeToFlowCancel",
  "flowStanceMinimumTimeToFollowup",
  "flowStanceMaxDuration",
  "isCharged",
  "nonstandard",
  "nonstandardNote",
  "flowCancellable",
  "notApplicable",
  "stanceFollowupPattern",
  "dependsOnMoveId",
  "stanceMinimumDuration",
  "chargedMoveId",
  "baseMoveId",
  ...frameFields,
]);
const allowedComboFields = new Set([
  "id",
  "characterId",
  "supportId",
  "name",
  "difficulty",
  "editorPickReason",
  "editorPickContext",
  "route",
  "starterIsNonAttackStance",
  "routingMode",
  "moveIds",
  "screenPosition",
  "damage",
  "notes",
  "resourceCosts",
  "mechanics",
  "youtubeUrl",
  "youtubeVideoId",
  "startSeconds",
  "sourceCandidateId",
]);
const publicHeaders = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" };
const privateHeaders = { "Cache-Control": "no-store" };
let cachedCerts = null;

function json(value, status = 200, headers = publicHeaders) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function fail(message, status, privateResponse = false) {
  return json({ error: message }, status, privateResponse ? privateHeaders : publicHeaders);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unexpected field: ${key}.`);
  }
}

function id(value, field) {
  if (typeof value !== "string" || !idPattern.test(value)) {
    throw new Error(`${field} must be a lowercase slug of at most 100 characters.`);
  }
  return value;
}

function content(value, field, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new Error(`${field} must be nonempty text of at most ${max} characters.`);
  }
  return value.trim();
}

function optionalContent(value, field, max = 200) {
  return value === undefined || value === "" ? "" : content(value, field, max);
}

function comboDifficulty(value) {
  if (value === undefined || value === null || value === "") return null;
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("difficulty must be a whole number from 1 to 5.");
  }
  return value;
}

function resourceCosts(value) {
  if (!isObject(value)) throw new Error("resourceCosts must be an object.");
  if (Object.keys(value).length > 20) throw new Error("Too many resource costs.");
  const result = {};
  for (const [key, amount] of Object.entries(value)) {
    if (!idPattern.test(key) || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
      throw new Error("Invalid resource cost.");
    }
    result[key] = amount;
  }
  if (!Number.isFinite(result.pips) || !Number.isFinite(result.flow)) {
    throw new Error("resourceCosts must include pips and flow.");
  }
  return result;
}

function mechanics(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error("Invalid mechanics list.");
  return value.map((entry) => content(entry, "mechanic", 160));
}

function comboRouteTokenOffsets(route) {
  const tokens = [];
  let index = 0;
  while (index < route.length) {
    const character = route[index];
    if (/\s/.test(character)) index += 1;
    else if (route.startsWith("->", index)) index += 2;
    else if ([">", ",", "~", "→"].includes(character)) index += 1;
    else {
      const start = index;
      while (
        index < route.length &&
        !/\s/.test(route[index]) &&
        !route.startsWith("->", index) &&
        ![">", ",", "~", "→"].includes(route[index])
      )
        index += 1;
      tokens.push({ start, end: index });
    }
  }
  return tokens;
}

function comboNotes(value, route) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error("Invalid combo notes list.");
  const tokens = comboRouteTokenOffsets(route);
  const ids = new Set();
  const notes = value.map((entry, index) => {
    const note =
      typeof entry === "string"
        ? { id: `legacy-${index}`, text: entry, category: "general" }
        : entry;
    if (!isObject(note)) throw new Error("Invalid combo note.");
    exactFields(note, new Set(["id", "text", "category", "range"]));
    const noteId = content(note.id, "note id", 100);
    if (ids.has(noteId)) throw new Error("Combo note IDs must be distinct.");
    ids.add(noteId);
    const category = note.category ?? "general";
    if (!["general", "execution", "situational"].includes(category)) {
      throw new Error("Invalid combo note category.");
    }
    const result = { id: noteId, text: content(note.text, "note", 1000), category };
    if (note.range !== undefined) {
      if (!isObject(note.range)) throw new Error("Invalid combo note range.");
      exactFields(note.range, new Set(["startToken", "endToken", "excerpt"]));
      const { startToken, endToken, excerpt } = note.range;
      if (
        !Number.isInteger(startToken) ||
        !Number.isInteger(endToken) ||
        startToken < 0 ||
        endToken <= startToken ||
        endToken > tokens.length ||
        typeof excerpt !== "string" ||
        route.slice(tokens[startToken].start, tokens[endToken - 1].end) !== excerpt
      ) {
        throw new Error("Combo note range no longer matches the route.");
      }
      result.range = { startToken, endToken, excerpt };
    }
    return result;
  });
  const ranges = notes.filter((note) => note.range).map((note) => note.range);
  for (let index = 0; index < ranges.length; index += 1) {
    for (let other = index + 1; other < ranges.length; other += 1) {
      if (
        ranges[index].startToken < ranges[other].endToken &&
        ranges[other].startToken < ranges[index].endToken
      ) {
        throw new Error("Combo segment notes cannot overlap.");
      }
    }
  }
  return notes;
}

function routingMode(value) {
  if (value === undefined || value === "autopilot") return "autopilot";
  if (value === "unique") return "unique";
  throw new Error("Invalid routing mode.");
}

function comboScreenPosition(value) {
  if (value === undefined || value === "") return "corner";
  if (typeof value !== "string") throw new Error("Invalid screen position.");
  const position = value.trim().toLowerCase();
  if (!["corner", "midscreen", "fullscreen"].includes(position)) {
    throw new Error("Screen position must be corner, midscreen, or fullscreen.");
  }
  return position;
}

function optionalBoolean(value, field) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);
  return value;
}

function optionalId(value, field) {
  return value === undefined || value === null ? null : id(value, field);
}

function optionalNumber(value, field, min = 0) {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value) || value < min || value > 9999) {
    throw new Error(`${field} must be a number or null.`);
  }
  return value;
}

function notApplicable(value) {
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error("notApplicable must be an object.");
  const result = {};
  for (const [situation, reason] of Object.entries(value)) {
    if (!["whiff", "block", "hit-grounded", "hit-airborne", "hit"].includes(situation)) {
      throw new Error("Invalid notApplicable situation.");
    }
    result[situation] = content(reason, "notApplicable reason", 300);
  }
  return result;
}

export function youtubeVideoId(value) {
  if (typeof value !== "string") throw new Error("A YouTube video URL is required.");
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Invalid YouTube video URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    throw new Error("Use an HTTPS YouTube video URL.");
  }
  let videoId = null;
  if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
    videoId = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
  } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
    videoId =
      url.pathname === "/watch"
        ? url.searchParams.get("v")
        : /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
  }
  if (!videoIdPattern.test(videoId ?? "")) throw new Error("Link to a single YouTube video.");
  return videoId;
}

export function validateRecord(kind, value, pathId) {
  if (!isObject(value)) throw new Error("The record must be a JSON object.");
  exactFields(value, kind === "move" ? allowedMoveFields : allowedComboFields);
  if (id(value.id, "id") !== pathId) throw new Error("Body and path IDs differ.");
  const common = {
    id: pathId,
    characterId: id(value.characterId, "characterId"),
    resourceCosts: resourceCosts(value.resourceCosts),
    mechanics: mechanics(value.mechanics),
  };
  if (kind === "move") {
    if (
      value.flowStanceOverride !== undefined &&
      value.flowStanceOverride !== null &&
      typeof value.flowStanceOverride !== "boolean"
    ) {
      throw new Error("flowStanceOverride must be a boolean or null.");
    }
    if (
      value.stanceFollowupPattern !== undefined &&
      value.stanceFollowupPattern !== null &&
      value.stanceFollowupPattern !== "directional-button"
    ) {
      throw new Error("Invalid stanceFollowupPattern.");
    }
    const result = {
      ...common,
      input: content(value.input, "input", 80),
      label: optionalContent(value.label, "label", 160),
      isStanceParent: optionalBoolean(value.isStanceParent, "isStanceParent"),
      isNonAttack: optionalBoolean(value.isNonAttack, "isNonAttack"),
      isFlowStance: optionalBoolean(value.isFlowStance, "isFlowStance"),
      flowStanceOverride: value.flowStanceOverride ?? null,
      flowStanceMinimumTimeToFlowCancel: optionalNumber(
        value.flowStanceMinimumTimeToFlowCancel,
        "flowStanceMinimumTimeToFlowCancel",
      ),
      flowStanceMinimumTimeToFollowup: optionalNumber(
        value.flowStanceMinimumTimeToFollowup,
        "flowStanceMinimumTimeToFollowup",
      ),
      flowStanceMaxDuration: optionalNumber(value.flowStanceMaxDuration, "flowStanceMaxDuration"),
      isCharged: optionalBoolean(value.isCharged, "isCharged"),
      nonstandard: optionalBoolean(value.nonstandard, "nonstandard"),
      nonstandardNote: optionalContent(value.nonstandardNote, "nonstandardNote", 500),
      flowCancellable: optionalBoolean(value.flowCancellable, "flowCancellable"),
      notApplicable: notApplicable(value.notApplicable),
      stanceFollowupPattern: value.stanceFollowupPattern ?? null,
      dependsOnMoveId: optionalId(value.dependsOnMoveId, "dependsOnMoveId"),
      stanceMinimumDuration: optionalNumber(value.stanceMinimumDuration, "stanceMinimumDuration"),
      chargedMoveId: optionalId(value.chargedMoveId, "chargedMoveId"),
      baseMoveId: optionalId(value.baseMoveId, "baseMoveId"),
    };
    if (value.supportId !== undefined) result.supportId = id(value.supportId, "supportId");
    for (const field of frameFields) {
      result[field] = optionalNumber(value[field], field, field === "onBlock" ? -9999 : 0);
    }
    return result;
  }
  const videoId =
    value.youtubeUrl === undefined ? value.youtubeVideoId : youtubeVideoId(value.youtubeUrl);
  if (
    !videoIdPattern.test(videoId ?? "") ||
    (value.youtubeVideoId !== undefined && value.youtubeVideoId !== videoId)
  ) {
    throw new Error("A valid YouTube video ID is required.");
  }
  if (!Array.isArray(value.moveIds) || value.moveIds.length > 100) {
    throw new Error("moveIds must be a list of at most 100 move IDs.");
  }
  const startSeconds = value.startSeconds ?? 0;
  if (!Number.isInteger(startSeconds) || startSeconds < 0 || startSeconds > 86_400) {
    throw new Error("startSeconds must be between 0 and 86400.");
  }
  const route = content(value.route, "route", 2000);
  if (value.sourceCandidateId !== undefined && !candidateIdPattern.test(value.sourceCandidateId)) {
    throw new Error("sourceCandidateId must be a candidate UUID.");
  }
  return {
    ...common,
    supportId: id(value.supportId, "supportId"),
    name: optionalContent(value.name, "name", 160),
    difficulty: comboDifficulty(value.difficulty),
    editorPickReason: optionalContent(value.editorPickReason, "editorPickReason", 1000),
    editorPickContext: optionalContent(value.editorPickContext, "editorPickContext", 160),
    route,
    starterIsNonAttackStance: optionalBoolean(
      value.starterIsNonAttackStance,
      "starterIsNonAttackStance",
    ),
    routingMode: routingMode(value.routingMode),
    moveIds: value.moveIds.map((item) => id(item, "moveId")),
    screenPosition: comboScreenPosition(value.screenPosition),
    damage: content(value.damage, "damage", 100),
    notes: comboNotes(value.notes, route),
    youtubeVideoId: videoId,
    startSeconds,
    ...(value.sourceCandidateId ? { sourceCandidateId: value.sourceCandidateId } : {}),
  };
}

async function readJsonBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? "")) {
    throw new Error("Content-Type must be application/json.");
  }
  const length = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(length) && length > maxBodyBytes) throw new Error("JSON body is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A JSON body is required.");
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodyBytes) {
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

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("Invalid token.");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function accessCerts(team, fetcher, refresh = false) {
  const now = Date.now();
  if (!refresh && cachedCerts?.team === team && cachedCerts.until > now) return cachedCerts.keys;
  const response = await fetcher(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("Could not load Cloudflare Access signing keys.");
  const data = await response.json();
  if (!Array.isArray(data.keys)) throw new Error("Invalid Cloudflare Access signing keys.");
  cachedCerts = { team, keys: data.keys, until: now + 5 * 60_000 };
  return data.keys;
}

export async function verifyAccessJwt(token, env, fetcher = fetch) {
  const team = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  if (!/^[a-z0-9-]+$/.test(team ?? "") || !audience || !token || token.length > 8192)
    throw new Error("Editor access is unavailable.");
  const pieces = token.split(".");
  if (pieces.length !== 3) throw new Error("Invalid Access token.");
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(pieces[0])));
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(pieces[1])));
  } catch {
    throw new Error("Invalid Access token.");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Unsupported Access token.");
  }
  let keys = await accessCerts(team, fetcher);
  let jwk = keys.find((entry) => entry.kid === header.kid && entry.kty === "RSA");
  if (!jwk) {
    keys = await accessCerts(team, fetcher, true);
    jwk = keys.find((entry) => entry.kid === header.kid && entry.kty === "RSA");
  }
  if (!jwk) throw new Error("Unknown Access signing key.");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(pieces[2]),
    new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`),
  );
  const now = Math.floor(Date.now() / 1000);
  if (
    !valid ||
    claims.iss !== `https://${team}.cloudflareaccess.com` ||
    !(Array.isArray(claims.aud) ? claims.aud.includes(audience) : claims.aud === audience) ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= now ||
    (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now)) ||
    (claims.iat !== undefined && (!Number.isFinite(claims.iat) || claims.iat > now + 60)) ||
    typeof claims.email !== "string"
  ) {
    throw new Error("Invalid Access token claims.");
  }
  return claims.email.toLowerCase();
}

export async function authorizeEditor(request, env, fetcher = fetch) {
  const email = await verifyAccessJwt(request.headers.get("Cf-Access-Jwt-Assertion"), env, fetcher);
  if (!(ownerEmails(env).includes(email) || (await accessRole(env.DB, email)) === "editor")) {
    throw new Error("This account is not an approved editor.");
  }
  return email;
}

export async function authorizeComboPreview(request, env, fetcher = fetch) {
  const email = await verifyAccessJwt(request.headers.get("Cf-Access-Jwt-Assertion"), env, fetcher);
  if (!(ownerEmails(env).includes(email) || (await accessRole(env.DB, email))))
    throw new Error("Combos preview access is unavailable.");
  return email;
}

export async function authorizeComboUpload(request, env, fetcher = fetch) {
  const email = await verifyAccessJwt(request.headers.get("Cf-Access-Jwt-Assertion"), env, fetcher);
  if (!(ownerEmails(env).includes(email) || (await accessRole(env.DB, email))))
    throw new Error("This account cannot submit combo videos.");
  return email;
}

function ownerEmails(env) {
  return (env.EDITOR_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function accessRole(db, email) {
  if (!db) throw new Error("Access roles are unavailable.");
  const { results } = await db
    .prepare("SELECT role FROM catalog_access_roles WHERE email = ?")
    .bind(email)
    .all();
  return results[0]?.role ?? null;
}

async function hasYouTubeUploadAccess(db, email) {
  if (!db) throw new Error("YouTube upload access is unavailable.");
  const { results } = await db
    .prepare("SELECT email FROM catalog_youtube_upload_access WHERE email = ?")
    .bind(email)
    .all();
  return results.length > 0;
}

export async function authorizeAccessAdmin(request, env, fetcher = fetch) {
  const email = await verifyAccessJwt(request.headers.get("Cf-Access-Jwt-Assertion"), env, fetcher);
  if (!ownerEmails(env).includes(email)) throw new AccessAdminDenied(email);
  return email;
}

class AccessAdminDenied extends Error {
  constructor(email) {
    super(`Signed in as ${email}, but this account is not an access administrator.`);
  }
}

function accessAdminFailure(error) {
  return fail(
    error instanceof AccessAdminDenied
      ? error.message
      : "Could not verify the Cloudflare Access session.",
    403,
    true,
  );
}

function accessEmail(value) {
  if (typeof value !== "string") throw new Error("Enter an email address.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Enter a valid email address.");
  return email;
}

function checkAdminMutation(request) {
  if (request.headers.get("X-Labatar-Admin") !== "1")
    throw new Error("Admin request header is required.");
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new Error("Admin request origin is invalid.");
}

async function handleAccessRoles(request, env, adminEmail) {
  if (request.method === "GET") {
    const { results: roles } = await env.DB.prepare(
      "SELECT email, role, updated_at AS updatedAt, updated_by AS updatedBy FROM catalog_access_roles ORDER BY email",
    ).all();
    const { results: youtube } = await env.DB.prepare(
      "SELECT email FROM catalog_youtube_upload_access ORDER BY email",
    ).all();
    const items = new Map(roles.map((entry) => [entry.email, { ...entry, youtubeUpload: false }]));
    for (const { email } of youtube) {
      const entry = items.get(email);
      if (entry) entry.youtubeUpload = true;
      else items.set(email, { email, role: "none", youtubeUpload: true });
    }
    return json(
      {
        owner: adminEmail,
        items: [...items.values()].sort((a, b) => a.email.localeCompare(b.email)),
      },
      200,
      privateHeaders,
    );
  }
  try {
    checkAdminMutation(request);
    const body = await readJsonBody(request);
    if (!isObject(body)) throw new Error("JSON body must be an object.");
    exactFields(
      body,
      new Set(request.method === "PUT" ? ["email", "role", "youtubeUpload"] : ["email"]),
    );
    const email = accessEmail(body.email);
    if (ownerEmails(env).includes(email)) throw new Error("Owner access is managed separately.");
    if (request.method === "PUT") {
      if (!["none", "viewer", "editor"].includes(body.role))
        throw new Error("Role must be none, viewer, or editor.");
      if (body.youtubeUpload !== undefined && typeof body.youtubeUpload !== "boolean")
        throw new Error("YouTube upload permission must be true or false.");
      if (body.role === "none" && body.youtubeUpload !== true)
        throw new Error("Choose at least one permission, or remove the person.");
      const now = new Date().toISOString();
      const statements = [];
      if (body.role === "none") {
        statements.push(
          env.DB.prepare("DELETE FROM catalog_access_roles WHERE email = ?").bind(email),
        );
      } else {
        statements.push(
          env.DB.prepare(`
        INSERT INTO catalog_access_roles (email, role, updated_at, updated_by)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          role = excluded.role,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).bind(email, body.role, now, adminEmail),
        );
      }
      if (body.youtubeUpload === true) {
        statements.push(
          env.DB.prepare(`
          INSERT INTO catalog_youtube_upload_access (email, updated_at, updated_by)
          VALUES (?, ?, ?)
          ON CONFLICT(email) DO UPDATE SET
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        `).bind(email, now, adminEmail),
        );
      } else if (body.youtubeUpload === false) {
        statements.push(
          env.DB.prepare("DELETE FROM catalog_youtube_upload_access WHERE email = ?").bind(email),
        );
      }
      await env.DB.batch(statements);
      return json(
        { email, role: body.role, youtubeUpload: body.youtubeUpload },
        200,
        privateHeaders,
      );
    }
    if (request.method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM catalog_access_roles WHERE email = ?").bind(email),
        env.DB.prepare("DELETE FROM catalog_youtube_upload_access WHERE email = ?").bind(email),
      ]);
      return json({ removed: email }, 200, privateHeaders);
    }
  } catch (error) {
    return fail(error.message, 400, true);
  }
  return fail("Method not allowed.", 405, true);
}

async function listRecords(db, kind, search, editor = false) {
  const character = search.get("character");
  const support = search.get("support");
  if (character !== null) id(character, "character");
  if (support !== null) id(support, "support");
  const result = await db
    .prepare(`
    SELECT v.payload, v.revision, v.created_at, v.editor_email, v.published
    FROM catalog_versions AS v
    WHERE v.kind = ? AND (? IS NULL OR v.character_id = ?)
      AND (? IS NULL OR v.support_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM catalog_versions AS newer
        WHERE newer.kind = v.kind AND newer.id = v.id AND newer.revision > v.revision
      )
      AND (? = 1 OR v.published = 1)
    ORDER BY v.character_id, v.id LIMIT 5000
  `)
    .bind(kind, character, character, support, support, editor ? 1 : 0)
    .all();
  return (result.results ?? []).map((row) => ({
    ...JSON.parse(row.payload),
    revision: row.revision,
    updatedAt: row.created_at,
    ...(editor ? { updatedBy: row.editor_email, published: Boolean(row.published) } : {}),
  }));
}

function expectedRevision(request) {
  if (request.headers.get("If-None-Match") === "*") return 0;
  const match = /^"([1-9]\d*)"$/.exec(request.headers.get("If-Match") ?? "");
  if (!match || !Number.isSafeInteger(Number(match[1]))) return null;
  return Number(match[1]);
}

async function putRecord(request, env, kind, pathId, email) {
  const expected = expectedRevision(request);
  if (expected === null)
    return fail('Create with If-None-Match: * or update with If-Match: "revision".', 428, true);
  let record;
  try {
    const body = await readJsonBody(request);
    if (kind === "combo" && expected > 0 && isObject(body)) {
      const previous = await env.DB.prepare(
        "SELECT payload FROM catalog_versions WHERE kind = ? AND id = ? AND revision = ?",
      )
        .bind(kind, pathId, expected)
        .all();
      const sourceCandidateId = JSON.parse(
        previous.results?.[0]?.payload ?? "{}",
      ).sourceCandidateId;
      if (sourceCandidateId) {
        if (body.sourceCandidateId && body.sourceCandidateId !== sourceCandidateId) {
          throw new Error("A catalog combo's sourceCandidateId cannot change between revisions.");
        }
        body.sourceCandidateId = sourceCandidateId;
      }
    }
    record = validateRecord(kind, body, pathId);
  } catch (error) {
    return fail(error.message, 400, true);
  }
  const revision = expected + 1;
  const updatedAt = new Date().toISOString();
  const result = await env.DB.prepare(`
    INSERT INTO catalog_versions
      (kind, id, revision, character_id, support_id, payload, published, editor_email, created_at)
    SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?
    WHERE COALESCE((SELECT MAX(revision) FROM catalog_versions WHERE kind = ? AND id = ?), 0) = ?
  `)
    .bind(
      kind,
      pathId,
      revision,
      record.characterId,
      record.supportId ?? null,
      JSON.stringify(record),
      email,
      updatedAt,
      kind,
      pathId,
      expected,
    )
    .run();
  if (result.meta?.changes !== 1)
    return fail("The record changed. Reload before saving.", 409, true);
  if (kind === "combo") {
    try {
      await removeCandidatesForPublishedCombo(env, record);
    } catch (error) {
      console.error("Could not remove published combo candidate", error);
    }
  }
  return json(
    { ...record, revision, updatedAt, updatedBy: email, published: true },
    expected === 0 ? 201 : 200,
    privateHeaders,
  );
}

async function unpublishRecord(env, kind, pathId, expected, email) {
  if (expected === null || expected === 0) return fail('Use If-Match: "revision".', 428, true);
  const result = await env.DB.prepare(`
    INSERT INTO catalog_versions
      (kind, id, revision, character_id, support_id, payload, published, editor_email, created_at)
    SELECT kind, id, revision + 1, character_id, support_id, payload, 0, ?, ?
    FROM catalog_versions WHERE kind = ? AND id = ? AND revision = ? AND published = 1
      AND revision = (SELECT MAX(revision) FROM catalog_versions WHERE kind = ? AND id = ?)
  `)
    .bind(email, new Date().toISOString(), kind, pathId, expected, kind, pathId)
    .run();
  if (result.meta?.changes !== 1)
    return fail("The record changed. Reload before saving.", 409, true);
  return json({ id: pathId, revision: expected + 1, published: false }, 200, privateHeaders);
}

export async function handleRequest(
  request,
  env,
  context,
  getEditor = authorizeEditor,
  getComboPreview = authorizeComboPreview,
  getAccessAdmin = authorizeAccessAdmin,
  getComboUpload = authorizeComboUpload,
  fetchDiscord = fetch,
  getAccessIdentity = (request, env) =>
    verifyAccessJwt(request.headers.get("Cf-Access-Jwt-Assertion"), env),
) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "OPTIONS" && /^\/v1\/(?:moves|combos)$/.test(path)) {
    return new Response(null, {
      status: 204,
      headers: {
        ...publicHeaders,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }
  if (!env.DB) return fail("Database binding is unavailable.", 503);
  const candidateResponse = await handleCandidateRequest(
    request,
    env,
    getEditor,
    getComboUpload,
    validateRecord,
    youtubeVideoId,
    context,
    fetchDiscord,
  );
  if (candidateResponse) return candidateResponse;
  if (path === "/v1/editor/upload-access-request") {
    if (request.method !== "POST") return fail("Method not allowed.", 405, true);
    if (request.headers.get("X-Labatar-Access-Request") !== "1")
      return fail("Access request header is required.", 400, true);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin)
      return fail("Access request origin is invalid.", 400, true);
    let email;
    try {
      email = accessEmail(await getAccessIdentity(request, env));
    } catch {
      return fail("Sign in to request combo upload access.", 401, true);
    }
    try {
      if (ownerEmails(env).includes(email) || (await accessRole(env.DB, email)))
        return fail("This account already has combo upload access.", 409, true);
      if (!env.DISCORD_ALERT_WEBHOOK_URL)
        return fail("Upload access requests are unavailable right now.", 503, true);
      const now = new Date().toISOString();
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const requestId = crypto.randomUUID();
      const claimed = await env.DB.prepare(`
        INSERT INTO catalog_upload_access_requests (email, request_id, requested_at)
        VALUES (?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          request_id = excluded.request_id,
          requested_at = excluded.requested_at
        WHERE catalog_upload_access_requests.requested_at <= ?
      `)
        .bind(email, requestId, now, cutoff)
        .run();
      if (claimed.meta?.changes !== 1)
        return json({ sent: false, alreadyRequested: true }, 200, privateHeaders);
      try {
        await sendDiscordAlert(
          env,
          `Labatar combo upload access requested\nEmail: ${email}\nAdd this email as a Combo uploader at /v1/editor/access.`,
          fetchDiscord,
        );
      } catch (error) {
        await env.DB.prepare(
          "DELETE FROM catalog_upload_access_requests WHERE email = ? AND request_id = ?",
        )
          .bind(email, requestId)
          .run();
        return fail(error.message, 502, true);
      }
      return json({ sent: true, alreadyRequested: false }, 200, privateHeaders);
    } catch {
      return fail("Upload access requests are unavailable right now.", 503, true);
    }
  }
  if (request.method === "GET" && path === "/health") {
    return json({
      ok: true,
      features: { comboNotes: true, comboCandidates: Boolean(env.CANDIDATE_VIDEOS) },
    });
  }
  if (path === "/v1/editor/combo-preview") {
    if (request.method !== "GET") return fail("Method not allowed.", 405, true);
    try {
      await getComboPreview(request, env);
    } catch {
      return fail("Combos preview access required.", 403, true);
    }
    return json({ allowed: true }, 200, privateHeaders);
  }
  if (path === "/v1/editor/youtube-upload-access") {
    if (request.method !== "GET") return fail("Method not allowed.", 405, true);
    let email;
    try {
      email = accessEmail(await getAccessIdentity(request, env));
    } catch {
      return fail("Sign in to check YouTube upload access.", 401, true);
    }
    try {
      if (!(ownerEmails(env).includes(email) || (await hasYouTubeUploadAccess(env.DB, email))))
        return fail("This account does not have YouTube upload access.", 403, true);
    } catch {
      return fail("YouTube upload access is unavailable.", 503, true);
    }
    return json({ allowed: true }, 200, privateHeaders);
  }
  if (path === "/v1/editor/access-roles") {
    let adminEmail;
    try {
      adminEmail = await getAccessAdmin(request, env);
    } catch (error) {
      return accessAdminFailure(error);
    }
    if (!["GET", "PUT", "DELETE"].includes(request.method))
      return fail("Method not allowed.", 405, true);
    try {
      return await handleAccessRoles(request, env, adminEmail);
    } catch {
      return fail("Access roles are unavailable.", 503, true);
    }
  }
  if (path === "/v1/editor/discord-alert-test") {
    try {
      await getAccessAdmin(request, env);
    } catch (error) {
      return accessAdminFailure(error);
    }
    if (request.method !== "POST") return fail("Method not allowed.", 405, true);
    try {
      checkAdminMutation(request);
    } catch (error) {
      return fail(error.message, 400, true);
    }
    try {
      await sendDiscordAlert(
        env,
        "Labatar test alert: Discord notifications are working.",
        fetchDiscord,
      );
      return json({ sent: true }, 200, privateHeaders);
    } catch (error) {
      return fail(error.message, env.DISCORD_ALERT_WEBHOOK_URL ? 502 : 503, true);
    }
  }
  if (request.method === "GET" && /^\/v1\/editor\/access(?:\.(?:js|css))?$/.test(path)) {
    try {
      await getAccessAdmin(request, env);
    } catch (error) {
      return accessAdminFailure(error);
    }
    if (!env.ASSETS) return fail("Admin assets are unavailable.", 503, true);
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    if (path === "/v1/editor/access") {
      headers.set(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
    }
    return new Response(asset.body, { status: asset.status, headers });
  }
  if (request.method === "GET" && /^\/v1\/editor\/app(?:\.(?:js|css))?$/.test(path)) {
    try {
      await getEditor(request, env);
    } catch {
      return fail("Editor authentication required.", 401, true);
    }
    if (!env.ASSETS) return fail("Editor assets are unavailable.", 503, true);
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    if (path === "/v1/editor/app") {
      headers.set(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src blob:; frame-src https://www.youtube-nocookie.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
    }
    return new Response(asset.body, { status: asset.status, headers });
  }
  const editorRoute = /^\/v1\/editor\/(moves|combos)(?:\/([a-z0-9][a-z0-9-]{0,99}))?$/.exec(path);
  const publicRoute = /^\/v1\/(moves|combos)$/.exec(path);
  if (!editorRoute && !publicRoute) return fail("Not found.", 404);
  const kind = (editorRoute ?? publicRoute)[1] === "moves" ? "move" : "combo";
  if (editorRoute) {
    let email;
    try {
      email = await getEditor(request, env);
    } catch {
      return fail("Editor authentication required.", 401, true);
    }
    if (request.method === "GET" && !editorRoute[2]) {
      try {
        return json(
          { items: await listRecords(env.DB, kind, url.searchParams, true) },
          200,
          privateHeaders,
        );
      } catch (error) {
        return fail(error.message, 400, true);
      }
    }
    if (request.method === "PUT" && editorRoute[2]) {
      return putRecord(request, env, kind, editorRoute[2], email);
    }
    if (request.method === "DELETE" && editorRoute[2]) {
      return unpublishRecord(env, kind, editorRoute[2], expectedRevision(request), email);
    }
    return fail("Method not allowed.", 405, true);
  }
  if (request.method !== "GET") return fail("Method not allowed.", 405);
  try {
    return json({ items: await listRecords(env.DB, kind, url.searchParams) });
  } catch (error) {
    return fail(error.message, 400);
  }
}

export default { fetch: handleRequest };
