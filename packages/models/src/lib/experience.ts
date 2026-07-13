import { z } from 'zod';
import { APlusGeneratedModuleSchema, APlusImageSchema } from './aplus.js';

// ---------------------------------------------------------------------------
// Experience / Section data model (docs/redesign-proposal.md §4, vocabulary v1).
//
// The unit of work is an EXPERIENCE — a conversion-driven narrative of
// SECTIONS, each with one job — and Amazon formats are DEPLOYMENT TARGETS: a
// per-format compiler (see aplus-compiler.ts) turns sections into modules at
// the end. Strategy/narrative/visual stay format-agnostic.
// ---------------------------------------------------------------------------

// -------------------------------- Vocabulary --------------------------------

/** Conversion jobs a section can carry (doc §4 vocabulary v1). */
export const CONVERSION_JOBS = [
  'hook',
  'problem',
  'benefit',
  'how-it-works',
  'differentiation',
  'proof',
  'comparison',
  'use-cases',
  'brand',
  'cta',
] as const;
export const ConversionJobSchema = z.enum(CONVERSION_JOBS);
export type ConversionJob = z.infer<typeof ConversionJobSchema>;

export const DEPLOYMENT_FORMATS = [
  'aplus',
  'premium-aplus',
  'brand-story',
  'listing',
] as const;
export const DeploymentFormatSchema = z.enum(DEPLOYMENT_FORMATS);
export type DeploymentFormat = z.infer<typeof DeploymentFormatSchema>;

/**
 * Layout archetypes, DECOUPLED from Amazon module names (doc §4 table, plus
 * `qna` — the doc's structured-content list includes it even though the
 * archetype table omits it).
 */
export const LAYOUT_ARCHETYPES = [
  'full-bleed-hero',
  'split-LR',
  'lifestyle-immersion',
  'feature-grid',
  'icon-row',
  'comparison-table',
  'problem-solution',
  'dual-use-split',
  'stat-band',
  'spec-sheet',
  'qna',
  'brand-story-band',
  'hotspots',
  'video',
  'carousel',
] as const;
export const LayoutArchetypeSchema = z.enum(LAYOUT_ARCHETYPES);
export type LayoutArchetype = z.infer<typeof LayoutArchetypeSchema>;

export type ArchetypeCapability = {
  medium: 'static' | 'hotspots' | 'video';
  /** Formats that host this archetype natively. */
  nativeFormats: readonly DeploymentFormat[];
  /** How it degrades when compiled to a format that doesn't host it natively. */
  degradesTo?: LayoutArchetype | 'annotated-static' | 'poster-frame';
  /**
   * true → compiles to NATIVE Amazon module fields (real text, no pixels);
   * false → deploys as a designed image (doc: "structured sections → NATIVE
   * modules (decided)").
   */
  structured: boolean;
};

const ALL_FORMATS = DEPLOYMENT_FORMATS;
const APLUS_FORMATS = ['aplus', 'premium-aplus'] as const;

export const ARCHETYPE_CAPABILITIES: Record<
  LayoutArchetype,
  ArchetypeCapability
> = {
  'full-bleed-hero': {
    medium: 'static',
    nativeFormats: ALL_FORMATS,
    structured: false,
  },
  'split-LR': {
    medium: 'static',
    nativeFormats: ALL_FORMATS,
    structured: false,
  },
  'lifestyle-immersion': {
    medium: 'static',
    nativeFormats: ALL_FORMATS,
    structured: false,
  },
  'feature-grid': {
    medium: 'static',
    nativeFormats: ALL_FORMATS,
    structured: false,
  },
  'icon-row': {
    medium: 'static',
    nativeFormats: ALL_FORMATS,
    structured: false,
  },
  'comparison-table': {
    medium: 'static',
    nativeFormats: APLUS_FORMATS,
    structured: true,
  },
  'problem-solution': {
    medium: 'static',
    nativeFormats: ALL_FORMATS,
    structured: false,
  },
  'dual-use-split': {
    medium: 'static',
    nativeFormats: ALL_FORMATS,
    structured: false,
  },
  'stat-band': {
    medium: 'static',
    nativeFormats: ALL_FORMATS,
    structured: false,
  },
  'spec-sheet': {
    medium: 'static',
    nativeFormats: APLUS_FORMATS,
    structured: true,
  },
  // qna is Premium-A+/Listing-native; degrades on Standard A+ (doc).
  qna: {
    medium: 'static',
    nativeFormats: ['premium-aplus', 'listing'],
    degradesTo: 'brand-story-band',
    structured: true,
  },
  'brand-story-band': {
    medium: 'static',
    nativeFormats: ['aplus', 'premium-aplus', 'brand-story'],
    structured: false,
  },
  hotspots: {
    medium: 'hotspots',
    nativeFormats: ['premium-aplus'],
    degradesTo: 'annotated-static',
    structured: false,
  },
  video: {
    medium: 'video',
    nativeFormats: ['premium-aplus', 'listing'],
    degradesTo: 'poster-frame',
    structured: false,
  },
  carousel: {
    medium: 'static',
    nativeFormats: ['premium-aplus'],
    degradesTo: 'feature-grid',
    structured: false,
  },
};

// ------------------------------- Image intents ------------------------------

export const ImageIntentSchema = z.object({
  subject: z.enum(['product', 'scene', 'background', 'detail']),
  mustShow: z.array(z.string().max(80)).max(6).default([]),
  orientation: z.enum(['portrait', 'landscape', 'square']),
  negativeSpace: z
    .object({
      side: z.enum(['left', 'right', 'top', 'bottom', 'none']),
      amount: z.enum(['low', 'medium', 'high']),
    })
    .optional(),
  productProminence: z.enum(['hero', 'soft', 'absent']),
  moodRefs: z.array(z.string().max(80)).optional(),
  paletteRefs: z.array(z.string().max(40)).optional(),
});
export type ImageIntent = z.infer<typeof ImageIntentSchema>;

export const ImageSourceDecisionSchema = z.object({
  strategy: z.enum(['place', 'reference-generate', 'generate', 'composite']),
  assetId: z.string().optional(),
  referenceAssetIds: z.array(z.string()).optional(),
  /** Generation brief (today's slot.brief). */
  brief: z.string().max(1200).optional(),
});
export type ImageSourceDecision = z.infer<typeof ImageSourceDecisionSchema>;

/** Named to avoid clashing with the module-level APlusImageSlot. */
export const ExperienceImageSlotSchema = z.object({
  role: z.string().min(1).max(60),
  intent: ImageIntentSchema,
  source: ImageSourceDecisionSchema,
  alt: z.string().max(160),
  /** Already generated/placed image, kept for lossless round-trips. */
  resolved: APlusImageSchema.optional(),
});
export type ExperienceImageSlot = z.infer<typeof ExperienceImageSlotSchema>;

// ------------------------------ Layout intents -------------------------------

const tileSchema = z.object({
  headline: z.string().max(160).optional(),
  body: z.string().max(400).optional(),
  /** References a VisualConcept.images[].role. */
  imageRole: z.string().max(60),
});

const heroHints = {
  /** Short spec/size pill (e.g. "50-PACK"); never price/promo. */
  badge: z.string().max(16).optional(),
};

/**
 * Discriminated union on `archetype`. Structured archetypes carry their
 * content (the data IS the message); image archetypes carry presentation
 * hints that preserve today's module-level knobs so lift/compile round-trips
 * are lossless.
 */
export const LayoutIntentSchema = z.discriminatedUnion('archetype', [
  z.object({
    archetype: z.literal('full-bleed-hero'),
    overlayPosition: z.enum(['left', 'right', 'center']).optional(),
    ...heroHints,
  }),
  z.object({
    archetype: z.literal('split-LR'),
    /** Present → deploys as image-and-text; absent → single-image-text. */
    imagePosition: z.enum(['left', 'right']).optional(),
    ...heroHints,
  }),
  z.object({ archetype: z.literal('lifestyle-immersion'), ...heroHints }),
  z.object({ archetype: z.literal('problem-solution'), ...heroHints }),
  z.object({
    archetype: z.literal('feature-grid'),
    tiles: z.array(tileSchema).min(3).max(6),
  }),
  z.object({
    archetype: z.literal('icon-row'),
    items: z
      .array(z.object({ icon: z.string().max(40), label: z.string().max(40) }))
      .min(2)
      .max(6),
  }),
  z.object({
    archetype: z.literal('comparison-table'),
    columns: z
      .array(
        z.object({
          title: z.string().max(100),
          highlight: z.boolean().optional(),
          imageRole: z.string().max(60).optional(),
        })
      )
      .min(2)
      .max(6),
    rows: z.array(
      z.object({
        label: z.string().max(60),
        values: z.array(z.string().max(80)),
      })
    ),
  }),
  z.object({
    archetype: z.literal('dual-use-split'),
    panels: z
      .array(
        z.object({
          label: z.string().max(40),
          caption: z.string().max(160).optional(),
          imageRole: z.string().max(60),
        })
      )
      .length(2),
  }),
  z.object({
    archetype: z.literal('stat-band'),
    stats: z
      .array(z.object({ value: z.string().max(16), label: z.string().max(40) }))
      .min(2)
      .max(6),
  }),
  z.object({
    archetype: z.literal('spec-sheet'),
    rows: z
      .array(
        z.object({ label: z.string().max(60), value: z.string().max(200) })
      )
      .min(1),
  }),
  z.object({
    archetype: z.literal('qna'),
    items: z
      .array(
        z.object({
          question: z.string().max(200),
          answer: z.string().max(800),
        })
      )
      .min(1),
  }),
  z.object({
    archetype: z.literal('brand-story-band'),
    /** logo-band → company-logo module; text-band → text-only module. */
    presentation: z.enum(['logo-band', 'text-band']).default('logo-band'),
    placement: z.enum(['header', 'footer']).optional(),
    heroVariant: z.string().optional(),
    logoCorner: z.string().optional(),
  }),
  z.object({
    archetype: z.literal('hotspots'),
    baseImageRole: z.string().max(60),
    hotspots: z
      .array(
        z.object({
          position: z.object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
          }),
          label: z.string().max(60),
          copy: z.string().max(200),
        })
      )
      .min(1),
  }),
  z.object({
    archetype: z.literal('video'),
    intent: z.string().max(300),
    source: z.enum(['ugc', 'uploaded', 'generated', 'stock']),
    /** REQUIRED — the static fallback when a format can't host video. */
    posterFrameRole: z.string().max(60),
    captions: z.string().optional(),
  }),
  z.object({
    archetype: z.literal('carousel'),
    imageRoles: z.array(z.string().max(60)).min(2),
  }),
]);
export type LayoutIntent = z.infer<typeof LayoutIntentSchema>;

// ---------------------------- Visual concept / section ----------------------

export const CompositionSchema = z.object({
  /** Target aspect for this surface, e.g. '970:600'. */
  aspect: z.string().max(20),
  focalHierarchy: z.array(z.string().max(120)).default([]),
  textZones: z.array(z.string().max(120)).default([]),
  copyPlacement: z.string().max(200).optional(),
});
export type Composition = z.infer<typeof CompositionSchema>;

export const VisualConceptSchema = z.object({
  medium: z.enum(['static', 'hotspots', 'video']).default('static'),
  layout: LayoutIntentSchema,
  desktop: CompositionSchema,
  /** Separately composed, NOT a resize. N/A for structured archetypes (Amazon reflows natively). */
  mobile: CompositionSchema.optional(),
  images: z.array(ExperienceImageSlotSchema).default([]),
});
export type VisualConcept = z.infer<typeof VisualConceptSchema>;

export const SectionSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  job: ConversionJobSchema,
  /** 1 sentence: what this section must accomplish. */
  intent: z.string().max(200),
  headline: z.string().max(160).optional(),
  subcopy: z.string().max(1200).optional(),
  bullets: z.array(z.string().max(160)).max(6).optional(),
  proofPoints: z.array(z.string().max(160)).optional(),
  visual: VisualConceptSchema,
  /** Seller-locked → regeneration must not touch this section. */
  locked: z.boolean().default(false),
  /** Seller direction, consumed by per-section regeneration. */
  notes: z.string().max(1000).optional(),
});
export type Section = z.infer<typeof SectionSchema>;

/** Today's creativeDirection shape — the lift from a generated package is lossless. */
export const ArtDirectionSchema = z.object({
  positioning: z.string(),
  visualSystem: z.string(),
  mobilePrinciple: z.string(),
  imagePlan: z.string(),
});
export type ArtDirection = z.infer<typeof ArtDirectionSchema>;

export const ExperienceSchema = z.object({
  id: z.string().min(1),
  productId: z.string().optional(),
  // Doc says brandId "always present", but no brand entity IDs exist in the
  // pipeline yet — optional until Brand Intelligence lands.
  brandId: z.string().optional(),
  strategyId: z.string().optional(),
  title: z.string().max(200),
  /** Overall conversion goal (lifted from the package executive summary). */
  goal: z.string().max(1000),
  primaryPersona: z.string().max(200).optional(),
  artDirection: ArtDirectionSchema,
  sections: z.array(SectionSchema),
  status: z.enum(['draft', 'ready', 'deployed']).default('draft'),
});
export type Experience = z.infer<typeof ExperienceSchema>;

// ------------------------------- Deployment ---------------------------------

/**
 * Amazon slice geometry. VALUES ARE ASSUMPTIONS from Seller Central
 * observation — VERIFY against the live A+ Content Manager before the scene
 * slicer ships (Phase 2): exact image slot pixel specs and inter-module gap.
 */
export const APLUS_SLICE_CONSTANTS = {
  /** Matches APLUS_CANVAS_WIDTH in the design renderer. */
  canvasWidth: 970,
  /** STANDARD_IMAGE_TEXT_OVERLAY image height (short slice). */
  sliceUnitPx: 300,
  /** STANDARD_HEADER_IMAGE_TEXT image height (tall slice). */
  tallSlicePx: 600,
  /** No focal element within this distance of an internal cut. */
  seamSafePx: 40,
  /**
   * HARD Amazon module caps per tier. The lower per-tier content targets
   * (5/7 in aplusModuleLimitForTier) are generation guidance — the pipeline
   * legitimately adds a brand-footer bookend on top of them.
   */
  moduleBudget: { basic: 7, premium: 7 },
} as const;

export const SliceSpecSchema = z.object({
  index: z.number().int().nonnegative(),
  offsetY: z.number().int().nonnegative(),
  height: z.union([z.literal(300), z.literal(600)]),
  /** True when the edge is an internal cut needing a seam-safe zone. */
  seamSafeTop: z.boolean(),
  seamSafeBottom: z.boolean(),
});
export type SliceSpec = z.infer<typeof SliceSpecSchema>;

export const ModuleMappingEntrySchema = z.object({
  /** Order of the compiled module in `modules`. */
  order: z.number().int().positive(),
  amazonModuleType: z.string(),
  sectionIds: z.array(z.string()).min(1),
  kind: z.enum(['native', 'designed-image', 'image-slice-stack']),
  /** Present when kind = image-slice-stack: the Amazon-side upload plan. */
  slices: z.array(SliceSpecSchema).optional(),
});
export type ModuleMappingEntry = z.infer<typeof ModuleMappingEntrySchema>;

export const DeploymentValidationSchema = z.object({
  level: z.enum(['error', 'warning']),
  code: z.string(),
  message: z.string(),
  sectionId: z.string().optional(),
});
export type DeploymentValidation = z.infer<typeof DeploymentValidationSchema>;

export const AplusDeploymentSchema = z.object({
  experienceId: z.string(),
  format: DeploymentFormatSchema,
  /**
   * The strangler-fig contract: compiled output stays in today's module
   * union, so DesignedModule, the module-image route, moduleTextFields, and
   * the build sheet keep working unchanged.
   */
  modules: z.array(APlusGeneratedModuleSchema),
  moduleMapping: z.array(ModuleMappingEntrySchema),
  validation: z.array(DeploymentValidationSchema),
});
export type AplusDeployment = z.infer<typeof AplusDeploymentSchema>;

/** Human-readable archetype names for UI badges. */
export const ARCHETYPE_LABELS: Record<LayoutArchetype, string> = {
  'full-bleed-hero': 'Full-bleed hero',
  'split-LR': 'Split image + text',
  'lifestyle-immersion': 'Lifestyle immersion',
  'feature-grid': 'Feature grid',
  'icon-row': 'Icon highlights',
  'comparison-table': 'Comparison table',
  'problem-solution': 'Problem → solution',
  'dual-use-split': 'Two-scenario split',
  'stat-band': 'Stat band',
  'spec-sheet': 'Spec sheet',
  qna: 'Q&A',
  'brand-story-band': 'Brand band',
  hotspots: 'Hotspots',
  video: 'Video',
  carousel: 'Carousel',
};

/** Human-readable conversion-job names for UI badges. */
export const CONVERSION_JOB_LABELS: Record<ConversionJob, string> = {
  hook: 'Hook',
  problem: 'Problem',
  benefit: 'Benefit',
  'how-it-works': 'How it works',
  differentiation: 'Differentiation',
  proof: 'Proof',
  comparison: 'Comparison',
  'use-cases': 'Use cases',
  brand: 'Brand',
  cta: 'Call to action',
};
