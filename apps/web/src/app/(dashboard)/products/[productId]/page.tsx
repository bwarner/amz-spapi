'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type {
  Product,
  ProductListing,
  ProductVariant,
} from '@farvisionllc/models';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListingCard } from '../listing-card';

type ProductDetail = {
  product: Product;
  variants: ProductVariant[];
  listings: ProductListing[];
};

type ResyncSummary = {
  connected: boolean;
  updated: number;
  asins: number;
  errors: string[];
  message?: string;
};

export default function ProductDetailPage() {
  const params = useParams<{ productId: string }>();
  const productId = params.productId;
  const router = useRouter();

  const [data, setData] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resyncing, setResyncing] = useState(false);
  const [resyncResult, setResyncResult] = useState<ResyncSummary | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [creatingAPlus, setCreatingAPlus] = useState(false);
  const [brandGuides, setBrandGuides] = useState<
    { brandGuideId: string; name: string; brandName?: string }[]
  >([]);
  const [savingBrand, setSavingBrand] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}`);
      const body = (await res.json()) as ProductDetail & { error?: string };
      if (!res.ok) throw new Error(body.error || 'Could not load product.');
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load product.');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Brand guides are user-wide, independent of which product is open.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/a-plus/brand-guides');
        const body = (await res.json()) as {
          brandGuides?: {
            brandGuideId: string;
            name: string;
            brandName?: string;
          }[];
        };
        if (res.ok) setBrandGuides(body.brandGuides ?? []);
      } catch {
        // Non-fatal: the selector just won't render.
      }
    })();
  }, []);

  async function assignBrandGuide(brandId: string) {
    setSavingBrand(true);
    setError('');
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // null clears the field (empty string would persist as ''); see PATCH.
        body: JSON.stringify({ brandId: brandId || null }),
      });
      const body = (await res.json()) as { product?: Product; error?: string };
      if (!res.ok || !body.product) {
        throw new Error(body.error || 'Could not update brand guide.');
      }
      setData((current) =>
        current ? { ...current, product: body.product as Product } : current
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not update brand guide.'
      );
    } finally {
      setSavingBrand(false);
    }
  }

  async function refreshFromAmazon() {
    if (resyncing) return;
    setResyncing(true);
    setError('');
    setResyncResult(null);
    setNotConnected(false);
    try {
      const res = await fetch(`/api/products/${productId}/resync`, {
        method: 'POST',
      });
      const body = (await res.json()) as ResyncSummary & { error?: string };
      if (res.status === 409 && body.connected === false) {
        setNotConnected(true);
        return;
      }
      if (!res.ok) throw new Error(body.error || 'Refresh failed.');
      setResyncResult(body);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed.');
    } finally {
      setResyncing(false);
    }
  }

  async function createAPlusContent() {
    if (creatingAPlus) return;
    setCreatingAPlus(true);
    setError('');
    try {
      const res = await fetch(`/api/products/${productId}/a-plus`, {
        method: 'POST',
      });
      const body = (await res.json()) as { draftId?: string; error?: string };
      if (!res.ok || !body.draftId) {
        throw new Error(body.error || 'Could not start A+ content.');
      }
      router.push(`/a-plus/${body.draftId}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not start A+ content.'
      );
      setCreatingAPlus(false);
    }
    // On success we navigate away, so leave the spinner up until the route changes.
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link
        href="/products"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Products
      </Link>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !data ? (
        <p className="text-sm text-red-700">{error || 'Product not found.'}</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">{data.product.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.product.brandName ? `${data.product.brandName} · ` : ''}
                {data.product.status}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void refreshFromAmazon()}
                disabled={resyncing}
              >
                {resyncing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh from Amazon
              </Button>
              <Button
                type="button"
                onClick={() => void createAPlusContent()}
                disabled={creatingAPlus}
              >
                {creatingAPlus ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Create A+ Content
              </Button>
            </div>
          </div>

          {data.product.description ? (
            <p className="mb-4 text-sm text-foreground/80">
              {data.product.description}
            </p>
          ) : null}

          {brandGuides.length > 0 ? (
            <div className="mb-4 flex items-center gap-2 text-sm">
              <label htmlFor="brand-guide" className="text-muted-foreground">
                Brand guide
              </label>
              <select
                id="brand-guide"
                className="rounded border bg-background px-2 py-1 text-sm"
                value={data.product.brandId ?? ''}
                disabled={savingBrand}
                onChange={(e) => void assignBrandGuide(e.target.value)}
              >
                <option value="">None</option>
                {brandGuides.map((guide) => (
                  <option key={guide.brandGuideId} value={guide.brandGuideId}>
                    {guide.name || guide.brandName || 'Untitled brand guide'}
                  </option>
                ))}
              </select>
              {savingBrand ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : null}
              <span className="text-xs text-muted-foreground">
                — used to seed A+ content brand styling
              </span>
            </div>
          ) : null}

          {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

          {notConnected ? (
            <Card className="mb-4 border-amber-300 bg-amber-50">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <p className="text-sm text-amber-900">
                  Amazon isn&apos;t connected. Link your SP-API account to
                  refresh from the catalog.
                </p>
                <Button asChild size="sm" variant="outline">
                  <Link href="/connections">Connect Amazon</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {resyncResult ? (
            <Card className="mb-4 border-emerald-300 bg-emerald-50">
              <CardContent className="py-4 text-sm text-emerald-900">
                Refreshed {resyncResult.updated} listing
                {resyncResult.updated === 1 ? '' : 's'} from{' '}
                {resyncResult.asins} ASIN{resyncResult.asins === 1 ? '' : 's'}.
                {resyncResult.errors.length
                  ? ` ${resyncResult.errors.length} could not be refreshed.`
                  : ''}
              </CardContent>
            </Card>
          ) : null}

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">
                Amazon listings ({data.listings.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.listings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No listings yet. Use “Refresh from Amazon” once this product
                  is linked to a seller SKU.
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Variants ({data.variants.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {data.variants.map((variant) => (
                  <li key={variant.variantId}>
                    <Link
                      href={`/products/${productId}/variants/${variant.variantId}`}
                      className="-mx-2 flex flex-wrap items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted"
                    >
                      <span className="font-medium">
                        {variant.title ||
                          (variant.isDefault ? 'Default variant' : 'Variant')}
                      </span>
                      {variant.options.map((option) => (
                        <span
                          key={`${option.name}:${option.value}`}
                          className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {option.name}: {option.value}
                        </span>
                      ))}
                      {variant.identifiers?.asin ? (
                        <span className="text-xs text-muted-foreground">
                          ASIN {variant.identifiers.asin}
                        </span>
                      ) : null}
                      <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
