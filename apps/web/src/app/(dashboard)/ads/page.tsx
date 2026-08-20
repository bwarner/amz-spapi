'use client';

import { useEffect, useState } from 'react';

/**
 * AdOps: funnels and the harvest queue (#149).
 *
 * Two of the issue's four sections. Lifts wait on the split work; experiments
 * wait on an ads change log that does not exist yet, and on the honesty that a
 * before/after across a live campaign is observational rather than controlled.
 *
 * The freshness line is deliberately at the top rather than in a footnote.
 * Structure is fetched live and performance is not, so a page that shows both
 * without saying which is which invites a fortnight-old figure to be read as
 * today's — and a page that silently shows week-old numbers is worse than one
 * that shows none.
 */

type DestinationHealth = {
  campaignId: string;
  keywordCount?: number;
  dailyBudget?: number;
  spendPerDay?: number;
  utilisation?: number;
};

type FunnelView = {
  funnelId: string;
  profileId: string;
  name: string;
  nodes: Array<{ campaignId: string; adGroupId: string; role: string }>;
  edges: Array<{ from: string; to: string }>;
  destinations: DestinationHealth[];
};

type DueNegative = {
  graduationId: string;
  term: string;
  fromCampaignId: string;
  toCampaignId: string;
  ready: boolean;
  reason?: string;
  remedy?: string[];
  delivery?: { impressions: number; clicks: number; from: string; to: string };
};

type AdOpsView = {
  funnels: FunnelView[];
  dueNegatives: DueNegative[];
  awaitingApproval: Array<{
    graduationId: string;
    funnelId: string;
    term: string;
    toCampaignId: string;
    bid: number;
    sourceCpc: number;
    proposedAt: number;
  }>;
  freshness: {
    through?: string;
    staleDays?: number;
    gaps: Array<{ from: string; to: string }>;
  };
};

const ROLE_STYLE: Record<string, string> = {
  auto: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  broad: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  phrase: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  exact: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
};

function Freshness({ freshness }: { freshness: AdOpsView['freshness'] }) {
  if (!freshness.through) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        No ad performance data is stored yet, so nothing below carries a
        performance figure. Sync or upload an ads report to populate it.
      </p>
    );
  }

  const stale = freshness.staleDays ?? 0;
  const tone =
    stale <= 2
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : 'border-amber-300 bg-amber-50 text-amber-900';

  return (
    <p className={`rounded-md border px-3 py-2 text-sm ${tone}`}>
      Performance figures cover data through{' '}
      <strong>{freshness.through}</strong>
      {stale > 0
        ? ` — ${stale} day${stale === 1 ? '' : 's'} old.`
        : ' — current.'}
      {freshness.gaps.length > 0 && (
        <>
          {' '}
          {freshness.gaps.length} gap
          {freshness.gaps.length === 1 ? '' : 's'} in the window have no data.
        </>
      )}
    </p>
  );
}

function Health({ health }: { health: DestinationHealth }) {
  const parts: string[] = [];
  if (health.keywordCount !== undefined) {
    parts.push(`${health.keywordCount} keywords`);
  }
  if (health.utilisation !== undefined) {
    parts.push(`${Math.round(health.utilisation * 100)}% of budget`);
  } else if (health.dailyBudget === undefined) {
    // Said out loud rather than shown as 0%. A destination whose budget could
    // not be read is not a destination with room.
    parts.push('budget unknown');
  }

  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="font-mono text-xs text-muted-foreground">
        {health.campaignId}
      </span>
      <span className="text-muted-foreground">
        {parts.length ? parts.join(' · ') : 'no data'}
      </span>
    </div>
  );
}

export default function AdOpsPage() {
  const [view, setView] = useState<AdOpsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/ads/adops');
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setError(body?.error ?? 'Could not load ad operations.');
          return;
        }
        setView(body as AdOpsView);
      } catch {
        if (!cancelled) setError('Could not load ad operations.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Ad operations</h1>
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </p>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Ad operations</h1>
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const blocked = view.dueNegatives.filter((item) => !item.ready);
  const ready = view.dueNegatives.filter((item) => item.ready);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Ad operations</h1>
        <Freshness freshness={view.freshness} />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Funnels</h2>
        {view.funnels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No funnels yet. Ask in chat to adopt this account&rsquo;s structure
            as a funnel.
          </p>
        ) : (
          view.funnels.map((funnel) => (
            <div key={funnel.funnelId} className="rounded-lg border p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="font-medium">{funnel.name}</h3>
                <span className="font-mono text-xs text-muted-foreground">
                  {funnel.profileId}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {funnel.nodes.map((node) => (
                  <span
                    key={`${node.campaignId}:${node.adGroupId}`}
                    className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${
                      ROLE_STYLE[node.role] ??
                      'bg-muted text-muted-foreground ring-border'
                    }`}
                  >
                    {node.role}
                  </span>
                ))}
                <span className="text-xs text-muted-foreground">
                  {funnel.edges.length} edge
                  {funnel.edges.length === 1 ? '' : 's'}
                </span>
              </div>

              {funnel.destinations.length > 0 && (
                <div className="mt-3 border-t pt-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Destinations
                  </p>
                  {funnel.destinations.map((health) => (
                    <Health key={health.campaignId} health={health} />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          Backward negatives{' '}
          <span className="text-sm font-normal text-muted-foreground">
            ({ready.length} ready, {blocked.length} held)
          </span>
        </h2>

        {view.dueNegatives.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing due. A negative falls due when a graduation&rsquo;s overlap
            window closes.
          </p>
        )}

        {/* Held first, deliberately: a blocked negative is a funnel stopped
            halfway, and it is the thing on this page that needs a decision. */}
        {blocked.map((item) => (
          <div
            key={item.graduationId}
            className="rounded-lg border border-amber-300 bg-amber-50/50 p-4"
          >
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-medium">{item.term}</span>
              <span className="text-xs text-amber-800">held back</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{item.reason}</p>
            {item.remedy && item.remedy.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {item.remedy.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {ready.map((item) => (
          <div key={item.graduationId} className="rounded-lg border p-4">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-medium">{item.term}</span>
              <span className="text-xs text-emerald-700">ready to propose</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              The destination is serving. Approve in chat to add the negative to{' '}
              <span className="font-mono text-xs">{item.fromCampaignId}</span>.
            </p>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Awaiting approval</h2>
        {view.awaitingApproval.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No graduations are waiting.
          </p>
        ) : (
          view.awaitingApproval.map((item) => (
            <div key={item.graduationId} className="rounded-lg border p-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{item.term}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {item.toCampaignId}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Bid {item.bid.toFixed(2)}, seeded from an observed CPC of{' '}
                {item.sourceCpc.toFixed(2)}.
              </p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
