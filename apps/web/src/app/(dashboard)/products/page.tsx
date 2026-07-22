'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronDown,
  ChevronRight,
  ImageOff,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type VariantRow = {
  variantId: string;
  title?: string;
  options: { name: string; value: string }[];
  asin?: string;
  imageUrl?: string;
};

type ProductRow = {
  productId: string;
  title: string;
  brandName?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  variants: VariantRow[];
};

function variantLabel(variant: VariantRow): string {
  const fromOptions = variant.options
    .map((option) => option.value)
    .filter(Boolean)
    .join(' / ');
  return fromOptions || variant.title || 'Variant';
}

type SyncSummary = {
  connected: boolean;
  scanned: number;
  productsCreated: number;
  productsMatched: number;
  productsMerged: number;
  listingsUpserted: number;
  truncated: boolean;
  errors: string[];
  message?: string;
};

type StatusFilter = 'all' | 'active' | 'archived' | 'draft';
type SortKey = 'updated' | 'created' | 'title';

const SELECT_CLASS =
  'rounded-md border bg-background px-2 py-2 text-sm text-foreground';

const PAGE_SIZE = 10;

function ProductsList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncSummary | null>(null);
  const [notConnected, setNotConnected] = useState(false);

  // Seed search/filter/sort/page from the URL so the view is shareable and
  // survives navigation. Unknown values fall back to defaults.
  // Product families default to expanded (variants visible inline); users can
  // collapse individual ones. We track the collapsed set, so new/unknown
  // products stay expanded by default.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const value = searchParams.get('status');
    return value === 'active' || value === 'draft' || value === 'archived'
      ? value
      : 'all';
  });
  const [sort, setSort] = useState<SortKey>(() => {
    const value = searchParams.get('sort');
    return value === 'created' || value === 'title' ? value : 'updated';
  });
  const [page, setPage] = useState(() => {
    // URL page is 1-based and human-facing; internal page is 0-based.
    const value = Number.parseInt(searchParams.get('page') ?? '', 10);
    return Number.isFinite(value) && value > 1 ? value - 1 : 0;
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/products');
      const body = (await res.json()) as {
        products?: ProductRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || 'Could not load products.');
      setProducts(body.products ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load products.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Reflect search/filter/sort/page into the URL (debounced, defaults omitted).
  // replace() keeps it out of history so Back still leaves the Products page.
  useEffect(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (sort !== 'updated') params.set('sort', sort);
    if (page > 0) params.set('page', String(page + 1));
    const queryString = params.toString();
    const nextUrl = queryString ? `${pathname}?${queryString}` : pathname;
    const timer = setTimeout(() => {
      router.replace(nextUrl, { scroll: false });
    }, 250);
    return () => clearTimeout(timer);
  }, [search, statusFilter, sort, page, pathname, router]);

  async function syncFromAmazon() {
    if (syncing) return;
    setSyncing(true);
    setError('');
    setSyncResult(null);
    setNotConnected(false);
    try {
      const res = await fetch('/api/products/sync', { method: 'POST' });
      const body = (await res.json()) as SyncSummary & { error?: string };
      if (res.status === 409 && body.connected === false) {
        setNotConnected(true);
        return;
      }
      if (!res.ok) throw new Error(body.error || 'Amazon sync failed.');
      setSyncResult(body);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Amazon sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  async function removeProduct(productId: string) {
    await fetch(`/api/products/${productId}`, { method: 'DELETE' });
    await load();
  }

  // Changing what's shown resets to the first page.
  function updateSearch(value: string) {
    setSearch(value);
    setPage(0);
  }
  function updateStatusFilter(value: StatusFilter) {
    setStatusFilter(value);
    setPage(0);
  }
  function updateSort(value: SortKey) {
    setSort(value);
    setPage(0);
  }

  function toggleCollapsed(productId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  // Search + filter + sort happen client-side: the list is already fully loaded.
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = products.filter((product) => {
      if (statusFilter !== 'all' && product.status !== statusFilter) {
        return false;
      }
      if (!query) return true;
      return (
        product.title.toLowerCase().includes(query) ||
        (product.brandName?.toLowerCase().includes(query) ?? false) ||
        product.variants.some((variant) =>
          variant.options.some((option) =>
            option.value.toLowerCase().includes(query)
          )
        )
      );
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'created') return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });
    return sorted;
  }, [products, search, statusFilter, sort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = visible.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  );

  // If the stored page falls out of range (URL over-shoot, or filtering shrank
  // the set), snap it back once data has loaded — never during the initial load,
  // so a deep-linked ?page= survives until products arrive.
  useEffect(() => {
    if (!loading && page > pageCount - 1) {
      setPage(Math.max(0, pageCount - 1));
    }
  }, [loading, page, pageCount]);

  const filtering = Boolean(search.trim()) || statusFilter !== 'all';

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold">Products</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void syncFromAmazon()}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync from Amazon
          </Button>
          <Button asChild>
            <Link href="/products/new">
              <Plus className="mr-2 h-4 w-4" />
              New product
            </Link>
          </Button>
        </div>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Platform-independent products. Create one manually, or sync your FBA
        catalog from Amazon. Each product owns its variants, listings, and
        assets.
      </p>

      {notConnected ? (
        <Card className="mb-6 border-amber-300 bg-amber-50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm text-amber-900">
              Amazon isn&apos;t connected yet. Link your SP-API account to sync
              products.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/connections">Connect Amazon</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {syncResult ? (
        <Card className="mb-6 border-emerald-300 bg-emerald-50">
          <CardContent className="py-4 text-sm text-emerald-900">
            <p>
              Synced {syncResult.scanned} SKU
              {syncResult.scanned === 1 ? '' : 's'} —{' '}
              {syncResult.productsCreated} added, {syncResult.productsMatched}{' '}
              updated ({syncResult.listingsUpserted} listing
              {syncResult.listingsUpserted === 1 ? '' : 's'}).
            </p>
            {syncResult.productsMerged > 0 ? (
              <p className="mt-1 text-emerald-800">
                Merged {syncResult.productsMerged} duplicate product
                {syncResult.productsMerged === 1 ? '' : 's'} into variation
                families.
              </p>
            ) : null}
            {syncResult.truncated ? (
              <p className="mt-1 text-emerald-800">
                Large catalog — only the first batch was synced. Run sync again
                to continue.
              </p>
            ) : null}
            {syncResult.errors.length ? (
              <p className="mt-1 text-amber-800">
                {syncResult.errors.length} item
                {syncResult.errors.length === 1 ? '' : 's'} could not be synced.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => updateSearch(e.target.value)}
            placeholder="Search title or brand…"
            className="pl-8"
            aria-label="Search products"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => updateStatusFilter(e.target.value as StatusFilter)}
          className={SELECT_CLASS}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
        <select
          value={sort}
          onChange={(e) => updateSort(e.target.value as SortKey)}
          className={SELECT_CLASS}
          aria-label="Sort products"
        >
          <option value="updated">Recently updated</option>
          <option value="created">Recently added</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading
              ? 'Your products'
              : filtering
              ? `${visible.length} of ${products.length} products`
              : `Your products (${products.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : products.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No products yet.{' '}
              <Link href="/products/new" className="underline">
                Add one
              </Link>{' '}
              or sync from Amazon.
            </p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No products match your search or filter.
            </p>
          ) : (
            <>
              <ul className="divide-y">
                {paged.map((product) => {
                  const isFamily = product.variants.length > 1;
                  const isExpanded =
                    isFamily && !collapsed.has(product.productId);
                  return (
                    <li key={product.productId} className="py-2">
                      <div className="flex items-center gap-1">
                        {isFamily ? (
                          <button
                            type="button"
                            onClick={() => toggleCollapsed(product.productId)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted"
                            aria-label={
                              isExpanded
                                ? 'Collapse variants'
                                : 'Expand variants'
                            }
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        ) : (
                          <span className="w-6" />
                        )}
                        <Link
                          href={`/products/${product.productId}`}
                          className="min-w-0 flex-1 rounded px-2 py-1 hover:bg-muted"
                        >
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">
                              {product.title}
                            </p>
                            {isFamily ? (
                              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                {product.variants.length} variants
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {product.brandName ? `${product.brandName} · ` : ''}
                            {product.status}
                          </p>
                        </Link>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Delete ${product.title}`}
                          onClick={() => void removeProduct(product.productId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {isExpanded ? (
                        <ul className="ml-8 mt-1 space-y-0.5 border-l pl-3">
                          {product.variants.map((variant) => (
                            <li key={variant.variantId}>
                              <Link
                                href={`/products/${product.productId}/variants/${variant.variantId}`}
                                className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                              >
                                {variant.imageUrl ? (
                                  <img
                                    src={variant.imageUrl}
                                    alt={variantLabel(variant)}
                                    className="h-8 w-8 shrink-0 rounded border bg-white object-contain"
                                  />
                                ) : (
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border bg-muted">
                                    <ImageOff className="h-3.5 w-3.5 text-muted-foreground" />
                                  </span>
                                )}
                                <span className="truncate text-sm">
                                  {variantLabel(variant)}
                                </span>
                                {variant.asin ? (
                                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                    {variant.asin}
                                  </span>
                                ) : null}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {pageCount > 1 ? (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Page {safePage + 1} of {pageCount}
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
                      onClick={() =>
                        setPage((p) => Math.min(pageCount - 1, p + 1))
                      }
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProductsPage() {
  // useSearchParams() requires a Suspense boundary during prerender.
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        </div>
      }
    >
      <ProductsList />
    </Suspense>
  );
}
