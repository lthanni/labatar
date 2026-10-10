# Automatic move processing with isolated capture

Status: isolated Aang/Gyatso training view and scripted Player 1 normal and
quarter-circle inputs verified on 2026-10-08. The first capture runner is
implemented but awaits a live scripted reset and end-to-end OBS take test. All
tested installed game files were restored from verified backups after the
isolation test.

## Dev-only blackout launch

The Dev-only capture tab now offers **Start game in blackout mode** when
`Atla.exe` is closed. It verifies the selected game's four shipped PAK hashes,
copies and verifies originals under the dev user-data `blackout-game-backups`
directory, installs the previously tested Water Tribe, Korra/Naga, and HUD
replacement PAKs, plus a targeted `hitspark.pak` shadow replacement, then launches `Atla.exe`. A detached watcher restores the
original PAKs after the game exits; the backup copies remain available. A
saved session manifest lets a later app launch recover an interrupted install
or restore. Changed game versions fail the hash check before installation.

Manual move arming, manual move recording, automatic move capture, and recording
starts from the Dev-only tab require a running game with all four installed
PAKs matching the blackout replacements, plus an OBS connection. The asset
check works whether Labatar launched the game or the matching PAKs were installed
before opening it. Labatar restores originals automatically only for sessions
it prepared and backed up. An already open game disables the launch button.
An active blackout hides that button. An automatic pass, an active recording, or
OBS work locks conflicting manual controls and explains the reason in the panel.
Reviewing and processing saved move videos remains available after the game closes. The
PAK installation and restoration have temp-folder tests. On 2026-10-09, the
user confirmed the launched game was visually blacked out, but the verifier
rejected its session after an early transition to `restoring`. The installed
PAKs still matched all three blackout hashes. The verifier now recovers that
state only while the game is running and both patches and backups hash-match;
the watcher waits through startup and launches independently of the dev app.
After the game closed in that test, the three originals were restored and
their hashes verified. The revised watcher, in-game reset, and OBS pass still
need a live check.

## Capture review layout

Dev-only capture keeps character, move, and take selection on the left. Capture,
Review & process, and Move evidence are separate tabs below those selectors. A
video player occupies the right 60% on desktop and moves below the controls on
smaller windows. Selecting a saved take plays it there, including recordings
awaiting manual approval after an automatic pass. This is the full player panel
from the recordings tab, with its playback, timeline, chapter, clip, and exact
frame review controls. The recording library sidebar is hidden on the capture
page.

## Goal

Turn a selected move take into clean images of every observed animation frame,
then reviewable frame data. Preserve the original recording and link every
output to its source frame. An image alone does not establish startup, active
frames, recovery, contact, or hitbox geometry.

## Current facts and open assumptions

- Labatar already queues takes by character, support, move, and situation
  (whiff, block, grounded hit, airborne hit), then processes and reviews them.
- The existing file reader extracts type-6 portrait images from PAK archives.
  A separate test builder has now produced transparent type-3 and type-6
  `.munged` frames in replacement PAKs that the game accepts.
- The current move processor reads the visible input history, framebars, and
  colored overlay boxes. Its Electron frame reader returns 60 as a fixed rate
  and transcodes decoded frames to JPEG before analysis. The managed OBS profile
  targets 60 fps. The existing image quality may already be sufficient for
  reviewable snapshots; timing accuracy still needs validation.
- A local test confirmed that replacing the shipped `watertribe.pak` with an
  edited copy changes the selectable Water Tribe stage. The character and
  training HUD remained visible when its visual layers and stage sprites were
  disabled.
- The user confirmed that the combined Water Tribe, Korra/Naga, and HUD test
  produced the intended isolated view while retaining the training frame meter
  and inputs. Frame timing and game-state equivalence have not been measured.
- Player 1's installed `data/button_config.ini` maps keyboard device 7 to
  attacks (`A`, `S`, `D`, `Z` for Atk1-4) and arrow keys to directions, alongside
  an Xbox controller mapping. The user confirmed that scripted `5A` and `236A`
  reached Player 1's input history and made Aang perform the expected moves.
- In the user's training setup, a tap of Back resets to the chosen positions
  and restores resources. Player 1's current keyboard config maps `KEY_BACK`
  to `Select`; automated reset through that binding still needs an in-game
  test.
- Labatar already has a character/support-specific gather queue and a one-video
  move-take workflow. It currently arms the next move after each manually
  started and stopped recording. It processes pending videos before its final
  evidence-acceptance action; it has no separate pre-processing video approval.

## First delivery: automatic whiff capture

The first implementation has the nonstandard catalog tag, recipe queue
preview, packaged Windows input worker, Electron capture runner, persisted
pause/resume state, one-MP4-per-move manifest, and video approval gate. The UI
queues `1`–`9`, `236`, and `214`, optionally prefixed with `j.`, followed by
`A`, `B`, `C`, `F`, or `EX` (`A+B`). For `j.` moves, the input worker presses
jump, releases it, pauses briefly, then sends the listed input. Player 1's
keyboard bindings determine the physical keys;
directions are relative to the selected facing. Only `5A` and right-facing
`236A` have been confirmed in game. Other recipes need video review, and their
timing is not frame accurate. Charged, stance, dependent, and other
unimplemented inputs remain visible with skip reasons. The jump delay and
airborne input recognition still need in-game validation.

The command **Gather whiff data for all moves** runs against the selected
character/support variant. The user first sets the training position, facing,
opponent distance, frame meter, input display, and OBS capture profile. The
runner then makes one MP4 per eligible move. It does not process or accept any
move data during the capture pass. The user's requested per-move order is:

1. Send Player 1's training reset (the Back/Select binding) and release it.
   Wait for the reset to settle at the chosen starting spot.
2. Arm the catalog move as a whiff take. Start OBS recording and await its
   `StartRecord` acknowledgment. Leave a short recorded neutral lead-in.
3. Send the move's input sequence. Release every key, then wait two seconds
   from the final key release.
4. Send and release training reset again. Stop OBS recording after the reset
   has registered.
5. Await `StopRecord`, MP4 finalization, move-take manifest creation, and file
   existence. Record the result, then advance to the next eligible move.

The two-second tail is the first-release default. A move known to have
animation or recovery longer than that needs a longer recipe or a manual take;
if a reset cuts off a move, video review rejects the clip. The script schedules
inputs by wall-clock time, so the recorded input history and frame meter remain
the timing evidence. No injected timestamp is treated as a game-frame number.

### Eligibility and manual nonstandard tag

Add an editable `nonstandard` boolean and optional explanatory note to each
`TechMove` in Tech -> Moves. This is separate from `notApplicable`: a
nonstandard move can still have a whiff evidence slot and can still be recorded
manually. The user can set or clear the tag at any time; the automated queue
always skips tagged moves and shows them in a manual-capture list.

An untagged move enters the automated queue when it has a supported recipe
and its selected evidence slot is missing or needs redo. Supported recipes are
`1`–`9`, `236`, and `214` with `A`, `B`, `C`, `F`, or `EX`, with an optional
`j.` prefix for jump attacks. Jump attacks use the same grounded reset point;
the worker sends jump before the motion or attack.
The runner sends `EX` by pressing the configured `A` and `B` keys together.
It skips charged/held inputs, stance entries and followups,
`SUP`/`X`, and any notation without a recipe. Record a skip reason for each,
without silently changing its `nonstandard` tag. The user can still record
those moves through the existing manual gather controls. A supported recipe
does not guarantee the move whiffs from the chosen position; video review
checks the result before processing. A `j.` clip also needs review to confirm
the attack occurred in the air. Airborne move recognition and frame-data
processing can be refined after these captures are tested.

One starting distance cannot guarantee a whiff for every move, especially
long-range attacks or projectiles. The queue preview must make that setup
assumption visible. The user can mark those moves nonstandard or skip them for
the pass; the video-review step decides whether each recorded take actually
whiffed.

Build the queue from a snapshot of the selected variant and catalog IDs. By
default, skip slots that already have an active or pending take; offer a
separate explicit retake action later. Show the queued moves and all skip
reasons before starting. A move is attempted at most once per pass. A
successfully finalized video advances the pass even if later review rejects it.
An OBS or storage failure leaves the current move unattempted and pauses the
pass for retry.

### Run control and safe failure

The Electron main process should own the run state and call the existing
move-arm, OBS start/stop, and finalization functions. It should use a single
long-lived Windows input worker adapted from
`scripts/send-p1-training-input.ps1`, with structured commands for reset and
move recipes rather than shell-built command strings. Package the worker with
the Electron app. Prepare and verify the managed 60 fps OBS profile once before
the pass, then reuse it for each clip.

Starting the pass gives the user a countdown to return focus to the game.
Before each key event, the worker checks that `Atla.exe` is foreground; if
focus is lost, it releases all held keys and pauses the run. Stop/cancel also
releases keys and ends an active recording safely. OBS disconnection, a game
exit, an unexpected recording, or a failed reset stops progress and shows the
current move. The run may resume only after another reset and preflight.

Persist a run ID, variant, outcome, queued move IDs, skip reasons, current
phase, and completed recording IDs. Store the run ID and input/reset recipe
with each move-take manifest. On restart, reconcile the run against finalized
manifests before offering resume so no move is advanced merely because an OBS
stop was requested. Keep the existing one-active-take-per-slot rule.

### Review before processing

Automated captures need a separate visual review state:
`awaiting-video-review`, `approved-for-processing`, or `rejected`. It is
independent of the existing `pending`/`active`/`archived` evidence status.
After a pass, show all its videos in order with the intended move and input.
The user watches each clip and confirms character, whiff, complete animation,
visible input/frame meter, and clean reset, or rejects it with a reason. A
rejected clip stays inspectable in the archive and returns its slot to the
retry queue. Approval makes the take eligible for **Process approved**; it
does not write measured values to Tech -> Moves.

Processing then uses the existing input/framebar validation and preserves its
analysis history. After processing, the existing evidence review can accept
source-linked measurements or reject an ambiguous take. Legacy/manual takes
without this new video-review field retain their existing workflow. Do not
auto-accept a move solely because the scheduled input matches its notation.

The Dev-only capture list offers a confirmed **Delete video** action for
captured, pending move videos that have not been processed, including automated
videos still awaiting visual approval. It removes the MP4 and its manifest;
processed or accepted evidence cannot be deleted through this action.

### Implementation and verification order

1. Add the persisted nonstandard tag and reason to Tech -> Moves, and display
   nonstandard and unsupported skip reasons in the gather preview.
2. Add a short Back/Select tap to the input worker. Verify in game that both
   scripted taps return to the chosen spot, replenish resources, preserve the
   desired facing and training options, and do not open a menu. Calibrate the
   tap and settle durations before a batch. Until visual reset detection
   exists, treat the input acknowledgment as delivery only and use the
   one-move clip and later video review to confirm the reset effect.
3. Implement one-move orchestration in Electron: reset, OBS start, input,
   two-second tail, reset, OBS stop, saved-manifest check. Confirm a real 60 fps
   recording and correct move-take association.
4. Add the queue, progress/pause/cancel/resume controls, persistent run state,
   and per-move errors. Test sequencing with a fake input worker and fake OBS
   client, then capture a short Aang/Gyatso whiff pass in training.
5. Add the video-review gate and **Process approved**. Verify that rejected
   and unreviewed clips are never processed automatically, and that accepted
   measurements still require the existing post-processing evidence review.

## Verified black-background experiment

The game selected `watertribe` before entering training; its log showed
`Changing Level To: watertribe`. The built-in `greenscreen.pak` was not the
loaded stage in the first test. Changing a saved training-stage value did not
override the character-select stage choice.

The successful test used `data/levels/watertribe/watertribe.lvl` inside the
shipped `data_packages/watertribe.pak`. A same-size copy of the PAK commented
out 377 commands in the `Layers and Sprites` section. The stage setup and
environment sections, all other entries, and the PAK directory were preserved.
The game loaded Water Tribe, and the user confirmed a black background with
the character and training HUD visible. The original PAK was then restored and
its SHA-256 matched the saved backup:
`2138e9227a2948fe19fe77cc4bfc1b34c6a9265525b757a856db6f911a98ba78`.

The local ignored work area retains the original and test PAKs under
`.dev/installer/black-stage/`. The original PAKs are installed now. A game
update may change the shipped PAKs, so compare their hashes with the backups
before reusing test copies. The modding tools at
[calebrisc/avatar-legends-tools](https://github.com/calebrisc/avatar-legends-tools)
document PAK extraction and repacking, type-3 frame encoding, and the finding
that loose files or extra PAKs do not override shipped entries. Removing stage
commands from the loaded `.lvl` avoided deleting referenced assets.

## Verified opponent and HUD isolation

The test builder `scripts/build-capture-isolation.cjs` made transparent
replacements for 2,637 Korra/Naga/VFX frames and 533 fight-HUD frames. The
separate `training_timing_bar.pak`, which holds the frame meter and input
display, was left intact. The Water Tribe test copy also disabled stage visuals
and set floor-shadow alpha to zero. The user confirmed the combined result in
training mode. All three installed PAKs were restored after closing the game;
their SHA-256 hashes matched the saved originals:

- `watertribe.pak`: `2138e9227a2948fe19fe77cc4bfc1b34c6a9265525b757a856db6f911a98ba78`
- `korra.pak`: `b2241aac58acd890026c084e6f2e8e677e995a3bdf3f9c3701ebe0cc338f6559`
- `hud.pak`: `24b0d04eb5288f28a9e0d28b6b22985e7e81f3a6ea611ef9f6f192acac0e1ce1`

The visual test establishes that the mod loads and hides the selected art. It
does not yet establish that all move effects, collision visuals, or timing are
equivalent to an ordinary training session.

## Support shadow and collision overlay investigation

A blackout recording still showed a soft oval at center stage. The shipped
`hitspark.pak` contains `blob_shadow/frames/circle.munged`, a matching soft
oval image. The blackout builder now makes a separate `hitspark.pak` copy with
only that image transparent; all other effects remain byte-identical. The
launcher includes this fourth PAK in its hash-checked backup, install, and
restore flow. The asset-level comparison showed that only this image changed.
The user confirmed in game that the oval disappeared while the frame meter
and hit/hurtbox overlays remained visible.
After that test, Windows briefly locked `hitspark.pak` during automatic restore.
The verified backup restored it on retry, and all four installed PAKs matched
their original hashes. The watcher now retries a transient `EBUSY` lock.

A later launch exposed a separate startup race: Labatar began restoring the
PAKs one second before its newly spawned game process appeared. Water Tribe
was restored while Korra, HUD, and hitspark remained patched, producing a
colored stage in otherwise isolated training. After the game closed, the
watcher restored and verified all four originals. Launch now writes a
`launching` phase before spawning the game, gives that phase a one-minute
recovery grace period, and treats temporary process-check failures as
unconfirmed rather than immediately restoring assets. A subsequent launch
reported a timeout even though the game log began three seconds later. The
launch deadline and watcher grace periods now use monotonic elapsed time;
the launch confirmation window is 30 seconds. The next test showed the
actual false timeout: one process check briefly saw the game and exited the
wait loop, but a second immediate check did not see it. That produced a
"30 seconds" error after only 337 ms, while all four PAKs remained patched
and the game started shortly afterward. Launch confirmation now requires two
successive process sightings and has a regression test for that sequence.

The PAK directory scan found no named training hitbox or hurtbox frame asset.
`hitspark.pak` does contain three `graze_box` images, and the character
`.sprbin` contains strings such as `RingHitboxActive`. This suggests some
collision behavior is represented in serialized animation data, but the
box geometry and training overlay rendering have not been decoded. The
visible training boxes should continue to be measured from recorded frames
unless that format is established.

## Capture design

Use two outputs for the same catalog move when isolation is feasible:

1. **Evidence take:** ordinary training-mode recording with input history,
   framebars, defender, and collision overlay visible. Use this for move
   identity, phase timing, contact, opponent state, and hitbox candidates.
2. **Clean visual take:** isolated performer against a known solid background.
   Hide stage decoration, opponent art, unrelated effects, and distracting HUD
   art while retaining any signals needed to align the move. Use this for
   animation snapshots and silhouettes.

The two takes should be linked by catalog move ID, support variant, situation,
game build, mod profile, and capture profile. Do not pretend two separate
executions have identical frame timing. If both outputs can be captured from one
execution, use that shared timeline; otherwise align their input and framebar
events and retain any mismatch.

Transparency inside the game's assets is not an alpha channel in a normal OBS
video. Transparent pixels reveal whatever the game renders behind them. A
uniform background should make the recorded frames easy to crop or key into
useful snapshots, even if the edges are approximate. Direct animation-asset
extraction is optional if the video results look good enough.

## First experiment: one move

1. Reapply the verified isolation profile only when needed, after comparing
   the current PAKs with their saved originals. Keep the selected stage and
   capture profile in the take metadata.
2. Record a normal take and an isolated take of the same move at verified 60
   fps. Retain original files and inspect their stream metadata, visible frame
   sequence, and where the move begins and ends.
3. Export representative frames through the existing video reader and inspect
   them as a contact sheet. Check the character outline, effects, floor contact,
   spatial alignment, and whether a simple crop or background key gives usable
   snapshots. Try direct animation-asset extraction only if video quality or
   isolation is insufficient.

The image-first experiment succeeds if the modified game loads reliably, the
original gameplay/framebar behavior remains the same, the move's visible
animation frames are captured, and the contact sheet is useful for reviewing
the move. If replacement loading fails, investigate direct animation extraction
before building a larger recording pipeline. Phase and hitbox measurements are
a second acceptance gate, after snapshot extraction works.

## Processing pipeline after the experiment

1. Keep the existing move catalog and four evidence slots as the queue and
   identity source. A selected move and situation are capture intent until the
   video confirms them.
2. Ingest the original recording with measured stream rate and timestamps.
   Record frame identity and gaps. Use the framebar transition plus input event
   to locate the move; refuse a precise phase count when the boundary is
   missing or ambiguous.
3. For each confirmed move frame, save a snapshot and metadata containing
   source recording, source frame/time, move ID, phase, visual profile, crop,
   transform, and confidence. Optionally derive an alpha mask from the plain
   background; label keyed masks as estimates.
4. Read collision overlay colors separately from character artwork. Keep
   attack, hurt, and other box semantics unresolved until validated with
   manually checked frames. A character silhouette is not a hitbox.
5. Present a contact sheet and frame timeline for review. Accept measured
   values into Tech -> Moves only after outcome, timing, and visual identity
   are confirmed. Preserve rejected takes and prior analyses for debugging.

## Implementation boundary

Keep asset inventory/mod-profile creation separate from Labatar's normal
recording workflow. The current match log watcher handles online match and
replay events; it is not a training-mode move trigger. The first automation
target is the standard-move whiff capture pass above. Processing and evidence
acceptance stay separate and happen after the user's video review.

Potential code changes after the experiment, in order: a small asset inventory
for the isolation profile, capture-profile metadata on move takes, a video-frame
snapshot exporter, an optional background-key processor, a contact-sheet review
view, then phase and collision analysis improvements. Any OBS profile change
must update `OBS_RECORDING_PROFILE.md` and be verified against actual media
metadata.

## Player 1 input automation experiment

The installed Player 1 keyboard mapping and Windows `SendInput` work in offline
training without a virtual-controller driver. The user confirmed both a `5A`
normal and a `236A` special in Aang's animation and Player 1's input history.
The sandboxed execution path could not see the foreground desktop, but the
approved interactive execution path could. A virtual Xbox controller remains
an option if the keyboard path later proves insufficient; it needs a system
driver and a separate player-assignment test. Neither route guarantees exact
game-frame timing from wall-clock sleeps.

The local pilot is `scripts/send-p1-training-input.ps1`. It reads Player 1's
current keyboard bindings, supports basic `5A`, `2B`, `236C`, and `214F`-style
inputs, reverses horizontal direction when facing left, and refuses to send
keys unless `Atla.exe` is foreground. It has a dry-run mode. Only `5A` and
right-facing `236A` have been tested in game. It does not yet automate OBS. The
current Windows session blocks direct PowerShell script execution, so invoke
it with a process-local execution-policy override, for example:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\send-p1-training-input.ps1 -Move 5A -DryRun
```

For one Aang/Gyatso move, use this order:

1. Enter training manually with Aang/Gyatso, Korra/Naga, and Water Tribe.
   Verify the game is foreground, offline, and showing the input history and
   frame meter. Abort input injection if focus leaves the game.
2. Extend the verified `5A` and `236A` trials to down attacks, reverse facing,
   the other buttons, and `214` motions. Confirm the displayed inputs and
   resulting animation. Resolve the remaining notation-to-physical button
   mapping from the display instead of assuming Atk1-4 labels.
3. Set a reproducible training state, wait for neutral and recovery, start or
   mark an OBS recording, execute one catalog move, and leave a long enough
   neutral tail. Save the intended input, actual injected event times, OBS file,
   game version, and isolation-profile hashes together.
4. Process the recording and verify the observed input and framebar before
   accepting snapshots or phase counts. Retry or flag ambiguous takes rather
   than attributing frames to the intended move by schedule alone.
5. Expand to a catalog queue only after one move repeats reliably. Charged
   inputs, airborne moves, meter-dependent moves, stance followups, side
   reversal, and different hit situations each need explicit setup and checks.

The controller script is an execution aid, not a frame clock. Use the recording
and visible framebar to measure timing. The normal and isolated takes may need
separate runs and should retain separate timestamps.
