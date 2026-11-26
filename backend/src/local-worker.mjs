import { handleRequest } from "./worker.mjs";
import { processGuidePublications, cleanGuideVideos } from "./guide-publications.mjs";

const localIdentity = async () => "local-dev@labatar.invalid";

export default {
  async scheduled(_event, env) {
    await processGuidePublications(env);
    await cleanGuideVideos(env);
  },
  fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
      return new Response("Local development only.", { status: 403 });
    }
    return handleRequest(
      request,
      env,
      context,
      localIdentity,
      localIdentity,
      localIdentity,
      localIdentity,
      fetch,
      localIdentity,
    );
  },
};
