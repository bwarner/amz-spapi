/**
 * Output rendering for the admin CLI.
 *
 * Separate from `main.ts` because that module builds and runs the command tree
 * on import — importing it from a test would execute the CLI. This holds the
 * only logic here worth pinning, and holds it somewhere a test can reach.
 */

/**
 * One value, as a table cell.
 *
 * Timestamps are stored as epoch milliseconds throughout the identity
 * collections, and an operator reading `1786227194263` in a `joinedAt` column
 * learns nothing. Anything past the year 2001 in milliseconds is rendered as an
 * ISO date; the threshold is far enough below any real timestamp to be safe and
 * far enough above ordinary counts (member totals, invitation counts) not to
 * catch them.
 */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && value > 1_000_000_000_000) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * A fixed-width table, or `(none)` for an empty set.
 *
 * Columns are the union of every row's keys rather than the first row's, so a
 * record carrying an optional field — `acceptedAt` on one invitation and not
 * another — does not silently drop it.
 */
export function renderTable(value: unknown): string {
  const rows = (Array.isArray(value) ? value : [value]).filter(
    (row): row is Record<string, unknown> =>
      row !== null && typeof row === 'object'
  );
  if (rows.length === 0) return '(none)';

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => cell(row[column]).length))
  );

  const line = (cells: string[]) =>
    cells
      .map((text, index) => text.padEnd(widths[index]))
      .join('  ')
      .trimEnd();

  return [
    line(columns),
    line(widths.map((width) => '-'.repeat(width))),
    ...rows.map((row) => line(columns.map((column) => cell(row[column])))),
  ].join('\n');
}
