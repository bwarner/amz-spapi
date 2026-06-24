import { SpApiClient } from '@farvisionllc/sp-client';
import { auth0 } from '../../../../lib/auth0';
import { stripHtmlToText } from '../../../../lib/brand-guide-extraction';
import { getCredentialStore } from '../../../../lib/credential-store';
import { listAmazonConnections } from '../../../../lib/amazon-connections';
import {
  getCachedSourceFacts,
  setCachedSourceFacts,
} from '../../../../lib/source-cache';

export const maxDuration = 60;

type ExtractionSource =
  | 'structured-data'
  | 'meta-tags'
  | 'heuristic'
  | 'sp-api-catalog';

type ExtractedProductFacts = {
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

function isPrivateHost(hostname: string): boolean {
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

function apifyActorPath() {
  const actorId =
    process.env['APIFY_SOURCE_ACTOR_ID'] ||
    process.env['APIFY_ACTOR_ID'] ||
    'apify~website-content-crawler';

  return actorId.replace('/', '~');
}

function isEcommerceScrapingActor() {
  const actorId =
    process.env['APIFY_SOURCE_ACTOR_ID'] || process.env['APIFY_ACTOR_ID'] || '';
  return actorId === '2APbAvDfNDOWXbkWf';
}

function apifyInput(url: string) {
  if (isEcommerceScrapingActor()) {
    return {
      scrapeMode: 'AUTO',
      detailsUrls: [{ url }],
      maxProductResults: 1,
      additionalProperties: true,
      additionalReviewProperties: false,
      scrapeReviewsFromGoogleShopping: false,
      scrapeSellersFromGoogleShopping: false,
      scrapeInfluencerProducts: false,
      scrapeProductsFromGoogleShopping: false,
    };
  }

  return {
    startUrls: [{ url }],
    maxCrawlPages: 1,
    maxCrawlDepth: 0,
    maxResults: 1,
    saveHtml: true,
    saveMarkdown: true,
    saveScreenshots: false,
  };
}

function itemString(item: ApifyDatasetItem, keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function nestedItemString(item: ApifyDatasetItem, path: string[]) {
  let current: unknown = item;
  for (const key of path) {
    if (!current || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current.trim() : '';
}

function factsFromApifyItem(item: ApifyDatasetItem, sourceUrl: string) {
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
  return {
    ...facts,
    warnings: unique(
      [...facts.warnings, 'Used Apify fallback to read this source.'],
      4
    ),
  };
}

async function extractWithApify(url: string) {
  const token = process.env['APIFY_TOKEN'];
  if (!token) return null;

  const actorPath = encodeURIComponent(apifyActorPath());
  const response = await fetch(
    `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?format=json&clean=true`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(55_000),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(apifyInput(url)),
    }
  );

  if (!response.ok) {
    return {
      error: `Apify fallback failed (HTTP ${response.status}).`,
    };
  }

  const items = (await response.json()) as ApifyDatasetItem[];
  const firstItem = items.find((item) => item && typeof item === 'object');
  if (!firstItem) {
    return {
      error: 'Apify fallback did not return readable page content.',
    };
  }

  return { facts: factsFromApifyItem(firstItem, url) };
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

  const { profile, profileName } = connection;
  const marketplaceId =
    profile.marketplace_id ||
    process.env['SP_MARKETPLACE_ID'] ||
    'ATVPDKIKX0DER';
  const credStore = getCredentialStore();

  const client = new SpApiClient({
    clientId: profile.client_id,
    clientSecret: profile.client_secret,
    refreshToken: profile.refresh_token,
    accessToken: profile.access_token,
    sellerId: profile.seller_id,
    marketplaceId,
    region: (profile.region as 'NA' | 'EU' | 'FE') || 'NA',
    onTokenRefresh: async (accessToken, expiresIn) => {
      await credStore.updateAccessToken(
        profileName,
        'SP_API',
        accessToken,
        expiresIn,
        userId
      );
    },
  });

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

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let url: URL;
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== 'string') throw new Error('URL is required');
    url = new URL(body.url);
  } catch {
    return Response.json(
      { error: 'Enter a valid source URL.' },
      { status: 400 }
    );
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    isPrivateHost(url.hostname)
  ) {
    return Response.json(
      { error: 'Only public http(s) source URLs can be extracted.' },
      { status: 400 }
    );
  }

  const cacheKeyUrl = cleanUrl(url.toString());
  const cached = await getCachedSourceFacts<ExtractedProductFacts>(cacheKeyUrl);
  if (cached) {
    console.log('[source-extract] cache HIT', cacheKeyUrl);
    return Response.json({ facts: cached, cacheHit: true });
  }
  console.log('[source-extract] cache MISS', cacheKeyUrl);

  const respondWithFacts = (facts: ExtractedProductFacts) => {
    void setCachedSourceFacts(cacheKeyUrl, facts);
    return Response.json({ facts });
  };

  // For Amazon product URLs, prefer authoritative SP-API Catalog data when the
  // seller has SP-API connected. Falls back to scraping below on any miss.
  try {
    const catalogFacts = await extractFromAmazonCatalog(
      url.toString(),
      session.user.sub
    );
    if (catalogFacts) {
      console.log('[source-extract] SP-API catalog HIT', cacheKeyUrl);
      return respondWithFacts(catalogFacts);
    }
  } catch (error) {
    console.warn(
      '[source-extract] SP-API catalog lookup failed; scraping instead:',
      error instanceof Error ? error.message : error
    );
  }

  const apifyFallbackOrError = async (params: {
    url: string;
    error: string;
    httpStatus?: number;
    finalUrl?: string;
  }) => {
    const apifyResult = await extractWithApify(params.url);
    if (apifyResult?.facts) return respondWithFacts(apifyResult.facts);
    return Response.json(
      {
        error: apifyResult?.error || params.error,
        httpStatus: params.httpStatus,
        finalUrl: params.finalUrl,
        apifyConfigured: Boolean(process.env['APIFY_TOKEN']),
      },
      { status: 200 }
    );
  };

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; SellAvantSourceExtractor/1.0; +https://sellavant.com)',
        Accept:
          'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
      },
    });

    if (!response.ok) {
      return apifyFallbackOrError({
        url: url.toString(),
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
        url: url.toString(),
        error: 'This source is not a readable product page.',
        finalUrl: response.url,
      });
    }

    const html = (await response.text()).slice(0, 1_000_000);
    const facts = extractFacts(html, response.url);
    const shouldTryApify =
      isAmazonHost(url.hostname) ||
      facts.warnings.length > 0 ||
      facts.evidence.length < 2;

    if (shouldTryApify) {
      const apifyResult = await extractWithApify(url.toString());
      if (
        apifyResult?.facts &&
        apifyResult.facts.evidence.length >= facts.evidence.length
      ) {
        return respondWithFacts(apifyResult.facts);
      }
    }

    return respondWithFacts(facts);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return apifyFallbackOrError({
      url: url.toString(),
      error: timedOut
        ? 'Timed out while reading this source.'
        : 'Could not read this source. It may block automated access.',
    });
  }
}
