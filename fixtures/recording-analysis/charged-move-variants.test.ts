import { describe, expect, it } from "vite-plus/test";
import {
  chargedInputFor,
  linkLegacyChargedMoves,
  withChargedVariant,
} from "../../src/charged-move-variants";
import { withCommonTechMoves } from "../../src/common-tech-moves";

describe("charged move variants", () => {
  it("can bracket a directionless stance followup", () => {
    expect(chargedInputFor("A")).toBe("[A]");
  });

  it("keeps the standard move and creates a linked bracketed version", () => {
    const initial = withCommonTechMoves("Aang", []);
    const base = initial.find((move) => move.input === "5C")!;
    const linked = withChargedVariant(initial, base.id, true);
    const standard = linked.find((move) => move.id === base.id)!;
    const charged = linked.find((move) => move.id === standard.chargedMoveId)!;
    expect(linked).toHaveLength(initial.length + 1);
    expect(standard.input).toBe("5C");
    expect(charged.input).toBe("5[C]");
    expect(charged.baseMoveId).toBe(standard.id);
    expect(charged.startup).toBeNull();
    expect(withChargedVariant(linked, base.id, true)).toEqual(linked);
    const renamed = withChargedVariant(
      linked.map((move) => (move.id === base.id ? { ...move, input: "6C" } : move)),
      base.id,
      true,
    );
    expect(renamed.find((move) => move.id === charged.id)?.input).toBe("6[C]");
    expect(withChargedVariant(linked, base.id, false)).toEqual(initial);
  });

  it("links an older charged entry without replacing its ID or measurements", () => {
    const initial = withCommonTechMoves("Aang", []);
    const base = initial.find((move) => move.input === "5C")!;
    const oldCharged = { ...base, id: "old-charge", isCharged: true, startup: 8 };
    const linked = linkLegacyChargedMoves([...initial, oldCharged]);
    expect(linked.find((move) => move.id === base.id)?.chargedMoveId).toBe(oldCharged.id);
    expect(linked.find((move) => move.id === oldCharged.id)).toMatchObject({
      input: "5[C]",
      baseMoveId: base.id,
      startup: 8,
    });
  });

  it("creates a standard counterpart for an older charged-only move", () => {
    const oldCharged = {
      ...withCommonTechMoves("Aang", [])[0],
      id: "old-22ex-charge",
      input: "22EX",
      isCharged: true,
      startup: 12,
    };
    const linked = linkLegacyChargedMoves([oldCharged]);
    const charged = linked.find((move) => move.id === oldCharged.id)!;
    const standard = linked.find((move) => move.id === charged.baseMoveId)!;
    expect(charged.input).toBe("22[EX]");
    expect(standard).toMatchObject({
      input: "22EX",
      chargedMoveId: charged.id,
      startup: null,
    });
  });
});
