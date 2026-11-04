import { describe, expect, it } from "vite-plus/test";
import {
  comboRouteFormatError,
  comboNoteRangeOffsets,
  formatComboRoute,
  normalizeComboNoteRanges,
  normalizeComboRoute,
} from "./combo-notes";

describe("combo route normalization", () => {
  it("formats move separators and spacing while preserving stance followups", () => {
    expect(formatComboRoute("2b J.2c")).toBe("2B j.2C");
    expect(formatComboRoute(" 2b! > j.2c~a, 236ex -> 5b(2) → dash ")).toBe(
      "2B! j.2C~A 236EX 5B(2) dash",
    );
    expect(comboRouteFormatError("2B! j.2C~A 236EX")).toBeNull();
    expect(comboRouteFormatError("2B! > j.2C")).toMatch(/one space/);
    expect(comboRouteFormatError("5B < 236A")).toMatch(/Remove </);
  });

  it("normalizes move inputs while preserving separators, crits, hit counts, and free text", () => {
    expect(normalizeComboRoute(" 2b! > j.2c~a, 236ex -> 5b(2) > dash > 2bad ")).toBe(
      " 2B! > j.2C~A, 236EX -> 5B(2) > dash > 2bad ",
    );
  });

  it("keeps attached note ranges when a route is formatted", () => {
    const original = "2b! > 5c";
    const route = formatComboRoute(original);
    const notes = normalizeComboNoteRanges(original, route, [
      {
        id: "note-1",
        category: "execution",
        text: "Wait for the second hit",
        range: { startToken: 0, endToken: 2, excerpt: "2b! > 5c" },
      },
    ]);
    expect(notes[0].range?.excerpt).toBe("2B! 5C");
    expect(comboNoteRangeOffsets(route, notes[0].range!)).toEqual({ start: 0, end: route.length });
  });
});
