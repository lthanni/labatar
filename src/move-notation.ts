export const MOVE_BUTTONS = ["A", "B", "C", "F", "EX", "SUP", "X"] as const;

export type MoveButton = (typeof MOVE_BUTTONS)[number];

export type ParsedMoveNotation = {
  notation: string;
  prefix: string;
  button: MoveButton;
  isAirborne: boolean;
  isDirectional: boolean;
};

export type MoveNotationResult = ({ ok: true } & ParsedMoveNotation) | { ok: false; error: string };

const INVALID_MOVE_NOTATION_MESSAGE =
  "Use j.1-9, 1-9, 214, 236, or 22 followed by A, B, C, F, EX, SUP, or X.";

function compactMoveInput(input: string) {
  return input
    .trim()
    .replace(/\s+/g, "")
    .replace(/^~+|~+$/g, "");
}

export function parseMoveNotation(input: string): MoveNotationResult {
  const compact = compactMoveInput(input);
  const match = /^(j\.)?(214|236|22|[1-9])?(EX|SUP|A|B|C|F|X)$/i.exec(compact);
  if (!match || (!match[1] && !match[2])) {
    return { ok: false, error: INVALID_MOVE_NOTATION_MESSAGE };
  }

  const isAirborne = Boolean(match[1]);
  const prefix = match[2] ?? "";
  const button = match[3].toUpperCase() as MoveButton;
  return {
    ok: true,
    notation: `${isAirborne ? "j." : ""}${prefix}${button}`,
    prefix,
    button,
    isAirborne,
    isDirectional: /^[1-9]$/.test(prefix),
  };
}

export function normalizeMoveNotation(input: string) {
  const parsed = parseMoveNotation(input);
  return parsed.ok ? parsed.notation : null;
}

export function moveNotationsMatch(knownInput: string, observedInput: string) {
  const known = parseMoveNotation(knownInput);
  const observed = parseMoveNotation(observedInput);
  if (!known.ok || !observed.ok) return false;
  if (known.notation === observed.notation) return true;
  return (
    known.prefix === observed.prefix &&
    known.isAirborne === observed.isAirborne &&
    known.button === "X" &&
    ["A", "B", "C"].includes(observed.button)
  );
}

export function isDirectionalButtonFollowup(input: string) {
  const parsed = parseMoveNotation(input);
  return parsed.ok && parsed.isDirectional && !parsed.isAirborne;
}
