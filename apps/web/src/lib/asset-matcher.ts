/**
 * Asset → slot matcher (redesign #26). Given a scene image slot's need and the
 * pool of profiled assets, decides whether a real asset can directly fill the
 * slot (`place`) or whether to generate (optionally with a product reference for
 * image-to-image). Pure + no I/O — safe on client or server.
 */

export type MatcherProfile = {
  role: string;
  subjectProminence: string;
  orientation: string;
  affordances: string[];
  hasBakedText: boolean;
};

export type MatcherCandidate = { assetId: string; profile: MatcherProfile };

export type SlotNeed = {
  /** Slot role, e.g. "hero", "comparison-thumb-1", "column-2", "background". */
  role: string;
  orientation: 'portrait' | 'landscape' | 'square';
};

export type MatchDecision =
  | { strategy: 'place'; assetId: string; score: number; reason: string }
  | { strategy: 'generate'; referenceAssetId?: string };

// Conservative: only place when we're confident, so an irrelevant photo never
// hijacks a slot. Needs the right affordance (+3) plus orientation (+1) or a
// direct role fit (+2).
const PLACE_THRESHOLD = 4;

/** Which asset affordance best fills this slot. */
function desiredAffordance(role: string): string {
  const r = role.toLowerCase();
  if (r.includes('hero') || r.includes('background') || r.includes('banner')) {
    return 'hero-bg';
  }
  if (r.includes('thumb') || r.includes('comparison')) {
    return 'comparison-thumb';
  }
  if (
    r.includes('column') ||
    r.includes('feature') ||
    r.includes('icon') ||
    r.includes('grid')
  ) {
    return 'feature-callout';
  }
  return 'carousel-tile';
}

export function matchAssetToSlot(
  need: SlotNeed,
  candidates: MatcherCandidate[]
): MatchDecision {
  const want = desiredAffordance(need.role);
  let best: { assetId: string; score: number; reason: string } | null = null;
  let bestProductRef: string | undefined;

  for (const candidate of candidates) {
    const p = candidate.profile;

    // Keep the strongest product-iso shot as a reference for the generate path.
    if (
      !bestProductRef &&
      (p.role === 'product-iso' || p.subjectProminence === 'hero')
    ) {
      bestProductRef = candidate.assetId;
    }

    // Baked-in text can't be placed directly (Amazon rejects text-in-image).
    if (p.hasBakedText) continue;

    let score = 0;
    const reasons: string[] = [];
    if (p.affordances.includes(want)) {
      score += 3;
      reasons.push(want);
    }
    if (p.orientation === need.orientation) {
      score += 1;
      reasons.push('orientation');
    }
    if (
      want === 'hero-bg' &&
      (p.role === 'product-in-scene' || p.role === 'background')
    ) {
      score += 2;
      reasons.push(p.role);
    }
    if (want === 'comparison-thumb' && p.role === 'product-iso') {
      score += 2;
      reasons.push('product-iso');
    }
    if (
      want === 'feature-callout' &&
      (p.role === 'detail-macro' || p.role === 'product-iso')
    ) {
      score += 1;
      reasons.push(p.role);
    }

    if (!best || score > best.score) {
      best = { assetId: candidate.assetId, score, reason: reasons.join('+') };
    }
  }

  if (best && best.score >= PLACE_THRESHOLD) {
    return {
      strategy: 'place',
      assetId: best.assetId,
      score: best.score,
      reason: best.reason,
    };
  }
  return { strategy: 'generate', referenceAssetId: bestProductRef };
}
