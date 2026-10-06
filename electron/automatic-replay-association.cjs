function takePendingReplayMatch(pendingRecordings, matchId) {
  if (typeof matchId !== "string" || !matchId.trim()) return null;
  const index = pendingRecordings.findIndex((pending) => pending.match?.matchId === matchId);
  return index < 0 ? null : pendingRecordings.splice(index, 1)[0];
}

function replayMatchesGame(game, replay, formatCharacter = (value) => value) {
  const metadata = game?.metadata;
  if (!metadata || !replay) return false;
  return [1, 2].every((side) => {
    const expected = metadata[`player${side}Character`] || metadata[`player${side}`];
    const actual = replay[`player${side}Character`];
    return (
      typeof expected === "string" &&
      expected.trim() &&
      typeof actual === "string" &&
      actual.trim() &&
      formatCharacter(expected).toLowerCase() === formatCharacter(actual).toLowerCase()
    );
  });
}

function replayRoundScore(fields) {
  const first = fields.TM_WinsT1;
  const second = fields.TM_WinsT2;
  if (first == null && second == null) return "Unknown";
  if ((first != null && !/^\d+$/.test(first)) || (second != null && !/^\d+$/.test(second))) {
    return "Unknown";
  }
  return `${first ?? 0} - ${second ?? 0}`;
}

module.exports = { takePendingReplayMatch, replayMatchesGame, replayRoundScore };
