import type { ImageIntent, ImageSourceDecision } from './experience.js';
import type { AssetAffordance, AssetProfile } from './asset-profile.js';

/**
 * Asset → slot matcher (redesign #26).
 *
 * Decides how an image slot gets filled: with a seller's real photo (`place`),
 * by generating from one (`reference-generate`), by putting a product into a
 * real background (`composite`), or from nothing (`generate`).
 *
 * Pure, no I/O. The point of the scoring is that the decision is arguable: a
 * caller gets the dimensions back, not just a verdict, because "why did it use
 * that photo" is a question the seller will ask about their own images.
 *
 * The matcher never invents a brief and never renders anything. It says which
 * assets to use and how; producing the image is the caller's job.
 */

export type AssetCandidate = {
  assetId: string;
  profile: AssetProfile;
};

/** Per-dimension contribution, so a decision can be explained and tuned. */
export type MatchScore = {
  affordance: number;
  prominence: number;
  composition: number;
  quality: number;
  brandFit: number;
  mustShow: number;
  total: number;
};

export type AssetMatch = ImageSourceDecision & {
  /** Present when a candidate was scored — absent for a bare `generate`. */
  score?: MatchScore;
  /** Human-readable, in decision order. Safe to show in the UI. */
  reasons: string[];
};

/**
 * Placement needs real confidence: the right affordance (3) plus either the
 * composition (3) or a strong prominence and orientation fit. Below this the
 * asset informs generation instead of replacing it, which is the cheaper
 * mistake — a wrong generated image looks wrong, a wrongly placed real photo
 * looks like the seller chose it.
 */
const PLACE_THRESHOLD = 6;

/** Which affordance a slot wants, from what the scene needs to show. */
export function desiredAffordance(intent: ImageIntent): AssetAffordance {
  if (intent.subject === 'background') return 'backdrop-layer';
  if (intent.subject === 'detail') return 'feature-callout';
  if (intent.subject === 'scene') return 'hero-bg';
  // subject === 'product'
  return intent.productProminence === 'hero'
    ? 'comparison-thumb'
    : 'carousel-tile';
}

function normaliseHex(value: string): string {
  const hex = value.trim().toLowerCase().replace(/^#/, '');
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  return `#${hex}`;
}

const AMOUNT_RANK = { low: 1, medium: 2, high: 3 } as const;

/**
 * How much of what the scene must show is actually in the picture.
 *
 * Matched against the profile's one-or-two-sentence description, so this is
 * weak evidence by construction: it can confirm a term is present, never that
 * it is absent-but-visible. It therefore gates placement only at zero coverage.
 */
function mustShowCoverage(intent: ImageIntent, profile: AssetProfile): number {
  const terms = intent.mustShow.filter((term) => term.trim());
  if (!terms.length) return 1;
  const haystack = `${profile.description} ${profile.role}`.toLowerCase();
  const hits = terms.filter((term) =>
    haystack.includes(term.trim().toLowerCase())
  );
  return hits.length / terms.length;
}

type Scored = {
  candidate: AssetCandidate;
  score: MatchScore;
  reasons: string[];
  placeable: boolean;
};

function scoreCandidate(
  intent: ImageIntent,
  candidate: AssetCandidate
): Scored {
  const profile = candidate.profile;
  const reasons: string[] = [];
  const want = desiredAffordance(intent);

  // ---- Quality gates. These decide placeability, not rank. -----------------
  let quality = 0;
  let placeable = true;

  if (profile.hasBakedText) {
    // Amazon rejects text rendered into a module image. Still a fine reference.
    placeable = false;
    reasons.push('has baked-in text — cannot be placed, reference only');
  }
  if (profile.affordances.includes('reference-only')) {
    placeable = false;
    reasons.push('profiled as reference-only');
  }
  if (
    !profile.hasBakedText &&
    !profile.affordances.includes('reference-only')
  ) {
    quality += 1;
  }
  // A busy background under overlaid text is unreadable. Only matters when the
  // scene actually wants space for copy.
  if (
    profile.background === 'busy' &&
    intent.negativeSpace &&
    intent.negativeSpace.amount !== 'low'
  ) {
    quality -= 1;
    reasons.push('busy background where the scene needs space for copy');
  }

  // ---- Affordance ---------------------------------------------------------
  let affordance = 0;
  if (profile.affordances.includes(want)) {
    affordance += 3;
    reasons.push(`affords ${want}`);
  }

  // ---- Subject prominence -------------------------------------------------
  let prominence = 0;
  if (profile.subjectProminence === intent.productProminence) {
    prominence += 2;
    reasons.push(`product ${intent.productProminence}`);
  } else if (
    (intent.productProminence === 'absent' &&
      profile.subjectProminence === 'hero') ||
    (intent.productProminence === 'hero' &&
      profile.subjectProminence === 'absent')
  ) {
    // A backdrop slot filled with a hero product shot, or the reverse. Not a
    // ranking penalty — it is the wrong picture for this slot.
    placeable = false;
    reasons.push(
      `wants product ${intent.productProminence}, asset is ${profile.subjectProminence}`
    );
  }

  // ---- Composition: orientation, and where the empty space is -------------
  let composition = 0;
  if (profile.orientation === intent.orientation) {
    composition += 1;
    reasons.push('orientation');
  }
  if (intent.negativeSpace && intent.negativeSpace.side !== 'none') {
    if (profile.negativeSpace.side === intent.negativeSpace.side) {
      composition += 2;
      reasons.push(`negative space ${intent.negativeSpace.side}`);
      if (
        AMOUNT_RANK[profile.negativeSpace.amount] >=
        AMOUNT_RANK[intent.negativeSpace.amount]
      ) {
        composition += 1;
      }
    } else {
      // Text would land on the product. Placeable only if nothing overlays it,
      // which the intent expresses by asking for no negative space at all.
      composition -= 1;
      reasons.push(
        `negative space on ${profile.negativeSpace.side}, scene needs ${intent.negativeSpace.side}`
      );
    }
  }

  // ---- Brand fit ----------------------------------------------------------
  let brandFit = 0;
  const wantedPalette = (intent.paletteRefs ?? []).map(normaliseHex);
  if (wantedPalette.length && profile.dominantColors.length) {
    const assetPalette = profile.dominantColors.map(normaliseHex);
    // Exact hex agreement only. Perceptual distance would be better and is not
    // worth faking here — a near-miss scores zero rather than a made-up number.
    if (assetPalette.some((colour) => wantedPalette.includes(colour))) {
      brandFit += 1;
      reasons.push('palette');
    }
  }

  // ---- Must-show coverage -------------------------------------------------
  const coverage = mustShowCoverage(intent, profile);
  const mustShow = Math.round(coverage * 2);
  if (intent.mustShow.length) {
    if (coverage === 0) {
      placeable = false;
      reasons.push(`shows none of: ${intent.mustShow.join(', ')}`);
    } else if (coverage === 1) {
      reasons.push('shows everything the scene requires');
    }
  }

  const total =
    affordance + prominence + composition + quality + brandFit + mustShow;

  return {
    candidate,
    score: {
      affordance,
      prominence,
      composition,
      quality,
      brandFit,
      mustShow,
      total,
    },
    reasons,
    placeable,
  };
}

/** Product shots, best first — what image-to-image conditions on. */
function productReferences(candidates: AssetCandidate[]): string[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.profile.role === 'product-iso' ||
        (candidate.profile.subjectPresent &&
          candidate.profile.subjectProminence === 'hero')
    )
    .sort((a, b) => {
      // An isolated product on a clean background conditions better than the
      // same product inside a scene the generator then has to argue with.
      const rank = (profile: AssetProfile) =>
        (profile.role === 'product-iso' ? 0 : 1) +
        (profile.background === 'white' || profile.background === 'transparent'
          ? 0
          : 1);
      return rank(a.profile) - rank(b.profile);
    })
    .map((candidate) => candidate.assetId);
}

/** A real environment the product can be placed into. */
function backdropCandidate(
  candidates: AssetCandidate[]
): AssetCandidate | undefined {
  return candidates.find(
    (candidate) =>
      !candidate.profile.hasBakedText &&
      (candidate.profile.role === 'background' ||
        candidate.profile.affordances.includes('backdrop-layer')) &&
      candidate.profile.subjectProminence === 'absent'
  );
}

/**
 * Choose how to fill one image slot.
 *
 * Order matters: place a real photo if one genuinely fits, else composite when
 * both halves of the picture exist as real assets, else condition generation on
 * a product shot, else generate. Each step down spends more and invents more.
 */
export function matchAssetToIntent(
  intent: ImageIntent,
  candidates: AssetCandidate[]
): AssetMatch {
  const references = productReferences(candidates);

  if (!candidates.length) {
    return { strategy: 'generate', reasons: ['no assets available'] };
  }

  const scored = candidates
    .map((candidate) => scoreCandidate(intent, candidate))
    .sort((a, b) => b.score.total - a.score.total);

  const best = scored.find((entry) => entry.placeable);
  if (best && best.score.total >= PLACE_THRESHOLD) {
    return {
      strategy: 'place',
      assetId: best.candidate.assetId,
      score: best.score,
      reasons: best.reasons,
    };
  }

  /**
   * Why the closest asset was turned down. This is the part a seller actually
   * wants when their own photo was not used — "we generated instead" is not an
   * answer, "your photo has text baked into it" is.
   */
  const declined = scored[0];
  const declinedReasons = declined
    ? declined.reasons.map(
        (reason) => `${declined.candidate.assetId}: ${reason}`
      )
    : [];

  // A real backdrop plus a real product beats generating either of them.
  const backdrop =
    intent.subject === 'scene' && intent.productProminence !== 'absent'
      ? backdropCandidate(candidates)
      : undefined;
  if (backdrop && references.length) {
    return {
      strategy: 'composite',
      assetId: backdrop.assetId,
      referenceAssetIds: references.slice(0, 2),
      score: scored.find(
        (entry) => entry.candidate.assetId === backdrop.assetId
      )?.score,
      reasons: [
        'real backdrop and a real product shot — compose rather than invent',
        ...(best ? [`best placement scored ${best.score.total}`] : []),
        ...declinedReasons,
      ],
    };
  }

  if (references.length) {
    return {
      strategy: 'reference-generate',
      referenceAssetIds: references.slice(0, 2),
      score: best?.score,
      reasons: [
        best
          ? `no asset fit the slot (best ${best.score.total} < ${PLACE_THRESHOLD})`
          : 'no placeable asset',
        ...declinedReasons,
        'generating from the product photos so the product stays itself',
      ],
    };
  }

  return {
    strategy: 'generate',
    score: best?.score,
    reasons: ['no product photo to condition on', ...declinedReasons],
  };
}
