import type { ComboNote } from "./tech-types";

const databaseName = "labatar-published-catalog-v1";
const storeName = "snapshots";
const snapshotKey = "latest";
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const candidateIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const catalogApiUrl =
  import.meta.env.VITE_CATALOG_API_URL?.replace(/\/$/, "") ??
  "https://labatar-catalog.landenhanni.workers.dev";

export type PublishedMove = {
  id: string;
  characterId: string;
  supportId?: string;
  input: string;
  isStanceParent?: boolean;
  isNonAttack?: boolean;
  label: string | null;
  startup: number | null;
  active: number | null;
  recovery: number | null;
  onBlock: number | null;
  blockstun: number | null;
  hitstun: number | null;
  resourceCosts: Record<string, number>;
  mechanics: string[];
};

export type PublishedCombo = {
  id: string;
  sourceCandidateId?: string;
  revision?: number;
  characterId: string;
  supportId: string;
  name?: string;
  difficulty?: number | null;
  editorPickReason?: string;
  editorPickContext?: string;
  route: string;
  starterIsNonAttackStance?: boolean;
  routingMode?: "autopilot" | "unique";
  moveIds: string[];
  screenPosition: string | null;
  damage: string;
  notes?: Array<ComboNote | string>;
  resourceCosts: Record<string, number>;
  mechanics: string[];
  youtubeVideoId: string;
  startSeconds: number;
};

export type PublishedCatalog = {
  fetchedAt: number;
  moves: PublishedMove[];
  combos: PublishedCombo[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSlug(value: unknown): value is string {
  return typeof value === "string" && slugPattern.test(value);
}

function isOptionalText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function hasCommonFields(value: Record<string, unknown>): boolean {
  return (
    isSlug(value.id) &&
    isSlug(value.characterId) &&
    isRecord(value.resourceCosts) &&
    Object.entries(value.resourceCosts).every(
      ([key, amount]) => isSlug(key) && typeof amount === "number" && Number.isFinite(amount),
    ) &&
    Array.isArray(value.mechanics) &&
    value.mechanics.every((mechanic) => typeof mechanic === "string")
  );
}

function isMove(value: unknown): value is PublishedMove {
  if (!isRecord(value) || !hasCommonFields(value)) return false;
  return (
    (value.supportId === undefined || isSlug(value.supportId)) &&
    typeof value.input === "string" &&
    (value.isStanceParent === undefined || typeof value.isStanceParent === "boolean") &&
    (value.isNonAttack === undefined || typeof value.isNonAttack === "boolean") &&
    isOptionalText(value.label) &&
    ["startup", "active", "recovery", "onBlock", "blockstun", "hitstun"].every(
      (field) =>
        value[field] === null ||
        (typeof value[field] === "number" && Number.isFinite(value[field])),
    )
  );
}

export function isPublishedCombo(value: unknown): value is PublishedCombo {
  if (!isRecord(value) || !hasCommonFields(value)) return false;
  return (
    isSlug(value.supportId) &&
    (value.sourceCandidateId === undefined ||
      (typeof value.sourceCandidateId === "string" &&
        candidateIdPattern.test(value.sourceCandidateId))) &&
    (value.revision === undefined ||
      (Number.isSafeInteger(value.revision) && Number(value.revision) > 0)) &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.editorPickReason === undefined || typeof value.editorPickReason === "string") &&
    (value.editorPickContext === undefined || typeof value.editorPickContext === "string") &&
    (value.difficulty === undefined ||
      value.difficulty === null ||
      (Number.isInteger(value.difficulty) &&
        Number(value.difficulty) >= 1 &&
        Number(value.difficulty) <= 5)) &&
    typeof value.route === "string" &&
    (value.starterIsNonAttackStance === undefined ||
      typeof value.starterIsNonAttackStance === "boolean") &&
    (value.routingMode === undefined ||
      value.routingMode === "autopilot" ||
      value.routingMode === "unique") &&
    Array.isArray(value.moveIds) &&
    value.moveIds.every(isSlug) &&
    isOptionalText(value.screenPosition) &&
    typeof value.damage === "string" &&
    (value.notes === undefined ||
      (Array.isArray(value.notes) &&
        value.notes.every(
          (note) =>
            typeof note === "string" ||
            (isRecord(note) &&
              typeof note.id === "string" &&
              typeof note.text === "string" &&
              ["general", "execution", "situational"].includes(String(note.category)) &&
              (note.range === undefined ||
                (isRecord(note.range) &&
                  Number.isInteger(note.range.startToken) &&
                  Number.isInteger(note.range.endToken) &&
                  typeof note.range.excerpt === "string"))),
        ))) &&
    typeof value.youtubeVideoId === "string" &&
    videoIdPattern.test(value.youtubeVideoId) &&
    Number.isInteger(value.startSeconds) &&
    (value.startSeconds as number) >= 0 &&
    (value.startSeconds as number) <= 86_400
  );
}

function parseItems<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  if (!isRecord(value) || !Array.isArray(value.items) || !value.items.every(guard)) {
    throw new Error("The catalog response has an unexpected format.");
  }
  return value.items;
}

export function parsePublishedCatalog(value: unknown): PublishedCatalog {
  if (
    !isRecord(value) ||
    typeof value.fetchedAt !== "number" ||
    !Number.isFinite(value.fetchedAt) ||
    !Array.isArray(value.moves) ||
    !value.moves.every(isMove) ||
    !Array.isArray(value.combos) ||
    !value.combos.every(isPublishedCombo)
  ) {
    throw new Error("The saved catalog has an unexpected format.");
  }
  return value as PublishedCatalog;
}

export async function fetchPublishedCatalog(
  fetcher: typeof fetch = fetch,
  apiUrl = catalogApiUrl,
  signal?: AbortSignal,
): Promise<PublishedCatalog> {
  const [movesResponse, combosResponse] = await Promise.all([
    fetcher(`${apiUrl}/v1/moves`, { signal, cache: "no-store" }),
    fetcher(`${apiUrl}/v1/combos`, { signal, cache: "no-store" }),
  ]);
  if (!movesResponse.ok || !combosResponse.ok) {
    throw new Error("The published catalog could not be loaded.");
  }
  const [movesBody, combosBody] = await Promise.all([movesResponse.json(), combosResponse.json()]);
  return {
    fetchedAt: Date.now(),
    moves: parseItems(movesBody, isMove),
    combos: parseItems(combosBody, isPublishedCombo),
  };
}

export async function fetchPublishedCombos(
  fetcher: typeof fetch = fetch,
  apiUrl = catalogApiUrl,
  signal?: AbortSignal,
): Promise<PublishedCombo[]> {
  const response = await fetcher(`${apiUrl}/v1/combos`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("The published combos could not be loaded.");
  return parseItems(await response.json(), isPublishedCombo);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readPublishedCatalogCache(): Promise<PublishedCatalog | null> {
  const database = await openDatabase();
  try {
    const cached = await new Promise<unknown>((resolve, reject) => {
      const request = database
        .transaction(storeName, "readonly")
        .objectStore(storeName)
        .get(snapshotKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return cached === undefined ? null : parsePublishedCatalog(cached);
  } finally {
    database.close();
  }
}

export async function writePublishedCatalogCache(catalog: PublishedCatalog): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(catalog, snapshotKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
