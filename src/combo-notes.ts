import type { ComboNote, ComboNoteCategory, ComboNoteRange } from "./tech-types";
import { normalizeMoveNotation } from "./move-notation";

export type ComboRouteToken = { text: string; start: number; end: number };

export function comboRouteTokens(route: string): ComboRouteToken[] {
  const tokens: ComboRouteToken[] = [];
  let index = 0;
  while (index < route.length) {
    const character = route[index];
    if (/\s/.test(character)) {
      index += 1;
    } else if (route.startsWith("->", index)) {
      index += 2;
    } else if (character === ">" || character === "," || character === "~" || character === "→") {
      index += 1;
    } else {
      const start = index;
      while (
        index < route.length &&
        !/\s/.test(route[index]) &&
        !route.startsWith("->", index) &&
        ![">", ",", "~", "→"].includes(route[index])
      ) {
        index += 1;
      }
      tokens.push({ text: route.slice(start, index), start, end: index });
    }
  }
  return tokens;
}

/** Canonicalize recognized move inputs without changing route separators or free text. */
export function normalizeComboRoute(route: string): string {
  const tokens = comboRouteTokens(route);
  let result = "";
  let offset = 0;
  for (const token of tokens) {
    const hit = /\(\d+\)$/.exec(token.text)?.[0] ?? "";
    const withoutHit = hit ? token.text.slice(0, -hit.length) : token.text;
    const crit = withoutHit.endsWith("!") ? "!" : "";
    const input = crit ? withoutHit.slice(0, -1) : withoutHit;
    const notation = normalizeMoveNotation(input, { allowDirectionless: true });
    result += route.slice(offset, token.start) + (notation ? notation + crit + hit : token.text);
    offset = token.end;
  }
  return result + route.slice(offset);
}

/** Format move inputs and use one space between moves. A tilde stays attached
 * to a stance followup because it carries route meaning. */
export function formatComboRoute(route: string): string {
  const normalized = normalizeComboRoute(route);
  const tokens = comboRouteTokens(normalized);
  return tokens
    .map((token, index) => {
      if (index === 0) return token.text;
      const gap = normalized.slice(tokens[index - 1].end, token.start);
      return `${gap.includes("~") ? "~" : " "}${token.text}`;
    })
    .join("");
}

export function comboRouteFormatError(route: string): string | null {
  if (!route.trim()) return "Enter a combo route.";
  if (route.includes("<")) return "Remove < from the route.";
  if (route !== formatComboRoute(route)) {
    return "Use one space between moves, with no arrows or commas. Keep ~ attached to stance followups and use move casing like 2B or j.2C.";
  }
  return null;
}

/** Keep valid note selections attached to the same tokens after normalization. */
export function normalizeComboNoteRanges(
  originalRoute: string,
  normalizedRoute: string,
  notes: ComboNote[],
): ComboNote[] {
  const tokens = comboRouteTokens(normalizedRoute);
  return notes.map((note) => {
    const range = note.range;
    if (!range || !comboNoteRangeOffsets(originalRoute, range)) return note;
    return {
      ...note,
      range: {
        ...range,
        excerpt: normalizedRoute.slice(
          tokens[range.startToken].start,
          tokens[range.endToken - 1].end,
        ),
      },
    };
  });
}

export function comboNoteRangeFromSelection(
  route: string,
  selectionStart: number,
  selectionEnd: number,
): ComboNoteRange | null {
  if (selectionStart >= selectionEnd) return null;
  const tokens = comboRouteTokens(route);
  const first = tokens.findIndex(
    (token) => token.end > selectionStart && token.start < selectionEnd,
  );
  if (first < 0) return null;
  let last = first;
  while (last + 1 < tokens.length && tokens[last + 1].start < selectionEnd) last += 1;
  return {
    startToken: first,
    endToken: last + 1,
    excerpt: route.slice(tokens[first].start, tokens[last].end),
  };
}

export function comboNoteRangeOffsets(
  route: string,
  range: ComboNoteRange,
): { start: number; end: number } | null {
  const tokens = comboRouteTokens(route);
  if (
    !Number.isInteger(range.startToken) ||
    !Number.isInteger(range.endToken) ||
    range.startToken < 0 ||
    range.endToken <= range.startToken ||
    range.endToken > tokens.length
  )
    return null;
  const start = tokens[range.startToken].start;
  const end = tokens[range.endToken - 1].end;
  return route.slice(start, end) === range.excerpt ? { start, end } : null;
}

export function comboNotesOverlap(left: ComboNoteRange, right: ComboNoteRange): boolean {
  return left.startToken < right.endToken && right.startToken < left.endToken;
}

export function comboNoteCategoryLabel(category: ComboNoteCategory): string {
  switch (category) {
    case "execution":
      return "Execution";
    case "situational":
      return "Situational";
    default:
      return "General";
  }
}

export function normalizeComboNotes(value: unknown): ComboNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index): ComboNote[] => {
    if (typeof entry === "string") {
      return [{ id: `legacy-${index}`, text: entry, category: "general" }];
    }
    if (!entry || typeof entry !== "object" || typeof entry.text !== "string") return [];
    const category: ComboNoteCategory =
      entry.category === "execution" || entry.category === "situational"
        ? entry.category
        : "general";
    const range = entry.range;
    return [
      {
        id: typeof entry.id === "string" && entry.id ? entry.id : `legacy-${index}`,
        text: entry.text,
        category,
        ...(range &&
        typeof range === "object" &&
        Number.isInteger(range.startToken) &&
        Number.isInteger(range.endToken) &&
        typeof range.excerpt === "string"
          ? {
              range: {
                startToken: range.startToken,
                endToken: range.endToken,
                excerpt: range.excerpt,
              },
            }
          : {}),
      },
    ];
  });
}
