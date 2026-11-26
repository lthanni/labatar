const { pressureGameItems } = require("./pressure-framebar.cjs");

const sceneName = "Labatar - Game";
const sceneCollectionName = "Labatar";
const inputNames = {
  game: "Labatar - Atla.exe Game Capture",
  monitor: "Labatar - Monitor Capture",
  gameAudio: "Labatar - Atla.exe Audio",
  desktopAudio: "Labatar - Desktop Audio",
  microphone: "Labatar - Microphone",
};
const toggleKeys = [
  "monitorCapture",
  "pressureFramebar",
  "gameAudio",
  "desktopAudio",
  "microphone",
];

function isMonitorCapture(item) {
  return /^monitor_capture(?:_v\d+)?$/.test(item.inputKind ?? "");
}

function isVideoCapture(item) {
  return (
    item.sourceName === inputNames.game ||
    /^(?:monitor|window|game)_capture(?:_v\d+)?$/.test(item.inputKind ?? "")
  );
}

function isLabatarOwnedName(name) {
  return typeof name === "string" && /^Labatar(?:$|[\s-])/.test(name);
}

function legacySceneToggles(name) {
  return {
    monitorCapture: false,
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
    monitorCapture: items.some((item) => isMonitorCapture(item) && item.sceneItemEnabled),
    gameOnly:
      Boolean(gameItems[0]?.sceneItemEnabled) &&
      !items.some(
        (item) =>
          item.sceneItemEnabled &&
          item !== gameItems[0] &&
          item !== gameItems[1] &&
          isVideoCapture(item),
      ),
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

async function prepareMonitorCapture(client, items, videoSettings) {
  let monitor = items.find(isMonitorCapture);
  if (!monitor) {
    const { inputs = [] } = await client.call("GetInputList");
    const existing = inputs.find((input) => input.inputName === inputNames.monitor);
    let response;
    if (existing) {
      if (!isMonitorCapture(existing)) {
        throw new Error(
          `OBS source "${inputNames.monitor}" is already in use by another source type.`,
        );
      }
      response = await client.call("CreateSceneItem", {
        sceneName,
        sourceName: inputNames.monitor,
        sceneItemEnabled: false,
      });
    } else {
      response = await client.call("CreateInput", {
        sceneName,
        inputName: inputNames.monitor,
        inputKind: "monitor_capture",
        sceneItemEnabled: false,
      });
    }
    monitor = {
      sourceName: inputNames.monitor,
      inputKind: "monitor_capture",
      sceneItemId: response.sceneItemId,
      sceneItemEnabled: false,
    };
  }

  const inputName = monitor.sourceName;
  const { inputSettings } = await client.call("GetInputSettings", { inputName });
  const { propertyItems = [] } = await client.call("GetInputPropertiesListPropertyItems", {
    inputName,
    propertyName: "monitor_id",
  });
  const displays = propertyItems.filter(
    (item) => item.itemEnabled && typeof item.itemValue === "string" && item.itemValue,
  );
  const monitorId = inputSettings?.monitor_id;
  if (!monitorId || monitorId === "DUMMY") {
    if (!displays.length) throw new Error("OBS did not find a monitor to capture.");
    await client.call("SetInputSettings", {
      inputName,
      inputSettings: { monitor_id: displays[0].itemValue },
      overlay: true,
    });
  } else if (!displays.some((display) => display.itemValue === monitorId)) {
    throw new Error(
      `The display for "${inputName}" is unavailable. Select a connected display in OBS.`,
    );
  }

  const { baseWidth, baseHeight } = videoSettings ?? {};
  if (!(baseWidth > 0 && baseHeight > 0)) {
    throw new Error("OBS did not report a recording canvas size.");
  }
  await client.call("SetSceneItemTransform", {
    sceneName,
    sceneItemId: monitor.sceneItemId,
    sceneItemTransform: {
      alignment: 5,
      positionX: 0,
      positionY: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      cropLeft: 0,
      cropTop: 0,
      cropRight: 0,
      cropBottom: 0,
      boundsType: "OBS_BOUNDS_SCALE_INNER",
      boundsAlignment: 0,
      boundsWidth: baseWidth,
      boundsHeight: baseHeight,
    },
  });
  return monitor;
}

async function setCaptureVideo(client, items, monitorCapture, videoSettings) {
  const [game, crop] = pressureGameItems(items, inputNames.game);
  if (!game) throw new Error("Apply Labatar OBS setup before changing the video source.");
  const selected = monitorCapture
    ? await prepareMonitorCapture(client, items, videoSettings)
    : game;
  const hidden = items.filter(
    (item) =>
      item.sceneItemId !== selected.sceneItemId &&
      (item !== crop || monitorCapture) &&
      isVideoCapture(item) &&
      item.sceneItemEnabled,
  );
  const changes = hidden.map((item) => [item, false]);
  if (!selected.sceneItemEnabled) changes.push([selected, true]);

  const setEnabled = (item, sceneItemEnabled) =>
    client.call("SetSceneItemEnabled", {
      sceneName,
      sceneItemId: item.sceneItemId,
      sceneItemEnabled,
    });
  const applied = [];
  try {
    for (const [item, enabled] of changes) {
      await setEnabled(item, enabled);
      applied.push(item);
    }
  } catch (error) {
    for (const item of applied.reverse()) {
      await setEnabled(item, item.sceneItemEnabled).catch(() => undefined);
    }
    throw error;
  }
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
  isLabatarOwnedName,
  legacySceneToggles,
  sceneTogglesFromItems,
  updateSceneToggles,
  setCaptureVideo,
  disableAutomaticPressureFramebar,
};
