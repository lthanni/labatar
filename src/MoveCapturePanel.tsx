import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
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
  Typography,
} from "@mui/material";
import { useObsRecording } from "./ObsRecordingContext";
import type { DevBlackoutStatus } from "./dev-blackout-types";
import { withCommonTechMoves } from "./common-tech-moves";
import { linkLegacyChargedMoves } from "./charged-move-variants";
import {
  automatedWhiffEligibility,
  gatherMoves,
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
import type { KnownMoveCaptureVariant, MoveTakeOutcome } from "./move-capture-types";
import {
  isFlowCancellableByDefault,
  normalizeMoveNotation,
  parseMoveNotation,
} from "./move-notation";
import type { RecordedVideo } from "./recording-types";
import {
  techCatalogStorageKey,
  techCatalogUpdatedEvent,
  techSelectRecordingEvent,
  techSelectedRecordingStorageKey,
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
  blackoutStatus,
  refreshBlackoutStatus,
}: {
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
  const [outcome, setOutcome] = useState<MoveTakeOutcome>("whiff");
  const [allRecordings, setAllRecordings] = useState<RecordedVideo[]>([]);
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
  const [automaticRun, setAutomaticRun] = useState<{
    status: "idle" | "countdown" | "running" | "paused" | "completed" | "cancelled" | "error";
    index: number;
    total: number;
    currentMove: string | null;
    phase: string;
    error: string | null;
    runId?: string;
  }>({ status: "idle", index: 0, total: 0, currentMove: null, phase: "", error: null });
  const [error, setError] = useState<string | null>(null);
  const [blackoutLaunching, setBlackoutLaunching] = useState(false);

  const startBlackoutGame = async () => {
    const api = window.electronAPI?.devBlackout;
    if (!api) return;
    setBlackoutLaunching(true);
    setError(null);
    try {
      await api.start();
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
  const automatedWhiffPreview = useMemo(
    () =>
      selectedKnownVariant
        ? availableMoves.map((move) => ({
            move,
            eligibility: automatedWhiffEligibility(
              move,
              allRecordings,
              selectedKnownVariant.id,
              new Set(),
              automaticFacing,
            ),
          }))
        : [],
    [allRecordings, availableMoves, automaticFacing, selectedKnownVariant],
  );
  const automaticWhiffQueue = useMemo(
    () =>
      automatedWhiffPreview
        .filter(({ eligibility }) => eligibility.eligible)
        .map(({ move }) => ({ id: move.id, input: move.input })),
    [automatedWhiffPreview],
  );
  const unprocessedTakes = useMemo(
    () =>
      selectedKnownVariant ? unprocessedMoveTakes(allRecordings, selectedKnownVariant.id) : [],
    [allRecordings, selectedKnownVariant],
  );
  const captureReviewQueue = useMemo(
    () =>
      selectedKnownVariant
        ? allRecordings.filter(
            (recording) =>
              recording.moveTake?.characterId === selectedKnownVariant.id &&
              recording.moveTake.captureMethod === "automated" &&
              recording.moveTake.captureReviewStatus === "awaiting-video-review" &&
              recording.moveTake.status === "captured" &&
              recording.moveTake.evidenceStatus === "pending" &&
              !recording.moveTake.storageError,
          )
        : [],
    [allRecordings, selectedKnownVariant],
  );
  const processingReviewTakes = useMemo(
    () =>
      selectedKnownVariant
        ? allRecordings
            .filter(
              (recording) =>
                recording.moveTake?.characterId === selectedKnownVariant.id &&
                ((recording.analysis && recording.moveTake.evidenceStatus === "pending") ||
                  batchResults[recording.id] ||
                  processingErrors[recording.id]),
            )
            .sort((left, right) => right.modifiedAt - left.modifiedAt)
        : [],
    [allRecordings, batchResults, processingErrors, selectedKnownVariant],
  );

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
    const api = window.electronAPI?.moveCapture;
    if (!api?.automaticStatus || !api.onAutomaticState) return;
    const unsubscribe = api.onAutomaticState((nextRun) => {
      setAutomaticRun(nextRun);
      if (nextRun.status === "completed") void loadMoveEvidence();
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

  const arm = useCallback(async () => {
    if (!selectedKnownVariant || !selectedMove) return;
    await armMoveCapture({
      characterId: selectedKnownVariant.id,
      moveId: selectedMove.id,
      moveInput: selectedMove.input,
      isStance: Boolean(selectedMove.dependsOnMoveId),
      isCharged: selectedMove.isCharged,
      outcome,
    });
  }, [armMoveCapture, outcome, selectedKnownVariant, selectedMove]);

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
      setOutcome(mode);
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
    if (!completedTake || !gatherMode || !selectedKnownVariant) return;
    if (
      completedTake.characterId !== selectedKnownVariant.id ||
      completedTake.outcome !== gatherMode
    )
      return;
    void (async () => {
      const recordings = await loadMoveEvidence();
      if (!recordings) return;
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
      if (processed.moveTake?.validation.status === "mismatch") {
        await window.electronAPI?.recordings.setMoveEvidence({
          recordingId: recording.id,
          action: "archive",
          reason: processed.moveTake.validation.message,
        });
      }
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
    const reason =
      action === "reject" ? window.prompt("Why are you rejecting this video?") : undefined;
    if (action === "reject" && reason === null) return;
    setReviewBusy(true);
    setError(null);
    try {
      await recordingsApi.reviewCapture({
        recordingId,
        action,
        reason: reason?.trim() || undefined,
      });
      await loadMoveEvidence();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
    } finally {
      setReviewBusy(false);
    }
  };

  const deletePendingMove = async () => {
    const api = window.electronAPI?.recordings;
    if (!api?.deletePendingMove || !deleteTarget || batchRunning.current || processingTakeId)
      return;
    const recordingId = deleteTarget.id;
    setDeletingTakeId(recordingId);
    setDeleteError(null);
    try {
      await api.deletePendingMove({ recordingId });
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

  const startAutomaticWhiffPass = async () => {
    const api = window.electronAPI?.moveCapture;
    if (
      !api?.automaticStart ||
      !selectedKnownVariant ||
      automaticWhiffQueue.length === 0 ||
      obsState.status !== "connected"
    )
      return;
    setError(null);
    try {
      await api.automaticStart({
        variantId: selectedKnownVariant.id,
        moves: automaticWhiffQueue,
        facing: automaticFacing,
      });
      await refreshAutomaticRun();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    }
  };

  const controlAutomaticRun = async (action: "pause" | "resume" | "cancel") => {
    const api = window.electronAPI?.moveCapture;
    if (!api) return;
    setError(null);
    try {
      if (action === "pause") await api.automaticPause?.();
      else if (action === "resume") await api.automaticResume?.();
      else await api.automaticCancel?.();
      await refreshAutomaticRun();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    }
  };

  const processAll = async () => {
    if (batchRunning.current || processingTakeId || obsState.recording.active) return;
    const recordings = await loadMoveEvidence();
    if (!recordings || !selectedKnownVariant) return;
    const pending = unprocessedMoveTakes(recordings, selectedKnownVariant.id);
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

  const reviewTake = async (recordingId: string, action: "accept" | "archive") => {
    if (!window.electronAPI?.recordings) return;
    setReviewBusy(true);
    setError(null);
    try {
      await window.electronAPI.recordings.setMoveEvidence({
        recordingId,
        action,
        reason: action === "archive" ? "Retake requested after review." : undefined,
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
          const withoutReplacedSources =
            action === "accept"
              ? allRecordings
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
                  )
              : current;
          const next =
            action === "accept"
              ? applyAcceptedMeasurements(
                  withoutReplacedSources,
                  recording,
                  variant.character,
                  variant.support,
                  allRecordings,
                )
              : removeRecordingMeasurements(current, recordingId);
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
    localStorage.setItem(techSelectedRecordingStorageKey, recordingId);
    window.dispatchEvent(new CustomEvent(techSelectRecordingEvent, { detail: recordingId }));
  };

  const batchActive = Boolean(batchProgress && batchProgress.done < batchProgress.total);
  const batchFailureCount = Object.values(batchResults).filter(
    (result) => result === "Processing failed",
  ).length;
  const locked =
    obsBusy ||
    obsState.recording.active ||
    batchActive ||
    ["countdown", "running", "paused"].includes(automaticRun.status);
  const obsConnected = obsState.status === "connected";
  const captureReady = blackoutStatus.active && obsConnected;
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
  const activeMoveTakes = moveTakes.filter((take) => take.moveTake?.evidenceStatus === "active");
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
            Select a known character/support variant and move, then use the header controls or F9.
            The move list comes from Tech → Moves. Labatar saves the original take under its move
            and outcome, but processing still has to verify the visible input history independently.
          </Typography>
        </Box>

        <Alert severity={captureReady ? "success" : blackoutStatus.error ? "error" : "warning"}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="body2" sx={{ flex: 1 }}>
              {blackoutStatus.active
                ? obsConnected
                  ? "Blackout mode and OBS are active. Move capture is enabled."
                  : "Blackout mode is active. Connect OBS to enable move capture."
                : (blackoutStatus.error ??
                  (blackoutStatus.gameRunning
                    ? "The game is already open without a verified blackout session. Close it to start blackout mode."
                    : blackoutStatus.busy
                      ? "Restoring or preparing blackout assets."
                      : "Move capture is locked until the game starts in blackout mode. Saved videos can still be reviewed and processed."))}
            </Typography>
            <Button
              size="small"
              variant="contained"
              disabled={
                !blackoutStatus.available ||
                blackoutStatus.gameRunning ||
                blackoutStatus.busy ||
                blackoutLaunching
              }
              onClick={() => void startBlackoutGame()}
            >
              {blackoutLaunching ? "Starting game..." : "Start game in blackout mode"}
            </Button>
            {blackoutStatus.restorePending && (
              <Button size="small" onClick={() => void retryBlackoutRestore()}>
                Retry restore
              </Button>
            )}
          </Stack>
        </Alert>

        <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
          <FormControl
            size="small"
            sx={{ minWidth: 200 }}
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
            disabled={locked || Boolean(gatherMode) || availableMoves.length === 0}
          >
            <InputLabel id="move-capture-move-label">Move</InputLabel>
            <Select
              labelId="move-capture-move-label"
              label="Move"
              value={selectedMoveId}
              onChange={(event) => setSelectedMoveId(event.target.value)}
            >
              {availableMoves.map((move) => (
                <MenuItem key={move.id} value={move.id}>
                  {move.input}
                  {move.isCharged ? " (charged)" : ""}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl
            size="small"
            sx={{ minWidth: 130 }}
            disabled={locked || Boolean(gatherMode) || !selectedMove}
          >
            <InputLabel id="move-capture-outcome-label">Take</InputLabel>
            <Select
              labelId="move-capture-outcome-label"
              label="Take"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value as MoveTakeOutcome)}
            >
              {outcomes.map((item) => (
                <MenuItem key={item.value} value={item.value}>
                  {item.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            onClick={() => void arm()}
            disabled={locked || !captureReady || Boolean(gatherMode) || !selectedMove}
          >
            Arm {outcome} take
          </Button>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          {outcomes.map((item) => (
            <Button
              key={item.value}
              size="small"
              variant={gatherMode === item.value ? "contained" : "outlined"}
              disabled={locked || !captureReady || Boolean(gatherMode) || !selectedKnownVariant}
              onClick={() => void startGather(item.value)}
            >
              Gather {item.label.toLowerCase()} data
            </Button>
          ))}
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
              Automatic whiff queue preview · {selectedKnownVariant.label}
            </Typography>
            <Typography variant="body2">
              {automaticWhiffQueue.length} supported move
              {automaticWhiffQueue.length === 1 ? "" : "s"} queued ·{" "}
              {
                automatedWhiffPreview.filter(
                  ({ eligibility }) =>
                    eligibility.eligible && eligibility.validation === "needs-validation",
                ).length
              }{" "}
              recipes not yet verified in game ·{" "}
              {automatedWhiffPreview.filter(({ eligibility }) => !eligibility.eligible).length}{" "}
              skipped. Review every captured video before processing; untested inputs may need a
              retake.
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", flexWrap: "wrap", mt: 1 }}
            >
              <FormControl
                size="small"
                sx={{ minWidth: 130 }}
                disabled={
                  automaticRun.status === "running" ||
                  automaticRun.status === "countdown" ||
                  automaticRun.status === "paused"
                }
              >
                <InputLabel id="automatic-facing-label">Facing</InputLabel>
                <Select
                  labelId="automatic-facing-label"
                  label="Facing"
                  value={automaticFacing}
                  onChange={(event) => setAutomaticFacing(event.target.value as "Right" | "Left")}
                >
                  <MenuItem value="Right">Right</MenuItem>
                  <MenuItem value="Left">Left</MenuItem>
                </Select>
              </FormControl>
              {automaticRun.status === "paused" ? (
                <Button
                  size="small"
                  variant="contained"
                  disabled={!captureReady || obsBusy || obsState.recording.active}
                  onClick={() => void controlAutomaticRun("resume")}
                >
                  Resume pass
                </Button>
              ) : automaticRun.status === "running" || automaticRun.status === "countdown" ? (
                <>
                  <Button size="small" onClick={() => void controlAutomaticRun("pause")}>
                    Pause
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => void controlAutomaticRun("cancel")}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="small"
                  variant="contained"
                  disabled={
                    locked ||
                    !captureReady ||
                    Boolean(gatherMode) ||
                    automaticWhiffQueue.length === 0
                  }
                  onClick={() => void startAutomaticWhiffPass()}
                >
                  Start automatic whiff pass ({automaticWhiffQueue.length})
                </Button>
              )}
              <Typography variant="caption" color="text.secondary">
                Set the training position and facing first. Starting gives you time to focus the
                game before capture begins.
              </Typography>
            </Stack>
            {(automaticRun.status === "countdown" ||
              automaticRun.status === "running" ||
              automaticRun.status === "paused" ||
              automaticRun.status === "completed" ||
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
                {automaticRun.status === "countdown" ||
                automaticRun.status === "running" ||
                automaticRun.status === "paused"
                  ? `Automatic whiff pass ${automaticRun.status}: ${automaticRun.index} of ${automaticRun.total} · ${automaticRun.currentMove ?? "preparing"}${automaticRun.phase ? ` · ${automaticRun.phase}` : ""}`
                  : `Automatic whiff pass ${automaticRun.status}${automaticRun.total ? ` · ${automaticRun.index} of ${automaticRun.total}` : ""}`}
                {automaticRun.error ? ` · ${automaticRun.error}` : ""}
              </Alert>
            )}
            <Stack spacing={0.25} sx={{ mt: 0.75 }}>
              {automatedWhiffPreview.map(({ move, eligibility }) => (
                <Typography key={move.id} variant="caption" color="text.secondary">
                  {move.input}:{" "}
                  {eligibility.eligible
                    ? eligibility.validation === "tested"
                      ? "queued (live-tested recipe)"
                      : "queued (review input and move in video)"
                    : eligibility.reason}
                </Typography>
              ))}
            </Stack>
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
              ? `Capture pass complete for ${selectedKnownVariant.label}. Review pending takes and retry any failures.`
              : `Gathering ${gatherMode} for ${selectedKnownVariant.label}: ${selectedMove?.input ?? "loading"}. Start and stop recording with the header control or F9; the next move is armed automatically. Next: ${gatherQueue.find((move) => move.id !== selectedMoveId)?.input ?? "end of queue"}.`}
            {gatherCounts &&
              ` Complete ${gatherCounts.complete} · pending ${gatherCounts.pending} · missing ${gatherCounts.missing} · redo ${gatherCounts["needs-redo"]} · not applicable ${gatherCounts["not-applicable"]}.`}
          </Alert>
        )}

        {selectedMove && (
          <Typography variant="caption" color="text.secondary">
            Expected visible input: {selectedMove.input} ·{" "}
            {selectedMove.isCharged
              ? "Charged version: its takes are stored separately; hold duration is not yet automatically verified."
              : outcomes.find((item) => item.value === outcome)?.description}
          </Typography>
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

        <Divider />
        <Paper variant="outlined" sx={{ p: 1.25 }}>
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="subtitle1" sx={{ flex: 1 }}>
                Unprocessed moves ({unprocessedTakes.length})
              </Typography>
              <Button
                size="small"
                onClick={() => void loadMoveEvidence()}
                disabled={evidenceLoading || Boolean(processingTakeId)}
              >
                Refresh
              </Button>
              <Button
                variant="contained"
                size="small"
                onClick={() => void processAll()}
                disabled={
                  !selectedKnownVariant ||
                  unprocessedTakes.length === 0 ||
                  Boolean(processingTakeId) ||
                  Boolean(batchProgress && batchProgress.done < batchProgress.total) ||
                  obsState.recording.active
                }
              >
                Process all
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {selectedKnownVariant?.label ?? "Select a character/support"} · processing uses saved
              videos and leaves acceptance for review. The situation shown is the capture request,
              not a verified opponent outcome.
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
                  ? `. ${batchFailureCount} failed; review the outcomes below and retry failures.`
                  : processingTakeId
                    ? ` · currently processing ${allRecordings.find((item) => item.id === processingTakeId)?.moveTake?.moveLabel ?? processingTakeId}`
                    : ""}
              </Alert>
            )}
            {captureReviewQueue.length > 0 && (
              <>
                <Divider />
                <Typography variant="subtitle2">Automated videos awaiting your review</Typography>
                <Typography variant="caption" color="text.secondary">
                  Watch each clip and confirm the move, whiff, complete animation, visible
                  input/frame meter, and clean reset. Only approved clips can be processed.
                </Typography>
                {captureReviewQueue.map((recording) => (
                  <Stack
                    key={recording.id}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center", flexWrap: "wrap" }}
                  >
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 180 }}>
                      {recording.moveTake?.moveLabel} · {recording.moveTake?.outcome}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {recording.name}
                    </Typography>
                    <Button size="small" onClick={() => openRecording(recording.id)}>
                      Watch video
                    </Button>
                    <Button
                      size="small"
                      disabled={reviewBusy}
                      onClick={() => void reviewAutomatedCapture(recording.id, "approve")}
                    >
                      Approve for processing
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      disabled={reviewBusy}
                      onClick={() => void reviewAutomatedCapture(recording.id, "reject")}
                    >
                      Reject
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      disabled={
                        locked || Boolean(processingTakeId) || Boolean(deletingTakeId) || reviewBusy
                      }
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(recording);
                      }}
                    >
                      Delete video
                    </Button>
                  </Stack>
                ))}
              </>
            )}
            {unprocessedTakes.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No pending unprocessed move videos for this character/support.
              </Typography>
            ) : (
              <Stack spacing={0.5}>
                {unprocessedTakes.map((recording) => (
                  <Stack
                    key={recording.id}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center", flexWrap: "wrap" }}
                  >
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 180 }}>
                      {recording.moveTake?.moveLabel} · {recording.moveTake?.outcome}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {recording.name}
                    </Typography>
                    <Button size="small" onClick={() => openRecording(recording.id)}>
                      Video
                    </Button>
                    <Button
                      size="small"
                      disabled={Boolean(processingTakeId) || obsState.recording.active}
                      onClick={() => void processTake(recording)}
                    >
                      Process
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      disabled={locked || Boolean(processingTakeId) || Boolean(deletingTakeId)}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(recording);
                      }}
                    >
                      Delete video
                    </Button>
                  </Stack>
                ))}
              </Stack>
            )}
            {processingReviewTakes.length > 0 && (
              <>
                <Divider />
                <Typography variant="subtitle2">Outcome summary</Typography>
                {processingReviewTakes.map((recording) => {
                  const summary = moveTakeOutcomeSummary(recording);
                  const failure = processingErrors[recording.id];
                  return (
                    <Stack key={recording.id} spacing={0.25} sx={{ py: 0.5 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: "center", flexWrap: "wrap" }}
                      >
                        <Typography variant="body2" sx={{ flex: 1, minWidth: 180 }}>
                          {recording.moveTake?.moveLabel} · requested {recording.moveTake?.outcome}
                        </Typography>
                        <Typography
                          variant="caption"
                          color={
                            failure || recording.moveTake?.validation.status === "mismatch"
                              ? "error"
                              : recording.moveTake?.validation.status === "verified"
                                ? "success.main"
                                : "text.secondary"
                          }
                        >
                          {failure ? "Processing failed" : summary.result} ·{" "}
                          {recording.moveTake?.evidenceStatus ?? "pending"}
                        </Typography>
                        <Button size="small" onClick={() => openRecording(recording.id)}>
                          Review video
                        </Button>
                        <Button
                          size="small"
                          onClick={() => setSelectedMoveId(recording.moveTake?.moveId ?? "")}
                        >
                          Select move
                        </Button>
                      </Stack>
                      <Typography variant="caption" color={failure ? "error" : "text.secondary"}>
                        {failure ?? summary.detail}
                      </Typography>
                    </Stack>
                  );
                })}
              </>
            )}
          </Stack>
        </Paper>
        <Divider />
        {selectedMove && (
          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Stack spacing={0.75}>
              {selectedKnownVariant && (
                <Typography variant="caption" color="text.secondary">
                  Accepted measurements:{" "}
                  {measuredFields
                    .map((field) => {
                      const source = effectiveMeasurement(
                        catalogForMeasurements,
                        selectedKnownVariant.character,
                        selectedKnownVariant.support,
                        selectedMove.id,
                        field,
                      );
                      return source ? `${field} ${source.value}` : null;
                    })
                    .filter(Boolean)
                    .join(" · ") || "none yet"}
                </Typography>
              )}
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>
                  Move evidence ({moveTakes.length} take{moveTakes.length === 1 ? "" : "s"})
                </Typography>
                <Button
                  size="small"
                  onClick={() => void loadMoveEvidence()}
                  disabled={evidenceLoading}
                >
                  {evidenceLoading ? "Refreshing..." : "Refresh"}
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Pending takes require processing and review. Only accepted active takes complete
                evidence slots.
              </Typography>
              {moveTakes.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  No recorded takes for this move yet.
                </Typography>
              ) : (
                [
                  ...outcomes,
                  {
                    value: "hit" as const,
                    label: "Legacy hit",
                    description: "Opponent state unknown.",
                  },
                ].map((item) => {
                  const takes = moveTakes.filter((take) => take.moveTake?.outcome === item.value);
                  return (
                    <Box key={item.value}>
                      <Typography variant="caption" color="text.secondary">
                        {item.label}: {takes.length} take{takes.length === 1 ? "" : "s"}
                      </Typography>
                      {takes.map((take) => {
                        const matched = take.analysis?.moves.find(
                          (move) => move.id === take.moveTake?.validation.matchedAnalysisMoveId,
                        );
                        const summary = matched
                          ? `${matched.phases.startup} startup · ${matched.phases.active} active · ${matched.phases.recovery} recovery${item.value === "block" ? ` · on block ${matched.onBlock == null ? "?" : `${matched.onBlock >= 0 ? "+" : ""}${matched.onBlock}`}` : ""}${item.value === "hit" ? ` · on hit ${matched.onHit == null ? "?" : `${matched.onHit >= 0 ? "+" : ""}${matched.onHit}`}` : ""}`
                          : (take.moveTake?.validation.message ?? "Awaiting processing.");
                        return (
                          <Typography
                            key={take.id}
                            variant="caption"
                            component="div"
                            color={
                              take.moveTake?.validation.status === "verified"
                                ? "success.main"
                                : "text.secondary"
                            }
                            sx={{ pl: 1, overflowWrap: "anywhere" }}
                          >
                            [{take.moveTake?.evidenceStatus ?? "pending"}]{" "}
                            {take.moveTake?.validation.status ?? "unprocessed"} · {take.name} ·{" "}
                            {summary}
                          </Typography>
                        );
                      })}
                    </Box>
                  );
                })
              )}
              {moveTakes.map((take) => (
                <Stack
                  key={take.id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", flexWrap: "wrap" }}
                >
                  <Button size="small" onClick={() => openRecording(take.id)}>
                    Review {take.name}
                  </Button>
                  {take.moveTake?.evidenceStatus !== "active" && (
                    <Button
                      size="small"
                      disabled={
                        Boolean(processingTakeId) ||
                        (take.moveTake?.captureMethod === "automated" &&
                          take.moveTake.captureReviewStatus !== "approved-for-processing")
                      }
                      onClick={() => void processTake(take)}
                    >
                      {processingTakeId === take.id
                        ? "Processing..."
                        : take.analysis
                          ? "Reprocess"
                          : "Process"}
                    </Button>
                  )}
                  {take.moveTake?.evidenceStatus !== "active" && (
                    <Button
                      size="small"
                      disabled={reviewBusy || !take.analysis}
                      onClick={() => void reviewTake(take.id, "accept")}
                    >
                      Accept reviewed take
                    </Button>
                  )}
                  {take.moveTake?.evidenceStatus !== "archived" && (
                    <Button
                      size="small"
                      color="error"
                      disabled={reviewBusy}
                      onClick={() => void reviewTake(take.id, "archive")}
                    >
                      Archive
                    </Button>
                  )}
                  {processingErrors[take.id] && (
                    <Typography variant="caption" color="error">
                      {processingErrors[take.id]}
                    </Typography>
                  )}
                </Stack>
              ))}
              {moveTakes.length > 0 && activeMoveTakes.length === 0 && (
                <Alert severity="warning">No evidence slot has an accepted active take yet.</Alert>
              )}
            </Stack>
          </Paper>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deletingTakeId) setDeleteTarget(null);
        }}
      >
        <DialogTitle>Delete pending move video?</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography>
              Permanently delete {deleteTarget ? `“${deleteTarget.name}”` : "this video"} and its
              move-take metadata? The deleted take will no longer block a retake. Any clips made
              from this recording will remain but lose their source link.
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
            disabled={locked || Boolean(processingTakeId) || Boolean(deletingTakeId)}
            onClick={() => void deletePendingMove()}
          >
            {deletingTakeId ? "Deleting..." : "Delete video"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
