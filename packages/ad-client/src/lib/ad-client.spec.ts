/**
 * Sponsored Products read paths (#86).
 *
 * Two failure modes worth pinning, both of which produce an unhelpful error at
 * the far end of an HTTP call rather than anything local:
 *
 * 1. Every v3 list endpoint demands its own vendored media type in BOTH Accept
 *    and Content-Type. Plain `application/json` returns 415 without saying
 *    which header was wrong.
 * 2. The filters travel in a POST body, not a query string — and Amazon wraps
 *    each one in `{ include: [...] }`. A bare array is accepted and ignored,
 *    which silently returns everything instead of the filtered set.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AmazonAdsApiClient } from './ad-client.js';

type Captured = {
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

function clientWithCapture(responseData: unknown = {}) {
  const captured: Captured[] = [];
  const client = new AmazonAdsApiClient({
    clientId: 'amzn1.application-oa2-client.test',
    marketplaceId: 'ATVPDKIKX0DER',
    profileId: '967757046531288',
    accessToken: 'token',
  });

  // Replace the transport, keeping the class's own header and body assembly.
  (client as unknown as { httpClient: unknown }).httpClient = {
    post: vi.fn(async (path: string, body: unknown, config: unknown) => {
      captured.push({
        path,
        body: (body ?? {}) as Record<string, unknown>,
        headers: ((config as { headers?: Record<string, string> })?.headers ??
          {}) as Record<string, string>,
      });
      return { data: responseData };
    }),
    get: vi.fn(async () => ({ data: responseData })),
  };

  return { client, captured };
}

describe('vendored media types', () => {
  let subject: ReturnType<typeof clientWithCapture>;

  beforeEach(() => {
    subject = clientWithCapture({ campaigns: [] });
  });

  it('sends the same vendored type in Accept and Content-Type', async () => {
    // Amazon rejects a mismatch with 415 and does not say which header it
    // disliked, so both must be set and they must agree.
    await subject.client.listCampaigns();

    const { headers } = subject.captured[0];
    expect(headers.Accept).toBe('application/vnd.spCampaign.v3+json');
    expect(headers['Content-Type']).toBe('application/vnd.spCampaign.v3+json');
  });

  it.each([
    ['listAdGroups', 'spAdGroup.v3'],
    ['listKeywords', 'spKeyword.v3'],
    ['listProductAds', 'spProductAd.v3'],
    ['listNegativeKeywords', 'spNegativeKeyword.v3'],
  ] as const)('uses the right type for %s', async (method, media) => {
    const local = clientWithCapture({});
    await (local.client as unknown as Record<string, () => Promise<unknown>>)[
      method
    ]();

    expect(local.captured[0].headers.Accept).toBe(
      `application/vnd.${media}+json`
    );
  });

  it('never falls back to plain application/json', async () => {
    // The default on the axios instance is application/json. If a method
    // forgets its override it inherits that and 415s in production only.
    await subject.client.listCampaigns();

    expect(subject.captured[0].headers['Content-Type']).not.toBe(
      'application/json'
    );
  });
});

describe('filters', () => {
  it('wraps filters in { include }, which Amazon requires', async () => {
    // A bare array is accepted and IGNORED — the call succeeds and returns
    // every campaign, so the failure looks like "the filter did nothing".
    const { client, captured } = clientWithCapture({ campaigns: [] });
    await client.listAdGroups({ campaignIdFilter: ['123', '456'] });

    expect(captured[0].body['campaignIdFilter']).toEqual({
      include: ['123', '456'],
    });
  });

  it('excludes ARCHIVED by default', async () => {
    // An archived campaign is not one anyone is managing. Including them by
    // default makes every list longer and every count wrong for the question
    // usually being asked.
    const { client, captured } = clientWithCapture({ campaigns: [] });
    await client.listCampaigns();

    expect(captured[0].body['stateFilter']).toEqual({
      include: ['ENABLED', 'PAUSED'],
    });
  });

  it('honours an explicit request for archived campaigns', async () => {
    const { client, captured } = clientWithCapture({ campaigns: [] });
    await client.listCampaigns({ stateFilter: ['ARCHIVED'] });

    expect(captured[0].body['stateFilter']).toEqual({ include: ['ARCHIVED'] });
  });

  it('omits absent filters rather than sending empty ones', async () => {
    // `{ include: [] }` is not the same as no filter: an empty include matches
    // nothing, so sending one for an unspecified filter returns zero rows.
    const { client, captured } = clientWithCapture({ adGroups: [] });
    await client.listAdGroups();

    expect(captured[0].body).not.toHaveProperty('campaignIdFilter');
    expect(captured[0].body).not.toHaveProperty('adGroupIdFilter');
  });
});

describe('responses', () => {
  it('reads the collection under its own key and surfaces nextToken', async () => {
    const { client } = clientWithCapture({
      campaigns: [{ campaignId: '1' }, { campaignId: '2' }],
      nextToken: 'abc',
      totalResults: 2,
    });
    const result = await client.listCampaigns();

    expect(result.items).toHaveLength(2);
    expect(result.nextToken).toBe('abc');
  });

  it('returns an empty list rather than undefined when the key is absent', async () => {
    // Callers map over `items`. Amazon omits the key entirely when there are no
    // results, and an undefined here becomes a TypeError at the call site.
    const { client } = clientWithCapture({});
    const result = await client.listCampaigns();

    expect(result.items).toEqual([]);
  });

  it('keeps per-campaign errors alongside successes for budget usage', async () => {
    // This endpoint degrades per row: one bad campaign id does not fail the
    // call, so discarding the error array loses the only signal that a
    // requested campaign was not answered.
    const { client } = clientWithCapture({
      success: [{ campaignId: '1', budgetUsagePercent: 42 }],
      error: [{ campaignId: '2', code: 'NOT_FOUND' }],
    });
    const result = await client.getCampaignBudgetUsage(['1', '2']);

    expect(result.usage).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });
});
