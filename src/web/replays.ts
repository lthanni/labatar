import characterMapJson from "../../electron/character-map.json";
import supportMapJson from "../../electron/support-map.json";

export type ReplayRating = {
  rating: number | null;
  deviation: number | null;
  volatility: number | null;
  characterMmr: number | null;
  mmrChange: number | null;
};

export type ReplayRatings = {
  mode: string;
  affectsRank: boolean | null;
  player1: ReplayRating;
  player2: ReplayRating;
};

/** Structurally matches the rows consumed by AvatarGrid and AnalyticsSection. */
export type WebReplayRow = {
  id: string;
  contentHash: string;
  timestamp: string | null;
  player1: string;
  player2: string;
  player1Character: string;
  player2Character: string;
  winner: string;
  player1Support: string;
  player2Support: string;
  roundScore: string;
  ratings: ReplayRatings | null;
};

export type ReplayInputFile = { relativePath: string; file: Blob };
export type ReplayFolderSelection = {
  name: string;
  /** Present when selected with showDirectoryPicker; supports a fresh rescan. */
  directory?: FileSystemDirectoryHandle;
  /** Snapshot from the fallback input, or the most recent directory scan. */
  files: ReplayInputFile[];
};
export type ReplayScanProgress = {
  phase: "discovery" | "logs" | "scanning";
  completed: number;
  total: number;
};
export type ReplayScanResult = {
  games: WebReplayRow[];
  playerCounts: Record<string, number>;
  duplicateCount: number;
  files: ReplayInputFile[];
};
export type ReplayScanOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ReplayScanProgress) => void;
};

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" }) => Promise<FileSystemDirectoryHandle>;
};
type DirectoryInput = HTMLInputElement & { webkitdirectory: boolean };

const characterMap = characterMapJson as Record<string, string>;
const supportMap = supportMapJson as Record<string, Record<string, string>>;

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Replay scan cancelled.", "AbortError");
}

function isRelevant(path: string) {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".dlr") ||
    lower.endsWith(".pak") ||
    (/(^|\/)logs\//.test(lower) && lower.endsWith(".txt"))
  );
}

async function walkDirectory(
  directory: FileSystemDirectoryHandle,
  prefix = "",
  signal?: AbortSignal,
  onDiscovered?: (count: number) => void,
  count = { value: 0 },
): Promise<ReplayInputFile[]> {
  const files: ReplayInputFile[] = [];
  for await (const entry of directory.values()) {
    abortIfNeeded(signal);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      files.push(
        ...(await walkDirectory(
          entry as FileSystemDirectoryHandle,
          relativePath,
          signal,
          onDiscovered,
          count,
        )),
      );
    } else if (isRelevant(relativePath)) {
      const file = await (entry as FileSystemFileHandle).getFile();
      files.push({ relativePath, file });
      count.value += 1;
      if (count.value % 20 === 0) onDiscovered?.(count.value);
    }
  }
  return files;
}

function pickWithDirectoryInput(): Promise<ReplayFolderSelection> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input") as DirectoryInput;
    input.type = "file";
    input.multiple = true;
    input.webkitdirectory = true;
    input.style.display = "none";
    document.body.append(input);
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      callback();
    };
    const onFocus = () =>
      window.setTimeout(() => {
        if (!settled && input.files?.length === 0)
          finish(() => reject(new DOMException("Folder selection cancelled.", "AbortError")));
      }, 2000);
    input.addEventListener(
      "change",
      () => {
        const selected = [...(input.files ?? [])];
        if (!selected.length) {
          finish(() => reject(new Error("No files were selected.")));
          return;
        }
        const root =
          (selected[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split(
            "/",
          )[0] ?? "Selected folder";
        const files = selected
          .flatMap((file) => {
            const relativePath = (file as File & { webkitRelativePath?: string })
              .webkitRelativePath;
            const localPath = relativePath?.split("/").slice(1).join("/");
            return localPath && isRelevant(localPath) ? [{ relativePath: localPath, file }] : [];
          })
          .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
        finish(() => resolve({ name: root, files }));
      },
      { once: true },
    );
    window.addEventListener("focus", onFocus);
    input.addEventListener("cancel", () =>
      finish(() => reject(new DOMException("Folder selection cancelled.", "AbortError"))),
    );
    input.click();
  });
}

/** Opens a user-gesture folder picker, with a one-shot webkitdirectory fallback. */
export async function selectReplayFolder(useFileInput = false): Promise<ReplayFolderSelection> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (picker && !useFileInput) {
    const directory = await picker.call(window, { mode: "read" });
    return { name: directory.name, directory, files: [] };
  }
  return pickWithDirectoryInput();
}

function decodeAsciiFields(bytes: Uint8Array) {
  const fields: Record<string, string> = {};
  let start = 0;
  const flush = (end: number) => {
    if (end - start < 3) return;
    let text = "";
    for (let i = start; i < end; i += 1) text += String.fromCharCode(bytes[i]);
    const separator = text.indexOf(" = ");
    if (separator > 0) fields[text.slice(0, separator)] = text.slice(separator + 3);
  };
  for (let i = 0; i <= bytes.length; i += 1) {
    if (i < bytes.length && bytes[i] >= 0x20 && bytes[i] <= 0x7e) continue;
    flush(i);
    start = i + 1;
  }
  return fields;
}

function cleanName(value: string) {
  return value
    .replace(/^.*?@@/, "")
    .replace(/\\_@@/g, " ")
    .replace(/\\/g, "")
    .trim();
}

function formatCharacter(value: string) {
  const key = Object.keys(characterMap).find(
    (candidate) => candidate.toLowerCase() === value.toLowerCase(),
  );
  return (
    characterMap[value] ??
    characterMap[value.toUpperCase()] ??
    (key ? characterMap[key] : undefined) ??
    value
  );
}

function formatSupport(character: string, supportId?: string) {
  if (!supportId || supportId === "0") return "None";
  const aliases: Record<string, string> = {
    korra_nightmare: "Nightmare Korra",
    aang_avchar: "Avatar Aang",
    avatar_aang: "Avatar Aang",
  };
  const normalized = character
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const mapped =
    aliases[character.trim().toLowerCase()] ??
    Object.keys(supportMap).find(
      (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized,
    );
  return (mapped ? supportMap[mapped]?.[supportId] : undefined) ?? `Support #${supportId}`;
}

function replayRoundScore(fields: Record<string, string>) {
  const first = fields.TM_WinsT1;
  const second = fields.TM_WinsT2;
  if (first == null && second == null) return "Unknown";
  if ((first != null && !/^\d+$/.test(first)) || (second != null && !/^\d+$/.test(second)))
    return "Unknown";
  return `${first ?? 0} - ${second ?? 0}`;
}

async function sha256(bytes: Uint8Array) {
  const input = new Uint8Array(bytes.length);
  input.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", input.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseNumeric(value: string) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

type PendingChange = {
  characters: string[];
  newRatings: Array<number | null>;
  changes: Array<number | null>;
  affectsRank: boolean;
};

function parseRatings(
  value: string,
  volatility: Record<string, number | null>,
  change: PendingChange | null,
  characters: Record<string, string | null>,
): ReplayRatings | null {
  const match = value.match(
    /^\s*([^|]+?)\s*\|\s*P1 glicko\s+([^/|]+)\/([^|]+)\s+charMMR\s+([^|]+)\s*\|\s*P2 glicko\s+([^/|]+)\/([^|]+)\s+charMMR\s+([^|]+)\s*$/i,
  );
  if (!match) return null;
  const numericMmr = [parseNumeric(match[4]), parseNumeric(match[7])];
  const mmrChanges: Array<number | null> = [null, null];
  const used = new Set<number>();
  const assigned: Array<number | null> = [null, null];
  for (let player = 0; player < 2; player += 1) {
    const mmr = numericMmr[player];
    const index =
      change?.newRatings.findIndex(
        (candidate, candidateIndex) => !used.has(candidateIndex) && candidate === mmr,
      ) ?? -1;
    if (mmr !== null && mmr >= 0 && index >= 0) {
      assigned[player] = index;
      used.add(index);
    }
  }
  for (let player = 0; player < 2; player += 1) {
    if (assigned[player] !== null) continue;
    const character = characters[player === 0 ? "player1" : "player2"]
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const index = character
      ? (change?.characters.findIndex(
          (candidate, candidateIndex) =>
            !used.has(candidateIndex) &&
            candidate.toLowerCase().replace(/[^a-z0-9]/g, "") === character,
        ) ?? -1)
      : -1;
    if (index >= 0) {
      assigned[player] = index;
      used.add(index);
    }
  }
  let fallback = 0;
  for (let player = 0; player < 2; player += 1) {
    if (assigned[player] !== null) continue;
    while (used.has(fallback)) fallback += 1;
    assigned[player] = fallback;
    used.add(fallback);
  }
  for (let player = 0; player < 2; player += 1)
    mmrChanges[player] = change?.changes[assigned[player]!] ?? null;
  const rating = (r: string, d: string, c: string, player: string, side: number): ReplayRating => ({
    rating: parseNumeric(r),
    deviation: parseNumeric(d),
    volatility: volatility[player] ?? null,
    characterMmr: parseNumeric(c),
    mmrChange: mmrChanges[side],
  });
  return {
    mode: match[1].trim(),
    affectsRank: change?.affectsRank ?? null,
    player1: rating(match[2], match[3], match[4], "player1", 0),
    player2: rating(match[5], match[6], match[7], "player2", 1),
  };
}

async function* logLines(file: Blob, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      abortIfNeeded(signal);
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        yield line.endsWith("\r") ? line.slice(0, -1) : line;
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    }
    pending += decoder.decode();
    if (pending) yield pending;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function ratingsFromLogs(files: ReplayInputFile[], options: ReplayScanOptions) {
  const map = new Map<string, ReplayRatings>();
  const logs = files.filter(
    ({ relativePath }) =>
      /(^|\/)logs\//i.test(relativePath) && relativePath.toLowerCase().endsWith(".txt"),
  );
  return (async () => {
    for (let index = 0; index < logs.length; index += 1) {
      abortIfNeeded(options.signal);
      let pending: ReplayRatings | null = null;
      let pendingChange: PendingChange | null = null;
      const volatility: Record<string, number | null> = {};
      const characters: Record<string, string | null> = {};
      let lineIndex = 0;
      try {
        for await (const line of logLines(logs[index].file, options.signal)) {
          abortIfNeeded(options.signal);
          const setPlayer = line.match(/SetNewMatch:\s*Player\s+([12]):\s*(.*?)\s*\(SteamID:/i);
          if (setPlayer) {
            const player = setPlayer[1] === "1" ? "player1" : "player2";
            if (player === "player1") {
              characters.player1 = null;
              characters.player2 = null;
              pendingChange = null;
            }
            characters[player] = setPlayer[2].trim();
            const vol = line.match(
              /Glicko:\s*\[\s*R:\s*([^:]+):\s*D:\s*([^:]+):\s*Vol:\s*([^\]]+)\]/i,
            );
            volatility[player] = vol ? parseNumeric(vol[3]) : null;
          }
          const recompute = line.match(
            /Character rating recompute:\s*(.*?)\s+(-?\d+(?:\.\d+)?)\/rd[^\s]+\s*->\s*(-?\d+(?:\.\d+)?)\/rd[^\s]+\s*\(([+-]?\d+(?:\.\d+)?)\)\s+vs\s+(.*?)\s+(-?\d+(?:\.\d+)?)\/rd[^\s]+\s*->\s*(-?\d+(?:\.\d+)?)\/rd[^\s]+/i,
          );
          if (recompute)
            pendingChange = {
              characters: [recompute[1].trim(), recompute[5].trim()],
              newRatings: [parseNumeric(recompute[3]), parseNumeric(recompute[7])],
              changes: [
                parseNumeric(recompute[4]),
                parseNumeric(recompute[7])! - parseNumeric(recompute[6])!,
              ],
              affectsRank: !/dead game:\s*set scoring over/i.test(line),
            };
          const gathered = line.match(/Gathered ratings for header:\s*(.*)$/i);
          const written = line.match(/Wrote ratings to header\s*\(([^)]*glicko[^)]*)\)/i);
          if (gathered || written)
            pending = parseRatings(
              gathered?.[1] ?? written![1],
              volatility,
              pendingChange,
              characters,
            );
          const replay = line.match(/Successfully wrote replay file:\s*(.*?\.dlr)/i);
          if (replay && pending) {
            const name = replay[1].split(/[\\/]/).pop()!.toLowerCase();
            map.set(name, pending);
            pending = null;
            volatility.player1 = null;
            volatility.player2 = null;
            characters.player1 = null;
            characters.player2 = null;
            pendingChange = null;
          }
          lineIndex += 1;
          if (lineIndex % 5000 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        // One unreadable log should not hide replays found elsewhere.
      }
      options.onProgress?.({ phase: "logs", completed: index + 1, total: logs.length });
      if (index % 4 === 3) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return map;
  })();
}

/** Scans selected .dlr and optional log files; PAK blobs are returned for artwork processing. */
export async function rescanReplayFolder(
  selection: ReplayFolderSelection,
  options: ReplayScanOptions = {},
): Promise<ReplayScanResult> {
  abortIfNeeded(options.signal);
  options.onProgress?.({ phase: "discovery", completed: 0, total: 0 });
  const files = selection.directory
    ? await walkDirectory(selection.directory, "", options.signal, (completed) => {
        options.onProgress?.({ phase: "discovery", completed, total: 0 });
      })
    : [...selection.files];
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  selection.files = files;
  const replayFiles = files.filter(({ relativePath }) =>
    relativePath.toLowerCase().endsWith(".dlr"),
  );
  options.onProgress?.({
    phase: "discovery",
    completed: replayFiles.length,
    total: replayFiles.length,
  });
  const ratings = await ratingsFromLogs(files, options);
  const games: WebReplayRow[] = [];
  const hashes = new Set<string>();
  let duplicateCount = 0;
  for (let index = 0; index < replayFiles.length; index += 1) {
    abortIfNeeded(options.signal);
    const input = replayFiles[index];
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const fields = decodeAsciiFields(bytes);
    const fileName = input.relativePath.split("/").pop() ?? input.relativePath;
    const player1 = cleanName(fields.ReplayInfo_P1Name ?? "Player 1");
    const player2 = cleanName(fields.ReplayInfo_P2Name ?? "Player 2");
    const rawCharacter1 = fields.P1 ?? fields.PreFight_MainChar ?? "Unknown";
    const rawCharacter2 = fields.P2 ?? "Unknown";
    const player1Character = formatCharacter(rawCharacter1);
    const player2Character = formatCharacter(rawCharacter2);
    const winner =
      fields.ReplayInfo_Winner === "1"
        ? player1
        : fields.ReplayInfo_Winner === "2"
          ? player2
          : "Unknown";
    const timestampMatch = fileName.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})/);
    const contentHash = await sha256(bytes);
    if (hashes.has(contentHash)) duplicateCount += 1;
    else {
      hashes.add(contentHash);
      games.push({
        id: input.relativePath,
        contentHash,
        timestamp: timestampMatch
          ? `${timestampMatch[1]}-${timestampMatch[2]}-${timestampMatch[3]} ${timestampMatch[4]}:${timestampMatch[5]}:${timestampMatch[6]}`
          : null,
        player1,
        player2,
        player1Character,
        player2Character,
        winner,
        player1Support: formatSupport(
          player1Character,
          fields.P1_SupportCharId ??
            fields.P1_SupportCharID ??
            fields.SupportCharIdP1 ??
            fields.SupportCharIDP1,
        ),
        player2Support: formatSupport(
          player2Character,
          fields.P2_SupportCharId ??
            fields.P2_SupportCharID ??
            fields.SupportCharIdP2 ??
            fields.SupportCharIDP2,
        ),
        roundScore: replayRoundScore(fields),
        ratings: ratings.get(fileName.toLowerCase()) ?? null,
      });
    }
    options.onProgress?.({ phase: "scanning", completed: index + 1, total: replayFiles.length });
    if (index % 4 === 3) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const playerCounts: Record<string, number> = {};
  for (const game of games) {
    playerCounts[game.player1] = (playerCounts[game.player1] ?? 0) + 1;
    playerCounts[game.player2] = (playerCounts[game.player2] ?? 0) + 1;
  }
  return { games, playerCounts, duplicateCount, files };
}
