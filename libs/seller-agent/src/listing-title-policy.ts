/**
 * Amazon's product title requirements, effective 2025-01-21.
 *
 * Source: Seller Central help page GYTR6SYGFA5E3EQC ("Product title
 * requirements") and Amazon's January 2025 announcement. This is POLICY the
 * model must not be trusted to remember: the rules postdate most training
 * data, and a confidently recommended 250-character keyword-stuffed title is
 * exactly the suggestion that gets a seller's ASIN suppressed. The prompt
 * carries the rules; the `check-listing-title` tool enforces them, because a
 * model that knows a rule and a model that checked are different models.
 *
 * The rules, as announced:
 *  - Max 200 characters including spaces in most categories (apparel
 *    categories are stricter, 125).
 *  - The characters ! $ ? _ { } ^ ¬ ¦ are not allowed unless part of the
 *    brand name. Pipes and dashes remain fine; ~ # < > * only in real
 *    context (part numbers, measurements), never decoration.
 *  - No word more than twice, prepositions/articles/conjunctions excepted.
 *    Amazon counts plurals and word variants as repeats.
 *  - Enforcement: non-compliant titles are flagged in Manage All Inventory
 *    with a 14-day window before Amazon edits or suppresses.
 */

export const TITLE_POLICY_PROMPT = `LISTING TITLE POLICY (Amazon, effective 2025-01-21 — newer than your training data; trust THIS, not memory):
- Titles: max 200 characters INCLUDING spaces in most categories; apparel is 125.
- Forbidden characters: ! $ ? _ { } ^ ¬ ¦ — allowed only inside the registered brand name. Pipes | and dashes - are fine; ~ # < > * only with real meaning ("Style #4301", "<10 lb"), never decoration.
- No word more than twice per title (prepositions, articles and conjunctions excepted). Amazon counts plurals and variants of a word as repeats — "pan, pans, pan" is three.
- Non-compliant titles get flagged in Manage All Inventory with 14 days to fix before Amazon edits or suppresses the listing.
Before you recommend, write or approve ANY listing title, run check-listing-title on it and fix what it reports. Never present an unchecked title as compliant.`;

/** Words the repetition rule exempts. */
const EXEMPT_WORDS = new Set([
  // Articles
  'a',
  'an',
  'the',
  // Common conjunctions
  'and',
  'or',
  'but',
  'nor',
  'so',
  'yet',
  // Common prepositions
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'off',
  'on',
  'onto',
  'over',
  'per',
  'to',
  'up',
  'with',
  'without',
]);

const FORBIDDEN_CHARACTERS = ['!', '$', '?', '_', '{', '}', '^', '¬', '¦'];

export type TitleCheck = {
  compliant: boolean;
  characters: number;
  limit: number;
  issues: string[];
  /** What this check cannot see — stated so the model repeats it. */
  caveats: string[];
};

export function validateListingTitle(
  title: string,
  options: { apparel?: boolean } = {}
): TitleCheck {
  const issues: string[] = [];
  const limit = options.apparel ? 125 : 200;
  const characters = title.length;

  if (characters > limit) {
    issues.push(
      `${characters} characters — over the ${limit}-character limit ` +
        `(spaces count) by ${characters - limit}.`
    );
  }

  const forbidden = FORBIDDEN_CHARACTERS.filter((character) =>
    title.includes(character)
  );
  if (forbidden.length) {
    issues.push(
      `Contains ${forbidden.map((c) => `"${c}"`).join(', ')} — forbidden ` +
        'unless part of the registered brand name.'
    );
  }

  const counts = new Map<string, number>();
  for (const raw of title.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || EXEMPT_WORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  const repeated = [...counts.entries()].filter(([, count]) => count > 2);
  for (const [word, count] of repeated) {
    issues.push(
      `"${word}" appears ${count} times — the limit is twice, and Amazon ` +
        'also counts plurals and variants as repeats.'
    );
  }

  return {
    compliant: issues.length === 0,
    characters,
    limit,
    issues,
    caveats: [
      'This check counts EXACT word repeats only; Amazon also counts ' +
        'plurals and variants ("pan"/"pans"), so review near-duplicates ' +
        'yourself.',
      'Forbidden characters are allowed inside a registered brand name — ' +
        'if one flagged here is part of the brand, say so explicitly.',
      options.apparel
        ? undefined
        : 'Checked against the 200-character general limit; apparel ' +
          'categories are limited to 125.',
    ].filter((caveat): caveat is string => Boolean(caveat)),
  };
}
