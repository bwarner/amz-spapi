'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Boxes,
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Receipt,
  Trash2,
} from 'lucide-react';
import { DocumentRoleSchema, type DocumentRole } from '@farvisionllc/models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { DocumentPalette } from './document-palette';

/**
 * What has been imported, what it became, and what belongs with what.
 *
 * The Import page is a conveyor belt — it reports on the files going past and
 * forgets them on reload. This is the record: every file still held, the rows
 * and figures each one produced, and the purchases their documents group into.
 * It is also the only place a file can be removed, which is why deletion here
 * shows its consequences before it happens rather than after.
 */

type Produced =
  | {
      kind: 'report-rows';
      importId: string;
      reportKind: string;
      label: string;
      rowsNew: number;
      rowsParsed: number;
      observedFrom?: string;
      observedTo?: string;
      unmappedHeaders?: string[];
    }
  | {
      kind: 'purchase-document';
      documentId: string;
      role: DocumentRole;
      roleSource: string;
      vendorName?: string;
      documentDate?: string;
      currency?: string;
      total?: number;
      needsReview: boolean;
      purchaseId?: string;
    }
  | {
      kind: 'box-labels';
      shipmentId: string;
      boxes: number;
      units: number;
      destinationFc?: string;
    };

type FileEntry = {
  id: string;
  nameUnknown?: boolean;
  assetId?: string;
  importId?: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  uploadedAt: number;
  produced: Produced[];
};

type PurchaseView = {
  purchaseId: string;
  fileIds: string[];
  vendorName?: string;
  documentDate?: string;
  currency?: string;
  total?: number;
  joins: string[];
  confirmed: boolean;
};

type SuggestionView = {
  fileIds: string[];
  documentIds: string[];
  reason: string;
};

type DocumentCenter = {
  files: FileEntry[];
  purchases: PurchaseView[];
  suggestions: SuggestionView[];
  sellerStatus: 'connected' | 'not-connected' | 'unavailable';
};

const ROLE_LABELS: Record<DocumentRole, string> = {
  'commercial-invoice': 'Commercial invoice',
  proforma: 'Proforma / quote',
  'payment-record': 'Payment record',
  'customs-declaration': 'Customs declaration',
  'freight-invoice': 'Freight invoice',
  'transport-document': 'Transport document',
  'proof-of-delivery': 'Proof of delivery',
  'packing-list': 'Packing list',
  'purchase-order': 'Purchase order',
  other: 'Other',
};

/** Which filter a file answers to. A file can satisfy more than one. */
type Filter = 'all' | 'reports' | 'purchase' | 'labels' | 'other';

function matchesFilter(file: FileEntry, filter: Filter): boolean {
  if (filter === 'all') return true;
  const kinds = new Set(file.produced.map((item) => item.kind));
  if (filter === 'reports') return kinds.has('report-rows');
  if (filter === 'purchase') return kinds.has('purchase-document');
  if (filter === 'labels') return kinds.has('box-labels');
  // "Other" is the residue — stored, classified as nothing in particular, and
  // the group most likely to be worth deleting.
  return kinds.size === 0;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDay(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatMoney(amount?: number, currency?: string): string | undefined {
  if (typeof amount !== 'number') return undefined;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  } catch {
    // An unrecognised currency code must not blank the figure out.
    return `${amount.toFixed(2)} ${currency ?? ''}`.trim();
  }
}

function FileIcon({ file }: { file: FileEntry }) {
  const kinds = new Set(file.produced.map((item) => item.kind));
  const className = 'h-4 w-4 shrink-0 text-muted-foreground';
  if (kinds.has('report-rows'))
    return <FileSpreadsheet className={className} />;
  if (kinds.has('box-labels')) return <Boxes className={className} />;
  if (kinds.has('purchase-document')) return <Receipt className={className} />;
  if (file.mimeType?.startsWith('image/'))
    return <ImageIcon className={className} />;
  return <FileText className={className} />;
}

export default function DocumentsPage() {
  const [view, setView] = useState<DocumentCenter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<FileEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * The file ⌘K jumped to. Cleared on the next interaction rather than after a
   * timer: a highlight that vanishes on its own leaves the seller looking for
   * the row they just chose.
   */
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/documents');
    const payload = await response
      .json()
      .catch(() => ({ error: `Server error (HTTP ${response.status}).` }));
    if (!response.ok) {
      setError(payload.error ?? 'Could not load your documents.');
      setView({
        files: [],
        purchases: [],
        suggestions: [],
        sellerStatus: 'not-connected',
      });
      return;
    }
    setError(null);
    setView(payload as DocumentCenter);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filesById = useMemo(() => {
    const map = new Map<string, FileEntry>();
    for (const file of view?.files ?? []) map.set(file.id, file);
    return map;
  }, [view]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (view?.files ?? []).filter((file) => {
      if (!matchesFilter(file, filter)) return false;
      if (!needle) return true;
      // Searching the vendor as well as the file name: half these files are
      // named `invoice-2.pdf` and the supplier is the only thing anyone
      // remembers about them.
      const vendor = file.produced
        .map((item) =>
          item.kind === 'purchase-document' ? item.vendorName : ''
        )
        .join(' ');
      return `${file.fileName} ${vendor}`.toLowerCase().includes(needle);
    });
  }, [view, filter, query]);

  const remove = useCallback(
    async (file: FileEntry) => {
      setBusy(file.id);
      try {
        const response = await fetch(
          `/api/documents/files/${encodeURIComponent(file.id)}`,
          { method: 'DELETE' }
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setError(payload.error ?? 'Could not delete that file.');
          return;
        }
        // Reload rather than splicing: deleting a file can dissolve a purchase
        // group and revive a suggestion, and guessing at that in the client is
        // how a screen ends up disagreeing with the data.
        await load();
      } finally {
        setBusy(null);
        setPending(null);
      }
    },
    [load]
  );

  const changeRole = useCallback(
    async (documentId: string, role: DocumentRole) => {
      setBusy(documentId);
      try {
        const response = await fetch('/api/documents/role', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId, role }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setError(payload.error ?? 'Could not change that role.');
          return;
        }
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const confirmPurchase = useCallback(
    async (documentIds: string[]) => {
      setBusy(documentIds.join(','));
      try {
        const response = await fetch('/api/documents/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentIds }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setError(payload.error ?? 'Could not group those documents.');
          return;
        }
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const jumpToFile = useCallback((fileId: string) => {
    // Clear the filters first: the chosen file may not be in the current facet,
    // and scrolling to a row that is filtered out looks like nothing happened.
    setFilter('all');
    setQuery('');
    setHighlighted(fileId);
    // After the state above has rendered the row, not before.
    requestAnimationFrame(() => {
      document
        .getElementById(`file-${fileId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every file you have imported, what it became, and what belongs with
            what.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {view?.files.length ? (
            <DocumentPalette files={view.files} onSelectFile={jumpToFile} />
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href="/import">Import files</Link>
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {view?.sellerStatus === 'not-connected' ? (
        <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
          No Amazon account is connected, so imported report rows and box labels
          cannot be listed — they belong to a seller account rather than to you.
          Stored files are all shown.{' '}
          <Link href="/connections" className="underline">
            Connect an account
          </Link>
          .
        </p>
      ) : null}

      {/* Said differently from "not connected" on purpose: this list is
          INCOMPLETE and we cannot say by how much, which is worth knowing
          before concluding that a file was never imported. */}
      {view?.sellerStatus === 'unavailable' ? (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Your Amazon connection could not be read just now, so report rows and
          box labels are missing from this list. Stored files are all shown.
        </p>
      ) : null}

      {view === null ? (
        <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : null}

      {view?.purchases.length ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Purchases
          </h2>
          <div className="mt-3 space-y-3">
            {view.purchases.map((purchase) => (
              <PurchaseCard
                key={purchase.purchaseId}
                purchase={purchase}
                filesById={filesById}
              />
            ))}
          </div>
        </section>
      ) : null}

      {view?.suggestions.length ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Might be one purchase
          </h2>
          <div className="mt-3 space-y-3">
            {view.suggestions.map((suggestion) => (
              <div
                key={suggestion.documentIds.join('|')}
                className="rounded-lg border border-dashed p-4"
              >
                <p className="text-sm">{suggestion.reason}</p>
                <ul className="mt-2 space-y-1">
                  {suggestion.fileIds.map((fileId) => (
                    <li key={fileId} className="text-sm text-muted-foreground">
                      {filesById.get(fileId)?.fileName ?? fileId}
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  disabled={busy === suggestion.documentIds.join(',')}
                  onClick={() => confirmPurchase(suggestion.documentIds)}
                >
                  <Link2 className="mr-1.5 h-3.5 w-3.5" />
                  These are one purchase
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {view?.files.length ? (
        <section className="mt-8">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Files ({view.files.length})
            </h2>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or supplier"
              className="h-8 w-full sm:w-56"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-1">
            {(
              [
                ['all', 'All'],
                ['reports', 'Reports'],
                ['purchase', 'Invoices & receipts'],
                ['labels', 'Box labels'],
                ['other', 'Everything else'],
              ] as Array<[Filter, string]>
            ).map(([value, label]) => {
              // Counted from the whole library, not the visible rows, so the
              // number does not change as the seller types in the box above.
              const count = (view?.files ?? []).filter((file) =>
                matchesFilter(file, value)
              ).length;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  disabled={count === 0 && value !== 'all'}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    filter === value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                    count === 0 && value !== 'all' && 'opacity-40'
                  )}
                >
                  {label}
                  <span className="ml-1.5 tabular-nums opacity-70">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-2">
            {visible.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                highlighted={highlighted === file.id}
                busy={busy}
                onDelete={() => setPending(file)}
                onRoleChange={changeRole}
              />
            ))}
            {!visible.length ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Nothing matches that.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {view && !view.files.length && !error ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">Nothing imported yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop Amazon report exports, supplier invoices, receipts or box
            labels on the Import page and they will be listed here.
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link href="/import">Import files</Link>
          </Button>
        </div>
      ) : null}

      <DeleteDialog
        file={pending}
        busy={busy === pending?.id}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && remove(pending)}
      />
    </div>
  );
}

function PurchaseCard({
  purchase,
  filesById,
}: {
  purchase: PurchaseView;
  filesById: Map<string, FileEntry>;
}) {
  const total = formatMoney(purchase.total, purchase.currency);
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-medium">
          {purchase.vendorName ?? 'Unnamed supplier'}
        </span>
        {purchase.documentDate ? (
          <span className="text-sm text-muted-foreground">
            {purchase.documentDate}
          </span>
        ) : null}
        {total ? (
          <span className="ml-auto text-sm font-medium">{total}</span>
        ) : null}
      </div>

      <ul className="mt-2 space-y-1">
        {purchase.fileIds.map((fileId) => (
          <li key={fileId} className="truncate text-sm text-muted-foreground">
            {filesById.get(fileId)?.fileName ?? fileId}
          </li>
        ))}
      </ul>

      {/* Why these were joined. A group whose only explanation is "we think so"
          is one nobody can correct. */}
      {purchase.joins.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Joined by {purchase.joins.join('; ')}
        </p>
      ) : purchase.confirmed ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Grouped by you, rather than by a shared reference.
        </p>
      ) : null}
    </div>
  );
}

function FileRow({
  file,
  busy,
  highlighted,
  onDelete,
  onRoleChange,
}: {
  file: FileEntry;
  highlighted?: boolean;
  busy: string | null;
  onDelete: () => void;
  onRoleChange: (documentId: string, role: DocumentRole) => void;
}) {
  const document = file.produced.find(
    (item): item is Extract<Produced, { kind: 'purchase-document' }> =>
      item.kind === 'purchase-document'
  );

  return (
    <div
      id={`file-${file.id}`}
      className={cn(
        'rounded-lg border p-4 transition-colors',
        highlighted && 'border-primary bg-primary/5'
      )}
    >
      <div className="flex items-center gap-2">
        <FileIcon file={file} />
        {/* A file stored before names were kept has no name to show. Italic and
            muted, so it does not read as a file actually called that. */}
        <span
          className={cn(
            'truncate text-sm font-medium',
            file.nameUnknown && 'italic text-muted-foreground'
          )}
        >
          {file.fileName}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {formatDay(file.uploadedAt)}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {file.sizeBytes ? <span>{formatBytes(file.sizeBytes)}</span> : null}
        {file.mimeType ? <span>{file.mimeType}</span> : null}
        {/* An ingested report with no stored bytes: say so, because the
            missing Download button otherwise looks like a fault. */}
        {!file.assetId ? <span>rows only — file not kept</span> : null}
      </div>

      {file.produced.length ? (
        <ul className="mt-3 space-y-1.5">
          {file.produced.map((item, index) => (
            <li key={index} className="text-sm">
              <ProducedLine item={item} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Stored, but nothing was read from it.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {file.assetId ? (
          <Button asChild size="sm" variant="outline">
            <a href={`/api/a-plus/assets/${file.assetId}`} download>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download
            </a>
          </Button>
        ) : null}

        {document ? (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Filed as
            <select
              value={document.role}
              disabled={busy === document.documentId}
              onChange={(event) =>
                onRoleChange(
                  document.documentId,
                  event.target.value as DocumentRole
                )
              }
              className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
            >
              {DocumentRoleSchema.options.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-muted-foreground hover:text-destructive"
          disabled={busy === file.id}
          onClick={onDelete}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </div>
  );
}

function ProducedLine({ item }: { item: Produced }) {
  if (item.kind === 'report-rows') {
    return (
      <span>
        <span className="font-medium">{item.label}</span>
        <span className="text-muted-foreground">
          {/* What the FILE holds, not what this import added. A re-import of an
              overlapping range records rowsNew: 0 — true, and not what anyone
              means by "how big is this file". */}
          {' — '}
          {item.rowsParsed.toLocaleString()} rows
          {item.observedFrom && item.observedTo
            ? `, ${item.observedFrom} → ${item.observedTo}`
            : ''}
          {item.rowsNew === 0 && item.rowsParsed > 0
            ? ' (all already held when imported)'
            : ''}
        </span>
        {item.unmappedHeaders?.length ? (
          <span className="block text-xs text-amber-700">
            Columns not recognised: {item.unmappedHeaders.join(', ')}
          </span>
        ) : null}
      </span>
    );
  }

  if (item.kind === 'box-labels') {
    return (
      <span>
        <span className="font-medium">Shipment {item.shipmentId}</span>
        <span className="text-muted-foreground">
          {` — ${item.boxes} ${item.boxes === 1 ? 'box' : 'boxes'}, ${
            item.units
          } units`}
          {item.destinationFc ? ` to ${item.destinationFc}` : ''}
        </span>
      </span>
    );
  }

  const total = formatMoney(item.total, item.currency);
  return (
    <span>
      <span className="font-medium">{ROLE_LABELS[item.role]}</span>
      <span className="text-muted-foreground">
        {item.vendorName ? ` — ${item.vendorName}` : ''}
        {item.documentDate ? `, ${item.documentDate}` : ''}
        {total ? `, ${total}` : ''}
      </span>
      {item.needsReview ? (
        <span className="block text-xs text-amber-700">
          Needs a look before these figures are used as cost.
        </span>
      ) : null}
    </span>
  );
}

/**
 * Confirm a delete by naming what goes with it.
 *
 * The cascade is listed from the same `produced` entries the row displays, so
 * what the seller was just looking at is what the dialog itemises — no second
 * request, and nothing the screen did not already show them.
 */
function DeleteDialog({
  file,
  busy,
  onCancel,
  onConfirm,
}: {
  file: FileEntry | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // The only number here that is not already on screen: how many stored rows
  // still carry this import's id. See the impact route for why neither figure
  // on the import record can answer it.
  const [rows, setRows] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      setRows(undefined);
      return;
    }
    const hasRows = file.produced.some((item) => item.kind === 'report-rows');
    if (!hasRows) {
      setRows(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const query = file.importId
        ? `?importId=${encodeURIComponent(file.importId)}`
        : '';
      const response = await fetch(
        `/api/documents/files/${encodeURIComponent(file.id)}/impact${query}`
      );
      const payload = await response.json().catch(() => ({ reportRows: null }));
      if (!cancelled) setRows(payload.reportRows);
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const consequences = (file?.produced ?? []).map((item) => {
    if (item.kind === 'report-rows') {
      const window =
        item.observedFrom && item.observedTo
          ? `, covering ${item.observedFrom} → ${item.observedTo}`
          : '';
      if (rows === undefined) return `${item.label} rows — counting…`;
      if (rows === null) return `${item.label} rows${window}`;
      // Zero is worth saying out loud rather than hiding: it means an earlier
      // import of the same range holds these rows, and deleting this one will
      // not free them.
      return rows === 0
        ? `no rows — an earlier import of ${item.label.toLowerCase()} holds them`
        : `${rows.toLocaleString()} ${item.label} rows${window}`;
    }
    if (item.kind === 'box-labels') {
      return `the shipped record for ${item.shipmentId} — ${item.boxes} ${
        item.boxes === 1 ? 'box' : 'boxes'
      }, ${item.units} units`;
    }
    const total = formatMoney(item.total, item.currency);
    return `the extracted ${ROLE_LABELS[item.role].toLowerCase()}${
      item.vendorName ? ` from ${item.vendorName}` : ''
    }${total ? ` (${total})` : ''}`;
  });

  return (
    <AlertDialog
      open={Boolean(file)}
      onOpenChange={(open) => !open && onCancel()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {file?.fileName}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {consequences.length ? (
                <>
                  <p>This also removes:</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {consequences.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <p className="mt-3">
                    Anything computed from them — coverage, margins,
                    reconciliation — changes accordingly. Importing the file
                    again restores it.
                  </p>
                </>
              ) : (
                <p>
                  Nothing was read from this file, so only the file itself goes.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              // Kept open while the request runs, so the row cannot be clicked
              // twice and the spinner is where the eye already is.
              event.preventDefault();
              onConfirm();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            Delete everything
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
