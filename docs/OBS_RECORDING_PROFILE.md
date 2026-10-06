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

## Automatic matches and lobby events

Public-lobby fights can log `Adopting already joined lobby: <id> with gamemode
PUBLIC` without the `XMatch` or meetup events used by matchmaking. Labatar
recognizes that adopted fight lobby and keeps one automatic recording open
across its games, stopping when Steam logs that it left the same lobby. A
repeated adoption of an already known meetup lobby does not start a new
recording. If Labatar starts after the adoption event has fallen outside the
log-recovery window, it may still fall back to one recording per match.

Some identified online matches emit `SetNewMatch` and replay events without a
new lobby event. When automatic recording is enabled, Labatar can capture one
such match per recording if the log includes a match ID, ranked/casual mode,
and two distinct numeric player IDs. The recording stops at that match's end.
Only a replay with the same match ID and matching character identities is
linked to it. Without a lobby ID, Labatar cannot establish a historical set
number, so these files use a `match` label instead of inventing one. Matches
without enough identity information remain unrecorded automatically.

## Recording chapter markers

The Labatar Recording profile uses OBS Hybrid MP4 (`RecFormat2=hybrid_mp4`).
While OBS is actively recording, Labatar's F10 shortcut (or its chapter button)
sends the OBS WebSocket `CreateRecordChapter` request without a name. OBS adds an
"Unnamed N" chapter to the MP4 during normal recording finalization. This does
not create a Labatar-only sidecar marker or remux the video afterward. Chapters
are not recoverable if OBS cannot finalize the recording after a crash.
Labatar does not send the request while recording is stopped or paused; OBS
rejects it if the output format does not support chapters.

Once a Labatar recording has finalized, Labatar reads its native MP4 chapters
and creates a separate clip for the 30 seconds before each "Unnamed N" F10
chapter (or from the beginning when the marker is earlier than 30 seconds).
Automatic recordings wait for replay linking and optional game-chapter
postprocessing first. The Recordings view also offers "Create 30-second clips
from manual chapters" for older MP4s. Both paths skip clips already generated for the same source and
marker, so retrying only fills gaps. Clip manifests retain the source recording
and marker time; encoding runs in the background and may take time or use
substantial disk space. Individual failures are reported in the manual action
or recording diagnostic log, while successfully created clips remain available.

Optional automatic game-start chapters are separate from F10. When enabled in
Capture configuration, Labatar waits for replay linking after an automatic
recording stops, then uses the UTC clock time of each `SetNewMatch` game-start
log line and the MP4 creation time to place chapters. The recording's streams
are copied into a temporary MP4 without re-encoding, then the verified file
replaces the original. Existing OBS chapters are preserved. The option is off
by default; earlier automatic MP4s can be processed individually from the
Recordings context menu. Re-running replaces Labatar game chapters, not OBS
chapters. Starts shortly before capture are marked "start not captured" at
time zero; games with missing, mismatched, or implausible times are skipped.
This requires temporary free disk space roughly equal to the recording size.
Game-log times have one-second precision; pauses, clock changes, or incorrect
MP4 creation metadata can make chapter placement inaccurate. Labatar skips
obviously out-of-range starts, but cannot reconstruct pauses from the sidecar.
The Recordings player reads chapter titles and start times from the MP4 itself.
It shows chapter ticks above the seek bar; hovering shows the title, and
clicking a tick seeks to that chapter. This includes native OBS/F10 chapters
and postprocessed game-start chapters without relying on sidecar estimates.

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
