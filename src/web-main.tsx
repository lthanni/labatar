import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgGridProvider } from "ag-grid-react";
import { AllCommunityModule } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import "./style.css";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  Paper,
  Slider,
  Stack,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
} from "@mui/material";
import { AvatarGrid, type ReplayRow } from "./AvatarGrid";
import { OPPONENT_CHARACTER_ROSTER, type AnalysisSummary } from "./AnalyticsSection";
import { extractWebArtwork, type WebArtworkLibrary, type WebArtworkProgress } from "./web/artwork";
import {
  combineReplaySubfolder,
  rescanReplayFolder,
  selectReplayFolder,
  type ReplayFolderSelection,
  type ReplayScanProgress,
  type ReplayScanResult,
  type ReplaySubfolderKind,
} from "./web/replays";

const theme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#121318", paper: "#1d2028" },
    primary: { main: "#90caf9" },
  },
});
const EMPTY_SUMMARY: AnalysisSummary = {
  games: 0,
  sessions: 0,
  wins: 0,
  losses: 0,
  opponents: 0,
  winRate: 0,
};
const showMmrInUnrankedGamesStorageKey = "labatar-show-mmr-in-unranked-games-v1";
const EMPTY_GAMES: ReplayRow[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;

function localDateKey(timestamp: string | null) {
  if (!timestamp) return null;
  const date = new Date(timestamp.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return null;
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, "0")))
    .join("-");
}

function dateIndex(key: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const value = Date.parse(`${key}T00:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === key
    ? value / DAY_MS
    : null;
}

function dateFromIndex(value: number) {
  return new Date(Math.round(value) * DAY_MS).toISOString().slice(0, 10);
}

function playerCountsFor(games: ReplayRow[]) {
  const counts: Record<string, number> = {};
  for (const game of games) {
    counts[game.player1] = (counts[game.player1] ?? 0) + 1;
    counts[game.player2] = (counts[game.player2] ?? 0) + 1;
  }
  return counts;
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ py: 1.25, "&:last-child": { pb: 1.25 } }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
          {value}
        </Typography>
        {detail && (
          <Typography variant="caption" color="text.secondary">
            {detail}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

function scanProgressText(progress: ReplayScanProgress) {
  if (progress.phase === "discovery") return `Finding game files (${progress.completed} found)...`;
  const subject = progress.phase === "logs" ? "rating logs" : "replays";
  return progress.total > 0
    ? `Reading ${subject} ${progress.completed} of ${progress.total}...`
    : `Finding ${subject}...`;
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function WebApp() {
  const [folder, setFolder] = useState<ReplayFolderSelection | null>(null);
  const [result, setResult] = useState<ReplayScanResult | null>(null);
  const [artwork, setArtwork] = useState<WebArtworkLibrary | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [extractingArtwork, setExtractingArtwork] = useState(false);
  const [scanProgress, setScanProgress] = useState<ReplayScanProgress | null>(null);
  const [artworkProgress, setArtworkProgress] = useState<WebArtworkProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artworkIssue, setArtworkIssue] = useState<string | null>(null);
  const [summary, setSummary] = useState<AnalysisSummary>(EMPTY_SUMMARY);
  const [rankedOnly, setRankedOnly] = useState(false);
  const [rankAffectingOnly, setRankAffectingOnly] = useState(false);
  const [showMmrInUnrankedGames, setShowMmrInUnrankedGames] = useState(
    () => localStorage.getItem(showMmrInUnrankedGamesStorageKey) === "true",
  );
  const [playerOverride, setPlayerOverride] = useState<string | null>(null);
  const [dateFromOverride, setDateFromOverride] = useState<string | null>(null);
  const [dateToOverride, setDateToOverride] = useState<string | null>(null);
  const [draggedDates, setDraggedDates] = useState<[number, number] | null>(null);
  const controller = useRef<AbortController | null>(null);
  const runNumber = useRef(0);
  const artworkRef = useRef<WebArtworkLibrary | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
      artworkRef.current?.dispose();
    },
    [],
  );

  const scan = useCallback(async (selected: ReplayFolderSelection, changedFolder: boolean) => {
    controller.current?.abort();
    const currentRun = ++runNumber.current;
    const nextController = new AbortController();
    controller.current = nextController;
    setError(null);
    setArtworkIssue(null);
    setScanProgress(null);
    setArtworkProgress(null);
    setScanning(true);
    setExtractingArtwork(false);
    if (changedFolder) {
      artworkRef.current?.dispose();
      artworkRef.current = null;
      setArtwork(null);
      setResult(null);
      setSummary(EMPTY_SUMMARY);
      setPlayerOverride(null);
      setDateFromOverride(null);
      setDateToOverride(null);
      setRankedOnly(false);
      setRankAffectingOnly(false);
    }
    try {
      const nextResult = await rescanReplayFolder(selected, {
        signal: nextController.signal,
        onProgress: (progress) => {
          if (runNumber.current === currentRun) setScanProgress(progress);
        },
      });
      if (runNumber.current !== currentRun) return;
      setResult(nextResult);
      setScanning(false);
      if (
        !nextResult.files.some(({ relativePath }) =>
          /(^|\/)data_packages\/.*\.pak$/i.test(relativePath),
        )
      ) {
        artworkRef.current?.dispose();
        artworkRef.current = null;
        setArtwork(null);
        return;
      }
      setExtractingArtwork(true);
      try {
        const nextArtwork = await extractWebArtwork(nextResult.files, {
          signal: nextController.signal,
          onProgress: (progress) => {
            if (runNumber.current === currentRun) setArtworkProgress(progress);
          },
        });
        if (runNumber.current !== currentRun) {
          nextArtwork.dispose();
          return;
        }
        artworkRef.current?.dispose();
        artworkRef.current = nextArtwork;
        setArtwork(nextArtwork);
        if (nextArtwork.skippedPakCount) {
          setArtworkIssue(`${nextArtwork.skippedPakCount} PAK file(s) could not be decoded.`);
        }
      } catch (artError) {
        if (runNumber.current === currentRun && !isAbort(artError)) {
          setArtworkIssue(
            `Portraits could not be loaded: ${artError instanceof Error ? artError.message : String(artError)}`,
          );
        }
      }
    } catch (scanError) {
      if (runNumber.current === currentRun) {
        setError(
          isAbort(scanError)
            ? "Scan cancelled."
            : `Could not scan the folder: ${scanError instanceof Error ? scanError.message : String(scanError)}`,
        );
      }
    } finally {
      if (runNumber.current === currentRun) {
        setScanning(false);
        setExtractingArtwork(false);
        controller.current = null;
      }
    }
  }, []);

  const chooseFolder = async (useFileInput = false) => {
    setSelecting(true);
    setError(null);
    try {
      const selected = await selectReplayFolder(useFileInput);
      setFolder(selected);
      void scan(selected, true);
    } catch (pickError) {
      if (!isAbort(pickError)) {
        setError(
          `Could not select a folder: ${pickError instanceof Error ? pickError.message : String(pickError)}. Select the game subfolders below.`,
        );
      }
    } finally {
      setSelecting(false);
    }
  };

  const chooseSubfolder = async (kind: ReplaySubfolderKind) => {
    setSelecting(true);
    setError(null);
    try {
      const chosen = await selectReplayFolder(true, kind);
      const selected = combineReplaySubfolder(folder, kind, chosen);
      controller.current?.abort();
      controller.current = null;
      runNumber.current += 1;
      artworkRef.current?.dispose();
      artworkRef.current = null;
      setArtwork(null);
      setResult(null);
      setSummary(EMPTY_SUMMARY);
      setScanProgress(null);
      setArtworkProgress(null);
      setArtworkIssue(null);
      setScanning(false);
      setExtractingArtwork(false);
      setPlayerOverride(null);
      setDateFromOverride(null);
      setDateToOverride(null);
      setRankedOnly(false);
      setRankAffectingOnly(false);
      setFolder(selected);
    } catch (pickError) {
      if (!isAbort(pickError)) {
        setError(
          `Could not select the ${kind} folder: ${pickError instanceof Error ? pickError.message : String(pickError)}`,
        );
      }
    } finally {
      setSelecting(false);
    }
  };

  const allGames: ReplayRow[] = result?.games ?? EMPTY_GAMES;
  const modeGames = useMemo(
    () =>
      allGames.filter(
        (game) =>
          (!rankedOnly || game.ratings?.mode.trim().toLowerCase() === "ranked") &&
          (!rankedOnly || !rankAffectingOnly || game.ratings?.affectsRank !== false),
      ),
    [allGames, rankedOnly, rankAffectingOnly],
  );
  const playerCounts = useMemo(
    () => (rankedOnly ? playerCountsFor(modeGames) : (result?.playerCounts ?? {})),
    [modeGames, rankedOnly, result],
  );
  const automaticPlayer =
    Object.entries(playerCounts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const player = playerOverride ?? automaticPlayer;
  const games = useMemo(
    () => modeGames.filter((game) => game.player1 === player || game.player2 === player),
    [modeGames, player],
  );
  const dateRange = useMemo(() => {
    const dates = games
      .map((game) => localDateKey(game.timestamp))
      .filter((date): date is string => Boolean(date))
      .sort();
    return { from: dates[0] ?? "", to: dates.at(-1) ?? "" };
  }, [games]);
  const dateFrom = dateFromOverride ?? dateRange.from;
  const dateTo = dateToOverride ?? dateRange.to;
  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const availableFrom = dateIndex(dateRange.from);
  const availableTo = dateIndex(dateRange.to);
  const selectedFrom = dateIndex(dateFrom);
  const selectedTo = dateIndex(dateTo);
  const sliderMin = Math.min(availableFrom ?? 0, selectedFrom ?? availableFrom ?? 0);
  const sliderMax = Math.max(availableTo ?? 0, selectedTo ?? availableTo ?? 0);
  const sliderValue: [number, number] = [
    selectedFrom ?? availableFrom ?? 0,
    selectedTo ?? availableTo ?? 0,
  ];

  const portraits = useMemo(() => {
    const map: Record<string, { portraitUrl: string | null; supportUrl: string | null }> = {};
    if (!artwork) return map;
    const pairs = new Set<string>();
    for (const game of allGames) {
      pairs.add(JSON.stringify([game.player1Character, game.player1Support]));
      pairs.add(JSON.stringify([game.player2Character, game.player2Support]));
    }
    for (const character of OPPONENT_CHARACTER_ROSTER) {
      for (const slot of [1, 2, 3]) pairs.add(JSON.stringify([character, `Support #${slot}`]));
    }
    for (const key of pairs) {
      const [character, support] = JSON.parse(key) as [string, string];
      map[key] = artwork.portraitArtwork(character, support);
    }
    return map;
  }, [allGames, artwork]);

  const scanBusy = scanning || extractingArtwork;
  const hasRatingLogs = result?.files.some(({ relativePath }) =>
    /(^|\/)logs\/.*\.txt$/i.test(relativePath),
  );

  return (
    <Box
      sx={{
        height: "100vh",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        p: { xs: 1, sm: 2 },
        boxSizing: "border-box",
        bgcolor: "background.default",
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between", mb: 1.5 }}
      >
        <Box sx={{ textAlign: "left" }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 600, color: "text.primary" }}>
            Labatar Match History
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {folder
              ? `${folder.subfolders ? "Game folders" : "Game folder"}: ${folder.name}`
              : "Choose your game folder to browse local replays."}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
          <Button variant="contained" onClick={() => void chooseFolder(true)} disabled={selecting}>
            {folder ? "Change folder" : "Choose game folder"}
          </Button>
          <Button variant="outlined" onClick={() => void chooseFolder()} disabled={selecting}>
            Folder picker with rescan
          </Button>
          {folder?.directory && (
            <Button
              variant="outlined"
              onClick={() => void scan(folder, false)}
              disabled={scanBusy || selecting}
            >
              Rescan
            </Button>
          )}
          {scanBusy && (
            <Button variant="text" onClick={() => controller.current?.abort()}>
              Cancel
            </Button>
          )}
        </Stack>
      </Stack>
      {folder && !folder.subfolders && folder.name.toLowerCase() === "replays" && (
        <Alert severity="warning" sx={{ mb: 1.5, textAlign: "left" }}>
          You selected the replays folder. For the full Labatar experience, choose the game
          installation folder, usually one folder up, so Labatar can find artwork and game logs.
        </Alert>
      )}
      {(!folder || folder.subfolders) && (
        <Alert severity="info" sx={{ mb: 1.5, textAlign: "left" }}>
          Choose the game folder, or select its replays folder here and optionally add logs and
          data_packages. The rescan picker may block game installs under Program Files. Files are
          read locally and are not uploaded.
          <Typography variant="body2" sx={{ mt: 1, overflowWrap: "anywhere" }}>
            Usual Steam location (you can paste this into the folder dialog):
            {" C:\\Program Files (x86)\\Steam\\steamapps\\common\\Avatar Legends The Fighting Game"}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap", gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => void chooseSubfolder("replays")}
              disabled={selecting}
            >
              {folder?.subfolders?.replays ? "Replace replays" : "Choose replays"}
            </Button>
            {folder?.subfolders && (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => void chooseSubfolder("logs")}
                  disabled={selecting}
                >
                  {folder.subfolders.logs ? "Replace logs" : "Add logs"}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => void chooseSubfolder("data_packages")}
                  disabled={selecting}
                >
                  {folder.subfolders.data_packages ? "Replace data_packages" : "Add data_packages"}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => void scan(folder, !result)}
                  disabled={selecting || scanBusy || !folder.subfolders.replays}
                >
                  {result ? "Scan selected files" : "Load match history"}
                </Button>
              </>
            )}
          </Stack>
          {folder?.subfolders && (
            <Typography variant="caption" sx={{ display: "block", mt: 1 }}>
              To include newly created files, choose that subfolder again before scanning.
            </Typography>
          )}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}
      {artworkIssue && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {artworkIssue}
        </Alert>
      )}
      {folder && result && result.games.length === 0 && !scanning && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          No `.dlr` replays were found. Select the game installation folder or its replays folder.
        </Alert>
      )}
      {result && result.games.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "left", mb: 1 }}>
          {result.games.length} unique replays
          {result.duplicateCount ? ` | ${result.duplicateCount} duplicates skipped` : ""}
          {hasRatingLogs ? " | rating logs found" : " | no rating logs found"}
          {artwork ? ` | ${artwork.decodedCount} portraits decoded locally` : ""}
        </Typography>
      )}
      {scanBusy && (
        <Box sx={{ mb: 1.5, textAlign: "left" }}>
          <LinearProgress
            variant={scanning && scanProgress?.total ? "determinate" : "indeterminate"}
            value={
              scanning && scanProgress?.total
                ? (scanProgress.completed / scanProgress.total) * 100
                : undefined
            }
          />
          <Typography variant="caption" color="text.secondary">
            {scanning && scanProgress
              ? scanProgressText(scanProgress)
              : extractingArtwork
                ? (artworkProgress?.message ?? "Loading portraits...")
                : "Finding game files..."}
          </Typography>
        </Box>
      )}
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 1, mb: 1 }}>
        <Paper variant="outlined" sx={{ p: 1, flex: "1 1 600px", minWidth: 0, textAlign: "left" }}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
            <TextField
              label="From"
              type="date"
              size="small"
              value={dateFrom}
              onChange={(event) => setDateFromOverride(event.target.value)}
              error={invalidDateRange}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 155 }}
            />
            <TextField
              label="To"
              type="date"
              size="small"
              value={dateTo}
              onChange={(event) => setDateToOverride(event.target.value)}
              error={invalidDateRange}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 155 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={rankedOnly}
                  onChange={(event) => {
                    setRankedOnly(event.target.checked);
                    if (!event.target.checked) setRankAffectingOnly(false);
                    setPlayerOverride(null);
                  }}
                />
              }
              label="Ranked only"
              sx={{ m: 0 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={rankAffectingOnly}
                  disabled={!rankedOnly}
                  onChange={(event) => setRankAffectingOnly(event.target.checked)}
                />
              }
              label="Games which affect rank only"
              sx={{ m: 0 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={showMmrInUnrankedGames}
                  onChange={(event) => {
                    const value = event.target.checked;
                    localStorage.setItem(showMmrInUnrankedGamesStorageKey, String(value));
                    setShowMmrInUnrankedGames(value);
                  }}
                />
              }
              label="Show MMR in unranked games"
              sx={{ m: 0 }}
            />
          </Stack>
          {availableFrom !== null && availableTo !== null && (
            <Slider
              value={draggedDates ?? sliderValue}
              min={sliderMin}
              max={sliderMax}
              step={1}
              disableSwap
              disabled={invalidDateRange || sliderMin === sliderMax}
              getAriaLabel={(index) => (index === 0 ? "Start date" : "End date")}
              valueLabelDisplay="auto"
              valueLabelFormat={dateFromIndex}
              onChange={(_, value) => {
                if (Array.isArray(value)) setDraggedDates([value[0], value[1]]);
              }}
              onChangeCommitted={(_, value) => {
                setDraggedDates(null);
                if (Array.isArray(value)) {
                  setDateFromOverride(dateFromIndex(value[0]));
                  setDateToOverride(dateFromIndex(value[1]));
                }
              }}
              sx={{ mx: 1, width: "calc(100% - 16px)" }}
            />
          )}
        </Paper>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 1,
            flex: "1 1 410px",
            minWidth: 0,
          }}
        >
          <SummaryCard
            label="Games"
            value={String(summary.games)}
            detail={`${summary.sessions} sets`}
          />
          <SummaryCard
            label="Record"
            value={`${summary.wins}-${summary.losses}`}
            detail={`${summary.winRate}% (${summary.wins + summary.losses} total)`}
          />
          <SummaryCard label="Opponents" value={String(summary.opponents)} />
        </Box>
      </Box>
      <Box sx={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
        <AvatarGrid
          rowData={games}
          replayFolder={folder?.name ?? null}
          active
          recordingsRefreshToken={0}
          webMode
          showMmrInUnrankedGames={showMmrInUnrankedGames}
          webPortraits={portraits}
          playerOfInterest={player}
          playerCounts={playerCounts}
          playerOverride={playerOverride}
          onPlayerOverrideChange={setPlayerOverride}
          dateFrom={dateFrom}
          dateTo={dateTo}
          invalidDateRange={invalidDateRange}
          onSummaryChange={setSummary}
          onReplaysChanged={() => undefined}
          onOpenGuide={() => undefined}
        />
      </Box>
    </Box>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");
createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <AgGridProvider modules={[AllCommunityModule]}>
        <WebApp />
      </AgGridProvider>
    </ThemeProvider>
  </StrictMode>,
);
