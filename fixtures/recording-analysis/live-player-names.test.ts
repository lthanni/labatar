import { createRequire } from "node:module";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const { createLivePlayerNameTracker } = require("../../electron/live-player-names.cjs");

describe("live lobby player names", () => {
  it("uses a complete named pair only after setup confirms the same lobby", () => {
    const tracker = createLivePlayerNameTracker();
    tracker.setLobby("2474146963266724268");
    tracker.observe("[08:04:35] [MAT] Player 0 is filled out: LockeZeroSix");
    tracker.observe("[08:04:35] [MAT] Player 1 is filled out: MY LEG IT'S CAUGHT IN A BEAR TRA");
    expect(tracker.namesFor("2474146963266724268")).toBeNull();
    tracker.observe(
      "[08:04:35] [MAT] GotSetupGameMetadata: Lobby '2474146963266724268' has metadata for 2/2 players",
    );
    expect(tracker.namesFor("2474146963266724268")).toEqual({
      player1: "LockeZeroSix",
      player2: "MY LEG IT'S CAUGHT IN A BEAR TRA",
    });
    expect(tracker.namesFor("another-lobby")).toBeNull();
  });

  it("does not carry names across a lobby transition or accept partial setup", () => {
    const tracker = createLivePlayerNameTracker();
    tracker.setLobby("old");
    tracker.observe("[MAT] Player 0 is filled out: Old player");
    tracker.observe("[MAT] Player 1 is filled out: Old opponent");
    tracker.observe("GotSetupGameMetadata: Lobby '123' has metadata for 2/2 players");
    tracker.setLobby("123");
    expect(tracker.namesFor("123")).toBeNull();
    tracker.observe("[MAT] Player 0 is filled out: New player");
    tracker.observe("GotSetupGameMetadata: Lobby '123' has metadata for 2/2 players");
    expect(tracker.namesFor("123")).toBeNull();
    tracker.observe("[MAT] Player 1 is filled out: New opponent");
    tracker.observe("GotSetupGameMetadata: Lobby '123' has metadata for 2/2 players");
    expect(tracker.namesFor("123")).toBeNull();
  });

  it("ignores empty player names", () => {
    const tracker = createLivePlayerNameTracker();
    tracker.setLobby("123");
    tracker.observe("[MAT] Player 0 is filled out: Alice");
    tracker.observe("[MAT] Player 1 is filled out:   ");
    tracker.observe("GotSetupGameMetadata: Lobby '123' has metadata for 2/2 players");
    expect(tracker.namesFor("123")).toBeNull();
  });
});
