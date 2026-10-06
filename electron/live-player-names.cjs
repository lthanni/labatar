function createLivePlayerNameTracker() {
  let lobbyId = null;
  let names = null;
  let pending = [null, null];

  return {
    setLobby(nextLobbyId) {
      if (nextLobbyId === lobbyId) return;
      lobbyId = nextLobbyId;
      names = null;
      pending = [null, null];
    },
    observe(line) {
      const player = line.match(/\[MAT\]\s*Player\s+([01])\s+is filled out:\s*(.*)$/i);
      if (player) {
        pending[Number(player[1])] = player[2].trim() || null;
        return;
      }

      const setup = line.match(
        /GotSetupGameMetadata:\s*Lobby\s+'(\d+)'\s+has metadata for\s+2\/2 players/i,
      );
      if (!setup) return;
      if (setup[1] === lobbyId && pending[0] && pending[1]) {
        names = { player1: pending[0], player2: pending[1] };
      }
      pending = [null, null];
    },
    namesFor(matchLobbyId) {
      return matchLobbyId && matchLobbyId === lobbyId ? names : null;
    },
  };
}

module.exports = { createLivePlayerNameTracker };
