import crypto from 'node:crypto';
import { getCachedSourceFacts, setCachedSourceFacts } from './source-cache';

/**
 * Supplier sourcing search over Alibaba.
 *
 * This is the counterpart to the read-page path, not a replacement: Alibaba's
 * product URLs are read by a URL actor, while THIS actor is search-driven and
 * cannot target a URL. What it does give is a shortlist with the full quantity
 * ladder (bands included), MOQ, lead time, specs and the manufacturer — which
 * is what a sourcing decision actually needs.
 *
 * Pay-per-result, so every search is cached.
 */

const SOURCING_ACTOR = 'zen-studio~alibaba-scraper';
const RESULT_CAP = 25;
const SPEC_CAP = 12;

export type PriceTier = {
  /** Inclusive lower bound of the quantity band. */
  minQuantity: number;
  /** Upper bound, or null for "and above". */
  maxQuantity: number | null;
  price: number;
  formatted: string;
};

export type SupplierProduct = {
  productId?: string;
  url?: string;
  title?: string;
  priceRange?: string;
  tiers: PriceTier[];
  moq?: number;
  unit?: string;
  leadTime?: string;
  supplier?: {
    name?: string;
    country?: string;
    yearsOnPlatform?: string;
    serviceScore?: string;
    profileUrl?: string;
  };
  specs?: Record<string, string>;
  certifications?: string[];
  sampleAvailable?: boolean;
  soldCount?: string;
  reviewScore?: string;
};

export type SourcingSearchParams = {
  keywords: string[];
  maxResults?: number;
  maxMoq?: number;
  minPrice?: number;
  maxPrice?: number;
  supplierCountries?: string[];
  verifiedManufacturerOnly?: boolean;
  tradeAssuranceOnly?: boolean;
  samplesAvailable?: boolean;
  maxDeliveryDays?: number;
  shipToCountry?: string;
  sortBy?: 'relevance' | 'price_asc' | 'price_desc' | 'orders';
};

export type SourcingSearchResult = {
  products: SupplierProduct[];
  error?: string;
  cacheHit?: boolean;
};

function scalar(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

function pick(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = scalar(source[key]);
    if (value) return value;
  }
  return '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseTiers(price: Record<string, unknown>): PriceTier[] {
  const ladder = price['productLadderPrices'];
  if (!Array.isArray(ladder)) return [];
  const tiers: PriceTier[] = [];
  for (const entry of ladder) {
    const record = asRecord(entry);
    const value = Number(record['price'] ?? record['dollarPrice']);
    const min = Number(record['min']);
    if (!Number.isFinite(value) || !Number.isFinite(min)) continue;
    const rawMax = Number(record['max']);
    // The actor encodes "and above" as -1.
    const maxQuantity = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : null;
    tiers.push({
      minQuantity: min,
      maxQuantity,
      price: value,
      formatted: scalar(record['formatPrice']) || `${value}`,
    });
  }
  return tiers.sort((a, b) => a.minQuantity - b.minQuantity);
}

/** `[{minQuantity, maxQuantity, processPeriod}]` → "1-5,000: 25 days". */
function parseLeadTime(trade: Record<string, unknown>): string {
  const list = asRecord(trade['leadTimeInfo'])['ladderPeriodList'];
  if (!Array.isArray(list)) return '';
  return list
    .map((entry) => {
      const record = asRecord(entry);
      const min = scalar(record['minQuantity']);
      const max = scalar(record['maxQuantity']);
      const days = scalar(record['processPeriod']);
      if (!days) return '';
      const band = max && max !== '-1' ? `${min}-${max}` : `${min}+`;
      return `${band}: ${days} days`;
    })
    .filter(Boolean)
    .join('; ');
}

function parseSpecs(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return {};
  const specs: Record<string, string> = {};
  for (const entry of value) {
    const record = asRecord(entry);
    const name = scalar(record['attrName']);
    const attrValue = scalar(record['attrValue']);
    if (!name || !attrValue) continue;
    if (Object.keys(specs).length >= SPEC_CAP) break;
    specs[name] = attrValue;
  }
  return specs;
}

function normalize(item: Record<string, unknown>): SupplierProduct | null {
  const product = asRecord(item['product']);
  const detail = asRecord(item['detail']);
  const supplier = asRecord(item['supplier']);
  const price = asRecord(detail['price']);

  const title = pick(product, ['title', 'name']) || pick(detail, ['title']);
  const url = pick(product, ['url', 'productUrl', 'detailUrl']);
  if (!title && !url) return null;

  const moq = Number(detail['moq']);
  const certifications = Array.isArray(detail['certifications'])
    ? (detail['certifications'] as unknown[]).map(scalar).filter(Boolean)
    : [];

  return {
    productId:
      url.match(/_(\d{10,})\.html/)?.[1] ||
      pick(product, ['id', 'productId']) ||
      undefined,
    url: url || undefined,
    title: title || undefined,
    priceRange: scalar(price['formatLadderPrice']) || undefined,
    tiers: parseTiers(price),
    moq: Number.isFinite(moq) ? moq : undefined,
    unit: scalar(price['unit']) || undefined,
    leadTime: parseLeadTime(asRecord(detail['trade'])) || undefined,
    supplier: {
      name: pick(supplier, ['name']) || undefined,
      country: pick(supplier, ['country']) || undefined,
      yearsOnPlatform: pick(supplier, ['goldSupplierYears']) || undefined,
      serviceScore: pick(supplier, ['serviceScore', 'service']) || undefined,
      profileUrl: pick(supplier, ['profileUrl', 'homeUrl']) || undefined,
    },
    specs: parseSpecs(detail['specs']),
    certifications: certifications.length ? certifications : undefined,
    sampleAvailable: detail['sample'] ? true : undefined,
    soldCount: pick(product, ['soldOrder']) || undefined,
    reviewScore: pick(supplier, ['serviceScore']) || undefined,
  };
}

function cacheKeyFor(input: unknown): string {
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, 32);
  // Shares the source_cache collection; the prefix keeps it clear of page reads.
  return `sourcing::alibaba::${hash}`;
}

/**
 * Search Alibaba for suppliers of a product. Never throws for a failed search —
 * callers get `error` and surface it.
 */
export async function searchAlibabaSuppliers(
  params: SourcingSearchParams,
  timeoutMs = 120_000
): Promise<SourcingSearchResult> {
  const token = process.env['APIFY_TOKEN'];
  if (!token) {
    return { products: [], error: 'No scraping backend is configured.' };
  }
  const keywords = params.keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!keywords.length) {
    return { products: [], error: 'Provide at least one search keyword.' };
  }

  const maxResults = Math.min(Math.max(params.maxResults ?? 10, 1), RESULT_CAP);
  const input = {
    resultType: 'products',
    keywords,
    maxResults,
    shipToCountry: params.shipToCountry ?? 'US',
    sortBy: params.sortBy ?? 'relevance',
    ...(params.maxMoq ? { maxMOQ: params.maxMoq } : {}),
    ...(params.minPrice ? { minPrice: params.minPrice } : {}),
    ...(params.maxPrice ? { maxPrice: params.maxPrice } : {}),
    ...(params.supplierCountries?.length
      ? { supplierCountries: params.supplierCountries }
      : {}),
    ...(params.verifiedManufacturerOnly ? { verifiedManufacturer: true } : {}),
    ...(params.tradeAssuranceOnly ? { tradeAssurance: true } : {}),
    ...(params.samplesAvailable ? { paidSamples: true } : {}),
    ...(params.maxDeliveryDays
      ? { maxDeliveryDays: params.maxDeliveryDays }
      : {}),
  };

  const cacheKey = cacheKeyFor(input);
  const cached = await getCachedSourceFacts<{ products: SupplierProduct[] }>(
    cacheKey
  );
  if (cached?.products?.length) {
    console.log('[sourcing] cache HIT', keywords.join(' | '));
    return { products: cached.products, cacheHit: true };
  }

  const actor = (
    process.env['APIFY_SOURCING_ACTOR_ID'] || SOURCING_ACTOR
  ).replace('/', '~');
  let response: Response;
  try {
    response = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(
        actor
      )}/run-sync-get-dataset-items?format=json&clean=true`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      }
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      products: [],
      error: timedOut
        ? 'The supplier search timed out. Try fewer keywords or fewer results.'
        : 'The supplier search could not be run.',
    };
  }

  if (!response.ok) {
    return {
      products: [],
      error: `The supplier search failed (HTTP ${response.status}).`,
    };
  }

  const body = await response.json();
  if (!Array.isArray(body)) {
    return { products: [], error: 'The supplier search returned no results.' };
  }
  const products = body
    .map((item) => normalize(asRecord(item)))
    .filter((product): product is SupplierProduct => Boolean(product));
  if (!products.length) {
    return {
      products: [],
      error: 'No suppliers matched. Try broader keywords or relax the filters.',
    };
  }

  void setCachedSourceFacts(cacheKey, { products });
  return { products };
}
