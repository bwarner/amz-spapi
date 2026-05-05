'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Activity,
  Bot,
  ShoppingCart,
} from 'lucide-react';

type ProbeResult = {
  apiType: 'SP_API' | 'ADS_API';
  profileName: string;
  marketplaceId: string;
  region?: string;
  sellerId?: string;
  advertiserProfileId?: string;
  ok: boolean;
  source: 'stored' | 'env';
  probe: string;
  summary: string;
  details?: Record<string, unknown>;
  error?: string;
};

type DiagnosticsResponse = {
  testedAt: string;
  counts: {
    sp: number;
    ads: number;
    ok: number;
    failed: number;
  };
  results: ProbeResult[];
};

function formatValue(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export default function ConnectionsPage() {
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDiagnostics = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      setError(null);

      try {
        const response = await fetch('/api/amazon/connection-test', {
          cache: 'no-store',
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            body.error || 'Failed to load connection diagnostics'
          );
        }
        setData(await response.json());
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load connection diagnostics'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadDiagnostics();
  }, [loadDiagnostics]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Connection Diagnostics
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Live probes against the current SP-API and Amazon Ads connections.
            This page is meant to answer one simple question: do the stored
            credentials actually work.
          </p>
        </div>
        <Button
          onClick={() => void loadDiagnostics('refresh')}
          disabled={loading || refreshing}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="mt-6 border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Diagnostics failed
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>SP Connections</CardDescription>
            <CardTitle className="text-2xl">{data?.counts.sp ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ads Connections</CardDescription>
            <CardTitle className="text-2xl">
              {data?.counts.ads ?? '—'}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Passing Probes</CardDescription>
            <CardTitle className="text-2xl text-emerald-600">
              {data?.counts.ok ?? '—'}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failing Probes</CardDescription>
            <CardTitle className="text-2xl text-destructive">
              {data?.counts.failed ?? '—'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <Activity className="h-4 w-4" />
        {loading
          ? 'Running live checks…'
          : `Last checked ${data?.testedAt ?? '—'}`}
      </div>

      <div className="mt-6 space-y-4">
        {loading &&
          Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="animate-pulse">
              <CardHeader>
                <div className="h-6 w-48 rounded bg-muted" />
                <div className="h-4 w-72 rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="h-20 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}

        {!loading && data?.results.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>No connections found</CardTitle>
              <CardDescription>
                There are no SP-API or Ads profiles available for the current
                user.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {!loading &&
          data?.results.map((result) => {
            const isSp = result.apiType === 'SP_API';
            return (
              <Card
                key={`${result.apiType}-${result.profileName}-${result.marketplaceId}`}
              >
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        {isSp ? (
                          <ShoppingCart className="h-5 w-5 text-orange-600" />
                        ) : (
                          <Bot className="h-5 w-5 text-blue-600" />
                        )}
                        {isSp ? 'SP-API' : 'Ads API'} · {result.marketplaceId}
                      </CardTitle>
                      <CardDescription>{result.summary}</CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={result.ok ? 'default' : 'destructive'}>
                        {result.ok ? (
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                        ) : (
                          <XCircle className="mr-1 h-3.5 w-3.5" />
                        )}
                        {result.ok ? 'Working' : 'Failed'}
                      </Badge>
                      <Badge variant="outline">
                        {result.source === 'env' ? 'Env self-auth' : 'Stored'}
                      </Badge>
                      <Badge variant="secondary">{result.probe}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 rounded-md border p-4">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Connection
                      </div>
                      <dl className="space-y-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Profile</dt>
                          <dd className="text-right font-mono">
                            {result.profileName}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Marketplace</dt>
                          <dd>{result.marketplaceId}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Region</dt>
                          <dd>{formatValue(result.region)}</dd>
                        </div>
                        {result.sellerId && (
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">Seller ID</dt>
                            <dd className="font-mono">{result.sellerId}</dd>
                          </div>
                        )}
                        {result.advertiserProfileId && (
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">
                              Advertiser Profile
                            </dt>
                            <dd className="font-mono">
                              {result.advertiserProfileId}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>

                    <div className="space-y-2 rounded-md border p-4">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Probe Output
                      </div>
                      {result.error ? (
                        <p className="text-sm text-destructive">
                          {result.error}
                        </p>
                      ) : result.details ? (
                        <dl className="space-y-2 text-sm">
                          {Object.entries(result.details).map(
                            ([key, value]) => (
                              <div
                                key={key}
                                className="flex justify-between gap-3"
                              >
                                <dt className="text-muted-foreground">{key}</dt>
                                <dd className="text-right font-mono">
                                  {formatValue(value)}
                                </dd>
                              </div>
                            )
                          )}
                        </dl>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No additional details.
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
      </div>
    </div>
  );
}
