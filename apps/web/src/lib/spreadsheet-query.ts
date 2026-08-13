/**
 * Filter, group and total an attached spreadsheet — server-side, so the model
 * gets answers, not rows.
 *
 * The chat preview shows 50 rows of a file that may hold thousands; totalling
 * a preview is wrong and attaching the whole sheet is a six-figure-token turn
 * (#133). This is the third way: the model states a small query, the whole
 * sheet is computed over here, and only the result enters the context.
 *
 * Everything is strings until an operation needs a number. Amazon exports
 * format money as "$6.60", counts as "1,600" and rates as "12.00%", so
 * numeric comparison and aggregation strip that formatting; equality and
 * `contains` compare the text as it appears in the file.
 */

export class SpreadsheetQueryError extends Error {}

export type WhereOp = 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';

export type SpreadsheetQuery = {
  where?: Array<{ column: string; op: WhereOp; value: string }>;
  groupBy?: string[];
  aggregate?: Array<{
    column?: string;
    fn: 'sum' | 'avg' | 'min' | 'max' | 'count';
  }>;
  /** Projection for row listings; ignored when aggregating. */
  columns?: string[];
  limit?: number;
};

export type SpreadsheetQueryResult = {
  columns: string[];
  rows: Array<Array<string | number>>;
  /** Rows that passed the filter, before any limit. */
  matchedRows: number;
  totalRows: number;
  truncated: boolean;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** "$6.60" → 6.6, "1,600" → 1600, "12.00%" → 12. NaN when not a number. */
export function cellNumber(value: string): number {
  const cleaned = value.replace(/[$€£¥,%\s]/g, '');
  if (!cleaned) return NaN;
  return Number(cleaned);
}

function resolveColumn(headers: string[], name: string): number {
  const wanted = name.trim().toLowerCase();
  const index = headers.findIndex(
    (header) => header.trim().toLowerCase() === wanted
  );
  if (index === -1) {
    throw new SpreadsheetQueryError(
      `No column "${name}" in this sheet. The columns are: ` +
        headers.map((header) => `"${header}"`).join(', ')
    );
  }
  return index;
}

function matches(
  row: string[],
  clause: { index: number; op: WhereOp; value: string }
): boolean {
  const cell = row[clause.index] ?? '';
  switch (clause.op) {
    case 'eq':
      return cell.trim().toLowerCase() === clause.value.trim().toLowerCase();
    case 'neq':
      return cell.trim().toLowerCase() !== clause.value.trim().toLowerCase();
    case 'contains':
      return cell.toLowerCase().includes(clause.value.toLowerCase());
    default: {
      const left = cellNumber(cell);
      const right = cellNumber(clause.value);
      if (Number.isNaN(left) || Number.isNaN(right)) return false;
      if (clause.op === 'gt') return left > right;
      if (clause.op === 'gte') return left >= right;
      if (clause.op === 'lt') return left < right;
      return left <= right;
    }
  }
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

export function querySheet(
  table: { headers: string[]; rows: string[][] },
  query: SpreadsheetQuery
): SpreadsheetQueryResult {
  const { headers, rows } = table;
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const clauses = (query.where ?? []).map((clause) => ({
    index: resolveColumn(headers, clause.column),
    op: clause.op,
    value: clause.value,
  }));
  const filtered = rows.filter((row) =>
    clauses.every((clause) => matches(row, clause))
  );

  if (query.aggregate?.length) {
    const groupIndexes = (query.groupBy ?? []).map((name) =>
      resolveColumn(headers, name)
    );
    const aggregates = query.aggregate.map((aggregate) => ({
      ...aggregate,
      index:
        aggregate.fn === 'count' && !aggregate.column
          ? -1
          : resolveColumn(headers, aggregate.column ?? ''),
    }));

    const groups = new Map<string, { key: string[]; rows: string[][] }>();
    for (const row of filtered) {
      const key = groupIndexes.map((index) => row[index] ?? '');
      const id = JSON.stringify(key);
      const group = groups.get(id);
      if (group) group.rows.push(row);
      else groups.set(id, { key, rows: [row] });
    }

    const columns = [
      ...groupIndexes.map((index) => headers[index]),
      ...aggregates.map(
        (aggregate) =>
          `${aggregate.fn}(${
            aggregate.index === -1 ? '*' : headers[aggregate.index]
          })`
      ),
    ];
    const resultRows = [...groups.values()].map((group) => [
      ...group.key,
      ...aggregates.map((aggregate) => {
        if (aggregate.fn === 'count') {
          return aggregate.index === -1
            ? group.rows.length
            : group.rows.filter((row) => (row[aggregate.index] ?? '').trim())
                .length;
        }
        const values = group.rows
          .map((row) => cellNumber(row[aggregate.index] ?? ''))
          .filter((value) => !Number.isNaN(value));
        if (!values.length) return NaN;
        if (aggregate.fn === 'sum')
          return round(values.reduce((sum, value) => sum + value, 0));
        if (aggregate.fn === 'avg')
          return round(
            values.reduce((sum, value) => sum + value, 0) / values.length
          );
        if (aggregate.fn === 'min') return round(Math.min(...values));
        return round(Math.max(...values));
      }),
    ]);

    // Sort by the first aggregate, descending — "biggest first" is what every
    // spend/sales question wants, and a stable default beats map order.
    const firstAggregate = groupIndexes.length;
    resultRows.sort((a, b) => {
      const left = a[firstAggregate];
      const right = b[firstAggregate];
      return (
        (typeof right === 'number' && !Number.isNaN(right)
          ? right
          : -Infinity) -
        (typeof left === 'number' && !Number.isNaN(left) ? left : -Infinity)
      );
    });

    return {
      columns,
      // NaN survives to here only when a group had no readable number; say ''
      // rather than serialising NaN to null and reading as a zero-ish value.
      rows: resultRows
        .slice(0, limit)
        .map((row) =>
          row.map((cell) =>
            typeof cell === 'number' && Number.isNaN(cell) ? '' : cell
          )
        ),
      matchedRows: filtered.length,
      totalRows: rows.length,
      truncated: resultRows.length > limit,
    };
  }

  // Row listing: project the named columns (or all of them).
  const projection = query.columns?.length
    ? query.columns.map((name) => resolveColumn(headers, name))
    : headers.map((_, index) => index);

  return {
    columns: projection.map((index) => headers[index]),
    rows: filtered
      .slice(0, limit)
      .map((row) => projection.map((index) => row[index] ?? '')),
    matchedRows: filtered.length,
    totalRows: rows.length,
    truncated: filtered.length > limit,
  };
}
