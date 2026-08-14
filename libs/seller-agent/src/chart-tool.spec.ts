/**
 * The chart tool's wiring, which is the part the schema tests cannot reach.
 *
 * Three things are worth pinning here, all of them decisions that would fail
 * silently rather than loudly:
 *
 * 1. It is registered even for a seller with NO Amazon connection at all.
 *    Every other tool group is gated on the ops object it needs, and the
 *    obvious gate — `hasAmazonConnection`, which is `!!spCache` — is wrong for
 *    this one: Ads is a separate application, so gating on SP-API would hide
 *    charts from an advertiser who never linked a Seller account.
 * 2. `toModelOutput` returns an acknowledgement, NOT the series. The model
 *    typed those numbers into the call; echoing them back doubles them in
 *    context and keeps costing on every later turn, because tool results
 *    persist for the life of the conversation.
 * 3. The prompt guidance ships with the tool. A tool the model can call with
 *    no rules about provenance is the failure this feature most needs to
 *    avoid — a chart of numbers nobody fetched looks exactly as convincing as
 *    a real one.
 */

import { describe, expect, it } from 'vitest';
import { createSellerAgent } from './seller-agent.js';
import type { AIProvider } from '@amz-spapi/ai-provider';

/** The agent only needs a model handle to be constructed; it is never called. */
const provider = {
  languageModel: () => ({} as never),
} as unknown as AIProvider;

function agentWith(overrides: Record<string, unknown> = {}) {
  return createSellerAgent({
    provider,
    marketplaceId: 'ATVPDKIKX0DER',
    ...overrides,
  } as never);
}

const SPEC = {
  title: 'Spend vs ACOS',
  xKind: 'time',
  caption: 'Jul 1–3 2026, 14d attribution window',
  currencyCode: 'USD',
  series: [
    { label: 'Spend', render: 'bar' as const, format: 'currency' as const },
  ],
  points: [
    { label: 'Jul 1', values: [120.5] },
    { label: 'Jul 2', values: [null] },
    { label: 'Jul 3', values: [98.25] },
  ],
};

function chartTool() {
  const tools = (agentWith() as unknown as { tools: Record<string, never> })
    .tools;
  return tools['render-chart'] as unknown as {
    inputSchema: { safeParse: (v: unknown) => { success: boolean } };
    execute: (spec: unknown) => Promise<{ success: true; chart: typeof SPEC }>;
    toModelOutput: (arg: { output: unknown }) => {
      type: 'content';
      value: Array<{ type: 'text'; text: string }>;
    };
  };
}

describe('registration', () => {
  it('is available to a seller with no Amazon connection at all', () => {
    // Charting reaches nothing, so there is no capability to gate it on — and
    // an ads-only advertiser is exactly the user with the most to chart.
    expect(chartTool()).toBeDefined();
  });

  it('is not approval-gated: it spends nothing and changes nothing', () => {
    expect(
      (chartTool() as unknown as { needsApproval?: boolean }).needsApproval
    ).toBeUndefined();
  });
});

describe('execute', () => {
  it('echoes the validated spec for the browser to draw', async () => {
    const result = await chartTool().execute(SPEC);

    expect(result.success).toBe(true);
    expect(result.chart.points).toHaveLength(3);
    // The gap survives the round trip: a null here is what breaks the line.
    expect(result.chart.points[1].values[0]).toBeNull();
  });

  it('rejects a spec whose points do not match its series', () => {
    expect(
      chartTool().inputSchema.safeParse({
        ...SPEC,
        series: [
          ...SPEC.series,
          { label: 'Sales', render: 'line', format: 'currency' },
        ],
      }).success
    ).toBe(false);
  });
});

describe('toModelOutput', () => {
  it('acknowledges the chart without repeating the data', async () => {
    const output = await chartTool().execute(SPEC);
    const text = chartTool().toModelOutput({ output }).value[0].text;

    expect(text).toContain('Spend vs ACOS');
    expect(text).toContain('3 points');
    // The numbers must NOT come back: the model already has them, and a tool
    // result is re-sent on every subsequent turn.
    expect(text).not.toContain('120.5');
    expect(text).not.toContain('98.25');
  });

  it('tells the model to conclude rather than read the chart aloud', async () => {
    const output = await chartTool().execute(SPEC);
    const text = chartTool().toModelOutput({ output }).value[0].text;

    expect(text).toMatch(/do not restate/i);
  });
});

/*
 * Not tested here: that the prompt guidance reaches the model.
 *
 * `ToolLoopAgent` keeps its settings private, so the assembled system prompt
 * is unreachable from outside — and neither exporting the prompt builder nor
 * reading the agent's internals is worth reshaping production code for. The
 * guidance is interpolated into both `baseInstructions` branches (connected
 * and not), which is verifiable by reading `seller-agent.ts`, and the tool's
 * own `description` carries the same rules in miniature — that part IS
 * reachable, and is what the model sees first.
 */
describe('tool description', () => {
  const description = () =>
    (chartTool() as unknown as { description: string }).description;

  it('states the rule that keeps waste from looking efficient', () => {
    // Spend with no sales has NO acos. Charting it as 0 puts the worst rows at
    // the efficient end — the most misleading thing a chart here could do.
    expect(description()).toMatch(/null.*NOT zero/i);
  });

  it('requires the attribution window and truncation in the caption', () => {
    expect(description()).toMatch(/attribution window/i);
    expect(description()).toMatch(/top 10 of 137/);
  });

  it('forbids charting anything not fetched this turn', () => {
    expect(description()).toMatch(/ALREADY fetched/);
    expect(description()).toMatch(/never from memory|never estimated/i);
  });

  it('says percentages are fractions, which is how ACOS arrives', () => {
    expect(description()).toMatch(/0\.22 means 22%/);
  });

  it('binds the written conclusion to what the caption admits', () => {
    // Seen in the wild: a caption said "ordered by settlement id, deposit
    // dates were not available", and the very next line called it a stable
    // trend over the last four periods. The chart was honest and the prose
    // beside it was not.
    expect(description()).toMatch(/levels and outliers/i);
    expect(description()).toMatch(/never a trend|never .*direction/i);
  });

  it('explains why a line is refused across categories', () => {
    // Without the reason, a rejected call reads as an arbitrary rule and the
    // model retries the same shape.
    expect(description()).toMatch(/xKind/);
    expect(description()).toMatch(/re-sorting|implies movement/i);
    expect(description()).toMatch(/"point"/);
  });
});
