# Labatar

Labatar is an unofficial Windows companion app for reviewing Avatar Legends: The Fighting Game replay files. It reads replay files for analysis and sharing; it does not modify the game or inject into gameplay.

![Labatar match history interface](image.png)

## Download

Download the latest Windows installer from the [GitHub Releases page](https://github.com/lthanni/labatar/releases/latest).

Run the `.exe` installer and launch Labatar from the Start menu. Windows may show a SmartScreen warning because the installer is not currently code-signed; verify that the installer came from the Labatar GitHub Releases page before continuing.

## Match history

1. Launch Labatar.
2. Choose your replay folder. Labatar starts with the usual Steam installation folder when it exists:
   `C:\Program Files (x86)\Steam\steamapps\common\Avatar Legends The Fighting Game`
3. Select the player of interest.
4. Use the matchup cards, support checkboxes, opponent filter, and date range to filter the analysis and replay table.

The app scans `.dlr` files recursively, ignores duplicate file contents, and supports right-click actions for opening a replay or set in File Explorer and exporting replays as a ZIP.

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

The production build disables the visual overlay and packages a Windows NSIS installer in `release/`.

## Publishing a release

The first configured release uses the current `0.1.0` version. For later releases, bump the `version` in `package.json` using a semantic version such as `0.1.1`.

1. Leave the version at `0.1.0` for the first release; otherwise bump it in `package.json`.
2. Commit and push the change.
3. Create and push the matching tag:

```powershell
git tag v0.1.0 # use the matching version; for example, v0.1.1 for the next release
git push origin master --tags
```

The GitHub Actions workflow builds the Windows installer and publishes it to a GitHub Release. The release assets include the installer metadata required by `electron-updater`.

## Project status

Labatar is an unofficial community project and is not affiliated with or endorsed by Paramount, Avatar Studios, or the game’s developers.
