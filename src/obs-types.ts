export type ObsConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export type RecordingMetadata = {
  player: string;
  opponent: string;
  setLabel: string;
  gameNumber: string;
  mode: string;
  notes: string;
  matchId: string;
  lobbyId: string;
  player1: string;
  player2: string;
  player1SteamId: string;
  player2SteamId: string;
  player1Character: string;
  player2Character: string;
  player1Rating: string;
  player2Rating: string;
};

export type ObsRecordingState = {
  active: boolean;
  paused: boolean;
  outputPath: string | null;
  sessionId: string | null;
  source: "manual" | "automatic" | null;
  metadata: RecordingMetadata | null;
  startedAt: string | null;
};

export type ObsState = {
  status: ObsConnectionStatus;
  host: string;
  port: number;
  error: string | null;
  obsVersion: string | null;
  obsWebSocketVersion: string | null;
  currentProfileName: string | null;
  profiles: string[];
  currentSceneCollectionName: string | null;
  currentSceneName: string | null;
  recordDirectory: string | null;
  automation: ObsAutomationState;
  recording: ObsRecordingState;
};

export type ObsAutomationState = {
  enabled: boolean;
  status: string;
  logPath: string | null;
  lobbyId: string | null;
  currentMatch: {
    matchId: string;
    lobbyId: string | null;
    logTime: string | null;
    startedAt: string;
    player1: DetectedPlayer | null;
    player2: DetectedPlayer | null;
    notes: {
      player1: string;
      player2: string;
    };
    recordingStarted: boolean;
  } | null;
  setNumber: number;
  gameNumber: number;
  lastReplayPath: string | null;
  pendingRecordings: number;
  error: string | null;
};

export type DetectedPlayer = {
  player: number;
  character: string;
  steamId: string;
  glicko: {
    rating: number;
    deviation: number;
    volatility: number;
  } | null;
};

export type ObsSettings = {
  host: string;
  port: number;
  profileName: string;
  recordDirectory: string;
  passwordSaved: boolean;
};
