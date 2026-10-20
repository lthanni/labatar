const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Transform, Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { importReplays } = require("./replay-import.cjs");

const MAX_ZIP_BYTES = 1024 * 1024 * 1024;
const MAX_REPLAY_BYTES = 64 * 1024 * 1024;

function discordReplayAttachment(value) {
  if (typeof value !== "string" || value.length > 4096) {
    throw new Error("Drop a Discord replay attachment link, or download the file first.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Drop a Discord replay attachment link, or download the file first.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "cdn.discordapp.com" ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("Only Discord attachment links can be imported from a URL.");
  }
  const match = url.pathname.match(/^\/attachments\/(\d+)\/(\d+)\/([^/]+)$/);
  if (!match) throw new Error("Drop the replay attachment itself, not its Discord message link.");
  let name;
  try {
    name = decodeURIComponent(match[3]);
  } catch {
    throw new Error("The Discord attachment has an invalid filename.");
  }
  const extension = path.extname(name).toLowerCase();
  if (extension !== ".dlr" && extension !== ".zip") {
    throw new Error("The Discord attachment must be a .dlr replay or ZIP archive.");
  }
  return {
    url,
    name,
    extension,
    maxBytes: extension === ".zip" ? MAX_ZIP_BYTES : MAX_REPLAY_BYTES,
  };
}

async function importDiscordReplayUrl(
  value,
  gameFolder,
  fetchFile = fetch,
  importFiles = importReplays,
) {
  const attachment = discordReplayAttachment(value);
  if (!gameFolder) throw new Error("Choose the game folder in Settings before importing replays.");
  const staging = await fs.promises.mkdtemp(path.join(os.tmpdir(), "labatar-discord-replay-"));
  try {
    const stem =
      attachment.name
        .slice(0, -attachment.extension.length)
        .replace(/[<>:"/\\|?*]/g, "_")
        .split("")
        .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
        .join("")
        .replace(/[. ]+$/, "")
        .slice(0, 150) || "replay";
    const target = path.join(staging, `${stem}-${randomUUID()}${attachment.extension}`);
    const response = await fetchFile(attachment.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(300000),
    });
    if (!response.ok || !response.body) {
      throw new Error(
        "Discord could not provide that attachment. Try Download in Discord, then Import replays.",
      );
    }
    const declaredSize = Number(response.headers.get("content-length"));
    if (declaredSize > attachment.maxBytes) throw new Error("The Discord attachment is too large.");
    let received = 0;
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (received > attachment.maxBytes)
            callback(new Error("The Discord attachment is too large."));
          else callback(null, chunk);
        },
      }),
      fs.createWriteStream(target, { flags: "wx" }),
    );
    return await importFiles([target], gameFolder);
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
}

module.exports = { discordReplayAttachment, importDiscordReplayUrl };
