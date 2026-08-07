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
});
