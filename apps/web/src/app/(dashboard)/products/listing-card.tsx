'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { ProductListing } from '@farvisionllc/models';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  inactive: 'bg-gray-200 text-gray-700',
  incomplete: 'bg-amber-100 text-amber-800',
  unknown: 'bg-gray-100 text-gray-600',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? STATUS_STYLES['unknown']
      }`}
    >
      {status}
    </span>
  );
}

export function ListingCard({ listing }: { listing: ProductListing }) {
  const [imageFailed, setImageFailed] = useState(false);
  const snapshot = listing.snapshot;
  const mainImage = snapshot?.mainImage?.url;
  // A synced listing whose ASIN returned no catalog data (404 / not in this
  // marketplace) — typically an inactive, suppressed, or test listing.
  const hasCatalogData = Boolean(
    snapshot?.title || mainImage || snapshot?.bulletPoints?.length
  );

  return (
    <li className="flex gap-4 py-4">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded border bg-white">
        {mainImage && !imageFailed ? (
          <img
            src={mainImage}
            alt={snapshot?.title ?? listing.external.sku ?? 'Product image'}
            className="max-h-20 max-w-full object-contain"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <ImageOff className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">
            {snapshot?.title ?? listing.external.sku ?? 'Listing'}
          </p>
          <StatusBadge status={listing.status} />
        </div>

        <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-4">
          {listing.external.asin ? (
            <div>
              <dt className="inline font-medium">ASIN </dt>
              <dd className="inline">{listing.external.asin}</dd>
            </div>
          ) : null}
          {listing.external.sku ? (
            <div>
              <dt className="inline font-medium">SKU </dt>
              <dd className="inline">{listing.external.sku}</dd>
            </div>
          ) : null}
          {listing.external.fnsku ? (
            <div>
              <dt className="inline font-medium">FNSKU </dt>
              <dd className="inline">{listing.external.fnsku}</dd>
            </div>
          ) : null}
          {listing.marketplaceId ? (
            <div>
              <dt className="inline font-medium">Market </dt>
              <dd className="inline">{listing.marketplaceId}</dd>
            </div>
          ) : null}
        </dl>

        {!hasCatalogData ? (
          <p className="mt-2 text-xs text-amber-700">
            No Amazon catalog data — this ASIN isn’t in the{' '}
            {listing.marketplaceId ?? 'selected'} catalog (usually an inactive,
            suppressed, or test listing), so there’s nothing to show.
          </p>
        ) : null}

        {snapshot?.bulletPoints?.length ? (
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-foreground/80">
            {snapshot.bulletPoints.slice(0, 5).map((bullet, i) => (
              <li key={i}>{bullet}</li>
            ))}
          </ul>
        ) : null}

        {snapshot?.salesRank?.length ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {snapshot.salesRank
              .slice(0, 2)
              .map(
                (rank) =>
                  `#${rank.rank?.toLocaleString() ?? '?'}${
                    rank.title ? ` in ${rank.title}` : ''
                  }`
              )
              .join(' · ')}
          </p>
        ) : null}

        {listing.syncedAt ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Synced {new Date(listing.syncedAt).toLocaleString()}
          </p>
        ) : null}
      </div>
    </li>
  );
}
