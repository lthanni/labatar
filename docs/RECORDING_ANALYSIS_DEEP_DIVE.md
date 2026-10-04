# Recording analysis deep dive

Status: architecture and validation plan in progress

This document defines the intended direction for processing training-mode videos. It is deliberately more rigorous than the current prototype so that detector changes can be evaluated against evidence instead of visual impressions.

## Product goal

Given a supported training-mode video with the input history and framebars visible, Labatar should produce a reviewable analysis containing:

- the player character and support
- the input notation for each detected move
- the ordered move sequence
- frame data for each move
- damage for a combo or pressure string
- source timestamps and logical frame ranges
- confidence and data-quality indicators
- debug evidence explaining every important conclusion

The first saved result should be a candidate analysis. It should not silently overwrite the authoritative move or combo catalog until the result passes confidence checks or is reviewed by the user.

## Scope milestones

### Milestone 1: Single move

Input:

- training mode is visible
- input history and framebar are visible
- the framebar is stably blank before the move begins
- one move is performed
- the framebar returns to a stably blank state after the move

Output:

- character and support
- input notation
- startup, active, and recovery observations
- opponent hitstun or blockstun when visible
- source timestamp and logical frame range
- missing-frame and confidence information

For this fixture type, a neutral lead-in is not required. The blank framebar is
the start anchor: the first confirmed transition away from blank begins the
move episode, and the confirmed return to blank ends it. “Blank” must be a
recognized stable detector state, not merely an absence of usable color data.

### Milestone 2: Combo or pressure string

For clips up to approximately 20 seconds, identify:

- character and support
- ordered move sequence
- damage
- timing between moves
- whether the sequence appears connected or contains gaps
- source timestamps for every move

The result must distinguish confirmed, ambiguous, unresolved, and contradictory observations. An absent observation must not become an invented zero.

### Reach goal: hitbox capture

Execution video alone cannot reveal hitboxes unless hitboxes are visibly rendered in the recorded image or another synchronized data source exists. If training mode exposes a hitbox overlay, active-frame geometry can become a separate detector. If it does not, this goal requires a different capture or instrumentation method.

### Reach goal: corner distance

A single successful execution gives the position where it worked, not the maximum distance from the corner where it works. Corner range requires player/world-position extraction plus stage geometry, or repeated executions from controlled starting positions.

## Current implementation audit

The current prototype proves that browser-based analysis can produce diagnostics, but several shortcuts make correctness and reproducibility difficult:

1. Detector functions are split into pure modules such as `src/framebar-detector.ts` and `src/input-display.ts`.
2. `src/recording-processor.ts` orchestrates those modules without importing React or a live overlay component.
3. Calibration, templates, and runtime color mappings are read from renderer `localStorage`.
4. Desktop analysis now uses the Electron FFmpeg frame reader and canvas sampling when available; the hidden HTML video remains a browser/fallback adapter.
5. The FFmpeg path samples sequential source frames, while the browser fallback uses a logical 60 FPS seeking interval; each analysis records which path was used.
6. Some calibration values are percentages while other values are source-pixel offsets, but the calibration snapshot does not consistently identify its source dimensions.
7. The debugger has historically had separate geometry code from the detector, allowing the displayed regions to drift from the pixels actually sampled.
8. Older analyses do not necessarily contain the exact configuration, templates, or color map used to generate them.
9. Phase labels can be approximate when runtime color mappings are unavailable.

These are not proof that the current approach must be discarded. They are the risks that the next design should remove or explicitly accept.

## Evidence fixtures

The current repository contains candidate local recordings under `.dev/recordings`. Their existing analysis manifests are useful observations, but they are not yet manually verified ground truth.

| Fixture                            | Current evidence                                                                                                               | Intended use                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `double-overhead double-cross.mp4` | training ratio about 0.92, diagnostics and a newer calibration snapshot; manually verified as an Aang/Gyatso pressure sequence | first verified pressure fixture                                                         |
| `high-low double-cross.mp4`        | training ratio about 0.94, four detected moves and diagnostics, older analysis without the newer calibration snapshot          | positive input and migration candidate                                                  |
| `Aang_Gyatso_Midscreen.mp4`        | training ratio 0 and no detected moves                                                                                         | negative or uncertain case; must be manually classified before becoming a hard negative |

The fixture set should eventually be represented by a small manifest, not by committing large recordings into the repository:

```text
fixtures/recording-analysis/
  cases.json
  README.md
  labels/
  frames/
```

Each positive fixture needs manually checked frame timestamps and expected observations for at least a few representative frames. The existing detector output must not be copied into expected labels without review.

### First verified fixture

`double-overhead double-cross.mp4` is the first fixture with manually supplied ground truth. It is not a combo and should not be evaluated by damage or combo-continuity rules:

- performer: Aang with Gyatso, Player 1
- opponent: blocking for the entire clip
- route: `236C`, scooter-hop with `C`, `j.2C`, `j.5F`, `j.B`
- current parser assessment: input recognition is mostly correct; the remaining errors are canonical move resolution
- damage: `0`
- hitboxes: visible
- neutral lead-in: none
- frame meter: resets at least once inside the route; this must split frame-data segments without ending the overall pressure episode

The machine-readable case is recorded in `fixtures/recording-analysis/cases.json`. The current output needs three resolution improvements: infer `j.2C` from an observed `2C` plus aerial context, map the observed `5S` button slot to the canonical `F` label, and add the aerial prefix to both `j.5F` and `j.5B`. This means input recognition and canonical move resolution must remain separate stages.

The fixture contract now has automated coverage for the expected performer/route/damage
metadata, the accepted notation grammar, and manual airborne-state application. It does
not yet compare detector pixels or frame timestamps; that requires the single-move capture
and verified frame labels described in `fixtures/recording-analysis/README.md`.

## Required data-quality model

The analysis model should preserve uncertainty instead of collapsing it into plausible-looking values.

Every move observation should be able to report:

- source timestamp
- logical frame index, when known
- observed frame count
- missing-frame count
- input notation and confidence
- framebar phase observations and confidence
- training-mode state and confidence
- whether a value was directly observed, inferred, or unavailable

For example, a move should be able to say:

```text
startup: 12 observed frames
active: 5 observed frames
recovery: 18 observed frames
missing frames: 1
quality: degraded
```

It must not report `recovery: 0` merely because recovery could not be read.

## Frame-fidelity policy

The detector should use a logical 60 Hz timeline because the game’s frame data is discrete, but it must retain source timestamps and source frame identity.

For every source gap:

- record the number of missing logical frames
- do not invent unseen framebar states
- tolerate small gaps when they do not cross a critical transition
- flag results when a gap crosses input, phase, or episode boundaries
- make the maximum tolerated gap configurable

The first validation threshold can be 1–3 missing frames. Gaps of 3–6 frames should be treated as a degraded-result boundary, not as silently acceptable data. The appropriate threshold must be measured against fixtures.

## Color and visual detection policy

Raw RGB equality is not sufficient for compressed video or changing stages. Detection should combine:

- color distance and tolerance
- local contrast
- expected HUD geometry
- temporal stability
- neighboring-frame evidence
- per-video calibration when needed

Unknown colors should be retained as diagnostic evidence. They should not be silently converted into a phase label.

## Target architecture

The detector should become a pure, shared core with adapters around it:

```text
media ingestion
  -> timestamped frame provider
  -> shared detector core
       -> input detector
       -> framebar detector
       -> training-mode detector
       -> identity detector
       -> episode correlator
  -> analysis result and debug artifacts
  -> review UI and searchable metadata
```

Proposed modules:

```text
src/recording-analysis/
  types.ts
  config.ts
  frame-provider.ts
  input-detector.ts
  framebar-detector.ts
  training-detector.ts
  identity-detector.ts
  episode-builder.ts
  debug-renderer.ts
```

`recording-processor.ts` is the browser-video adapter. Detector modules should not import React, read `localStorage`, or depend on a live overlay.

## Calibration contract

Calibration must be an explicit, versioned analysis input. A future snapshot should contain at least:

```json
{
  "schemaVersion": 1,
  "sourceWidth": 1920,
  "sourceHeight": 1082,
  "coordinateSpace": "source-pixels",
  "regions": {},
  "inputGeometry": {},
  "framebarGeometry": {},
  "colorMap": {},
  "digitTemplates": {}
}
```

Each saved analysis must retain the exact snapshot used. Current renderer storage can remain a user-editing convenience, but processing must receive an explicit configuration object and save it with the result.

## Media backend decision

The offline pipeline supports two frame-provider implementations:

### Browser video and canvas

Useful for rapid preview, but requires careful handling of codec support, seeking, CORS, and exact frame timing.

### FFmpeg frame extraction

The desktop path uses this provider because FFmpeg is already packaged and sequential decoded frames are reproducible. The current reader preserves source frame order; source presentation timestamps remain a follow-up requirement for variable-frame-rate media.

The decision gate is a benchmark using the same fixture clips. The selected provider must demonstrate:

- stable decoding of supported codecs
- source timestamp preservation
- reproducible frame selection
- acceptable processing time
- useful error messages for unsupported media

The browser video player can remain the review surface even if FFmpeg becomes the analysis backend.

## Debug artifact contract

Every processed fixture should be able to produce artifacts such as:

```text
artifacts/recording-analysis/<case>/
  summary.json
  frame-000120.png
  frame-000120.json
```

A debug frame should distinguish visually between:

- source image
- actual sampled crop
- detector tolerance/search region
- sample points
- detected markers
- parsed values
- rejected or ambiguous evidence

The artifact must be generated from the same geometry and detector output used by processing. The UI debugger should display these artifacts rather than independently recreating detector geometry.

## Validation gates

### Gate 1: Ingestion

- supported codecs are detected and decoded
- unsupported codecs fail with actionable errors
- source dimensions, frame rate, time base, and timestamps are recorded

### Gate 2: Geometry

- every sampled region aligns with the intended HUD element
- source-pixel and display-pixel coordinates are not confused
- letterboxed playback does not move overlays

### Gate 3: Single move

- a manually labeled move has the expected input and phase range
- gaps are reported
- ambiguous data remains ambiguous

### Gate 4: Sequence

- a short combo or pressure string produces ordered observations
- move boundaries are explainable
- damage agrees with the visible HUD within an explicit tolerance

### Gate 5: Regression

- all fixtures run through the same pipeline
- geometry, timing, and recognition regressions are reported
- debug artifacts remain available for failed cases

## Implementation order after plan approval

1. Manually label the initial fixture frames and events.
2. Introduce an explicit, versioned calibration object.
3. Make the processor accept and save a configuration snapshot.
4. Build a deterministic frame-provider benchmark.
5. Implement exported debug artifacts from shared detector geometry.
6. Add fixture regression checks.
7. Revalidate single-move processing.
8. Add combo/pressure sequence correlation.
9. Validate visible overlay colors and geometry against manually reviewed frames.
10. Expand hitbox tracks into verified hitbox/hurtbox semantics, then investigate corner-distance experiments.

## Decision rules

- Do not add more detector heuristics until a failing fixture and its debug artifact are available.
- Do not treat the current analysis output as ground truth without manual verification.
- Do not write uncertain observations directly into the authoritative move catalog.
- Do not duplicate geometry calculations between detector code and debugger code.
- Do not call a missing frame a detected frame.
- Prefer a null or degraded result over a precise-looking incorrect value.
