const PAD_BUTTONS = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Start", "Back"];

function playerOnePadBindings(config) {
  const playerOne = String(config).split(/#-+\s*Player 2/i, 1)[0];
  const bindings = {};
  for (const match of playerOne.matchAll(/^Device\s+0\s+PAD_BTN_(\d+)\s+->\s+(\w+)\s*$/gm)) {
    const button = PAD_BUTTONS[Number(match[1])];
    if (button) bindings[button] = match[2];
  }
  return bindings;
}

function normalizedState(state, timeMs, bindings) {
  const buttons = Array.isArray(state.buttons)
    ? [...new Set(state.buttons.filter((button) => PAD_BUTTONS.includes(button)))].sort((a, b) =>
        a.localeCompare(b),
      )
    : [];
  const direction =
    Number.isInteger(state.direction) && state.direction >= 1 && state.direction <= 9
      ? state.direction
      : 5;
  const stickDirection =
    Number.isInteger(state.stickDirection) && state.stickDirection >= 1 && state.stickDirection <= 9
      ? state.stickDirection
      : 5;
  const actions = [...new Set(buttons.map((button) => bindings[button]).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
  return { timeMs: Math.max(0, Math.round(timeMs)), direction, stickDirection, buttons, actions };
}

function stateKey(state) {
  return `${state.direction}:${state.stickDirection}:${state.buttons.join(",")}:${state.actions.join(",")}`;
}

function pushState(states, next) {
  if (states.length && stateKey(states.at(-1)) === stateKey(next)) return;
  if (states.length && states.at(-1).timeMs === next.timeMs) states.pop();
  states.push(next);
}

function pausedBefore(timeMs, pauses) {
  return pauses.reduce(
    (total, pause) => total + Math.max(0, Math.min(timeMs, pause.endMs) - pause.startMs),
    0,
  );
}

function isPaused(timeMs, pauses) {
  return pauses.some((pause) => timeMs >= pause.startMs && timeMs < pause.endMs);
}

function createComboInputCapture({
  rawStates,
  startAtMs,
  endAtMs,
  pauses = [],
  bindings = {},
  deviceIndex,
  interrupted = false,
}) {
  if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs) || endAtMs < startAtMs) {
    throw new Error("Invalid combo input capture clock.");
  }
  const normalizedPauses = pauses
    .filter((pause) => Number.isFinite(pause.startMs) && Number.isFinite(pause.endMs))
    .map((pause) => ({
      startMs: Math.max(startAtMs, pause.startMs),
      endMs: Math.min(endAtMs, pause.endMs),
    }))
    .filter((pause) => pause.endMs > pause.startMs);
  const ordered = [...rawStates]
    .filter((state) => Number.isFinite(state.atMs))
    .sort((a, b) => a.atMs - b.atMs);
  const timeline = ordered.map((state) => ({ state, atMs: state.atMs }));
  for (const pause of normalizedPauses) {
    const resumedState = ordered.filter((state) => state.atMs <= pause.endMs).at(-1);
    if (resumedState) timeline.push({ state: resumedState, atMs: pause.endMs });
  }
  timeline.sort((a, b) => a.atMs - b.atMs);
  const states = [];
  const initial = ordered.filter((state) => state.atMs <= startAtMs).at(-1);
  pushState(states, normalizedState(initial ?? { direction: 5, buttons: [] }, 0, bindings));
  for (const entry of timeline) {
    if (entry.atMs <= startAtMs || entry.atMs > endAtMs || isPaused(entry.atMs, normalizedPauses))
      continue;
    pushState(
      states,
      normalizedState(
        entry.state,
        entry.atMs - startAtMs - pausedBefore(entry.atMs, normalizedPauses),
        bindings,
      ),
    );
  }
  return {
    schemaVersion: 1,
    source: "xinput",
    deviceIndex,
    bindings,
    status: interrupted ? "interrupted" : "complete",
    timing: "OBS start event plus controller clock; approximate",
    durationMs: Math.max(
      0,
      Math.round(endAtMs - startAtMs - pausedBefore(endAtMs, normalizedPauses)),
    ),
    states,
  };
}

function trimComboInputCapture(capture, startTime, endTime) {
  if (!capture || capture.schemaVersion !== 1 || !Array.isArray(capture.states)) return null;
  const startMs = Math.round(startTime * 1000);
  const endMs = Math.round(endTime * 1000);
  if (startMs < 0 || endMs <= startMs) throw new Error("Invalid combo input trim range.");
  const states = [];
  const prior = capture.states.filter((state) => state.timeMs <= startMs).at(-1);
  pushState(states, { ...(prior ?? normalizedState({}, 0, capture.bindings ?? {})), timeMs: 0 });
  for (const state of capture.states) {
    if (state.timeMs <= startMs || state.timeMs >= endMs) continue;
    pushState(states, { ...state, timeMs: state.timeMs - startMs });
  }
  return { ...capture, durationMs: endMs - startMs, states };
}

module.exports = {
  createComboInputCapture,
  playerOnePadBindings,
  trimComboInputCapture,
};
