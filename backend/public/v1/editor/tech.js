const field = (name) => document.getElementById(name);
const status = (message, error = false) => {
  field("status").textContent = message;
  field("status").className = error ? "error" : "muted";
};
const slug = /^[a-z0-9][a-z0-9-]{0,99}$/;
const state = {
  sections: [],
  entries: [],
  sectionRevision: 0,
  entryRevision: 0,
  entryNotation: "",
};
const params = new URLSearchParams(location.search);

async function response(request) {
  const result = await request;
  const body = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(body.error ?? `Request failed (${result.status}).`);
  return body;
}

function resetSection() {
  state.sectionRevision = 0;
  field("existing-section").value = "";
  field("section-id").value = "";
  field("section-id").readOnly = false;
  field("section-title").value = "";
  field("section-description").value = "";
  field("section-order").value = "0";
  field("scope-kind").value = params.has("support") ? "support" : "character";
  field("subject-id").value = params.get("support") ?? params.get("character") ?? "";
  field("section-revision").textContent = "New subsection";
  field("unpublish-section").hidden = true;
}

function resetEntry() {
  state.entryRevision = 0;
  state.entryNotation = "";
  field("existing-entry").value = "";
  field("entry-id").value = "";
  field("entry-id").readOnly = false;
  field("entry-title").value = "";
  field("entry-description").value = "";
  field("entry-order").value = "0";
  field("entry-section").value =
    field("existing-section").value || field("entry-section").options[0]?.value || "";
  field("videos").replaceChildren();
  field("entry-revision").textContent = "New tech entry";
  field("unpublish-entry").hidden = true;
}

function addVideo(video = {}) {
  if (field("videos").children.length >= 12) return status("Use at most 12 videos.", true);
  const group = document.createElement("div");
  group.className = "panel";
  group.style.marginTop = "12px";
  const title = document.createElement("input");
  title.placeholder = "Video heading (optional)";
  title.maxLength = 160;
  title.value = video.title ?? "";
  const description = document.createElement("textarea");
  description.placeholder = "Description (optional)";
  description.maxLength = 500;
  description.rows = 2;
  description.value = video.description ?? "";
  const url = document.createElement("input");
  url.type = "url";
  url.placeholder = "https://www.youtube.com/watch?v=...";
  url.value =
    video.url ??
    (video.youtubeVideoId ? `https://www.youtube.com/watch?v=${video.youtubeVideoId}` : "");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove video";
  remove.addEventListener("click", () => group.remove());
  for (const [label, control] of [
    ["Heading", title],
    ["Description", description],
    ["YouTube URL", url],
  ]) {
    const wrapper = document.createElement("label");
    wrapper.textContent = label;
    wrapper.append(control);
    group.append(wrapper);
  }
  group.append(remove);
  field("videos").append(group);
}

function loadSection(section) {
  state.sectionRevision = section.revision;
  field("existing-section").value = section.id;
  field("section-id").value = section.id;
  field("section-id").readOnly = true;
  field("scope-kind").value = section.scopeKind;
  field("subject-id").value = section.subjectId;
  field("section-title").value = section.title;
  field("section-description").value = section.description;
  field("section-order").value = String(section.sortOrder);
  field("section-revision").textContent =
    `Revision ${section.revision} · ${section.published ? "published" : "unpublished"}`;
  field("unpublish-section").hidden = !section.published;
}

function loadEntry(entry) {
  state.entryRevision = entry.revision;
  state.entryNotation = entry.notation ?? "";
  field("existing-entry").value = entry.id;
  field("entry-id").value = entry.id;
  field("entry-id").readOnly = true;
  field("entry-section").value = entry.sectionId;
  field("entry-title").value = entry.title;
  field("entry-description").value = entry.description;
  field("entry-order").value = String(entry.sortOrder);
  field("videos").replaceChildren();
  for (const video of entry.videos) addVideo(video);
  field("entry-revision").textContent =
    `Revision ${entry.revision} · ${entry.published ? "published" : "unpublished"}`;
  field("unpublish-entry").hidden = !entry.published;
}

async function reload() {
  const [sections, entries] = await Promise.all([
    response(fetch("/v1/editor/tech-sections", { cache: "no-store" })),
    response(fetch("/v1/editor/tech-entries", { cache: "no-store" })),
  ]);
  state.sections = sections.sections;
  state.entries = entries.entries;
  const previousSection = field("existing-section").value;
  const previousEntry = field("existing-entry").value;
  field("existing-section").replaceChildren(new Option("New subsection", ""));
  field("entry-section").replaceChildren(new Option("Choose a subsection", ""));
  for (const section of state.sections) {
    const label = `${section.scopeKind}: ${section.subjectId} / ${section.title}${section.published ? "" : " (unpublished)"}`;
    field("existing-section").add(new Option(label, section.id));
    if (section.published) field("entry-section").add(new Option(label, section.id));
  }
  field("existing-section").value = previousSection;
  field("existing-entry").replaceChildren(new Option("New tech entry", ""));
  for (const entry of state.entries) {
    field("existing-entry").add(
      new Option(`${entry.title}${entry.published ? "" : " (unpublished)"}`, entry.id),
    );
  }
  field("existing-entry").value = previousEntry;
}

function sectionPayload() {
  const value = {
    id: field("section-id").value.trim(),
    scopeKind: field("scope-kind").value,
    subjectId: field("subject-id").value.trim(),
    title: field("section-title").value.trim(),
    description: field("section-description").value.trim(),
    sortOrder: Number(field("section-order").value),
  };
  if (!slug.test(value.id) || !slug.test(value.subjectId))
    throw new Error("Subsection and subject IDs must be lowercase slugs.");
  if (!value.title) throw new Error("Enter a subsection title.");
  return value;
}

function entryPayload() {
  const value = {
    id: field("entry-id").value.trim(),
    sectionId: field("entry-section").value,
    title: field("entry-title").value.trim(),
    description: field("entry-description").value.trim(),
    notation: state.entryNotation,
    sortOrder: Number(field("entry-order").value),
    videos: [...field("videos").children].map((group) => ({
      title: group.querySelector("input").value.trim(),
      description: group.querySelector("textarea").value.trim(),
      url: group.querySelector('input[type="url"]').value.trim(),
    })),
  };
  if (!slug.test(value.id) || !slug.test(value.sectionId))
    throw new Error("Enter a tech ID and published subsection.");
  if (!value.title) throw new Error("Enter a tech title.");
  return value;
}

async function save(type) {
  try {
    const value = type === "sections" ? sectionPayload() : entryPayload();
    const revision = type === "sections" ? state.sectionRevision : state.entryRevision;
    const result = await response(
      fetch(`/v1/editor/tech-${type}/${value.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(revision ? { "If-Match": `"${revision}"` } : { "If-None-Match": "*" }),
        },
        body: JSON.stringify(value),
      }),
    );
    await reload();
    if (type === "sections") loadSection(result);
    else loadEntry(result);
    status(`Published ${type === "sections" ? "subsection" : "tech"} revision ${result.revision}.`);
  } catch (error) {
    status(error.message, true);
  }
}

async function unpublish(type) {
  const revision = type === "sections" ? state.sectionRevision : state.entryRevision;
  const id = field(type === "sections" ? "section-id" : "entry-id").value;
  if (!revision || !confirm(`Unpublish ${id}?`)) return;
  try {
    await response(
      fetch(`/v1/editor/tech-${type}/${id}`, {
        method: "DELETE",
        headers: { "If-Match": `"${revision}"` },
      }),
    );
    await reload();
    const record = (type === "sections" ? state.sections : state.entries).find(
      (item) => item.id === id,
    );
    if (type === "sections") loadSection(record);
    else loadEntry(record);
    status(`Unpublished ${id}.`);
  } catch (error) {
    status(error.message, true);
  }
}

field("new-section").addEventListener("click", resetSection);
field("new-entry").addEventListener("click", resetEntry);
field("add-video").addEventListener("click", () => addVideo());
field("existing-section").addEventListener("change", () => {
  const section = state.sections.find((item) => item.id === field("existing-section").value);
  if (section) loadSection(section);
  else resetSection();
});
field("existing-entry").addEventListener("change", () => {
  const entry = state.entries.find((item) => item.id === field("existing-entry").value);
  if (entry) loadEntry(entry);
  else resetEntry();
});
field("save-section").addEventListener("click", () => void save("sections"));
field("save-entry").addEventListener("click", () => void save("entries"));
field("unpublish-section").addEventListener("click", () => void unpublish("sections"));
field("unpublish-entry").addEventListener("click", () => void unpublish("entries"));

resetSection();
resetEntry();
void reload().catch((error) => status(`Could not load Tech editor: ${error.message}`, true));
