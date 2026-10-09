# Labatar

Labatar is an unofficial Windows companion app for reviewing Avatar Legends: The Fighting Game replays, recording matches with OBS, and making clips. It reads local game files and controls OBS through its WebSocket server; it does not modify the game or inject into gameplay.

## Download

Download the latest Windows installer from the [GitHub Releases page](https://github.com/lthanni/labatar/releases/latest).

Run the `.exe` installer and launch Labatar from the Start menu. Windows may show a SmartScreen warning because the installer is not currently code-signed; verify that the installer came from the Labatar GitHub Releases page before continuing.

## Match history

1. Launch Labatar.
2. Open the cog-shaped **Settings** dialog and choose your game folder under **Game folder**. Labatar starts with the usual Steam installation folder when it exists:
   `C:\Program Files (x86)\Steam\steamapps\common\Avatar Legends The Fighting Game`
3. Select the player.
4. Use the matchup portraits, opponent filter, and date range to filter the analysis and replay table.

The app scans `.dlr` files recursively, ignores duplicate file contents, and supports right-click actions for opening a replay or set in File Explorer and exporting replays as a ZIP.

Match history also shows set results, ranked MMR changes, activity and win-rate trends, and matchup breakdowns. When a set has a linked recording, you can open it directly from the set row.

## Record with OBS

OBS Studio must be running with its WebSocket server enabled (**Tools > WebSocket Server Settings**). The default port is `4455`. In Labatar, open the cog-shaped **Settings** dialog and expand **OBS** to enter the matching port and password, then connect. If OBS is not running, **attempt to open OBS** can try to launch it. **Apply Labatar OBS setup** prepares the Labatar recording profile and scenes; review your OBS setup before using it because it manages the Labatar scene collection.

- **Start automatic recording** monitors game logs and starts and stops OBS recordings for matches it can identify. Labatar can keep one recording across games in a recognized lobby, link matching replays, and name a set using your history against that opponent. Matches without enough reliable identity information may not be recorded automatically.
- If a lobby closes before any game starts, Labatar keeps the short recording as **No game started** instead of assigning guessed players or a set number. The logs do not always distinguish a declined match from another early exit.
- **Start recording** begins a manual recording immediately; stop it in Labatar when finished. The configurable global capture shortcut defaults to **F9**.
- Press **F10** during an active recording to add an unnamed chapter directly to the Hybrid MP4. With **Auto-clip 30 seconds before manual chapters** enabled (the default), Labatar makes a clip of up to 30 seconds before each marker after the recording finishes. You can turn auto-clipping off without disabling F10 chapters. The Recordings tab also offers **Create 30-second clips from manual chapters** for older recordings or retries.

Automatic game-start chapters are a separate, optional setting in OBS settings. Labatar adds them after replay linking, preserving F10 chapters. This can require temporary free space roughly equal to the MP4 size, and games without trustworthy timing are skipped.

## Review recordings and clips

The **Recordings** tab plays local recordings and clips. Chapter ticks on the timeline show their titles on hover and seek to the chapter when clicked. You can filter recordings and clips, add tags, rename recordings, export a selected video range as a clip, and use the recording's menu to rebuild an automatic name or add game-start chapters. For a standalone clip, the same range selector also offers **Trim & replace**: it re-encodes the selected range in place and keeps the original MP4 and sidecar as `.bak` files in the same folder. Clips with child clips, chapters, analysis, or a YouTube link cannot be trimmed this way. Linked clips appear under their source recording, with chevrons to expand or hide nested clips. Collapsing a branch does not change the selected video; a recording's details also link back to its source or child clips.

To associate an uploaded video with a recording, select it and choose **Link YouTube video**, then paste its YouTube video URL. A YouTube icon appears on the recording card; in the recording details, click the icon to open the linked video instead of YouTube Studio. You can edit or remove the link later. The link is stored in the recording's local metadata; Labatar does not upload or synchronize the video.

A floating activity panel shows which recording is being saved, when game-start chapters are being added, and which clip is being created. For manual-chapter clips, it identifies the clip number and time range being encoded.

## Updates

Installed releases check GitHub Releases for updates when the app starts. You can also use **Help > Check for Updates...** in the native application menu. When an update is available, Labatar offers native Windows prompts to download and install it.

Updates are available for installed Windows builds. Development runs and unpacked test builds do not use the updater.

## Game artwork

The **Artwork** section in Settings decodes encoded files from `data_packages` inside your selected game folder into
character and support portraits—there is no separate artwork folder to choose. You should only
need to import them once, or again when a game update adds new characters or supports. If the
local portrait library has missing PNGs, Labatar shows a popup with a shortcut to the import button.
The reader handles the supported type-6 portraits without Python or a separate tool clone.
Imported art is saved under Electron user data, not in this repository.

## For contributors

Requirements:

- Windows
- Node.js 22 or newer
- Vite+ (`vp` CLI)

Install dependencies and start the development app:

```powershell
vp install --frozen-lockfile
vp run electron:dev
```

Run checks and build the production assets:

```powershell
vp check
vp test
vp run build
vp run electron:build
```

The production build packages the recording-analysis workflow and a Windows NSIS installer in `release/`. Run `vp env doctor` if setup or dependency behavior looks wrong. Vite+ uses the project's pnpm lockfile and package-manager version internally; release CI installs with pnpm on a clean Windows runner.

## Publishing a release

The version in `package.json` must match the tag being pushed. Stable releases use normal semantic versions, while beta builds use a semantic-version prerelease suffix such as `0.2.2-dev.0`.

For a beta release:

```powershell
# package.json: "version": "0.2.2-dev.0"
git add package.json
git commit -m "release: 0.2.2-dev.0"
git tag v0.2.2-dev.0
git push origin master --tags
```

For the stable release after beta testing:

```powershell
# package.json: "version": "0.2.2"
git add package.json
git commit -m "release: 0.2.2"
git tag v0.2.2
git push origin master --tags
```

Tags containing a prerelease suffix are published as GitHub prereleases. Beta installers use their own update channel, so stable installations do not receive beta updates automatically, while beta installations can receive later builds from the same channel. The workflow uploads all YAML update metadata so both stable and beta channels work with `electron-updater`.

To see cumulative installer downloads for every published version and a grand total, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\release-downloads.ps1
```

This reads GitHub's release-asset counts without changing system execution policy. It includes prereleases and combines separate release entries that share a version tag. Counts are downloads, not unique users or confirmed installs.

## Project status

Labatar is an unofficial community project and is not affiliated with or endorsed by Paramount, Avatar Studios, or the game’s developers.
