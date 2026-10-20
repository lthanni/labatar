import { describe, expect, it } from "vite-plus/test";
import { comboStarterFromRoute, comboStarterGroup } from "./combo-starter";
import {
  catalogSnapshot,
  comboItems,
  countLocalCombos,
  effectiveDifficulty,
  emptyPersonalEntry,
  localRevisionDraft,
  parseComboWorkspace,
  replaceLocalComboWithCatalog,
  replaceComboEntries,
} from "./combo-gameplan";
import type { PublishedCombo } from "./published-catalog";

const published: PublishedCombo = {
  id: "aang-route",
  characterId: "aang",
  supportId: "gyatso",
  name: "Reliable route",
  difficulty: 3,
  route: "5B > 236A",
  moveIds: [],
  screenPosition: "midscreen",
  damage: "3200",
  resourceCosts: { pips: 0, flow: 0 },
  mechanics: [],
  youtubeVideoId: "M7lc1UVf-VE",
  startSeconds: 0,
};

describe("personal combo workspace", () => {
  it("replaces a published candidate draft with its catalog identity and personal state", () => {
    const workspace = parseComboWorkspace({
      version: 1,
      localCombos: [
        {
          id: "local-candidate-1",
          characterId: "aang",
          supportId: "gyatso",
          route: published.route,
          needsCatalogPublication: true,
        },
      ],
      entries: {
        "local-candidate-1": {
          status: "Using",
          role: "Autopilot",
          tags: ["fullscreen"],
          note: "My route",
        },
      },
      recordingLinks: {
        "local-candidate-1": { recordingId: "candidate.mp4", name: "candidate.mp4" },
      },
      candidateSubmissions: {
        "local-candidate-1": { id: "queue-1", submittedAt: "2026-01-01" },
      },
      legacyImports: { "dev-route": "local-candidate-1" },
    });
    const result = replaceLocalComboWithCatalog(workspace, "local-candidate-1", published);
    expect(result.localCombos).toEqual([]);
    expect(result.entries["local-candidate-1"]).toBeUndefined();
    expect(result.entries[published.id]).toMatchObject({
      status: "Using",
      role: "Autopilot",
      tags: ["fullscreen"],
      note: "My route",
    });
    expect(result.recordingLinks[published.id]?.recordingId).toBe("candidate.mp4");
    expect(result.recordingLinks["local-candidate-1"]).toBeUndefined();
    expect(result.candidateSubmissions).toEqual({});
    expect(result.legacyImports["dev-route"]).toBe(published.id);
    expect(comboItems([], [], [], result.snapshots)[0].id).toBe(published.id);
    expect(parseComboWorkspace({ version: 1, ...result }).entries[published.id].status).toBe(
      "Using",
    );
  });
  it("recovers the candidate ID from an older uploaded local draft", () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    const workspace = parseComboWorkspace({
      version: 1,
      localCombos: [
        {
          id: `local-candidate-${id}`,
          characterId: "aang",
          supportId: "gyatso",
          route: "5B > 236A",
          needsCatalogPublication: true,
        },
      ],
    });
    expect(workspace.localCombos[0].candidateOriginId).toBe(id);
  });
  it("counts local combos by character, support, and parsed crit starter", () => {
    const localCombos = parseComboWorkspace({
      version: 1,
      localCombos: [
        { id: "local-1", characterId: "aang", supportId: "gyatso", route: "2B! > 5C" },
        { id: "local-2", characterId: "aang", supportId: "gyatso", route: "2B > 5C" },
        { id: "local-3", characterId: "aang", supportId: "katara", route: "2B! > 5C" },
      ],
    }).localCombos;
    expect(countLocalCombos(localCombos, "aang")).toBe(3);
    expect(countLocalCombos(localCombos, "aang", "gyatso")).toBe(2);
    expect(countLocalCombos(localCombos, "aang", "gyatso", "2B!")).toBe(1);
    expect(countLocalCombos(localCombos, "aang", "gyatso", "2B")).toBe(1);
    expect(countLocalCombos(localCombos, "korra")).toBe(0);
  });
  it("keeps unnamed catalog combos and revision drafts unnamed", () => {
    const unnamed = { ...published, name: undefined, revision: 2 };
    const catalogItem = comboItems([unnamed], [], [])[0];
    expect(catalogItem.name).toBe("");
    expect(catalogItem.route).toBe("5B > 236A");
    const draft = localRevisionDraft(catalogItem, "local-unnamed")!;
    expect(draft.name).toBe("");
    expect(comboItems([], [], [draft])[0].name).toBe("");
    const oldSnapshot = parseComboWorkspace({
      version: 1,
      snapshots: {
        [unnamed.id]: { ...catalogSnapshot(catalogItem), name: unnamed.route },
      },
    });
    expect(comboItems([], [], [], oldSnapshot.snapshots)[0].name).toBe("");
  });

  it("derives starters from routes, including saved drafts with stale starter values", () => {
    expect(comboStarterFromRoute("  j.5B! -> 236A")).toBe("j.5B!");
    expect(comboStarterFromRoute("2B! > 5B > 236B")).toBe("2B!");
    expect(comboStarterGroup("2B!")).toBe("crit");
    expect(comboStarterGroup("2B")).toBe("ground-normal");
    expect(comboStarterGroup("j.B!~A")).toBe("crit");
    expect(comboStarterFromRoute("STANCE~B > 5A", true)).toBe("STANCE~B");
    expect(comboStarterFromRoute("2F~B > 5A")).toBe("2F~B");
    expect(comboStarterFromRoute("5B > 2F~B > 5A")).toBe("5B");
    expect(comboStarterFromRoute("5B~A > 236B")).toBe("5B");
    expect(comboStarterFromRoute("5B > 236A")).toBe("5B");
    const saved = parseComboWorkspace({
      version: 1,
      localCombos: [
        {
          id: "local-stale",
          characterId: "aang",
          supportId: "gyatso",
          starter: "2A",
          route: "5B > 236A",
          name: "Changed opener",
        },
      ],
    });
    expect(saved.localCombos[0].starter).toBe("5B");
    expect(comboItems([], [], saved.localCombos)[0].starter).toBe("5B");
    expect(
      comboItems(
        [{ ...published, moveIds: ["aang-2a"] }],
        [{ id: "aang-2a", input: "2A", characterId: "aang" }] as Parameters<typeof comboItems>[1],
        [],
      )[0].starter,
    ).toBe("5B");
  });

  it("restores a Maybe someday route under its critical starter", () => {
    const saved = parseComboWorkspace({
      version: 1,
      localCombos: [
        {
          id: "local-crit",
          characterId: "aang",
          supportId: "gyatso",
          starter: "2B",
          route: "2B! > 5B > 236B",
          name: "Crit route",
        },
      ],
      entries: { "local-crit": { status: "Maybe someday" } },
    });
    expect(saved.localCombos[0].starter).toBe("2B!");
    expect(saved.entries["local-crit"].status).toBe("Maybe someday");
    expect(comboItems([], [], saved.localCombos)[0].starter).toBe("2B!");
  });

  it("restores local routes and private tracking without confusing blank status with dismissal", () => {
    const data = parseComboWorkspace({
      version: 1,
      characterId: "aang",
      supportId: "gyatso",
      starter: "5B",
      localCombos: [
        {
          id: "local-one",
          characterId: "aang",
          supportId: "gyatso",
          starter: "5B",
          route: "5B > 236A",
          name: "Mine",
          pips: 0,
          flow: 0,
        },
      ],
      entries: {
        "aang-route": { status: "", difficulty: 2 },
        "local-one": { status: "Dismissed", dismissalReason: "Too far" },
      },
    });
    expect(data.localCombos).toHaveLength(1);
    expect(data.entries["aang-route"].status).toBe("");
    expect(data.entries["local-one"].status).toBe("Dismissed");
    expect(data.entries["local-one"].dismissalReason).toBe("Too far");
    expect(
      effectiveDifficulty(comboItems([published], [], [])[0], data.entries["aang-route"]),
    ).toBe(2);
    expect(effectiveDifficulty(comboItems([published], [], [])[0], emptyPersonalEntry())).toBe(3);
  });

  it("restores private recording links and Dev import bookkeeping without adding public combo fields", () => {
    const data = parseComboWorkspace({
      version: 1,
      recordingLinks: {
        "local-one": { recordingId: "Imported Combos/route.mp4", name: "route.mp4" },
        broken: { recordingId: 7, name: "bad" },
      },
      legacyImports: { "Aang:old-combo": "local-one", invalid: 7 },
      localCombos: [
        {
          id: "local-one",
          characterId: "aang",
          supportId: "katara",
          route: "5B > 236A",
          name: "Mine",
          legacyTechComboId: "Aang:old-combo",
        },
      ],
    });
    expect(data.recordingLinks).toEqual({
      "local-one": { recordingId: "Imported Combos/route.mp4", name: "route.mp4" },
    });
    expect(data.legacyImports).toEqual({ "Aang:old-combo": "local-one" });
    expect(data.localCombos[0].legacyTechComboId).toBe("Aang:old-combo");
    expect(comboItems([], [], data.localCombos)[0]).not.toHaveProperty("recordingId");
    expect(parseComboWorkspace({ version: 1 }).recordingLinks).toEqual({});
  });

  it("replaces a Using route while preserving both routes' private notes", () => {
    const old = {
      ...emptyPersonalEntry(),
      status: "Using" as const,
      role: "Autopilot" as const,
      condition: "Midscreen",
      note: "Old timing",
    };
    const next = { ...emptyPersonalEntry(), status: "Considering" as const, note: "New timing" };
    const result = replaceComboEntries({ old, next }, "old", "next");
    expect(result.old).toMatchObject({ status: "Retired", note: "Old timing" });
    expect(result.next).toMatchObject({
      status: "Using",
      role: "Autopilot",
      condition: "Midscreen",
      note: "New timing",
    });
  });

  it("keeps a saved catalog route visible when the catalog no longer contains it", () => {
    const item = comboItems([published], [], [])[0];
    const snapshot = catalogSnapshot(item);
    const unavailable = comboItems([], [], [], { [item.id]: snapshot });
    expect(unavailable).toMatchObject([
      { id: "aang-route", source: "Unavailable", route: "5B > 236A" },
    ]);
    expect(comboItems([published], [], [], { [item.id]: snapshot })).toHaveLength(1);
  });

  it("stages a catalog revision locally with its public source fields intact", () => {
    const original = {
      ...published,
      revision: 3,
      name: "Editor route",
      difficulty: 4,
      editorPickReason: "Reliable follow-up",
      moveIds: ["aang-5b", "aang-236a"],
      notes: [{ id: "timing", category: "execution" as const, text: "Delay the follow-up." }],
    };
    const item = comboItems([original], [], [])[0];
    const draft = localRevisionDraft(item, "local-revision");
    expect(draft).toMatchObject({
      publishedId: original.id,
      publishedRevision: 3,
      originCatalog: true,
      editorName: "Editor route",
      editorDifficulty: 4,
      moveIds: original.moveIds,
      publishedBase: original,
    });
    const saved = parseComboWorkspace({ version: 1, localCombos: [draft], entries: {} });
    expect(saved.localCombos[0].publishedBase?.notes).toEqual(original.notes);
    expect(saved.localCombos[0].originCatalog).toBe(true);
    expect(localRevisionDraft(comboItems([published], [], [])[0], "local-no-revision")).toBeNull();
  });
});
