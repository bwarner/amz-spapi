/**
 * Guidance that exists because the agent got a real question wrong.
 *
 * A seller asked for three months of payouts to enter into Quicken. The
 * Finances API 403'd, and the agent — correctly diagnosing the missing role —
 * offered two manual workarounds without first checking that the settlement
 * reports were already imported. Once pushed, it found them. It then reported
 * the payouts WITHOUT dates, saying deposit dates "aren't stored in your
 * imported settlement rows".
 *
 * They are stored — but not where anyone looking at a transaction row would
 * find them. Checked against the live account: 17 rows out of 17,496 carry
 * `depositDate`. Amazon writes the deposit date, the settlement window and the
 * net `amountTotal` on ONE totals row per settlement and leaves all four blank
 * on every transaction row beneath it. Grouping transaction rows by
 * depositDate therefore returns almost nothing, which looks exactly like a
 * field that was never imported.
 *
 * The tool description said only "settlement -> amount" and named no
 * groupings, so the model reached for `date` — which follows the
 * per-transaction posted date and scatters one payout across a whole period —
 * and concluded from the mess that the dates did not exist. The fix is to name
 * the measure that selects the totals rows: `amountTotal` grouped by
 * ["settlementId","depositDate"] returns one dated payout per settlement, and
 * summing `amount` over that settlement reproduces the same figure exactly.
 *
 * The cost was not a crash. It was a confident false statement about the
 * seller's own data, plus a instruction to go and redo work by hand. Both
 * halves are pinned here: the field names must stay in the description, and
 * the 403 path must reach for stored rows before it reaches for the user.
 */

import { describe, expect, it } from 'vitest';
import { createSellerAgent } from './seller-agent.js';
import type { AIProvider } from '@amz-spapi/ai-provider';

const provider = {
  languageModel: () => ({} as never),
} as unknown as AIProvider;

/**
 * Report tools are gated on `reportOps` and the Amazon-failure guidance on a
 * connected account, so both stubs are required to see either. Nothing is
 * called — this file reads descriptions and instructions, not behaviour.
 */
function agent() {
  return createSellerAgent({
    provider,
    marketplaceId: 'ATVPDKIKX0DER',
    spCache: { hasSellerId: () => true },
    reportOps: {},
  } as never) as unknown as {
    tools: Record<string, { description: string }>;
    // The SDK keeps what it was constructed with under `settings`; the tools
    // are also re-exposed at the top level, which is why they read directly.
    settings: { instructions: string };
  };
}

function totalsDescription(): string {
  return agent().tools['total-report-rows'].description;
}

describe('settlement groupings are discoverable', () => {
  it('names depositDate, without which a payout list has no dates', () => {
    expect(totalsDescription()).toMatch(/depositDate/);
  });

  it('names settlementId, the unit a payout is actually paid in', () => {
    expect(totalsDescription()).toMatch(/settlementId/);
  });

  it('names amountTotal as the measure that yields a dated payout list', () => {
    // The whole correction: amountTotal exists ONLY on the totals rows, so it
    // selects them and the transaction rows drop out on their own. Reaching
    // for `amount` with depositDate returns near-nothing and reads as missing
    // data — which is the mistake that shipped a wrong answer to a seller.
    expect(totalsDescription()).toMatch(/amountTotal grouped by/i);
    expect(totalsDescription()).toMatch(
      /do not reach for depositDate with measure amount/i
    );
  });

  it('says the two settlement views reconcile, so neither is a guess', () => {
    expect(totalsDescription()).toMatch(
      /reproduces its\s+amountTotal exactly/i
    );
  });

  it('warns that grouping a settlement by date scatters the payout', () => {
    // `date` follows postedDate for this report, so it answers a different
    // question than the one being asked and looks broken rather than wrong.
    expect(totalsDescription()).toMatch(/do not group a settlement by date/i);
  });

  it('forbids declaring a settlement date unavailable without looking', () => {
    expect(totalsDescription()).toMatch(/never tell the user/i);
  });
});

describe('a 403 is not the end of the question', () => {
  it('sends a failed report call to stored coverage before the user', () => {
    const text = agent().settings.instructions;

    expect(text).toMatch(/before offering ANY manual workaround/i);
    expect(text).toMatch(/check-report-coverage/);
  });
});
