const { BrowserWindow } = require("electron");
const {
  catalogOrigin,
  isCancelledEditorRedirect,
  publisherSession,
  publisherReadWithRecovery,
} = require("./catalog-publisher.cjs");

const previewUrl = `${catalogOrigin}/v1/editor/combo-preview`;
const publisherPartition = "persist:labatar-catalog-publisher";

async function checkComboPreviewAccess(ses = publisherSession()) {
  return publisherReadWithRecovery(ses, "Combos preview access check", async (signal) => {
    let response;
    try {
      response = await ses.fetch(previewUrl, {
        credentials: "include",
        redirect: "manual",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal,
      });
    } catch (error) {
      if (isCancelledEditorRedirect(error)) return false;
      throw error;
    }
    if (response.status >= 300 && response.status < 400) return false;
    if (response.status === 401 || response.status === 403) return false;
    if (!response.ok) throw new Error(`Combos preview access check failed (${response.status}).`);
    const body = await response.json();
    return body?.allowed === true;
  });
}

async function requestComboPreviewAccess(parent) {
  const ses = publisherSession();
  if (await checkComboPreviewAccess(ses)) return true;
  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 850,
      height: 760,
      minWidth: 600,
      minHeight: 500,
      title: "Sign in for Combos preview",
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
      reject(new Error("Combos preview sign-in timed out."));
    }, 120000);
    authWindow.webContents.on("did-finish-load", async () => {
      if (finished || checking) return;
      let currentUrl;
      try {
        currentUrl = new URL(authWindow.webContents.getURL());
      } catch {
        return;
      }
      if (currentUrl.origin !== catalogOrigin || currentUrl.pathname !== "/v1/editor/combo-preview")
        return;
      checking = true;
      try {
        const allowed = await checkComboPreviewAccess(ses);
        if (!finished) {
          finished = true;
          authWindow.close();
          resolve(allowed);
        }
      } catch (error) {
        if (!finished) {
          finished = true;
          authWindow.close();
          reject(error);
        }
      } finally {
        checking = false;
      }
    });
    authWindow.on("closed", () => {
      clearTimeout(timeout);
      if (!finished) {
        finished = true;
        resolve(false);
      }
    });
    void authWindow.loadURL(previewUrl).catch((error) => {
      if (finished) return;
      finished = true;
      authWindow.close();
      reject(error);
    });
  });
}

module.exports = { checkComboPreviewAccess, requestComboPreviewAccess };
