import { useId, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  ButtonBase,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import supportMap from "../electron/support-map.json";
import {
  applyComboCharacterAssignments,
  maxComboCharacterIds,
  sameComboCharacterCompatibility,
  type ComboCharacterAssignments,
  type ComboCharacterCompatibility,
  type ComboCharacterList,
} from "./combo-character-compatibility";
import { slugComboText } from "./combo-gameplan";
import type { GetScopePortrait } from "./ScopePortrait";

const characterNames = new Map(Object.keys(supportMap).map((name) => [slugComboText(name), name]));
const compatibilityLists = [
  ["whitelist", "Character whitelist", "Opponents this combo works against."],
  ["blacklist", "Character blacklist", "Opponents this combo fails against."],
] as const;

const emptyList: string[] = [];

export function ComboCharacterCompatibilityFields({
  value,
  onChange,
}: {
  value?: ComboCharacterCompatibility;
  onChange: (value: ComboCharacterCompatibility) => void;
}) {
  const whitelist = value?.whitelist ?? emptyList;
  const blacklist = value?.blacklist ?? emptyList;
  const options = [...new Set([...characterNames.keys(), ...whitelist, ...blacklist])];
  return (
    <>
      {compatibilityLists.map(([field, label, help]) => {
        const selected = field === "whitelist" ? whitelist : blacklist;
        const excluded = field === "whitelist" ? blacklist : whitelist;
        return (
          <Autocomplete
            key={field}
            multiple
            filterSelectedOptions
            options={options.filter((id) => !excluded.includes(id))}
            value={selected}
            getOptionLabel={(id) => characterNames.get(id) ?? id}
            getOptionDisabled={() => selected.length >= maxComboCharacterIds}
            onChange={(_, ids) => onChange({ whitelist, blacklist, [field]: ids })}
            renderInput={(params) => <TextField {...params} label={label} helperText={help} />}
          />
        );
      })}
    </>
  );
}

export type ComboCompatibilityEdit = {
  value?: ComboCharacterCompatibility;
  savesLocalRevision: boolean;
  onSave: (assignments: ComboCharacterAssignments) => Promise<void>;
};

export function ComboCompatibilityEditor({
  value,
  getScopePortrait,
  edit,
}: {
  value?: ComboCharacterCompatibility;
  getScopePortrait: GetScopePortrait;
  edit?: ComboCompatibilityEdit;
}) {
  const instructionsId = useId();
  const focusAfterMove = useRef<string | null>(null);
  const [assignments, setAssignments] = useState<ComboCharacterAssignments>(() => new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const saved = edit ? edit.value : value;
  const current = applyComboCharacterAssignments(saved, assignments);
  const changed = !sameComboCharacterCompatibility(saved, current);
  const unclassified = [...new Set([...characterNames.keys(), ...assignments.keys()])].filter(
    (id) => !current.whitelist.includes(id) && !current.blacklist.includes(id),
  );
  const rows = [
    ["whitelist", "Whitelist", current.whitelist],
    [null, "Unclassified", unclassified],
    ["blacklist", "Blacklist", current.blacklist],
  ] as const;

  function move(
    id: string,
    from: ComboCharacterList | null,
    target: ComboCharacterList,
    button: HTMLButtonElement,
  ) {
    if (!edit || saving) return;
    const to = from === target ? null : target;
    if (to && current[to].length >= maxComboCharacterIds) {
      setError(`The ${to} is full. Clear an opponent to make room.`);
      return;
    }
    const originallyListed = saved?.whitelist.includes(id)
      ? "whitelist"
      : saved?.blacklist.includes(id)
        ? "blacklist"
        : null;
    const next = new Map(assignments);
    if (to === originallyListed) next.delete(id);
    else next.set(id, to);
    if (document.activeElement === button) focusAfterMove.current = id;
    setAssignments(next);
    setError("");
  }

  function discard() {
    setAssignments(new Map());
    setError("");
  }

  async function save() {
    if (!edit || saving || !changed) return;
    setSaving(true);
    setError("");
    try {
      await edit.onSave(assignments);
      discard();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save opponent compatibility.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack spacing={0.75}>
      {edit && (
        <Typography id={instructionsId} variant="caption" color="text.secondary">
          Click to whitelist. Right-click or Shift+Enter to blacklist. Repeat the same action to
          clear a portrait.
        </Typography>
      )}
      <Box
        role="group"
        aria-label="Opponent compatibility"
        sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}
      >
        {rows.map(([list, label, ids], index) => (
          <Box
            key={label}
            role="group"
            aria-label={label}
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "90px minmax(0, 1fr)" },
              alignItems: "center",
              gap: { xs: 0.25, sm: 1 },
              px: 1,
              py: 0.5,
              minHeight: 42,
              borderTop: index === 0 ? 0 : 1,
              borderColor: "divider",
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, minWidth: 0 }}>
              {ids.map((id) => {
                const { name, src } = getScopePortrait("character", id);
                const status =
                  list === "whitelist"
                    ? `This combo works against ${name}.`
                    : list === "blacklist"
                      ? `This combo does not work against ${name}.`
                      : `No matchup result recorded for ${name}.`;
                const portrait = (
                  <Avatar
                    component="span"
                    variant="rounded"
                    src={src ?? undefined}
                    sx={{
                      width: 34,
                      height: 34,
                      fontSize: "0.75rem",
                      bgcolor: "action.hover",
                      color: "text.secondary",
                      filter: list === "blacklist" ? "grayscale(1)" : undefined,
                      opacity: list === "blacklist" ? 0.6 : 1,
                      pointerEvents: "none",
                      "& .MuiAvatar-img": { objectFit: "contain" },
                    }}
                  >
                    {name.slice(0, 2).toUpperCase()}
                  </Avatar>
                );
                return (
                  <Tooltip key={id} title={status} arrow>
                    {edit ? (
                      <ButtonBase
                        type="button"
                        aria-describedby={instructionsId}
                        aria-disabled={saving}
                        ref={(button) => {
                          if (button && focusAfterMove.current === id) {
                            focusAfterMove.current = null;
                            button.focus({ preventScroll: true });
                          }
                        }}
                        onClick={(event) =>
                          move(
                            id,
                            list,
                            event.shiftKey ? "blacklist" : "whitelist",
                            event.currentTarget,
                          )
                        }
                        onContextMenu={(event) => {
                          event.preventDefault();
                          move(id, list, "blacklist", event.currentTarget);
                        }}
                        onKeyDown={(event) => {
                          if (!event.shiftKey || (event.key !== "Enter" && event.key !== " "))
                            return;
                          event.preventDefault();
                          if (!event.repeat) move(id, list, "blacklist", event.currentTarget);
                        }}
                        sx={{
                          borderRadius: 1,
                          "&:hover": { bgcolor: "action.hover" },
                          "&.Mui-focusVisible": {
                            outline: "2px solid",
                            outlineColor: "primary.main",
                            outlineOffset: 1,
                          },
                        }}
                      >
                        {portrait}
                      </ButtonBase>
                    ) : (
                      <Box component="span" role="img" tabIndex={0}>
                        {portrait}
                      </Box>
                    )}
                  </Tooltip>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {changed && edit && (
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
          <Button size="small" onClick={discard} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="small"
            variant="contained"
            color="info"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "Saving…" : edit.savesLocalRevision ? "Save local revision" : "Save matchups"}
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

export function ComboCharacterPortraits({
  value,
  getScopePortrait,
}: {
  value?: ComboCharacterCompatibility;
  getScopePortrait: GetScopePortrait;
}) {
  if (!value?.whitelist.length && !value?.blacklist.length) return null;
  return (
    <Box
      role="group"
      aria-label="Opponent compatibility"
      sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}
    >
      {compatibilityLists.flatMap(([field]) =>
        value[field].map((id) => {
          const { name, src } = getScopePortrait("character", id);
          const blocked = field === "blacklist";
          return (
            <Tooltip
              key={id}
              title={`This combo ${blocked ? "does not work" : "works"} against ${name}.`}
              arrow
            >
              <Avatar
                component="span"
                variant="rounded"
                role="img"
                tabIndex={0}
                src={src ?? undefined}
                sx={{
                  width: 25,
                  height: 25,
                  fontSize: "0.65rem",
                  color: "text.secondary",
                  bgcolor: "action.hover",
                  border: 1,
                  borderColor: "divider",
                  filter: blocked ? "grayscale(1)" : undefined,
                  opacity: blocked ? 0.6 : 1,
                  "& .MuiAvatar-img": { objectFit: "contain" },
                }}
              >
                {name.slice(0, 2).toUpperCase()}
              </Avatar>
            </Tooltip>
          );
        }),
      )}
    </Box>
  );
}
