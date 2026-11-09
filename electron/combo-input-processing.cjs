const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const PROCESSOR_VERSION = 10;
const EMPTY_EDITS = { schemaVersion: 1, presses: {} };
const ACTION_LABELS = {
  Atk1: "A",
  Atk2: "B",
  Atk3: "C",
  Atk4: "F",
  EX: "EX",
  Support: "SUP",
  SUP: "SUP",
  Throw: "TH",
  TH: "TH",
};

function inputDirection(state) {
  return state.direction !== 5 ? state.direction : state.stickDirection;
}

function relativeDirection(direction, facing) {
  if (facing === "right") return direction;
  return { 1: 3, 3: 1, 4: 6, 6: 4, 7: 9, 9: 7 }[direction] ?? direction;
}

function oppositePosition(position) {
  return position === "airborne" ? "grounded" : "airborne";
}

function applyDirectionOverride(notation, directionOverride) {
  if (!notation || directionOverride === undefined) return notation;
  return notation.replace(/^(j\.)?[1-9]*/, (_, jump = "") => `${jump}${directionOverride}`);
}

function applyAnyAttackButton(notation, anyAttack) {
  if (!notation || !anyAttack) return notation;
  return notation.replace(
    /^((?:j\.)?(?:1-9|[1-9]*))(?:\[([ABC])\]|([ABC]))(!?)$/,
    (_, prefix, bracketed, _plain, critical) => `${prefix}${bracketed ? "[X]" : "X"}${critical}`,
  );
}

function mirrorDirection(direction) {
  return direction.replace(
    /[134679]/g,
    (digit) =>
      ({
        1: "3",
        3: "1",
        4: "6",
        6: "4",
        7: "9",
        9: "7",
      })[digit],
  );
}

function applyPressDecorations(notation, edit) {
  if (!notation) return notation;
  let result = notation;
  if (edit?.charged) {
    const suffix = result.endsWith("!") ? "!" : "";
    const base = suffix ? result.slice(0, -1) : result;
    result = base.replace(/(?<!\[)(EX|SUP|TH|[A-Z])$/, "[$1]") + suffix;
  }
  if (edit?.crit && !result.endsWith("!")) result += "!";
  if (edit?.delay && !result.startsWith("dl.")) result = `dl.${result}`;
  return result;
}

function recentMotion(states, index, facing) {
  const pressedAt = states[index].timeMs;
  const recent = [];
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    recent.push(states[cursor]);
    // A direction already held at the start of the window still matters.
    if (pressedAt - states[cursor].timeMs > 250) break;
  }
  recent.reverse();
  const lastActive = [...recent].reverse().find((state) => inputDirection(state) !== 5);
  if (lastActive && pressedAt - lastActive.timeMs <= 50) {
    while (recent.length && inputDirection(recent.at(-1)) === 5) recent.pop();
  }
  const directions = recent
    .map((state) => relativeDirection(inputDirection(state), facing))
    .filter((direction, position, values) => position === 0 || direction !== values[position - 1]);
  const path = directions.join("");
  if (/2(?:3)*3(?:6)*6$/.test(path)) return { notation: "236", path };
  if (/2(?:1)*1(?:4)*4$/.test(path)) return { notation: "214", path };
  if (/2(?:5)*2$/.test(path)) return { notation: "22", path };
  return null;
}

function sourceHash(capture) {
  return createHash("sha256").update(JSON.stringify(capture)).digest("hex");
}

function comboInputEditsPath(videoPath) {
  return `${videoPath}.combo-inputs.edits.json`;
}

function pressEditKey(rawTimeMs, physicalButton) {
  return `${rawTimeMs}:${physicalButton}`;
}

function validateEdits(value) {
  if (
    value?.schemaVersion !== 1 ||
    !value.presses ||
    typeof value.presses !== "object" ||
    Array.isArray(value.presses)
  ) {
    throw new Error("The combo input edits file is invalid.");
  }
  for (const [key, edit] of Object.entries(value.presses)) {
    if (
      !/^\d+:[A-Za-z0-9]+$/.test(key) ||
      !edit ||
      typeof edit !== "object" ||
      Array.isArray(edit)
    ) {
      throw new Error("The combo input edits file is invalid.");
    }
    if (
      edit.notation !== undefined &&
      (typeof edit.notation !== "string" || !/^[^\s~<>]{1,40}$/.test(edit.notation))
    ) {
      throw new Error("A combo input edit has invalid notation.");
    }
    if (edit.separator !== undefined && ![" ", "~"].includes(edit.separator)) {
      throw new Error("A combo input edit has an invalid separator.");
    }
    if (
      edit.positionAfter !== undefined &&
      !["grounded", "airborne"].includes(edit.positionAfter)
    ) {
      throw new Error("A combo input edit has an invalid position.");
    }
    if (edit.togglePosition !== undefined && edit.togglePosition !== true) {
      throw new Error("A combo input edit has an invalid position toggle.");
    }
    if (edit.charged !== undefined && edit.charged !== true) {
      throw new Error("A combo input edit has an invalid charged flag.");
    }
    if (edit.delay !== undefined && edit.delay !== true) {
      throw new Error("A combo input edit has an invalid delay flag.");
    }
    if (edit.crit !== undefined && edit.crit !== true) {
      throw new Error("A combo input edit has an invalid critical flag.");
    }
    if (edit.anyAttack !== undefined && edit.anyAttack !== true) {
      throw new Error("A combo input edit has an invalid any-attack flag.");
    }
    if (
      edit.directionOverride !== undefined &&
      (typeof edit.directionOverride !== "string" || !/^[1-9]{0,8}$/.test(edit.directionOverride))
    ) {
      throw new Error("A combo input edit has an invalid direction override.");
    }
  }
  return value;
}

async function readComboInputEdits(videoPath) {
  try {
    return validateEdits(JSON.parse(await fs.readFile(comboInputEditsPath(videoPath), "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return EMPTY_EDITS;
    throw error;
  }
}

async function writeComboInputEdits(videoPath, edits) {
  validateEdits(edits);
  const outputPath = comboInputEditsPath(videoPath);
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(edits, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rename(temporaryPath, outputPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return edits;
}

function processComboInputCapture(
  capture,
  processedAt = new Date().toISOString(),
  rawStartMs = null,
  edits = EMPTY_EDITS,
) {
  if (capture?.schemaVersion !== 1 || !Array.isArray(capture.states)) {
    throw new Error("The raw combo input capture is invalid.");
  }
  const states = capture.states;
  const directionChanges = [];
  const presses = [];
  const routes = { right: [], left: [] };
  let basePosition =
    Object.entries(edits.presses)
      .filter(([key, edit]) => edit.positionAfter && Number(key.split(":")[0]) <= (rawStartMs ?? 0))
      .sort(([left], [right]) => Number(left.split(":")[0]) - Number(right.split(":")[0]))
      .at(-1)?.[1].positionAfter ?? "grounded";
  let positionFlipped =
    Object.entries(edits.presses).filter(
      ([key, edit]) => edit.togglePosition && Number(key.split(":")[0]) <= (rawStartMs ?? 0),
    ).length %
      2 ===
    1;
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    const previous = states[index - 1];
    if (!previous || inputDirection(previous) !== inputDirection(state)) {
      const heldButtons = (state.buttons ?? []).filter(
        (button) => !previous || previous.buttons?.includes(button),
      );
      directionChanges.push({
        timeMs: state.timeMs,
        sourceStateIndex: index,
        direction: inputDirection(state),
        heldButtons,
        heldGameButtons: heldButtons
          .map((button) => ACTION_LABELS[capture.bindings?.[button]])
          .filter(Boolean),
      });
    }
    // State zero describes what was held at the clip boundary, not a new press.
    const newButtons = previous
      ? (state.buttons ?? []).filter((button) => !previous.buttons?.includes(button))
      : [];
    for (const physicalButton of newButtons) {
      const action = capture.bindings?.[physicalButton] ?? null;
      const gameButton = ACTION_LABELS[action] ?? null;
      const rawTimeMs = (Number.isFinite(rawStartMs) ? rawStartMs : 0) + state.timeMs;
      const edit = edits.presses[pressEditKey(rawTimeMs, physicalButton)] ?? null;
      if (edit?.togglePosition) positionFlipped = !positionFlipped;
      const position = positionFlipped ? oppositePosition(basePosition) : basePosition;
      const interpretations = {};
      for (const facing of ["right", "left"]) {
        const motion = recentMotion(states, index, facing);
        const direction = relativeDirection(inputDirection(state), facing);
        const suggestedNotation = gameButton
          ? `${position === "airborne" ? "j." : ""}${motion?.notation ?? direction}${gameButton}`
          : null;
        const baseNotation =
          facing === "right" && edit?.notation
            ? `${position === "airborne" ? "j." : ""}${edit.notation.replace(/^j\./, "")}`
            : suggestedNotation;
        const directionOverride =
          facing === "left" && edit?.directionOverride !== undefined
            ? mirrorDirection(edit.directionOverride)
            : edit?.directionOverride;
        const notation = applyPressDecorations(
          applyAnyAttackButton(
            applyDirectionOverride(baseNotation, directionOverride),
            edit?.anyAttack && ["A", "B", "C"].includes(gameButton),
          ),
          edit,
        );
        interpretations[facing] = {
          direction,
          motion: motion?.notation ?? null,
          directionPath: motion?.path ?? null,
          suggestedNotation,
          notation,
        };
        if (notation)
          routes[facing].push({
            notation,
            separator: facing === "right" ? (edit?.separator ?? " ") : " ",
          });
      }
      presses.push({
        timeMs: state.timeMs,
        sourceStateIndex: index,
        physicalButton,
        gameAction: action,
        gameButton,
        context: { facing: "right", position },
        positionAfter: edit?.positionAfter
          ? positionFlipped
            ? oppositePosition(edit.positionAfter)
            : edit.positionAfter
          : null,
        manualEdit: edit,
        interpretations,
      });
      if (edit?.positionAfter) basePosition = edit.positionAfter;
    }
  }
  return {
    schemaVersion: 1,
    processorVersion: PROCESSOR_VERSION,
    processedAt,
    source: {
      kind: "comboInputCapture",
      sha256: sourceHash(capture),
      durationMs: capture.durationMs,
      stateCount: states.length,
      timing: capture.timing,
      rawStartMs: Number.isFinite(rawStartMs) ? rawStartMs : null,
      editsSha256: sourceHash(edits),
    },
    context: { defaultFacing: "right", defaultPosition: "grounded" },
    directionChanges,
    presses,
    routes: Object.fromEntries(
      Object.entries(routes).map(([facing, tokens]) => [
        facing,
        tokens.map((token, index) => `${index ? token.separator : ""}${token.notation}`).join(""),
      ]),
    ),
  };
}

function processedComboInputPath(videoPath) {
  return `${videoPath}.combo-inputs.processed.json`;
}

function originalComboInputPath(videoPath) {
  return `${videoPath}.combo-inputs.raw.json`;
}

async function ensureOriginalComboInput(videoPath, capture) {
  if (!capture) return null;
  const outputPath = originalComboInputPath(videoPath);
  try {
    await fs.writeFile(outputPath, JSON.stringify(capture, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return outputPath;
}

async function ensureProcessedComboInput(
  videoPath,
  capture,
  rawStartMs = null,
  { force = false } = {},
) {
  if (!capture) return null;
  const outputPath = processedComboInputPath(videoPath);
  const hash = sourceHash(capture);
  const edits = await readComboInputEdits(videoPath);
  const editsHash = sourceHash(edits);
  if (!force) {
    try {
      const saved = JSON.parse(await fs.readFile(outputPath, "utf8"));
      if (
        saved.schemaVersion === 1 &&
        saved.processorVersion === PROCESSOR_VERSION &&
        saved.source?.sha256 === hash &&
        saved.source?.editsSha256 === editsHash &&
        saved.source?.rawStartMs === (Number.isFinite(rawStartMs) ? rawStartMs : null)
      )
        return saved;
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }
  const processed = processComboInputCapture(capture, new Date().toISOString(), rawStartMs, edits);
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(processed, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rename(temporaryPath, outputPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return processed;
}

module.exports = {
  comboInputEditsPath,
  ensureOriginalComboInput,
  ensureProcessedComboInput,
  originalComboInputPath,
  pressEditKey,
  processComboInputCapture,
  processedComboInputPath,
  readComboInputEdits,
  writeComboInputEdits,
};
