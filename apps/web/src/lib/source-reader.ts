import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { stripHtmlToText } from './brand-guide-extraction';
import { spApiClientFor } from './amazon-clients';
import { listAmazonConnections } from './amazon-connections';
import { getCachedSourceFacts, setCachedSourceFacts } from './source-cache';
import { withPaidCall } from './cost-ledger';
import { loggerFor } from './logger';
const log = loggerFor('source-reader');

/**
 * Reads a public product/supplier page and distills it to facts plus readable
 * text. Two paths: a direct fetch parsed for JSON-LD/meta/heuristics, and an
 * Apify actor run for sites that render client-side or block bots (Alibaba,
 * 1688, Amazon). Amazon URLs prefer authoritative SP-API catalog data when the
 * seller has a connected profile.
 *
 * Shared by the A+ source-extract route and the chat agent's read-page tool —
 * both hit the same Couchbase cache, so an Apify run is paid for once.
 */

export type ExtractionSource =
  | 'structured-data'
  | 'meta-tags'
  | 'heuristic'
  | 'sp-api-catalog'
  | 'alibaba-product';

export type ExtractedProductFacts = {
  productName?: string;
  brandName?: string;
  asin?: string;
  oneLiner?: string;
  pricePoint?: string;
  features: string[];
  differentiators: string[];
  warnings: string[];
  evidence: string[];
  finalUrl?: string;
  extractionSource: ExtractionSource;
};

type ApifyDatasetItem = Record<string, unknown>;

const AUTH_HINTS = [
  'sign in',
  'sign-in',
  'log in',
  'login',
  'create account',
  'subscribe',
  'subscription',
  'paywall',
  'captcha',
  'verify you are human',
  'access denied',
];

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.startsWith('local.') ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (version === 6) {
    const host = address.toLowerCase();
    if (host === '::' || host === '::1') return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
    // IPv4-mapped — check the embedded v4 address.
    const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  return false;
}

/**
 * Reject anything that is not a public http(s) endpoint. URLs reach this
 * module from model tool calls and user input, so a hostname string check is
 * not enough — resolve it and inspect the addresses too (a public name can
 * point at 169.254.169.254 or a VPC address).
 */
async function assertPublicUrl(url: URL): Promise<void> {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only public http(s) URLs can be read.');
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error('Only public http(s) URLs can be read.');
  }
  const literal = isIP(url.hostname.replace(/^\[|\]$/g, ''));
  if (literal) {
    if (isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
      throw new Error('Only public http(s) URLs can be read.');
    }
    return;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw new Error('Could not resolve that host.');
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error('Only public http(s) URLs can be read.');
  }
}

const MAX_REDIRECTS = 5;

/**
 * fetch() with every redirect hop re-validated — `redirect: 'follow'` would
 * happily walk a public URL into an internal one.
 */
async function safeFetch(
  startUrl: URL,
  init: { headers: Record<string, string>; timeoutMs: number }
): Promise<Response> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(init.timeoutMs),
      headers: init.headers,
    });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    if (!location) return response;
    try {
      url = new URL(location, url);
    } catch {
      throw new Error('Followed an invalid redirect.');
    }
  }
  throw new Error('Too many redirects.');
}

function isAmazonHost(hostname: string) {
  return hostname.toLowerCase().includes('amazon.');
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values: Array<string | undefined | null>, limit = 8) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = decodeHtml(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned || cleaned.length < 3) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function matchContent(html: string, regex: RegExp) {
  const match = html.match(regex);
  return match?.[1] ? decodeHtml(match[1]) : undefined;
}

function metaContent(html: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        'i'
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
        'i'
      ),
    ];
    for (const pattern of patterns) {
      const value = matchContent(html, pattern);
      if (value) return value;
    }
  }
  return undefined;
}

function collectJsonLd(html: string) {
  const blocks = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
  );
  if (!blocks) return [];

  const parsed: unknown[] = [];
  for (const block of blocks) {
    const jsonText = block
      .replace(/^<script[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();
    try {
      const value = JSON.parse(jsonText);
      parsed.push(value);
    } catch {
      // Ignore malformed structured data.
    }
  }
  return parsed;
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => flattenJsonLd(item));
  if (typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  const graph = record['@graph'];
  return [record, ...flattenJsonLd(graph)];
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return textValue(record.name) || textValue(record.value);
  }
  return undefined;
}

function arrayTextValues(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value))
    return value.flatMap((item) => arrayTextValues(item));
  const text = textValue(value);
  return text ? [text] : [];
}

function isProductNode(node: Record<string, unknown>) {
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some(
    (item) => typeof item === 'string' && item.toLowerCase().includes('product')
  );
}

function extractListItems(html: string, patterns: RegExp[]) {
  const values: string[] = [];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      values.push(stripHtmlToText(match[1] || ''));
    }
  }
  return unique(values, 10);
}

function normalizeAsin(value: string | undefined) {
  const candidate = value?.trim().toUpperCase();
  return candidate && /^[A-Z0-9]{10}$/.test(candidate) ? candidate : undefined;
}

const PRODUCT_SELECTOR_PARAMS = new Set([
  'variant',
  'sku',
  'color',
  'colour',
  'size',
  'id',
  'pid',
  'product_id',
  'productid',
  'item',
  'model',
]);

function cleanUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const host = url.hostname.toLowerCase();
  url.hash = '';

  if (host.includes('amazon.')) {
    url.pathname = url.pathname
      .split('/')
      .filter((segment) => !/^ref=/i.test(segment))
      .join('/');
    url.search = '';
    return url.toString();
  }

  for (const key of [...url.searchParams.keys()]) {
    if (!PRODUCT_SELECTOR_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  return url.toString();
}

function extractProductName(
  title: string | undefined,
  finalUrl: string
): string | undefined {
  if (!title) return undefined;
  let cleaned = title.replace(/\s+/g, ' ').trim();

  let isAmazon = false;
  try {
    isAmazon = new URL(finalUrl).hostname.toLowerCase().includes('amazon.');
  } catch {
    /* ignore */
  }

  if (isAmazon) {
    cleaned = cleaned.replace(/^Amazon\.[a-z.]+\s*:\s*/i, '');
    cleaned = cleaned.replace(/\s*:\s*[^:]+$/, '');
    if (cleaned.length > 90) {
      const firstSegment = cleaned.split(/\s+-\s+/)[0]?.trim();
      if (firstSegment && firstSegment.length >= 10) {
        cleaned = firstSegment;
      }
    }
  }

  return cleaned || undefined;
}

function formatPrice(
  price: string | undefined,
  currency: string | undefined
): string | undefined {
  if (!price) return undefined;
  const numeric = Number(String(price).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric)) return undefined;
  const code = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).format(numeric);
  } catch {
    return `${code} ${numeric.toFixed(2)}`;
  }
}

function extractAsinFromAmazonUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();
  if (!host.includes('amazon.')) return undefined;

  const pathSegments = url.pathname
    .split('/')
    .map((segment) => decodeURIComponent(segment).trim())
    .filter(Boolean);

  const productRouteMarkers = new Set([
    'dp',
    'gp/product',
    'product',
    'exec/obidos/asin',
  ]);

  for (let index = 0; index < pathSegments.length; index += 1) {
    const segment = pathSegments[index]?.toLowerCase();
    const twoSegmentMarker = `${segment}/${pathSegments[
      index + 1
    ]?.toLowerCase()}`;
    if (productRouteMarkers.has(segment || '')) {
      const asin = normalizeAsin(pathSegments[index + 1]);
      if (asin) return asin;
    }
    if (productRouteMarkers.has(twoSegmentMarker)) {
      const asin = normalizeAsin(pathSegments[index + 2]);
      if (asin) return asin;
    }
  }

  for (const param of ['asin', 'ASIN', 'psc']) {
    const asin = normalizeAsin(url.searchParams.get(param) || undefined);
    if (asin) return asin;
  }

  return undefined;
}

function extractAsin(html: string, text: string, finalUrl: string) {
  return (
    extractAsinFromAmazonUrl(finalUrl) ||
    extractAsinFromAmazonUrl(
      matchContent(
        html,
        /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i
      ) || ''
    ) ||
    normalizeAsin(
      metaContent(html, ['asin', 'ASIN', 'product:retailer_item_id'])
    ) ||
    normalizeAsin(
      matchContent(html, /["'](?:asin|ASIN)["']\s*:\s*["']([A-Z0-9]{10})["']/)
    ) ||
    normalizeAsin(matchContent(text, /\bASIN\b\s*[:-]?\s*([A-Z0-9]{10})\b/i))
  );
}

function splitDescriptionIntoFeatures(
  description: string | undefined
): string[] {
  if (!description) return [];
  const candidates = description
    .split(/(?:\r?\n|•|·|•|\.\s+(?=[A-Z]))/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 20 && segment.length <= 240);
  return candidates;
}

function extractFacts(html: string, finalUrl: string): ExtractedProductFacts {
  const text = stripHtmlToText(html).slice(0, 80_000);
  const lowerText = text.toLowerCase();
  const warnings = AUTH_HINTS.some((hint) => lowerText.includes(hint))
    ? [
        'This page may be partially gated by login, subscription, captcha, or anti-bot checks.',
      ]
    : [];

  let isAmazonFinalUrl = false;
  try {
    isAmazonFinalUrl = new URL(finalUrl).hostname
      .toLowerCase()
      .includes('amazon.');
  } catch {
    /* leave false */
  }

  const nodes = collectJsonLd(html).flatMap((block) => flattenJsonLd(block));
  const productNode = nodes.find(isProductNode);
  const offer =
    productNode && typeof productNode.offers === 'object'
      ? ((Array.isArray(productNode.offers)
          ? productNode.offers[0]
          : productNode.offers) as Record<string, unknown>)
      : undefined;

  const ogTitle = metaContent(html, ['og:title', 'twitter:title']);
  const ogDescription = metaContent(html, [
    'description',
    'og:description',
    'twitter:description',
  ]);

  const rawTitle =
    textValue(productNode?.name) ||
    ogTitle ||
    matchContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const cleanedFinalUrl = cleanUrl(finalUrl);
  const title = extractProductName(rawTitle, finalUrl);
  const description = textValue(productNode?.description) || ogDescription;
  const brand =
    textValue(productNode?.brand) ||
    matchContent(html, /(?:Brand|By)\s*[:-]\s*([A-Z][A-Za-z0-9&'. -]{2,60})/);
  const asin = extractAsin(html, text, finalUrl);

  const structuredHtmlPrice =
    matchContent(html, /["']price["']\s*:\s*["']?(\d+(?:\.\d{2})?)["']?/i) ||
    matchContent(html, /data-price=["'](\d+(?:\.\d{2})?)["']/i) ||
    matchContent(
      html,
      /<[^>]+(?:class|id)=["'][^"']*price[^"']*["'][^>]*>\s*[^<]*?\$(\d+(?:\.\d{2})?)/i
    );

  const price =
    textValue(offer?.price) ||
    metaContent(html, ['product:price:amount', 'og:price:amount']) ||
    structuredHtmlPrice ||
    matchContent(text, /(?:\$|USD\s*)(\d{1,5}\.\d{2})/i);
  const currency =
    textValue(offer?.priceCurrency) ||
    metaContent(html, ['product:price:currency']);
  const formattedPrice = formatPrice(price, currency);

  const jsonFeatures = unique(
    [
      ...arrayTextValues(productNode?.featureList),
      ...arrayTextValues(productNode?.additionalProperty),
    ],
    10
  );

  const featurePatterns: RegExp[] = [
    /<li[^>]*class=["'][^"']*(?:feature|bullet|benefit|highlight)[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
  ];
  if (isAmazonFinalUrl) {
    featurePatterns.push(/<li[^>]*>([^<]{20,240})<\/li>/gi);
  }
  const htmlFeatures = extractListItems(html, featurePatterns);

  const descriptionFeatures =
    !isAmazonFinalUrl && jsonFeatures.length === 0 && htmlFeatures.length === 0
      ? splitDescriptionIntoFeatures(description)
      : [];

  const features = unique(
    [...jsonFeatures, ...htmlFeatures, ...descriptionFeatures],
    8
  );

  let extractionSource: ExtractionSource;
  if (productNode) {
    extractionSource = 'structured-data';
  } else if (ogTitle || ogDescription) {
    extractionSource = 'meta-tags';
  } else {
    extractionSource = 'heuristic';
  }

  if (extractionSource === 'heuristic') {
    warnings.push(
      'Extracted facts came from page heuristics (no structured data or meta tags found). Review carefully.'
    );
  }

  const descriptionForEvidence =
    description && title && description.trim() === rawTitle?.trim()
      ? undefined
      : description;

  const evidence = unique(
    [
      title ? `Title: ${title}` : null,
      descriptionForEvidence ? `Description: ${descriptionForEvidence}` : null,
      brand ? `Brand: ${brand}` : null,
      asin ? `ASIN: ${asin}` : null,
      formattedPrice ? `Price: ${formattedPrice}` : null,
      ...features.slice(0, 5).map((feature) => `Feature: ${feature}`),
    ],
    12
  );

  return {
    productName: title,
    brandName: brand,
    asin,
    oneLiner: description,
    pricePoint: formattedPrice,
    features,
    differentiators: features.slice(0, 4),
    warnings,
    evidence,
    finalUrl: cleanedFinalUrl,
    extractionSource,
  };
}

/**
 * Alibaba product pages need a purpose-built actor: the generic e-commerce
 * actor only reads the page's schema.org block, which carries ONE price — and
 * it is the cheapest tier, so margin math built on it understates unit cost at
 * low volume. This actor returns the tier prices, MOQ, lead-time table and the
 * real supplier. Overridable per deployment.
 */
const ALIBABA_ACTOR = 'happitap~alibaba-product-scraper';
const ECOMMERCE_ACTOR_ID = '2APbAvDfNDOWXbkWf';

type ApifyPlan = {
  actorPath: string;
  input: unknown;
  kind: 'alibaba-product' | 'ecommerce' | 'content-crawler';
};

function isAlibabaProductUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.toLowerCase().includes('alibaba.') &&
      /\/product-detail\//i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function apifyPlan(url: string): ApifyPlan {
  if (isAlibabaProductUrl(url)) {
    return {
      actorPath: (
        process.env['APIFY_ALIBABA_ACTOR_ID'] || ALIBABA_ACTOR
      ).replace('/', '~'),
      input: { startUrls: [{ url }] },
      kind: 'alibaba-product',
    };
  }

  const actorId =
    process.env['APIFY_SOURCE_ACTOR_ID'] ||
    process.env['APIFY_ACTOR_ID'] ||
    'apify~website-content-crawler';

  if (actorId === ECOMMERCE_ACTOR_ID) {
    return {
      actorPath: actorId,
      kind: 'ecommerce',
      input: {
        scrapeMode: 'AUTO',
        detailsUrls: [{ url }],
        maxProductResults: 1,
        additionalProperties: true,
        additionalReviewProperties: false,
        scrapeReviewsFromGoogleShopping: false,
        scrapeSellersFromGoogleShopping: false,
        scrapeInfluencerProducts: false,
        scrapeProductsFromGoogleShopping: false,
      },
    };
  }

  return {
    actorPath: actorId.replace('/', '~'),
    kind: 'content-crawler',
    input: {
      startUrls: [{ url }],
      maxCrawlPages: 1,
      maxCrawlDepth: 0,
      maxResults: 1,
      saveHtml: true,
      saveMarkdown: true,
      saveScreenshots: false,
    },
  };
}

/**
 * Scalars only. Numbers count: actors return `offers.price` as 4.3, and a
 * string-only check silently threw the price away.
 */
function scalarText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function itemString(item: ApifyDatasetItem, keys: string[]) {
  for (const key of keys) {
    const value = scalarText(item[key]);
    if (value) return value;
  }
  return '';
}

function nestedItemString(item: ApifyDatasetItem, path: string[]) {
  let current: unknown = item;
  for (const key of path) {
    if (!current || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[key];
  }
  return scalarText(current);
}

/** Marketplaces whose real terms (price breaks, MOQ) are client-side rendered. */
const TIERED_PRICING_HOSTS = ['alibaba.', '1688.', 'made-in-china.'];

function hasTieredPricing(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return TIERED_PRICING_HOSTS.some((fragment) => host.includes(fragment));
  } catch {
    return false;
  }
}

/**
 * Scalar and shallow-nested scalar fields the actor returned, flattened to a
 * label→value map. The old code funnelled everything through synthetic HTML,
 * which kept only what `extractFacts` happened to look for and dropped the
 * rest (sku, rating, availability, categories) on the floor.
 */
function commerceDetails(item: ApifyDatasetItem): Record<string, string> {
  const details: Record<string, string> = {};
  const add = (label: string, value: string) => {
    if (value && !details[label]) details[label] = value;
  };

  for (const [key, value] of Object.entries(item)) {
    if (key === 'description' || key === 'name' || key === 'title') continue;
    const scalar = scalarText(value);
    if (scalar && scalar.length <= 200) {
      add(key, scalar);
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const [nestedKey, nestedValue] of Object.entries(
      value as Record<string, unknown>
    )) {
      const nested = scalarText(nestedValue);
      if (nested && nested.length <= 200) add(`${key}.${nestedKey}`, nested);
    }
  }
  return details;
}

/** `[["Quantity (pieces)","1 - 10,000","> 10,000"],["Lead time (days)","45","-"]]` */
function formatLeadTimeTable(value: unknown): string {
  if (!Array.isArray(value) || value.length < 2) return '';
  const [quantities, days] = value;
  if (!Array.isArray(quantities) || !Array.isArray(days)) return '';
  const pairs: string[] = [];
  for (let i = 1; i < quantities.length; i++) {
    const qty = scalarText(quantities[i]);
    const lead = scalarText(days[i]);
    if (!qty || !lead) continue;
    // Cells are not always numeric ("To be negotiated") — don't suffix those.
    pairs.push(/^\d/.test(lead) ? `${qty} → ${lead} days` : `${qty} → ${lead}`);
  }
  return pairs.join('; ');
}

/** Unique tier prices, cheapest last, from `[{range, price}]`. */
function formatPriceTiers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tiers: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const price = scalarText(record['price']);
    const range = scalarText(record['range']);
    if (!price) continue;
    // Some actors echo the price into `range`; only keep a real quantity band.
    const band = range && range !== price ? `${range}: ${price}` : price;
    if (seen.has(band)) continue;
    seen.add(band);
    tiers.push(band);
  }
  return tiers;
}

/**
 * Map the Alibaba product actor's output. Distinct from the generic mapper
 * because the fields that matter for sourcing — tier prices, MOQ, lead time,
 * the manufacturer — have no equivalent in schema.org product data.
 */
function factsFromAlibabaItem(
  item: ApifyDatasetItem,
  sourceUrl: string
): {
  facts: ExtractedProductFacts;
  text: string;
  details: Record<string, string>;
} {
  const finalUrl = itemString(item, ['url', 'productUrl']) || sourceUrl;
  const title = itemString(item, ['title', 'name']);
  const description = itemString(item, ['description']);
  const moq = itemString(item, ['minOrderQuantity', 'moq']);
  const tiers = formatPriceTiers(item['prices']);
  const leadTime = formatLeadTimeTable(item['leadTime']);

  const specs: string[] = [];
  const specSource = item['specifications'] ?? item['details'];
  if (
    specSource &&
    typeof specSource === 'object' &&
    !Array.isArray(specSource)
  ) {
    for (const [key, value] of Object.entries(
      specSource as Record<string, unknown>
    )) {
      const text = scalarText(value);
      if (text && text.length <= 160) specs.push(`${key}: ${text}`);
    }
  }

  const supplier = (
    item['supplier'] && typeof item['supplier'] === 'object'
      ? item['supplier']
      : {}
  ) as Record<string, unknown>;

  const details: Record<string, string> = {};
  const add = (label: string, value: string) => {
    if (value) details[label] = value;
  };
  add('productId', itemString(item, ['productId']));
  add('minOrderQuantity', moq);
  add('priceTiers', tiers.join(' | '));
  add('leadTime', leadTime);
  add('supplier', scalarText(supplier['name']));
  add('supplierLocation', scalarText(supplier['location']));
  add('supplierYears', scalarText(supplier['yearsInBusiness']));
  add('tradeAssurance', scalarText(supplier['hasTradeAssurance']));
  add('verifiedSupplier', scalarText(supplier['isVerified']));
  add('rating', itemString(item, ['rating']));
  add('reviewCount', itemString(item, ['reviewCount']));
  add('soldCount', itemString(item, ['soldCount']));
  const certifications = arrayTextValues(item['certifications']);
  add('certifications', certifications.join(', '));

  const warnings: string[] = ['Read via the Alibaba product scraper.'];
  if (tiers.length && !tiers.some((tier) => tier.includes(':'))) {
    warnings.push(
      'The tier PRICES came through but not the quantity band each one applies ' +
        'to. Treat the highest price as the MOQ price and confirm the bands with ' +
        'the supplier before using a lower tier in margin math.'
    );
  }
  if (!tiers.length) {
    warnings.push(
      'No quantity price breaks were captured — ask the user for the tier table.'
    );
  }

  const text = [
    title,
    moq ? `Minimum order quantity: ${moq}` : '',
    tiers.length ? `Price tiers: ${tiers.join(' | ')}` : '',
    leadTime ? `Lead time: ${leadTime}` : '',
    details['supplier'] ? `Supplier: ${details['supplier']}` : '',
    certifications.length ? `Certifications: ${certifications.join(', ')}` : '',
    specs.length ? `Specifications:\n${specs.join('\n')}` : '',
    description,
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    facts: {
      productName: title || undefined,
      brandName: undefined,
      oneLiner: description || undefined,
      // Highest tier = the MOQ price, the only one a small first order can buy.
      pricePoint: tiers[0] || undefined,
      features: unique(specs, 8),
      differentiators: [],
      warnings: unique(warnings, 4),
      evidence: unique(
        [
          title ? `Title: ${title}` : null,
          moq ? `MOQ: ${moq}` : null,
          tiers.length ? `Tiers: ${tiers.join(' | ')}` : null,
          leadTime ? `Lead time: ${leadTime}` : null,
          details['supplier'] ? `Supplier: ${details['supplier']}` : null,
          ...specs.slice(0, 6),
        ],
        12
      ),
      finalUrl,
      extractionSource: 'alibaba-product',
    },
    text,
    details,
  };
}

function factsFromApifyItem(
  item: ApifyDatasetItem,
  sourceUrl: string
): {
  facts: ExtractedProductFacts;
  text: string;
  details: Record<string, string>;
} {
  const finalUrl =
    itemString(item, ['url', 'productUrl', 'loadedUrl', 'requestedUrl']) ||
    sourceUrl;
  const title = itemString(item, ['name', 'title', 'productName', 'pageTitle']);
  const description =
    itemString(item, ['description', 'productDescription']) ||
    nestedItemString(item, ['metadata', 'description']);
  const brand = itemString(item, ['brand', 'manufacturer']);
  const sku = itemString(item, ['sku', 'asin', 'productId']);
  const price =
    itemString(item, ['price', 'currentPrice']) ||
    nestedItemString(item, ['offers', 'price']);
  const currency =
    itemString(item, ['priceCurrency', 'currency']) ||
    nestedItemString(item, ['offers', 'priceCurrency']);
  const featureText = [
    item['features'],
    item['bullets'],
    item['highlights'],
    item['additionalProperties'],
  ]
    .flatMap((value) => arrayTextValues(value))
    .join('\n');
  const html = itemString(item, ['html', 'contentHtml']);
  const markdown = itemString(item, ['markdown', 'text', 'content', 'body']);

  const syntheticHtml = [
    title ? `<title>${title}</title>` : '',
    description ? `<meta name="description" content="${description}">` : '',
    brand ? `<meta name="brand" content="${brand}">` : '',
    sku ? `<meta name="asin" content="${sku}">` : '',
    price ? `<meta name="product:price:amount" content="${price}">` : '',
    currency
      ? `<meta name="product:price:currency" content="${currency}">`
      : '',
    featureText,
    html,
    markdown,
  ].join('\n');

  const facts = extractFacts(syntheticHtml, finalUrl);
  const details = commerceDetails(item);

  // Prefer the actor's own rendered text. Actors that return only structured
  // fields (no markdown/html) used to yield an EMPTY text body, so a caller saw
  // nothing but the title — build a fact sheet from the fields instead.
  const detailSheet = Object.entries(details)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
  const text =
    markdown ||
    stripHtmlToText(html) ||
    [description, featureText, detailSheet].filter(Boolean).join('\n\n');

  const warnings = [
    ...facts.warnings,
    'Used Apify fallback to read this source.',
  ];
  // Say what is missing rather than letting a single schema.org price stand in
  // for a quote: on these marketplaces the tier table and MOQ are the terms.
  if (hasTieredPricing(finalUrl)) {
    const sawTiers = /min\.?\s*order|moq|pieces?\s*\/|tier/i.test(
      `${markdown} ${detailSheet}`
    );
    if (!sawTiers) {
      warnings.push(
        'Quantity price breaks, MOQ, and lead time are rendered client-side on ' +
          'this marketplace and were NOT captured. Any single price here is the ' +
          "listing's headline figure, not a quote — ask the user for the tier table."
      );
    }
  }

  return {
    facts: { ...facts, warnings: unique(warnings, 5) },
    text,
    details,
  };
}

async function extractWithApify(
  url: string,
  owner: { userId: string; chatId?: string },
  timeoutMs = 55_000
) {
  const token = process.env['APIFY_TOKEN'];
  if (!token) return null;

  const plan = apifyPlan(url);
  // One actor run per page read; the cap check runs before it starts.
  return withPaidCall(
    {
      userId: owner.userId,
      chatId: owner.chatId,
      feature: 'page-read',
      vendor: 'apify',
      operation: plan.actorPath,
      expectedUnits: 1,
    },
    async (report) => {
      const response = await fetch(
        `https://api.apify.com/v2/acts/${encodeURIComponent(
          plan.actorPath
        )}/run-sync-get-dataset-items?format=json&clean=true`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(plan.input),
        }
      );

      if (!response.ok) {
        return {
          error: `Apify fallback failed (HTTP ${response.status}).`,
        };
      }

      const items = (await response.json()) as ApifyDatasetItem[];
      const firstItem = Array.isArray(items)
        ? items.find((item) => item && typeof item === 'object')
        : undefined;
      if (!firstItem) {
        return {
          error: 'Apify fallback did not return readable page content.',
        };
      }

      report(1);
      return plan.kind === 'alibaba-product'
        ? factsFromAlibabaItem(firstItem, url)
        : factsFromApifyItem(firstItem, url);
    }
  );
}

type CatalogItemResult = {
  summaries?: Array<{
    itemName?: string;
    brand?: string;
    manufacturer?: string;
  }>;
  attributes?: Record<string, Array<{ value?: unknown }>>;
  images?: Array<{ images?: Array<{ link?: string; variant?: string }> }>;
  productTypes?: Array<{ productType?: string }>;
};

// A+-useful single-value catalog attributes → human labels. Surfaced into the
// notes the generator reads. (Name/brand/bullets/description handled separately.)
const CATALOG_ATTR_LABELS: Array<[string, string]> = [
  ['material', 'Material'],
  ['fabric_type', 'Fabric'],
  ['color', 'Color'],
  ['finish_type', 'Finish'],
  ['style', 'Style'],
  ['pattern', 'Pattern'],
  ['item_shape', 'Shape'],
  ['item_form', 'Form'],
  ['size', 'Size'],
  ['capacity', 'Capacity'],
  ['number_of_items', 'Number of items'],
  ['unit_count', 'Unit count'],
  ['item_package_quantity', 'Package quantity'],
  ['special_feature', 'Special features'],
  ['included_components', 'Included components'],
  ['recommended_uses_for_product', 'Recommended uses'],
  ['specific_uses_for_product', 'Specific uses'],
  ['target_audience_keyword', 'Target audience'],
  ['age_range_description', 'Age range'],
  ['occasion', 'Occasion'],
  ['theme', 'Theme'],
  ['scent', 'Scent'],
  ['flavor', 'Flavor'],
  ['model_number', 'Model'],
  ['part_number', 'Part number'],
  ['manufacturer', 'Manufacturer'],
  ['country_of_origin', 'Country of origin'],
  ['warranty_description', 'Warranty'],
];

function catalogAttrValues(
  attributes: CatalogItemResult['attributes'],
  key: string
): string[] {
  const raw = attributes?.[key];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) =>
      typeof entry?.value === 'string' ? entry.value.trim() : ''
    )
    .filter(Boolean);
}

// Like catalogAttrValues but also accepts numeric {value, unit} measurements.
function catalogAttrText(
  attributes: CatalogItemResult['attributes'],
  key: string
): string[] {
  const raw = attributes?.[key];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const value = (entry as { value?: unknown })?.value;
    const unit = (entry as { unit?: unknown })?.unit;
    if (typeof value === 'string' && value.trim()) out.push(value.trim());
    else if (typeof value === 'number' && Number.isFinite(value)) {
      out.push(typeof unit === 'string' ? `${value} ${unit}` : String(value));
    }
  }
  return [...new Set(out)];
}

// Format a nested dimensions attribute (length/width/height leaves with units).
function catalogDimensions(
  attributes: CatalogItemResult['attributes'],
  key: string
): string | null {
  const entry = attributes?.[key]?.[0] as
    | Record<string, { value?: unknown; unit?: unknown }>
    | undefined;
  if (!entry || typeof entry !== 'object') return null;
  const part = (k: string) => {
    const leaf = entry[k];
    if (!leaf || typeof leaf.value !== 'number') return null;
    return typeof leaf.unit === 'string'
      ? `${leaf.value} ${leaf.unit}`
      : String(leaf.value);
  };
  const dims = ['length', 'width', 'height']
    .map(part)
    .filter((d): d is string => Boolean(d));
  return dims.length ? dims.join(' × ') : null;
}

/**
 * Authoritative product facts from SP-API Catalog Items for an Amazon product
 * URL, when the seller has a connected SP-API profile. Returns null when the
 * URL isn't an Amazon ASIN, no SP-API profile is connected/usable, or the
 * lookup yields nothing — callers then fall back to page scraping.
 */
async function extractFromAmazonCatalog(
  rawUrl: string,
  userId: string
): Promise<ExtractedProductFacts | null> {
  const asin = extractAsinFromAmazonUrl(rawUrl);
  if (!asin) return null;

  const connections = await listAmazonConnections({
    apiType: 'SP_API',
    userId,
  });
  const connection = connections.find((c) => c.missing.length === 0);
  if (!connection) return null;

  const { profile } = connection;
  const marketplaceId =
    profile.marketplace_id ||
    process.env['SP_MARKETPLACE_ID'] ||
    'ATVPDKIKX0DER';

  const client = await spApiClientFor(connection, { marketplaceId });

  const item = (await client.getCatalogItem(asin, {
    marketplaceIds: [marketplaceId],
    includedData: ['summaries', 'attributes', 'images', 'productTypes'],
  })) as CatalogItemResult;

  const summary = item.summaries?.[0];
  const productName =
    summary?.itemName?.trim() ||
    catalogAttrValues(item.attributes, 'item_name')[0];
  if (!productName) return null;

  const brandName =
    summary?.brand?.trim() ||
    catalogAttrValues(item.attributes, 'brand')[0] ||
    summary?.manufacturer?.trim() ||
    undefined;

  const features = catalogAttrValues(item.attributes, 'bullet_point').slice(
    0,
    8
  );
  const descriptionRaw =
    catalogAttrValues(item.attributes, 'product_description')[0] || '';
  const oneLiner =
    (descriptionRaw ? stripHtmlToText(descriptionRaw) : '').trim() ||
    features[0] ||
    undefined;

  const officialImageCount = new Set(
    (item.images?.[0]?.images || [])
      .map((img) => img?.link)
      .filter((link): link is string => Boolean(link))
  ).size;

  // Surface the rich product attributes (material, color, pack size, uses,
  // dimensions, etc.) into the notes the generator reads.
  const attributeEvidence: string[] = [];
  for (const [key, label] of CATALOG_ATTR_LABELS) {
    const values = catalogAttrText(item.attributes, key);
    if (values.length) attributeEvidence.push(`${label}: ${values.join(', ')}`);
  }
  const itemDims = catalogDimensions(item.attributes, 'item_dimensions');
  if (itemDims) attributeEvidence.push(`Item dimensions: ${itemDims}`);
  const pkgDims = catalogDimensions(item.attributes, 'item_package_dimensions');
  if (pkgDims) attributeEvidence.push(`Package dimensions: ${pkgDims}`);

  const productType = item.productTypes?.[0]?.productType;

  const evidence = [
    `Title: ${productName}`,
    brandName ? `Brand: ${brandName}` : null,
    `ASIN: ${asin}`,
    productType ? `Product type: ${productType}` : null,
    ...features.map((feature) => `Feature: ${feature}`),
    ...attributeEvidence,
    officialImageCount
      ? `${officialImageCount} official product image${
          officialImageCount === 1 ? '' : 's'
        } available from Amazon.`
      : null,
  ].filter((line): line is string => Boolean(line));

  return {
    productName,
    brandName,
    asin,
    oneLiner,
    // Price intentionally omitted — A+ content never uses it.
    features,
    differentiators: features.slice(0, 4),
    warnings: [],
    evidence,
    finalUrl: rawUrl,
    extractionSource: 'sp-api-catalog',
  };
}

/** What a read produced: facts, readable text, or a reason it failed. */
export type SourceReadResult = {
  facts?: ExtractedProductFacts;
  /** Readable page text (plain text or the actor's markdown), untruncated. */
  text?: string;
  /** Scalar commerce fields the scraper returned (price, sku, rating, ...). */
  details?: Record<string, string>;
  error?: string;
  httpStatus?: number;
  finalUrl?: string;
  apifyConfigured: boolean;
  cacheHit?: boolean;
};

/**
 * Bump whenever extraction changes what a read can produce (a new actor, a new
 * mapper, a new field). Entries written by an older reader are treated as
 * misses, so an improvement takes effect immediately instead of waiting out a
 * 24h TTL on results the previous code was incapable of getting.
 */
const READER_VERSION = 2;

/** Shape stored in the shared source cache. */
type CachedSource = {
  readerVersion?: number;
  facts: ExtractedProductFacts;
  text?: string;
  details?: Record<string, string>;
};

/** A read this thin is a failure in substance — don't let it squat for a day. */
const WEAK_CACHE_TTL_SECONDS = 15 * 60;

function isWeakExtraction(
  facts: ExtractedProductFacts,
  details?: Record<string, string>
): boolean {
  // A bot-wall page still yields a <title> and meta description, which looks
  // like a successful extraction and is worthless for sourcing.
  const thin =
    (facts.extractionSource === 'meta-tags' ||
      facts.extractionSource === 'heuristic') &&
    !facts.features.length &&
    !facts.pricePoint;
  const gated = facts.warnings.some((warning) =>
    /login|subscription|captcha|anti-bot|partially gated|not captured/i.test(
      warning
    )
  );
  const marketplaceWithoutTerms =
    hasTieredPricing(facts.finalUrl ?? '') && !details?.['priceTiers'];
  return thin || gated || marketplaceWithoutTerms;
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (compatible; SellAvantSourceExtractor/1.0; +https://sellavant.com)',
  Accept:
    'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
};

/**
 * Read a public page. Order: cache → SP-API catalog (Amazon URLs with a
 * connected profile) → direct fetch → Apify. Never throws for an unreadable
 * page — callers get `error` and decide how to surface it.
 */
export async function readSourcePage(params: {
  url: string;
  userId: string;
  /** Attributes the spend to a conversation in the ledger. */
  chatId?: string;
  /** Cap the Apify sync run; keep under the caller's own timeout. */
  apifyTimeoutMs?: number;
}): Promise<SourceReadResult> {
  const apifyConfigured = Boolean(process.env['APIFY_TOKEN']);

  let url: URL;
  try {
    url = new URL(params.url);
  } catch {
    return { error: 'Enter a valid source URL.', apifyConfigured };
  }
  try {
    await assertPublicUrl(url);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Only public http(s) source URLs can be read.',
      apifyConfigured,
    };
  }

  const cacheKeyUrl = cleanUrl(url.toString());
  const cached = await getCachedSourceFacts<CachedSource>(cacheKeyUrl);
  if (cached?.facts && cached.readerVersion === READER_VERSION) {
    log.info({ cacheKeyUrl }, 'cache HIT');
    return {
      facts: cached.facts,
      text: cached.text,
      details: cached.details,
      apifyConfigured,
      cacheHit: true,
    };
  }
  log.info(
    {
      cacheKeyUrl,
      // Present only when the miss was a reader-version bump rather than an
      // absent entry — the two have very different causes.
      staleReaderVersion: cached?.facts ? cached.readerVersion ?? 1 : undefined,
      readerVersion: READER_VERSION,
    },
    'cache MISS'
  );

  const succeed = (
    facts: ExtractedProductFacts,
    text?: string,
    details?: Record<string, string>
  ) => {
    void setCachedSourceFacts<CachedSource>(
      cacheKeyUrl,
      { readerVersion: READER_VERSION, facts, text, details },
      isWeakExtraction(facts, details) ? WEAK_CACHE_TTL_SECONDS : undefined
    );
    return { facts, text, details, apifyConfigured };
  };

  // Authoritative Amazon data beats scraping when SP-API is connected.
  try {
    const catalogFacts = await extractFromAmazonCatalog(
      url.toString(),
      params.userId
    );
    if (catalogFacts) {
      log.info({ cacheKeyUrl }, 'SP-API catalog HIT');
      return succeed(catalogFacts, catalogFacts.evidence.join('\n'));
    }
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : error },
      'SP-API catalog lookup failed; scraping instead'
    );
  }

  const apifyFallbackOrError = async (fallback: {
    error: string;
    httpStatus?: number;
    finalUrl?: string;
  }): Promise<SourceReadResult> => {
    const apifyResult = await extractWithApify(
      url.toString(),
      { userId: params.userId, chatId: params.chatId },
      params.apifyTimeoutMs
    );
    if (apifyResult && 'facts' in apifyResult && apifyResult.facts) {
      return succeed(apifyResult.facts, apifyResult.text, apifyResult.details);
    }
    return {
      error:
        (apifyResult && 'error' in apifyResult ? apifyResult.error : null) ||
        fallback.error,
      httpStatus: fallback.httpStatus,
      finalUrl: fallback.finalUrl,
      apifyConfigured,
    };
  };

  try {
    const response = await safeFetch(url, {
      headers: BROWSER_HEADERS,
      timeoutMs: 12_000,
    });

    if (!response.ok) {
      return apifyFallbackOrError({
        error:
          response.status === 401 || response.status === 403
            ? 'This source requires login or blocks automated reading.'
            : `Could not read this source (HTTP ${response.status}).`,
        httpStatus: response.status,
        finalUrl: response.url,
      });
    }

    const contentType = response.headers.get('content-type') || '';
    if (
      !contentType.includes('text/html') &&
      !contentType.includes('text/plain') &&
      !contentType.includes('application/json')
    ) {
      return apifyFallbackOrError({
        error: 'This source is not a readable product page.',
        finalUrl: response.url,
      });
    }

    const html = (await response.text()).slice(0, 1_000_000);
    const finalUrl = response.url || url.toString();
    const facts = extractFacts(html, finalUrl);
    const shouldTryApify =
      isAmazonHost(url.hostname) ||
      facts.warnings.length > 0 ||
      facts.evidence.length < 2;

    if (shouldTryApify) {
      const apifyResult = await extractWithApify(
        url.toString(),
        { userId: params.userId, chatId: params.chatId },
        params.apifyTimeoutMs
      );
      if (
        apifyResult &&
        'facts' in apifyResult &&
        apifyResult.facts &&
        apifyResult.facts.evidence.length >= facts.evidence.length
      ) {
        return succeed(
          apifyResult.facts,
          apifyResult.text,
          apifyResult.details
        );
      }
    }

    return succeed(facts, stripHtmlToText(html));
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return apifyFallbackOrError({
      error: timedOut
        ? 'Timed out while reading this source.'
        : 'Could not read this source. It may block automated access.',
    });
  }
}
