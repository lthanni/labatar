export function nextLocalEightAm(now = new Date()): string {
  const slot = new Date(now);
  slot.setHours(8, 0, 0, 0);
  if (slot.getTime() <= now.getTime() + 60_000) slot.setDate(slot.getDate() + 1);
  const year = slot.getFullYear();
  const month = String(slot.getMonth() + 1).padStart(2, "0");
  const day = String(slot.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T08:00`;
}

type ScheduledRelease = {
  recordingId: string;
  publishAt: string;
  status: "reserved" | "scheduled";
};

const storageKey = "labatar.youtube-scheduled-releases";

export function readScheduledReleases(): ScheduledRelease[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
    if (!Array.isArray(saved)) return [];
    return saved.filter(
      (item): item is ScheduledRelease =>
        item != null &&
        typeof item === "object" &&
        typeof item.recordingId === "string" &&
        typeof item.publishAt === "string" &&
        Number.isFinite(new Date(item.publishAt).getTime()) &&
        (item.status === "reserved" || item.status === "scheduled"),
    );
  } catch {
    return [];
  }
}

function writeScheduledReleases(releases: ScheduledRelease[]): void {
  localStorage.setItem(storageKey, JSON.stringify(releases));
}

export function nextAvailableLocalTime(
  localDateTime: string,
  occupiedPublishAts: readonly string[],
): string {
  const slot = new Date(localDateTime);
  if (!Number.isFinite(slot.getTime())) return localDateTime;
  const occupied = new Set(occupiedPublishAts);
  while (occupied.has(slot.toISOString())) slot.setDate(slot.getDate() + 1);
  const year = slot.getFullYear();
  const month = String(slot.getMonth() + 1).padStart(2, "0");
  const day = String(slot.getDate()).padStart(2, "0");
  const hour = String(slot.getHours()).padStart(2, "0");
  const minute = String(slot.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function nextAvailableLocalEightAm(now = new Date()): string {
  return nextAvailableLocalTime(
    nextLocalEightAm(now),
    readScheduledReleases().map((release) => release.publishAt),
  );
}

export function reserveScheduledRelease(recordingId: string, publishAt: string): void {
  const releases = readScheduledReleases();
  if (releases.some((release) => release.publishAt === publishAt)) {
    throw new Error("This YouTube release time is already in use.");
  }
  writeScheduledReleases([...releases, { recordingId, publishAt, status: "reserved" }]);
}

export function finishScheduledRelease(recordingId: string, publishAt: string): void {
  writeScheduledReleases(
    readScheduledReleases().map((release) =>
      release.recordingId === recordingId && release.publishAt === publishAt
        ? { ...release, status: "scheduled" }
        : release,
    ),
  );
}

export function cancelScheduledRelease(recordingId: string, publishAt: string): void {
  writeScheduledReleases(
    readScheduledReleases().filter(
      (release) =>
        release.status === "scheduled" ||
        release.recordingId !== recordingId ||
        release.publishAt !== publishAt,
    ),
  );
}
