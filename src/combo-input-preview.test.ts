import { describe, expect, it } from "vite-plus/test";
import { previewComboChipEdit } from "./combo-input-preview";
import type { ProcessedComboInput } from "./recording-types";

const initial: ProcessedComboInput = {
  schemaVersion: 1,
  processorVersion: 10,
  processedAt: "2026-01-01T00:00:00.000Z",
  source: {
    kind: "comboInputCapture",
    sha256: "source",
    durationMs: 600,
    stateCount: 7,
    timing: "approximate",
    rawStartMs: 0,
  },
  context: { defaultFacing: "right", defaultPosition: "grounded" },
  directionChanges: [],
  presses: [
    {
      timeMs: 220,
      sourceStateIndex: 4,
      physicalButton: "B",
      gameAction: "Atk3",
      gameButton: "C",
      context: { facing: "right", position: "grounded" },
      manualEdit: null,
      interpretations: {
        right: {
          direction: 6,
          motion: "236",
          directionPath: "236",
          suggestedNotation: "236C",
          notation: "236C",
        },
        left: {
          direction: 4,
          motion: "214",
          directionPath: "214",
          suggestedNotation: "214C",
          notation: "214C",
        },
      },
    },
    {
      timeMs: 400,
      sourceStateIndex: 6,
      physicalButton: "X",
      gameAction: "Atk1",
      gameButton: "A",
      context: { facing: "right", position: "grounded" },
      manualEdit: null,
      interpretations: {
        right: {
          direction: 5,
          motion: null,
          directionPath: null,
          suggestedNotation: "5A",
          notation: "5A",
        },
        left: {
          direction: 5,
          motion: null,
          directionPath: null,
          suggestedNotation: "5A",
          notation: "5A",
        },
      },
    },
  ],
  routes: { right: "236C 5A", left: "214C 5A" },
};

describe("combo chip preview", () => {
  it("shows position, charge, and follow-up edits before deferred processing", () => {
    const first = initial.presses[0];
    const second = initial.presses[1];
    const toggled = previewComboChipEdit(initial, first, { togglePosition: true });
    const charged = previewComboChipEdit(toggled, first, { togglePosition: true, charged: true });
    const joined = previewComboChipEdit(charged, second, { separator: "~" });
    expect(joined.routes.right).toBe("j.236[C]~j.5A");
    expect(joined.routes.left).toBe("j.214[C] j.5A");
    expect(joined.presses.map((press) => press.context.position)).toEqual(["airborne", "airborne"]);
    const landed = previewComboChipEdit(joined, second, {
      separator: "~",
      togglePosition: true,
    });
    expect(landed.routes.right).toBe("j.236[C]~5A");
  });

  it("adds and removes a critical suffix alongside charge and position edits", () => {
    const first = initial.presses[0];
    const crit = previewComboChipEdit(initial, first, { crit: true });
    expect(crit.routes.right).toBe("236C! 5A");
    expect(crit.routes.left).toBe("214C! 5A");
    const charged = previewComboChipEdit(crit, first, { crit: true, charged: true });
    expect(charged.routes.right).toBe("236[C]! 5A");
    const airborne = previewComboChipEdit(charged, first, {
      crit: true,
      charged: true,
      togglePosition: true,
    });
    expect(airborne.routes.right).toBe("j.236[C]! j.5A");
    const plain = previewComboChipEdit(airborne, first, {
      charged: true,
      togglePosition: true,
    });
    expect(plain.routes.right).toBe("j.236[C] j.5A");
  });

  it("prefixes only the selected move with dl. and keeps it before j. after position changes", () => {
    const first = initial.presses[0];
    const second = initial.presses[1];
    const delayed = previewComboChipEdit(initial, second, { delay: true });
    expect(delayed.routes.right).toBe("236C dl.5A");
    expect(delayed.routes.left).toBe("214C dl.5A");
    const airborne = previewComboChipEdit(delayed, first, { togglePosition: true });
    expect(airborne.routes.right).toBe("j.236C dl.j.5A");
    const restored = previewComboChipEdit(airborne, second, {});
    expect(restored.routes.right).toBe("j.236C j.5A");
  });

  it("previews X as any A/B/C attack while preserving motion, charge, crit, and position", () => {
    const first = initial.presses[0];
    const anyAttack = previewComboChipEdit(initial, first, {
      anyAttack: true,
      charged: true,
      crit: true,
      togglePosition: true,
    });
    expect(anyAttack.routes.right).toBe("j.236[X]! j.5A");
    expect(anyAttack.routes.left).toBe("j.214[X]! j.5A");
    const restored = previewComboChipEdit(anyAttack, first, {
      charged: true,
      crit: true,
      togglePosition: true,
    });
    expect(restored.routes.right).toBe("j.236[C]! j.5A");
  });

  it("previews direction replacement, removal, and restoration without changing the button", () => {
    const first = initial.presses[0];
    const replaced = previewComboChipEdit(initial, first, { directionOverride: "623" });
    expect(replaced.routes.right).toBe("623C 5A");
    expect(replaced.routes.left).toBe("421C 5A");
    const removed = previewComboChipEdit(replaced, first, {
      directionOverride: "",
      charged: true,
      crit: true,
      togglePosition: true,
    });
    expect(removed.routes.right).toBe("j.[C]! j.5A");
    expect(removed.routes.left).toBe("j.[C]! j.5A");
    const restored = previewComboChipEdit(removed, first, {
      charged: true,
      crit: true,
      togglePosition: true,
    });
    expect(restored.routes.right).toBe("j.236[C]! j.5A");
    expect(restored.routes.left).toBe("j.214[C]! j.5A");
    const manual = previewComboChipEdit(initial, first, {
      notation: "236X",
      directionOverride: "623",
    });
    expect(manual.routes.right).toBe("623X 5A");
    expect(manual.routes.left).toBe("421C 5A");
    expect(previewComboChipEdit(manual, first, { notation: "236X" }).routes.right).toBe("236X 5A");
  });
});
