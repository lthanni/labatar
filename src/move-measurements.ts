import type { RecordedVideo } from "./recording-types";
import type {
  TechCatalog,
  TechMeasuredField,
  TechMeasurement,
  TechSupportMove,
} from "./tech-types";

function measuredValues(
  recording: RecordedVideo,
): Partial<Record<TechMeasuredField, TechMeasurement>> {
  const take = recording.moveTake;
  const move = recording.analysis?.moves.find(
    (candidate) => candidate.id === take?.validation.matchedAnalysisMoveId,
  );
  if (!take || !move) return {};
  const source = (value: number | null | undefined): TechMeasurement | undefined =>
    typeof value === "number" && Number.isFinite(value)
      ? {
          value,
          recordingId: recording.id,
          analysisMoveId: move.id,
          startTime: move.startTime,
          endTime: move.endTime,
          startFrame: Math.round(
            move.startTime * (recording.analysis?.timing?.nominalFrameRate ?? 60),
          ),
          endFrame: Math.round(move.endTime * (recording.analysis?.timing?.nominalFrameRate ?? 60)),
          frameRate: recording.analysis?.timing?.nominalFrameRate ?? 60,
        }
      : undefined;
  const entries: Partial<Record<TechMeasuredField, TechMeasurement | undefined>> =
    take.outcome === "whiff"
      ? {
          startup: source(move.phases.startup),
          active: source(move.phases.active),
          recovery: source(move.phases.recovery),
        }
      : take.outcome === "block"
        ? {
            blockstun: source(move.opponentPhases.blockstun),
            onBlock: source(move.onBlock),
          }
        : take.outcome === "hit-grounded"
          ? {
              hitstunGrounded: source(move.opponentPhases.hitstun),
              onHitGrounded: source(move.onHit),
            }
          : take.outcome === "hit-airborne"
            ? {
                hitstunAirborne: source(move.opponentPhases.hitstun),
                onHitAirborne: source(move.onHit),
              }
            : {};
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  ) as Partial<Record<TechMeasuredField, TechMeasurement>>;
}

const legacyField: Partial<
  Record<TechMeasuredField, "startup" | "active" | "recovery" | "onBlock" | "blockstun">
> = {
  startup: "startup",
  active: "active",
  recovery: "recovery",
  onBlock: "onBlock",
  blockstun: "blockstun",
};

/** Only a reviewed take may update the catalog. The first value is the shared baseline. */
export function applyAcceptedMeasurements(
  catalog: TechCatalog,
  recording: RecordedVideo,
  character: string,
  support: string,
  recordings: RecordedVideo[] = [],
): TechCatalog {
  const base = catalog[character]?.moves.find((move) => move.id === recording.moveTake?.moveId);
  if (!base) return catalog;
  const values = measuredValues(recording);
  if (Object.keys(values).length === 0) return catalog;
  const baseline = { ...base, evidence: { ...base.evidence } };
  const existing = catalog[character].supportMoves?.find(
    (entry) => entry.baseMoveId === base.id && entry.support === support,
  );
  const override: TechSupportMove = existing
    ? { ...existing, sources: { ...existing.sources }, measurements: { ...existing.measurements } }
    : {
        id: `${base.id}/support/${encodeURIComponent(support)}`,
        character,
        support,
        baseMoveId: base.id,
        sources: {},
        measurements: {},
      };
  for (const [key, measurement] of Object.entries(values) as Array<
    [TechMeasuredField, TechMeasurement]
  >) {
    override.sources![key] = measurement;
    const old = baseline.evidence?.[key];
    const field = legacyField[key];
    const manualValue = field ? base[field] : null;
    const oldTake = recordings.find((item) => item.id === old?.recordingId)?.moveTake;
    if (old && oldTake?.characterId === recording.moveTake?.characterId) {
      baseline.evidence![key] = measurement;
      if (field) baseline[field] = measurement.value;
      delete override.measurements[key];
    } else if (!old && manualValue == null) {
      baseline.evidence![key] = measurement;
      if (field) baseline[field] = measurement.value;
    } else if (old?.value === measurement.value || (!old && manualValue === measurement.value)) {
      if (!old) baseline.evidence![key] = measurement;
      delete override.measurements[key];
    } else {
      override.measurements[key] = measurement;
    }
  }
  const supportMoves = (catalog[character].supportMoves ?? []).filter(
    (entry) => entry.id !== override.id,
  );
  if (Object.keys(override.sources ?? {}).length > 0) supportMoves.push(override);
  return {
    ...catalog,
    [character]: {
      ...catalog[character],
      moves: catalog[character].moves.map((move) => (move.id === base.id ? baseline : move)),
      supportMoves,
    },
  };
}

export function removeRecordingMeasurements(
  catalog: TechCatalog,
  recordingId: string,
): TechCatalog {
  let changed = false;
  const next = Object.fromEntries(
    Object.entries(catalog).map(([character, data]) => {
      const moves = data.moves.map((move) => {
        if (!move.evidence) return move;
        const evidence = { ...move.evidence };
        for (const key of Object.keys(evidence) as TechMeasuredField[]) {
          if (evidence[key]?.recordingId !== recordingId) continue;
          const oldValue = evidence[key]?.value;
          const replacement = data.supportMoves
            ?.map((entry) => entry.sources?.[key])
            .find(
              (source) => source && source.recordingId !== recordingId && source.value === oldValue,
            );
          delete evidence[key];
          if (replacement) evidence[key] = replacement;
          changed = true;
          const field = legacyField[key];
          if (field && !replacement) move = { ...move, [field]: null };
        }
        return { ...move, evidence };
      });
      const supportMoves = data.supportMoves
        ?.map((entry) => {
          const measurements = { ...entry.measurements };
          const sources = { ...entry.sources };
          for (const key of Object.keys(measurements) as TechMeasuredField[]) {
            if (measurements[key]?.recordingId !== recordingId) continue;
            delete measurements[key];
            changed = true;
          }
          for (const key of Object.keys(sources) as TechMeasuredField[]) {
            if (sources[key]?.recordingId !== recordingId) continue;
            delete sources[key];
            changed = true;
          }
          return { ...entry, sources, measurements };
        })
        .filter((entry) => Object.keys(entry.sources ?? {}).length > 0);
      return [character, { ...data, moves, supportMoves }];
    }),
  ) as TechCatalog;
  return changed ? next : catalog;
}

export function effectiveMeasurement(
  catalog: TechCatalog,
  character: string,
  support: string,
  moveId: string,
  field: TechMeasuredField,
): TechMeasurement | null {
  const data = catalog[character];
  const variant = data?.supportMoves?.find(
    (entry) => entry.baseMoveId === moveId && entry.support === support,
  );
  return (
    variant?.sources?.[field] ??
    variant?.measurements[field] ??
    data?.moves.find((move) => move.id === moveId)?.evidence?.[field] ??
    null
  );
}
