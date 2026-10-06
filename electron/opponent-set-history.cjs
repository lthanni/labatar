const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

function matchedLobby(line) {
  if (!/XMatch:\s*MATCHED\b/i.test(line)) return null;
  const opponentSteamId = line.match(/\bopponent=(\d+)\b/i)?.[1];
  const lobbyId = line.match(/\blobbyId=(\d+)\b/i)?.[1];
  return opponentSteamId && lobbyId ? { opponentSteamId, lobbyId } : null;
}

async function playedSetsInLog(filePath) {
  const opponentsByLobby = new Map();
  const played = new Map();
  let currentLobbyId = null;
  let currentMatch = null;
  let currentDay = null;
  let previousClockSeconds = null;
  const lines = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "latin1" }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    const datedTime = line.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC\]/);
    if (datedTime) {
      currentDay = Date.parse(`${datedTime[1]}T00:00:00Z`);
      const [hours, minutes, seconds] = datedTime[2].split(":").map(Number);
      previousClockSeconds = hours * 3600 + minutes * 60 + seconds;
    }
    const clock = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/);
    let lineTime = null;
    if (clock && Number.isFinite(currentDay)) {
      const clockSeconds = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
      if (previousClockSeconds != null && previousClockSeconds - clockSeconds > 12 * 3600) {
        currentDay += 24 * 3600 * 1000;
      }
      previousClockSeconds = clockSeconds;
      lineTime = currentDay + clockSeconds * 1000;
    }
    const matched = matchedLobby(line);
    if (matched) {
      opponentsByLobby.set(matched.lobbyId, matched.opponentSteamId);
      currentLobbyId = matched.lobbyId;
      currentMatch = null;
      continue;
    }
    const joinedLobbyId = line.match(
      /Joined meetup lobby,\s*setting currentMeetupLobbyIdHash to\s*(\d+)/i,
    )?.[1];
    if (joinedLobbyId) {
      currentLobbyId = joinedLobbyId;
      currentMatch = null;
      continue;
    }
    const leftLobbyId = line.match(/Steam:\s*Leaving lobby\s*(\d+)/i)?.[1];
    if (leftLobbyId && leftLobbyId === currentLobbyId) {
      currentLobbyId = null;
      currentMatch = null;
      continue;
    }
    if (/SetNewMatch:\s*New match started with ID\b/i.test(line)) {
      const opponentSteamId = opponentsByLobby.get(currentLobbyId);
      currentMatch = opponentSteamId
        ? { lobbyId: currentLobbyId, opponentSteamId, startedAt: lineTime }
        : null;
      continue;
    }
    const player = line.match(/SetNewMatch:\s*Player\s+([12]):.*?\(SteamID:\s*(\d+)/i);
    if (player && currentMatch) {
      currentMatch[`player${player[1]}SteamId`] = player[2];
      const { player1SteamId, player2SteamId, opponentSteamId } = currentMatch;
      if (player1SteamId && player2SteamId) {
        const playerSteamId =
          player1SteamId === opponentSteamId
            ? player2SteamId
            : player2SteamId === opponentSteamId
              ? player1SteamId
              : null;
        if (playerSteamId && playerSteamId !== opponentSteamId) {
          if (!played.has(currentMatch.lobbyId)) {
            played.set(currentMatch.lobbyId, {
              playerSteamId,
              opponentSteamId,
              startedAt: currentMatch.startedAt,
            });
          }
        }
        currentMatch = null;
      }
    }
  }
  return played;
}

function createOpponentSetHistory({ cachePath, getLogsDirectory }) {
  let loaded = false;
  let scannedFiles = new Map();
  let setsByLobby = new Map();
  let inFlight = null;

  async function load() {
    if (loaded) return;
    const saved = await fs.promises
      .readFile(cachePath(), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (saved?.schemaVersion === 2 || saved?.schemaVersion === 3) {
      scannedFiles = new Map(
        (saved.schemaVersion === 3 && Array.isArray(saved.scannedFiles)
          ? saved.scannedFiles
          : []
        ).filter(
          (entry) =>
            Array.isArray(entry) &&
            typeof entry[0] === "string" &&
            typeof entry[1]?.size === "number" &&
            typeof entry[1]?.mtimeMs === "number",
        ),
      );
      setsByLobby = new Map(
        (Array.isArray(saved.setsByLobby) ? saved.setsByLobby : [])
          .filter(
            (entry) =>
              Array.isArray(entry) &&
              /^\d+$/.test(entry[0]) &&
              /^\d+$/.test(entry[1]?.playerSteamId) &&
              /^\d+$/.test(entry[1]?.opponentSteamId),
          )
          .map(([lobbyId, players]) => [
            lobbyId,
            {
              playerSteamId: players.playerSteamId,
              opponentSteamId: players.opponentSteamId,
              startedAt: Number.isFinite(players.startedAt) ? players.startedAt : null,
            },
          ]),
      );
    }
    loaded = true;
  }

  async function refreshInternal() {
    await load();
    const directory = await getLogsDirectory();
    if (!directory) return;
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    let changed = false;
    for (const entry of entries) {
      if (!entry.isFile() || !/^abare_log_.*\.txt$/i.test(entry.name)) continue;
      const filePath = path.join(directory, entry.name);
      const stat = await fs.promises.stat(filePath);
      const previous = scannedFiles.get(filePath);
      if (previous?.size === stat.size && previous.mtimeMs === stat.mtimeMs) continue;
      const played = await playedSetsInLog(filePath);
      for (const [lobbyId, players] of played) {
        const existing = setsByLobby.get(lobbyId);
        if (
          !existing ||
          existing.playerSteamId !== players.playerSteamId ||
          existing.opponentSteamId !== players.opponentSteamId ||
          !Number.isFinite(existing.startedAt) ||
          (Number.isFinite(players.startedAt) && players.startedAt < existing.startedAt)
        ) {
          setsByLobby.set(lobbyId, players);
        }
      }
      scannedFiles.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs });
      changed = true;
    }
    if (!changed) return;
    const filePath = cachePath();
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await fs.promises.writeFile(
      temporaryPath,
      JSON.stringify({
        schemaVersion: 3,
        scannedFiles: [...scannedFiles],
        setsByLobby: [...setsByLobby],
      }),
      "utf8",
    );
    await fs.promises.rename(temporaryPath, filePath);
  }

  function refresh() {
    if (!inFlight) {
      inFlight = refreshInternal().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  async function setNumberForLobby(lobbyId) {
    if (!lobbyId) return null;
    await refresh();
    const players = setsByLobby.get(String(lobbyId));
    if (!players) return null;
    return [...setsByLobby.values()].filter(
      (entry) =>
        entry.playerSteamId === players.playerSteamId &&
        entry.opponentSteamId === players.opponentSteamId,
    ).length;
  }

  async function historicalSetNumberForLobby(lobbyId) {
    if (!lobbyId) return null;
    await refresh();
    const target = setsByLobby.get(String(lobbyId));
    if (!target || !Number.isFinite(target.startedAt)) return null;
    const opponentsSets = [...setsByLobby.values()].filter(
      (entry) =>
        entry.playerSteamId === target.playerSteamId &&
        entry.opponentSteamId === target.opponentSteamId,
    );
    if (opponentsSets.some((entry) => !Number.isFinite(entry.startedAt))) return null;
    return opponentsSets.filter((entry) => entry.startedAt <= target.startedAt).length;
  }

  return { refresh, setNumberForLobby, historicalSetNumberForLobby };
}

module.exports = { createOpponentSetHistory, playedSetsInLog };
