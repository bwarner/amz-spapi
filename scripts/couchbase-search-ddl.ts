#!/usr/bin/env npx tsx
/**
 * Converge an environment's Search (FTS) index onto the definition in code.
 *
 * The sibling of `couchbase-ddl.ts`, which owns collections and GSI indexes.
 * This one owns the Search index that backs document search and suggested
 * links — a different service, a different REST API, and a failure mode of its
 * own: a Search index that does not exist, or exists over the wrong keyspace,
 * does not raise anything. Queries against it return zero hits, and the Library
 * reads as "you have no documents".
 *
 * So the plan output states what the index will actually match, and `--verify`
 * asks the cluster how many documents it has indexed. Zero indexed documents
 * against a non-empty collection is the signature of a wrong type mapping, and
 * it is the one thing worth checking after every apply.
 *
 * The definition itself is imported from `document-search.ts` rather than
 * written here, because the query builder and the index have to agree about
 * field names, the vector width and the keyspace. Two copies is how they stop
 * agreeing.
 *
 * Env: CB_DATA_API_URL, CB_USERNAME, CB_PASSWORD, CB_BUCKET
 *   npx tsx --env-file=apps/web/.env.local scripts/couchbase-search-ddl.ts --env dev
 *   … --env dev --apply     create or update
 *   … --env dev --verify    report what the index currently holds
 */

import {
  documentSearchIndexDefinition,
  documentSearchTypeKey,
  EMBEDDING_DIMENSIONS,
} from '@amz-spapi/sp-cache';
import { config, requireConfig, requireEnv } from './couchbase-schema';

type IndexDefinition = ReturnType<typeof documentSearchIndexDefinition>;

/** The scoped-index REST path, the same one `searchQuery` queries through. */
function indexPath(env: string, name: string): string {
  return (
    `${config.url}/_p/fts/api/bucket/${encodeURIComponent(config.bucket)}` +
    `/scope/${encodeURIComponent(env)}/index/${encodeURIComponent(name)}`
  );
}

function authHeader(): string {
  const raw = `${config.user}:${config.pass}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

async function callSearchApi(
  url: string,
  init: { method: string; body?: unknown } = { method: 'GET' }
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: init.method,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // The FTS API answers some failures with HTML or a bare string. Keep it
    // rather than throwing a parse error over the top of the real message.
    payload = { error: text.slice(0, 300) };
  }
  return { ok: response.ok, status: response.status, payload };
}

async function readIndex(
  env: string,
  name: string
): Promise<{ uuid?: string; definition?: IndexDefinition }> {
  const { ok, payload } = await callSearchApi(indexPath(env, name));
  if (!ok) return {};
  const indexDef = (payload['indexDef'] ?? payload['indexDefs']) as
    | (IndexDefinition & { uuid?: string })
    | undefined;
  if (!indexDef) return {};
  return { uuid: indexDef.uuid, definition: indexDef };
}

/** How many documents the index actually holds. */
async function indexedCount(env: string, name: string): Promise<number | null> {
  const { ok, payload } = await callSearchApi(`${indexPath(env, name)}/count`);
  if (!ok) return null;
  const count = payload['count'];
  return typeof count === 'number' ? count : null;
}

/**
 * What the observed index disagrees with, in the terms that matter.
 *
 * Deliberately not a deep equality: the server returns the definition with
 * defaults filled in and its own uuid, so a structural diff is noise. These
 * three are the ones whose drift is silent — the keyspace decides whether
 * anything is indexed at all, and the vector width decides whether the query
 * is rejected outright.
 */
function drift(
  observed: IndexDefinition | undefined,
  wanted: IndexDefinition,
  typeKey: string
): string[] {
  if (!observed) return ['index does not exist'];
  const problems: string[] = [];

  const observedTypes = Object.keys(
    (observed.params?.mapping?.types ?? {}) as Record<string, unknown>
  );
  if (!observedTypes.includes(typeKey)) {
    problems.push(
      `maps ${observedTypes.join(', ') || '(nothing)'} — wanted ${typeKey}`
    );
  }

  if (observed.sourceName !== wanted.sourceName) {
    problems.push(
      `reads bucket ${observed.sourceName ?? '(none)'} — wanted ${
        wanted.sourceName
      }`
    );
  }

  const observedMapping = (
    (observed.params?.mapping?.types ?? {}) as Record<
      string,
      { properties?: Record<string, { fields?: Array<{ dims?: number }> }> }
    >
  )[typeKey];
  const dims = observedMapping?.properties?.['embedding']?.fields?.[0]?.dims;
  if (dims !== undefined && dims !== EMBEDDING_DIMENSIONS) {
    problems.push(`vector width ${dims} — wanted ${EMBEDDING_DIMENSIONS}`);
  }

  // Whether the free-text fields join `_all`. Checked because it is the third
  // silent one: without it an unfielded query — which is every search a seller
  // types — matches nothing, while the vector half keeps returning documents.
  // A live index missed this exact change, since the checks above all passed.
  const searchTextField = (
    observedMapping as
      | {
          properties?: Record<
            string,
            { fields?: Array<{ include_in_all?: boolean }> }
          >;
        }
      | undefined
  )?.properties?.['searchText']?.fields?.[0];
  if (searchTextField && !searchTextField.include_in_all) {
    problems.push(
      'searchText is not in _all — unfielded keyword search matches nothing'
    );
  }

  return problems;
}

async function main() {
  requireConfig();
  const args = process.argv.slice(2);
  const env = requireEnv(args[args.indexOf('--env') + 1]);
  const apply = args.includes('--apply');
  const verify = args.includes('--verify');
  const json = args.includes('--json');

  const wanted = documentSearchIndexDefinition({
    bucket: config.bucket,
    environmentScope: env,
  });
  const typeKey = documentSearchTypeKey(env);

  // The definition on stdout, for creating the index by hand in the Capella UI.
  //
  // Worth having as a first-class option rather than a workaround: creating a
  // Search index is a ONE-OFF administrative act, and doing it here requires
  // giving the application's own credential bucket-wide write for the lifetime
  // of the app. Pasted into the UI instead, the credential keeps read-only
  // access and can still query — which is all the running app ever does.
  if (json) {
    console.log(JSON.stringify(wanted, null, 2));
    return;
  }

  console.log(`${apply ? 'APPLYING' : 'PLAN'} → ${config.bucket}.${env}`);
  console.log(`  index    ${wanted.name}`);
  console.log(`  matches  ${typeKey}`);
  console.log(`  vectors  ${EMBEDDING_DIMENSIONS}-wide, dot_product\n`);

  const existing = await readIndex(env, wanted.name);
  const problems = drift(existing.definition, wanted, typeKey);

  if (!problems.length) {
    console.log('  in sync — nothing to do');
  } else {
    for (const problem of problems) console.log(`  ~ ${problem}`);
  }

  if (verify) {
    const count = await indexedCount(env, wanted.name);
    console.log(
      `\n  indexed documents: ${count === null ? 'unreadable' : count}`
    );
    if (count === 0) {
      // The whole reason this flag exists.
      console.log(
        '  NOTE zero indexed documents. If the collection is not empty this is\n' +
          '       a keyspace mismatch, not an empty library — the index is\n' +
          '       matching nothing and every search will return no results.'
      );
    }
  }

  if (!apply) {
    console.log(
      problems.length ? '\nDrift found. Re-run with --apply.\n' : '\n'
    );
    return;
  }

  if (!problems.length) return;

  // Updating an existing index requires naming the one being replaced;
  // without it the service refuses rather than silently forking a second.
  const body: Record<string, unknown> = { ...wanted };
  const url = existing.uuid
    ? `${indexPath(env, wanted.name)}?prevIndexUUID=${encodeURIComponent(
        existing.uuid
      )}`
    : indexPath(env, wanted.name);

  const { ok, status, payload } = await callSearchApi(url, {
    method: 'PUT',
    body,
  });
  if (!ok) {
    console.error(
      `\n  failed (HTTP ${status}): ${
        payload['error'] ?? JSON.stringify(payload).slice(0, 300)
      }\n`
    );
    process.exit(1);
  }

  console.log(`\n  ${existing.uuid ? 'updated' : 'created'} ${wanted.name}`);
  console.log(
    '  Building is asynchronous — re-run with --verify in a minute to see\n' +
      '  how many documents it has taken in.\n'
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
