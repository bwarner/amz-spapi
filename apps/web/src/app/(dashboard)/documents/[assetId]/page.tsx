'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  Link2,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { DocumentRoleSchema, type DocumentRole } from '@farvisionllc/models';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * One document: the figures that were read off it, and what they rest on.
 *
 * The Library answers "what do I have". This answers "can I trust this one",
 * which is a different question and the reason the page leads with the failed
 * checks rather than the totals. A figure that did not survive its own
 * arithmetic should not be read as a number first and doubted second.
 *
 * Everything here is reviewable rather than merely displayed: the role decides
 * which document is authoritative for cost, and the suggested links decide what
 * counts as one purchase. Both are a model's guess until a human says
 * otherwise, so both are editable, and the ones a human has answered stay
 * answered.
 */

type ExtractedLine = {
  description: string;
  kind?: string;
  quantity?: number;
  amount?: number;
};

type Extracted = {
  vendorName?: string;
  documentDate?: string;
  documentDateRaw?: string;
  currency?: string;
  total?: number;
  subtotal?: number;
  tax?: number;
  shipping?: number;
  amountPaid?: number;
  invoiceNumber?: string;
  receiptNumber?: string;
  trackingNumber?: string;
  carrier?: string;
  lines?: ExtractedLine[];
};

type Issue = {
  code: string;
  severity: 'blocker' | 'review';
  message: string;
  line?: number;
};

type StoredDoc = {
  documentId: string;
  assetId: string;
  fileName?: string;
  role: DocumentRole;
  roleSource: string;
  recognition: { kind: string; confidence: number; signals: string[] };
  extracted: Extracted;
  issues: Issue[];
  needsReview: boolean;
  modelId?: string;
  searchText?: string;
  embedded?: boolean;
  confirmedPurchaseId?: string;
  shipmentIds?: string[];
};

type Suggestion = {
  documentId: string;
  assetId?: string;
  score: number;
  role?: string;
  fileName?: string;
  vendorName?: string;
  documentDate?: string;
  total?: number;
  currency?: string;
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

export default function DocumentDetailPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = use(params);
  const [doc, setDoc] = useState<StoredDoc | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/documents/${assetId}`);
    const payload = await response
      .json()
      .catch(() => ({ error: `Server error (HTTP ${response.status}).` }));
    if (!response.ok) {
      setError(payload.error ?? 'Could not load that document.');
      return;
    }
    setError(null);
    setDoc(payload.document as StoredDoc);
    setSuggestions((payload.suggestions ?? []) as Suggestion[]);
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = useCallback(
    async (role: DocumentRole) => {
      if (!doc) return;
      setBusy('role');
      try {
        await fetch('/api/documents/role', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId: doc.documentId, role }),
        });
        await load();
      } finally {
        setBusy(null);
      }
    },
    [doc, load]
  );

  const linkTo = useCallback(
    async (suggestion: Suggestion) => {
      if (!doc) return;
      setBusy(suggestion.documentId);
      try {
        const response = await fetch('/api/documents/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentIds: [doc.documentId, suggestion.documentId],
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setError(payload.error ?? 'Could not link those documents.');
          return;
        }
        await load();
      } finally {
        setBusy(null);
      }
    },
    [doc, load]
  );

  const dismiss = useCallback(
    async (suggestion: Suggestion) => {
      setBusy(suggestion.documentId);
      try {
        await fetch('/api/documents/dismiss-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assetId,
            dismissedDocumentId: suggestion.documentId,
          }),
        });
        // Removed here rather than by reloading: the answer is recorded, and a
        // suggestion that flickers back before the refetch lands reads as a
        // failed click.
        setSuggestions((current) =>
          current.filter((entry) => entry.documentId !== suggestion.documentId)
        );
      } finally {
        setBusy(null);
      }
    },
    [assetId]
  );

  if (error && !doc) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <Back />
        <p className="mt-6 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <Back />
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      </div>
    );
  }

  const blockers = doc.issues.filter((issue) => issue.severity === 'blocker');
  const reference =
    doc.extracted.invoiceNumber ?? doc.extracted.receiptNumber ?? undefined;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Back />

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {doc.extracted.vendorName ?? doc.fileName ?? 'Document'}
        </h1>
        {reference ? (
          <span className="text-sm text-muted-foreground">{reference}</span>
        ) : null}
        {doc.needsReview ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            Needs review
          </span>
        ) : null}
        {/* The other end of the Shipments screen's attach — without this, a
            successful attach is invisible from the document's side. */}
        {(doc.shipmentIds ?? []).map((shipmentId) => (
          <span
            key={shipmentId}
            className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-xs font-medium text-primary"
          >
            {shipmentId}
          </span>
        ))}
      </div>

      {error ? (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      {/* The checks come first. A total that failed its own arithmetic should
          not be read as a figure and doubted afterwards. */}
      {doc.issues.length ? (
        <section
          className={cn(
            'mt-6 rounded-lg border p-4',
            blockers.length ? 'border-amber-300 bg-amber-50' : 'bg-muted/40'
          )}
        >
          <h2 className="text-sm font-semibold">
            {doc.issues.length} check{doc.issues.length === 1 ? '' : 's'} failed
            {blockers.length ? ' — figures held back' : ''}
          </h2>
          <ul className="mt-2 space-y-1.5">
            {doc.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`} className="text-sm">
                <span
                  className={
                    issue.severity === 'blocker'
                      ? 'text-amber-900'
                      : 'text-muted-foreground'
                  }
                >
                  {issue.message}
                </span>
                {issue.code === 'ambiguous-date' &&
                doc.extracted.documentDateRaw ? (
                  <span className="block text-xs text-muted-foreground">
                    As written: {doc.extracted.documentDateRaw}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Field label="Supplier" value={doc.extracted.vendorName} />
        <Field
          label="Document date"
          value={doc.extracted.documentDate}
          caution={doc.issues.some((i) => i.code === 'ambiguous-date')}
        />
        <Field label="Currency" value={doc.extracted.currency} />
        <Field
          label="Total"
          value={money(doc.extracted.total, doc.extracted.currency)}
        />
        <Field label="Reference" value={reference} />
        <div>
          <dt className="text-xs text-muted-foreground">Filed as</dt>
          <dd className="mt-1">
            <select
              value={doc.role}
              disabled={busy === 'role'}
              onChange={(event) =>
                changeRole(event.target.value as DocumentRole)
              }
              className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            >
              {DocumentRoleSchema.options.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            {/* Which document is authoritative for cost follows from this, so
                whether a human chose it is worth stating. */}
            <span className="mt-1 block text-xs text-muted-foreground">
              {doc.roleSource === 'user'
                ? 'You set this'
                : `Recognised as ${doc.recognition.kind}`}
            </span>
          </dd>
        </div>
      </section>

      {doc.extracted.lines?.length ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Lines
          </h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {doc.extracted.lines.map((line, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="py-2 pr-3">{line.description}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {line.quantity ?? ''}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {money(line.amount, doc.extracted.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="mt-3 flex flex-wrap justify-end gap-x-6 text-sm">
            {typeof doc.extracted.subtotal === 'number' ? (
              <Total
                label="Subtotal"
                value={doc.extracted.subtotal}
                doc={doc}
              />
            ) : null}
            {typeof doc.extracted.shipping === 'number' ? (
              <Total label="Freight" value={doc.extracted.shipping} doc={doc} />
            ) : null}
            {typeof doc.extracted.tax === 'number' ? (
              <Total label="Tax" value={doc.extracted.tax} doc={doc} />
            ) : null}
            <Total label="Total" value={doc.extracted.total} doc={doc} strong />
          </dl>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Suggested links
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Found by meaning, not by a shared reference — confirm before they
          count towards a purchase.
        </p>

        {suggestions.length ? (
          <div className="mt-3 space-y-2">
            {suggestions.map((suggestion) => (
              <div
                key={suggestion.documentId}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3"
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {suggestion.vendorName ?? suggestion.fileName ?? 'Document'}
                  <span className="text-muted-foreground">
                    {suggestion.role
                      ? ` · ${suggestion.role.replace(/-/g, ' ')}`
                      : ''}
                    {suggestion.documentDate
                      ? ` · ${suggestion.documentDate}`
                      : ''}
                    {typeof suggestion.total === 'number'
                      ? ` · ${money(suggestion.total, suggestion.currency)}`
                      : ''}
                  </span>
                </span>
                {/* Score and both answers travel together. Left to wrap
                    independently, "Not related" dropped onto its own line and
                    stopped reading as one of two answers to this row. */}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {suggestion.score.toFixed(2)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === suggestion.documentId}
                    onClick={() => linkTo(suggestion)}
                  >
                    <Link2 className="mr-1.5 h-3.5 w-3.5" />
                    Same purchase
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={busy === suggestion.documentId}
                    onClick={() => dismiss(suggestion)}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Not related
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {doc.embedded
              ? 'Nothing else reads as part of this purchase.'
              : 'This document has not been indexed for meaning yet, so there is nothing to suggest.'}
          </p>
        )}
      </section>

      {/* Where every figure above came from. A suspect number should be
          attributable without asking anyone. */}
      <footer className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-4 text-xs text-muted-foreground">
        <span>
          read by {doc.modelId ?? 'an unrecorded model'} · {doc.assetId}
        </span>
        <Button asChild size="sm" variant="outline" className="ml-auto">
          <a href={`/api/a-plus/assets/${doc.assetId}`} download>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Original file
          </a>
        </Button>
      </footer>
    </div>
  );
}

function Back() {
  return (
    <Link
      href="/documents"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Documents
    </Link>
  );
}

function Field({
  label,
  value,
  caution,
}: {
  label: string;
  value?: string;
  caution?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-sm font-medium',
          caution && 'text-amber-800',
          !value && 'text-muted-foreground'
        )}
      >
        {value || '—'}
      </dd>
    </div>
  );
}

function Total({
  label,
  value,
  doc,
  strong,
}: {
  label: string;
  value?: number;
  doc: StoredDoc;
  strong?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums', strong && 'font-semibold')}>
        {money(value, doc.extracted.currency)}
      </dd>
    </div>
  );
}
