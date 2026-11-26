import { normalizedChannelUrl, readLocalChannelLinks } from "./channel-links";
import { currentCatalogApiUrl } from "./published-catalog";

export type Player = {
  id: string;
  scopeKind: "character" | "support";
  subjectId: string;
  title: string;
  links: string[];
};

export type LocalPlayer = Player & { updatedAt: string; publishedRevision?: number };
export type PublishedPlayer = Player & { revision: number };

export const localPlayersKey = "labatar-local-players-v1";
export const maxPlayerLinks = 20;
const slug = /^[a-z0-9][a-z0-9-]{0,99}$/;

export function normalizedPlayerLink(value: string): string | null {
  const url = normalizedChannelUrl(value);
  return url && url.length <= 2048 ? url : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlayer(value: unknown): value is Player {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    slug.test(value.id) &&
    (value.scopeKind === "character" || value.scopeKind === "support") &&
    typeof value.subjectId === "string" &&
    slug.test(value.subjectId) &&
    typeof value.title === "string" &&
    Boolean(value.title.trim()) &&
    value.title.length <= 100 &&
    Array.isArray(value.links) &&
    value.links.length >= 1 &&
    value.links.length <= maxPlayerLinks &&
    value.links.every((link) => typeof link === "string" && normalizedPlayerLink(link) !== null)
  );
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isLocalPlayer(value: unknown): value is LocalPlayer {
  return (
    isRecord(value) &&
    typeof value.updatedAt === "string" &&
    (value.publishedRevision === undefined || isRevision(value.publishedRevision)) &&
    isPlayer(value)
  );
}

function isPublishedPlayer(value: unknown): value is PublishedPlayer {
  return isRecord(value) && isRevision(value.revision) && isPlayer(value);
}

export function readLocalPlayers(): LocalPlayer[] {
  try {
    const raw = localStorage.getItem(localPlayersKey);
    if (raw === null) {
      return readLocalChannelLinks().map(({ platform: _platform, url, ...player }) => ({
        ...player,
        links: [url],
      }));
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isLocalPlayer) : [];
  } catch {
    return [];
  }
}

export function writeLocalPlayers(items: LocalPlayer[]): void {
  localStorage.setItem(localPlayersKey, JSON.stringify(items));
}

export function playersForSelection<T extends Player>(
  items: T[],
  characterId: string,
  supportId: string,
): T[] {
  return items
    .filter((item) => item.subjectId === (item.scopeKind === "character" ? characterId : supportId))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function fetchPublishedPlayers(
  characterId: string,
  supportId: string,
): Promise<PublishedPlayer[]> {
  const url = new URL(`${await currentCatalogApiUrl()}/v1/players`);
  url.searchParams.set("character", characterId);
  if (supportId) url.searchParams.set("support", supportId);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Published players could not be loaded (${response.status}).`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.items) || !body.items.every(isPublishedPlayer))
    throw new Error("The published players response has an unexpected format.");
  return body.items;
}
