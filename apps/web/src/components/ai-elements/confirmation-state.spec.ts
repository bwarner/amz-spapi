/**
 * What a confirmation shows, at every state a gated tool call passes through.
 *
 * #102 replaced a hand-rolled approval box with the AI Elements `confirmation`
 * component, and the reason given was that a tool-approval state machine has
 * been hard to get right here — four separate fixes hard. The migration is
 * presentational, so the three server-side fixes stay covered by
 * `libs/seller-agent/src/history.spec.ts`; what is new, and what these cover,
 * is that the seller can still see what they decided after they decide it.
 */

import { describe, expect, it } from 'vitest';
import {
  confirmationPhase,
  type ToolUIPartApproval,
} from './confirmation-state';

/** Before an answer, the SDK carries an approval id and no verdict. */
const requested = { id: 'appr_1' } as ToolUIPartApproval;
const approved = { id: 'appr_1', approved: true } as ToolUIPartApproval;
const rejected = { id: 'appr_1', approved: false } as ToolUIPartApproval;

describe('confirmationPhase', () => {
  it('asks while the approval is outstanding', () => {
    expect(confirmationPhase('approval-requested', requested)).toBe('request');
  });

  it('keeps showing the decision after it is made', () => {
    // The bug this component was adopted to fix: answering used to erase both
    // the question and the answer, so a live listing write or a purchase order
    // was approved and the transcript kept no trace of it.
    expect(confirmationPhase('approval-responded', approved)).toBe('accepted');
    expect(confirmationPhase('output-available', approved)).toBe('accepted');
    expect(confirmationPhase('output-denied', rejected)).toBe('rejected');
    expect(confirmationPhase('approval-responded', rejected)).toBe('rejected');
  });

  it('survives the state settling, which happens almost immediately', () => {
    // `approval-responded` is transient — the server acts at once and the part
    // moves to output-available. Covering only that state would keep the record
    // on screen for a fraction of a second.
    expect(confirmationPhase('output-available', approved)).toBe('accepted');
  });

  it('shows nothing for a call that was never gated', () => {
    expect(confirmationPhase('output-available', undefined)).toBe('none');
    expect(confirmationPhase('input-available', undefined)).toBe('none');
  });

  it('stays quiet while the call is still being assembled', () => {
    // An approval id can be present before the call is ready to act on; asking
    // then would put a decision in front of the reader with nothing behind it.
    expect(confirmationPhase('input-streaming', requested)).toBe('none');
    expect(confirmationPhase('input-available', requested)).toBe('none');
  });

  it('never reads a missing verdict as a rejection', () => {
    // `approved` is absent until answered. Treating absent as false would show
    // "you rejected this" for a question nobody has answered yet.
    expect(confirmationPhase('approval-responded', requested)).toBe('none');
  });
});
