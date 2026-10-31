const { pressureGameItems } = require("./pressure-framebar.cjs");

const sceneName = "Labatar - Game";
const sceneCollectionName = "Labatar";
const inputNames = {
  game: "Labatar - Atla.exe Game Capture",
  gameAudio: "Labatar - Atla.exe Audio",
  desktopAudio: "Labatar - Desktop Audio",
  microphone: "Labatar - Microphone",
};
const toggleKeys = ["pressureFramebar", "gameAudio", "desktopAudio", "microphone"];

function legacySceneToggles(name) {
  return {
    pressureFramebar: name === "Labatar - Labbing Pressure Framebar",
    gameAudio: name === "Labatar - Game Only" || name === "Labatar - Game + Mic",
    desktopAudio: name === "Labatar - Game + Desktop + Mic",
    microphone: name === "Labatar - Game + Mic" || name === "Labatar - Game + Desktop + Mic",
  };
}

function sceneTogglesFromItems(items) {
  const gameItems = pressureGameItems(items, inputNames.game);
  const enabled = (name) =>
    Boolean(items.find((item) => item.sourceName === name)?.sceneItemEnabled);
  return {
    pressureFramebar: Boolean(gameItems[1]?.sceneItemEnabled),
    gameAudio: enabled(inputNames.gameAudio),
    desktopAudio: enabled(inputNames.desktopAudio),
    microphone: enabled(inputNames.microphone),
  };
}

function updateSceneToggles(current, key, enabled, { gameAudioAvailable = true } = {}) {
  if (!toggleKeys.includes(key) || typeof enabled !== "boolean") {
    throw new Error("Invalid OBS source toggle.");
  }
  const next = { ...current, [key]: enabled };
  if (enabled && key === "gameAudio") next.desktopAudio = false;
  if (enabled && key === "desktopAudio") next.gameAudio = false;
  if (!enabled && key === "desktopAudio" && gameAudioAvailable) next.gameAudio = true;
  return next;
}

async function disableAutomaticPressureFramebar(client) {
  const collection = await client.call("GetSceneCollectionList");
  if (collection.currentSceneCollectionName !== sceneCollectionName) return false;
  const { scenes = [] } = await client.call("GetSceneList");
  if (!scenes.some((scene) => scene.sceneName === sceneName)) return false;
  const { sceneItems = [] } = await client.call("GetSceneItemList", { sceneName });
  const overlayItem = pressureGameItems(sceneItems, inputNames.game)[1];
  if (!overlayItem?.sceneItemEnabled) return false;
  await client.call("SetSceneItemEnabled", {
    sceneName,
    sceneItemId: overlayItem.sceneItemId,
    sceneItemEnabled: false,
  });
  return true;
}

module.exports = {
  sceneName,
  inputNames,
  toggleKeys,
  legacySceneToggles,
  sceneTogglesFromItems,
  updateSceneToggles,
  disableAutomaticPressureFramebar,
};
