# OBS recording profile contract

This document defines the OBS assumptions that affect Labatar recording
analysis. It is intentionally separate from the checked-in `Labatar.json`
scene-collection export, which is a snapshot rather than the runtime setup.
The app manages the current scene through OBS WebSocket, while the OBS profile's
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

The managed `Labatar` scene collection uses the `Labatar - Game` scene. Setup
creates the Labatar profile, collection, scene, and sources when missing, or
updates their existing settings. Other OBS profiles and scene collections are
left in place. Setup preserves other scenes and sources in the `Labatar`
collection and non-Labatar scene items in `Labatar - Game`. Setup removes no
OBS entries. Surplus Labatar scene items in the managed game scene are disabled
to avoid duplicate capture. The game scene contains the full game capture and
independently switchable P2 crop, game audio,
desktop audio, and microphone scene items. Game audio and desktop audio are
mutually exclusive to avoid recording the game sound twice. Turning off desktop
audio restores the separate game-audio source when OBS provides one. Setup
adopts the switch state of the selected legacy scene on first migration and
preserves the current switches on later runs. Source switches are unavailable
during an active recording. The selected switches affect both manual and
automatic recordings. Enabling automatic recording turns off the P2 crop in
the managed game scene. Labatar keeps it off for automatic captures; the crop
can be switched on again after automatic recording is stopped.

The P2 item layers a tight crop from the same game-capture source directly
below the P1 framebar. The measured 2560×1441 OBS scene used a
1377/1309/177/86 pixel crop (left/top/right/bottom) at position (175, 1355).
The crop coordinates scale with the source dimensions when OBS can read the
game capture. If the game source is unavailable during setup, the overlay stays
hidden until setup is run again with the game open. The scene uses the same 60 fps
recording profile for every source combination.

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

Lobby recording begins before the first game so character selection and other
pre-game footage are preserved. If the lobby closes without a `SetNewMatch`
game (for example, after a declined match), Labatar keeps the MP4 but names it
`No game started - <UTC time>` and records `recordingStatus: no-game-started`
alongside the actual stop reason in its sidecar. The log does not reliably say
who declined or why, so this label does not claim a specific cause. No set
number is assigned to a lobby with no recorded game.

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
Clip export seeks to the requested start time before opening the source and
uses accurate seek while re-encoding. This avoids decoding from time zero for
every late chapter while retaining frame-accurate clip boundaries. Stream copy
is avoided because cutting only at keyframes can shift the clip start.

The Recordings viewer offers two in-place trim choices. Precise trim re-encodes
the selected range to keep the requested frame boundary. Fast trim copies the
video and audio streams, snapping the start back to the preceding keyframe.
The confirmation explains this and the completion message reports any shift.
Chapter times and linked clip positions use the actual retained start; partly
overlapping linked clips still use precise encoding. Chaptered recordings may
need a second stream-copy pass to preserve MP4 chapter positions. A temporary
candidate is verified before replacing the original recording.

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
Legacy combo-input chapters embedded in older MP4s are hidden from the timeline.
The player also hides synthetic "Recording start" and "Video start" chapters.
Labatar's chapter remuxer inserts a "Recording start" chapter when the first
real marker is later than time zero; FFmpeg otherwise moves that marker to
time zero. The lead-in chapter remains embedded to preserve the later marker's
time, but is not shown as a seek marker.
Nearby chapters may share a timeline tick.

## Combo lab input capture

**+ Record local combo** in the Combos tab starts a manual OBS recording and a separate Windows XInput
poller for the first connected Xbox-compatible controller. It does not require
Labatar to keep focus while the game is being played. The recording's
`.labatar.json` sidecar stores timestamped controller state changes: D-pad
numpad direction, left-stick direction, physical buttons, and game actions inferred from the Player 1
`data/button_config.ini` snapshot available when capture starts. If that file
is unavailable, physical buttons are still saved. The pad button order used to
infer game actions is the common Xbox A/B/X/Y, shoulder, trigger order and
should be verified against the game's input display before relying on labels.
The viewer labels the physical controller button separately from the game
input: with the current Player 1 bindings, controller X maps to game A and
controller Y maps to game B. A physical button label does not identify the
move that occurred in the game.

Starting capture also creates a local personal combo draft using the character
and support selected in the Combos tab. The combo entry and its MP4 link live
in the local combo workspace; the timed controller states live in the MP4's
`.labatar.json` sidecar. When the MP4 finishes saving, processing its captured
inputs fills the linked combo's suggested route. A trim is optional: an in-place
trim updates the route to the retained range, while exporting a clip moves the
link to that clip and updates the route from its processed inputs. The processed
file is `<video>.combo-inputs.processed.json`. It records direction changes, button
presses with timestamps and physical/game labels, both facing interpretations,
and suggested routes. Each button press points to its raw state index, and a
SHA-256 hash identifies the exact source capture used. The file is regenerated
when the raw capture changes or the processor version changes. Processing never
edits the raw capture. For example, down, down-forward, forward, then C pressed
while holding forward is suggested as `236C`. The processor reads Atk1-4 as
A/B/C/F, recognizes simple 236, 214, and 22 motions, and assumes the player
faces right for the default route. Unmapped physical buttons remain in the
processed press list without invented notation. It cannot infer side switches
or whether an attack connected. Processing defaults to facing right and
grounded. Facing changes still require manual route correction.

When a linked recording is submitted as a combo candidate, Labatar reads the
current processed input artifact from that recording. If its selected facing
route matches the combo and the upload JSON stays within the size limit, the
candidate receives the processed events and source hashes. The backend derives
the candidate's route text from the selected facing. If those conditions are
not met, the candidate upload uses the combo's route text. The raw controller
states and preserved full-session copy are not uploaded. Publishing that
candidate retains its processed artifact in the public combo record so its
timed events remain available after the review queue is cleared.

Direction changes record buttons that remain held. Releasing forward during a
held C changes `6+C` to `5+C` as a controller state, but does not add a second
`5C` press or route token. The viewer labels presses, holds, and releases
separately so a held state is not mistaken for another move input.
The recording player offers Raw clip states, Processed events, and Preserved raw
session views. These show timestamps, physical buttons, saved game actions,
interpreted directions and presses, both facing routes, and the processor's
source hash. Long lists are paginated. Its Reprocess clip inputs button forces
the processed JSON to be rebuilt from the clip-aligned raw capture in the
`.labatar.json` sidecar. The preserved raw session file is read-only in this
flow; reprocessing does not rewrite it or the sidecar.
Combo cards with a linked local capture show the editable facing-right input
chips and a Reprocess clip inputs button directly. The Recordings player keeps
the full raw and processed input inspector for detailed review.
The facing-right route in Processed events renders button presses as chips.
Clicking a chip edits its track token; right-clicking it toggles a `~` follow-up
or flips airborne/grounded from that chip onward, including the selected chip,
brackets the pressed button as charged (for example `j.2[C]`), or marks it
critical with a `!` suffix (for example `j.2[C]!`).
Delay adds `dl.` before that move (for example `dl.j.2[C]!`); it can be toggled
off on the same chip.
Any attack button (X) toggles A, B, or C to the generic X in the displayed
token, preserving its direction, airborne prefix, charge, and crit markers.
The menu can also replace a chip's leading numpad direction or motion with
another 1–9 digit sequence, remove it entirely, or clear the direction override.
For example, `236C` can become `623C` or `C` without changing the button;
the facing-left route mirrors an entered sequence. These edits change the
processed notation and leave the raw controller states untouched.
Clearing a direction override returns to the direction in the underlying
suggestion or manually edited token.
A later toggle flips the rest of the route again. Airborne suggested inputs
receive a `j.` prefix. The earlier per-press position-after override remains
available in the event editor. Chip edits update the displayed track immediately,
save to `<video>.combo-inputs.edits.json`, and reprocess 10 seconds after the
last chip edit (or when Apply pending edits now is clicked).
The Chip shortcuts button lets the player configure local keyboard shortcuts.
Hover a facing-right chip and press its assigned key to use the same edit path
as the context menu. Defaults are backtick for a `~` follow-up, `j` for
airborne/grounded from that chip, `r` to remove its direction, `x` for any A/B/C
attack (`X`), `d` for delay (`dl.`), `[` for charged, and `1` for crit. Follow-up is unavailable on the
first chip. These actions
appear first in the right-click menu, with the current key before each action.
Shortcuts do not fire while the inspector's edit dialogs are open or while holding Ctrl,
Alt, or Command. Hovering a chip takes priority even if keyboard focus remains
in another field. Repeated keydown events are ignored so a held key toggles
only once.
The edits are keyed to the original input timestamp and physical button.
Reprocessing reapplies them. An in-place trim keeps the file; an exported clip
gets a copy.
Processing writes the timed input events to the separate processed JSON file.
It does not add input chapters to the MP4. Reprocessing updates the JSON and
preserves existing MP4 chapters. Older recordings may still contain embedded
input chapters; Labatar hides those markers in the player without rewriting
the existing files.
The Combos detail and Recordings views can render a separate full-length MP4
with the processed input sequence. This render crops approximately 2.5% from
the top and 7% from the bottom, scales the remaining game image into the upper
80% of a frame at the original dimensions, and places the input text in the
black lower band. Each token starts white, stays red during its own controller
button hold, then returns to white. Simultaneous buttons are highlighted
independently. If input
capture is interrupted while a button is held, its highlight ends at the last
saved controller state. Rendering re-encodes the video, keeps
the clip-aligned input capture and edits with the new copy, and leaves the source
MP4 unchanged. Review the copy before upload: the overlay inherits the
approximate controller-to-video alignment described below, and edited notation
may not match the game if the facing assumption is wrong.
After editing chips on an annotated copy, the render button appears again. A
new copy uses the original MP4 for its picture and the annotated copy's saved
input edits for the overlay. The app requires their timelines to still match;
it keeps both existing videos.
The position marker is a user annotation, not video-based landing detection.
Editing the route keeps the user's correction instead of overwriting it on
later trims. The recording's timed input states remain available for review.

Labatar anchors controller timestamps to the OBS recording-start event and
subtracts OBS pause intervals. This is an approximate alignment, not a
frame-exact measurement of when the game accepted an input. Clock changes,
WebSocket event delay, the poll interval (8 ms requested), and OBS encoder
delay can shift an input relative to a video frame. Input capture can stop
early if the controller disconnects; the saved metadata marks that case.

Precise and fast in-place trims crop and shift the input timeline in the same
manifest replacement as the MP4. Fast trim uses the actual keyframe-snapped
start. Exported clips, including F10 clips, receive their own cropped input
timeline. The state already held at the new clip start is retained at time
zero. As with other recording sidecar metadata, an app crash before OBS
finalization can leave a video without its captured input timeline.

For new sessions started with **+ Record local combo**, Labatar also saves the full original capture as
`<video>.combo-inputs.raw.json`. This file is written once and is never changed
by processing or trimming. An in-place trim preserves this full-session copy,
while the MP4's `.labatar.json` capture becomes clip-aligned and the separate
processed file is regenerated from that clip-aligned capture. The manifest and
processed file record the current MP4's start offset into the preserved raw
timeline, including offsets accumulated across later trims. For older
recordings without a full-session copy, Labatar saves one before the first
in-place trim when the untrimmed timeline is still available. It cannot recover
inputs already discarded by a trim done before this behavior was added.

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
