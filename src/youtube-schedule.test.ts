import { expect, it } from "vite-plus/test";
import { nextLocalEightAm } from "./youtube-schedule";

it("chooses today's local 8 AM when it is safely in the future", () => {
  expect(nextLocalEightAm(new Date(2026, 9, 30, 7, 30))).toBe("2026-10-30T08:00");
});

it("chooses the next local day when today's 8 AM is too close or past", () => {
  expect(nextLocalEightAm(new Date(2026, 9, 30, 7, 59))).toBe("2026-10-31T08:00");
  expect(nextLocalEightAm(new Date(2026, 9, 30, 9))).toBe("2026-10-31T08:00");
  expect(nextLocalEightAm(new Date(2026, 11, 31, 9))).toBe("2027-01-01T08:00");
});
