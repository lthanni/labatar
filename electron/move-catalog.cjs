const fs = require("node:fs");
const path = require("node:path");

const catalogFileName = "move-catalog.json";
const catalogBackupFileName = "move-catalog.json.bak";

function object(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function requiredId(value, field) {
  const id = requiredText(value, field);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    throw new Error(`${field} must use letters, numbers, and hyphens only.`);
  }
  return id;
}

function inputList(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must include at least one observed input.`);
  }
  const inputs = [];
  for (const entry of value) {
    const input = requiredText(entry, field);
    if (input.length > 40) throw new Error(`${field} contains an input that is too long.`);
    if (!inputs.includes(input)) inputs.push(input);
  }
  return inputs;
}

function bareStanceInput(value) {
  return /^(EX|SUP|A|B|C|F|X)$/i.test(value);
}

function defaultCatalog() {
  return { schemaVersion: 1, revision: 0, characters: [] };
}

function validateCatalog(value) {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.characters)) {
    throw new Error("The move catalog is invalid.");
  }
  const characterIds = new Set();
  const characters = value.characters.map((character, characterIndex) => {
    if (!object(character)) throw new Error(`characters[${characterIndex}] is invalid.`);
    const id = requiredId(character.id, `characters[${characterIndex}].id`);
    if (characterIds.has(id)) throw new Error(`The character id ${id} is duplicated.`);
    characterIds.add(id);
    if (!Array.isArray(character.moves)) {
      throw new Error(`characters[${characterIndex}].moves must be an array.`);
    }
    const moveIds = new Set();
    const moves = character.moves.map((move, moveIndex) => {
      if (!object(move))
        throw new Error(`characters[${characterIndex}].moves[${moveIndex}] is invalid.`);
      const moveId = requiredId(move.id, `characters[${characterIndex}].moves[${moveIndex}].id`);
      if (moveIds.has(moveId)) throw new Error(`The move id ${moveId} is duplicated for ${id}.`);
      moveIds.add(moveId);
      const expectedInputs = inputList(
        move.expectedInputs,
        `characters[${characterIndex}].moves[${moveIndex}].expectedInputs`,
      );
      const isStance = move.isStance === true;
      const isCharged = move.isCharged === true;
      if (isStance && expectedInputs.some((input) => !bareStanceInput(input))) {
        throw new Error("Stance moves must use bare button inputs such as A or B.");
      }
      return {
        id: moveId,
        label: requiredText(move.label, `characters[${characterIndex}].moves[${moveIndex}].label`),
        expectedInputs,
        isStance,
        isCharged,
      };
    });
    return {
      id,
      label: requiredText(character.label, `characters[${characterIndex}].label`),
      moves,
    };
  });
  return { schemaVersion: 1, revision: 0, characters };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function createMoveCatalogStore(userDataPath) {
  const catalogPath = path.join(userDataPath, catalogFileName);
  const backupPath = path.join(userDataPath, catalogBackupFileName);

  function load() {
    for (const candidatePath of [catalogPath, backupPath]) {
      try {
        const rawCatalog = readJson(candidatePath);
        const catalog = validateCatalog(rawCatalog);
        const revision = Number(rawCatalog.revision);
        return {
          catalog: {
            ...catalog,
            revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
          },
          path: catalogPath,
          recoveredFromBackup: candidatePath === backupPath,
        };
      } catch {
        // Try the backup before falling back to an empty catalog.
      }
    }
    return { catalog: defaultCatalog(), path: catalogPath, recoveredFromBackup: false };
  }

  function save(candidate, expectedRevision) {
    const current = load();
    if (!Number.isInteger(expectedRevision) || expectedRevision !== current.catalog.revision) {
      throw new Error("The move catalog changed in another window. Reload it before saving.");
    }
    const validated = validateCatalog(candidate);
    const catalog = { ...validated, revision: current.catalog.revision + 1 };
    fs.mkdirSync(userDataPath, { recursive: true });
    if (fs.existsSync(catalogPath)) fs.copyFileSync(catalogPath, backupPath);
    const temporaryPath = `${catalogPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(catalog, null, 2), "utf8");
    fs.renameSync(temporaryPath, catalogPath);
    return { catalog, path: catalogPath, recoveredFromBackup: false };
  }

  return { load, save };
}

module.exports = { createMoveCatalogStore, defaultCatalog, validateCatalog };
