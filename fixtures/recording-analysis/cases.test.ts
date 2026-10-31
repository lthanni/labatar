import { describe, expect, it } from "vite-plus/test";
import fixtureManifest from "./cases.json";
import { applyManualInputStateOverrides } from "../../src/recording-analysis-state";
import {
  classifyMoveInput,
  isFlowCancellableByDefault,
  moveNotationsMatch,
  parseMoveNotation,
  stanceFollowupMatches,
} from "../../src/move-notation";
import {
  buildRecordingDisplayRows,
  collapseRecordingDisplayRows,
  countRecordingClips,
  descendantClipRanges,
  pageRecordingDisplayRows,
  recordingInheritedTags,
  recordingLibraryTab,
  recordingPageForId,
} from "../../src/recording-hierarchy";
import {
  defaultInputDisplayGeometry,
  detectInputDisplay,
  inputDisplayObservationsMatch,
  readFramebarCounter,
  resolveNewestInput,
  resolveRecentInput,
  type InputDisplayObservation,
} from "../../src/input-display";
import { inputDisplaySegmentLayoutFromConfig } from "../../src/input-display-config";
import { defaultDetectorConfig } from "../../src/detector-config";
import { framebarColorMap, findClosestFramebarColor } from "../../src/framebar-color-map";
import {
  calculateOnBlock,
  calculateOnHit,
  airborneAttackTimeline,
  groupFramebarStates,
  isSaturatedSingleStateFramebar,
  scanFramebar,
  countPostHitpauseActiveFrames,
  resolveFramebarSampleSpacing,
  splitFramebarHitWindows,
  splitAaFollowupFramebarTimeline,
  summarizeFramePhases,
  summarizeMoveDurationFrames,
  summarizeMoveFramebarTimeline,
} from "../../src/framebar-detector";
import {
  findInputForFramebarStart,
  findInputForStartup,
} from "../../src/recording-input-association";
import { detectVisibleHitboxesFromPixels } from "../../src/hitbox-detector";
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
  it("tolerates two pixels of input marker jitter without hiding a changed button or direction", () => {
    const observation = (joystickX: number, buttonX?: number): InputDisplayObservation => ({
      width: 200,
      height: 100,
      rows: [
        {
          top: 0,
          bottom: 10,
          markers: [
            { color: "red", x: joystickX, y: 5, area: 20, width: 5, height: 5, fillRatio: 0.8 },
            ...(buttonX === undefined
              ? []
              : [
                  {
                    color: "yellow" as const,
                    x: buttonX,
                    y: 5,
                    area: 20,
                    width: 5,
                    height: 5,
                    fillRatio: 0.8,
                  },
                ]),
          ],
        },
      ],
    });

    expect(inputDisplayObservationsMatch(observation(99, 155), observation(99, 154))).toBe(true);
    expect(inputDisplayObservationsMatch(observation(99, 155), observation(99, 153))).toBe(true);
    expect(inputDisplayObservationsMatch(observation(99, 155), observation(99, 152))).toBe(false);
    expect(inputDisplayObservationsMatch(observation(99, 155), observation(99))).toBe(false);
    expect(inputDisplayObservationsMatch(observation(99, 155), observation(96, 155))).toBe(false);
  });

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
    for (const notation of ["236C", "2C", "2AA", "5AA", "j.2C", "j.5F", "j.B"]) {
      expect(parseMoveNotation(notation), notation).toMatchObject({ ok: true });
    }
    expect(parseMoveNotation("5AA")).toMatchObject({ button: "AA", notation: "5AA" });
    expect(parseMoveNotation("5[AA]").ok).toBe(false);
    expect(parseMoveNotation("5S").ok).toBe(false);
  });

  it("only matches bare followups within a stance sequence", () => {
    expect(parseMoveNotation("A").ok).toBe(false);
    expect(parseMoveNotation("A", { allowDirectionless: true })).toMatchObject({
      ok: true,
      notation: "A",
      isDirectionless: true,
    });
    expect(moveNotationsMatch("A", "A")).toBe(true);
    expect(moveNotationsMatch("A", "6A")).toBe(false);
    expect(moveNotationsMatch("A", "236A")).toBe(false);
    expect(stanceFollowupMatches("A", "6A")).toBe(true);
    expect(stanceFollowupMatches("A", "236A")).toBe(false);
  });

  it("keeps bracketed charged notation distinct from the standard input", () => {
    expect(parseMoveNotation("5[C]")).toMatchObject({
      ok: true,
      notation: "5[C]",
      button: "C",
      isCharged: true,
    });
    expect(moveNotationsMatch("5[C]", "5C")).toBe(false);
  });

  it("classifies directional A/B/C inputs as normals or command normals", () => {
    expect(classifyMoveInput("5A")).toBe("normal");
    expect(classifyMoveInput("2C")).toBe("normal");
    expect(classifyMoveInput("j.5B")).toBe("normal");
    expect(classifyMoveInput("j.B")).toBe("normal");
    expect(classifyMoveInput("6A")).toBe("command-normal");
    expect(classifyMoveInput("j.2C")).toBe("command-normal");
    expect(classifyMoveInput("236A")).toBe("other");
    expect(classifyMoveInput("j.236A")).toBe("other");
    expect(classifyMoveInput("j.214B")).toBe("other");
    expect(isFlowCancellableByDefault("j.236A")).toBe(false);
    expect(isFlowCancellableByDefault("6A")).toBe(true);
    expect(isFlowCancellableByDefault("j.2C")).toBe(true);
    expect(isFlowCancellableByDefault("5A")).toBe(false);
    expect(isFlowCancellableByDefault("236A")).toBe(false);
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

  it("anchors a new button row to startup before an earlier direction-only input", () => {
    const direction = {
      time: 85 / 60,
      input: { notation: "2", direction: "2", buttons: [], confidence: 0.75 },
    };
    const button = { notation: "2B", direction: "2", buttons: ["B"], confidence: 0.95 };
    const startup = 88 / 60;
    const params = {
      inputs: [direction],
      framebarStartTime: startup,
      frameRate: 60,
      newestInput: button,
      newestButtonFirstSeenTime: 86 / 60,
    };

    expect(
      findInputForStartup({ ...params, currentTime: startup, newestButtonFrameCount: 3 })?.input
        .notation,
    ).toBe("2B");
    expect(
      findInputForStartup({ ...params, currentTime: startup, newestButtonFrameCount: 1 }),
    ).toBeNull();
    expect(
      findInputForStartup({
        ...params,
        currentTime: 90 / 60,
        newestButtonFrameCount: 0,
        newestInput: null,
      })?.input.notation,
    ).toBe("2");
  });

  it("uses the observed framebar palette and one sample per displayed cell", () => {
    expect(findClosestFramebarColor(60, 120, 77, framebarColorMap)?.name).toBe("startup");
    expect(findClosestFramebarColor(148, 0, 4, framebarColorMap)?.name).toBe("active");
    expect(findClosestFramebarColor(33, 78, 104, framebarColorMap)?.name).toBe("recovery");
    expect(findClosestFramebarColor(68, 46, 121, framebarColorMap)?.name).toBe("blockstun");
    expect(findClosestFramebarColor(76, 76, 73, framebarColorMap)?.name).toBe("hitpause");
    expect(resolveFramebarSampleSpacing(1009, 4, 63, 8)).toBeCloseTo(15.95, 1);
    expect(resolveFramebarSampleSpacing(1009, 4, 63, 16)).toBe(16);
  });

  it("samples the centers of scaled framebar cells, away from dark borders", () => {
    const states = [
      ...Array(26).fill("recovery-bright"),
      ...Array(12).fill("startup-bright"),
      ...Array(15).fill("active-bright"),
      ...Array(10).fill("recovery-bright"),
    ];
    const colors: Record<string, [number, number, number]> = {
      "recovery-bright": [65, 132, 191],
      "startup-bright": [94, 186, 107],
      "active-bright": [210, 0, 18],
    };
    const scan = scanFramebar({
      config: {
        ...defaultDetectorConfig,
        sampleStartOffset: 3.5,
        sampleSpacing: 8,
        sampleCount: 63,
      },
      sampleWidth: 1009,
      sampleHeight: 65,
      readPixel: (x) => {
        const cell = Math.min(62, Math.floor(x / 16));
        const [red, green, blue] = x % 16 < 4 ? [195, 196, 207] : colors[states[cell]];
        return { red, green, blue };
      },
      getMappedColor: (red, green, blue) =>
        findClosestFramebarColor(red, green, blue, framebarColorMap),
    });
    expect(scan.sampleStartOffset).toBeCloseTo(8, 1);
    expect(summarizeFramePhases(scan.groups)).toEqual({
      startup: 12,
      active: 15,
      recovery: 36,
      other: 0,
    });
  });

  it("excludes jump frames from an airborne attack's measured phases", () => {
    const sample = (timestamp: number, jump: number, recovery: number) => {
      const groups = [
        { state: "airborne", start: 0, length: jump },
        { state: "startup-bright", start: jump, length: 12 },
        { state: "active-bright", start: jump + 12, length: 15 },
        { state: "recovery-bright", start: jump + 27, length: recovery },
      ];
      return {
        timestamp,
        player1: "",
        player1Groups: groups,
        player2: "",
        player1Phases: summarizeFramePhases(groups),
      };
    };
    const jumpOnly = sample(0.45, 26, 0);
    jumpOnly.player1Groups = [{ state: "airborne", start: 0, length: 26 }];
    jumpOnly.player1Phases = summarizeFramePhases(jumpOnly.player1Groups);
    const attack = airborneAttackTimeline([jumpOnly, sample(1.6, 26, 10), sample(1.8, 9, 27)]);
    expect(attack[0].timestamp).toBe(1.6);
    expect(summarizeMoveFramebarTimeline(attack)?.player1Phases).toMatchObject({
      startup: 12,
      active: 15,
      recovery: 27,
    });
  });

  it("separates j.2C's two trailing airborne cells from its 16 recovery cells", () => {
    // RGB values checked against the 60 fps j.2C whiff take's displayed cells.
    const cells = [
      ...Array(15).fill([120, 162, 223]),
      ...Array(11).fill([88, 200, 120]),
      ...Array(6).fill([240, 2, 9]),
      ...Array(16).fill([57, 127, 200]),
      ...Array(2).fill([122, 161, 223]),
      ...Array(13).fill([29, 29, 33]),
    ] as [number, number, number][];
    const scan = scanFramebar({
      config: {
        ...defaultDetectorConfig,
        sampleStartOffset: 3.5,
        sampleSpacing: 8,
        sampleCount: 63,
      },
      sampleWidth: 1009,
      sampleHeight: 65,
      readPixel: (x) => {
        const [red, green, blue] = cells[Math.min(62, Math.floor(x / 16))];
        return { red, green, blue };
      },
      getMappedColor: (red, green, blue) =>
        findClosestFramebarColor(red, green, blue, framebarColorMap),
    });
    expect(scan.groups.map(({ state, length }) => [state, length])).toEqual([
      ["airborne", 15],
      ["startup-bright", 11],
      ["active-bright", 6],
      ["recovery-bright", 16],
      ["airborne", 2],
      ["idle", 13],
    ]);
    const attack = airborneAttackTimeline([
      {
        timestamp: 1.3,
        player1: "",
        player1Groups: scan.groups,
        player2: "",
        player1Phases: summarizeFramePhases(scan.groups),
      },
    ]);
    expect(summarizeMoveFramebarTimeline(attack)?.player1Phases).toMatchObject({
      startup: 11,
      active: 6,
      recovery: 16,
    });
    expect(summarizeMoveDurationFrames(attack)?.total).toBe(33);
  });

  it("keeps j.236EX startup at its first contiguous 22 cells after the meter rolls", () => {
    const snapshot = (
      timestamp: number,
      jump: number,
      recovery: number,
      trailingStartup: number,
    ) => {
      const groups = [
        { state: "airborne", start: 0, length: jump },
        { state: "startup-bright", start: jump, length: 12 },
        { state: "startup", start: jump + 12, length: 10 },
        { state: "active-bright", start: jump + 22, length: 8 },
        { state: "recovery-bright", start: jump + 30, length: recovery },
        ...(trailingStartup
          ? [{ state: "startup-bright", start: jump + 30 + recovery, length: trailingStartup }]
          : []),
      ];
      return {
        timestamp,
        player1: "",
        player1Groups: groups,
        player2: "",
        player1Phases: summarizeFramePhases(groups),
      };
    };
    const attack = airborneAttackTimeline([snapshot(1.48, 22, 10, 0), snapshot(1.65, 14, 11, 8)]);
    expect(summarizeMoveFramebarTimeline(attack)?.player1Phases).toMatchObject({
      startup: 22,
      active: 8,
      recovery: 11,
    });
    expect(attack[1].player1Phases.other).toBe(8);
  });

  it("retains early phases when 214EX recovery rolls the meter left", () => {
    const beforeRoll = {
      timestamp: 1.55,
      player1: "",
      player1Groups: [
        { state: "startup-bright", start: 0, length: 12 },
        { state: "active-bright", start: 12, length: 3 },
        { state: "multihit-gap", start: 15, length: 13 },
        { state: "active-bright", start: 28, length: 5 },
        { state: "multihit-gap", start: 33, length: 12 },
        { state: "active-bright", start: 45, length: 1 },
        { state: "multihit-gap", start: 46, length: 2 },
        { state: "active-bright", start: 48, length: 4 },
        { state: "recovery-bright", start: 52, length: 1 },
      ],
      player2: "",
      player1Phases: { startup: 12, active: 13, recovery: 1, other: 37 },
    };
    const afterRoll = {
      ...beforeRoll,
      timestamp: 2.07,
      player1Groups: [
        { state: "multihit-gap", start: 0, length: 7 },
        { state: "active-bright", start: 7, length: 10 },
        { state: "recovery-bright", start: 17, length: 32 },
      ],
      player1Phases: { startup: 0, active: 10, recovery: 32, other: 21 },
    };
    const summary = summarizeMoveFramebarTimeline([beforeRoll, afterRoll]);
    expect(summary?.player1Phases).toMatchObject({ startup: 12, active: 13, recovery: 32 });
    expect(summary?.player1Groups).toBe(beforeRoll.player1Groups);
    expect(splitFramebarHitWindows(summary?.player1Groups ?? [])).toHaveLength(4);
  });

  it("extends a uniform framebar state after its 63 visible frames", () => {
    const snapshot = (
      timestamp: number,
      groups: Array<{ state: string; start: number; length: number }>,
    ) => ({
      timestamp,
      player1: "",
      player1Groups: groups,
      player2: "",
      player1Phases: summarizeFramePhases(groups),
    });
    const recovery = Array.from({ length: 32 }, (_, index) =>
      snapshot(62 + index, [{ state: "recovery", start: 0, length: 63 }]),
    );
    const samples = [
      snapshot(61, [
        { state: "recovery", start: 0, length: 62 },
        { state: "active", start: 62, length: 1 },
      ]),
      ...recovery,
      snapshot(94, [
        { state: "recovery", start: 0, length: 62 },
        { state: "idle", start: 62, length: 1 },
      ]),
    ];

    expect(summarizeMoveFramebarTimeline(samples)?.player1Phases.recovery).toBe(94);
    expect(summarizeMoveDurationFrames(samples)?.total).toBe(94);
    expect(summarizeMoveDurationFrames(samples.slice(0, -1))?.total).toBe(63);
    expect(isSaturatedSingleStateFramebar(recovery[0].player1Groups, 63)).toBe(true);
    expect(isSaturatedSingleStateFramebar([{ state: "idle", start: 0, length: 63 }], 63)).toBe(
      false,
    );
  });

  it("reads a changing numeric counter from the lower part of the framebar crop", () => {
    const digits = [
      ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
      ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    ];
    const width = 100;
    const height = 30;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) data[pixel * 4 + 3] = 255;
    digits.forEach((digit, digitIndex) => {
      digit.forEach((row, y) => {
        for (let x = 0; x < row.length; x += 1) {
          const cell = row[x];
          if (cell !== "1") continue;
          for (let dy = 0; dy < 2; dy += 1) {
            for (let dx = 0; dx < 2; dx += 1) {
              const index = ((8 + y * 2 + dy) * width + 35 + digitIndex * 14 + x * 2 + dx) * 4;
              data[index] = 255;
              data[index + 1] = 255;
              data[index + 2] = 255;
            }
          }
        }
      });
    });

    expect(readFramebarCounter({ data, width, height })).toMatchObject({ value: 21 });
  });

  it("includes flow stance and orange gaps in total move frames across a meter roll", () => {
    const beforeRoll = [
      { state: "idle", start: 0, length: 5 },
      { state: "startup", start: 5, length: 4 },
      { state: "active", start: 9, length: 2 },
      { state: "multihit-gap", start: 11, length: 3 },
      { state: "active", start: 14, length: 2 },
      { state: "flow-stance", start: 16, length: 6 },
      { state: "recovery", start: 22, length: 1 },
    ];
    const afterRoll = [
      { state: "active", start: 0, length: 2 },
      { state: "flow-stance", start: 2, length: 6 },
      { state: "recovery", start: 8, length: 8 },
      { state: "idle", start: 16, length: 10 },
    ];
    const samples = [beforeRoll, afterRoll].map((groups, timestamp) => ({
      timestamp,
      player1: "",
      player1Groups: groups,
      player2: "",
      player1Phases: summarizeFramePhases(groups),
    }));
    expect(summarizeMoveDurationFrames(samples)).toEqual({ flowStance: 6, total: 25 });
  });

  it("does not add recovery waiting cells twice to the total", () => {
    const groups = [
      { state: "startup", start: 0, length: 2 },
      { state: "active", start: 2, length: 2 },
      { state: "recovery", start: 4, length: 2 },
      { state: "multihit-gap", start: 6, length: 3 },
      { state: "recovery", start: 9, length: 2 },
    ];
    expect(
      summarizeMoveDurationFrames([
        {
          timestamp: 0,
          player1: "",
          player1Groups: groups,
          player2: "",
          player1Phases: summarizeFramePhases(groups),
        },
      ]),
    ).toEqual({ flowStance: 0, total: 11 });
  });

  it("splits 5A into 5AA at the first active window and counts cancel frames as startup", () => {
    const states = [
      ...Array(8).fill("startup-bright"),
      ...Array(2).fill("active-bright"),
      ...Array(2).fill("recovery-bright"),
      ...Array(6).fill("startup-bright"),
      ...Array(2).fill("active-bright"),
      ...Array(24).fill("recovery-bright"),
    ];
    const samples = states.map((_, index) => {
      const player1Groups = groupFramebarStates([
        ...states.slice(0, index + 1),
        ...Array(63 - index - 1).fill("idle"),
      ]);
      return {
        timestamp: index / 60,
        player1: "",
        player1Groups,
        player2: "",
        player1Phases: summarizeFramePhases(player1Groups),
      };
    });
    const split = splitAaFollowupFramebarTimeline(samples);
    expect(split?.followupStartTime).toBe(10 / 60);
    expect(summarizeMoveFramebarTimeline(split?.base ?? [])?.player1Phases).toMatchObject({
      startup: 8,
      active: 2,
      recovery: 0,
    });
    expect(summarizeMoveFramebarTimeline(split?.followup ?? [])?.player1Phases).toMatchObject({
      startup: 8,
      active: 2,
      recovery: 24,
    });
    expect(summarizeMoveDurationFrames(split?.followup ?? [])?.total).toBe(34);
  });

  it("does not split orange-separated multihits as an AA cancel", () => {
    const player1Groups = groupFramebarStates([
      ...Array(8).fill("startup"),
      ...Array(2).fill("active"),
      ...Array(3).fill("multihit-gap"),
      ...Array(2).fill("active"),
      ...Array(24).fill("recovery"),
    ]);
    expect(
      splitAaFollowupFramebarTimeline([
        {
          timestamp: 0,
          player1: "",
          player1Groups,
          player2: "",
          player1Phases: summarizeFramePhases(player1Groups),
        },
      ]),
    ).toBeNull();
  });

  it("separates 5B's two active windows across its seven orange cells", () => {
    const groups = [
      { state: "startup-bright", start: 0, length: 11 },
      { state: "active-bright", start: 11, length: 6 },
      { state: "multihit-gap", start: 17, length: 7 },
      { state: "active-bright", start: 24, length: 6 },
      { state: "recovery-bright", start: 30, length: 21 },
    ];
    expect(splitFramebarHitWindows(groups)).toEqual([
      { activeStart: 11, activeFrames: 6, gapBeforeFrames: 0 },
      { activeStart: 24, activeFrames: 6, gapBeforeFrames: 7 },
    ]);
    expect(summarizeFramePhases(groups)).toEqual({
      startup: 11,
      active: 12,
      recovery: 21,
      other: 7,
    });
    expect(
      splitFramebarHitWindows([
        { state: "active", start: 0, length: 3 },
        { state: "Unmapped", start: 3, length: 2 },
        { state: "active", start: 5, length: 3 },
      ]),
    ).toEqual([{ activeStart: 0, activeFrames: 6, gapBeforeFrames: 0 }]);
  });

  it("counts j.236B's three orange waiting cells between recovery groups as recovery", () => {
    const groups = [
      { state: "airborne", start: 0, length: 19 }, // Jump lead-in.
      { state: "startup-bright", start: 19, length: 27 },
      { state: "active-bright", start: 46, length: 7 },
      { state: "recovery-bright", start: 53, length: 10 },
      { state: "multihit-gap", start: 63, length: 3 },
      { state: "recovery-bright", start: 66, length: 12 },
    ];
    const attack = airborneAttackTimeline([
      {
        timestamp: 1.8,
        player1: "",
        player1Groups: groups,
        player2: "",
        player1Phases: summarizeFramePhases(groups),
      },
    ]);
    expect(summarizeMoveFramebarTimeline(attack)?.player1Phases).toMatchObject({
      startup: 27,
      active: 7,
      recovery: 25,
    });
    expect(splitFramebarHitWindows(attack[0].player1Groups)).toHaveLength(1);

    const secondHit = [...groups, { state: "active-bright", start: 78, length: 4 }];
    expect(summarizeFramePhases(secondHit).recovery).toBe(22);
    expect(summarizeFramePhases(secondHit).other).toBe(22);
  });

  it("calculates on-block advantage from recovery and purple blockstun", () => {
    expect(calculateOnBlock({ recovery: 20 }, { blockstun: 12 })).toBe(-8);
    expect(calculateOnBlock({ recovery: 10 }, { blockstun: 12 })).toBe(2);
    expect(calculateOnBlock({ recovery: 10 }, { blockstun: 12 }, 3)).toBe(-1);
    expect(calculateOnBlock({ recovery: 0 }, { blockstun: 12 })).toBeNull();
  });

  it("calculates on-hit advantage from recovery and hitstun", () => {
    expect(calculateOnHit({ recovery: 20 }, { hitstun: 28 })).toBe(8);
    expect(calculateOnHit({ recovery: 10 }, { hitstun: 12 }, 3)).toBe(-1);
    expect(calculateOnHit({ recovery: 0 }, { hitstun: 12 })).toBeNull();
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

  it("detects visible colored hitbox rectangles from a decoded frame", () => {
    const width = 100;
    const height = 80;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 80;
      pixels[index + 1] = 80;
      pixels[index + 2] = 80;
      pixels[index + 3] = 255;
    }
    for (let y = 20; y < 50; y += 1) {
      for (let x = 30; x < 75; x += 1) {
        const index = (y * width + x) * 4;
        pixels[index] = 220;
        pixels[index + 1] = 100;
        pixels[index + 2] = 100;
      }
    }

    const boxes = detectVisibleHitboxesFromPixels(pixels, width, height);

    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.kind).toBe("overlay-red");
    expect(boxes[0]?.x).toBeCloseTo(30, 0);
    expect(boxes[0]?.y).toBeCloseTo(25, 0);
    expect(boxes[0]?.width).toBeCloseTo(44, 0);
    expect(boxes[0]?.height).toBeCloseTo(37.5, 1);
  });

  it("detects translucent outlined hitbox rectangles", () => {
    const width = 160;
    const height = 120;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 55;
      pixels[index + 1] = 75;
      pixels[index + 2] = 85;
      pixels[index + 3] = 255;
    }
    for (let y = 24; y < 96; y += 1) {
      for (let x = 32; x < 128; x += 1) {
        if (y > 26 && y < 93 && x > 34 && x < 125) continue;
        const index = (y * width + x) * 4;
        pixels[index] = 90;
        pixels[index + 1] = 220;
        pixels[index + 2] = 145;
      }
    }

    const boxes = detectVisibleHitboxesFromPixels(pixels, width, height);

    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.kind).toBe("overlay-green");
    expect(boxes[0]?.x).toBeCloseTo(20, 0);
    expect(boxes[0]?.y).toBeCloseTo(20, 0);
    expect(boxes[0]?.width).toBeCloseTo(60, 0);
    expect(boxes[0]?.height).toBeCloseTo(60, 0);
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
    const otherRoot = fixtureRecording("other-root");
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

    const rows = buildRecordingDisplayRows([child, parent, root]);
    expect(rows.map(({ recording, depth }) => [recording.id, depth])).toEqual([
      [root.id, 0],
      [parent.id, 1],
      [child.id, 2],
    ]);
    expect(
      collapseRecordingDisplayRows(rows, new Set([parent.id])).map(({ recording }) => recording.id),
    ).toEqual([root.id, parent.id]);
    expect(
      collapseRecordingDisplayRows(rows, new Set([root.id])).map(({ recording }) => recording.id),
    ).toEqual([root.id]);
    expect(
      collapseRecordingDisplayRows(
        buildRecordingDisplayRows([child, parent, root, otherRoot]),
        new Set([root.id]),
      ).map(({ recording }) => recording.id),
    ).toEqual([root.id, otherRoot.id]);
    expect(countRecordingClips(rows)).toEqual(
      new Map([
        [root.id, 2],
        [parent.id, 1],
      ]),
    );
    const pagedRows = buildRecordingDisplayRows([child, parent, root, otherRoot]);
    expect(pageRecordingDisplayRows(pagedRows, 1, 1).map(({ recording }) => recording.id)).toEqual([
      root.id,
      parent.id,
      child.id,
    ]);
    expect(pageRecordingDisplayRows(pagedRows, 2, 1).map(({ recording }) => recording.id)).toEqual([
      otherRoot.id,
    ]);
    expect(recordingPageForId(pagedRows, child.id, 1)).toBe(1);
    expect(recordingPageForId(pagedRows, otherRoot.id, 1)).toBe(2);
    expect(descendantClipRanges([root, parent, child], parent.id, 25)).toEqual([[3.69, 4.91]]);
  });

  it("keeps untagged clips with their match recording", () => {
    const match = fixtureRecording("match");
    match.tags.match = ["ranked"];
    const clip = fixtureRecording("clip", {
      sourceRecordingId: match.id,
      sourceRecordingName: match.name,
      startTime: 0,
      endTime: 20,
      createdAt: null,
    });
    const unrelated = fixtureRecording("unrelated");
    const byId = new Map([match, clip, unrelated].map((recording) => [recording.id, recording]));

    expect(recordingLibraryTab(match, byId)).toBe("matches");
    expect(recordingLibraryTab(clip, byId)).toBe("matches");
    expect(recordingInheritedTags(clip, byId).match).toEqual(["ranked"]);
    expect(recordingLibraryTab(unrelated, byId)).toBe("other");

    const otherClip = fixtureRecording("other-clip", {
      sourceRecordingId: unrelated.id,
      sourceRecordingName: unrelated.name,
      startTime: 0,
      endTime: 10,
      createdAt: null,
    });
    otherClip.tags.match = ["casual"];
    byId.set(otherClip.id, otherClip);
    expect(recordingLibraryTab(otherClip, byId)).toBe("other");
  });
});
