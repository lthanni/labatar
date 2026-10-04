import type { MoveTakeOutcome } from "./move-capture-types";
import type { RecordedVideo } from "./recording-types";
import type { TechMove } from "./tech-types";

export function takesForSlot(
  recordings: RecordedVideo[],
  variantId: string,
  moveId: string,
  outcome: MoveTakeOutcome,
) {
  return recordings.filter(
    (recording) =>
      recording.moveTake?.catalogMoveId === `${variantId}/${moveId}` &&
      recording.moveTake.outcome === outcome,
  );
}

export function slotStatus(
  move: TechMove,
  outcome: MoveTakeOutcome,
  takes: RecordedVideo[],
): "not-applicable" | "complete" | "pending" | "needs-redo" | "missing" {
  if (move.notApplicable?.[outcome]?.trim()) return "not-applicable";
  if (takes.some((take) => take.moveTake?.evidenceStatus === "active")) return "complete";
  if (takes.some((take) => take.moveTake?.evidenceStatus === "pending")) return "pending";
  return takes.length ? "needs-redo" : "missing";
}

export function gatherMoves(
  moves: TechMove[],
  recordings: RecordedVideo[],
  variantId: string,
  outcome: MoveTakeOutcome,
  attemptedMoveIds: ReadonlySet<string>,
) {
  return moves.filter((move) => {
    if (attemptedMoveIds.has(move.id)) return false;
    const status = slotStatus(move, outcome, takesForSlot(recordings, variantId, move.id, outcome));
    return status === "missing" || status === "needs-redo";
  });
}

/** Captured, pending videos that have not had an analysis saved yet. */
export function unprocessedMoveTakes(recordings: RecordedVideo[], variantId: string) {
  return recordings
    .filter(
      (recording) =>
        recording.moveTake?.characterId === variantId &&
        recording.moveTake.status === "captured" &&
        recording.moveTake.evidenceStatus === "pending" &&
        !recording.moveTake.storageError &&
        !recording.analysis,
    )
    .sort((left, right) => left.modifiedAt - right.modifiedAt);
}

/** Describe what processing found without implying that the intended outcome was proven. */
export function moveTakeOutcomeSummary(recording: RecordedVideo) {
  const take = recording.moveTake;
  if (!take) return { result: "No move take", detail: "" };
  if (!recording.analysis) {
    return { result: "Unprocessed", detail: "No analysis saved yet." };
  }
  const validation = take.validation;
  const matched = recording.analysis.moves.find(
    (move) => move.id === validation.matchedAnalysisMoveId,
  );
  const result =
    validation.status === "verified"
      ? "Input matched"
      : validation.status === "mismatch"
        ? "Input mismatch"
        : "Needs review";
  if (!matched) return { result, detail: validation.message };
  const phases = matched.phases;
  const contact = matched.hits?.some((hit) => hit.status === "blocked")
    ? "blocked"
    : matched.hits?.some((hit) => hit.status === "hit")
      ? "hit"
      : "unconfirmed";
  const numbers = [
    `startup ${phases.startup}`,
    `active ${phases.active}`,
    `recovery ${phases.recovery}`,
  ];
  if (take.outcome === "block") {
    numbers.push(`blockstun ${matched.opponentPhases.blockstun}`);
    if (matched.onBlock != null)
      numbers.push(`on block ${matched.onBlock >= 0 ? "+" : ""}${matched.onBlock}`);
  } else if (take.outcome === "hit-grounded" || take.outcome === "hit-airborne") {
    numbers.push(`hitstun ${matched.opponentPhases.hitstun}`);
    if (matched.onHit != null)
      numbers.push(`on hit ${matched.onHit >= 0 ? "+" : ""}${matched.onHit}`);
  }
  return {
    result,
    detail: `Observed ${matched.observedNotation ?? matched.notation ?? "unknown input"} · contact signal ${contact} · ${numbers.join(" · ")}`,
  };
}
