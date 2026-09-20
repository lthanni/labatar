import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { AgGridProvider } from "ag-grid-react";
import { AllCommunityModule } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { AvatarGrid } from "./AvatarGrid";

declare global {
  interface Window {
    electronAPI?: {
      replays: {
        getFolder: () => Promise<string | null>;
        selectFolder: () => Promise<string | null>;
      };
    };
  }
}

function ReplayFolderPicker() {
  const [folder, setFolder] = useState<string | null>(null);

  useEffect(() => {
    void window.electronAPI?.replays.getFolder().then(setFolder);
  }, []);

  const chooseFolder = async () => {
    const selected = await window.electronAPI?.replays.selectFolder();
    if (selected) setFolder(selected);
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
        <ReplayFolderPicker />
        <AvatarGrid />
      </AgGridProvider>
    </Box>
  </StrictMode>,
);
