import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Menu,
  Pagination,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import type { ComboInputCapture, ProcessedComboInput, RecordedVideo } from "./recording-types";
import { previewComboChipEdit } from "./combo-input-preview";
import {
  chipShortcutActions,
  chipShortcutChangedEvent,
  defaultChipShortcutBindings,
  loadChipShortcutBindings,
  normalizeChipShortcutKey,
  saveChipShortcutBindings,
  type ChipShortcutAction,
} from "./combo-chip-shortcuts";

const PAGE_SIZE = 100;
const CHIP_EDIT_PROCESSOR_VERSION = 10;
const CHIP_EDIT_IDLE_DELAY_MS = 10_000;
type InputView = "clip-raw" | "processed" | "original-raw";
const chipShortcutLabels: Record<ChipShortcutAction, string> = {
  followup: "Toggle ~ follow-up",
  togglePosition: "Toggle airborne/grounded",
  removeDirection: "Remove direction",
  anyAttack: "Any attack button (X)",
  delay: "Toggle delay dl.",
  charged: "Toggle charged []",
  crit: "Toggle crit !",
};

function ShortcutMenuLabel({ shortcut, label }: { shortcut: string; label: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Box
        component="kbd"
        sx={{
          minWidth: 24,
          px: 0.5,
          border: 1,
          borderColor: "divider",
          borderRadius: 0.5,
          fontFamily: "monospace",
          textAlign: "center",
        }}
      >
        {shortcut.toUpperCase()}
      </Box>
      <span>{label}</span>
    </Stack>
  );
}

function inputTime(timeMs: number): string {
  const minutes = Math.floor(timeMs / 60_000);
  const seconds = Math.floor((timeMs % 60_000) / 1000);
  const milliseconds = Math.floor(timeMs % 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function RawInputRows({ capture, page }: { capture: ComboInputCapture; page: number }) {
  const start = (page - 1) * PAGE_SIZE;
  return (
    <TableContainer sx={{ maxHeight: 410 }}>
      <Table size="small" stickyHeader aria-label="Raw controller states">
        <TableHead>
          <TableRow>
            <TableCell>#</TableCell>
            <TableCell>Time</TableCell>
            <TableCell>D-pad</TableCell>
            <TableCell>Stick</TableCell>
            <TableCell>Controller buttons</TableCell>
            <TableCell>Saved game actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {capture.states.slice(start, start + PAGE_SIZE).map((state, index) => (
            <TableRow key={`${start + index}-${state.timeMs}`}>
              <TableCell>{start + index}</TableCell>
              <TableCell sx={{ fontFamily: "monospace" }}>{inputTime(state.timeMs)}</TableCell>
              <TableCell>{state.direction}</TableCell>
              <TableCell>{state.stickDirection}</TableCell>
              <TableCell>{state.buttons.join(" + ") || "—"}</TableCell>
              <TableCell>{state.actions.join(" + ") || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function RawCaptureDetails({ capture }: { capture: ComboInputCapture }) {
  const bindings = Object.entries(capture.bindings)
    .map(([button, action]) => `${button} → ${action}`)
    .join(", ");
  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        Controller {capture.deviceIndex} · {capture.source} · {capture.timing}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        Saved bindings: {bindings || "None"}
      </Typography>
      {capture.status === "interrupted" && (
        <Alert severity="warning" sx={{ mt: 0.5 }}>
          Input capture was interrupted; the states shown may end before the video does.
        </Alert>
      )}
    </Box>
  );
}

export function ComboInputInspector({
  recording,
  playheadMs,
  onUpdated,
  onEdited,
  onProcessingComplete,
  compact = false,
}: {
  recording: RecordedVideo;
  playheadMs: number;
  onUpdated: () => Promise<void>;
  onEdited?: () => void;
  onProcessingComplete?: () => void;
  compact?: boolean;
}) {
  const [view, setView] = useState<InputView>("clip-raw");
  const [page, setPage] = useState(1);
  const [originalCapture, setOriginalCapture] = useState<ComboInputCapture | null>(null);
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [originalError, setOriginalError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState<ProcessedComboInput | null>(null);
  const previewRef = useRef<ProcessedComboInput | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const deferredTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasDeferredEdits = useRef(false);
  const flushInProgress = useRef(false);
  const [processingNotice, setProcessingNotice] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [editingPress, setEditingPress] = useState<ProcessedComboInput["presses"][number] | null>(
    null,
  );
  const [editNotation, setEditNotation] = useState("");
  const [editSeparator, setEditSeparator] = useState<" " | "~">(" ");
  const [editPosition, setEditPosition] = useState<"keep" | "grounded" | "airborne">("keep");
  const [directionDialogPress, setDirectionDialogPress] = useState<
    ProcessedComboInput["presses"][number] | null
  >(null);
  const [directionValue, setDirectionValue] = useState("");
  const [chipMenu, setChipMenu] = useState<{
    press: ProcessedComboInput["presses"][number];
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const hoveredChip = useRef<{
    timeMs: number;
    physicalButton: string;
    element: HTMLElement;
  } | null>(null);
  const [shortcutBindings, setShortcutBindings] = useState(loadChipShortcutBindings);
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);
  const [capturingShortcut, setCapturingShortcut] = useState<ChipShortcutAction | null>(null);
  const [shortcutError, setShortcutError] = useState("");
  const processed = preview ?? recording.processedComboInput;
  const capture = recording.comboInputCapture;
  const rightFacingPresses =
    processed?.presses.filter((press) => press.interpretations.right.notation) ?? [];
  const processedRows = useMemo(() => {
    if (!processed) return [];
    return [
      ...processed.directionChanges.map((event) => ({ kind: "direction" as const, ...event })),
      ...processed.presses.map((event) => ({ kind: "press" as const, ...event })),
    ].sort(
      (left, right) =>
        left.timeMs - right.timeMs ||
        left.sourceStateIndex - right.sourceStateIndex ||
        (left.kind === right.kind ? 0 : left.kind === "direction" ? -1 : 1),
    );
  }, [processed]);

  useEffect(() => {
    if (
      !hasDeferredEdits.current &&
      previewRef.current?.processedAt === recording.processedComboInput?.processedAt
    ) {
      previewRef.current = null;
      setPreview(null);
    }
  }, [recording.processedComboInput?.processedAt]);

  useEffect(() => {
    const recordingId = recording.id;
    return () => {
      if (deferredTimer.current) clearTimeout(deferredTimer.current);
      if (hasDeferredEdits.current && !flushInProgress.current) {
        void saveQueue.current
          .then(() => window.electronAPI?.recordings.reprocessComboInputs({ recordingId }))
          .catch(() => undefined);
      }
    };
  }, [recording.id]);

  useEffect(() => {
    const refresh = () => setShortcutBindings(loadChipShortcutBindings());
    window.addEventListener(chipShortcutChangedEvent, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(chipShortcutChangedEvent, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const selectView = async (next: InputView) => {
    setView(next);
    setPage(1);
    if (next !== "original-raw" || originalCapture || loadingOriginal) return;
    const api = window.electronAPI?.recordings;
    if (!api) {
      setOriginalError("Recording controls are unavailable.");
      return;
    }
    setLoadingOriginal(true);
    setOriginalError(null);
    try {
      const original = await api.getOriginalComboInputs({
        recordingId: recording.id,
      });
      if (!original) throw new Error("The preserved raw input file is missing.");
      setOriginalCapture(original);
    } catch (error) {
      setOriginalError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingOriginal(false);
    }
  };

  const reprocess = async () => {
    if (processing) return;
    const api = window.electronAPI?.recordings;
    if (!api) {
      setProcessingError("Recording controls are unavailable.");
      return;
    }
    setProcessing(true);
    flushInProgress.current = true;
    setProcessingError(null);
    setProcessingNotice(null);
    if (deferredTimer.current) clearTimeout(deferredTimer.current);
    deferredTimer.current = null;
    try {
      await saveQueue.current;
      const result = await api.reprocessComboInputs({
        recordingId: recording.id,
      });
      hasDeferredEdits.current = false;
      previewRef.current = result;
      setPreview(result);
      await onUpdated();
      onProcessingComplete?.();
      if (result.processorVersion < CHIP_EDIT_PROCESSOR_VERSION) {
        setProcessingError(
          `Reprocessed with combo processor v${result.processorVersion}. Restart Labatar to load v${CHIP_EDIT_PROCESSOR_VERSION} and enable fast chip edits.`,
        );
      } else {
        setProcessingNotice(
          `Reprocessed ${result.source.stateCount} clip-aligned raw states at ${new Date(result.processedAt).toLocaleString()}.`,
        );
      }
    } catch (error) {
      setProcessingError(error instanceof Error ? error.message : String(error));
    } finally {
      flushInProgress.current = false;
      setProcessing(false);
    }
  };

  const openPressEditor = (press: ProcessedComboInput["presses"][number]) => {
    setEditingPress(press);
    setEditNotation(press.manualEdit?.notation ?? "");
    setEditSeparator(press.manualEdit?.separator ?? " ");
    setEditPosition(press.manualEdit?.positionAfter ?? "keep");
    setProcessingError(null);
  };

  const updatePressEdit = async (
    press: ProcessedComboInput["presses"][number],
    edit: NonNullable<ProcessedComboInput["presses"][number]["manualEdit"]> | null,
  ) => {
    if (processing) return;
    const api = window.electronAPI?.recordings;
    if (!api) return setProcessingError("Recording controls are unavailable.");
    setProcessing(true);
    flushInProgress.current = true;
    setProcessingError(null);
    setProcessingNotice(null);
    if (deferredTimer.current) clearTimeout(deferredTimer.current);
    deferredTimer.current = null;
    try {
      await saveQueue.current;
      const updated = await api.setComboInputEdit({
        recordingId: recording.id,
        timeMs: press.timeMs,
        physicalButton: press.physicalButton,
        edit: edit && Object.keys(edit).length ? edit : null,
      });
      if ("deferred" in updated) throw new Error("The move edit was not processed.");
      hasDeferredEdits.current = false;
      previewRef.current = updated;
      setPreview(updated);
      await onUpdated();
      onEdited?.();
      onProcessingComplete?.();
      setEditingPress(null);
      if (updated.processorVersion < CHIP_EDIT_PROCESSOR_VERSION && edit?.togglePosition) {
        setProcessingError(
          `Saved the position toggle, but this Electron window is running processor v${updated.processorVersion}. Restart Labatar to load the current chip processor.`,
        );
      } else {
        setProcessingNotice("Saved the track edit and rebuilt processed inputs.");
      }
    } catch (error) {
      setProcessingError(error instanceof Error ? error.message : String(error));
    } finally {
      flushInProgress.current = false;
      setProcessing(false);
    }
  };

  const changeChipEdit = (
    press: ProcessedComboInput["presses"][number],
    change:
      | "separator"
      | "togglePosition"
      | "anyAttack"
      | "delay"
      | "charged"
      | "crit"
      | "direction",
    directionOverride?: string | null,
  ) => {
    if (processing) return;
    setChipMenu(null);
    const current = previewRef.current ?? recording.processedComboInput;
    const currentPress = current?.presses.find(
      (item) => item.timeMs === press.timeMs && item.physicalButton === press.physicalButton,
    );
    const api = window.electronAPI?.recordings;
    if (!current || !currentPress || !api) {
      setProcessingError("Recording controls are unavailable.");
      return;
    }
    const edit = { ...currentPress.manualEdit };
    if (change === "separator") {
      if (edit.separator === "~") delete edit.separator;
      else edit.separator = "~";
    } else if (change === "togglePosition") {
      if (edit.togglePosition) delete edit.togglePosition;
      else edit.togglePosition = true;
    } else if (change === "charged") {
      if (edit.charged) delete edit.charged;
      else edit.charged = true;
    } else if (change === "delay") {
      if (edit.delay) delete edit.delay;
      else edit.delay = true;
    } else if (change === "anyAttack") {
      if (edit.anyAttack) delete edit.anyAttack;
      else edit.anyAttack = true;
    } else if (change === "crit") {
      if (edit.crit) delete edit.crit;
      else edit.crit = true;
    } else if (directionOverride === null) {
      delete edit.directionOverride;
    } else if (directionOverride !== undefined) {
      edit.directionOverride = directionOverride;
    }
    const next = previewComboChipEdit(current, currentPress, edit);
    previewRef.current = next;
    setPreview(next);
    hasDeferredEdits.current = true;
    setProcessingError(null);
    setProcessingNotice("Preview updated. Saving edits; processing after you pause editing.");
    saveQueue.current = saveQueue.current
      .then(async () => {
        const result = await api.setComboInputEdit({
          recordingId: recording.id,
          timeMs: currentPress.timeMs,
          physicalButton: currentPress.physicalButton,
          edit: Object.keys(edit).length ? edit : null,
          deferProcessing: true,
        });
        onEdited?.();
        if (!("deferred" in result)) {
          if (deferredTimer.current) clearTimeout(deferredTimer.current);
          deferredTimer.current = null;
          hasDeferredEdits.current = false;
          previewRef.current = result;
          setPreview(result);
          await onUpdated();
        }
      })
      .catch(async (error) => {
        hasDeferredEdits.current = false;
        previewRef.current = null;
        setPreview(null);
        setProcessingError(error instanceof Error ? error.message : String(error));
        await onUpdated().catch(() => undefined);
      });
    if (deferredTimer.current) clearTimeout(deferredTimer.current);
    deferredTimer.current = setTimeout(() => void reprocess(), CHIP_EDIT_IDLE_DELAY_MS);
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (shortcutDialogOpen) {
        if (!capturingShortcut) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.repeat) return;
        if (event.key === "Escape") {
          setCapturingShortcut(null);
          setShortcutError("");
          return;
        }
        const key =
          event.ctrlKey || event.altKey || event.metaKey
            ? null
            : normalizeChipShortcutKey(event.key);
        if (!key) {
          setShortcutError("Press one printable key without Ctrl, Alt, or Command.");
          return;
        }
        const conflict = chipShortcutActions.find(
          (action) => action !== capturingShortcut && shortcutBindings[action] === key,
        );
        if (conflict) {
          setShortcutError(`${key} is already assigned to ${chipShortcutLabels[conflict]}.`);
          return;
        }
        const next = { ...shortcutBindings, [capturingShortcut]: key };
        try {
          saveChipShortcutBindings(next);
          setShortcutBindings(next);
          setCapturingShortcut(null);
          setShortcutError("");
        } catch {
          setShortcutError("Could not save keyboard shortcuts on this device.");
        }
        return;
      }
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        processing ||
        chipMenu ||
        directionDialogPress ||
        editingPress ||
        (!compact && view !== "processed") ||
        !hoveredChip.current
      ) {
        return;
      }
      const targetDialog =
        event.target instanceof Element ? event.target.closest('[role="dialog"]') : null;
      if (targetDialog && !targetDialog.contains(hoveredChip.current.element)) return;
      const key = normalizeChipShortcutKey(event.key);
      const action = chipShortcutActions.find((candidate) => shortcutBindings[candidate] === key);
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const current = previewRef.current ?? recording.processedComboInput;
      if (!current || current.processorVersion < CHIP_EDIT_PROCESSOR_VERSION) {
        setProcessingError(
          "Reprocess clip inputs with the current Electron app before using chip shortcuts.",
        );
        return;
      }
      const press = current.presses.find(
        (item) =>
          item.timeMs === hoveredChip.current?.timeMs &&
          item.physicalButton === hoveredChip.current?.physicalButton,
      );
      if (!press?.interpretations.right.notation) return;
      if (action === "anyAttack" && !["A", "B", "C"].includes(press.gameButton ?? "")) return;
      if (
        action === "followup" &&
        current.presses.find((item) => item.interpretations.right.notation) === press
      ) {
        return;
      }
      if (
        action === "charged" &&
        !/(?:\[(?:EX|SUP|TH|[A-Z])\]|EX|SUP|TH|[A-Z])!?$/.test(press.interpretations.right.notation)
      ) {
        return;
      }
      changeChipEdit(
        press,
        action === "removeDirection" ? "direction" : action === "followup" ? "separator" : action,
        action === "removeDirection" ? "" : undefined,
      );
    };
    window.addEventListener("keydown", handleShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleShortcut, { capture: true });
  }, [
    capturingShortcut,
    changeChipEdit,
    chipMenu,
    compact,
    directionDialogPress,
    editingPress,
    processing,
    recording.processedComboInput,
    shortcutBindings,
    shortcutDialogOpen,
    view,
  ]);

  const closeDirectionDialog = () => {
    setDirectionDialogPress(null);
    if (hasDeferredEdits.current && !deferredTimer.current) {
      deferredTimer.current = setTimeout(() => void reprocess(), CHIP_EDIT_IDLE_DELAY_MS);
    }
  };

  const savePressEdit = async (reset = false) => {
    if (!editingPress || processing) return;
    const notation = editNotation.trim();
    if (!reset && notation && !/^[^\s~<>]{1,40}$/.test(notation)) {
      return setProcessingError("Use one move token without spaces or ~ (up to 40 characters).");
    }
    const edit = reset
      ? null
      : {
          ...(notation ? { notation } : {}),
          ...(editSeparator === "~" ? { separator: "~" as const } : {}),
          ...(editPosition !== "keep" ? { positionAfter: editPosition } : {}),
          ...(editingPress.manualEdit?.togglePosition ? { togglePosition: true as const } : {}),
          ...(editingPress.manualEdit?.charged ? { charged: true as const } : {}),
          ...(editingPress.manualEdit?.delay ? { delay: true as const } : {}),
          ...(editingPress.manualEdit?.anyAttack ? { anyAttack: true as const } : {}),
          ...(editingPress.manualEdit?.crit ? { crit: true as const } : {}),
          ...(editingPress.manualEdit?.directionOverride !== undefined
            ? { directionOverride: editingPress.manualEdit.directionOverride }
            : {}),
        };
    await updatePressEdit(editingPress, edit);
  };

  const rowCount =
    view === "processed"
      ? processedRows.length
      : view === "original-raw"
        ? (originalCapture?.states.length ?? 0)
        : (capture?.states.length ?? 0);
  const pages = Math.max(1, Math.ceil(rowCount / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const jumpToPlayhead = () => {
    const timeline =
      view === "processed"
        ? processedRows
        : view === "original-raw"
          ? (originalCapture?.states ?? [])
          : (capture?.states ?? []);
    if (!timeline.length) return;
    const targetTime =
      view === "original-raw" ? playheadMs + (recording.comboInputRawStartMs ?? 0) : playheadMs;
    const nextIndex = timeline.findIndex((event) => event.timeMs >= targetTime);
    const index = nextIndex < 0 ? timeline.length - 1 : nextIndex;
    setPage(Math.floor(index / PAGE_SIZE) + 1);
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ alignItems: { sm: "center" } }}
      >
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {compact ? "Recorded inputs" : "Combo input inspection"}
        </Typography>
        {!compact && (
          <Button
            size="small"
            variant="text"
            disabled={
              !rowCount || (view === "original-raw" && recording.comboInputRawStartMs == null)
            }
            onClick={jumpToPlayhead}
          >
            Jump to playhead
          </Button>
        )}
        <Button
          size="small"
          variant="outlined"
          disabled={processing}
          onClick={() => void reprocess()}
        >
          {processing
            ? "Processing…"
            : hasDeferredEdits.current
              ? "Apply pending edits now"
              : "Reprocess clip inputs"}
        </Button>
        <Button
          size="small"
          variant="text"
          onClick={() => {
            setShortcutError("");
            setShortcutDialogOpen(true);
          }}
        >
          Chip shortcuts
        </Button>
      </Stack>
      {!compact && (
        <Typography variant="caption" color="text.secondary">
          Reprocessing reads clip-aligned raw states, reapplies saved edits, and updates the
          processed JSON file.
        </Typography>
      )}
      {processingNotice && (
        <Alert severity="success" sx={{ mt: 1 }}>
          {processingNotice}
        </Alert>
      )}
      {processingError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {processingError}
        </Alert>
      )}
      {compact && processed && processed.processorVersion < CHIP_EDIT_PROCESSOR_VERSION && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          Restart Labatar to enable the current input chip options.
        </Alert>
      )}
      {compact &&
        (processed ? (
          rightFacingPresses.length ? (
            <Box
              aria-label="Facing right combo input track"
              sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5, mt: 1 }}
            >
              {rightFacingPresses.map((press, index) => (
                <Box
                  key={`${press.timeMs}:${press.physicalButton}`}
                  sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
                >
                  {index > 0 && press.manualEdit?.separator === "~" && (
                    <Typography component="span" sx={{ fontFamily: "monospace" }}>
                      ~
                    </Typography>
                  )}
                  <Chip
                    clickable
                    disabled={processing}
                    size="small"
                    color={press.context.position === "airborne" ? "secondary" : "default"}
                    variant={press.manualEdit?.togglePosition ? "outlined" : "filled"}
                    label={press.interpretations.right.notation}
                    title={`${inputTime(press.timeMs)} · ${press.context.position} · Click to edit token; right-click for options`}
                    onMouseEnter={(event) => {
                      hoveredChip.current = {
                        timeMs: press.timeMs,
                        physicalButton: press.physicalButton,
                        element: event.currentTarget,
                      };
                    }}
                    onMouseLeave={() => {
                      hoveredChip.current = null;
                    }}
                    onClick={() => openPressEditor(press)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setChipMenu({ press, mouseX: event.clientX, mouseY: event.clientY });
                    }}
                  />
                </Box>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No mapped presses
            </Typography>
          )
        ) : (
          <Alert severity="warning" sx={{ mt: 1 }}>
            Processed inputs are unavailable. Try Reprocess clip inputs.
          </Alert>
        ))}
      {!compact && (
        <>
          <Tabs
            value={view}
            onChange={(_, next: InputView) => void selectView(next)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mt: 1, mb: 1 }}
          >
            <Tab value="clip-raw" label="Raw clip states" />
            <Tab value="processed" label="Processed events" />
            {recording.originalComboInputAvailable && (
              <Tab value="original-raw" label="Preserved raw session" />
            )}
          </Tabs>
          {view === "clip-raw" && capture && (
            <>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                {capture.states.length} state changes · {inputTime(capture.durationMs)} · Controller{" "}
                {capture.deviceIndex}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                These states are aligned to the current MP4. The saved action labels come from the
                controller bindings at capture time.
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                Source: {recording.name}.labatar.json
              </Typography>
              <RawCaptureDetails capture={capture} />
              <RawInputRows capture={capture} page={currentPage} />
            </>
          )}
          {view === "processed" &&
            (processed ? (
              <>
                {processed.processorVersion < CHIP_EDIT_PROCESSOR_VERSION && (
                  <Alert severity="warning" sx={{ mb: 1 }}>
                    This Electron window is running combo processor v{processed.processorVersion}.
                    Restart Labatar to enable the current chip options. Saved edits will be
                    reprocessed when it starts.
                  </Alert>
                )}
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  Facing right
                </Typography>
                {rightFacingPresses.length ? (
                  <Box
                    aria-label="Facing right combo input track"
                    sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5 }}
                  >
                    {rightFacingPresses.map((press, index) => (
                      <Box
                        key={`${press.timeMs}:${press.physicalButton}`}
                        sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
                      >
                        {index > 0 && press.manualEdit?.separator === "~" && (
                          <Typography component="span" sx={{ fontFamily: "monospace" }}>
                            ~
                          </Typography>
                        )}
                        <Chip
                          clickable
                          disabled={processing}
                          size="small"
                          color={press.context.position === "airborne" ? "secondary" : "default"}
                          variant={press.manualEdit?.togglePosition ? "outlined" : "filled"}
                          label={press.interpretations.right.notation}
                          title={`${inputTime(press.timeMs)} · ${press.context.position} · Click to edit token; right-click for options`}
                          aria-label={`${press.interpretations.right.notation}, ${press.context.position}, ${inputTime(press.timeMs)}. Click to edit; right-click for options.`}
                          onMouseEnter={(event) => {
                            hoveredChip.current = {
                              timeMs: press.timeMs,
                              physicalButton: press.physicalButton,
                              element: event.currentTarget,
                            };
                          }}
                          onMouseLeave={() => {
                            hoveredChip.current = null;
                          }}
                          onClick={() => openPressEditor(press)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setChipMenu({ press, mouseX: event.clientX, mouseY: event.clientY });
                          }}
                        />
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No mapped presses
                  </Typography>
                )}
                <Typography
                  variant="body2"
                  sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}
                >
                  Facing left: {processed.routes.left || "No mapped presses"}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.5 }}
                >
                  Processor v{processed.processorVersion} · {processed.processedAt} · Default:
                  facing right, grounded · Source SHA-256: {processed.source.sha256}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  Click a chip to edit its move token. Right-click a chip to make it a ~ follow-up
                  or flip airborne/grounded for that chip and every later chip, or mark its button
                  charged with [], mark it critical with !, or prefix it with dl. for delay.
                  Airborne chips use j.; outlined chips mark a position toggle. The menu also
                  replaces or removes a leading direction. Edits survive reprocessing and trimming.
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  File: {recording.name}.combo-inputs.processed.json
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  Track edits: {recording.name}.combo-inputs.edits.json
                  {processed.source.editsSha256
                    ? ` · Edits SHA-256: ${processed.source.editsSha256}`
                    : ""}
                </Typography>
                <TableContainer sx={{ maxHeight: 410, mt: 1 }}>
                  <Table size="small" stickyHeader aria-label="Processed controller events">
                    <TableHead>
                      <TableRow>
                        <TableCell>Time</TableCell>
                        <TableCell>Event</TableCell>
                        <TableCell>Interpretation</TableCell>
                        <TableCell>Raw state</TableCell>
                        <TableCell>Track</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {processedRows
                        .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
                        .map((event, index) => (
                          <TableRow key={`${event.kind}-${event.sourceStateIndex}-${index}`}>
                            <TableCell sx={{ fontFamily: "monospace" }}>
                              {inputTime(event.timeMs)}
                            </TableCell>
                            <TableCell>
                              {event.kind === "press" ? "Button press" : "Direction change"}
                            </TableCell>
                            <TableCell>
                              {event.kind === "press"
                                ? `${event.interpretations.right.notation ?? "Unmapped"} (left: ${event.interpretations.left.notation ?? "Unmapped"}) · ${event.context.position}${event.positionAfter ? ` → ${event.positionAfter} after move` : ""} · Controller ${event.physicalButton} → ${event.gameAction ?? "unmapped"}`
                                : `Direction ${event.direction}${event.heldButtons.length ? ` · Held ${event.heldGameButtons.join("+") || event.heldButtons.join("+")} (controller ${event.heldButtons.join("+")})` : ""}`}
                            </TableCell>
                            <TableCell>{event.sourceStateIndex}</TableCell>
                            <TableCell>
                              {event.kind === "press" && (
                                <Button size="small" onClick={() => openPressEditor(event)}>
                                  {event.manualEdit ? "Edit saved" : "Edit"}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            ) : (
              <Alert severity="warning">
                Processed inputs are unavailable. Try Reprocess clip inputs.
              </Alert>
            ))}
          {view === "original-raw" &&
            (loadingOriginal ? (
              <Typography variant="body2">Loading preserved raw inputs…</Typography>
            ) : originalError ? (
              <Alert severity="error">{originalError}</Alert>
            ) : originalCapture ? (
              <>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  {originalCapture.states.length} original state changes ·{" "}
                  {inputTime(originalCapture.durationMs)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Times here start at the preserved capture.
                  {typeof recording.comboInputRawStartMs === "number"
                    ? ` The current MP4 begins ${inputTime(recording.comboInputRawStartMs)} into this timeline.`
                    : " The current MP4's offset into this capture is unavailable."}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  File: {recording.name}.combo-inputs.raw.json
                </Typography>
                <RawCaptureDetails capture={originalCapture} />
                <RawInputRows capture={originalCapture} page={currentPage} />
              </>
            ) : null)}
          {rowCount > PAGE_SIZE && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 1 }}>
              <Pagination
                count={pages}
                page={currentPage}
                onChange={(_, next) => setPage(next)}
                size="small"
              />
            </Box>
          )}
        </>
      )}
      <Menu
        open={Boolean(chipMenu)}
        onClose={() => setChipMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={chipMenu ? { top: chipMenu.mouseY, left: chipMenu.mouseX } : undefined}
      >
        <MenuItem
          selected={chipMenu?.press.manualEdit?.separator === "~"}
          disabled={
            processing ||
            !chipMenu ||
            !processed ||
            processed.processorVersion < CHIP_EDIT_PROCESSOR_VERSION ||
            rightFacingPresses[0] === chipMenu.press
          }
          onClick={() => chipMenu && changeChipEdit(chipMenu.press, "separator")}
        >
          <ShortcutMenuLabel
            shortcut={shortcutBindings.followup}
            label={`~ (follow-up) ${chipMenu?.press.manualEdit?.separator === "~" ? "✓" : ""}`}
          />
        </MenuItem>
        <MenuItem
          selected={Boolean(chipMenu?.press.manualEdit?.togglePosition)}
          disabled={
            processing ||
            !chipMenu ||
            !processed ||
            processed.processorVersion < CHIP_EDIT_PROCESSOR_VERSION
          }
          onClick={() => chipMenu && changeChipEdit(chipMenu.press, "togglePosition")}
        >
          <ShortcutMenuLabel
            shortcut={shortcutBindings.togglePosition}
            label="Toggle airborne/grounded from here"
          />
        </MenuItem>
        <MenuItem
          disabled={
            processing ||
            !chipMenu ||
            !processed ||
            processed.processorVersion < CHIP_EDIT_PROCESSOR_VERSION
          }
          onClick={() => chipMenu && changeChipEdit(chipMenu.press, "direction", "")}
        >
          <ShortcutMenuLabel shortcut={shortcutBindings.removeDirection} label="Remove direction" />
        </MenuItem>
        <MenuItem
          selected={Boolean(chipMenu?.press.manualEdit?.anyAttack)}
          disabled={
            processing ||
            !chipMenu ||
            !processed ||
            processed.processorVersion < CHIP_EDIT_PROCESSOR_VERSION ||
            !["A", "B", "C"].includes(chipMenu.press.gameButton ?? "")
          }
          onClick={() => chipMenu && changeChipEdit(chipMenu.press, "anyAttack")}
        >
          <ShortcutMenuLabel
            shortcut={shortcutBindings.anyAttack}
            label={`Any attack button (X) ${chipMenu?.press.manualEdit?.anyAttack ? "✓" : ""}`}
          />
        </MenuItem>
        <MenuItem
          selected={Boolean(chipMenu?.press.manualEdit?.delay)}
          disabled={
            processing ||
            !chipMenu ||
            !processed ||
            processed.processorVersion < CHIP_EDIT_PROCESSOR_VERSION
          }
          onClick={() => chipMenu && changeChipEdit(chipMenu.press, "delay")}
        >
          <ShortcutMenuLabel
            shortcut={shortcutBindings.delay}
            label={`Delay dl. ${chipMenu?.press.manualEdit?.delay ? "✓" : ""}`}
          />
        </MenuItem>
        <MenuItem
          selected={Boolean(chipMenu?.press.manualEdit?.charged)}
          disabled={
            processing ||
            !chipMenu ||
            !processed ||
            processed.processorVersion < CHIP_EDIT_PROCESSOR_VERSION ||
            !/(?:\[(?:EX|SUP|TH|[A-Z])\]|EX|SUP|TH|[A-Z])!?$/.test(
              chipMenu.press.interpretations.right.notation ?? "",
            )
          }
          onClick={() => chipMenu && changeChipEdit(chipMenu.press, "charged")}
        >
          <ShortcutMenuLabel
            shortcut={shortcutBindings.charged}
            label={`Charged [] ${chipMenu?.press.manualEdit?.charged ? "✓" : ""}`}
          />
        </MenuItem>
        <MenuItem
          selected={Boolean(chipMenu?.press.manualEdit?.crit)}
          disabled={
            processing ||
            !chipMenu ||
            !processed ||
            processed.processorVersion < CHIP_EDIT_PROCESSOR_VERSION
          }
          onClick={() => chipMenu && changeChipEdit(chipMenu.press, "crit")}
        >
          <ShortcutMenuLabel
            shortcut={shortcutBindings.crit}
            label={`Crit ! ${chipMenu?.press.manualEdit?.crit ? "✓" : ""}`}
          />
        </MenuItem>
        <Divider />
        <MenuItem
          disabled={
            processing ||
            !chipMenu ||
            !processed ||
            processed.processorVersion < CHIP_EDIT_PROCESSOR_VERSION
          }
          onClick={() => {
            if (!chipMenu) return;
            const press = chipMenu.press;
            setDirectionValue(
              press.manualEdit?.directionOverride ??
                press.interpretations.right.notation?.match(/^(?:dl\.)?(?:j\.)?([1-9]+)/)?.[1] ??
                "",
            );
            setDirectionDialogPress(press);
            setChipMenu(null);
            if (deferredTimer.current) clearTimeout(deferredTimer.current);
            deferredTimer.current = null;
          }}
        >
          Override direction…
        </MenuItem>
        <MenuItem
          disabled={
            processing ||
            !chipMenu ||
            !processed ||
            processed.processorVersion < CHIP_EDIT_PROCESSOR_VERSION ||
            chipMenu.press.manualEdit?.directionOverride === undefined
          }
          onClick={() => chipMenu && changeChipEdit(chipMenu.press, "direction", null)}
        >
          Clear direction override
        </MenuItem>
      </Menu>
      <Dialog
        open={shortcutDialogOpen}
        onClose={() => {
          setShortcutDialogOpen(false);
          setCapturingShortcut(null);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Chip shortcuts</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1.5, pt: "12px !important" }}>
          <Typography variant="body2" color="text.secondary">
            Hover a facing-right chip and press its assigned key. Shortcuts are saved on this
            device. Press Escape to cancel assigning a key.
          </Typography>
          {chipShortcutActions.map((action) => (
            <Stack
              key={action}
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", justifyContent: "space-between" }}
            >
              <Typography variant="body2">{chipShortcutLabels[action]}</Typography>
              <Button
                size="small"
                variant={capturingShortcut === action ? "contained" : "outlined"}
                onClick={() => {
                  setCapturingShortcut(action);
                  setShortcutError("");
                }}
                sx={{ minWidth: 92, fontFamily: "monospace" }}
              >
                {capturingShortcut === action ? "Press key…" : shortcutBindings[action]}
              </Button>
            </Stack>
          ))}
          {shortcutError && <Alert severity="error">{shortcutError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              try {
                saveChipShortcutBindings(defaultChipShortcutBindings);
                setShortcutBindings({ ...defaultChipShortcutBindings });
                setCapturingShortcut(null);
                setShortcutError("");
              } catch {
                setShortcutError("Could not save keyboard shortcuts on this device.");
              }
            }}
          >
            Reset defaults
          </Button>
          <Button
            onClick={() => {
              setShortcutDialogOpen(false);
              setCapturingShortcut(null);
            }}
          >
            Done
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(directionDialogPress)}
        onClose={() => !processing && closeDirectionDialog()}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Override direction</DialogTitle>
        <DialogContent sx={{ pt: "12px !important" }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Numpad direction or motion"
            value={directionValue}
            onChange={(event) => setDirectionValue(event.target.value)}
            error={!/^[1-9]{0,8}$/.test(directionValue)}
            helperText="Enter 1–9 digits, such as 6, 236, or 623. Leave blank to remove the direction."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDirectionDialog} disabled={processing}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={processing || !/^[1-9]{0,8}$/.test(directionValue)}
            onClick={() => {
              if (!directionDialogPress) return;
              changeChipEdit(directionDialogPress, "direction", directionValue);
              setDirectionDialogPress(null);
            }}
          >
            Save direction
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(editingPress)}
        onClose={() => !processing && setEditingPress(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Edit processed move</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 2, pt: "12px !important" }}>
          <Typography variant="body2" color="text.secondary">
            {editingPress &&
              `${inputTime(editingPress.timeMs)} · Controller ${editingPress.physicalButton} · Suggested ${editingPress.interpretations.right.suggestedNotation ?? "unmapped"}`}
          </Typography>
          <TextField
            label="Track token"
            value={editNotation}
            onChange={(event) => setEditNotation(event.target.value)}
            placeholder={editingPress?.interpretations.right.suggestedNotation ?? "236X"}
            helperText="Leave blank to use the suggested token. For example, enter 236X or XX."
            size="small"
          />
          <FormControl size="small">
            <InputLabel id="combo-input-separator-label">Join with previous</InputLabel>
            <Select
              labelId="combo-input-separator-label"
              label="Join with previous"
              value={editSeparator}
              onChange={(event) => setEditSeparator(event.target.value as " " | "~")}
            >
              <MenuItem value=" ">Space (next move)</MenuItem>
              <MenuItem value="~">~ (follow-up)</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small">
            <InputLabel id="combo-input-position-label">Position after this move</InputLabel>
            <Select
              labelId="combo-input-position-label"
              label="Position after this move"
              value={editPosition}
              onChange={(event) => setEditPosition(event.target.value as typeof editPosition)}
            >
              <MenuItem value="keep">Keep current position</MenuItem>
              <MenuItem value="airborne">Airborne</MenuItem>
              <MenuItem value="grounded">Grounded</MenuItem>
            </Select>
          </FormControl>
          {processingError && <Alert severity="error">{processingError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => void savePressEdit(true)} disabled={processing}>
            Reset move
          </Button>
          <Button onClick={() => setEditingPress(null)} disabled={processing}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void savePressEdit()} disabled={processing}>
            Save and reprocess
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
