# Persistent processing calibration

Labatar stores processing calibration in `processing-config.json` in Electron's
user-data directory (normally `%APPDATA%\labatar` on Windows). The Nerd processing
configuration panel shows the actual path and revision, supports export/import,
and lets you reload the file explicitly.

The file lives outside the repository, installed app, and `node_modules`.
Changing UI code or reinstalling dependencies does not replace it. Browser
storage is consulted only once, when no configuration or recovery files exist.
An initialization marker also prevents remigrating stale browser settings if
all configuration files disappear later.
The migration preserves the old browser entries and captures:

- detector geometry, including the existing legacy geometry migrations;
- bundled framebar colors plus saved runtime color samples;
- the color-distance threshold and an explicit unknown-color policy;
- digit templates;
- training-meter samples and fitted thresholds;
- the bundled input-display rules;
- the source resolution against which pixel offsets were calibrated.

The migration uses 2560x1440 as the reference resolution because that is the
existing detector contract. Legacy browser settings did not record their own
reference dimensions, so this is an assumption, not inferred ground truth.
The two recent 5A captures have 2560x1440 analysis dimensions and 60fps capture
metadata. If calibration came from a different resolution, set its reference
width/height in the panel. Percentage regions stay fixed; source-pixel offsets
scale once from the recorded reference size.

Calibration profile version 2 adds the verified bright startup sample
`RGB(94,186,107)` as `startup-bright`. It is additive: existing samples remain
intact, the update creates a new revision, and saved analysis snapshots remain
unchanged. The recent `new 5a block` capture uses this brighter green; the
older `5A block` fixture uses the original darker green.

## Saves and recovery

The main process validates configuration before saving. Writes use a temporary
file, flush its contents, and rename it into place. Saves increment a revision;
the renderer serializes edits, and the main process rejects a stale revision
instead of overwriting another window's changes. Numeric edits no longer write
storage from React state-updater callbacks. Press Enter or leave a numeric field
to commit its value; incomplete typing stays local to the field.

Every successful configuration is archived in
`processing-config-history/revision-N.json`. The previous working file is also
kept as `processing-config.json.bak`. If the main file becomes unreadable,
Labatar restores the latest valid archive or backup and reports the recovery.
It preserves a damaged file under a `.corrupt-...` name. If nothing is
recoverable, processing fails visibly; only an explicit, validated import can
repair it. A future, unsupported schema is never downgraded to an older backup.

Importing an export or a history file restores its settings as a new revision.
History is retained without automatic pruning; repeated edits consume disk space.

## Analysis provenance

Each new analysis saves `processingSnapshot`, containing the full configuration,
its revision, the effective scaled detector geometry, source dimensions, and
the detector version and code fingerprint. The processor takes an independent
copy before sampling so edits during a run do not change that run's settings.

The viewer distinguishes **Process current calibration** from **Reprocess saved
calibration**. Selecting an old recording no longer replaces the editable
current configuration with geometry from that recording. The debugger previews
the recorded geometry by default; its current-calibration preview is explicit.

The code fingerprint changes when detector code changes and remains stable for
UI-only edits. Vite restarts on detector-source edits to refresh the signature.
The viewer warns if a recording was analyzed with a different detector.
Snapshots freeze calibration, not an executable copy of the old algorithm:
reprocessing saved calibration runs the current detector. Changes to the bundled
input-display rules require an explicit configuration migration/import rather
than silently changing saved calibration.

Older analyses contain only geometry and cannot recover missing runtime color
or template settings. New snapshots prevent that ambiguity going forward.
Unmatched framebar pixels remain `Unmapped`; they are counted as unknown, and
the warning reports common rejected RGB values. They are never guessed to be
active. A run that decodes zero frames fails instead of replacing a saved
analysis with an empty result.

## Regression checks

`vp check`, `vp test`, and `vp run build` validate the configuration code,
migration, restart behavior, invalid data, revision conflicts, recovery, import,
geometry scaling, and calibrated versus unknown framebar samples. These checks
protect configuration handling; they do not establish exact startup/active
counts for an unverified recording. Follow `OBS_RECORDING_PROFILE.md` and the
fixture policy before treating output as frame-data ground truth.
