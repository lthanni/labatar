import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { AgGridProvider } from "ag-grid-react";
import { AllCommunityModule } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { AvatarGrid, type ReplayRow } from "./AvatarGrid";
import { useCallback } from "react";

declare global {
  interface Window {
    electronAPI?: {
      replays: {
        getFolder: () => Promise<string | null>;
        selectFolder: () => Promise<string | null>;
        scanFolder: (
          folder: string,
        ) => Promise<{ games: ReplayRow[]; playerCounts: Record<string, number> }>;
      };
    };
  }
}

function ReplayFolderPicker({
  onData,
}: {
  onData: (games: ReplayRow[], counts: Record<string, number>) => void;
}) {
  const [folder, setFolder] = useState<string | null>(null);
  const scan = useCallback(
    async (selectedFolder: string | null) => {
      if (!selectedFolder || !window.electronAPI) return;
      const result = await window.electronAPI.replays.scanFolder(selectedFolder);
      onData(result.games, result.playerCounts);
    },
    [onData],
  );

  useEffect(() => {
    void window.electronAPI?.replays.getFolder().then((savedFolder) => {
      setFolder(savedFolder);
      void scan(savedFolder);
    });
  }, [scan]);

  const chooseFolder = async () => {
    const selected = await window.electronAPI?.replays.selectFolder();
    if (selected) {
      setFolder(selected);
      void scan(selected);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, textAlign: "left" }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { sm: "center" } }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Replay folder
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap title={folder ?? undefined}>
            {folder ?? "No replay folder selected"}
          </Typography>
        </Box>
        <Button variant="contained" onClick={chooseFolder}>
          Choose folder
        </Button>
      </Stack>
    </Paper>
  );
}

const root = document.getElementById("app");

const agGridModules = [AllCommunityModule];

function App() {
  const [games, setGames] = useState<ReplayRow[]>([]);
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const onData = useCallback((nextGames: ReplayRow[], counts: Record<string, number>) => {
    setGames(nextGames);
    setPlayerCounts(counts);
  }, []);
  const playerOfInterest = Object.entries(playerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return (
    <>
      <ReplayFolderPicker onData={onData} />
      <Typography variant="body2" sx={{ my: 1, textAlign: "left" }}>
        {playerOfInterest
          ? `Player of interest: ${playerOfInterest} (${playerCounts[playerOfInterest]} appearances)`
          : "No replay data loaded"}
      </Typography>
      <AvatarGrid rowData={games} />
    </>
  );
}

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <Box
      sx={{
        minHeight: "100vh",
        width: "100%",
        p: 3,
      }}
    >
      <AgGridProvider modules={agGridModules}>
        <App />
      </AgGridProvider>
    </Box>
  </StrictMode>,
);
