import { describe, expect, it } from 'vitest';
/*
 * Reaching into `scripts/` is the point of this file. The boundary rule guards
 * against one PROJECT importing another by path; `scripts/couchbase-schema.ts`
 * is workspace tooling, not a project, and it is the source of truth the DDL
 * converges the cluster onto. Comparing against a copy of the list would
 * defeat the entire check.
 */
// eslint-disable-next-line @nx/enforce-module-boundaries
import { SOURCES, flatName } from '../../../../scripts/couchbase-schema.js';
import { OWNERSHIP, ownershipOf } from './manifest.js';

/**
 * The manifest must cover the database, exactly.
 *
 * This is the whole enforcement mechanism for data-subject requests, so it is
 * worth being explicit about what it prevents. A GDPR export and a GDPR
 * deletion both fail the same way and fail SILENTLY: somebody adds a
 * collection, nobody classifies it, and from then on every export is
 * incomplete and every deletion leaves data behind. Both still report success.
 * Nothing in the product misbehaves. You find out from a regulator.
 *
 * Reaching across into `scripts/couchbase-schema.ts` is deliberate. That file
 * is the source of truth for what exists — the DDL tool converges the cluster
 * onto it — so comparing against it is comparing against reality rather than
 * against a second list somebody also has to remember to update.
 */

const declared = new Set(SOURCES.map(flatName));
const classified = new Set(OWNERSHIP.map((entry) => entry.collection));

describe('ownership manifest', () => {
  it('classifies every collection the schema declares', () => {
    const unclassified = [...declared].filter((c) => !classified.has(c)).sort();

    expect(
      unclassified,
      'Add these to OWNERSHIP in manifest.ts and decide how each is owned. ' +
        'An unclassified collection is silently excluded from every export ' +
        'and every deletion.'
    ).toEqual([]);
  });

  it('classifies nothing that does not exist', () => {
    // A stale entry is less dangerous than a missing one, but it means the
    // purge issues deletes against a collection that is gone, and the failure
    // would be read as an outage rather than as drift.
    const orphaned = [...classified].filter((c) => !declared.has(c)).sort();

    expect(orphaned).toEqual([]);
  });

  it('classifies each collection exactly once', () => {
    const seen = new Set<string>();
    const duplicates = OWNERSHIP.map((e) => e.collection).filter((c) =>
      seen.has(c) ? true : (seen.add(c), false)
    );

    // Two entries mean `ownershipOf` silently answers with the first, and the
    // second — possibly the correct one — never applies.
    expect(duplicates).toEqual([]);
  });

  it('gives every not-personal decision a stated reason', () => {
    // "Not personal data" is the only classification that removes a collection
    // from a deletion request, so it is the one that has to be argued rather
    // than asserted. An empty reason is an unexamined assumption.
    for (const entry of OWNERSHIP) {
      if (entry.ownership.kind !== 'not-personal') continue;
      expect(
        entry.ownership.because.length,
        `${entry.collection} is excluded without saying why`
      ).toBeGreaterThan(40);
    }
  });

  it('knows the three tenancy spellings ADR-0004 recorded', () => {
    // Regression guard for the specific mistake of assuming `userId` is
    // universal: `credentials_profiles` and `reports_*` do not use it, and a
    // sweep that only looked for `userId` would skip both — including the
    // largest collection in the database.
    expect(ownershipOf('credentials_profiles')).toEqual({
      kind: 'user-field',
      field: 'user_id',
    });
    expect(ownershipOf('reports_rows')).toEqual({
      kind: 'seller-field',
      field: 'sellerId',
    });
    expect(ownershipOf('chat_messages')).toEqual({
      kind: 'user-field',
      field: 'userId',
    });
  });

  it('does not lose the spend counter, which no query can find', () => {
    // It has no tenancy field at all — the user id is hashed into the key. A
    // field-based sweep cannot see it, so it has to be named explicitly or it
    // survives deletion.
    expect(ownershipOf('ops_spend_counters')).toMatchObject({
      kind: 'hashed-key',
    });
  });
});
