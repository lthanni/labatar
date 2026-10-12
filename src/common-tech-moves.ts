import type { TechMove } from "./tech-types";
import { isFlowCancellableByDefault, parseMoveNotation } from "./move-notation";

export function isNonMotionFMove(input: string) {
  const parsed = parseMoveNotation(input, { allowDirectionless: true });
  return parsed.ok && parsed.isDirectional && parsed.button === "F" && !parsed.isCharged;
}

export function resolveFlowStance(move: TechMove) {
  if (typeof move.flowStanceOverride === "boolean") return move.flowStanceOverride;
  if (move.isFlowStance === true) return true;
  // An existing stance selection takes precedence over the new input default.
  if (move.isStanceParent === true) return false;
  return isNonMotionFMove(move.input);
}

export const commonMoveInputs = [
  ...["A", "B", "C"].map((button) => `2${button}`),
  ...["A", "AA", "B", "C"].map((button) => `5${button}`),
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
    const isFlowStance = isNonMotionFMove(input);
    moves.push({
      id,
      character,
      input,
      isStanceParent: isFlowStance,
      isFlowStance,
      isCharged: false,
      nonstandard: false,
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
