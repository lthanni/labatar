import {
  defaultDetectorConfig,
  hasStoredDetectorConfig,
  readDetectorConfig,
} from "./detector-config";
import {
  framebarColorMap,
  framebarColorDistanceThreshold,
  framebarRuntimeMapKey,
} from "./framebar-color-map";
import { digitTemplatesKey, type DigitTemplate } from "./input-display";
import { readTrainingMeterCalibration, trainingMeterCalibrationKey } from "./training-meter";
import inputDisplayProfile from "./config/input-display-profile.json";
import type {
  ProcessingConfiguration,
  ProcessingConfigurationResult,
} from "./processing-config-types";

export const recordingProcessorVersion = "recording-processor/2";
export const currentCalibrationProfileVersion = 2;
declare const __RECORDING_PROCESSOR_FINGERPRINT__: string;
export const recordingProcessorFingerprint = __RECORDING_PROCESSOR_FINGERPRINT__;
let loading: Promise<ProcessingConfigurationResult> | null = null;
let pendingSave: Promise<unknown> = Promise.resolve();
const migrationMarkerKey = "labatar-processing-config-initialized";

/** Only used when the app-owned file has never existed. Legacy keys are left intact. */
export function migrateLegacyProcessingConfiguration(): ProcessingConfiguration {
  const legacyKeys = [
    "avatar-overlay-config",
    framebarRuntimeMapKey,
    digitTemplatesKey,
    trainingMeterCalibrationKey,
  ];
  const saved = legacyKeys.map((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null) throw new Error("empty saved calibration");
      return parsed;
    } catch {
      throw new Error(
        `Saved calibration ${key} could not be read. It was preserved; fix or import it before processing.`,
      );
    }
  });
  if (saved[0] !== null && (typeof saved[0] !== "object" || Array.isArray(saved[0]))) {
    throw new Error("Saved detector calibration is invalid; defaults were not substituted.");
  }
  if (saved[1] !== null && !Array.isArray(saved[1]))
    throw new Error("Saved framebar color map is invalid.");
  if (saved[2] !== null && !Array.isArray(saved[2]))
    throw new Error("Saved digit templates are invalid.");
  if (saved[3] !== null && (typeof saved[3] !== "object" || Array.isArray(saved[3])))
    throw new Error("Saved training-meter calibration is invalid.");
  if (saved[3]) {
    const training = saved[3] as Record<string, unknown>;
    for (const kind of ["positive", "negative"]) {
      if (training[kind] !== undefined && !Array.isArray(training[kind]))
        throw new Error(`Saved training-meter ${kind} samples are invalid.`);
    }
  }
  const calibration = readTrainingMeterCalibration();
  const colors = [...framebarColorMap, ...((saved[1] ?? []) as typeof framebarColorMap)];
  return {
    schemaVersion: 1,
    calibrationProfileVersion: currentCalibrationProfileVersion,
    revision: 1,
    updatedAt: new Date().toISOString(),
    origin: saved.some((value) => value !== null) ? "legacy-migration" : "defaults",
    detector: hasStoredDetectorConfig() ? readDetectorConfig() : { ...defaultDetectorConfig },
    referenceSize: { width: 2560, height: 1440 },
    framebar: {
      colors: colors.filter(
        (color, index) =>
          colors.findIndex((entry) => JSON.stringify(entry) === JSON.stringify(color)) === index,
      ),
      distanceThreshold: framebarColorDistanceThreshold,
      unmappedPolicy: "unknown",
    },
    digitTemplates: (saved[2] ?? []) as DigitTemplate[],
    trainingMeter: {
      calibration,
      thresholds: calibration.fitted
        ? {
            enterThreshold: calibration.fitted.enterThreshold,
            exitThreshold: calibration.fitted.exitThreshold,
            oneSidedEnterThreshold: calibration.fitted.oneSidedEnterThreshold,
          }
        : { enterThreshold: 0.4, exitThreshold: 0.32, oneSidedEnterThreshold: 0.55 },
    },
    inputDisplayProfile: structuredClone(inputDisplayProfile),
  };
}

/** Adds proven palette samples without removing or rewriting user measurements. */
export function upgradeProcessingConfigurationProfile(
  configuration: ProcessingConfiguration,
): ProcessingConfiguration {
  const profileVersion = configuration.calibrationProfileVersion ?? 1;
  if (profileVersion >= currentCalibrationProfileVersion) return configuration;
  const colors = [...configuration.framebar.colors];
  for (const knownColor of framebarColorMap) {
    const alreadyPresent = colors.some(
      (color) =>
        color.name === knownColor.name &&
        color.red === knownColor.red &&
        color.green === knownColor.green &&
        color.blue === knownColor.blue,
    );
    if (!alreadyPresent) colors.push({ ...knownColor });
  }
  return {
    ...configuration,
    calibrationProfileVersion: currentCalibrationProfileVersion,
    framebar: { ...configuration.framebar, colors },
  };
}

async function upgradeStoredProcessingConfiguration(result: ProcessingConfigurationResult) {
  if (!result.configuration) return result;
  const configuration = upgradeProcessingConfigurationProfile(result.configuration);
  if (configuration === result.configuration) return result;
  const upgraded = await window.electronAPI!.processingConfiguration.save({
    configuration,
    expectedRevision: result.configuration.revision,
  });
  upgraded.warnings.push(
    "Upgraded the framebar calibration profile with the verified bright-startup color sample.",
  );
  return upgraded;
}

export function loadProcessingConfiguration(): Promise<ProcessingConfigurationResult> {
  if (!loading) {
    loading = (async () => {
      const api = window.electronAPI?.processingConfiguration;
      if (!api) throw new Error("Persistent processing calibration requires the desktop app.");
      const stored = await api.load();
      if (stored.configuration)
        return markInitialized(await upgradeStoredProcessingConfiguration(stored));
      if (localStorage.getItem(migrationMarkerKey)) {
        throw new Error(
          "The persistent processing configuration is missing after previous initialization. Import an exported configuration; defaults were not substituted.",
        );
      }
      const configuration = migrateLegacyProcessingConfiguration();
      return markInitialized(await api.save({ configuration, expectedRevision: 0 }));
    })().catch((error) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

function markInitialized(result: ProcessingConfigurationResult) {
  try {
    localStorage.setItem(migrationMarkerKey, "1");
  } catch {
    result.warnings.push(
      "Calibration is saved to disk, but the browser could not record the migration marker.",
    );
  }
  return result;
}

export async function getProcessingConfiguration(): Promise<ProcessingConfiguration> {
  await pendingSave;
  await loadProcessingConfiguration();
  // Re-read the validated file at the start of each run, then freeze that
  // revision. A cached renderer must not hide another window's saved edits.
  const result = await upgradeStoredProcessingConfiguration(
    await window.electronAPI!.processingConfiguration.load(),
  );
  if (!result.configuration) throw new Error("No processing calibration is available.");
  loading = Promise.resolve(result);
  return structuredClone(result.configuration);
}

/** Serialize edits outside React state updaters; revision checks reject stale windows. */
export function updateProcessingConfiguration(
  edit: (configuration: ProcessingConfiguration) => ProcessingConfiguration,
): Promise<ProcessingConfigurationResult> {
  const action = pendingSave.then(async () => {
    const current = await loadProcessingConfiguration();
    if (!current.configuration) throw new Error("No processing calibration is available.");
    const result = await window.electronAPI!.processingConfiguration.save({
      configuration: edit(structuredClone(current.configuration)),
      expectedRevision: current.configuration.revision,
    });
    loading = Promise.resolve(result);
    return result;
  });
  pendingSave = action.catch(() => undefined);
  return action;
}

export async function reloadProcessingConfiguration() {
  await pendingSave;
  loading = null;
  return loadProcessingConfiguration();
}

export async function importProcessingConfiguration() {
  await pendingSave;
  let expectedRevision: number | null = null;
  try {
    const current = await loadProcessingConfiguration();
    expectedRevision = current.configuration?.revision ?? 0;
  } catch {
    // Import remains available when damaged calibration cannot be loaded.
    // The main process still rejects unsupported schemas and stale imports.
  }
  const result = await window.electronAPI!.processingConfiguration.import({
    expectedRevision,
  });
  if (result) {
    const upgraded = await upgradeStoredProcessingConfiguration(result);
    loading = Promise.resolve(markInitialized(upgraded));
    return upgraded;
  }
  return result;
}

export function assertCompatibleProcessingConfiguration(configuration: ProcessingConfiguration) {
  if (configuration.schemaVersion !== 1)
    throw new Error("Unsupported processing calibration version.");
  const canonicalJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
        .join(",")}}`;
    return JSON.stringify(value);
  };
  if (canonicalJson(configuration.inputDisplayProfile) !== canonicalJson(inputDisplayProfile)) {
    throw new Error(
      "The input detector rules differ from this saved calibration. An explicit configuration migration is required before processing.",
    );
  }
}

export function effectiveDetectorConfig(
  configuration: ProcessingConfiguration,
  width: number,
  height: number,
) {
  const config = { ...configuration.detector };
  for (const key of [
    "sampleStartOffset",
    "sampleSpacing",
    "gateStartOffset",
    "gateSpacing",
  ] as const) {
    config[key] *= width / configuration.referenceSize.width;
  }
  for (const key of ["baseSampleOffset", "yellowSampleOffset", "gateSampleOffset"] as const) {
    config[key] *= height / configuration.referenceSize.height;
  }
  return config;
}
