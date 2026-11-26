const { app } = require("electron");
const isPackaged = app?.isPackaged ?? true;

const hostedOrigin = "https://labatar-catalog.landenhanni.workers.dev";
const defaultLocalOrigin = "http://127.0.0.1:8787";

function localOrigin() {
  const input = process.env.VITE_CATALOG_API_URL;
  if (!input || input === hostedOrigin) return defaultLocalOrigin;
  const url = new URL(input);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("VITE_CATALOG_API_URL must be a local HTTP origin in Electron development.");
  }
  return url.origin;
}

let mode =
  !isPackaged &&
  process.env.VITE_CATALOG_API_URL &&
  process.env.VITE_CATALOG_API_URL !== hostedOrigin
    ? "local"
    : "hosted";

function getCatalogBackend() {
  return {
    mode: isPackaged ? "hosted" : mode,
    origin: !isPackaged && mode === "local" ? localOrigin() : hostedOrigin,
  };
}

function getCatalogOrigin() {
  return getCatalogBackend().origin;
}

function setCatalogBackend(nextMode) {
  if (isPackaged) throw new Error("Catalog backend switching is available only in development.");
  if (nextMode !== "local" && nextMode !== "hosted") throw new Error("Invalid catalog backend.");
  if (nextMode === "local") localOrigin();
  mode = nextMode;
  return getCatalogBackend();
}

module.exports = { getCatalogBackend, getCatalogOrigin, setCatalogBackend };
