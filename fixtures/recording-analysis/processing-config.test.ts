import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import detectorKeys from "../../electron/detector-config-keys.json";
import { defaultDetectorConfig } from "../../src/detector-config";
import { findClosestFramebarColor } from "../../src/framebar-color-map";
import { scanFramebar, summarizeFramePhases } from "../../src/framebar-detector";
import {
  assertCompatibleProcessingConfiguration,
  effectiveDetectorConfig,
  migrateLegacyProcessingConfiguration,
  reloadProcessingConfiguration,
  updateProcessingConfiguration,
  upgradeProcessingConfigurationProfile,
} from "../../src/processing-config";
import type { ProcessingConfiguration } from "../../src/processing-config-types";
import { processRecording } from "../../src/recording-processor";

const { createProcessingConfigurationStore } = createRequire(import.meta.url)(
  "../../electron/processing-config.cjs",
);
let directory: string;
let legacy: Map<string, string>;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "labatar-config-test-"));
  legacy = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => legacy.get(key) ?? null,
    setItem: (key: string, value: string) => legacy.set(key, value),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

function store() {
  return createProcessingConfigurationStore(directory, detectorKeys);
}
function configuration(): ProcessingConfiguration {
  return migrateLegacyProcessingConfiguration();
}

describe("persistent processing calibration", () => {
  it("keeps the validation schema aligned with every detector field", () => {
    expect([...detectorKeys].sort()).toEqual(Object.keys(defaultDetectorConfig).sort());
  });

  it("migrates geometry, runtime colors, templates and trained thresholds together", () => {
    legacy.set(
      "avatar-overlay-config",
      JSON.stringify({ ...defaultDetectorConfig, baseSampleOffset: 1.5 }),
    );
    legacy.set(
      "avatar-overlay-runtime-color-map",
      JSON.stringify([{ name: "startup", red: 65, green: 135, blue: 85 }]),
    );
    legacy.set(
      "avatar-overlay-digit-templates",
      JSON.stringify([
        { id: "one", digit: "1", mask: Array(35).fill(1), capturedAt: "2026-10-03" },
      ]),
    );
    legacy.set(
      "avatar-overlay-training-meter-calibration",
      JSON.stringify({
        positive: [],
        negative: [],
        fitted: {
          enterThreshold: 0.6,
          exitThreshold: 0.4,
          oneSidedEnterThreshold: 0.7,
          accuracy: 1,
          trainedAt: "2026-10-03",
        },
      }),
    );
    const profile = store().save(configuration(), 0).configuration;
    expect(profile.origin).toBe("legacy-migration");
    expect(profile.detector.baseSampleOffset).toBe(1.5);
    expect(profile.framebar.colors).toContainEqual({
      name: "startup",
      red: 65,
      green: 135,
      blue: 85,
    });
    expect(profile.digitTemplates[0].id).toBe("one");
    expect(profile.trainingMeter.thresholds.enterThreshold).toBe(0.6);
    expect(profile.calibrationProfileVersion).toBe(2);
    expect(legacy.size).toBe(4);
  });

  it("adds the verified bright-startup sample to older profiles without replacing colors", () => {
    const legacyProfile = configuration();
    delete legacyProfile.calibrationProfileVersion;
    legacyProfile.framebar.colors = legacyProfile.framebar.colors.filter(
      (color) => color.name !== "startup-bright",
    );
    const upgraded = upgradeProcessingConfigurationProfile(legacyProfile);
    expect(upgraded.calibrationProfileVersion).toBe(2);
    expect(upgraded.framebar.colors).toContainEqual({
      name: "startup-bright",
      red: 94,
      green: 186,
      blue: 107,
    });
    expect(upgraded.framebar.colors).toContainEqual({
      name: "startup",
      red: 55,
      green: 120,
      blue: 75,
    });
  });

  it("uses disk after restart even when browser calibration disappears", async () => {
    legacy.set(
      "avatar-overlay-config",
      JSON.stringify({ ...defaultDetectorConfig, baseSampleOffset: 1.5 }),
    );
    const original = store().save(configuration(), 0).configuration;
    legacy.clear();
    const api = { load: () => Promise.resolve(store().load()), save: vi.fn() };
    vi.stubGlobal("window", { electronAPI: { processingConfiguration: api } });
    const loaded = await reloadProcessingConfiguration();
    expect(loaded.configuration).toEqual(original);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("does not remigrate old browser settings when previously initialized disk calibration disappears", async () => {
    legacy.set("labatar-processing-config-initialized", "1");
    const api = {
      load: () => Promise.resolve({ configuration: null, path: "missing.json", warnings: [] }),
      save: vi.fn(),
    };
    vi.stubGlobal("window", { electronAPI: { processingConfiguration: api } });
    await expect(reloadProcessingConfiguration()).rejects.toThrow("defaults were not substituted");
    expect(api.save).not.toHaveBeenCalled();
  });

  it("rejects invalid calibration without overwriting the working file", () => {
    const first = store().save(configuration(), 0).configuration;
    const before = readFileSync(join(directory, "processing-config.json"), "utf8");
    const bad = structuredClone(first);
    bad.framebar.colors[0].green = 999;
    expect(() => store().save(bad, 1)).toThrow("framebar.colors");
    expect(readFileSync(join(directory, "processing-config.json"), "utf8")).toBe(before);
    expect(() =>
      store().save({ ...first, detector: { ...first.detector, sourceX: 99 } }, 1),
    ).toThrow("detector region");
  });

  it("archives previous revisions and rejects a stale window's save", () => {
    const first = store().save(configuration(), 0).configuration;
    const edited = { ...first, detector: { ...first.detector, baseSampleOffset: 6 } };
    expect(store().save(edited, 1).configuration.revision).toBe(2);
    expect(() => store().save(first, 1)).toThrow("another window");
    expect(
      JSON.parse(
        readFileSync(join(directory, "processing-config-history/revision-1.json"), "utf8"),
      ),
    ).toEqual(first);
    expect(store().load().configuration.detector.baseSampleOffset).toBe(6);
  });

  it("recovers corruption visibly, preserves damaged data, and never uses defaults", () => {
    const first = store().save(configuration(), 0).configuration;
    const second = store().save(
      { ...first, detector: { ...first.detector, baseSampleOffset: 6 } },
      1,
    ).configuration;
    writeFileSync(join(directory, "processing-config.json"), "{interrupted write", "utf8");
    const recovered = store().load();
    expect(recovered.configuration).toEqual(second);
    expect(recovered.warnings.join(" ")).toContain("Recovered");
    expect(readdirSync(directory).some((name) => name.includes(".corrupt-"))).toBe(true);
  });

  it("fails visibly on unrecoverable damage or a future schema", () => {
    writeFileSync(join(directory, "processing-config.json"), "{bad", "utf8");
    expect(() => store().load()).toThrow("no valid backup");
    writeFileSync(
      join(directory, "processing-config.json"),
      JSON.stringify({ ...configuration(), schemaVersion: 2 }),
      "utf8",
    );
    expect(() => store().load()).toThrow("Unsupported");
  });

  it("does not downgrade a future configuration even when a valid backup exists", () => {
    const first = store().save(configuration(), 0).configuration;
    store().save(first, 1);
    const future = JSON.stringify({ ...first, schemaVersion: 2 });
    writeFileSync(join(directory, "processing-config.json"), future, "utf8");
    expect(() => store().load()).toThrow("Unsupported");
    expect(() => store().restore(first, null)).toThrow("Unsupported");
    expect(readFileSync(join(directory, "processing-config.json"), "utf8")).toBe(future);
  });

  it("restores an exported configuration as a new revision", () => {
    const first = store().save(configuration(), 0).configuration;
    store().save({ ...first, detector: { ...first.detector, baseSampleOffset: 6 } }, 1);
    const restored = store().save(first, 2, "imported").configuration;
    expect(restored.revision).toBe(3);
    expect(restored.origin).toBe("imported");
    expect(restored.detector).toEqual(first.detector);
  });

  it("allows a validated import to repair damage while retaining the broken file", () => {
    const original = configuration();
    writeFileSync(join(directory, "processing-config.json"), "{bad", "utf8");
    const repaired = store().restore(original, null);
    expect(repaired.configuration.detector).toEqual(original.detector);
    expect(repaired.configuration.origin).toBe("imported");
    expect(repaired.warnings.join(" ")).toContain("Damaged files were preserved");
    expect(readdirSync(directory).some((name) => name.includes(".corrupt-"))).toBe(true);
  });

  it("preserves legacy calibration when its JSON is damaged", () => {
    legacy.set("avatar-overlay-runtime-color-map", "{bad");
    expect(() => configuration()).toThrow("preserved");
    expect(legacy.get("avatar-overlay-runtime-color-map")).toBe("{bad");
  });

  it("serializes rapid edits without losing changes or running React side effects", async () => {
    store().save(configuration(), 0);
    vi.stubGlobal("window", {
      electronAPI: {
        processingConfiguration: {
          load: () => Promise.resolve(store().load()),
          save: (request: { configuration: ProcessingConfiguration; expectedRevision: number }) =>
            Promise.resolve(store().save(request.configuration, request.expectedRevision)),
        },
      },
    });
    await reloadProcessingConfiguration();
    await Promise.all([
      updateProcessingConfiguration((current) => ({
        ...current,
        detector: { ...current.detector, baseSampleOffset: 6 },
      })),
      updateProcessingConfiguration((current) => ({
        ...current,
        detector: { ...current.detector, yellowSampleOffset: 12 },
      })),
    ]);
    const saved = store().load().configuration;
    expect(saved.revision).toBe(3);
    expect(saved.detector.baseSampleOffset).toBe(6);
    expect(saved.detector.yellowSampleOffset).toBe(12);
  });

  it("scales source-pixel offsets exactly once without changing percentage ROIs", () => {
    const original = configuration();
    const half = effectiveDetectorConfig(original, 1280, 720);
    expect(half.baseSampleOffset).toBe(original.detector.baseSampleOffset / 2);
    expect(half.sampleSpacing).toBe(original.detector.sampleSpacing / 2);
    expect(half.player1SourceX).toBe(original.detector.player1SourceX);
    expect(effectiveDetectorConfig(original, 2560, 1440)).toEqual(original.detector);
  });

  it("rejects implicit changes to the bundled input detector rules", () => {
    const original = configuration();
    original.inputDisplayProfile.colorRules[0].redMin = 200;
    expect(() => assertCompatibleProcessingConfiguration(original)).toThrow(
      "explicit configuration migration",
    );
  });

  it("fails a zero-frame processing run instead of returning an empty successful analysis", async () => {
    class Video extends EventTarget {
      duration = 1;
      videoWidth = 2560;
      videoHeight = 1440;
      load() {
        this.dispatchEvent(new Event("loadedmetadata"));
      }
      removeAttribute() {}
    }
    vi.stubGlobal("document", {
      createElement: (tag: string) => (tag === "video" ? new Video() : { getContext: () => ({}) }),
    });
    await expect(
      processRecording(
        "test.mp4",
        undefined,
        undefined,
        { frameRate: 60, readFrame: async () => null },
        configuration(),
      ),
    ).rejects.toThrow("existing analysis was preserved");
  });

  it("retains calibrated startup/active colors and leaves unmatched pixels unknown", () => {
    const profile = configuration();
    const scan = scanFramebar({
      config: { ...profile.detector, sampleCount: 3, sampleStartOffset: 0, sampleSpacing: 1 },
      sampleWidth: 3,
      sampleHeight: 10,
      readPixel: (x) =>
        [
          { red: 55, green: 120, blue: 75 },
          { red: 145, green: 0, blue: 3 },
          { red: 255, green: 255, blue: 0 },
        ][Math.round(x)],
      getMappedColor: (r, g, b) =>
        findClosestFramebarColor(
          r,
          g,
          b,
          profile.framebar.colors,
          profile.framebar.distanceThreshold,
        ),
    });
    expect(scan.rawStates).toEqual(["startup", "active", "Unmapped"]);
    expect(summarizeFramePhases(scan.groups)).toEqual({
      startup: 1,
      active: 1,
      recovery: 0,
      other: 1,
    });
    expect(scan.meterPresence.mappedScore).toBeCloseTo(2 / 3);
    expect(scan.unmappedColors.get("255,255,0")).toBe(1);
  });

  it("recognizes the bright startup cells from the latest 5A block capture", () => {
    const profile = configuration();
    const match = findClosestFramebarColor(
      94,
      186,
      107,
      profile.framebar.colors,
      profile.framebar.distanceThreshold,
    );
    expect(match?.name).toBe("startup-bright");
    expect(
      summarizeFramePhases([
        { state: match?.name ?? "Unmapped", start: 0, length: 8 },
        { state: "active", start: 8, length: 1 },
      ]),
    ).toEqual({ startup: 8, active: 1, recovery: 0, other: 0 });
  });
});
