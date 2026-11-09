const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, maximum = 200) => typeof value === "string" && value.length <= maximum;
const hash = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const time = (value) => Number.isFinite(value) && value >= 0;
const direction = (value) => Number.isInteger(value) && value >= 1 && value <= 9;
const position = (value) => value === "grounded" || value === "airborne";
const labels = (value) =>
  Array.isArray(value) && value.length <= 32 && value.every((item) => text(item, 40));
const nullableText = (value, maximum = 80) => value === null || text(value, maximum);
const onlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));

function validEdit(edit) {
  if (edit === null) return true;
  if (!isObject(edit)) return false;
  for (const [key, value] of Object.entries(edit)) {
    if (key === "notation" && text(value, 40)) continue;
    if (key === "separator" && (value === " " || value === "~")) continue;
    if (key === "positionAfter" && position(value)) continue;
    if (["togglePosition", "charged", "delay", "crit", "anyAttack"].includes(key) && value === true)
      continue;
    if (key === "directionOverride" && typeof value === "string" && /^[1-9]{0,8}$/.test(value))
      continue;
    return false;
  }
  return true;
}

function validInterpretation(value) {
  return (
    isObject(value) &&
    onlyKeys(value, ["direction", "motion", "directionPath", "suggestedNotation", "notation"]) &&
    direction(value.direction) &&
    nullableText(value.motion, 8) &&
    nullableText(value.directionPath, 80) &&
    (value.suggestedNotation === undefined || nullableText(value.suggestedNotation, 80)) &&
    nullableText(value.notation, 80)
  );
}

function validPress(value, stateCount, durationMs) {
  return (
    isObject(value) &&
    onlyKeys(value, [
      "timeMs",
      "sourceStateIndex",
      "physicalButton",
      "gameAction",
      "gameButton",
      "context",
      "positionAfter",
      "manualEdit",
      "interpretations",
    ]) &&
    time(value.timeMs) &&
    value.timeMs <= durationMs &&
    count(value.sourceStateIndex) &&
    value.sourceStateIndex < stateCount &&
    text(value.physicalButton, 40) &&
    nullableText(value.gameAction, 80) &&
    nullableText(value.gameButton, 40) &&
    isObject(value.context) &&
    onlyKeys(value.context, ["facing", "position"]) &&
    value.context.facing === "right" &&
    position(value.context.position) &&
    (value.positionAfter === undefined ||
      value.positionAfter === null ||
      position(value.positionAfter)) &&
    (value.manualEdit === undefined || validEdit(value.manualEdit)) &&
    isObject(value.interpretations) &&
    onlyKeys(value.interpretations, ["right", "left"]) &&
    validInterpretation(value.interpretations.right) &&
    validInterpretation(value.interpretations.left)
  );
}

function validDirectionChange(value, stateCount, durationMs) {
  return (
    isObject(value) &&
    onlyKeys(value, [
      "timeMs",
      "sourceStateIndex",
      "direction",
      "heldButtons",
      "heldGameButtons",
    ]) &&
    time(value.timeMs) &&
    value.timeMs <= durationMs &&
    count(value.sourceStateIndex) &&
    value.sourceStateIndex < stateCount &&
    direction(value.direction) &&
    labels(value.heldButtons) &&
    labels(value.heldGameButtons)
  );
}

/** Validate the generated, clip-aligned artifact without discarding its event detail. */
export function validateProcessedComboInput(value) {
  if (
    !isObject(value) ||
    !onlyKeys(value, [
      "schemaVersion",
      "processorVersion",
      "processedAt",
      "source",
      "context",
      "directionChanges",
      "presses",
      "routes",
    ]) ||
    value.schemaVersion !== 1 ||
    !count(value.processorVersion) ||
    !text(value.processedAt, 40) ||
    !Number.isFinite(Date.parse(value.processedAt)) ||
    !isObject(value.source) ||
    !onlyKeys(value.source, [
      "kind",
      "sha256",
      "durationMs",
      "stateCount",
      "timing",
      "rawStartMs",
      "editsSha256",
    ]) ||
    value.source.kind !== "comboInputCapture" ||
    !hash(value.source.sha256) ||
    !time(value.source.durationMs) ||
    !count(value.source.stateCount) ||
    !text(value.source.timing, 200) ||
    !(value.source.rawStartMs === null || time(value.source.rawStartMs)) ||
    (value.source.editsSha256 !== undefined && !hash(value.source.editsSha256)) ||
    !isObject(value.context) ||
    !onlyKeys(value.context, ["defaultFacing", "defaultPosition"]) ||
    value.context.defaultFacing !== "right" ||
    value.context.defaultPosition !== "grounded" ||
    !isObject(value.routes) ||
    !onlyKeys(value.routes, ["right", "left"]) ||
    !text(value.routes.right, 2000) ||
    !text(value.routes.left, 2000) ||
    !Array.isArray(value.directionChanges) ||
    !Array.isArray(value.presses) ||
    value.directionChanges.length > 10000 ||
    value.presses.length > 10000 ||
    !value.directionChanges.every((event) =>
      validDirectionChange(event, value.source.stateCount, value.source.durationMs),
    ) ||
    !value.presses.every((event) =>
      validPress(event, value.source.stateCount, value.source.durationMs),
    )
  ) {
    throw new Error("The processed combo inputs are invalid.");
  }
  return value;
}
