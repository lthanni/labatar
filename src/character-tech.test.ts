import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  characterTechForSelection,
  characterTechStorageKey,
  inheritCharacterTechScope,
  isCharacterTechKind,
  readCharacterTech,
  readLocalNoteSections,
  writeCharacterTech,
  writeLocalNoteSections,
  type CharacterTechEntry,
} from "./character-tech";

afterEach(() => vi.unstubAllGlobals());

const universal: CharacterTechEntry = {
  id: "universal",
  kind: "pressure",
  characterId: "aang",
  supportId: null,
  title: "Universal pressure",
  setup: "5B blocked",
  sequence: "5B > 2A",
  outcome: "Stay close",
  notes: "",
  recordingId: "",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

it("shows universal tech for every support and scoped tech only for its support", () => {
  const gyatso = {
    ...universal,
    id: "gyatso",
    supportId: "gyatso",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
  expect(characterTechForSelection([universal, gyatso], "pressure", "aang", "gyatso")).toEqual([
    gyatso,
    universal,
  ]);
  expect(characterTechForSelection([universal, gyatso], "pressure", "aang", "appa")).toEqual([
    universal,
  ]);
});

it("retains drafts from the removed Counterplay tab when reading and saving local guides", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const section = {
    id: "legacy-section",
    kind: "counterplay" as const,
    characterId: "aang",
    supportId: null,
    title: "Defending",
    description: "",
  };
  const entry = { ...universal, id: "legacy-entry", kind: section.kind, sectionId: section.id };
  writeLocalNoteSections([section]);
  writeCharacterTech([entry]);
  writeCharacterTech([...readCharacterTech(), universal]);

  expect(isCharacterTechKind(section.kind)).toBe(false);
  expect(readLocalNoteSections()).toEqual([section]);
  expect(readCharacterTech()).toEqual([entry, universal]);
  expect(characterTechForSelection(readCharacterTech(), "pressure", "aang", "appa")).toEqual([
    universal,
  ]);
});

it("uses the parent section's scope before filtering entries, including after a local scope change", () => {
  const section = {
    id: "group",
    title: "Pressure",
    description: "",
    kind: universal.kind,
    characterId: universal.characterId,
    supportId: "gyatso" as string | null,
  };
  const sections = new Map([[section.id, section]]);
  const guide = { ...universal, sectionId: section.id };
  const scoped = inheritCharacterTechScope(guide, sections);
  expect(scoped.supportId).toBe("gyatso");
  expect(characterTechForSelection([scoped], "pressure", "aang", "appa")).toEqual([]);
  expect(characterTechForSelection([scoped], "pressure", "aang", "gyatso")).toEqual([scoped]);

  sections.set(section.id, { ...section, supportId: null });
  expect(inheritCharacterTechScope(scoped, sections).supportId).toBeNull();
  expect(inheritCharacterTechScope({ ...scoped, sectionId: undefined }, sections).supportId).toBe(
    "gyatso",
  );
});

it("keeps saved guide links and ignores invalid local records", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const guide: CharacterTechEntry = {
    ...universal,
    id: "guide",
    kind: "guide",
    relatedTechIds: ["universal"],
    relatedComboIds: ["aang-route"],
    videos: [
      {
        title: "Demo",
        description: "Watch the timing",
        url: "",
        localVideoId: "550e8400-e29b-41d4-a716-446655440000",
        localFileName: "demo.mp4",
      },
    ],
    publishedRevision: 3,
  };
  writeCharacterTech([guide]);
  expect(readCharacterTech()).toEqual([guide]);
  values.set(characterTechStorageKey, JSON.stringify([guide, { ...guide, id: 10 }]));
  expect(readCharacterTech()).toEqual([guide]);
});
