import { describe, expect, it } from "vite-plus/test";
import { comboItems } from "./combo-gameplan";
import { candidateItem } from "./combo-candidates";
import { comboMediaGap, comboYouTubeVideo, mediaGap } from "./combo-media";
import type { RecordedVideo } from "./recording-types";

describe("combo media gaps", () => {
  it("distinguishes no video from an MP4 that still needs YouTube", () => {
    expect(mediaGap(false, false)).toBe("No video");
    expect(mediaGap(true, false)).toBe("No YouTube video");
    expect(mediaGap(false, true)).toBeNull();
  });

  it("uses the local link, uploaded recording, and combo YouTube URL", () => {
    const local = comboItems(
      [],
      [],
      [
        {
          id: "local-one",
          characterId: "aang",
          supportId: "katara",
          starter: "5B",
          name: "Route",
          route: "5B > 236A",
          screenPosition: "midscreen",
          damage: "100",
          pips: 0,
          flow: 0,
          difficulty: null,
          hitconfirm: "unknown",
          counterhit: false,
          youtubeUrl: "",
        },
      ],
    )[0];
    const link = { recordingId: "route.mp4", name: "route.mp4" };
    const recording = {
      id: "route.mp4",
      name: "route.mp4",
      mediaKind: "local",
      youtubeUrl: null,
    } as RecordedVideo;
    expect(comboMediaGap(local, undefined, null, true)).toBe("No video");
    expect(comboMediaGap(local, link, null, false)).toBe("No YouTube video");
    expect(comboMediaGap(local, link, null, true)).toBe("No video");
    expect(comboMediaGap(local, link, recording, true)).toBe("No YouTube video");
    expect(
      comboMediaGap(
        local,
        link,
        { ...recording, youtubeUrl: "https://youtu.be/M7lc1UVf-VE" },
        true,
      ),
    ).toBeNull();
    expect(
      comboMediaGap(
        { ...local, local: { ...local.local!, youtubeUrl: "https://youtu.be/M7lc1UVf-VE" } },
        undefined,
        null,
        true,
      ),
    ).toBeNull();
    const localWithYouTube = {
      ...local,
      local: { ...local.local!, youtubeUrl: "https://youtu.be/M7lc1UVf-VE" },
    };
    expect(comboYouTubeVideo(localWithYouTube, "https://youtu.be/aaaaaaaaaaa")).toMatchObject({
      videoId: "M7lc1UVf-VE",
      source: "Local combo",
    });
    expect(comboYouTubeVideo(local, "https://youtu.be/M7lc1UVf-VE")).toMatchObject({
      videoId: "M7lc1UVf-VE",
      source: "Linked recording",
    });
    expect(comboMediaGap(local, link, recording, true, "https://youtu.be/M7lc1UVf-VE")).toBeNull();
    expect(
      comboYouTubeVideo({ ...local, local: { ...local.local!, youtubeUrl: "broken" } }),
    ).toMatchObject({
      videoId: null,
      source: "Local combo",
    });
  });

  it("counts an upstream candidate MP4 and its eventual YouTube link", () => {
    const candidate = {
      id: "queue-1",
      combo: {
        id: "route",
        characterId: "aang",
        supportId: "katara",
        route: "5B > 236A",
        moveIds: [],
        screenPosition: "midscreen",
        damage: "100",
        notes: [],
        resourceCosts: { pips: 0, flow: 0 },
        mechanics: [],
      },
      fileName: "route.mp4",
      fileSize: 100,
      status: "pending" as const,
      rejectionReason: "",
      youtubeUrl: "",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    expect(comboMediaGap(candidateItem(candidate), undefined, null, true)).toBe("No YouTube video");
    expect(
      comboMediaGap(
        candidateItem({
          ...candidate,
          status: "uploaded",
          youtubeUrl: "https://youtu.be/M7lc1UVf-VE",
        }),
        undefined,
        null,
        true,
      ),
    ).toBeNull();
  });
});
