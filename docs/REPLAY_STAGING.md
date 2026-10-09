# In-game replay staging

In Match History, right-click a game or set and choose **Prepare for in-game playback**. Close the game before confirming. Labatar moves the entire existing `<game folder>/replays` directory to `<game folder>/.labatar-original-replays` and creates a fresh `replays` directory containing copies of only the selected `.dlr` files. Imported subfolders in the original directory remain intact. Match History still scans both directories, so preparation does not hide games in the app.

Use **Restore original replays** in the Match History banner to put the original directory back. You can also prepare a different game or set without restoring first. On either switch or restore, new files saved directly into the temporary `replays` directory are moved into the preserved tree. If a filename already exists there, the new file is kept under `Recovered while staged/<unique id>/` rather than overwriting anything. Recording links use replay content hashes when available, so same-name replays remain distinct.

Staging state is stored in Electron's user-data directory as `replay-staging.json`; a matching marker inside the archived directory helps finish an interrupted restore. If the app reports a missing archive or invalid staging state, do not manually delete either replay directory. Back up both directories before attempting any manual recovery. An archive without its state file is deliberately not modified automatically.

Labatar asks you to close the game and checks for the game process where possible. The game has not been tested against every imported replay-folder layout; staging only changes the `replays` directory and its sibling Labatar archive in the configured game folder.
