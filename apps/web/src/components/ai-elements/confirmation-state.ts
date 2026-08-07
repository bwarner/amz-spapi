import type { ToolUIPart } from 'ai';

/**
 * Which face a confirmation shows, as a pure function of the tool call.
 *
 * Split out of `confirmation.tsx` so it can be tested without a DOM. The three
 * sub-components each ask this rather than re-deriving the rule, so what the
 * tests assert and what the screen shows cannot drift apart.
 */

/** The SDK's approval shape: `approved` is absent until a decision is made. */
export type ToolUIPartApproval = Extract<
  ToolUIPart,
  { state: 'approval-requested' | 'approval-responded' }
>['approval'];

export type ConfirmationPhase = 'none' | 'request' | 'accepted' | 'rejected';

/**
 * States in which a decision has been made and can be reported back.
 *
 * `output-available` and `output-denied` are included because the answer is
 * only briefly `approval-responded`: the server acts immediately, and the part
 * settles. If those were left out, the record of what a seller approved would
 * survive for a fraction of a second and then disappear — which is the bug this
 * component was adopted to fix.
 */
const RESPONDED_STATES = new Set<string>([
  'approval-responded',
  'output-denied',
  'output-available',
]);

export function confirmationPhase(
  state: ToolUIPart['state'] | string,
  approval: ToolUIPartApproval | undefined
): ConfirmationPhase {
  // Nothing was ever gated, or the call has not got far enough to say.
  if (!approval) return 'none';
  if (state === 'input-streaming' || state === 'input-available') return 'none';

  if (state === 'approval-requested') return 'request';
  if (!RESPONDED_STATES.has(state)) return 'none';

  // `approved` is absent until answered; only an explicit false is a refusal.
  if (approval.approved === true) return 'accepted';
  if (approval.approved === false) return 'rejected';
  return 'none';
}
