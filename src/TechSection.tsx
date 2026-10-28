import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
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
  Switch,
  Typography,
} from "@mui/material";
import supportMap from "../electron/support-map.json";
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
  techSelectRecordingEvent,
  techSelectedRecordingStorageKey,
} from "./tech-types";
import type {
  TechCatalog,
  TechMove,
  TechStanceFollowupPattern,
  TechMeasuredField,
} from "./tech-types";
import {
  classifyMoveInput,
  isFlowCancellableByDefault,
  normalizeMoveNotation,
  parseMoveNotation,
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
      if (Array.isArray(storedCharacter.combos))
        catalog[character.value].combos = storedCharacter.combos;
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

export function TechSection() {
  const [character, setCharacter] = useState(characters[0].value);
  const [support, setSupport] = useState(supportsByCharacter[characters[0].value][0]);
  const [section, setSection] = useState(() => {
    const savedSection = localStorage.getItem(techEditorSectionStorageKey);
    const savedIndex = techEditorSections.findIndex((value) => value === savedSection);
    return savedIndex >= 0 ? savedIndex : 0;
  });
  const [catalog, setCatalog] = useState<TechCatalog>(loadTechCatalog);
  const [moveDraft, setMoveDraft] = useState<MoveDraft>(emptyMoveDraft);
  const [editingMoveId, setEditingMoveId] = useState<string | null>(null);
  const [moveInputError, setMoveInputError] = useState<string | null>(null);
  const moveInputRef = useRef<HTMLInputElement>(null);
  const supports = useMemo(() => supportsByCharacter[character] ?? [], [character]);
  const techData = catalog[character] ?? { moves: [], combos: [] };
  const moves = techData.moves;
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

  const changeCharacter = (nextCharacter: string) => {
    setCharacter(nextCharacter);
    setSupport(supportsByCharacter[nextCharacter]?.[0] ?? "");
    setMoveDraft(emptyMoveDraft);
    setEditingMoveId(null);
    setMoveInputError(null);
  };

  const selectLinkedRecording = (recordingId: string) => {
    localStorage.setItem(techSelectedRecordingStorageKey, recordingId);
    window.dispatchEvent(new CustomEvent(techSelectRecordingEvent, { detail: recordingId }));
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
        },
      };
    });
    setMoveDraft(emptyMoveDraft);
    setEditingMoveId(null);
    setMoveInputError(null);
  };

  return (
    <Stack spacing={2} sx={{ textAlign: "left" }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6">Tech editor</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Explore character and support-specific moves, pressure, and other notes.
        </Typography>
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
              }}
            >
              {supports.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Paper>

      <Paper variant="outlined">
        <Tabs value={section} onChange={(_, nextSection: number) => setSection(nextSection)}>
          <Tab label="Moves" />
          <Tab label="Pressure" />
          <Tab label="Neutral" />
          <Tab label="Misc" />
        </Tabs>
        <Box sx={{ p: 2 }}>
          {section === 0 && (
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
          {section === 1 && (
            <Typography color="text.secondary">
              Pressure strings for this character and support will appear here.
            </Typography>
          )}
          {section === 2 && (
            <Typography color="text.secondary">
              Neutral tools and game plans for this character and support will appear here.
            </Typography>
          )}
          {section === 3 && (
            <Typography color="text.secondary">
              Miscellaneous tech for this character and support will appear here.
            </Typography>
          )}
        </Box>
      </Paper>
    </Stack>
  );
}
