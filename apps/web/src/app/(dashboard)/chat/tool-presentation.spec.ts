/**
 * The rules that decide how a tool call reads in the transcript.
 *
 * `isStalled` is the one with history: #72 was seven live-looking spinners for
 * calls that had stopped days earlier. Adopting the AI Elements `tool`
 * component put that at risk, because it maps state straight to a badge and has
 * no way to express "not settled, and nothing is running" — so the rule moved
 * here, where it can be tested, and is passed into the component.
 */

import { describe, expect, it } from 'vitest';
import { approvalSummary, isStalled, toolTitle } from './tool-presentation';

describe('isStalled', () => {
  it('is false while the call is genuinely in flight', () => {
    expect(isStalled('input-available', true)).toBe(false);
    expect(isStalled('input-streaming', true)).toBe(false);
  });

  it('is true for an unsettled call in a conversation that is not streaming', () => {
    // Reopening an old conversation. Nothing is running, and nothing will:
    // the turn ended without these resolving. A spinner would claim otherwise.
    expect(isStalled('input-available', false)).toBe(true);
    expect(isStalled('input-streaming', false)).toBe(true);
  });

  it('is false once a call has settled, however it settled', () => {
    for (const state of ['output-available', 'output-error', 'output-denied']) {
      expect(isStalled(state, false)).toBe(false);
      expect(isStalled(state, true)).toBe(false);
    }
  });

  it('never calls an outstanding approval stalled', () => {
    // It is not stopped, it is waiting on the reader — and it resumes the
    // moment they answer. Striking it through would say the opposite.
    expect(isStalled('approval-requested', false)).toBe(false);
    expect(isStalled('approval-requested', true)).toBe(false);
  });
});

describe('toolTitle', () => {
  it('reads as present tense while running and past tense once done', () => {
    expect(toolTitle('get-orders', 'input-available')).toBe(
      'Fetching orders...'
    );
    expect(toolTitle('get-orders', 'output-available')).toBe(
      'Orders retrieved'
    );
  });

  it('never claims success for a call that failed', () => {
    // Seen in the wild: a 403 on the Finances API rendered as "Settlements
    // retrieved" beside a red Error badge — the header saying the data had
    // arrived while the badge said it had not.
    expect(toolTitle('get-settlements', 'output-error')).toBe(
      'Fetching settlements'
    );
    expect(toolTitle('get-settlements', 'output-error')).not.toMatch(
      /retrieved/
    );
  });

  it('does not claim success for a denied write either', () => {
    expect(toolTitle('apply-listing-images', 'output-denied')).toBe(
      'Updating the live listing'
    );
  });

  it('still reads as finished when the call actually succeeded', () => {
    expect(toolTitle('get-settlements', 'output-available')).toBe(
      'Settlements retrieved'
    );
  });

  it('falls back to the tool name rather than inventing a verb', () => {
    expect(toolTitle('some-new-tool', 'output-available')).toBe(
      'some-new-tool'
    );
  });
});

describe('approvalSummary', () => {
  it('says what a live write will actually do', () => {
    expect(approvalSummary('apply-listing-images', { sku: 'WIDGET-1' })).toBe(
      'Write these images to the LIVE Amazon listing (a snapshot is saved first) — SKU WIDGET-1'
    );
  });

  it('counts the images so the scope of the write is visible', () => {
    const summary = approvalSummary('apply-listing-images', {
      sku: 'WIDGET-1',
      imageAssetIds: ['a', 'b'],
    });
    expect(summary).toContain('(2 images)');
  });

  it('degrades to naming the tool for anything ungated by name', () => {
    expect(approvalSummary('unknown-tool', null)).toBe('Run unknown-tool');
  });

  it('counts the items in a bulk ads write so its scope is visible', () => {
    // The approval line is what the user actually reads before saying yes;
    // "3 items" versus "100 items" is the difference that matters.
    const summary = approvalSummary('update-ad-keywords', {
      profileId: '1',
      keywords: [
        { keywordId: 'k1', bid: 0.5 },
        { keywordId: 'k2', state: 'PAUSED' },
        { keywordId: 'k3', bid: 1.2 },
      ],
    });
    expect(summary).toContain('LIVE ad account');
    expect(summary).toContain('(3 items)');
  });

  it('counts negative keyword creations the same way', () => {
    const summary = approvalSummary('create-ad-negative-keywords', {
      negativeKeywords: [
        {
          campaignId: 'c',
          adGroupId: 'g',
          keywordText: 'free',
          matchType: 'NEGATIVE_EXACT',
        },
      ],
    });
    expect(summary).toContain('(1 item)');
  });
});

/**
 * The approval line for creating a campaign (#146).
 *
 * The one card in the app where a seller consents to something with no undo, so
 * the line has to describe what is actually being built. The specific trap:
 * `adsBatchCount` matches on a `keywords` array, and this tool has one.
 */
describe('approvalSummary for create-ad-campaign', () => {
  const tree = {
    name: 'SP - Exact - French Press',
    targetingType: 'MANUAL',
    dailyBudget: 25,
    adGroup: { name: 'Core', defaultBid: 0.75 },
    products: [{ sku: 'FP-24OZ' }, { sku: 'FP-34OZ' }],
    keywords: [
      { keywordText: 'french press', matchType: 'EXACT' },
      { keywordText: 'coffee press', matchType: 'EXACT' },
      { keywordText: 'cafetiere', matchType: 'PHRASE' },
    ],
  };

  it('says it is irreversible and created paused', () => {
    const summary = approvalSummary('create-ad-campaign', tree);

    expect(summary).toMatch(/no undo/i);
    expect(summary).toMatch(/PAUSED/);
    expect(summary).toMatch(/LIVE ad account/);
  });

  it('describes the tree rather than counting "items"', () => {
    // Without the early return this read "(3 items)" — the keyword count,
    // describing neither the campaign nor its SKUs.
    const summary = approvalSummary('create-ad-campaign', tree);

    expect(summary).toContain('SP - Exact - French Press');
    expect(summary).toContain('25/day');
    expect(summary).toContain('MANUAL');
    expect(summary).toContain('2 SKUs');
    expect(summary).toContain('3 keywords');
    expect(summary).not.toMatch(/\d+ items?/);
  });

  it('omits keywords for an AUTO campaign instead of showing zero', () => {
    // "0 keywords" reads as something missing; an AUTO campaign has none by
    // design.
    const summary = approvalSummary('create-ad-campaign', {
      name: 'Auto - Discovery',
      targetingType: 'AUTO',
      dailyBudget: 10,
      products: [{ sku: 'FP-24OZ' }],
    });

    expect(summary).toContain('1 SKU');
    expect(summary).not.toMatch(/keyword/);
  });

  it('falls back to the base sentence when the input is unusable', () => {
    // A malformed input must still name the risk rather than rendering blank.
    const summary = approvalSummary('create-ad-campaign', null);

    expect(summary).toMatch(/no undo/i);
  });
});
