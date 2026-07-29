import { describe, expect, it } from 'vitest';
import {
  checkTitle,
  splitTitleForHighlights,
  TITLE_MAX_LENGTH,
} from './title-compliance.js';

/** The two live titles in this account, measured 2026-07-29. */
const WASHED =
  'Gran Del Val Geisha Coffee Whole Beans - Panamanian Fresh Geisha Washed ' +
  'Coffee Beans - Panama Coffee Souvenier with Notes of Jasmine, Citrus, ' +
  'Floral and Sweet Caramel';
const HONEY =
  'Gran Del Val Panama Geisha Coffee Whole Beans, Washed Light Roast, 8.8 oz';

describe('the account as it stands', () => {
  it('fails the Washed listing on length and repetition', () => {
    const report = checkTitle(WASHED);
    expect(report.verdict).toBe('fail');
    expect(report.length).toBe(166);
    expect(report.blockers.map((b) => b.id).sort()).toEqual([
      'length',
      'word-repetition',
    ]);
    expect(
      report.blockers.find((b) => b.id === 'word-repetition')?.actual
    ).toContain('coffee x3');
    expect(report.overflowCharacters).toBe(166 - TITLE_MAX_LENGTH);
  });

  it('passes the shortened Honey listing', () => {
    const report = checkTitle(HONEY);
    expect(report.length).toBe(73);
    expect(report.blockers).toEqual([]);
  });
});

describe('checkTitle', () => {
  it('blocks banned characters', () => {
    const report = checkTitle('Coffee Beans! Best Value? {Fresh}');
    const finding = report.blockers.find((b) => b.id === 'banned-characters');
    expect(finding).toBeDefined();
    expect(finding?.actual).toContain('!');
    expect(finding?.actual).toContain('?');
    expect(finding?.actual).toContain('{');
    expect(report.verdict).toBe('fail');
  });

  it('blocks ALL CAPS runs but tolerates short forms like oz', () => {
    expect(
      checkTitle('Gran Del Val FRESH Coffee 8.8 oz').blockers.map((b) => b.id)
    ).toContain('all-caps');
    expect(checkTitle('Gran Del Val Coffee 8.8 oz').blockers).toEqual([]);
  });

  it('exempts articles and prepositions from the repetition limit', () => {
    // "of" five times is allowed; "beans" three times is not.
    const exempt = 'Bag of Beans of Panama of Boquete of Geisha of Origin';
    expect(checkTitle(exempt).blockers.map((b) => b.id)).not.toContain(
      'word-repetition'
    );
    const notExempt = 'Beans Beans Beans Coffee Panama';
    expect(checkTitle(notExempt).blockers.map((b) => b.id)).toContain(
      'word-repetition'
    );
  });

  it('warns rather than blocks on spelled numbers and unit words', () => {
    const report = checkTitle('Gran Del Val Coffee Two Pounds Whole Bean');
    expect(report.blockers).toEqual([]);
    expect(report.warnings.map((w) => w.id).sort()).toEqual([
      'spelled-numbers',
      'unit-abbreviations',
    ]);
    expect(report.verdict).toBe('review');
  });

  it('flags size and colour on a parent title only', () => {
    const opts = { isParent: true, variationValues: ['250g', 'Black'] };
    expect(
      checkTitle('Gran Del Val Geisha Coffee 250g', opts).warnings.map(
        (w) => w.id
      )
    ).toContain('parent-variation-values');
    expect(
      checkTitle('Gran Del Val Geisha Coffee 250g', {
        isParent: false,
        variationValues: ['250g'],
      }).warnings.map((w) => w.id)
    ).not.toContain('parent-variation-values');
  });

  it('reports subjective rules as manual checks instead of guessing', () => {
    // A keyword blocklist would flag "Best Beans Farm" as a promotional claim.
    const report = checkTitle(HONEY);
    expect(report.manualChecks.join(' ')).toContain('promotional');
    expect(report.verdict).toBe('pass');
  });

  it('carries provenance saying the rules are unverified', () => {
    expect(checkTitle(HONEY).provenance).toContain('Not verified');
  });
});

describe('splitTitleForHighlights', () => {
  it('cuts the Washed title at a separator, not at character 75', () => {
    const split = splitTitleForHighlights(WASHED);
    expect(split.title.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
    expect(split.needsManualRewrite).toBe(false);
    // Must not end mid-phrase.
    expect(split.title.endsWith('Beans')).toBe(true);
    expect(split.highlights.length).toBeGreaterThan(0);
    expect(checkTitle(split.title).blockers.map((b) => b.id)).not.toContain(
      'length'
    );
  });

  it('leaves a compliant title alone', () => {
    expect(splitTitleForHighlights(HONEY)).toEqual({
      title: HONEY,
      highlights: '',
      needsManualRewrite: false,
    });
  });

  it('refuses rather than truncating when there is no separator', () => {
    const runOn = 'a'.repeat(120);
    const split = splitTitleForHighlights(runOn);
    expect(split.needsManualRewrite).toBe(true);
    expect(split.title).toBe(runOn);
  });
});
