# Labatar Project Intent

This document is meant to give future collaborators and AI assistants a quick read on what Labatar is trying to do, what kind of problems it solves, and how the codebase is organized.

## Core purpose

Labatar is an unofficial Windows companion for Avatar Legends: The Fighting Game replay review and analysis.

Its core mission is to help a player:

- browse and filter local replay files
- review match history and matchup trends
- analyze recorded gameplay and technical execution
- connect with OBS for recording and clip review
- inspect overlay data and capture scenes for deeper breakdowns

The project is intentionally local-first and non-invasive. It reads replay files and system data; it does not modify the live game or inject into gameplay.

## Product intent

The app is designed around a few practical goals:

1. Make replay exploration feel fast and focused.
2. Reduce the friction of finding the right match or opponent trend.
3. Support replay metadata analysis without requiring a live game connection.
4. Offer a bridge to OBS recording workflows for study and clip making.
5. Provide a Windows desktop experience with native controls, updater behavior, and file-system integration.

In other words, this is not a game client or a cheat tool. It is more like a replay-analysis workstation and personal training companion.

## High-level architecture

The project is split between a desktop Electron shell and a React/Vite frontend.

### Electron side

The main process is responsible for:

- app lifecycle and window management
- replay-folder scanning and replay metadata parsing
- OBS integration and recording setup
- overlay capture and window detection
- update checks and native OS integration

Key files:

- `electron/main.cjs`
- `electron/match-watcher.cjs`
- `electron/support-map.json`
- `electron/character-map.json`

### Frontend side

The UI is built with React, MUI, and Vite. It renders the match browser, recording viewer, analytics panel, and technical tooling.

Key files:

- `src/main.tsx` — top-level app shell and IPC wiring
- `src/AvatarGrid.tsx` — replay table and match history browser
- `src/AnalyticsSection.tsx` — summary and analysis cards
- `src/RecordingViewer.tsx` — video review, playback, diagnostics, and calibration workflows
- `src/ObsRecordingPanel.tsx` — OBS control and recording UI
- `src/TechSection.tsx` — tech catalog and combo/tech selection tools
- `src/detector-config.ts`, `src/framebar-detector.ts`, and `src/input-display.ts` — recording-analysis calibration and detector logic

## Core subsystems

### 1. Replay scanning and history

The app scans the selected game folder recursively for replays, filters duplicates by content hash, and builds a searchable set of match rows.

This is the main product loop for the app: pick a game folder in Settings, pick a player, filter by matchup or ranking status, then inspect matches and replay details.

### 2. Replay analytics

The project is trying to turn raw replay files into usable insights: who won, what was the matchup, how often a player or character appears, and which technical patterns are relevant.

This is done through summary cards, filters, and structured analysis objects in the TypeScript layer.

### 3. Recording and analysis

A second major loop is the recorded-video workflow:

- record a match or training clip with OBS
- review video frames and diagnostics
- tag recordings for match, combo, or pressure content
- save analysis metadata to make the recording easier to classify and revisit

This is the most feature-rich mode in the app and likely the most important place for future improvement.

### 4. Recording-analysis tooling

The recording-analysis subsystem reads framebars, inputs, training-mode indicators, and character/support regions directly from recorded video. Calibration is persisted and shared by the processor and its debug views; there is no separate live overlay window.

This part of the product hints that Labatar may eventually support richer training-analysis signals than a plain replay list.

### 5. OBS automation

OBS integration supports:

- profile setup
- scene configuration
- recording start/stop
- automatic recording based on match events
- manifest generation for recorded sessions

This is important because the app is not just a replay browser; it also acts as a recording and workflow pipeline.

## Design principles to preserve

When making changes, it is useful to keep these principles intact:

- Windows-first behavior matters. File paths, app install flow, and native UI patterns should stay aligned with desktop expectations.
- Local data and replay files are the source of truth. Prefer file-based workflows over cloud or remote dependencies.
- Keep the app non-invasive. No cheating, no gameplay injection, no game tampering.
- Preserve the separation between the main process and renderer process. UI should not directly manage OS-level tasks.
- Keep replay and recording workflows explicit and inspectable; debugging logs and metadata matter a lot here.

## Good extension points

If you want to add or revise features, these are the best places to start:

- Replay table/filtering logic: `src/AvatarGrid.tsx`
- Data summary cards: `src/AnalyticsSection.tsx`
- Recording and playback UI: `src/RecordingViewer.tsx`
- OBS automation and recording lifecycle: `src/ObsRecordingPanel.tsx` and `electron/main.cjs`
- Recording detector configuration: `src/detector-config.ts`
- Framebar scan logic: `src/framebar-detector.ts`
- Input scan logic: `src/input-display.ts`
- Match event detection: `electron/match-watcher.cjs`

## Suggested mental model for the repo

Think of the app as three connected systems:

1. Replay intelligence — reading and organizing matches
2. Recording intelligence — capturing and reviewing gameplay footage
3. Analysis tooling — turning raw data into training and review workflows

Everything in the codebase ultimately supports those three goals.

## Working notes

- The Tech move list and Capture selector contract is documented in [`MOVE_SECTION_INTENT.md`](MOVE_SECTION_INTENT.md).

- The app can be developed locally with the Electron + Vite flow described in the project README.
- The current package setup and scripts indicate this project expects Node 22+, pnpm, and a Windows environment for full runtime validation.
- A lot of business logic is embedded in TypeScript modules rather than a backend service, so the codebase is more “desktop app with structured local analysis” than a standard web app.

This document should be expanded as features grow. The main value is to keep the product intent clear: Labatar is a replay-first analysis and recording toolbox for serious match review.
