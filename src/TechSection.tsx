import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import type { RecordedVideo } from "./recording-types";
import supportMap from "../electron/support-map.json";
import { useObsRecording } from "./ObsRecordingContext";
import { RecordingViewer } from "./RecordingViewer";
import { ComboTable, ComboWorkspace, type ComboTableRow } from "./ComboTable";
import { comboStarterLabel } from "./combo-starter";
import {
  comboScreenPositions,
  comboScreenPositionOrEmpty,
  isComboScreenPosition,
} from "./combo-screen-position";
import { formatComboRecordingBaseName } from "./combo-recording-name";
import {
  ComboInlineFilters,
  emptyComboInlineFilters,
  matchesComboInlineFilters,
  type ComboInlineFilterState,
} from "./ComboInlineFilters";
import {
  comboNoteCategoryLabel,
  comboNoteRangeFromSelection,
  comboNoteRangeOffsets,
  comboNotesOverlap,
  normalizeComboNotes,
} from "./combo-notes";
import {
  makePublishComboDraft,
  matchesPublishedCombo,
  publishedComboFromDraft,
} from "./publish-combo-draft";
import { catalogApiUrl, fetchPublishedCombos, type PublishedCombo } from "./published-catalog";
import { moveTakeOutcomes, type MoveTakeOutcome } from "./move-capture-types";
import { isNonMotionFMove, resolveFlowStance, withCommonTechMoves } from "./common-tech-moves";
import { effectiveMeasurement } from "./move-measurements";
import {
  chargedInputFor,
  linkLegacyChargedMoves,
  withChargedVariant,
} from "./charged-move-variants";
import {
  techCatalogStorageKey,
  techCatalogUpdatedEvent,
  techSelectComboEvent,
  techSelectRecordingEvent,
  techSelectedComboStorageKey,
  techSelectedRecordingStorageKey,
} from "./tech-types";
import type {
  TechCatalog,
  TechCombo,
  ComboNote,
  ComboNoteRange,
  TechMove,
  TechStanceFollowupPattern,
  TechMeasuredField,
} from "./tech-types";
import {
  classifyMoveInput,
  isFlowCancellableByDefault,
  moveNotationsMatch,
  normalizeMoveNotation,
  parseMoveNotation,
  stanceFollowupMatches,
} from "./move-notation";

type TechCharacter = {
  value: string;
  label: string;
};

const characters: TechCharacter[] = [
  { value: "Aang", label: "Aang" },
  { value: "Korra", label: "Korra" },
  { value: "Nightmare Korra", label: "N. Korra" },
  { value: "Zuko", label: "Zuko" },
  { value: "Katara", label: "Katara" },
  { value: "Toph", label: "Toph" },
  { value: "Sokka", label: "Sokka" },
  { value: "Azula", label: "Azula" },
  { value: "Kyoshi", label: "Kyoshi" },
  { value: "Ozai", label: "Ozai" },
  { value: "Zaheer", label: "Zaheer" },
  { value: "Avatar Aang", label: "Avatar Aang" },
];

const supportsByCharacter: Record<string, string[]> = Object.fromEntries(
  Object.entries(supportMap).map(([character, slots]) => [
    character,
    [slots["1"], slots["2"], slots["3"]],
  ]),
);

const techEditorSections = ["moves", "pressure", "neutral", "misc"] as const;
const techEditorSectionStorageKey = "labatar-tech-editor-section";
const measuredFields: Array<{ key: TechMeasuredField; label: string }> = [
  { key: "startup", label: "Startup" },
  { key: "active", label: "Active" },
  { key: "recovery", label: "Recovery" },
  { key: "onBlock", label: "On block" },
  { key: "blockstun", label: "Blockstun" },
  { key: "hitstunGrounded", label: "Grounded hitstun" },
  { key: "onHitGrounded", label: "On grounded hit" },
  { key: "hitstunAirborne", label: "Airborne hitstun" },
  { key: "onHitAirborne", label: "On airborne hit" },
];

type MoveDraft = {
  input: string;
  nonstandard: boolean;
  nonstandardNote: string;
  notApplicable: Partial<Record<MoveTakeOutcome, string>>;
  flowCancellable: boolean | null;
  isStanceParent: boolean;
  isNonAttack: boolean;
  isFlowStance: boolean;
  flowStanceOverride: boolean | null;
  hasChargedVersion: boolean;
  dependsOnMoveId: string;
  stanceMinimumDuration: string;
  flowStanceMinimumTimeToFlowCancel: string;
  flowStanceMinimumTimeToFollowup: string;
  flowStanceMaxDuration: string;
  startup: string;
  active: string;
  recovery: string;
  onBlock: string;
  blockstun: string;
  hitstun: string;
  pips: string;
  flow: string;
};

type ComboDraft = {
  route: string;
  routingMode: "autopilot" | "unique";
  screenPosition: string;
  damage: string;
  notes: ComboNote[];
  requiresCounterhit: boolean;
  initialConversionHitconfirmable: boolean;
  initialConversionSafeOnBlock: boolean;
  pips: string;
  flow: string;
  recordingId: string | null;
};

function newComboNoteId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `note-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

type PendingComboRecording = {
  character: string;
  comboId: string;
  sessionId: string;
};

type FinalizedComboRecording = {
  sessionId: string;
  recordingId: string | null;
  manifestError: string | null;
};

const pendingComboRecordingStorageKey = "labatar-pending-combo-recording-v1";

function readPendingComboRecording(): PendingComboRecording | null {
  try {
    const value = JSON.parse(localStorage.getItem(pendingComboRecordingStorageKey) ?? "null");
    return value &&
      typeof value.character === "string" &&
      typeof value.comboId === "string" &&
      typeof value.sessionId === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

const emptyMoveDraft: MoveDraft = {
  input: "",
  nonstandard: false,
  nonstandardNote: "",
  notApplicable: {},
  flowCancellable: null,
  isStanceParent: false,
  isNonAttack: false,
  isFlowStance: false,
  flowStanceOverride: null,
  hasChargedVersion: false,
  dependsOnMoveId: "",
  stanceMinimumDuration: "",
  flowStanceMinimumTimeToFlowCancel: "",
  flowStanceMinimumTimeToFollowup: "",
  flowStanceMaxDuration: "",
  startup: "",
  active: "",
  recovery: "",
  onBlock: "",
  blockstun: "",
  hitstun: "",
  pips: "0",
  flow: "0",
};

const emptyComboDraft: ComboDraft = {
  route: "",
  routingMode: "autopilot",
  screenPosition: "corner",
  damage: "",
  notes: [],
  requiresCounterhit: false,
  initialConversionHitconfirmable: false,
  initialConversionSafeOnBlock: false,
  pips: "0",
  flow: "0",
  recordingId: null,
};

function loadTechCatalog(): TechCatalog {
  const catalog: TechCatalog = Object.fromEntries(
    characters.map(({ value }) => [value, { moves: [], supportMoves: [], combos: [] }]),
  );
  try {
    const stored = JSON.parse(localStorage.getItem(techCatalogStorageKey) ?? "null") as Record<
      string,
      Partial<TechCatalog[string]>
    > | null;
    for (const character of characters) {
      const storedCharacter = stored?.[character.value];
      if (!storedCharacter) continue;
      catalog[character.value].supportMoves = Array.isArray(storedCharacter.supportMoves)
        ? storedCharacter.supportMoves.filter(
            (entry) =>
              typeof entry?.id === "string" &&
              typeof entry?.baseMoveId === "string" &&
              typeof entry?.support === "string",
          )
        : [];
      if (Array.isArray(storedCharacter.moves)) {
        catalog[character.value].moves = storedCharacter.moves.map((move) => {
          const legacyMove = move as TechMove & {
            isRekka?: boolean;
            isStance?: boolean;
            rekkaFollowupPattern?: TechStanceFollowupPattern;
            rekkaMinimumDuration?: number;
          };
          const currentMove = { ...legacyMove };
          delete currentMove.isRekka;
          delete currentMove.isStance;
          delete currentMove.rekkaFollowupPattern;
          delete currentMove.rekkaMinimumDuration;
          const normalizedInput =
            typeof move.input === "string"
              ? normalizeMoveNotation(move.input, {
                  allowDirectionless: Boolean(move.dependsOnMoveId),
                })
              : null;
          const isFlowStance = resolveFlowStance(move);
          return {
            ...currentMove,
            input: normalizedInput ?? move.input,
            isStanceParent:
              move.isStanceParent === true || isFlowStance || legacyMove.isRekka === true,
            isNonAttack: move.isNonAttack === true,
            isFlowStance,
            flowStanceMinimumTimeToFlowCancel:
              typeof move.flowStanceMinimumTimeToFlowCancel === "number"
                ? move.flowStanceMinimumTimeToFlowCancel
                : null,
            flowStanceMinimumTimeToFollowup:
              typeof move.flowStanceMinimumTimeToFollowup === "number"
                ? move.flowStanceMinimumTimeToFollowup
                : null,
            flowStanceMaxDuration:
              typeof move.flowStanceMaxDuration === "number" ? move.flowStanceMaxDuration : null,
            isCharged: move.isCharged === true,
            nonstandard: move.nonstandard === true,
            nonstandardNote: typeof move.nonstandardNote === "string" ? move.nonstandardNote : "",
            flowCancellable:
              typeof move.flowCancellable === "boolean"
                ? move.flowCancellable
                : isFlowCancellableByDefault(normalizedInput ?? move.input, {
                    allowDirectionless: Boolean(move.dependsOnMoveId),
                  }),
            notApplicable: move.notApplicable ?? {},
            stanceFollowupPattern:
              (move.stanceFollowupPattern as TechStanceFollowupPattern | null) ===
              "directional-button"
                ? "directional-button"
                : legacyMove.rekkaFollowupPattern === "directional-button"
                  ? "directional-button"
                  : null,
            dependsOnMoveId: typeof move.dependsOnMoveId === "string" ? move.dependsOnMoveId : null,
            stanceMinimumDuration:
              typeof move.stanceMinimumDuration === "number"
                ? move.stanceMinimumDuration
                : (legacyMove.rekkaMinimumDuration ?? null),
            chargedMoveId: typeof move.chargedMoveId === "string" ? move.chargedMoveId : null,
            baseMoveId: typeof move.baseMoveId === "string" ? move.baseMoveId : null,
          };
        });
      }
      if (Array.isArray(storedCharacter.combos)) {
        catalog[character.value].combos = storedCharacter.combos.map((combo) => {
          const legacyCombo = combo as TechCombo & { recordingIds?: unknown };
          return {
            ...combo,
            moveIds: Array.isArray(combo.moveIds)
              ? combo.moveIds.map((moveId) => (typeof moveId === "string" ? moveId : null))
              : [],
            route: typeof combo.route === "string" ? combo.route : "",
            routingMode: combo.routingMode === "unique" ? "unique" : "autopilot",
            notes: normalizeComboNotes(combo.notes),
            requiresCounterhit: combo.requiresCounterhit === true,
            initialConversionHitconfirmable: combo.initialConversionHitconfirmable === true,
            initialConversionSafeOnBlock: combo.initialConversionSafeOnBlock === true,
            resourceCosts: {
              pips: combo.resourceCosts?.pips ?? 0,
              flow: combo.resourceCosts?.flow ?? 0,
            },
            recordingId:
              typeof combo.recordingId === "string"
                ? combo.recordingId
                : Array.isArray(legacyCombo.recordingIds) &&
                    typeof legacyCombo.recordingIds[0] === "string"
                  ? legacyCombo.recordingIds[0]
                  : null,
          };
        });
      }
    }
  } catch {
    // Use the empty catalog if local storage contains invalid tech data.
  }
  for (const character of characters) {
    catalog[character.value].moves = linkLegacyChargedMoves(
      withCommonTechMoves(character.value, catalog[character.value].moves),
    );
  }
  return catalog;
}

function parseMoveNumber(value: string) {
  const parsed = Number(value);
  return value.trim() === "" || !Number.isFinite(parsed) ? null : parsed;
}

function moveIdFor(character: string, input: string, existing: TechMove[]) {
  const base =
    `${character}-${input}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "move";
  let id = base;
  let suffix = 2;
  while (existing.some((move) => move.id === id)) id = `${base}-${suffix++}`;
  return id;
}

function getComboStarterMove(combo: TechCombo, moves: TechMove[]) {
  const starterId = combo.moveIds[0];
  return moves.find((move) => move.id === starterId) ?? null;
}

type ComboRouteToken = { input: string; followsStance: boolean };

function parseComboRoute(route: string): ComboRouteToken[] {
  const parts = route.split(/(->|>|,|~|\u2192)/g);
  const tokens: ComboRouteToken[] = [];
  let followsStance = false;
  for (const part of parts) {
    if (/^(?:->|>|,|~|\u2192)$/.test(part)) {
      followsStance = part === "~";
      continue;
    }
    for (const rawInput of part
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)) {
      const input =
        rawInput.length > 1 && rawInput.endsWith("!") ? rawInput.slice(0, -1) : rawInput;
      tokens.push({ input, followsStance });
      followsStance = false;
    }
  }
  return tokens;
}

function splitComboRoute(route: string) {
  return parseComboRoute(route).map(({ input }) => input);
}

function findKnownMove(input: string, moves: TechMove[]) {
  const matches = moves.filter((move) => moveNotationsMatch(move.input, input));
  return matches[0] ?? null;
}

function resolveComboRoute(route: string, moves: TechMove[]) {
  let activeStance: TechMove | null = null;
  return parseComboRoute(route).map((token) => {
    const move = token.followsStance
      ? activeStance
        ? (moves.find(
            (candidate) =>
              candidate.dependsOnMoveId === activeStance?.id &&
              (moveNotationsMatch(candidate.input, token.input) ||
                stanceFollowupMatches(candidate.input, token.input)),
          ) ?? null)
        : null
      : findKnownMove(token.input, moves);
    activeStance = token.followsStance ? activeStance : move?.isStanceParent ? move : null;
    return move?.id ?? null;
  });
}

function getComboRouteEntries(combo: TechCombo, moves: TechMove[]) {
  const tokens = parseComboRoute(combo.route);
  if (tokens.length > 0) {
    let activeStance: TechMove | null = null;
    return tokens.map((token, index) => {
      const savedMove = moves.find((candidate) => candidate.id === combo.moveIds[index]) ?? null;
      const move = token.followsStance
        ? activeStance
          ? ((savedMove?.dependsOnMoveId === activeStance.id &&
            (moveNotationsMatch(savedMove.input, token.input) ||
              stanceFollowupMatches(savedMove.input, token.input))
              ? savedMove
              : null) ??
            moves.find(
              (candidate) =>
                candidate.dependsOnMoveId === activeStance?.id &&
                (moveNotationsMatch(candidate.input, token.input) ||
                  stanceFollowupMatches(candidate.input, token.input)),
            ) ??
            null)
          : null
        : (savedMove ?? findKnownMove(token.input, moves));
      activeStance = token.followsStance ? activeStance : move?.isStanceParent ? move : null;
      return { token: token.input, move, followsStance: token.followsStance };
    });
  }
  return combo.moveIds.map((moveId) => {
    const move = moves.find((candidate) => candidate.id === moveId) ?? null;
    return { token: formatMoveLabel(move), move, followsStance: false };
  });
}

function getComboRouteText(combo: TechCombo, moves: TechMove[]) {
  if (combo.route.trim()) return combo.route.trim();
  return combo.moveIds
    .map((moveId) => formatMoveLabel(moves.find((move) => move.id === moveId) ?? null))
    .join(" → ");
}

function getComboStarterLabel(combo: TechCombo, moves: TechMove[]) {
  const firstRouteToken = splitComboRoute(combo.route)[0];
  const starterMove =
    getComboStarterMove(combo, moves) ??
    (firstRouteToken ? findKnownMove(firstRouteToken, moves) : null);
  const starter = starterMove
    ? formatMoveLabel(starterMove)
    : firstRouteToken ||
      getComboRouteText(combo, moves).split(/\s*(?:→|->|,)\s*/)[0] ||
      "Unknown starter";
  const fallbackFollowup = !combo.route.trim()
    ? moves.find((move) => move.id === combo.moveIds[1] && move.dependsOnMoveId === starterMove?.id)
        ?.input
    : undefined;
  return comboStarterLabel(
    starter,
    combo.route,
    starterMove?.isStanceParent === true && starterMove.isNonAttack === true,
    fallbackFollowup,
  );
}

function comboRecordingBaseName(combo: TechCombo, moves: TechMove[]) {
  return formatComboRecordingBaseName({
    character: combo.character,
    support: combo.support,
    starter: getComboStarterLabel(combo, moves),
    screenPosition: combo.screenPosition,
    damage: combo.damage,
  });
}

function formatMoveLabel(move: TechMove | null) {
  return move?.input ?? "Unknown move";
}

function frameValue(value: number | null) {
  return value == null ? "—" : String(value);
}

function getEffectiveStartup(
  move: TechMove | null,
  moves: TechMove[],
  visited = new Set<string>(),
): number | null {
  if (!move || move.startup == null || visited.has(move.id)) return null;
  if (!move.dependsOnMoveId) return move.startup;
  const parent = moves.find((candidate) => candidate.id === move.dependsOnMoveId);
  if (!parent) return null;
  const minimumFollowup = parent.isFlowStance
    ? parent.flowStanceMinimumTimeToFollowup
    : parent.stanceMinimumDuration;
  if (minimumFollowup == null) return null;
  visited.add(move.id);
  return minimumFollowup + move.startup;
}

function MoveList({
  moves,
  selectedMoveId,
  onEdit,
}: {
  moves: TechMove[];
  selectedMoveId: string | null;
  onEdit: (move: TechMove) => void;
}) {
  const moveTableColumns = "minmax(220px, 1fr) repeat(8, 64px)";
  const movesByParent = new Map<string, TechMove[]>();
  const moveIds = new Set(moves.map((move) => move.id));
  for (const move of moves) {
    if (!move.dependsOnMoveId || !moveIds.has(move.dependsOnMoveId)) continue;
    const siblings = movesByParent.get(move.dependsOnMoveId) ?? [];
    siblings.push(move);
    movesByParent.set(move.dependsOnMoveId, siblings);
  }
  const orderedMoves: Array<{ move: TechMove; depth: number }> = [];
  const visited = new Set<string>();
  const appendMove = (move: TechMove, depth: number) => {
    if (visited.has(move.id)) return;
    visited.add(move.id);
    orderedMoves.push({ move, depth });
    for (const followup of movesByParent.get(move.id) ?? []) appendMove(followup, depth + 1);
  };
  for (const move of moves) {
    if (!move.dependsOnMoveId || !moveIds.has(move.dependsOnMoveId)) appendMove(move, 0);
  }
  for (const move of moves) appendMove(move, 0);
  return (
    <Paper variant="outlined" sx={{ overflowX: "auto" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: moveTableColumns,
          columnGap: 1,
          minWidth: 850,
          px: 2,
          py: 1,
          bgcolor: "action.hover",
          alignItems: "center",
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          Move / input
        </Typography>
        {["Startup", "Active", "Recovery", "On block", "Blockstun", "Hitstun", "Pips", "Flow"].map(
          (label) => (
            <Typography key={label} variant="caption" sx={{ fontWeight: 700 }}>
              {label}
            </Typography>
          ),
        )}
      </Box>
      {moves.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 2 }}>
          No moves have been added for this character yet.
        </Typography>
      ) : (
        <List dense disablePadding>
          {orderedMoves.map(({ move, depth }) => {
            const linkedChargeMove = move.chargedMoveId
              ? moves.find((candidate) => candidate.id === move.chargedMoveId)
              : null;
            const linkedBaseMove = move.baseMoveId
              ? moves.find((candidate) => candidate.id === move.baseMoveId)
              : null;
            const inputClass = classifyMoveInput(move.input, {
              allowDirectionless: Boolean(move.dependsOnMoveId),
            });
            return (
              <ListItemButton
                key={move.id}
                component="div"
                selected={selectedMoveId === move.id}
                onClick={() => onEdit(move)}
                aria-label={`Edit ${move.input}`}
                sx={{
                  display: "grid",
                  gridTemplateColumns: moveTableColumns,
                  columnGap: 1,
                  minWidth: 850,
                  px: 2,
                  borderLeft: depth ? 2 : 0,
                  borderColor: "primary.main",
                  pl: depth ? 4 : 2,
                }}
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                      <span>{move.input}</span>
                      {move.isFlowStance ? (
                        <Chip label="Flow stance" size="small" color="primary" />
                      ) : move.isStanceParent ? (
                        <Chip label="Stance" size="small" color="primary" />
                      ) : null}
                      {move.isNonAttack && <Chip label="Non-attack" size="small" />}
                      {move.isCharged && <Chip label="Charged" size="small" color="warning" />}
                      {move.nonstandard && (
                        <Chip label="Nonstandard" size="small" color="default" />
                      )}
                      {inputClass === "normal" && <Chip label="Normal" size="small" />}
                      {inputClass === "command-normal" && (
                        <Chip label="Command normal" size="small" />
                      )}
                      {move.flowCancellable && (
                        <Chip label="Flow-cancellable" size="small" color="success" />
                      )}
                    </Stack>
                  }
                  secondary={
                    [
                      linkedChargeMove ? `Charged: ${linkedChargeMove.input}` : null,
                      linkedBaseMove ? `Standard: ${linkedBaseMove.input}` : null,
                      move.isStanceParent &&
                      !move.isFlowStance &&
                      move.stanceMinimumDuration != null
                        ? `Stance minimum ${move.stanceMinimumDuration}`
                        : null,
                      move.isFlowStance && move.flowStanceMinimumTimeToFlowCancel != null
                        ? `Minimum time to flow cancel ${move.flowStanceMinimumTimeToFlowCancel}`
                        : null,
                      move.isFlowStance && move.flowStanceMinimumTimeToFollowup != null
                        ? `Minimum time to followup ${move.flowStanceMinimumTimeToFollowup}`
                        : null,
                      move.isFlowStance && move.flowStanceMaxDuration != null
                        ? `Max duration ${move.flowStanceMaxDuration}`
                        : null,
                      move.nonstandardNote?.trim()
                        ? `Nonstandard: ${move.nonstandardNote.trim()}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  sx={{ minWidth: 0, pl: depth ? 2 : 0 }}
                />
                <Typography variant="body2">
                  {frameValue(getEffectiveStartup(move, moves))}
                </Typography>
                <Typography variant="body2">{frameValue(move.active)}</Typography>
                <Typography variant="body2">{frameValue(move.recovery)}</Typography>
                <Typography variant="body2">{frameValue(move.onBlock)}</Typography>
                <Typography variant="body2">{frameValue(move.blockstun)}</Typography>
                <Typography variant="body2">{frameValue(move.hitstun)}</Typography>
                <Typography variant="body2">{move.resourceCosts.pips}</Typography>
                <Typography variant="body2">{move.resourceCosts.flow}</Typography>
              </ListItemButton>
            );
          })}
        </List>
      )}
    </Paper>
  );
}

function getComboRouteParts(combo: TechCombo, moves: TechMove[]) {
  const entries = getComboRouteEntries(combo, moves);
  if (!combo.route.trim()) {
    return entries.flatMap(({ token, move }, index) => [
      ...(index > 0 ? [{ text: " \u2192 " }] : []),
      { text: token === "Unknown move" ? "?" : token, invalid: !move },
    ]);
  }

  let entryIndex = 0;
  return getComboRouteText(combo, moves)
    .split(/(\s+|->|>|,|~|\u2192)/g)
    .filter(Boolean)
    .map((part) => {
      if (/^(?:\s+|->|>|,|~|\u2192)$/.test(part)) return { text: part };
      const entry = entries[entryIndex++];
      return { text: part, invalid: !entry?.move };
    });
}

function ComboSelector({
  combos,
  moves,
  recordings,
  publishedCombos,
  inlineFilters,
  selectedId,
  onEdit,
}: {
  combos: TechCombo[];
  moves: TechMove[];
  recordings: RecordedVideo[];
  publishedCombos: PublishedCombo[] | null;
  inlineFilters: ComboInlineFilterState;
  selectedId: string | null;
  onEdit: (combo: TechCombo) => void;
}) {
  const rows = useMemo<ComboTableRow[]>(() => {
    const recordingsById = new Map(recordings.map((recording) => [recording.id, recording]));
    return combos
      .map((combo) => {
        const recording = combo.recordingId ? recordingsById.get(combo.recordingId) : null;
        const hasYouTube = Boolean(recording?.youtubeUrl?.trim());
        const hasMp4 = recording?.mediaKind !== "youtube" && /\.mp4$/i.test(recording?.name ?? "");
        const publishCombo = makePublishComboDraft(combo, recording ?? null, moves).combo;
        const isPublished = publishedCombos?.some(
          (item) =>
            item.id === publishCombo.id &&
            item.characterId === publishCombo.characterId &&
            item.supportId === publishCombo.supportId,
        );
        const starter = getComboStarterLabel(combo, moves);
        return {
          id: combo.id,
          starter: starter === "Unknown move" ? "" : starter,
          position: combo.screenPosition,
          damage: combo.damage,
          pips: combo.resourceCosts.pips,
          flow: combo.resourceCosts.flow,
          requiresCounterhit: combo.requiresCounterhit === true,
          route: getComboRouteText(combo, moves),
          routeParts: getComboRouteParts(combo, moves),
          notes: combo.notes,
          mediaStatus: hasYouTube
            ? publishedCombos && !isPublished
              ? "ready-unpublished"
              : "ready"
            : hasMp4
              ? "local-only"
              : "missing",
          draggableRecordingId: hasMp4 ? recording?.id : undefined,
        } satisfies ComboTableRow;
      })
      .filter((row) => matchesComboInlineFilters(row, inlineFilters));
  }, [combos, inlineFilters, moves, publishedCombos, recordings]);
  const combosById = useMemo(() => new Map(combos.map((combo) => [combo.id, combo])), [combos]);

  return (
    <ComboTable
      rows={rows}
      selectedId={selectedId}
      onSelect={(id) => {
        const combo = combosById.get(id);
        if (combo) onEdit(combo);
      }}
      emptyMessage="No combos have been added for this character and support yet."
    />
  );
}

function ComboRecordingViewer({
  combo,
  recordings,
  onSelectRecording,
}: {
  combo: TechCombo | null;
  recordings: RecordedVideo[];
  onSelectRecording: (recordingId: string) => void;
}) {
  const recording = combo?.recordingId
    ? (recordings.find((item) => item.id === combo.recordingId) ?? null)
    : null;

  return (
    <Stack spacing={1.5} sx={{ minWidth: 0, minHeight: 360 }}>
      {recording ? (
        <>
          <Button
            size="small"
            onClick={() => onSelectRecording(recording.id)}
            sx={{ alignSelf: "flex-start" }}
          >
            Open in recording library
          </Button>
          <Box sx={{ flex: 1, minHeight: 320, minWidth: 0 }}>
            <RecordingViewer active panelOnly selectedRecordingId={recording.id} />
          </Box>
        </>
      ) : (
        <Typography color="text.secondary">
          {combo?.recordingId
            ? "The linked recording is unavailable."
            : "Link a recording to this combo to play it here."}
        </Typography>
      )}
    </Stack>
  );
}

export function TechSection({
  active,
  recordingsRefreshToken,
  combosOnly = false,
}: {
  active: boolean;
  recordingsRefreshToken: number;
  combosOnly?: boolean;
}) {
  const { state: obsState, settings: obsSettings, busy: obsBusy, moveCapture } = useObsRecording();
  const [character, setCharacter] = useState(characters[0].value);
  const [support, setSupport] = useState(supportsByCharacter[characters[0].value][0]);
  const [section, setSection] = useState(() => {
    const savedSection = localStorage.getItem(techEditorSectionStorageKey);
    const savedIndex = techEditorSections.findIndex((value) => value === savedSection);
    return savedIndex >= 0 ? savedIndex : 0;
  });
  const [selectedComboId, setSelectedComboId] = useState<string | null>(null);
  const [comboInlineFilters, setComboInlineFilters] = useState(emptyComboInlineFilters);
  const [catalog, setCatalog] = useState<TechCatalog>(loadTechCatalog);
  const [moveDraft, setMoveDraft] = useState<MoveDraft>(emptyMoveDraft);
  const [editingMoveId, setEditingMoveId] = useState<string | null>(null);
  const [moveInputError, setMoveInputError] = useState<string | null>(null);
  const moveInputRef = useRef<HTMLInputElement>(null);
  const [comboDraft, setComboDraft] = useState<ComboDraft>(emptyComboDraft);
  const comboRouteInputRef = useRef<HTMLTextAreaElement>(null);
  const [routeSelection, setRouteSelection] = useState<ComboNoteRange | null>(null);
  const [editingComboId, setEditingComboId] = useState<string | null>(null);
  const [publishingCombo, setPublishingCombo] = useState(false);
  const [publishStatus, setPublishStatus] = useState<{
    severity: "success" | "error";
    message: string;
  } | null>(null);
  const [recordings, setRecordings] = useState<RecordedVideo[]>([]);
  const [pendingComboRecording, setPendingComboRecording] = useState(readPendingComboRecording);
  const pendingComboRecordingRef = useRef(pendingComboRecording);
  const [comboRecordingBusy, setComboRecordingBusy] = useState(false);
  const [comboRecordingStatus, setComboRecordingStatus] = useState<{
    severity: "success" | "error";
    message: string;
  } | null>(null);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const editingComboIdRef = useRef(editingComboId);
  editingComboIdRef.current = editingComboId;
  const [publishedCombos, setPublishedCombos] = useState<PublishedCombo[] | null>(null);
  const [checkingPublishedCombos, setCheckingPublishedCombos] = useState(false);
  const publishedRequestId = useRef(0);
  const supports = useMemo(() => supportsByCharacter[character] ?? [], [character]);
  const techData = catalog[character] ?? { moves: [], combos: [] };
  const moves = techData.moves;
  const combos = useMemo(
    () => techData.combos.filter((combo) => combo.support === support),
    [support, techData.combos],
  );
  const comboStarterOptions = useMemo(
    () =>
      combos.map((combo) => {
        const starter = getComboStarterLabel(combo, moves);
        return starter === "Unknown move" ? "" : starter;
      }),
    [combos, moves],
  );
  const selectedCombo = combos.find((combo) => combo.id === selectedComboId) ?? null;
  const selectionOverlapsNote = Boolean(
    routeSelection &&
    comboDraft.notes.some(
      (note) =>
        note.range &&
        comboNoteRangeOffsets(comboDraft.route, note.range) &&
        comboNotesOverlap(routeSelection, note.range),
    ),
  );
  const ownComboRecordingActive = Boolean(
    pendingComboRecording &&
    obsState.recording.active &&
    obsState.recording.sessionId === pendingComboRecording.sessionId,
  );
  const selectedRecording =
    recordings.find((item) => item.id === selectedCombo?.recordingId) ?? null;
  const selectedPublishDraft = selectedCombo
    ? makePublishComboDraft(selectedCombo, selectedRecording, moves)
    : null;
  const selectedAlreadyPublished = Boolean(
    selectedPublishDraft &&
    matchesPublishedCombo(
      selectedPublishDraft,
      publishedCombos?.find((item) => item.id === selectedPublishDraft.combo.id),
    ),
  );
  const stanceParentOptions = moves.filter(
    (move) => move.isStanceParent && move.id !== editingMoveId,
  );
  const selectedStanceParent = stanceParentOptions.some(
    (move) => move.id === moveDraft.dependsOnMoveId,
  )
    ? moveDraft.dependsOnMoveId
    : "";

  useEffect(() => {
    localStorage.setItem(techEditorSectionStorageKey, techEditorSections[section]);
  }, [section]);

  useEffect(() => {
    localStorage.setItem(techCatalogStorageKey, JSON.stringify(catalog));
    window.dispatchEvent(new Event(techCatalogUpdatedEvent));
  }, [catalog]);

  useEffect(() => {
    const syncCatalog = () => {
      const stored = localStorage.getItem(techCatalogStorageKey);
      if (stored && stored !== JSON.stringify(catalog)) setCatalog(loadTechCatalog());
    };
    window.addEventListener(techCatalogUpdatedEvent, syncCatalog);
    window.addEventListener("storage", syncCatalog);
    return () => {
      window.removeEventListener(techCatalogUpdatedEvent, syncCatalog);
      window.removeEventListener("storage", syncCatalog);
    };
  }, [catalog]);

  const updatePendingComboRecording = useCallback((next: PendingComboRecording | null) => {
    pendingComboRecordingRef.current = next;
    setPendingComboRecording(next);
    try {
      if (next) localStorage.setItem(pendingComboRecordingStorageKey, JSON.stringify(next));
      else localStorage.removeItem(pendingComboRecordingStorageKey);
    } catch {
      // Keep the association for this session if local storage is unavailable.
    }
  }, []);

  const refreshRecordings = useCallback(
    async (finalized?: FinalizedComboRecording) => {
      const recordingsApi = window.electronAPI?.recordings;
      if (!recordingsApi) return;
      try {
        const result = await recordingsApi.list();
        setRecordings(result.recordings);
        const pending = pendingComboRecordingRef.current;
        if (!pending) return;
        const recording = result.recordings.find(
          (item) =>
            (item.source === "manual" && item.sessionId === pending.sessionId) ||
            (finalized?.sessionId === pending.sessionId && item.id === finalized.recordingId),
        );
        if (!recording) {
          if (finalized?.sessionId === pending.sessionId) {
            setComboRecordingStatus({
              severity: "error",
              message:
                "The finished recording was not found in the recording library. Try finding it again or link it manually.",
            });
          }
          return;
        }
        if (
          !catalogRef.current[pending.character]?.combos.some(
            (combo) => combo.id === pending.comboId,
          )
        ) {
          setComboRecordingStatus({
            severity: "error",
            message:
              "The combo for this recording is no longer in the local catalog. Link the recording manually if needed.",
          });
          updatePendingComboRecording(null);
          return;
        }
        setCatalog((current) => ({
          ...current,
          [pending.character]: {
            ...current[pending.character],
            combos: current[pending.character].combos.map((combo) =>
              combo.id === pending.comboId ? { ...combo, recordingId: recording.id } : combo,
            ),
          },
        }));
        if (editingComboIdRef.current === pending.comboId) {
          setComboDraft((current) => ({ ...current, recordingId: recording.id }));
        }
        updatePendingComboRecording(null);
        setPublishStatus(null);
        setComboRecordingStatus({
          severity: "success",
          message: `Linked ${recording.name} to the combo.`,
        });
      } catch (error) {
        if (pendingComboRecordingRef.current) {
          setComboRecordingStatus({
            severity: "error",
            message: `Could not check the finished recording: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        // Keep the last loaded options available if a refresh fails.
      }
    },
    [updatePendingComboRecording],
  );

  useEffect(() => {
    if (!active) return;
    void refreshRecordings();
  }, [active, recordingsRefreshToken, refreshRecordings]);

  useEffect(() => {
    const recordingsApi = window.electronAPI?.recordings;
    if (!recordingsApi) return;
    return recordingsApi.onFinalized((finalized) => {
      if (pendingComboRecordingRef.current?.sessionId === finalized.sessionId) {
        void refreshRecordings(finalized);
      }
    });
  }, [refreshRecordings]);

  useEffect(() => {
    if (!active) return;
    const requestId = ++publishedRequestId.current;
    setPublishedCombos(null);
    setCheckingPublishedCombos(true);
    void fetchPublishedCombos().then(
      (items) => {
        if (publishedRequestId.current === requestId) {
          setPublishedCombos(items);
          setCheckingPublishedCombos(false);
        }
      },
      () => {
        if (publishedRequestId.current === requestId) {
          setPublishedCombos(null);
          setCheckingPublishedCombos(false);
        }
      },
    );
    return () => {
      publishedRequestId.current += 1;
    };
  }, [active]);

  useEffect(() => {
    const selectCombo = (comboId: string) => {
      for (const [characterValue, data] of Object.entries(catalog)) {
        const combo = data.combos.find((candidate) => candidate.id === comboId);
        if (!combo) continue;
        setCharacter(characterValue);
        setSupport(combo.support);
        setComboInlineFilters(emptyComboInlineFilters());
        setSelectedComboId(combo.id);
        setPublishStatus(null);
        return;
      }
    };
    const handleComboSelection = (event: Event) => {
      const comboId = (event as CustomEvent<string>).detail;
      if (typeof comboId === "string") selectCombo(comboId);
    };
    const pendingComboId = localStorage.getItem(techSelectedComboStorageKey);
    if (pendingComboId) {
      selectCombo(pendingComboId);
      localStorage.removeItem(techSelectedComboStorageKey);
    }
    window.addEventListener(techSelectComboEvent, handleComboSelection);
    return () => window.removeEventListener(techSelectComboEvent, handleComboSelection);
  }, [catalog]);

  const selectLinkedRecording = (recordingId: string) => {
    localStorage.setItem(techSelectedRecordingStorageKey, recordingId);
    window.dispatchEvent(new CustomEvent(techSelectRecordingEvent, { detail: recordingId }));
  };

  const startComboRecording = async () => {
    if (!selectedCombo || !window.electronAPI?.obs || pendingComboRecordingRef.current) return;
    if (
      obsState.status !== "connected" ||
      obsState.recording.active ||
      obsState.automation.enabled ||
      !obsSettings.recordDirectory.trim()
    ) {
      setComboRecordingStatus({
        severity: "error",
        message:
          "Connect OBS, configure its recording folder, and stop any active or automatic recording first.",
      });
      return;
    }
    if (moveCapture.armed) {
      setComboRecordingStatus({
        severity: "error",
        message: "Disarm the move take before recording a combo.",
      });
      return;
    }
    setComboRecordingBusy(true);
    setComboRecordingStatus(null);
    try {
      const started = await window.electronAPI.obs.startManualRecording({
        setup: {
          profileName: obsSettings.profileName,
          recordDirectory: obsSettings.recordDirectory,
        },
        fileNameBase: comboRecordingBaseName(
          selectedCombo,
          catalog[selectedCombo.character]?.moves ?? [],
        ),
      });
      updatePendingComboRecording({
        character: selectedCombo.character,
        comboId: selectedCombo.id,
        sessionId: started.sessionId,
      });
      void refreshRecordings();
    } catch (error) {
      setComboRecordingStatus({
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setComboRecordingBusy(false);
    }
  };

  const stopComboRecording = async () => {
    if (!window.electronAPI?.obs || !ownComboRecordingActive) return;
    setComboRecordingBusy(true);
    setComboRecordingStatus(null);
    try {
      const result = await window.electronAPI.obs.stopRecording();
      if (!result.outputPath) {
        setComboRecordingStatus({
          severity: "error",
          message:
            "OBS stopped without a saved video. You can find a finished recording again or forget this link.",
        });
      }
      await refreshRecordings();
    } catch (error) {
      setComboRecordingStatus({
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setComboRecordingBusy(false);
    }
  };

  const changeCharacter = (nextCharacter: string) => {
    setCharacter(nextCharacter);
    setSupport(supportsByCharacter[nextCharacter]?.[0] ?? "");
    setComboInlineFilters(emptyComboInlineFilters());
    setSelectedComboId(null);
    setMoveDraft(emptyMoveDraft);
    setEditingMoveId(null);
    setMoveInputError(null);
    setComboDraft(emptyComboDraft);
    setRouteSelection(null);
    setEditingComboId(null);
    setPublishStatus(null);
  };

  const editMove = (move: TechMove) => {
    setEditingMoveId(move.id);
    setMoveInputError(null);
    setMoveDraft({
      input:
        normalizeMoveNotation(move.input, { allowDirectionless: Boolean(move.dependsOnMoveId) }) ??
        move.input,
      nonstandard: move.nonstandard === true,
      nonstandardNote: move.nonstandardNote ?? "",
      isStanceParent: move.isStanceParent,
      isNonAttack: move.isNonAttack === true,
      isFlowStance: move.isFlowStance === true,
      flowStanceOverride:
        typeof move.flowStanceOverride === "boolean"
          ? move.flowStanceOverride
          : move.isFlowStance && !isNonMotionFMove(move.input)
            ? true
            : move.isStanceParent && !move.isFlowStance && isNonMotionFMove(move.input)
              ? false
              : null,
      notApplicable: move.notApplicable ?? {},
      flowCancellable: move.flowCancellable,
      hasChargedVersion: Boolean(move.chargedMoveId),
      dependsOnMoveId: move.dependsOnMoveId ?? "",
      stanceMinimumDuration: String(move.stanceMinimumDuration ?? ""),
      flowStanceMinimumTimeToFlowCancel: String(move.flowStanceMinimumTimeToFlowCancel ?? ""),
      flowStanceMinimumTimeToFollowup: String(move.flowStanceMinimumTimeToFollowup ?? ""),
      flowStanceMaxDuration: String(move.flowStanceMaxDuration ?? ""),
      startup: String(move.startup ?? ""),
      active: String(move.active ?? ""),
      recovery: String(move.recovery ?? ""),
      onBlock: String(move.onBlock ?? ""),
      blockstun: String(move.blockstun ?? ""),
      hitstun: String(move.hitstun ?? ""),
      pips: String(move.resourceCosts.pips ?? 0),
      flow: String(move.resourceCosts.flow ?? 0),
    });
  };

  const addFollowup = () => {
    const stance = moves.find((move) => move.id === editingMoveId && move.isStanceParent);
    if (!stance) return;
    setMoveInputError(null);
    setMoveDraft({ ...emptyMoveDraft, dependsOnMoveId: stance.id });
    setEditingMoveId(null);
    window.requestAnimationFrame(() => moveInputRef.current?.focus());
  };

  const saveMove = () => {
    const stanceParentId = stanceParentOptions.some((move) => move.id === moveDraft.dependsOnMoveId)
      ? moveDraft.dependsOnMoveId
      : null;
    const parsedInput = parseMoveNotation(moveDraft.input, {
      allowDirectionless: Boolean(stanceParentId),
    });
    if (!parsedInput.ok) {
      setMoveInputError(parsedInput.error);
      return;
    }
    if (parsedInput.isDirectionless && parsedInput.button !== "TH" && !stanceParentId) {
      setMoveInputError("A bare button must depend on a stance move.");
      return;
    }
    const editingMove = moves.find((move) => move.id === editingMoveId);
    if (parsedInput.isCharged && !editingMove?.baseMoveId) {
      setMoveInputError("Create a charged version from its standard move instead.");
      return;
    }
    if (moveDraft.hasChargedVersion && !chargedInputFor(parsedInput.notation)) {
      setMoveInputError("This move cannot have a charged version.");
      return;
    }
    const input = parsedInput.notation;
    setMoveInputError(null);
    const moveValues = {
      character,
      input,
      nonstandard: moveDraft.nonstandard,
      nonstandardNote: moveDraft.nonstandardNote.trim(),
      isStanceParent: moveDraft.isStanceParent,
      isNonAttack: moveDraft.isNonAttack,
      isFlowStance: moveDraft.isFlowStance,
      flowStanceOverride: moveDraft.flowStanceOverride,
      flowStanceMinimumTimeToFlowCancel: moveDraft.isFlowStance
        ? parseMoveNumber(moveDraft.flowStanceMinimumTimeToFlowCancel)
        : null,
      flowStanceMinimumTimeToFollowup: moveDraft.isFlowStance
        ? parseMoveNumber(moveDraft.flowStanceMinimumTimeToFollowup)
        : null,
      flowStanceMaxDuration: moveDraft.isFlowStance
        ? parseMoveNumber(moveDraft.flowStanceMaxDuration)
        : null,
      notApplicable: Object.fromEntries(
        Object.entries(moveDraft.notApplicable)
          .map(([slot, reason]) => [slot, reason?.trim() ?? ""])
          .filter(([, reason]) => Boolean(reason)),
      ),
      flowCancellable:
        moveDraft.flowCancellable ??
        isFlowCancellableByDefault(input, { allowDirectionless: Boolean(stanceParentId) }),
      isCharged: Boolean(editingMove?.baseMoveId),
      chargedMoveId: editingMove?.chargedMoveId ?? null,
      baseMoveId: editingMove?.baseMoveId ?? null,
      stanceFollowupPattern: null,
      dependsOnMoveId: stanceParentId,
      stanceMinimumDuration:
        moveDraft.isStanceParent && !moveDraft.isFlowStance
          ? parseMoveNumber(moveDraft.stanceMinimumDuration)
          : null,
      startup: parseMoveNumber(moveDraft.startup),
      active: parseMoveNumber(moveDraft.active),
      recovery: parseMoveNumber(moveDraft.recovery),
      onBlock: parseMoveNumber(moveDraft.onBlock),
      blockstun: parseMoveNumber(moveDraft.blockstun),
      hitstun: parseMoveNumber(moveDraft.hitstun),
      resourceCosts: {
        pips: parseMoveNumber(moveDraft.pips) ?? 0,
        flow: parseMoveNumber(moveDraft.flow) ?? 0,
      },
    };
    if (editingMove?.chargedMoveId && !moveDraft.hasChargedVersion) {
      if (
        !window.confirm(
          `Remove the charged version of ${editingMove.input}? Its saved data will be lost.`,
        )
      )
        return;
    }
    setCatalog((current) => {
      const currentMoves = current[character]?.moves ?? [];
      const id = editingMoveId ?? moveIdFor(character, input, currentMoves);
      const updatedMoves = editingMoveId
        ? currentMoves.map((move) => {
            if (move.id === editingMoveId) {
              const evidence = { ...move.evidence };
              for (const field of [
                "startup",
                "active",
                "recovery",
                "onBlock",
                "blockstun",
              ] as const) {
                if (evidence[field] && evidence[field].value !== moveValues[field])
                  delete evidence[field];
              }
              return { ...move, ...moveValues, evidence };
            }
            if (!moveValues.isStanceParent && move.dependsOnMoveId === editingMoveId) {
              return { ...move, dependsOnMoveId: null };
            }
            return move;
          })
        : [...currentMoves, { id, ...moveValues }];
      return {
        ...current,
        [character]: {
          ...(current[character] ?? { combos: [] }),
          moves: withChargedVariant(updatedMoves, id, moveDraft.hasChargedVersion),
        },
      };
    });
    setMoveDraft(emptyMoveDraft);
    setEditingMoveId(null);
    window.requestAnimationFrame(() => moveInputRef.current?.focus());
  };

  const delete2AA = () => {
    const selected = moves.find((move) => move.id === editingMoveId);
    if (!selected || selected.input.toUpperCase() !== "2AA") return;
    if (
      !window.confirm(
        `Delete 2AA for ${character}? Its saved move and support data will be removed. Recordings will be kept.`,
      )
    )
      return;
    setCatalog((current) => {
      const data = current[character];
      if (!data) return current;
      const removedIds = new Set([
        selected.id,
        ...data.moves.filter((move) => move.baseMoveId === selected.id).map((move) => move.id),
      ]);
      return {
        ...current,
        [character]: {
          ...data,
          moves: data.moves
            .filter((move) => !removedIds.has(move.id))
            .map((move) => ({
              ...move,
              dependsOnMoveId: removedIds.has(move.dependsOnMoveId ?? "")
                ? null
                : move.dependsOnMoveId,
              chargedMoveId: removedIds.has(move.chargedMoveId ?? "") ? null : move.chargedMoveId,
            })),
          supportMoves: data.supportMoves?.filter((move) => !removedIds.has(move.baseMoveId)),
          combos: data.combos.map((combo) => ({
            ...combo,
            moveIds: combo.moveIds.map((id) => (id && removedIds.has(id) ? null : id)),
          })),
        },
      };
    });
    setMoveDraft(emptyMoveDraft);
    setEditingMoveId(null);
    setMoveInputError(null);
  };

  const editCombo = (combo: TechCombo) => {
    setPublishStatus(null);
    setSelectedComboId(combo.id);
    setEditingComboId(combo.id);
    setComboDraft({
      route: combo.route,
      routingMode: combo.routingMode === "unique" ? "unique" : "autopilot",
      screenPosition: comboScreenPositionOrEmpty(combo.screenPosition),
      damage: combo.damage,
      notes: [...(combo.notes ?? [])],
      requiresCounterhit: combo.requiresCounterhit === true,
      initialConversionHitconfirmable: combo.initialConversionHitconfirmable === true,
      initialConversionSafeOnBlock: combo.initialConversionSafeOnBlock === true,
      pips: String(combo.resourceCosts.pips ?? 0),
      flow: String(combo.resourceCosts.flow ?? 0),
      recordingId: combo.recordingId,
    });
    setRouteSelection(null);
  };

  const saveCombo = () => {
    if (!comboDraft.route.trim() || !isComboScreenPosition(comboDraft.screenPosition)) return;
    const comboValues = {
      character,
      support,
      moveIds: resolveComboRoute(comboDraft.route, moves),
      route: comboDraft.route.trim(),
      routingMode: comboDraft.routingMode,
      screenPosition: comboDraft.screenPosition.trim(),
      damage: comboDraft.damage.trim(),
      notes: comboDraft.notes
        .map((note) => ({ ...note, text: note.text.trim() }))
        .filter((note) => note.text),
      requiresCounterhit: comboDraft.requiresCounterhit,
      initialConversionHitconfirmable: comboDraft.initialConversionHitconfirmable,
      initialConversionSafeOnBlock: comboDraft.initialConversionSafeOnBlock,
      resourceCosts: {
        pips: parseMoveNumber(comboDraft.pips) ?? 0,
        flow: parseMoveNumber(comboDraft.flow) ?? 0,
      },
      recordingId: comboDraft.recordingId,
    };
    const comboId = editingComboId ?? `${character}-${support}-${Date.now()}`;
    setCatalog((current) => ({
      ...current,
      [character]: {
        ...(current[character] ?? { moves: [] }),
        combos: editingComboId
          ? (current[character]?.combos ?? []).map((combo) =>
              combo.id === editingComboId ? { ...combo, ...comboValues } : combo,
            )
          : [...(current[character]?.combos ?? []), { id: comboId, ...comboValues }],
      },
    }));
    setSelectedComboId(comboId);
    setComboDraft(emptyComboDraft);
    setRouteSelection(null);
    setEditingComboId(null);
  };

  const publishSelectedCombo = async () => {
    if (!selectedCombo) return;
    if (
      selectedCombo.notes?.some(
        (note) => note.range && !comboNoteRangeOffsets(selectedCombo.route, note.range),
      )
    ) {
      setPublishStatus({
        severity: "error",
        message:
          "Review segment notes whose move ranges no longer match the route before publishing.",
      });
      return;
    }
    if (catalogApiUrl !== "https://labatar-catalog.landenhanni.workers.dev") {
      setPublishStatus({
        severity: "error",
        message: "Direct publishing is available only for the hosted catalog.",
      });
      return;
    }
    const latestRecordings =
      (await window.electronAPI?.recordings.list().then(
        (result) => result.recordings,
        () => recordings,
      )) ?? recordings;
    setRecordings(latestRecordings);
    const recording =
      latestRecordings.find((item) => item.id === selectedCombo.recordingId) ?? null;
    const draft = makePublishComboDraft(selectedCombo, recording, moves);
    if (!draft.combo.youtubeUrl.trim()) {
      setPublishStatus({ severity: "error", message: "Link a YouTube video before publishing." });
      return;
    }
    const publisher = window.electronAPI?.catalogPublisher;
    if (!publisher) {
      setPublishStatus({ severity: "error", message: "Publishing requires the desktop app." });
      return;
    }
    setPublishingCombo(true);
    setPublishStatus(null);
    try {
      ++publishedRequestId.current;
      setCheckingPublishedCombos(false);
      try {
        const latestPublished = await fetchPublishedCombos();
        setPublishedCombos(latestPublished);
        if (
          matchesPublishedCombo(
            draft,
            latestPublished.find((item) => item.id === draft.combo.id),
          )
        ) {
          setPublishStatus({
            severity: "success",
            message: "This combo already matches the published version.",
          });
          return;
        }
      } catch {
        // Publishing still uses the editor's current revision when the public read is unavailable.
      }
      const result = await publisher.publishCombo(draft);
      if (!result.cancelled) {
        const published = publishedComboFromDraft(draft);
        if (published) {
          setPublishedCombos((current) => [
            ...(current ?? []).filter((item) => item.id !== published.id),
            published,
          ]);
        }
        setPublishStatus({
          severity: "success",
          message: `Published revision ${result.revision}. The public catalog may take up to 60 seconds to refresh.`,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
          : "Could not publish the combo.";
      setPublishStatus({
        severity: "error",
        message,
      });
    } finally {
      setPublishingCombo(false);
    }
  };

  return (
    <Stack spacing={2} sx={{ textAlign: "left" }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        {!combosOnly && (
          <>
            <Typography variant="h6">Tech editor</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Explore character and support-specific moves, pressure, and other notes.
            </Typography>
          </>
        )}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center" }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="tech-character-label">Character</InputLabel>
            <Select
              labelId="tech-character-label"
              value={character}
              label="Character"
              onChange={(event) => changeCharacter(event.target.value)}
            >
              {characters.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 220 }} disabled={supports.length === 0}>
            <InputLabel id="tech-support-label">Support</InputLabel>
            <Select
              labelId="tech-support-label"
              value={support}
              label="Support"
              onChange={(event) => {
                setSupport(event.target.value);
                setSelectedComboId(null);
                setComboInlineFilters(emptyComboInlineFilters());
              }}
            >
              {supports.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {combosOnly && (
            <ComboInlineFilters
              starters={comboStarterOptions}
              filters={comboInlineFilters}
              onChange={setComboInlineFilters}
            />
          )}
        </Box>
      </Paper>

      <Paper variant="outlined">
        {!combosOnly && (
          <Tabs value={section} onChange={(_, nextSection: number) => setSection(nextSection)}>
            <Tab label="Moves" />
            <Tab label="Pressure" />
            <Tab label="Neutral" />
            <Tab label="Misc" />
          </Tabs>
        )}
        <Box sx={{ p: 2 }}>
          {!combosOnly && section === 0 && (
            <Stack spacing={2}>
              <Typography variant="subtitle1">
                Moves for {characters.find((option) => option.value === character)?.label}
              </Typography>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "minmax(0, 1fr)",
                    lg: "minmax(0, 3fr) minmax(360px, 2fr)",
                  },
                  gap: 2,
                  alignItems: "start",
                }}
              >
                <Stack spacing={2} sx={{ minWidth: 0 }}>
                  <MoveList moves={moves} selectedMoveId={editingMoveId} onEdit={editMove} />
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="subtitle2">Accepted data with {support}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Values inherit the character baseline unless this support has a separate saved
                      move version. Select a value to open its source video.
                    </Typography>
                    {moves
                      .filter((move) =>
                        measuredFields.some(({ key }) =>
                          effectiveMeasurement(catalog, character, support, move.id, key),
                        ),
                      )
                      .map((move) => {
                        const supportMove = techData.supportMoves?.find(
                          (entry) => entry.baseMoveId === move.id && entry.support === support,
                        );
                        return (
                          <Stack key={move.id} spacing={0.5} sx={{ mt: 1 }}>
                            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                              <Typography variant="body2">{move.input}</Typography>
                              {supportMove &&
                                Object.keys(supportMove.measurements ?? {}).length > 0 && (
                                  <Chip size="small" label={`${support} version`} />
                                )}
                            </Stack>
                            <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap" }}>
                              {measuredFields.map(({ key, label }) => {
                                const value = effectiveMeasurement(
                                  catalog,
                                  character,
                                  support,
                                  move.id,
                                  key,
                                );
                                if (!value) return null;
                                return (
                                  <Button
                                    key={key}
                                    size="small"
                                    variant={
                                      supportMove?.measurements[key] ? "contained" : "outlined"
                                    }
                                    onClick={() => selectLinkedRecording(value.recordingId)}
                                    title={`Source: ${value.recordingId}, frames ${value.startFrame}–${value.endFrame} at ${value.frameRate} fps`}
                                  >
                                    {label} {value.value}
                                  </Button>
                                );
                              })}
                            </Stack>
                          </Stack>
                        );
                      })}
                    {!moves.some((move) =>
                      measuredFields.some(({ key }) =>
                        effectiveMeasurement(catalog, character, support, move.id, key),
                      ),
                    ) && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        No accepted measurements yet.
                      </Typography>
                    )}
                  </Paper>
                </Stack>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    minWidth: 0,
                    position: { xs: "static", lg: "sticky" },
                    top: 16,
                    maxHeight: { xs: "none", lg: "calc(100vh - 32px)" },
                    overflowY: { xs: "visible", lg: "auto" },
                  }}
                >
                  <Stack
                    component="form"
                    spacing={1.5}
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveMove();
                    }}
                  >
                    <Typography variant="subtitle2">
                      {editingMoveId ? "Edit move" : "Add move"}
                    </Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                      <TextField
                        label="Input"
                        placeholder={moveDraft.dependsOnMoveId ? "A or 2B" : "2B or 214C"}
                        size="small"
                        value={moveDraft.input}
                        inputRef={moveInputRef}
                        disabled={Boolean(
                          editingMoveId &&
                          moves.find((move) => move.id === editingMoveId)?.baseMoveId,
                        )}
                        onChange={(event) => {
                          setMoveInputError(null);
                          setMoveDraft((current) => {
                            const isFlowStance = isNonMotionFMove(event.target.value);
                            return {
                              ...current,
                              input: event.target.value,
                              ...(current.flowStanceOverride === null
                                ? {
                                    isFlowStance,
                                    isStanceParent:
                                      isFlowStance ||
                                      (current.isStanceParent && !current.isFlowStance),
                                  }
                                : {}),
                            };
                          });
                        }}
                        error={Boolean(moveInputError)}
                        helperText={
                          moveInputError ??
                          (moveDraft.dependsOnMoveId
                            ? "Followups can use a bare button or full move notation, such as 1-9X."
                            : "Example: TH, j.TH, 2B, 2AA, j.2C, 236F, 22EX, 5X, or 1-9X (any numbered direction with A/B/C).")
                        }
                        required
                        sx={{ flex: 1 }}
                      />
                    </Stack>
                    <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap" }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={
                              moveDraft.flowCancellable ??
                              isFlowCancellableByDefault(moveDraft.input, {
                                allowDirectionless: Boolean(moveDraft.dependsOnMoveId),
                              })
                            }
                            onChange={(event) =>
                              setMoveDraft((current) => ({
                                ...current,
                                flowCancellable: event.target.checked,
                              }))
                            }
                          />
                        }
                        label="Flow-cancellable"
                      />
                      <FormControl size="small" sx={{ minWidth: 170 }}>
                        <InputLabel id="tech-move-type-label">Move type</InputLabel>
                        <Select
                          labelId="tech-move-type-label"
                          label="Move type"
                          value={
                            moveDraft.isFlowStance
                              ? "flow-stance"
                              : moveDraft.isStanceParent
                                ? "stance"
                                : "standard"
                          }
                          onChange={(event) =>
                            setMoveDraft((current) => ({
                              ...current,
                              isStanceParent: event.target.value !== "standard",
                              isFlowStance: event.target.value === "flow-stance",
                              flowStanceOverride: event.target.value === "flow-stance",
                            }))
                          }
                        >
                          <MenuItem value="standard">Standard</MenuItem>
                          <MenuItem value="stance">Stance</MenuItem>
                          <MenuItem value="flow-stance">Flow stance</MenuItem>
                        </Select>
                      </FormControl>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={moveDraft.isNonAttack}
                            onChange={(event) =>
                              setMoveDraft((current) => ({
                                ...current,
                                isNonAttack: event.target.checked,
                              }))
                            }
                          />
                        }
                        label="Non-attack"
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={moveDraft.hasChargedVersion}
                            disabled={Boolean(
                              editingMoveId &&
                              moves.find((move) => move.id === editingMoveId)?.baseMoveId,
                            )}
                            onChange={(event) =>
                              setMoveDraft((current) => ({
                                ...current,
                                hasChargedVersion: event.target.checked,
                              }))
                            }
                          />
                        }
                        label="Has charged version"
                      />
                      {moveDraft.isStanceParent && !moveDraft.isFlowStance && (
                        <TextField
                          label="Minimum duration"
                          type="number"
                          size="small"
                          value={moveDraft.stanceMinimumDuration}
                          onChange={(event) =>
                            setMoveDraft((current) => ({
                              ...current,
                              stanceMinimumDuration: event.target.value,
                            }))
                          }
                          sx={{ width: 150 }}
                        />
                      )}
                      {moveDraft.isFlowStance && (
                        <>
                          <TextField
                            label="Minimum time to flow cancel"
                            type="number"
                            size="small"
                            value={moveDraft.flowStanceMinimumTimeToFlowCancel}
                            onChange={(event) =>
                              setMoveDraft((current) => ({
                                ...current,
                                flowStanceMinimumTimeToFlowCancel: event.target.value,
                              }))
                            }
                            slotProps={{ htmlInput: { min: 0, step: 1 } }}
                            sx={{ width: 210 }}
                          />
                          <TextField
                            label="Minimum time to followup"
                            type="number"
                            size="small"
                            value={moveDraft.flowStanceMinimumTimeToFollowup}
                            onChange={(event) =>
                              setMoveDraft((current) => ({
                                ...current,
                                flowStanceMinimumTimeToFollowup: event.target.value,
                              }))
                            }
                            slotProps={{ htmlInput: { min: 0, step: 1 } }}
                            sx={{ width: 210 }}
                          />
                          <TextField
                            label="Max duration"
                            type="number"
                            size="small"
                            value={moveDraft.flowStanceMaxDuration}
                            onChange={(event) =>
                              setMoveDraft((current) => ({
                                ...current,
                                flowStanceMaxDuration: event.target.value,
                              }))
                            }
                            slotProps={{ htmlInput: { min: 0, step: 1 } }}
                            sx={{ width: 150 }}
                          />
                        </>
                      )}
                      <FormControl
                        size="small"
                        sx={{ minWidth: 240 }}
                        disabled={stanceParentOptions.length === 0}
                      >
                        <InputLabel id="tech-stance-parent-label">Depends on stance</InputLabel>
                        <Select
                          labelId="tech-stance-parent-label"
                          value={selectedStanceParent}
                          label="Depends on stance"
                          onChange={(event) =>
                            setMoveDraft((current) => ({
                              ...current,
                              dependsOnMoveId: event.target.value,
                            }))
                          }
                        >
                          <MenuItem value="">None</MenuItem>
                          {stanceParentOptions.map((move) => (
                            <MenuItem key={move.id} value={move.id}>
                              {move.input}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      If a capture situation cannot occur for this move, enter a reason. That
                      situation will be skipped in gather mode.
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={moveDraft.nonstandard}
                            onChange={(event) =>
                              setMoveDraft((current) => ({
                                ...current,
                                nonstandard: event.target.checked,
                              }))
                            }
                          />
                        }
                        label="Nonstandard (manual capture only)"
                      />
                      <TextField
                        label="Nonstandard note"
                        size="small"
                        value={moveDraft.nonstandardNote}
                        onChange={(event) =>
                          setMoveDraft((current) => ({
                            ...current,
                            nonstandardNote: event.target.value,
                          }))
                        }
                        sx={{ minWidth: 240 }}
                      />
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                      {moveTakeOutcomes.map((slot) => (
                        <TextField
                          key={slot}
                          size="small"
                          label={`${slot} not applicable reason`}
                          value={moveDraft.notApplicable[slot] ?? ""}
                          onChange={(event) =>
                            setMoveDraft((current) => ({
                              ...current,
                              notApplicable: {
                                ...current.notApplicable,
                                [slot]: event.target.value,
                              },
                            }))
                          }
                          sx={{ minWidth: 205 }}
                        />
                      ))}
                    </Stack>
                    <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1.5 }}>
                      {(
                        [
                          ["startup", "Startup"],
                          ["active", "Active"],
                          ["recovery", "Recovery"],
                          ["onBlock", "On block"],
                          ["blockstun", "Blockstun"],
                          ["hitstun", "Hitstun"],
                          ["pips", "Pips"],
                          ["flow", "Flow"],
                        ] as const
                      ).map(([key, label]) => (
                        <TextField
                          key={key}
                          label={label}
                          type="number"
                          size="small"
                          value={moveDraft[key]}
                          onChange={(event) =>
                            setMoveDraft((current) => ({ ...current, [key]: event.target.value }))
                          }
                          sx={{ width: 110 }}
                        />
                      ))}
                    </Stack>
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={!moveDraft.input.trim()}
                      sx={{ alignSelf: "flex-start" }}
                    >
                      {editingMoveId ? "Save changes" : "Add move"}
                    </Button>
                    {editingMoveId &&
                      moves.find((move) => move.id === editingMoveId)?.isStanceParent && (
                        <Button
                          type="button"
                          variant="outlined"
                          onClick={addFollowup}
                          sx={{ alignSelf: "flex-start" }}
                        >
                          Add followup
                        </Button>
                      )}
                    {editingMoveId && (
                      <Button
                        type="button"
                        variant="text"
                        onClick={() => {
                          setMoveDraft(emptyMoveDraft);
                          setEditingMoveId(null);
                          setMoveInputError(null);
                        }}
                        sx={{ alignSelf: "flex-start" }}
                      >
                        Cancel
                      </Button>
                    )}
                    {editingMoveId &&
                      moves.find((move) => move.id === editingMoveId)?.input.toUpperCase() ===
                        "2AA" && (
                        <Button
                          type="button"
                          color="error"
                          onClick={delete2AA}
                          sx={{ alignSelf: "flex-start" }}
                        >
                          Delete 2AA
                        </Button>
                      )}
                  </Stack>
                </Paper>
              </Box>
            </Stack>
          )}
          {combosOnly && (
            <Stack spacing={2}>
              <ComboWorkspace>
                <Stack spacing={2} sx={{ minWidth: 0 }}>
                  <ComboSelector
                    combos={combos}
                    moves={moves}
                    recordings={recordings}
                    publishedCombos={publishedCombos}
                    inlineFilters={comboInlineFilters}
                    selectedId={selectedComboId}
                    onEdit={editCombo}
                  />
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Stack spacing={1.5}>
                      <Typography variant="subtitle2">
                        {editingComboId ? "Edit combo" : "Add combo"}
                      </Typography>
                      <TextField
                        label="Move string"
                        placeholder="2B > 5C > 236F~1-9X"
                        helperText="Select moves in this field, then choose Note for selection. Use ~ before a stance followup and ! after a move to mark a crit."
                        multiline
                        minRows={2}
                        size="small"
                        inputRef={comboRouteInputRef}
                        value={comboDraft.route}
                        onChange={(event) => {
                          setComboDraft((current) => ({ ...current, route: event.target.value }));
                          setRouteSelection(null);
                        }}
                        onSelect={(event) => {
                          const input =
                            event.target instanceof HTMLTextAreaElement
                              ? event.target
                              : comboRouteInputRef.current;
                          if (input) {
                            setRouteSelection(
                              comboNoteRangeFromSelection(
                                comboDraft.route,
                                input.selectionStart,
                                input.selectionEnd,
                              ),
                            );
                          }
                        }}
                        required
                      />
                      <Stack
                        direction="row"
                        spacing={1.5}
                        sx={{ alignItems: "center", flexWrap: "wrap" }}
                      >
                        <Typography variant="body2">Routing</Typography>
                        <ToggleButtonGroup
                          size="small"
                          exclusive
                          aria-label="Routing mode"
                          value={comboDraft.routingMode}
                          onChange={(_, value: "autopilot" | "unique" | null) => {
                            if (value)
                              setComboDraft((current) => ({ ...current, routingMode: value }));
                          }}
                        >
                          <ToggleButton value="autopilot">Autopilot</ToggleButton>
                          <ToggleButton value="unique">Unique routing</ToggleButton>
                        </ToggleButtonGroup>
                      </Stack>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                        <FormControl size="small" sx={{ flex: 1 }}>
                          <InputLabel id="tech-combo-position-label">Screen position</InputLabel>
                          <Select
                            labelId="tech-combo-position-label"
                            value={comboDraft.screenPosition}
                            label="Screen position"
                            onChange={(event) =>
                              setComboDraft((current) => ({
                                ...current,
                                screenPosition: event.target.value,
                              }))
                            }
                          >
                            <MenuItem value="" disabled>
                              Choose a position
                            </MenuItem>
                            {comboScreenPositions.map((position) => (
                              <MenuItem key={position} value={position}>
                                {position}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <TextField
                          label="Damage"
                          size="small"
                          value={comboDraft.damage}
                          onChange={(event) =>
                            setComboDraft((current) => ({ ...current, damage: event.target.value }))
                          }
                          sx={{ flex: 1 }}
                        />
                        <TextField
                          label="Pips"
                          type="number"
                          size="small"
                          value={comboDraft.pips}
                          onChange={(event) =>
                            setComboDraft((current) => ({ ...current, pips: event.target.value }))
                          }
                          sx={{ width: 100 }}
                        />
                        <TextField
                          label="Flow"
                          type="number"
                          size="small"
                          value={comboDraft.flow}
                          onChange={(event) =>
                            setComboDraft((current) => ({ ...current, flow: event.target.value }))
                          }
                          sx={{ width: 100 }}
                        />
                      </Stack>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={comboDraft.requiresCounterhit}
                            onChange={(event) =>
                              setComboDraft((current) => ({
                                ...current,
                                requiresCounterhit: event.target.checked,
                              }))
                            }
                          />
                        }
                        label="Requires counterhit"
                      />
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={comboDraft.initialConversionHitconfirmable}
                            onChange={(event) =>
                              setComboDraft((current) => ({
                                ...current,
                                initialConversionHitconfirmable: event.target.checked,
                              }))
                            }
                          />
                        }
                        label="Initial conversion hitconfirmable"
                      />
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={comboDraft.initialConversionSafeOnBlock}
                            onChange={(event) =>
                              setComboDraft((current) => ({
                                ...current,
                                initialConversionSafeOnBlock: event.target.checked,
                              }))
                            }
                          />
                        }
                        label="Initial conversion safe on block"
                      />
                      <Box>
                        <Stack
                          direction="row"
                          sx={{
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 1,
                            mb: 1,
                          }}
                        >
                          <Typography variant="subtitle2">Notes</Typography>
                          <Stack direction="row" spacing={1}>
                            <Button
                              size="small"
                              disabled={
                                !routeSelection ||
                                selectionOverlapsNote ||
                                comboDraft.notes.length >= 20
                              }
                              onClick={() => {
                                if (!routeSelection) return;
                                setComboDraft((current) => ({
                                  ...current,
                                  notes: [
                                    ...current.notes,
                                    {
                                      id: newComboNoteId(),
                                      text: "",
                                      category: "execution",
                                      range: routeSelection,
                                    },
                                  ],
                                }));
                                setRouteSelection(null);
                              }}
                            >
                              + Note for selection
                            </Button>
                            <Button
                              size="small"
                              onClick={() =>
                                setComboDraft((current) => ({
                                  ...current,
                                  notes: [
                                    ...current.notes,
                                    { id: newComboNoteId(), text: "", category: "general" },
                                  ],
                                }))
                              }
                              disabled={comboDraft.notes.length >= 20}
                            >
                              + General note
                            </Button>
                          </Stack>
                        </Stack>
                        {routeSelection && (
                          <Typography
                            variant="caption"
                            color={selectionOverlapsNote ? "error" : "text.secondary"}
                            sx={{ display: "block", mb: 1 }}
                          >
                            {selectionOverlapsNote
                              ? "This selection overlaps another segment note."
                              : `Selected: ${routeSelection.excerpt}`}
                          </Typography>
                        )}
                        <Stack spacing={1}>
                          {comboDraft.notes.map((note, index) => (
                            <Box
                              key={note.id}
                              sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}
                            >
                              <Stack
                                direction="row"
                                sx={{
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 1,
                                  mb: 1,
                                }}
                              >
                                <Typography
                                  variant="caption"
                                  color={
                                    note.range &&
                                    !comboNoteRangeOffsets(comboDraft.route, note.range)
                                      ? "error"
                                      : "text.secondary"
                                  }
                                  sx={{ overflowWrap: "anywhere" }}
                                >
                                  {note.range
                                    ? `${note.range.excerpt}${comboNoteRangeOffsets(comboDraft.route, note.range) ? "" : " · Range needs review"}`
                                    : `General note ${index + 1}`}
                                </Typography>
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() =>
                                    setComboDraft((current) => ({
                                      ...current,
                                      notes: current.notes.filter((item) => item.id !== note.id),
                                    }))
                                  }
                                >
                                  Remove
                                </Button>
                              </Stack>
                              <Stack
                                direction={{ xs: "column", sm: "row" }}
                                spacing={1}
                                sx={{ alignItems: "flex-start" }}
                              >
                                <TextField
                                  select
                                  size="small"
                                  label="Type"
                                  value={note.category}
                                  sx={{ minWidth: 145 }}
                                  onChange={(event) =>
                                    setComboDraft((current) => ({
                                      ...current,
                                      notes: current.notes.map((item) =>
                                        item.id === note.id
                                          ? {
                                              ...item,
                                              category: event.target.value as ComboNote["category"],
                                            }
                                          : item,
                                      ),
                                    }))
                                  }
                                >
                                  {(["general", "execution", "situational"] as const).map(
                                    (category) => (
                                      <MenuItem key={category} value={category}>
                                        {comboNoteCategoryLabel(category)}
                                      </MenuItem>
                                    ),
                                  )}
                                </TextField>
                                <TextField
                                  label={`Note ${index + 1}`}
                                  multiline
                                  minRows={2}
                                  size="small"
                                  fullWidth
                                  value={note.text}
                                  slotProps={{ htmlInput: { maxLength: 1000 } }}
                                  onChange={(event) =>
                                    setComboDraft((current) => ({
                                      ...current,
                                      notes: current.notes.map((item) =>
                                        item.id === note.id
                                          ? { ...item, text: event.target.value }
                                          : item,
                                      ),
                                    }))
                                  }
                                />
                              </Stack>
                              {note.range && routeSelection && (
                                <Button
                                  size="small"
                                  disabled={comboDraft.notes.some(
                                    (item) =>
                                      item.id !== note.id &&
                                      item.range &&
                                      comboNoteRangeOffsets(comboDraft.route, item.range) &&
                                      comboNotesOverlap(routeSelection, item.range),
                                  )}
                                  onClick={() => {
                                    setComboDraft((current) => ({
                                      ...current,
                                      notes: current.notes.map((item) =>
                                        item.id === note.id
                                          ? { ...item, range: routeSelection }
                                          : item,
                                      ),
                                    }));
                                    setRouteSelection(null);
                                  }}
                                >
                                  Use current selection
                                </Button>
                              )}
                            </Box>
                          ))}
                        </Stack>
                      </Box>
                      <Autocomplete
                        options={recordings}
                        onOpen={() => void refreshRecordings()}
                        value={
                          recordings.find((recording) => recording.id === comboDraft.recordingId) ??
                          null
                        }
                        onChange={(_, recording) =>
                          setComboDraft((current) => ({
                            ...current,
                            recordingId: recording?.id ?? null,
                          }))
                        }
                        getOptionLabel={(recording) => recording.name}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        renderInput={(params) => (
                          <TextField {...params} label="Linked recording" size="small" />
                        )}
                        clearOnEscape
                      />
                      <Stack direction="row" spacing={1}>
                        <Button
                          variant="contained"
                          onClick={saveCombo}
                          disabled={
                            !comboDraft.route.trim() ||
                            !isComboScreenPosition(comboDraft.screenPosition)
                          }
                        >
                          {editingComboId ? "Save changes" : "Add combo"}
                        </Button>
                        {editingComboId && (
                          <Button
                            onClick={() => {
                              setComboDraft(emptyComboDraft);
                              setRouteSelection(null);
                              setEditingComboId(null);
                            }}
                          >
                            Cancel
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                  </Paper>
                </Stack>
                <ComboRecordingViewer
                  combo={selectedCombo}
                  recordings={recordings}
                  onSelectRecording={selectLinkedRecording}
                />
              </ComboWorkspace>
              {(selectedCombo || pendingComboRecording || comboRecordingStatus) && (
                <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
                  {pendingComboRecording ? (
                    <>
                      <Typography variant="body2">
                        Recording for{" "}
                        {catalog[pendingComboRecording.character]?.combos.find(
                          (combo) => combo.id === pendingComboRecording.comboId,
                        )?.route ?? pendingComboRecording.comboId}
                      </Typography>
                      {ownComboRecordingActive ? (
                        <Button
                          variant="outlined"
                          color="error"
                          onClick={() => void stopComboRecording()}
                          disabled={comboRecordingBusy || obsBusy}
                        >
                          Stop combo recording
                        </Button>
                      ) : (
                        <Stack direction="row" spacing={1}>
                          <Button
                            onClick={() => void refreshRecordings()}
                            disabled={comboRecordingBusy}
                          >
                            Find finished recording
                          </Button>
                          <Button
                            onClick={() => {
                              updatePendingComboRecording(null);
                              setComboRecordingStatus(null);
                            }}
                            disabled={comboRecordingBusy}
                          >
                            Forget pending link
                          </Button>
                        </Stack>
                      )}
                      {ownComboRecordingActive && (
                        <Typography variant="caption" color="text.secondary">
                          Stop here, with F9, or in OBS. The saved recording will link
                          automatically.
                        </Typography>
                      )}
                    </>
                  ) : selectedCombo ? (
                    <Tooltip
                      title={
                        obsState.status !== "connected"
                          ? "Connect OBS first."
                          : !obsSettings.recordDirectory.trim()
                            ? "Configure the OBS recording folder first."
                            : obsState.recording.active || obsState.automation.enabled
                              ? "Stop active and automatic recording first."
                              : moveCapture.armed
                                ? "Disarm the move take first."
                                : selectedCombo.recordingId
                                  ? "The finished recording will replace this combo's current recording link."
                                  : ""
                      }
                    >
                      <span>
                        <Button
                          variant="outlined"
                          onClick={() => void startComboRecording()}
                          disabled={
                            comboRecordingBusy ||
                            obsBusy ||
                            obsState.status !== "connected" ||
                            !obsSettings.recordDirectory.trim() ||
                            obsState.recording.active ||
                            obsState.automation.enabled ||
                            Boolean(moveCapture.armed)
                          }
                        >
                          Record for this combo
                        </Button>
                      </span>
                    </Tooltip>
                  ) : null}
                  {selectedCombo && (
                    <>
                      <Tooltip
                        title={
                          selectedAlreadyPublished
                            ? "This combo already matches the published version."
                            : checkingPublishedCombos
                              ? "Checking the published catalog."
                              : ""
                        }
                      >
                        <span>
                          <Button
                            variant="outlined"
                            onClick={() => void publishSelectedCombo()}
                            disabled={
                              publishingCombo || checkingPublishedCombos || selectedAlreadyPublished
                            }
                          >
                            {publishingCombo ? "Publishing…" : "Publish combo"}
                          </Button>
                        </span>
                      </Tooltip>
                      {publishStatus && (
                        <Alert severity={publishStatus.severity}>{publishStatus.message}</Alert>
                      )}
                    </>
                  )}
                  {comboRecordingStatus && (
                    <Alert severity={comboRecordingStatus.severity}>
                      {comboRecordingStatus.message}
                    </Alert>
                  )}
                </Stack>
              )}
            </Stack>
          )}
          {!combosOnly && section === 1 && (
            <Typography color="text.secondary">
              Pressure strings for this character and support will appear here.
            </Typography>
          )}
          {!combosOnly && section === 2 && (
            <Typography color="text.secondary">
              Neutral tools and game plans for this character and support will appear here.
            </Typography>
          )}
          {!combosOnly && section === 3 && (
            <Typography color="text.secondary">
              Miscellaneous tech for this character and support will appear here.
            </Typography>
          )}
        </Box>
      </Paper>
    </Stack>
  );
}
