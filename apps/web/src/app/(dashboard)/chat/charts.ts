/**
 * Turning a validated chart spec into what the renderer needs.
 *
 * Pure and DOM-free, like `downloads.ts` and `table-cells.ts` beside it: the
 * decisions worth testing here — how a null renders, which axis gets which
 * formatter, when 12 long campaign names have to lie on their side — are all
 * answerable without mounting anything.
 *
 * Two things deliberately live HERE rather than in the model's vocabulary.
 * Colour, because a model choosing hex values produces charts that clash with
 * the app and with each other; series get theme tokens by position instead.
 * And orientation, because it follows from the data (bar count, label length)
 * rather than from intent — a seller asking for ACOS by campaign has no
 * opinion about which way the bars point, and campaign names are long enough
 * that vertical bars would be unreadable often enough to matter.
 */

import {
  ChartSpecSchema,
  type ChartSeries,
  type ChartSpec,
} from '@farvisionllc/models';
import type { ChartConfig } from '@/components/ui/chart';

/**
 * The tool whose output is drawn as a chart.
 *
 * Name-keyed, unlike `extractDownloads` next door, and the difference is
 * intentional. A `downloadUrl` is an incidental property of tools that mainly
 * do something else, so keying on shape means nobody has to remember to
 * register the seventh one. A chart spec is the opposite: the spec IS this
 * tool's purpose, and no other tool can produce one by accident. Keying on
 * shape there would mean some future tool returning `{ series, points }` for
 * unrelated reasons gets drawn as a chart — a false positive that renders
 * someone else's data under a chart title.
 */
export const CHART_TOOL_PART_TYPE = 'tool-render-chart';

/** Series colours, by position. Cycles — the schema caps series below this. */
const SERIES_COLOR_COUNT = 5;

/**
 * The spec inside a tool result, or null if there isn't a usable one.
 *
 * Re-validated rather than trusted. The output has been through storage and
 * back by the time it is read here, and a spec that no longer parses (an older
 * shape, a truncated write) must degrade to the plain tool card rather than
 * throw inside a message list — one bad historical chart would otherwise take
 * the whole conversation down.
 */
export function extractChartSpec(output: unknown): ChartSpec | null {
  if (!output || typeof output !== 'object') return null;
  const data = output as Record<string, unknown>;
  if (data['success'] === false) return null;

  const parsed = ChartSpecSchema.safeParse(data['chart']);
  return parsed.success ? parsed.data : null;
}

/** Stable key for a series, by position: `values` is positional too. */
export function seriesKey(index: number): string {
  return `s${index}`;
}

/**
 * One row per x value, which is the shape the chart library wants.
 *
 * Nulls are preserved rather than coerced. They are what produces a GAP in a
 * line — the visual statement that there was no data — and a zero substituted
 * here would draw a campaign that sold nothing as the most efficient point on
 * the chart.
 */
export function toChartRows(
  spec: ChartSpec
): Array<Record<string, string | number | null>> {
  return spec.points.map((point) => {
    const row: Record<string, string | number | null> = { label: point.label };
    spec.series.forEach((_, index) => {
      row[seriesKey(index)] = point.values[index] ?? null;
    });
    return row;
  });
}

/** Series labels and their theme colours, keyed the same way as the rows. */
export function toChartConfig(spec: ChartSpec): ChartConfig {
  const config: ChartConfig = {};
  spec.series.forEach((series, index) => {
    config[seriesKey(index)] = {
      label: series.label,
      // A CSS variable, not a resolved colour: it is defined for both themes in
      // global.css, so it stays correct if the app ever switches to dark.
      color: `var(--chart-${(index % SERIES_COLOR_COUNT) + 1})`,
    };
  });
  return config;
}

/** Which axis a series is measured against, with the default applied. */
export function seriesAxis(series: ChartSeries): 'left' | 'right' {
  return series.axis ?? 'left';
}

/**
 * The axes actually in use, in render order.
 *
 * Only axes with series on them get drawn — an empty right axis is a line and
 * a set of ticks describing nothing.
 */
export function usedAxes(spec: ChartSpec): Array<'left' | 'right'> {
  return (['left', 'right'] as const).filter((axis) =>
    spec.series.some((series) => seriesAxis(series) === axis)
  );
}

/**
 * The format for an axis. Safe to take from the first series on it: the schema
 * refuses a spec whose axis carries more than one unit.
 */
export function axisFormat(spec: ChartSpec, axis: 'left' | 'right') {
  return spec.series.find((series) => seriesAxis(series) === axis)?.format;
}

/**
 * A value as the reader should see it.
 *
 * `compact` is for axis ticks, where "$1.2k" fits and "$1,204.30" collides
 * with its neighbours. Tooltips and labels use the full form.
 *
 * Percentages arrive as FRACTIONS — 0.22 is 22% — because that is what ACOS
 * arithmetic (cost / sales) produces upstream. Sending 22 through this would
 * print 2,200%.
 */
export function formatChartValue(
  value: number | null | undefined,
  format: ChartSeries['format'] | undefined,
  currencyCode?: string,
  options: { compact?: boolean } = {}
): string {
  // Not "0", and not an empty cell either. A gap is a fact about the data and
  // deserves to be legible as one.
  if (value == null || !Number.isFinite(value)) return '—';

  if (format === 'percent') {
    return `${(value * 100).toFixed(options.compact ? 0 : 1)}%`;
  }

  if (format === 'currency') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      // The schema guarantees a code beside a currency series; the fallback is
      // for a malformed-but-parseable call, not an expected path.
      currency: currencyCode ?? 'USD',
      notation: options.compact ? 'compact' : 'standard',
      maximumFractionDigits: options.compact ? 1 : 2,
      minimumFractionDigits: options.compact ? 0 : 2,
    }).format(value);
  }

  return new Intl.NumberFormat('en-US', {
    notation: options.compact ? 'compact' : 'standard',
    maximumFractionDigits: options.compact ? 1 : 0,
  }).format(value);
}

/** Beyond this, a horizontal category label overlaps the one next to it. */
const LONG_LABEL_CHARS = 12;
const CROWDED_BAR_COUNT = 8;

/** Category names too long to sit flat under a vertical chart. */
export function hasLongLabels(spec: ChartSpec): boolean {
  return spec.points.some((point) => point.label.length > LONG_LABEL_CHARS);
}

/**
 * Whether the bars should lie on their side.
 *
 * Only a CATEGORY axis is ever turned: time runs left-to-right, and a time
 * series climbing bottom-to-top is not something anyone reads. Within that,
 * only all-bar charts — points and lines lose their meaning on a rotated
 * scale. The trigger is real Amazon data: "SP | Brand Defense | Exact" is an
 * ordinary campaign name, and a dozen under vertical bars overlap into an
 * unreadable band.
 */
export function shouldLayoutHorizontal(spec: ChartSpec): boolean {
  if (spec.xKind !== 'category') return false;
  if (!spec.series.every((series) => series.render === 'bar')) return false;

  return spec.points.length > CROWDED_BAR_COUNT || hasLongLabels(spec);
}

/**
 * Whether an upright chart has to tilt its category labels.
 *
 * The case this exists for is the mixed chart — spend as bars beside ACOS as
 * points — which `shouldLayoutHorizontal` deliberately refuses to turn
 * sideways and which therefore had no help at all. Twelve campaigns came out
 * with six labels under them, because the axis silently thins ticks that would
 * collide: the reader is told "Exact - 500pk cups is your worst" and cannot
 * find the bar.
 *
 * A time axis is never tilted. Thinning dates costs nothing — every other
 * "Jul 3" is still a date, and the ones between are inferable. Dropping half a
 * set of NAMES loses what no neighbour implies.
 */
export function shouldAngleLabels(spec: ChartSpec): boolean {
  return (
    spec.xKind === 'category' &&
    !shouldLayoutHorizontal(spec) &&
    hasLongLabels(spec)
  );
}

/**
 * How much of a tilted label survives before it runs into the next one.
 *
 * Elision is the honest trade: every category keeps a label, over-long ones
 * end in an ellipsis, and the full name is still on the tooltip — which is
 * strictly more than the axis showed when it silently dropped every second
 * category.
 */
const TICK_LABEL_MAX = 16;

export function truncateTickLabel(label: string): string {
  return label.length > TICK_LABEL_MAX
    ? `${label.slice(0, TICK_LABEL_MAX - 1).trimEnd()}…`
    : label;
}

/**
 * Whether a series has a value with no neighbour to join to.
 *
 * A line segment needs two points. A value whose neighbours are both null —
 * or the single value at the end of a series — produces a path of `M x,y`
 * with no `L`, which paints NOTHING when dots are off. The figure is present
 * in the data, absent on screen, and indistinguishable from the gaps beside
 * it: the chart silently under-reports.
 *
 * Found in the wild rather than reasoned about. A seller charted ten glass
 * teapot campaigns where only one had attributed sales, so exactly one ACOS
 * was real; the line covered the first few campaigns and then stopped, and the
 * one genuine figure past that point drew as empty space.
 *
 * The renderer turns dots on for such a series. Only for such a series: a
 * clean 30-day line does not need thirty markers.
 */
export function hasIsolatedValues(
  spec: ChartSpec,
  seriesIndex: number
): boolean {
  const values = spec.points.map((point) => point.values[seriesIndex] ?? null);
  return values.some(
    (value, i) =>
      value !== null && values[i - 1] == null && values[i + 1] == null
  );
}
