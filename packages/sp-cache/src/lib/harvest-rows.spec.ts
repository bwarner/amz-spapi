import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryHarvestRows, reportStorage } from './report-store.js';

/**
 * The query a harvest reads its evidence from (#147).
 *
 * Every failure here is a wrong number that looks right: a term that appears to
 * have clicks and no orders is proposed as WASTE and negated, and a term whose
 * spend is understated graduates on an ACOS that was never real. The query is
 * asserted directly because none of that is visible in the output.
 */

function capture() {
  return vi
    .spyOn(reportStorage, 'executeQuery')
    .mockResolvedValue({ rows: [] } as never);
}

afterEach(() => vi.restoreAllMocks());

describe('queryHarvestRows', () => {
  it('sums the parsed numbers, never the string column', async () => {
    // `numbers` is the copy parsed once at ingest. Summing `fields` is how
    // "0.011" totals as 11 and turns a $23 month into thousands.
    const execute = capture();
    await queryHarvestRows({
      sellerId: 'A1',
      from: '2026-07-01',
      to: '2026-07-30',
    });

    const [, statement] = execute.mock.calls[0] as [string, string];
    for (const measure of [
      'impressions',
      'clicks',
      'spend',
      'sales',
      'orders',
    ]) {
      expect(statement).toContain(`d.numbers.\`${measure}\``);
    }
    expect(statement).not.toMatch(/SUM\([^)]*d\.fields\./);
  });

  it('coalesces a missing measure to zero, so one row cannot erase a group', async () => {
    // SUM over a NULL is NULL in N1QL. A single row without a sales column
    // would blank the group's sales, and a group with no sales and real spend
    // is exactly what the waste rule negates.
    const execute = capture();
    await queryHarvestRows({
      sellerId: 'A1',
      from: '2026-07-01',
      to: '2026-07-30',
    });

    const [, statement] = execute.mock.calls[0] as [string, string];
    expect(statement).toContain('COALESCE(TONUMBER(');
  });

  it('groups by placement as well as term, so two ad groups stay two facts', async () => {
    // The same term in two ad groups is evidence about two different bids.
    // Collapsing them averages a winning ad group with a losing one.
    const execute = capture();
    await queryHarvestRows({
      sellerId: 'A1',
      from: '2026-07-01',
      to: '2026-07-30',
    });

    const [, statement] = execute.mock.calls[0] as [string, string];
    const groupBy = statement.slice(statement.indexOf('GROUP BY'));
    expect(groupBy).toContain('searchTerm');
    expect(groupBy).toContain('campaignId');
    expect(groupBy).toContain('adGroupId');
    expect(groupBy).toContain('matchType');
  });

  it('drops rows with no search term rather than grouping them under nothing', async () => {
    // A console export and an API pull disagree about which columns exist. A
    // NULL group would present itself as a term available to graduate.
    const execute = capture();
    await queryHarvestRows({
      sellerId: 'A1',
      from: '2026-07-01',
      to: '2026-07-30',
    });

    const [, statement] = execute.mock.calls[0] as [string, string];
    expect(statement).toContain('IS NOT MISSING');
    expect(statement).toMatch(/searchTerm`? *!= *''/);
  });

  it('bounds the window and the seller, and parameterises both', async () => {
    const execute = capture();
    await queryHarvestRows({
      sellerId: 'A1',
      from: '2026-07-01',
      to: '2026-07-30',
    });

    const [, statement, options] = execute.mock.calls[0] as [
      string,
      string,
      { parameters: Record<string, unknown>; readonly?: boolean }
    ];
    expect(statement).toContain('d.sellerId = $sellerId');
    expect(statement).toContain("d.reportKind = 'search-term'");
    expect(options.parameters).toMatchObject({
      sellerId: 'A1',
      from: '2026-07-01',
      to: '2026-07-30',
    });
    // A harvest only reads; saying so keeps it off a writable node.
    expect(options.readonly).toBe(true);
  });

  it('narrows to the funnel campaigns only when asked', async () => {
    const execute = capture();
    await queryHarvestRows({
      sellerId: 'A1',
      from: '2026-07-01',
      to: '2026-07-30',
      campaignIds: ['555', '429'],
    });
    const [, statement, options] = execute.mock.calls[0] as [
      string,
      string,
      { parameters: Record<string, unknown> }
    ];
    expect(statement).toContain('IN $campaignIds');
    expect(options.parameters['campaignIds']).toEqual(['555', '429']);

    // Absent, the clause must not appear at all — an empty IN list matches
    // nothing, which would silently harvest zero terms and read as "no
    // candidates" rather than as a mistake.
    const second = capture();
    await queryHarvestRows({
      sellerId: 'A1',
      from: '2026-07-01',
      to: '2026-07-30',
    });
    expect(second.mock.calls[0]?.[1] as string).not.toContain('$campaignIds');
  });
});
