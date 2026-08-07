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
 *   npx tsx --env-file=apps/web/.env.local scripts/report-rows.ts migrate <sellerId> [kind]
 *   npx tsx --env-file=apps/web/.env.local scripts/report-rows.ts delete <sellerId> <kind>
 *
 * `migrate` rewrites rows to what today's registry would produce, using only
 * what is already stored — ISO dates and parsed numbers. It is idempotent, and
 * it is the repair for data whose source file is gone. When the file IS still
 * to hand, re-importing it is stronger: that re-reads every column.
 */
import {
  deleteReportImports,
  deleteReportRows,
  migrateReportRows,
  REPORT_KINDS,
  type ReportKind,
} from '@amz-spapi/sp-cache';
import { collectionName, executeQuery } from '@amz-spapi/couchbase-utils';

/**
 * Backticked, and flattened per ADR-0005. `rows` is also a N1QL reserved word.
 * Naming it bare threw before this script could delete anything, which made the
 * one tool for resetting a remapped report the one tool that did not run.
 */
const ROWS = `\`${collectionName('reports', 'rows')}\``;

async function count(sellerId: string, kind?: string) {
  const { rows } = await executeQuery<{ reportKind: string; n: number }>(
    'reports',
    `SELECT d.reportKind, COUNT(*) AS n FROM ${ROWS} AS d ` +
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
      'Usage: report-rows.ts <count|migrate|delete> <sellerId> [kind]\n' +
        `Kinds: ${REPORT_KINDS.join(', ')}`
    );
    process.exit(1);
  }

  if (command === 'count') {
    await count(sellerId, kind);
    return;
  }

  if (command === 'migrate') {
    const kinds = kind ? [kind as ReportKind] : (REPORT_KINDS as ReportKind[]);
    if (kind && !REPORT_KINDS.includes(kind as ReportKind)) {
      console.error(
        `Unknown kind "${kind}". One of: ${REPORT_KINDS.join(', ')}`
      );
      process.exit(1);
    }
    for (const target of kinds) {
      const { scanned, updated } = await migrateReportRows({
        sellerId,
        kind: target,
      });
      if (!scanned) continue;
      console.log(
        `  ${target.padEnd(20)} ${scanned} scanned, ${updated} rewritten`
      );
    }
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
