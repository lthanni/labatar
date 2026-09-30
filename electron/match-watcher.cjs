const fs = require("node:fs");
const path = require("node:path");

function parseLogTime(line) {
  return line.match(/^\[(\d{2}:\d{2}:\d{2})\]/)?.[1] ?? null;
}

function parseGlicko(value) {
  const match = value.match(/\[\s*R:\s*([^:]+):\s*D:\s*([^:]+):\s*Vol:\s*([^\]]+)\]/i);
  if (!match) return null;
  return {
    rating: Number(match[1]),
    deviation: Number(match[2]),
    volatility: Number(match[3]),
  };
}

function parsePlayerLine(line) {
  const match = line.match(
    /SetNewMatch:\s*Player\s+([12]):\s*(.*?)\s*\(SteamID:\s*([^,]+),\s*Glicko:\s*(.*?)\)\s*$/i,
  );
  if (!match) return null;
  return {
    player: Number(match[1]),
    character: match[2].trim(),
    steamId: match[3].trim(),
    glicko: parseGlicko(match[4]),
  };
}

function parseMatchMode(line) {
  // SetNewMatch's Casual flag is the most direct signal and is emitted for
  // both ranked and casual matches before the match is marked as started.
  const casualFlag = line.match(/SetNewMatch:\s*Casual:\s*([01])\b/i);
  if (casualFlag) return casualFlag[1] === "1" ? "casual" : "ranked";

  const matchmakingMode = line.match(/\bMatchmakingMode(Ranked|Casual)\b/i);
  if (matchmakingMode) return matchmakingMode[1].toLowerCase();

  const queue = line.match(/\bqueue\s*=\s*(RANKED|CASUAL)\b/i);
  if (queue) return queue[1].toLowerCase();

  const replayHeader = line.match(/Gathered ratings for header:\s*(ranked|casual)\b/i);
  return replayHeader?.[1]?.toLowerCase() ?? null;
}

function updateMatchFromLine(currentMatch, line) {
  const start = line.match(/SetNewMatch:\s*New match started with ID\s*(.*?)\s*$/i);
  if (start) {
    return {
      matchId: start[1].trim(),
      logTime: parseLogTime(line),
      startedAt: new Date().toISOString(),
      player1: null,
      player2: null,
      notes: { player1: "", player2: "" },
      mode: null,
      recordingStarted: false,
      lobbyId: null,
    };
  }
  if (!currentMatch) return currentMatch;
  const mode = parseMatchMode(line);
  if (mode) currentMatch.mode = mode;
  const player = parsePlayerLine(line);
  if (player) {
    currentMatch[`player${player.player}`] = player;
    return currentMatch;
  }
  const notes = line.match(/SetNewMatch:\s*P1Notes:\s*(.*?),\s*P2Notes:\s*(.*?)\s*$/i);
  if (notes) {
    currentMatch.notes = { player1: notes[1].trim(), player2: notes[2].trim() };
  }
  return currentMatch;
}

function parseReplayPath(line) {
  const match = line.match(/Successfully wrote replay file:\s*(.*?\.dlr)/i);
  return match?.[1]?.trim() ?? null;
}

function parseMatchEndReason(line) {
  if (/EndMatch:\s*Match ended/i.test(line)) return "end-match";
  if (/Ending Netplay from script with reason:\s*Quit\b/i.test(line)) return "quit";
  if (/LogNetplayEvent:\s*Quit\b/i.test(line)) return "quit";
  if (
    /LogNetplayEvent:\s*\/\((?:UI_Netplay_TimeoutError|UI_NetworkError_ConnectionInterrupted)\)/i.test(
      line,
    )
  ) {
    return "connection-lost";
  }
  return null;
}

function parseLobbyEvent(line) {
  const matched = line.match(/XMatch:\s*MATCHED\b.*?\blobbyId=(\d+)/i);
  if (matched) return { type: "matched", lobbyId: matched[1] };
  const finalized = line.match(/XMatch finalize:\s*MATCH FINALIZED\s*\(lobby\s*(\d+)/i);
  if (finalized) return { type: "finalized", lobbyId: finalized[1] };
  const joined = line.match(/Joined meetup lobby,\s*setting currentMeetupLobbyIdHash to\s*(\d+)/i);
  if (joined) return { type: "joined", lobbyId: joined[1] };
  const leaving = line.match(/Steam:\s*Leaving lobby\s*(\d+)/i);
  if (leaving) return { type: "left", lobbyId: leaving[1] };
  if (
    /Leave Lobby Called from Script|Ending Netplay from script with reason:\s*Quit\b|LogNetplayEvent:\s*Quit\b/i.test(
      line,
    )
  ) {
    return { type: "left", lobbyId: null };
  }
  return null;
}

class MatchLogWatcher {
  constructor({
    getLogsDirectory,
    onState,
    onDiagnostic,
    onLobbyStarted,
    onLobbyEnded,
    onMatchStarted,
    onMatchEnded,
    onReplaySaved,
  }) {
    this.getLogsDirectory = getLogsDirectory;
    this.onState = onState;
    this.onDiagnostic = onDiagnostic;
    this.onLobbyStarted = onLobbyStarted;
    this.onLobbyEnded = onLobbyEnded;
    this.onMatchStarted = onMatchStarted;
    this.onMatchEnded = onMatchEnded;
    this.onReplaySaved = onReplaySaved;
    this.timer = null;
    this.polling = false;
    this.enabled = false;
    this.logPath = null;
    this.offset = 0;
    this.lineBuffer = "";
    this.currentMatch = null;
    this.setNumber = 0;
    this.gameNumber = 0;
    this.lobbyId = null;
    this.numberedSetKey = null;
    this.numberedMatchId = null;
    this.lastReplayPath = null;
    this.status = "disabled";
    this.error = null;
  }

  diagnostic(event, details = {}) {
    this.onDiagnostic?.(event, { logPath: this.logPath, ...details });
  }

  snapshot() {
    return {
      enabled: this.enabled,
      status: this.status,
      logPath: this.logPath,
      currentMatch: this.currentMatch,
      lobbyId: this.lobbyId,
      setNumber: this.setNumber,
      gameNumber: this.gameNumber,
      lastReplayPath: this.lastReplayPath,
      error: this.error,
    };
  }

  emit() {
    this.onState?.(this.snapshot());
  }

  async findNewestLog(logsDirectory) {
    const entries = await fs.promises.readdir(logsDirectory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^abare_log_.*\.txt$/i.test(entry.name)) continue;
      const filePath = path.join(logsDirectory, entry.name);
      const stat = await fs.promises.stat(filePath);
      files.push({ path: filePath, modifiedAt: stat.mtimeMs });
    }
    return files.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.path ?? null;
  }

  async primeCurrentFile(filePath, size) {
    const tailSize = Math.min(size, 256 * 1024);
    const buffer = Buffer.alloc(tailSize);
    const handle = await fs.promises.open(filePath, "r");
    try {
      await handle.read(buffer, 0, tailSize, size - tailSize);
    } finally {
      await handle.close();
    }
    let currentMatch = null;
    for (const line of buffer.toString("latin1").split(/\r?\n/)) {
      this.observeLobbyEvent(parseLobbyEvent(line));
      if (/EndMatch:\s*Match ended/i.test(line)) {
        currentMatch = null;
        continue;
      }
      currentMatch = updateMatchFromLine(currentMatch, line);
      if (currentMatch?.lobbyId == null) currentMatch.lobbyId = this.lobbyId;
    }
    this.currentMatch = currentMatch;
    this.offset = size;
    this.lineBuffer = "";
    if (this.lobbyId) {
      await this.onLobbyStarted?.({ lobbyId: this.lobbyId, recovered: true });
    }
    if (this.currentMatch) await this.beginCurrentMatch(true);
  }

  async switchToLog(filePath) {
    const stat = await fs.promises.stat(filePath);
    this.logPath = filePath;
    this.currentMatch = null;
    this.lastReplayPath = null;
    this.setNumber = 0;
    this.gameNumber = 0;
    this.lobbyId = null;
    this.numberedSetKey = null;
    this.numberedMatchId = null;
    await this.primeCurrentFile(filePath, stat.size);
    this.diagnostic("log-switched", { filePath, size: stat.size });
    this.emit();
  }

  async processLine(line) {
    const processingStartedAt = Date.now();
    const lobbyObservation = this.observeLobbyEvent(parseLobbyEvent(line));
    if (lobbyObservation?.ended) {
      await this.onLobbyEnded?.({
        lobbyId: lobbyObservation.previousLobbyId,
        reason: lobbyObservation.reason,
        currentMatch: this.currentMatch,
      });
    }
    if (lobbyObservation?.started) {
      await this.onLobbyStarted?.({
        lobbyId: lobbyObservation.lobbyId,
        type: lobbyObservation.type,
        recovered: false,
      });
    }
    const nextMatch = updateMatchFromLine(this.currentMatch, line);
    const endReason = parseMatchEndReason(line);
    if (nextMatch && nextMatch.lobbyId == null) nextMatch.lobbyId = this.lobbyId;
    if (nextMatch !== this.currentMatch && nextMatch?.matchId) {
      this.diagnostic("match-detected", {
        matchId: nextMatch.matchId,
        logTime: nextMatch.logTime,
        lobbyId: nextMatch.lobbyId,
        detectedAt: nextMatch.startedAt,
      });
      if (this.currentMatch) {
        this.diagnostic("match-end-handler-start", {
          matchId: this.currentMatch.matchId,
          reason: "new-match",
        });
        await this.onMatchEnded?.(this.currentMatch, "new-match");
        this.diagnostic("match-end-handler-complete", {
          matchId: this.currentMatch.matchId,
          reason: "new-match",
          durationMs: Date.now() - processingStartedAt,
        });
      }
      this.currentMatch = nextMatch;
      this.emit();
      return;
    }

    if (this.currentMatch) {
      this.currentMatch = nextMatch;
      if (endReason) {
        const completedMatch = this.currentMatch;
        this.currentMatch = null;
        this.diagnostic("match-end-handler-start", {
          matchId: completedMatch.matchId,
          logTime: completedMatch.logTime,
          reason: endReason,
        });
        await this.onMatchEnded?.(completedMatch, endReason);
        this.diagnostic("match-end-handler-complete", {
          matchId: completedMatch.matchId,
          logTime: completedMatch.logTime,
          reason: endReason,
          durationMs: Date.now() - processingStartedAt,
        });
        this.emit();
      } else {
        if (this.currentMatch.player1 && this.currentMatch.player2) {
          await this.beginCurrentMatch(false);
        }
        this.emit();
      }
    }

    const replayPath = parseReplayPath(line);
    if (replayPath) {
      this.lastReplayPath = replayPath;
      this.diagnostic("replay-detected", { replayPath, logTime: parseLogTime(line) });
      await this.onReplaySaved?.(replayPath);
      this.emit();
    }
  }

  async beginCurrentMatch(recovered) {
    if (!this.currentMatch || this.currentMatch.recordingStarted) return;
    if (!this.currentMatch.mode) {
      this.diagnostic("match-start-waiting-for-mode", {
        matchId: this.currentMatch.matchId,
        logTime: this.currentMatch.logTime,
        recovered,
      });
      return;
    }
    if (!this.currentMatch.player1 || !this.currentMatch.player2) {
      if (!recovered) return;
    }
    const match = this.currentMatch;
    this.assignMatchNumber(match);
    const startedAt = Date.now();
    this.diagnostic("match-start-handler-start", {
      matchId: match.matchId,
      logTime: match.logTime,
      lobbyId: match.lobbyId,
      recovered,
    });
    const started = await this.onMatchStarted?.(match, { recovered });
    this.diagnostic("match-start-handler-complete", {
      matchId: match.matchId,
      logTime: match.logTime,
      lobbyId: match.lobbyId,
      recovered,
      started: started !== false,
      durationMs: Date.now() - startedAt,
    });
    if (started !== false && this.currentMatch?.matchId === match.matchId) {
      this.currentMatch.recordingStarted = true;
    }
  }

  assignMatchNumber(match) {
    if (match.matchId === this.numberedMatchId) return;
    const lobbyId = match.lobbyId ?? this.lobbyId;
    const nextSetKey = lobbyId ? `lobby:${lobbyId}` : `match:${match.matchId}`;
    if (this.setNumber === 0 || nextSetKey !== this.numberedSetKey) {
      this.setNumber += 1;
      this.gameNumber = 1;
      this.numberedSetKey = nextSetKey;
    } else {
      this.gameNumber += 1;
    }
    this.numberedMatchId = match.matchId;
    this.emit();
  }

  observeLobbyEvent(event) {
    if (!event) return null;
    const previousLobbyId = this.lobbyId;
    if (event.type === "left") {
      const matchesCurrentLobby = !event.lobbyId || !this.lobbyId || event.lobbyId === this.lobbyId;
      if (matchesCurrentLobby) this.lobbyId = null;
      this.diagnostic("lobby-left", {
        eventLobbyId: event.lobbyId,
        lobbyId: this.lobbyId,
      });
      return matchesCurrentLobby && previousLobbyId
        ? { ended: true, previousLobbyId, reason: "left" }
        : null;
    }
    const changed = Boolean(this.lobbyId && this.lobbyId !== event.lobbyId);
    if (changed) {
      this.diagnostic("lobby-changed", {
        previousLobbyId,
        lobbyId: event.lobbyId,
      });
    }
    this.lobbyId = event.lobbyId;
    this.diagnostic("lobby-observed", {
      type: event.type,
      lobbyId: event.lobbyId,
      changed,
    });
    return {
      started: !previousLobbyId || changed,
      ended: changed,
      previousLobbyId,
      lobbyId: event.lobbyId,
      type: event.type,
      reason: "changed",
    };
  }

  async poll() {
    if (!this.enabled || this.polling) return;
    this.polling = true;
    try {
      const logsDirectory = await this.getLogsDirectory?.();
      if (!logsDirectory) {
        this.status = "waiting-for-log";
        this.error = null;
        this.emit();
        return;
      }
      const newestLog = await this.findNewestLog(logsDirectory);
      if (!newestLog) {
        this.status = "waiting-for-log";
        this.error = null;
        this.emit();
        return;
      }
      if (newestLog !== this.logPath) await this.switchToLog(newestLog);
      const stat = await fs.promises.stat(newestLog);
      if (stat.size < this.offset) {
        await this.switchToLog(newestLog);
      } else if (stat.size > this.offset) {
        const buffer = Buffer.alloc(stat.size - this.offset);
        const handle = await fs.promises.open(newestLog, "r");
        try {
          await handle.read(buffer, 0, buffer.length, this.offset);
        } finally {
          await handle.close();
        }
        this.offset = stat.size;
        const lines = `${this.lineBuffer}${buffer.toString("latin1")}`.split(/\r?\n/);
        this.lineBuffer = lines.pop() ?? "";
        const processingStartedAt = Date.now();
        for (const line of lines) await this.processLine(line);
        const processingDurationMs = Date.now() - processingStartedAt;
        if (processingDurationMs >= 1000) {
          this.diagnostic("poll-processing-slow", {
            lineCount: lines.length,
            durationMs: processingDurationMs,
          });
        }
      }
      if (this.currentMatch && !this.currentMatch.recordingStarted) {
        await this.beginCurrentMatch(false);
      }
      this.status = this.currentMatch ? "in-match" : "watching";
      this.error = null;
      this.emit();
    } catch (error) {
      this.status = "error";
      this.error = error instanceof Error ? error.message : String(error);
      this.emit();
    } finally {
      this.polling = false;
    }
  }

  async start() {
    if (this.enabled) return this.snapshot();
    this.enabled = true;
    this.status = "starting";
    this.error = null;
    this.emit();
    await this.poll();
    if (this.status === "error") {
      this.enabled = false;
      this.emit();
      throw new Error(this.error);
    }
    this.timer = setInterval(() => void this.poll(), 500);
    return this.snapshot();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.enabled = false;
    this.status = "disabled";
    this.error = null;
    this.logPath = null;
    this.offset = 0;
    this.lineBuffer = "";
    this.currentMatch = null;
    this.lobbyId = null;
    this.emit();
    return this.snapshot();
  }
}

module.exports = { MatchLogWatcher };
