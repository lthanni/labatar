import { describe, expect, it } from "vite-plus/test";
import {
  isNonMotionFMove,
  resolveFlowStance,
  withCommonTechMoves,
} from "../../src/common-tech-moves";

describe("assumed Tech moves", () => {
  it("starts each character with the requested inputs and unknown frame data", () => {
    const inputs = withCommonTechMoves("Aang", []);
    expect(inputs.map((move) => move.input)).toEqual([
      "2A",
      "2B",
      "2C",
      "5A",
      "5AA",
      "5B",
      "5C",
      "2F",
      "4F",
      "6F",
      "236A",
      "236B",
      "236C",
      "236EX",
      "214A",
      "214B",
      "214C",
      "214EX",
      "j.236A",
      "j.236B",
      "j.236C",
      "j.236EX",
    ]);
    expect(inputs.every((move) => move.startup === null && move.active === null)).toBe(true);
  });

  it("preserves existing move IDs and data when filling gaps", () => {
    const initial = withCommonTechMoves("Aang", []);
    const savedMove = { ...initial[0], id: "existing-2a", startup: 7 };
    const moves = withCommonTechMoves("Aang", [savedMove]);
    expect(moves).toHaveLength(22);
    expect(moves[0]).toEqual(savedMove);
    expect(withCommonTechMoves("Aang", moves)).toEqual(moves);
  });

  it("keeps an existing 2AA but does not recreate it after removal", () => {
    const existing = withCommonTechMoves("Aang", []);
    const saved2AA = { ...existing[0], id: "aang-2aa", input: "2AA", startup: 8 };
    expect(withCommonTechMoves("Aang", [saved2AA])).toContainEqual(saved2AA);
    expect(withCommonTechMoves("Aang", []).some((move) => move.input === "2AA")).toBe(false);
  });

  it("defaults directional F inputs to flow stances but respects a manual change", () => {
    const moves = withCommonTechMoves("Aang", []);
    for (const input of ["2F", "4F", "6F"]) {
      const move = moves.find((candidate) => candidate.input === input)!;
      expect(move.isFlowStance).toBe(true);
      expect(move.isStanceParent).toBe(true);
      expect(resolveFlowStance({ ...move, isFlowStance: false, isStanceParent: false })).toBe(true);
      expect(resolveFlowStance({ ...move, flowStanceOverride: false })).toBe(false);
    }
    expect(isNonMotionFMove("j.2F")).toBe(true);
    expect(isNonMotionFMove("236F")).toBe(false);
    expect(isNonMotionFMove("22F")).toBe(false);
    expect(isNonMotionFMove("2[F]")).toBe(false);
    expect(isNonMotionFMove("F")).toBe(false);
  });
});
