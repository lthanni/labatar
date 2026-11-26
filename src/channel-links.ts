export type ChannelLink = {
  id: string;
  scopeKind: "character" | "support";
  subjectId: string;
  platform: string;
  title: string;
  url: string;
  revision?: number;
};

export type LocalChannelLink = Omit<ChannelLink, "revision"> & {
  updatedAt: string;
  publishedRevision?: number;
};

export const localChannelLinksKey = "labatar-local-channel-links-v1";
const slug = /^[a-z0-9][a-z0-9-]{0,99}$/;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function normalizedChannelUrl(value: string): string | null {
  if (!value.trim() || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

const knownPlatforms: { domains: string[]; name: string }[] = [
  { domains: ["youtube.com", "youtu.be", "youtube-nocookie.com"], name: "YouTube" },
  { domains: ["twitch.tv"], name: "Twitch" },
  { domains: ["tiktok.com"], name: "TikTok" },
  { domains: ["instagram.com"], name: "Instagram" },
  { domains: ["x.com", "twitter.com"], name: "X" },
  { domains: ["facebook.com", "fb.com"], name: "Facebook" },
  { domains: ["kick.com"], name: "Kick" },
  { domains: ["bsky.app"], name: "Bluesky" },
  { domains: ["vimeo.com"], name: "Vimeo" },
  { domains: ["patreon.com"], name: "Patreon" },
  { domains: ["discord.com", "discord.gg"], name: "Discord" },
];

export function inferChannelPlatform(value: string): string | null {
  const normalized = normalizedChannelUrl(value);
  if (!normalized) return null;
  const hostname = new URL(normalized).hostname.toLowerCase();
  const known = knownPlatforms.find(({ domains }) =>
    domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)),
  );
  if (known) return known.name;
  const label = hostname.replace(/^www\./, "");
  return label.length <= 40 ? label : "Other";
}

function validLink(value: unknown): value is ChannelLink {
  return (
    record(value) &&
    typeof value.id === "string" &&
    slug.test(value.id) &&
    (value.scopeKind === "character" || value.scopeKind === "support") &&
    typeof value.subjectId === "string" &&
    slug.test(value.subjectId) &&
    typeof value.platform === "string" &&
    Boolean(value.platform.trim()) &&
    value.platform.length <= 40 &&
    typeof value.title === "string" &&
    Boolean(value.title.trim()) &&
    value.title.length <= 100 &&
    typeof value.url === "string" &&
    Boolean(normalizedChannelUrl(value.url)) &&
    (value.revision === undefined ||
      (Number.isInteger(value.revision) && (value.revision as number) > 0))
  );
}

function validLocal(value: unknown): value is LocalChannelLink {
  if (!validLink(value)) return false;
  const local = value as LocalChannelLink;
  return (
    typeof local.updatedAt === "string" &&
    (local.publishedRevision === undefined ||
      (Number.isInteger(local.publishedRevision) && local.publishedRevision > 0))
  );
}

export function readLocalChannelLinks(): LocalChannelLink[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(localChannelLinksKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(validLocal) : [];
  } catch {
    return [];
  }
}

export function writeLocalChannelLinks(items: LocalChannelLink[]): void {
  localStorage.setItem(localChannelLinksKey, JSON.stringify(items));
}

export function linksForSelection<T extends ChannelLink>(
  items: T[],
  characterId: string,
  supportId: string,
): T[] {
  return items
    .filter((item) =>
      item.scopeKind === "character"
        ? item.subjectId === characterId
        : item.subjectId === supportId,
    )
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.title.localeCompare(b.title));
}
