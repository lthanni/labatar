import { useMemo } from "react";
import type { ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

export type AvatarRow = {
  name: string;
  role: string;
  status: "Active" | "Away" | "Offline";
  lastSeen: string;
};

const rowData: AvatarRow[] = [
  { name: "Nova", role: "Explorer", status: "Active", lastSeen: "Just now" },
  { name: "Atlas", role: "Builder", status: "Away", lastSeen: "5 min ago" },
  { name: "Echo", role: "Guide", status: "Offline", lastSeen: "Yesterday" },
];

export function AvatarGrid() {
  const columnDefs = useMemo<ColDef<AvatarRow>[]>(
    () => [
      { field: "name", headerName: "Avatar", flex: 1 },
      { field: "role", headerName: "Role", flex: 1 },
      { field: "status", headerName: "Status", flex: 1 },
      { field: "lastSeen", headerName: "Last seen", flex: 1 },
    ],
    [],
  );

  return (
    <div className="ag-theme-quartz" style={{ height: 360, width: "100%" }}>
      <AgGridReact<AvatarRow>
        columnDefs={columnDefs}
        rowData={rowData}
        defaultColDef={{ sortable: true, filter: true, resizable: true }}
      />
    </div>
  );
}
