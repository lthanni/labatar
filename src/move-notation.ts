export const MOVE_BUTTONS = ["A", "B", "C", "F", "EX", "SUP", "X"] as const;

export type MoveButton = (typeof MOVE_BUTTONS)[number];

export type ParsedMoveNotation = {
  notation: string;
  prefix: string;
  button: MoveButton;
  isAirborne: boolean;
  isDirectional: boolean;
  isDirectionless: boolean;
  isCharged: boolean;
};

export type MoveNotationResult = ({ ok: true } & ParsedMoveNotation) | { ok: false; error: string };

const INVALID_MOVE_NOTATION_MESSAGE =
  "Use j.1-9, 1-9, 214, 236, or 22 followed by A, B, C, F, EX, SUP, or X; charged buttons use brackets, such as 5[C].";

export type MoveNotationOptions = {
  /** Bare buttons are only valid as stance followups. */
  allowDirectionless?: boolean;
};

export type MoveInputClass = "normal" | "command-normal" | "other";

function compactMoveInput(input: string) {
  return input
    .trim()
    .replace(/\s+/g, "")
    .replace(/^~+|~+$/g, "");
}

export function parseMoveNotation(
  input: string,
  options: MoveNotationOptions = {},
): MoveNotationResult {
  const compact = compactMoveInput(input);
  const match = /^(j\.)?(214|236|22|[1-9])?(\[(?:EX|SUP|A|B|C|F|X)\]|EX|SUP|A|B|C|F|X)$/i.exec(
    compact,
  );
  if (!match) {
    return { ok: false, error: INVALID_MOVE_NOTATION_MESSAGE };
  }

  const isAirborne = Boolean(match[1]);
  const prefix = match[2] ?? "";
  if (!prefix && !isAirborne && !options.allowDirectionless) {
    return { ok: false, error: INVALID_MOVE_NOTATION_MESSAGE };
  }
  const isCharged = match[3].startsWith("[");
  const button = match[3].replace(/^\[|\]$/g, "").toUpperCase() as MoveButton;
  return {
    ok: true,
    notation: `${isAirborne ? "j." : ""}${prefix}${isCharged ? `[${button}]` : button}`,
    prefix,
    button,
    isAirborne,
    isDirectional: /^[1-9]$/.test(prefix),
    isDirectionless: prefix === "" && !isAirborne,
    isCharged,
  };
}

export function normalizeMoveNotation(input: string, options: MoveNotationOptions = {}) {
  const parsed = parseMoveNotation(input, options);
  return parsed.ok ? parsed.notation : null;
}

export function moveNotationsMatch(knownInput: string, observedInput: string) {
  const known = parseMoveNotation(knownInput, { allowDirectionless: true });
  const observed = parseMoveNotation(observedInput, { allowDirectionless: true });
  if (!known.ok || !observed.ok) return false;
  if (known.notation === observed.notation) return true;
  return (
    !known.isCharged &&
    !observed.isCharged &&
    known.prefix === observed.prefix &&
    known.isAirborne === observed.isAirborne &&
    known.button === "X" &&
    ["A", "B", "C"].includes(observed.button)
  );
}

export function stanceFollowupMatches(knownInput: string, observedInput: string) {
  const known = parseMoveNotation(knownInput, { allowDirectionless: true });
  const observed = parseMoveNotation(observedInput, { allowDirectionless: true });
  return Boolean(
    known.ok &&
    observed.ok &&
    known.isDirectionless &&
    !known.isCharged &&
    observed.isDirectional &&
    !observed.isAirborne &&
    known.button === observed.button,
  );
}

/**
 * Classifies only directional A/B/C attacks. Motion inputs and other buttons
 * remain "other" because they need game-specific move semantics.
 */
export function classifyMoveInput(
  input: string,
  options: MoveNotationOptions = {},
): MoveInputClass | null {
  const parsed = parseMoveNotation(input, options);
  if (!parsed.ok || !["A", "B", "C"].includes(parsed.button)) return null;
  if (parsed.isAirborne) {
    return parsed.prefix === "" || parsed.prefix === "5" ? "normal" : "command-normal";
  }
  if (parsed.prefix === "2" || parsed.prefix === "5") return "normal";
  return parsed.isDirectional ? "command-normal" : "other";
}

export function isFlowCancellableByDefault(input: string, options: MoveNotationOptions = {}) {
  return classifyMoveInput(input, options) === "command-normal";
}

export function isDirectionalButtonFollowup(input: string) {
  const parsed = parseMoveNotation(input);
  return parsed.ok && parsed.isDirectional && !parsed.isAirborne;
}
