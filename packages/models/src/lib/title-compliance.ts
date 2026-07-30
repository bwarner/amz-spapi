/**
 * Check a product title against Amazon's title requirements.
 *
 * Deterministic, like image compliance and unlike document extraction: these are
 * countable rules, they run on every title, and a model would only add cost and
 * variance. The one genuinely subjective rule — promotional or subjective
 * language — is reported as a manual check rather than guessed at.
 *
 * PROVENANCE MATTERS HERE. Two thresholds in the image checker were wrong in the
 * blocking direction until they were read against the source, which is why every
 * rule below records where it came from. The rules encoded here are transcribed
 * from a SUMMARY of Seller Central `GYTR6SYGFA5E3EQC` supplied by the seller on
 * 2026-07-29, not from the page itself — it sits behind Seller Central auth and
 * could not be fetched. Anything marked `summary` should be confirmed against
 * the live page before it is allowed to block a listing.
 */

export const TITLE_RULES_PROVENANCE =
  'Seller Central GYTR6SYGFA5E3EQC, via a seller-supplied summary dated ' +
  '2026-07-29. Not verified against the page, which requires Seller Central ' +
  'authentication. Confirm before treating any blocker as final.';

/** Maximum title length. */
export const TITLE_MAX_LENGTH = 75;
/** The separate Item highlights field, where overflow copy belongs. */
export const ITEM_HIGHLIGHTS_MAX_LENGTH = 125;
/** A word may appear at most this many times. */
export const MAX_WORD_REPEATS = 2;

/** Characters Amazon bans from titles outright. */
export const BANNED_CHARACTERS = ['!', '$', '?', '{', '}'] as const;

/**
 * Exempt from the repetition limit: articles, prepositions and conjunctions.
 * The rule says these are exempt, so a title may say "of" five times.
 */
const REPETITION_EXEMPT = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'nor',
  'so',
  'yet',
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
  'out',
  'over',
  'to',
  'up',
  'with',
  'without',
]);

/**
 * Spelled-out numbers that should be numerals.
 *
 * Deliberately short: only the cases that are unambiguously a count. "One" in
 * "One World Coffee" is a brand word, so this reports a suggestion rather than
 * a blocker and leaves the judgement to the seller.
 */
const SPELLED_NUMBERS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'twenty',
  'thirty',
  'fifty',
  'hundred',
];

/** Units that should use the standard abbreviation. */
const UNIT_WORDS: Record<string, string> = {
  inch: 'in',
  inches: 'in',
  ounce: 'oz',
  ounces: 'oz',
  centimeter: 'cm',
  centimeters: 'cm',
  centimetre: 'cm',
  centimetres: 'cm',
  kilogram: 'kg',
  kilograms: 'kg',
  pound: 'lb',
  pounds: 'lb',
  gram: 'g',
  grams: 'g',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
};

export type TitleFinding = {
  id: string;
  severity: 'blocker' | 'warning';
  message: string;
  actual: string;
  required: string;
};

export type TitleComplianceReport = {
  title: string;
  length: number;
  /**
   * `fail` when a rule that can suppress a listing is broken; `review` when only
   * advisory rules are; `pass` otherwise.
   */
  verdict: 'pass' | 'review' | 'fail';
  blockers: TitleFinding[];
  warnings: TitleFinding[];
  /** Rules this tool cannot decide. Judgement, not measurement. */
  manualChecks: string[];
  /** Characters over the limit, which belong in Item highlights. */
  overflowCharacters: number;
  provenance: string;
};

export type TitleCheckOptions = {
  /**
   * True for a parent ASIN in a variation family. Size and colour belong only
   * on the child, so their presence on a parent is a finding.
   */
  isParent?: boolean;
  /** Size and colour values to look for when checking the parent rule. */
  variationValues?: string[];
};

function words(title: string): string[] {
  return title.toLowerCase().match(/[a-z]+/g) ?? [];
}

export function checkTitle(
  title: string,
  options: TitleCheckOptions = {}
): TitleComplianceReport {
  const blockers: TitleFinding[] = [];
  const warnings: TitleFinding[] = [];
  const length = title.length;

  if (length > TITLE_MAX_LENGTH) {
    blockers.push({
      id: 'length',
      severity: 'blocker',
      message:
        `Title is ${length} characters. The ${
          length - TITLE_MAX_LENGTH
        } over ` +
        `the limit can move to Item highlights, which takes ` +
        `${ITEM_HIGHLIGHTS_MAX_LENGTH} characters of comma-separated detail.`,
      actual: `${length} characters`,
      required: `at most ${TITLE_MAX_LENGTH}`,
    });
  }

  const banned = BANNED_CHARACTERS.filter((char) => title.includes(char));
  if (banned.length) {
    blockers.push({
      id: 'banned-characters',
      severity: 'blocker',
      message: `Remove ${banned.map((c) => `"${c}"`).join(', ')}.`,
      actual: banned.join(' '),
      required: `none of ${BANNED_CHARACTERS.join(' ')}`,
    });
  }

  // Three or more consecutive capitals. Two-letter forms like "oz" are fine and
  // legitimate acronyms exist, so this is deliberately not "any capital run".
  const shouty = title.match(/\b[A-Z]{3,}\b/g) ?? [];
  if (shouty.length) {
    blockers.push({
      id: 'all-caps',
      severity: 'blocker',
      message: `Do not use ALL CAPS: ${[...new Set(shouty)].join(', ')}.`,
      actual: [...new Set(shouty)].join(', '),
      required: 'title case or sentence case',
    });
  }

  const counts = new Map<string, number>();
  for (const word of words(title)) {
    if (REPETITION_EXEMPT.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const repeated = [...counts.entries()].filter(
    ([, count]) => count > MAX_WORD_REPEATS
  );
  if (repeated.length) {
    blockers.push({
      id: 'word-repetition',
      severity: 'blocker',
      message:
        'No word may appear more than twice: ' +
        repeated.map(([word, count]) => `"${word}" x${count}`).join(', ') +
        '. Articles, prepositions and conjunctions are exempt.',
      actual: repeated.map(([w, c]) => `${w} x${c}`).join(', '),
      required: `at most ${MAX_WORD_REPEATS} of any other word`,
    });
  }

  const spelled = words(title).filter((word) => SPELLED_NUMBERS.includes(word));
  if (spelled.length) {
    warnings.push({
      id: 'spelled-numbers',
      severity: 'warning',
      message:
        `Use numerals rather than ${[...new Set(spelled)].join(', ')} — ` +
        'unless the word is part of a brand name.',
      actual: [...new Set(spelled)].join(', '),
      required: 'numerals',
    });
  }

  const spelledUnits = words(title).filter((word) => word in UNIT_WORDS);
  if (spelledUnits.length) {
    warnings.push({
      id: 'unit-abbreviations',
      severity: 'warning',
      message:
        'Use standard unit abbreviations: ' +
        [...new Set(spelledUnits)]
          .map((unit) => `${unit} → ${UNIT_WORDS[unit]}`)
          .join(', ') +
        '.',
      actual: [...new Set(spelledUnits)].join(', '),
      required: 'in, oz, cm, kg and similar',
    });
  }

  if (options.isParent && options.variationValues?.length) {
    const present = options.variationValues.filter((value) =>
      title.toLowerCase().includes(value.toLowerCase())
    );
    if (present.length) {
      warnings.push({
        id: 'parent-variation-values',
        severity: 'warning',
        message:
          `Size and colour belong on the child ASIN, not the parent: ` +
          `${present.join(', ')}.`,
        actual: present.join(', '),
        required: 'no size or colour on a parent title',
      });
    }
  }

  // Judgement, not measurement. Listing these is the honest alternative to a
  // keyword blocklist that would flag "Best Beans Farm" as a promotional claim.
  const manualChecks = [
    'No promotional or subjective claims ("best seller", "#1", "top rated").',
    'Hyphens, slashes, commas and ampersands are used functionally rather than decoratively.',
    'A brand containing special characters is in the brand field, not the title; products with no brand use "generic".',
    'Recommended order: brand, flavour or style, product type, key attribute, colour, size or pack count, model number.',
  ];

  return {
    title,
    length,
    verdict: blockers.length ? 'fail' : warnings.length ? 'review' : 'pass',
    blockers,
    warnings,
    manualChecks,
    overflowCharacters: Math.max(0, length - TITLE_MAX_LENGTH),
    provenance: TITLE_RULES_PROVENANCE,
  };
}

/**
 * Split an over-long title into a compliant title and Item highlights copy.
 *
 * Truncation is refused rather than performed badly: this cuts only at a
 * separator, so it can return a shorter title than the limit allows but never a
 * title ending mid-phrase. A seller rewriting a title wants a starting point,
 * not a string chopped at character 75.
 */
export function splitTitleForHighlights(title: string): {
  title: string;
  highlights: string;
  /** True when no separator was found and nothing could be split safely. */
  needsManualRewrite: boolean;
} {
  if (title.length <= TITLE_MAX_LENGTH) {
    return { title, highlights: '', needsManualRewrite: false };
  }

  // Prefer the last separator that leaves a compliant title.
  const separators = [' - ', ' – ', ', ', ' | ', ' — '];
  let bestCut = -1;
  for (const separator of separators) {
    let index = title.indexOf(separator);
    while (index !== -1) {
      if (index <= TITLE_MAX_LENGTH && index > bestCut) bestCut = index;
      index = title.indexOf(separator, index + 1);
    }
  }

  if (bestCut <= 0) {
    return { title, highlights: '', needsManualRewrite: true };
  }

  return {
    title: title.slice(0, bestCut).trim(),
    highlights: title
      .slice(bestCut)
      .replace(/^[\s\-–—|,]+/, '')
      .slice(0, ITEM_HIGHLIGHTS_MAX_LENGTH)
      .trim(),
    needsManualRewrite: false,
  };
}
