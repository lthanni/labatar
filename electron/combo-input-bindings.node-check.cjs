const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_COMBO_INPUT_BINDINGS,
  validateComboInputBindings,
} = require("./combo-input-bindings.cjs");
const {
  ensureProcessedComboInput,
  processComboInputCapture,
  writeComboInputEdits,
} = require("./combo-input-processing.cjs");
const { buildComboInputOverlayAss } = require("./combo-input-overlay.cjs");

void test("default controller bindings match the game button layout", () => {
  assert.deepEqual(DEFAULT_COMBO_INPUT_BINDINGS, {
    X: "Atk1",
    Y: "Atk2",
    B: "Atk3",
    A: "Atk4",
    RB: "DashShortcut",
    RT: "SuperShortcut",
    LB: "ThrowShortcut",
    LT: "GuardReversalShortcut",
  });
  assert.deepEqual(validateComboInputBindings({ LT: "GuardReversalShortcut" }), {
    LT: "GuardReversalShortcut",
  });
  assert.throws(() => validateComboInputBindings({ Guide: "Atk1" }), /Invalid controller/);
  assert.throws(() => validateComboInputBindings({ LT: "Unsupported" }), /Invalid controller/);
  assert.deepEqual(validateComboInputBindings({ RB: "Atk8" }, { allowLegacy: true }), {
    RB: "Atk8",
  });
});

void test("shortcut presses render throw notation and retain their physical button evidence", async () => {
  const states = [
    { timeMs: 0, direction: 5, stickDirection: 5, buttons: [], actions: [] },
    { timeMs: 10, direction: 5, stickDirection: 5, buttons: ["LT"], actions: [] },
    { timeMs: 20, direction: 5, stickDirection: 5, buttons: [], actions: [] },
    { timeMs: 30, direction: 5, stickDirection: 5, buttons: ["RT"], actions: [] },
    { timeMs: 40, direction: 5, stickDirection: 5, buttons: [], actions: [] },
    { timeMs: 50, direction: 5, stickDirection: 5, buttons: ["RB"], actions: [] },
    { timeMs: 60, direction: 5, stickDirection: 5, buttons: [], actions: [] },
    { timeMs: 70, direction: 6, stickDirection: 5, buttons: ["LB"], actions: [] },
    { timeMs: 80, direction: 5, stickDirection: 5, buttons: [], actions: [] },
    { timeMs: 90, direction: 6, stickDirection: 5, buttons: ["LB"], actions: [] },
  ];
  const capture = {
    schemaVersion: 1,
    source: "xinput",
    deviceIndex: 0,
    bindings: {},
    status: "complete",
    timing: "approximate",
    durationMs: 110,
    states,
  };
  const result = processComboInputCapture(capture, undefined, 0, {
    schemaVersion: 1,
    presses: { "90:LB": { togglePosition: true } },
    bindings: {
      LT: "GuardReversalShortcut",
      RT: "SuperShortcut",
      RB: "DashShortcut",
      LB: "ThrowShortcut",
    },
  });
  assert.equal(result.routes.right, "5C+F 5A+B+C 5B+C TH j.TH");
  assert.equal(result.routes.left, result.routes.right);
  assert.equal(result.presses[3].gameButton, "TH");
  assert.equal(result.presses[3].interpretations.right.direction, 6);
  assert.equal(result.presses[3].interpretations.left.direction, 4);
  const { validateProcessedComboInput } = await import("../backend/src/processed-combo-input.mjs");
  assert.equal(validateProcessedComboInput(result), result);
  const subtitles = buildComboInputOverlayAss(result, capture, capture.durationMs);
  assert.match(subtitles, /5C\+F/);
  assert.match(subtitles, /5A\+B\+C/);
  assert.match(subtitles, /5B\+C/);
  assert.match(subtitles, /\}TH/);
  assert.match(subtitles, /\}j\.TH/);
  assert.doesNotMatch(subtitles, /A\+F/);
  assert.doesNotMatch(subtitles, /Controller LT|Controller RT/);
  assert.deepEqual(
    result.presses.map((press) => press.physicalButton),
    ["LT", "RT", "RB", "LB", "LB"],
  );
  assert.deepEqual(states[1].actions, []);
  assert.deepEqual(capture.bindings, {});
});

void test("a saved binding override changes reprocessing without modifying the capture", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-binding-"));
  const videoPath = path.join(directory, "capture.mp4");
  const capture = {
    schemaVersion: 1,
    source: "xinput",
    deviceIndex: 0,
    bindings: {},
    status: "complete",
    timing: "approximate",
    durationMs: 30,
    states: [
      { timeMs: 0, direction: 5, stickDirection: 5, buttons: [], actions: [] },
      { timeMs: 10, direction: 5, stickDirection: 5, buttons: ["LT"], actions: [] },
      { timeMs: 20, direction: 5, stickDirection: 5, buttons: [], actions: [] },
    ],
  };
  try {
    const before = await ensureProcessedComboInput(videoPath, capture, 0);
    assert.equal(before.routes.right, "");
    await writeComboInputEdits(videoPath, {
      schemaVersion: 1,
      presses: {},
      bindings: { LT: "GuardReversalShortcut" },
    });
    const after = await ensureProcessedComboInput(videoPath, capture, 0);
    assert.equal(after.routes.right, "5C+F");
    assert.deepEqual(capture.bindings, {});
    assert.deepEqual(capture.states[1].actions, []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
