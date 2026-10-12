const test = require("node:test");
const assert = require("node:assert/strict");
const { createInterruptedMatchScanner } = require("./interrupted-match-scanner.cjs");

void test("marks an interrupted game without a replay, including an error after EndMatch", () => {
  const scanner = createInterruptedMatchScanner();
  for (const line of [
    "[08:13:32] [TEL] SetNewMatch: New match started with ID unfinished-game",
    "[08:15:00] [TEL] EndRound: Winner is Aang",
    "[08:15:09] [TEL] EndMatch: Match ended and telemetry submitted",
    "[08:15:09] LogNetplayEvent: /(UI_NetworkError_ConnectionInterrupted) -> FrameNum: 3485334",
    "[08:21:00] [TEL] SetNewMatch: New match started with ID finished-game",
    "[08:22:00] Successfully wrote replay file: C:\\replays\\finished.dlr",
    "[08:22:01] LogNetplayEvent: /(UI_NetworkError_ConnectionInterrupted) -> FrameNum: 123",
  ]) {
    scanner.processLine(line);
  }
  assert.deepEqual(scanner.finish(), ["unfinished-game"]);
});
