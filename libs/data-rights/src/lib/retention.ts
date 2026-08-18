/**
 * How long Amazon Information may be kept.
 *
 * The SP-API Data Protection Policy caps non-PII Amazon Information at
 * **18 months**, and every collection derived from Amazon — reports, sync
 * records, cached API responses — is subject to it. This is one constant rather
 * than a number in each store because a ceiling that is restated in five places
 * is a ceiling that will be exceeded in one of them, and the exceedance will be
 * invisible until an assessor finds it.
 *
 * ## Why a clamp and not just a default
 *
 * `REPORT_ROW_TTL_DAYS` exists so retention can be shortened per environment.
 * Left unbounded it can also LENGTHEN it, which turns a compliance ceiling into
 * a suggestion that one environment variable can quietly lift. `retentionDays`
 * takes the shorter of what was asked for and what is allowed, so the only
 * reachable states are compliant ones.
 *
 * ## What this does NOT cover
 *
 * Data the seller gives us that did not come from Amazon — supplier invoices,
 * purchase orders, their own A+ copy, their uploaded media. That is the
 * seller's own business record, not Amazon Information, and deleting it at 18
 * months would destroy evidence they are relying on us to hold.
 *
 * PII is capped far shorter (30 days after delivery) and is not represented
 * here for a deliberate reason: this application fetches none. No PII endpoint
 * is called, no Restricted Data Token is minted, and no ingested report carries
 * a buyer column. A constant for it would imply somewhere it applies.
 */

/** The Data Protection Policy ceiling for non-PII Amazon Information. */
export const AMAZON_INFORMATION_MAX_DAYS = 548;

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Days of retention for Amazon-derived data, never above the policy ceiling.
 *
 * A non-finite or non-positive request means "unset", which takes the ceiling
 * rather than zero — a misspelled environment variable must not silently
 * expire every row on write.
 */
export function retentionDays(requestedDays?: number): number {
  const asked =
    typeof requestedDays === 'number' &&
    Number.isFinite(requestedDays) &&
    requestedDays > 0
      ? requestedDays
      : AMAZON_INFORMATION_MAX_DAYS;
  return Math.min(asked, AMAZON_INFORMATION_MAX_DAYS);
}

/** The same, in seconds, which is what every storage call wants. */
export function retentionSeconds(requestedDays?: number): number {
  return retentionDays(requestedDays) * SECONDS_PER_DAY;
}

/**
 * Read a day count from an environment variable, clamped.
 *
 * Absent, blank or unparseable all mean "unset" — see `retentionDays`.
 */
export function retentionSecondsFromEnv(name: string): number {
  return retentionSeconds(Number(process.env[name]));
}
