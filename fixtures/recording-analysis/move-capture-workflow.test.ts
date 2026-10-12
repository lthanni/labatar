import { describe, expect, it } from "vite-plus/test";
import { withCommonTechMoves } from "../../src/common-tech-moves";
import {
  automatedMoveEligibility,
  automatedWhiffEligibility,
  gatherMoves,
  moveCaptureComplete,
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

describe("move capture worklist completion", () => {
  const analyzedTake = (outcome: "whiff" | "block" | "hit-grounded" | "hit-airborne") =>
    ({
      id: outcome,
      moveTake: {
        catalogMoveId: `aang-gyatso/${moves[0].id}`,
        outcome,
        evidenceStatus: "active",
      },
      analysis: { moves: [] },
    }) as unknown as RecordedVideo;

  it("keeps a move visible until each applicable outcome has accepted analysis", () => {
    const completed = [
      analyzedTake("whiff"),
      analyzedTake("block"),
      analyzedTake("hit-grounded"),
      analyzedTake("hit-airborne"),
    ];
    expect(moveCaptureComplete(moves[0], completed.slice(0, 3), "aang-gyatso")).toBe(false);
    expect(moveCaptureComplete(moves[0], completed, "aang-gyatso")).toBe(true);
    expect(
      moveCaptureComplete(
        { ...moves[0], notApplicable: { "hit-airborne": "Cannot hit airborne" } },
        completed.slice(0, 3),
        "aang-gyatso",
      ),
    ).toBe(true);
  });

  it("keeps pending retakes and unanalyzed accepted takes in the worklist", () => {
    const completed = [
      analyzedTake("whiff"),
      analyzedTake("block"),
      analyzedTake("hit-grounded"),
      analyzedTake("hit-airborne"),
    ];
    const pending = {
      ...analyzedTake("whiff"),
      id: "pending-whiff-retake",
      moveTake: {
        ...analyzedTake("whiff").moveTake,
        evidenceStatus: "pending",
      },
      analysis: null,
    } as RecordedVideo;
    expect(moveCaptureComplete(moves[0], [...completed, pending], "aang-gyatso")).toBe(false);
    expect(
      moveCaptureComplete(
        moves[0],
        completed.map((take) => (take.id === "block" ? { ...take, analysis: null } : take)),
        "aang-gyatso",
      ),
    ).toBe(false);
  });

  it("tracks completion for the selected outcome without requiring the other slots", () => {
    const whiff = analyzedTake("whiff");
    expect(moveCaptureComplete(moves[0], [whiff], "aang-gyatso", "whiff")).toBe(true);
    expect(moveCaptureComplete(moves[0], [whiff], "aang-gyatso", "block")).toBe(false);
    expect(
      moveCaptureComplete(
        { ...moves[0], notApplicable: { block: "Cannot be blocked" } },
        [whiff],
        "aang-gyatso",
        "block",
      ),
    ).toBe(true);
    expect(
      moveCaptureComplete(
        moves[0],
        [
          whiff,
          {
            ...whiff,
            id: "retake",
            moveTake: { ...whiff.moveTake!, evidenceStatus: "pending" },
          } as RecordedVideo,
        ],
        "aang-gyatso",
        "whiff",
      ),
    ).toBe(false);
  });
});

describe("automatic capture outcome selection", () => {
  it("uses only the selected outcome when building the automatic queue", () => {
    const move = { ...moves[0], input: "5A" };
    const whiff = {
      id: "whiff",
      moveTake: {
        catalogMoveId: `aang-gyatso/${move.id}`,
        outcome: "whiff",
        evidenceStatus: "active",
      },
    } as RecordedVideo;
    expect(automatedMoveEligibility(move, [whiff], "aang-gyatso", "whiff")).toMatchObject({
      eligible: false,
      kind: "existing-take",
    });
    expect(automatedMoveEligibility(move, [whiff], "aang-gyatso", "block")).toMatchObject({
      eligible: true,
    });
    expect(
      automatedMoveEligibility(
        { ...move, notApplicable: { "hit-airborne": "Ground only" } },
        [],
        "aang-gyatso",
        "hit-airborne",
      ),
    ).toMatchObject({ eligible: false, kind: "not-applicable" });
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
    for (const input of ["j.5A", "j.236A", "j.214EX"]) {
      expect(automatedWhiffEligibility({ ...moves[0], input }, [], "aang-gyatso")).toEqual({
        eligible: true,
        validation: "needs-validation",
      });
    }
    for (const input of [
      "1A",
      "2B",
      "2AA",
      "3C",
      "4F",
      "5AA",
      "5EX",
      "6A",
      "7B",
      "8C",
      "9F",
      "236EX",
      "214EX",
      "5[C]",
      "2[B]",
      "236[EX]",
      "j.214[A]",
    ]) {
      expect(
        automatedWhiffEligibility(
          { ...moves[0], input, isCharged: input.includes("[") },
          [],
          "aang-gyatso",
        ),
      ).toEqual({
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

  it("queues common moves except default flow stances when their whiff slots are empty", () => {
    const catalog = withCommonTechMoves("Aang", []);
    const eligible = catalog.filter(
      (move) => automatedWhiffEligibility(move, [], "aang-gyatso").eligible,
    );
    expect(eligible.map((move) => move.input)).toEqual(
      catalog.filter((move) => !move.isFlowStance).map((move) => move.input),
    );
    const flowMove = catalog.find((move) => move.input === "2F")!;
    expect(automatedWhiffEligibility(flowMove, [], "aang-gyatso").eligible).toBe(false);
    expect(
      automatedWhiffEligibility(
        { ...flowMove, isFlowStance: false, isStanceParent: false, flowStanceOverride: false },
        [],
        "aang-gyatso",
      ).eligible,
    ).toBe(true);
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
      automatedWhiffEligibility({ ...move, input: "j.236SUP" }, [], "aang-gyatso"),
    ).toMatchObject({ eligible: false, kind: "unsupported" });
    for (const input of ["1AA", "236AA", "j.5AA"]) {
      expect(automatedWhiffEligibility({ ...move, input }, [], "aang-gyatso")).toMatchObject({
        eligible: false,
        kind: "unsupported",
      });
    }
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

  it("shows selected capture identity and frame values without claiming input detection", () => {
    const recording = {
      moveTake: {
        moveLabel: "2B",
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
      result: "Capture linked",
      detail:
        "Selected 2B · contact signal unconfirmed · startup 9 · active 2 · recovery 12 · blockstun 15 · on block +3",
    });
  });

  it("shows flow stance state frames and total duration in the processed take", () => {
    const recording = {
      moveTake: {
        moveLabel: "2F",
        outcome: "whiff",
        validation: { status: "verified", matchedAnalysisMoveId: "move-1" },
      },
      analysis: {
        moves: [
          {
            id: "move-1",
            phases: { startup: 3, active: 0, recovery: 5 },
            flowStanceFrames: 12,
            totalDurationFrames: 20,
            opponentPhases: { hitstun: 0, blockstun: 0 },
          },
        ],
      },
    } as unknown as RecordedVideo;
    const detail = moveTakeOutcomeSummary(recording).detail;
    expect(detail).toContain("flow stance 12");
    expect(detail).toContain("total 20 frames");
  });

  it("shows both numbered 5B hit windows and their orange gap", () => {
    const recording = {
      moveTake: {
        moveLabel: "5B",
        outcome: "whiff",
        validation: { status: "verified", matchedAnalysisMoveId: "move-1" },
      },
      analysis: {
        moves: [
          {
            id: "move-1",
            phases: { startup: 11, active: 12, recovery: 21 },
            opponentPhases: { hitstun: 0, blockstun: 0 },
            hits: [
              { notation: "5B(1)", index: 1, phases: { active: 6 }, gapBeforeFrames: 0 },
              { notation: "5B(2)", index: 2, phases: { active: 6 }, gapBeforeFrames: 7 },
            ],
          },
        ],
      },
    } as unknown as RecordedVideo;
    expect(moveTakeOutcomeSummary(recording).detail).toContain("5B(1): 6 active");
    expect(moveTakeOutcomeSummary(recording).detail).toContain(
      "5B(1): 6 active · 7 gap frames · 5B(2): 6 active",
    );
  });
});
