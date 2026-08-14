/**
 * The chart spec's job is to reject charts that would render happily and lie.
 *
 * Every case below is a chart that draws without erroring: a series shifted by
 * one column, a percentage crushed against a dollar axis, waste plotted as
 * efficiency. None of them look broken on screen, which is exactly why they
 * have to fail here.
 */

import { describe, expect, it } from 'vitest';
import { ChartSpecSchema } from './chart-spec.js';

/** A valid two-series spec; each test breaks one thing about it. */
function spec(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Spend vs ACOS',
    xKind: 'time',
    caption: 'Jul 1–7, 14d attribution window',
    currencyCode: 'USD',
    series: [
      { label: 'Spend', render: 'bar', format: 'currency' },
      { label: 'ACOS', render: 'line', format: 'percent', axis: 'right' },
    ],
    points: [
      { label: 'Jul 1', values: [120.5, 0.22] },
      { label: 'Jul 2', values: [98.25, 0.31] },
    ],
    ...overrides,
  };
}

describe('a well-formed spec', () => {
  it('accepts spend as bars behind ACOS as a line', () => {
    // The chart this feature exists to draw. No top-level "combo" type is
    // needed for it — the series say what they are.
    expect(ChartSpecSchema.safeParse(spec()).success).toBe(true);
  });

  it('accepts null where there is genuinely no data', () => {
    const result = ChartSpecSchema.safeParse(
      spec({
        points: [
          { label: 'Jul 1', values: [120.5, 0.22] },
          // Spend with no sales: there IS no ACOS for this day.
          { label: 'Jul 2', values: [98.25, null] },
        ],
      })
    );

    expect(result.success).toBe(true);
  });
});

describe('arity', () => {
  it('rejects a point carrying fewer values than there are series', () => {
    // The dangerous one: the chart still draws, with series 2 reading series
    // 1's numbers under its own name.
    const result = ChartSpecSchema.safeParse(
      spec({
        points: [
          { label: 'Jul 1', values: [120.5] },
          { label: 'Jul 2', values: [98.25, 0.31] },
        ],
      })
    );

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(
      /one value per series/
    );
  });
});

/**
 * The mark has to match what the axis means.
 *
 * A line asserts movement between neighbours. Days have neighbours; campaigns
 * do not — their order is whatever the list was sorted by, so a line across
 * them changes shape when you re-sort and stays identical in every number.
 * The first real chart drawn with this tool made exactly that claim.
 */
describe('marks against the axis kind', () => {
  it('refuses a line drawn across categories', () => {
    const result = ChartSpecSchema.safeParse(
      spec({
        xKind: 'category',
        series: [
          { label: 'Spend', render: 'bar', format: 'currency' },
          { label: 'ACOS', render: 'line', format: 'percent', axis: 'right' },
        ],
      })
    );

    expect(result.success).toBe(false);
    // The message has to name the way out, or the model just retries the line.
    const message = result.error?.issues[0]?.message ?? '';
    expect(message).toContain('"point"');
    expect(message).toContain('no inherent order');
  });

  it('accepts points across categories, which is the honest mark', () => {
    const result = ChartSpecSchema.safeParse(
      spec({
        xKind: 'category',
        series: [
          { label: 'Spend', render: 'bar', format: 'currency' },
          { label: 'ACOS', render: 'point', format: 'percent', axis: 'right' },
        ],
      })
    );

    expect(result.success).toBe(true);
  });

  it('still allows a line on a time axis, where it means something', () => {
    expect(ChartSpecSchema.safeParse(spec({ xKind: 'time' })).success).toBe(
      true
    );
  });

  it('requires xKind: it cannot be guessed from the labels', () => {
    // "Jul 3" and "Brand — Exact" are both strings. Only the caller knows
    // whether the space between two of them carries meaning.
    expect(ChartSpecSchema.safeParse(spec({ xKind: undefined })).success).toBe(
      false
    );
  });
});

describe('axis units', () => {
  it('refuses percent and currency on the same axis', () => {
    // 22% plotted against $4,000 is a flat line along the x-axis.
    const result = ChartSpecSchema.safeParse(
      spec({
        series: [
          { label: 'Spend', render: 'bar', format: 'currency' },
          { label: 'ACOS', render: 'line', format: 'percent' },
        ],
      })
    );

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/One axis/);
  });

  it('allows the same unit twice on one axis', () => {
    const result = ChartSpecSchema.safeParse(
      spec({
        series: [
          { label: 'Spend', render: 'bar', format: 'currency' },
          { label: 'Sales', render: 'line', format: 'currency' },
        ],
      })
    );

    expect(result.success).toBe(true);
  });
});

describe('currency', () => {
  it('requires a currency code beside a currency series', () => {
    const result = ChartSpecSchema.safeParse(spec({ currencyCode: undefined }));

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/ISO 4217/);
  });

  it('does not demand one when nothing is money', () => {
    const result = ChartSpecSchema.safeParse(
      spec({
        currencyCode: undefined,
        series: [{ label: 'Clicks', render: 'bar', format: 'count' }],
        points: [
          { label: 'Jul 1', values: [40] },
          { label: 'Jul 2', values: [61] },
        ],
      })
    );

    expect(result.success).toBe(true);
  });
});

describe('empty series', () => {
  it('rejects a series that is null at every point', () => {
    const result = ChartSpecSchema.safeParse(
      spec({
        points: [
          { label: 'Jul 1', values: [120.5, null] },
          { label: 'Jul 2', values: [98.25, null] },
        ],
      })
    );

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/null at every point/);
  });
});

describe('bounds', () => {
  it('rejects a single point, which is a number and not a chart', () => {
    const result = ChartSpecSchema.safeParse(
      spec({ points: [{ label: 'Jul 1', values: [120.5, 0.22] }] })
    );

    expect(result.success).toBe(false);
  });

  it('rejects more than 60 points so long windows get aggregated', () => {
    const result = ChartSpecSchema.safeParse(
      spec({
        points: Array.from({ length: 61 }, (_, i) => ({
          label: `Day ${i}`,
          values: [1, 0.2],
        })),
      })
    );

    expect(result.success).toBe(false);
  });

  it('rejects more than 4 series', () => {
    const result = ChartSpecSchema.safeParse(
      spec({
        series: Array.from({ length: 5 }, (_, i) => ({
          label: `S${i}`,
          render: 'line',
          format: 'count',
        })),
        currencyCode: undefined,
        points: [
          { label: 'Jul 1', values: [1, 2, 3, 4, 5] },
          { label: 'Jul 2', values: [1, 2, 3, 4, 5] },
        ],
      })
    );

    expect(result.success).toBe(false);
  });

  it('requires a caption, the slot that states the attribution window', () => {
    const result = ChartSpecSchema.safeParse(spec({ caption: '' }));

    expect(result.success).toBe(false);
  });

  it('rejects a non-finite value rather than drawing an infinite axis', () => {
    // ACOS computed as cost/0 arrives here as Infinity if nobody caught it.
    const result = ChartSpecSchema.safeParse(
      spec({
        points: [
          { label: 'Jul 1', values: [120.5, Number.POSITIVE_INFINITY] },
          { label: 'Jul 2', values: [98.25, 0.31] },
        ],
      })
    );

    expect(result.success).toBe(false);
  });
});
