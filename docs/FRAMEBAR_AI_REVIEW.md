# Visual framebar review for move takes

This is a local, occasional workflow for gathering move data. Use **Copy all AI review requests** to copy every eligible move take into one request for Codex, across characters and outcomes. You can also use **Copy AI review request** on an individual take. Codex inspects video framebar crops and reads the numbers printed below each colored run. The saved sequence contains **game-frame cell counts**, not counts of how many video frames a color remained on screen. The app approves that sequence before deriving startup, hits, gaps, recovery, and other move data from it.

## Review a take

Run these commands from the repository root:

```powershell
node scripts/framebar-review.mjs list
node scripts/framebar-review.mjs probe --video "path/to/take.mp4"
node scripts/framebar-review.mjs inspect --video "path/to/take.mp4"
node scripts/framebar-review.mjs inspect --video "path/to/take.mp4" --frames 90,152,160 --players p1
```

`inspect` writes enlarged P1/P2 framebar crops under `.dev/framebar-review/` and reports their paths. Codex can inspect those images with `view_image`. Start with snapshots during and after the move. If a run has scrolled out of the 63-cell bar, inspect earlier video frames near its transition. Read the printed run counts and confirm that visible colors match the intended state names. A stable completed bar is useful, but its continued presence does not add game frames to the move.

Create a JSON draft with one ordered run list per player. Video frame indices in `evidenceFrames` and `startVideoFrame` are zero-based; run `frames` values are game-frame cell counts. Include the opponent bar when its labels are visible, as a cross-check that both players cover the same game-frame span:

```json
{
  "video": "path/to/take.mp4",
  "startVideoFrame": 57,
  "evidenceFrames": [57, 90, 152, 160],
  "player1": [
    { "state": "startup", "frames": 94 },
    { "state": "airborne", "frames": 8 }
  ],
  "player2": [{ "state": "idle", "frames": 102 }]
}
```

`player2` may be omitted when only P1 is readable; the tool then fills the same span with idle. Supported state names include `startup`, `active`, `gap` (saved as `multihit-gap`), `recovery`, `airborne`, `flow-stance`, `blockstun`, `hitstun`, `hitpause`, `idle`, and `unknown`. Retain repeated states separated by another state: `[active: 3, gap: 4, active: 5]` is three runs. Save the draft:

```powershell
node scripts/framebar-review.mjs save --draft ".dev/framebar-review/my-draft.json"
```

The tool records the MP4's reported frame rate and dimensions, checks that P1/P2 game-frame totals agree, archives the previous sequence and analysis in the sidecar, and saves the new sequence as **awaiting review**. Refresh the app's move capture panel. It displays the compact P1/P2 runs. Approve the sequence there, then use **Determine move data** or **Determine approved**. The latter stage reads the sequence from the manifest; it does not open the video.

## Timing limits

The printed framebar counts are the source for the saved game-frame lengths. Record at 60 fps when possible: a lower rate can skip short runs, and even a 60 fps MP4 can duplicate or miss game updates. A lower-rate video can still yield correct counts when all run labels are visible. The first video frame and derived segment timestamps are approximate anchors; a dropped or duplicated game update can shift them without changing a visible printed count. Record more crops near a transition when the labels or state order are unclear. If the numbers cannot be read or an earlier run has disappeared before it was observed, leave the take pending and obtain a clearer recording.
