# Labatar Subcomponent Map

This file is a quick guide to the major parts of the project so a future contributor or AI assistant can find the right area faster.

## Top-level project structure

- `README.md` — user-facing overview, install and release notes
- `package.json` — package metadata, scripts, Electron build configuration
- `vite.config.ts` — Vite frontend configuration
- `electron/` — Electron main process and native integrations
- `src/` — React app and UI logic

## UI and app shell

### `src/main.tsx`

This is the main application shell. It contains:

- global React app setup
- primary app state and filters
- MUI theme setup
- IPC calls to the Electron main process
- navigation between replay review and recording workflows

If a user says “the app doesn’t react to a setting,” this file is a common starting point.

### `src/AvatarGrid.tsx`

This is the replay browser/viewer grid. Responsibilities likely include:

- table rendering for matchup rows
- replay list filtering
- result summaries and counts
- selecting rows for export or open-in-folder actions

This is the core “match history” surface.

### `src/AnalyticsSection.tsx`

This is the summary and analysis UI. It likely aggregates data about:

- matchup counts
- player counts
- selected filter state
- maybe totals and trends across seen replays

This is not the low-level parsing logic; it is the front-end summary layer.

### `src/TechSection.tsx`

This module handles the “tech” and combo/reference workflow. It likely deals with:

- cataloged techs
- selected combo usage
- reference lookup for a recording or match
- user interaction around training and technical analysis

If the project adds or revises command/tech analysis, this is likely the right place.

### `src/ObsRecordingPanel.tsx`

This is the OBS integration panel. It probably manages:

- OBS connection state
- recording controls
- profile setup
- scene preparation
- automated recording triggers

This is the access point for recording and automation workflows.

### `src/RecordingViewer.tsx`

This is the most complex viewer component. It almost certainly manages:

- playback of recorded videos
- time positioning and scrubbing
- detector-config calibration
- framebar or diagnostic visualizations
- tag editing and analysis persistence

This is the best file to inspect when a change touches video review or manually tagged analysis.

### Recording-analysis detector modules

The recording pipeline keeps detector concerns in focused modules:

- `src/detector-config.ts` — persisted calibration and detector geometry
- `src/framebar-detector.ts` — framebar sampling and phase grouping
- `src/framebar-color-map.ts` — framebar color matching
- `src/input-display.ts` — input-display sampling and notation resolution
- `src/recording-processor.ts` — video playback and analysis orchestration

These modules are used by recording analysis and do not create a live overlay window.

## Native process and runtime logic

### `electron/main.cjs`

This is the biggest runtime file. It handles:

- Electron app bootstrapping
- IPC bridge to the renderer
- replay scanning and folder selection
- OBS connection and session management
- recording jobs and output tracking
- recording-analysis integration
- updater and native menu behavior

If a change requires OS-level behavior, this file is usually responsible.

### `electron/match-watcher.cjs`

This is the match-log watcher or event-monitoring component. It likely:

- watches local match logs or game state
- identifies active matches or lobby changes
- can trigger OBS automation or recording hooks

## Data and type layer

Files in `src/` that look like typed data definitions are also important, including:

- `obs-types.ts`
- `recording-types.ts`
- `recording-analysis-types.ts`
- `recording-processor.ts`
- `tech-types.ts`
- `training-meter.ts`
- `corner-detection.ts`
- `counter.ts`
- `input-display.ts`

These likely model:

- OBS state and configuration
- recording metadata and tags
- analysis objects
- frame-processing logic
- training and technical metrics

## Recommended reading order

If you want to understand the project quickly, read in this order:

1. `README.md`
2. `src/main.tsx`
3. `electron/main.cjs`
4. `src/RecordingViewer.tsx`
5. `src/AvatarGrid.tsx`
6. `src/ObsRecordingPanel.tsx`
7. `src/TechSection.tsx`

That sequence gives a good map of the app’s UI, runtime integration, and the most important workflows.

## Ownership of concerns

A useful rule of thumb:

- `src/*.tsx` files are mostly UI and user interaction
- `electron/*.cjs` files are mostly OS and runtime integration
- `src/*-types.ts` files define models and structured data
- `src/*-processor.ts` files implement logic that transforms raw data into analysis

If you are unsure where to patch something, start at the UI file that displays the feature, then follow the IPC call into the Electron main process.
