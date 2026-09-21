import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  ThemeProvider,
  Typography,
  createTheme,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
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
const darkTheme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#121318", paper: "#1d2028" },
    primary: { main: "#90caf9" },
  },
});

function ReplayAnalysis() {
  const [games, setGames] = useState<ReplayRow[]>([]);
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [overridePlayer, setOverridePlayer] = useState<string | null>(null);
  const onData = useCallback((nextGames: ReplayRow[], counts: Record<string, number>) => {
    setGames(nextGames);
    setPlayerCounts(counts);
    setOverridePlayer(null);
  }, []);
  const automaticPlayer = Object.entries(playerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const playerOfInterest = overridePlayer ?? automaticPlayer;
  const relevantGames = useMemo(
    () =>
      games.filter(
        (game) => game.player1 === playerOfInterest || game.player2 === playerOfInterest,
      ),
    [games, playerOfInterest],
  );

  return (
    <>
      <ReplayFolderPicker onData={onData} />
      <Typography variant="body2" sx={{ my: 1, textAlign: "left" }}>
        {playerOfInterest
          ? `Player of interest: ${playerOfInterest} (${playerCounts[playerOfInterest]} appearances)`
          : "No replay data loaded"}
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 1, alignItems: "center" }}>
        <FormControl
          size="small"
          sx={{ minWidth: 240, backgroundColor: "background.paper", borderRadius: 1 }}
        >
          <InputLabel id="player-override-label">Player of interest</InputLabel>
          <Select
            labelId="player-override-label"
            value={playerOfInterest ?? ""}
            label="Player of interest"
            onChange={(event) => setOverridePlayer(event.target.value)}
          >
            {Object.entries(playerCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => (
                <MenuItem key={name} value={name}>
                  {name} ({count})
                </MenuItem>
              ))}
          </Select>
        </FormControl>
        <Button
          variant="outlined"
          disabled={!overridePlayer}
          onClick={() => setOverridePlayer(null)}
        >
          Use auto-detected
        </Button>
        <Typography variant="caption" color="text.secondary">
          {overridePlayer ? "Overridden" : "Auto-determined"}
        </Typography>
      </Stack>
      <AvatarGrid rowData={relevantGames} playerOfInterest={playerOfInterest} />
    </>
  );
}

function App() {
  const [tab, setTab] = useState(0);

  return (
    <>
      <Tabs value={tab} onChange={(_, nextTab: number) => setTab(nextTab)} sx={{ mb: 2 }}>
        <Tab label="Replay analysis" />
        <Tab label="Visual overlay" />
      </Tabs>
      {tab === 0 ? (
        <ReplayAnalysis />
      ) : (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "left" }}>
          <Typography variant="h6">Visual overlay</Typography>
          <Typography color="text.secondary">
            Overlay processing and gameplay feedback will appear here.
          </Typography>
        </Paper>
      )}
    </>
  );
}

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={darkTheme}>
      <Box sx={{ minHeight: "100vh", width: "100%", p: 2, backgroundColor: "background.default" }}>
        <AgGridProvider modules={agGridModules}>
          <App />
        </AgGridProvider>
      </Box>
    </ThemeProvider>
  </StrictMode>,
);
