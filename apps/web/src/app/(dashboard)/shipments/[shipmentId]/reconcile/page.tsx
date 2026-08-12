'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FileCheck2,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Reconcile deep view — ordered, invoiced, shipped, received, side by side.
 *
 * The finding column is the point: it says WHICH relationship broke, because
 * "Short 45" goes to Amazon and "Invoiced 20 over the PO" goes to the
 * supplier, and a page that only said "discrepancy" would leave the seller to
 * re-derive whose problem it is. Whole-side absences live in the notes, said
 * once — not manufactured into a finding on every row.
 */

type Finding = {
  kind: string;
  text: string;
  amount?: number;
};

type DeepLine = {
  sku: string;
  supplierLine?: string;
  ordered?: number;
  invoiced?: number;
  shipped?: number;
  shippedIsFloor?: boolean;
  received?: number;
  findings: Finding[];
  compared: boolean;
};

type Source = { key: string; title: string; detail: string; href?: string };

type View = {
  shipmentId: string;
  vendorName?: string;
  currency?: string;
  orderedDate?: string;
  window?: { from?: string; to?: string };
  fulfillmentCenters: string[];
  sources: Source[];
  lines: DeepLine[];
  notes: string[];
  discrepancies: number;
  exposure?: number;
  canBuildPacket: boolean;
};

const FINDING_STYLE: Record<string, string> = {
  short: 'text-red-700',
  'over-received': 'text-amber-700',
  'shipped-vs-order': 'text-amber-700',
  'invoice-vs-order': 'text-amber-700',
  'no-invoice-line': 'text-amber-700',
  'no-order-line': 'text-amber-700',
  // Good news, distinctly coloured: money already paid, not another problem.
  reimbursed: 'text-emerald-700',
};

function money(amount?: number, currency?: string): string {
  if (typeof amount !== 'number') return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ''}`.trim();
  }
}

function quantity(value?: number, floor?: boolean): string {
  if (value === undefined) return '—';
  return `${value}${floor ? '+' : ''}`;
}

export default function ReconcileDeepPage({
  params,
}: {
  params: Promise<{ shipmentId: string }>;
}) {
  const { shipmentId } = use(params);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch(
        `/api/shipments/${encodeURIComponent(shipmentId)}/reconcile`
      );
      const payload = await response
        .json()
        .catch(() => ({ error: `Server error (HTTP ${response.status}).` }));
      if (cancelled) return;
      if (!response.ok) {
        setError(payload.error ?? 'Could not build the reconcile view.');
        return;
      }
      setView(payload.view as View);
    })();
    return () => {
      cancelled = true;
    };
  }, [shipmentId]);

  if (error) {
    return (
      <Shell>
        <p className="mt-6 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      </Shell>
    );
  }

  if (!view) {
    return (
      <Shell>
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Comparing…
        </p>
      </Shell>
    );
  }

  const headerBits = [
    view.orderedDate ? `ordered ${view.orderedDate}` : undefined,
    view.window?.from && view.window?.to
      ? `received ${view.window.from} → ${view.window.to}`
      : undefined,
    view.fulfillmentCenters.length
      ? view.fulfillmentCenters.join(', ')
      : undefined,
  ].filter(Boolean);

  return (
    <Shell>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          {view.shipmentId}
        </h1>
        {view.vendorName ? (
          <span className="text-sm text-muted-foreground">
            {view.vendorName}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {headerBits.join(' · ') || 'Ordered, invoiced, shipped, received'}
        </p>
        <p
          className={
            view.discrepancies
              ? 'text-sm font-medium text-amber-800'
              : 'text-sm text-muted-foreground'
          }
        >
          {view.discrepancies
            ? `${view.discrepancies} ${
                view.discrepancies === 1 ? 'discrepancy' : 'discrepancies'
              }${
                view.exposure !== undefined
                  ? ` · ${money(view.exposure, view.currency)} exposed`
                  : ''
              }`
            : 'No discrepancies'}
        </p>
      </div>

      {view.sources.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {view.sources.map((source) => (
            <div key={source.key} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {source.title}
                </span>
                {source.href ? (
                  <Link
                    href={source.href}
                    className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {source.detail}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {view.lines.length ? (
        <div className="mt-5 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b text-left">
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">Supplier line</th>
                <th className="px-3 py-2 text-right font-medium">Ordered</th>
                <th className="px-3 py-2 text-right font-medium">Invoiced</th>
                <th className="px-3 py-2 text-right font-medium">Shipped</th>
                <th className="px-3 py-2 text-right font-medium">Received</th>
                <th className="px-3 py-2 font-medium">Finding</th>
              </tr>
            </thead>
            <tbody>
              {view.lines.map((line) => (
                <tr key={line.sku} className="border-b last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{line.sku}</td>
                  <td className="max-w-48 truncate px-3 py-2 text-xs text-muted-foreground">
                    {line.supplierLine ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {quantity(line.ordered)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {quantity(line.invoiced)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {quantity(line.shipped, line.shippedIsFloor)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {quantity(line.received)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {line.findings.length ? (
                      line.findings.map((finding) => (
                        <span
                          key={`${finding.kind}:${finding.text}`}
                          className={`block ${
                            FINDING_STYLE[finding.kind] ?? 'text-amber-700'
                          }`}
                        >
                          {finding.text}
                          {finding.amount !== undefined
                            ? ` · ${money(finding.amount, view.currency)}`
                            : ''}
                        </span>
                      ))
                    ) : line.compared ? (
                      <span className="text-emerald-700">Balanced</span>
                    ) : (
                      <span className="text-muted-foreground">Not checked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-5 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Nothing to compare yet — no ledger rows, box labels, or purchase order
          lines reference this shipment.
        </p>
      )}

      {view.notes.length ? (
        <ul className="mt-4 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-4">
          {view.notes.map((note) => (
            <li key={note} className="text-sm text-amber-900">
              {note}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {view.canBuildPacket ? (
          <Button asChild>
            <Link href={`/shipments/${encodeURIComponent(shipmentId)}/packet`}>
              <FileCheck2 className="mr-1.5 h-4 w-4" />
              Build reimbursement packet
            </Link>
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          Packet = PO + invoice + box labels + ledger rows, as one PDF with the
          arithmetic attached.
        </span>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Link
        href="/shipments"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Shipments
      </Link>
      {children}
    </div>
  );
}
