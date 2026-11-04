const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function validHashes(hashes, baseline) {
  return (
    hashes &&
    typeof hashes === "object" &&
    !Array.isArray(hashes) &&
    Object.keys(hashes).length === Object.keys(baseline).length &&
    Object.keys(baseline).every(
      (name) => Object.hasOwn(hashes, name) && /^[a-f0-9]{64}$/.test(hashes[name]),
    )
  );
}

function readApprovedHashes(filePath, baseline) {
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Could not read blackout hash approval: ${error.message}`);
  }
  if (saved?.version !== 1 || !validHashes(saved.files, baseline)) {
    throw new Error("The saved blackout hash approval is invalid.");
  }
  return saved.files;
}

async function inspectGameHashes(gameRoot, trusted, hashFile) {
  const current = {};
  const changes = [];
  for (const [name, approvedHash] of Object.entries(trusted)) {
    const filePath = path.join(gameRoot, "data_packages", name);
    const actualHash = await hashFile(filePath);
    current[name] = actualHash;
    if (actualHash !== approvedHash) {
      changes.push({ name, approvedHash, actualHash });
    }
  }
  return { current, changes };
}

async function saveApprovedHashes(filePath, hashes, baseline) {
  if (!validHashes(hashes, baseline)) throw new Error("Invalid blackout hashes to approve.");
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(
      temporary,
      JSON.stringify({ version: 1, approvedAt: new Date().toISOString(), files: hashes }, null, 2),
      "utf8",
    );
    await fs.promises.rename(temporary, filePath);
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
  }
}

module.exports = { readApprovedHashes, inspectGameHashes, saveApprovedHashes };
