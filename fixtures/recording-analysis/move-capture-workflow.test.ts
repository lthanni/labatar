import { describe, expect, it } from "vite-plus/test";
import { withCommonTechMoves } from "../../src/common-tech-moves";
import {
  gatherMoves,
  moveTakeOutcomeSummary,
  slotStatus,
  takesForSlot,
  unprocessedMoveTakes,
} from "../../src/move-capture-workflow";
import type { RecordedVideo } from "../../src/recording-types";

const moves = withCommonTechMoves("Aang", []).slice(0, 3);
const take = (
  moveId: string,
  evidenceStatus: "pending" | "active" | "archived",
  variantId = "aang-gyatso",
): RecordedVideo =>
  ({
    id: `${variantId}/${moveId}/${evidenceStatus}`,
    moveTake: { catalogMoveId: `${variantId}/${moveId}`, outcome: "block", evidenceStatus },
  }) as RecordedVideo;

describe("move capture gathering", () => {
  it("queues missing and failed slots but skips active, pending, and not-applicable slots", () => {
    const catalog = [
      moves[0],
      { ...moves[1], notApplicable: { block: "Cannot be blocked" } },
      moves[2],
    ];
    const recordings = [take(moves[0].id, "archived"), take(moves[2].id, "pending")];
    expect(
      gatherMoves(catalog, recordings, "aang-gyatso", "block", new Set()).map((m) => m.id),
    ).toEqual([moves[0].id]);
    expect(
      slotStatus(moves[0], "block", takesForSlot(recordings, "aang-gyatso", moves[0].id, "block")),
    ).toBe("needs-redo");
    expect(
      gatherMoves(catalog, [take(moves[0].id, "active")], "aang-katara", "block", new Set()).map(
        (m) => m.id,
      ),
    ).toEqual([moves[0].id, moves[2].id]);
    expect(
      gatherMoves(catalog, recordings, "aang-gyatso", "block", new Set([moves[0].id])),
    ).toEqual([]);
  });
});

describe("move processing queue", () => {
  it("limits process all to pending, captured, unprocessed takes for the selected variant", () => {
    const candidate = {
      id: "pending",
      modifiedAt: 2,
      moveTake: {
        characterId: "aang-gyatso",
        status: "captured",
        evidenceStatus: "pending",
      },
      analysis: null,
    } as RecordedVideo;
    const older = { ...candidate, id: "older", modifiedAt: 1 };
    const recordings = [
      candidate,
      {
        ...candidate,
        id: "other-variant",
        moveTake: { ...candidate.moveTake, characterId: "aang-appa" },
      },
      {
        ...candidate,
        id: "archived",
        moveTake: { ...candidate.moveTake, evidenceStatus: "archived" },
      },
      { ...candidate, id: "processed", analysis: { moves: [] } },
      {
        ...candidate,
        id: "failed-save",
        moveTake: { ...candidate.moveTake, storageError: "disk full" },
      },
      older,
    ] as RecordedVideo[];
    expect(
      unprocessedMoveTakes(recordings, "aang-gyatso").map((recording) => recording.id),
    ).toEqual(["older", "pending"]);
  });

  it("shows detected input and frame values while keeping requested outcome separate", () => {
    const recording = {
      moveTake: {
        outcome: "block",
        validation: {
          status: "verified",
          matchedAnalysisMoveId: "move-1",
          message: "Observed 2B.",
        },
      },
      analysis: {
        moves: [
          {
            id: "move-1",
            observedNotation: "2B",
            phases: { startup: 9, active: 2, recovery: 12 },
            opponentPhases: { blockstun: 15 },
            onBlock: 3,
          },
        ],
      },
    } as unknown as RecordedVideo;
    expect(moveTakeOutcomeSummary(recording)).toEqual({
      result: "Input matched",
      detail:
        "Observed 2B · contact signal unconfirmed · startup 9 · active 2 · recovery 12 · blockstun 15 · on block +3",
    });
  });
});
