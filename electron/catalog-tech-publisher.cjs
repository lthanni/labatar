const { dialog } = require("electron");
const { queueGuidePublication } = require("./guide-publications.cjs");
const {
  authenticatedPublisherSession,
  getCatalogOrigin,
  publisherRequestWithTimeout,
  readEditorResponse,
} = require("./catalog-publisher.cjs");

const slug = /^[a-z0-9][a-z0-9-]{0,99}$/;
const paths = {
  section: "/v1/editor/tech-sections",
  tech: "/v1/editor/tech-entries",
  note: "/v1/editor/character-notes",
  "note-section": "/v1/editor/character-note-sections",
  player: "/v1/editor/players",
};

async function publishCatalogTech(request, parent, dependencies = {}) {
  const type = request?.type;
  const item = request?.item;
  const expectedRevision = request?.expectedRevision ?? 0;
  if (
    typeof type !== "string" ||
    !Object.hasOwn(paths, type) ||
    !item ||
    typeof item !== "object" ||
    Array.isArray(item) ||
    typeof item.id !== "string" ||
    !slug.test(item.id ?? "")
  )
    throw new Error("Select a valid local catalog item to publish.");
  if (type === "note" && !["pressure", "oki", "guide"].includes(item.kind))
    throw new Error("Select a valid character note to publish.");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new Error("The expected catalog revision is invalid.");
  const draftBody = JSON.stringify(item);
  if (Buffer.byteLength(draftBody, "utf8") > 64 * 1024)
    throw new Error("The item is too large to publish.");

  const ses = dependencies.session ?? (await authenticatedPublisherSession(parent));
  const endpoint = `${getCatalogOrigin()}${paths[type]}`;
  const listed = await publisherRequestWithTimeout("Catalog tech check", (signal) =>
    ses.fetch(endpoint, {
      credentials: "include",
      redirect: "manual",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    }),
  );
  const listing = await readEditorResponse(listed);
  if (listing.authenticationRequired)
    throw new Error("Catalog sign-in expired. Sign in again and retry.");
  const items =
    type === "section"
      ? listing.body?.sections
      : type === "tech"
        ? listing.body?.entries
        : listing.body?.items;
  if (!Array.isArray(items)) throw new Error("The editor catalog returned an invalid list.");
  const existing = items.find((candidate) => candidate.id === item.id);
  if ((existing?.revision ?? 0) !== expectedRevision)
    throw new Error(
      "The catalog item changed since this local draft was published. Refresh and review it before publishing again.",
    );
  if (
    existing &&
    (type === "section"
      ? existing.scopeKind !== item.scopeKind || existing.subjectId !== item.subjectId
      : type === "tech"
        ? existing.sectionId !== item.sectionId
        : type === "player"
          ? existing.scopeKind !== item.scopeKind || existing.subjectId !== item.subjectId
          : existing.kind !== item.kind ||
            existing.characterId !== item.characterId ||
            existing.supportId !== item.supportId)
  )
    throw new Error("This publisher ID belongs to another catalog item.");

  const label =
    type === "section"
      ? "Tech subsection"
      : type === "tech"
        ? "Tech entry"
        : type === "player"
          ? "player"
          : type === "note-section"
            ? `${item.kind} section`
            : item.kind;
  const options = {
    type: "question",
    title: "Publish catalog item",
    message: `Publish ${label}: ${item.title}?`,
    detail: existing ? `Current revision: ${existing.revision}` : "New catalog record",
    buttons: ["Publish", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const showMessageBox =
    dependencies.showMessageBox ?? ((...args) => dialog.showMessageBox(...args));
  const confirmation = parent
    ? await showMessageBox(parent, options)
    : await showMessageBox(options);
  if (confirmation.response !== 0) return { cancelled: true };

  let publishItem = item;
  let hasLocalVideos = false;
  const publishVideos =
    type === "tech" || (type === "note" && (item.kind === "guide" || item.videos !== undefined));
  if (publishVideos) {
    const draftVideos = item.videos ?? [];
    if (!Array.isArray(draftVideos) || draftVideos.length > 12)
      throw new Error("Use at most 12 guide videos.");
    const videos = [];
    for (const video of draftVideos) {
      if (!video || typeof video !== "object" || Array.isArray(video))
        throw new Error("Choose a valid guide video.");
      if (video.localVideoId && !video.url) {
        hasLocalVideos = true;
        const uploadId = await dependencies.stageGuideVideo?.(ses, video);
        if (typeof uploadId !== "string" || !uploadId)
          throw new Error("The guide MP4 could not be staged.");
        videos.push({ title: video.title, description: video.description, uploadId });
        continue;
      }
      const url = video.url;
      if (typeof url !== "string" || !url)
        throw new Error("The guide video could not be prepared for publishing.");
      videos.push({ title: video.title, description: video.description, url });
    }
    publishItem = { ...item, videos };
  }
  if (hasLocalVideos)
    return (dependencies.queueGuidePublication ?? queueGuidePublication)(
      ses,
      type,
      publishItem,
      expectedRevision,
    );
  const body = JSON.stringify(publishItem);

  let response;
  try {
    response = await publisherRequestWithTimeout("Catalog tech publish", (signal) =>
      ses.fetch(`${endpoint}/${encodeURIComponent(item.id)}`, {
        method: "PUT",
        credentials: "include",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(existing ? { "If-Match": `"${existing.revision}"` } : { "If-None-Match": "*" }),
        },
        body,
        signal,
      }),
    );
  } catch (error) {
    if (/timed out/i.test(error?.message ?? ""))
      throw new Error(
        "Publishing timed out. Its outcome is unknown. Refresh the catalog before trying again.",
      );
    if (/redirect was cancelled/i.test(error?.message ?? ""))
      throw new Error("Catalog sign-in expired. Sign in again and retry.");
    throw error;
  }
  const result = await readEditorResponse(response);
  if (result.authenticationRequired)
    throw new Error("Catalog sign-in expired. Sign in again and retry.");
  if (result.body?.id !== item.id || result.body?.revision !== expectedRevision + 1)
    throw new Error("The catalog returned an invalid publish response. Refresh the catalog.");
  return {
    cancelled: false,
    id: item.id,
    revision: result.body.revision,
    ...(publishVideos ? { videos: publishItem.videos } : {}),
  };
}

async function unpublishCatalogPlayer(request, parent, dependencies = {}) {
  const id = request?.id;
  const expectedRevision = request?.expectedRevision;
  if (
    typeof id !== "string" ||
    !slug.test(id) ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1
  )
    throw new Error("Select a valid published player and refresh its revision.");
  const ses = dependencies.session ?? (await authenticatedPublisherSession(parent));
  const endpoint = `${getCatalogOrigin()}${paths.player}`;
  const listed = await publisherRequestWithTimeout("Player check", (signal) =>
    ses.fetch(endpoint, {
      credentials: "include",
      redirect: "manual",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    }),
  );
  const listing = await readEditorResponse(listed);
  if (listing.authenticationRequired)
    throw new Error("Catalog sign-in expired. Sign in again and retry.");
  if (!Array.isArray(listing.body?.items))
    throw new Error("The editor catalog returned an invalid list.");
  const existing = listing.body.items.find((item) => item.id === id);
  if (!existing?.published || existing.revision !== expectedRevision)
    throw new Error("The player changed. Refresh it before removing.");
  const options = {
    type: "warning",
    title: "Remove player",
    message: `Remove ${existing.title} from the public catalog?`,
    buttons: ["Remove", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const showMessageBox =
    dependencies.showMessageBox ?? ((...args) => dialog.showMessageBox(...args));
  const confirmation = parent
    ? await showMessageBox(parent, options)
    : await showMessageBox(options);
  if (confirmation.response !== 0) return { cancelled: true };
  let response;
  try {
    response = await publisherRequestWithTimeout("Player removal", (signal) =>
      ses.fetch(`${endpoint}/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
        redirect: "error",
        headers: { Accept: "application/json", "If-Match": `"${expectedRevision}"` },
        signal,
      }),
    );
  } catch (error) {
    if (/timed out/i.test(error?.message ?? ""))
      throw new Error(
        "Removing the player timed out. Refresh the catalog to check the result before trying again.",
      );
    if (/redirect was cancelled/i.test(error?.message ?? ""))
      throw new Error("Catalog sign-in expired. Sign in again and retry.");
    throw error;
  }
  const result = await readEditorResponse(response);
  if (result.authenticationRequired)
    throw new Error("Catalog sign-in expired. Sign in again and retry.");
  if (
    result.body?.id !== id ||
    result.body?.revision !== expectedRevision + 1 ||
    result.body?.published !== false
  )
    throw new Error("The catalog returned an invalid removal response. Refresh the catalog.");
  return { cancelled: false, id, revision: result.body.revision };
}

module.exports = { publishCatalogTech, unpublishCatalogPlayer };
