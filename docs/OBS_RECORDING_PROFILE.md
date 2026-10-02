# OBS recording profile contract

This document defines the OBS assumptions that affect Labatar recording
analysis. It is intentionally separate from the scene-collection export:
`Labatar.json` describes scenes and sources, while the OBS profile's
`basic.ini` stores video/output settings such as frame rate.

## Required timing setting

The managed `Labatar Recording` profile must use:

- FPS numerator: `60`
- FPS denominator: `1`
- Effective frame rate: `60 fps`

The app enforces this through OBS WebSocket `SetVideoSettings` when preparing
the profile or applying the Labatar scene setup. It reads the setting back and
fails visibly if OBS does not accept it. The UI also reports the current rate.

The app may resize the base and output resolution to the detected game-capture
source when the game is available. The base canvas preserves the raw capture
size, while the recorded output is normalized to even dimensions. This allows a
windowed DXGI source such as `2560x1441` to produce the expected `2560x1440`
recording without treating the one-pixel source discrepancy as a setup failure.
Resolution and frame rate are separate requirements: matching the source
resolution does not make a 30fps recording suitable for exact frame-data
analysis.

Each finalized recording manifest records the effective FPS, raw source/base
dimensions, output dimensions, and whether even-dimension normalization was
applied.

## Fixture policy

- A 60fps source is required for exact startup, active, recovery, blockstun,
  and hitstun boundaries.
- A 30fps source may still be useful for character/input identity, blocking,
  and damage, but it must not be treated as a 60fps frame-data oracle.
- Every timing-sensitive fixture records its source frame rate and whether
  phase boundaries have actually been verified.
- Do not copy the processor's output into fixture expectations without checking
  representative frames manually.

## Operational verification

Before capturing a timing-sensitive fixture:

1. Connect OBS in Labatar.
2. Run `Apply Labatar OBS setup`.
3. Confirm the panel reports `Capture frame rate: 60 fps`.
4. Capture the original recording rather than exporting a re-encoded clip.
5. Verify the resulting file's stream metadata before accepting frame data.

If the panel reports 30fps, do not use that recording to establish exact move
frame data. Fix the profile first and capture it again.

## Change discipline

Changes to OBS setup should update this contract when they affect capture
timing, source dimensions, codecs, audio routing, scene ownership, or fixture
validity. The app should manage these settings through OBS WebSocket where the
API supports them; direct edits to the user's AppData profile are a recovery
step, not the normal workflow.
