import { useMemo } from "react";
import type { ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

export type ReplayRow = {
  id: string;
  timestamp: string | null;
  player1: string;
  player2: string;
  player1Character: string;
  player2Character: string;
  winner: string;
  player1Support: string;
  player2Support: string;
  roundScore: string;
  stage: string;
};

export function AvatarGrid({ rowData }: { rowData: ReplayRow[] }) {
  const columnDefs = useMemo<ColDef<ReplayRow>[]>(
    () => [
      { field: "timestamp", headerName: "Timestamp", flex: 1 },
      { field: "player1Character", headerName: "P1 character", flex: 1 },
      { field: "player2Character", headerName: "P2 character", flex: 1 },
      { field: "player1", headerName: "P1", flex: 1 },
      { field: "player2", headerName: "P2", flex: 1 },
      { field: "winner", headerName: "Winner", flex: 1 },
      { field: "player1Support", headerName: "P1 support", flex: 1 },
      { field: "player2Support", headerName: "P2 support", flex: 1 },
      { field: "roundScore", headerName: "Round score", flex: 1 },
      { field: "stage", headerName: "Stage", flex: 1 },
    ],
    [],
  );

  return (
    <div className="ag-theme-quartz" style={{ height: 360, width: "100%" }}>
      <AgGridReact<ReplayRow>
        columnDefs={columnDefs}
        rowData={rowData}
        defaultColDef={{ sortable: true, filter: true, resizable: true }}
        getRowId={({ data }) => data.id}
      />
    </div>
  );
}
