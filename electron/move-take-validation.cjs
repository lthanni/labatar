function normalizedNotation(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function stanceInputMatches(expectedInput, observedInput) {
  const expected = normalizedNotation(expectedInput).replaceAll("[", "").replaceAll("]", "");
  const observed = normalizedNotation(observedInput);
  const match = /^([1-9])(EX|SUP|AA|A|B|C|F|X)$/.exec(observed);
  return Boolean(match && match[2] === expected);
}

function observedInput(move, inputEvents) {
  if (typeof move?.observedNotation === "string" && move.observedNotation.trim()) {
    return move.observedNotation.trim();
  }
  if (typeof move?.notation === "string" && move.notation.trim()) return move.notation.trim();
  const event = inputEvents.find((candidate) => candidate?.id === move?.inputEventId);
  return typeof event?.notation === "string" && event.notation.trim()
    ? event.notation.trim()
    : null;
}

function validateMoveTake(moveTake, analysis) {
  const expectedInputs = Array.isArray(moveTake?.expectedInputs)
    ? moveTake.expectedInputs.filter((input) => typeof input === "string" && input.trim())
    : [];
  const expected = new Set(
    expectedInputs.map((input) =>
      normalizedNotation(
        moveTake?.isCharged === true ? input.replaceAll("[", "").replaceAll("]", "") : input,
      ),
    ),
  );
  const moves = Array.isArray(analysis?.moves) ? analysis.moves : [];
  const inputEvents = Array.isArray(analysis?.inputEvents) ? analysis.inputEvents : [];
  const candidates = moves
    .map((move) => ({
      id: typeof move?.id === "string" ? move.id : null,
      observed: observedInput(move, inputEvents),
    }))
    .filter((candidate) => candidate.observed);
  const observedInputs = [...new Set(candidates.map((candidate) => candidate.observed))];
  const base = {
    expectedInputs,
    observedInputs,
    matchedAnalysisMoveId: null,
    processedAt: new Date().toISOString(),
  };

  if (expected.size === 0) {
    return {
      ...base,
      status: "unresolved",
      message: "The catalog has no expected observed input.",
    };
  }
  if (candidates.length === 0) {
    return {
      ...base,
      status: "unresolved",
      message: "The processor found no move input to compare with this armed take.",
    };
  }
  const matches = candidates.filter(
    (candidate) =>
      expected.has(normalizedNotation(candidate.observed)) ||
      (moveTake?.isStance === true &&
        expectedInputs.some((input) => stanceInputMatches(input, candidate.observed))),
  );
  if (matches.length === 0) {
    return {
      ...base,
      status: "mismatch",
      message: `Expected ${expectedInputs.join(" or ")}; observed ${observedInputs.join(", ")}.`,
    };
  }
  if (matches.length !== 1 || candidates.length !== 1) {
    return {
      ...base,
      status: "ambiguous",
      message: "More than one detected move was present; select the intended take after review.",
    };
  }
  if (moveTake?.isCharged === true) {
    return {
      ...base,
      status: "unresolved",
      message: `Observed ${matches[0].observed}, but hold duration has not been verified.`,
    };
  }
  return {
    ...base,
    status: "verified",
    message: `Observed ${matches[0].observed} for the armed move.`,
    matchedAnalysisMoveId: matches[0].id,
  };
}

/** Link a reviewed take to its framebar episode without consulting input detection. */
function validateCapturedMoveTake(moveTake, analysis) {
  const moves = Array.isArray(analysis?.moves) ? analysis.moves : [];
  const expectedInputs = Array.isArray(moveTake?.expectedInputs)
    ? moveTake.expectedInputs.filter((input) => typeof input === "string" && input.trim())
    : [];
  const base = {
    expectedInputs,
    observedInputs: [],
    matchedAnalysisMoveId: null,
    processedAt: new Date().toISOString(),
  };
  if (moves.length === 0) {
    return {
      ...base,
      status: "unresolved",
      message:
        "No framebar move episode was detected in this take. Review the clip and calibration.",
    };
  }
  const aaMatch = /^(2|5)AA$/.exec(normalizedNotation(moveTake?.moveLabel));
  if (aaMatch) {
    if (
      moves.length !== 2 ||
      moves.some((move) => typeof move?.id !== "string" || !move.id.trim())
    ) {
      return {
        ...base,
        status: "ambiguous",
        message: `Expected a ${aaMatch[1]}A action followed by ${aaMatch[1]}AA in the framebar. Review the clip.`,
      };
    }
    return {
      ...base,
      status: "verified",
      message: `The ${aaMatch[1]}AA framebar action was linked to the selected take; the preceding action remains ${aaMatch[1]}A. Input history was not read.`,
      matchedAnalysisMoveId: moves[1].id,
    };
  }
  if (moves.length !== 1 || typeof moves[0]?.id !== "string" || !moves[0].id.trim()) {
    return {
      ...base,
      status: "ambiguous",
      message:
        "The take did not contain exactly one identifiable framebar move episode. Review the clip.",
    };
  }
  return {
    ...base,
    status: "verified",
    message:
      "One framebar move episode was linked to the selected capture. Input history was not read.",
    matchedAnalysisMoveId: moves[0].id,
  };
}

module.exports = { validateMoveTake, validateCapturedMoveTake };
