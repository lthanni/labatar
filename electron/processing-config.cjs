const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Keep validation independent of Electron so persistence failures can be tested.
function validateProcessingConfiguration(value, detectorKeys) {
  const fail = (field) => {
    throw new Error(`Invalid processing configuration: ${field}.`);
  };
  const object = (entry) => entry && typeof entry === "object" && !Array.isArray(entry);
  const number = (entry, min, max) =>
    typeof entry === "number" && Number.isFinite(entry) && entry >= min && entry <= max;
  if (!object(value)) fail("expected an object");
  if (value.schemaVersion !== 1) {
    const error = new Error(`Unsupported processing configuration version ${value.schemaVersion}.`);
    error.code = "UNSUPPORTED_CONFIG_VERSION";
    throw error;
  }
  if (
    value.calibrationProfileVersion !== undefined &&
    (!Number.isSafeInteger(value.calibrationProfileVersion) ||
      value.calibrationProfileVersion < 1 ||
      value.calibrationProfileVersion > 2)
  ) {
    fail("calibrationProfileVersion");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) fail("revision");
  if (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) {
    fail("updatedAt");
  }
  if (!["legacy-migration", "defaults", "edited", "imported"].includes(value.origin))
    fail("origin");
  if (!object(value.detector)) fail("detector");
  for (const key of detectorKeys) {
    if (!number(value.detector[key], 0, 100000)) fail(`detector.${key}`);
  }
  for (const key of ["sampleCount", "gateSampleCount", "inputSegmentCount"]) {
    if (!Number.isInteger(value.detector[key]) || !number(value.detector[key], 1, 1000)) {
      fail(`detector.${key}`);
    }
  }
  for (const key of ["sampleSpacing", "gateSpacing", "inputSegmentHeight"]) {
    if (value.detector[key] <= 0) fail(`detector.${key}`);
  }
  for (const [x, y, width, height] of [
    ["sourceX", "sourceY", "framebarSourceWidth", "framebarSourceHeight"],
    ["player1SourceX", "player1SourceY", "framebarSourceWidth", "framebarSourceHeight"],
    ["inputSourceX", "inputSourceY", "inputSourceWidth", "inputSourceHeight"],
  ]) {
    const d = value.detector;
    if (d[width] <= 0 || d[height] <= 0 || d[x] + d[width] > 100 || d[y] + d[height] > 100) {
      fail(`detector region ${x},${y}`);
    }
  }
  if (
    !object(value.referenceSize) ||
    !number(value.referenceSize.width, 1, 32768) ||
    !number(value.referenceSize.height, 1, 32768)
  )
    fail("referenceSize");
  if (
    !object(value.framebar) ||
    value.framebar.unmappedPolicy !== "unknown" ||
    !number(value.framebar.distanceThreshold, 0.001, 1) ||
    !Array.isArray(value.framebar.colors) ||
    value.framebar.colors.length > 1000
  )
    fail("framebar");
  const states = new Set();
  for (const color of value.framebar.colors) {
    if (
      !object(color) ||
      typeof color.name !== "string" ||
      !color.name.trim() ||
      ![color.red, color.green, color.blue].every((channel) => number(channel, 0, 255))
    ) {
      fail("framebar.colors");
    }
    states.add(color.name.toLowerCase());
  }
  for (const state of ["startup", "active", "recovery", "idle"]) {
    if (!states.has(state)) fail(`missing ${state} color`);
  }
  if (!Array.isArray(value.digitTemplates) || value.digitTemplates.length > 100)
    fail("digitTemplates");
  for (const template of value.digitTemplates) {
    if (
      !object(template) ||
      typeof template.id !== "string" ||
      typeof template.capturedAt !== "string" ||
      typeof template.digit !== "string" ||
      !(template.digit === "blank" || /^[0-9]$/.test(template.digit)) ||
      !Array.isArray(template.mask) ||
      template.mask.length !== 35 ||
      !template.mask.every((entry) => number(entry, 0, 1))
    )
      fail("digitTemplates entry");
  }
  const training = value.trainingMeter;
  if (!object(training) || !object(training.calibration) || !object(training.thresholds)) {
    fail("trainingMeter");
  }
  const checkThresholds = (thresholds) => {
    for (const key of ["enterThreshold", "exitThreshold", "oneSidedEnterThreshold"]) {
      if (!number(thresholds[key], 0, 1)) fail(`trainingMeter.${key}`);
    }
    if (thresholds.exitThreshold > thresholds.enterThreshold) fail("trainingMeter hysteresis");
  };
  checkThresholds(training.thresholds);
  if (training.calibration.fitted !== null) {
    if (!object(training.calibration.fitted)) fail("trainingMeter.calibration.fitted");
    checkThresholds(training.calibration.fitted);
  }
  for (const kind of ["positive", "negative"]) {
    if (!Array.isArray(training.calibration[kind]) || training.calibration[kind].length > 300) {
      fail(`trainingMeter.calibration.${kind}`);
    }
    for (const sample of training.calibration[kind]) {
      if (!object(sample) || !number(sample.score, 0, 1) || typeof sample.timestamp !== "string") {
        fail(`trainingMeter.calibration.${kind} sample`);
      }
    }
  }
  const input = value.inputDisplayProfile;
  if (
    !object(input) ||
    input.version !== 1 ||
    !Array.isArray(input.buttonSlots) ||
    !Array.isArray(input.colorRules) ||
    !object(input.segmentBackground) ||
    !object(input.displayColors)
  )
    fail("inputDisplayProfile");
  return JSON.parse(JSON.stringify(value));
}

function createProcessingConfigurationStore(directory, detectorKeys) {
  const file = path.join(directory, "processing-config.json");
  const backup = `${file}.bak`;
  const history = path.join(directory, "processing-config-history");
  const validate = (value) => validateProcessingConfiguration(value, detectorKeys);
  const read = (target) => validate(JSON.parse(fs.readFileSync(target, "utf8")));
  const atomicWrite = (target, value) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const descriptor = fs.openSync(temporary, "wx");
      try {
        fs.writeFileSync(descriptor, JSON.stringify(value, null, 2), "utf8");
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  };
  const archive = (configuration) => {
    const target = path.join(history, `revision-${configuration.revision}.json`);
    if (!fs.existsSync(target)) atomicWrite(target, configuration);
  };
  const load = () => {
    const warnings = [];
    if (fs.existsSync(file)) {
      try {
        return { configuration: read(file), path: file, warnings };
      } catch (error) {
        // A newer schema must never be replaced with an older backup.
        if (error.code === "UNSUPPORTED_CONFIG_VERSION") throw error;
        warnings.push(`Processing configuration could not be read: ${error.message}`);
      }
    }
    const revisions = fs.existsSync(history)
      ? fs
          .readdirSync(history)
          .filter((name) => /^revision-\d+\.json$/.test(name))
          .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]))
          .map((name) => path.join(history, name))
      : [];
    for (const candidate of [...revisions, backup]) {
      if (!fs.existsSync(candidate)) continue;
      let configuration;
      try {
        configuration = read(candidate);
      } catch (error) {
        if (error.code === "UNSUPPORTED_CONFIG_VERSION") throw error;
        continue;
      }
      if (fs.existsSync(file)) {
        fs.copyFileSync(file, `${file}.corrupt-${Date.now()}-${randomUUID()}`);
      }
      atomicWrite(file, configuration);
      warnings.push(
        `Recovered processing calibration revision ${configuration.revision} from ${candidate}.`,
      );
      return { configuration, path: file, warnings };
    }
    if (fs.existsSync(file) || fs.existsSync(backup) || revisions.length) {
      const error = new Error(
        "Processing calibration is damaged and no valid backup is available. Import a saved configuration to recover; defaults were not substituted.",
      );
      error.code = "CONFIG_DAMAGED";
      throw error;
    }
    return { configuration: null, path: file, warnings };
  };
  const save = (value, expectedRevision, origin) => {
    // Validate before reading/writing so malformed imports cannot touch files.
    const incoming = validate(value);
    const current = load();
    if ((current.configuration?.revision ?? 0) !== expectedRevision) {
      throw new Error(
        "Processing calibration changed in another window. Reload the configuration before saving.",
      );
    }
    const configuration = validate({
      ...incoming,
      revision: expectedRevision + 1,
      updatedAt: new Date().toISOString(),
      origin: origin ?? (expectedRevision === 0 ? incoming.origin : "edited"),
    });
    if (current.configuration) {
      archive(current.configuration);
      atomicWrite(backup, current.configuration);
    }
    atomicWrite(file, configuration);
    try {
      archive(configuration);
    } catch (error) {
      // The main file is already committed. Report an archive failure without
      // pretending the save failed and encouraging a stale retry.
      current.warnings.push(
        `Calibration saved, but revision history could not be written: ${error.message}`,
      );
    }
    return { ...current, configuration };
  };
  const restore = (value, expectedRevision) => {
    const incoming = validate(value);
    let current;
    try {
      current = load();
    } catch (error) {
      if (error.code !== "CONFIG_DAMAGED" || expectedRevision !== null) throw error;
      // Only an explicit, validated import may repair unrecoverable damage.
      for (const target of [file, backup]) {
        if (fs.existsSync(target))
          fs.copyFileSync(target, `${target}.corrupt-${Date.now()}-${randomUUID()}`);
      }
      const revisions = fs.existsSync(history)
        ? fs
            .readdirSync(history)
            .filter((name) => /^revision-\d+\.json$/.test(name))
            .map((name) => Number(name.match(/\d+/)[0]))
        : [];
      const configuration = validate({
        ...incoming,
        revision: Math.max(incoming.revision, ...revisions, 0) + 1,
        updatedAt: new Date().toISOString(),
        origin: "imported",
      });
      atomicWrite(file, configuration);
      const warnings = [
        "Imported saved calibration to recover damaged configuration. Damaged files were preserved.",
      ];
      try {
        archive(configuration);
      } catch (archiveError) {
        warnings.push(`Revision history could not be written: ${archiveError.message}`);
      }
      return { configuration, path: file, warnings };
    }
    if (expectedRevision === null && current.configuration) {
      throw new Error(
        "Processing calibration is available again. Reload before importing to avoid replacing another window's changes.",
      );
    }
    return save(incoming, expectedRevision ?? 0, "imported");
  };
  return { load, save, restore, validate };
}

module.exports = { createProcessingConfigurationStore, validateProcessingConfiguration };
