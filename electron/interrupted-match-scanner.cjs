/** Tracks connection failures for matches that never produced a replay. */
function createInterruptedMatchScanner() {
  let current = null;
  const interruptedMatchIds = new Set();

  function finishCurrent() {
    if (current?.interrupted && !current.hasReplay) interruptedMatchIds.add(current.id);
  }

  return {
    processLine(line) {
      const start = line.match(/SetNewMatch:\s*New match started with ID\s*(.*?)\s*$/i);
      if (start) {
        finishCurrent();
        current = { id: start[1], interrupted: false, hasReplay: false };
      }
      if (!current) return;
      if (/Successfully wrote replay file:\s*.*?\.dlr/i.test(line)) current.hasReplay = true;
      if (
        /LogNetplayEvent:\s*\/\((?:UI_Netplay_TimeoutError|UI_NetworkError_ConnectionInterrupted)\)/i.test(
          line,
        )
      ) {
        current.interrupted = true;
      }
    },
    finish() {
      finishCurrent();
      return [...interruptedMatchIds];
    },
  };
}

module.exports = { createInterruptedMatchScanner };
