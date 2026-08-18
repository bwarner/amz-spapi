import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  storeReportRows,
  recordImport,
  reportStorage,
} from './report-store.js';
import { AMAZON_INFORMATION_MAX_DAYS } from '@amz-spapi/data-rights';
import type { ReportRow } from './report-ingest.js';

/**
 * Retention at the boundary that an assessor actually inspects — what the
 * write statement asks Couchbase for, not what a helper returns.
 *
 * The ceiling is 18 months because the SP-API Data Protection Policy says so.
 * This file exists because the previous value was 730 days for a defensible
 * reason (claim windows are long), which is exactly how a ceiling gets exceeded
 * — not by carelessness, but by a good argument nobody re-checked.
 */

const CEILING_SECONDS = AMAZON_INFORMATION_MAX_DAYS * 24 * 60 * 60;

function row(): ReportRow {
  return {
    rowId: 'row-1',
    sellerId: 'A1',
    kind: 'ledger-detail',
    mappingVersion: 1,
    fields: { date: '2026-07-06' },
    numbers: {},
    raw: { Date: '07/06/2026' },
  } as unknown as ReportRow;
}

/** The absolute epoch Couchbase was handed, back into a duration. */
function requestedSeconds(expiration: number): number {
  return expiration - Math.floor(Date.now() / 1000);
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['REPORT_ROW_TTL_DAYS'];
});

describe('report row retention', () => {
  it('asks for no more than 18 months, whatever the environment says', async () => {
    // The escape hatch must not be able to lift a compliance ceiling.
    process.env['REPORT_ROW_TTL_DAYS'] = '730';
    const execute = vi
      .spyOn(reportStorage, 'executeQuery')
      .mockResolvedValue({ rows: [] } as never);

    await storeReportRows([row()]);

    const write = execute.mock.calls.find(([, statement]) =>
      String(statement).startsWith('UPSERT')
    );
    const exp = (write?.[2] as { parameters: { exp: number } }).parameters.exp;
    // Within a second either way — the clock moves between call and assertion.
    expect(requestedSeconds(exp)).toBeGreaterThan(CEILING_SECONDS - 5);
    expect(requestedSeconds(exp)).toBeLessThanOrEqual(CEILING_SECONDS);
  });

  it('still honours a SHORTER retention, which is the point of the knob', async () => {
    process.env['REPORT_ROW_TTL_DAYS'] = '30';
    const execute = vi
      .spyOn(reportStorage, 'executeQuery')
      .mockResolvedValue({ rows: [] } as never);

    await storeReportRows([row()]);

    const write = execute.mock.calls.find(([, statement]) =>
      String(statement).startsWith('UPSERT')
    );
    const exp = (write?.[2] as { parameters: { exp: number } }).parameters.exp;
    expect(requestedSeconds(exp)).toBeLessThanOrEqual(30 * 24 * 60 * 60);
  });

  it('expires the import record too, so coverage cannot outlive its rows', async () => {
    // An audit row saying "July is covered" that survives July's rows describes
    // coverage that no longer exists — worse than having no record.
    const upsert = vi
      .spyOn(reportStorage, 'upsertDocument')
      .mockResolvedValue(undefined as never);

    await recordImport({
      sellerId: 'A1',
      kind: 'ledger-detail',
      reportType: 'GET_LEDGER_DETAIL_VIEW_DATA',
      source: 'upload',
      rows: [row()],
      stored: 1,
      duplicate: 0,
    });

    const [, , , , expirySeconds] = upsert.mock.calls[0];
    expect(expirySeconds).toBe(CEILING_SECONDS);
  });
});
