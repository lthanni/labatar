import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const { createMoveCatalogStore } = createRequire(import.meta.url)(
  "../../electron/move-catalog.cjs",
);
const { validateMoveTake } = createRequire(import.meta.url)(
  "../../electron/move-take-validation.cjs",
);

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "labatar-move-capture-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const catalog = {
  schemaVersion: 1,
  revision: 0,
  characters: [
    {
      id: "aang-gyatso",
      label: "Aang / Gyatso",
      moves: [{ id: "5a", label: "5A", expectedInputs: ["5A"], isStance: false, isCharged: false }],
    },
  ],
};

const take = {
  expectedInputs: ["5A"],
  isStance: false,
};

describe("move capture catalog", () => {
  it("persists a versioned manual catalog and rejects stale saves", () => {
    const store = createMoveCatalogStore(root);

    expect(store.load().catalog).toEqual({ schemaVersion: 1, revision: 0, characters: [] });
    const saved = store.save(catalog, 0);

    expect(saved.catalog.revision).toBe(1);
    expect(store.load().catalog.characters[0].moves[0].expectedInputs).toEqual(["5A"]);
    expect(store.load().catalog.characters[0].moves[0].isCharged).toBe(false);
    expect(() => store.save(catalog, 0)).toThrow("changed in another window");
  });

  it("persists a charged move as a distinct catalog entry", () => {
    const store = createMoveCatalogStore(root);
    const saved = store.save(
      {
        ...catalog,
        characters: [
          {
            ...catalog.characters[0],
            moves: [
              ...catalog.characters[0].moves,
              {
                id: "5a-charged",
                label: "Charged 5A",
                expectedInputs: ["5A"],
                isStance: false,
                isCharged: true,
              },
            ],
          },
        ],
      },
      0,
    );

    expect(saved.catalog.characters[0].moves[1]).toMatchObject({
      id: "5a-charged",
      isCharged: true,
    });
  });
});

describe("move take validation", () => {
  it("keeps a charged take unresolved until its hold duration is verified", () => {
    const result = validateMoveTake(
      { expectedInputs: ["5[C]"], isCharged: true },
      { moves: [{ id: "move-1", observedNotation: "5C" }], inputEvents: [] },
    );
    expect(result.status).toBe("unresolved");
    expect(result.message).toContain("hold duration");
  });

  it("can observe a directionless charged followup without claiming its hold duration", () => {
    const result = validateMoveTake(
      { expectedInputs: ["[A]"], isCharged: true, isStance: true },
      { moves: [{ id: "move-1", observedNotation: "6A" }], inputEvents: [] },
    );
    expect(result.status).toBe("unresolved");
  });

  it("verifies one observed input without using the armed move as processor input", () => {
    const result = validateMoveTake(take, {
      moves: [{ id: "move-1", observedNotation: "5A" }],
      inputEvents: [],
    });

    expect(result).toMatchObject({
      status: "verified",
      matchedAnalysisMoveId: "move-1",
      observedInputs: ["5A"],
    });
  });

  it("marks a disagreeing observed input as a mismatch", () => {
    const result = validateMoveTake(take, {
      moves: [{ id: "move-1", observedNotation: "2A" }],
      inputEvents: [],
    });

    expect(result.status).toBe("mismatch");
    expect(result.message).toContain("Expected 5A; observed 2A");
  });

  it("accepts a visible directional button for an armed stance move", () => {
    const result = validateMoveTake(
      { expectedInputs: ["A"], isStance: true },
      {
        moves: [{ id: "move-1", observedNotation: "6A" }],
        inputEvents: [],
      },
    );

    expect(result).toMatchObject({
      status: "verified",
      matchedAnalysisMoveId: "move-1",
      observedInputs: ["6A"],
    });
  });

  it("does not allow directional notation in a stance catalog entry", () => {
    const store = createMoveCatalogStore(root);
    expect(() =>
      store.save(
        {
          ...catalog,
          characters: [
            {
              ...catalog.characters[0],
              moves: [
                { id: "stance-a", label: "Stance A", expectedInputs: ["5A"], isStance: true },
              ],
            },
          ],
        },
        0,
      ),
    ).toThrow("Stance moves must use bare button inputs");
  });

  it("does not accept a correct input when another attack was detected", () => {
    const result = validateMoveTake(take, {
      moves: [
        { id: "move-1", observedNotation: "5A" },
        { id: "move-2", observedNotation: "5B" },
      ],
      inputEvents: [],
    });

    expect(result.status).toBe("ambiguous");
    expect(result.matchedAnalysisMoveId).toBeNull();
  });
});
