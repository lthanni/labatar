import type { ResolvedInput } from "./input-display";
import type { RecordingAnalysisInputEvent } from "./recording-analysis-types";

// The framebar and input history are sampled from adjacent decoded frames. A
// small look-ahead handles the normal one-frame delay without reaching back
// into an older history row from a previous attack.
export const INPUT_ASSOCIATION_LOOKBEHIND_SECONDS = 0.1;
export const INPUT_ASSOCIATION_LOOKAHEAD_SECONDS = 0.1;

export type RecordingInputCandidate = {
  time: number;
  input: ResolvedInput;
  event?: RecordingAnalysisInputEvent;
  /** True when the input was already visible when the clip was initialized. */
  preexisting?: boolean;
};

export function isAttackInput(input: ResolvedInput) {
  return input.buttons.length > 0 || input.direction !== "5";
}

export function findInputForFramebarStart(
  inputs: RecordingInputCandidate[],
  framebarStartTime: number,
) {
  const candidates = inputs
    .filter((candidate) => {
      const offset = candidate.time - framebarStartTime;
      return (
        !candidate.event &&
        isAttackInput(candidate.input) &&
        offset >= -INPUT_ASSOCIATION_LOOKBEHIND_SECONDS &&
        offset <= INPUT_ASSOCIATION_LOOKAHEAD_SECONDS
      );
    })
    .sort((left, right) => {
      const leftOffset = left.time - framebarStartTime;
      const rightOffset = right.time - framebarStartTime;
      const leftIsAfter = leftOffset >= 0;
      const rightIsAfter = rightOffset >= 0;

      // Prefer the measured input after the framebar transition. This is the
      // common case for the game, and prevents a prior button row from winning
      // merely because it is closer by a few milliseconds.
      if (leftIsAfter !== rightIsAfter) return leftIsAfter ? -1 : 1;
      return Math.abs(leftOffset) - Math.abs(rightOffset);
    });

  return candidates[0] ?? null;
}
