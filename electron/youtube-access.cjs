const {
  catalogOrigin,
  publisherSession,
  publisherReadWithRecovery,
  fetchEditorResponse,
  signInToCatalog,
} = require("./catalog-publisher.cjs");

const accessUrl = `${catalogOrigin}/v1/editor/youtube-upload-access`;

async function checkYouTubeUploadAccess(ses = publisherSession()) {
  return publisherReadWithRecovery(ses, "YouTube upload access check", async (signal) => {
    const result = await fetchEditorResponse(ses, accessUrl, {
      credentials: "include",
      redirect: "manual",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
    if (result.authenticationRequired) return null;
    if (result.body?.allowed !== true) throw new Error("Invalid YouTube upload access response.");
    return true;
  });
}

async function requireYouTubeUploadAccess(parent) {
  const ses = publisherSession();
  if (!(await checkYouTubeUploadAccess(ses))) {
    await signInToCatalog(ses, parent, checkYouTubeUploadAccess, accessUrl);
  }
  if (!(await checkYouTubeUploadAccess(ses))) {
    throw new Error("Sign in to use YouTube uploads.");
  }
}

module.exports = { checkYouTubeUploadAccess, requireYouTubeUploadAccess };
