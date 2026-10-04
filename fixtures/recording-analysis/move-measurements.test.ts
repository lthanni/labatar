import { describe, expect, it } from "vite-plus/test";
import {
  applyAcceptedMeasurements,
  effectiveMeasurement,
  removeRecordingMeasurements,
} from "../../src/move-measurements";
import type { RecordedVideo } from "../../src/recording-types";
import type { TechCatalog, TechMove } from "../../src/tech-types";

const move = {
  id: "aang-2b",
  character: "Aang",
  input: "2B",
  startup: null,
  active: null,
  recovery: null,
  onBlock: null,
  blockstun: null,
  hitstun: null,
  resourceCosts: { pips: 0, flow: 0 },
} as TechMove;

function take(id: string, variant: string, outcome: "whiff" | "block", startup: number) {
  return {
    id,
    moveTake: {
      id,
      characterId: variant,
      moveId: move.id,
      outcome,
      validation: { matchedAnalysisMoveId: "analysis-move" },
    },
    analysis: {
      moves: [
        {
          id: "analysis-move",
          startTime: 1,
          endTime: 2,
          phases: { startup, active: 2, recovery: 8 },
          opponentPhases: { blockstun: 12, hitstun: 0 },
          onBlock: 4,
        },
      ],
    },
  } as unknown as RecordedVideo;
}

describe("accepted move measurements", () => {
  it("stores a shared baseline with source frames and a separate support version for differences", () => {
    const catalog: TechCatalog = { Aang: { moves: [move], combos: [] } };
    const first = take("first", "aang-gyatso", "whiff", 9);
    const second = take("second", "aang-appa", "whiff", 11);
    const afterFirst = applyAcceptedMeasurements(catalog, first, "Aang", "Gyatso");
    const afterSecond = applyAcceptedMeasurements(afterFirst, second, "Aang", "Appa", [first]);
    expect(effectiveMeasurement(afterSecond, "Aang", "Gyatso", move.id, "startup")).toMatchObject({
      value: 9,
      recordingId: "first",
      startTime: 1,
      endTime: 2,
    });
    expect(afterSecond.Aang.supportMoves?.find((entry) => entry.support === "Appa")).toMatchObject({
      support: "Appa",
      baseMoveId: move.id,
    });
    expect(effectiveMeasurement(afterSecond, "Aang", "Appa", move.id, "startup")?.value).toBe(11);
    expect(effectiveMeasurement(afterSecond, "Aang", "Appa", move.id, "active")?.value).toBe(2);
    const archived = removeRecordingMeasurements(afterSecond, "second");
    expect(effectiveMeasurement(archived, "Aang", "Appa", move.id, "startup")?.value).toBe(9);
    expect(archived.Aang.supportMoves?.map((entry) => entry.support)).toEqual(["Gyatso"]);
  });

  it("replaces baseline provenance when the same support retakes its source", () => {
    const original = take("old", "aang-gyatso", "whiff", 9);
    const replacement = take("new", "aang-gyatso", "whiff", 10);
    const catalog = applyAcceptedMeasurements(
      { Aang: { moves: [move], combos: [] } },
      original,
      "Aang",
      "Gyatso",
    );
    const result = applyAcceptedMeasurements(catalog, replacement, "Aang", "Gyatso", [original]);
    expect(result.Aang.moves[0].startup).toBe(10);
    expect(result.Aang.moves[0].evidence?.startup?.recordingId).toBe("new");
    expect(result.Aang.supportMoves?.[0].sources?.startup?.recordingId).toBe("new");
  });

  it("promotes another support's identical source when the baseline video is archived", () => {
    const first = take("first", "aang-gyatso", "whiff", 9);
    const second = take("second", "aang-appa", "whiff", 9);
    const catalog = applyAcceptedMeasurements(
      { Aang: { moves: [move], combos: [] } },
      first,
      "Aang",
      "Gyatso",
    );
    const withSecond = applyAcceptedMeasurements(catalog, second, "Aang", "Appa", [first]);
    const archived = removeRecordingMeasurements(withSecond, "first");
    expect(archived.Aang.moves[0].evidence?.startup?.recordingId).toBe("second");
    expect(archived.Aang.moves[0].startup).toBe(9);
  });
});
