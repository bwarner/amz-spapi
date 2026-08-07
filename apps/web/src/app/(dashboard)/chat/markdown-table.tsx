'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cellClass, cellText, classifyCell } from './table-cells';

/**
 * Tables in an assistant answer.
 *
 * The agent writes ordinary markdown tables; everything wrong with how they
 * looked was here. Every cell was rendered `font-mono whitespace-nowrap`, which
 * #72 introduced for a good reason and applied too widely: a SKU or a tracking
 * number does have to read as one token, but a product name set in monospace
 * that can never wrap is what made a twenty-row listing table look unfinished,
 * run off the side, and swallow the conversation.
 *
 * So the rule is per CELL, not per table: identifiers keep the fixed pitch and
 * the no-wrap, figures are right-aligned and tabular so columns of money line
 * up on the decimal, and prose wraps like prose.
 */

/** How tall a table gets before it is collapsed behind a control. */
const COLLAPSED_MAX_HEIGHT = 320;

export function MarkdownTable({ children }: { children?: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  /**
   * Measured rather than counted from the rows.
   *
   * Row count is a poor proxy for height — four rows of wrapped product names
   * can be taller than a dozen rows of SKUs — and counting means reaching into
   * React children, which breaks the moment the markdown nests anything.
   */
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    setOverflows(element.scrollHeight > COLLAPSED_MAX_HEIGHT + 8);
  }, [children]);

  const collapsed = overflows && !expanded;

  return (
    // `not-prose` because this sits inside a `prose` block, and Tailwind
    // typography styles `td`/`th` itself — without the opt-out its padding and
    // borders win on specificity and none of the below applies.
    <div className="not-prose my-3 overflow-hidden rounded-lg border">
      <div
        ref={scroller}
        className="relative overflow-x-auto"
        style={
          collapsed
            ? { maxHeight: COLLAPSED_MAX_HEIGHT, overflowY: 'hidden' }
            : { maxHeight: expanded ? 'none' : undefined }
        }
      >
        <table className="w-full border-collapse text-sm [&_td]:px-3 [&_td]:py-1.5 [&_th]:px-3 [&_th]:py-2">
          {children}
        </table>
      </div>
      {overflows && (
        <div className="relative">
          {collapsed && (
            // Sits above the button so the cut-off row fades rather than
            // stopping mid-glyph, which reads as a rendering fault.
            <div className="pointer-events-none absolute -top-8 h-8 w-full bg-linear-to-t from-background to-transparent" />
          )}
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="flex w-full items-center justify-center gap-1 border-t bg-muted/30 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60"
          >
            {expanded ? 'Show less' : 'Show all rows'}
            <ChevronDown
              className={cn(
                'size-3.5 transition-transform',
                expanded && 'rotate-180'
              )}
            />
          </button>
        </div>
      )}
    </div>
  );
}

export function MarkdownTableHead({ children }: { children?: ReactNode }) {
  return (
    // Sticky so the column names survive scrolling a long result — the whole
    // point of a header on a table you have to scroll.
    <th className="sticky top-0 z-10 whitespace-nowrap border-b bg-muted/60 text-left align-bottom font-medium backdrop-blur-sm">
      {children}
    </th>
  );
}

export function MarkdownTableCell({ children }: { children?: ReactNode }) {
  return (
    <td
      className={cn('align-top', cellClass(classifyCell(cellText(children))))}
    >
      {children}
    </td>
  );
}

export function MarkdownTableRow({ children }: { children?: ReactNode }) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/40">{children}</tr>
  );
}
