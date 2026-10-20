import { describe, expect, it } from "vite-plus/test";
import {
  fetchPublishedCatalog,
  isPublishedCombo,
  parsePublishedCatalog,
} from "./published-catalog";

const move = {
  id: "aang-2a",
  characterId: "aang",
  input: "2A",
  label: "Low attack",
  startup: 8,
  active: 2,
  recovery: 12,
  onBlock: -2,
  blockstun: 10,
  hitstun: 15,
  resourceCosts: { pips: 0, flow: 0 },
  mechanics: [],
};

const combo = {
  id: "aang-basic",
  characterId: "aang",
  supportId: "gyatso",
  route: "2A > 5B",
  moveIds: ["aang-2a"],
  screenPosition: "midscreen",
  damage: "3200",
  resourceCosts: { pips: 1, flow: 0 },
  mechanics: ["corner carry"],
  youtubeVideoId: "M7lc1UVf-VE",
  startSeconds: 3,
};

function mockFetch(moves: unknown, combos: unknown): typeof fetch {
  return async (input) =>
    new Response(
      JSON.stringify(
        (typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url
        ).endsWith("/moves")
          ? moves
          : combos,
      ),
      {
        status: 200,
      },
    );
}

describe("published catalog", () => {
  it("loads moves and combos as one validated snapshot", async () => {
    const catalog = await fetchPublishedCatalog(
      mockFetch({ items: [move] }, { items: [combo] }),
      "https://catalog.example",
    );
    expect(catalog.moves).toEqual([move]);
    expect(catalog.combos).toEqual([combo]);
    expect(catalog.fetchedAt).toBeGreaterThan(0);
  });

  it("rejects an invalid combo response instead of accepting a partial catalog", async () => {
    await expect(
      fetchPublishedCatalog(
        mockFetch({ items: [move] }, { items: [{ ...combo, youtubeVideoId: "bad" }] }),
      ),
    ).rejects.toThrow("unexpected format");
  });

  it("rejects a damaged offline snapshot", () => {
    expect(() =>
      parsePublishedCatalog({
        fetchedAt: 1,
        moves: [move],
        combos: [{ ...combo, moveIds: [null] }],
      }),
    ).toThrow("unexpected format");
  });

  it("requires a valid catalog revision when one is supplied", () => {
    expect(() =>
      parsePublishedCatalog({
        fetchedAt: 1,
        moves: [move],
        combos: [{ ...combo, revision: 0 }],
      }),
    ).toThrow("unexpected format");
    expect(
      parsePublishedCatalog({ fetchedAt: 1, moves: [move], combos: [{ ...combo, revision: 2 }] })
        .combos[0].revision,
    ).toBe(2);
  });

  it("preserves a candidate ID for matching the submitter's local draft", () => {
    const sourceCandidateId = "12345678-1234-1234-1234-123456789abc";
    expect(isPublishedCombo({ ...combo, sourceCandidateId })).toBe(true);
    expect(
      parsePublishedCatalog({
        fetchedAt: 1,
        moves: [],
        combos: [{ ...combo, sourceCandidateId }],
      }).combos[0].sourceCandidateId,
    ).toBe(sourceCandidateId);
    expect(() =>
      parsePublishedCatalog({
        fetchedAt: 1,
        moves: [],
        combos: [{ ...combo, sourceCandidateId: "bad" }],
      }),
    ).toThrow("unexpected format");
  });
});
