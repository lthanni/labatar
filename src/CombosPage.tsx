import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import supportMap from "../electron/support-map.json";
import { ComboRouteText } from "./ComboRouteText";
import {
  comboScreenPositions,
  comboScreenPositionOrEmpty,
  isComboScreenPosition,
} from "./combo-screen-position";
import { ComboCandidateReview } from "./ComboCandidateReview";
import {
  candidateComboFromItem,
  candidateMatchesPublishedCombo,
  candidateReviewStatus,
  countCandidates,
  isActiveCandidate,
  finishUploadedCandidate,
  mergeCandidateItems,
  candidatePublicationMatches,
  savedCandidateRecording,
  type ComboCandidate,
} from "./combo-candidates";
import { comboStarterFromRoute, comboStarterGroup, comboStarterGroups } from "./combo-starter";
import { candidateRecordingTitle, formatComboRecordingBaseName } from "./combo-recording-name";
import { useObsRecording } from "./ObsRecordingContext";
import { comboNoteCategoryLabel, comboNoteRangeOffsets, normalizeComboNotes } from "./combo-notes";
import {
  catalogSnapshot,
  comboItems,
  comboStatuses,
  countLocalCombos,
  effectiveDifficulty,
  emptyPersonalEntry,
  localRevisionDraft,
  replaceLocalComboWithCatalog,
  numericDamage,
  readComboWorkspace,
  replaceComboEntries,
  slugComboText,
  writeComboWorkspace,
  type ComboItem,
  type ComboRole,
  type ComboStatus,
  type ComboWorkspaceData,
  type ConfirmFact,
  type LocalCombo,
  type PersonalComboEntry,
} from "./combo-gameplan";
import {
  fetchPublishedCatalog,
  readPublishedCatalogCache,
  writePublishedCatalogCache,
  type PublishedCatalog,
} from "./published-catalog";
import { publishedComboFromDraft, type PublishComboDraft } from "./publish-combo-draft";
import {
  comboMediaGap,
  comboYouTubeVideo,
  isLocalMp4,
  mediaGap,
  type ComboMediaGap,
} from "./combo-media";
import type { RecordedVideo } from "./recording-types";
import {
  pendingYouTubeUploadUrl,
  pendingYouTubeUploadsChangedEvent,
  savePendingYouTubeUpload,
} from "./youtube-pending-uploads";
import { youtubeVideoId } from "./YouTubeRecordingPlayer";
import {
  techCatalogStorageKey,
  techSelectedRecordingStorageKey,
  techSelectRecordingEvent,
  type TechCombo,
} from "./tech-types";

const names: Record<string, string> = {
  "avatar-aang": "Avatar Aang",
  "nightmare-korra": "Nightmare Korra",
  "dark-avatar-unalaq": "Dark Avatar Unalaq",
  "firelord-sozin": "Firelord Sozin",
  "lo-and-li": "Lo and Li",
  "ming-hua": "Ming-Hua",
  "p-li": "P'Li",
};
const roster = Object.keys(supportMap);
const displayName = (id: string) =>
  names[id] ??
  id
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ");
const comboDisplayName = (item: ComboItem, personal: PersonalComboEntry) =>
  personal.name.trim() || item.name.trim() || "Unnamed combo";
const catalogId = (name: string) => slugComboText(name);
const loadUpstreamCandidatesKey = "labatar-load-upstream-candidates";
const pendingPageComboRecordingKey = "labatar-pending-page-combo-recording-v1";

type PendingPageComboRecording = { comboId: string; sessionId: string };

function readPendingPageComboRecording(): PendingPageComboRecording | null {
  try {
    const value = JSON.parse(localStorage.getItem(pendingPageComboRecordingKey) ?? "null");
    return value && typeof value.comboId === "string" && typeof value.sessionId === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

type LegacyComboRow = { key: string; combo: TechCombo };

function readLegacyCombos(): LegacyComboRow[] {
  try {
    const catalog = JSON.parse(localStorage.getItem(techCatalogStorageKey) ?? "null");
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return [];
    return Object.entries(catalog).flatMap(([character, data]) => {
      const combos = (data as { combos?: unknown })?.combos;
      if (!Array.isArray(combos)) return [];
      return combos.flatMap((value): LegacyComboRow[] => {
        if (!value || typeof value !== "object") return [];
        const combo = value as Partial<TechCombo>;
        if (
          typeof combo.id !== "string" ||
          typeof combo.route !== "string" ||
          !combo.route.trim() ||
          typeof combo.support !== "string"
        )
          return [];
        return [
          {
            key: `${character}:${combo.id}`,
            combo: {
              ...combo,
              id: combo.id,
              character: typeof combo.character === "string" ? combo.character : character,
              support: combo.support,
              route: combo.route,
              name: typeof combo.name === "string" ? combo.name : "",
              moveIds: Array.isArray(combo.moveIds) ? combo.moveIds : [],
              screenPosition: typeof combo.screenPosition === "string" ? combo.screenPosition : "",
              damage: typeof combo.damage === "string" ? combo.damage : "",
              resourceCosts: {
                pips: Number(combo.resourceCosts?.pips) || 0,
                flow: Number(combo.resourceCosts?.flow) || 0,
              },
              recordingId:
                typeof combo.recordingId === "string"
                  ? combo.recordingId
                  : Array.isArray((combo as TechCombo & { recordingIds?: unknown }).recordingIds) &&
                      typeof (combo as TechCombo & { recordingIds: unknown[] }).recordingIds[0] ===
                        "string"
                    ? (combo as TechCombo & { recordingIds: string[] }).recordingIds[0]
                    : null,
            },
          },
        ];
      });
    });
  } catch {
    return [];
  }
}

function legacyComboMediaGap(
  combo: TechCombo,
  recording: RecordedVideo | null,
  recordingsLoaded: boolean,
): ComboMediaGap {
  const hasLocalMp4 =
    Boolean(recording && isLocalMp4(recording)) ||
    Boolean(!recordingsLoaded && combo.recordingId && /\.mp4$/i.test(combo.recordingId));
  const hasYouTubeVideo = Boolean(youtubeVideoId(recording?.youtubeUrl ?? recording?.url));
  return mediaGap(hasLocalMp4, hasYouTubeVideo);
}

type RawFilters = {
  search: string;
  source: string;
  character: string;
  support: string;
  starter: string;
  position: string;
  status: string;
  hitconfirm: string;
  counterhit: string;
  editorPick: string;
  media: string;
  minDamage: string;
  maxPips: string;
  maxFlow: string;
  maxDifficulty: string;
};
const emptyRaw = (): RawFilters => ({
  search: "",
  source: "all",
  character: "all",
  support: "all",
  starter: "all",
  position: "all",
  status: "all",
  hitconfirm: "all",
  counterhit: "all",
  editorPick: "all",
  media: "all",
  minDamage: "",
  maxPips: "",
  maxFlow: "",
  maxDifficulty: "",
});
function activeRawFilters(raw: RawFilters): [keyof RawFilters, string][] {
  const labels: [keyof RawFilters, string][] = [
    ["search", `Search: ${raw.search.trim()}`],
    ["source", `Source: ${raw.source}`],
    ["character", `Character: ${displayName(raw.character)}`],
    ["support", `Support: ${displayName(raw.support)}`],
    ["starter", `Starter: ${raw.starter}`],
    ["position", `Position: ${raw.position}`],
    ["status", `Status: ${raw.status || "Blank"}`],
    ["hitconfirm", `Hitconfirm: ${raw.hitconfirm}`],
    ["counterhit", `Counterhit: ${raw.counterhit}`],
    ["editorPick", `Editor pick: ${raw.editorPick}`],
    ["media", `Media: ${raw.media}`],
    ["minDamage", `Damage ≥ ${raw.minDamage}`],
    ["maxPips", `Pips ≤ ${raw.maxPips}`],
    ["maxFlow", `Flow ≤ ${raw.maxFlow}`],
    ["maxDifficulty", `Difficulty ≤ ${raw.maxDifficulty}`],
  ];
  const defaults = emptyRaw();
  return labels.filter(
    ([key]) => raw[key] !== defaults[key] && (key !== "search" || raw.search.trim()),
  );
}
const rawColumns = [
  ["source", "Source"],
  ["character", "Character"],
  ["support", "Support"],
  ["starter", "Starter"],
  ["name", "Name"],
  ["position", "Position"],
  ["damage", "Damage"],
  ["difficulty", "Difficulty"],
  ["pips", "Pips"],
  ["flow", "Flow"],
  ["counterhit", "Counterhit"],
  ["hitconfirm", "Hitconfirm"],
  ["status", "Status"],
  ["editorPick", "Editor pick"],
  ["media", "Media"],
  ["route", "Route"],
  ["tags", "My tags"],
] as const;
type RawColumn = (typeof rawColumns)[number][0];

function field(
  item: ComboItem,
  entry: PersonalComboEntry,
  column: RawColumn,
  gap: ComboMediaGap,
): string | number | null {
  switch (column) {
    case "source":
      return item.local?.originCatalog
        ? "Local revision"
        : item.candidate
          ? `Candidate · ${candidateReviewStatus(item.candidate)}`
          : item.source;
    case "character":
      return displayName(item.characterId);
    case "support":
      return displayName(item.supportId);
    case "starter":
      return item.starter;
    case "name":
      return entry.name || item.name;
    case "position":
      return item.screenPosition || "—";
    case "damage":
      return numericDamage(item.damage);
    case "difficulty":
      return effectiveDifficulty(item, entry);
    case "pips":
      return item.pips;
    case "flow":
      return item.flow;
    case "counterhit":
      return item.counterhit === "yes" ? "Required" : item.counterhit === "no" ? "No" : "—";
    case "hitconfirm":
      return item.hitconfirm === "unknown" ? "—" : item.hitconfirm;
    case "status":
      return entry.status;
    case "editorPick":
      return item.published?.editorPickReason ? "Yes" : "";
    case "media":
      return gap ?? "Video available";
    case "route":
      return item.route;
    case "tags":
      return entry.tags.join(", ");
  }
}

function matchesRaw(
  item: ComboItem,
  entry: PersonalComboEntry,
  filters: RawFilters,
  gap: ComboMediaGap,
): boolean {
  const search = filters.search.trim().toLowerCase();
  if (
    search &&
    ![item.name, entry.name, item.route, item.starter, item.screenPosition, ...entry.tags].some(
      (value) => value.toLowerCase().includes(search),
    )
  )
    return false;
  if (
    filters.source !== "all" &&
    (filters.source === "Candidate" ? !item.candidate : item.source !== filters.source)
  )
    return false;
  if (filters.character !== "all" && item.characterId !== filters.character) return false;
  if (filters.support !== "all" && item.supportId !== filters.support) return false;
  if (filters.starter !== "all" && item.starter !== filters.starter) return false;
  if (filters.position !== "all" && item.screenPosition.toLowerCase() !== filters.position)
    return false;
  if (filters.status !== "all" && entry.status !== filters.status) return false;
  if (filters.hitconfirm !== "all" && item.hitconfirm !== filters.hitconfirm) return false;
  if (filters.counterhit !== "all" && item.counterhit !== filters.counterhit) return false;
  if (
    filters.editorPick !== "all" &&
    Boolean(item.published?.editorPickReason) !== (filters.editorPick === "yes")
  )
    return false;
  if (filters.media !== "all" && gap !== filters.media) return false;
  if (filters.minDamage && (numericDamage(item.damage) ?? -1) < Number(filters.minDamage))
    return false;
  if (filters.maxPips && item.pips > Number(filters.maxPips)) return false;
  if (filters.maxFlow && item.flow > Number(filters.maxFlow)) return false;
  if (
    filters.maxDifficulty &&
    (effectiveDifficulty(item, entry) ?? 6) > Number(filters.maxDifficulty)
  )
    return false;
  return true;
}

function SelectField({
  label,
  value,
  options,
  onChange,
  width = 150,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  width?: number;
}) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      sx={{ minWidth: width }}
      slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
    >
      {options.map(([key, text]) => (
        <option key={key} value={key}>
          {text}
        </option>
      ))}
    </TextField>
  );
}

function ComboSourceCounts({ local, candidates }: { local: number; candidates: number }) {
  if (local === 0 && candidates === 0) return null;
  return (
    <Stack direction="row" spacing={0.75} sx={{ justifyContent: "center", mt: 0.5 }}>
      {local > 0 && (
        <Typography
          variant="caption"
          aria-label={`${local} local ${local === 1 ? "combo" : "combos"}`}
          title={`${local} local ${local === 1 ? "combo" : "combos"}`}
          sx={{ color: "info.main", fontWeight: 700, lineHeight: 1 }}
        >
          ({local})
        </Typography>
      )}
      {candidates > 0 && (
        <Typography
          variant="caption"
          aria-label={`${candidates} ${candidates === 1 ? "candidate" : "candidates"}`}
          title={`${candidates} ${candidates === 1 ? "candidate" : "candidates"}`}
          sx={{ color: "secondary.main", fontWeight: 700, lineHeight: 1 }}
        >
          ({candidates})
        </Typography>
      )}
    </Stack>
  );
}

function ComboPipIcons({ pips }: { pips: number }) {
  const [available, setAvailable] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = () => {
      setAvailable(true);
      setVersion((current) => current + 1);
    };
    window.addEventListener("labatar-artwork-imported", refresh);
    return () => window.removeEventListener("labatar-artwork-imported", refresh);
  }, []);

  const count = Number.isFinite(pips) ? Math.min(7, Math.max(0, Math.trunc(pips))) : 0;
  if (count === 0) return null;
  if (!available) return <Typography variant="caption">{pips} pips</Typography>;

  return (
    <Box
      role="img"
      aria-label={`${pips} ${pips === 1 ? "pip" : "pips"}`}
      title={`${pips} ${pips === 1 ? "pip" : "pips"}`}
      sx={{ display: "flex", flexShrink: 0, alignItems: "center", gap: 0.25 }}
    >
      {Array.from({ length: count }, (_, index) => 8 - count + index).map((dot) => (
        <Box
          key={dot}
          component="img"
          src={`labatar-media://artwork/${dot === 1 ? "pips" : `chakradot_${dot}`}.png?v=${version}`}
          alt=""
          onError={() => setAvailable(false)}
          sx={{ width: 16, height: 16, objectFit: "contain", display: "block" }}
        />
      ))}
    </Box>
  );
}

function ComboFlowMeter({ flow }: { flow: number }) {
  const [available, setAvailable] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = () => {
      setAvailable(true);
      setVersion((current) => current + 1);
    };
    window.addEventListener("labatar-artwork-imported", refresh);
    return () => window.removeEventListener("labatar-artwork-imported", refresh);
  }, []);

  if (!available) return <Chip size="small" label={`${flow} flow`} variant="outlined" />;
  const amount = Number.isFinite(flow) ? Math.max(0, flow) : 0;
  const fill = Math.min(amount / 500, 1);

  return (
    <Box
      role="meter"
      aria-label="Flow cost"
      aria-valuemin={0}
      aria-valuemax={500}
      aria-valuenow={Math.min(amount, 500)}
      aria-valuetext={`${flow} flow`}
      title={`${flow} flow`}
      sx={{ width: 120, height: 18, position: "relative", flexShrink: 0 }}
    >
      <Box
        component="img"
        src={`labatar-media://artwork/chi_frame_bg.png?v=${version}`}
        alt=""
        onError={() => setAvailable(false)}
        sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <Box
        sx={{
          position: "absolute",
          left: "2.5%",
          top: "27%",
          width: `${fill * 95}%`,
          height: "48%",
          bgcolor: "#38d4e7",
          backgroundImage: "linear-gradient(110deg, #22c6db, #8beaf2)",
          clipPath: "polygon(0 0, 98% 0, 100% 100%, 2% 100%)",
        }}
      />
      <Box
        component="img"
        src={`labatar-media://artwork/chi_frame.png?v=${version}`}
        alt=""
        onError={() => setAvailable(false)}
        sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <Typography
        component="span"
        aria-hidden="true"
        sx={{
          position: "absolute",
          right: 7,
          top: -1,
          color: "#fff",
          fontSize: 13,
          fontWeight: 900,
          fontVariantNumeric: "tabular-nums",
          lineHeight: "18px",
          WebkitTextStroke: "0.5px #1c2a30",
          textShadow: "1px 1px 0 #1c2a30, -1px -1px 0 #1c2a30",
        }}
      >
        {flow}
      </Typography>
    </Box>
  );
}

function PortraitPicker({
  open,
  kind,
  options,
  character,
  localCount,
  candidateCount,
  onClose,
  onChoose,
}: {
  open: boolean;
  kind: "character" | "support";
  options: string[];
  character: string;
  localCount: (id: string) => number;
  candidateCount?: (id: string) => number;
  onClose: () => void;
  onChoose: (id: string) => void;
}) {
  const [images, setImages] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (!open || !window.electronAPI?.replays?.resolvePortraits) return;
    let cancelled = false;
    const pairs = options.map((id) => ({
      character: kind === "character" ? displayName(id) : displayName(character),
      support:
        kind === "support"
          ? displayName(id)
          : (Object.values(supportMap[displayName(id) as keyof typeof supportMap] ?? {})[0] ?? ""),
    }));
    void window.electronAPI.replays
      .resolvePortraits({ pairs })
      .then((results) => {
        if (cancelled) return;
        setImages(
          Object.fromEntries(
            options.map((id, index) => [
              id,
              kind === "character"
                ? (results[index]?.portraitUrl ?? null)
                : (results[index]?.supportUrl ?? null),
            ]),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setImages({});
      });
    return () => {
      cancelled = true;
    };
  }, [open, kind, options.join("|"), character]);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ color: "text.primary" }}>Choose {kind}</DialogTitle>
      <DialogContent dividers>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(125px, 1fr))",
            gap: 1,
          }}
        >
          {options.map((id) => (
            <Button
              key={id}
              variant="outlined"
              onClick={() => onChoose(id)}
              sx={{
                minHeight: 105,
                display: "flex",
                flexDirection: "column",
                gap: 0.5,
                textTransform: "none",
              }}
            >
              {images[id] ? (
                <Box
                  component="img"
                  src={images[id] ?? ""}
                  alt=""
                  sx={{ width: 55, height: 62, objectFit: "contain" }}
                />
              ) : (
                <Box
                  sx={{
                    width: 55,
                    height: 62,
                    borderRadius: 1,
                    bgcolor: "action.hover",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {displayName(id).slice(0, 2).toUpperCase()}
                </Box>
              )}
              <Typography variant="caption" sx={{ textAlign: "center", lineHeight: 1.2 }}>
                {displayName(id)}
              </Typography>
              <ComboSourceCounts local={localCount(id)} candidates={candidateCount?.(id) ?? 0} />
            </Button>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

const blankLocal = (characterId: string, supportId: string): LocalCombo => ({
  id: "",
  characterId,
  supportId,
  starter: "",
  name: "",
  route: "",
  screenPosition: "corner",
  damage: "",
  pips: 0,
  flow: 0,
  difficulty: null,
  hitconfirm: "unknown",
  counterhit: false,
  youtubeUrl: "",
});

function LocalComboDialog({
  draft,
  personal,
  onClose,
  onSave,
}: {
  draft: LocalCombo | null;
  personal: PersonalComboEntry;
  onClose: () => void;
  onSave: (combo: LocalCombo, personal: PersonalComboEntry) => void;
}) {
  const [form, setForm] = useState<LocalCombo | null>(null);
  const [personalForm, setPersonalForm] = useState<PersonalComboEntry>(personal);
  const [formError, setFormError] = useState("");
  useEffect(() => {
    setForm(
      draft ? { ...draft, screenPosition: comboScreenPositionOrEmpty(draft.screenPosition) } : null,
    );
    setPersonalForm({ ...personal, difficulty: personal.difficulty ?? draft?.difficulty ?? null });
    setFormError("");
  }, [draft]);
  if (!draft || !form) return <Dialog open={false} onClose={onClose} />;
  const update = <K extends keyof LocalCombo>(key: K, value: LocalCombo[K]) =>
    setForm((old) => (old ? { ...old, [key]: value } : old));
  const save = (event: FormEvent) => {
    event.preventDefault();
    const starter = comboStarterFromRoute(
      form.route,
      form.publishedBase?.starterIsNonAttackStance ?? false,
    );
    if (!form.characterId.trim() || !form.supportId.trim() || !starter || !form.route.trim())
      return;
    if (!slugComboText(form.characterId) || !slugComboText(form.supportId)) {
      setFormError("Choose valid character and support IDs.");
      return;
    }
    if (!isComboScreenPosition(form.screenPosition)) {
      setFormError("Choose a screen position.");
      return;
    }
    if (form.route.length > 2000 || form.name.length > 160 || form.screenPosition.length > 100) {
      setFormError("The combo name, route, or position is too long.");
      return;
    }
    if (
      (form.editorName?.length ?? 0) > 160 ||
      (form.editorPickReason?.length ?? 0) > 1000 ||
      (form.editorPickContext?.length ?? 0) > 160 ||
      (form.editorNotes?.length ?? 0) > 20
    ) {
      setFormError("An editor field is too long, or the draft has more than 20 editor notes.");
      return;
    }
    onSave(
      {
        ...form,
        difficulty: null,
        characterId: slugComboText(form.characterId),
        supportId: slugComboText(form.supportId),
        name: form.originCatalog ? form.editorName?.trim() || "" : form.name.trim(),
        starter,
        route: form.route.trim(),
      },
      form.id ? personal : personalForm,
    );
  };
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <Box component="form" onSubmit={save}>
        <DialogTitle sx={{ color: "text.primary" }}>
          {form.originCatalog
            ? "Edit catalog combo locally"
            : form.publishedId
              ? "Edit published local combo"
              : form.id
                ? "Edit my combo"
                : "Add my combo"}
        </DialogTitle>
        <DialogContent dividers>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
              gap: 2,
              pt: 1,
            }}
          >
            <TextField
              label="Character ID"
              required
              disabled
              value={form.characterId}
              helperText="Current character selection"
            />
            <TextField
              label="Support ID"
              required
              disabled
              value={form.supportId}
              helperText="Current support selection"
            />
            {form.originCatalog ? (
              <TextField
                label="Editor name (public)"
                value={form.editorName ?? ""}
                onChange={(e) => update("editorName", e.target.value)}
              />
            ) : form.id ? (
              <TextField
                label="My combo name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
              />
            ) : null}
            <TextField
              label="Route"
              required
              value={form.route}
              onChange={(e) => update("route", e.target.value)}
              helperText={`Starter: ${comboStarterFromRoute(form.route, form.publishedBase?.starterIsNonAttackStance ?? false) || "Enter a route"}`}
              sx={{ gridColumn: { sm: "span 2" } }}
            />
            <SelectField
              label="Screen position"
              value={form.screenPosition}
              width={0}
              options={comboScreenPositions
                .map((position): [string, string] => [
                  position,
                  position[0].toUpperCase() + position.slice(1),
                ])
                .concat([["", "Choose a position"]])}
              onChange={(value) => update("screenPosition", value)}
            />
            <TextField
              label="Damage"
              value={form.damage}
              onChange={(e) => update("damage", e.target.value)}
            />
            <TextField
              label="Pips"
              type="number"
              value={form.pips}
              onChange={(e) => update("pips", Math.max(0, Number(e.target.value) || 0))}
              slotProps={{ htmlInput: { min: 0 } }}
            />
            <TextField
              label="Flow"
              type="number"
              value={form.flow}
              onChange={(e) => update("flow", Math.max(0, Number(e.target.value) || 0))}
              slotProps={{ htmlInput: { min: 0 } }}
            />
            {Boolean(form.id || form.originCatalog) && (
              <SelectField
                label="Hitconfirm"
                value={form.hitconfirm}
                width={0}
                options={[
                  ["unknown", "Unknown"],
                  ["yes", "Yes"],
                  ["no", "No"],
                ]}
                onChange={(v) => update("hitconfirm", v as ConfirmFact)}
              />
            )}
            {Boolean(form.id || form.originCatalog) && (
              <FormControlLabel
                control={
                  <Switch
                    checked={form.counterhit}
                    onChange={(e) => update("counterhit", e.target.checked)}
                  />
                }
                label="Requires counterhit"
              />
            )}
            {Boolean(form.id || form.originCatalog) && (
              <TextField
                label="YouTube URL (for editor submission)"
                value={form.youtubeUrl}
                onChange={(e) => update("youtubeUrl", e.target.value)}
                sx={{ gridColumn: { sm: "span 2" } }}
              />
            )}
            {form.publishedId && (
              <>
                <Divider sx={{ gridColumn: "1 / -1" }} />
                <Typography variant="subtitle2" sx={{ gridColumn: "1 / -1" }}>
                  Public fields for this revision
                </Typography>
                {!form.originCatalog && (
                  <TextField
                    label="Editor name (public)"
                    value={form.editorName ?? ""}
                    onChange={(e) => update("editorName", e.target.value)}
                  />
                )}
                <SelectField
                  label="Editor difficulty"
                  value={String(form.editorDifficulty ?? "")}
                  width={0}
                  options={[
                    ["", "Unrated"],
                    ...[1, 2, 3, 4, 5].map((n): [string, string] => [String(n), String(n)]),
                  ]}
                  onChange={(value) => update("editorDifficulty", value ? Number(value) : null)}
                />
                <TextField
                  label="Editor pick context"
                  value={form.editorPickContext ?? ""}
                  onChange={(e) => update("editorPickContext", e.target.value)}
                />
                <TextField
                  label="Why the editor picked it"
                  value={form.editorPickReason ?? ""}
                  onChange={(e) => update("editorPickReason", e.target.value)}
                  multiline
                  minRows={2}
                />
                <SelectField
                  label="Routing mode"
                  value={form.routingMode ?? "autopilot"}
                  width={0}
                  options={[
                    ["autopilot", "Autopilot"],
                    ["unique", "Unique routing"],
                  ]}
                  onChange={(value) => update("routingMode", value as "autopilot" | "unique")}
                />
                <Box sx={{ gridColumn: "1 / -1" }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Editor notes
                  </Typography>
                  <Stack spacing={1}>
                    {(form.editorNotes ?? []).map((note, index) => (
                      <Paper key={note.id} variant="outlined" sx={{ p: 1 }}>
                        <Stack spacing={1}>
                          <TextField
                            size="small"
                            label={`Note ${index + 1}`}
                            value={note.text}
                            onChange={(event) =>
                              update(
                                "editorNotes",
                                (form.editorNotes ?? []).map((current, position) =>
                                  position === index
                                    ? { ...current, text: event.target.value }
                                    : current,
                                ),
                              )
                            }
                            multiline
                            minRows={2}
                          />
                          <SelectField
                            label="Category"
                            value={note.category}
                            options={[
                              ["general", "General"],
                              ["execution", "Execution"],
                              ["situational", "Situational"],
                            ]}
                            onChange={(value) =>
                              update(
                                "editorNotes",
                                (form.editorNotes ?? []).map((current, position) =>
                                  position === index
                                    ? {
                                        ...current,
                                        category: value as "general" | "execution" | "situational",
                                      }
                                    : current,
                                ),
                              )
                            }
                          />
                          {note.range && (
                            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                              <Typography
                                variant="caption"
                                color={
                                  comboNoteRangeOffsets(form.route, note.range)
                                    ? "text.secondary"
                                    : "error"
                                }
                              >
                                Attached to “{note.range.excerpt}”
                                {!comboNoteRangeOffsets(form.route, note.range) &&
                                  " · no longer matches the route"}
                              </Typography>
                              <Button
                                type="button"
                                size="small"
                                onClick={() =>
                                  update(
                                    "editorNotes",
                                    (form.editorNotes ?? []).map((current, position) => {
                                      if (position !== index) return current;
                                      const { range: _range, ...withoutRange } = current;
                                      return withoutRange;
                                    }),
                                  )
                                }
                              >
                                Clear segment
                              </Button>
                            </Stack>
                          )}
                          <Button
                            type="button"
                            size="small"
                            color="error"
                            onClick={() =>
                              update(
                                "editorNotes",
                                (form.editorNotes ?? []).filter(
                                  (_, position) => position !== index,
                                ),
                              )
                            }
                          >
                            Remove note
                          </Button>
                        </Stack>
                      </Paper>
                    ))}
                    <Button
                      type="button"
                      size="small"
                      onClick={() =>
                        update("editorNotes", [
                          ...(form.editorNotes ?? []),
                          {
                            id: `local-note-${crypto.randomUUID()}`,
                            text: "",
                            category: "general",
                          },
                        ])
                      }
                    >
                      Add editor note
                    </Button>
                  </Stack>
                </Box>
              </>
            )}
          </Box>
          {formError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {formError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">
            {form.publishedId ? "Save local revision" : "Save local combo"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

type PublishForm = {
  backendId: string;
  name: string;
  difficulty: string;
  editorPickReason: string;
  editorPickContext: string;
  youtubeUrl: string;
  moveIds: string;
  note: string;
  routingMode: "autopilot" | "unique";
};
export function initialPublisherForm(
  item: ComboItem,
  linkedYouTubeUrl = "",
  legacyCombo?: TechCombo | null,
): PublishForm {
  if (!item.local) throw new Error("Only local combos can be submitted.");
  const local = item.local;
  const base = local.publishedBase;
  const legacy =
    legacyCombo &&
    legacyCombo.route.trim() === item.route.trim() &&
    legacyCombo.damage.trim() === item.damage.trim() &&
    slugComboText(legacyCombo.character) === item.characterId &&
    slugComboText(legacyCombo.support) === item.supportId
      ? legacyCombo
      : null;
  const name = local.editorName ?? base?.name ?? legacy?.name ?? "";
  return {
    backendId:
      local.publishedId ??
      slugComboText(
        `${item.characterId}-${item.supportId}-${name || local.name || item.route}-${item.screenPosition}-${item.damage}`,
      )
        .slice(0, 100)
        .replace(/-+$/, ""),
    name,
    difficulty: String(local.editorDifficulty ?? base?.difficulty ?? legacy?.difficulty ?? ""),
    editorPickReason:
      local.editorPickReason ?? base?.editorPickReason ?? legacy?.editorPickReason ?? "",
    editorPickContext:
      local.editorPickContext ?? base?.editorPickContext ?? legacy?.editorPickContext ?? "",
    youtubeUrl: comboYouTubeVideo(item, linkedYouTubeUrl)?.url ?? "",
    moveIds: (
      local.moveIds ??
      base?.moveIds ??
      legacy?.moveIds.filter((moveId): moveId is string => Boolean(moveId?.trim())) ??
      []
    ).join("\n"),
    note: "",
    routingMode: local.routingMode ?? base?.routingMode ?? legacy?.routingMode ?? "autopilot",
  };
}
export function publisherDraft(
  item: ComboItem,
  form: PublishForm,
  candidateSubmissionId = "",
): PublishComboDraft {
  if (!item.local) throw new Error("Only local combos can be submitted.");
  const base = item.local.publishedBase;
  const baseNotes = item.local.editorNotes ?? normalizeComboNotes(base?.notes);
  let noteId = baseNotes.length + 1;
  while (baseNotes.some((note) => note.id === `editor-note-${noteId}`)) noteId += 1;
  const notes = form.note.trim()
    ? [
        ...baseNotes,
        { id: `editor-note-${noteId}`, category: "general" as const, text: form.note.trim() },
      ]
    : baseNotes;
  const mechanics = (base?.mechanics ?? []).filter(
    (value) =>
      !/^(?:requires\s+)?counterhit$/i.test(value.trim()) &&
      !/initial conversion hitconfirmable/i.test(value),
  );
  return {
    schemaVersion: 1,
    source: "labatar-combos-page",
    warnings: ["Review all public fields before publishing."],
    expectedRevision: item.local.publishedId ? item.local.publishedRevision : 0,
    combo: {
      id: form.backendId,
      ...((item.local.candidateOriginId ?? base?.sourceCandidateId ?? candidateSubmissionId)
        ? {
            sourceCandidateId:
              item.local.candidateOriginId ?? base?.sourceCandidateId ?? candidateSubmissionId,
          }
        : {}),
      characterId: item.characterId,
      supportId: item.supportId,
      ...(form.name.trim() ? { name: form.name.trim() } : {}),
      ...(form.difficulty ? { difficulty: Number(form.difficulty) } : {}),
      ...(form.editorPickReason.trim() ? { editorPickReason: form.editorPickReason.trim() } : {}),
      ...(form.editorPickContext.trim()
        ? { editorPickContext: form.editorPickContext.trim() }
        : {}),
      route: item.route,
      ...(base?.starterIsNonAttackStance ? { starterIsNonAttackStance: true } : {}),
      ...(form.routingMode === "unique" ? { routingMode: "unique" } : {}),
      moveIds: form.moveIds
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
      screenPosition: item.screenPosition,
      damage: item.damage,
      ...(notes.length ? { notes } : {}),
      resourceCosts: { ...base?.resourceCosts, pips: item.pips, flow: item.flow },
      mechanics: [
        ...mechanics,
        ...(item.counterhit === "yes" ? ["Requires counterhit"] : []),
        ...(item.hitconfirm === "yes" ? ["Initial conversion hitconfirmable"] : []),
      ],
      youtubeUrl: form.youtubeUrl.trim(),
      startSeconds: base?.startSeconds ?? 0,
    },
  };
}

function PublishDialog({
  item,
  candidateSubmissionId,
  linkedRecording,
  linkedYouTubeUrl,
  onClose,
  onPublished,
  onYouTubeUploaded,
  onVideoLinked,
}: {
  item: ComboItem | null;
  candidateSubmissionId: string;
  linkedRecording: RecordedVideo | null;
  linkedYouTubeUrl: string;
  onClose: () => void;
  onPublished: (id: string, revision: number, draft: PublishComboDraft) => void;
  onYouTubeUploaded: (url: string) => void;
  onVideoLinked: () => Promise<void>;
}) {
  const [form, setForm] = useState<PublishForm | null>(null);
  const [review, setReview] = useState<PublishComboDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [youtubeChecking, setYoutubeChecking] = useState(false);
  const [youtubeTitle, setYoutubeTitle] = useState("");
  const [youtubeDescription, setYoutubeDescription] = useState("");
  const [madeForKids, setMadeForKids] = useState(false);
  useEffect(() => {
    setReview(null);
    setError("");
    setUploadError("");
    setUploadNotice("");
    setYoutubeTitle(item ? candidateRecordingTitle(item) : "");
    setYoutubeDescription(item ? `${item.characterId} / ${item.supportId}\n${item.route}` : "");
    setMadeForKids(false);
    const legacy = item?.local?.legacyTechComboId
      ? readLegacyCombos().find((row) => row.key === item.local?.legacyTechComboId)?.combo
      : null;
    setForm(item?.local ? initialPublisherForm(item, linkedYouTubeUrl, legacy) : null);
  }, [item?.id]);
  useEffect(() => {
    const fallback = item?.candidate?.youtubeUrl || linkedYouTubeUrl;
    if (fallback)
      setForm((old) => (old && !old.youtubeUrl ? { ...old, youtubeUrl: fallback } : old));
  }, [item?.candidate?.youtubeUrl, linkedYouTubeUrl]);
  useEffect(() => {
    setYoutubeConnected(false);
    if (!item || !linkedRecording) {
      setYoutubeChecking(false);
      return;
    }
    let cancelled = false;
    setYoutubeChecking(true);
    void window.electronAPI?.recordings
      .getYouTubeUploadStatus({ destination: "combos" })
      .then((status) => {
        if (!cancelled) setYoutubeConnected(status.connected);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setYoutubeChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item?.id, linkedRecording?.id]);
  const update = (key: keyof PublishForm, value: string) => {
    setForm((old) => (old ? ({ ...old, [key]: value } as PublishForm) : old));
    setReview(null);
  };
  const connectYouTube = async () => {
    setBusy(true);
    setUploadError("");
    try {
      const status = await window.electronAPI!.recordings.connectYouTube({ destination: "combos" });
      setYoutubeConnected(status.connected);
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "Could not connect YouTube.");
    } finally {
      setBusy(false);
    }
  };
  const uploadLinkedMp4 = async () => {
    if (!item || !linkedRecording) return;
    setBusy(true);
    setUploadError("");
    setUploadNotice("");
    try {
      const result = await window.electronAPI!.recordings.uploadToYouTube({
        destination: "combos",
        recordingId: linkedRecording.id,
        title: youtubeTitle.trim() || candidateRecordingTitle(item),
        description: youtubeDescription.trim(),
        tags: [],
        privacyStatus: "unlisted",
        madeForKids,
      });
      update("youtubeUrl", result.url);
      onYouTubeUploaded(result.url);
      setUploadNotice("MP4 uploaded to YouTube. Review the URL below before publishing.");
      try {
        savePendingYouTubeUpload({
          recordingId: linkedRecording.id,
          fileName: linkedRecording.name,
          url: result.url,
        });
      } catch {
        // The recording metadata still stores the link when browser storage is unavailable.
      }
      try {
        await window.electronAPI!.recordings.setYouTubeLink({
          recordingId: linkedRecording.id,
          url: result.url,
          keepLocalVideo: true,
        });
        await onVideoLinked();
      } catch (reason) {
        setUploadError(
          `YouTube upload succeeded, but saving the link to the recording failed. The URL is ${result.url}. ${reason instanceof Error ? reason.message : ""}`,
        );
      }
    } catch (reason) {
      setUploadError(
        reason instanceof Error ? reason.message : "Could not upload the MP4 to YouTube.",
      );
    } finally {
      setBusy(false);
    }
  };
  const prepare = () => {
    if (!item || !form) return;
    if (
      item.local?.publishedId &&
      (!Number.isSafeInteger(item.local.publishedRevision) ||
        Number(item.local.publishedRevision) < 1)
    )
      return setError("This local revision has no valid base revision. Refresh the catalog first.");
    if (item.local?.publishedId && form.backendId !== item.local.publishedId)
      return setError("A catalog revision must keep its original backend ID.");
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(form.backendId))
      return setError("Use a lowercase backend ID with letters, numbers, and hyphens.");
    if (form.name.trim().length > 160)
      return setError("Editor name must be at most 160 characters.");
    if (form.editorPickReason.trim().length > 1000 || form.editorPickContext.trim().length > 160)
      return setError("Editor pick text is too long.");
    if (
      !item.route.trim() ||
      item.route.length > 2000 ||
      !item.damage.trim() ||
      item.damage.length > 100 ||
      !isComboScreenPosition(item.screenPosition)
    )
      return setError("Complete the route and damage, and choose a valid screen position.");
    if (form.note.trim().length > 1000)
      return setError("Editor note must be at most 1000 characters.");
    const notes = item.local?.editorNotes ?? normalizeComboNotes(item.local?.publishedBase?.notes);
    if (
      notes.length > 20 ||
      notes.some(
        (note) =>
          !note.text.trim() ||
          note.text.length > 1000 ||
          (note.range && !comboNoteRangeOffsets(item.route, note.range)),
      )
    )
      return setError(
        "Review editor notes before publishing. A note may be empty, too long, or attached to a route segment that changed.",
      );
    if (form.note.trim() && notes.length >= 20)
      return setError("A combo can have at most 20 editor notes.");
    try {
      const url = new URL(form.youtubeUrl);
      const videoId =
        url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
      if (
        url.protocol !== "https:" ||
        !["youtu.be", "www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname) ||
        !/^[\w-]{11}$/.test(videoId ?? "")
      )
        throw new Error("Add a valid HTTPS YouTube video URL.");
    } catch {
      return setError("Add a valid HTTPS YouTube video URL.");
    }
    const moveIds = form.moveIds
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (moveIds.length > 100 || moveIds.some((id) => !/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)))
      return setError(
        "This combo contains invalid catalog references and cannot be published from this page.",
      );
    setError("");
    setReview(publisherDraft(item, form, candidateSubmissionId));
  };
  const publish = async () => {
    if (!review) return;
    const publisher = window.electronAPI?.catalogPublisher;
    if (!publisher) return setError("Publishing requires the desktop app.");
    setBusy(true);
    setError("");
    try {
      const result = await publisher.publishCombo(review);
      if (!result.cancelled) onPublished(result.id, result.revision, review);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
          : "Could not publish the combo.",
      );
    } finally {
      setBusy(false);
    }
  };
  const existingNotes = normalizeComboNotes(
    item?.local?.editorNotes ?? item?.local?.publishedBase?.notes,
  );
  return (
    <Dialog open={Boolean(item)} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ color: "text.primary" }}>
        {item?.local?.needsCatalogPublication
          ? "Publish candidate"
          : item?.local?.publishedId
            ? "Publish local revision"
            : "Submit local combo to catalog"}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Only server-authorized editors can publish. Your personal status, tags, ratings, and
            notes are excluded.
          </Typography>
          <TextField
            label="Backend combo ID"
            value={form?.backendId ?? ""}
            onChange={(e) => update("backendId", e.target.value)}
            disabled={Boolean(item?.local?.publishedId)}
          />
          <TextField
            label="Editor name (public, optional)"
            value={form?.name ?? ""}
            onChange={(e) => update("name", e.target.value)}
          />
          <SelectField
            label="Editor difficulty"
            value={form?.difficulty ?? ""}
            options={[
              ["", "Unrated"],
              ...[1, 2, 3, 4, 5].map((n): [string, string] => [String(n), String(n)]),
            ]}
            onChange={(v) => update("difficulty", v)}
          />
          <TextField
            label="Editor pick context (public, optional)"
            value={form?.editorPickContext ?? ""}
            onChange={(e) => update("editorPickContext", e.target.value)}
          />
          <TextField
            label="Why the editor picked it (public, optional)"
            multiline
            minRows={2}
            value={form?.editorPickReason ?? ""}
            onChange={(e) => update("editorPickReason", e.target.value)}
          />
          <TextField
            label="YouTube URL (required)"
            value={form?.youtubeUrl ?? ""}
            onChange={(e) => update("youtubeUrl", e.target.value)}
            helperText={
              !form?.youtubeUrl && item?.candidate
                ? "Upload this candidate to YouTube first, or paste its YouTube URL."
                : undefined
            }
          />
          {linkedRecording && (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Upload linked MP4 to YouTube</Typography>
                <Typography variant="body2" color="text.secondary">
                  {linkedRecording.name}. Uploads as unlisted and fills the YouTube URL above.
                </Typography>
                <TextField
                  size="small"
                  label="Video title"
                  value={youtubeTitle}
                  onChange={(event) => setYoutubeTitle(event.target.value)}
                  disabled={busy}
                />
                <TextField
                  size="small"
                  label="Description"
                  multiline
                  minRows={2}
                  value={youtubeDescription}
                  onChange={(event) => setYoutubeDescription(event.target.value)}
                  disabled={busy}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={madeForKids}
                      onChange={(event) => setMadeForKids(event.target.checked)}
                      disabled={busy}
                    />
                  }
                  label="Made for kids"
                />
                <Button
                  variant="outlined"
                  onClick={() => void (youtubeConnected ? uploadLinkedMp4() : connectYouTube())}
                  disabled={busy || youtubeChecking}
                  sx={{ alignSelf: "flex-start" }}
                >
                  {busy
                    ? "Working…"
                    : youtubeChecking
                      ? "Checking YouTube account…"
                      : youtubeConnected
                        ? "Upload linked MP4 as unlisted"
                        : "Connect combos YouTube account"}
                </Button>
                {uploadNotice && <Alert severity="success">{uploadNotice}</Alert>}
                {uploadError && <Alert severity="error">{uploadError}</Alert>}
              </Stack>
            </Paper>
          )}
          <SelectField
            label="Routing mode"
            value={form?.routingMode ?? "autopilot"}
            options={[
              ["autopilot", "Autopilot"],
              ["unique", "Unique routing"],
            ]}
            onChange={(v) => update("routingMode", v)}
          />
          <TextField
            label="Additional editor note (public, optional)"
            multiline
            minRows={2}
            value={form?.note ?? ""}
            onChange={(e) => update("note", e.target.value)}
          />
          {existingNotes.length > 0 && (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2">Existing editor notes in this payload</Typography>
              {existingNotes.map((note) => (
                <Typography key={note.id} variant="body2" sx={{ overflowWrap: "anywhere" }}>
                  {note.text}
                </Typography>
              ))}
            </Paper>
          )}
          <Button variant="outlined" onClick={prepare}>
            Review combo details
          </Button>
          {error && <Alert severity="error">{error}</Alert>}
          {review && (
            <Paper variant="outlined" sx={{ p: 2, maxHeight: 300, overflow: "auto" }}>
              <Box
                component="pre"
                sx={{ m: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}
              >
                {JSON.stringify({ ...review.combo, moveIds: undefined }, null, 2)}
              </Box>
            </Paper>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void publish()} disabled={!review || busy}>
          {busy
            ? "Publishing…"
            : item?.local?.needsCatalogPublication
              ? "Publish candidate"
              : "Publish reviewed combo"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function CombosPage({ active }: { active: boolean }) {
  const { state: obsState, settings: obsSettings, busy: obsBusy, moveCapture } = useObsRecording();
  const [catalog, setCatalog] = useState<PublishedCatalog | null>(null);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const [refreshing, setRefreshing] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [workspace, setWorkspace] = useState<ComboWorkspaceData>(readComboWorkspace);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [storageError, setStorageError] = useState("");
  const [tab, setTab] = useState<"gameplan" | "raw">("gameplan");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picker, setPicker] = useState<"character" | "support" | null>(null);
  const [localDraft, setLocalDraft] = useState<LocalCombo | null>(null);
  const [publishId, setPublishId] = useState<string | null>(null);
  const [upstreamCandidates, setUpstreamCandidates] = useState<ComboCandidate[]>([]);
  const [candidatesLoaded, setCandidatesLoaded] = useState(false);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidateAvailable, setCandidateAvailable] = useState(false);
  const [candidateSubmitting, setCandidateSubmitting] = useState(false);
  const [candidateProgress, setCandidateProgress] = useState<number | null>(null);
  const [candidateError, setCandidateError] = useState("");
  const candidateRefreshIdRef = useRef(0);
  const candidateCleanupInFlight = useRef(new Set<string>());
  const [candidateCleanupTick, setCandidateCleanupTick] = useState(0);
  const [statusFilter, setStatusFilter] = useState("gameplan");
  const [candidateOnly, setCandidateOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState("all");
  const [raw, setRaw] = useState(emptyRaw);
  const appliedRawFilters = activeRawFilters(raw);
  const [sort, setSort] = useState<{ column: RawColumn; descending: boolean }>({
    column: "name",
    descending: false,
  });
  const [columns, setColumns] = useState<Set<RawColumn>>(
    () => new Set(rawColumns.map(([id]) => id)),
  );
  const [showColumns, setShowColumns] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [replaceId, setReplaceId] = useState("");
  const [undo, setUndo] = useState<{
    oldId: string;
    nextId: string;
    old?: PersonalComboEntry;
    next?: PersonalComboEntry;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [recordings, setRecordings] = useState<RecordedVideo[]>([]);
  const [recordingsLoaded, setRecordingsLoaded] = useState(false);
  const [recordingsError, setRecordingsError] = useState("");
  const [pendingYouTubeVersion, setPendingYouTubeVersion] = useState(0);
  const [pendingComboRecording, setPendingComboRecording] = useState(readPendingPageComboRecording);
  const pendingComboRecordingRef = useRef(pendingComboRecording);
  const itemByIdRef = useRef(new Map<string, ComboItem>());
  const [comboRecordingBusy, setComboRecordingBusy] = useState(false);
  const [comboRecordingStatus, setComboRecordingStatus] = useState<{
    severity: "success" | "error";
    message: string;
  } | null>(null);
  const [recordingPickerId, setRecordingPickerId] = useState<string | null>(null);
  const [recordingSearch, setRecordingSearch] = useState("");
  const [importingMp4, setImportingMp4] = useState(false);
  const [legacyImportOpen, setLegacyImportOpen] = useState(false);
  const [legacyCombos, setLegacyCombos] = useState<LegacyComboRow[]>([]);
  const [legacySelection, setLegacySelection] = useState("");
  const [legacyTargetId, setLegacyTargetId] = useState("");
  const refreshCandidates = useCallback(async (interactive = false) => {
    const api = window.electronAPI?.comboCandidates;
    if (!api) return;
    const refreshId = ++candidateRefreshIdRef.current;
    setCandidatesLoading(true);
    setCandidateError("");
    try {
      const next = await api.list({ interactive });
      if (refreshId !== candidateRefreshIdRef.current) return;
      const publishedCombos = catalogRef.current?.combos ?? [];
      setUpstreamCandidates(
        next.filter(
          (candidate) =>
            !publishedCombos.some((combo) => candidateMatchesPublishedCombo(candidate, combo)),
        ),
      );
      setCandidatesLoaded(true);
    } catch (reason) {
      if (refreshId !== candidateRefreshIdRef.current) return;
      if (
        !interactive &&
        reason instanceof Error &&
        reason.message.includes("Candidate sign-in required")
      ) {
        setUpstreamCandidates([]);
        setCandidatesLoaded(false);
        return;
      }
      setCandidateError(
        reason instanceof Error ? reason.message : "Could not load upstream candidates.",
      );
    } finally {
      if (refreshId === candidateRefreshIdRef.current) setCandidatesLoading(false);
    }
  }, []);
  const enableCandidates = () => {
    if (!window.electronAPI?.comboCandidates) return;
    try {
      localStorage.setItem(loadUpstreamCandidatesKey, "1");
    } catch {
      // Optional preference.
    }
    void refreshCandidates(true);
  };
  const updateCandidate = (candidate: ComboCandidate) =>
    setUpstreamCandidates((old) =>
      old.map((item) => (item.id === candidate.id ? candidate : item)),
    );
  useEffect(() => {
    if (!active || !window.electronAPI?.comboCandidates) return;
    try {
      if (localStorage.getItem(loadUpstreamCandidatesKey) === "1") void refreshCandidates();
    } catch {
      // The button still allows a one-time load when local storage is unavailable.
    }
  }, [active, refreshCandidates]);
  useEffect(() => {
    return window.electronAPI?.comboCandidates?.onUploadProgress(
      ({ uploadedBytes, totalBytes }) => {
        setCandidateProgress(Math.round((uploadedBytes / totalBytes) * 100));
      },
    );
  }, []);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void window.electronAPI?.comboCandidates
      ?.status()
      .then((status) => {
        if (!cancelled) setCandidateAvailable(status.available);
      })
      .catch(() => {
        if (!cancelled) setCandidateAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setCatalogError("");
    try {
      const next = await fetchPublishedCatalog();
      setCatalog(next);
      await writePublishedCatalogCache(next).catch(() => undefined);
    } catch (reason) {
      setCatalogError(reason instanceof Error ? reason.message : "Could not load the catalog.");
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void readPublishedCatalogCache()
      .then((cached) => {
        if (!cancelled && cached) setCatalog((old) => old ?? cached);
      })
      .catch(() => undefined);
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [active, refresh]);
  const updatePendingComboRecording = useCallback((next: PendingPageComboRecording | null) => {
    pendingComboRecordingRef.current = next;
    setPendingComboRecording(next);
    try {
      if (next) localStorage.setItem(pendingPageComboRecordingKey, JSON.stringify(next));
      else localStorage.removeItem(pendingPageComboRecordingKey);
    } catch {
      // Keep the association in memory for this session.
    }
  }, []);
  const refreshRecordings = useCallback(
    async (finalized?: { sessionId: string; recordingId: string | null }) => {
      const api = window.electronAPI?.recordings;
      if (!api) return;
      try {
        const result = await api.list();
        setRecordings(result.recordings);
        setRecordingsLoaded(true);
        setRecordingsError("");
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
                "The finished recording was not found in the library. Find it again or link it manually.",
            });
          }
          return;
        }
        const combo = itemByIdRef.current.get(pending.comboId);
        if (!combo) {
          setComboRecordingStatus({
            severity: "error",
            message: "This combo is no longer on the page. Link the recording manually if needed.",
          });
          updatePendingComboRecording(null);
          return;
        }
        const nextWorkspace = {
          ...workspaceRef.current,
          recordingLinks: {
            ...workspaceRef.current.recordingLinks,
            [pending.comboId]: { recordingId: recording.id, name: recording.name },
          },
          snapshots:
            combo.source === "Catalog"
              ? { ...workspaceRef.current.snapshots, [pending.comboId]: catalogSnapshot(combo) }
              : workspaceRef.current.snapshots,
        };
        try {
          writeComboWorkspace(nextWorkspace);
        } catch {
          setStorageError(
            "Local storage is unavailable. The recording link was not saved; find the finished recording again after storage is available.",
          );
          return;
        }
        workspaceRef.current = nextWorkspace;
        setWorkspace(nextWorkspace);
        updatePendingComboRecording(null);
        setComboRecordingStatus({
          severity: "success",
          message: `Linked ${recording.name} to the combo.`,
        });
      } catch (reason) {
        setRecordingsError(reason instanceof Error ? reason.message : "Could not load recordings.");
      }
    },
    [updatePendingComboRecording],
  );
  useEffect(() => {
    if (!active || !window.electronAPI?.recordings) return;
    void refreshRecordings();
    return window.electronAPI.recordings.onChanged(() => void refreshRecordings());
  }, [active, refreshRecordings]);
  useEffect(() => {
    const changed = () => setPendingYouTubeVersion((version) => version + 1);
    window.addEventListener(pendingYouTubeUploadsChangedEvent, changed);
    return () => window.removeEventListener(pendingYouTubeUploadsChangedEvent, changed);
  }, []);
  useEffect(() => {
    if (!window.electronAPI?.recordings) return;
    return window.electronAPI.recordings.onFinalized((finalized) => {
      if (pendingComboRecordingRef.current?.sessionId === finalized.sessionId) {
        void refreshRecordings(finalized);
      }
    });
  }, [refreshRecordings]);
  useEffect(() => {
    try {
      writeComboWorkspace(workspace);
      setStorageError("");
    } catch {
      setStorageError(
        "Local storage is unavailable. Keep this page open or your changes may be lost.",
      );
    }
  }, [workspace]);

  const items = useMemo(
    () =>
      mergeCandidateItems(
        comboItems(
          catalog?.combos ?? [],
          catalog?.moves ?? [],
          workspace.localCombos,
          workspace.snapshots,
        ),
        upstreamCandidates,
        workspace.candidateSubmissions,
      ),
    [
      catalog,
      workspace.localCombos,
      workspace.snapshots,
      upstreamCandidates,
      workspace.candidateSubmissions,
    ],
  );
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  itemByIdRef.current = itemById;
  const publicationMatches = useMemo(
    () => candidatePublicationMatches(workspace, catalog?.combos ?? []),
    [workspace.candidateSubmissions, workspace.localCombos, catalog],
  );
  useEffect(() => {
    if (!catalog) return;
    setUpstreamCandidates((old) => {
      const next = old.filter(
        (candidate) =>
          !catalog.combos.some((combo) => candidateMatchesPublishedCombo(candidate, combo)),
      );
      return next.length === old.length ? old : next;
    });
  }, [catalog]);
  useEffect(() => {
    if (!catalog) return;
    const promotions = publicationMatches.filter((match) => match.readyToReplace);
    if (!promotions.length) return;
    const selectedPromotion = promotions.find(({ localId }) => localId === selectedId);
    setWorkspace((old) => {
      const next = promotions.reduce(
        (next, { localId, published }) =>
          candidatePublicationMatches(next, [published]).some(
            (match) => match.localId === localId && match.readyToReplace,
          )
            ? replaceLocalComboWithCatalog(next, localId, published)
            : next,
        old,
      );
      return selectedPromotion
        ? {
            ...next,
            characterId: selectedPromotion.published.characterId,
            supportId: selectedPromotion.published.supportId,
            starter: comboStarterFromRoute(selectedPromotion.published.route),
          }
        : next;
    });
    setSelectedId((old) => promotions.find(({ localId }) => localId === old)?.published.id ?? old);
    setMessage("Published candidate replaced its submitted local draft.");
  }, [catalog, publicationMatches, selectedId]);
  const finalizeUploadedCandidate = useCallback(
    async (candidate: ComboCandidate, recording?: RecordedVideo) => {
      const { workspace: next, targetId } = finishUploadedCandidate(
        workspace,
        candidate,
        items,
        recording ? { recordingId: recording.id, name: recording.name } : undefined,
      );
      writeComboWorkspace(next);
      setWorkspace(next);
      setSelectedId((old) => (old === `candidate:${candidate.id}` ? targetId : old));
      setUpstreamCandidates((old) =>
        old.map((item) => (item.id === candidate.id ? candidate : item)),
      );
      await window.electronAPI!.comboCandidates.removeUploaded({ id: candidate.id });
      setUpstreamCandidates((old) => old.filter((item) => item.id !== candidate.id));
      setMessage("Candidate removed. Its combo and YouTube link are saved locally.");
      return targetId;
    },
    [workspace, items],
  );
  const onCandidateChanged = async (candidate: ComboCandidate, recording?: RecordedVideo) => {
    if (candidate.status === "uploaded") {
      candidateCleanupInFlight.current.add(candidate.id);
      setUpstreamCandidates((old) =>
        old.map((item) => (item.id === candidate.id ? candidate : item)),
      );
      try {
        const targetId = await finalizeUploadedCandidate(candidate, recording);
        setSelectedId(targetId);
        setPublishId(targetId);
        setCandidateOnly(false);
        setRaw((old) => (old.source === "Candidate" ? { ...old, source: "Local" } : old));
      } catch (reason) {
        setCandidateError(
          `YouTube upload succeeded, but candidate cleanup needs a retry: ${reason instanceof Error ? reason.message : "Unknown error"}. Refresh candidates to retry.`,
        );
        throw reason;
      } finally {
        candidateCleanupInFlight.current.delete(candidate.id);
      }
    } else {
      updateCandidate(candidate);
    }
  };
  useEffect(() => {
    if (!candidatesLoaded || candidateCleanupInFlight.current.size > 0) return;
    const candidate = upstreamCandidates.find((item) => item.status === "uploaded");
    if (!candidate) return;
    candidateCleanupInFlight.current.add(candidate.id);
    let succeeded = false;
    void finalizeUploadedCandidate(candidate)
      .then(() => {
        succeeded = true;
      })
      .catch((reason) => {
        setCandidateError(
          reason instanceof Error ? reason.message : "Could not finish candidate cleanup.",
        );
      })
      .finally(() => {
        candidateCleanupInFlight.current.delete(candidate.id);
        if (succeeded) setCandidateCleanupTick((old) => old + 1);
      });
  }, [candidatesLoaded, upstreamCandidates, finalizeUploadedCandidate, candidateCleanupTick]);
  const recordingsById = useMemo(
    () => new Map(recordings.map((recording) => [recording.id, recording])),
    [recordings],
  );
  const linkedYouTubeUrlFor = (comboId: string) => {
    const recordingId = workspace.recordingLinks[comboId]?.recordingId ?? "";
    return (
      recordingsById.get(recordingId)?.youtubeUrl || pendingYouTubeUploadUrl(recordingId) || ""
    );
  };
  const mediaGaps = useMemo(
    () =>
      new Map(
        items.map((item): [string, ComboMediaGap] => {
          const link = workspace.recordingLinks[item.id];
          const recording = recordingsById.get(link?.recordingId ?? "") ?? null;
          return [
            item.id,
            comboMediaGap(
              item,
              link,
              recording,
              recordingsLoaded,
              pendingYouTubeUploadUrl(link?.recordingId ?? "") ?? "",
            ),
          ];
        }),
      ),
    [items, workspace.recordingLinks, recordingsById, recordingsLoaded, pendingYouTubeVersion],
  );
  const gapFor = (id: string): ComboMediaGap => mediaGaps.get(id) ?? null;
  const entry = useCallback(
    (id: string) => workspace.entries[id] ?? emptyPersonalEntry(),
    [workspace.entries],
  );
  const updateEntry = (id: string, patch: Partial<PersonalComboEntry>) =>
    setWorkspace((old) => ({
      ...old,
      entries: { ...old.entries, [id]: { ...(old.entries[id] ?? emptyPersonalEntry()), ...patch } },
      snapshots:
        itemById.get(id)?.source === "Catalog"
          ? { ...old.snapshots, [id]: catalogSnapshot(itemById.get(id)!) }
          : old.snapshots,
    }));
  useEffect(() => {
    if (!catalog) return;
    const missing = items.filter(
      (item) =>
        item.source === "Catalog" && workspace.entries[item.id] && !workspace.snapshots[item.id],
    );
    if (missing.length)
      setWorkspace((old) => ({
        ...old,
        snapshots: {
          ...old.snapshots,
          ...Object.fromEntries(missing.map((item) => [item.id, catalogSnapshot(item)])),
        },
      }));
  }, [catalog, items, workspace.entries, workspace.snapshots]);
  const characters = useMemo(
    () => [...new Set([...roster.map(catalogId), ...items.map((item) => item.characterId)])].sort(),
    [items],
  );
  const preferredItem = items.find((item) => entry(item.id).status === "Using") ?? items[0];
  const character = characters.includes(workspace.characterId)
    ? workspace.characterId
    : (preferredItem?.characterId ?? characters[0] ?? "");
  const supports = useMemo(() => {
    const mapped = Object.values(
      supportMap[displayName(character) as keyof typeof supportMap] ?? {},
    ).map(catalogId);
    return [
      ...new Set([
        ...mapped,
        ...items.filter((item) => item.characterId === character).map((item) => item.supportId),
      ]),
    ].sort();
  }, [character, items]);
  const support = supports.includes(workspace.supportId)
    ? workspace.supportId
    : (items.find((item) => item.characterId === character && entry(item.id).status === "Using")
        ?.supportId ??
      items.find((item) => item.characterId === character)?.supportId ??
      supports[0] ??
      "");
  const [selectedPortraits, setSelectedPortraits] = useState<{
    character: string | null;
    support: string | null;
  }>({ character: null, support: null });
  useEffect(() => {
    setSelectedPortraits({ character: null, support: null });
    if (!active || !character || !support || !window.electronAPI?.replays?.resolvePortraits) return;
    let cancelled = false;
    void window.electronAPI.replays
      .resolvePortraits({
        pairs: [{ character: displayName(character), support: displayName(support) }],
      })
      .then(([portrait]) => {
        if (!cancelled)
          setSelectedPortraits({
            character: portrait?.portraitUrl ?? null,
            support: portrait?.supportUrl ?? null,
          });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, character, support]);
  const starters = useMemo(
    () =>
      [
        ...new Set(
          items
            .filter((item) => item.characterId === character && item.supportId === support)
            .map((item) => item.starter),
        ),
      ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [items, character, support],
  );
  const starter = starters.includes(workspace.starter)
    ? workspace.starter
    : (starters.find((value) =>
        items.some(
          (item) =>
            item.characterId === character &&
            item.supportId === support &&
            item.starter === value &&
            entry(item.id).status === "Using",
        ),
      ) ??
      starters[0] ??
      "");
  const scoped = items.filter(
    (item) =>
      item.characterId === character && item.supportId === support && item.starter === starter,
  );
  const scopedForView = candidateOnly
    ? scoped.filter((item) => item.candidate && isActiveCandidate(item.candidate))
    : scoped;
  const newCombos = scopedForView
    .filter((item) => !entry(item.id).status && item.candidate?.status !== "rejected")
    .sort(
      (left, right) =>
        Number(Boolean(right.candidate)) - Number(Boolean(left.candidate)) ||
        Number(Boolean(right.published?.editorPickReason)) -
          Number(Boolean(left.published?.editorPickReason)) ||
        left.name.localeCompare(right.name),
    );
  const tracked = scopedForView.filter((item) => entry(item.id).status);
  const gameplanTags = [...new Set(tracked.flatMap((item) => entry(item.id).tags))].sort();
  const effectiveTagFilter = gameplanTags.includes(tagFilter) ? tagFilter : "all";
  const shown = tracked.filter(
    (item) =>
      (statusFilter === "gameplan"
        ? entry(item.id).status !== "Dismissed"
        : statusFilter === "all" || entry(item.id).status === statusFilter) &&
      (effectiveTagFilter === "all" || entry(item.id).tags.includes(effectiveTagFilter)),
  );
  const showNewCombos = ["gameplan", "all"].includes(statusFilter) && effectiveTagFilter === "all";
  const positionColumns = comboScreenPositions.map((position) => ({
    position,
    label: position[0].toUpperCase() + position.slice(1),
  }));
  const positionGroups = positionColumns.map(({ position, label }) => ({
    label,
    combos: shown.filter((item) => item.screenPosition.trim().toLowerCase() === position),
    newCombos: showNewCombos
      ? newCombos.filter((item) => item.screenPosition.trim().toLowerCase() === position)
      : [],
  }));
  const otherPositionCombos = shown.filter(
    (item) =>
      !positionColumns.some(
        ({ position }) => item.screenPosition.trim().toLowerCase() === position,
      ),
  );
  const otherPositionNewCombos = showNewCombos
    ? newCombos.filter(
        (item) =>
          !positionColumns.some(
            ({ position }) => item.screenPosition.trim().toLowerCase() === position,
          ),
      )
    : [];
  const filtered = useMemo(
    () =>
      items
        .filter((item) => matchesRaw(item, entry(item.id), raw, mediaGaps.get(item.id) ?? null))
        .sort((left, right) => {
          const a = field(left, entry(left.id), sort.column, mediaGaps.get(left.id) ?? null);
          const b = field(right, entry(right.id), sort.column, mediaGaps.get(right.id) ?? null);
          if (a === null || a === "") return b === null || b === "" ? 0 : 1;
          if (b === null || b === "") return -1;
          const result =
            typeof a === "number" && typeof b === "number"
              ? a - b
              : String(a).localeCompare(String(b), undefined, { numeric: true });
          return sort.descending ? -result : result;
        }),
    [items, entry, raw, sort, mediaGaps],
  );
  useEffect(() => {
    if (!candidatesLoaded || tab !== "raw" || raw.source !== "Candidate") return;
    if (selectedId && filtered.some((item) => item.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [candidatesLoaded, tab, raw.source, selectedId, filtered]);
  const selected = itemById.get(selectedId ?? "") ?? null;
  const selectedPublicationConflict = publicationMatches.find(
    ({ localId, readyToReplace }) => localId === selectedId && !readyToReplace,
  );
  const visibleGameplan = [...shown, ...(showNewCombos ? newCombos : [])];
  const activeCandidateCountForStarter = candidatesLoaded
    ? countCandidates(upstreamCandidates, character, support, starter)
    : 0;
  const renderedCandidateIds = new Set(
    [...shown, ...(showNewCombos ? newCombos : [])]
      .filter((item) => item.candidate && isActiveCandidate(item.candidate))
      .map((item) => item.candidate!.id),
  );
  const hiddenCandidateCount = Math.max(
    0,
    activeCandidateCountForStarter - renderedCandidateIds.size,
  );
  const scopeSelected =
    selected && visibleGameplan.some((item) => item.id === selected.id)
      ? selected
      : (shown.find((item) => entry(item.id).status === "Using") ??
        shown[0] ??
        visibleGameplan[0] ??
        null);
  const detail = tab === "gameplan" ? scopeSelected : selected;
  const detailEntry = detail ? entry(detail.id) : emptyPersonalEntry();
  const comparison =
    detail && tab === "raw"
      ? items.filter(
          (item) =>
            item.id !== detail.id &&
            item.characterId === detail.characterId &&
            item.supportId === detail.supportId &&
            item.starter === detail.starter &&
            entry(item.id).status === "Using",
        )
      : [];
  const updateRaw = (key: keyof RawFilters, value: string) =>
    setRaw((old) => ({ ...old, [key]: value }));

  const openCreate = () => setLocalDraft(blankLocal(character, support));
  const openRevisionDraft = (item: ComboItem) => {
    if (!item.published) return;
    const existing = workspace.localCombos.find(
      (combo) => combo.originCatalog && combo.publishedId === item.id,
    );
    if (existing) return setLocalDraft(existing);
    const draft = localRevisionDraft(item, `local-${crypto.randomUUID()}`);
    if (!draft) {
      setMessage(
        "This catalog copy has no revision number. Refresh the catalog before editing it.",
      );
      return;
    }
    setLocalDraft(draft);
  };
  const saveLocal = (combo: LocalCombo, personal: PersonalComboEntry) => {
    const id = combo.id || `local-${crypto.randomUUID()}`;
    setWorkspace((old) => {
      const entries = { ...old.entries };
      if (combo.originCatalog) delete entries[id];
      else entries[id] = personal;
      return {
        ...old,
        localCombos: [...old.localCombos.filter((item) => item.id !== id), { ...combo, id }],
        entries,
        characterId: combo.characterId,
        supportId: combo.supportId,
        starter: combo.starter,
      };
    });
    setSelectedId(id);
    setLocalDraft(null);
    setMessage(combo.publishedId ? "Local revision saved." : "Local combo saved.");
  };
  const deleteLocal = (id: string) => {
    if (!window.confirm("Delete this local combo and its personal tracking?")) return;
    setWorkspace((old) => {
      const entries = { ...old.entries };
      delete entries[id];
      const recordingLinks = { ...old.recordingLinks };
      delete recordingLinks[id];
      const candidateSubmissions = { ...old.candidateSubmissions };
      delete candidateSubmissions[id];
      const legacyImports = Object.fromEntries(
        Object.entries(old.legacyImports).filter(([, comboId]) => comboId !== id),
      );
      return {
        ...old,
        localCombos: old.localCombos.filter((item) => item.id !== id),
        entries,
        recordingLinks,
        candidateSubmissions,
        legacyImports,
      };
    });
    setSelectedId(null);
    setMessage("Local combo deleted.");
  };
  const useInstead = () => {
    if (!detail || !replaceId || !comparison.some((item) => item.id === replaceId)) return;
    setUndo({
      oldId: replaceId,
      nextId: detail.id,
      old: workspace.entries[replaceId],
      next: workspace.entries[detail.id],
    });
    setWorkspace((old) => ({
      ...old,
      entries: replaceComboEntries(old.entries, replaceId, detail.id),
      snapshots: {
        ...old.snapshots,
        ...Object.fromEntries(
          [itemById.get(replaceId), detail]
            .filter((item): item is ComboItem => item?.source === "Catalog")
            .map((item) => [item.id, catalogSnapshot(item)]),
        ),
      },
    }));
    setReplaceId("");
    setMessage("Replacement saved. The previous route is retired.");
  };
  const onPublished = (id: string, revision: number, draft: PublishComboDraft) => {
    const published = publishedComboFromDraft(draft);
    if (published && publishId) {
      const catalogCombo = { ...published, revision };
      const isCatalogRevision = workspace.localCombos.find(
        (combo) => combo.id === publishId,
      )?.originCatalog;
      setWorkspace((old) => replaceLocalComboWithCatalog(old, publishId, catalogCombo));
      setCatalog((old) => ({
        fetchedAt: Date.now(),
        moves: old?.moves ?? [],
        combos: [...(old?.combos ?? []).filter((combo) => combo.id !== id), catalogCombo],
      }));
      setSelectedId(id);
      setPublishId(null);
      setMessage(
        isCatalogRevision
          ? "Published catalog revision. The local draft was removed; catalog tracking and video were kept."
          : "Published combo. The local draft was removed and its saved data was transferred.",
      );
      void refresh();
      return;
    }
    setWorkspace((old) => ({
      ...old,
      localCombos: old.localCombos.map((combo) =>
        combo.id === publishId
          ? {
              ...combo,
              publishedId: id,
              publishedRevision: revision,
              needsCatalogPublication: false,
              ...(published ? { publishedBase: { ...published, revision } } : {}),
              editorName: draft.combo.name ?? "",
              editorDifficulty: draft.combo.difficulty ?? null,
              editorPickReason: draft.combo.editorPickReason ?? "",
              editorPickContext: draft.combo.editorPickContext ?? "",
              moveIds: draft.combo.moveIds,
              routingMode: draft.combo.routingMode ?? "autopilot",
              editorNotes: normalizeComboNotes(draft.combo.notes),
              youtubeUrl: draft.combo.youtubeUrl,
            }
          : combo,
      ),
    }));
    setPublishId(null);
    setMessage(
      `Published revision ${revision}, but the app could not match it to a saved local draft. Refresh the catalog before editing it again.`,
    );
    void refresh();
  };
  const mergeLocal = (id: string) => {
    const local = workspace.localCombos.find((combo) => combo.id === id);
    const targetId = local?.publishedId;
    if (!targetId || !itemById.get(targetId)?.published) return;
    if (
      !window.confirm(
        local.originCatalog
          ? `Remove the local revision of ${targetId}? Its own tracking will be discarded; tracking on the catalog combo will stay as it is.`
          : `Move your tracking to published combo ${targetId} and remove the local copy? Any existing tracking on the published combo will be replaced.`,
      )
    )
      return;
    const linkedVideo = workspace.recordingLinks[id];
    const targetVideo = workspace.recordingLinks[targetId];
    if (
      !local.originCatalog &&
      linkedVideo &&
      targetVideo &&
      targetVideo.recordingId !== linkedVideo.recordingId &&
      !window.confirm(
        `The published combo already has a different local video. Replace that link with ${linkedVideo.name || linkedVideo.recordingId}?`,
      )
    )
      return;
    setWorkspace((old) => {
      const entries = { ...old.entries };
      if (entries[id] && !local.originCatalog) entries[targetId] = entries[id];
      delete entries[id];
      const recordingLinks = { ...old.recordingLinks };
      if (linkedVideo && !local.originCatalog) recordingLinks[targetId] = linkedVideo;
      delete recordingLinks[id];
      const candidateSubmissions = { ...old.candidateSubmissions };
      delete candidateSubmissions[id];
      const legacyImports = Object.fromEntries(
        Object.entries(old.legacyImports)
          .filter(([, comboId]) => !(local.originCatalog && comboId === id))
          .map(([legacyId, comboId]) => [legacyId, comboId === id ? targetId : comboId]),
      );
      return {
        ...old,
        localCombos: old.localCombos.filter((combo) => combo.id !== id),
        entries,
        recordingLinks,
        candidateSubmissions,
        legacyImports,
        snapshots: { ...old.snapshots, [targetId]: catalogSnapshot(itemById.get(targetId)!) },
      };
    });
    setSelectedId(targetId);
    setMessage(
      local.originCatalog
        ? "Local revision removed. Catalog tracking was preserved."
        : "Personal tracking moved to the published combo.",
    );
  };
  const linkRecording = (comboId: string, recording: RecordedVideo) => {
    setWorkspace((old) => ({
      ...old,
      recordingLinks: {
        ...old.recordingLinks,
        [comboId]: { recordingId: recording.id, name: recording.name },
      },
      snapshots:
        itemById.get(comboId)?.source === "Catalog"
          ? { ...old.snapshots, [comboId]: catalogSnapshot(itemById.get(comboId)!) }
          : old.snapshots,
    }));
    setRecordingPickerId(null);
  };
  const linkCandidateRecording = (candidate: ComboCandidate, recording: RecordedVideo) => {
    setRecordings((old) => [...old.filter((item) => item.id !== recording.id), recording]);
    linkRecording(`candidate:${candidate.id}`, recording);
  };
  const unlinkRecording = (comboId: string) => {
    setWorkspace((old) => {
      const recordingLinks = { ...old.recordingLinks };
      delete recordingLinks[comboId];
      return { ...old, recordingLinks };
    });
  };
  const ownComboRecordingActive = Boolean(
    pendingComboRecording &&
    obsState.recording.active &&
    obsState.recording.sessionId === pendingComboRecording.sessionId,
  );
  const recordingDisabledReason = !window.electronAPI?.obs
    ? "Recording requires the desktop app."
    : pendingComboRecording
      ? "Finish or clear the pending combo recording first."
      : obsState.status !== "connected"
        ? "Connect OBS first."
        : !obsSettings.recordDirectory.trim()
          ? "Configure the OBS recording folder first."
          : obsState.recording.active || obsState.automation.enabled
            ? "Stop active and automatic recording first."
            : moveCapture.armed
              ? "Disarm the move take first."
              : obsBusy || comboRecordingBusy
                ? "OBS is busy."
                : "";
  const startComboRecording = async (item: ComboItem) => {
    if (recordingDisabledReason || !window.electronAPI?.obs) return;
    setComboRecordingBusy(true);
    setComboRecordingStatus(null);
    try {
      const started = await window.electronAPI.obs.startManualRecording({
        setup: {
          profileName: obsSettings.profileName,
          recordDirectory: obsSettings.recordDirectory,
        },
        fileNameBase: formatComboRecordingBaseName({
          character: displayName(item.characterId),
          support: displayName(item.supportId),
          starter: item.starter,
          screenPosition: item.screenPosition,
          damage: item.damage,
        }),
      });
      updatePendingComboRecording({ comboId: item.id, sessionId: started.sessionId });
      void refreshRecordings();
    } catch (reason) {
      setComboRecordingStatus({
        severity: "error",
        message: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setComboRecordingBusy(false);
    }
  };
  const stopComboRecording = async () => {
    if (!ownComboRecordingActive || !window.electronAPI?.obs) return;
    setComboRecordingBusy(true);
    setComboRecordingStatus(null);
    try {
      const result = await window.electronAPI.obs.stopRecording();
      if (!result.outputPath) {
        setComboRecordingStatus({
          severity: "error",
          message:
            "OBS stopped without a saved video. Find the finished recording again or clear the pending link.",
        });
      }
      await refreshRecordings();
    } catch (reason) {
      setComboRecordingStatus({
        severity: "error",
        message: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setComboRecordingBusy(false);
    }
  };
  const submitCandidate = async (item: ComboItem) => {
    const api = window.electronAPI?.comboCandidates;
    const link = workspace.recordingLinks[item.id];
    const recording = recordingsById.get(link?.recordingId ?? "");
    if (!api || !link || !recording || !isLocalMp4(recording)) {
      setCandidateError("Link an available local MP4 before submitting this combo.");
      return;
    }
    if (
      !window.confirm(
        `Submit ${item.route} and ${recording.name} for editor review? The MP4 and catalog-facing combo details will be uploaded.`,
      )
    )
      return;
    setCandidateSubmitting(true);
    setCandidateProgress(0);
    setCandidateError("");
    try {
      const submissionCombo = candidateComboFromItem(item);
      const previousSubmission = workspace.candidateSubmissions[item.id];
      const originCandidateId =
        item.local?.candidateOriginId ??
        previousSubmission?.originCandidateId ??
        previousSubmission?.id;
      const result = await api.submit({
        recordingId: recording.id,
        combo: submissionCombo,
        ...(originCandidateId ? { originCandidateId } : {}),
      });
      setWorkspace((old) => ({
        ...old,
        candidateSubmissions: {
          ...old.candidateSubmissions,
          [item.id]: {
            id: result.id,
            originCandidateId: originCandidateId ?? result.id,
            submittedAt: new Date().toISOString(),
            draftSignature: JSON.stringify(submissionCombo),
          },
        },
      }));
      setMessage(`Candidate ${result.id} submitted with its MP4 for review.`);
      if (candidatesLoaded) void refreshCandidates();
    } catch (reason) {
      setCandidateError(reason instanceof Error ? reason.message : "Could not submit candidate.");
    } finally {
      setCandidateSubmitting(false);
      setCandidateProgress(null);
    }
  };
  const importMp4 = async () => {
    if (!recordingPickerId || !window.electronAPI?.recordings) return;
    setImportingMp4(true);
    setRecordingsError("");
    try {
      const recordingId = await window.electronAPI.recordings.importComboMp4();
      if (!recordingId) return;
      const latest = await window.electronAPI.recordings.list();
      setRecordings(latest.recordings);
      const recording = latest.recordings.find((item) => item.id === recordingId);
      if (!recording) throw new Error("The imported MP4 did not appear in the recording library.");
      linkRecording(recordingPickerId, recording);
    } catch (reason) {
      setRecordingsError(reason instanceof Error ? reason.message : "Could not import MP4.");
    } finally {
      setImportingMp4(false);
    }
  };
  const openRecordingInLibrary = (recordingId: string) => {
    localStorage.setItem(techSelectedRecordingStorageKey, recordingId);
    window.dispatchEvent(new CustomEvent(techSelectRecordingEvent, { detail: recordingId }));
  };
  const openLegacyImport = () => {
    setLegacyCombos(readLegacyCombos());
    setLegacySelection("");
    setLegacyTargetId("");
    setLegacyImportOpen(true);
  };
  const selectedLegacy = legacyCombos.find((row) => row.key === legacySelection);
  const pickerRecordings = recordings
    .filter(isLocalMp4)
    .filter((recording) =>
      `${recording.name} ${recording.id}`.toLowerCase().includes(recordingSearch.toLowerCase()),
    );
  const importLegacy = () => {
    if (!selectedLegacy || workspace.legacyImports[selectedLegacy.key]) return;
    const combo = selectedLegacy.combo;
    const legacyRecordingId =
      combo.recordingId && /\.mp4$/i.test(combo.recordingId) ? combo.recordingId : null;
    const target = itemById.get(legacyTargetId);
    if (
      target &&
      (!legacyRecordingId ||
        !window.confirm(
          `Link the Dev editor recording to ${comboDisplayName(target, entry(target.id))}?`,
        ))
    )
      return;
    if (
      target &&
      workspace.recordingLinks[target.id] &&
      !window.confirm("Replace this combo's existing local video link?")
    )
      return;
    const id = target?.id ?? `local-${crypto.randomUUID()}`;
    const recording = recordingsById.get(legacyRecordingId ?? "");
    const localCombo: LocalCombo | null = target
      ? null
      : {
          id,
          characterId: slugComboText(combo.character),
          supportId: slugComboText(combo.support),
          starter: comboStarterFromRoute(combo.route),
          name: combo.name?.trim() || "Imported combo",
          route: combo.route.trim(),
          screenPosition: combo.screenPosition,
          damage: combo.damage,
          pips: Math.max(0, combo.resourceCosts.pips),
          flow: Math.max(0, combo.resourceCosts.flow),
          difficulty: null,
          hitconfirm: combo.initialConversionHitconfirmable ? "yes" : "unknown",
          counterhit: combo.requiresCounterhit === true,
          youtubeUrl: "",
          ...(combo.name?.trim() ? { editorName: combo.name.trim() } : {}),
          ...(combo.difficulty != null ? { editorDifficulty: combo.difficulty } : {}),
          ...(combo.editorPickReason?.trim()
            ? { editorPickReason: combo.editorPickReason.trim() }
            : {}),
          ...(combo.editorPickContext?.trim()
            ? { editorPickContext: combo.editorPickContext.trim() }
            : {}),
          moveIds: combo.moveIds.filter((moveId): moveId is string => Boolean(moveId?.trim())),
          routingMode: combo.routingMode ?? "autopilot",
          legacyTechComboId: selectedLegacy.key,
          editorNotes: normalizeComboNotes(combo.notes),
        };
    setWorkspace((old) => ({
      ...old,
      localCombos: localCombo ? [...old.localCombos, localCombo] : old.localCombos,
      entries: localCombo
        ? { ...old.entries, [id]: { ...emptyPersonalEntry(), status: "Considering" } }
        : old.entries,
      recordingLinks: legacyRecordingId
        ? {
            ...old.recordingLinks,
            [id]: { recordingId: legacyRecordingId, name: recording?.name ?? legacyRecordingId },
          }
        : old.recordingLinks,
      legacyImports: { ...old.legacyImports, [selectedLegacy.key]: id },
      snapshots:
        target?.source === "Catalog"
          ? { ...old.snapshots, [id]: catalogSnapshot(target) }
          : old.snapshots,
      characterId: localCombo?.characterId ?? old.characterId,
      supportId: localCombo?.supportId ?? old.supportId,
      starter: localCombo?.starter ?? old.starter,
    }));
    setSelectedId(id);
    setLegacySelection("");
    setLegacyTargetId("");
    setMessage(target ? "Dev editor recording linked." : "Dev editor combo imported.");
  };
  const imageOptions = picker === "character" ? characters : supports;

  return (
    <Stack spacing={2} sx={{ pb: 5, textAlign: "left" }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
        <Tabs
          value={tab}
          onChange={(_, value: "gameplan" | "raw") => {
            setTab(value);
            setSelectedId(null);
          }}
          aria-label="Combo views"
        >
          <Tab value="gameplan" label="My gameplan" />
          <Tab value="raw" label="Raw" />
        </Tabs>
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={openLegacyImport}>
            Import Dev combos
          </Button>
          {window.electronAPI?.comboCandidates && (
            <Button
              size="small"
              onClick={() => {
                enableCandidates();
                setRaw({ ...emptyRaw(), source: "Candidate" });
                setTab("raw");
              }}
              disabled={candidatesLoading}
            >
              {candidatesLoading
                ? "Loading candidates…"
                : candidatesLoaded
                  ? "Refresh candidates"
                  : "Upstream candidates"}
            </Button>
          )}
          <Button size="small" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </Stack>
      </Stack>
      {storageError && <Alert severity="warning">{storageError}</Alert>}
      {pendingComboRecording && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
            <Typography variant="body2">
              Recording for{" "}
              {itemById.get(pendingComboRecording.comboId)?.route ?? pendingComboRecording.comboId}
            </Typography>
            {ownComboRecordingActive ? (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={() => void stopComboRecording()}
                  disabled={comboRecordingBusy || obsBusy}
                >
                  Stop combo recording
                </Button>
                <Typography variant="caption" color="text.secondary">
                  Stop here, with F9, or in OBS. The saved MP4 will link automatically.
                </Typography>
              </>
            ) : (
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  onClick={() => void refreshRecordings()}
                  disabled={comboRecordingBusy}
                >
                  Find finished recording
                </Button>
                <Button
                  size="small"
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
          </Stack>
        </Paper>
      )}
      {comboRecordingStatus && (
        <Alert
          severity={comboRecordingStatus.severity}
          onClose={() => setComboRecordingStatus(null)}
        >
          {comboRecordingStatus.message}
        </Alert>
      )}
      {candidateError && (
        <Alert severity="error" onClose={() => setCandidateError("")}>
          {candidateError}
        </Alert>
      )}
      {selectedPublicationConflict && (
        <Alert
          severity="info"
          action={
            <Button
              size="small"
              onClick={() => {
                const { localId, published } = selectedPublicationConflict;
                setWorkspace((old) => ({
                  ...replaceLocalComboWithCatalog(old, localId, published),
                  characterId: published.characterId,
                  supportId: published.supportId,
                  starter: comboStarterFromRoute(published.route),
                }));
                setSelectedId(published.id);
                setMessage("Published candidate replaced your edited local draft.");
              }}
            >
              Use published combo
            </Button>
          }
        >
          This draft changed after candidate submission. Review it before replacing it with the
          published combo.
        </Alert>
      )}
      {candidatesLoaded && upstreamCandidates.length === 0 && raw.source === "Candidate" && (
        <Alert severity="info">No upstream candidates found.</Alert>
      )}
      {catalogError && (
        <Alert severity={catalog ? "warning" : "error"}>
          {catalogError}
          {catalog ? " Showing saved catalog data." : ""}
        </Alert>
      )}
      {message && (
        <Alert severity="info" onClose={() => setMessage("")}>
          {message}
          {undo && (
            <Button
              size="small"
              onClick={() => {
                setWorkspace((old) => {
                  const entries = { ...old.entries };
                  if (undo.old) entries[undo.oldId] = undo.old;
                  else delete entries[undo.oldId];
                  if (undo.next) entries[undo.nextId] = undo.next;
                  else delete entries[undo.nextId];
                  return { ...old, entries };
                });
                setUndo(null);
                setMessage("Replacement undone.");
              }}
            >
              Undo replacement
            </Button>
          )}
        </Alert>
      )}
      {!catalog && refreshing && <CircularProgress size={26} />}
      {tab === "gameplan" ? (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                {(
                  [
                    ["character", character, selectedPortraits.character],
                    ["support", support, selectedPortraits.support],
                  ] as const
                ).map(([kind, id, portrait]) => {
                  const localTotal =
                    kind === "character"
                      ? countLocalCombos(workspace.localCombos, id)
                      : countLocalCombos(workspace.localCombos, character, id);
                  const candidateTotal = candidatesLoaded
                    ? kind === "character"
                      ? countCandidates(upstreamCandidates, id)
                      : countCandidates(upstreamCandidates, character, id)
                    : 0;
                  return (
                    <Box key={kind}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block" }}
                      >
                        {kind === "character" ? "Character" : "Support"}
                      </Typography>
                      <Button
                        variant="outlined"
                        aria-label={`Choose ${kind}: ${displayName(id)}${localTotal > 0 ? `; ${localTotal} local combos` : ""}${candidateTotal > 0 ? `; ${candidateTotal} candidates` : ""}`}
                        title={displayName(id)}
                        onClick={() => setPicker(kind)}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          textTransform: "none",
                        }}
                      >
                        {portrait ? (
                          <Box
                            component="img"
                            src={portrait}
                            alt=""
                            sx={{ width: 42, height: 48, objectFit: "contain" }}
                          />
                        ) : (
                          <Box
                            aria-hidden="true"
                            sx={{
                              width: 42,
                              height: 48,
                              display: "grid",
                              placeItems: "center",
                              bgcolor: "action.hover",
                              borderRadius: 1,
                            }}
                          >
                            {displayName(id).slice(0, 2).toUpperCase()}
                          </Box>
                        )}
                        <Typography aria-hidden="true" color="text.secondary">
                          ⌄
                        </Typography>
                      </Button>
                      <ComboSourceCounts local={localTotal} candidates={candidateTotal} />
                    </Box>
                  );
                })}
              </Stack>
              {starters.length ? (
                <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 2 }}>
                  {comboStarterGroups.map(({ id, label }) => {
                    const options = starters.filter((value) => comboStarterGroup(value) === id);
                    return options.length ? (
                      <Box key={id} sx={{ minWidth: 0, maxWidth: "100%" }}>
                        <Typography variant="caption" color="text.secondary">
                          {label}
                        </Typography>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 0.5 }}>
                          {options.map((value) => (
                            <Box
                              key={value}
                              sx={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                              }}
                            >
                              <Button
                                size="small"
                                variant={starter === value ? "contained" : "outlined"}
                                onClick={() => {
                                  setWorkspace((old) => ({
                                    ...old,
                                    characterId: character,
                                    supportId: support,
                                    starter: value,
                                  }));
                                  setSelectedId(null);
                                }}
                              >
                                {value}
                              </Button>
                              <ComboSourceCounts
                                local={countLocalCombos(
                                  workspace.localCombos,
                                  character,
                                  support,
                                  value,
                                )}
                                candidates={
                                  candidatesLoaded
                                    ? countCandidates(upstreamCandidates, character, support, value)
                                    : 0
                                }
                              />
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    ) : null;
                  })}
                </Box>
              ) : (
                <Typography color="text.secondary">
                  No starters for this pairing yet. Add a local combo to begin.
                </Typography>
              )}
            </Stack>
          </Paper>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 1fr) minmax(330px, .38fr)" },
              gap: 2,
              alignItems: "start",
            }}
          >
            <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
              <Stack spacing={2}>
                <Stack
                  direction="row"
                  sx={{
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                  }}
                >
                  <Typography variant="h6">
                    {starter ? (
                      <>
                        <Box component="span" sx={{ color: "primary.main" }}>
                          {starter}
                        </Box>{" "}
                        starter combos
                      </>
                    ) : (
                      "Starter combos"
                    )}
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    {workspace.localCombos.length > 0 && (
                      <Button
                        variant="outlined"
                        onClick={() => {
                          setRaw({ ...emptyRaw(), source: "Local" });
                          setSelectedId(null);
                          setTab("raw");
                        }}
                      >
                        My local combos ({workspace.localCombos.length})
                      </Button>
                    )}
                    <Button variant="contained" onClick={openCreate}>
                      + Add my combo
                    </Button>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                  {[
                    ["gameplan", "Gameplan"],
                    ["all", "All saved"],
                    ...comboStatuses.map((status): [string, string] => [status, status]),
                  ].map(([value, label]) => (
                    <Chip
                      key={value}
                      label={label}
                      clickable
                      color={statusFilter === value ? "primary" : "default"}
                      onClick={() => setStatusFilter(value)}
                    />
                  ))}
                  {window.electronAPI?.comboCandidates && (
                    <Chip
                      label="Candidate"
                      clickable
                      title="Show upstream candidates with the selected personal status"
                      color={candidateOnly ? "secondary" : "default"}
                      variant={candidateOnly ? "filled" : "outlined"}
                      onClick={() => {
                        const next = !candidateOnly;
                        setCandidateOnly(next);
                        if (next && !candidatesLoaded && !candidatesLoading) enableCandidates();
                      }}
                    />
                  )}
                </Stack>
                {gameplanTags.length > 0 && (
                  <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{ flexWrap: "wrap", alignItems: "center" }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      My tags
                    </Typography>
                    <Chip
                      size="small"
                      clickable
                      label="All"
                      color={effectiveTagFilter === "all" ? "primary" : "default"}
                      onClick={() => setTagFilter("all")}
                    />
                    {gameplanTags.map((tag) => (
                      <Chip
                        key={tag}
                        size="small"
                        clickable
                        label={`#${tag}`}
                        color={effectiveTagFilter === tag ? "primary" : "default"}
                        onClick={() => setTagFilter(tag)}
                      />
                    ))}
                  </Stack>
                )}
                {candidateOnly && candidatesLoading && (
                  <Alert severity="info">Loading upstream candidates…</Alert>
                )}
                {hiddenCandidateCount > 0 && !candidatesLoading && (
                  <Alert
                    severity="info"
                    action={
                      <Button
                        size="small"
                        onClick={() => {
                          setCandidateOnly(true);
                          setStatusFilter("all");
                          setTagFilter("all");
                        }}
                      >
                        Show {hiddenCandidateCount === 1 ? "candidate" : "candidates"}
                      </Button>
                    }
                  >
                    {hiddenCandidateCount}{" "}
                    {hiddenCandidateCount === 1 ? "candidate is" : "candidates are"} hidden by the
                    current view.
                  </Alert>
                )}
                {visibleGameplan.length === 0 &&
                  hiddenCandidateCount === 0 &&
                  !candidatesLoading && (
                    <Alert
                      severity="info"
                      action={
                        candidateOnly && scopedForView.length > 0 ? (
                          <Button
                            size="small"
                            onClick={() => {
                              setStatusFilter("all");
                              setTagFilter("all");
                            }}
                          >
                            Show all statuses
                          </Button>
                        ) : undefined
                      }
                    >
                      {candidateOnly
                        ? scopedForView.length > 0
                          ? "Candidates for this starter are hidden by the current status or tag filter."
                          : "No active upstream candidates for this starter and pairing."
                        : scoped.length > 0
                          ? "No routes match the current status or tag filter."
                          : "No routes for this starter yet. Add a local combo or browse Raw."}
                    </Alert>
                  )}
                {starter && (
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
                      gap: 1.5,
                    }}
                  >
                    {[
                      ...positionGroups,
                      ...(otherPositionCombos.length || otherPositionNewCombos.length
                        ? [
                            {
                              label: "Other positions",
                              combos: otherPositionCombos,
                              newCombos: otherPositionNewCombos,
                            },
                          ]
                        : []),
                    ].map(({ label, combos, newCombos: newPositionCombos }) => (
                      <Box
                        key={label}
                        sx={{
                          minWidth: 0,
                          gridColumn: label === "Other positions" ? { md: "1 / -1" } : undefined,
                        }}
                      >
                        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                          {label}{" "}
                          <Typography component="span" color="text.secondary">
                            ({combos.length + newPositionCombos.length})
                          </Typography>
                        </Typography>
                        <Stack spacing={1}>
                          {combos.length === 0 && newPositionCombos.length === 0 && (
                            <Paper variant="outlined" sx={{ p: 1.5, color: "text.secondary" }}>
                              No saved combos here.
                            </Paper>
                          )}
                          {combos.map((item) => {
                            const personal = entry(item.id);
                            return (
                              <Card
                                key={item.id}
                                variant="outlined"
                                onClick={() => setSelectedId(item.id)}
                                sx={{
                                  cursor: "pointer",
                                  borderColor:
                                    scopeSelected?.id === item.id ? "primary.main" : undefined,
                                  p: 1.5,
                                }}
                              >
                                <Box
                                  sx={{
                                    display: "grid",
                                    gridTemplateColumns: "minmax(0, 1fr) auto",
                                    gridTemplateAreas: '"heading rail" "route rail" "details rail"',
                                    gridTemplateRows: "auto minmax(0, 1fr) auto",
                                    columnGap: 1,
                                    rowGap: 1,
                                    minHeight: 140,
                                  }}
                                >
                                  <Box
                                    sx={{
                                      gridArea: "heading",
                                      minWidth: 0,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      flexWrap: "wrap",
                                      gap: 1,
                                      pb: 1,
                                      borderBottom: 1,
                                      borderColor: "divider",
                                    }}
                                  >
                                    <Box sx={{ minWidth: 0, flex: "1 1 88px" }}>
                                      <Typography sx={{ fontWeight: 700 }}>
                                        {comboDisplayName(item, personal)}
                                      </Typography>
                                      {(label === "Other positions" || personal.condition) && (
                                        <Typography variant="body2" color="text.secondary">
                                          {label === "Other positions"
                                            ? item.screenPosition || "Position unknown"
                                            : personal.condition}
                                          {label === "Other positions" && personal.condition
                                            ? ` · ${personal.condition}`
                                            : ""}
                                        </Typography>
                                      )}
                                    </Box>
                                  </Box>
                                  <Box
                                    sx={{
                                      gridArea: "rail",
                                      borderLeft: 1,
                                      borderColor: "divider",
                                      pl: 1,
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "flex-end",
                                      justifyContent: "space-between",
                                      gap: 1,
                                    }}
                                  >
                                    <Box sx={{ textAlign: "right" }}>
                                      <Typography variant="h5" sx={{ fontWeight: 800 }}>
                                        {item.damage || "—"}
                                      </Typography>
                                      <Typography variant="caption">damage</Typography>
                                    </Box>
                                    <Box
                                      sx={{
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "flex-end",
                                        gap: 0.5,
                                      }}
                                    >
                                      <ComboPipIcons pips={item.pips} />
                                      <ComboFlowMeter flow={item.flow} />
                                    </Box>
                                  </Box>
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      gridArea: "route",
                                      fontFamily: "monospace",
                                      overflowWrap: "anywhere",
                                    }}
                                  >
                                    {item.route}
                                  </Typography>
                                  <Stack
                                    direction="row"
                                    spacing={0.5}
                                    sx={{
                                      gridArea: "details",
                                      minWidth: 0,
                                      flexWrap: "wrap",
                                      alignItems: "end",
                                    }}
                                  >
                                    <Chip size="small" label={personal.status} />
                                    <Chip
                                      size="small"
                                      label={`Difficulty ${effectiveDifficulty(item, personal) ?? "—"}`}
                                      variant="outlined"
                                    />
                                    {item.counterhit === "yes" && (
                                      <Chip
                                        size="small"
                                        label="CH only"
                                        color="warning"
                                        title="Requires a counterhit"
                                      />
                                    )}
                                    {item.candidate && (
                                      <Chip size="small" label="Candidate" color="secondary" />
                                    )}
                                    {item.local && (
                                      <Chip
                                        size="small"
                                        label={
                                          item.local.originCatalog ? "Local revision" : "Local"
                                        }
                                        color="info"
                                      />
                                    )}
                                    {gapFor(item.id) && (
                                      <Chip
                                        size="small"
                                        label={gapFor(item.id)}
                                        color="warning"
                                        variant="outlined"
                                      />
                                    )}
                                  </Stack>
                                </Box>
                              </Card>
                            );
                          })}
                          {newPositionCombos.length > 0 && (
                            <Typography variant="subtitle2" sx={{ pt: 1, fontWeight: 700 }}>
                              New combos ({newPositionCombos.length})
                            </Typography>
                          )}
                          {newPositionCombos.map((item) => (
                            <Card
                              key={item.id}
                              variant="outlined"
                              onClick={() => setSelectedId(item.id)}
                              sx={{
                                cursor: "pointer",
                                p: 1.5,
                                borderColor:
                                  scopeSelected?.id === item.id ? "primary.main" : undefined,
                              }}
                            >
                              <Box
                                sx={{
                                  display: "grid",
                                  gridTemplateColumns: "minmax(0, 1fr) auto",
                                  gridTemplateAreas: '"heading rail" "route rail" "details rail"',
                                  gridTemplateRows: "auto minmax(0, 1fr) auto",
                                  columnGap: 1,
                                  rowGap: 1,
                                  minHeight: 140,
                                }}
                              >
                                <Box
                                  sx={{
                                    gridArea: "heading",
                                    minWidth: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    flexWrap: "wrap",
                                    gap: 1,
                                    pb: 1,
                                    borderBottom: 1,
                                    borderColor: "divider",
                                  }}
                                >
                                  <Box sx={{ minWidth: 0, flex: "1 1 88px" }}>
                                    <Typography sx={{ fontWeight: 700 }}>
                                      {comboDisplayName(item, entry(item.id))}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                      {item.screenPosition || "Position unknown"}
                                    </Typography>
                                  </Box>
                                </Box>
                                <Box
                                  sx={{
                                    gridArea: "rail",
                                    borderLeft: 1,
                                    borderColor: "divider",
                                    pl: 1,
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "flex-end",
                                    justifyContent: "space-between",
                                    gap: 1,
                                  }}
                                >
                                  <Box sx={{ textAlign: "right" }}>
                                    <Typography variant="h5" sx={{ fontWeight: 800 }}>
                                      {item.damage || "—"}
                                    </Typography>
                                    <Typography variant="caption">damage</Typography>
                                  </Box>
                                  <Box
                                    sx={{
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "flex-end",
                                      gap: 0.5,
                                    }}
                                  >
                                    <ComboPipIcons pips={item.pips} />
                                    <ComboFlowMeter flow={item.flow} />
                                  </Box>
                                </Box>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    gridArea: "route",
                                    fontFamily: "monospace",
                                    overflowWrap: "anywhere",
                                  }}
                                >
                                  {item.route}
                                </Typography>
                                <Stack
                                  direction="row"
                                  spacing={0.5}
                                  sx={{
                                    gridArea: "details",
                                    minWidth: 0,
                                    flexWrap: "wrap",
                                    alignItems: "end",
                                  }}
                                >
                                  {item.published?.editorPickReason && (
                                    <Chip size="small" color="warning" label="Editor's pick" />
                                  )}
                                  <Chip
                                    size="small"
                                    variant="outlined"
                                    label={`Difficulty ${effectiveDifficulty(item, entry(item.id)) ?? "—"}`}
                                  />
                                  {item.counterhit === "yes" && (
                                    <Chip
                                      size="small"
                                      label="CH only"
                                      color="warning"
                                      title="Requires a counterhit"
                                    />
                                  )}
                                  {item.candidate && (
                                    <Chip size="small" label="Candidate" color="secondary" />
                                  )}
                                  {item.local && (
                                    <Chip
                                      size="small"
                                      label={item.local.originCatalog ? "Local revision" : "Local"}
                                      color="info"
                                    />
                                  )}
                                  {gapFor(item.id) && (
                                    <Chip
                                      size="small"
                                      label={gapFor(item.id)}
                                      color="warning"
                                      variant="outlined"
                                    />
                                  )}
                                </Stack>
                              </Box>
                            </Card>
                          ))}
                        </Stack>
                      </Box>
                    ))}
                  </Box>
                )}
              </Stack>
            </Paper>
            <ComboDetail
              item={scopeSelected}
              mediaGap={scopeSelected ? gapFor(scopeSelected.id) : null}
              recordingLink={scopeSelected ? workspace.recordingLinks[scopeSelected.id] : undefined}
              linkedYouTubeUrl={scopeSelected ? linkedYouTubeUrlFor(scopeSelected.id) : ""}
              recording={
                recordings.find(
                  (recording) =>
                    recording.id ===
                      workspace.recordingLinks[scopeSelected?.id ?? ""]?.recordingId &&
                    isLocalMp4(recording),
                ) ?? null
              }
              recordingApiAvailable={Boolean(window.electronAPI?.recordings)}
              recordingDisabledReason={recordingDisabledReason}
              onRecord={() => scopeSelected && void startComboRecording(scopeSelected)}
              recordingsLoaded={recordingsLoaded}
              recordingsError={recordingsError}
              onChooseRecording={() => {
                if (!scopeSelected) return;
                setRecordingSearch("");
                setRecordingPickerId(scopeSelected.id);
                void refreshRecordings();
              }}
              onUnlinkRecording={() => scopeSelected && unlinkRecording(scopeSelected.id)}
              onOpenRecording={openRecordingInLibrary}
              candidateSubmission={
                scopeSelected ? workspace.candidateSubmissions[scopeSelected.id] : undefined
              }
              candidateAvailable={candidateAvailable}
              candidateSubmitting={candidateSubmitting}
              candidateProgress={candidateProgress}
              onSubmitCandidate={() => scopeSelected && void submitCandidate(scopeSelected)}
              onCandidateChanged={onCandidateChanged}
              candidateRecording={
                scopeSelected?.candidate
                  ? savedCandidateRecording(
                      scopeSelected.candidate,
                      recordings,
                      workspace.recordingLinks,
                    )
                  : null
              }
              onCandidateRecordingSaved={linkCandidateRecording}
              personal={scopeSelected ? entry(scopeSelected.id) : emptyPersonalEntry()}
              updateEntry={updateEntry}
              tagInput={tagInput}
              setTagInput={setTagInput}
              onEdit={() => scopeSelected?.local && setLocalDraft(scopeSelected.local)}
              onStagePublished={() => scopeSelected && openRevisionDraft(scopeSelected)}
              onDelete={() => scopeSelected && deleteLocal(scopeSelected.id)}
              onPublish={() => scopeSelected && setPublishId(scopeSelected.id)}
              onMerge={() => scopeSelected && mergeLocal(scopeSelected.id)}
              latestCatalogRevision={
                itemById.get(scopeSelected?.local?.publishedId ?? "")?.published?.revision ?? null
              }
              canMerge={Boolean(
                scopeSelected?.local?.publishedId &&
                itemById.get(scopeSelected.local.publishedId)?.published,
              )}
            />
          </Box>
        </>
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Stack
                direction="row"
                sx={{
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 1,
                }}
              >
                <Typography variant="h6">
                  All combos · {filtered.length} of {items.length}
                </Typography>
                <Button variant="contained" onClick={openCreate}>
                  + Add my combo
                </Button>
              </Stack>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                <TextField
                  size="small"
                  label="Search"
                  value={raw.search}
                  onChange={(e) => updateRaw("search", e.target.value)}
                />
                <SelectField
                  label="Source"
                  value={raw.source}
                  options={[
                    ["all", "All"],
                    ["Catalog", "Catalog"],
                    ["Candidate", "Candidate"],
                    ["Local", "Local"],
                    ["Unavailable", "Unavailable"],
                  ]}
                  onChange={(v) => {
                    updateRaw("source", v);
                    if (v === "Candidate" && !candidatesLoaded && !candidatesLoading)
                      enableCandidates();
                  }}
                />
                <SelectField
                  label="Character"
                  value={raw.character}
                  options={[
                    ["all", "All"],
                    ...characters.map((id): [string, string] => [id, displayName(id)]),
                  ]}
                  onChange={(v) => updateRaw("character", v)}
                />
                <SelectField
                  label="Support"
                  value={raw.support}
                  options={[
                    ["all", "All"],
                    ...[...new Set(items.map((item) => item.supportId))]
                      .sort()
                      .map((id): [string, string] => [id, displayName(id)]),
                  ]}
                  onChange={(v) => updateRaw("support", v)}
                />
                <SelectField
                  label="Starter"
                  value={raw.starter}
                  options={[
                    ["all", "All"],
                    ...[...new Set(items.map((item) => item.starter))]
                      .sort()
                      .map((id): [string, string] => [id, id]),
                  ]}
                  onChange={(v) => updateRaw("starter", v)}
                />
                <SelectField
                  label="Position"
                  value={raw.position}
                  options={[
                    ["all", "All"],
                    ...[
                      ...new Set(
                        items.map((item) => item.screenPosition.toLowerCase()).filter(Boolean),
                      ),
                    ]
                      .sort()
                      .map((id): [string, string] => [id, id]),
                  ]}
                  onChange={(v) => updateRaw("position", v)}
                />
                <SelectField
                  label="Status"
                  value={raw.status}
                  options={[
                    ["all", "All"],
                    ["", "Blank"],
                    ...comboStatuses.map((v): [string, string] => [v, v]),
                  ]}
                  onChange={(v) => updateRaw("status", v)}
                />
                <SelectField
                  label="Hitconfirm"
                  value={raw.hitconfirm}
                  options={[
                    ["all", "All"],
                    ["yes", "Yes"],
                    ["no", "No"],
                    ["unknown", "Unknown"],
                  ]}
                  onChange={(v) => updateRaw("hitconfirm", v)}
                />
                <SelectField
                  label="Counterhit"
                  value={raw.counterhit}
                  options={[
                    ["all", "All"],
                    ["yes", "Required"],
                    ["no", "Not required"],
                    ["unknown", "Unknown"],
                  ]}
                  onChange={(v) => updateRaw("counterhit", v)}
                />
                <SelectField
                  label="Editor pick"
                  value={raw.editorPick}
                  options={[
                    ["all", "All"],
                    ["yes", "Picks"],
                    ["no", "Others"],
                  ]}
                  onChange={(v) => updateRaw("editorPick", v)}
                />
                <SelectField
                  label="Media"
                  value={raw.media}
                  options={[
                    ["all", "All"],
                    ["No video", "No video"],
                    ["No YouTube video", "No YouTube video"],
                  ]}
                  onChange={(v) => updateRaw("media", v)}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Min damage"
                  value={raw.minDamage}
                  onChange={(e) => updateRaw("minDamage", e.target.value)}
                  sx={{ width: 120 }}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Max pips"
                  value={raw.maxPips}
                  onChange={(e) => updateRaw("maxPips", e.target.value)}
                  sx={{ width: 105 }}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Max flow"
                  value={raw.maxFlow}
                  onChange={(e) => updateRaw("maxFlow", e.target.value)}
                  sx={{ width: 105 }}
                />
                <SelectField
                  label="Max difficulty"
                  value={raw.maxDifficulty}
                  options={[
                    ["", "Any"],
                    ...[1, 2, 3, 4, 5].map((n): [string, string] => [String(n), String(n)]),
                  ]}
                  onChange={(v) => updateRaw("maxDifficulty", v)}
                />
                <Button onClick={() => setRaw(emptyRaw())}>Clear filters</Button>
                <Button onClick={() => setShowColumns((value) => !value)}>Columns</Button>
              </Box>
              {appliedRawFilters.length > 0 && (
                <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
                  <Typography variant="caption" color="text.secondary">
                    Applied filters
                  </Typography>
                  {appliedRawFilters.map(([key, label]) => (
                    <Chip
                      key={key}
                      size="small"
                      label={label}
                      onDelete={() => updateRaw(key, emptyRaw()[key])}
                    />
                  ))}
                </Box>
              )}
              {showColumns && (
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                  {rawColumns.map(([id, label]) => (
                    <Chip
                      key={id}
                      label={label}
                      clickable
                      color={columns.has(id) ? "primary" : "default"}
                      onClick={() =>
                        setColumns((old) => {
                          const next = new Set(old);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                    />
                  ))}
                </Stack>
              )}
              <Box sx={{ overflowX: "auto" }}>
                <Box
                  component="table"
                  sx={{
                    borderCollapse: "collapse",
                    minWidth: 1100,
                    width: "100%",
                    textAlign: "left",
                    "& th, & td": {
                      borderBottom: 1,
                      borderColor: "divider",
                      px: 1,
                      py: 1,
                      whiteSpace: "nowrap",
                    },
                    "& tbody tr:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <thead>
                    <tr>
                      {rawColumns
                        .filter(([id]) => columns.has(id))
                        .map(([id, label]) => (
                          <th key={id}>
                            <Button
                              size="small"
                              onClick={() =>
                                setSort((old) => ({
                                  column: id,
                                  descending: old.column === id ? !old.descending : false,
                                }))
                              }
                            >
                              {label}
                              {sort.column === id ? (sort.descending ? " ↓" : " ↑") : ""}
                            </Button>
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => (
                      <tr
                        key={item.id}
                        tabIndex={0}
                        onClick={() => {
                          setSelectedId(item.id);
                          setReplaceId("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setSelectedId(item.id);
                        }}
                        style={{
                          cursor: "pointer",
                          background: selectedId === item.id ? "rgba(144,202,249,.12)" : undefined,
                        }}
                      >
                        {rawColumns
                          .filter(([id]) => columns.has(id))
                          .map(([id]) => (
                            <td key={id}>
                              {id === "source" && item.candidate ? (
                                <Chip
                                  size="small"
                                  color="secondary"
                                  label={`Candidate · ${candidateReviewStatus(item.candidate)}`}
                                />
                              ) : id === "damage" ? (
                                item.damage || "—"
                              ) : (
                                (field(item, entry(item.id), id, gapFor(item.id)) ?? "—")
                              )}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </Box>
            </Stack>
          </Paper>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) minmax(320px, .6fr)" },
              gap: 2,
              alignItems: "start",
            }}
          >
            <ComboDetail
              item={selected}
              mediaGap={selected ? gapFor(selected.id) : null}
              recordingLink={selected ? workspace.recordingLinks[selected.id] : undefined}
              linkedYouTubeUrl={selected ? linkedYouTubeUrlFor(selected.id) : ""}
              recording={
                recordings.find(
                  (recording) =>
                    recording.id === workspace.recordingLinks[selected?.id ?? ""]?.recordingId &&
                    isLocalMp4(recording),
                ) ?? null
              }
              recordingApiAvailable={Boolean(window.electronAPI?.recordings)}
              recordingDisabledReason={recordingDisabledReason}
              onRecord={() => selected && void startComboRecording(selected)}
              recordingsLoaded={recordingsLoaded}
              recordingsError={recordingsError}
              onChooseRecording={() => {
                if (!selected) return;
                setRecordingSearch("");
                setRecordingPickerId(selected.id);
                void refreshRecordings();
              }}
              onUnlinkRecording={() => selected && unlinkRecording(selected.id)}
              onOpenRecording={openRecordingInLibrary}
              candidateSubmission={
                selected ? workspace.candidateSubmissions[selected.id] : undefined
              }
              candidateAvailable={candidateAvailable}
              candidateSubmitting={candidateSubmitting}
              candidateProgress={candidateProgress}
              onSubmitCandidate={() => selected && void submitCandidate(selected)}
              onCandidateChanged={onCandidateChanged}
              candidateRecording={
                selected?.candidate
                  ? savedCandidateRecording(
                      selected.candidate,
                      recordings,
                      workspace.recordingLinks,
                    )
                  : null
              }
              onCandidateRecordingSaved={linkCandidateRecording}
              personal={detailEntry}
              updateEntry={updateEntry}
              tagInput={tagInput}
              setTagInput={setTagInput}
              onEdit={() => selected?.local && setLocalDraft(selected.local)}
              onStagePublished={() => selected && openRevisionDraft(selected)}
              onDelete={() => selected && deleteLocal(selected.id)}
              onPublish={() => selected && setPublishId(selected.id)}
              onMerge={() => selected && mergeLocal(selected.id)}
              latestCatalogRevision={
                itemById.get(selected?.local?.publishedId ?? "")?.published?.revision ?? null
              }
              canMerge={Boolean(
                selected?.local?.publishedId && itemById.get(selected.local.publishedId)?.published,
              )}
            />
            {selected && comparison.length > 0 && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="h6">Compare with my current route</Typography>
                <SelectField
                  label="Current Using route"
                  value={replaceId}
                  options={[
                    ["", "Choose a route"],
                    ...comparison.map((item): [string, string] => [
                      item.id,
                      `${comboDisplayName(item, entry(item.id))} · ${item.id}`,
                    ]),
                  ]}
                  onChange={setReplaceId}
                  width={220}
                />
                {replaceId && (
                  <Stack spacing={1} sx={{ mt: 1 }}>
                    <Typography variant="body2">
                      Current:{" "}
                      {comparison.find((item) => item.id === replaceId)?.damage || "unknown"} damage
                      · {comparison.find((item) => item.id === replaceId)?.pips} pips
                    </Typography>
                    <Typography variant="body2">
                      Candidate: {selected.damage || "unknown"} damage · {selected.pips} pips
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Use instead retires the current route and assigns its
                      {entry(replaceId).role ? ` ${entry(replaceId).role} role` : " unset role"}
                      {entry(replaceId).condition
                        ? ` and condition “${entry(replaceId).condition}”`
                        : " and no condition"}{" "}
                      to this candidate.
                    </Typography>
                    <Button variant="contained" onClick={useInstead}>
                      Use instead
                    </Button>
                  </Stack>
                )}
              </Paper>
            )}
          </Box>
        </>
      )}
      <PortraitPicker
        open={Boolean(picker)}
        kind={picker ?? "character"}
        options={imageOptions}
        character={character}
        localCount={(id) =>
          picker === "support"
            ? countLocalCombos(workspace.localCombos, character, id)
            : countLocalCombos(workspace.localCombos, id)
        }
        candidateCount={
          candidatesLoaded
            ? (id) =>
                picker === "support"
                  ? countCandidates(upstreamCandidates, character, id)
                  : countCandidates(upstreamCandidates, id)
            : undefined
        }
        onClose={() => setPicker(null)}
        onChoose={(id) => {
          setWorkspace((old) =>
            picker === "character"
              ? { ...old, characterId: id, supportId: "", starter: "" }
              : { ...old, characterId: character, supportId: id, starter: "" },
          );
          setSelectedId(null);
          setPicker(null);
        }}
      />
      <LocalComboDialog
        draft={localDraft}
        personal={localDraft?.id ? entry(localDraft.id) : emptyPersonalEntry()}
        onClose={() => setLocalDraft(null)}
        onSave={saveLocal}
      />
      <PublishDialog
        item={itemById.get(publishId ?? "") ?? null}
        candidateSubmissionId={
          workspace.candidateSubmissions[publishId ?? ""]?.originCandidateId ??
          workspace.candidateSubmissions[publishId ?? ""]?.id ??
          ""
        }
        linkedRecording={
          recordings.find(
            (recording) =>
              recording.id === workspace.recordingLinks[publishId ?? ""]?.recordingId &&
              isLocalMp4(recording),
          ) ?? null
        }
        linkedYouTubeUrl={linkedYouTubeUrlFor(publishId ?? "")}
        onClose={() => setPublishId(null)}
        onPublished={onPublished}
        onYouTubeUploaded={(url) =>
          setWorkspace((old) => ({
            ...old,
            localCombos: old.localCombos.map((combo) =>
              combo.id === publishId ? { ...combo, youtubeUrl: url } : combo,
            ),
          }))
        }
        onVideoLinked={refreshRecordings}
      />
      <Dialog
        open={Boolean(recordingPickerId)}
        onClose={() => !importingMp4 && setRecordingPickerId(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Link a local MP4</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <TextField
              label="Search recordings"
              size="small"
              value={recordingSearch}
              onChange={(event) => setRecordingSearch(event.target.value)}
              autoFocus
            />
            {recordingsError && <Alert severity="error">{recordingsError}</Alert>}
            <Button
              onClick={() => void refreshRecordings()}
              disabled={!window.electronAPI?.recordings}
              sx={{ alignSelf: "flex-start" }}
            >
              Refresh library
            </Button>
            <Box sx={{ maxHeight: 360, overflowY: "auto" }}>
              {pickerRecordings.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  {recordingSearch
                    ? "No MP4s match this search."
                    : "No MP4s in the recording library yet. You can import one from disk."}
                </Typography>
              )}
              {pickerRecordings.map((recording) => (
                <Button
                  key={recording.id}
                  fullWidth
                  onClick={() => recordingPickerId && linkRecording(recordingPickerId, recording)}
                  sx={{ display: "block", textAlign: "left", overflowWrap: "anywhere" }}
                >
                  {recording.name}
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {recording.id} · {new Date(recording.modifiedAt).toLocaleDateString()}
                  </Typography>
                </Button>
              ))}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRecordingPickerId(null)} disabled={importingMp4}>
            Cancel
          </Button>
          <Button
            onClick={() => void importMp4()}
            disabled={importingMp4 || !window.electronAPI?.recordings}
            variant="contained"
          >
            {importingMp4 ? "Importing…" : "Import MP4 from disk"}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={legacyImportOpen}
        onClose={() => setLegacyImportOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Import from Dev combo editor</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Choose a Dev combo to copy locally, or attach its recording to a combo already on this
              page. Dev editor data stays untouched.
            </Typography>
            {legacyCombos.length === 0 && (
              <Typography>No Dev editor combos found on this device.</Typography>
            )}
            <Box sx={{ maxHeight: 300, overflowY: "auto" }}>
              {legacyCombos.map(({ key, combo }) => (
                <Button
                  key={key}
                  fullWidth
                  disabled={Boolean(workspace.legacyImports[key])}
                  variant={legacySelection === key ? "contained" : "text"}
                  onClick={() => {
                    setLegacySelection(key);
                    setLegacyTargetId("");
                  }}
                  sx={{ display: "block", textAlign: "left", overflowWrap: "anywhere" }}
                >
                  {combo.name || "Unnamed Dev combo"} · {combo.character} / {combo.support}
                  {legacyComboMediaGap(
                    combo,
                    recordingsById.get(combo.recordingId ?? "") ?? null,
                    recordingsLoaded,
                  ) && (
                    <Chip
                      size="small"
                      label={legacyComboMediaGap(
                        combo,
                        recordingsById.get(combo.recordingId ?? "") ?? null,
                        recordingsLoaded,
                      )}
                      color="warning"
                      variant="outlined"
                      sx={{ ml: 1 }}
                    />
                  )}
                  <Typography variant="caption" sx={{ display: "block" }}>
                    {combo.route} ·{" "}
                    {workspace.legacyImports[key]
                      ? "Already imported"
                      : combo.recordingId && /\.mp4$/i.test(combo.recordingId)
                        ? `Recording: ${combo.recordingId}`
                        : "No linked MP4"}
                  </Typography>
                </Button>
              ))}
            </Box>
            {selectedLegacy && (
              <>
                <SelectField
                  label="Destination"
                  value={legacyTargetId}
                  width={0}
                  options={[
                    ["", "Create a local combo"],
                    ...items
                      .filter(
                        (item) =>
                          item.characterId === slugComboText(selectedLegacy.combo.character) &&
                          item.supportId === slugComboText(selectedLegacy.combo.support),
                      )
                      .map((item): [string, string] => [
                        item.id,
                        `${comboDisplayName(item, entry(item.id))} · ${item.route}`,
                      ]),
                  ]}
                  onChange={setLegacyTargetId}
                />
                {legacyTargetId && !selectedLegacy.combo.recordingId?.match(/\.mp4$/i) && (
                  <Alert severity="info">
                    This Dev combo has no recording to attach. Choose “Create a local combo” to
                    import its route.
                  </Alert>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLegacyImportOpen(false)}>Close</Button>
          <Button
            variant="contained"
            onClick={importLegacy}
            disabled={
              !selectedLegacy ||
              Boolean(legacyTargetId && !selectedLegacy.combo.recordingId?.match(/\.mp4$/i))
            }
          >
            {legacyTargetId ? "Link recording" : "Create local combo"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function ComboDetail({
  item,
  mediaGap,
  recordingLink,
  linkedYouTubeUrl,
  recording,
  recordingApiAvailable,
  recordingDisabledReason,
  onRecord,
  recordingsLoaded,
  recordingsError,
  onChooseRecording,
  onUnlinkRecording,
  onOpenRecording,
  candidateSubmission,
  candidateAvailable,
  candidateSubmitting,
  candidateProgress,
  onSubmitCandidate,
  onCandidateChanged,
  candidateRecording,
  onCandidateRecordingSaved,
  personal,
  updateEntry,
  tagInput,
  setTagInput,
  onEdit,
  onStagePublished,
  onDelete,
  onPublish,
  onMerge,
  latestCatalogRevision,
  canMerge,
}: {
  item: ComboItem | null;
  mediaGap: ComboMediaGap;
  recordingLink?: { recordingId: string; name: string };
  linkedYouTubeUrl: string;
  recording: RecordedVideo | null;
  recordingApiAvailable: boolean;
  recordingDisabledReason: string;
  onRecord: () => void;
  recordingsLoaded: boolean;
  recordingsError: string;
  onChooseRecording: () => void;
  onUnlinkRecording: () => void;
  onOpenRecording: (recordingId: string) => void;
  candidateSubmission?: { id: string; submittedAt: string };
  candidateAvailable: boolean;
  candidateSubmitting: boolean;
  candidateProgress: number | null;
  onSubmitCandidate: () => void;
  onCandidateChanged: (candidate: ComboCandidate, recording?: RecordedVideo) => Promise<void>;
  candidateRecording: RecordedVideo | null;
  onCandidateRecordingSaved: (candidate: ComboCandidate, recording: RecordedVideo) => void;
  personal: PersonalComboEntry;
  updateEntry: (id: string, patch: Partial<PersonalComboEntry>) => void;
  tagInput: string;
  setTagInput: (value: string) => void;
  onEdit: () => void;
  onStagePublished: () => void;
  onDelete: () => void;
  onPublish: () => void;
  onMerge: () => void;
  latestCatalogRevision: number | null;
  canMerge: boolean;
}) {
  if (!item)
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography color="text.secondary">Select a combo to see its details.</Typography>
      </Paper>
    );
  const notes = normalizeComboNotes(
    item.candidate?.combo.notes ?? item.local?.editorNotes ?? item.published?.notes,
  );
  const youtubeVideo = comboYouTubeVideo(item, linkedYouTubeUrl);
  const videoUrl = youtubeVideo?.videoId
    ? `https://www.youtube-nocookie.com/embed/${youtubeVideo.videoId}${youtubeVideo.startSeconds ? `?start=${youtubeVideo.startSeconds}` : ""}`
    : null;
  const pickReason =
    item.candidate?.combo.editorPickReason ??
    item.local?.editorPickReason ??
    item.published?.editorPickReason;
  const pickContext =
    item.candidate?.combo.editorPickContext ??
    item.local?.editorPickContext ??
    item.published?.editorPickContext;
  const editorName =
    item.candidate?.combo.name ??
    item.local?.editorName ??
    item.local?.publishedBase?.name ??
    item.published?.name ??
    "";
  const editorDifficulty =
    item.candidate?.combo.difficulty ??
    item.local?.editorDifficulty ??
    item.local?.publishedBase?.difficulty ??
    item.published?.difficulty ??
    null;
  const nameSource = personal.name.trim()
    ? "My name"
    : item.local && !item.local.originCatalog
      ? "Local combo name"
      : item.name.trim()
        ? "Editor name"
        : "";
  const displayedRecording = recording ?? candidateRecording;
  const candidateVideoShownAbove = Boolean(
    candidateRecording && displayedRecording?.id === candidateRecording.id,
  );
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={2}>
            <Typography variant="subtitle2">Displayed combo</Typography>
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Chip
                  size="small"
                  label={
                    item.local?.originCatalog
                      ? "Local revision"
                      : item.source === "Unavailable"
                        ? "Catalog unavailable"
                        : item.source
                  }
                  color={
                    item.local
                      ? "info"
                      : item.candidate
                        ? "secondary"
                        : item.source === "Unavailable"
                          ? "warning"
                          : "default"
                  }
                />
                {item.candidate && (
                  <Chip
                    size="small"
                    label={`Candidate · ${candidateReviewStatus(item.candidate)}`}
                    color="secondary"
                    variant="outlined"
                  />
                )}
                {pickReason && <Chip size="small" label="Editor's pick" color="warning" />}
                {mediaGap && (
                  <Chip size="small" label={mediaGap} color="warning" variant="outlined" />
                )}
                <Typography variant="caption" color="text.secondary">
                  {displayName(item.characterId)} / {displayName(item.supportId)}
                </Typography>
              </Stack>
              <Typography variant="h6" sx={{ mt: 1 }}>
                {comboDisplayName(item, personal)}
              </Typography>
              {nameSource && (
                <Typography variant="caption" color="text.secondary">
                  {nameSource}
                </Typography>
              )}
              {personal.name.trim() && editorName && (
                <Typography variant="body2" color="text.secondary">
                  Editor name: {editorName}
                </Typography>
              )}
            </Box>
            {(displayedRecording || (recordingLink && !youtubeVideo?.videoId)) && (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1}>
                  <Typography variant="subtitle2">Local video</Typography>
                  {displayedRecording ? (
                    <>
                      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                        {displayedRecording.name}
                      </Typography>
                      <Box
                        component="video"
                        key={displayedRecording.id}
                        src={displayedRecording.url}
                        controls
                        preload="metadata"
                        sx={{ width: "100%", maxHeight: 360, bgcolor: "black" }}
                      />
                    </>
                  ) : recordingLink &&
                    recordingApiAvailable &&
                    !recordingsLoaded &&
                    !recordingsError ? (
                    <Typography variant="body2" color="text.secondary">
                      Loading local video…
                    </Typography>
                  ) : recordingLink ? (
                    <Alert severity="warning">
                      Linked video unavailable: {recordingLink.name || recordingLink.recordingId}
                    </Alert>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No local video linked.
                    </Typography>
                  )}
                  {recordingsError && recordingLink && (
                    <Alert severity="error">{recordingsError}</Alert>
                  )}
                </Stack>
              </Paper>
            )}
            {youtubeVideo?.videoId && (
              <Typography variant="subtitle2">
                {youtubeVideo.source === "Catalog"
                  ? "Catalog YouTube video"
                  : `${youtubeVideo.source} YouTube video`}
              </Typography>
            )}
            {videoUrl ? (
              <Box
                component="iframe"
                title={`Combo video: ${item.route}`}
                src={videoUrl}
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                allow="clipboard-write; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                sx={{ width: "100%", aspectRatio: "16 / 9", border: 0 }}
              />
            ) : youtubeVideo ? (
              <Alert severity="warning">
                The {youtubeVideo.source.toLowerCase()} YouTube link is invalid. Review it before
                publishing.
              </Alert>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No YouTube video linked.
              </Typography>
            )}
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Chip label={`${item.damage || "—"} damage`} />
              <Chip label={`${item.pips} pips`} />
              <Chip label={`${item.flow} flow`} />
              <Chip label={`Difficulty ${effectiveDifficulty(item, personal) ?? "—"}`} />
              {effectiveDifficulty(item, personal) !== null && (
                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                  {personal.difficulty !== null ? "My difficulty" : "Editor difficulty"}
                </Typography>
              )}
            </Stack>
            <Box>
              <Typography variant="overline">Route</Typography>
              <Typography
                sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
              >
                <ComboRouteText route={item.route} notes={notes} />
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              {personal.status && <Chip size="small" label={personal.status} />}
              {personal.role && <Chip size="small" label={personal.role} variant="outlined" />}
              {item.screenPosition && (
                <Chip size="small" label={item.screenPosition} variant="outlined" />
              )}
              {item.hitconfirm !== "unknown" && (
                <Chip size="small" label={`Hitconfirm: ${item.hitconfirm}`} variant="outlined" />
              )}
              {item.counterhit === "yes" && (
                <Chip size="small" label="Counterhit required" variant="outlined" />
              )}
              {personal.tags.map((tag) => (
                <Chip key={tag} size="small" label={`#${tag}`} variant="outlined" />
              ))}
            </Stack>
            {personal.condition && (
              <Box>
                <Typography variant="overline">When I use it</Typography>
                <Typography variant="body2">{personal.condition}</Typography>
              </Box>
            )}
            {personal.note && (
              <Box>
                <Typography variant="overline">Personal note</Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {personal.note}
                </Typography>
              </Box>
            )}
            {personal.status === "Dismissed" && personal.dismissalReason && (
              <Box>
                <Typography variant="overline">Reason for dismissal</Typography>
                <Typography variant="body2">{personal.dismissalReason}</Typography>
              </Box>
            )}
            {pickReason && (
              <Box>
                <Typography variant="subtitle2">Why the editor picked it</Typography>
                {pickContext && (
                  <Typography variant="caption" color="text.secondary">
                    {pickContext}
                  </Typography>
                )}
                <Typography variant="body2">{pickReason}</Typography>
              </Box>
            )}
            {notes.length > 0 && (
              <Box>
                <Typography variant="subtitle2">Editor notes</Typography>
                {notes.map((note) => (
                  <Box key={note.id} sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {comboNoteCategoryLabel(note.category)}
                    </Typography>
                    <Typography variant="body2">{note.text}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={2}>
            <Typography variant="subtitle2">Edit my data</Typography>
            <TextField
              size="small"
              label="My name"
              value={personal.name}
              onChange={(event) => updateEntry(item.id, { name: event.target.value })}
              helperText={
                editorName ? `Editor name: ${editorName}` : "Leave blank to use the combo name"
              }
            />
            <Box
              sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1 }}
            >
              <SelectField
                label="Status"
                value={personal.status}
                width={0}
                options={[
                  ["", "Blank / not tracked"],
                  ...comboStatuses.map((status): [string, string] => [status, status]),
                ]}
                onChange={(value) => updateEntry(item.id, { status: value as ComboStatus })}
              />
              <SelectField
                label="Role"
                value={personal.role}
                width={0}
                options={[
                  ["", "Not set"],
                  ["Autopilot", "Autopilot"],
                  ["Situational", "Situational"],
                ]}
                onChange={(value) => updateEntry(item.id, { role: value as ComboRole })}
              />
              <SelectField
                label="My difficulty"
                value={String(personal.difficulty ?? "")}
                width={0}
                options={[
                  ["", `Editor: ${editorDifficulty ?? "unrated"}`],
                  ...[1, 2, 3, 4, 5].map((n): [string, string] => [String(n), String(n)]),
                ]}
                onChange={(value) =>
                  updateEntry(item.id, { difficulty: value ? Number(value) : null })
                }
              />
              <TextField
                size="small"
                label="When I use it"
                value={personal.condition}
                onChange={(e) => updateEntry(item.id, { condition: e.target.value })}
                sx={{ gridColumn: { sm: "span 2" } }}
              />
              {personal.status === "Dismissed" && (
                <TextField
                  size="small"
                  label="Reason for dismissal (optional)"
                  value={personal.dismissalReason}
                  onChange={(e) => updateEntry(item.id, { dismissalReason: e.target.value })}
                  sx={{ gridColumn: { sm: "span 2" } }}
                />
              )}
              <TextField
                size="small"
                label="Personal note"
                multiline
                minRows={2}
                value={personal.note}
                onChange={(e) => updateEntry(item.id, { note: e.target.value })}
                sx={{ gridColumn: { sm: "span 2" } }}
              />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                My tags
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", mb: 1 }}>
                {personal.tags.map((tag) => (
                  <Chip
                    key={tag}
                    size="small"
                    label={`#${tag}`}
                    onDelete={() =>
                      updateEntry(item.id, { tags: personal.tags.filter((value) => value !== tag) })
                    }
                  />
                ))}
              </Stack>
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  label="Add tag"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                />
                <Button
                  onClick={() => {
                    const tag = tagInput.trim().replace(/^#/, "").toLowerCase();
                    if (tag && !personal.tags.includes(tag))
                      updateEntry(item.id, { tags: [...personal.tags, tag] });
                    setTagInput("");
                  }}
                >
                  Add
                </Button>
              </Stack>
            </Box>
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle2">Local video controls</Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Tooltip
                title={
                  recordingDisabledReason ||
                  (recordingLink
                    ? "The finished recording will replace this combo's current local video link."
                    : "")
                }
              >
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={onRecord}
                    disabled={Boolean(recordingDisabledReason)}
                  >
                    Record for this combo
                  </Button>
                </span>
              </Tooltip>
              <Button
                size="small"
                variant="outlined"
                onClick={onChooseRecording}
                disabled={!recordingApiAvailable}
              >
                {recordingLink ? "Replace local video" : "Link local MP4"}
              </Button>
              {displayedRecording && (
                <Button size="small" onClick={() => onOpenRecording(displayedRecording.id)}>
                  Open in recording library
                </Button>
              )}
              {recordingLink && !candidateVideoShownAbove && (
                <Button size="small" onClick={onUnlinkRecording}>
                  Unlink
                </Button>
              )}
            </Stack>
            {!recordingApiAvailable && (
              <Typography variant="caption" color="text.secondary">
                Local video links require the desktop app.
              </Typography>
            )}
            {candidateSubmission && (
              <Typography variant="caption" color="text.secondary">
                Submitted as candidate on{" "}
                {new Date(candidateSubmission.submittedAt).toLocaleString()}.
              </Typography>
            )}
            {recording && recordingApiAvailable && window.electronAPI?.comboCandidates && (
              <Button
                size="small"
                variant="outlined"
                onClick={onSubmitCandidate}
                disabled={candidateSubmitting || !candidateAvailable}
                sx={{ alignSelf: "flex-start" }}
              >
                {candidateSubmitting
                  ? `Submitting${candidateProgress === null ? "…" : ` ${candidateProgress}%`}`
                  : candidateSubmission
                    ? "Submit another candidate with MP4"
                    : "Submit as candidate with MP4"}
              </Button>
            )}
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle2">Editor / catalog data</Typography>
            {item.candidate && (
              <ComboCandidateReview
                candidate={item.candidate}
                onChanged={onCandidateChanged}
                savedRecording={candidateRecording}
                savedVideoShownAbove={candidateVideoShownAbove}
                onRecordingSaved={(recording) =>
                  onCandidateRecordingSaved(item.candidate!, recording)
                }
              />
            )}
            {item.published && (
              <Button
                variant="outlined"
                size="small"
                onClick={onStagePublished}
                sx={{ alignSelf: "flex-start" }}
              >
                Edit catalog combo locally
              </Button>
            )}
            {item.local && (
              <>
                {item.local.publishedId && (
                  <Chip
                    size="small"
                    label={`Catalog ID: ${item.local.publishedId}`}
                    sx={{ alignSelf: "flex-start" }}
                  />
                )}
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                  <Button size="small" variant="outlined" onClick={onEdit}>
                    Edit combo data
                  </Button>
                  <Button size="small" variant="outlined" onClick={onPublish}>
                    {item.local.needsCatalogPublication
                      ? "Publish candidate"
                      : youtubeVideo?.videoId
                        ? "Review catalog publication"
                        : "Add YouTube video for catalog"}
                  </Button>
                  {item.local.publishedId && canMerge && (
                    <Button size="small" variant="outlined" onClick={onMerge}>
                      Merge catalog update
                    </Button>
                  )}
                  <Button size="small" color="error" onClick={onDelete}>
                    Delete local combo
                  </Button>
                </Stack>
                {!youtubeVideo?.videoId && (
                  <Typography variant="caption" color="text.secondary">
                    Catalog publication requires a YouTube video. This form can upload a linked MP4
                    or accept a YouTube URL.
                  </Typography>
                )}
                {item.local.publishedId &&
                  latestCatalogRevision !== null &&
                  item.local.publishedRevision !== undefined &&
                  latestCatalogRevision > item.local.publishedRevision && (
                    <Alert severity="info">
                      Catalog revision {latestCatalogRevision} is newer than this local copy.
                    </Alert>
                  )}
              </>
            )}
            {!item.local && !item.published && !item.candidate && (
              <Typography variant="body2" color="text.secondary">
                No editable catalog data is available for this combo.
              </Typography>
            )}
          </Stack>
        </Paper>
      </Stack>
    </Paper>
  );
}
