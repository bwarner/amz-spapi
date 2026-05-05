import { ViewportPreview } from './viewport-preview';
import { sampleAPlusDoc } from '@/components/aplus-preview/sample-doc';

export default function APlusPreviewPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">A+ Content Preview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sample render of an assembled A+ document. Mirrors Amazon&rsquo;s
          970&nbsp;px stacked-module layout. Toggle viewport to see how modules
          reflow on tablet and mobile (image+text stacks, quadrants go
          single-column, table scrolls).
        </p>
      </header>

      <ViewportPreview doc={sampleAPlusDoc} />
    </div>
  );
}
