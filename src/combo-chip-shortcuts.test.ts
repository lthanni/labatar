import { describe, expect, it } from "vite-plus/test";
import {
  defaultChipShortcutBindings,
  normalizeChipShortcutKey,
  parseChipShortcutBindings,
} from "./combo-chip-shortcuts";

describe("combo chip shortcuts", () => {
  it("uses the requested defaults and accepts printable, distinct custom keys", () => {
    expect(defaultChipShortcutBindings).toEqual({
      followup: "`",
      togglePosition: "j",
      removeDirection: "r",
      anyAttack: "x",
      delay: "d",
      charged: "[",
      crit: "1",
    });
    expect(normalizeChipShortcutKey("J")).toBe("j");
    expect(normalizeChipShortcutKey("Enter")).toBeNull();
    expect(normalizeChipShortcutKey(" ")).toBeNull();
    expect(
      parseChipShortcutBindings({
        followup: "v",
        togglePosition: "A",
        removeDirection: "d",
        anyAttack: "c",
        delay: "e",
        charged: "]",
        crit: "2",
      }),
    ).toEqual({
      followup: "v",
      togglePosition: "a",
      removeDirection: "d",
      anyAttack: "c",
      delay: "e",
      charged: "]",
      crit: "2",
    });
  });

  it("keeps four saved custom bindings when adding the follow-up key", () => {
    expect(
      parseChipShortcutBindings({
        togglePosition: "a",
        removeDirection: "d",
        charged: "]",
        crit: "2",
      }),
    ).toEqual({
      followup: "`",
      togglePosition: "a",
      removeDirection: "d",
      anyAttack: "x",
      delay: "e",
      charged: "]",
      crit: "2",
    });
    expect(
      parseChipShortcutBindings({
        togglePosition: "`",
        removeDirection: "d",
        charged: "]",
        crit: "2",
      }).followup,
    ).toBe("~");
    expect(
      parseChipShortcutBindings({
        followup: "`",
        togglePosition: "x",
        removeDirection: "d",
        charged: "]",
        crit: "2",
      }).anyAttack,
    ).toBe("v");
    expect(
      parseChipShortcutBindings({
        togglePosition: "a",
        removeDirection: "r",
        charged: "]",
        crit: "2",
      }).delay,
    ).toBe("d");
  });

  it("falls back to defaults for duplicate or incomplete saved bindings", () => {
    expect(
      parseChipShortcutBindings({
        followup: "r",
        togglePosition: "j",
        removeDirection: "J",
        anyAttack: "x",
        delay: "d",
        charged: "[",
        crit: "1",
      }),
    ).toEqual(defaultChipShortcutBindings);
    expect(parseChipShortcutBindings({ togglePosition: "x" })).toEqual(defaultChipShortcutBindings);
  });
});
