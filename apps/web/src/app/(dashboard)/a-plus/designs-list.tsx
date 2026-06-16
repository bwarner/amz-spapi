'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FileText, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type DesignListItem = {
  draftId: string;
  name: string;
  productName?: string;
  asin?: string;
  contentTier?: 'Basic A+' | 'Premium A+';
  updatedAt: number;
};

const PAGE_SIZE = 8;

/**
 * Paginated list of the seller's A+ designs (drafts). Create/edit happen via
 * routes (/a-plus/new, /a-plus/<id>); delete is handled here against the drafts
 * API with optimistic removal.
 */
export function DesignsList({ drafts: initial }: { drafts: DesignListItem[] }) {
  const [drafts, setDrafts] = useState(initial);
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(drafts.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = drafts.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  );

  async function remove(draftId: string, name: string) {
    if (
      !window.confirm(
        `Delete “${name || 'Untitled design'}”? This can’t be undone.`
      )
    ) {
      return;
    }
    setDeleting(draftId);
    try {
      const res = await fetch(`/api/a-plus/drafts/${draftId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setDrafts((current) => current.filter((d) => d.draftId !== draftId));
      } else {
        window.alert('Could not delete this design. Please try again.');
      }
    } catch {
      window.alert('Could not delete this design. Please try again.');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">A+ Designs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create, edit, and manage your Amazon A+ content packages.
          </p>
        </div>
        <Button asChild>
          <Link href="/a-plus/new">
            <Plus className="mr-2 h-4 w-4" />
            New design
          </Link>
        </Button>
      </div>

      {drafts.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-10 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No designs yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Start your first A+ content package.
          </p>
          <Button asChild className="mt-4">
            <Link href="/a-plus/new">
              <Plus className="mr-2 h-4 w-4" />
              New design
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <ul className="divide-y rounded-lg border bg-card">
            {visible.map((d) => (
              <li
                key={d.draftId}
                className="flex flex-wrap items-center gap-3 p-4"
              >
                <Link href={`/a-plus/${d.draftId}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium hover:underline">
                    {d.name || 'Untitled design'}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {d.productName || d.asin || 'No product set'} · updated{' '}
                    {new Date(d.updatedAt).toLocaleString()}
                  </p>
                </Link>
                {d.contentTier ? (
                  <Badge variant="outline">{d.contentTier}</Badge>
                ) : null}
                <Button asChild variant="outline" size="sm">
                  <Link href={`/a-plus/${d.draftId}`}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Edit
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={deleting === d.draftId}
                  onClick={() => void remove(d.draftId, d.name)}
                  className="text-destructive hover:text-destructive"
                  aria-label={`Delete ${d.name || 'design'}`}
                >
                  {deleting === d.draftId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </li>
            ))}
          </ul>

          {pageCount > 1 ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {drafts.length} design{drafts.length === 1 ? '' : 's'} · page{' '}
                {safePage + 1} of {pageCount}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
