'use client';

/**
 * A validated chart spec, drawn.
 *
 * Everything decidable without a DOM lives in `chat/charts.ts` and is tested
 * there; this file is the Recharts wiring and nothing else.
 *
 * Always a ComposedChart, because the spec has no top-level chart type — a
 * series says whether it is a line or a bar, so an all-line spec IS a line
 * chart and spend-bars-behind-an-ACOS-line needs no special case.
 *
 * Two Recharts details worth knowing before editing:
 *
 * - Axis ids must match between the axis and the series drawn against it, and
 *   a `layout="vertical"` chart swaps which component is the category axis.
 *   That is why the two layouts are written out separately rather than sharing
 *   one branchy axis block: the ids move, not just the props.
 * - `ChartTooltipContent` is given an explicit `formatter`. Without one it
 *   renders values through `item.value && (…)`, which prints NOTHING for a
 *   genuine zero — and a zero-spend day would read as missing data.
 */

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartSpec } from '@farvisionllc/models';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  axisFormat,
  formatChartValue,
  hasIsolatedValues,
  seriesAxis,
  seriesKey,
  shouldAngleLabels,
  shouldLayoutHorizontal,
  toChartConfig,
  toChartRows,
  truncateTickLabel,
  usedAxes,
  // Relative: there is no `@/app/*` alias, and the chat-gallery fixtures reach
  // into this directory the same way.
} from '../../app/(dashboard)/chat/charts';

const CATEGORY_AXIS_ID = 'category';

export function ChatChart({ spec }: { spec: ChartSpec }) {
  const rows = toChartRows(spec);
  const config = toChartConfig(spec);
  const axes = usedAxes(spec);
  const horizontal = shouldLayoutHorizontal(spec);
  const angled = shouldAngleLabels(spec);

  const tick = (axis: 'left' | 'right') => (value: number) =>
    formatChartValue(value, axisFormat(spec, axis), spec.currencyCode, {
      compact: true,
    });

  /** Tooltip values carry the unit of the series they belong to, not the axis. */
  const formatValue = (value: unknown, name: unknown) => {
    const index = spec.series.findIndex(
      (_, i) => seriesKey(i) === String(name)
    );
    const series = index >= 0 ? spec.series[index] : undefined;
    return `${series?.label ?? String(name)}: ${formatChartValue(
      typeof value === 'number' ? value : null,
      series?.format,
      spec.currencyCode
    )}`;
  };

  const marks = spec.series.map((series, index) => {
    const key = seriesKey(index);
    const color = `var(--color-${key})`;
    // In a horizontal chart the VALUE axis is the x axis, so the series binds
    // its value to xAxisId and its category to the shared y axis (and the
    // reverse when upright).
    const ids = horizontal
      ? { xAxisId: seriesAxis(series), yAxisId: CATEGORY_AXIS_ID }
      : { xAxisId: CATEGORY_AXIS_ID, yAxisId: seriesAxis(series) };

    if (series.render === 'bar') {
      return (
        <Bar
          key={key}
          dataKey={key}
          name={key}
          fill={color}
          radius={4}
          {...ids}
        />
      );
    }

    // Markers with no connecting path. Recharts has no scatter that shares a
    // ComposedChart's category axis cleanly, so this is a Line with its stroke
    // switched off — the dots are the mark, and nothing is drawn between them
    // to imply movement the data does not claim.
    if (series.render === 'point') {
      return (
        <Line
          key={key}
          dataKey={key}
          name={key}
          stroke={color}
          strokeWidth={0}
          dot={{ r: 4, fill: color }}
          activeDot={{ r: 6 }}
          legendType="circle"
          {...ids}
        />
      );
    }

    return (
      <Line
        key={key}
        dataKey={key}
        name={key}
        stroke={color}
        strokeWidth={2}
        // Dots ONLY where a value would otherwise be invisible. A segment needs
        // two points, so a value with null on both sides paints nothing at all
        // — present in the data, absent on screen. A clean run of days needs no
        // markers, so this stays off unless the series actually strands a value.
        dot={hasIsolatedValues(spec, index) ? { r: 3 } : false}
        // A null is a gap in the data, and must read as one. Connecting across
        // it would draw a straight line through days Amazon never reported.
        connectNulls={false}
        {...ids}
      />
    );
  });

  return (
    <ChartContainer
      config={config}
      // aspect-video is what gives the responsive container a height inside a
      // flex message bubble; without it the chart collapses to zero.
      className="aspect-video max-h-[320px] w-full"
    >
      <ComposedChart
        data={rows}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 12, bottom: 8, left: 12 }}
      >
        <CartesianGrid
          horizontal={!horizontal}
          vertical={horizontal}
          strokeDasharray="3 3"
        />

        {horizontal ? (
          <>
            <YAxis
              yAxisId={CATEGORY_AXIS_ID}
              type="category"
              dataKey="label"
              tickLine={false}
              axisLine={false}
              width={120}
              tickMargin={8}
            />
            {axes.map((axis) => (
              <XAxis
                key={axis}
                xAxisId={axis}
                type="number"
                orientation={axis === 'right' ? 'top' : 'bottom'}
                tickLine={false}
                axisLine={false}
                tickFormatter={tick(axis)}
              />
            ))}
          </>
        ) : (
          <>
            <XAxis
              xAxisId={CATEGORY_AXIS_ID}
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              // With long category names, EVERY tick is drawn (interval 0) and
              // tilted, because the alternative is the axis quietly dropping
              // half the names — leaving bars the reader cannot identify. Short
              // labels keep the default thinning, where showing every other
              // date costs nothing.
              interval={angled ? 0 : 'preserveStartEnd'}
              minTickGap={angled ? 0 : 16}
              angle={angled ? -35 : 0}
              textAnchor={angled ? 'end' : 'middle'}
              height={angled ? 78 : 30}
              tickFormatter={angled ? truncateTickLabel : undefined}
            />
            {axes.map((axis) => (
              <YAxis
                key={axis}
                yAxisId={axis}
                orientation={axis}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={tick(axis)}
              />
            ))}
          </>
        )}

        <ChartTooltip
          content={<ChartTooltipContent formatter={formatValue} />}
        />
        {spec.series.length > 1 ? (
          <ChartLegend content={<ChartLegendContent />} />
        ) : null}
        {marks}
      </ComposedChart>
    </ChartContainer>
  );
}
