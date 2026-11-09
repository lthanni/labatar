const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  createComboInputCapture,
  playerOnePadBindings,
  trimComboInputCapture,
} = require("./combo-input-timeline.cjs");

void test("Player 1 controller bindings are snapshotted without using Player 2", () => {
  const config = [
    "# Player 1",
    "Device 0 PAD_BTN_2 -> Atk1",
    "Device 0 PAD_BTN_3 -> Atk2",
    "#-------",
    "Player 2",
    "Device 0 PAD_BTN_2 -> Atk4",
  ].join("\n");
  assert.deepEqual(playerOnePadBindings(config), { X: "Atk1", Y: "Atk2" });
});

void test("controller states use video time and preserve button holds across a trim", () => {
  const capture = createComboInputCapture({
    startAtMs: 10_000,
    endAtMs: 20_000,
    deviceIndex: 0,
    bindings: { X: "Atk1" },
    rawStates: [
      { atMs: 9_900, direction: 5, buttons: [] },
      { atMs: 12_000, direction: 2, buttons: [] },
      { atMs: 12_080, direction: 3, buttons: [] },
      { atMs: 12_160, direction: 6, buttons: ["X"] },
      { atMs: 12_300, direction: 5, buttons: [] },
    ],
  });
  assert.deepEqual(
    capture.states.map((state) => [state.timeMs, state.direction, state.actions]),
    [
      [0, 5, []],
      [2000, 2, []],
      [2080, 3, []],
      [2160, 6, ["Atk1"]],
      [2300, 5, []],
    ],
  );
  const trimmed = trimComboInputCapture(capture, 2.1, 2.25);
  assert.equal(trimmed.durationMs, 150);
  assert.deepEqual(
    trimmed.states.map((state) => [state.timeMs, state.direction, state.buttons]),
    [
      [0, 3, []],
      [60, 6, ["X"]],
    ],
  );
  assert.deepEqual(
    trimComboInputCapture(trimmed, 0.05, 0.1).states.map((state) => state.timeMs),
    [0, 10],
  );
});

void test("paused intervals do not accumulate video time and resume with the held state", () => {
  const capture = createComboInputCapture({
    startAtMs: 1000,
    endAtMs: 5000,
    deviceIndex: 0,
    bindings: {},
    pauses: [{ startMs: 2000, endMs: 3000 }],
    rawStates: [
      { atMs: 900, direction: 5, buttons: [] },
      { atMs: 1500, direction: 2, buttons: [] },
      { atMs: 2500, direction: 6, buttons: ["A"] },
      { atMs: 3500, direction: 5, buttons: [] },
    ],
  });
  assert.equal(capture.durationMs, 3000);
  assert.deepEqual(
    capture.states.map((state) => [state.timeMs, state.direction]),
    [
      [0, 5],
      [500, 2],
      [1000, 6],
      [1500, 5],
    ],
  );
});
