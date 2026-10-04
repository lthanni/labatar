import type { TechMove } from "./tech-types";
import { isFlowCancellableByDefault } from "./move-notation";

export const commonMoveInputs = [
  ...["2", "5"].flatMap((direction) => ["A", "B", "C"].map((button) => `${direction}${button}`)),
  ...["2", "4", "6"].map((direction) => `${direction}F`),
  ...["236", "214"].flatMap((motion) =>
    ["A", "B", "C", "EX"].map((button) => `${motion}${button}`),
  ),
  ...["A", "B", "C", "EX"].map((button) => `j.236${button}`),
];

export function withCommonTechMoves(character: string, existing: TechMove[]): TechMove[] {
  const moves = [...existing];
  for (const input of commonMoveInputs) {
    if (moves.some((move) => !move.isCharged && move.input.toUpperCase() === input.toUpperCase())) {
      continue;
    }
    const stem = `${character}-${input}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    let id = stem;
    let suffix = 2;
    while (moves.some((move) => move.id === id)) id = `${stem}-${suffix++}`;
    moves.push({
      id,
      character,
      input,
      isStanceParent: false,
      isCharged: false,
      flowCancellable: isFlowCancellableByDefault(input),
      stanceFollowupPattern: null,
      dependsOnMoveId: null,
      stanceMinimumDuration: null,
      chargedMoveId: null,
      baseMoveId: null,
      startup: null,
      active: null,
      recovery: null,
      onBlock: null,
      blockstun: null,
      hitstun: null,
      resourceCosts: { pips: 0, flow: 0 },
    });
  }
  return moves;
}
