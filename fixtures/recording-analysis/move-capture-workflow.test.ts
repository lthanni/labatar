import { describe, expect, it } from "vite-plus/test";
import { withCommonTechMoves } from "../../src/common-tech-moves";
import {
  automatedWhiffEligibility,
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

describe("automated whiff eligibility", () => {
  const whiffTake = (moveId: string, evidenceStatus: "pending" | "active") =>
    ({
      id: `aang-gyatso/${moveId}/${evidenceStatus}`,
      moveTake: {
        catalogMoveId: `aang-gyatso/${moveId}`,
        outcome: "whiff",
        evidenceStatus,
      },
    }) as RecordedVideo;

  it("separates live-tested recipes from supported recipes needing validation", () => {
    expect(automatedWhiffEligibility({ ...moves[0], input: "5A" }, [], "aang-gyatso")).toEqual({
      eligible: true,
      validation: "tested",
    });
    expect(automatedWhiffEligibility({ ...moves[0], input: "236A" }, [], "aang-gyatso")).toEqual({
      eligible: true,
      validation: "tested",
    });
    expect(automatedWhiffEligibility({ ...moves[0], input: "214C" }, [], "aang-gyatso")).toEqual({
      eligible: true,
      validation: "needs-validation",
    });
    for (const input of ["1A", "2B", "3C", "4F", "5EX", "6A", "7B", "8C", "9F", "236EX", "214EX"]) {
      expect(automatedWhiffEligibility({ ...moves[0], input }, [], "aang-gyatso")).toEqual({
        eligible: true,
        validation: "needs-validation",
      });
    }
    expect(
      automatedWhiffEligibility(
        { ...moves[0], input: "236A" },
        [],
        "aang-gyatso",
        new Set(),
        "Left",
      ),
    ).toEqual({ eligible: true, validation: "needs-validation" });
  });

  it("queues every grounded common move when its whiff slot is empty", () => {
    const catalog = withCommonTechMoves("Aang", []);
    const eligible = catalog.filter(
      (move) => automatedWhiffEligibility(move, [], "aang-gyatso").eligible,
    );
    expect(eligible.map((move) => move.input)).toEqual(
      catalog.filter((move) => !move.input.startsWith("j.")).map((move) => move.input),
    );
  });

  it("reports explicit manual, unsupported, not-applicable, and existing-take skips", () => {
    const move = { ...moves[0], input: "5A" };
    expect(
      automatedWhiffEligibility(
        { ...move, nonstandard: true, nonstandardNote: "Range varies" },
        [],
        "aang-gyatso",
      ),
    ).toMatchObject({
      eligible: false,
      kind: "nonstandard",
      reason: "Tagged nonstandard: Range varies",
    });
    expect(
      automatedWhiffEligibility({ ...move, input: "j.236A" }, [], "aang-gyatso"),
    ).toMatchObject({ eligible: false, kind: "unsupported" });
    expect(
      automatedWhiffEligibility(
        { ...move, notApplicable: { whiff: "Cannot whiff" } },
        [],
        "aang-gyatso",
      ),
    ).toMatchObject({
      eligible: false,
      kind: "not-applicable",
      reason: "Whiff not applicable: Cannot whiff",
    });
    expect(
      automatedWhiffEligibility(move, [whiffTake(move.id, "active")], "aang-gyatso"),
    ).toMatchObject({
      eligible: false,
      kind: "existing-take",
      reason: "An active whiff take already exists.",
    });
    expect(
      automatedWhiffEligibility(move, [whiffTake(move.id, "pending")], "aang-gyatso"),
    ).toMatchObject({
      eligible: false,
      kind: "existing-take",
      reason: "A pending whiff take already exists.",
    });
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
        id: "automated-awaiting-review",
        moveTake: {
          ...candidate.moveTake,
          captureMethod: "automated",
          captureReviewStatus: "awaiting-video-review",
        },
      },
      {
        ...candidate,
        id: "automated-approved",
        moveTake: {
          ...candidate.moveTake,
          captureMethod: "automated",
          captureReviewStatus: "approved-for-processing",
        },
      },
      {
        ...candidate,
        id: "automated-rejected",
        moveTake: {
          ...candidate.moveTake,
          captureMethod: "automated",
          captureReviewStatus: "rejected",
        },
      },
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
    ).toEqual(["older", "pending", "automated-approved"]);
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
