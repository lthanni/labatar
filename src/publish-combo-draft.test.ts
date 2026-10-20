import { describe, expect, it } from "vite-plus/test";
import { makePublishComboDraft } from "./publish-combo-draft";
import type { TechCombo } from "./tech-types";
import type { RecordedVideo } from "./recording-types";

const combo: TechCombo = {
  id: "Nightmare Korra-P'Li-123",
  character: "Nightmare Korra",
  support: "P'Li",
  route: "2A > 5B",
  moveIds: ["nightmare-korra-2a", null],
  screenPosition: "midscreen",
  damage: "3200",
  resourceCosts: { pips: 1, flow: 0 },
  recordingId: "local-recording",
};

describe("combo publishing draft", () => {
  it("keeps local recording references out of the backend payload and flags unmatched moves", () => {
    const draft = makePublishComboDraft(combo, {
      youtubeUrl: "https://youtu.be/M7lc1UVf-VE",
      name: "Local video.mp4",
    } as RecordedVideo);
    expect(draft.combo.id).toBe("nightmare-korra-p-li-123");
    expect(draft.combo.characterId).toBe("nightmare-korra");
    expect(draft.combo.supportId).toBe("p-li");
    expect(draft.combo.moveIds).toEqual(["nightmare-korra-2a"]);
    expect(draft.combo.youtubeUrl).toBe("https://youtu.be/M7lc1UVf-VE");
    expect(JSON.stringify(draft)).not.toContain("local-recording");
    expect(draft.warnings).toHaveLength(1);
  });
});
