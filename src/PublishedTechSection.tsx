import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ComboTable, ComboWorkspace, type ComboTableRow } from "./ComboTable";
import { comboStarterFromRoute } from "./combo-starter";
import {
  ComboInlineFilters,
  emptyComboInlineFilters,
  matchesComboInlineFilters,
} from "./ComboInlineFilters";
import { ComboRouteText } from "./ComboRouteText";
import { comboNoteCategoryLabel, comboNoteRangeOffsets, normalizeComboNotes } from "./combo-notes";
import {
  fetchPublishedCatalog,
  readPublishedCatalogCache,
  writePublishedCatalogCache,
  type PublishedCatalog,
  type PublishedCombo,
  type PublishedMove,
} from "./published-catalog";

const names: Record<string, string> = {
  "avatar-aang": "Avatar Aang",
  "nightmare-korra": "Nightmare Korra",
  "dark-avatar-unalaq": "Dark Avatar Unalaq",
  "firelord-sozin": "Firelord Sozin",
  "lo-and-li": "Lo and Li",
  "ming-hua": "Ming-Hua",
  "p-li": "P'Li",
};

function displayName(id: string): string {
  return (
    names[id] ??
    id
      .split("-")
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function formatCosts(costs: Record<string, number>): string {
  return (
    Object.entries(costs)
      .filter(([, amount]) => amount !== 0)
      .map(([name, amount]) => `${amount} ${name}`)
      .join(" · ") || "None"
  );
}

function MoveCard({ move }: { move: PublishedMove }) {
  const frames = [
    ["Startup", move.startup],
    ["Active", move.active],
    ["Recovery", move.recovery],
    ["On block", move.onBlock],
    ["Blockstun", move.blockstun],
    ["Hitstun", move.hitstun],
  ] as const;
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="h6">
            {move.input}
            {move.label ? ` · ${move.label}` : ""}
          </Typography>
          {move.supportId && (
            <Typography variant="body2" color="text.secondary">
              Support: {displayName(move.supportId)}
            </Typography>
          )}
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 1 }}>
            {frames.map(([label, value]) => (
              <Typography key={label} variant="body2">
                {label}: {value ?? "—"}
              </Typography>
            ))}
          </Stack>
          <Typography variant="body2">Cost: {formatCosts(move.resourceCosts)}</Typography>
          {move.mechanics.length > 0 && (
            <Typography variant="body2">Mechanics: {move.mechanics.join(", ")}</Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function PublishedComboDetails({ combo }: { combo: PublishedCombo | null }) {
  const notes = normalizeComboNotes(combo?.notes);
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", textAlign: "left" }}>
      {combo ? (
        <>
          <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
            <Typography variant="overline" color="text.secondary">
              Combo details
            </Typography>
            <Typography variant="h6" sx={{ lineHeight: 1.3 }}>
              {displayName(combo.characterId)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Support: {displayName(combo.supportId)}
            </Typography>
          </Box>
          <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
            <Typography variant="overline" color="text.secondary">
              Route
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {combo.routingMode === "unique" ? "Unique routing" : "Autopilot"}
            </Typography>
            <Typography
              variant="body1"
              sx={{
                fontFamily: "monospace",
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              <ComboRouteText route={combo.route} notes={notes} />
            </Typography>
          </Box>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "repeat(2, minmax(0, 1fr))",
                sm: "repeat(3, minmax(0, 1fr))",
              },
              gap: 1,
              p: 2,
            }}
          >
            {[
              ["Damage", combo.damage],
              ["Position", combo.screenPosition || "—"],
              ["Cost", formatCosts(combo.resourceCosts)],
            ].map(([label, value]) => (
              <Box
                key={label}
                sx={{ minWidth: 0, p: 1.5, borderRadius: 1, bgcolor: "action.hover" }}
              >
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>
          {combo.mechanics.length > 0 && (
            <Box sx={{ px: 2, pb: 2 }}>
              <Typography variant="overline" color="text.secondary">
                Mechanics
              </Typography>
              <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75, mt: 0.5 }}>
                {combo.mechanics.map((mechanic) => (
                  <Chip key={mechanic} label={mechanic} size="small" variant="outlined" />
                ))}
              </Stack>
            </Box>
          )}
          {notes.length > 0 && (
            <Box sx={{ px: 2, pb: 2 }}>
              <Typography variant="overline" color="text.secondary">
                Notes
              </Typography>
              <Stack spacing={1} sx={{ mt: 0.5 }}>
                {notes.map((note) => (
                  <Box key={note.id} sx={{ p: 1.5, borderRadius: 1, bgcolor: "action.hover" }}>
                    <Typography variant="caption" color="text.secondary">
                      {comboNoteCategoryLabel(note.category)} ·{" "}
                      {note.range?.excerpt ?? "Whole combo"}
                      {note.range && !comboNoteRangeOffsets(combo.route, note.range)
                        ? " · Range needs review"
                        : ""}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                    >
                      {note.text}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </>
      ) : (
        <Typography color="text.secondary" sx={{ p: 2 }}>
          Select a combo to see its details.
        </Typography>
      )}
    </Paper>
  );
}

function PublishedComboPlayer({ combo }: { combo: PublishedCombo | null }) {
  if (!combo) {
    return <Typography color="text.secondary">Select a combo to play its video.</Typography>;
  }
  const youtubeUrl =
    "https://www.youtube.com/watch?v=" +
    combo.youtubeVideoId +
    (combo.startSeconds ? "&t=" + combo.startSeconds + "s" : "");
  const embedUrl =
    "https://www.youtube-nocookie.com/embed/" +
    combo.youtubeVideoId +
    (combo.startSeconds ? "?start=" + combo.startSeconds : "");
  return (
    <Stack spacing={1} sx={{ minWidth: 0, minHeight: 360 }}>
      <Box
        key={combo.id}
        component="iframe"
        title={"Combo video: " + combo.route}
        src={embedUrl}
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        allow="clipboard-write; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        sx={{ width: "100%", aspectRatio: "16 / 9", border: 0 }}
      />
      <Typography variant="body2" color="text.secondary">
        Video playback requires internet.{" "}
        <a href={youtubeUrl} target="_blank" rel="noopener noreferrer">
          Open on YouTube
        </a>
      </Typography>
    </Stack>
  );
}

export function PublishedTechSection({
  active,
  view,
  showHeading = true,
}: {
  active: boolean;
  view: "moves" | "combos";
  showHeading?: boolean;
}) {
  const [catalog, setCatalog] = useState<PublishedCatalog | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheWarning, setCacheWarning] = useState(false);
  const [characterId, setCharacterId] = useState("all");
  const [supportId, setSupportId] = useState("all");
  const [selectedComboId, setSelectedComboId] = useState<string | null>(null);
  const [comboInlineFilters, setComboInlineFilters] = useState(emptyComboInlineFilters);
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      nextController.abort();
    }, 10_000);
    setRefreshing(true);
    setError(null);
    try {
      const nextCatalog = await fetchPublishedCatalog(fetch, undefined, nextController.signal);
      window.clearTimeout(timeout);
      if (nextController.signal.aborted) return;
      setCatalog(nextCatalog);
      try {
        await writePublishedCatalogCache(nextCatalog);
        if (!nextController.signal.aborted) setCacheWarning(false);
      } catch {
        if (!nextController.signal.aborted) setCacheWarning(true);
      }
    } catch (reason) {
      if (timedOut) {
        setError("The published catalog request timed out.");
      } else if (!nextController.signal.aborted) {
        setError(
          reason instanceof Error ? reason.message : "The published catalog could not be loaded.",
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === nextController) {
        controller.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setRefreshing(true);
    void (async () => {
      try {
        const cached = await readPublishedCatalogCache();
        if (!cancelled && cached) setCatalog((current) => current ?? cached);
      } catch {
        if (!cancelled) setCacheWarning(true);
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
      controller.current?.abort();
    };
  }, [active, refresh]);

  const characters = useMemo(
    () =>
      [
        ...new Set(
          (view === "moves" ? (catalog?.moves ?? []) : (catalog?.combos ?? [])).map(
            (item) => item.characterId,
          ),
        ),
      ].sort(),
    [catalog, view],
  );
  const selectedCharacter = characters.includes(characterId) ? characterId : "all";
  const supports = useMemo(
    () =>
      [
        ...new Set(
          (catalog?.combos ?? [])
            .filter(
              (combo) => selectedCharacter === "all" || combo.characterId === selectedCharacter,
            )
            .map((combo) => combo.supportId),
        ),
      ].sort(),
    [catalog, selectedCharacter],
  );
  const selectedSupport = supports.includes(supportId) ? supportId : "all";
  const moves = useMemo(
    () =>
      catalog?.moves.filter(
        (move) => selectedCharacter === "all" || move.characterId === selectedCharacter,
      ) ?? [],
    [catalog, selectedCharacter],
  );
  const combos = useMemo(
    () =>
      catalog?.combos.filter(
        (combo) =>
          (selectedCharacter === "all" || combo.characterId === selectedCharacter) &&
          (selectedSupport === "all" || combo.supportId === selectedSupport),
      ) ?? [],
    [catalog, selectedCharacter, selectedSupport],
  );
  const comboRows = useMemo<ComboTableRow[]>(() => {
    const movesById = new Map((catalog?.moves ?? []).map((move) => [move.id, move]));
    return combos.map((combo) => {
      const starterMove = movesById.get(combo.moveIds[0]);
      return {
        id: combo.id,
        starter: comboStarterFromRoute(
          combo.route,
          combo.starterIsNonAttackStance ??
            (starterMove?.isStanceParent === true && starterMove.isNonAttack === true),
        ),
        position: combo.screenPosition ?? "",
        damage: combo.damage,
        pips: combo.resourceCosts.pips ?? 0,
        flow: combo.resourceCosts.flow ?? 0,
        requiresCounterhit: combo.mechanics.some((mechanic) =>
          /^(?:requires\s+)?counterhit$/i.test(mechanic.trim()),
        ),
        route: combo.route,
        notes: normalizeComboNotes(combo.notes),
      };
    });
  }, [catalog?.moves, combos]);
  const visibleComboRows = useMemo(
    () => comboRows.filter((row) => matchesComboInlineFilters(row, comboInlineFilters)),
    [comboInlineFilters, comboRows],
  );
  const visibleComboIds = new Set(visibleComboRows.map((row) => row.id));
  const selectedCombo =
    combos.find((combo) => combo.id === selectedComboId && visibleComboIds.has(combo.id)) ?? null;
  const items = view === "moves" ? moves : visibleComboRows;

  return (
    <Stack spacing={2} sx={{ pb: 4 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        {showHeading && (
          <Typography variant="h5" sx={{ flexGrow: 1 }}>
            {view === "combos" ? "Combos" : "Tech"}
          </Typography>
        )}
        <Button
          variant="outlined"
          onClick={() => void refresh()}
          disabled={refreshing}
          sx={{ ml: showHeading ? 0 : "auto" }}
        >
          Refresh
        </Button>
      </Stack>
      {catalog && (
        <Typography variant="body2" color="text.secondary">
          Fetched {new Date(catalog.fetchedAt).toLocaleString()}
          {refreshing ? " · Checking for updates…" : ""}
        </Typography>
      )}
      {cacheWarning && (
        <Alert severity="warning">
          Offline storage is unavailable. This catalog may not be available next time you open the
          app.
        </Alert>
      )}
      {error && (
        <Alert severity={catalog ? "warning" : "error"}>
          {error}
          {catalog ? " Showing the saved catalog." : ""}
        </Alert>
      )}
      {!catalog && refreshing && <CircularProgress size={28} aria-label="Loading published tech" />}
      {catalog && (
        <>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center" }}>
            <TextField
              select
              size="small"
              label="Character"
              value={selectedCharacter}
              onChange={(event) => {
                setCharacterId(event.target.value);
                setComboInlineFilters(emptyComboInlineFilters());
              }}
              sx={{ minWidth: 180 }}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            >
              <option value="all">All characters</option>
              {characters.map((id) => (
                <option key={id} value={id}>
                  {displayName(id)}
                </option>
              ))}
            </TextField>
            {view === "combos" && (
              <TextField
                select
                size="small"
                label="Support"
                value={selectedSupport}
                onChange={(event) => {
                  setSupportId(event.target.value);
                  setComboInlineFilters(emptyComboInlineFilters());
                }}
                sx={{ minWidth: 180 }}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              >
                <option value="all">All supports</option>
                {supports.map((id) => (
                  <option key={id} value={id}>
                    {displayName(id)}
                  </option>
                ))}
              </TextField>
            )}
            {view === "combos" && (
              <ComboInlineFilters
                starters={comboRows.map((row) => row.starter)}
                filters={comboInlineFilters}
                onChange={setComboInlineFilters}
              />
            )}
          </Box>
          {items.length === 0 ? (
            <Alert severity="info">
              {catalog.moves.length === 0 && catalog.combos.length === 0
                ? error
                  ? "No entries are in the saved catalog."
                  : "No tech has been published yet."
                : `No published ${view} match these filters.`}
            </Alert>
          ) : view === "moves" ? (
            <Stack spacing={1.5}>
              {moves.map((move) => (
                <Box key={move.id}>
                  {selectedCharacter === "all" && (
                    <Typography variant="subtitle2">{displayName(move.characterId)}</Typography>
                  )}
                  <MoveCard move={move} />
                </Box>
              ))}
            </Stack>
          ) : (
            <ComboWorkspace>
              <Stack spacing={2} sx={{ minWidth: 0 }}>
                <ComboTable
                  rows={visibleComboRows}
                  selectedId={selectedCombo?.id ?? null}
                  onSelect={setSelectedComboId}
                />
                <PublishedComboDetails combo={selectedCombo} />
              </Stack>
              <PublishedComboPlayer combo={selectedCombo} />
            </ComboWorkspace>
          )}
        </>
      )}
    </Stack>
  );
}
