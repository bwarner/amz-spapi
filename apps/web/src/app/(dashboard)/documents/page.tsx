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
      issuedPoNumber?: string;
      shipmentIds?: string[];
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
    }
  | {
      kind: 'issued-po-render';
      poNumber: string;
      format: string;
      vendorName?: string;
      issueDate?: string;
      currency?: string;
      total?: number;
      shipmentIds?: string[];
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

/**
 * The library's row facts, derived once per file (design page 01: the list is
 * a TABLE — kind, vendor, date, total, linked-to, status — with facets over
 * the same fields, so both must come from one derivation or the sidebar
 * counts drift from the rows).
 */
type RowStatus = 'review' | 'matched' | 'parsed' | 'unlinked';

const STATUS_LABELS: Record<RowStatus, string> = {
  review: 'Needs review',
  matched: 'Matched',
  parsed: 'Parsed',
  unlinked: 'Unlinked',
};

const STATUS_STYLES: Record<RowStatus, string> = {
  review: 'text-amber-700',
  matched: 'text-emerald-700',
  parsed: 'text-foreground',
  unlinked: 'text-muted-foreground',
};

type DerivedRow = {
  kind: string;
  vendor?: string;
  /** The date ON the document where one was read; else the upload day. */
  date?: string;
  total?: number;
  currency?: string;
  linkedTo: string[];
  status: RowStatus;
};

function deriveRow(file: FileEntry): DerivedRow {
  const doc = file.produced.find(
    (item): item is Extract<Produced, { kind: 'purchase-document' }> =>
      item.kind === 'purchase-document'
  );
  const labels = file.produced.find(
    (item): item is Extract<Produced, { kind: 'box-labels' }> =>
      item.kind === 'box-labels'
  );
  const report = file.produced.find(
    (item): item is Extract<Produced, { kind: 'report-rows' }> =>
      item.kind === 'report-rows'
  );
  const render = file.produced.find(
    (item): item is Extract<Produced, { kind: 'issued-po-render' }> =>
      item.kind === 'issued-po-render'
  );

  const uploadDay = new Date(file.uploadedAt).toISOString().slice(0, 10);

  if (doc) {
    const linkedTo = [
      ...(doc.issuedPoNumber ? [doc.issuedPoNumber] : []),
      ...(doc.shipmentIds ?? []),
      ...(doc.purchaseId ? ['purchase'] : []),
    ];
    return {
      kind: ROLE_LABELS[doc.role as DocumentRole] ?? doc.role,
      vendor: doc.vendorName,
      date: doc.documentDate ?? uploadDay,
      total: doc.total,
      currency: doc.currency,
      linkedTo,
      status: doc.needsReview
        ? 'review'
        : linkedTo.length
        ? 'matched'
        : 'unlinked',
    };
  }
  if (labels) {
    return {
      kind: 'FBA box label',
      date: uploadDay,
      linkedTo: [labels.shipmentId],
      status: 'matched',
    };
  }
  if (report) {
    return {
      kind: report.label,
      date: report.observedTo ?? uploadDay,
      linkedTo:
        report.observedFrom && report.observedTo
          ? [`${report.observedFrom} → ${report.observedTo}`]
          : [],
      status: 'parsed',
    };
  }
  if (render) {
    return {
      kind: 'Purchase order (issued)',
      vendor: render.vendorName,
      date: render.issueDate ?? uploadDay,
      total: render.total,
      currency: render.currency,
      linkedTo: render.shipmentIds ?? [],
      status: render.shipmentIds?.length ? 'matched' : 'unlinked',
    };
  }
  return {
    kind: file.mimeType?.startsWith('image/')
      ? 'Image'
      : file.mimeType === 'application/pdf'
      ? 'PDF'
      : 'Stored file',
    date: uploadDay,
    linkedTo: [],
    status: 'unlinked',
  };
}

/** Rows per page. Enough that a normal library is one page. */
const PAGE_SIZE = 50;

/**
 * The month bucket a row files under. Extracted document dates are USUALLY
 * ISO, but a raw "Jul 31, 2026" reaches here off some documents — sliced
 * blindly that minted a garbage facet named "Jul 31," (seen live). A date
 * that does not start ISO buckets by upload month instead.
 */
function monthKeyOf(date: string | undefined, uploadedAt: number): string {
  if (date && /^\d{4}-\d{2}/.test(date)) return date.slice(0, 7);
  return new Date(uploadedAt).toISOString().slice(0, 7);
}

/** "2026-08" → "Aug 2026". The key stays ISO for sorting; only eyes get this. */
function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatBytesTotal(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
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
  if (kinds.has('purchase-document') || kinds.has('issued-po-render'))
    return <Receipt className={className} />;
  if (file.mimeType?.startsWith('image/'))
    return <ImageIcon className={className} />;
  return <FileText className={className} />;
}

export default function DocumentsPage() {
  const [view, setView] = useState<DocumentCenter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kindFacet, setKindFacet] = useState<string | null>(null);
  const [statusFacet, setStatusFacet] = useState<RowStatus | null>(null);
  const [periodFacet, setPeriodFacet] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
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

  /** Row facts, computed once — the table and every facet count read these. */
  const rows = useMemo(
    () =>
      new Map(
        (view?.files ?? []).map((file) => [file.id, deriveRow(file)] as const)
      ),
    [view]
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (view?.files ?? []).filter((file) => {
      const row = rows.get(file.id);
      if (!row) return false;
      if (kindFacet && row.kind !== kindFacet) return false;
      if (statusFacet && row.status !== statusFacet) return false;
      if (periodFacet && monthKeyOf(row.date, file.uploadedAt) !== periodFacet)
        return false;
      if (!needle) return true;
      // Searching the vendor as well as the file name: half these files are
      // named `invoice-2.pdf` and the supplier is the only thing anyone
      // remembers about them.
      return `${file.fileName} ${row.vendor ?? ''}`
        .toLowerCase()
        .includes(needle);
    });
  }, [view, rows, kindFacet, statusFacet, periodFacet, query]);

  const pageCount = Math.max(Math.ceil(visible.length / PAGE_SIZE), 1);
  const currentPage = Math.min(page, pageCount - 1);
  const paged = visible.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  );

  /** Facet counts over the WHOLE library, so numbers hold still while
   * filtering — a count that shrinks as you filter reads as data loss. */
  const facets = useMemo(() => {
    const kinds = new Map<string, number>();
    const statuses = new Map<RowStatus, number>();
    const periods = new Map<string, number>();
    let bytes = 0;
    let lastImport = 0;
    for (const file of view?.files ?? []) {
      const row = rows.get(file.id);
      if (!row) continue;
      kinds.set(row.kind, (kinds.get(row.kind) ?? 0) + 1);
      statuses.set(row.status, (statuses.get(row.status) ?? 0) + 1);
      const month = monthKeyOf(row.date, file.uploadedAt);
      periods.set(month, (periods.get(month) ?? 0) + 1);
      bytes += file.sizeBytes ?? 0;
      lastImport = Math.max(lastImport, file.uploadedAt);
    }
    return {
      kinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]),
      statuses,
      periods: [...periods.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 8),
      bytes,
      lastImport,
    };
  }, [view, rows]);

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

  // The other answer. A suggestion with only an accept button is a nag, and
  // for two same-day invoices from one supplier, accepting is exactly wrong —
  // it makes one invoice the cost basis for both.
  const rejectPurchase = useCallback(
    async (documentIds: string[]) => {
      setBusy(documentIds.join(','));
      try {
        const response = await fetch('/api/documents/purchase/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentIds }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setError(payload.error ?? 'Could not record that.');
          return;
        }
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const jumpToFile = useCallback(
    (fileId: string) => {
      // Clear the filters first: the chosen file may not be in the current
      // facet, and scrolling to a row that is filtered out looks like nothing
      // happened. Then land on the PAGE that holds it — with pagination, the
      // row may not be rendered at all otherwise.
      setKindFacet(null);
      setStatusFacet(null);
      setPeriodFacet(null);
      setQuery('');
      const index = (view?.files ?? []).findIndex((file) => file.id === fileId);
      setPage(index >= 0 ? Math.floor(index / PAGE_SIZE) : 0);
      setHighlighted(fileId);
      // After the state above has rendered the row, not before.
      requestAnimationFrame(() => {
        document
          .getElementById(`file-${fileId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    },
    [view]
  );

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
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === suggestion.documentIds.join(',')}
                    onClick={() => confirmPurchase(suggestion.documentIds)}
                  >
                    <Link2 className="mr-1.5 h-3.5 w-3.5" />
                    These are one purchase
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={busy === suggestion.documentIds.join(',')}
                    onClick={() => rejectPurchase(suggestion.documentIds)}
                  >
                    These are separate
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {view?.files.length ? (
        <section className="mt-8">
          {/* The review queue, surfaced before the list (design page 01): the
              count, why things land here, and one click to see only them. */}
          {(facets.statuses.get('review') ?? 0) > 0 ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div>
                <p className="text-sm font-medium text-amber-900">
                  {facets.statuses.get('review')} need review
                </p>
                <p className="mt-0.5 text-xs text-amber-800">
                  Arithmetic that didn't check out, ambiguous dates, and kinds
                  the recogniser couldn't call.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setStatusFacet('review');
                  setKindFacet(null);
                  setPeriodFacet(null);
                  setPage(0);
                }}
              >
                Start reviewing
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Files ({view.files.length})
            </h2>
            <span className="text-xs text-muted-foreground">newest first</span>
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Search name or supplier"
              className="h-8 w-full sm:w-56"
            />
          </div>

          <div className="mt-4 gap-6 lg:grid lg:grid-cols-[190px_minmax(0,1fr)]">
            {/* Facets: the same derivation the rows use, counted over the
                whole library so the numbers hold still while filtering. */}
            <aside className="mb-4 lg:mb-0">
              <Facet
                title="Kind"
                entries={facets.kinds}
                active={kindFacet}
                onPick={(value) => {
                  setKindFacet(value);
                  setPage(0);
                }}
              />
              <Facet
                title="Status"
                entries={(
                  ['review', 'matched', 'parsed', 'unlinked'] as RowStatus[]
                )
                  .filter((status) => facets.statuses.has(status))
                  .map((status) => [
                    STATUS_LABELS[status],
                    facets.statuses.get(status) ?? 0,
                  ])}
                active={statusFacet ? STATUS_LABELS[statusFacet] : null}
                onPick={(label) => {
                  setPage(0);
                  setStatusFacet(
                    label === null
                      ? null
                      : ((Object.entries(STATUS_LABELS).find(
                          ([, text]) => text === label
                        )?.[0] ?? null) as RowStatus | null)
                  );
                }}
              />
              <Facet
                title="Period"
                entries={facets.periods}
                active={periodFacet}
                onPick={(value) => {
                  setPeriodFacet(value);
                  setPage(0);
                }}
                format={monthLabel}
              />
              <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                <p>
                  {view.files.length} document
                  {view.files.length === 1 ? '' : 's'} ·{' '}
                  {formatBytesTotal(facets.bytes)}
                </p>
                {facets.lastImport ? (
                  <p className="mt-0.5">
                    Last import {formatDay(facets.lastImport)}
                  </p>
                ) : null}
              </div>
            </aside>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b text-left">
                    <th className="px-3 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium">Kind</th>
                    <th className="px-3 py-2 font-medium">Vendor</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Linked to</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((file) => (
                    <LibraryRow
                      key={file.id}
                      file={file}
                      row={rows.get(file.id)}
                      highlighted={highlighted === file.id}
                      busy={busy}
                      onDelete={() => setPending(file)}
                      onRoleChange={changeRole}
                    />
                  ))}
                  {!visible.length ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="p-6 text-center text-sm text-muted-foreground"
                      >
                        Nothing matches that.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
                <span>
                  {visible.length > PAGE_SIZE
                    ? `Showing ${currentPage * PAGE_SIZE + 1}\u2013${
                        currentPage * PAGE_SIZE + paged.length
                      } of ${visible.length}`
                    : `End of the list \u2014 ${visible.length} shown`}
                </span>
                {pageCount > 1 ? (
                  <span className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2"
                      disabled={currentPage === 0}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      Previous
                    </Button>
                    <span className="tabular-nums">
                      {currentPage + 1}/{pageCount}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2"
                      disabled={currentPage >= pageCount - 1}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      Next
                    </Button>
                  </span>
                ) : null}
              </div>
            </div>
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

function Facet({
  title,
  entries,
  active,
  onPick,
  format,
}: {
  title: string;
  entries: Array<readonly [string, number]>;
  active: string | null;
  onPick: (value: string | null) => void;
  /** Display transform for a key — the Period facet turns "2026-08" into
      "Aug 2026" while filtering keeps the sortable ISO key. */
  format?: (key: string) => string;
}) {
  if (!entries.length) return null;
  return (
    <div className="mt-4 first:mt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="mt-1.5 space-y-0.5">
        {entries.map(([label, count]) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => onPick(active === label ? null : label)}
              className={cn(
                'flex w-full items-center justify-between rounded px-1.5 py-0.5 text-left text-xs',
                active === label
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span className="truncate">{format?.(label) ?? label}</span>
              <span className="ml-2 shrink-0 tabular-nums">{count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LibraryRow({
  file,
  row,
  busy,
  highlighted,
  onDelete,
  onRoleChange,
}: {
  file: FileEntry;
  row?: DerivedRow;
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
    <tr
      id={`file-${file.id}`}
      className={cn(
        'border-b align-top transition-colors last:border-0',
        highlighted && 'border-primary bg-primary/5'
      )}
    >
      <td className="max-w-64 px-3 py-2">
        <div className="flex items-center gap-2">
          <FileIcon file={file} />
          {/* Linked only when there is a document behind it: the detail view is
              about extracted figures, and an unread upload has none. */}
          {document && file.assetId ? (
            <Link
              href={`/documents/${file.assetId}`}
              className={cn(
                'truncate font-medium underline-offset-4 hover:underline',
                file.nameUnknown && 'italic text-muted-foreground'
              )}
              title={file.fileName}
            >
              {file.fileName}
            </Link>
          ) : (
            <span
              className={cn(
                'truncate font-medium',
                file.nameUnknown && 'italic text-muted-foreground'
              )}
              title={file.fileName}
            >
              {file.fileName}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {[file.mimeType, file.sizeBytes ? formatBytes(file.sizeBytes) : null]
            .filter(Boolean)
            .join(' · ')}
          {/* An ingested report with no stored bytes: say so, because the
              missing Download button otherwise looks like a fault. */}
          {!file.assetId ? ' · rows only — file not kept' : ''}
        </p>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs">
        {document ? (
          // Filing is an ANSWER the seller can change right here — the same
          // select the old card carried, in a column instead.
          <select
            value={document.role}
            disabled={busy === document.documentId}
            onChange={(event) =>
              onRoleChange(
                document.documentId,
                event.target.value as DocumentRole
              )
            }
            className="h-7 max-w-36 rounded-md border bg-background px-1 text-xs text-foreground"
          >
            {DocumentRoleSchema.options.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        ) : (
          row?.kind ?? '—'
        )}
      </td>
      <td className="max-w-36 truncate px-3 py-2 text-xs" title={row?.vendor}>
        {row?.vendor ?? '—'}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums">
        {row?.date ?? '—'}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">
        {formatMoney(row?.total, row?.currency) ?? '—'}
      </td>
      <td
        className="max-w-40 truncate px-3 py-2 text-xs"
        title={row?.linkedTo.join(', ')}
      >
        {row?.linkedTo.length ? row.linkedTo.join(', ') : '—'}
      </td>
      <td
        className={cn(
          'whitespace-nowrap px-3 py-2 text-xs',
          STATUS_STYLES[row?.status ?? 'unlinked']
        )}
      >
        {document && file.assetId ? (
          <Link
            href={`/documents/${file.assetId}`}
            className="underline-offset-4 hover:underline"
          >
            {STATUS_LABELS[row?.status ?? 'unlinked']}
          </Link>
        ) : (
          STATUS_LABELS[row?.status ?? 'unlinked']
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {file.assetId ? (
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground"
          >
            <a
              href={`/api/a-plus/assets/${file.assetId}`}
              download
              aria-label="Download"
            >
              <Download className="h-3.5 w-3.5" />
            </a>
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          aria-label="Delete"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          disabled={busy === file.id}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
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
    if (item.kind === 'issued-po-render') {
      // The one non-destructive entry in this list: the order keeps its
      // figures and renders a fresh file on the next download.
      return `the rendered file of ${item.poNumber} — the order itself stays and re-renders on demand`;
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
