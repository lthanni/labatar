import { describe, expect, it } from "vite-plus/test";
import { supportFilters } from "../../src/AnalyticsSection";

describe("matchup portrait support slots", () => {
  it("keeps support portraits in game slot order with zero counts for unused slots", () => {
    expect(
      supportFilters("Aang", [
        { name: "Momo", games: 2 },
        { name: "Gyatso", games: 7 },
      ]),
    ).toEqual({
      slots: [
        { slot: 1, name: "Gyatso", games: 7 },
        { slot: 2, name: "Appa", games: 0 },
        { slot: 3, name: "Momo", games: 2 },
      ],
      extra: [],
    });
  });

  it("retains non-slot support filters such as None", () => {
    expect(supportFilters("Korra", [{ name: "None", games: 3 }])).toMatchObject({
      extra: [{ name: "None", games: 3 }],
    });
  });

  it("labels Zuko's numbered portrait slots in replay order", () => {
    expect(supportFilters("Zuko", [{ name: "June", games: 1 }]).slots).toEqual([
      { slot: 1, name: "Mai", games: 0 },
      { slot: 2, name: "Ran and Shaw", games: 0 },
      { slot: 3, name: "June", games: 1 },
    ]);
  });
});
