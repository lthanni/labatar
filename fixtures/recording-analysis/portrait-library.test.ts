import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const {
  portraitAssetFromFilename,
  publishPortraits,
  readPortraitCatalog,
  portraitPlayerNameHints,
  portraitArtwork,
  missingPortraitArtwork,
  portraitMatchup,
} = require("../../electron/portrait-library.cjs");

describe("local portrait library", () => {
  it("reports every missing character and support PNG", () => {
    const complete = Object.fromEntries(
      [
        "aang",
        "korra",
        "zuko",
        "katara",
        "toph",
        "sokka",
        "azula",
        "kyoshi",
        "ozai",
        "zaheer",
        "aang_avchar",
        "korra_nightmare",
      ].map((character) => [
        character,
        new Set(["portrait.png", "support1.png", "support2.png", "support3.png"]),
      ]),
    );
    expect(missingPortraitArtwork(complete)).toEqual([]);
    complete.aang.delete("support2.png");
    complete.korra_nightmare.delete("portrait.png");
    expect(missingPortraitArtwork(complete)).toEqual([
      "Aang support #2",
      "Nightmare Korra portrait",
    ]);
  });

  it("resolves replay character and support art without a recording", () => {
    const catalog = {
      aang: new Set(["portrait.png", "support1.png"]),
      aang_avchar: new Set(["portrait.png", "support3.png"]),
    };
    expect(portraitArtwork("Aang", "Gyatso", catalog)).toEqual({
      portraitUrl: "labatar-media://portrait/aang/portrait.png",
      supportUrl: "labatar-media://portrait/aang/support1.png",
    });
    expect(portraitArtwork("Avatar Aang", "Guru Pathik", catalog)).toEqual({
      portraitUrl: "labatar-media://portrait/aang_avchar/portrait.png",
      supportUrl: "labatar-media://portrait/aang_avchar/support3.png",
    });
    expect(portraitArtwork("Unmapped", "Unknown", catalog)).toEqual({
      portraitUrl: null,
      supportUrl: null,
    });
  });

  it("organizes only character and numbered support portraits", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "labatar-portraits-"));
    try {
      const decoded = path.join(root, "decoded", "srcdata", "munged", "frames");
      const library = path.join(root, "portraits");
      await mkdir(decoded, { recursive: true });
      await writeFile(path.join(decoded, "sprites~aang~hud~art~portraitart.png"), "main");
      await writeFile(path.join(decoded, "sprites~aang~hud~art~support1.png"), "support");
      await writeFile(path.join(decoded, "sprites~aang~hud~art~support2-samurai.png"), "variant");
      await writeFile(path.join(decoded, "sprites~aang~hud~supportart~supportart1.png"), "other");
      await writeFile(path.join(decoded, "sprites~aang~idle~frame01.png"), "animation");

      expect(portraitAssetFromFilename("sprites~aang~hud~art~support1.png")).toEqual({
        characterId: "aang",
        assetName: "support1",
      });
      expect(await publishPortraits(path.join(root, "decoded"), library)).toBe(3);
      expect(await readFile(path.join(library, "characters", "aang", "portrait.png"), "utf8")).toBe(
        "main",
      );
      expect(await readdir(path.join(library, "characters", "aang"))).toEqual([
        "portrait.png",
        "support1.png",
        "support2-samurai.png",
      ]);
      const catalog = await readPortraitCatalog(library);
      expect([...catalog.aang].sort((left, right) => left.localeCompare(right))).toEqual([
        "portrait.png",
        "support1.png",
        "support2-samurai.png",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses player slots and support names from the first linked game", () => {
    const catalog = {
      aang: new Set(["portrait.png", "support1.png"]),
      zaheer: new Set(["portrait.png", "support2.png"]),
    };
    const matchup = portraitMatchup(
      {
        games: [
          {
            gameNumber: 1,
            replay: {
              player1: "ZaheerPlayer",
              player1Character: "Zaheer",
              player1Support: "P'Li",
              player2: "AangPlayer",
              player2Character: "Aang",
              player2Support: "Gyatso",
            },
          },
          { gameNumber: 2 },
        ],
      },
      catalog,
    );
    expect(matchup).toEqual({
      gameCount: 2,
      gameNumber: 1,
      players: [
        {
          slot: 1,
          playerName: "ZaheerPlayer",
          character: "Zaheer",
          support: "P'Li",
          portraitUrl: "labatar-media://portrait/zaheer/portrait.png",
          supportUrl: "labatar-media://portrait/zaheer/support2.png",
        },
        {
          slot: 2,
          playerName: "AangPlayer",
          character: "Aang",
          support: "Gyatso",
          portraitUrl: "labatar-media://portrait/aang/portrait.png",
          supportUrl: "labatar-media://portrait/aang/support1.png",
        },
      ],
    });
  });

  it("does not borrow support portraits from a different game", () => {
    const matchup = portraitMatchup(
      {
        games: [
          {
            gameNumber: 1,
            metadata: { player1Character: "Aang", player2Character: "Korra" },
          },
        ],
        replays: [
          {
            replay: {
              player1Character: "Zuko",
              player1Support: "Mai",
              player2Character: "Azula",
              player2Support: "Ursa",
            },
          },
        ],
      },
      { aang: new Set(["portrait.png"]), korra: new Set(["portrait.png"]) },
    );
    expect(matchup.players[0].character).toBe("Aang");
    expect(matchup.players[1].character).toBe("Korra");
    expect(matchup.players[0].playerName).toBe("Player 1");
    expect(matchup.players[1].playerName).toBe("Player 2");
    expect(matchup.players[0].supportUrl).toBeNull();
    expect(matchup.players[1].supportUrl).toBeNull();
  });

  it("uses replay names from the same Steam IDs when older metadata has no names", () => {
    const recordings = [
      {
        modifiedAt: 100,
        games: [
          {
            metadata: {
              player1SteamId: "111",
              player2SteamId: "222",
              player1Character: "Aang",
              player2Character: "Korra",
            },
            replay: { player1: "P1", player2: "P2" },
          },
        ],
      },
      {
        modifiedAt: 200,
        games: [
          {
            metadata: { player1SteamId: "111", player2SteamId: "333" },
            replay: { player1: "AangPlayer", player2: "KorraPlayer" },
          },
        ],
      },
      {
        modifiedAt: 50,
        games: [
          {
            metadata: { player1SteamId: "111" },
            replay: { player1: "OlderName" },
          },
        ],
      },
    ];
    const hints = portraitPlayerNameHints(recordings);
    const matchup = portraitMatchup(recordings[0], {}, hints);
    expect(matchup.players[0].playerName).toBe("AangPlayer");
    expect(matchup.players[1].playerName).toBe("Player 2");
    expect(hints.get("111")).toBe("AangPlayer");
  });
});
