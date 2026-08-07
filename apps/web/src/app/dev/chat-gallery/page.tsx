import { notFound } from 'next/navigation';
import { GALLERY_CASES } from './cases';
import { GalleryCase } from './gallery-case';

/**
 * Every chat message state on one page, from fixtures.
 *
 * Two jobs. It is a review surface — the states are otherwise reachable only by
 * getting a live model to do a specific thing, which is slow, costs money and
 * cannot be relied on to produce the case you wanted. And it is what the
 * screenshot spec in `apps/web-e2e` walks, so a visual change shows up as an
 * image on a pull request instead of as a line of Tailwind nobody can picture.
 *
 * Dev only, following the same gate as the A+ sample renderer: this reaches no
 * services and holds no data, but a page that renders arbitrary fixtures has no
 * business in production.
 */
export const dynamic = 'force-static';

export default function ChatGalleryPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-xl font-semibold">Chat states</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {GALLERY_CASES.length} fixtures, rendered through the real{' '}
          <code className="font-mono text-xs">MessageBubble</code>. No network,
          no account, no model.
        </p>
      </header>

      <div className="space-y-10">
        {GALLERY_CASES.map((entry) => (
          <section
            key={entry.id}
            // The screenshot spec finds each case by this attribute and names
            // the PNG after it, so ids are the contract between the two.
            data-gallery-case={entry.id}
            className="scroll-mt-6"
          >
            <div className="mb-2 border-b pb-1.5">
              <h2 className="text-sm font-medium">{entry.title}</h2>
              {entry.note && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {entry.note}
                </p>
              )}
            </div>
            <GalleryCase entry={entry} />
          </section>
        ))}
      </div>
    </main>
  );
}
