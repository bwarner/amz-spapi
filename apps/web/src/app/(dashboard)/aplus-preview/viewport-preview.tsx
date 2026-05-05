'use client';

import { useState } from 'react';
import { Smartphone, Tablet, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { APlusPreview } from '@/components/aplus-preview/aplus-preview';
import type { APlusDocument } from '@farvisionllc/models';

type Viewport = 'mobile' | 'tablet' | 'desktop';

const VIEWPORTS: Record<
  Viewport,
  { width: string; label: string; icon: typeof Smartphone }
> = {
  mobile: { width: '375px', label: 'Mobile', icon: Smartphone },
  tablet: { width: '768px', label: 'Tablet', icon: Tablet },
  desktop: { width: '100%', label: 'Desktop', icon: Monitor },
};

export function ViewportPreview({ doc }: { doc: APlusDocument }) {
  const [viewport, setViewport] = useState<Viewport>('desktop');

  return (
    <div>
      <div className="mb-4 inline-flex rounded-md border border-neutral-200 bg-neutral-50 p-1">
        {(
          Object.entries(VIEWPORTS) as [
            Viewport,
            (typeof VIEWPORTS)[Viewport]
          ][]
        ).map(([key, { label, icon: Icon }]) => (
          <button
            key={key}
            type="button"
            onClick={() => setViewport(key)}
            className={cn(
              'flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors',
              viewport === key
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div
        className="mx-auto transition-[max-width] duration-200"
        style={{ maxWidth: VIEWPORTS[viewport].width }}
      >
        <APlusPreview doc={doc} />
      </div>
    </div>
  );
}
