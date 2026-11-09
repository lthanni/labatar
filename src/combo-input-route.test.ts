import { describe, expect, it } from "vite-plus/test";
import { parseComboWorkspace } from "./combo-gameplan";

describe("recorded combo drafts", () => {
  it("keeps an empty recorded draft across workspace reload", () => {
    const draft = parseComboWorkspace({
      version: 1,
      localCombos: [
        {
          id: "local-recorded",
          characterId: "aang",
          supportId: "katara",
          route: "",
          recordingDraft: true,
          routeSource: "capture",
          inputFacing: "right",
        },
      ],
    });
    expect(draft.localCombos[0]).toMatchObject({
      route: "",
      starter: "Pending input",
      recordingDraft: true,
      routeSource: "capture",
      inputFacing: "right",
    });
  });
});
