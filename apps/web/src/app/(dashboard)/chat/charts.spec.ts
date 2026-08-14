/**
 * The chart helpers, tested where they decide something.
 *
 * The recurring theme is the difference between "no data" and "zero" — a
 * distinction that survives the schema, has to survive the row mapping, and
 * has to be legible once formatted. A zero-spend day and a day Amazon has not
 * reported yet look identical on a chart that gets this wrong.
 */

import { describe, expect, it } from 'vitest';
import type { ChartSpec } from '@farvisionllc/models';
import {
  axisFormat,
  extractChartSpec,
  formatChartValue,
  hasIsolatedValues,
  shouldAngleLabels,
  shouldLayoutHorizontal,
  toChartConfig,
  toChartRows,
  truncateTickLabel,
  usedAxes,
} from './charts';

const SPEC: ChartSpec = {
  title: 'Spend vs ACOS',
  xKind: 'time',
  caption: 'Jul 1–3, 14d attribution',
  currencyCode: 'USD',
  series: [
    { label: 'Spend', render: 'bar', format: 'currency' },
    { label: 'ACOS', render: 'line', format: 'percent', axis: 'right' },
  ],
  points: [
    { label: 'Jul 1', values: [120.5, 0.22] },
    { label: 'Jul 2', values: [98.25, null] },
    { label: 'Jul 3', values: [0, 0.31] },
  ],
};

describe('extractChartSpec', () => {
  it('reads the spec out of a tool result', () => {
    expect(extractChartSpec({ success: true, chart: SPEC })?.title).toBe(
      'Spend vs ACOS'
    );
  });

  it('returns null for a refusal rather than drawing an empty chart', () => {
    expect(extractChartSpec({ success: false, error: 'nope' })).toBeNull();
  });

  it('returns null instead of throwing on a spec that no longer parses', () => {
    // Output round-trips through storage; a stale or truncated spec must
    // degrade to the plain tool card, not take the message list down with it.
    expect(
      extractChartSpec({ chart: { title: 'Broken', points: [] } })
    ).toBeNull();
    expect(extractChartSpec(null)).toBeNull();
    expect(extractChartSpec('chart')).toBeNull();
  });
});

describe('toChartRows', () => {
  it('gives one row per x value, keyed by series position', () => {
    const rows = toChartRows(SPEC);

    expect(rows[0]).toEqual({ label: 'Jul 1', s0: 120.5, s1: 0.22 });
  });

  it('preserves null so the line breaks instead of dropping to zero', () => {
    // The whole point: a gap says "no data", a zero says "no cost".
    const rows = toChartRows(SPEC);

    expect(rows[1].s1).toBeNull();
    expect(rows[2].s0).toBe(0);
  });
});

describe('toChartConfig', () => {
  it('labels each series and assigns a theme token by position', () => {
    const config = toChartConfig(SPEC);

    expect(config.s0.label).toBe('Spend');
    expect(config.s0).toMatchObject({ color: 'var(--chart-1)' });
    expect(config.s1).toMatchObject({ color: 'var(--chart-2)' });
  });
});

describe('axes', () => {
  it('reports only the axes that carry a series', () => {
    expect(usedAxes(SPEC)).toEqual(['left', 'right']);
    expect(
      usedAxes({
        ...SPEC,
        series: [SPEC.series[0]],
        points: [
          { label: 'Jul 1', values: [1] },
          { label: 'Jul 2', values: [2] },
        ],
      })
    ).toEqual(['left']);
  });

  it('takes each axis format from the series on it', () => {
    expect(axisFormat(SPEC, 'left')).toBe('currency');
    expect(axisFormat(SPEC, 'right')).toBe('percent');
  });
});

describe('formatChartValue', () => {
  it('renders a gap as an em dash, never as zero', () => {
    expect(formatChartValue(null, 'currency', 'USD')).toBe('—');
    expect(formatChartValue(undefined, 'percent')).toBe('—');
  });

  it('renders an actual zero as a real number', () => {
    // A zero-spend day is data. It must not read as missing.
    expect(formatChartValue(0, 'currency', 'USD')).toBe('$0.00');
    expect(formatChartValue(0, 'count')).toBe('0');
  });

  it('treats percentages as fractions, matching ACOS arithmetic', () => {
    // cost / sales gives 0.22 for 22%. Passing 22 here would print 2,200%.
    expect(formatChartValue(0.224, 'percent')).toBe('22.4%');
  });

  it('honours the profile currency rather than assuming dollars', () => {
    expect(formatChartValue(1204.3, 'currency', 'CAD')).toContain('1,204.30');
  });

  it('compacts axis ticks so they do not collide', () => {
    expect(formatChartValue(1204.3, 'currency', 'USD', { compact: true })).toBe(
      '$1.2K'
    );
    expect(formatChartValue(12040, 'count', undefined, { compact: true })).toBe(
      '12K'
    );
  });

  it('refuses a non-finite value rather than printing Infinity', () => {
    expect(formatChartValue(Number.POSITIVE_INFINITY, 'currency', 'USD')).toBe(
      '—'
    );
  });
});

describe('shouldLayoutHorizontal', () => {
  const bars = (labels: string[]): ChartSpec => ({
    title: 'ACOS by campaign',
    xKind: 'category',
    caption: 'Last 30 days, 14d attribution',
    series: [{ label: 'ACOS', render: 'bar', format: 'percent' }],
    points: labels.map((label) => ({ label, values: [0.2] })),
  });

  it('turns bars sideways when the labels are long', () => {
    // "SP | Brand Defense | Exact" is an ordinary campaign name.
    expect(
      shouldLayoutHorizontal(bars(['SP | Brand Defense | Exact', 'Auto']))
    ).toBe(true);
  });

  it('turns bars sideways when there are too many of them', () => {
    expect(
      shouldLayoutHorizontal(bars(Array.from({ length: 9 }, (_, i) => `C${i}`)))
    ).toBe(true);
  });

  it('leaves a small bar chart upright', () => {
    expect(shouldLayoutHorizontal(bars(['Auto', 'Exact', 'Broad']))).toBe(
      false
    );
  });

  it('never turns a line chart sideways', () => {
    // A horizontal time series reads bottom-to-top, which nobody expects.
    expect(shouldLayoutHorizontal(SPEC)).toBe(false);
  });
});

/**
 * Regression: the first real chart this tool drew.
 *
 * Spend and sales as bars with ACOS as a line, over 12 campaigns whose names
 * run past 20 characters. It stayed upright — correctly, since a sideways line
 * chart reads bottom-to-top — and then the axis silently thinned the ticks, so
 * twelve bars carried six labels. The prose named a campaign as the worst
 * performer and the reader could not find it.
 */
describe('shouldAngleLabels', () => {
  const comboOverCampaigns = (labels: string[]): ChartSpec => ({
    title: 'Spend vs Sales by campaign',
    xKind: 'category',
    caption: 'Jul 15 – Aug 13, 14d attribution. Top 12 by spend.',
    currencyCode: 'USD',
    series: [
      { label: 'Spend', render: 'bar', format: 'currency' },
      { label: 'Sales', render: 'bar', format: 'currency' },
      { label: 'ACOS', render: 'point', format: 'percent', axis: 'right' },
    ],
    points: labels.map((label) => ({ label, values: [100, 200, 0.5] })),
  });

  const CAMPAIGNS = [
    'Auto - Triple Wall Cups',
    'Broad - coffee press',
    'Exact 2 - coffee press',
    'PATA 1 - Insulated Cup',
    'Exact - 500pk cups',
    'Broad Modifier - Tea Pot',
  ];

  it('tilts the labels on the combo chart the sideways rule refuses', () => {
    const spec = comboOverCampaigns(CAMPAIGNS);

    expect(shouldLayoutHorizontal(spec)).toBe(false);
    expect(shouldAngleLabels(spec)).toBe(true);
  });

  it('leaves a date axis alone, where thinning costs nothing', () => {
    // Every other "Jul 3" is still a date. Dropping half a set of NAMES loses
    // what a neighbour cannot imply; dropping half a set of dates does not.
    expect(shouldAngleLabels(SPEC)).toBe(false);
  });

  it('does not tilt what it has already turned sideways', () => {
    const sideways: ChartSpec = {
      ...comboOverCampaigns(CAMPAIGNS),
      series: [{ label: 'ACOS', render: 'bar', format: 'percent' }],
      points: CAMPAIGNS.map((label) => ({ label, values: [0.4] })),
    };

    expect(shouldLayoutHorizontal(sideways)).toBe(true);
    expect(shouldAngleLabels(sideways)).toBe(false);
  });
});

/**
 * Regression: ten glass teapot campaigns, one with attributed sales.
 *
 * Exactly one ACOS was real. The line covered the campaigns up to it and
 * stopped, and the one genuine figure past that point drew as empty space —
 * a path of `M x,y` with no segment, and no dot to fall back on. The chart
 * under-reported, and nothing on screen said so.
 */
describe('hasIsolatedValues', () => {
  const stranded: ChartSpec = {
    title: 'Spend vs ACOS',
    xKind: 'category',
    caption: 'Jul 15 – Aug 13, 14d attribution',
    currencyCode: 'USD',
    series: [
      { label: 'Spend', render: 'bar', format: 'currency' },
      { label: 'ACOS', render: 'point', format: 'percent', axis: 'right' },
    ],
    points: [
      { label: 'Broad Modifier', values: [5.1, null] },
      { label: 'SP - PATA', values: [8.4, null] },
      { label: 'SP - Auto', values: [28, 1.4] },
      { label: 'PATA 2', values: [5.2, null] },
    ],
  };

  it('spots a value with a gap on both sides', () => {
    expect(hasIsolatedValues(stranded, 1)).toBe(true);
  });

  it('spots a lone value at the end of a series', () => {
    // Nothing to its left, nothing to its right: still unconnectable.
    const trailing: ChartSpec = {
      ...stranded,
      points: [
        { label: 'a', values: [1, null] },
        { label: 'b', values: [2, null] },
        { label: 'c', values: [3, 0.4] },
      ],
    };

    expect(hasIsolatedValues(trailing, 1)).toBe(true);
  });

  it('leaves a continuous series alone, so it needs no markers', () => {
    expect(hasIsolatedValues(SPEC, 0)).toBe(false);
  });

  it('does not flag a gap between two joinable runs', () => {
    // Jul 2's null splits the ACOS series, but Jul 1 and Jul 3 each still have
    // a neighbour... except they do not — this is the honest edge, and the
    // 3-point fixture strands both. Use a longer run to check the real case.
    const twoRuns: ChartSpec = {
      ...SPEC,
      points: [
        { label: 'Jul 1', values: [1, 0.2] },
        { label: 'Jul 2', values: [1, 0.3] },
        { label: 'Jul 3', values: [1, null] },
        { label: 'Jul 4', values: [1, 0.4] },
        { label: 'Jul 5', values: [1, 0.5] },
      ],
    };

    expect(hasIsolatedValues(twoRuns, 1)).toBe(false);
  });
});

describe('truncateTickLabel', () => {
  it('elides a name too long for a tilted tick', () => {
    expect(truncateTickLabel('Broad Modifier - Tea Pot')).toBe(
      'Broad Modifier…'
    );
  });

  it('leaves a short label untouched', () => {
    expect(truncateTickLabel('Jul 3')).toBe('Jul 3');
  });

  it('never leaves a dangling space before the ellipsis', () => {
    expect(truncateTickLabel('Exact - 500pk cups')).not.toMatch(/ …$/);
  });
});
