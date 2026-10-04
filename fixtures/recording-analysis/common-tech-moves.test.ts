import { describe, expect, it } from "vite-plus/test";
import { withCommonTechMoves } from "../../src/common-tech-moves";

describe("assumed Tech moves", () => {
  it("starts each character with the requested inputs and unknown frame data", () => {
    const inputs = withCommonTechMoves("Aang", []);
    expect(inputs.map((move) => move.input)).toEqual([
      "2A",
      "2B",
      "2C",
      "5A",
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
    expect(moves).toHaveLength(21);
    expect(moves[0]).toEqual(savedMove);
    expect(withCommonTechMoves("Aang", moves)).toEqual(moves);
  });
});
