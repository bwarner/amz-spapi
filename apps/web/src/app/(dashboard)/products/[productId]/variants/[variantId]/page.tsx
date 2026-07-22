'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type {
  Product,
  ProductListing,
  ProductVariant,
} from '@farvisionllc/models';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListingCard } from '../../../listing-card';

type VariantDetail = {
  product: Product;
  variant: ProductVariant;
  listings: ProductListing[];
};

export default function VariantDetailPage() {
  const params = useParams<{ productId: string; variantId: string }>();
  const { productId, variantId } = params;

  const [data, setData] = useState<VariantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/products/${productId}/variants/${variantId}`
      );
      const body = (await res.json()) as VariantDetail & { error?: string };
      if (!res.ok) throw new Error(body.error || 'Could not load variant.');
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load variant.');
    } finally {
      setLoading(false);
    }
  }, [productId, variantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const variantName =
    data?.variant.title ||
    (data?.variant.isDefault ? 'Default variant' : 'Variant');

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !data ? (
        <p className="text-sm text-red-700">{error || 'Variant not found.'}</p>
      ) : (
        <>
          <Link
            href={`/products/${productId}`}
            className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> {data.product.title}
          </Link>

          <h1 className="text-2xl font-bold">{variantName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {data.variant.options.map((option) => (
              <span
                key={`${option.name}:${option.value}`}
                className="rounded bg-muted px-1.5 py-0.5 text-xs"
              >
                {option.name}: {option.value}
              </span>
            ))}
            {data.variant.identifiers?.asin ? (
              <span className="text-xs">
                ASIN {data.variant.identifiers.asin}
              </span>
            ) : null}
            {data.variant.isDefault ? (
              <span className="text-xs">Default variant</span>
            ) : null}
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">
                Listings ({data.listings.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.listings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No listings for this variant yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {data.listings.map((listing) => (
                    <ListingCard key={listing.listingId} listing={listing} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
