import { describe, expect, it } from "vite-plus/test";
import { candidateRecordingTitle, formatComboRecordingBaseName } from "./combo-recording-name";

describe("combo recording and upload titles", () => {
  it("uses the same name for a candidate and Record for this combo", () => {
    const recordingName = formatComboRecordingBaseName({
      character: "Aang",
      support: "Gyatso",
      starter: "2B",
      screenPosition: "fullscreen",
      damage: "468",
    });
    expect(
      candidateRecordingTitle({
        characterId: "aang",
        supportId: "gyatso",
        route: "2B 5C 236EX",
        screenPosition: "fullscreen",
        damage: "468",
      }),
    ).toBe(recordingName);
    expect(recordingName).toBe("Aang - Gyatso - 2B - fullscreen - damage 468");
  });
});
