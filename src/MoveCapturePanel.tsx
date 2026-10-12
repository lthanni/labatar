import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useObsRecording } from "./ObsRecordingContext";
import type { DevBlackoutStatus } from "./dev-blackout-types";
import { withCommonTechMoves } from "./common-tech-moves";
import { linkLegacyChargedMoves } from "./charged-move-variants";
import {
  automatedMoveEligibility,
  gatherMoves,
  moveCaptureComplete,
  moveTakeOutcomeSummary,
  slotStatus,
  takesForSlot,
  unprocessedMoveTakes,
} from "./move-capture-workflow";
import { processMoveTake } from "./process-move-take";
import {
  applyAcceptedMeasurements,
  effectiveMeasurement,
  removeRecordingMeasurements,
} from "./move-measurements";
import {
  moveTakeOutcomes,
  type KnownMoveCaptureVariant,
  type MoveTakeOutcome,
} from "./move-capture-types";
import {
  isFlowCancellableByDefault,
  normalizeMoveNotation,
  parseMoveNotation,
} from "./move-notation";
import type { RecordedVideo } from "./recording-types";
import { RecordingViewer } from "./RecordingViewer";
import {
  techCatalogStorageKey,
  techCatalogUpdatedEvent,
  type TechMove,
  type TechCatalog,
  type TechMeasuredField,
} from "./tech-types";

const outcomes: Array<{ value: MoveTakeOutcome; label: string; description: string }> = [
  {
    value: "whiff",
    label: "Whiff",
    description: "Startup, active/recovery, and visible hitbox tracks.",
  },
  {
    value: "block",
    label: "Block",
    description: "Blockstun, blocked recovery, and on-block evidence.",
  },
  {
    value: "hit-grounded",
    label: "Hit grounded",
    description: "Hitstun and on-hit evidence while the opponent is grounded.",
  },
  {
    value: "hit-airborne",
    label: "Hit airborne",
    description: "Hitstun and on-hit evidence while the opponent is airborne.",
  },
];

const selectedOutcomeStorageKey = "moveCapture:selectedOutcome";

function VideoRowButton({
  recording,
  selected,
  onSelect,
  children,
}: {
  recording: RecordedVideo;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <ButtonBase
      component="div"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      aria-label={`Watch ${recording.name}`}
      aria-pressed={selected}
      sx={{
        width: "100%",
        minWidth: 0,
        px: 1,
        py: 0.75,
        border: "1px solid",
        borderColor: selected ? "primary.main" : "divider",
        borderRadius: 1,
        bgcolor: selected ? "action.selected" : "transparent",
        justifyContent: "flex-start",
        textAlign: "left",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Stack sx={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</Stack>
    </ButtonBase>
  );
}

function takeWorkflowStatus(recording: RecordedVideo, processingError?: string) {
  const take = recording.moveTake;
  if (take?.storageError) return { label: "Save failed", color: "error.main" };
  if (processingError) return { label: "Failed processing", color: "error.main" };
  if (take?.evidenceStatus === "archived") return { label: "Needs retake", color: "warning.main" };
  if (
    take?.captureMethod === "automated" &&
    take.captureReviewStatus !== "approved-for-processing"
  ) {
    return { label: "Awaiting video approval", color: "warning.main" };
  }
  if (recording.analysis && take?.evidenceStatus === "active") {
    return { label: "Processed and accepted", color: "success.main" };
  }
  if (recording.analysis) {
    return { label: "Processed · review evidence", color: "info.main" };
  }
  if (take?.evidenceStatus === "active") {
    return { label: "Accepted · needs processing", color: "warning.main" };
  }
  if (take?.captureMethod === "automated") {
    return { label: "Approved for processing", color: "info.main" };
  }
  return { label: "Ready to process", color: "text.secondary" };
}

function MoveTakeCard({
  move,
  outcome,
  takes,
  selectedPlaybackId,
  captureReady,
  locked,
  obsRecording,
  batchActive,
  reviewBusy,
  processingTakeId,
  deletingTakeId,
  processingErrors,
  armAllowed = true,
  onArm,
  onWatch,
  onReviewCapture,
  onProcess,
  onReviewEvidence,
  onDelete,
}: {
  move: TechMove;
  outcome: (typeof outcomes)[number];
  takes: RecordedVideo[];
  selectedPlaybackId: string | null;
  captureReady: boolean;
  locked: boolean;
  obsRecording: boolean;
  batchActive: boolean;
  reviewBusy: boolean;
  processingTakeId: string | null;
  deletingTakeId: string | null;
  processingErrors: Record<string, string>;
  armAllowed?: boolean;
  onArm: () => void;
  onWatch: (id: string) => void;
  onReviewCapture: (id: string, action: "approve" | "reject") => void;
  onProcess: (recording: RecordedVideo) => void;
  onReviewEvidence: (id: string) => void;
  onDelete: (recording: RecordedVideo) => void;
}) {
  const status = slotStatus(move, outcome.value, takes);
  const notApplicable = move.notApplicable?.[outcome.value]?.trim();
  const statusLabel = {
    "not-applicable": "Not applicable",
    complete: takes.some((take) => take.moveTake?.evidenceStatus === "pending")
      ? "Retake pending"
      : takes.some((take) => take.moveTake?.evidenceStatus === "active" && take.analysis)
        ? "Processed"
        : "Accepted · needs processing",
    pending: "In progress",
    "needs-redo": "Needs retake",
    missing: "Missing",
  }[status];
  return (
    <Paper variant="outlined" sx={{ p: 1, minWidth: 0 }}>
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            {outcome.label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {statusLabel}
          </Typography>
          {!notApplicable && armAllowed && (
            <Button size="small" disabled={locked || !captureReady} onClick={onArm}>
              Arm
            </Button>
          )}
        </Stack>
        {notApplicable && (
          <Typography variant="caption" color="text.secondary">
            {notApplicable}
          </Typography>
        )}
        {takes.length === 0 && !notApplicable ? (
          <Typography variant="caption" color="text.secondary">
            No take recorded.
          </Typography>
        ) : (
          [...takes]
            .sort((left, right) => right.modifiedAt - left.modifiedAt)
            .map((recording) => {
              const take = recording.moveTake;
              const failure = processingErrors[recording.id];
              const state = takeWorkflowStatus(recording, failure);
              const awaitingVideoReview =
                take?.captureMethod === "automated" &&
                take.captureReviewStatus !== "approved-for-processing" &&
                take.evidenceStatus === "pending" &&
                !take.storageError;
              const canProcess =
                (take?.evidenceStatus === "pending" ||
                  (take?.evidenceStatus === "active" && !recording.analysis)) &&
                !awaitingVideoReview &&
                !take.storageError;
              const canDelete = take?.status === "captured" && !awaitingVideoReview;
              const summary = recording.analysis ? moveTakeOutcomeSummary(recording) : null;
              return (
                <Stack key={recording.id} spacing={0.5} sx={{ minWidth: 0 }}>
                  <VideoRowButton
                    recording={recording}
                    selected={selectedPlaybackId === recording.id}
                    onSelect={() => onWatch(recording.id)}
                  >
                    <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                      {recording.name}
                    </Typography>
                  </VideoRowButton>
                  <Typography variant="caption" color={state.color}>
                    {state.label}
                    {summary ? ` · ${summary.result}` : ""}
                  </Typography>
                  {(failure || take?.storageError || summary?.detail) && (
                    <Typography
                      variant="caption"
                      color={failure || take?.storageError ? "error" : "text.secondary"}
                      sx={{ overflowWrap: "anywhere" }}
                    >
                      {failure ?? take?.storageError ?? summary?.detail}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                    {awaitingVideoReview && (
                      <>
                        <Button
                          size="small"
                          disabled={reviewBusy || batchActive}
                          onClick={() => onReviewCapture(recording.id, "approve")}
                        >
                          Approve video
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          disabled={reviewBusy || batchActive}
                          onClick={() => onReviewCapture(recording.id, "reject")}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {canProcess && (
                      <Button
                        size="small"
                        disabled={
                          Boolean(processingTakeId) || obsRecording || reviewBusy || batchActive
                        }
                        onClick={() => onProcess(recording)}
                      >
                        {processingTakeId === recording.id
                          ? "Processing..."
                          : recording.analysis
                            ? "Reprocess"
                            : "Process"}
                      </Button>
                    )}
                    {take?.evidenceStatus === "pending" && recording.analysis && (
                      <Button
                        size="small"
                        disabled={
                          reviewBusy ||
                          batchActive ||
                          Boolean(processingTakeId) ||
                          !take.validation.matchedAnalysisMoveId ||
                          take.validation.status === "mismatch"
                        }
                        onClick={() => onReviewEvidence(recording.id)}
                      >
                        Accept evidence
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="small"
                        color="error"
                        disabled={
                          locked ||
                          batchActive ||
                          Boolean(processingTakeId) ||
                          Boolean(deletingTakeId) ||
                          reviewBusy
                        }
                        onClick={() => onDelete(recording)}
                      >
                        Delete take
                      </Button>
                    )}
                  </Stack>
                </Stack>
              );
            })
        )}
      </Stack>
    </Paper>
  );
}

function readTechMoves(character: string): TechMove[] {
  try {
    const stored = JSON.parse(localStorage.getItem(techCatalogStorageKey) ?? "{}");
    const moves = stored?.[character]?.moves;
    const savedMoves: TechMove[] = Array.isArray(moves)
      ? moves
          .filter((move) => typeof move?.id === "string" && typeof move?.input === "string")
          .map((move) => ({
            ...move,
            character,
            input:
              normalizeMoveNotation(move.input, {
                allowDirectionless: Boolean(move.dependsOnMoveId),
              }) ?? move.input,
            isStanceParent: move.isStanceParent === true || move.isRekka === true,
            stanceFollowupPattern: move.stanceFollowupPattern ?? move.rekkaFollowupPattern ?? null,
            stanceMinimumDuration: move.stanceMinimumDuration ?? move.rekkaMinimumDuration ?? null,
            chargedMoveId: move.chargedMoveId ?? null,
            baseMoveId: move.baseMoveId ?? null,
            isCharged: move.isCharged === true,
            nonstandard: move.nonstandard === true,
            nonstandardNote: typeof move.nonstandardNote === "string" ? move.nonstandardNote : "",
            flowCancellable:
              typeof move.flowCancellable === "boolean"
                ? move.flowCancellable
                : isFlowCancellableByDefault(move.input, {
                    allowDirectionless: Boolean(move.dependsOnMoveId),
                  }),
          }))
          .filter(
            (move) =>
              parseMoveNotation(move.input, { allowDirectionless: Boolean(move.dependsOnMoveId) })
                .ok,
          )
      : [];
    return linkLegacyChargedMoves(withCommonTechMoves(character, savedMoves));
  } catch {
    return withCommonTechMoves(character, []);
  }
}

export function MoveCapturePanel({
  active,
  blackoutStatus,
  refreshBlackoutStatus,
}: {
  active: boolean;
  blackoutStatus: DevBlackoutStatus;
  refreshBlackoutStatus: () => Promise<void>;
}) {
  const {
    busy: obsBusy,
    moveCapture,
    armMoveCapture,
    disarmMoveCapture,
    state: obsState,
  } = useObsRecording();
  const [knownVariants, setKnownVariants] = useState<KnownMoveCaptureVariant[]>([]);
  const [techMoves, setTechMoves] = useState<TechMove[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [selectedMoveId, setSelectedMoveId] = useState("");
  const [allRecordings, setAllRecordings] = useState<RecordedVideo[]>([]);
  const [recordingsRevision, setRecordingsRevision] = useState(0);
  const [selectedPlaybackId, setSelectedPlaybackId] = useState<string | null>(null);
  const [showCompletedMoves, setShowCompletedMoves] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState<MoveTakeOutcome>(() => {
    const saved = localStorage.getItem(selectedOutcomeStorageKey);
    return moveTakeOutcomes.find((outcome) => outcome === saved) ?? "whiff";
  });
  const [gatherMode, setGatherMode] = useState<MoveTakeOutcome | null>(null);
  const [attemptedMoveIds, setAttemptedMoveIds] = useState<Set<string>>(new Set());
  const [gatherComplete, setGatherComplete] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RecordedVideo | null>(null);
  const [deletingTakeId, setDeletingTakeId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [processingTakeId, setProcessingTakeId] = useState<string | null>(null);
  const [processingErrors, setProcessingErrors] = useState<Record<string, string>>({});
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchResults, setBatchResults] = useState<Record<string, string>>({});
  const batchRunning = useRef(false);
  const previousActiveTake = useRef<typeof moveCapture.active>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [automaticFacing, setAutomaticFacing] = useState<"Right" | "Left">("Right");
  const [chargeHoldMs, setChargeHoldMs] = useState(1000);
  const [automaticRun, setAutomaticRun] = useState<{
    status: "idle" | "countdown" | "running" | "paused" | "completed" | "cancelled" | "error";
    index: number;
    total: number;
    currentMove: string | null;
    phase: string;
    error: string | null;
    runId?: string;
    outcome?: MoveTakeOutcome;
  }>({ status: "idle", index: 0, total: 0, currentMove: null, phase: "", error: null });
  const [automaticControlAction, setAutomaticControlAction] = useState<
    "pause" | "resume" | "cancel" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [blackoutLaunching, setBlackoutLaunching] = useState(false);

  const startBlackoutGame = async () => {
    const api = window.electronAPI?.devBlackout;
    if (!api || !selectedKnownVariant) return;
    setBlackoutLaunching(true);
    setError(null);
    try {
      await api.start({ testedCharacter: selectedKnownVariant.character });
      await refreshBlackoutStatus();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
      await refreshBlackoutStatus();
    } finally {
      setBlackoutLaunching(false);
    }
  };

  const retryBlackoutRestore = async () => {
    const api = window.electronAPI?.devBlackout;
    if (!api) return;
    setError(null);
    try {
      await api.restore();
      await refreshBlackoutStatus();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : String(restoreError));
    }
  };

  const selectedKnownVariant = useMemo(
    () => knownVariants.find((variant) => variant.id === selectedCharacterId) ?? null,
    [knownVariants, selectedCharacterId],
  );
  const availableMoves = useMemo(
    () => techMoves.filter((move) => move.character === selectedKnownVariant?.character),
    [techMoves, selectedKnownVariant],
  );
  const selectedMove = useMemo(
    () => availableMoves.find((move) => move.id === selectedMoveId) ?? null,
    [availableMoves, selectedMoveId],
  );
  const moveTakes = useMemo(
    () =>
      selectedKnownVariant && selectedMove
        ? allRecordings.filter(
            (recording) =>
              recording.moveTake?.catalogMoveId === `${selectedKnownVariant.id}/${selectedMove.id}`,
          )
        : [],
    [allRecordings, selectedKnownVariant, selectedMove],
  );
  const gatherQueue = useMemo(
    () =>
      gatherMode && selectedKnownVariant
        ? gatherMoves(
            availableMoves,
            allRecordings,
            selectedKnownVariant.id,
            gatherMode,
            attemptedMoveIds,
          )
        : [],
    [allRecordings, attemptedMoveIds, availableMoves, gatherMode, selectedKnownVariant],
  );
  const automatedPreview = useMemo(
    () =>
      selectedKnownVariant
        ? availableMoves.map((move) => ({
            move,
            eligibility: automatedMoveEligibility(
              move,
              allRecordings,
              selectedKnownVariant.id,
              selectedOutcome,
              new Set(),
              automaticFacing,
            ),
          }))
        : [],
    [allRecordings, availableMoves, automaticFacing, selectedKnownVariant, selectedOutcome],
  );
  const automaticQueue = useMemo(
    () =>
      automatedPreview
        .filter(({ eligibility }) => eligibility.eligible)
        .map(({ move }) => ({ id: move.id, input: move.input })),
    [automatedPreview],
  );
  const completedMoveIds = useMemo(
    () =>
      new Set(
        selectedKnownVariant
          ? availableMoves
              .filter((move) =>
                moveCaptureComplete(move, allRecordings, selectedKnownVariant.id, selectedOutcome),
              )
              .map((move) => move.id)
          : [],
      ),
    [allRecordings, availableMoves, selectedKnownVariant, selectedOutcome],
  );
  const visibleMoves = showCompletedMoves
    ? availableMoves
    : availableMoves.filter((move) => !completedMoveIds.has(move.id));
  const unprocessedTakes = useMemo(
    () =>
      selectedKnownVariant
        ? unprocessedMoveTakes(allRecordings, selectedKnownVariant.id).filter(
            (recording) => recording.moveTake?.outcome === selectedOutcome,
          )
        : [],
    [allRecordings, selectedKnownVariant, selectedOutcome],
  );
  const selectedMoveTakes = moveTakes.filter(
    (recording) => recording.moveTake?.outcome === selectedOutcome,
  );
  const selectedPlayback =
    selectedMoveTakes.find((recording) => recording.id === selectedPlaybackId) ??
    selectedMoveTakes.find((recording) => recording.moveTake?.evidenceStatus === "pending") ??
    selectedMoveTakes[0] ??
    null;

  const loadCatalog = useCallback(async () => {
    if (!window.electronAPI?.moveCatalog) return;
    setError(null);
    try {
      const variants = await window.electronAPI.moveCatalog.knownVariants();
      setKnownVariants(variants);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  const loadMoveEvidence = useCallback(async () => {
    if (!window.electronAPI?.recordings) return null;
    setEvidenceLoading(true);
    try {
      const result = await window.electronAPI.recordings.list({ analysisScope: "move-takes" });
      setAllRecordings(result.recordings);
      setRecordingsRevision((revision) => revision + 1);
      return result.recordings;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      return null;
    } finally {
      setEvidenceLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    localStorage.setItem(selectedOutcomeStorageKey, selectedOutcome);
  }, [selectedOutcome]);

  useEffect(() => {
    const activeOutcome = ["countdown", "running", "paused"].includes(automaticRun.status)
      ? automaticRun.outcome
      : moveCapture.armed?.outcome;
    if (activeOutcome && moveTakeOutcomes.some((outcome) => outcome === activeOutcome)) {
      setSelectedOutcome(activeOutcome);
    }
  }, [automaticRun.outcome, automaticRun.status, moveCapture.armed?.outcome]);

  useEffect(() => {
    const api = window.electronAPI?.moveCapture;
    if (!api?.automaticStatus || !api.onAutomaticState) return;
    const unsubscribe = api.onAutomaticState((nextRun) => {
      setAutomaticRun(nextRun);
      if (nextRun.status === "completed" || nextRun.status === "cancelled") {
        setSelectedPlaybackId(null);
        void loadMoveEvidence();
      }
    });
    void api
      .automaticStatus()
      .then(setAutomaticRun)
      .catch((statusError) => {
        setError(statusError instanceof Error ? statusError.message : String(statusError));
      });
    return unsubscribe;
  }, [loadMoveEvidence]);

  useEffect(() => {
    if (knownVariants.length === 0) return;
    const variant = knownVariants.find((candidate) => candidate.id === selectedCharacterId);
    const nextVariant = variant ?? knownVariants[0] ?? null;
    if (nextVariant?.id !== selectedCharacterId) setSelectedCharacterId(nextVariant?.id ?? "");
    const syncMoves = () => setTechMoves(nextVariant ? readTechMoves(nextVariant.character) : []);
    syncMoves();
    window.addEventListener(techCatalogUpdatedEvent, syncMoves);
    window.addEventListener("storage", syncMoves);
    return () => {
      window.removeEventListener(techCatalogUpdatedEvent, syncMoves);
      window.removeEventListener("storage", syncMoves);
    };
  }, [knownVariants, selectedCharacterId]);

  useEffect(() => {
    if (!availableMoves.some((move) => move.id === selectedMoveId)) {
      setSelectedMoveId(availableMoves[0]?.id ?? "");
    }
  }, [availableMoves, selectedMoveId]);

  useEffect(() => {
    void loadMoveEvidence();
  }, [loadMoveEvidence]);

  const armMove = useCallback(
    async (move: TechMove, mode: MoveTakeOutcome, variant: KnownMoveCaptureVariant) => {
      const armed = await armMoveCapture({
        characterId: variant.id,
        moveId: move.id,
        moveInput: move.input,
        isStance: Boolean(move.dependsOnMoveId),
        isCharged: move.isCharged,
        outcome: mode,
      });
      if (armed) setSelectedMoveId(move.id);
      return armed;
    },
    [armMoveCapture],
  );

  const startGather = useCallback(
    async (mode: MoveTakeOutcome) => {
      if (!selectedKnownVariant || obsState.recording.active) return;
      const recordings = await loadMoveEvidence();
      if (!recordings) return;
      const queue = gatherMoves(
        availableMoves,
        recordings,
        selectedKnownVariant.id,
        mode,
        new Set(),
      );
      if (queue[0] && !(await armMove(queue[0], mode, selectedKnownVariant))) {
        setError("Could not arm the first move. Check the recording controls and try again.");
        return;
      }
      setAttemptedMoveIds(new Set());
      setGatherMode(mode);
      setGatherComplete(queue.length === 0);
      if (!queue[0]) await disarmMoveCapture();
    },
    [
      armMove,
      availableMoves,
      disarmMoveCapture,
      loadMoveEvidence,
      obsState.recording.active,
      selectedKnownVariant,
    ],
  );

  useEffect(() => {
    if (moveCapture.active) {
      previousActiveTake.current = moveCapture.active;
      return;
    }
    const completedTake = previousActiveTake.current;
    previousActiveTake.current = null;
    if (!completedTake) return;
    void (async () => {
      const recordings = await loadMoveEvidence();
      if (!recordings) return;
      if (
        !gatherMode ||
        !selectedKnownVariant ||
        completedTake.characterId !== selectedKnownVariant.id ||
        completedTake.outcome !== gatherMode
      )
        return;
      const saved = recordings.find((recording) => recording.moveTake?.id === completedTake.id);
      if (!saved || saved.moveTake?.storageError) {
        setError(
          saved?.moveTake?.storageError ?? "The move video was not saved. Record this move again.",
        );
        return;
      }
      const attempted = new Set(attemptedMoveIds);
      attempted.add(completedTake.moveId);
      setAttemptedMoveIds(attempted);
      const next = gatherMoves(
        availableMoves,
        recordings,
        selectedKnownVariant.id,
        gatherMode,
        attempted,
      )[0];
      if (next) {
        if (!(await armMove(next, gatherMode, selectedKnownVariant)))
          setError("The next move could not be armed. End and restart gather mode to retry.");
      } else {
        setGatherComplete(true);
        await disarmMoveCapture();
      }
    })();
  }, [
    armMove,
    attemptedMoveIds,
    availableMoves,
    disarmMoveCapture,
    gatherMode,
    loadMoveEvidence,
    moveCapture.active,
    selectedKnownVariant,
  ]);

  const processOneTake = async (recording: RecordedVideo) => {
    setProcessingTakeId(recording.id);
    setProcessingErrors((current) => {
      const next = { ...current };
      delete next[recording.id];
      return next;
    });
    try {
      const processed = await processMoveTake(recording);
      const summary = moveTakeOutcomeSummary(processed);
      setBatchResults((current) => ({ ...current, [recording.id]: summary.result }));
      return processed;
    } catch (processingError) {
      const message =
        processingError instanceof Error ? processingError.message : String(processingError);
      setProcessingErrors((current) => ({
        ...current,
        [recording.id]: message,
      }));
      setBatchResults((current) => ({ ...current, [recording.id]: "Processing failed" }));
      return null;
    } finally {
      setProcessingTakeId(null);
    }
  };

  const processTake = async (recording: RecordedVideo) => {
    if (batchRunning.current) return;
    await processOneTake(recording);
    await loadMoveEvidence();
  };

  const reviewAutomatedCapture = async (recordingId: string, action: "approve" | "reject") => {
    const recordingsApi = window.electronAPI?.recordings;
    if (!recordingsApi?.reviewCapture) return;
    setReviewBusy(true);
    setError(null);
    try {
      await recordingsApi.reviewCapture({
        recordingId,
        action,
      });
      await loadMoveEvidence();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
    } finally {
      setReviewBusy(false);
    }
  };

  const deleteMoveTake = async () => {
    const api = window.electronAPI?.recordings;
    if (!api?.deleteMoveTake || !deleteTarget || batchRunning.current || processingTakeId) return;
    const recordingId = deleteTarget.id;
    setDeletingTakeId(recordingId);
    setDeleteError(null);
    try {
      const catalog = JSON.parse(
        localStorage.getItem(techCatalogStorageKey) ?? "{}",
      ) as TechCatalog;
      const nextCatalog = removeRecordingMeasurements(catalog, recordingId);
      await api.deleteMoveTake({ recordingId });
      if (nextCatalog !== catalog) {
        localStorage.setItem(techCatalogStorageKey, JSON.stringify(nextCatalog));
        window.dispatchEvent(new Event(techCatalogUpdatedEvent));
      }
      setDeleteTarget(null);
      setBatchResults((current) => {
        const next = { ...current };
        delete next[recordingId];
        return next;
      });
      setProcessingErrors((current) => {
        const next = { ...current };
        delete next[recordingId];
        return next;
      });
      await loadMoveEvidence();
    } catch (deleteActionError) {
      setDeleteError(
        deleteActionError instanceof Error ? deleteActionError.message : String(deleteActionError),
      );
    } finally {
      setDeletingTakeId(null);
    }
  };

  const refreshAutomaticRun = async () => {
    const api = window.electronAPI?.moveCapture;
    if (!api?.automaticStatus) return;
    try {
      setAutomaticRun(await api.automaticStatus());
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    }
  };

  const startAutomaticPass = async () => {
    const api = window.electronAPI?.moveCapture;
    if (
      !api?.automaticStart ||
      !selectedKnownVariant ||
      automaticQueue.length === 0 ||
      obsState.status !== "connected"
    )
      return;
    setError(null);
    try {
      await api.automaticStart({
        variantId: selectedKnownVariant.id,
        moves: automaticQueue,
        facing: automaticFacing,
        outcome: selectedOutcome,
        chargeHoldMs,
      });
      await refreshAutomaticRun();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    }
  };

  const controlAutomaticRun = async (action: "pause" | "resume" | "cancel") => {
    const api = window.electronAPI?.moveCapture;
    if (!api || automaticControlAction) return;
    setAutomaticControlAction(action);
    setError(null);
    try {
      if (action === "pause") await api.automaticPause?.();
      else if (action === "resume") await api.automaticResume?.();
      else await api.automaticCancel?.();
      await refreshAutomaticRun();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setAutomaticControlAction(null);
    }
  };

  const processAll = async () => {
    if (batchRunning.current || processingTakeId || obsState.recording.active) return;
    const recordings = await loadMoveEvidence();
    if (!recordings || !selectedKnownVariant) return;
    const pending = unprocessedMoveTakes(recordings, selectedKnownVariant.id).filter(
      (recording) => recording.moveTake?.outcome === selectedOutcome,
    );
    if (pending.length === 0) return;
    batchRunning.current = true;
    setBatchResults({});
    setBatchProgress({ done: 0, total: pending.length });
    try {
      for (const [index, recording] of pending.entries()) {
        await processOneTake(recording);
        setBatchProgress({ done: index + 1, total: pending.length });
        await loadMoveEvidence();
      }
    } finally {
      batchRunning.current = false;
    }
  };

  const skipGatherMove = async () => {
    if (!gatherMode || !selectedKnownVariant || !selectedMove) return;
    const attempted = new Set(attemptedMoveIds);
    attempted.add(selectedMove.id);
    setAttemptedMoveIds(attempted);
    const next = gatherMoves(
      availableMoves,
      allRecordings,
      selectedKnownVariant.id,
      gatherMode,
      attempted,
    )[0];
    if (next) {
      if (!(await armMove(next, gatherMode, selectedKnownVariant)))
        setError("The next move could not be armed. End and restart gather mode to retry.");
    } else {
      setGatherComplete(true);
      await disarmMoveCapture();
    }
  };

  const reviewTake = async (recordingId: string) => {
    if (!window.electronAPI?.recordings) return;
    setReviewBusy(true);
    setError(null);
    try {
      await window.electronAPI.recordings.setMoveEvidence({
        recordingId,
        action: "accept",
      });
      {
        const recording = allRecordings.find((item) => item.id === recordingId);
        const variant = knownVariants.find((item) => item.id === recording?.moveTake?.characterId);
        if (recording && variant) {
          const catalog = JSON.parse(
            localStorage.getItem(techCatalogStorageKey) ?? "{}",
          ) as TechCatalog;
          const data = catalog[variant.character] ?? { moves: [], combos: [] };
          const moves = readTechMoves(variant.character);
          const current = { ...catalog, [variant.character]: { ...data, moves } };
          const withoutReplacedSources = allRecordings
            .filter(
              (item) =>
                item.id !== recordingId &&
                item.moveTake?.catalogMoveId === recording.moveTake?.catalogMoveId &&
                item.moveTake?.outcome === recording.moveTake?.outcome &&
                item.moveTake?.evidenceStatus === "active",
            )
            .reduce(
              (result, item) => removeRecordingMeasurements(result, item.id),
              current as TechCatalog,
            );
          const next = applyAcceptedMeasurements(
            withoutReplacedSources,
            recording,
            variant.character,
            variant.support,
            allRecordings,
          );
          localStorage.setItem(techCatalogStorageKey, JSON.stringify(next));
          window.dispatchEvent(new Event(techCatalogUpdatedEvent));
        }
      }
      await loadMoveEvidence();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
    } finally {
      setReviewBusy(false);
    }
  };

  const openRecording = (recordingId: string) => {
    setSelectedPlaybackId(recordingId);
    const moveId = allRecordings.find((recording) => recording.id === recordingId)?.moveTake
      ?.moveId;
    if (moveId) setSelectedMoveId(moveId);
  };

  const batchActive = Boolean(batchProgress && batchProgress.done < batchProgress.total);
  const automaticRunOpen = ["countdown", "running", "paused"].includes(automaticRun.status);
  const batchFailureCount = Object.values(batchResults).filter(
    (result) => result === "Processing failed",
  ).length;
  const locked =
    obsBusy ||
    obsState.recording.active ||
    batchActive ||
    ["countdown", "running", "paused"].includes(automaticRun.status);
  const obsConnected = obsState.status === "connected";
  const blackoutProfileMatchesSelection =
    blackoutStatus.active && blackoutStatus.testedCharacter === selectedKnownVariant?.character;
  const captureReady = blackoutProfileMatchesSelection && obsConnected;
  const captureLockReason =
    automaticRun.status === "paused"
      ? "The automatic pass is paused. Resume or cancel it before manual capture."
      : automaticRun.status === "running" || automaticRun.status === "countdown"
        ? "The automatic pass is active. Manual capture unlocks when it finishes or is cancelled."
        : obsState.recording.active
          ? "A recording is in progress. Manual capture unlocks when it stops."
          : obsBusy
            ? "OBS is busy. Manual capture unlocks when it is ready."
            : batchActive
              ? "Move processing is running. Manual capture unlocks when it finishes."
              : null;
  const gatherCounts =
    gatherMode && selectedKnownVariant
      ? availableMoves.reduce(
          (counts, move) => {
            const status = slotStatus(
              move,
              gatherMode,
              takesForSlot(allRecordings, selectedKnownVariant.id, move.id, gatherMode),
            );
            counts[status] += 1;
            return counts;
          },
          { missing: 0, pending: 0, complete: 0, "needs-redo": 0, "not-applicable": 0 },
        )
      : null;
  const measuredFields: TechMeasuredField[] = [
    "startup",
    "active",
    "recovery",
    "onBlock",
    "blockstun",
    "hitstunGrounded",
    "onHitGrounded",
    "hitstunAirborne",
    "onHitAirborne",
  ];
  const catalogForMeasurements = (() => {
    try {
      return JSON.parse(localStorage.getItem(techCatalogStorageKey) ?? "{}") as TechCatalog;
    } catch {
      return {} as TechCatalog;
    }
  })();

  return (
    <Paper variant="outlined" sx={{ p: 2, textAlign: "left" }}>
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="h6">Move capture</Typography>
          <Typography variant="body2" color="text.secondary">
            Select a character/support, arm a take in its move card, then use the header controls or
            F9. The move list comes from Tech → Moves. Processing uses the selected take's move
            identity and measures its frame meter.
          </Typography>
        </Box>

        <Alert
          severity={
            captureReady && !captureLockReason
              ? "success"
              : blackoutStatus.error
                ? "error"
                : "warning"
          }
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="body2" sx={{ flex: 1 }}>
              {blackoutStatus.active
                ? !blackoutProfileMatchesSelection
                  ? `Blackout mode is for ${blackoutStatus.testedCharacter}. Select that fighter to capture moves, or restart in the selected fighter's profile.`
                  : obsConnected
                    ? (captureLockReason ??
                      `Blackout for ${blackoutStatus.testedCharacter} and OBS are active. Move capture is enabled. ${blackoutStatus.testedCharacter === "Korra" ? "Zuko is visible as Player 2." : "Other fighters and all supports are hidden."}`)
                    : "Blackout mode is active. Connect OBS to enable move capture."
                : (blackoutStatus.error ??
                  (blackoutStatus.gameRunning
                    ? "The game is open without verified blackout assets. Close it before installing blackout mode."
                    : blackoutStatus.busy
                      ? "Restoring or preparing blackout assets."
                      : "Move capture requires the game to be running with verified blackout assets. Saved videos can still be reviewed and processed."))}
            </Typography>
            {!blackoutStatus.active && (
              <Button
                size="small"
                variant="contained"
                disabled={
                  !blackoutStatus.available ||
                  blackoutStatus.gameRunning ||
                  blackoutStatus.busy ||
                  blackoutLaunching ||
                  !selectedKnownVariant
                }
                onClick={() => void startBlackoutGame()}
              >
                {blackoutLaunching ? "Starting game..." : "Start game in blackout mode"}
              </Button>
            )}
            {!blackoutStatus.active && selectedKnownVariant && (
              <Typography variant="caption" color="text.secondary">
                {selectedKnownVariant.character} visible; all supports hidden.
                {selectedKnownVariant.character === "Korra"
                  ? " Choose Zuko as the visible Player 2 target."
                  : " Other fighters are hidden."}
              </Typography>
            )}
            {blackoutStatus.restorePending && (
              <Button size="small" onClick={() => void retryBlackoutRestore()}>
                Retry restore
              </Button>
            )}
          </Stack>
        </Alert>

        {automaticRunOpen && (
          <Alert severity="info">
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="body2" sx={{ flex: 1 }}>
                Automatic {automaticRun.outcome ?? "whiff"} pass {automaticRun.status}:{" "}
                {automaticRun.index} of {automaticRun.total} ·{" "}
                {automaticRun.currentMove ?? "preparing"}
                {automaticRun.phase ? ` · ${automaticRun.phase}` : ""}
                {automaticRun.error ? ` · ${automaticRun.error}` : ""}
              </Typography>
              {automaticRun.status === "paused" ? (
                <Button
                  size="small"
                  variant="contained"
                  disabled={
                    Boolean(automaticControlAction) ||
                    !captureReady ||
                    obsBusy ||
                    obsState.recording.active
                  }
                  onClick={() => void controlAutomaticRun("resume")}
                >
                  Resume pass
                </Button>
              ) : (
                <Button
                  size="small"
                  disabled={Boolean(automaticControlAction)}
                  onClick={() => void controlAutomaticRun("pause")}
                >
                  Pause
                </Button>
              )}
              <Button
                size="small"
                color="error"
                disabled={Boolean(automaticControlAction)}
                onClick={() => void controlAutomaticRun("cancel")}
              >
                {automaticControlAction === "cancel" ? "Cancelling..." : "Cancel pass"}
              </Button>
            </Stack>
          </Alert>
        )}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 2fr) minmax(0, 3fr)" },
            gap: 2,
            alignItems: "start",
          }}
        >
          <Stack spacing={1.5} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <FormControl
                size="small"
                sx={{ minWidth: 200, flex: 1 }}
                disabled={locked || Boolean(gatherMode) || knownVariants.length === 0}
              >
                <InputLabel id="move-capture-character-label">Known character / support</InputLabel>
                <Select
                  labelId="move-capture-character-label"
                  label="Known character / support"
                  value={selectedCharacterId}
                  onChange={(event) => {
                    setSelectedCharacterId(event.target.value);
                    setSelectedMoveId("");
                    setSelectedPlaybackId(null);
                    setShowCompletedMoves(false);
                  }}
                >
                  {knownVariants.map((variant) => (
                    <MenuItem key={variant.id} value={variant.id}>
                      {variant.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl
                size="small"
                sx={{ minWidth: 150 }}
                disabled={locked || Boolean(gatherMode) || Boolean(moveCapture.armed)}
              >
                <InputLabel id="move-capture-outcome-label">Capture data</InputLabel>
                <Select
                  labelId="move-capture-outcome-label"
                  label="Capture data"
                  value={selectedOutcome}
                  onChange={(event) => {
                    setSelectedOutcome(event.target.value as MoveTakeOutcome);
                    setSelectedPlaybackId(null);
                    setShowCompletedMoves(false);
                  }}
                >
                  {outcomes.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                size="small"
                onClick={() => void loadMoveEvidence()}
                disabled={evidenceLoading || Boolean(processingTakeId)}
              >
                {evidenceLoading ? "Refreshing..." : "Refresh"}
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={() => void processAll()}
                disabled={
                  !selectedKnownVariant ||
                  unprocessedTakes.length === 0 ||
                  Boolean(processingTakeId) ||
                  batchActive ||
                  obsState.recording.active ||
                  automaticRunOpen
                }
              >
                Process all ({unprocessedTakes.length})
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Review automated videos before processing. Processed takes still need evidence
              acceptance. The requested outcome is separate from what processing observed.
            </Typography>
            {batchProgress && (
              <Alert
                severity={
                  batchProgress.done < batchProgress.total
                    ? "info"
                    : batchFailureCount > 0
                      ? "warning"
                      : "success"
                }
              >
                Attempted {batchProgress.done} of {batchProgress.total} takes
                {batchProgress.done === batchProgress.total
                  ? ". " + batchFailureCount + " failed; review their cards and retry."
                  : processingTakeId
                    ? " · currently processing " +
                      (allRecordings.find((item) => item.id === processingTakeId)?.moveTake
                        ?.moveLabel ?? processingTakeId)
                    : ""}
              </Alert>
            )}

            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              <Button
                size="small"
                variant={gatherMode ? "contained" : "outlined"}
                disabled={locked || !captureReady || Boolean(gatherMode) || !selectedKnownVariant}
                onClick={() => void startGather(selectedOutcome)}
              >
                Gather{" "}
                {outcomes.find((item) => item.value === selectedOutcome)?.label.toLowerCase()} data
              </Button>
              {gatherMode && (
                <Button
                  size="small"
                  color="error"
                  disabled={locked}
                  onClick={() => {
                    setGatherMode(null);
                    setGatherComplete(false);
                    void disarmMoveCapture();
                  }}
                >
                  End gather mode
                </Button>
              )}
            </Stack>
            {selectedKnownVariant && (
              <Alert severity="info">
                <Typography variant="subtitle2">
                  Automatic {selectedOutcome} queue · {selectedKnownVariant.label}
                </Typography>
                <Typography variant="body2">
                  {automaticQueue.length} supported move
                  {automaticQueue.length === 1 ? "" : "s"} queued ·{" "}
                  {
                    automatedPreview.filter(
                      ({ eligibility }) =>
                        eligibility.eligible && eligibility.validation === "needs-validation",
                    ).length
                  }{" "}
                  recipes not yet verified in game. Existing takes and manual-only moves remain
                  visible until this outcome is processed and accepted.
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", flexWrap: "wrap", mt: 1 }}
                >
                  <FormControl size="small" sx={{ minWidth: 130 }} disabled={automaticRunOpen}>
                    <InputLabel id="automatic-facing-label">Facing</InputLabel>
                    <Select
                      labelId="automatic-facing-label"
                      label="Facing"
                      value={automaticFacing}
                      onChange={(event) =>
                        setAutomaticFacing(event.target.value as "Right" | "Left")
                      }
                    >
                      <MenuItem value="Right">Right</MenuItem>
                      <MenuItem value="Left">Left</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    size="small"
                    type="number"
                    label="Charge hold (ms)"
                    value={chargeHoldMs}
                    onChange={(event) => setChargeHoldMs(Number(event.target.value))}
                    disabled={automaticRunOpen}
                    slotProps={{ htmlInput: { min: 100, max: 5000, step: 50 } }}
                    sx={{ width: 160 }}
                  />
                  {!automaticRunOpen && (
                    <Button
                      size="small"
                      variant="contained"
                      disabled={
                        locked ||
                        !captureReady ||
                        Boolean(gatherMode) ||
                        !Number.isInteger(chargeHoldMs) ||
                        chargeHoldMs < 100 ||
                        chargeHoldMs > 5000 ||
                        automaticQueue.length === 0
                      }
                      onClick={() => void startAutomaticPass()}
                    >
                      Start automatic {selectedOutcome} pass ({automaticQueue.length})
                    </Button>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    Set the training position, target state, and facing first, then focus the game.
                    Bracketed moves hold their attack button for the selected duration.
                  </Typography>
                </Stack>
                {(automaticRun.status === "completed" ||
                  automaticRun.status === "cancelled" ||
                  automaticRun.status === "error") && (
                  <Alert
                    severity={
                      automaticRun.status === "error"
                        ? "error"
                        : automaticRun.status === "completed"
                          ? "success"
                          : "info"
                    }
                    sx={{ mt: 1 }}
                  >
                    Automatic {automaticRun.outcome ?? "whiff"} pass {automaticRun.status}
                    {automaticRun.total
                      ? " · " + automaticRun.index + " of " + automaticRun.total
                      : ""}
                    {automaticRun.error ? " · " + automaticRun.error : ""}
                  </Alert>
                )}
              </Alert>
            )}
            {gatherMode && selectedKnownVariant && (
              <Alert
                severity={gatherComplete ? "success" : "info"}
                action={
                  !gatherComplete && !locked ? (
                    <Button color="inherit" size="small" onClick={() => void skipGatherMove()}>
                      Skip this move
                    </Button>
                  ) : undefined
                }
              >
                {gatherComplete
                  ? "Capture pass complete for " +
                    selectedKnownVariant.label +
                    ". Review pending takes and retry failures."
                  : "Gathering " +
                    gatherMode +
                    " for " +
                    selectedKnownVariant.label +
                    ": " +
                    (selectedMove?.input ?? "loading") +
                    ". Start and stop recording with the header control or F9. Next: " +
                    (gatherQueue.find((move) => move.id !== selectedMoveId)?.input ??
                      "end of queue") +
                    "."}
                {gatherCounts &&
                  " Complete " +
                    gatherCounts.complete +
                    " · pending " +
                    gatherCounts.pending +
                    " · missing " +
                    gatherCounts.missing +
                    " · redo " +
                    gatherCounts["needs-redo"] +
                    " · not applicable " +
                    gatherCounts["not-applicable"] +
                    "."}
              </Alert>
            )}
            {moveCapture.armed && (
              <Alert
                severity="info"
                action={
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => void disarmMoveCapture()}
                    disabled={locked}
                  >
                    Disarm
                  </Button>
                }
              >
                Armed: {moveCapture.armed.characterLabel} · {moveCapture.armed.moveLabel} ·{" "}
                {moveCapture.armed.outcome}. It remains armed for additional takes until disarmed.
              </Alert>
            )}
            {moveCapture.active && (
              <Alert severity="warning">
                Recording move take: {moveCapture.active.moveLabel} · {moveCapture.active.outcome}
              </Alert>
            )}

            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="subtitle1" sx={{ flex: 1 }}>
                {outcomes.find((item) => item.value === selectedOutcome)?.label} takes (
                {availableMoves.length - completedMoveIds.size} to do)
              </Typography>
              {completedMoveIds.size > 0 && (
                <Button size="small" onClick={() => setShowCompletedMoves((current) => !current)}>
                  {showCompletedMoves
                    ? "Hide completed moves"
                    : "Show completed moves (" + completedMoveIds.size + ")"}
                </Button>
              )}
            </Stack>
            {availableMoves.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                No moves are listed for this character/support in Tech.
              </Typography>
            )}
            {availableMoves.length > 0 && visibleMoves.length === 0 && (
              <Alert severity="success">
                All applicable {selectedOutcome} takes are processed and accepted.
              </Alert>
            )}
            {visibleMoves.map((move) => {
              const takes = selectedKnownVariant
                ? allRecordings.filter(
                    (recording) =>
                      recording.moveTake?.catalogMoveId === selectedKnownVariant.id + "/" + move.id,
                  )
                : [];
              const automation = automatedPreview.find(
                (item) => item.move.id === move.id,
              )?.eligibility;
              const manualReason =
                automation &&
                !automation.eligible &&
                (automation.kind === "nonstandard" || automation.kind === "unsupported")
                  ? automation.reason
                  : null;
              const measurements =
                selectedKnownVariant &&
                measuredFields
                  .map((field) => {
                    const source = effectiveMeasurement(
                      catalogForMeasurements,
                      selectedKnownVariant.character,
                      selectedKnownVariant.support,
                      move.id,
                      field,
                    );
                    return source ? field + " " + source.value : null;
                  })
                  .filter(Boolean)
                  .join(" · ");
              return (
                <Paper
                  key={move.id}
                  variant="outlined"
                  sx={{
                    p: 1,
                    borderColor: selectedMoveId === move.id ? "primary.main" : "divider",
                  }}
                >
                  <Stack spacing={1}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", flexWrap: "wrap" }}
                    >
                      <ButtonBase
                        onClick={() => {
                          setSelectedMoveId(move.id);
                          setSelectedPlaybackId(null);
                        }}
                        sx={{ borderRadius: 1, px: 0.5, textAlign: "left" }}
                        aria-label={"Select move " + move.input}
                      >
                        <Typography variant="subtitle1">{move.input}</Typography>
                      </ButtonBase>
                      {move.isCharged && (
                        <Typography variant="caption" color="text.secondary">
                          Charged
                        </Typography>
                      )}
                      {move.nonstandard && (
                        <Typography variant="caption" color="text.secondary">
                          Manual capture only
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                        {measurements ? "Accepted: " + measurements : "No accepted measurements"}
                      </Typography>
                    </Stack>
                    {(manualReason || move.isCharged) && (
                      <Typography variant="caption" color="text.secondary">
                        {manualReason}
                        {move.isCharged &&
                          " Review the video to confirm the charged move activated."}
                      </Typography>
                    )}
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr)",
                        gap: 1,
                      }}
                    >
                      {outcomes
                        .filter((item) => item.value === selectedOutcome)
                        .map((item) => (
                          <MoveTakeCard
                            key={item.value}
                            move={move}
                            outcome={item}
                            takes={takes.filter((take) => take.moveTake?.outcome === item.value)}
                            selectedPlaybackId={selectedPlayback?.id ?? null}
                            captureReady={captureReady}
                            locked={locked || Boolean(gatherMode)}
                            obsRecording={obsState.recording.active}
                            batchActive={batchActive}
                            reviewBusy={reviewBusy}
                            processingTakeId={processingTakeId}
                            deletingTakeId={deletingTakeId}
                            processingErrors={processingErrors}
                            onArm={() => {
                              if (selectedKnownVariant) {
                                void armMove(move, item.value, selectedKnownVariant);
                              }
                            }}
                            onWatch={openRecording}
                            onReviewCapture={(id, action) =>
                              void reviewAutomatedCapture(id, action)
                            }
                            onProcess={(recording) => void processTake(recording)}
                            onReviewEvidence={(id) => void reviewTake(id)}
                            onDelete={(recording) => {
                              setDeleteError(null);
                              setDeleteTarget(recording);
                            }}
                          />
                        ))}
                    </Box>
                  </Stack>
                </Paper>
              );
            })}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
          <Box
            sx={{
              minWidth: 0,
              height: "calc(100vh - 220px)",
              minHeight: 520,
              position: { lg: "sticky" },
              top: 12,
            }}
          >
            <RecordingViewer
              active={active}
              mode="recordings"
              panelOnly
              selectedRecordingId={selectedPlayback?.id ?? null}
              refreshToken={recordingsRevision}
            />
          </Box>
        </Box>
      </Stack>
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deletingTakeId) setDeleteTarget(null);
        }}
      >
        <DialogTitle>Delete move take?</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography>
              Permanently delete {deleteTarget ? `“${deleteTarget.name}”` : "this video"} and its
              move-take metadata? Its accepted measurements will be removed from Tech. The deleted
              take will no longer block a retake. Any clips made from this recording will remain but
              lose their source link.
            </Typography>
            {deleteError && <Alert severity="error">{deleteError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={Boolean(deletingTakeId)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={
              locked ||
              batchActive ||
              reviewBusy ||
              Boolean(processingTakeId) ||
              Boolean(deletingTakeId)
            }
            onClick={() => void deleteMoveTake()}
          >
            {deletingTakeId ? "Deleting..." : "Delete take"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
