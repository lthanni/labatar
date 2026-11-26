import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import supportMap from "../electron/support-map.json";
import { CharacterTechNotes } from "./CharacterTechNotes";
import { CharacterTechPage } from "./CharacterTechPage";
import { CharacterPlayersPage } from "./CharacterPlayersPage";
import type { GetScopePortrait } from "./ScopePortrait";
import { ComboSourceCounts, CombosPage } from "./CombosPage";
import { countCandidates, type ComboCandidate } from "./combo-candidates";
import {
  countLocalCombos,
  readComboWorkspace,
  slugComboText,
  type LocalCombo,
} from "./combo-gameplan";
import { characterTechOpenComboEvent } from "./character-tech";
import type { WebArtworkLibrary } from "./web/artwork";

const sections = [
  ["combos", "Combos"],
  ["tech", "Tech"],
  ["pressure", "Pressure"],
  ["oki", "Oki"],
  ["guide", "Guides"],
  ["players", "Players"],
] as const;
type Section = (typeof sections)[number][0];
type EntrySection = Exclude<Section, "combos" | "players">;
type Selection = { characterId: string; supportId: string };
type EntrySelection = Selection & { id: string };
const selectionKey = "labatar-character-selection-v1";
const sectionKey = "labatar-character-section-v1";
const entrySelectionKeys: Record<EntrySection, string> = {
  tech: "labatar-character-tech-guide-v1",
  pressure: "labatar-character-pressure-entry-v1",
  oki: "labatar-character-oki-entry-v1",
  guide: "labatar-character-guide-entry-v1",
};

const specialNames: Record<string, string> = {
  "avatar-aang": "Avatar Aang",
  "nightmare-korra": "Nightmare Korra",
  "dark-avatar-unalaq": "Dark Avatar Unalaq",
  "firelord-sozin": "Firelord Sozin",
  "lo-and-li": "Lo and Li",
  "ming-hua": "Ming-Hua",
  "p-li": "P'Li",
};
const displayName = (id: string) =>
  specialNames[id] ??
  id
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

function storedSelection(): Selection {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(selectionKey) ?? "null");
    if (saved && typeof saved === "object") {
      const value = saved as Partial<Selection>;
      if (typeof value.characterId === "string" && typeof value.supportId === "string")
        return { characterId: value.characterId, supportId: value.supportId };
    }
  } catch {
    // Use the existing combo workspace when the new selection has not been saved.
  }
  const workspace = readComboWorkspace();
  return { characterId: workspace.characterId, supportId: workspace.supportId };
}

function storedSection(): Section {
  try {
    const saved = localStorage.getItem(sectionKey);
    return sections.find(([value]) => value === saved)?.[0] ?? "combos";
  } catch {
    return "combos";
  }
}

function storedEntrySelections(): Partial<Record<EntrySection, EntrySelection | null>> {
  const selections: Partial<Record<EntrySection, EntrySelection>> = {};
  for (const section of Object.keys(entrySelectionKeys) as EntrySection[]) {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(entrySelectionKeys[section]) ?? "null",
      );
      if (saved && typeof saved === "object") {
        const { characterId, supportId, id } = saved as Partial<EntrySelection>;
        if (
          typeof characterId === "string" &&
          typeof supportId === "string" &&
          typeof id === "string"
        )
          selections[section] = { characterId, supportId, id };
      }
    } catch {
      // Open the list when this tab's saved entry cannot be read.
    }
  }
  return selections;
}

function PortraitArtwork({
  src,
  name,
  selected,
  large = false,
}: {
  src: string | null;
  name: string;
  selected: boolean;
  large?: boolean;
}) {
  const size = large ? { width: 112, height: 132 } : { width: 62, height: 72 };
  const faded = { filter: selected ? "none" : "grayscale(1)", opacity: selected ? 1 : 0.45 };
  return src ? (
    <Box component="img" src={src} alt="" sx={{ ...size, objectFit: "contain", ...faded }} />
  ) : (
    <Box
      aria-hidden="true"
      sx={{
        ...size,
        display: "grid",
        placeItems: "center",
        bgcolor: "action.hover",
        borderRadius: 1,
        fontWeight: 700,
        ...faded,
      }}
    >
      {name.slice(0, 2).toUpperCase()}
    </Box>
  );
}

export function CharactersPage({
  active,
  readOnly = false,
  webArtwork,
  guideComboStep = null,
}: {
  active: boolean;
  readOnly?: boolean;
  webArtwork?: WebArtworkLibrary | null;
  guideComboStep?: number | null;
}) {
  const [savedSection, setSavedSection] = useState(storedSection);
  const [showGuidedCombos, setShowGuidedCombos] = useState(guideComboStep !== null);
  useEffect(() => setShowGuidedCombos(guideComboStep !== null), [guideComboStep]);
  const section = showGuidedCombos && guideComboStep !== null ? "combos" : savedSection;
  const [entrySelections, setEntrySelections] = useState(storedEntrySelections);
  const [readingEntry, setReadingEntry] = useState(false);
  const hasEntryReader = section !== "combos" && section !== "players";
  const showEntryReader = active && hasEntryReader && readingEntry;
  const saveEntrySelection = useCallback(
    (tab: EntrySection, pairing: Selection, id: string | null) => {
      const next = id === null ? null : { ...pairing, id };
      setEntrySelections((current) => ({ ...current, [tab]: next }));
      try {
        const key = entrySelectionKeys[tab];
        if (next) localStorage.setItem(key, JSON.stringify(next));
        else localStorage.removeItem(key);
      } catch {
        // Keep the entry selection in memory when storage is unavailable.
      }
    },
    [],
  );
  const selectSection = useCallback((next: Section) => {
    setShowGuidedCombos(false);
    setSavedSection(next);
    try {
      localStorage.setItem(sectionKey, next);
    } catch {
      // Keep the active tab for this session when storage is unavailable.
    }
  }, []);
  useEffect(() => {
    const openCombo = () => selectSection("combos");
    window.addEventListener(characterTechOpenComboEvent, openCombo);
    return () => window.removeEventListener(characterTechOpenComboEvent, openCombo);
  }, [selectSection]);
  const [selection, setSelection] = useState(storedSelection);
  const [sourceData, setSourceData] = useState<{
    localCombos: LocalCombo[];
    candidates: ComboCandidate[];
  }>(() => ({ localCombos: readComboWorkspace().localCombos, candidates: [] }));
  const updateSourceData = useCallback(
    (localCombos: LocalCombo[], candidates: ComboCandidate[]) => {
      setSourceData({ localCombos, candidates });
    },
    [],
  );
  const characters = useMemo(
    () =>
      [
        ...new Set([
          ...Object.keys(supportMap).map(slugComboText),
          ...sourceData.localCombos.map((combo) => combo.characterId),
        ]),
      ].sort(),
    [sourceData.localCombos],
  );
  const characterId = characters.includes(selection.characterId)
    ? selection.characterId
    : (characters[0] ?? "");
  const supports = useMemo(
    () =>
      [
        ...new Set([
          ...Object.values(
            supportMap[displayName(characterId) as keyof typeof supportMap] ?? {},
          ).map(slugComboText),
          ...sourceData.localCombos
            .filter((combo) => combo.characterId === characterId)
            .map((combo) => combo.supportId),
        ]),
      ].sort(),
    [characterId, sourceData.localCombos],
  );
  const supportId = supports.includes(selection.supportId)
    ? selection.supportId
    : (supports[0] ?? "");
  const entrySelection = hasEntryReader ? entrySelections[section] : null;
  const selectedEntryId =
    entrySelection?.characterId === characterId && entrySelection.supportId === supportId
      ? entrySelection.id
      : null;
  const selectEntry = useCallback(
    (id: string | null) => {
      if (section !== "combos" && section !== "players")
        saveEntrySelection(section, { characterId, supportId }, id);
    },
    [section, characterId, supportId, saveEntrySelection],
  );
  const [localPortraits, setLocalPortraits] = useState<{
    characters: Record<string, string | null>;
    supports: Record<string, string | null>;
  }>({ characters: {}, supports: {} });
  useEffect(() => {
    if (!active || webArtwork || !window.electronAPI?.replays?.resolvePortraits) return;
    let cancelled = false;
    const pairs = [
      ...characters.map((id) => ({ character: displayName(id), support: "" })),
      ...supports.map((id) => ({ character: displayName(characterId), support: displayName(id) })),
    ];
    void window.electronAPI.replays
      .resolvePortraits({ pairs })
      .then((results) => {
        if (cancelled) return;
        setLocalPortraits((previous) => ({
          characters: {
            ...previous.characters,
            ...Object.fromEntries(
              characters.map((id, index) => [id, results[index]?.portraitUrl ?? null]),
            ),
          },
          supports: {
            ...previous.supports,
            ...Object.fromEntries(
              supports.map((id, index) => [
                `${characterId}/${id}`,
                results[characters.length + index]?.supportUrl ?? null,
              ]),
            ),
          },
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, characterId, characters, supports, webArtwork]);
  const characterPortraits = webArtwork
    ? Object.fromEntries(
        characters.map((id) => [id, webArtwork.portraitArtwork(displayName(id), "").portraitUrl]),
      )
    : localPortraits.characters;
  const supportPortraits = webArtwork
    ? Object.fromEntries(
        supports.map((id) => [
          `${characterId}/${id}`,
          webArtwork.portraitArtwork(displayName(characterId), displayName(id)).supportUrl,
        ]),
      )
    : localPortraits.supports;

  const getScopePortrait: GetScopePortrait = (kind, id) => ({
    kind,
    name: displayName(id),
    src:
      (kind === "character" ? characterPortraits[id] : supportPortraits[`${characterId}/${id}`]) ??
      null,
  });

  function choose(next: Selection) {
    setSelection(next);
    try {
      localStorage.setItem(selectionKey, JSON.stringify(next));
    } catch {
      // Keep selection in memory for this session.
    }
  }

  return (
    <Stack
      spacing={2}
      useFlexGap={showEntryReader}
      sx={{
        textAlign: "left",
        pb: showEntryReader ? 0 : 5,
        ...(showEntryReader && { height: "100%" }),
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          px: 1.5,
          py: 0.5,
          display: "grid",
          flexShrink: 0,
          gridTemplateColumns: { xs: "minmax(0, 1fr)", xl: "minmax(0, 1fr) minmax(0, 1.3fr)" },
          gap: 2,
          alignItems: "center",
        }}
        data-guide-anchor="combo-pairing"
      >
        <Stack direction="row" spacing={2} sx={{ minWidth: 0, alignItems: "center" }}>
          <Stack spacing={0.5} sx={{ alignItems: "center", flexShrink: 0, width: 128 }}>
            <PortraitArtwork
              src={characterPortraits[characterId] ?? null}
              name={displayName(characterId)}
              selected
              large
            />
            <Typography variant="subtitle2" align="center">
              {displayName(characterId)}
            </Typography>
          </Stack>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {supports.map((id) => {
                const selected = id === supportId;
                return (
                  <Stack key={id} sx={{ alignItems: "center", width: 64 }}>
                    <Button
                      variant="outlined"
                      aria-label={`Support: ${displayName(id)}`}
                      title={displayName(id)}
                      aria-pressed={selected}
                      onClick={() => choose({ characterId, supportId: id })}
                      sx={{
                        width: 64,
                        minWidth: 0,
                        height: 74,
                        p: 0,
                        display: "flex",
                        borderColor: selected ? "primary.main" : "divider",
                        bgcolor: selected ? "action.selected" : "transparent",
                      }}
                    >
                      <PortraitArtwork
                        src={supportPortraits[`${characterId}/${id}`] ?? null}
                        name={displayName(id)}
                        selected={selected}
                      />
                    </Button>
                    {section === "combos" && (
                      <ComboSourceCounts
                        local={countLocalCombos(sourceData.localCombos, characterId, id)}
                        candidates={countCandidates(sourceData.candidates, characterId, id)}
                      />
                    )}
                  </Stack>
                );
              })}
            </Box>
          </Box>
        </Stack>
        <Box sx={{ minWidth: 0 }}>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: { xs: "flex-start", xl: "flex-end" },
              gap: 1,
            }}
          >
            {characters.map((id) => {
              const selected = id === characterId;
              return (
                <Stack key={id} sx={{ alignItems: "center", width: 64 }}>
                  <Button
                    variant="outlined"
                    aria-label={`Character: ${displayName(id)}`}
                    title={displayName(id)}
                    aria-pressed={selected}
                    onClick={() => {
                      const nextSupports = Object.values(
                        supportMap[displayName(id) as keyof typeof supportMap] ?? {},
                      ).map(slugComboText);
                      choose({ characterId: id, supportId: nextSupports[0] ?? "" });
                    }}
                    sx={{
                      width: 64,
                      minWidth: 0,
                      height: 74,
                      p: 0,
                      display: "flex",
                      borderColor: selected ? "primary.main" : "divider",
                      bgcolor: selected ? "action.selected" : "transparent",
                    }}
                  >
                    <PortraitArtwork
                      src={characterPortraits[id] ?? null}
                      name={displayName(id)}
                      selected={selected}
                    />
                  </Button>
                  {section === "combos" && (
                    <ComboSourceCounts
                      local={countLocalCombos(sourceData.localCombos, id)}
                      candidates={countCandidates(sourceData.candidates, id)}
                    />
                  )}
                </Stack>
              );
            })}
          </Box>
        </Box>
      </Paper>
      <Tabs
        value={section}
        onChange={(_, value: Section) => selectSection(value)}
        variant="scrollable"
        allowScrollButtonsMobile
        aria-label="Character sections"
        data-guide-anchor="character-sections"
        sx={{ flexShrink: 0 }}
      >
        {sections.map(([value, label]) => (
          <Tab key={value} value={value} label={label} />
        ))}
      </Tabs>
      <Box sx={{ display: section === "combos" ? "block" : "none" }}>
        <CombosPage
          active={active && section === "combos"}
          readOnly={readOnly}
          getScopePortrait={getScopePortrait}
          characterId={characterId}
          supportId={supportId}
          onSelectionChange={choose}
          onSourceDataChange={updateSourceData}
        />
      </Box>
      {section === "tech" && (
        <CharacterTechPage
          active={active}
          readOnly={readOnly}
          characterId={characterId}
          supportId={supportId}
          getScopePortrait={getScopePortrait}
          selectedEntryId={selectedEntryId}
          onSelectEntry={selectEntry}
          onReadingChange={setReadingEntry}
        />
      )}
      {section === "players" && (
        <CharacterPlayersPage
          active={active}
          readOnly={readOnly}
          characterId={characterId}
          supportId={supportId}
          getScopePortrait={getScopePortrait}
        />
      )}
      {section !== "combos" && section !== "tech" && section !== "players" && (
        <CharacterTechNotes
          active={active}
          kind={section}
          readOnly={readOnly}
          characterId={characterId}
          supportId={supportId}
          getScopePortrait={getScopePortrait}
          selectedEntryId={selectedEntryId}
          onSelectEntry={selectEntry}
          onReadingChange={setReadingEntry}
          onOpenTech={(kind, id, linkedSupportId) => {
            const pairing = { characterId, supportId: linkedSupportId ?? supportId };
            if (linkedSupportId && linkedSupportId !== supportId) choose(pairing);
            saveEntrySelection(kind, pairing, id);
            selectSection(kind);
          }}
        />
      )}
    </Stack>
  );
}
