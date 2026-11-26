const assert = require("node:assert/strict");
const test = require("node:test");
const {
  inputNames,
  isLabatarOwnedName,
  legacySceneToggles,
  sceneTogglesFromItems,
  updateSceneToggles,
  setCaptureVideo,
  disableAutomaticPressureFramebar,
} = require("../../electron/obs-scene-toggles.cjs");

void test("recognizes only Labatar-named OBS entries as managed", () => {
  for (const name of ["Labatar", "Labatar Recording", "Labatar - Game"]) {
    assert.equal(isLabatarOwnedName(name), true);
  }
  for (const name of ["Desktop", "Game", "Labatarized", "labatar Recording", null, 42]) {
    assert.equal(isLabatarOwnedName(name), false);
  }
});

void test("adopts each legacy scene's visible sources", () => {
  assert.deepEqual(legacySceneToggles("Labatar - Game Only"), {
    monitorCapture: false,
    pressureFramebar: false,
    gameAudio: true,
    desktopAudio: false,
    microphone: false,
  });
  assert.deepEqual(legacySceneToggles("Labatar - Game + Desktop + Mic"), {
    monitorCapture: false,
    pressureFramebar: false,
    gameAudio: false,
    desktopAudio: true,
    microphone: true,
  });
  assert.deepEqual(legacySceneToggles("Labatar - Labbing Pressure Framebar"), {
    monitorCapture: false,
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
    monitorCapture: false,
    gameOnly: true,
    pressureFramebar: true,
    gameAudio: false,
    desktopAudio: true,
    microphone: true,
  });
});

const canvas = { baseWidth: 2560, baseHeight: 1440 };
const captureItems = [
  { sourceName: inputNames.game, sceneItemIndex: 0, sceneItemId: 10, sceneItemEnabled: false },
  { sourceName: inputNames.game, sceneItemIndex: 1, sceneItemId: 20, sceneItemEnabled: false },
  { inputKind: "window_capture_v2", sceneItemId: 30, sceneItemEnabled: true },
  {
    sourceName: "Display Capture",
    inputKind: "monitor_capture",
    sceneItemId: 40,
    sceneItemEnabled: true,
  },
  { inputKind: "wasapi_output_capture", sceneItemId: 50, sceneItemEnabled: true },
];

function fakeCaptureClient(call) {
  const changes = [];
  return {
    changes,
    async call(method, request) {
      if (method === "SetSceneItemEnabled") {
        changes.push([request.sceneItemId, request.sceneItemEnabled]);
        return {};
      }
      if (!call) throw new Error(`Unexpected OBS call: ${method}`);
      return call(method, request);
    },
  };
}

void test("Game only hides the existing display and window without changing audio", async () => {
  const client = fakeCaptureClient();
  assert.equal(sceneTogglesFromItems(captureItems).monitorCapture, true);
  assert.equal(sceneTogglesFromItems(captureItems).gameOnly, false);
  await setCaptureVideo(client, captureItems, false, canvas);
  assert.deepEqual(client.changes, [
    [30, false],
    [40, false],
    [10, true],
  ]);
});

void test("Monitor capture reuses the configured display and hides both game items", async () => {
  const calls = [];
  const client = fakeCaptureClient((method, request) => {
    calls.push({ method, request });
    if (method === "GetInputSettings") return { inputSettings: { monitor_id: "second" } };
    if (method === "GetInputPropertiesListPropertyItems") {
      return {
        propertyItems: [
          { itemEnabled: true, itemValue: "first" },
          { itemEnabled: true, itemValue: "second" },
        ],
      };
    }
    if (method === "SetSceneItemTransform") return {};
    throw new Error(`Unexpected OBS call: ${method}`);
  });
  const gameItems = captureItems.map((item) => ({
    ...item,
    sceneItemEnabled: item.sceneItemId !== 40,
  }));
  await setCaptureVideo(client, gameItems, true, canvas);
  assert.equal(calls[0].request.inputName, "Display Capture");
  const transform = calls.at(-1).request.sceneItemTransform;
  assert.equal(transform.boundsType, "OBS_BOUNDS_SCALE_INNER");
  assert.equal(transform.boundsWidth, canvas.baseWidth);
  assert.equal(transform.boundsHeight, canvas.baseHeight);
  assert.deepEqual(client.changes, [
    [10, false],
    [20, false],
    [30, false],
    [40, true],
  ]);
});

void test("first use creates a hidden monitor source and configures an available display", async () => {
  const replies = {
    GetInputList: { inputs: [] },
    CreateInput: { sceneItemId: 60 },
    GetInputSettings: { inputSettings: {} },
    GetInputPropertiesListPropertyItems: {
      propertyItems: [
        { itemEnabled: false, itemValue: "DUMMY" },
        { itemEnabled: true, itemValue: "monitor-1" },
      ],
    },
    SetInputSettings: {},
    SetSceneItemTransform: {},
  };
  const calls = [];
  const client = fakeCaptureClient((method, request) => {
    calls.push({ method, request });
    assert.ok(method in replies, `Unexpected OBS call: ${method}`);
    return replies[method];
  });
  await setCaptureVideo(client, captureItems.slice(0, 2), true, canvas);
  assert.equal(
    calls.find(({ method }) => method === "CreateInput").request.sceneItemEnabled,
    false,
  );
  assert.deepEqual(
    calls.find(({ method }) => method === "SetInputSettings").request.inputSettings,
    {
      monitor_id: "monitor-1",
    },
  );
  assert.deepEqual(client.changes, [[60, true]]);
});

void test("a disconnected configured display leaves the current capture visible", async () => {
  const client = fakeCaptureClient((method) => {
    if (method === "GetInputSettings") return { inputSettings: { monitor_id: "offline" } };
    if (method === "GetInputPropertiesListPropertyItems") {
      return { propertyItems: [{ itemEnabled: true, itemValue: "another-display" }] };
    }
    throw new Error(`Unexpected OBS call: ${method}`);
  });
  const items = captureItems.map((item) => ({
    ...item,
    sceneItemEnabled: item.sceneItemId === 10,
  }));
  await assert.rejects(setCaptureVideo(client, items, true, canvas), /unavailable/);
  assert.deepEqual(client.changes, []);
});

void test("a failed switch restores capture items already hidden", async () => {
  const changes = [];
  const client = {
    async call(method, { sceneItemId, sceneItemEnabled }) {
      assert.equal(method, "SetSceneItemEnabled");
      changes.push([sceneItemId, sceneItemEnabled]);
      if (sceneItemId === 10) throw new Error("Game could not be enabled");
    },
  };
  await assert.rejects(
    setCaptureVideo(client, captureItems, false, canvas),
    /could not be enabled/,
  );
  assert.deepEqual(changes, [
    [30, false],
    [40, false],
    [10, true],
    [40, true],
    [30, true],
  ]);
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
