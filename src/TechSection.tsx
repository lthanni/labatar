import { useEffect, useMemo, useState } from "react";
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Switch,
  Typography,
} from "@mui/material";
import type { RecordedVideo } from "./recording-types";
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
  TechMove,
  TechResourceCosts,
  TechRekkaFollowupPattern,
} from "./tech-types";
import { moveNotationsMatch, normalizeMoveNotation, parseMoveNotation } from "./move-notation";

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

const supportsByCharacter: Record<string, string[]> = {
  Aang: ["Gyatso", "Appa", "Momo"],
  Korra: ["Naga", "Tonraq", "Raava"],
  "Nightmare Korra": ["Vaatu", "Dark Avatar Unalaq", "Dark Spirit"],
  Zuko: ["Mai", "June", "Ran and Shaw"],
  Katara: ["Kanna", "Master Pakku", "Hakoda"],
  Toph: ["Badgermole", "The Boulder", "The Hippo"],
  Sokka: ["Suki", "Master Piandao", "Princess Yue"],
  Azula: ["Lo and Li", "Joo Dee", "Ursa"],
  Kyoshi: ["Rangi", "Kelsang", "Yun"],
  Ozai: ["Firelord Sozin", "Imperial Firebender", "Admiral Zhao"],
  Zaheer: ["Ming-Hua", "P'Li", "Ghazan"],
  "Avatar Aang": ["Katara", "Roku", "Guru Pathik"],
};

const screenPositions = ["corner", "midscreen", "fullscreen"];

type MoveDraft = {
  input: string;
  isRekka: boolean;
  allowsDirectionalFollowups: boolean;
  dependsOnMoveId: string;
  rekkaMinimumDuration: string;
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
  screenPosition: string;
  damage: string;
  pips: string;
  flow: string;
  recordingId: string | null;
};

const emptyMoveDraft: MoveDraft = {
  input: "",
  isRekka: false,
  allowsDirectionalFollowups: false,
  dependsOnMoveId: "",
  rekkaMinimumDuration: "",
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
  screenPosition: "",
  damage: "",
  pips: "0",
  flow: "0",
  recordingId: null,
};

function loadTechCatalog(): TechCatalog {
  const catalog: TechCatalog = Object.fromEntries(
    characters.map(({ value }) => [value, { moves: [], combos: [] }]),
  );
  try {
    const stored = JSON.parse(localStorage.getItem(techCatalogStorageKey) ?? "null") as Record<
      string,
      Partial<TechCatalog[string]>
    > | null;
    for (const character of characters) {
      const storedCharacter = stored?.[character.value];
      if (!storedCharacter) continue;
      if (Array.isArray(storedCharacter.moves)) {
        catalog[character.value].moves = storedCharacter.moves.map((move) => {
          const normalizedInput =
            typeof move.input === "string" ? normalizeMoveNotation(move.input) : null;
          return {
            ...move,
            input: normalizedInput ?? move.input,
            isRekka: move.isRekka === true,
            rekkaFollowupPattern:
              (move.rekkaFollowupPattern as TechRekkaFollowupPattern | null) ===
              "directional-button"
                ? "directional-button"
                : null,
            dependsOnMoveId: typeof move.dependsOnMoveId === "string" ? move.dependsOnMoveId : null,
            rekkaMinimumDuration:
              typeof move.rekkaMinimumDuration === "number" ? move.rekkaMinimumDuration : null,
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

function splitComboRoute(route: string) {
  return route
    .replace(/->|>|,|~|\u2192/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function findKnownMove(input: string, moves: TechMove[]) {
  return moves.find((move) => moveNotationsMatch(move.input, input)) ?? null;
}

function resolveComboRoute(route: string, moves: TechMove[]) {
  return splitComboRoute(route).map((token) => findKnownMove(token, moves)?.id ?? null);
}

function getComboRouteEntries(combo: TechCombo, moves: TechMove[]) {
  const tokens = splitComboRoute(combo.route);
  if (tokens.length > 0) {
    return tokens.map((token, index) => ({
      token,
      move:
        moves.find((candidate) => candidate.id === combo.moveIds[index]) ??
        findKnownMove(token, moves),
    }));
  }
  return combo.moveIds.map((moveId) => {
    const move = moves.find((candidate) => candidate.id === moveId) ?? null;
    return { token: formatMoveLabel(move), move };
  });
}

function getComboRouteText(combo: TechCombo, moves: TechMove[]) {
  if (combo.route.trim()) return combo.route.trim();
  return combo.moveIds
    .map((moveId) => formatMoveLabel(moves.find((move) => move.id === moveId) ?? null))
    .join(" → ");
}

function getComboStarterLabel(combo: TechCombo, moves: TechMove[]) {
  const starterMove = getComboStarterMove(combo, moves);
  if (starterMove) return formatMoveLabel(starterMove);
  const firstRouteToken = splitComboRoute(combo.route)[0];
  if (firstRouteToken) return firstRouteToken;
  return getComboRouteText(combo, moves).split(/\s*(?:→|->|,)\s*/)[0] || "Unknown starter";
}

function getComboStarterKey(combo: TechCombo, moves: TechMove[]) {
  return getComboStarterMove(combo, moves)?.id ?? getComboStarterLabel(combo, moves);
}

function getComboResourceCosts(combo: TechCombo, moves: TechMove[]): TechResourceCosts {
  if (combo.moveIds.length === 0) return combo.resourceCosts;
  return combo.moveIds.reduce<TechResourceCosts>(
    (total, moveId) => {
      const move = moves.find((candidate) => candidate.id === moveId);
      if (!move) return total;
      for (const [resource, amount] of Object.entries(move.resourceCosts)) {
        total[resource] = (total[resource] ?? 0) + amount;
      }
      return total;
    },
    { pips: 0, flow: 0 },
  );
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
  if (!parent || parent.rekkaMinimumDuration == null) return null;
  visited.add(move.id);
  return parent.rekkaMinimumDuration + move.startup;
}

function MoveList({ moves, onEdit }: { moves: TechMove[]; onEdit: (move: TechMove) => void }) {
  const moveTableColumns = "minmax(220px, 1fr) repeat(8, 76px) 70px";
  return (
    <Paper variant="outlined" sx={{ overflowX: "auto" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: moveTableColumns,
          columnGap: 1.5,
          minWidth: 960,
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
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          Actions
        </Typography>
      </Box>
      {moves.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 2 }}>
          No moves have been added for this character yet.
        </Typography>
      ) : (
        <List dense disablePadding>
          {moves.map((move) => {
            const parentMove = move.dependsOnMoveId
              ? moves.find((candidate) => candidate.id === move.dependsOnMoveId)
              : null;
            return (
              <ListItemButton
                key={move.id}
                component="div"
                sx={{
                  display: "grid",
                  gridTemplateColumns: moveTableColumns,
                  columnGap: 1.5,
                  minWidth: 960,
                  cursor: "default",
                  px: 2,
                  borderLeft: move.dependsOnMoveId ? 2 : 0,
                  borderColor: "primary.main",
                }}
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                      <span>{move.input}</span>
                      {move.isRekka && <Chip label="Rekka" size="small" color="primary" />}
                    </Stack>
                  }
                  secondary={
                    [
                      parentMove ? `Follow-up after ${parentMove.input}` : null,
                      move.rekkaFollowupPattern === "directional-button"
                        ? "Accepts 1-9 + button followups"
                        : null,
                      move.isRekka && move.rekkaMinimumDuration != null
                        ? `Rekka minimum ${move.rekkaMinimumDuration}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  sx={{ minWidth: 0, pl: move.dependsOnMoveId ? 3 : 0 }}
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
                <Button size="small" onClick={() => onEdit(move)}>
                  Edit
                </Button>
              </ListItemButton>
            );
          })}
        </List>
      )}
    </Paper>
  );
}

function ComboSelector({
  combos,
  moves,
  selectedId,
  onSelect,
  onEdit,
}: {
  combos: TechCombo[];
  moves: TechMove[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (combo: TechCombo) => void;
}) {
  const [selectedStarterMoves, setSelectedStarterMoves] = useState<string[]>([]);
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const starterMoveOptions = useMemo(
    () => [
      ...new Map(
        combos.map((combo) => [
          getComboStarterKey(combo, moves),
          getComboStarterLabel(combo, moves),
        ]),
      ),
    ],
    [combos, moves],
  );
  const positionOptions = useMemo(
    () => [...new Set(combos.map((combo) => combo.screenPosition))],
    [combos],
  );

  useEffect(() => {
    setSelectedStarterMoves([]);
    setSelectedPositions([]);
  }, [combos]);

  const filteredCombos = combos.filter((combo) => {
    const starterMatches =
      selectedStarterMoves.length === 0 ||
      selectedStarterMoves.includes(getComboStarterKey(combo, moves));
    const positionMatches =
      selectedPositions.length === 0 || selectedPositions.includes(combo.screenPosition);
    return starterMatches && positionMatches;
  });

  const updateMultiSelect = (value: unknown, setValue: (value: string[]) => void) => {
    setValue((typeof value === "string" ? value.split(",") : value) as string[]);
  };

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ px: 2, py: 1, bgcolor: "action.hover", alignItems: "center" }}
      >
        <FormControl size="small" sx={{ width: 190, flexShrink: 0 }}>
          <InputLabel id="tech-starter-filter-label">Starter move</InputLabel>
          <Select
            labelId="tech-starter-filter-label"
            multiple
            value={selectedStarterMoves}
            onChange={(event) => updateMultiSelect(event.target.value, setSelectedStarterMoves)}
            input={<OutlinedInput label="Starter move" />}
            renderValue={(selected) => {
              const values = selected as string[];
              if (values.length === 0) return "All starter moves";
              return values
                .map((value) => starterMoveOptions.find(([id]) => id === value)?.[1] ?? value)
                .join(", ");
            }}
          >
            {starterMoveOptions.map(([id, label]) => (
              <MenuItem key={id} value={id}>
                <Checkbox checked={selectedStarterMoves.includes(id)} size="small" />
                <ListItemText primary={label} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="caption" sx={{ flex: 1, minWidth: 180, fontWeight: 700 }}>
          Route
        </Typography>
        <FormControl size="small" sx={{ width: 150, flexShrink: 0 }}>
          <InputLabel id="tech-position-filter-label">Position</InputLabel>
          <Select
            labelId="tech-position-filter-label"
            multiple
            value={selectedPositions}
            onChange={(event) => updateMultiSelect(event.target.value, setSelectedPositions)}
            input={<OutlinedInput label="Position" />}
            renderValue={(selected) => {
              const values = selected as string[];
              return values.length === 0 ? "All positions" : values.join(", ");
            }}
          >
            {positionOptions.map((position) => (
              <MenuItem key={position} value={position}>
                <Checkbox checked={selectedPositions.includes(position)} size="small" />
                <ListItemText primary={position} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="caption" sx={{ width: 80, fontWeight: 700 }}>
          Damage
        </Typography>
        <Typography variant="caption" sx={{ width: 130, fontWeight: 700 }}>
          Cost
        </Typography>
      </Stack>
      {combos.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 2 }}>
          No combos have been added for this character and support yet.
        </Typography>
      ) : filteredCombos.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 2 }}>
          No combos match the selected filters.
        </Typography>
      ) : (
        <List dense disablePadding>
          {filteredCombos.map((combo) =>
            (() => {
              const costs = getComboResourceCosts(combo, moves);
              return (
                <ListItemButton
                  key={combo.id}
                  component="div"
                  role="button"
                  tabIndex={0}
                  selected={combo.id === selectedId}
                  onClick={() => onSelect(combo.id)}
                  onKeyDown={(event) => {
                    if (
                      event.target !== event.currentTarget ||
                      (event.key !== "Enter" && event.key !== " ")
                    ) {
                      return;
                    }
                    event.preventDefault();
                    onSelect(combo.id);
                  }}
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <span>{getComboStarterLabel(combo, moves)}</span>
                        {getComboRouteEntries(combo, moves).some(({ move }) => !move) && (
                          <Chip label="Unknown move" size="small" color="warning" />
                        )}
                        <Button
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation();
                            onEdit(combo);
                          }}
                        >
                          Edit
                        </Button>
                      </Stack>
                    }
                    sx={{ width: 190, flexShrink: 0, minWidth: 0 }}
                  />
                  <Typography
                    variant="body2"
                    sx={{ flex: 1, minWidth: 180, overflowWrap: "anywhere" }}
                  >
                    {getComboRouteText(combo, moves)}
                  </Typography>
                  <Typography variant="body2" sx={{ width: 110 }}>
                    {combo.screenPosition}
                  </Typography>
                  <Typography variant="body2" sx={{ width: 80 }}>
                    {combo.damage}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ width: 130 }}>
                    {costs.pips} pips · {costs.flow} flow
                  </Typography>
                </ListItemButton>
              );
            })(),
          )}
        </List>
      )}
    </Paper>
  );
}

function ComboDetails({
  combo,
  moves,
  recordings,
  onSelectRecording,
}: {
  combo: TechCombo | null;
  moves: TechMove[];
  recordings: RecordedVideo[];
  onSelectRecording: (recordingId: string) => void;
}) {
  if (!combo) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography color="text.secondary">
            Select a combo to view its route and linked recordings.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const costs = getComboResourceCosts(combo, moves);
  const route = combo.moveIds.map((moveId) => {
    const move = moves.find((candidate) => candidate.id === moveId) ?? null;
    return move ? { ...move, startup: getEffectiveStartup(move, moves) } : null;
  });
  const routeEntries = getComboRouteEntries(combo, moves);
  const unknownRouteEntries = routeEntries.filter(({ move }) => !move);
  const linkedRecording = combo.recordingId
    ? (recordings.find((recording) => recording.id === combo.recordingId) ?? null)
    : null;
  const additionalCosts = Object.entries(costs).filter(
    ([resource, amount]) => resource !== "pips" && resource !== "flow" && amount !== 0,
  );

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="h6">{getComboStarterLabel(combo, moves)}</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={3}>
            <Typography variant="body2">Position: {combo.screenPosition}</Typography>
            <Typography variant="body2">Damage: {combo.damage}</Typography>
            <Typography variant="body2">
              Cost: {costs.pips} pips · {costs.flow} flow
            </Typography>
          </Stack>
          <Divider />
          <Typography variant="subtitle2">Route</Typography>
          {routeEntries.length > 0 ? (
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", gap: 0.75 }}>
              {routeEntries.map(({ token, move }, index) => (
                <Chip
                  key={`${combo.id}-route-${index}`}
                  label={token}
                  color={move ? "default" : "error"}
                  variant={move ? "outlined" : "filled"}
                  title={move ? `Known move: ${move.input}` : "This move was not matched"}
                />
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No moves in this combo yet.
            </Typography>
          )}
          {unknownRouteEntries.length > 0 && (
            <Typography variant="body2" color="warning.main">
              Could not match: {unknownRouteEntries.map(({ token }) => token).join(", ")}
            </Typography>
          )}
          {additionalCosts.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              Other costs:{" "}
              {additionalCosts.map(([resource, amount]) => `${amount} ${resource}`).join(", ")}
            </Typography>
          )}
          {route.some(Boolean) && (
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">Move data</Typography>
              {route.map((move, index) => (
                <Typography key={`${combo.id}-${index}`} variant="body2" color="text.secondary">
                  {index + 1}. {formatMoveLabel(move)} — startup {move?.startup ?? "?"}, active{" "}
                  {move?.active ?? "?"}, recovery {move?.recovery ?? "?"}, on block{" "}
                  {move?.onBlock ?? "?"}, blockstun {move?.blockstun ?? "?"}, hitstun{" "}
                  {move?.hitstun ?? "?"}
                </Typography>
              ))}
            </Stack>
          )}
          {combo.recordingId ? (
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">Linked recording</Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                {linkedRecording && (
                  <Box
                    component="video"
                    src={linkedRecording.url}
                    muted
                    playsInline
                    preload="auto"
                    aria-label={`Thumbnail for ${linkedRecording.name}`}
                    onClick={() => onSelectRecording(combo.recordingId as string)}
                    sx={{
                      width: 160,
                      height: 90,
                      flexShrink: 0,
                      objectFit: "cover",
                      borderRadius: 1,
                      backgroundColor: "#000",
                      cursor: "pointer",
                    }}
                  />
                )}
                <Button
                  variant="text"
                  size="small"
                  onClick={() => onSelectRecording(combo.recordingId as string)}
                  sx={{ justifyContent: "flex-start", overflowWrap: "anywhere" }}
                >
                  {linkedRecording?.name ?? `${combo.recordingId} (not found)`}
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No recording linked yet.
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export function TechSection() {
  const [character, setCharacter] = useState(characters[0].value);
  const [support, setSupport] = useState(supportsByCharacter[characters[0].value][0]);
  const [section, setSection] = useState(0);
  const [selectedComboId, setSelectedComboId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<TechCatalog>(loadTechCatalog);
  const [moveDraft, setMoveDraft] = useState<MoveDraft>(emptyMoveDraft);
  const [editingMoveId, setEditingMoveId] = useState<string | null>(null);
  const [moveInputError, setMoveInputError] = useState<string | null>(null);
  const [comboDraft, setComboDraft] = useState<ComboDraft>(emptyComboDraft);
  const [editingComboId, setEditingComboId] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<RecordedVideo[]>([]);
  const supports = useMemo(() => supportsByCharacter[character] ?? [], [character]);
  const techData = catalog[character] ?? { moves: [], combos: [] };
  const moves = techData.moves;
  const combos = useMemo(
    () => techData.combos.filter((combo) => combo.support === support),
    [support, techData.combos],
  );
  const selectedCombo = combos.find((combo) => combo.id === selectedComboId) ?? null;
  const rekkaParentOptions = moves.filter((move) => move.isRekka && move.id !== editingMoveId);
  const selectedRekkaParent = rekkaParentOptions.some(
    (move) => move.id === moveDraft.dependsOnMoveId,
  )
    ? moveDraft.dependsOnMoveId
    : "";

  useEffect(() => {
    localStorage.setItem(techCatalogStorageKey, JSON.stringify(catalog));
    window.dispatchEvent(new Event(techCatalogUpdatedEvent));
  }, [catalog]);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.recordings
      .list()
      .then((result) => {
        if (!cancelled) setRecordings(result.recordings);
      })
      .catch(() => {
        if (!cancelled) setRecordings([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const selectCombo = (comboId: string) => {
      for (const [characterValue, data] of Object.entries(catalog)) {
        const combo = data.combos.find((candidate) => candidate.id === comboId);
        if (!combo) continue;
        setCharacter(characterValue);
        setSupport(combo.support);
        setSection(1);
        setSelectedComboId(combo.id);
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

  const changeCharacter = (nextCharacter: string) => {
    setCharacter(nextCharacter);
    setSupport(supportsByCharacter[nextCharacter]?.[0] ?? "");
    setSelectedComboId(null);
    setMoveDraft(emptyMoveDraft);
    setEditingMoveId(null);
    setMoveInputError(null);
    setComboDraft(emptyComboDraft);
    setEditingComboId(null);
  };

  const editMove = (move: TechMove) => {
    setEditingMoveId(move.id);
    setMoveInputError(null);
    setMoveDraft({
      input: normalizeMoveNotation(move.input) ?? move.input,
      isRekka: move.isRekka,
      allowsDirectionalFollowups: move.rekkaFollowupPattern === "directional-button",
      dependsOnMoveId: move.dependsOnMoveId ?? "",
      rekkaMinimumDuration: String(move.rekkaMinimumDuration ?? ""),
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

  const saveMove = () => {
    const parsedInput = parseMoveNotation(moveDraft.input);
    if (!parsedInput.ok) {
      setMoveInputError(parsedInput.error);
      return;
    }
    const input = parsedInput.notation;
    setMoveInputError(null);
    const rekkaFollowupPattern: TechRekkaFollowupPattern | null =
      moveDraft.isRekka && moveDraft.allowsDirectionalFollowups ? "directional-button" : null;
    const moveValues = {
      character,
      input,
      isRekka: moveDraft.isRekka,
      rekkaFollowupPattern,
      dependsOnMoveId: rekkaParentOptions.some((move) => move.id === moveDraft.dependsOnMoveId)
        ? moveDraft.dependsOnMoveId
        : null,
      rekkaMinimumDuration: moveDraft.isRekka
        ? parseMoveNumber(moveDraft.rekkaMinimumDuration)
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
    setCatalog((current) => ({
      ...current,
      [character]: {
        ...(current[character] ?? { combos: [] }),
        moves: editingMoveId
          ? (current[character]?.moves ?? []).map((move) => {
              if (move.id === editingMoveId) return { ...move, ...moveValues };
              if (!moveValues.isRekka && move.dependsOnMoveId === editingMoveId) {
                return { ...move, dependsOnMoveId: null };
              }
              return move;
            })
          : [
              ...(current[character]?.moves ?? []),
              { id: moveIdFor(character, input, moves), ...moveValues },
            ],
      },
    }));
    setMoveDraft(emptyMoveDraft);
    setEditingMoveId(null);
  };

  const editCombo = (combo: TechCombo) => {
    setSelectedComboId(combo.id);
    setEditingComboId(combo.id);
    setComboDraft({
      route: combo.route,
      screenPosition: combo.screenPosition,
      damage: combo.damage,
      pips: String(combo.resourceCosts.pips ?? 0),
      flow: String(combo.resourceCosts.flow ?? 0),
      recordingId: combo.recordingId,
    });
  };

  const saveCombo = () => {
    if (!comboDraft.route.trim()) return;
    const comboValues = {
      character,
      support,
      moveIds: resolveComboRoute(comboDraft.route, moves),
      route: comboDraft.route.trim(),
      screenPosition: comboDraft.screenPosition.trim(),
      damage: comboDraft.damage.trim(),
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
    setEditingComboId(null);
  };

  return (
    <Stack spacing={2} sx={{ textAlign: "left" }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6">Tech</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Explore character and support-specific combos, pressure, and other notes.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
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
              }}
            >
              {supports.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      <Paper variant="outlined">
        <Tabs value={section} onChange={(_, nextSection: number) => setSection(nextSection)}>
          <Tab label="Moves" />
          <Tab label="Combos" />
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
              <MoveList moves={moves} onEdit={editMove} />
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Typography variant="subtitle2">
                    {editingMoveId ? "Edit move" : "Add move"}
                  </Typography>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                    <TextField
                      label="Input"
                      placeholder="2B or 214C"
                      size="small"
                      value={moveDraft.input}
                      onChange={(event) => {
                        setMoveInputError(null);
                        setMoveDraft((current) => ({ ...current, input: event.target.value }));
                      }}
                      error={Boolean(moveInputError)}
                      helperText={moveInputError ?? "Example: 2B, j.2C, 236F, 22EX, or 5X."}
                      required
                      sx={{ flex: 1 }}
                    />
                  </Stack>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={moveDraft.isRekka}
                          onChange={(event) =>
                            setMoveDraft((current) => ({
                              ...current,
                              isRekka: event.target.checked,
                            }))
                          }
                        />
                      }
                      label="Rekka move"
                    />
                    {moveDraft.isRekka && (
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={moveDraft.allowsDirectionalFollowups}
                            onChange={(event) =>
                              setMoveDraft((current) => ({
                                ...current,
                                allowsDirectionalFollowups: event.target.checked,
                              }))
                            }
                            size="small"
                          />
                        }
                        label="1-9 + button followups"
                      />
                    )}
                    {moveDraft.isRekka && (
                      <TextField
                        label="Minimum duration"
                        type="number"
                        size="small"
                        value={moveDraft.rekkaMinimumDuration}
                        onChange={(event) =>
                          setMoveDraft((current) => ({
                            ...current,
                            rekkaMinimumDuration: event.target.value,
                          }))
                        }
                        sx={{ width: 150 }}
                      />
                    )}
                    <FormControl
                      size="small"
                      sx={{ minWidth: 240 }}
                      disabled={rekkaParentOptions.length === 0}
                    >
                      <InputLabel id="tech-rekka-parent-label">Depends on rekka</InputLabel>
                      <Select
                        labelId="tech-rekka-parent-label"
                        value={selectedRekkaParent}
                        label="Depends on rekka"
                        onChange={(event) =>
                          setMoveDraft((current) => ({
                            ...current,
                            dependsOnMoveId: event.target.value,
                          }))
                        }
                      >
                        <MenuItem value="">None</MenuItem>
                        {rekkaParentOptions.map((move) => (
                          <MenuItem key={move.id} value={move.id}>
                            {move.input}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
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
                    variant="contained"
                    onClick={saveMove}
                    disabled={!moveDraft.input.trim()}
                    sx={{ alignSelf: "flex-start" }}
                  >
                    {editingMoveId ? "Save changes" : "Add move"}
                  </Button>
                  {editingMoveId && (
                    <Button
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
                </Stack>
              </Paper>
            </Stack>
          )}
          {section === 1 && (
            <Stack spacing={2}>
              <Typography variant="subtitle1">
                Combos for {characters.find((option) => option.value === character)?.label} +{" "}
                {support}
              </Typography>
              <Typography variant="subtitle2">Combo selector</Typography>
              <ComboSelector
                combos={combos}
                moves={moves}
                selectedId={selectedComboId}
                onSelect={setSelectedComboId}
                onEdit={editCombo}
              />
              <ComboDetails
                combo={selectedCombo}
                moves={moves}
                recordings={recordings}
                onSelectRecording={selectLinkedRecording}
              />
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Typography variant="subtitle2">
                    {editingComboId ? "Edit combo" : "Add combo"}
                  </Typography>
                  <TextField
                    label="Move string"
                    placeholder="2B > 5C > 214C"
                    multiline
                    minRows={2}
                    size="small"
                    value={comboDraft.route}
                    onChange={(event) =>
                      setComboDraft((current) => ({ ...current, route: event.target.value }))
                    }
                    required
                  />
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
                        {screenPositions.map((position) => (
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
                  <Autocomplete
                    options={recordings}
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
                      disabled={!comboDraft.route.trim()}
                    >
                      {editingComboId ? "Save changes" : "Add combo"}
                    </Button>
                    {editingComboId && (
                      <Button
                        onClick={() => {
                          setComboDraft(emptyComboDraft);
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
          )}
          {section === 2 && (
            <Typography color="text.secondary">
              Pressure strings for this character and support will appear here.
            </Typography>
          )}
          {section === 3 && (
            <Typography color="text.secondary">
              Neutral tools and game plans for this character and support will appear here.
            </Typography>
          )}
          {section === 4 && (
            <Typography color="text.secondary">
              Miscellaneous tech for this character and support will appear here.
            </Typography>
          )}
        </Box>
      </Paper>
    </Stack>
  );
}
