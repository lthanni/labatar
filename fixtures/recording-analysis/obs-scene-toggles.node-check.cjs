const assert = require("node:assert/strict");
const test = require("node:test");
const {
  inputNames,
  legacySceneToggles,
  sceneTogglesFromItems,
  updateSceneToggles,
} = require("../../electron/obs-scene-toggles.cjs");

void test("adopts each legacy scene's visible sources", () => {
  assert.deepEqual(legacySceneToggles("Labatar - Game Only"), {
    pressureFramebar: false,
    gameAudio: true,
    desktopAudio: false,
    microphone: false,
  });
  assert.deepEqual(legacySceneToggles("Labatar - Game + Desktop + Mic"), {
    pressureFramebar: false,
    gameAudio: false,
    desktopAudio: true,
    microphone: true,
  });
  assert.deepEqual(legacySceneToggles("Labatar - Labbing Pressure Framebar"), {
    pressureFramebar: true,
    gameAudio: false,
    desktopAudio: false,
    microphone: false,
  });
});

void test("reads the cropped game item separately from the full capture", () => {
  const items = [
    { sourceName: inputNames.game, sceneItemIndex: 4, sceneItemEnabled: true },
    { sourceName: inputNames.gameAudio, sceneItemIndex: 0, sceneItemEnabled: false },
    { sourceName: inputNames.game, sceneItemIndex: 3, sceneItemEnabled: true },
    { sourceName: inputNames.desktopAudio, sceneItemIndex: 1, sceneItemEnabled: true },
    { sourceName: inputNames.microphone, sceneItemIndex: 2, sceneItemEnabled: true },
  ];
  assert.deepEqual(sceneTogglesFromItems(items), {
    pressureFramebar: true,
    gameAudio: false,
    desktopAudio: true,
    microphone: true,
  });
});

void test("enabling either audio source turns off the other", () => {
  const game = legacySceneToggles("Labatar - Game Only");
  assert.deepEqual(updateSceneToggles(game, "desktopAudio", true), {
    ...game,
    gameAudio: false,
    desktopAudio: true,
  });
  assert.deepEqual(
    updateSceneToggles({ ...game, gameAudio: false, desktopAudio: true }, "gameAudio", true),
    game,
  );
  assert.throws(() => updateSceneToggles(game, "unknown", true), /Invalid/);
});

void test("turning off desktop audio restores the separate game audio source", () => {
  const desktop = legacySceneToggles("Labatar - Game + Desktop + Mic");
  assert.deepEqual(updateSceneToggles(desktop, "desktopAudio", false), {
    ...desktop,
    gameAudio: true,
    desktopAudio: false,
  });
  assert.deepEqual(
    updateSceneToggles(desktop, "desktopAudio", false, { gameAudioAvailable: false }),
    { ...desktop, desktopAudio: false },
  );
});
