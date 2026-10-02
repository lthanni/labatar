import type {
  RecordingAnalysis,
  RecordingAnalysisInputEvent,
  RecordingAnalysisState,
  RecordingAnalysisStateOverride,
} from "./recording-analysis-types";

function findEventForOverride(
  override: RecordingAnalysisStateOverride,
  events: RecordingAnalysisInputEvent[],
) {
  const exact = events.find((event) => event.id === override.inputEventId);
  if (exact) return exact;

  const matchingOccurrence = events.find(
    (event) => event.notation === override.notation && event.occurrence === override.occurrence,
  );
  if (matchingOccurrence) return matchingOccurrence;

  return events
    .filter((event) => event.notation === override.notation)
    .sort(
      (left, right) => Math.abs(left.time - override.time) - Math.abs(right.time - override.time),
    )[0];
}

function notationWithAirborneState(notation: string | null) {
  if (!notation || notation.startsWith("j.")) return notation;

  // Aerial prefixes apply to normal attacks such as 2C, 5B, or 5F. Motion
  // inputs such as 236C remain unchanged; their move-specific resolver can
  // provide a more appropriate canonical name later.
  return /^[1-9][A-Za-z]+$/.test(notation) ? `j.${notation}` : notation;
}

export function resolveInputStates(
  analysis: RecordingAnalysis,
  overrides: RecordingAnalysisStateOverride[] = analysis.stateOverrides ?? [],
) {
  const events = analysis.inputEvents ?? [];
  const eventById = new Map(events.map((event) => [event.id, event]));
  const overrideByEventId = new Map<string, RecordingAnalysisStateOverride>();

  for (const override of overrides) {
    const event = findEventForOverride(override, events);
    if (event && eventById.has(event.id)) {
      overrideByEventId.set(event.id, { ...override, inputEventId: event.id });
    }
  }

  const states = new Map<string, RecordingAnalysisState>();
  let state: RecordingAnalysisState = "grounded";
  for (const event of events) {
    const override = overrideByEventId.get(event.id);
    if (override) state = override.state;
    states.set(event.id, state);
  }

  return { states, overrides: [...overrideByEventId.values()] };
}

export function applyManualInputStateOverrides(
  analysis: RecordingAnalysis,
  overrides: RecordingAnalysisStateOverride[] = analysis.stateOverrides ?? [],
): RecordingAnalysis {
  const resolved = resolveInputStates(analysis, overrides);
  const moves = analysis.moves.map((move) => {
    const observedNotation = move.observedNotation ?? move.notation;
    const state = move.inputEventId ? resolved.states.get(move.inputEventId) : "grounded";
    return {
      ...move,
      observedNotation,
      notation:
        state === "airborne" ? notationWithAirborneState(observedNotation) : observedNotation,
    };
  });

  return {
    ...analysis,
    moves,
    stateOverrides: resolved.overrides,
  };
}

export function stateOverrideForEvent(analysis: RecordingAnalysis, inputEventId: string) {
  return (analysis.stateOverrides ?? []).find((override) => override.inputEventId === inputEventId);
}
