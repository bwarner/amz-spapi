import crypto from 'node:crypto';
import {
  executeQuery,
  getDocument,
  incrementCounter,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import { withVendorSpan } from './telemetry';

/**
 * Durable record of metered vendor spend, plus the cap that enforces it.
 *
 * Why a ledger and not just telemetry: traces are sampled and expire, so they
 * cannot answer "what did this seller cost us last month" or reconcile against
 * a vendor invoice. Every paid call writes one `cost_ledger` doc (the auditable
 * record) and increments a per-user daily counter in `spend_counters` (so the
 * pre-flight cap check is one key lookup, not an aggregate scan).
 *
 * The agent can now spend money on its own initiative — a tool loop can fire
 * scraper runs and image generations without a human in the loop — so the cap
 * is the point of this module. Observability is the side effect.
 */

const SCOPE = 'ops';
const LEDGER = 'cost_ledger';
const COUNTERS = 'spend_counters';
const SCHEMA_VERSION = 1;

/** Ledger entries outlive a billing dispute; counters only need the month. */
const LEDGER_TTL_SECONDS = 400 * 24 * 60 * 60;
const COUNTER_TTL_SECONDS = 40 * 24 * 60 * 60;

const MICRO = 1_000_000;

/**
 * Storage seam. Money-handling logic should be verifiable without a live
 * cluster, and these three calls are the only I/O in this module — tests swap
 * them, production leaves them alone.
 */
export const ledgerStorage = {
  getDocument,
  upsertDocument,
  executeQuery,
  incrementCounter,
};

export type CostSource = 'measured' | 'estimated';

export type MeteredVendor = 'apify' | 'image-generation';

export type LedgerEntry = {
  schemaVersion: number;
  entryId: string;
  userId: string;
  /** UTC day, YYYY-MM-DD — the counter's bucket. */
  day: string;
  feature: string;
  vendor: MeteredVendor;
  /** Actor path, model slug, or other vendor-side identifier. */
  operation: string;
  units: number;
  costUsd: number;
  costSource: CostSource;
  /** False when no published unit price is known and a default was assumed. */
  priceKnown: boolean;
  chatId?: string;
  error?: string;
  createdAt: number;
};

/**
 * Published unit prices, USD. VERIFIED 2026-07-24 against the Apify API; these
 * are list prices at the FREE plan tier and Apify's tiers change (BRONZE/SILVER
 * are cheaper), so anything derived from them is `estimated`, never `measured`.
 * Override per deployment rather than editing this table.
 */
const UNIT_PRICES_USD: Record<string, number> = {
  // Per product result.
  'zen-studio~alibaba-scraper': 0.00499,
};

/** Assumed cost for a call whose price we do not know. Deliberately not zero:
 *  an unpriced call must still consume budget, or the cap is bypassable. */
function defaultCallCostUsd(): number {
  return readFloatEnv('COST_DEFAULT_CALL_USD') ?? 0.02;
}

function readFloatEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function unitPriceUsd(operation: string): number | undefined {
  const override = readFloatEnv(
    `COST_UNIT_PRICE_${operation.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`
  );
  return override ?? UNIT_PRICES_USD[operation];
}

/** Per-user daily ceiling. Set COST_CAP_DAILY_USD=0 to disable enforcement. */
function dailyCapUsd(): number {
  return readFloatEnv('COST_CAP_DAILY_USD') ?? 10;
}

function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function counterKey(userId: string, day: string): string {
  // Hash the user id: ledger docs carry it in a field, but keys end up in logs.
  const ref = crypto
    .createHash('sha256')
    .update(userId)
    .digest('hex')
    .slice(0, 24);
  return `spend::${ref}::${day}`;
}

/** Opaque, stable, non-PII reference for span attributes. */
export function userRef(userId: string): string {
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 16);
}

/**
 * Spend so far today, USD. Returns 0 when the counter is missing or unreadable.
 *
 * The counter is a KV counter document, so its body is a bare integer of
 * micro-USD rather than JSON.
 */
export async function spendTodayUsd(userId: string): Promise<number> {
  try {
    const value = await ledgerStorage.getDocument<number>(
      SCOPE,
      COUNTERS,
      counterKey(userId, utcDay())
    );
    const micro = Number(value);
    return Number.isFinite(micro) ? micro / MICRO : 0;
  } catch {
    return 0;
  }
}

/**
 * Add to today's counter. A single-document N1QL UPDATE is atomic, so
 * concurrent tool calls cannot lose an increment — except on the very first
 * call of a day, where two racing creators can each insert (one increment
 * lost). The ledger remains complete, so the counter is self-correcting the
 * next day and reconcilable at any time.
 */
async function addToCounter(userId: string, costUsd: number): Promise<void> {
  const delta = Math.round(costUsd * MICRO);
  if (delta <= 0) return;

  // One atomic KV operation that also creates the document. The previous
  // UPDATE-then-UPSERT pair raced on the first paid call of a UTC day: both
  // callers found no row, both wrote, and one call's spend vanished.
  await ledgerStorage.incrementCounter(
    SCOPE,
    COUNTERS,
    counterKey(userId, utcDay()),
    delta,
    COUNTER_TTL_SECONDS
  );
}

export class BudgetExceededError extends Error {
  constructor(spentUsd: number, capUsd: number) {
    super(
      `Daily spend cap reached ($${spentUsd.toFixed(2)} of $${capUsd.toFixed(
        2
      )}). Paid lookups (supplier searches, page reads, image generation) are ` +
        'paused until tomorrow, or until the cap is raised.'
    );
    this.name = 'BudgetExceededError';
  }
}

/**
 * Refuse a paid call that would run past the cap. Checked BEFORE the vendor
 * call using the pending call's estimate: after the fact is too late.
 *
 * Fails OPEN on a storage error — a Couchbase outage must not take the product
 * down, and the ledger will still record whatever gets spent.
 */
export async function assertWithinBudget(params: {
  userId: string;
  estimatedCostUsd: number;
}): Promise<void> {
  const cap = dailyCapUsd();
  if (cap <= 0) return;

  const spent = await spendTodayUsd(params.userId);
  if (spent + params.estimatedCostUsd > cap) {
    console.warn(
      `[cost] cap reached for ${userRef(params.userId)}: spent ${spent.toFixed(
        4
      )} + pending ${params.estimatedCostUsd.toFixed(4)} > cap ${cap}`
    );
    throw new BudgetExceededError(spent, cap);
  }
}

/** Write the ledger entry and update the counter. Never throws. */
export async function recordCost(params: {
  userId: string;
  feature: string;
  vendor: MeteredVendor;
  operation: string;
  units: number;
  costUsd: number;
  costSource: CostSource;
  priceKnown: boolean;
  chatId?: string;
  error?: string;
}): Promise<void> {
  const entry: LedgerEntry = {
    schemaVersion: SCHEMA_VERSION,
    entryId: crypto.randomUUID(),
    day: utcDay(),
    createdAt: Date.now(),
    ...params,
  };
  try {
    await ledgerStorage.upsertDocument<LedgerEntry>(
      SCOPE,
      LEDGER,
      `cost::${entry.entryId}`,
      entry,
      LEDGER_TTL_SECONDS
    );
  } catch (error) {
    // Losing a ledger write must not fail the user's request, but it must be
    // visible — this is the reconciliation record.
    console.error(
      '[cost] ledger write failed',
      entry.vendor,
      entry.operation,
      error instanceof Error ? error.message : error
    );
  }
  try {
    await addToCounter(params.userId, params.costUsd);
  } catch (error) {
    console.error(
      '[cost] counter update failed',
      error instanceof Error ? error.message : error
    );
  }
}

export type PaidCallContext = {
  userId: string;
  feature: string;
  vendor: MeteredVendor;
  operation: string;
  chatId?: string;
  /** Units the call is expected to consume, for the pre-flight cap check. */
  expectedUnits?: number;
};

/**
 * Wrap a metered vendor call: cap check → span → run → ledger.
 *
 * `fn` reports the units actually consumed (results returned, images produced);
 * cost is `units × unit price` when a price is known, otherwise the configured
 * per-call default with `priceKnown: false`. A cache hit reports 0 units, which
 * records a zero-cost entry — that is how the savings become visible.
 */
export async function withPaidCall<T>(
  context: PaidCallContext,
  fn: (report: (units: number) => void) => Promise<T>
): Promise<T> {
  const price = unitPriceUsd(context.operation);
  const expectedUnits = context.expectedUnits ?? 1;
  const estimate =
    price !== undefined ? price * expectedUnits : defaultCallCostUsd();

  await assertWithinBudget({
    userId: context.userId,
    estimatedCostUsd: estimate,
  });

  let units = expectedUnits;
  let failure: string | undefined;

  try {
    return await withVendorSpan(
      {
        vendor: context.vendor,
        operation: context.operation,
        feature: context.feature,
        userRef: userRef(context.userId),
        chatId: context.chatId,
      },
      async (report) => {
        const result = await fn((actualUnits) => {
          units = actualUnits;
          const cost =
            price !== undefined
              ? price * actualUnits
              : actualUnits === 0
              ? 0
              : defaultCallCostUsd();
          report({
            units: actualUnits,
            costUsd: cost,
            costSource: 'estimated',
            cacheHit: actualUnits === 0,
          });
        });
        return result;
      }
    );
  } catch (error) {
    failure = error instanceof Error ? error.message : 'vendor call failed';
    throw error;
  } finally {
    // A failed actor run still bills, so record regardless of outcome.
    const costUsd =
      price !== undefined
        ? price * units
        : units === 0
        ? 0
        : defaultCallCostUsd();
    await recordCost({
      userId: context.userId,
      feature: context.feature,
      vendor: context.vendor,
      operation: context.operation,
      units,
      costUsd,
      costSource: 'estimated',
      priceKnown: price !== undefined,
      chatId: context.chatId,
      error: failure,
    });
  }
}
