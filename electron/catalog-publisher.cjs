const { BrowserWindow, dialog, session } = require("electron");

const catalogOrigin = "https://labatar-catalog.landenhanni.workers.dev";
const editorListUrl = `${catalogOrigin}/v1/editor/combos`;
const editorAppUrl = `${catalogOrigin}/v1/editor/app`;
const publisherPartition = "persist:labatar-catalog-publisher";
const slugPattern = /^[a-z0-9][a-z0-9-]{0,99}$/;

function publisherSession() {
  return session.fromPartition(publisherPartition);
}

async function publisherRequestWithTimeout(label, action, timeoutMs = 15000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      action(controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out. Check your connection and try again.`));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function publisherReadWithRecovery(ses, label, action, timeoutMs = 15000, onReset) {
  const request = () => publisherRequestWithTimeout(label, action, timeoutMs);
  try {
    return await request();
  } catch (error) {
    if (
      error?.message !== `${label} timed out. Check your connection and try again.` ||
      typeof ses.closeAllConnections !== "function"
    ) {
      throw error;
    }
    onReset?.();
    await publisherRequestWithTimeout(
      `${label} connection reset`,
      () => ses.closeAllConnections(),
      5000,
    );
    try {
      return await request();
    } catch (retryError) {
      if (retryError?.message === error.message) {
        throw new Error(
          `${label} still timed out after reconnecting. Check your connection or restart the desktop app.`,
        );
      }
      throw retryError;
    }
  }
}

async function readEditorResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status >= 300 && response.status < 400) return { authenticationRequired: true };
  if (!contentType.includes("application/json")) return { authenticationRequired: true };
  const body = await response.json();
  if (response.status === 401) return { authenticationRequired: true };
  if (!response.ok) throw new Error(body?.error ?? `Catalog request failed (${response.status}).`);
  return { body };
}

function isCancelledEditorRedirect(error) {
  return /redirect was cancelled/i.test(error?.message ?? "");
}

async function fetchEditorResponse(ses, url, options) {
  let response;
  try {
    response = await ses.fetch(url, options);
  } catch (error) {
    if (isCancelledEditorRedirect(error)) return { authenticationRequired: true };
    throw error;
  }
  return readEditorResponse(response);
}

async function listEditorCombos(ses, timeoutMs = 15000, onReset) {
  return publisherReadWithRecovery(
    ses,
    "Catalog sign-in check",
    async (signal) => {
      const result = await fetchEditorResponse(ses, editorListUrl, {
        credentials: "include",
        redirect: "manual",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal,
      });
      if (result.authenticationRequired) return null;
      if (!Array.isArray(result.body?.items)) throw new Error("Invalid editor catalog response.");
      return result.body.items;
    },
    timeoutMs,
    onReset,
  );
}

function signInToCatalog(ses, parent, verifyAccess = listEditorCombos) {
  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 850,
      height: 760,
      minWidth: 600,
      minHeight: 500,
      title: "Sign in to publish",
      autoHideMenuBar: true,
      ...(parent ? { parent, modal: true } : {}),
      webPreferences: {
        partition: publisherPartition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    let finished = false;
    let checking = false;
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      authWindow.close();
      reject(new Error("Catalog sign-in timed out. Close the window and try again."));
    }, 120000);
    authWindow.webContents.on("did-finish-load", async () => {
      if (finished || checking) return;
      let currentUrl;
      try {
        currentUrl = new URL(authWindow.webContents.getURL());
      } catch {
        return;
      }
      if (currentUrl.origin !== catalogOrigin || currentUrl.pathname !== "/v1/editor/app") return;
      checking = true;
      try {
        const items = await verifyAccess(ses);
        if (items && !finished) {
          finished = true;
          authWindow.close();
          resolve(items);
        }
      } catch (error) {
        if (finished) return;
        finished = true;
        authWindow.close();
        reject(error);
      } finally {
        checking = false;
      }
    });
    authWindow.on("closed", () => {
      clearTimeout(timeout);
      if (!finished) {
        finished = true;
        reject(new Error("Catalog sign-in was cancelled."));
      }
    });
    void authWindow.loadURL(editorAppUrl).catch((error) => {
      if (finished) return;
      finished = true;
      authWindow.close();
      reject(error);
    });
  });
}

function publishRequest(request) {
  const combo = request?.combo;
  if (!combo || typeof combo !== "object" || Array.isArray(combo)) {
    throw new Error("Select a combo to publish.");
  }
  if (!slugPattern.test(combo.id ?? "")) throw new Error("The combo needs a valid publisher ID.");
  if (typeof combo.youtubeUrl !== "string" || !combo.youtubeUrl.trim()) {
    throw new Error("Link a YouTube video to the combo before publishing.");
  }
  if (
    request.expectedRevision !== undefined &&
    (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0)
  ) {
    throw new Error("The expected catalog revision is invalid.");
  }
  const body = JSON.stringify(combo);
  if (Buffer.byteLength(body, "utf8") > 128 * 1024) {
    throw new Error("The combo is too large to publish.");
  }
  const warnings = Array.isArray(request.warnings)
    ? request.warnings.filter((warning) => typeof warning === "string").slice(0, 10)
    : [];
  return { combo, body, warnings, expectedRevision: request.expectedRevision };
}

function assertExpectedRevision(expectedRevision, existing) {
  if (expectedRevision !== undefined && (existing?.revision ?? 0) !== expectedRevision) {
    throw new Error(
      "The catalog combo changed since this local draft was made. Review the latest version and start a fresh local revision before publishing.",
    );
  }
}

async function publishCombo(request, parent, onConnectionReset) {
  const { combo, body, warnings, expectedRevision } = publishRequest(request);
  const ses = publisherSession();
  let items = await listEditorCombos(ses, 15000, onConnectionReset);
  if (!items) items = await signInToCatalog(ses, parent);
  const existing = items.find((item) => item.id === combo.id);
  assertExpectedRevision(expectedRevision, existing);
  if (
    existing &&
    (existing.characterId !== combo.characterId || existing.supportId !== combo.supportId)
  ) {
    throw new Error("This publisher ID belongs to another character or support.");
  }
  const options = {
    type: "question",
    title: "Publish combo",
    message: existing
      ? `Publish a new revision of ${combo.id}?`
      : `Publish ${combo.id} to the public catalog?`,
    detail: [
      `${combo.characterId} / ${combo.supportId}`,
      combo.route,
      `Damage: ${combo.damage}`,
      `YouTube: ${combo.youtubeUrl}`,
      existing ? `Current revision: ${existing.revision}` : "New catalog record",
      ...warnings,
    ].join("\n"),
    buttons: ["Publish", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const confirmation = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  if (confirmation.response !== 0) return { cancelled: true };

  let response;
  try {
    response = await publisherRequestWithTimeout("Catalog publish request", (signal) =>
      ses.fetch(`${editorListUrl}/${encodeURIComponent(combo.id)}`, {
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
    if (
      error?.message === "Catalog publish request timed out. Check your connection and try again."
    ) {
      throw new Error(
        "The catalog publish request timed out. Its outcome is unknown. Refresh the catalog to check whether this combo was published before trying again.",
      );
    }
    if (/redirect was cancelled/i.test(String(error))) {
      throw new Error("Catalog sign-in expired. Sign in again and retry publishing.");
    }
    throw error;
  }
  const result = await readEditorResponse(response);
  if (result.authenticationRequired) {
    throw new Error("Catalog sign-in expired. Sign in again and retry publishing.");
  }
  if (!Number.isInteger(result.body?.revision)) {
    throw new Error("The catalog returned an invalid publish response.");
  }
  return { cancelled: false, id: combo.id, revision: result.body.revision };
}

async function authenticatedPublisherSession(parent) {
  const ses = publisherSession();
  if (!(await listEditorCombos(ses))) await signInToCatalog(ses, parent);
  return ses;
}

module.exports = {
  publishCombo,
  assertExpectedRevision,
  authenticatedPublisherSession,
  signInToCatalog,
  publisherSession,
  publisherRequestWithTimeout,
  publisherReadWithRecovery,
  listEditorCombos,
  readEditorResponse,
  fetchEditorResponse,
  isCancelledEditorRedirect,
  catalogOrigin,
};
