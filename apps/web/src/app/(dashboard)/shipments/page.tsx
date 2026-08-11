'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Every inbound shipment wants six documents. This shows which are missing.
 *
 * Design page 04. The Reconcile page compares quantities; this compares
 * PAPERWORK, because a reimbursement claim is exactly as strong as its
 * thinnest document, and the time to notice a missing proof of delivery is
 * before the claim window closes, not while writing the claim.
 *
 * Two slots fill themselves (box labels carry the shipment id; the ledger
 * joins receipts to it). The other four are attached here by a human, and
 * clicking an empty slot is the attach flow — the paperwork lives in the
 * Library, so attaching is pointing, not uploading.
 */

type SlotKey = 'po' | 'invoice' | 'packingList' | 'box' | 'pod' | 'ledger';

type Slot = {
  key: SlotKey;
  label: string;
  present: boolean;
  assetId?: string;
  poNumber?: string;
  fileName?: string;
  disputed?: boolean;
  note?: string;
};

type ShipmentEntry = {
  shipmentId: string;
  vendorName?: string;
  destinationFc?: string;
  from?: string;
  to?: string;
  slots: Slot[];
  presentCount: number;
  headline?: string;
  value?: number;
  valueCurrency?: string;
  valueSource?: 'invoice' | 'po';
  discrepancies: number;
};

type PoCandidate = {
  poNumber: string;
  vendorName: string;
  issueDate: string;
  total: number;
  currency: string;
  shipmentIds: string[];
};

type ShipmentCenter = {
  shipments: ShipmentEntry[];
  sellerStatus: 'connected' | 'not-connected' | 'unavailable';
  orders: PoCandidate[];
};

/** A library document that could fill a confirmed slot. */
type Candidate = {
  assetId: string;
  fileName: string;
  role: string;
  vendorName?: string;
  documentDate?: string;
  total?: number;
  currency?: string;
};

/** Which roles can answer which slot — the attach dialog offers only these. */
const ROLES_FOR_SLOT: Partial<Record<SlotKey, string[]>> = {
  po: ['purchase-order'],
  invoice: ['commercial-invoice'],
  packingList: ['packing-list'],
  pod: ['proof-of-delivery'],
};

const SLOT_NAMES: Record<SlotKey, string> = {
  po: 'purchase order',
  invoice: 'invoice',
  packingList: 'packing list',
  box: 'box labels',
  pod: 'proof of delivery',
  ledger: 'ledger receipts',
};

function money(amount?: number, currency?: string): string | undefined {
  if (typeof amount !== 'number') return undefined;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ''}`.trim();
  }
}

export default function ShipmentsPage() {
  const [view, setView] = useState<ShipmentCenter | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'incomplete' | 'all'>('incomplete');
  const [attach, setAttach] = useState<{
    shipmentId: string;
    slot: SlotKey;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [shipmentsResponse, documentsResponse] = await Promise.all([
      fetch('/api/shipments'),
      fetch('/api/documents'),
    ]);
    const payload = await shipmentsResponse.json().catch(() => ({
      error: `Server error (HTTP ${shipmentsResponse.status}).`,
    }));
    if (!shipmentsResponse.ok) {
      setError(payload.error ?? 'Could not load your shipments.');
      setView({ shipments: [], sellerStatus: 'not-connected', orders: [] });
      return;
    }
    setError(null);
    setView(payload as ShipmentCenter);

    // The attach dialog's menu: every extracted document in the library, with
    // its role. Loaded alongside rather than on demand so opening the dialog
    // is instant — the list is the same tens of documents either way.
    const documents = await documentsResponse.json().catch(() => null);
    if (documents?.files) {
      setCandidates(
        (
          documents.files as Array<{
            assetId?: string;
            fileName: string;
            produced: Array<Record<string, unknown>>;
          }>
        )
          .flatMap((file) =>
            file.produced
              .filter((item) => item['kind'] === 'purchase-document')
              .map((item) => ({
                assetId: file.assetId as string,
                fileName: file.fileName,
                role: item['role'] as string,
                vendorName: item['vendorName'] as string | undefined,
                documentDate: item['documentDate'] as string | undefined,
                total: item['total'] as number | undefined,
                currency: item['currency'] as string | undefined,
              }))
          )
          .filter((candidate) => candidate.assetId)
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setLink = useCallback(
    async (
      target: { assetId?: string; poNumber?: string },
      shipmentId: string,
      attached: boolean
    ) => {
      const busyKey = target.assetId ?? target.poNumber ?? '';
      setBusy(busyKey);
      try {
        const response = await fetch('/api/shipments/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...target, shipmentId, attached }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setError(payload.error ?? 'Could not update that link.');
          return;
        }
        setAttach(null);
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const shown = useMemo(() => {
    const all = view?.shipments ?? [];
    return tab === 'all' ? all : all.filter((entry) => entry.presentCount < 6);
  }, [view, tab]);

  const attachTargets = useMemo(() => {
    if (!attach) return [];
    const roles = ROLES_FOR_SLOT[attach.slot] ?? [];
    return candidates.filter((candidate) => roles.includes(candidate.role));
  }, [attach, candidates]);

  // Orders the app issued, offered first: they are the record the PDF was
  // printed from. Ones already on this shipment are omitted — offering an
  // attach that is already true reads as the previous click having failed.
  const poTargets = useMemo(() => {
    if (!attach) return [];
    return (view?.orders ?? []).filter(
      (po) => !po.shipmentIds.includes(attach.shipmentId)
    );
  }, [attach, view]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shipments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every inbound shipment wants six documents. Click an empty slot to
            attach one from your library.
          </p>
        </div>
        <div className="flex gap-1">
          {(
            [
              ['incomplete', 'Incomplete'],
              ['all', 'All'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                tab === value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {view?.sellerStatus === 'unavailable' ? (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Your Amazon connection could not be read just now, so box labels and
          ledger receipts are missing from these checklists.
        </p>
      ) : null}

      {view === null ? (
        <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {shown.map((entry) => (
          <ShipmentCard
            key={entry.shipmentId}
            entry={entry}
            onEmptySlot={(slot) =>
              setAttach({ shipmentId: entry.shipmentId, slot })
            }
            onDetach={(slot) =>
              (slot.assetId || slot.poNumber) &&
              setLink(
                slot.poNumber
                  ? { poNumber: slot.poNumber }
                  : { assetId: slot.assetId },
                entry.shipmentId,
                false
              )
            }
          />
        ))}
      </div>

      {view && !shown.length ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">
            {tab === 'incomplete' && view.shipments.length
              ? 'Every shipment is fully documented.'
              : 'No shipments yet'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {view.shipments.length
              ? 'Switch to All to see them.'
              : 'Shipments appear when box labels or ledger receipts mention them — import either on the Import page.'}
          </p>
        </div>
      ) : null}

      <Dialog
        open={Boolean(attach)}
        onOpenChange={(open) => !open && setAttach(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Attach a {attach ? SLOT_NAMES[attach.slot] : ''} to{' '}
              {attach?.shipmentId}
            </DialogTitle>
            <DialogDescription>
              Only documents filed under a matching role are offered — re-file a
              document in the Library if the one you want is not here.
            </DialogDescription>
          </DialogHeader>

          {attach?.slot === 'po' && poTargets.length ? (
            <ul className="space-y-2">
              {poTargets.map((po) => (
                <li key={po.poNumber}>
                  <button
                    type="button"
                    disabled={busy === po.poNumber}
                    onClick={() =>
                      attach &&
                      setLink(
                        { poNumber: po.poNumber },
                        attach.shipmentId,
                        true
                      )
                    }
                    className="w-full rounded-lg border p-3 text-left text-sm transition-colors hover:border-primary"
                  >
                    <span className="font-medium">
                      {po.poNumber} · {po.vendorName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      issued in Sellavant · {po.issueDate} ·{' '}
                      {money(po.total, po.currency)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {attachTargets.length ? (
            <ul className="space-y-2">
              {attachTargets.map((candidate) => (
                <li key={candidate.assetId}>
                  <button
                    type="button"
                    disabled={busy === candidate.assetId}
                    onClick={() =>
                      attach &&
                      setLink(
                        { assetId: candidate.assetId },
                        attach.shipmentId,
                        true
                      )
                    }
                    className="w-full rounded-lg border p-3 text-left text-sm transition-colors hover:border-primary"
                  >
                    <span className="font-medium">
                      {candidate.vendorName ?? candidate.fileName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {candidate.fileName}
                      {candidate.documentDate
                        ? ` · ${candidate.documentDate}`
                        : ''}
                      {money(candidate.total, candidate.currency)
                        ? ` · ${money(candidate.total, candidate.currency)}`
                        : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {!attachTargets.length &&
          !(attach?.slot === 'po' && poTargets.length) ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Nothing in the library is filed as a{' '}
              {attach ? SLOT_NAMES[attach.slot] : 'document'} yet.
              {attach?.slot === 'po'
                ? ' Create one on the Orders page, or import a PDF.'
                : ' Import it, or re-file an existing document under that role.'}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShipmentCard({
  entry,
  onEmptySlot,
  onDetach,
}: {
  entry: ShipmentEntry;
  onEmptySlot: (slot: SlotKey) => void;
  onDetach: (slot: Slot) => void;
}) {
  const value = money(entry.value, entry.valueCurrency);
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-sm font-semibold">
          {entry.shipmentId}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {entry.presentCount} of {entry.slots.length}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {entry.vendorName ?? 'Supplier not linked'}
        {entry.from ? ` · ${entry.from.slice(0, 10)}` : ''}
        {entry.to && entry.to !== entry.from
          ? ` → ${entry.to.slice(0, 10)}`
          : ''}
        {entry.destinationFc ? ` · ${entry.destinationFc}` : ''}
      </p>

      <div className="mt-3 flex gap-1.5">
        {entry.slots.map((slot) => {
          const confirmedSlot = slot.key in ROLES_FOR_SLOT;
          return (
            <button
              key={slot.key}
              type="button"
              title={
                slot.present
                  ? slot.fileName ?? slot.note ?? SLOT_NAMES[slot.key]
                  : `Missing ${SLOT_NAMES[slot.key]}${
                      confirmedSlot ? ' — click to attach' : ''
                    }`
              }
              // Derived slots are evidence, not opinions: nothing to click.
              disabled={!confirmedSlot}
              onClick={() =>
                confirmedSlot &&
                (slot.present ? onDetach(slot) : onEmptySlot(slot.key))
              }
              className={cn(
                'group relative flex-1 rounded border py-1.5 text-center text-[11px] font-medium',
                slot.present
                  ? slot.disputed
                    ? 'border-amber-400 bg-amber-50 text-amber-900'
                    : 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-dashed text-muted-foreground/60',
                confirmedSlot && 'cursor-pointer hover:border-primary'
              )}
            >
              {slot.label}
              {confirmedSlot && slot.present ? (
                <X className="absolute -right-1 -top-1 hidden h-3 w-3 rounded-full bg-background text-muted-foreground group-hover:block" />
              ) : null}
              {confirmedSlot && !slot.present ? (
                <Plus className="absolute -right-1 -top-1 hidden h-3 w-3 rounded-full bg-background text-muted-foreground group-hover:block" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span
          className={cn(
            'text-sm',
            entry.headline ? 'text-amber-800' : 'text-muted-foreground'
          )}
        >
          {entry.headline ?? 'Fully documented'}
        </span>
        {value ? (
          <span className="ml-auto text-sm font-semibold">
            {value}
            {/* A PO total is what was ORDERED, which routinely differs from
                what was billed — worth a word, not a footnote. */}
            {entry.valueSource === 'po' ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                (PO)
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      {entry.discrepancies > 0 ? (
        <Button asChild size="sm" variant="outline" className="mt-3">
          <Link href="/reconciliation">Reconcile</Link>
        </Button>
      ) : null}
    </div>
  );
}
