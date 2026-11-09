const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  ensureOriginalComboInput,
  ensureProcessedComboInput,
  originalComboInputPath,
  pressEditKey,
  processComboInputCapture,
  processedComboInputPath,
  writeComboInputEdits,
} = require("./combo-input-processing.cjs");
const { trimComboInputCapture } = require("./combo-input-timeline.cjs");

const capture = {
  schemaVersion: 1,
  source: "xinput",
  deviceIndex: 0,
  bindings: { X: "Atk1", B: "Atk3", RB: "Atk8" },
  status: "complete",
  timing: "approximate",
  durationMs: 1000,
  states: [
    { timeMs: 0, direction: 5, stickDirection: 5, buttons: [], actions: [] },
    { timeMs: 100, direction: 2, stickDirection: 5, buttons: [], actions: [] },
    { timeMs: 150, direction: 3, stickDirection: 5, buttons: [], actions: [] },
    { timeMs: 200, direction: 6, stickDirection: 5, buttons: [], actions: [] },
    { timeMs: 220, direction: 6, stickDirection: 5, buttons: ["B"], actions: ["Atk3"] },
    { timeMs: 260, direction: 5, stickDirection: 5, buttons: [], actions: [] },
    { timeMs: 500, direction: 2, stickDirection: 5, buttons: ["X"], actions: ["Atk1"] },
    {
      timeMs: 540,
      direction: 2,
      stickDirection: 5,
      buttons: ["X", "RB"],
      actions: ["Atk1", "Atk8"],
    },
  ],
};

void test("processes 2, 3, 6, 6+C as 236C with physical-button evidence", () => {
  const result = processComboInputCapture(capture, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(result.context, { defaultFacing: "right", defaultPosition: "grounded" });
  assert.equal(result.routes.right, "236C 2A");
  assert.deepEqual(
    result.directionChanges.map((event) => event.direction),
    [5, 2, 3, 6, 5, 2],
  );
  assert.deepEqual(result.presses[0], {
    timeMs: 220,
    sourceStateIndex: 4,
    physicalButton: "B",
    gameAction: "Atk3",
    gameButton: "C",
    context: { facing: "right", position: "grounded" },
    positionAfter: null,
    manualEdit: null,
    interpretations: {
      right: {
        direction: 6,
        motion: "236",
        directionPath: "5236",
        suggestedNotation: "236C",
        notation: "236C",
      },
      left: {
        direction: 4,
        motion: "214",
        directionPath: "5214",
        suggestedNotation: "214C",
        notation: "214C",
      },
    },
  });
  assert.equal(result.presses[2].gameAction, "Atk8");
  assert.equal(result.presses[2].interpretations.right.notation, null);
});

void test("manual move labels and position changes survive reprocessing and a later trim", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-combo-edits-"));
  const videoPath = path.join(directory, "combo.mp4");
  const input = {
    ...capture,
    states: [
      ...capture.states.slice(0, 7),
      { timeMs: 600, direction: 5, stickDirection: 5, buttons: [], actions: [] },
      { timeMs: 750, direction: 5, stickDirection: 5, buttons: ["B"], actions: ["Atk3"] },
      { timeMs: 800, direction: 5, stickDirection: 5, buttons: [], actions: [] },
      { timeMs: 900, direction: 5, stickDirection: 5, buttons: ["X"], actions: ["Atk1"] },
    ],
  };
  try {
    const edits = {
      schemaVersion: 1,
      presses: {
        [pressEditKey(220, "B")]: { notation: "236X" },
        [pressEditKey(500, "X")]: { notation: "XX", separator: "~", positionAfter: "airborne" },
        [pressEditKey(750, "B")]: { positionAfter: "grounded" },
      },
    };
    await writeComboInputEdits(videoPath, edits);
    const original = await ensureProcessedComboInput(videoPath, input, 0);
    assert.equal(original.routes.right, "236X~XX j.5C 5A");
    assert.equal(original.presses[2].context.position, "airborne");
    assert.equal(original.presses[3].context.position, "grounded");
    await writeComboInputEdits(videoPath, {
      ...edits,
      presses: { ...edits.presses, [pressEditKey(220, "B")]: { notation: "236C" } },
    });
    const changed = await ensureProcessedComboInput(videoPath, input, 0);
    assert.equal(changed.routes.right, "236C~XX j.5C 5A");
    await writeComboInputEdits(videoPath, edits);
    const rebuilt = await ensureProcessedComboInput(videoPath, input, 0, { force: true });
    assert.equal(rebuilt.routes.right, original.routes.right);
    const trimmed = trimComboInputCapture(input, 0.7, 1);
    const afterTrim = await ensureProcessedComboInput(videoPath, trimmed, 700);
    assert.equal(afterTrim.routes.right, "j.5C 5A");
    assert.equal(afterTrim.presses[0].context.position, "airborne");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

void test("chip position toggles flip the selected press and every later press", () => {
  const input = {
    ...capture,
    states: [
      ...capture.states.slice(0, 7),
      { timeMs: 600, direction: 5, stickDirection: 5, buttons: [], actions: [] },
      { timeMs: 750, direction: 5, stickDirection: 5, buttons: ["B"], actions: ["Atk3"] },
      { timeMs: 800, direction: 5, stickDirection: 5, buttons: [], actions: [] },
      { timeMs: 900, direction: 5, stickDirection: 5, buttons: ["X"], actions: ["Atk1"] },
    ],
  };
  const edits = {
    schemaVersion: 1,
    presses: {
      [pressEditKey(500, "X")]: { notation: "XX", separator: "~", togglePosition: true },
      [pressEditKey(750, "B")]: { notation: "5C", positionAfter: "airborne" },
    },
  };
  const result = processComboInputCapture(input, undefined, 0, edits);
  assert.deepEqual(
    result.presses.map((press) => press.context.position),
    ["grounded", "airborne", "airborne", "grounded"],
  );
  assert.equal(result.routes.right, "236C~j.XX j.5C 5A");
  const withoutToggle = processComboInputCapture(input, undefined, 0, {
    ...edits,
    presses: { ...edits.presses, [pressEditKey(500, "X")]: { notation: "XX", separator: "~" } },
  });
  assert.deepEqual(
    withoutToggle.presses.map((press) => press.context.position),
    ["grounded", "grounded", "grounded", "airborne"],
  );
  const existingLiteral = processComboInputCapture(input, undefined, 0, {
    ...edits,
    presses: { [pressEditKey(500, "X")]: { notation: "j.XX" } },
  });
  assert.equal(existingLiteral.presses[1].interpretations.right.notation, "XX");
  const withLanding = processComboInputCapture(input, undefined, 0, {
    ...edits,
    presses: {
      ...edits.presses,
      [pressEditKey(900, "X")]: { togglePosition: true },
    },
  });
  assert.equal(withLanding.presses[3].context.position, "airborne");
  const trimmed = trimComboInputCapture(input, 0.7, 1);
  const afterTrim = processComboInputCapture(trimmed, undefined, 700, edits);
  assert.deepEqual(
    afterTrim.presses.map((press) => press.context.position),
    ["airborne", "grounded"],
  );
});

void test("charged edits bracket the button in grounded and airborne notation", () => {
  const grounded = processComboInputCapture(capture, undefined, 0, {
    schemaVersion: 1,
    presses: { [pressEditKey(220, "B")]: { charged: true } },
  });
  assert.equal(grounded.routes.right, "236[C] 2A");
  assert.equal(grounded.routes.left, "214[C] 2A");
  const airborne = processComboInputCapture(capture, undefined, 0, {
    schemaVersion: 1,
    presses: { [pressEditKey(220, "B")]: { charged: true, togglePosition: true } },
  });
  assert.equal(airborne.routes.right, "j.236[C] j.2A");
  assert.equal(airborne.presses[0].context.position, "airborne");
  const downC = {
    ...capture,
    states: [
      { timeMs: 0, direction: 5, stickDirection: 5, buttons: [], actions: [] },
      { timeMs: 100, direction: 2, stickDirection: 5, buttons: ["B"], actions: ["Atk3"] },
    ],
  };
  assert.equal(
    processComboInputCapture(downC, undefined, 0, {
      schemaVersion: 1,
      presses: { [pressEditKey(100, "B")]: { charged: true, togglePosition: true } },
    }).routes.right,
    "j.2[C]",
  );
});

void test("delay edit prefixes one move and survives saved reprocessing", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-combo-delay-"));
  const videoPath = path.join(directory, "combo.mp4");
  try {
    await writeComboInputEdits(videoPath, {
      schemaVersion: 1,
      presses: { [pressEditKey(220, "B")]: { delay: true, togglePosition: true } },
    });
    const processed = await ensureProcessedComboInput(videoPath, capture, 0);
    assert.equal(processed.routes.right, "dl.j.236C j.2A");
    assert.equal(processed.routes.left, "dl.j.214C j.2A");
    assert.equal(
      (await ensureProcessedComboInput(videoPath, capture, 0, { force: true })).routes.right,
      processed.routes.right,
    );
    await assert.rejects(
      writeComboInputEdits(videoPath, {
        schemaVersion: 1,
        presses: { [pressEditKey(220, "B")]: { delay: false } },
      }),
      /invalid delay flag/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

void test("any-attack edits render A/B/C as X and survive saved reprocessing", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-combo-any-attack-"));
  const videoPath = path.join(directory, "combo.mp4");
  try {
    await writeComboInputEdits(videoPath, {
      schemaVersion: 1,
      presses: {
        [pressEditKey(220, "B")]: { anyAttack: true, charged: true, crit: true },
        [pressEditKey(500, "X")]: { anyAttack: true, togglePosition: true },
      },
    });
    const result = await ensureProcessedComboInput(videoPath, capture, 0);
    assert.equal(result.routes.right, "236[X]! j.2X");
    assert.equal(result.routes.left, "214[X]! j.2X");
    const rebuilt = await ensureProcessedComboInput(videoPath, capture, 0, { force: true });
    assert.equal(rebuilt.routes.right, result.routes.right);
    await writeComboInputEdits(videoPath, {
      schemaVersion: 1,
      presses: { [pressEditKey(220, "B")]: { charged: true, crit: true } },
    });
    const restored = await ensureProcessedComboInput(videoPath, capture, 0);
    assert.equal(restored.routes.right, "236[C]! 2A");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

void test("critical edits append ! and survive reprocessing, charging, and a later trim", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-combo-crit-"));
  const videoPath = path.join(directory, "combo.mp4");
  try {
    await writeComboInputEdits(videoPath, {
      schemaVersion: 1,
      presses: { [pressEditKey(220, "B")]: { crit: true, charged: true } },
    });
    const processed = await ensureProcessedComboInput(videoPath, capture, 0);
    assert.equal(processed.routes.right, "236[C]! 2A");
    assert.equal(processed.routes.left, "214[C]! 2A");
    const rebuilt = await ensureProcessedComboInput(videoPath, capture, 0, { force: true });
    assert.equal(rebuilt.routes.right, processed.routes.right);
    const trimmed = trimComboInputCapture(capture, 0, 0.6);
    const afterTrim = await ensureProcessedComboInput(videoPath, trimmed, 0);
    assert.equal(afterTrim.routes.right, "236[C]! 2A");
    await assert.rejects(
      writeComboInputEdits(videoPath, {
        schemaVersion: 1,
        presses: { [pressEditKey(220, "B")]: { crit: false } },
      }),
      /invalid critical flag/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

void test("direction overrides replace, remove, and restore the leading motion across processing and trim", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-combo-direction-"));
  const videoPath = path.join(directory, "combo.mp4");
  try {
    await writeComboInputEdits(videoPath, {
      schemaVersion: 1,
      presses: { [pressEditKey(220, "B")]: { directionOverride: "623" } },
    });
    const replaced = await ensureProcessedComboInput(videoPath, capture, 0);
    assert.equal(replaced.routes.right, "623C 2A");
    assert.equal(replaced.routes.left, "421C 2A");
    await writeComboInputEdits(videoPath, {
      schemaVersion: 1,
      presses: { [pressEditKey(220, "B")]: { notation: "236X", directionOverride: "623" } },
    });
    const manual = await ensureProcessedComboInput(videoPath, capture, 0, { force: true });
    assert.equal(manual.routes.right, "623X 2A");
    assert.equal(manual.routes.left, "421C 2A");
    await writeComboInputEdits(videoPath, {
      schemaVersion: 1,
      presses: { [pressEditKey(220, "B")]: { directionOverride: "", charged: true, crit: true } },
    });
    const removed = await ensureProcessedComboInput(videoPath, capture, 0, { force: true });
    assert.equal(removed.routes.right, "[C]! 2A");
    assert.equal(removed.routes.left, "[C]! 2A");
    const afterTrim = await ensureProcessedComboInput(
      videoPath,
      trimComboInputCapture(capture, 0, 0.6),
      0,
      { force: true },
    );
    assert.equal(afterTrim.routes.right, "[C]! 2A");
    await writeComboInputEdits(videoPath, { schemaVersion: 1, presses: {} });
    const restored = await ensureProcessedComboInput(videoPath, capture, 0, { force: true });
    assert.equal(restored.routes.right, "236C 2A");
    await assert.rejects(
      writeComboInputEdits(videoPath, {
        schemaVersion: 1,
        presses: { [pressEditKey(220, "B")]: { directionOverride: "0" } },
      }),
      /invalid direction override/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

void test("keeps the original file unchanged while regenerating the derived file after a trim", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "labatar-combo-input-"));
  const videoPath = path.join(directory, "combo.mp4");
  try {
    await ensureOriginalComboInput(videoPath, capture);
    const originalBytes = await fs.readFile(originalComboInputPath(videoPath));
    const first = await ensureProcessedComboInput(videoPath, capture);
    const again = await ensureProcessedComboInput(videoPath, capture);
    assert.deepEqual(again, first);
    const trimmed = trimComboInputCapture(capture, 0.45, 0.8);
    const updated = await ensureProcessedComboInput(videoPath, trimmed);
    assert.equal(updated.routes.right, "2A");
    assert.notEqual(updated.source.sha256, first.source.sha256);
    const aligned = await ensureProcessedComboInput(videoPath, trimmed, 450);
    assert.equal(aligned.source.rawStartMs, 450);
    assert.equal(aligned.source.sha256, updated.source.sha256);
    const altered = { ...aligned, routes: { ...aligned.routes, right: "incorrect" } };
    await fs.writeFile(processedComboInputPath(videoPath), JSON.stringify(altered), "utf8");
    const rebuilt = await ensureProcessedComboInput(videoPath, trimmed, 450, { force: true });
    assert.equal(rebuilt.routes.right, "2A");
    assert.deepEqual(await fs.readFile(originalComboInputPath(videoPath)), originalBytes);
    assert.equal(
      JSON.parse(await fs.readFile(processedComboInputPath(videoPath), "utf8")).routes.right,
      "2A",
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

void test("does not treat a button held at the trim boundary as a new press", () => {
  const trimmed = trimComboInputCapture(capture, 0.23, 0.6);
  const result = processComboInputCapture(trimmed);
  assert.equal(
    result.presses.some((press) => press.physicalButton === "B"),
    false,
  );
  assert.equal(result.routes.right, "2A");
});

void test("recognizes a held starting direction and a brief neutral release", () => {
  const input = {
    ...capture,
    states: [
      { timeMs: 0, direction: 5, stickDirection: 5, buttons: [] },
      { timeMs: 100, direction: 2, stickDirection: 5, buttons: [] },
      { timeMs: 900, direction: 3, stickDirection: 5, buttons: [] },
      { timeMs: 950, direction: 6, stickDirection: 5, buttons: [] },
      { timeMs: 970, direction: 5, stickDirection: 5, buttons: [] },
      { timeMs: 990, direction: 5, stickDirection: 5, buttons: ["B"] },
    ],
  };
  assert.equal(processComboInputCapture(input).routes.right, "236C");
});

void test("releasing forward while C stays held changes direction without adding 5C", () => {
  const input = {
    ...capture,
    states: [
      { timeMs: 0, direction: 5, stickDirection: 5, buttons: [] },
      { timeMs: 100, direction: 2, stickDirection: 5, buttons: [] },
      { timeMs: 150, direction: 3, stickDirection: 5, buttons: [] },
      { timeMs: 200, direction: 6, stickDirection: 5, buttons: ["B"] },
      { timeMs: 620, direction: 5, stickDirection: 5, buttons: ["B"] },
      { timeMs: 700, direction: 5, stickDirection: 5, buttons: [] },
    ],
  };
  const result = processComboInputCapture(input);
  assert.equal(result.routes.right, "236C");
  assert.deepEqual(
    result.presses.map((press) => [press.timeMs, press.interpretations.right.notation]),
    [[200, "236C"]],
  );
  assert.deepEqual(result.directionChanges.at(-1), {
    timeMs: 620,
    sourceStateIndex: 4,
    direction: 5,
    heldButtons: ["B"],
    heldGameButtons: ["C"],
  });
});
