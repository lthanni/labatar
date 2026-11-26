import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  cancelScheduledRelease,
  finishScheduledRelease,
  nextAvailableLocalEightAm,
  nextAvailableLocalTime,
  nextLocalEightAm,
  readScheduledReleases,
  reserveScheduledRelease,
} from "./youtube-schedule";

afterEach(() => vi.unstubAllGlobals());

function stubStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
}

it("chooses today's local 8 AM when it is safely in the future", () => {
  expect(nextLocalEightAm(new Date(2026, 9, 30, 7, 30))).toBe("2026-10-30T08:00");
});

it("chooses the next local day when today's 8 AM is too close or past", () => {
  expect(nextLocalEightAm(new Date(2026, 9, 30, 7, 59))).toBe("2026-10-31T08:00");
  expect(nextLocalEightAm(new Date(2026, 9, 30, 9))).toBe("2026-10-31T08:00");
  expect(nextLocalEightAm(new Date(2026, 11, 31, 9))).toBe("2027-01-01T08:00");
});

it("remembers scheduled slots and advances across consecutive occupied days", () => {
  stubStorage();
  const first = new Date(2026, 9, 30, 8).toISOString();
  const second = new Date(2026, 9, 31, 8).toISOString();
  reserveScheduledRelease("first.mp4", first);
  finishScheduledRelease("first.mp4", first);
  reserveScheduledRelease("second.mp4", second);

  expect(readScheduledReleases()).toHaveLength(2);
  expect(nextAvailableLocalEightAm(new Date(2026, 9, 30, 7))).toBe("2026-11-01T08:00");
  expect(nextAvailableLocalTime("2026-10-30T08:00", [first, second])).toBe("2026-11-01T08:00");
});

it("releases a failed upload reservation so the slot can be reused", () => {
  stubStorage();
  const slot = new Date(2026, 11, 31, 8).toISOString();
  reserveScheduledRelease("failed.mp4", slot);
  expect(() => reserveScheduledRelease("duplicate.mp4", slot)).toThrow(/already in use/);
  cancelScheduledRelease("failed.mp4", slot);
  expect(readScheduledReleases()).toEqual([]);
  expect(nextAvailableLocalEightAm(new Date(2026, 11, 31, 7))).toBe("2026-12-31T08:00");
});
