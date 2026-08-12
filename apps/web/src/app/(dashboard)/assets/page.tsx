'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  FileText,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

/**
 * Assets — creative files as the same record, a different face.
 *
 * The grid answers "what images do I have and what still uses them". The
 * banner answers the only bulk question worth asking: which GENERATED files
 * does nothing reference any more. Uploads are never collectable — a
 * person's file is theirs to delete with their eyes open, not a sweep's.
 */

type Reference = { kind: string; label: string };

type AssetCard = {
  assetId: string;
  fileName: string;
  nameUnknown?: boolean;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  feature: string;
  generated: boolean;
  createdAt: number;
  references: Reference[];
};

type View = {
  cards: AssetCard[];
  counts: Record<string, number>;
  unreferencedGenerated: { count: number; bytes: number };
};

type Filter = 'all' | 'uploaded' | 'generated' | 'unreferenced';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'generated', label: 'Generated' },
  { key: 'unreferenced', label: 'Unreferenced' },
];

function matches(card: AssetCard, filter: Filter): boolean {
  if (filter === 'uploaded') return !card.generated;
  if (filter === 'generated') return card.generated;
  if (filter === 'unreferenced') return card.references.length === 0;
  return true;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AssetsPage() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirming, setConfirming] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collected, setCollected] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/assets');
    const payload = await response
      .json()
      .catch(() => ({ error: `Server error (HTTP ${response.status}).` }));
    if (!response.ok) {
      setError(payload.error ?? 'Could not load your assets.');
      return;
    }
    setError(null);
    setView(payload.view as View);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => (view?.cards ?? []).filter((card) => matches(card, filter)),
    [view, filter]
  );

  const collect = useCallback(async () => {
    setCollecting(true);
    try {
      const response = await fetch('/api/assets/collect', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? 'Collection failed.');
        return;
      }
      setCollected(
        `Collected ${payload.deleted} file${
          payload.deleted === 1 ? '' : 's'
        } — ${formatBytes(payload.bytesFreed ?? 0)} freed.`
      );
      await load();
    } finally {
      setCollecting(false);
      setConfirming(false);
    }
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
        {view ? (
          <span className="text-xs text-muted-foreground">
            {Object.entries(view.counts)
              .map(([feature, count]) => `${feature} ${count}`)
              .join(' · ') || 'no creative files yet'}
          </span>
        ) : null}
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Creative files — the same records your documents live in, worn as a
        library. Each card says what still uses it.
      </p>

      {error ? (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}
      {collected ? (
        <p className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {collected}
        </p>
      ) : null}

      {view && view.unreferencedGenerated.count > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div>
            <p className="text-sm font-medium text-amber-900">
              {view.unreferencedGenerated.count} generated file
              {view.unreferencedGenerated.count === 1 ? ' is' : 's are'}{' '}
              referenced by nothing —{' '}
              {formatBytes(view.unreferencedGenerated.bytes)}
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              Only model output is ever collected. Anything you uploaded
              yourself stays, referenced or not.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setConfirming(true)}
            disabled={collecting}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Review &amp; collect
          </Button>
        </div>
      ) : null}

      <div className="mt-5 flex gap-1.5">
        {FILTERS.map((entry) => (
          <button
            key={entry.key}
            onClick={() => setFilter(entry.key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs',
              filter === entry.key
                ? 'border-foreground bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {!view ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {filter === 'all'
            ? 'No creative files yet — images land here as A+ content, listings and ads use them.'
            : 'Nothing matches this filter.'}
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((card) => (
            <div
              key={card.assetId}
              className="overflow-hidden rounded-lg border"
            >
              {card.mimeType.startsWith('image/') ? (
                // A plain <img>: the thumbnail route is authenticated by the
                // session cookie, which next/image's optimizer cannot carry.
                <img
                  src={`/api/a-plus/assets/${card.assetId}?w=480`}
                  alt={card.fileName}
                  loading="lazy"
                  className="aspect-square w-full bg-muted object-cover"
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center bg-muted">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="p-2.5">
                <div className="flex items-center gap-1.5">
                  {card.generated ? (
                    <Sparkles
                      className="h-3 w-3 shrink-0 text-muted-foreground"
                      aria-label="Generated"
                    />
                  ) : (
                    <Upload
                      className="h-3 w-3 shrink-0 text-muted-foreground"
                      aria-label="Uploaded"
                    />
                  )}
                  <span
                    className={cn(
                      'truncate text-xs font-medium',
                      card.nameUnknown && 'italic text-muted-foreground'
                    )}
                    title={card.fileName}
                  >
                    {card.fileName}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {card.generated ? 'generated' : 'uploaded'}
                  {card.width && card.height
                    ? ` · ${card.width}×${card.height}`
                    : ''}
                  {` · ${formatBytes(card.sizeBytes)} · ${card.feature}`}
                </p>
                <p
                  className={cn(
                    'mt-0.5 truncate text-[11px]',
                    card.references.length
                      ? 'text-muted-foreground'
                      : 'text-amber-700'
                  )}
                  title={card.references.map((r) => r.label).join(', ')}
                >
                  {card.references.length
                    ? `Used in ${card.references.length} place${
                        card.references.length === 1 ? '' : 's'
                      }: ${card.references.map((r) => r.label).join(', ')}`
                    : 'Referenced by nothing'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => !open && setConfirming(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Collect {view?.unreferencedGenerated.count} generated file
              {view?.unreferencedGenerated.count === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  Every file in the sweep is model output that nothing
                  references — no A+ draft or snapshot, no product or listing,
                  no chat, no filed document, no issued order. The set is
                  re-checked at the moment of deletion, so anything referenced
                  since this page loaded is left alone.
                </p>
                <p className="mt-2">
                  Frees about{' '}
                  {formatBytes(view?.unreferencedGenerated.bytes ?? 0)}. Your
                  own uploads are never touched.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={collecting}>Cancel</AlertDialogCancel>
            <Button onClick={collect} disabled={collecting}>
              {collecting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-4 w-4" />
              )}
              Collect
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
