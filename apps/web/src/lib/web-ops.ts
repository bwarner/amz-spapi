import type { SellerSourcingOps, SellerWebOps } from '@amz-spapi/seller-agent';
import { readSourcePage } from './source-reader';
import { searchAlibabaSuppliers } from './sourcing';

/** Default cap on page text handed back to the model. */
const DEFAULT_MAX_CHARS = 8_000;

/**
 * The chat route runs with maxDuration 300, but a tool call that eats a full
 * minute stalls the stream — keep the scraper run well inside that.
 */
const APIFY_TIMEOUT_MS = 45_000;

/**
 * Host implementation of the agent's page reading. Delegates to the shared
 * source reader (URL validation, direct fetch, Apify fallback, Couchbase
 * cache) and trims the result to something worth spending context on.
 */
export function createWebOps(userId: string): SellerWebOps {
  return {
    async readPage({ url, maxChars }) {
      const result = await readSourcePage({
        url,
        userId,
        apifyTimeoutMs: APIFY_TIMEOUT_MS,
      });

      if (!result.facts) {
        return {
          url,
          error:
            result.error ??
            (result.apifyConfigured
              ? 'Could not read that page.'
              : 'Could not read that page, and no scraping backend is configured.'),
        };
      }

      const limit = Math.min(
        Math.max(maxChars ?? DEFAULT_MAX_CHARS, 500),
        20_000
      );
      const text = (result.text ?? '').trim();
      const facts = result.facts;

      return {
        url,
        finalUrl: facts.finalUrl,
        extractionSource: facts.extractionSource,
        title: facts.productName,
        brand: facts.brandName,
        asin: facts.asin,
        price: facts.pricePoint,
        description: facts.oneLiner,
        features: facts.features,
        details: result.details,
        warnings: facts.warnings,
        text: text.slice(0, limit),
        truncated: text.length > limit,
      };
    },
  };
}

/**
 * Host implementation of supplier sourcing search. Stateless — the search is
 * keyword-driven and cached by input hash, so it needs no user context.
 */
export function createSourcingOps(): SellerSourcingOps {
  return {
    searchSuppliers: (params) => searchAlibabaSuppliers(params),
  };
}
