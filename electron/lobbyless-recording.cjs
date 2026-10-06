function canRecordLobbylessMatch(match) {
  if (!match || match.lobbyId || typeof match.matchId !== "string" || !match.matchId.trim()) {
    return false;
  }
  if (match.mode !== "casual" && match.mode !== "ranked") return false;
  const player1Id = match.player1?.steamId;
  const player2Id = match.player2?.steamId;
  return (
    typeof player1Id === "string" &&
    /^\d{10,20}$/.test(player1Id) &&
    typeof player2Id === "string" &&
    /^\d{10,20}$/.test(player2Id) &&
    player1Id !== player2Id
  );
}

function recordingMatchesAutomaticGame(recording, match) {
  if (!recording || recording.source !== "automatic" || !match?.matchId) return false;
  if (recording.fallbackMatchId) return recording.fallbackMatchId === match.matchId;
  return Boolean(recording.lobbyId && match.lobbyId === recording.lobbyId);
}

module.exports = { canRecordLobbylessMatch, recordingMatchesAutomaticGame };
