'use client';

import { useCallback, useRef, useState } from 'react';
import { FileUp, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One place to bring outside data in.
 *
 * Two different pipelines sit behind a single drop zone, chosen by what the
 * file IS rather than by asking the user: tabular Amazon exports are parsed
 * into de-duplicated report rows, while PDFs, images and design files are
 * stored as documents. Making the user pick the right uploader would only
 * create a way to get it wrong.
 *
 * The report half also matters because it needs no Amazon permissions — for a
 * report behind a role the app has not been granted, this is the only way in.
 */

type ImportResult = {
  kind: string;
  rowsParsed: number;
  rowsNew: number;
  rowsDuplicate: number;
  unmappedHeaders?: string[];
  observedFrom?: string;
  observedTo?: string;
  detectionConfidence?: number;
};

type ImportError = {
  error: string;
  candidates?: Array<{ kind: string; matched: number; possible: number }>;
};

type DocumentResult = {
  assetId: string;
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  duplicate?: boolean;
  recognition?: {
    kind: string;
    confidence: number;
    needsUserChoice: boolean;
    signals: string[];
    alternatives: string[];
  };
  boxLabelsStored?: number;
  boxLabelSummary?: Array<{
    shipmentId: string;
    destinationFc?: string;
    boxesSeen: number;
    boxesDeclared?: number;
    complete: boolean;
    units: Array<{ sku: string; quantity: number; boxes: number }>;
    totalUnits: number;
    warnings: string[];
  }>;
};

/** What each recognised kind is called in the UI. */
const DOCUMENT_LABELS: Record<string, string> = {
  'commercial-invoice': 'Commercial invoice',
  'purchase-order': 'Purchase order',
  receipt: 'Receipt',
  'proof-of-delivery': 'Proof of delivery',
  'transport-document': 'Transport document',
  'customs-declaration': 'Customs declaration',
  'packing-list': 'Packing list',
  'fba-box-label': 'FBA box label',
  'fnsku-label': 'FNSKU label',
  'design-artwork': 'Design artwork',
  unknown: 'Unrecognised',
};

type Row = {
  id: string;
  fileName: string;
  kind: 'report' | 'document';
  status: 'uploading' | 'done' | 'failed';
  result?: ImportResult;
  document?: DocumentResult;
  /** Looked like a report by extension but was not one; kept as a document. */
  notReport?: boolean;
  error?: ImportError;
};

/**
 * How many uploads are in flight at once.
 *
 * Sequential was fine for one file and slow for a backfill: a year of
 * settlements is roughly twenty-six of them, each its own request. Unbounded
 * `Promise.all` is the wrong other extreme — it opens every connection at once
 * and hands the API route a thundering herd, for no gain once the link is
 * saturated.
 *
 * Files stay one-per-request whatever this is set to. Batching several into one
 * body would be worse: a year is around 5 MB and the platform rejects a request
 * body over 4.5 MB, so the batch would work in testing and fail on the real
 * backfill. Per-file also means per-file reconciliation feedback, and an import
 * that dedupes on re-upload, so a partial failure is repaired by dropping the
 * same folder in again.
 */
const UPLOAD_CONCURRENCY = 5;

/**
 * Run `worker` over `items`, at most `limit` at a time, in order.
 *
 * Workers share one cursor rather than taking a fixed slice each, so a slow
 * file holds up only itself: whichever worker frees first takes the next file.
 * Never rejects — `worker` is expected to record its own failures, and one bad
 * file must not abandon the rest of the batch.
 */
async function runPooled<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const take = async (): Promise<void> => {
    // Safe without a lock: nothing awaits between reading and advancing.
    while (cursor < items.length) await worker(items[cursor++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, take)
  );
}

/** Tabular exports go to the report parser; everything else is a document. */
const REPORT_EXTENSIONS = new Set(['txt', 'tsv', 'csv']);

function classify(file: File): 'report' | 'document' {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (REPORT_EXTENSIONS.has(extension)) return 'report';
  // A .xlsx is tabular but not what Amazon exports, so it goes to the document
  // importer — which converts a workbook and files it as a report anyway when
  // the headers say it is one. Feeding the raw zip to the report parser here
  // would only fail.
  return 'document';
}

/**
 * Labels for the kinds detection can return. Kept in step with the registry in
 * `sp-cache` by hand: importing it here would pull the Couchbase client into a
 * client component.
 */
const REPORT_LABELS: Record<string, string> = {
  'ledger-detail': 'Inventory Ledger — Detail',
  'ledger-summary': 'Inventory Ledger — Summary',
  stranded: 'Stranded Inventory',
  'removal-order': 'Removal Order Detail',
  'removal-shipment': 'Removal Shipment Detail',
  reimbursement: 'Reimbursements',
  'inbound-performance': 'FBA Inbound Performance',
  settlement: 'Settlement (payments archive)',
  'storage-fee': 'FBA Monthly Storage Fees',
};

export default function ReportsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (files: FileList | File[]) => {
    const uploadOne = async (file: File) => {
      const id = `${file.name}-${Date.now()}-${Math.random()}`;
      const kind = classify(file);
      setRows((current) => [
        { id, fileName: file.name, kind, status: 'uploading' },
        ...current,
      ]);

      try {
        const send = async (endpoint: string) => {
          const body = new FormData();
          body.append('file', file);
          const response = await fetch(endpoint, { method: 'POST', body });
          // A crashed route answers with an HTML error page, and json() then
          // throws "Unexpected end of JSON input" — which tells the user
          // nothing. Fall back to the status.
          const payload = await response.json().catch(() => ({
            error: `Server error (HTTP ${response.status}). Check the server log.`,
          }));
          return { response, payload };
        };

        let asKind = kind;
        let { response, payload } = await send(
          kind === 'report' ? '/api/reports/import' : '/api/documents/import'
        );

        // A .csv or .txt that is not an Amazon export — a supplier price list,
        // say — should not be a dead end. Keep the file as a document rather
        // than telling the user their upload failed.
        if (!response.ok && kind === 'report' && response.status === 422) {
          const retry = await send('/api/documents/import');
          if (retry.response.ok) {
            asKind = 'document';
            response = retry.response;
            payload = retry.payload;
          }
        }

        setRows((current) =>
          current.map((row) =>
            row.id === id
              ? response.ok
                ? {
                    ...row,
                    kind: asKind,
                    status: 'done',
                    ...(asKind === 'report'
                      ? { result: payload as ImportResult }
                      : {
                          document: payload as DocumentResult,
                          notReport: kind === 'report',
                        }),
                  }
                : { ...row, status: 'failed', error: payload as ImportError }
              : row
          )
        );
      } catch (error) {
        setRows((current) =>
          current.map((row) =>
            row.id === id
              ? {
                  ...row,
                  status: 'failed',
                  error: {
                    error:
                      error instanceof Error ? error.message : 'Upload failed.',
                  },
                }
              : row
          )
        );
      }
    };

    await runPooled(Array.from(files), UPLOAD_CONCURRENCY, uploadOne);
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Import</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Drop Amazon report exports, supplier invoices, receipts, proofs of
        delivery or packaging artwork. Each file is routed by what it is —
        reports are parsed into rows and de-duplicated, so re-importing an
        overlapping date range is safe; documents are stored against this
        account.
      </p>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer.files?.length)
            upload(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'mt-6 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors',
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-muted-foreground/50'
        )}
      >
        <FileUp className="h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">
          Drop report files, or click to choose
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Reports (.txt, .tsv, .csv) — ledger, stranded, removals,
          reimbursements, inbound performance, settlements, storage fees
          <br />
          Documents (.pdf, .docx, .ai, images) — invoices, receipts, POs, PODs,
          box designs
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".txt,.tsv,.csv,.pdf,.docx,.ai,.png,.jpg,.jpeg,.heic,text/plain,text/tab-separated-values,text/csv,application/pdf,image/*"
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) upload(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      <div className="mt-6 space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              {row.status === 'uploading' ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : row.status === 'done' ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
              <span className="truncate text-sm font-medium">
                {row.fileName}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {row.result
                  ? REPORT_LABELS[row.result.kind] ?? row.result.kind
                  : row.document
                  ? 'Document'
                  : row.kind === 'report'
                  ? 'Report'
                  : 'Document'}
              </span>
            </div>

            {row.document ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <Stat
                  label="Stored"
                  value={`${(row.document.sizeBytes / 1024).toFixed(0)} KB`}
                />
                <Stat label="Type" value={row.document.mimeType} muted />
                <Stat
                  label="Asset"
                  value={row.document.assetId.slice(0, 14) + '…'}
                  muted
                />
                <Stat
                  label="Preview"
                  value={
                    row.document.mimeType.startsWith('image/')
                      ? 'available'
                      : 'download only'
                  }
                  muted
                />
              </dl>
            ) : null}

            {row.result ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <Stat label="New rows" value={row.result.rowsNew} />
                <Stat
                  label="Already held"
                  value={row.result.rowsDuplicate}
                  muted
                />
                <Stat label="Parsed" value={row.result.rowsParsed} muted />
                <Stat
                  label="Covers"
                  value={
                    row.result.observedFrom && row.result.observedTo
                      ? `${row.result.observedFrom} → ${row.result.observedTo}`
                      : '—'
                  }
                  muted
                />
              </dl>
            ) : null}

            {/* Unrecognised columns are kept verbatim, but say so: it is how a
                mapping that has drifted becomes visible instead of silent. */}
            {row.notReport ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Not a recognised Amazon report — stored as a document instead.
              </p>
            ) : null}

            {/* The shipped side: what this sheet says the seller sent. A
                label PDF holds one label per box, so a shipment is summarised
                rather than a single box reported. */}
            {row.document?.boxLabelSummary?.map((shipment) => (
              <div key={shipment.shipmentId} className="mt-3">
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Shipment" value={shipment.shipmentId} />
                  <Stat
                    label="Boxes"
                    value={`${shipment.boxesSeen} of ${
                      shipment.boxesDeclared ?? '?'
                    }`}
                  />
                  <Stat label="Units" value={`${shipment.totalUnits}`} />
                  <Stat
                    label="Destination"
                    value={shipment.destinationFc ?? '—'}
                    muted
                  />
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">
                  {shipment.units
                    .map((unit) => `${unit.sku} ${unit.quantity}`)
                    .join(' · ')}
                  {shipment.complete ? ' — complete' : ''}
                </p>
                {shipment.warnings.length ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {shipment.warnings.join('; ')}
                  </p>
                ) : null}
              </div>
            ))}

            {/* Show the reasons, not just the verdict: a classification the
                seller can argue with is one they can correct. */}
            {row.document?.recognition ? (
              <div className="mt-3 text-xs">
                <p
                  className={
                    row.document.recognition.needsUserChoice
                      ? 'text-amber-700'
                      : 'text-muted-foreground'
                  }
                >
                  {DOCUMENT_LABELS[row.document.recognition.kind] ??
                    row.document.recognition.kind}
                  {row.document.recognition.confidence > 0
                    ? ` — confidence ${row.document.recognition.confidence.toFixed(
                        2
                      )}`
                    : ''}
                  {row.document.recognition.needsUserChoice
                    ? ' — needs confirmation'
                    : ''}
                </p>
                {row.document.recognition.signals.length ? (
                  <p className="mt-1 text-muted-foreground">
                    {row.document.recognition.signals.slice(0, 4).join('; ')}
                  </p>
                ) : null}
                {row.document.recognition.alternatives.length ? (
                  <p className="mt-1 text-muted-foreground">
                    Could also be:{' '}
                    {row.document.recognition.alternatives
                      .map((kind) => DOCUMENT_LABELS[kind] ?? kind)
                      .join(', ')}
                  </p>
                ) : null}
              </div>
            ) : null}

            {row.result?.unmappedHeaders?.length ? (
              <p className="mt-3 text-xs text-amber-700">
                Columns not recognised (stored, but not searchable):{' '}
                {row.result.unmappedHeaders.join(', ')}
              </p>
            ) : null}

            {row.error ? (
              <div className="mt-2 text-sm text-amber-800">
                <p>{row.error.error}</p>
                {row.error.candidates?.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Closest matches:{' '}
                    {row.error.candidates
                      .filter((candidate) => candidate.matched > 0)
                      .sort((a, b) => b.matched - a.matched)
                      .slice(0, 3)
                      .map(
                        (candidate) =>
                          `${
                            REPORT_LABELS[candidate.kind] ?? candidate.kind
                          } (${candidate.matched}/${
                            candidate.possible
                          } columns)`
                      )
                      .join(', ') || 'none'}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  muted,
}: {
  label: string;
  value: string | number;
  muted?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('font-medium', muted && 'text-muted-foreground')}>
        {value}
      </dd>
    </div>
  );
}
