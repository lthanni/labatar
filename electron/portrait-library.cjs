const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const supportMap = require("./support-map.json");

const portraitFilePattern =
  /^sprites~([a-z0-9_]+)~hud~art~(portraitart|support[1-3](?:-[a-z0-9_-]+)?)\.png$/i;
const assetFilePattern = /^(portrait|support[1-3](?:-[a-z0-9_-]+)?)\.png$/i;
const characterAliases = {
  "avatar aang": "aang_avchar",
  "nightmare korra": "korra_nightmare",
};

function portraitAssetFromFilename(filename) {
  const match = portraitFilePattern.exec(filename);
  if (!match) return null;
  return {
    characterId: match[1].toLowerCase(),
    assetName: match[2].toLowerCase() === "portraitart" ? "portrait" : match[2].toLowerCase(),
  };
}

async function findPortraitAssets(directory, current = directory, signal) {
  if (signal?.aborted) throw new Error("Portrait import cancelled.");
  const entries = await fs.promises.readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (signal?.aborted) throw new Error("Portrait import cancelled.");
    const filePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findPortraitAssets(directory, filePath, signal)));
    } else if (entry.isFile()) {
      const asset = portraitAssetFromFilename(entry.name);
      if (asset) files.push({ ...asset, sourcePath: filePath });
    }
  }
  return files;
}

async function publishPortraits(decodedDirectory, libraryDirectory, signal) {
  const assets = await findPortraitAssets(decodedDirectory, decodedDirectory, signal);
  for (const asset of assets) {
    if (signal?.aborted) throw new Error("Portrait import cancelled.");
    const targetDirectory = path.join(libraryDirectory, "characters", asset.characterId);
    await fs.promises.mkdir(targetDirectory, { recursive: true });
    const temporaryPath = path.join(targetDirectory, `.portrait-${randomUUID()}.tmp`);
    try {
      await fs.promises.copyFile(asset.sourcePath, temporaryPath);
      if (signal?.aborted) throw new Error("Portrait import cancelled.");
      await fs.promises.rename(temporaryPath, path.join(targetDirectory, `${asset.assetName}.png`));
    } finally {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
  return assets.length;
}

async function readPortraitCatalog(libraryDirectory) {
  const root = path.join(libraryDirectory, "characters");
  const directories = await fs.promises.readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const catalog = {};
  for (const directory of directories) {
    if (!directory.isDirectory() || !/^[a-z0-9_]+$/.test(directory.name)) continue;
    const names = await fs.promises.readdir(path.join(root, directory.name)).catch(() => []);
    const assets = names.filter((name) => assetFilePattern.test(name));
    if (assets.length > 0) catalog[directory.name] = new Set(assets);
  }
  return catalog;
}

function characterIdForName(character) {
  const name = String(character ?? "")
    .trim()
    .toLowerCase();
  if (!name) return null;
  return characterAliases[name] ?? name.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function supportIdForName(character, support) {
  const normalizedSupport = String(support ?? "")
    .trim()
    .toLowerCase();
  if (!normalizedSupport || normalizedSupport === "none") return null;
  const supportNumber = /^support\s*#?\s*([1-3])$/i.exec(normalizedSupport)?.[1];
  if (supportNumber) return supportNumber;
  const characterId = characterIdForName(character);
  const names = {
    aang_avchar: "Avatar Aang",
    korra_nightmare: "Nightmare Korra",
  };
  const mappedName =
    names[characterId] ??
    Object.keys(supportMap).find((name) => characterIdForName(name) === characterId);
  const entry = supportMap[mappedName];
  return (
    Object.entries(entry ?? {}).find(([, name]) => name.toLowerCase() === normalizedSupport)?.[0] ??
    null
  );
}

function portraitUrl(characterId, assetName, catalog) {
  if (!catalog[characterId]?.has(`${assetName}.png`)) return null;
  return `labatar-media://portrait/${characterId}/${assetName}.png`;
}

function usefulPlayerName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  return name && !/^(?:p[12]|player\s*[12]|unknown)$/i.test(name) ? name : null;
}

function portraitArtwork(character, support, catalog) {
  const characterId = characterIdForName(character);
  const supportId = supportIdForName(character, support);
  return {
    portraitUrl: characterId ? portraitUrl(characterId, "portrait", catalog) : null,
    supportUrl:
      characterId && supportId ? portraitUrl(characterId, `support${supportId}`, catalog) : null,
  };
}

function missingPortraitArtwork(catalog) {
  const missing = [];
  for (const character of Object.keys(supportMap)) {
    if (!portraitArtwork(character, "", catalog).portraitUrl) {
      missing.push(`${character} portrait`);
    }
    for (const slot of [1, 2, 3]) {
      if (!portraitArtwork(character, `Support #${slot}`, catalog).supportUrl) {
        missing.push(`${character} support #${slot}`);
      }
    }
  }
  return missing;
}

function portraitPlayerNameHints(recordings) {
  const hints = new Map();
  const newestFirst = [...recordings].sort(
    (left, right) => (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0),
  );
  for (const recording of newestFirst) {
    for (const game of recording.games ?? []) {
      for (const slot of [1, 2]) {
        const steamId = game?.metadata?.[`player${slot}SteamId`];
        const name = usefulPlayerName(game?.replay?.[`player${slot}`]);
        if (steamId && name && !hints.has(steamId)) hints.set(steamId, name);
      }
    }
  }
  return hints;
}

function portraitSide(character, support, playerName, catalog, slot) {
  const name = typeof playerName === "string" ? playerName.trim() : "";
  const characterId = characterIdForName(character);
  if (!characterId)
    return {
      slot,
      playerName: name || `Player ${slot}`,
      character: "Unknown",
      support: null,
      portraitUrl: null,
      supportUrl: null,
    };
  const supportId = supportIdForName(character, support);
  const artwork = portraitArtwork(character, support, catalog);
  return {
    slot,
    playerName: name || `Player ${slot}`,
    character: String(character).trim(),
    support: supportId ? String(support).trim() : null,
    ...artwork,
  };
}

function portraitMatchup(recording, catalog, playerNameHints = new Map()) {
  const games = Array.isArray(recording.games) ? recording.games : [];
  const linkedGame = games.find(
    (game) => game?.replay?.player1Character || game?.metadata?.player1Character,
  );
  const replay = linkedGame
    ? linkedGame.replay
    : recording.replays?.find((entry) => entry?.replay)?.replay;
  const metadata = linkedGame?.metadata ?? recording.metadata;
  const p1 = replay?.player1Character ?? metadata?.player1Character;
  const p2 = replay?.player2Character ?? metadata?.player2Character;
  if (!p1 && !p2) return null;
  const playerName = (slot) =>
    usefulPlayerName(replay?.[`player${slot}`]) ??
    usefulPlayerName(metadata?.[`player${slot}Name`]) ??
    playerNameHints.get(metadata?.[`player${slot}SteamId`]) ??
    null;
  return {
    players: [
      portraitSide(p1, replay?.player1Support, playerName(1), catalog, 1),
      portraitSide(p2, replay?.player2Support, playerName(2), catalog, 2),
    ],
    gameCount: games.length,
    gameNumber: linkedGame?.gameNumber ?? null,
  };
}

module.exports = {
  portraitAssetFromFilename,
  findPortraitAssets,
  publishPortraits,
  readPortraitCatalog,
  characterIdForName,
  supportIdForName,
  portraitPlayerNameHints,
  portraitArtwork,
  missingPortraitArtwork,
  portraitMatchup,
};
