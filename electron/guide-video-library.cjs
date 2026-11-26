const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createGuideVideoLibrary(userData) {
  const indexPath = path.join(userData, "guide-videos.json");
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }
  function write(data) {
    fs.mkdirSync(userData, { recursive: true });
    const tempPath = `${indexPath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(tempPath, indexPath);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  }
  function get(id) {
    if (typeof id !== "string" || !idPattern.test(id)) throw new Error("Invalid guide video.");
    const entry = read()[id];
    if (!entry || typeof entry.filePath !== "string")
      throw new Error("The local guide video is unavailable. Choose it again.");
    return entry;
  }
  async function add(filePath) {
    const realPath = await fs.promises.realpath(filePath);
    const stat = await fs.promises.stat(realPath);
    if (!stat.isFile() || !stat.size || path.extname(realPath).toLowerCase() !== ".mp4")
      throw new Error("Choose a nonempty MP4 file.");
    const existing = Object.entries(read()).find(([, entry]) => entry.filePath === realPath);
    if (existing) return { id: existing[0], fileName: path.basename(realPath) };
    const id = randomUUID();
    write({ ...read(), [id]: { filePath: realPath } });
    return { id, fileName: path.basename(realPath) };
  }
  async function file(id) {
    const entry = get(id);
    const realPath = await fs.promises.realpath(entry.filePath).catch(() => null);
    const stat = realPath ? await fs.promises.stat(realPath).catch(() => null) : null;
    if (!stat?.isFile() || !stat.size || path.extname(realPath).toLowerCase() !== ".mp4")
      throw new Error("The local guide video is unavailable. Choose it again.");
    return { filePath: realPath, stat };
  }
  function remoteId(id, origin, stat) {
    const data = read();
    const entry = get(id);
    const previous = entry.remote?.[origin];
    if (previous?.size === stat.size && previous?.mtimeMs === stat.mtimeMs) return previous.id;
    const remote = { id: randomUUID(), size: stat.size, mtimeMs: stat.mtimeMs };
    write({ ...data, [id]: { ...entry, remote: { ...entry.remote, [origin]: remote } } });
    return remote.id;
  }
  const remote = (id, origin) => get(id).remote?.[origin] ?? null;
  async function list() {
    const entries = Object.keys(read()).filter((id) => idPattern.test(id));
    const videos = await Promise.all(
      entries.map(async (id) => {
        const source = await file(id).catch(() => null);
        return source ? { id, fileName: path.basename(source.filePath) } : null;
      }),
    );
    return videos.filter(Boolean);
  }
  async function recordingLinks(ids, folder, recordingIds) {
    if (!ids.length || !recordingIds.size) return {};
    const realFolder = await fs.promises.realpath(folder).catch(() => null);
    if (!realFolder) return {};
    const links = await Promise.all(
      ids.map(async (id) => {
        const video = await file(id).catch(() => null);
        if (!video) return [];
        const recordingId = path.relative(realFolder, video.filePath).split(path.sep).join("/");
        return recordingIds.has(recordingId) ? [[id, recordingId]] : [];
      }),
    );
    return Object.fromEntries(links.flat());
  }
  return { add, file, remoteId, remote, list, recordingLinks };
}

module.exports = { createGuideVideoLibrary };
