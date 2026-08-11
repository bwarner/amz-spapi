'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileText,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The packet, shown before it is downloaded.
 *
 * A reviewer-facing PDF should never be a surprise: this page is the cover
 * page's content as a screen — the claim, the contents, and the gaps — so the
 * seller sees exactly what they are about to hand to Amazon before a single
 * byte is assembled. The gaps section doubles as the to-do list that makes the
 * claim stronger: attach the missing POD and rebuild.
 */

type PacketItem = {
  key: string;
  label: string;
  role: string;
};

type PacketGap = { name: string; reason: string };

type ClaimLine = {
  sku: string;
  shipped: number;
  receivedNet: number;
  units: number;
  unitCost?: number;
  unitCostSource?: string;
  amount?: number;
};

type Plan = {
  shipmentId: string;
  vendorName?: string;
  currency?: string;
  items: PacketItem[];
  gaps: PacketGap[];
  claim: {
    lines: ClaimLine[];
    total?: number;
    unpriced?: string;
    compared: boolean;
  };
  window?: { from?: string; to?: string };
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

export default function PacketPage({
  params,
}: {
  params: Promise<{ shipmentId: string }>;
}) {
  const { shipmentId } = use(params);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/shipments/${encodeURIComponent(shipmentId)}/packet?plan=1`
    );
    const payload = await response
      .json()
      .catch(() => ({ error: `Server error (HTTP ${response.status}).` }));
    if (!response.ok) {
      setError(payload.error ?? 'Could not plan the packet.');
      return;
    }
    setError(null);
    setPlan(payload.plan as Plan);
  }, [shipmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !plan) {
    return (
      <Shell shipmentId={shipmentId}>
        <p className="mt-6 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      </Shell>
    );
  }

  if (!plan) {
    return (
      <Shell shipmentId={shipmentId}>
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Planning…
        </p>
      </Shell>
    );
  }

  const canBuild = plan.items.length > 0;

  return (
    <Shell shipmentId={shipmentId}>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Evidence packet
        </h1>
        <span className="font-mono text-sm text-muted-foreground">
          {plan.shipmentId}
        </span>
        {plan.vendorName ? (
          <span className="text-sm text-muted-foreground">
            {plan.vendorName}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything that proves this shipment's claim, in the order a case
        reviewer reads it — with every gap named on the cover rather than
        quietly left out.
      </p>

      <section className="mt-6 rounded-lg border p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          The claim
        </h2>
        {plan.claim.lines.length ? (
          <>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 font-medium">SKU</th>
                  <th className="py-1 text-right font-medium">Shipped</th>
                  <th className="py-1 text-right font-medium">Received</th>
                  <th className="py-1 text-right font-medium">Short</th>
                  <th className="py-1 text-right font-medium">Claim</th>
                </tr>
              </thead>
              <tbody>
                {plan.claim.lines.map((line) => (
                  <tr key={line.sku} className="border-t">
                    <td className="py-1.5 font-mono text-xs">{line.sku}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {line.shipped}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {line.receivedNet}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {line.units}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {money(line.amount, plan.currency)}
                      {line.unitCostSource ? (
                        <span className="block text-xs text-muted-foreground">
                          @ {money(line.unitCost, plan.currency)} ·{' '}
                          {line.unitCostSource}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {typeof plan.claim.total === 'number' ? (
              <p className="mt-2 text-right text-sm font-semibold">
                Total claimed: {money(plan.claim.total, plan.currency)}
              </p>
            ) : null}
            {plan.claim.unpriced ? (
              <p className="mt-2 text-xs text-amber-800">
                {plan.claim.unpriced}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {plan.claim.compared
              ? 'No shortfall to claim — shipped and received reconcile for every SKU. The packet still documents the shipment end to end.'
              : 'No shortfall is computed — the shipped or received side is missing, so no comparison was possible. The packet documents what exists and names the rest.'}
          </p>
        )}
      </section>

      <section className="mt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          What goes in
        </h2>
        <ul className="mt-2 space-y-1.5">
          {plan.items.map((item) => (
            <li key={item.key} className="flex items-center gap-2 text-sm">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>{item.label}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {item.role}
              </span>
            </li>
          ))}
          {!plan.items.length ? (
            <li className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Nothing is attached to this shipment yet — attach documents from
              the Shipments page first.
            </li>
          ) : null}
        </ul>
      </section>

      {plan.gaps.length ? (
        <section className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            Named on the cover as missing
          </h2>
          <ul className="mt-1 space-y-1">
            {plan.gaps.map((gap) => (
              <li key={gap.name} className="text-sm text-amber-900">
                {gap.name} — {gap.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800">
            A claim that states where it is thin reads as honest; one with a
            silent hole reads as hiding it. Attach what is missing and rebuild
            for a stronger packet.
          </p>
        </section>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <Button asChild disabled={!canBuild}>
          <a
            href={`/api/shipments/${encodeURIComponent(shipmentId)}/packet`}
            download
            className={cn(!canBuild && 'pointer-events-none opacity-50')}
          >
            <Download className="mr-1.5 h-4 w-4" />
            Download PDF
          </a>
        </Button>
        <span className="text-xs text-muted-foreground">
          One PDF: cover with the claim and sources, then each document in
          reading order.
        </span>
      </div>
    </Shell>
  );
}

function Shell({
  shipmentId,
  children,
}: {
  shipmentId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
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
