const draftKey = "labatar-combo-publisher-draft-v1";
const slugPattern = /^[a-z0-9][a-z0-9-]{0,99}$/;
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const fieldIds = [
  "combo-id",
  "character-id",
  "support-id",
  "combo-name",
  "difficulty",
  "editor-pick-reason",
  "editor-pick-context",
  "route",
  "routing-mode",
  "screen-position",
  "damage",
  "start-seconds",
  "pips",
  "flow",
  "other-costs",
  "mechanics",
  "notes",
  "move-ids",
  "youtube-url",
];
const field = (id) => document.getElementById(id);
const fields = Object.fromEntries(fieldIds.map((id) => [id, field(id)]));
let records = [];
let revision = null;
let published = false;
let localVideoUrl = null;

function setStatus(message, isError = false) {
  const status = field("status");
  status.textContent = message;
  status.className = isError ? "error" : "muted";
}

function youtubeVideoId(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash)
    return null;
  let id = null;
  if (["youtu.be", "www.youtu.be"].includes(url.hostname)) {
    id = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
  } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
    id =
      url.pathname === "/watch"
        ? url.searchParams.get("v")
        : /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
  }
  return videoIdPattern.test(id ?? "") ? id : null;
}

function lines(id) {
  return fields[id].value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function number(id) {
  const value = Number(fields[id].value);
  if (!fields[id].value.trim() || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new Error(`${id} must be a nonnegative number up to 1000000.`);
  }
  return value;
}

function payload() {
  const id = fields["combo-id"].value.trim();
  const characterId = fields["character-id"].value.trim();
  const supportId = fields["support-id"].value.trim();
  for (const [name, value] of Object.entries({ id, characterId, supportId })) {
    if (!slugPattern.test(value))
      throw new Error(`${name} must be a lowercase slug of at most 100 characters.`);
  }
  const route = fields.route.value.trim();
  const name = fields["combo-name"].value.trim();
  const difficultyValue = fields.difficulty.value;
  const difficulty = difficultyValue ? Number(difficultyValue) : null;
  const editorPickReason = fields["editor-pick-reason"].value.trim();
  const editorPickContext = fields["editor-pick-context"].value.trim();
  if (name.length > 160) throw new Error("Combo name must be at most 160 characters.");
  if (difficulty !== null && (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5)) {
    throw new Error("Difficulty must be a whole number from 1 to 5.");
  }
  if (editorPickReason.length > 1000 || editorPickContext.length > 160) {
    throw new Error("Editor pick reason or context is too long.");
  }
  const routingMode = fields["routing-mode"].value;
  if (!["autopilot", "unique"].includes(routingMode)) throw new Error("Select a routing mode.");
  const damage = fields.damage.value.trim();
  const screenPosition = fields["screen-position"].value.trim();
  if (!route || route.length > 2000) throw new Error("Enter a route of at most 2000 characters.");
  if (!damage || damage.length > 100) throw new Error("Enter damage of at most 100 characters.");
  if (screenPosition.length > 100) throw new Error("Screen position is too long.");
  const moveIds = lines("move-ids");
  if (moveIds.length > 100 || !moveIds.every((moveId) => slugPattern.test(moveId))) {
    throw new Error("Move IDs must be lowercase slugs, at most 100 entries.");
  }
  const mechanics = lines("mechanics");
  if (mechanics.length > 20 || mechanics.some((item) => item.length > 160)) {
    throw new Error("Use at most 20 mechanics, each under 160 characters.");
  }
  let notes;
  try {
    notes = JSON.parse(fields.notes.value.trim() || "[]");
  } catch {
    throw new Error("Notes must be a JSON array of strings or note objects.");
  }
  if (
    !Array.isArray(notes) ||
    notes.length > 20 ||
    notes.some((note) => {
      const text = typeof note === "string" ? note : note?.text;
      return typeof text !== "string" || !text.trim() || text.trim().length > 1000;
    })
  ) {
    throw new Error("Use at most 20 nonempty notes, each under 1000 characters.");
  }
  let otherCosts = {};
  if (fields["other-costs"].value.trim()) {
    try {
      otherCosts = JSON.parse(fields["other-costs"].value);
    } catch {
      throw new Error("Other costs must be a JSON object.");
    }
    if (!otherCosts || typeof otherCosts !== "object" || Array.isArray(otherCosts)) {
      throw new Error("Other costs must be a JSON object.");
    }
  }
  for (const [key, amount] of Object.entries(otherCosts)) {
    if (
      !slugPattern.test(key) ||
      key === "pips" ||
      key === "flow" ||
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 1_000_000
    ) {
      throw new Error("Other costs need slug keys and nonnegative numeric amounts.");
    }
  }
  if (Object.keys(otherCosts).length > 18) throw new Error("Use at most 18 other costs.");
  const youtubeUrl = fields["youtube-url"].value.trim();
  if (!youtubeVideoId(youtubeUrl)) throw new Error("Enter a single HTTPS YouTube video URL.");
  const startSeconds = Number(fields["start-seconds"].value);
  if (
    !fields["start-seconds"].value.trim() ||
    !Number.isInteger(startSeconds) ||
    startSeconds < 0 ||
    startSeconds > 86_400
  ) {
    throw new Error("Start time must be a whole number from 0 to 86400.");
  }
  return {
    id,
    characterId,
    supportId,
    name,
    difficulty,
    editorPickReason,
    editorPickContext,
    route,
    routingMode,
    moveIds,
    screenPosition,
    damage,
    resourceCosts: { pips: number("pips"), flow: number("flow"), ...otherCosts },
    mechanics,
    notes: notes.map((note) => (typeof note === "string" ? note.trim() : note)),
    youtubeUrl,
    startSeconds,
  };
}

function saveDraft() {
  try {
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        values: Object.fromEntries(fieldIds.map((id) => [id, fields[id].value])),
        revision,
        published,
      }),
    );
  } catch {
    setStatus("Browser draft storage is unavailable. Keep this page open until you publish.", true);
  }
}

function renderPreview() {
  const warning = field("validation");
  try {
    const record = payload();
    field("payload-preview").textContent = JSON.stringify(record, null, 2);
    warning.hidden = true;
    warning.textContent = "";
    field("publish").disabled = false;
  } catch (error) {
    field("payload-preview").textContent = "Complete the form to preview the published record.";
    warning.textContent = error.message;
    warning.hidden = false;
    field("publish").disabled = true;
  }
  const videoId = youtubeVideoId(fields["youtube-url"].value);
  const frame = field("youtube-preview");
  const embedUrl = videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : "";
  if (videoId && frame.getAttribute("src") !== embedUrl) frame.src = embedUrl;
  if (!videoId) frame.removeAttribute("src");
  frame.hidden = !videoId;
}

function setValues(values) {
  for (const id of fieldIds)
    fields[id].value = values[id] ?? (id === "routing-mode" ? "autopilot" : "");
  renderPreview();
  saveDraft();
}

function loadRecord(record) {
  revision = record.revision ?? null;
  published = Boolean(record.published);
  const otherCosts = Object.fromEntries(
    Object.entries(record.resourceCosts ?? {}).filter(([key]) => key !== "pips" && key !== "flow"),
  );
  setValues({
    "combo-id": record.id,
    "character-id": record.characterId,
    "support-id": record.supportId,
    "combo-name": record.name ?? "",
    difficulty: String(record.difficulty ?? ""),
    "editor-pick-reason": record.editorPickReason ?? "",
    "editor-pick-context": record.editorPickContext ?? "",
    route: record.route,
    "routing-mode": record.routingMode ?? "autopilot",
    "screen-position": record.screenPosition ?? "",
    damage: record.damage,
    "start-seconds": String(record.startSeconds ?? 0),
    pips: String(record.resourceCosts?.pips ?? 0),
    flow: String(record.resourceCosts?.flow ?? 0),
    "other-costs": Object.keys(otherCosts).length ? JSON.stringify(otherCosts) : "",
    mechanics: (record.mechanics ?? []).join("\n"),
    notes: JSON.stringify(record.notes ?? [], null, 2),
    "move-ids": (record.moveIds ?? []).join("\n"),
    "youtube-url":
      record.youtubeUrl ??
      (record.youtubeVideoId ? `https://www.youtube.com/watch?v=${record.youtubeVideoId}` : ""),
  });
  fields["combo-id"].readOnly = revision !== null;
  field("revision").textContent =
    revision === null
      ? "New record"
      : `Revision ${revision} · ${published ? "published" : "unpublished"}`;
  field("publish").textContent = revision === null ? "Publish combo" : "Save and publish";
  field("unpublish").hidden = revision === null || !published;
}

function newCombo() {
  if (fields.route.value.trim() && !confirm("Replace the current browser draft with a new combo?"))
    return;
  loadRecord({ resourceCosts: { pips: 0, flow: 0 }, startSeconds: 0 });
  field("import-warning").hidden = true;
  setStatus("New combo draft ready.");
}

async function readResponse(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      body?.error ??
        `Request failed (${response.status}). Reload to sign in again if your session expired.`,
    );
  return body;
}

async function loadList(quiet = false) {
  try {
    const result = await readResponse(
      await fetch("/v1/editor/combos", {
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    records = result.items;
    const select = field("existing");
    const selected = select.value;
    select.replaceChildren(new Option("Choose a combo", ""));
    for (const record of records) {
      select.add(
        new Option(
          `${record.characterId} / ${record.supportId} / ${record.id}${record.published ? "" : " (unpublished)"}`,
          record.id,
        ),
      );
    }
    if (records.some((record) => record.id === selected)) select.value = selected;
    if (!quiet) setStatus(`Loaded ${records.length} combo${records.length === 1 ? "" : "s"}.`);
  } catch (error) {
    setStatus(`Could not load editor records: ${error.message}`, true);
  }
}

async function publishCombo() {
  let record;
  try {
    record = payload();
  } catch (error) {
    setStatus(error.message, true);
    return;
  }
  const button = field("publish");
  button.disabled = true;
  setStatus("Publishing…");
  try {
    const result = await readResponse(
      await fetch(`/v1/editor/combos/${record.id}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(revision === null ? { "If-None-Match": "*" } : { "If-Match": `"${revision}"` }),
        },
        body: JSON.stringify(record),
      }),
    );
    loadRecord(result);
    await loadList(true);
    setStatus(
      `Published revision ${result.revision}. The public catalog may take up to 60 seconds to refresh.`,
    );
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    renderPreview();
  }
}

async function unpublishCombo() {
  if (revision === null || !published || !confirm("Unpublish this combo from the public catalog?"))
    return;
  const id = fields["combo-id"].value.trim();
  setStatus("Unpublishing…");
  try {
    const result = await readResponse(
      await fetch(`/v1/editor/combos/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "If-Match": `"${revision}"` },
      }),
    );
    revision = result.revision;
    published = false;
    field("revision").textContent = `Revision ${revision} · unpublished`;
    field("unpublish").hidden = true;
    saveDraft();
    await loadList(true);
    setStatus("Combo unpublished. The public catalog may take up to 60 seconds to refresh.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

for (const id of fieldIds) {
  fields[id].addEventListener("input", () => {
    renderPreview();
    saveDraft();
  });
}
field("local-video").addEventListener("change", (event) => {
  if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
  const file = event.target.files?.[0];
  const preview = field("local-preview");
  localVideoUrl = file ? URL.createObjectURL(file) : null;
  preview.src = localVideoUrl ?? "";
  preview.hidden = !file;
});
window.addEventListener("beforeunload", () => {
  if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
});
field("new-combo").addEventListener("click", newCombo);
field("reload-list").addEventListener("click", () => void loadList());
field("load-existing").addEventListener("click", () => {
  const record = records.find((item) => item.id === field("existing").value);
  if (!record) return setStatus("Select a combo first.", true);
  if (fields.route.value.trim() && !confirm("Replace the current browser draft with this combo?"))
    return;
  loadRecord(record);
  field("import-warning").hidden = true;
  setStatus(`Loaded ${record.id}.`);
});
field("publish").addEventListener("click", () => void publishCombo());
field("unpublish").addEventListener("click", () => void unpublishCombo());
field("import-draft").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 64 * 1024) return setStatus("Draft JSON is too large.", true);
  try {
    const imported = JSON.parse(await file.text());
    const combo = imported.combo ?? imported;
    if (!combo || typeof combo !== "object" || Array.isArray(combo))
      throw new Error("Invalid combo draft.");
    if (
      fields.route.value.trim() &&
      !confirm("Replace the current browser draft with this import?")
    )
      return;
    const existing = records.find((record) => record.id === combo.id);
    loadRecord({
      ...combo,
      revision: existing?.revision ?? null,
      published: existing?.published ?? false,
    });
    const warnings = Array.isArray(imported.warnings)
      ? imported.warnings.filter((item) => typeof item === "string")
      : [];
    if (existing)
      warnings.push(
        `This ID already exists. Publishing will update revision ${existing.revision}.`,
      );
    field("import-warning").textContent = warnings.join(" ");
    field("import-warning").hidden = warnings.length === 0;
    setStatus(
      "Desktop draft imported. Review its fields and add a YouTube link before publishing.",
    );
  } catch (error) {
    setStatus(`Could not import draft: ${error.message}`, true);
  } finally {
    event.target.value = "";
  }
});

try {
  const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null");
  if (saved?.values && typeof saved.values === "object") {
    revision = Number.isInteger(saved.revision) && saved.revision > 0 ? saved.revision : null;
    published = Boolean(saved.published);
    setValues(saved.values);
    fields["combo-id"].readOnly = revision !== null;
    field("revision").textContent =
      revision === null
        ? "Restored local draft"
        : `Restored revision ${revision} · ${published ? "published" : "unpublished"}`;
    field("publish").textContent = revision === null ? "Publish combo" : "Save and publish";
    field("unpublish").hidden = revision === null || !published;
  } else {
    newCombo();
  }
} catch {
  newCombo();
}
void loadList();
