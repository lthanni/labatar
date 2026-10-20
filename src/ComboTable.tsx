import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CellStyle, ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact, useGridFilter } from "ag-grid-react";
import type { CustomFilterProps } from "ag-grid-react";
import { ComboRouteText, type ComboRoutePart } from "./ComboRouteText";
import type { ComboNote } from "./tech-types";
import {
  Box,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from "@mui/material";

export type ComboTableRow = {
  id: string;
  starter: string;
  position: string;
  damage: string;
  pips: number;
  flow: number;
  requiresCounterhit: boolean;
  route: string;
  routeParts?: ComboRoutePart[];
  notes?: ComboNote[];
  mediaStatus?: "missing" | "local-only" | "ready" | "ready-unpublished";
  draggableRecordingId?: string;
};

export function ComboWorkspace({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "minmax(0, 1fr)",
          lg: "minmax(0, 6fr) minmax(320px, 7fr)",
        },
        gap: 2,
        alignItems: "start",
      }}
    >
      {children}
    </Box>
  );
}

function ResourceIconHeader({ assetName, label }: { assetName: "flow" | "pips"; label: string }) {
  const [iconAvailable, setIconAvailable] = useState(true);
  const [iconVersion, setIconVersion] = useState(0);
  useEffect(() => {
    const refreshIcon = () => {
      setIconAvailable(true);
      setIconVersion((version) => version + 1);
    };
    window.addEventListener("labatar-artwork-imported", refreshIcon);
    return () => window.removeEventListener("labatar-artwork-imported", refreshIcon);
  }, []);
  return iconAvailable ? (
    <Box
      component="img"
      src={`labatar-media://artwork/${assetName}.png?v=${iconVersion}`}
      alt={label}
      sx={{ width: 24, height: 24, objectFit: "contain", display: "block" }}
      onError={() => setIconAvailable(false)}
    />
  ) : (
    <>{label}</>
  );
}

function FlowHeader() {
  return <ResourceIconHeader assetName="flow" label="Flow" />;
}

function PipsHeader() {
  return <ResourceIconHeader assetName="pips" label="Pips" />;
}

type ComboSetFilterModel = { values: string[] };
type ComboComparisonOperator = ">" | ">=" | "<" | "<=" | "=";
type ComboFilterModel = ComboSetFilterModel | { operator: ComboComparisonOperator; value: number };

function ComboValueFilter({
  api,
  getValue,
  model,
  onModelChange,
  numeric = false,
}: CustomFilterProps<ComboTableRow, unknown, ComboFilterModel> & { numeric?: boolean }) {
  const [search, setSearch] = useState("");
  const [rowsVersion, setRowsVersion] = useState(0);
  const [mode, setMode] = useState<"values" | "comparison">(
    model && "operator" in model ? "comparison" : "values",
  );
  const [operator, setOperator] = useState<ComboComparisonOperator>(
    model && "operator" in model ? model.operator : ">=",
  );
  const [comparisonInput, setComparisonInput] = useState(
    model && "operator" in model ? String(model.value) : "",
  );
  useGridFilter({
    doesFilterPass: ({ node }) => {
      if (model === null) return true;
      const value = getValue(node);
      if ("values" in model) return model.values.includes(String(value ?? ""));
      const amount = Number(value);
      if (value === null || value === undefined || !Number.isFinite(amount)) return false;
      switch (model.operator) {
        case ">":
          return amount > model.value;
        case ">=":
          return amount >= model.value;
        case "<":
          return amount < model.value;
        case "<=":
          return amount <= model.value;
        case "=":
          return amount === model.value;
      }
    },
    onNewRowsLoaded: () => setRowsVersion((version) => version + 1),
  });

  const values = useMemo(() => {
    const unique = new Set<string>();
    api.forEachLeafNode((node) => unique.add(String(getValue(node) ?? "")));
    return [...unique].sort((left, right) =>
      numeric ? Number(left) - Number(right) : left.localeCompare(right),
    );
  }, [api, getValue, numeric, rowsVersion]);
  const visibleValues = values.filter((value) =>
    value.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const selected = new Set(model && "values" in model ? model.values : values);
  const selectedVisibleCount = visibleValues.filter((value) => selected.has(value)).length;

  const updateSelection = (next: Set<string>) => {
    const nextValues = values.filter((value) => next.has(value));
    onModelChange(nextValues.length === values.length ? null : { values: nextValues });
  };

  const updateComparison = (nextOperator: ComboComparisonOperator, nextInput: string) => {
    const amount = Number(nextInput);
    onModelChange(
      nextInput.trim() && Number.isFinite(amount)
        ? { operator: nextOperator, value: amount }
        : null,
    );
  };

  return (
    <Box sx={{ p: 1, width: 220 }}>
      {numeric && (
        <TextField
          select
          size="small"
          label="Filter type"
          fullWidth
          value={mode}
          onChange={(event) => {
            const nextMode = event.target.value as "values" | "comparison";
            setMode(nextMode);
            if (nextMode === "values") onModelChange(null);
            else updateComparison(operator, comparisonInput);
          }}
          sx={{ mb: 1 }}
        >
          <MenuItem value="values">Values</MenuItem>
          <MenuItem value="comparison">Compare</MenuItem>
        </TextField>
      )}
      {numeric && mode === "comparison" ? (
        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField
            select
            size="small"
            label="Operator"
            value={operator}
            onChange={(event) => {
              const nextOperator = event.target.value as ComboComparisonOperator;
              setOperator(nextOperator);
              updateComparison(nextOperator, comparisonInput);
            }}
            sx={{ width: 92 }}
          >
            {([">", ">=", "<", "<=", "="] as const).map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            autoFocus
            size="small"
            label="Amount"
            type="number"
            value={comparisonInput}
            onChange={(event) => {
              setComparisonInput(event.target.value);
              updateComparison(operator, event.target.value);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            sx={{ flex: 1 }}
          />
        </Box>
      ) : (
        <>
          <TextField
            autoFocus
            size="small"
            placeholder="Search values"
            fullWidth
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <FormControlLabel
            sx={{ display: "flex", mx: 0, mt: 0.5 }}
            control={
              <Checkbox
                size="small"
                checked={visibleValues.length > 0 && selectedVisibleCount === visibleValues.length}
                indeterminate={
                  selectedVisibleCount > 0 && selectedVisibleCount < visibleValues.length
                }
                disabled={visibleValues.length === 0}
                onChange={(event) => {
                  const next = new Set(selected);
                  for (const value of visibleValues) {
                    if (event.target.checked) next.add(value);
                    else next.delete(value);
                  }
                  updateSelection(next);
                }}
              />
            }
            label="Select all"
          />
          <Box sx={{ maxHeight: 240, overflowY: "auto" }}>
            {visibleValues.map((value) => (
              <FormControlLabel
                key={value}
                sx={{ display: "flex", mx: 0 }}
                control={
                  <Checkbox
                    size="small"
                    checked={selected.has(value)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(value);
                      else next.delete(value);
                      updateSelection(next);
                    }}
                  />
                }
                label={value || "(Blanks)"}
              />
            ))}
            {visibleValues.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 0.5 }}>
                No values found
              </Typography>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}

function ComboSetFilter(props: CustomFilterProps<ComboTableRow, unknown, ComboFilterModel>) {
  return <ComboValueFilter {...props} />;
}

function ComboNumericFilter(props: CustomFilterProps<ComboTableRow, unknown, ComboFilterModel>) {
  return <ComboValueFilter {...props} numeric />;
}

const centeredCellStyle: CellStyle = { textAlign: "center" };
const counterhitCellStyle: CellStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  paddingLeft: 0,
  paddingRight: 0,
};

const columns: ColDef<ComboTableRow>[] = [
  {
    headerName: "Starter",
    field: "starter",
    filter: ComboSetFilter,
    minWidth: 80,
    maxWidth: 170,
    cellStyle: { display: "flex", alignItems: "center" },
    cellRenderer: ({ data }: ICellRendererParams<ComboTableRow>) =>
      data ? (
        <Typography variant="body2" noWrap>
          {data.starter}
        </Typography>
      ) : null,
  },
  {
    field: "position",
    headerName: "Position",
    filter: ComboSetFilter,
    minWidth: 70,
    maxWidth: 120,
  },
  { field: "damage", minWidth: 55, maxWidth: 80, cellStyle: centeredCellStyle },
  {
    field: "pips",
    headerName: "Pips",
    headerTooltip: "Pips",
    headerComponentParams: { innerHeaderComponent: PipsHeader },
    filter: ComboNumericFilter,
    minWidth: 64,
    maxWidth: 70,
    cellStyle: centeredCellStyle,
  },
  {
    field: "flow",
    headerName: "Flow",
    headerTooltip: "Flow",
    headerComponentParams: { innerHeaderComponent: FlowHeader },
    filter: ComboNumericFilter,
    width: 70,
    maxWidth: 70,
    suppressAutoSize: true,
    cellStyle: centeredCellStyle,
  },
  {
    field: "requiresCounterhit",
    headerName: "CH",
    headerTooltip: "Requires counterhit",
    filter: ComboSetFilter,
    filterValueGetter: ({ data }) => (data?.requiresCounterhit ? "Yes" : "No"),
    width: 70,
    minWidth: 70,
    maxWidth: 70,
    suppressAutoSize: true,
    cellStyle: counterhitCellStyle,
    cellRenderer: ({ data }: ICellRendererParams<ComboTableRow>) =>
      data ? (
        <Checkbox
          checked={data.requiresCounterhit}
          size="small"
          disableRipple
          tabIndex={-1}
          slotProps={{
            input: {
              readOnly: true,
              "aria-label": data.requiresCounterhit
                ? "Requires counterhit"
                : "Does not require counterhit",
            },
          }}
          sx={{ p: 0, pointerEvents: "none" }}
        />
      ) : null,
  },
  {
    field: "route",
    headerName: "Route",
    minWidth: 100,
    flex: 1,
    suppressAutoSize: true,
    wrapText: true,
    autoHeight: true,
    cellRenderer: ({ data }: ICellRendererParams<ComboTableRow>) =>
      data ? (
        <ComboRouteText route={data.route} parts={data.routeParts} notes={data.notes} />
      ) : null,
    cellStyle: { whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: "1.3" },
  },
];

const defaultColDef: ColDef<ComboTableRow> = { sortable: true, resizable: true };
const autoSizeStrategy = { type: "fitCellContents" as const, defaultMinWidth: 40 };
const rowSelection = { mode: "singleRow" as const, checkboxes: false, enableClickSelection: true };

export function ComboTable({
  rows,
  selectedId,
  onSelect,
  emptyMessage = "No combos are available.",
}: {
  rows: ComboTableRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyMessage?: string;
}) {
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const comboRowFromTarget = (target: EventTarget) =>
    target instanceof Element ? target.closest<HTMLElement>(".ag-row[row-id]") : null;
  const updateDraggableRow = (target: EventTarget) => {
    const rowElement = comboRowFromTarget(target);
    const row = rowsById.get(rowElement?.getAttribute("row-id") ?? "");
    if (rowElement) rowElement.draggable = Boolean(row?.draggableRecordingId);
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        minWidth: 0,
        height: 560,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {rows.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 2 }}>
          {emptyMessage}
        </Typography>
      ) : (
        <div
          className="ag-theme-quartz-dark"
          style={{ width: "100%", flex: "1 1 0", minHeight: 0 }}
          onMouseOverCapture={(event) => updateDraggableRow(event.target)}
          onMouseDownCapture={(event) => updateDraggableRow(event.target)}
          onDragStartCapture={(event) => {
            const rowElement = comboRowFromTarget(event.target);
            if (!rowElement) return;
            const row = rowsById.get(rowElement.getAttribute("row-id") ?? "");
            if (row?.draggableRecordingId) {
              event.preventDefault();
              window.electronAPI?.recordings?.startDrag({ recordingId: row.draggableRecordingId });
            }
          }}
        >
          <AgGridReact<ComboTableRow>
            theme="legacy"
            columnDefs={columns}
            rowData={rows}
            defaultColDef={defaultColDef}
            autoSizeStrategy={autoSizeStrategy}
            domLayout="normal"
            headerHeight={40}
            rowHeight={40}
            rowSelection={rowSelection}
            getRowId={({ data }) => data.id}
            onRowClicked={({ data }) => {
              if (data) onSelect(data.id);
            }}
            getRowStyle={({ data }) => ({
              cursor: data?.draggableRecordingId ? "grab" : "pointer",
              ...(data?.mediaStatus === "missing"
                ? { backgroundColor: "rgba(244, 67, 54, 0.22)" }
                : data?.mediaStatus === "local-only"
                  ? { backgroundColor: "rgba(255, 152, 0, 0.22)" }
                  : data?.mediaStatus === "ready-unpublished"
                    ? { backgroundColor: "rgba(76, 175, 80, 0.22)" }
                    : {}),
              ...(data?.id === selectedId
                ? { boxShadow: "inset 0 0 0 2px rgba(144, 202, 249, 0.9)" }
                : {}),
            })}
          />
        </div>
      )}
    </Paper>
  );
}
