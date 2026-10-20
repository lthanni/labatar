import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Typography,
} from "@mui/material";
import { comboStarterGroup, comboStarterGroups } from "./combo-starter";

export function ComboStarterFilter({
  starters,
  excluded,
  onExcludedChange,
}: {
  starters: string[];
  excluded: Set<string>;
  onExcludedChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const unique = [...new Set(starters)].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
    return comboStarterGroups
      .map((group) => ({
        ...group,
        items: unique.filter((starter) => comboStarterGroup(starter) === group.id),
      }))
      .filter((group) => group.items.length > 0);
  }, [starters]);
  const allStarters = groups.flatMap((group) => group.items);
  const selectedCount = allStarters.filter((starter) => !excluded.has(starter)).length;

  const setItemsSelected = (items: string[], selected: boolean) => {
    const next = new Set(excluded);
    for (const item of items) {
      if (selected) next.delete(item);
      else next.add(item);
    }
    onExcludedChange(next);
  };

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        onClick={() => setOpen(true)}
        disabled={allStarters.length === 0}
        aria-label="Filter combo starters"
        sx={{ minHeight: 40, alignSelf: { sm: "center" } }}
      >
        Starter
        {selectedCount < allStarters.length ? ` (${selectedCount}/${allStarters.length})` : ""}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xl" fullWidth>
        <DialogTitle>Filter starters</DialogTitle>
        <DialogContent dividers sx={{ maxHeight: "min(70vh, 680px)", overflowX: "auto" }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={selectedCount === allStarters.length}
                indeterminate={selectedCount > 0 && selectedCount < allStarters.length}
                onChange={(event) => setItemsSelected(allStarters, event.target.checked)}
              />
            }
            label={`Select all (${selectedCount}/${allStarters.length})`}
          />
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 1, pb: 1, width: "max-content", alignItems: "flex-start" }}
          >
            {groups.map((group) => {
              const groupSelected = group.items.filter((item) => !excluded.has(item)).length;
              return (
                <Box
                  key={group.id}
                  sx={{
                    flex: "0 0 210px",
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    px: 1.5,
                    py: 0.5,
                  }}
                >
                  <FormControlLabel
                    sx={{ display: "flex", m: 0 }}
                    control={
                      <Checkbox
                        checked={groupSelected === group.items.length}
                        indeterminate={groupSelected > 0 && groupSelected < group.items.length}
                        onChange={(event) => setItemsSelected(group.items, event.target.checked)}
                      />
                    }
                    label={
                      <Typography sx={{ fontWeight: 600 }}>
                        {group.label} ({groupSelected}/{group.items.length})
                      </Typography>
                    }
                  />
                  <Stack sx={{ pl: 4 }}>
                    {group.items.map((item) => (
                      <FormControlLabel
                        key={item}
                        sx={{ display: "flex", m: 0 }}
                        control={
                          <Checkbox
                            size="small"
                            checked={!excluded.has(item)}
                            onChange={(event) => setItemsSelected([item], event.target.checked)}
                          />
                        }
                        label={item || "(Unknown starter)"}
                      />
                    ))}
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
