import { validateListingTitle } from './listing-title-policy';

/**
 * The January 2025 title policy, enforced rather than remembered. Every
 * failure here is a recommendation that gets a seller's listing flagged: an
 * over-long title presented as fine, a "$" waved through, a keyword repeated
 * three times because only exact matches were counted.
 */

describe('validateListingTitle', () => {
  it('passes a compliant title and still states its caveats', () => {
    const check = validateListingTitle(
      'Gran Del Val Panama Geisha Coffee Whole Beans - Washed Process, ' +
        'Notes of Jasmine and Citrus, 250g Bag'
    );
    expect(check.compliant).toBe(true);
    expect(check.issues).toEqual([]);
    // The caveats are part of the answer: what this check cannot see, the
    // model must say rather than silently certify.
    expect(check.caveats.join(' ')).toMatch(/plurals and variants/);
  });

  it('measures length including spaces, against the right limit', () => {
    const long = 'word '.repeat(50).trim(); // 249 characters
    const check = validateListingTitle(long);
    expect(check.compliant).toBe(false);
    expect(check.characters).toBe(249);
    expect(check.issues[0]).toMatch(/over the 200-character limit.*49/);
  });

  it('applies the stricter apparel limit when told', () => {
    const title = 'x'.repeat(150);
    expect(validateListingTitle(title).compliant).toBe(true);
    const apparel = validateListingTitle(title, { apparel: true });
    expect(apparel.compliant).toBe(false);
    expect(apparel.limit).toBe(125);
  });

  it('names each forbidden character it finds', () => {
    const check = validateListingTitle('Amazing Deal! Only $9.99 Best_Value');
    expect(check.compliant).toBe(false);
    expect(check.issues[0]).toContain('"!"');
    expect(check.issues[0]).toContain('"$"');
    expect(check.issues[0]).toContain('"_"');
    expect(check.issues[0]).toMatch(/brand name/);
  });

  it('allows pipes and dashes — the separators Amazon still permits', () => {
    const check = validateListingTitle(
      'French Press Coffee Maker - Stainless Steel | 1.6L'
    );
    expect(check.compliant).toBe(true);
  });

  it('flags a word used three times, but not exempt little words', () => {
    const check = validateListingTitle(
      'Coffee Maker for Coffee Lovers with Coffee Scoop and Filters and Stand'
    );
    expect(check.compliant).toBe(false);
    expect(check.issues[0]).toMatch(/"coffee" appears 3 times/);
    // "and" appears twice+ but is a conjunction — exempt, never flagged.
    expect(check.issues.join(' ')).not.toMatch(/"and"/);
  });

  it('permits a word exactly twice', () => {
    const check = validateListingTitle(
      'Coffee Maker with Coffee Scoop, Borosilicate Glass, 600ml'
    );
    expect(check.compliant).toBe(true);
  });
});
