import { describe, expect, it } from "vite-plus/test";
import { initialPublisherForm, publisherDraft } from "./CombosPage";
import { comboItems, localRevisionDraft } from "./combo-gameplan";
import { publishedComboFromDraft } from "./publish-combo-draft";
import type { TechCombo } from "./tech-types";
import type { PublishedCombo } from "./published-catalog";

const published: PublishedCombo = {
  id: "aang-route",
  revision: 3,
  characterId: "aang",
  supportId: "gyatso",
  name: "Old editor name",
  route: "5B > 236A",
  moveIds: ["aang-5b", "aang-236a"],
  screenPosition: "midscreen",
  damage: "3200",
  resourceCosts: { pips: 1, flow: 0, burst: 2 },
  mechanics: ["Requires counterhit", "Initial conversion safe on block"],
  notes: [
    { id: "old-note", category: "execution", text: "Original timing." },
    { id: "setup", category: "general", text: "Keep this setup note." },
  ],
  youtubeVideoId: "M7lc1UVf-VE",
  startSeconds: 7,
};

describe("local catalog revision publishing", () => {
  it("carries the candidate ID into the published record", () => {
    const local = localRevisionDraft(comboItems([published], [], [])[0], "local-candidate")!;
    local.candidateOriginId = "12345678-1234-1234-1234-123456789abc";
    const item = comboItems([], [], [local])[0];
    const draft = publisherDraft(item, initialPublisherForm(item));
    expect(draft.combo.sourceCandidateId).toBe(local.candidateOriginId);
    expect(publishedComboFromDraft(draft)?.sourceCandidateId).toBe(local.candidateOriginId);
    const submittedDraft = publisherDraft(
      { ...item, local: { ...local, candidateOriginId: undefined } },
      initialPublisherForm(item),
      local.candidateOriginId,
    );
    expect(submittedDraft.combo.sourceCandidateId).toBe(local.candidateOriginId);
  });
  it("retains candidate provenance when an editor stages and changes a catalog revision", () => {
    const sourceCandidateId = "12345678-1234-1234-1234-123456789abc";
    const source = { ...published, sourceCandidateId };
    const local = localRevisionDraft(comboItems([source], [], [])[0], "local-revision")!;
    expect(local.candidateOriginId).toBe(sourceCandidateId);
    local.route = "5B > 236C";
    local.damage = "392";
    const item = comboItems([], [], [local])[0];
    expect(publisherDraft(item, initialPublisherForm(item)).combo.sourceCandidateId).toBe(
      sourceCandidateId,
    );
  });
  it("recovers imported public fields and a linked candidate video without inventing stale move links", () => {
    const local = {
      id: "local-import",
      characterId: "aang",
      supportId: "gyatso",
      starter: "2B",
      name: "Imported combo",
      route: "2B > 236A",
      screenPosition: "fullscreen",
      damage: "468",
      pips: 1,
      flow: 0,
      difficulty: null,
      hitconfirm: "unknown" as const,
      counterhit: false,
      youtubeUrl: "",
    };
    const legacy: TechCombo = {
      id: "dev-import",
      character: "aang",
      support: "gyatso",
      name: "EXScooter optimal?",
      difficulty: 3,
      editorPickContext: "Universal off 2B",
      moveIds: ["aang-2b", null, "aang-236a"],
      route: local.route,
      screenPosition: local.screenPosition,
      damage: local.damage,
      resourceCosts: { pips: 1, flow: 0 },
      recordingId: null,
    };
    const item = comboItems([], [], [local])[0];
    const candidateUrl = "https://youtu.be/M7lc1UVf-VE";
    expect(
      initialPublisherForm(
        { ...item, local: { ...item.local!, youtubeUrl: candidateUrl } },
        "https://youtu.be/aaaaaaaaaaa",
      ).youtubeUrl,
    ).toBe(candidateUrl);
    const form = initialPublisherForm(
      {
        ...item,
        candidate: {
          id: "queue-1",
          combo: {
            id: "dev-import",
            characterId: "aang",
            supportId: "gyatso",
            route: local.route,
            moveIds: [],
            screenPosition: local.screenPosition,
            damage: local.damage,
            notes: [],
            resourceCosts: { pips: 1, flow: 0 },
            mechanics: [],
          },
          fileName: "combo.mp4",
          fileSize: 1,
          status: "uploaded",
          rejectionReason: "",
          youtubeUrl: candidateUrl,
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
        },
      },
      "https://youtu.be/aaaaaaaaaaa",
      legacy,
    );
    expect(form).toMatchObject({
      name: "EXScooter optimal?",
      difficulty: "3",
      editorPickContext: "Universal off 2B",
      youtubeUrl: candidateUrl,
      moveIds: "aang-2b\naang-236a",
    });
    expect(form.backendId).toContain("exscooter-optimal");
    expect(initialPublisherForm({ ...item, route: "2B > 236B" }, "", legacy).moveIds).toBe("");
  });
  it("keeps public fields that the local route editor did not change", () => {
    const source = comboItems([published], [], [])[0];
    const local = localRevisionDraft(source, "local-revision")!;
    local.route = "5B > 236B";
    local.damage = "3400";
    local.editorName = "Updated editor name";
    local.editorNotes = local.editorNotes?.map((note) =>
      note.id === "old-note" ? { ...note, text: "Updated timing." } : note,
    );
    const item = comboItems([], [], [local])[0];
    const draft = publisherDraft(item, {
      backendId: published.id,
      name: local.editorName,
      difficulty: "4",
      editorPickReason: "",
      editorPickContext: "",
      youtubeUrl: local.youtubeUrl,
      moveIds: local.moveIds!.join("\n"),
      note: "",
      routingMode: "autopilot",
    });

    expect(draft.expectedRevision).toBe(3);
    expect(draft.combo).toMatchObject({
      id: published.id,
      name: "Updated editor name",
      route: "5B > 236B",
      damage: "3400",
      moveIds: published.moveIds,
      notes: [
        { id: "old-note", category: "execution", text: "Updated timing." },
        { id: "setup", category: "general", text: "Keep this setup note." },
      ],
      resourceCosts: published.resourceCosts,
      youtubeUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      startSeconds: 7,
    });
    expect(draft.combo.mechanics).toContain("Initial conversion safe on block");
    expect(draft.combo.mechanics).toContain("Requires counterhit");
  });
});
