import characterMap from "../electron/character-map.json";

type LinkedGame = {
  matchId?: string | null;
  replayPath?: string | null;
  replay?: unknown;
  metadata?: {
    player1Character?: string | null;
    player2Character?: string | null;
  } | null;
};
type ReplayLinkedRecording = {
  id: string;
  source?: "automatic" | "manual" | null;
  clip?: unknown;
  games?: LinkedGame[];
  replays?: Array<{
    matchId?: string | null;
    replayPath?: string | null;
    replay?: unknown;
  }>;
};

function canonicalCharacter(value: string) {
  const mapping = characterMap as Record<string, string>;
  const key = Object.keys(mapping).find(
    (candidate) => candidate.toLowerCase() === value.toLowerCase(),
  );
  return (key ? mapping[key] : value).toLowerCase();
}

function charactersAgree(game: LinkedGame, replay: unknown) {
  if (!replay || typeof replay !== "object" || !game.metadata) return true;
  const replayFields = replay as Record<string, unknown>;
  return ([1, 2] as const).every((side) => {
    const expected = game.metadata?.[`player${side}Character`];
    const actual = replayFields[`player${side}Character`];
    return (
      !expected ||
      typeof actual !== "string" ||
      canonicalCharacter(expected) === canonicalCharacter(actual)
    );
  });
}

function comparablePath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/");
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function buildRecordingReplayIndex(recordings: ReplayLinkedRecording[]) {
  const index = new Map<string, Set<string>>();
  for (const recording of recordings) {
    if (recording.source !== "automatic" || recording.clip) continue;
    const games = recording.games ?? [];
    const replayEntries = [
      ...games.filter((game) => charactersAgree(game, game.replay)),
      ...(recording.replays ?? [])
        .filter((replay) => {
          const game = games.find((candidate) => candidate.matchId === replay.matchId);
          return game && charactersAgree(game, replay.replay ?? game.replay);
        })
        .map((replay) => replay),
    ];
    for (const { replayPath, replay } of replayEntries) {
      if (!replayPath) continue;
      const hash =
        replay && typeof replay === "object" && "contentHash" in replay
          ? (replay as { contentHash?: unknown }).contentHash
          : null;
      const key =
        typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash)
          ? `sha256:${hash.toLowerCase()}`
          : comparablePath(replayPath);
      const linked = index.get(key) ?? new Set<string>();
      linked.add(recording.id);
      index.set(key, linked);
    }
  }
  return index;
}

export function recordingIdForSet(
  replayIds: string[],
  replayFolder: string | null,
  index: Map<string, Set<string>>,
  hashesByReplayId?: Map<string, string>,
) {
  if (!replayFolder || replayIds.length === 0) return null;
  const folder = replayFolder.replace(/[\\/]+$/, "");
  let commonRecordingId: string | null = null;
  for (const replayId of replayIds) {
    const absolutePath = comparablePath(`${folder}/${replayId.replace(/^[\\/]+/, "")}`);
    const hash = hashesByReplayId?.get(replayId);
    const linked =
      (hash ? index.get(`sha256:${hash.toLowerCase()}`) : null) ?? index.get(absolutePath);
    if (!linked || linked.size !== 1) return null;
    const [recordingId] = linked;
    if (commonRecordingId && commonRecordingId !== recordingId) return null;
    commonRecordingId = recordingId;
  }
  return commonRecordingId;
}
