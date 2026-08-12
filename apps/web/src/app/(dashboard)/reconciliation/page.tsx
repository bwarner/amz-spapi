'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Line = {
  sku?: string;
  fnsku?: string;
  shipped?: number;
  shippedIsFloor: boolean;
  receivedGross: number;
  reversed: number;
  receivedNet: number;
  discrepancy?: number;
  status: 'balanced' | 'over-received' | 'short' | 'shipped-unknown';
  fulfillmentCenters: string[];
  reversalWindowDays?: number;
  reversalEvents: number;
};

type Shipment = {
  shipmentId: string;
  firstReceiptDate?: string;
  lastReceiptDate?: string;
  lines: Line[];
  warnings: string[];
};

const STATUS_LABEL: Record<Line['status'], string> = {
  balanced: 'Balanced',
  'over-received': 'Over-received',
  short: 'Short',
  'shipped-unknown': 'Not checked',
};

const STATUS_STYLE: Record<Line['status'], string> = {
  balanced: 'text-emerald-700',
  'over-received': 'text-amber-700',
  short: 'text-red-700',
  'shipped-unknown': 'text-muted-foreground',
};

export default function ReconciliationPage() {
  const [shipments, setShipments] = useState<Shipment[] | null>(null);
  const [shippedSideAvailable, setShippedSideAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch('/api/reports/reconciliation');
      const payload = await response
        .json()
        .catch(() => ({ error: `Server error (HTTP ${response.status}).` }));
      if (cancelled) return;
      if (!response.ok) {
        setError(payload.error ?? 'Could not load reconciliation.');
        setShipments([]);
        return;
      }
      setShipments(payload.shipments ?? []);
      setShippedSideAvailable(Boolean(payload.shippedSideAvailable));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Inbound reconciliation</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        What Amazon recorded receiving against each inbound shipment, from the
        Inventory Ledger detail view. Only receipt events carry a shipment
        reference, so customer sales cannot be traced back to the shipment that
        supplied them.
      </p>

      {/* Say plainly that the comparison is one-sided, rather than letting a
          page full of "Not checked" imply everything reconciled. */}
      {!shippedSideAvailable && shipments?.length ? (
        <p className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No shipped quantities are held yet, so these figures show only what
          Amazon received. Import your FBA box labels to compare them against
          what you actually sent.
        </p>
      ) : null}

      {error ? (
        <p className="mt-6 text-sm text-amber-800">{error}</p>
      ) : shipments === null ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : shipments.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No inbound shipments found. Import an Inventory Ledger detail export
          on the Import page — the summary view carries no shipment references
          and cannot be reconciled.
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {shipments.map((shipment) => (
            <div
              key={shipment.shipmentId}
              className="rounded-lg border bg-card p-4"
            >
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-mono text-sm font-semibold">
                  {shipment.shipmentId}
                </h2>
                <span className="flex items-baseline gap-3 text-xs text-muted-foreground">
                  {shipment.firstReceiptDate} → {shipment.lastReceiptDate}
                  {/* The deep view adds the ordered and invoiced sides this
                      two-way table cannot show. */}
                  <Link
                    href={`/shipments/${shipment.shipmentId}/reconcile`}
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Open
                  </Link>
                </span>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="text-left">
                      <th className="pb-1 pr-3 font-normal">SKU</th>
                      <th className="pb-1 pr-3 text-right font-normal">
                        Shipped
                      </th>
                      <th className="pb-1 pr-3 text-right font-normal">
                        Received
                      </th>
                      <th className="pb-1 pr-3 text-right font-normal">
                        Reversed
                      </th>
                      <th className="pb-1 pr-3 text-right font-normal">Net</th>
                      <th className="pb-1 font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipment.lines.map((line) => (
                      <tr key={line.sku ?? line.fnsku} className="border-t">
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          {line.sku ?? line.fnsku}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {line.shipped ?? '—'}
                          {line.shippedIsFloor ? '+' : ''}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {line.receivedGross}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                          {line.reversed ? `−${line.reversed}` : '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums font-medium">
                          {line.receivedNet}
                        </td>
                        <td
                          className={`py-1.5 text-xs ${
                            STATUS_STYLE[line.status]
                          }`}
                        >
                          {STATUS_LABEL[line.status]}
                          {line.discrepancy
                            ? ` ${line.discrepancy > 0 ? '−' : '+'}${Math.abs(
                                line.discrepancy
                              )}`
                            : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Findings carry their reasoning, so a seller can take one
                  straight to a case without re-deriving it. */}
              {shipment.warnings.length ? (
                <ul className="mt-3 space-y-1 text-xs text-amber-700">
                  {shipment.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
