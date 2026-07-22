'use client';

import { useState } from 'react';
import { History, Loader2, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export type DraftVersionSummary = {
  versionId: string;
  createdAt: number;
  origin: 'pre-generation' | 'pre-restore' | 'manual';
  label?: string;
  summary: {
    name: string;
    contentTier?: string;
    sectionCount: number;
    score?: number;
  };
};

const ORIGIN_LABELS: Record<DraftVersionSummary['origin'], string> = {
  'pre-generation': 'Before generation',
  'pre-restore': 'Before restore',
  manual: 'Saved by you',
};

function relativeTime(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Version history drawer: protective snapshots (taken automatically before a
 * generation or restore overwrites content) plus manual checkpoints. Restoring
 * always snapshots the current state first, so backtracking is never lossy.
 */
export function APlusHistorySheet({
  open,
  onOpenChange,
  versions,
  loading,
  busyVersionId,
  snapshotting,
  onSnapshot,
  onRestore,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versions: DraftVersionSummary[];
  loading: boolean;
  /** versionId currently being restored/deleted (disables its row). */
  busyVersionId: string | null;
  snapshotting: boolean;
  onSnapshot: (label: string) => void;
  onRestore: (versionId: string) => void;
  onDelete: (versionId: string) => void;
}) {
  const [label, setLabel] = useState('');
  const anyBusy = snapshotting || busyVersionId !== null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Version history
          </SheetTitle>
          <SheetDescription>
            Snapshots are taken automatically before a generation or restore
            replaces your content. Restore any version — the current state is
            saved first, so nothing is lost.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 border-b px-4 pb-4">
          <Input
            value={label}
            maxLength={120}
            placeholder="Label this version (optional)…"
            onChange={(event) => setLabel(event.target.value)}
            className="h-9"
          />
          <Button
            type="button"
            size="sm"
            disabled={anyBusy}
            onClick={() => {
              onSnapshot(label.trim());
              setLabel('');
            }}
          >
            {snapshotting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Save version
          </Button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading versions…
            </p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No versions yet. One is saved automatically before each
              generation, or click “Save version” to checkpoint now.
            </p>
          ) : (
            versions.map((version) => {
              const busy = busyVersionId === version.versionId;
              return (
                <div key={version.versionId} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        version.origin === 'manual' ? 'default' : 'secondary'
                      }
                    >
                      {ORIGIN_LABELS[version.origin]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(version.createdAt)}
                    </span>
                    {version.summary.score !== undefined ? (
                      <Badge variant="outline">
                        Quality {version.summary.score}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1.5 truncate text-sm font-medium">
                    {version.label || version.summary.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {version.summary.sectionCount} section
                    {version.summary.sectionCount === 1 ? '' : 's'}
                    {version.summary.contentTier
                      ? ` · ${version.summary.contentTier}`
                      : ''}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={anyBusy}
                      onClick={() => onRestore(version.versionId)}
                    >
                      {busy ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Restore
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={anyBusy}
                      title="Delete this version"
                      onClick={() => onDelete(version.versionId)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
