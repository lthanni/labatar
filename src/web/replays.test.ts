import { describe, expect, it } from "vite-plus/test";
import {
  combineReplaySubfolder,
  normalizeDirectoryInputFiles,
  rescanReplayFolder,
  type ReplayFolderSelection,
} from "./replays";

function replay(fields: Record<string, string>) {
  return new Blob([
    Object.entries(fields)
      .map(([key, value]) => `${key} = ${value}`)
      .join("\n"),
  ]);
}

describe("browser replay scanning", () => {
  it("keeps text and PAK files from separately chosen folder inputs", () => {
    const inputFile = (relativePath: string) =>
      Object.assign(new Blob(["local"]), { webkitRelativePath: relativePath }) as File;
    expect(
      normalizeDirectoryInputFiles(
        [inputFile("logs/match.txt"), inputFile("logs/ignore.bin")],
        "logs",
      ).map((file) => file.relativePath),
    ).toEqual(["match.txt"]);
    expect(
      normalizeDirectoryInputFiles([inputFile("data_packages/a.pak")], "data_packages").map(
        (file) => file.relativePath,
      ),
    ).toEqual(["a.pak"]);
  });

  it("combines separately selected game folders under their expected paths", async () => {
    const replayFile = replay({ ReplayInfo_P1Name: "A", ReplayInfo_P2Name: "B" });
    const replays = combineReplaySubfolder(null, "replays", {
      name: "replays",
      files: [{ relativePath: "nested/2025-04-03 10-11-12.dlr", file: replayFile }],
    });
    const withLogs = combineReplaySubfolder(replays, "logs", {
      name: "logs",
      files: [{ relativePath: "match.txt", file: new Blob(["optional log"]) }],
    });
    const withArtwork = combineReplaySubfolder(withLogs, "data_packages", {
      name: "data_packages",
      files: [{ relativePath: "characters.pak", file: new Blob(["pak"]) }],
    });
    const result = await rescanReplayFolder(withArtwork);
    expect(result.games).toHaveLength(1);
    expect(result.games[0].id).toBe("replays/nested/2025-04-03 10-11-12.dlr");
    expect(result.files.map((file) => file.relativePath)).toEqual([
      "data_packages/characters.pak",
      "logs/match.txt",
      "replays/nested/2025-04-03 10-11-12.dlr",
    ]);
    const replaced = combineReplaySubfolder(withArtwork, "logs", {
      name: "new logs",
      files: [{ relativePath: "later.txt", file: new Blob(["new"]) }],
    });
    expect(replaced.files.map((file) => file.relativePath)).toContain("logs/later.txt");
    expect(replaced.files.map((file) => file.relativePath)).not.toContain("logs/match.txt");
  });

  it("recursively scans the selected files, maps fields, and counts duplicate contents once", async () => {
    const bytes = replay({
      ReplayInfo_P1Name: "User@@Alice",
      ReplayInfo_P2Name: "Bob",
      ReplayInfo_Winner: "1",
      P1: "AANG",
      P2: "KORRA",
      P1_SupportCharId: "1",
      P2_SupportCharId: "0",
      TM_WinsT1: "2",
      TM_WinsT2: "1",
    });
    const selection: ReplayFolderSelection = {
      name: "game",
      files: [
        { relativePath: "replays/nested/2025-04-03 10-11-12.dlr", file: bytes },
        { relativePath: "replays/zz-duplicate.dlr", file: bytes },
      ],
    };
    const result = await rescanReplayFolder(selection);
    expect(result.games).toHaveLength(1);
    expect(result.games[0]).toMatchObject({
      id: "replays/nested/2025-04-03 10-11-12.dlr",
      timestamp: "2025-04-03 10:11:12",
      player1: "Alice",
      player2: "Bob",
      player1Character: "Aang",
      player2Character: "Korra",
      player1Support: "Gyatso",
      player2Support: "None",
      winner: "Alice",
      roundScore: "2 - 1",
    });
    expect(result.duplicateCount).toBe(1);
    expect(result.playerCounts).toEqual({ Alice: 1, Bob: 1 });
  });

  it("keeps malformed replay files with desktop-compatible defaults and reports cancellation", async () => {
    const selection: ReplayFolderSelection = {
      name: "replays",
      files: [{ relativePath: "broken.dlr", file: new Blob(["not a replay"]) }],
    };
    const result = await rescanReplayFolder(selection);
    expect(result.games[0]).toMatchObject({
      player1: "Player 1",
      player2: "Player 2",
      player1Character: "Unknown",
      winner: "Unknown",
      roundScore: "Unknown",
      timestamp: null,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      rescanReplayFolder(selection, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("associates optional ratings logs by replay filename", async () => {
    const log = new Blob([
      "SetNewMatch: Player 1: Aang (SteamID: 1) Glicko: [R: 100: D: 2: Vol: 0.4]\n" +
        "SetNewMatch: Player 2: Korra (SteamID: 2) Glicko: [R: 200: D: 3: Vol: 0.5]\n" +
        "Gathered ratings for header: Ranked | P1 glicko 100/2 charMMR 1200 | P2 glicko 200/3 charMMR 1300\n" +
        "Successfully wrote replay file: C:\\game\\replays\\ranked.dlr",
    ]);
    Object.defineProperty(log, "text", {
      value: () => {
        throw new Error("Logs must be streamed, not loaded whole.");
      },
    });
    const selection: ReplayFolderSelection = {
      name: "game",
      files: [
        {
          relativePath: "replays/ranked.dlr",
          file: replay({ ReplayInfo_P1Name: "A", ReplayInfo_P2Name: "B" }),
        },
        {
          relativePath: "logs/match.txt",
          file: log,
        },
      ],
    };
    const result = await rescanReplayFolder(selection);
    expect(result.games[0].ratings).toMatchObject({
      mode: "Ranked",
      player1: { rating: 100, characterMmr: 1200, volatility: 0.4 },
      player2: { rating: 200, characterMmr: 1300, volatility: 0.5 },
    });
  });
});
