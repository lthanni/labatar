import { describe, expect, it } from "vite-plus/test";
import {
  candidateComboFromItem,
  candidateMatchesPublishedCombo,
  candidateItem,
  candidateReviewStatus,
  countCandidates,
  finishUploadedCandidate,
  mergeCandidateItems,
  candidatePublicationMatches,
  savedCandidateRecording,
  type ComboCandidate,
} from "./combo-candidates";
import type { RecordedVideo } from "./recording-types";
import {
  comboItems,
  emptyComboWorkspace,
  emptyPersonalEntry,
  parseComboWorkspace,
  type ComboItem,
  type PersonalComboEntry,
} from "./combo-gameplan";

describe("combo candidate snapshot", () => {
  it("presents pending and approved backend states as the same upload step", () => {
    expect(candidateReviewStatus({ status: "pending" } as ComboCandidate)).toBe(
      "Awaiting YouTube upload",
    );
    expect(candidateReviewStatus({ status: "approved" } as ComboCandidate)).toBe(
      "Awaiting YouTube upload",
    );
  });
  it("recognizes a previously downloaded MP4 after refresh and keeps a renamed link", () => {
    const candidate = {
      id: "queue-1",
      fileSize: 100,
    } as ComboCandidate;
    const downloaded = {
      id: "candidate-queue-1.mp4",
      name: "candidate-queue-1.mp4",
      mediaKind: "local",
      size: 100,
    } as RecordedVideo;
    const renamed = {
      ...downloaded,
      id: "Imported Combos/reviewed-route.mp4",
      name: "reviewed-route.mp4",
    };
    expect(savedCandidateRecording(candidate, [downloaded], {})).toEqual(downloaded);
    const oldDownload = { ...downloaded, id: `Imported Combos/${downloaded.id}` };
    expect(savedCandidateRecording(candidate, [oldDownload], {})?.id).toBe(
      `Imported Combos/${downloaded.id}`,
    );
    expect(savedCandidateRecording(candidate, [oldDownload, downloaded], {})).toEqual(downloaded);
    expect(
      savedCandidateRecording(candidate, [renamed], {
        "candidate:queue-1": { recordingId: renamed.id, name: renamed.name },
      }),
    ).toEqual(renamed);
    expect(savedCandidateRecording(candidate, [{ ...downloaded, size: 99 }], {})).toBeNull();
    expect(
      savedCandidateRecording(candidate, [{ ...downloaded, mediaKind: "youtube" }], {}),
    ).toBeNull();
  });
  it("counts active upstream candidates by character, pairing, and parsed starter", () => {
    const first: ComboCandidate = {
      id: "queue-1",
      combo: {
        id: "combo-1",
        characterId: "aang",
        supportId: "katara",
        route: "2B! > 5C",
        moveIds: [],
        screenPosition: "fullscreen",
        damage: "468",
        notes: [],
        resourceCosts: { pips: 0, flow: 0 },
        mechanics: [],
      },
      fileName: "combo.mp4",
      fileSize: 100,
      status: "pending",
      rejectionReason: "",
      youtubeUrl: "",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    const candidates: ComboCandidate[] = [
      first,
      {
        ...first,
        id: "queue-2",
        status: "rejected",
        combo: { ...first.combo, supportId: "gyatso", route: "5B > 236A" },
      },
      {
        ...first,
        id: "queue-3",
        status: "uploaded",
        combo: { ...first.combo, characterId: "korra" },
      },
    ];
    expect(countCandidates(candidates, "aang")).toBe(1);
    expect(countCandidates(candidates, "aang", "katara")).toBe(1);
    expect(countCandidates(candidates, "aang", "gyatso")).toBe(0);
    expect(countCandidates(candidates, "aang", "katara", "2B!")).toBe(1);
    expect(countCandidates(candidates, "aang", "katara", "5B")).toBe(0);
    expect(countCandidates(candidates, "korra")).toBe(0);
    expect(mergeCandidateItems([], candidates, {})).toHaveLength(2);
  });
  it("turns an uploaded candidate into a local combo without its candidate receipt", () => {
    const candidate: ComboCandidate = {
      id: "queue-1",
      combo: {
        id: "aang-katara-5b",
        characterId: "aang",
        supportId: "katara",
        name: "Reliable route",
        route: "5B > 236A",
        moveIds: [],
        screenPosition: "midscreen",
        damage: "302",
        notes: [],
        resourceCosts: { pips: 1, flow: 0 },
        mechanics: [],
      },
      fileName: "route.mp4",
      fileSize: 100,
      status: "uploaded",
      rejectionReason: "",
      youtubeUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    };
    const workspace = emptyComboWorkspace();
    workspace.entries[`candidate:${candidate.id}`] = {
      ...emptyPersonalEntry(),
      status: "Learning",
    };
    const result = finishUploadedCandidate(workspace, candidate, [], {
      recordingId: "Imported Combos/route.mp4",
      name: "route.mp4",
    });
    expect(result.targetId).toBe(`local-candidate-${candidate.id}`);
    expect(result.workspace.localCombos).toMatchObject([
      {
        id: result.targetId,
        route: "5B > 236A",
        youtubeUrl: candidate.youtubeUrl,
        needsCatalogPublication: true,
        candidateOriginId: candidate.id,
      },
    ]);
    expect(result.workspace.entries[result.targetId].status).toBe("Learning");
    expect(result.workspace.entries[`candidate:${candidate.id}`]).toBeUndefined();
    expect(result.workspace.recordingLinks[result.targetId].recordingId).toBe(
      "Imported Combos/route.mp4",
    );
    expect(parseComboWorkspace({ version: 1, ...result.workspace }).localCombos).toMatchObject([
      { id: result.targetId, youtubeUrl: candidate.youtubeUrl, needsCatalogPublication: true },
    ]);
    expect(mergeCandidateItems([], [candidate], {})).toEqual([]);
  });
  it("finds the original submitter's unchanged draft by published candidate ID", () => {
    const local = {
      id: "local-1",
      characterId: "aang",
      supportId: "gyatso",
      starter: "5B",
      name: "Route",
      route: "5B > 236A",
      screenPosition: "midscreen",
      damage: "302",
      pips: 0,
      flow: 0,
      difficulty: null,
      hitconfirm: "unknown" as const,
      counterhit: false,
      youtubeUrl: "",
    };
    const item = comboItems([], [], [local])[0];
    const published = {
      id: "catalog-route",
      sourceCandidateId: "12345678-1234-1234-1234-123456789abc",
      characterId: "aang",
      supportId: "gyatso",
      route: local.route,
      moveIds: [],
      screenPosition: local.screenPosition,
      damage: local.damage,
      resourceCosts: { pips: 0, flow: 0 },
      mechanics: [],
      youtubeVideoId: "M7lc1UVf-VE",
      startSeconds: 0,
    };
    const workspace = emptyComboWorkspace();
    workspace.localCombos = [local];
    workspace.candidateSubmissions[local.id] = {
      id: published.sourceCandidateId,
      submittedAt: "2026-01-01",
      draftSignature: JSON.stringify(candidateComboFromItem(item)),
    };
    expect(candidatePublicationMatches(workspace, [published])).toEqual([
      { localId: local.id, published, readyToReplace: true },
    ]);
    expect(
      candidatePublicationMatches(
        { ...workspace, localCombos: [{ ...local, route: "5B > 236B" }] },
        [published],
      ),
    ).toEqual([{ localId: local.id, published, readyToReplace: false }]);
    expect(
      candidatePublicationMatches(workspace, [published, { ...published, id: "duplicate" }]),
    ).toEqual([]);
    const editorCopy = {
      ...workspace,
      candidateSubmissions: {},
      localCombos: [
        { ...local, candidateOriginId: published.sourceCandidateId, needsCatalogPublication: true },
      ],
    };
    expect(candidatePublicationMatches(editorCopy, [published])).toEqual([
      { localId: local.id, published, readyToReplace: true },
    ]);
    expect(
      candidatePublicationMatches(
        { ...editorCopy, localCombos: [{ ...editorCopy.localCombos[0], route: "5B > 236B" }] },
        [published],
      ),
    ).toEqual([{ localId: local.id, published, readyToReplace: true }]);
    const duplicate = {
      ...workspace,
      candidateSubmissions: {
        [local.id]: {
          ...workspace.candidateSubmissions[local.id],
          id: "87654321-4321-4321-4321-cba987654321",
        },
      },
    };
    expect(candidatePublicationMatches(duplicate, [published])).toEqual([
      { localId: local.id, published, readyToReplace: true },
    ]);
    const updatedPublication = {
      ...published,
      route: "5B > 236C",
      damage: "400",
    };
    const resubmitted = {
      ...duplicate,
      candidateSubmissions: {
        [local.id]: {
          ...duplicate.candidateSubmissions[local.id],
          originCandidateId: published.sourceCandidateId,
        },
      },
    };
    expect(candidatePublicationMatches(resubmitted, [updatedPublication])).toEqual([
      { localId: local.id, published: updatedPublication, readyToReplace: true },
    ]);
    const queuedDuplicate: ComboCandidate = {
      id: duplicate.candidateSubmissions[local.id].id,
      combo: candidateComboFromItem(item),
      fileName: "duplicate.mp4",
      fileSize: 100,
      status: "pending",
      rejectionReason: "",
      youtubeUrl: "",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    expect(candidateMatchesPublishedCombo(queuedDuplicate, published)).toBe(true);
    expect(
      candidateMatchesPublishedCombo(
        { ...queuedDuplicate, combo: { ...queuedDuplicate.combo, damage: "393" } },
        published,
      ),
    ).toBe(false);
    expect(
      candidateMatchesPublishedCombo(
        { ...queuedDuplicate, originCandidateId: queuedDuplicate.id },
        published,
      ),
    ).toBe(false);
    expect(
      candidateMatchesPublishedCombo(
        {
          ...queuedDuplicate,
          originCandidateId: published.sourceCandidateId,
          combo: { ...queuedDuplicate.combo, route: "5B > 236C", damage: "400" },
        },
        published,
      ),
    ).toBe(true);
    expect(
      candidatePublicationMatches(
        {
          ...workspace,
          candidateSubmissions: {},
          localCombos: [
            { ...local, candidateOriginId: published.sourceCandidateId, publishedId: published.id },
          ],
        },
        [published],
      ),
    ).toEqual([]);
  });
  it("carries a saved candidate MP4 into the local combo after a later upload", () => {
    const workspace = emptyComboWorkspace();
    const candidate: ComboCandidate = {
      id: "queue-1",
      status: "uploaded",
      youtubeUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      fileName: "candidate-queue-1.mp4",
      fileSize: 100,
      rejectionReason: "",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      combo: {
        id: "aang-katara-5b",
        characterId: "aang",
        supportId: "katara",
        route: "5B > 236A",
        moveIds: [],
        screenPosition: "midscreen",
        damage: "302",
        notes: [],
        resourceCosts: { pips: 1, flow: 0 },
        mechanics: [],
      },
    };
    workspace.recordingLinks[`candidate:${candidate.id}`] = {
      recordingId: "Imported Combos/candidate-queue-1.mp4",
      name: "candidate-queue-1.mp4",
    };
    const result = finishUploadedCandidate(workspace, candidate, []);
    expect(result.workspace.recordingLinks[result.targetId]).toEqual(
      workspace.recordingLinks[`candidate:${candidate.id}`],
    );
    expect(result.workspace.recordingLinks[`candidate:${candidate.id}`]).toBeUndefined();
  });
  it("keeps the first submission ID on an editor's locally edited candidate", () => {
    const originCandidateId = "12345678-1234-1234-1234-123456789abc";
    const candidate: ComboCandidate = {
      id: "87654321-4321-4321-4321-cba987654321",
      originCandidateId,
      combo: {
        id: "aang-route",
        characterId: "aang",
        supportId: "gyatso",
        route: "5B > 236B",
        moveIds: [],
        screenPosition: "midscreen",
        damage: "392",
        notes: [],
        resourceCosts: { pips: 0, flow: 0 },
        mechanics: [],
      },
      fileName: "route.mp4",
      fileSize: 100,
      status: "uploaded",
      rejectionReason: "",
      youtubeUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    };
    const finished = finishUploadedCandidate(emptyComboWorkspace(), candidate, []);
    const saved = parseComboWorkspace({ version: 1, ...finished.workspace });
    expect(saved.localCombos[0].candidateOriginId).toBe(originCandidateId);
    expect(saved.localCombos[0].id).toBe(`local-candidate-${originCandidateId}`);
    expect(candidatePublicationMatches(saved, [])).toEqual([]);
  });
  it("updates a matching local combo and clears only its candidate receipt", () => {
    const workspace = emptyComboWorkspace();
    const local = {
      id: "local-1",
      characterId: "aang",
      supportId: "katara",
      starter: "5B",
      name: "Route",
      route: "5B > 236A",
      screenPosition: "midscreen",
      damage: "302",
      pips: 1,
      flow: 0,
      difficulty: null,
      hitconfirm: "unknown" as const,
      counterhit: false,
      youtubeUrl: "",
    };
    workspace.localCombos = [local];
    workspace.candidateSubmissions = {
      "local-1": { id: "queue-1", submittedAt: "2026-01-01" },
      "local-2": { id: "queue-2", submittedAt: "2026-01-01" },
    };
    const candidate: ComboCandidate = {
      id: "queue-1",
      combo: {
        id: "aang-katara-5b",
        characterId: "aang",
        supportId: "katara",
        route: local.route,
        moveIds: [],
        screenPosition: local.screenPosition,
        damage: local.damage,
        notes: [],
        resourceCosts: { pips: 1, flow: 0 },
        mechanics: [],
      },
      fileName: "route.mp4",
      fileSize: 100,
      status: "uploaded",
      rejectionReason: "",
      youtubeUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    };
    const item: ComboItem = {
      ...local,
      source: "Local",
      counterhit: "unknown",
      local,
    };
    const result = finishUploadedCandidate(workspace, candidate, [item]);
    expect(result.targetId).toBe("local-1");
    expect(result.workspace.localCombos).toMatchObject([
      { id: "local-1", youtubeUrl: candidate.youtubeUrl },
    ]);
    expect(result.workspace.candidateSubmissions).toEqual({
      "local-2": { id: "queue-2", submittedAt: "2026-01-01" },
    });
  });
  it("attaches a matching submitted candidate to its tracked combo identity", () => {
    const original: ComboItem = {
      id: "local-1",
      source: "Local",
      characterId: "aang",
      supportId: "katara",
      starter: "5B",
      name: "Route",
      route: "5B > 236A",
      screenPosition: "midscreen",
      damage: "100",
      pips: 1,
      flow: 0,
      difficulty: null,
      hitconfirm: "unknown",
      counterhit: "unknown",
    };
    const candidate = {
      id: "queue-1",
      combo: candidateComboFromItem(original),
      fileName: "route.mp4",
      fileSize: 100,
      status: "pending" as const,
      rejectionReason: "",
      youtubeUrl: "",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    const submissions = { [original.id]: { id: candidate.id } };
    expect(mergeCandidateItems([original], [candidate], submissions)).toMatchObject([
      { id: "local-1", source: "Local", candidate: { id: "queue-1" } },
    ]);
    const changed = { ...original, route: "5B > 236B" };
    expect(mergeCandidateItems([changed], [candidate], submissions).map((item) => item.id)).toEqual(
      ["local-1", "candidate:queue-1"],
    );
  });
  it("maps an upstream candidate into a distinct combo row with its route starter", () => {
    const item = candidateItem({
      id: "queue-1",
      combo: {
        id: "shared-id",
        characterId: "aang",
        supportId: "katara",
        route: "2B! > 5C",
        moveIds: [],
        screenPosition: "fullscreen",
        damage: "468",
        notes: [],
        resourceCosts: { pips: 2, flow: 0 },
        mechanics: ["Requires counterhit"],
      },
      fileName: "combo.mp4",
      fileSize: 100,
      status: "approved",
      rejectionReason: "",
      youtubeUrl: "",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    expect(item).toMatchObject({
      id: "candidate:queue-1",
      source: "Candidate",
      starter: "2B!",
      damage: "468",
      pips: 2,
      counterhit: "yes",
      candidate: { status: "approved" },
    });
  });
  it("includes public combo details while excluding personal tracking and local recording paths", () => {
    const item: ComboItem = {
      id: "local-123",
      source: "Local",
      characterId: "aang",
      supportId: "katara",
      starter: "5B",
      name: "",
      route: "5B > 2FA > 236B",
      screenPosition: "midscreen",
      damage: "302",
      pips: 1,
      flow: 0,
      difficulty: null,
      hitconfirm: "yes",
      counterhit: "no",
      local: {
        id: "local-123",
        characterId: "aang",
        supportId: "katara",
        starter: "5B",
        name: "Reliable route",
        route: "5B > 2FA > 236B",
        screenPosition: "midscreen",
        damage: "302",
        pips: 1,
        flow: 0,
        difficulty: 5,
        hitconfirm: "yes",
        counterhit: false,
        youtubeUrl: "",
        editorDifficulty: 2,
      },
    };
    const personal: PersonalComboEntry = {
      status: "Using",
      name: "Secret nickname",
      difficulty: 4,
      role: "Autopilot",
      condition: "Close range",
      tags: ["private"],
      note: "Private note",
      dismissalReason: "",
    };
    const candidate = candidateComboFromItem(item);
    expect(candidate).toMatchObject({
      id: "aang-katara-5b-2fa-236b",
      name: "Reliable route",
      difficulty: 2,
      resourceCosts: { pips: 1, flow: 0 },
      mechanics: ["Initial conversion hitconfirmable"],
    });
    const serialized = JSON.stringify(candidate);
    expect(serialized).not.toContain(personal.name);
    expect(serialized).not.toContain(personal.note);
    expect(serialized).not.toContain("local-123");
  });
});
