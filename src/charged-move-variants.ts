import { parseMoveNotation } from "./move-notation";
import type { TechMove } from "./tech-types";

export function chargedInputFor(input: string): string | null {
  const parsed = parseMoveNotation(input, { allowDirectionless: true });
  if (!parsed.ok || parsed.isCharged) return null;
  return `${parsed.isAirborne ? "j." : ""}${parsed.prefix}[${parsed.button}]`;
}

export function linkLegacyChargedMoves(moves: TechMove[]): TechMove[] {
  const linked = moves.map((move) => ({ ...move }));
  for (const charged of linked) {
    if (!charged.isCharged || charged.baseMoveId) continue;
    const parsed = parseMoveNotation(charged.input, { allowDirectionless: true });
    if (!parsed.ok) continue;
    const baseInput = `${parsed.isAirborne ? "j." : ""}${parsed.prefix}${parsed.button}`;
    const expectedInput = chargedInputFor(baseInput);
    if (!expectedInput) continue;
    let base = linked.find(
      (move) => !move.isCharged && move.input === baseInput && !move.chargedMoveId,
    );
    if (!base) {
      const stem = `${charged.id}-standard`;
      let id = stem;
      let suffix = 2;
      while (linked.some((move) => move.id === id)) id = `${stem}-${suffix++}`;
      base = {
        ...charged,
        id,
        input: baseInput,
        isCharged: false,
        chargedMoveId: charged.id,
        baseMoveId: null,
        startup: null,
        active: null,
        recovery: null,
        onBlock: null,
        blockstun: null,
        hitstun: null,
        resourceCosts: { pips: 0, flow: 0 },
      };
      linked.push(base);
    }
    base.chargedMoveId = charged.id;
    charged.baseMoveId = base.id;
    charged.input = expectedInput;
  }
  return linked;
}

export function withChargedVariant(
  moves: TechMove[],
  baseId: string,
  enabled: boolean,
): TechMove[] {
  const base = moves.find((move) => move.id === baseId);
  if (!base || base.isCharged || base.baseMoveId) return moves;
  const linked = moves.find((move) => move.id === base.chargedMoveId || move.baseMoveId === baseId);
  if (!enabled) {
    return moves
      .filter((move) => move.id !== linked?.id)
      .map((move) => (move.id === baseId ? { ...move, chargedMoveId: null } : move));
  }
  const chargedInput = chargedInputFor(base.input);
  if (!chargedInput) return moves;
  if (linked) {
    return moves.map((move) =>
      move.id === baseId
        ? { ...move, chargedMoveId: linked.id }
        : move.id === linked.id
          ? { ...move, input: chargedInput, isCharged: true, baseMoveId: baseId }
          : move,
    );
  }
  const stem = `${baseId}-charged`;
  let id = stem;
  let suffix = 2;
  while (moves.some((move) => move.id === id)) id = `${stem}-${suffix++}`;
  const charged: TechMove = {
    ...base,
    id,
    input: chargedInput,
    isCharged: true,
    isStanceParent: false,
    stanceFollowupPattern: null,
    stanceMinimumDuration: null,
    chargedMoveId: null,
    baseMoveId: baseId,
    startup: null,
    active: null,
    recovery: null,
    onBlock: null,
    blockstun: null,
    hitstun: null,
    resourceCosts: { pips: 0, flow: 0 },
  };
  return [
    ...moves.map((move) => (move.id === baseId ? { ...move, chargedMoveId: id } : move)),
    charged,
  ];
}
