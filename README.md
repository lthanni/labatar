# Labatar

Labatar is an unofficial Windows companion app for reviewing Avatar Legends: The Fighting Game replays, recording matches with OBS, and making clips. It reads local game files and controls OBS through its WebSocket server; it does not modify the game or inject into gameplay.

## Download

Download the latest Windows installer from the [GitHub Releases page](https://github.com/lthanni/labatar/releases/latest).

Run the `.exe` installer and launch Labatar from the Start menu. Windows may show a SmartScreen warning because the installer is not currently code-signed; verify that the installer came from the Labatar GitHub Releases page before continuing.

## Match history

1. Launch Labatar.
2. Choose your replay folder. Labatar starts with the usual Steam installation folder when it exists:
   `C:\Program Files (x86)\Steam\steamapps\common\Avatar Legends The Fighting Game`
3. Select the player.
4. Use the matchup cards, support checkboxes, opponent filter, and date range to filter the analysis and replay table.

The app scans `.dlr` files recursively, ignores duplicate file contents, and supports right-click actions for opening a replay or set in File Explorer and exporting replays as a ZIP.

Match history also shows set results, ranked MMR changes, activity and win-rate trends, and matchup breakdowns. When a set has a linked recording, you can open it directly from the set row.

## Record with OBS

OBS Studio must be running with its WebSocket server enabled (**Tools > WebSocket Server Settings**). The default port is `4455`. In Labatar, open the gear-shaped **OBS settings**, enter the matching port and password, and connect. If OBS is not running, **attempt to open OBS** can try to launch it. **Apply Labatar OBS setup** prepares the Labatar recording profile and scenes; review your OBS setup before using it because it manages the Labatar scene collection.

- **Start automatic recording** monitors game logs and starts and stops OBS recordings for matches it can identify. Labatar can keep one recording across games in a recognized lobby, link matching replays, and name a set using your history against that opponent. Matches without enough reliable identity information may not be recorded automatically.
- **Start recording** begins a manual recording immediately; stop it in Labatar when finished. The configurable global capture shortcut defaults to **F9**.
- Press **F10** during an active recording to add an unnamed chapter directly to the Hybrid MP4. With **Auto-clip 30 seconds before manual chapters** enabled (the default), Labatar makes a clip of up to 30 seconds before each marker after the recording finishes. You can turn auto-clipping off without disabling F10 chapters. The Recordings tab also offers **Create 30-second clips from manual chapters** for older recordings or retries.

Automatic game-start chapters are a separate, optional setting in OBS settings. Labatar adds them after replay linking, preserving F10 chapters. This can require temporary free space roughly equal to the MP4 size, and games without trustworthy timing are skipped.

## Review recordings and clips

The **Recordings** tab plays local recordings and clips. Chapter ticks on the timeline show their titles on hover and seek to the chapter when clicked. You can filter recordings and clips, add tags, rename recordings, export a selected video range as a clip, and use the recording's menu to rebuild an automatic name or add game-start chapters. Linked clips appear under their source recording, with chevrons to expand or hide nested clips. Collapsing a branch does not change the selected video; a recording's details also link back to its source or child clips.

A floating activity panel shows which recording is being saved, when game-start chapters are being added, and which clip is being created. For manual-chapter clips, it identifies the clip number and time range being encoded.

## Updates

Installed releases check GitHub Releases for updates when the app starts. You can also use **Help > Check for Updates...** in the native application menu. When an update is available, Labatar offers native Windows prompts to download and install it.

Updates are available for installed Windows builds. Development runs and unpacked test builds do not use the updater.

## For contributors

Requirements:

- Windows
- Node.js 22 or newer
- pnpm 12.3.4

Install dependencies and start the development app:

```powershell
pnpm install
pnpm run electron:dev
```

Run checks and build the production assets:

```powershell
pnpm exec vp check --fix
pnpm run build
pnpm run electron:build
```

The production build packages the recording-analysis workflow and a Windows NSIS installer in `release/`.

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

## Project status

Labatar is an unofficial community project and is not affiliated with or endorsed by Paramount, Avatar Studios, or the game’s developers.
