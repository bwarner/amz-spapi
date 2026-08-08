import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertChatTurnWithinBudget,
  BudgetExceededError,
  ledgerStorage,
} from './cost-ledger';

/**
 * The chat spend cap.
 *
 * Model tokens were metered and never capped: `withPaidCall` guarded scrapers,
 * images and document extraction, while chat — the most expensive path — ran
 * unbounded against the gateway balance. These cases pin the two ways that
 * regression could return silently: a cap that never refuses, and a cap that
 * refuses when the datastore is merely unreachable.
 *
 * Money is read through the `ledgerStorage` seam, so no cluster is needed. The
 * counter document body is a bare integer of MICRO-USD, which is the detail
 * most likely to be got wrong by a future edit — a reader that forgets the
 * conversion is off by a factor of a million and every user looks free.
 */

const MICRO = 1_000_000;
const USER = 'auth0|cap-test';

function counterReturning(micros: number | null) {
  return vi.fn(async () => micros);
}

describe('assertChatTurnWithinBudget', () => {
  const originalCap = process.env['COST_CAP_DAILY_USD'];
  const originalEstimate = process.env['COST_CHAT_TURN_ESTIMATE_USD'];
  let getDocument: typeof ledgerStorage.getDocument;

  beforeEach(() => {
    getDocument = ledgerStorage.getDocument;
    process.env['COST_CAP_DAILY_USD'] = '10';
    process.env['COST_CHAT_TURN_ESTIMATE_USD'] = '0.05';
  });

  afterEach(() => {
    ledgerStorage.getDocument = getDocument;
    if (originalCap === undefined) delete process.env['COST_CAP_DAILY_USD'];
    else process.env['COST_CAP_DAILY_USD'] = originalCap;
    if (originalEstimate === undefined)
      delete process.env['COST_CHAT_TURN_ESTIMATE_USD'];
    else process.env['COST_CHAT_TURN_ESTIMATE_USD'] = originalEstimate;
  });

  it('allows a turn when the user is well under the cap', async () => {
    ledgerStorage.getDocument = counterReturning(2 * MICRO);

    await expect(assertChatTurnWithinBudget(USER)).resolves.toBeUndefined();
  });

  it('refuses a turn once spend plus the estimate exceeds the cap', async () => {
    // $9.98 spent, $0.05 estimated, $10 cap → 10.03 > 10.
    ledgerStorage.getDocument = counterReturning(9.98 * MICRO);

    await expect(assertChatTurnWithinBudget(USER)).rejects.toBeInstanceOf(
      BudgetExceededError
    );
  });

  it('allows the turn that lands exactly on the cap', async () => {
    // $9.95 + $0.05 = $10.00, which is not *past* the ceiling. Pinned because
    // an off-by-one to `>=` would refuse a turn the user has paid for.
    ledgerStorage.getDocument = counterReturning(9.95 * MICRO);

    await expect(assertChatTurnWithinBudget(USER)).resolves.toBeUndefined();
  });

  it('fails OPEN when the counter cannot be read', async () => {
    // A Couchbase outage must not take chat down. The ledger still records
    // whatever gets spent, so the money remains reconcilable afterwards.
    ledgerStorage.getDocument = vi.fn(async () => {
      throw new Error('cluster unreachable');
    });

    await expect(assertChatTurnWithinBudget(USER)).resolves.toBeUndefined();
  });

  it('treats a missing counter as zero spend, not as a failure', async () => {
    ledgerStorage.getDocument = counterReturning(null);

    await expect(assertChatTurnWithinBudget(USER)).resolves.toBeUndefined();
  });

  it('enforces nothing when the cap is disabled', async () => {
    process.env['COST_CAP_DAILY_USD'] = '0';
    ledgerStorage.getDocument = counterReturning(500 * MICRO);

    await expect(assertChatTurnWithinBudget(USER)).resolves.toBeUndefined();
  });

  it('reads the counter as micro-USD', async () => {
    // The same integer read as plain USD would be 9,980,000 — astronomically
    // over any cap — so a lost conversion fails this rather than passing by
    // coincidence with the refusal case above.
    ledgerStorage.getDocument = counterReturning(1 * MICRO);
    process.env['COST_CAP_DAILY_USD'] = '2';

    await expect(assertChatTurnWithinBudget(USER)).resolves.toBeUndefined();
  });
});
