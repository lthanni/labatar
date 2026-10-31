const assert = require("node:assert/strict");
const test = require("node:test");
const {
  inputNames,
  legacySceneToggles,
  sceneTogglesFromItems,
  updateSceneToggles,
  disableAutomaticPressureFramebar,
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

void test("automatic recording hides only the upper game crop in the managed OBS scene", async () => {
  const calls = [];
  const client = {
    async call(method, request) {
      calls.push({ method, request });
      if (method === "GetSceneCollectionList") return { currentSceneCollectionName: "Labatar" };
      if (method === "GetSceneList") return { scenes: [{ sceneName: "Labatar - Game" }] };
      if (method === "GetSceneItemList") {
        return {
          sceneItems: [
            {
              sourceName: inputNames.game,
              sceneItemIndex: 4,
              sceneItemId: 20,
              sceneItemEnabled: true,
            },
            {
              sourceName: inputNames.game,
              sceneItemIndex: 3,
              sceneItemId: 10,
              sceneItemEnabled: true,
            },
          ],
        };
      }
      if (method === "SetSceneItemEnabled") return {};
      throw new Error(`Unexpected OBS call: ${method}`);
    },
  };
  assert.equal(await disableAutomaticPressureFramebar(client), true);
  assert.deepEqual(calls.at(-1), {
    method: "SetSceneItemEnabled",
    request: { sceneName: "Labatar - Game", sceneItemId: 20, sceneItemEnabled: false },
  });
});

void test("automatic framebar switch leaves other scene collections alone", async () => {
  const calls = [];
  const client = {
    async call(method) {
      calls.push(method);
      return { currentSceneCollectionName: "Personal" };
    },
  };
  assert.equal(await disableAutomaticPressureFramebar(client), false);
  assert.deepEqual(calls, ["GetSceneCollectionList"]);
});
