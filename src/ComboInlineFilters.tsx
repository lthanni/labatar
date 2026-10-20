import {
  Box,
  Checkbox,
  FormControlLabel,
  FormGroup,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { ComboStarterFilter } from "./ComboStarterFilter";
import type { ComboTableRow } from "./ComboTable";

const positions = ["corner", "midscreen", "fullscreen"] as const;

export type ComboInlineFilterState = {
  excludedStarters: Set<string>;
  positions: Set<string>;
  minDamage: string;
  maxPips: string;
  maxFlow: string;
  counterhit: "all" | "yes" | "no";
};

export function emptyComboInlineFilters(): ComboInlineFilterState {
  return {
    excludedStarters: new Set(),
    positions: new Set(positions),
    minDamage: "0",
    maxPips: "7",
    maxFlow: "500",
    counterhit: "all",
  };
}

export function matchesComboInlineFilters(row: ComboTableRow, filters: ComboInlineFilterState) {
  if (filters.excludedStarters.has(row.starter)) return false;
  if (
    filters.positions.size !== positions.length &&
    !filters.positions.has(row.position.toLowerCase())
  ) {
    return false;
  }
  if (filters.minDamage.trim()) {
    const minimum = Number(filters.minDamage);
    if (Number.isFinite(minimum) && !(Number(row.damage) >= minimum)) return false;
  }
  if (filters.maxPips.trim()) {
    const maximum = Number(filters.maxPips);
    if (Number.isFinite(maximum) && !(row.pips <= maximum)) return false;
  }
  if (filters.maxFlow.trim()) {
    const maximum = Number(filters.maxFlow);
    if (Number.isFinite(maximum) && !(row.flow <= maximum)) return false;
  }
  if (filters.counterhit !== "all" && row.requiresCounterhit !== (filters.counterhit === "yes")) {
    return false;
  }
  return true;
}

export function ComboInlineFilters({
  starters,
  filters,
  onChange,
}: {
  starters: string[];
  filters: ComboInlineFilterState;
  onChange: (next: ComboInlineFilterState) => void;
}) {
  return (
    <>
      <ComboStarterFilter
        starters={starters}
        excluded={filters.excludedStarters}
        onExcludedChange={(excludedStarters) => onChange({ ...filters, excludedStarters })}
      />
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
        <Typography variant="body2" color="text.secondary">
          Position
        </Typography>
        <FormGroup row sx={{ flexWrap: "nowrap" }}>
          {positions.map((position) => (
            <FormControlLabel
              key={position}
              sx={{ mr: 1 }}
              control={
                <Checkbox
                  size="small"
                  checked={filters.positions.has(position)}
                  onChange={(event) => {
                    const next = new Set(filters.positions);
                    if (event.target.checked) next.add(position);
                    else next.delete(position);
                    onChange({ ...filters, positions: next });
                  }}
                />
              }
              label={
                <Typography variant="body2" sx={{ textTransform: "capitalize" }}>
                  {position}
                </Typography>
              }
            />
          ))}
        </FormGroup>
      </Box>
      <TextField
        size="small"
        type="number"
        label="Min damage"
        value={filters.minDamage}
        onChange={(event) => onChange({ ...filters, minDamage: event.target.value })}
        slotProps={{ htmlInput: { min: 0 } }}
        sx={{ width: 110 }}
      />
      <TextField
        size="small"
        type="number"
        label="Max pips"
        value={filters.maxPips}
        onChange={(event) => onChange({ ...filters, maxPips: event.target.value })}
        slotProps={{ htmlInput: { min: 0 } }}
        sx={{ width: 100 }}
      />
      <TextField
        size="small"
        type="number"
        label="Max flow"
        value={filters.maxFlow}
        onChange={(event) => onChange({ ...filters, maxFlow: event.target.value })}
        slotProps={{ htmlInput: { min: 0 } }}
        sx={{ width: 100 }}
      />
      <TextField
        select
        size="small"
        label="Counterhit"
        value={filters.counterhit}
        onChange={(event) =>
          onChange({
            ...filters,
            counterhit: event.target.value as ComboInlineFilterState["counterhit"],
          })
        }
        sx={{ width: 130 }}
      >
        <MenuItem value="all">Any</MenuItem>
        <MenuItem value="yes">Required</MenuItem>
        <MenuItem value="no">Not required</MenuItem>
      </TextField>
    </>
  );
}
