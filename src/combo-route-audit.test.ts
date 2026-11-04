import { describe, expect, it } from "vite-plus/test";
import type { ComboItem, LocalCombo } from "./combo-gameplan";
import { routeAuditTargets } from "./combo-route-audit";

describe("combo route audit access", () => {
  it("limits nonowners to saved local routes and includes shared routes for owners", () => {
    const local = [{ id: "local-1", route: "2b > 5c" }] as LocalCombo[];
    const items = [
      { id: "local-1", source: "Local", route: "2b > 5c" },
      { id: "published-1", source: "Catalog", route: "5b > 236a" },
      { id: "candidate:1", source: "Candidate", route: "j.2c > 5b" },
    ] as ComboItem[];

    expect(routeAuditTargets(local, items, false).map(({ id }) => id)).toEqual(["local-1"]);
    expect(routeAuditTargets(local, items, true).map(({ id }) => id)).toEqual([
      "local-1",
      "published-1",
      "candidate:1",
    ]);
  });
});
