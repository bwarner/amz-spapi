/**
 * SP-API client behaviour that fails without saying so.
 *
 * This package had no tests. The cases chosen are not the ones most likely to
 * break — they are the ones that break into a plausible-looking answer: a
 * report body decoded with the wrong charset, a pagination request that quietly
 * returns page one forever, and a terminal report state that means "no data"
 * being reported as a failure.
 */

import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { SpApiClient, REPORT_TIMEOUT_MS } from './sp-client.js';

function makeClient(overrides: Record<string, unknown> = {}) {
  return new SpApiClient({
    clientId: 'amzn1.application-oa2-client.test',
    clientSecret: 'secret',
    refreshToken: 'refresh',
    marketplaceId: 'ATVPDKIKX0DER',
    ...overrides,
  } as never);
}

/** Replace the transport, keeping the class's own request assembly. */
function withTransport(
  client: SpApiClient,
  handlers: {
    get?: (path: string, config?: unknown) => Promise<unknown>;
    post?: (path: string, body?: unknown, config?: unknown) => Promise<unknown>;
  }
) {
  const calls: Array<{ path: string; body?: unknown; config?: unknown }> = [];
  (client as unknown as { httpClient: unknown }).httpClient = {
    get: vi.fn(async (path: string, config?: unknown) => {
      calls.push({ path, config });
      return handlers.get ? handlers.get(path, config) : { data: {} };
    }),
    post: vi.fn(async (path: string, body?: unknown, config?: unknown) => {
      calls.push({ path, body, config });
      return handlers.post ? handlers.post(path, body, config) : { data: {} };
    }),
  };
  return calls;
}

describe('regional endpoints', () => {
  it.each([
    ['NA', 'sellingpartnerapi-na.amazon.com'],
    ['EU', 'sellingpartnerapi-eu.amazon.com'],
    ['FE', 'sellingpartnerapi-fe.amazon.com'],
  ])('%s resolves to its own host', (region, host) => {
    const client = makeClient({ region });

    expect((client as unknown as { BASE_URL: string }).BASE_URL).toContain(
      host
    );
  });

  it('falls back to NA for an unknown region rather than an undefined host', () => {
    // An undefined base URL produces requests to a relative path, which fail
    // far from the cause with a message about the path.
    const client = makeClient({ region: 'XX' });

    expect((client as unknown as { BASE_URL: string }).BASE_URL).toContain(
      'sellingpartnerapi-na'
    );
  });

  it('uses the regional LWA host, which is not the same split as the API host', () => {
    const client = makeClient({ region: 'FE' });

    expect(
      (client as unknown as { LWA_TOKEN_URL: string }).LWA_TOKEN_URL
    ).toContain('amazon.co.jp');
  });
});

describe('listReports', () => {
  it('sends a continuation token ALONE, without the filters that produced it', async () => {
    // Amazon rejects nextToken alongside its filters with a 400 that reads as
    // though the token were malformed, which sends you looking at the token.
    const client = makeClient();
    const calls = withTransport(client, {
      get: async () => ({ data: { reports: [] } }),
    });

    await client.listReports({
      reportTypes: ['GET_LEDGER_SUMMARY_VIEW_DATA'],
      nextToken: 'abc',
      createdSince: '2026-07-01T00:00:00Z',
    });

    const params = (calls[0].config as { params: Record<string, unknown> })
      .params;
    expect(params).toEqual({ nextToken: 'abc' });
    expect(params).not.toHaveProperty('reportTypes');
    expect(params).not.toHaveProperty('createdSince');
  });

  it('defaults to DONE, since a queued report has no document to fetch', async () => {
    const client = makeClient();
    const calls = withTransport(client, {
      get: async () => ({ data: { reports: [] } }),
    });

    await client.listReports({ reportTypes: ['ANY'] });

    const params = (calls[0].config as { params: Record<string, string> })
      .params;
    expect(params['processingStatuses']).toBe('DONE');
  });

  it('returns an empty list rather than undefined when there are none', async () => {
    // Callers iterate the result. Amazon omits the key entirely when empty, and
    // an undefined becomes a TypeError at the call site.
    const client = makeClient();
    withTransport(client, { get: async () => ({ data: {} }) });

    const result = await client.listReports({ reportTypes: ['ANY'] });

    expect(result.reports).toEqual([]);
  });
});

describe('downloadReportDocument', () => {
  const spy = vi.spyOn(axios, 'get');
  afterEach(() => spy.mockReset());

  it('gunzips when Amazon says it is compressed', async () => {
    const client = makeClient();
    spy.mockResolvedValue({
      data: gzipSync(Buffer.from('Date\tSKU\nA\tB', 'utf8')),
    } as never);

    const text = await client.downloadReportDocument({
      url: 'https://s3/doc',
      compressionAlgorithm: 'GZIP',
    });

    expect(text).toContain('Date\tSKU');
  });

  it('falls back to latin1 when UTF-8 produces replacement characters', async () => {
    // Amazon emits some FBA reports as Latin-1. Decoding those as UTF-8 does
    // not throw — it mangles accented SKUs and titles into U+FFFD, so the rows
    // import successfully and the product names are quietly wrong.
    const client = makeClient();
    const latin1 = Buffer.from('SKU\nCafé Crème', 'latin1');
    spy.mockResolvedValue({ data: latin1 } as never);

    const text = await client.downloadReportDocument({ url: 'https://s3/doc' });

    expect(text).toContain('Café Crème');
    expect(text).not.toContain('�');
  });

  it('leaves valid UTF-8 alone', async () => {
    const client = makeClient();
    spy.mockResolvedValue({
      data: Buffer.from('SKU\nCafé Crème', 'utf8'),
    } as never);

    const text = await client.downloadReportDocument({ url: 'https://s3/doc' });

    expect(text).toContain('Café Crème');
  });

  it('does not send SP-API auth to the presigned URL', async () => {
    // The URL is S3, not an SP-API endpoint, and rejects the auth headers.
    const client = makeClient();
    spy.mockResolvedValue({ data: Buffer.from('x') } as never);

    await client.downloadReportDocument({ url: 'https://s3/doc' });

    const config = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(config).not.toHaveProperty('headers');
  });
});

describe('runReport terminal states', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function reportClient(statuses: string[], documentId = 'doc-1') {
    const client = makeClient();
    let poll = 0;
    withTransport(client, {
      post: async () => ({ data: { reportId: 'r-1' } }),
      get: async () => {
        const processingStatus =
          statuses[Math.min(poll++, statuses.length - 1)];
        return {
          data: {
            reportId: 'r-1',
            processingStatus,
            ...(processingStatus === 'DONE'
              ? { reportDocumentId: documentId }
              : {}),
          },
        };
      },
    });
    return client;
  }

  it('explains that CANCELLED usually means no data, not a failure', async () => {
    // The distinction that matters operationally: CANCELLED for an empty window
    // is a normal outcome. Reporting it as a failure sends a seller chasing a
    // problem that does not exist.
    const client = reportClient(['CANCELLED']);

    await expect(
      client.runReport({ reportType: 'GET_LEDGER_SUMMARY_VIEW_DATA' })
    ).rejects.toThrow(/no data in that date range/i);
  });

  it('does not soften a FATAL into the same message', async () => {
    const client = reportClient(['FATAL']);

    await expect(
      client.runReport({ reportType: 'GET_LEDGER_SUMMARY_VIEW_DATA' })
    ).rejects.toThrow(/FATAL/);
    await expect(
      client.runReport({ reportType: 'GET_LEDGER_SUMMARY_VIEW_DATA' })
    ).rejects.not.toThrow(/no data in that date range/i);
  });

  it('names the report id on timeout so the work can be reclaimed', async () => {
    // Without the id the report is unreachable, and Amazon is already building
    // it — the next attempt pays to build the same thing again.
    const client = reportClient(['IN_PROGRESS']);

    const pending = client.runReport({
      reportType: 'ANY',
      timeoutMs: 1_000,
    });
    const assertion = expect(pending).rejects.toThrow(/reportId r-1/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('defaults to the request-safe budget, not the worker one', async () => {
    // A default longer than the caller's budget can only be reached by a
    // request that is already doomed. See report-timeouts.spec.ts.
    expect(REPORT_TIMEOUT_MS.requestSafe).toBeLessThan(
      REPORT_TIMEOUT_MS.worker
    );
  });
});

describe('createReport', () => {
  it('omits reportOptions entirely when none are given', async () => {
    // An empty object is not the same as absent: the ledger reports validate
    // their options, and sending `{}` fails where sending nothing succeeds.
    const client = makeClient();
    const calls = withTransport(client, {
      post: async () => ({ data: { reportId: 'r' } }),
    });

    await client.createReport({ reportType: 'ANY' });

    expect(calls[0].body).not.toHaveProperty('reportOptions');
    expect(calls[0].body).not.toHaveProperty('dataStartTime');
  });

  it('defaults marketplaceIds to the configured marketplace', async () => {
    const client = makeClient();
    const calls = withTransport(client, {
      post: async () => ({ data: { reportId: 'r' } }),
    });

    await client.createReport({ reportType: 'ANY' });

    expect(
      (calls[0].body as { marketplaceIds: string[] }).marketplaceIds
    ).toEqual(['ATVPDKIKX0DER']);
  });
});

describe('getOrders', () => {
  it('joins array filters into the comma form the API expects', async () => {
    // Passing an array reaches Amazon as `OrderStatuses=Shipped,Unshipped`
    // only if joined here; axios would otherwise serialise it as repeated
    // params, which the API ignores — returning every order as though no
    // filter had been given.
    const client = makeClient();
    const calls = withTransport(client, {
      get: async () => ({ data: { payload: { Orders: [] } } }),
    });

    await client.getOrders({
      createdAfter: '2026-07-01',
      orderStatuses: ['Shipped', 'Unshipped'],
    });

    const params = (calls[0].config as { params: Record<string, string> })
      .params;
    expect(params['OrderStatuses']).toBe('Shipped,Unshipped');
    expect(params['MarketplaceIds']).toBe('ATVPDKIKX0DER');
  });
});
