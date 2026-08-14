/**
 * A chart the assistant draws from data it has already fetched.
 *
 * The vocabulary is deliberately small. The model does not author component
 * props — it states what the series ARE (a label, a shape, a unit) and hands
 * over the numbers; every rendering decision is made downstream from that. A
 * pass-through of Recharts config would put layout bugs, unreadable colour
 * choices and untestable output into the model's hands, and there would be no
 * boundary at which a malformed chart could be rejected.
 *
 * The refinements below are the interesting part. Each one blocks a chart that
 * renders happily and misleads:
 *
 * - Arity. `values` is positional, one per series. A point with the wrong
 *   count would draw series 2's number under series 1's name — a chart that is
 *   confidently wrong, with nothing on screen to suggest it.
 * - Shared axis, shared unit. ACOS at 22 (percent) beside spend at 4,000
 *   (dollars) on one scale flattens the percentage into the axis line. This is
 *   what makes "one tick formatter per axis" well defined rather than a guess.
 * - Currency needs its code. A bare "$" in front of CAD is a different claim.
 * - An all-null series is a series the model failed to fill; drawing an empty
 *   legend entry hides that it meant to say something.
 *
 * `null` is not zero, and the distinction is load-bearing for the question
 * this feature exists to answer. A campaign with spend and no sales has NO
 * ACOS — plotting it as 0 draws pure waste as the most efficient point on the
 * chart, inverting the ranking the seller asked for. The same rule already
 * governs the numbers coming out of `get-ad-report`.
 */

import { z } from 'zod';

/**
 * Ceilings, not preferences. They bound what a single tool call can put into
 * the conversation — the spec is echoed in the tool call's arguments, which
 * stay in history — and they force the model to aggregate rather than dump a
 * year of daily rows into a chart nobody can read.
 */
export const CHART_MAX_SERIES = 4;
export const CHART_MAX_POINTS = 60;

/** What a number MEANS, which is the only thing formatting can be derived from. */
export const ChartValueFormatSchema = z.enum(['currency', 'percent', 'count']);
export type ChartValueFormat = z.infer<typeof ChartValueFormatSchema>;

/**
 * What the x axis MEANS, which decides which marks are honest on it.
 *
 * `time` is an ordered continuum: the space between two x values is itself
 * information, so joining them with a line asserts something true about what
 * happened in between.
 *
 * `category` is a set with no inherent order — campaigns, match types, ASINs.
 * Their left-to-right arrangement is an artefact of how the list was sorted,
 * so a line drawn across them asserts a trend that does not exist: reorder the
 * campaigns and the line changes shape while every number stays identical.
 * Hence `line` is refused on a category axis, and `point` exists instead.
 */
export const ChartXKindSchema = z.enum(['time', 'category']);
export type ChartXKind = z.infer<typeof ChartXKindSchema>;

/**
 * How a series is drawn.
 *
 * `point` is markers with no connecting path — the honest mark for a ratio
 * measured across unordered things. It reads as "here is each campaign's
 * ACOS", where a line would read as "ACOS moved from here to here".
 */
export const ChartRenderSchema = z.enum(['line', 'bar', 'point']);
export type ChartRender = z.infer<typeof ChartRenderSchema>;

export const ChartSeriesSchema = z.object({
  label: z.string().min(1).max(40),
  render: ChartRenderSchema,
  format: ChartValueFormatSchema,
  /**
   * Which axis to measure against. Defaults to left.
   *
   * There is no top-level chart "type" anywhere in this schema, and no
   * combo/dual flag: a chart of all-line series IS a line chart, and
   * spend-as-bars beside ACOS-as-points — the most useful ads chart there is —
   * needs no special case. One representation, so there is nothing for a
   * top-level type and a per-series override to disagree about.
   */
  axis: z.enum(['left', 'right']).optional(),
});
export type ChartSeries = z.infer<typeof ChartSeriesSchema>;

export const ChartPointSchema = z.object({
  /**
   * The x value, ALREADY formatted for display: "Jul 3", "Brand — Exact".
   *
   * Deliberately a string rather than a date or an id. The model knows whether
   * it is charting days, campaigns or match types; asking it to say so once,
   * in the form it wants read, beats a renderer guessing a date format from a
   * value that might not be a date at all.
   */
  label: z.string().min(1).max(40),
  /**
   * One value per series, IN SERIES ORDER. `null` means no data — never zero.
   *
   * Positional rather than keyed by series name: it halves the payload, maps
   * straight onto the row-per-x shape the chart renderer wants, and makes a
   * miscounted point a validation error instead of a silently missing line.
   */
  values: z.array(z.number().finite().nullable()).min(1).max(CHART_MAX_SERIES),
});
export type ChartPoint = z.infer<typeof ChartPointSchema>;

export const ChartSpecSchema = z
  .object({
    title: z.string().min(1).max(80),
    /**
     * Required, and the honesty slot: the date window, the attribution window
     * behind any advertising figure, and any truncation, spelled out.
     *
     * Not optional, because the caption is where a chart stops overstating
     * itself. Ten campaigns out of 137 is a reasonable chart and a false one if
     * it does not say so, and an ACOS quoted without its attribution window is
     * a different claim rather than a rounder one — the same spend looks
     * several times healthier at 30 days than at 1.
     *
     * It has to describe the selection actually made, which is a stricter
     * requirement than it sounds: the first real chart drawn with this tool
     * captioned itself "top 12 of 31 campaigns by spend" while having also
     * dropped two of the largest spenders for being a different product line.
     * Nothing was wrong with the exclusion; the caption named a mechanical
     * rule nobody had followed, which is worse than no caption because it
     * invites the reader to trust it.
     */
    caption: z.string().min(1).max(200),
    /**
     * Required, because it cannot be inferred and getting it wrong is silent.
     * "Jul 3" and "Brand — Exact" are both strings; only the caller knows
     * whether the gap between two of them means anything.
     */
    xKind: ChartXKindSchema,
    xLabel: z.string().max(40).optional(),
    /** ISO 4217, from the advertiser profile — a CA profile reports in CAD. */
    currencyCode: z.string().length(3).optional(),
    series: z.array(ChartSeriesSchema).min(1).max(CHART_MAX_SERIES),
    /** Two points minimum: one point is a number, and a number is not a chart. */
    points: z.array(ChartPointSchema).min(2).max(CHART_MAX_POINTS),
  })
  .superRefine((spec, ctx) => {
    spec.points.forEach((point, index) => {
      if (point.values.length !== spec.series.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['points', index, 'values'],
          message:
            `Point "${point.label}" has ${point.values.length} values but ` +
            `there are ${spec.series.length} series. Every point needs one ` +
            'value per series, in series order; use null where there is no data.',
        });
      }
    });

    if (spec.xKind === 'category') {
      spec.series.forEach((series, index) => {
        if (series.render === 'line') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['series', index, 'render'],
            message:
              `Series "${series.label}" is a line on a category axis. A line ` +
              'asserts movement between neighbours, and categories have no ' +
              'inherent order — sort them differently and the line changes ' +
              'shape while every number stays the same. Use "point" for a ' +
              'ratio measured per category, or "bar" for a quantity.',
          });
        }
      });
    }

    if (
      spec.series.some((series) => series.format === 'currency') &&
      !spec.currencyCode
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currencyCode'],
        message:
          'A currency series needs currencyCode (ISO 4217) — the advertiser ' +
          "profile's own currency, since a bare $ in front of CAD is wrong.",
      });
    }

    for (const axis of ['left', 'right'] as const) {
      const formats = new Set(
        spec.series
          .filter((series) => (series.axis ?? 'left') === axis)
          .map((series) => series.format)
      );
      if (formats.size > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['series'],
          message:
            `The ${axis} axis mixes ${[...formats].join(' and ')}. One axis ` +
            'can carry one unit: put the second unit on the other axis, or ' +
            'split into two charts. Percentages plotted against dollars ' +
            'flatten into the axis line.',
        });
      }
    }

    spec.series.forEach((series, index) => {
      const everyValueMissing = spec.points.every(
        (point) => point.values[index] == null
      );
      if (everyValueMissing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['series', index],
          message:
            `Series "${series.label}" is null at every point — it would draw ` +
            'an empty legend entry. Drop the series, or fill in its values.',
        });
      }
    });
  });

export type ChartSpec = z.infer<typeof ChartSpecSchema>;
