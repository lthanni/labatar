import { describe, expect, it } from "vite-plus/test";
import fixtureManifest from "./cases.json";
import { applyManualInputStateOverrides } from "../../src/recording-analysis-state";
import { parseMoveNotation } from "../../src/move-notation";
import { buildRecordingDisplayRows, descendantClipRanges } from "../../src/recording-hierarchy";
import {
  defaultInputDisplayGeometry,
  detectInputDisplay,
  resolveNewestInput,
  resolveRecentInput,
  type InputDisplayObservation,
} from "../../src/input-display";
import { inputDisplaySegmentLayoutFromConfig } from "../../src/input-display-config";
import { defaultDetectorConfig } from "../../src/detector-config";
import { framebarColorMap, findClosestFramebarColor } from "../../src/framebar-color-map";
import {
  calculateOnBlock,
  countPostHitpauseActiveFrames,
  resolveFramebarSampleSpacing,
} from "../../src/framebar-detector";
import { findInputForFramebarStart } from "../../src/recording-input-association";
import type { RecordingAnalysis } from "../../src/recording-analysis-types";
import type { RecordedVideo } from "../../src/recording-types";

function fixtureRecording(id: string, clip: RecordedVideo["clip"] = null): RecordedVideo {
  return {
    id,
    name: `${id}.mp4`,
    url: `labatar-media://recording/${id}`,
    size: 1,
    modifiedAt: 0,
    metadata: null,
    tags: { match: [], lab: [], combo: false, pressure: false },
    analysis: null,
    games: [],
    replays: [],
    replayPath: null,
    replayFileName: null,
    clip,
  };
}

describe("recording-analysis fixture contract", () => {
  it("keeps the verified pressure case explicit", () => {
    const pressureCase = fixtureManifest.cases.find(
      (fixture) => fixture.id === "aang-gyatso-double-overhead-double-cross",
    );

    expect(pressureCase).toBeDefined();
    expect(pressureCase?.kind).toBe("pressure");
    expect(pressureCase?.performer).toEqual({
      side: "player1",
      character: "Aang",
      support: "Gyatso",
    });
    expect(pressureCase?.expected.route).toEqual(["236C", "scooter-hop C", "j.2C", "j.5F", "j.B"]);
    expect(pressureCase?.expected.damage).toBe(0);
    expect(pressureCase?.expected.frameMeter?.resetsWithinSequence).toBe(true);
  });

  it("keeps the new blocked single-move captures explicit without claiming frame data", () => {
    const singleMoveCases = fixtureManifest.cases.filter(
      (fixture) => fixture.kind === "single-move",
    );

    expect(singleMoveCases.map((fixture) => fixture.id)).toEqual([
      "aang-gyatso-5a-block",
      "aang-gyatso-2a-block",
      "aang-gyatso-2b-block",
      "aang-gyatso-5b-block",
    ]);
    expect(singleMoveCases.map((fixture) => fixture.expected.route[0])).toEqual([
      "5A",
      "2A",
      "2B",
      "5B",
    ]);
    singleMoveCases.forEach((fixture) => {
      const expectedVideo = {
        "aang-gyatso-5a-block": "H.264 2560x1440 60fps",
        "aang-gyatso-2a-block": "H.264 2560x1440 60fps",
        "aang-gyatso-2b-block": "H.264 2560x1440 30fps",
        "aang-gyatso-5b-block": "H.264 2560x1440 30fps",
      }[fixture.id as string];
      expect(fixture.status).toBe("capture-only");
      expect(fixture.performer).toMatchObject({
        side: "player1",
        character: "Aang",
        support: "Gyatso",
      });
      expect(fixture.opponent).toMatchObject({
        side: "player2",
        character: "Korra",
        defense: "blocking",
      });
      expect(fixture.expected.damage).toBe(0);
      expect(fixture.expected.frameData).toBe("not-yet-verified");
      expect(fixture.capture?.video).toBe(expectedVideo);
    });
  });

  it("accepts the canonical move notation used by the fixture", () => {
    for (const notation of ["236C", "2C", "j.2C", "j.5F", "j.B"]) {
      expect(parseMoveNotation(notation), notation).toMatchObject({ ok: true });
    }
    expect(parseMoveNotation("5S").ok).toBe(false);
  });

  it("does not resolve an unassigned background blob as the F button", () => {
    const backgroundMarker = {
      color: "cyan" as const,
      x: 217,
      y: 38,
      area: 30,
      width: 6,
      height: 6,
      fillRatio: 0.8,
    };
    const joystickMarker = {
      color: "red" as const,
      x: 102,
      y: 28,
      area: 30,
      width: 6,
      height: 6,
      fillRatio: 0.8,
    };
    const observation: InputDisplayObservation = {
      width: 269,
      height: 720,
      rows: [
        {
          top: 0,
          bottom: 55,
          markers: [joystickMarker, backgroundMarker],
          buttonChecks: ["A", "B", "C", "F"].map((slot) => ({
            slot: slot as "A" | "B" | "C" | "F",
            detected: false,
            confidence: 0,
          })),
        },
      ],
    };

    expect(resolveRecentInput(observation)).toMatchObject({
      notation: "5",
      direction: "5",
      buttons: [],
    });
  });

  it("keeps the expected per-segment input anatomy explicit", () => {
    const layout = inputDisplaySegmentLayoutFromConfig(defaultDetectorConfig);

    expect(layout.segment).toEqual({
      top: 2,
      height: 7.384615384615385,
    });
    expect(layout.joystick).toMatchObject({
      centerX: 38,
      centerY: 50,
      regionEndX: 44,
    });
    expect(layout.buttons.map(({ slot, color }) => [slot, color])).toEqual([
      ["A", "blue"],
      ["B", "yellow"],
      ["C", "red"],
      ["F", "cyan"],
    ]);
    expect(layout.number).toMatchObject({
      startX: 68,
      endX: 98,
      top: 2,
      height: 96,
      digitXs: [70, 79, 88],
    });
  });

  it("requires a joystick structure before accepting a button marker", () => {
    const width = 100;
    const height = 100;
    const geometry = {
      ...defaultInputDisplayGeometry,
      segmentCount: 1,
      segmentTop: 0,
      segmentHeight: 100,
      segmentLayout: {
        ...defaultInputDisplayGeometry.segmentLayout,
        segment: { top: 0, height: 100 },
      },
    };
    const createImage = (withJoystick: boolean, withBand: boolean) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let index = 0; index < data.length; index += 4) {
        data[index] = 120;
        data[index + 1] = 120;
        data[index + 2] = 120;
        data[index + 3] = 255;
      }
      const setPixel = (x: number, y: number, red: number, green: number, blue: number) => {
        const index = (y * width + x) * 4;
        data[index] = red;
        data[index + 1] = green;
        data[index + 2] = blue;
        data[index + 3] = 255;
      };
      if (withBand) {
        for (let y = 20; y < 80; y += 1) {
          for (let x = 0; x < 80; x += 1) setPixel(x, y, 20, 20, 20);
        }
      }
      if (withJoystick) {
        for (let y = 41; y <= 59; y += 1) {
          for (let x = 29; x <= 47; x += 1) {
            if (Math.hypot(x - 38, y - 50) <= 9 && Math.hypot(x - 38, y - 50) >= 4) {
              setPixel(x, y, 230, 230, 230);
            }
          }
        }
        for (let y = 47; y <= 53; y += 1) {
          for (let x = 35; x <= 41; x += 1) setPixel(x, y, 230, 40, 40);
        }
      }
      for (let y = 27; y <= 33; y += 1) {
        for (let x = 40; x <= 46; x += 1) setPixel(x, y, 30, 100, 230);
      }
      return { data, width, height };
    };

    const populated = detectInputDisplay(createImage(true, true), geometry);
    expect(populated.rows[0]?.segmentCheck).toEqual({
      populated: true,
      reason: "joystick-and-marker",
    });
    expect(populated.rows[0]?.backgroundCheck?.detected).toBe(true);
    expect(resolveNewestInput(populated)?.notation).toBe("5A");

    const unpopulated = detectInputDisplay(createImage(false, true), geometry);
    expect(unpopulated.rows[0]?.segmentCheck).toEqual({
      populated: false,
      reason: "missing-joystick-circle",
    });
    expect(resolveNewestInput(unpopulated)).toBeNull();

    const missingBand = detectInputDisplay(createImage(true, false), geometry);
    expect(missingBand.rows[0]?.segmentCheck).toEqual({
      populated: false,
      reason: "missing-black-band",
    });
    expect(resolveNewestInput(missingBand)).toBeNull();
  });

  it("associates the newest input with the framebar transition instead of stale history", () => {
    const input = (time: number, notation: string) => ({
      time,
      input: {
        notation,
        direction: notation.startsWith("2") ? "2" : "5",
        buttons: [notation.endsWith("A") ? "A" : ""].filter(Boolean),
        confidence: 1,
      },
    });
    const stale = input(0.066, "5A");
    const current = input(0.85, "2A");

    expect(findInputForFramebarStart([stale, current], 0.833)?.input.notation).toBe("2A");
    expect(findInputForFramebarStart([stale], 0.833)).toBeNull();
  });

  it("uses the observed framebar palette and one sample per displayed cell", () => {
    expect(findClosestFramebarColor(60, 120, 77, framebarColorMap)?.name).toBe("startup");
    expect(findClosestFramebarColor(148, 0, 4, framebarColorMap)?.name).toBe("active");
    expect(findClosestFramebarColor(33, 78, 104, framebarColorMap)?.name).toBe("recovery");
    expect(findClosestFramebarColor(68, 46, 121, framebarColorMap)?.name).toBe("blockstun");
    expect(findClosestFramebarColor(76, 76, 73, framebarColorMap)?.name).toBe("hitpause");
    expect(resolveFramebarSampleSpacing(1009, 4, 63, 8)).toBeCloseTo(16.2, 1);
    expect(resolveFramebarSampleSpacing(1009, 4, 63, 16)).toBe(16);
  });

  it("calculates on-block advantage from recovery and purple blockstun", () => {
    expect(calculateOnBlock({ recovery: 20 }, { blockstun: 12 })).toBe(-8);
    expect(calculateOnBlock({ recovery: 10 }, { blockstun: 12 })).toBe(2);
    expect(calculateOnBlock({ recovery: 10 }, { blockstun: 12 }, 3)).toBe(-1);
    expect(calculateOnBlock({ recovery: 0 }, { blockstun: 12 })).toBeNull();
  });

  it("counts active-looking frames after hitpause as recovery for advantage", () => {
    expect(
      countPostHitpauseActiveFrames([
        { state: "startup", start: 0, length: 7 },
        { state: "active", start: 7, length: 1 },
        { state: "hitpause", start: 8, length: 3 },
        { state: "active", start: 11, length: 3 },
        { state: "recovery", start: 14, length: 10 },
      ]),
    ).toBe(3);
  });

  it("keeps hit events separate from hitbox tracks", () => {
    const hit = {
      id: "move-1-hit-1",
      index: 1,
      status: "blocked" as const,
      startTime: 0.1,
      endTime: 0.5,
      phases: { startup: 7, active: 4, recovery: 10, other: 3 },
      opponentPhases: { hitstun: 0, blockstun: 12, other: 0 },
      onBlock: -1,
      hitboxTrackIds: ["move-1-hitbox-1"],
    };
    const track = {
      id: "move-1-hitbox-1",
      hitId: hit.id,
      samples: [
        {
          frame: 0,
          time: 0.2,
          boxes: [
            { x: 10, y: 20, width: 30, height: 40 },
            { x: 50, y: 20, width: 10, height: 10 },
          ],
        },
      ],
    };

    expect(hit.hitboxTrackIds).toHaveLength(1);
    expect(track.samples[0]?.boxes).toHaveLength(2);
    expect(hit.id).toBe(track.hitId);
  });

  it("applies an airborne override only from the selected input onward", () => {
    const analysis: RecordingAnalysis = {
      schemaVersion: 1,
      processedAt: "fixture",
      duration: 1,
      sourceWidth: 2560,
      sourceHeight: 1440,
      sampledFrames: 60,
      trainingFrameRatio: 1,
      inputEvents: [
        {
          id: "input-1",
          time: 0.1,
          notation: "236C",
          direction: "6",
          buttons: ["C"],
          confidence: 1,
          occurrence: 1,
        },
        {
          id: "input-2",
          time: 0.2,
          notation: "2C",
          direction: "2",
          buttons: ["C"],
          confidence: 1,
          occurrence: 1,
        },
      ],
      moves: [
        {
          id: "move-1",
          notation: "236C",
          observedNotation: "236C",
          inputEventId: "input-1",
          confidence: 1,
          startTime: 0.1,
          endTime: 0.15,
          phases: { startup: 1, active: 1, recovery: 1, other: 0 },
          opponentPhases: { hitstun: 0, blockstun: 1, other: 0 },
        },
        {
          id: "move-2",
          notation: "2C",
          observedNotation: "2C",
          inputEventId: "input-2",
          confidence: 1,
          startTime: 0.2,
          endTime: 0.25,
          phases: { startup: 1, active: 1, recovery: 1, other: 0 },
          opponentPhases: { hitstun: 0, blockstun: 1, other: 0 },
        },
      ],
      warnings: [],
    };

    const updated = applyManualInputStateOverrides(analysis, [
      {
        inputEventId: "input-2",
        state: "airborne",
        notation: "2C",
        occurrence: 1,
        time: 0.2,
      },
    ]);

    expect(updated.moves.map((move) => move.notation)).toEqual(["236C", "j.2C"]);
  });

  it("renders nested clips and resolves their ranges relative to the selected video", () => {
    const root = fixtureRecording("root");
    const parent = fixtureRecording("parent", {
      sourceRecordingId: root.id,
      sourceRecordingName: root.name,
      startTime: 0,
      endTime: 25,
      createdAt: null,
    });
    const child = fixtureRecording("child", {
      sourceRecordingId: parent.id,
      sourceRecordingName: parent.name,
      startTime: 3.69,
      endTime: 4.91,
      createdAt: null,
    });

    const rows = buildRecordingDisplayRows([child, parent, root], true, true);
    expect(rows.map(({ recording, depth }) => [recording.id, depth])).toEqual([
      [root.id, 0],
      [parent.id, 1],
      [child.id, 2],
    ]);
    expect(descendantClipRanges([root, parent, child], parent.id, 25)).toEqual([[3.69, 4.91]]);
  });
});
