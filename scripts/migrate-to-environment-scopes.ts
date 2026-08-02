#!/usr/bin/env node
/**
 * Copy the domain-scoped data into an environment scope (ADR-0005, #71).
 *
 * ONE-TIME. Today's layout is a scope per domain — `a_plus.drafts`,
 * `catalog.listings`. The target is a scope per ENVIRONMENT holding flat
 * collections named `<domain>_<collection>`, so a database user granted one scope
 * cannot reach another environment's data.
 *
 *   a_plus.drafts       →  dev.a_plus_drafts
 *   catalog.listings    →  dev.catalog_listings
 *   sp_cache.listings   →  dev.sp_cache_listings   ← would collide without the prefix
 *
 * This script moves DATA ONLY. Structure — the scope, its collections and its
 * indexes — belongs to `couchbase-ddl.ts`, which is declarative and permanent.
 * Run that first:
 *
 *   npx tsx scripts/couchbase-ddl.ts --env dev --apply
 *   npx tsx scripts/migrate-to-environment-scopes.ts --env dev --apply
 *
 * ADDITIVE AND IDEMPOTENT. It copies; it never drops. The old scopes are left
 * exactly as they are, so the running application keeps working until CB_SCOPE is
 * switched, and rolling back is doing nothing.
 *
 * Once every environment is migrated and the old domain scopes are dropped, this
 * file has no remaining purpose and should be deleted rather than kept as
 * documentation of a move that already happened.
 *
 * Env: CB_DATA_API_URL, CB_USERNAME, CB_PASSWORD, CB_BUCKET
 *   npx tsx --env-file=apps/web/.env.local <script>
 *
 * Node reads the file itself (`--env-file`, native since 20.6). Do NOT use
 * `set -a && . apps/web/.env.local`: the shell re-expands the value, so a
 * password containing $, ` or ! arrives truncated or altered, and the only
 * symptom is an authentication failure indistinguishable from a wrong
 * password. One of ours is 18 characters and the shell delivered 8.
 */

import {
  B,
  SOURCES,
  countIn,
  flatName,
  n1ql,
  q,
  requireConfig,
  requireEnv,
} from './couchbase-schema.js';

const args = process.argv.slice(2);
const env = requireEnv(args[args.indexOf('--env') + 1]);
const apply = args.includes('--apply');

requireConfig();

async function main() {
  console.log(
    `\n${apply ? 'APPLYING' : 'PLAN (no changes — pass --apply)'} → ` +
      `data into scope ${env}\n`
  );

  let copied = 0;
  const mismatches: string[] = [];

  for (const source of SOURCES) {
    const target = flatName(source);
    const before = await countIn(source.domain, source.collection);
    if (before === 0) continue;

    if (!apply) {
      console.log(
        `  ${source.domain}.${source.collection} → ${target}  (${
          before < 0 ? 'needs temp index' : before
        } docs)`
      );
      continue;
    }

    // Some source collections have no index to scan with. A primary index is
    // created for the copy and dropped afterwards — temporary by construction,
    // so the cluster ends as it started (#69).
    let temporaryIndex = false;
    if (before < 0) {
      await n1ql(
        `CREATE PRIMARY INDEX ON ${B()}.${q(source.domain)}.${q(
          source.collection
        )}`
      );
      temporaryIndex = true;
      await new Promise((r) => setTimeout(r, 2000));
    }

    const total = await countIn(source.domain, source.collection);
    if (total > 0) {
      // UPSERT, not INSERT: keys are preserved, so a second run overwrites
      // rather than failing on every existing key. A migration you cannot
      // re-run is one you have to get right first time.
      await n1ql(
        `UPSERT INTO ${B()}.${q(env)}.${q(target)} (KEY k, VALUE v) ` +
          `SELECT META(d).id AS k, d AS v ` +
          `FROM ${B()}.${q(source.domain)}.${q(source.collection)} AS d`
      );
    }

    if (temporaryIndex) {
      await n1ql(
        `DROP PRIMARY INDEX ON ${B()}.${q(source.domain)}.${q(
          source.collection
        )}`
      );
    }

    const after = await countIn(env, target);
    const ok = after === total;
    if (!ok) mismatches.push(`${target}: source ${total}, target ${after}`);
    copied += total;
    console.log(`  ${ok ? '✓' : '✗'} ${target.padEnd(26)} ${total} docs`);
  }

  if (!apply) {
    console.log('\n  Re-run with --apply to copy.\n');
    return;
  }

  console.log(`\n  ${copied} documents copied`);
  if (mismatches.length > 0) {
    console.error('\n  COUNT MISMATCH:');
    for (const line of mismatches) console.error(`    ${line}`);
    process.exit(1);
  }
  console.log('  all counts verified\n');
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
