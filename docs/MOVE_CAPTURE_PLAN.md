# Move capture plan

Status: implemented capture workflow with review and source-linked measurements; remaining detector checks are listed below.

## Goal

Build a move library by recording training-mode videos as needed. Every measured value should link to a video that actually shows the relevant situation and to the frames supporting the value. The workflow should make missing evidence easy to gather, and failures easy to inspect and retry.

## Move catalog and scope

- Tech → Moves is the character-wide move catalog. Common inputs are assumed starting entries, with measured values unknown until supported by evidence.
- Capture and evidence coverage are scoped to a selected character/support variant. The same character's move list is shared across support choices, but each variant has its own videos and completion status.
- The first accepted measurement becomes the character's universal baseline. When an accepted measurement differs for a support, it is saved as a separately identified support move version linked to the baseline. Unchanged fields inherit the baseline. Each accepted value retains its recording ID, analysis move ID, and analyzed frame/time interval.
- Each move has an editable **Flow-cancellable** property. Command normals start enabled. A saved manual choice overrides that default.
- A situation that cannot occur for a move is marked **not applicable** with an explicit reason. Absence of a video never implies that the situation is impossible.

## Required evidence slots

Each applicable move has exactly one active take in each slot:

| Slot         | What the video must show                              | Main data source                            |
| ------------ | ----------------------------------------------------- | ------------------------------------------- |
| Whiff        | The move misses                                       | Startup, active, recovery, visible hitboxes |
| Block        | The opponent blocks the move and blockstun is visible | Blockstun and on-block results              |
| Hit grounded | The move connects while the opponent is grounded      | Grounded hitstun and on-hit results         |
| Hit airborne | The move connects while the opponent is airborne      | Airborne hitstun and on-hit results         |

The grounded/airborne distinction describes the **opponent at impact**, independently of the attacker's state. A take counts for a slot only when its observed outcome is confirmed. The situation selected before recording is capture intent, not proof of the outcome. One video may support several values within its slot, and each value should retain a link to its relevant frames.

## Capture workflow

1. Select a character/support variant and a gather situation. Show the current move and the next move in the queue.
2. Start recording, perform the move, and stop recording. Once the video is finalized, save it as that slot's pending take, immediately select and arm the next move, and leave recording stopped. The user repeats the same start/stop action for the next move. Processing and review never interrupt this capture pass.
3. Open **Unprocessed moves** for the selected character/support and choose **Process all**, or process one video. Processing runs sequentially, continues after individual failures, and shows the result for each take. It produces candidate input and frame data; requested block/whiff or opponent state remains unconfirmed until video review.
4. After the capture pass, review takes needing attention. Accept supported values and make their takes active, or reject a take with a reason. Do not silently write uncertain observations into Tech → Moves.
5. When replacing an active take, keep the old take active until the new one is accepted. Then archive the old take. Failed retakes go to the debugging archive and leave the evidence slot incomplete.

If recording fails to finalize or save, stay on the current move and show the error. A successfully finalized video advances the queue even if later processing finds the wrong input or outcome. Such failures appear in a follow-up retry list rather than stopping the capture pass.

The archive keeps the original video, capture intent, analysis, calibration and processor snapshot, and replacement or failure reason. Archived takes remain inspectable but do not count toward the one-active-take rule.

## Gather modes

Provide **Gather block data** and **Gather whiff data** for the selected character/support variant. Each mode moves through catalog moves whose corresponding evidence slot lacks an accepted active video, skipping explicit not-applicable moves. After a video is finalized, mark that move attempted for this pass and advance automatically, even while validation is pending. Do not loop back to attempted moves during the same pass. The user can skip a move temporarily without marking it complete. Show captured, verified, pending, and needs-redo counts when the queue ends, with a separate retry pass for failed or unreviewable takes.

Grounded-hit and airborne-hit gather modes use the same queue pattern. A finished gather pass leaves its videos unprocessed until the user starts processing.

## Debugging contract

From any failed or uncertain take, the user should be able to inspect the video and the detector's evidence side by side: input rows and their appearance times, framebar transition, candidate association, outcome evidence, configuration, processor version, and the reason validation failed. Reprocessing must retain the previous result for comparison rather than erase the explanation of an earlier failure.

## Open decisions

- Define the review threshold and whether any candidate can be accepted automatically. Explicit review is the current planning default.
- Grounded and airborne hitstun/on-hit are separate source-linked measurements. The older single hitstun field remains for existing manually entered data.
- Decide what video evidence, if any, is required to verify the Flow-cancellable property. Its toggle currently represents a catalog assertion.
- Define archive cleanup controls and disk-use limits without removing the active evidence for a move.
- The review action confirms the selected situation by watching the video. The current processor validates the move input but does not independently prove opponent state at impact; the reviewer must check grounded/airborne and block/whiff outcome before accepting.
