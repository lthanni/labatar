# Recording-analysis fixtures

These fixtures are evidence for the recording-analysis pipeline, not authoritative
move data. A case becomes a regression target only after its expected observations
have been checked against the video by hand.

## Single-move capture status

Four candidate captures are now present in `cases.json`:

- `5A block.mp4`
- `2A block.mp4`
- `2B block.mp4`
- `5B block.mp4`

They are all Aang/Gyatso against Korra, identified as blocked, and begin with a
blank framebar. The 5A and 2A retakes are H.264 2560x1440 at 60 fps; the 2B
and 5B captures remain the earlier 30 fps versions. Their final frames still
contain the move history, so they are marked `capture-only` until the
processor's move boundaries and phase labels are checked. The 60 fps retakes
can now support exact phase verification; the 30 fps captures remain useful
for input identity, blocking, and zero damage only.

## Capture needed for exact single-move timing

The next fixture should be a short training-mode clip with:

- one character and support visible;
- input history and both framebars visible;
- a stable, totally blank framebar before the input; no neutral lead-in is needed;
- exactly one move, followed by its unambiguous return to blank;
- a stable return to a totally blank framebar after the move;
- no pause, menu transition, camera movement, or editing;
- the same supported OBS recording setup used for the other fixtures.

Please keep the original recording rather than exporting a shortened copy if
possible. When one is available, place it in the local recordings folder and tell
me its filename. I will add the expected input and phase timestamps after
inspecting the frames.

The existing `double-overhead double-cross.mp4` case remains a pressure-sequence
fixture. It is not a substitute for this single-move capture because its frame
meter resets during the route and it contains unresolved aerial move context.
