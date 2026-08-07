import type { ReactNode } from 'react';

/**
 * How a single table cell should be typeset.
 *
 * Pure and separate from the component so the classification can be tested
 * against real Amazon values, which is where it earns its keep: get it wrong
 * one way and a SKU wraps mid-token, wrong the other way and a sentence is set
 * in monospace and cannot wrap at all. The second is what #72's blanket rule
 * did to every listing table.
 */

/**
 * Flatten a cell to text so it can be classified.
 *
 * Cells arrive as React children — a bare string, or wrapped in `<strong>` or
 * `<code>` when the model emphasises a value — so the text has to be gathered
 * rather than read off a prop.
 */
export function cellText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(cellText).join('');
  if (typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return cellText(props?.children);
  }
  return '';
}

/**
 * An Amazon identifier: ASIN, FNSKU, seller SKU, order id, tracking number.
 *
 * Deliberately conservative — upper case, no spaces, and long enough not to
 * catch "USD" or a status like "Active". What it misses is set as prose, which
 * is the safe direction to be wrong in: a wrapped SKU is untidy, a monospaced
 * unwrappable sentence is the fault being fixed.
 */
const IDENTIFIER = /^[A-Z0-9][A-Z0-9._/-]{5,}$/;

/** A figure, with or without currency, grouping, percent or sign. */
const NUMERIC = /^[-+]?[$£€]?\s?[\d,]+(\.\d+)?\s?%?$/;

export type CellKind = 'identifier' | 'numeric' | 'prose';

export function classifyCell(text: string): CellKind {
  const value = text.trim();
  if (!value) return 'prose';
  if (IDENTIFIER.test(value)) return 'identifier';
  // The digit check keeps a bare currency symbol or a stray "%" out.
  if (NUMERIC.test(value) && /\d/.test(value)) return 'numeric';
  return 'prose';
}

/** Tailwind for a cell of that kind. */
export function cellClass(kind: CellKind): string {
  if (kind === 'identifier') return 'whitespace-nowrap font-mono text-xs';
  // Tabular figures so a column of money lines up on the decimal point.
  if (kind === 'numeric') return 'whitespace-nowrap text-right tabular-nums';
  // A floor width stops a prose column being crushed to one word per line by a
  // neighbouring column that cannot wrap.
  return 'min-w-[12rem]';
}
