#!/usr/bin/env node
/**
 * Converge an environment scope onto the declared schema (ADR-0005, #71).
 *
 * This is the permanent DDL tool: run it whenever `couchbase-schema.ts` changes,
 * and to provision a new environment from nothing. It is DECLARATIVE — it reads
 * what the cluster actually has, diffs it against the declaration, and applies the
 * difference.
 *
 * That is the part "CREATE ... IF NOT EXISTS" cannot do. An index whose keys have
 * changed already exists, so a create-if-absent script skips it forever and the
 * cluster quietly keeps serving the old definition. Here a changed index is
 * detected and rebuilt, and an index nobody declared is reported as drift.
 *
 * Usage:
 *   npx tsx scripts/couchbase-ddl.ts --env dev                    # plan (default)
 *   npx tsx scripts/couchbase-ddl.ts --env dev --apply
 *   npx tsx scripts/couchbase-ddl.ts --env staging --apply        # provision from nothing
 *   npx tsx scripts/couchbase-ddl.ts --env dev --check            # exit 1 on drift, for CI
 *   npx tsx scripts/couchbase-ddl.ts --env dev --apply --prune    # also drop undeclared indexes
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
  INDEXES,
  SOURCES,
  type IndexSpec,
  config,
  flatName,
  lit,
  n1ql,
  q,
  requireConfig,
  requireEnv,
} from './couchbase-schema.js';

type ObservedIndex = {
  name: string;
  keyspace_id: string;
  index_key: string[];
  condition?: string;
  is_primary?: boolean;
};

const args = process.argv.slice(2);
const env = requireEnv(args[args.indexOf('--env') + 1]);
const apply = args.includes('--apply');
const check = args.includes('--check');
const prune = args.includes('--prune');

requireConfig();

const DECLARED = SOURCES.map(flatName);

/**
 * Collections the integration suite creates and cleans up after itself.
 *
 * Matches the prefix that suite uses (`CB_TEST_DOMAIN`, default `itest`), so a
 * developer who points it at a different prefix gets the same exemption.
 */
function isTestOwned(name: string): boolean {
  const domain = process.env['CB_TEST_DOMAIN'] || 'itest';
  return name.startsWith(`${domain}_`);
}

/**
 * The system keyspaces do not agree on their own column names: `system:scopes`
 * and `system:keyspaces` use `bucket` and `scope`, while `system:indexes` below
 * uses `bucket_id`, `scope_id` and `keyspace_id`. Filtering either one with the
 * other's names returns zero rows and no error — which reads as "nothing exists"
 * and would have this tool confidently recreate a scope that is already there.
 */
async function observedScopeExists(): Promise<boolean> {
  const rows = await n1ql<string>(
    `SELECT RAW name FROM system:scopes ` +
      `WHERE \`bucket\` = ${lit(config.bucket)} AND name = ${lit(env)}`
  );
  return rows.length > 0;
}

async function observedCollections(): Promise<Set<string>> {
  const rows = await n1ql<string>(
    `SELECT RAW name FROM system:keyspaces ` +
      `WHERE \`bucket\` = ${lit(config.bucket)} AND \`scope\` = ${lit(env)}`
  );
  return new Set(rows);
}

async function observedIndexes(): Promise<ObservedIndex[]> {
  return n1ql<ObservedIndex>(
    `SELECT name, keyspace_id, index_key, \`condition\`, is_primary ` +
      `FROM system:indexes ` +
      `WHERE bucket_id = ${lit(config.bucket)} AND scope_id = ${lit(env)}`
  );
}

/**
 * Two index definitions are the same when their collection, keys and condition
 * all match. Keys are compared verbatim: `couchbase-schema.ts` declares them in
 * the exact form `system:indexes.index_key` reports, so no normalising is needed
 * and none is done — a normaliser is somewhere for a real difference to hide.
 */
function sameDefinition(spec: IndexSpec, observed: ObservedIndex): boolean {
  return (
    spec.collection === observed.keyspace_id &&
    JSON.stringify(spec.keys) === JSON.stringify(observed.index_key) &&
    (spec.condition ?? '') === (observed.condition ?? '')
  );
}

function createIndexStatement(spec: IndexSpec): string {
  return (
    `CREATE INDEX ${q(spec.name)} ON ${B()}.${q(env)}.${q(spec.collection)}` +
    `(${spec.keys.join(',')})` +
    (spec.condition ? ` WHERE ${spec.condition}` : '')
  );
}

async function main() {
  console.log(
    `\n${apply ? 'APPLYING' : 'PLAN (no changes — pass --apply)'} → ` +
      `${config.bucket}.${env}\n`
  );

  const scopeExists = await observedScopeExists();
  const collections = scopeExists
    ? await observedCollections()
    : new Set<string>();
  const indexes = scopeExists ? await observedIndexes() : [];
  const byName = new Map(indexes.map((index) => [index.name, index]));

  // ---- diff --------------------------------------------------------------
  const missingCollections = DECLARED.filter((name) => !collections.has(name));
  // Collections are never dropped, only reported. A collection holds data and a
  // declaration file is a weak reason to destroy it; removing one should be a
  // deliberate act with a human looking at the row count.
  //
  // The integration suite provisions and owns its own collections
  // (`libs/couchbase-utils`, prefix from CB_TEST_DOMAIN). They are deliberately
  // not declared here — declaring them would create them in production — so
  // without this exclusion `--check` reports permanent drift on any environment
  // the suite has ever run against, and a drift gate that is always red is one
  // nobody reads.
  const extraCollections = [...collections].filter(
    (name) => !DECLARED.includes(name) && !isTestOwned(name)
  );

  const missingIndexes: IndexSpec[] = [];
  const changedIndexes: Array<{ spec: IndexSpec; observed: ObservedIndex }> =
    [];
  for (const spec of INDEXES) {
    const observed = byName.get(spec.name);
    if (!observed) missingIndexes.push(spec);
    else if (!sameDefinition(spec, observed)) {
      changedIndexes.push({ spec, observed });
    }
  }
  const declaredNames = new Set(INDEXES.map((index) => index.name));
  const extraIndexes = indexes.filter(
    (index) => !declaredNames.has(index.name)
  );

  // ---- report ------------------------------------------------------------
  if (!scopeExists) console.log(`  + scope ${env}`);
  for (const name of missingCollections) console.log(`  + collection ${name}`);
  for (const spec of missingIndexes) console.log(`  + index ${spec.name}`);
  for (const { spec, observed } of changedIndexes) {
    console.log(
      `  ~ index ${spec.name} on ${spec.collection}\n` +
        `      is:     ${JSON.stringify(observed.index_key)}` +
        `${observed.condition ? ` WHERE ${observed.condition}` : ''}\n` +
        `      wants:  ${JSON.stringify(spec.keys)}` +
        `${spec.condition ? ` WHERE ${spec.condition}` : ''}`
    );
  }
  for (const index of extraIndexes) {
    const kind = index.is_primary ? 'PRIMARY index' : 'index';
    console.log(
      `  ${prune ? '-' : '?'} ${kind} ${index.name} on ${index.keyspace_id}` +
        `${prune ? '' : '  (undeclared — pass --prune to drop)'}`
    );
  }
  for (const name of extraCollections) {
    console.log(
      `  ? collection ${name}  (undeclared — drop by hand if intended)`
    );
  }

  const drift =
    !scopeExists ||
    missingCollections.length > 0 ||
    missingIndexes.length > 0 ||
    changedIndexes.length > 0 ||
    extraIndexes.length > 0 ||
    extraCollections.length > 0;

  if (!drift) console.log('  in sync — nothing to do');

  if (!apply) {
    console.log(
      `\n${drift ? 'Drift found.' : 'No drift.'} ` +
        `${drift && !check ? 'Re-run with --apply to converge.\n' : '\n'}`
    );
    // --check makes drift a failure, so this can gate a deploy. Plain plan mode
    // exits 0: reporting drift is not itself an error.
    process.exit(check && drift ? 1 : 0);
  }

  // ---- apply -------------------------------------------------------------
  if (!scopeExists) {
    await n1ql(`CREATE SCOPE ${B()}.${q(env)} IF NOT EXISTS`);
  }
  for (const name of missingCollections) {
    await n1ql(`CREATE COLLECTION ${B()}.${q(env)}.${q(name)} IF NOT EXISTS`);
  }
  if (!scopeExists || missingCollections.length > 0) {
    // A collection is not immediately queryable after the DDL returns, and an
    // index created against one that has not surfaced yet fails outright.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  for (const spec of missingIndexes) {
    await n1ql(createIndexStatement(spec));
    console.log(`  created ${spec.name}`);
  }

  for (const { spec } of changedIndexes) {
    // Couchbase has no ALTER for a key change, so this is a drop and a rebuild.
    // Between the two there is no index, and queries relying on it will scan or
    // fail. Small scopes rebuild in seconds; a large one should be done with a
    // deferred build and a swap rather than this.
    console.log(`  rebuilding ${spec.name} (briefly unindexed)`);
    await n1ql(
      `DROP INDEX ${q(spec.name)} ON ${B()}.${q(env)}.${q(spec.collection)}`
    );
    await n1ql(createIndexStatement(spec));
  }

  if (prune) {
    for (const index of extraIndexes) {
      await n1ql(
        index.is_primary
          ? `DROP PRIMARY INDEX ON ${B()}.${q(env)}.${q(index.keyspace_id)}`
          : `DROP INDEX ${q(index.name)} ON ${B()}.${q(env)}.${q(
              index.keyspace_id
            )}`
      );
      console.log(`  dropped ${index.name}`);
    }
  }

  console.log('\n  converged\n');
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
