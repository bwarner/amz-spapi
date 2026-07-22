import { z } from 'zod';
import type { APlusGeneratedModuleKind } from './aplus.js';
import {
  ArtDirectionSchema,
  ConversionJobSchema,
  type Experience,
  type LayoutArchetype,
} from './experience.js';

// ---------------------------------------------------------------------------
// Narrative Engine vocabulary (redesign §5a): the planning call emits ordered
// BEATS — each one section-to-be with a conversion job, a layout archetype,
// and a one-sentence intent. Beats drive the module writers (via
// moduleKindForBeat) and override the lift's job/archetype inference, so the
// narrative arc is CHOSEN by strategy, not inferred from layouts.
// ---------------------------------------------------------------------------

/**
 * Archetypes the Basic A+ planner may choose. Excludes qna/hotspots/carousel
 * (Premium-native — see PREMIUM_PLANNABLE_ARCHETYPES), video (no sourcing
 * pipeline) and stat-band (compile-target only — no writable module kind lifts
 * back to it).
 */
export const APLUS_PLANNABLE_ARCHETYPES = [
  'full-bleed-hero',
  'split-LR',
  'lifestyle-immersion',
  'problem-solution',
  'feature-grid',
  'icon-row',
  'comparison-table',
  'dual-use-split',
  'spec-sheet',
  'brand-story-band',
] as const satisfies readonly LayoutArchetype[];
export type AplusPlannableArchetype =
  (typeof APLUS_PLANNABLE_ARCHETYPES)[number];

/** Premium A+ adds the EBC-native interactive/showcase archetypes. */
export const PREMIUM_PLANNABLE_ARCHETYPES = [
  ...APLUS_PLANNABLE_ARCHETYPES,
  'qna',
  'hotspots',
  'carousel',
] as const satisfies readonly LayoutArchetype[];
export type PremiumPlannableArchetype =
  (typeof PREMIUM_PLANNABLE_ARCHETYPES)[number];

// One WIDE beat schema across tiers — Basic safety is enforced in
// sanitizeNarrativeBeats (allowedArchetypes), not by parse failure, so a
// premium beat in a Basic run degrades gracefully instead of being dropped.
export const NarrativeBeatSchema = z.object({
  order: z.number().int().positive(),
  job: ConversionJobSchema,
  archetype: z.enum(PREMIUM_PLANNABLE_ARCHETYPES),
  /** One sentence: what this section must make the buyer believe or feel. */
  intent: z.string().min(1).max(200),
  /** Optional short angle for the headline — direction, not final copy. */
  headlineAngle: z.string().max(120).optional(),
  /** Uploaded asset fileNames to feature in this section. */
  assetsToUse: z.array(z.string().max(120)).max(6).default([]),
});
export type NarrativeBeat = z.infer<typeof NarrativeBeatSchema>;

export const NarrativePlanSchema = z.object({
  productSummary: z.string(),
  buyer: z.object({
    likelyCustomer: z.string(),
    purchaseContext: z.string(),
    mainObjections: z.array(z.string()),
  }),
  usableAssets: z.array(
    z.object({
      fileName: z.string(),
      likelyUse: z.string(),
      confidence: z.enum(['low', 'medium', 'high']),
      notes: z.string(),
    })
  ),
  missingFacts: z.array(
    z.object({
      fact: z.string(),
      whyItMatters: z.string(),
      canProceedWithoutIt: z.boolean(),
    })
  ),
  artDirection: ArtDirectionSchema,
  beats: z.array(NarrativeBeatSchema).min(1),
});
export type NarrativePlan = z.infer<typeof NarrativePlanSchema>;

/**
 * The module kind the writers produce for a beat. Job-sensitive where one
 * archetype maps to two kinds. Total over APLUS_PLANNABLE_ARCHETYPES.
 */
export function moduleKindForBeat(
  beat: Pick<NarrativeBeat, 'job' | 'archetype'>
): APlusGeneratedModuleKind {
  switch (beat.archetype) {
    case 'full-bleed-hero':
      return 'image-text-overlay';
    case 'split-LR':
      return 'image-and-text';
    case 'lifestyle-immersion':
    case 'problem-solution':
      // problem-solution shares the module shape; the lift re-tags it.
      return 'image-header-with-text';
    case 'feature-grid':
      return beat.job === 'use-cases'
        ? 'four-image-text-quadrant'
        : 'three-image-text';
    case 'icon-row':
      return 'icon-row';
    case 'comparison-table':
      return 'comparison-table';
    case 'dual-use-split':
      return 'dual-use-split';
    case 'spec-sheet':
      return 'tech-specs';
    case 'brand-story-band':
      return beat.job === 'hook' || beat.job === 'brand'
        ? 'company-logo'
        : 'text-only';
    case 'qna':
      return 'qna';
    case 'hotspots':
      return 'hotspots';
    case 'carousel':
      return 'carousel';
  }
}

/**
 * Today's deterministic default story, expressed as beats — the fallback when
 * planning fails or comes back unusable, and the padding source. Rotated per
 * product (same name-length trick as the old defaultSequence) so two products
 * don't pad to an identical tail.
 */
export function fallbackNarrativeBeats(
  productName: string,
  maxBeats: number
): NarrativeBeat[] {
  const sequence: Array<Omit<NarrativeBeat, 'order'>> = [
    {
      job: 'hook',
      archetype: 'full-bleed-hero',
      intent: `Give shoppers a fast, clear reason to keep reading about ${productName}.`,
      assetsToUse: [],
    },
    {
      job: 'benefit',
      archetype: 'feature-grid',
      intent: 'Turn the strongest features into scannable buyer benefits.',
      assetsToUse: [],
    },
    {
      job: 'use-cases',
      archetype: 'dual-use-split',
      intent:
        'Show two contrasting real-life scenarios where the product shines.',
      assetsToUse: [],
    },
    {
      job: 'comparison',
      archetype: 'comparison-table',
      intent: 'Help shoppers choose confidently without promotional claims.',
      assetsToUse: [],
    },
    {
      job: 'proof',
      archetype: 'spec-sheet',
      intent: 'Answer practical questions with exact dimensions and materials.',
      assetsToUse: [],
    },
    {
      job: 'brand',
      archetype: 'brand-story-band',
      intent: 'Close with the brand story and build lasting trust.',
      assetsToUse: [],
    },
  ];
  const rot = productName.length % sequence.length;
  const rotated = [...sequence.slice(rot), ...sequence.slice(0, rot)];
  return rotated
    .slice(0, Math.max(1, maxBeats))
    .map((beat, index) => ({ ...beat, order: index + 1 }));
}

/** Archetypes strong enough to open the page above the fold. */
export const OPENER_ARCHETYPES: readonly PremiumPlannableArchetype[] = [
  'full-bleed-hero',
  'lifestyle-immersion',
  'split-LR',
  'problem-solution',
  'dual-use-split',
  'feature-grid',
  'brand-story-band',
  'carousel',
];

/** Premium showcase archetypes: at most ONE of each per page. */
const SINGLETON_ARCHETYPES: ReadonlySet<string> = new Set([
  'qna',
  'hotspots',
  'carousel',
]);

/**
 * Archetypes that render as one edge-to-edge photograph. Two of them in a row
 * read as a tiled contact sheet rather than a story — the eye gets no text
 * band to rest on — so sanitizeNarrativeBeats separates them even though their
 * archetypes differ (which is why the layout-diversity rule alone misses it).
 */
export const IMMERSIVE_ARCHETYPES: readonly LayoutArchetype[] = [
  'full-bleed-hero',
  'lifestyle-immersion',
  'problem-solution',
  'hotspots',
  'carousel',
  'video',
];

const IMMERSIVE_SET: ReadonlySet<string> = new Set(IMMERSIVE_ARCHETYPES);

/** True when the archetype renders as a full-bleed photo module. */
export function isImmersiveArchetype(archetype: string): boolean {
  return IMMERSIVE_SET.has(archetype);
}

/**
 * Makes any model-planned beat list safe to execute: drops invalid entries,
 * coerces archetypes the target tier can't execute (job/intent preserved),
 * clamps to the budget, renumbers 1..N, breaks back-to-back archetype repeats
 * (layout-diversity rule), forces a VISUAL opener (a spec table above the
 * fold kills the page), and pads up to maxBeats from the fallback story.
 * Pure and total — an empty/garbage plan yields the full fallback.
 */
export function sanitizeNarrativeBeats(
  beats: NarrativeBeat[],
  opts: {
    maxBeats: number;
    productName: string;
    /**
     * Archetypes the target tier can execute. Defaults to the Basic set so
     * forgotten callers stay Basic-safe; Premium runs pass
     * PREMIUM_PLANNABLE_ARCHETYPES.
     */
    allowedArchetypes?: readonly PremiumPlannableArchetype[];
  }
): NarrativeBeat[] {
  const allowed = new Set<string>(
    opts.allowedArchetypes ?? APLUS_PLANNABLE_ARCHETYPES
  );
  // Disallowed archetypes COERCE to their closest executable neighbor (never
  // dropped — the beat is a story decision, the archetype just its costume),
  // and premium showcase archetypes are singletons: at most ONE each of
  // qna/hotspots/carousel per page. Coercion targets are always plain Basic
  // archetypes, so one pass settles both rules.
  const singletonSeen = new Set<string>();
  const coerce = (beat: NarrativeBeat): NarrativeBeat => {
    let archetype = beat.archetype;
    if (
      !allowed.has(archetype) ||
      (SINGLETON_ARCHETYPES.has(archetype) && singletonSeen.has(archetype))
    ) {
      archetype = NON_PLANNABLE_COERCION[archetype] ?? 'lifestyle-immersion';
    }
    if (SINGLETON_ARCHETYPES.has(archetype)) singletonSeen.add(archetype);
    return archetype === beat.archetype ? beat : { ...beat, archetype };
  };
  const valid = beats
    .filter((beat) => NarrativeBeatSchema.safeParse(beat).success)
    .sort((a, b) => a.order - b.order)
    .map(coerce);

  // Layout diversity: never the same archetype twice in a row.
  const diverse: NarrativeBeat[] = [];
  for (const beat of valid) {
    if (diverse[diverse.length - 1]?.archetype === beat.archetype) continue;
    diverse.push(beat);
    if (diverse.length >= opts.maxBeats) break;
  }

  // A CLOSING bare logo band wastes a module slot (brand-story-band remains
  // legal as the opening hook) — enforce what the prompt only requests.
  while (
    diverse.length > 1 &&
    diverse[diverse.length - 1].archetype === 'brand-story-band' &&
    diverse[diverse.length - 1].job !== 'hook'
  ) {
    diverse.pop();
  }

  // Pad up to the budget from the FULL fallback story, keeping diversity
  // (never padding with a brand band — padding buys conversion, not
  // decoration).
  const fallback = fallbackNarrativeBeats(opts.productName, 6);
  const usedArchetypes = new Set(diverse.map((beat) => beat.archetype));
  for (const candidate of fallback) {
    if (diverse.length >= opts.maxBeats) break;
    if (candidate.archetype === 'brand-story-band') continue;
    if (usedArchetypes.has(candidate.archetype)) continue;
    if (diverse[diverse.length - 1]?.archetype === candidate.archetype)
      continue;
    usedArchetypes.add(candidate.archetype);
    diverse.push(candidate);
  }

  // Visual opener LAST (padding can otherwise leave a table first): promote
  // the first opener-worthy beat, or synthesize a hero.
  if (diverse.length && !OPENER_ARCHETYPES.includes(diverse[0].archetype)) {
    const openerIndex = diverse.findIndex((beat) =>
      OPENER_ARCHETYPES.includes(beat.archetype)
    );
    if (openerIndex > 0) {
      const [opener] = diverse.splice(openerIndex, 1);
      diverse.unshift(opener);
    } else {
      diverse.unshift({
        order: 0,
        job: 'hook',
        archetype: 'full-bleed-hero',
        intent: `Give shoppers a fast, clear reason to keep reading about ${opts.productName}.`,
        assetsToUse: [],
      });
    }
  }

  // Immersive separation: two edge-to-edge photo modules in a row read as a
  // tiled contact sheet (see IMMERSIVE_ARCHETYPES) — pull the NEXT
  // text-anchored beat between them, preserving story order otherwise. Runs
  // after opener promotion (which can itself create a photo-photo pair).
  for (let i = 0; i + 1 < diverse.length; i++) {
    if (!isImmersiveArchetype(diverse[i].archetype)) continue;
    if (!isImmersiveArchetype(diverse[i + 1].archetype)) continue;
    const breakerIndex = diverse.findIndex(
      (beat, index) =>
        index > i + 1 &&
        !isImmersiveArchetype(beat.archetype) &&
        // Taking this beat must not butt its neighbors' identical
        // archetypes together (would violate layout diversity).
        (index + 1 >= diverse.length ||
          diverse[index - 1].archetype !== diverse[index + 1].archetype)
    );
    if (breakerIndex < 0) break; // nothing text-anchored left to separate with
    const [breaker] = diverse.splice(breakerIndex, 1);
    diverse.splice(i + 1, 0, breaker);
  }

  return diverse
    .slice(0, opts.maxBeats)
    .map((beat, index) => ({ ...beat, order: index + 1 }));
}

/**
 * Coercions for archetypes a tier can't execute — used when a Basic run must
 * downgrade a premium beat, and when deriving beats from converted drafts.
 */
const NON_PLANNABLE_COERCION: Partial<
  Record<LayoutArchetype, AplusPlannableArchetype>
> = {
  hotspots: 'split-LR',
  video: 'lifestyle-immersion',
  carousel: 'feature-grid',
  qna: 'spec-sheet',
  'stat-band': 'icon-row',
};

/**
 * Derives the beat list from an Experience — the regeneration context. Works
 * on any experience (including old converted drafts): non-plannable archetypes
 * coerce to their closest plannable neighbor. Premium archetypes pass through
 * so regenerating a qna/hotspots/carousel section returns the same kind.
 */
export function beatsFromExperience(experience: Experience): NarrativeBeat[] {
  return [...experience.sections]
    .sort((a, b) => a.order - b.order)
    .map((section, index) => {
      const archetype = section.visual.layout.archetype;
      const plannable = (
        PREMIUM_PLANNABLE_ARCHETYPES as readonly string[]
      ).includes(archetype)
        ? (archetype as PremiumPlannableArchetype)
        : NON_PLANNABLE_COERCION[archetype] ?? 'lifestyle-immersion';
      return {
        order: index + 1,
        job: section.job,
        archetype: plannable,
        intent: section.intent.slice(0, 200) || `Section ${index + 1}`,
        headlineAngle: section.headline?.slice(0, 120),
        assetsToUse: [],
      };
    });
}
