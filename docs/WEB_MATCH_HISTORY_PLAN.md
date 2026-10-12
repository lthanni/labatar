# Web match history plan

## Goal and first-release scope

Publish a static Labatar site where a visitor chooses their local Avatar Legends
game folder, the browser recursively reads replay files, and Match History shows
the same games, sets, filters, and analytics as the Windows app. No account,
server-side processing, or replay upload is needed.

The first release includes:

- Selecting a game folder and explicitly rescanning it.
- Recursive discovery of `.dlr` files, including imported replay subfolders.
- Parsing player names, characters, supports, winner, round score, and the
  filename timestamp, with duplicate replay contents counted once.
- Reading `.txt` files under the selected folder's `logs` tree for mode and
  ratings when those logs are present. Replays still load if logs are absent or
  unreadable; ranked-only controls then show only games with known rank data.
- Player selection, set grouping, game expansion, opponent and date filters,
  ranked and rank-affecting filters, summary cards, and matchup analytics.
- Character and support portraits extracted in the browser from `.pak` files
  under the selected game folder's `data_packages` tree. Text labels remain
  available when artwork is missing or a particular asset cannot be decoded.
- Visible progress, cancellation, empty states, and an explanation of what the
  browser read. Game files remain on the visitor's machine.

The first release leaves out recordings, OBS, capture, Tech, replay staging,
Explorer actions, ZIP export, game launching, and automatic folder watching.
No game artwork is bundled with the site; portraits come from the folder the
visitor selects.

## Verified starting point

- `electron/main.cjs` owns folder selection and scanning. `findReplayFiles`
  recursively finds `.dlr` files. `parseReplayFile` reads each file as Latin-1,
  extracts printable `key = value` fields, hashes the original bytes with
  SHA-256, and derives its timestamp from the filename. The scan deduplicates
  by content hash.
- The same Electron file recursively reads `.txt` logs beneath `logs` and
  associates ratings with replay filenames. Its scan cache and folder access
  use Node and Electron APIs.
- `electron/artwork-extractor.ts` already provides pure TypeScript PAK header
  and directory parsing, type-6 portrait decoding, and LZ4 decompression.
  `electron/main.cjs` supplies Node file reads and PNG writing around it;
  `electron/portrait-library.cjs` maps character/support names to assets.
- `src/main.tsx` renders the Match History filters and loads scans through
  `window.electronAPI.replays`. `src/AvatarGrid.tsx` builds sets and the table;
  `src/AnalyticsSection.tsx` builds summaries and matchup views. The table
  also calls Electron for portraits, recordings, staging, ZIP, and Explorer.
- `vite.config.ts` already uses `base: "./"`, but the current `index.html`
  launches the Electron-oriented `src/main.tsx` entry. A static build needs its
  own entry and must not depend on the preload API.
- The repository has no checked-in `.dlr` sample, so parity with real game
  files needs a local validation pass before release.

## Browser architecture

1. **Separate entry and shell.** Add `web/index.html` and `src/web-main.tsx`
   (or equivalent) with only the folder picker and Match History. Extract the
   reusable history state and filters from `src/main.tsx`. Keep the Windows
   entry and existing Electron features intact. Give the web build its own
   output directory so the Windows installer cannot accidentally ship the
   wrong entry.
2. **Read-only folder source.** On browsers that support it, call
   `showDirectoryPicker({ mode: "read" })` from the Choose game folder button.
   Walk directory handles recursively and open only `.dlr` replay files and
   `.txt` files under `logs`, plus `.pak` files under `data_packages`. Do not
   read unrelated game assets. Provide a
   `<input type="file" webkitdirectory>` fallback and use each file's
   `webkitRelativePath` to identify replay and log paths. Normalize both
   sources into one `{ relativePath, file }` list. Accept the game root; allow
   a selected `replays` folder as a replay-only mode with no sibling logs or
   artwork.
3. **Browser scan module.** Port the desktop replay and log parsing rules to
   TypeScript using `File` bytes, byte-preserving Latin-1 decoding, and Web
   Crypto SHA-256. Keep the `ReplayRow` shape, relative IDs, deterministic scan order,
   duplicate count, and player counts. Parse only the selected files. Process
   files in bounded batches or a worker so progress and Cancel stay responsive.
   Do not move the desktop parser in the first change; compare both parsers in
   parity tests, then consider sharing a core module after the web release.
4. **Local artwork adapter.** Reuse the pure PAK and type-6 decoder from
   `electron/artwork-extractor.ts`. For each selected PAK, read its 12-byte
   header and directory with `File.slice()`, select only the portrait/support
   entries, and read only those entry byte ranges. Convert decoded RGBA pixels
   to browser `ImageData` and a canvas-backed PNG `Blob`/object URL; no Node
   zlib or disk write is needed. Port the pure character/support asset mapping
   from `electron/portrait-library.cjs`. Decode in a worker or bounded batches,
   show progress, and revoke object URLs when the folder changes or the page
   closes. A bad or unsupported asset must not prevent match history loading.
5. **History UI boundary.** Make `AvatarGrid` receive replay rows and optional
   portrait data without requiring Electron. Hide recording links, staging
   banners/dialogs, and the file-action context menu in the web entry. Keep set
   grouping, table columns that have data, pagination, opponent selection, and
   analytics. Display locally decoded portraits and use readable
   character/support names for missing slots.
6. **Session behavior.** Hold selected folder handles/files and decoded artwork
   in memory. Rescan
   uses the current handle where available; the fallback asks the visitor to
   select the folder again. A page reload starts with a Choose game folder
   prompt. Do not persist raw replay or log contents for the first release.
   Explain that the site reads local files in the browser and does not upload
   them. If scan performance warrants caching later, add a versioned IndexedDB
   cache keyed by relative path, size, and last-modified time, with a clear
   reset path.
7. **Deployment.** Add a dedicated web build command and a GitHub Actions
   Pages workflow that installs from the lockfile, runs checks, builds the web
   entry, and uploads only the static output. Configure Pages to use GitHub
   Actions. With the current repository owner/name, the expected project URL
   is `https://lthanni.github.io/labatar/` once Pages is enabled and deployed.
   Verify the built asset paths under `/labatar/` before publishing.

## Delivery order and acceptance checks

1. **Input and parser:** Build the picker/fallback and normalized file list.
   Test nested `.dlr` discovery, wrong-folder and empty-folder messages,
   duplicate bytes, missing fields, malformed files, filename timestamps,
   supports, and optional log ratings. Compare generated fixture results with
   the desktop parser. Do not commit private game replays or logs.
2. **Artwork:** Adapt the existing PAK decoder to byte-range reads and browser
   images. Test PAK directory bounds, nested `data_packages` discovery,
   decoded pixels against the existing extractor fixtures, missing assets,
   cancellation, and object URL cleanup. Confirm a large PAK is never loaded
   into memory in full.
3. **UI:** Wire browser scan output and portraits to the existing Match History view. Check
   player selection, set boundaries, expansion, date/opponent/ranked filters,
   summaries, and analytics against the desktop app for the same local folder.
   Confirm that no recording, staging, or file-action control remains visible.
4. **Browser validation:** Test the user's actual install location in current
   Chrome and Edge, including folders with many files. Verify the picker can
   access it, scanning remains responsive, cancellation works, and rescanning
   finds a newly added replay. Test the fallback in a browser without
   `showDirectoryPicker`. Compare a sample of portraits with the desktop app.
   Measure scan time and memory on a representative
   library before deciding whether IndexedDB caching is needed.
5. **Release gate:** Run `vp check`, `vp test`, the web build, and the existing
   desktop build. Preview the static output at a `/labatar/` path and check
   that the deployed page makes no request containing replay or log data.
   Deploy only after the local acceptance checks pass.

## Assumptions and open validation

- **Assumption:** The selected game folder contains `replays` (possibly nested)
  and optional `logs` and `data_packages`. A replay-only folder can provide
  history without MMR or portraits.
- **Assumption:** The currently supported type-6 assets cover the character
  and support portraits needed by Match History. Other game art formats are
  outside this release.
- **Browser limitation:** Folder access requires a user gesture; some browsers
  restrict `showDirectoryPicker`, and permission may not survive a reload. The
  folder-input fallback gives a one-time snapshot, so it cannot rescan without
  another selection.
- **Validation needed:** Confirm that the game installation directory is
  selectable in the target browsers and that the desktop log parser's
  filename-based rating association produces the same result on the user's
  current files. If browser access to the install directory is blocked, the
  user can select a copy of the `replays` folder for the first release.
