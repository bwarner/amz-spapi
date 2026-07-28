#!/usr/bin/env node
/**
 * Inspect or drop stored report rows. Development utility.
 *
 * Remapping a report's columns changes how rows are INTERPRETED without
 * changing their content hash, so a re-import reports every row as a duplicate
 * and keeps the old mapping. Dropping and re-importing is the fix while the
 * registry is still being corrected against real exports.
 *
 * Usage:
 *   npx tsx --env-file=apps/web/.env.local scripts/report-rows.ts count <sellerId> [kind]
 *   npx tsx --env-file=apps/web/.env.local scripts/report-rows.ts delete <sellerId> <kind>
 */
import {
  deleteReportImports,
  deleteReportRows,
  REPORT_KINDS,
  type ReportKind,
} from '@amz-spapi/sp-cache';
import { executeQuery } from '@amz-spapi/couchbase-utils';

async function count(sellerId: string, kind?: string) {
  const { rows } = await executeQuery<{ reportKind: string; n: number }>(
    'reports',
    'SELECT d.reportKind, COUNT(*) AS n FROM `rows` AS d ' +
      'WHERE d.sellerId = $sellerId ' +
      (kind ? 'AND d.reportKind = $kind ' : '') +
      'GROUP BY d.reportKind ORDER BY d.reportKind',
    { parameters: { sellerId, ...(kind ? { kind } : {}) }, readonly: true }
  );
  if (!rows.length) {
    console.log('No rows stored for that seller.');
    return;
  }
  for (const row of rows) {
    console.log(`  ${row.reportKind.padEnd(20)} ${row.n} rows`);
  }
}

async function main() {
  const [command, sellerId, kind] = process.argv.slice(2);
  if (!command || !sellerId) {
    console.error(
      'Usage: report-rows.ts <count|delete> <sellerId> [kind]\n' +
        `Kinds: ${REPORT_KINDS.join(', ')}`
    );
    process.exit(1);
  }

  if (command === 'count') {
    await count(sellerId, kind);
    return;
  }

  if (command === 'delete') {
    if (!kind || !REPORT_KINDS.includes(kind as ReportKind)) {
      console.error(`delete needs a kind: ${REPORT_KINDS.join(', ')}`);
      process.exit(1);
    }
    console.log(`Before:`);
    await count(sellerId, kind);
    const deleted = await deleteReportRows({
      sellerId,
      kind: kind as ReportKind,
    });
    // Coverage must go with the rows, or the import ledger would still claim a
    // window is covered when nothing is stored for it.
    const imports = await deleteReportImports({
      sellerId,
      kind: kind as ReportKind,
    });
    console.log(
      `Deleted ${deleted} rows and ${imports} import record(s) for ${kind}.`
    );
    return;
  }

  console.error(`Unknown command "${command}".`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
