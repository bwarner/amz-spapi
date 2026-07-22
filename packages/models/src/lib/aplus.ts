import { z } from 'zod';

/**
 * Image URLs come in three shapes: absolute http(s), data URLs (in-memory
 * generations), and the app's own ROOT-RELATIVE asset routes
 * (`/api/a-plus/assets/<id>`). `z.string().url()` rejects relative paths —
 * which silently 400'd every module round-trip once images persisted — so
 * validate the union explicitly.
 */
const imageUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith('/') || /^(https?:|data:)/i.test(value),
    'Must be an absolute URL, data URL, or root-relative asset path'
  );

export const APlusImageSchema = z.object({
  url: imageUrlSchema,
  alt: z.string().min(1).max(160),
});
export type APlusImage = z.infer<typeof APlusImageSchema>;

const headlineField = z.string().max(160).optional();
const bodyField = z.string().max(800).optional();

// ---------------------------------------------------------------------------
// Finished A+ document. Modules carry RESOLVED images (url + alt). This is what
// the chat A+ tool produces and the <APlusPreview> component renders.
// ---------------------------------------------------------------------------

export const APlusModuleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('company-logo'),
    logo: APlusImageSchema,
  }),
  z.object({
    type: z.literal('image-header-with-text'),
    image: APlusImageSchema,
    headline: headlineField,
    body: bodyField,
  }),
  z.object({
    type: z.literal('image-text-overlay'),
    image: APlusImageSchema,
    headline: headlineField,
    body: bodyField,
    overlayPosition: z.enum(['left', 'right', 'center']).optional(),
  }),
  z.object({
    type: z.literal('image-and-text'),
    image: APlusImageSchema,
    imagePosition: z.enum(['left', 'right']),
    headline: headlineField,
    body: bodyField,
  }),
  z.object({
    type: z.literal('four-image-text-quadrant'),
    quadrants: z
      .array(
        z.object({
          image: APlusImageSchema,
          headline: z.string().max(160).optional(),
          body: z.string().max(400).optional(),
        })
      )
      .length(4),
  }),
  z.object({
    type: z.literal('comparison-table'),
    products: z
      .array(
        z.object({
          title: z.string().max(100),
          image: APlusImageSchema.optional(),
          highlight: z.boolean().optional(),
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
]);
export type APlusModule = z.infer<typeof APlusModuleSchema>;

export const APlusDocumentSchema = z.object({
  asin: z.string().optional(),
  productTitle: z.string(),
  modules: z.array(APlusModuleSchema).min(1).max(7),
  guardrailsApplied: z.array(z.string()).optional(),
});
export type APlusDocument = z.infer<typeof APlusDocumentSchema>;

// ---------------------------------------------------------------------------
// Generation schema. Modules describe image SLOTS (photographic briefs, no
// baked text/logos) that are generated or uploaded later. This is what the A+
// generator pipeline produces and the structured HTML renderer consumes. Text
// lives in real fields, never inside generated pixels.
// ---------------------------------------------------------------------------

export const APLUS_IMAGE_SIZES = [
  '1024x1024',
  '1792x1024',
  '1024x1792',
] as const;
export type APlusImageSize = (typeof APLUS_IMAGE_SIZES)[number];

export const APlusImageSlotSchema = z.object({
  role: z.string().min(1).max(60),
  brief: z.string().min(1).max(1200),
  size: z.enum(APLUS_IMAGE_SIZES),
  alt: z.string().min(1).max(160),
  image: APlusImageSchema.optional(),
});
export type APlusImageSlot = z.infer<typeof APlusImageSlotSchema>;

const genHeadline = z.string().max(160).optional();
const genBody = z.string().max(800).optional();
const genBullets = z.array(z.string().max(160)).max(6).optional();
/** Short spec/size badge overlaid on a hero (e.g. "16 OZ", "50-PACK"). */
const genBadge = z.string().max(16).optional();

const moduleBase = {
  order: z.number().int().nonnegative(),
  amazonModuleType: z.string().min(1).max(80),
  title: z.string().max(120),
};

const companyLogoModule = z.object({
  ...moduleBase,
  type: z.literal('company-logo'),
  logo: APlusImageSlotSchema,
  /** Brand/product headline shown over the hero backdrop (e.g. brand + product). */
  headline: z.string().max(120).optional(),
  /** Short brand promise / benefit subhead shown under the headline. */
  tagline: z.string().max(120).optional(),
  /** Ambient brand backdrop photo behind the logo (NOT the logo itself). */
  background: APlusImageSlotSchema.optional(),
  /** 'header' = opening brand hero (default); 'footer' = centered closing band. */
  placement: z.enum(['header', 'footer']).optional(),
  /**
   * AI-chosen hero treatment so pages don't all look identical:
   * 'overlay' = text on photo, logo in a corner bar; 'split' = photo beside a
   * brand panel; 'plate'/'glass' = logo card centered over the photo. Free
   * string so an unexpected value falls back to a default instead of failing.
   */
  heroVariant: z.string().optional(),
  /** Corner for the overlay logo bar (AI-chosen): 'bottom-left'|'bottom-right'. */
  logoCorner: z.string().optional(),
});
const imageHeaderWithTextModule = z.object({
  ...moduleBase,
  type: z.literal('image-header-with-text'),
  image: APlusImageSlotSchema,
  headline: genHeadline,
  body: genBody,
  badge: genBadge,
});
const imageTextOverlayModule = z.object({
  ...moduleBase,
  type: z.literal('image-text-overlay'),
  image: APlusImageSlotSchema,
  headline: genHeadline,
  body: genBody,
  overlayPosition: z.enum(['left', 'right', 'center']).optional(),
  badge: genBadge,
});
const singleImageTextModule = z.object({
  ...moduleBase,
  type: z.literal('single-image-text'),
  image: APlusImageSlotSchema,
  headline: genHeadline,
  body: genBody,
  bullets: genBullets,
  badge: genBadge,
});
const imageAndTextModule = z.object({
  ...moduleBase,
  type: z.literal('image-and-text'),
  image: APlusImageSlotSchema,
  imagePosition: z.enum(['left', 'right']),
  headline: genHeadline,
  body: genBody,
  bullets: genBullets,
  badge: genBadge,
});
const threeImageTextModule = z.object({
  ...moduleBase,
  type: z.literal('three-image-text'),
  columns: z
    .array(
      z.object({
        image: APlusImageSlotSchema,
        headline: z.string().max(160).optional(),
        body: z.string().max(400).optional(),
      })
    )
    .length(3),
});
const fourImageQuadrantModule = z.object({
  ...moduleBase,
  type: z.literal('four-image-text-quadrant'),
  quadrants: z
    .array(
      z.object({
        image: APlusImageSlotSchema,
        headline: z.string().max(160).optional(),
        body: z.string().max(400).optional(),
      })
    )
    .length(4),
});
const comparisonTableModule = z.object({
  ...moduleBase,
  type: z.literal('comparison-table'),
  products: z
    .array(
      z.object({
        title: z.string().max(100),
        image: APlusImageSlotSchema.optional(),
        highlight: z.boolean().optional(),
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
});
const techSpecsModule = z.object({
  ...moduleBase,
  type: z.literal('tech-specs'),
  headline: genHeadline,
  rows: z
    .array(
      z.object({
        label: z.string().max(60),
        value: z.string().max(200),
      })
    )
    .min(1),
});
const textOnlyModule = z.object({
  ...moduleBase,
  type: z.literal('text-only'),
  headline: genHeadline,
  body: z.string().max(1200),
  bullets: genBullets,
});
const dualUseSplitModule = z.object({
  ...moduleBase,
  type: z.literal('dual-use-split'),
  // Two side-by-side scenario panels (e.g. Hot vs Cold), each a labeled photo.
  panels: z
    .array(
      z.object({
        image: APlusImageSlotSchema,
        label: z.string().max(40),
        caption: z.string().max(160).optional(),
      })
    )
    .length(2),
});

/** Generic, brand-agnostic icon set for the icon-row benefit strip. */
export const ICON_ROW_ICONS = [
  'coffee',
  'leaf',
  'shield',
  'zap',
  'heart',
  'star',
  'package',
  'home',
  'gift',
  'sparkles',
  'building',
  'users',
  'check',
  'clock',
  'droplet',
  'thermometer',
] as const;
export type IconRowIcon = (typeof ICON_ROW_ICONS)[number];

const iconRowModule = z.object({
  ...moduleBase,
  type: z.literal('icon-row'),
  /**
   * 2–6 icon + short-label highlights (e.g. use cases or key benefits). `icon`
   * is a free string (the model picks an intuitive name); the renderer maps it
   * to the closest supported glyph, so an unknown name never breaks generation.
   */
  items: z
    .array(
      z.object({
        icon: z.string().max(40),
        label: z.string().max(40),
      })
    )
    .min(2)
    .max(6),
});

// ---------------------------------------------------------------------------
// Premium A+ (EBC) native module kinds. These exist ONLY on the Premium tier —
// the Basic compiler degrades their archetypes (see aplus-compiler.ts). Limits
// mirror Seller Central's Premium module fields (web-researched 2026-07 —
// VERIFY against the live Premium A+ Content Manager).
// ---------------------------------------------------------------------------

const qnaModule = z.object({
  ...moduleBase,
  type: z.literal('qna'),
  headline: genHeadline,
  // Premium Q&A: up to 5 pairs, questions ≤120 chars (VERIFY).
  items: z
    .array(
      z.object({
        question: z.string().min(1).max(120),
        answer: z.string().min(1).max(800),
      })
    )
    .min(1)
    .max(5),
});
const hotspotsModule = z.object({
  ...moduleBase,
  type: z.literal('hotspots'),
  headline: genHeadline,
  /** ONE wide base band showing the whole product; markers land on features. */
  image: APlusImageSlotSchema,
  // Premium Hotspots: up to 6 callouts, labels ≤50 chars (VERIFY).
  hotspots: z
    .array(
      z.object({
        /** Marker position as fractions of the base image (0..1). */
        position: z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
        }),
        label: z.string().min(1).max(50),
        copy: z.string().max(200),
      })
    )
    .min(1)
    .max(6),
});
const carouselModule = z.object({
  ...moduleBase,
  type: z.literal('carousel'),
  // Premium Simple Image Carousel: 2–6 slides, short per-slide copy (VERIFY).
  slides: z
    .array(
      z.object({
        image: APlusImageSlotSchema,
        headline: z.string().max(100).optional(),
        caption: z.string().max(200).optional(),
      })
    )
    .min(2)
    .max(6),
});

export const APlusGeneratedModuleSchema = z.discriminatedUnion('type', [
  companyLogoModule,
  iconRowModule,
  imageHeaderWithTextModule,
  imageTextOverlayModule,
  singleImageTextModule,
  imageAndTextModule,
  threeImageTextModule,
  fourImageQuadrantModule,
  comparisonTableModule,
  techSpecsModule,
  textOnlyModule,
  dualUseSplitModule,
  qnaModule,
  hotspotsModule,
  carouselModule,
]);
export type APlusGeneratedModule = z.infer<typeof APlusGeneratedModuleSchema>;
export type APlusGeneratedModuleKind = APlusGeneratedModule['type'];

/** Basic A+ module kinds covered by the structured generator/renderer. */
export const BASIC_A_PLUS_MODULE_TYPES = [
  'company-logo',
  'image-header-with-text',
  'image-text-overlay',
  'single-image-text',
  'image-and-text',
  'three-image-text',
  'four-image-text-quadrant',
  'comparison-table',
  'tech-specs',
  'text-only',
  'dual-use-split',
  'icon-row',
] as const satisfies readonly APlusGeneratedModuleKind[];

/** Module kinds that exist ONLY on the Premium A+ (EBC) tier. */
export const PREMIUM_A_PLUS_MODULE_TYPES = [
  'qna',
  'hotspots',
  'carousel',
] as const satisfies readonly APlusGeneratedModuleKind[];

/** Per-kind schema, so callers can constrain generation to one module type. */
export const APLUS_GENERATED_MODULE_SCHEMA_BY_KIND = {
  'company-logo': companyLogoModule,
  'image-header-with-text': imageHeaderWithTextModule,
  'image-text-overlay': imageTextOverlayModule,
  'single-image-text': singleImageTextModule,
  'image-and-text': imageAndTextModule,
  'three-image-text': threeImageTextModule,
  'four-image-text-quadrant': fourImageQuadrantModule,
  'comparison-table': comparisonTableModule,
  'tech-specs': techSpecsModule,
  'text-only': textOnlyModule,
  'dual-use-split': dualUseSplitModule,
  'icon-row': iconRowModule,
  qna: qnaModule,
  hotspots: hotspotsModule,
  carousel: carouselModule,
} as const satisfies Record<APlusGeneratedModuleKind, z.ZodTypeAny>;

export function generatedModuleSchemaForKind(
  kind: APlusGeneratedModuleKind
): z.ZodTypeAny {
  return APLUS_GENERATED_MODULE_SCHEMA_BY_KIND[kind];
}

/**
 * Maps an Amazon Seller Central module type (e.g. STANDARD_COMPARISON_TABLE) to
 * the internal structured kind. Unknown types fall back to single-image-text.
 */
// Real Amazon A+ Content (SP-API ContentModuleType) values mapped to our
// internal render kinds. Includes aliases the planner/strategy may emit so they
// resolve to the closest renderable layout.
export const AMAZON_MODULE_TYPE_TO_KIND: Record<
  string,
  APlusGeneratedModuleKind
> = {
  STANDARD_COMPANY_LOGO: 'company-logo',
  STANDARD_HEADER_IMAGE_TEXT: 'image-header-with-text',
  STANDARD_IMAGE_TEXT_OVERLAY: 'image-text-overlay',
  STANDARD_SINGLE_IMAGE_HIGHLIGHTS: 'single-image-text',
  STANDARD_SINGLE_IMAGE_SPECS_DETAIL: 'single-image-text',
  STANDARD_SINGLE_SIDE_IMAGE: 'image-and-text',
  STANDARD_IMAGE_SIDEBAR: 'image-and-text',
  STANDARD_THREE_IMAGE_TEXT: 'three-image-text',
  STANDARD_MULTIPLE_IMAGE_TEXT: 'three-image-text',
  STANDARD_FOUR_IMAGE_TEXT_QUADRANT: 'four-image-text-quadrant',
  STANDARD_FOUR_IMAGE_TEXT: 'four-image-text-quadrant',
  STANDARD_COMPARISON_TABLE: 'comparison-table',
  STANDARD_TECH_SPECS: 'tech-specs',
  STANDARD_PRODUCT_DESCRIPTION: 'text-only',
  STANDARD_TEXT: 'text-only',
  // Legacy app-invented codes — NOT real Seller Central module types. Kept only
  // so drafts generated before they were removed from the renderable set still
  // parse and render; new generations can no longer produce them, and
  // normalizeAmazonModuleType() rewrites them to a real type on draft load.
  STANDARD_DUAL_USE_SPLIT: 'dual-use-split', // legacy
  STANDARD_ICON_ROW: 'icon-row', // legacy
  // Premium A+ (EBC). App-invented identifiers — the SP-API A+ Content API is
  // STANDARD-only and Premium pages are built manually in Seller Central, so
  // no official enum exists. Build-sheet keys only; sellerCentralModuleName()
  // carries the seller-facing truth (VERIFY names against Seller Central).
  PREMIUM_QA: 'qna',
  PREMIUM_HOTSPOTS_1: 'hotspots',
  PREMIUM_SIMPLE_IMAGE_CAROUSEL: 'carousel',
  PREMIUM_FULL_IMAGE: 'image-header-with-text',
  PREMIUM_BACKGROUND_IMAGE_TEXT: 'image-text-overlay',
  PREMIUM_SINGLE_IMAGE_TEXT: 'single-image-text',
  PREMIUM_DUAL_IMAGES_TEXT: 'dual-use-split',
  PREMIUM_FOUR_IMAGES_TEXT: 'four-image-text-quadrant',
  PREMIUM_TEXT: 'text-only',
  PREMIUM_TECH_SPECS: 'tech-specs',
  PREMIUM_COMPARISON_TABLE_1: 'comparison-table',
};

export function amazonModuleTypeToKind(
  amazonModuleType: string
): APlusGeneratedModuleKind {
  return AMAZON_MODULE_TYPE_TO_KIND[amazonModuleType] ?? 'single-image-text';
}

/**
 * Popular Anthropic + OpenAI models (AI Gateway slugs) the A+ generator may run.
 * Shared so the UI renders the picker and the API validates against the SAME
 * allowlist — never trust an arbitrary model id from the client.
 */
export type AplusGenerationModel = {
  id: string;
  label: string;
  provider: 'Anthropic' | 'OpenAI';
};

export const APLUS_GENERATION_MODELS: AplusGenerationModel[] = [
  {
    id: 'anthropic/claude-haiku-4.5',
    label: 'Claude Haiku 4.5 — fast',
    provider: 'Anthropic',
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6 — balanced',
    provider: 'Anthropic',
  },
  {
    id: 'anthropic/claude-opus-4.8',
    label: 'Claude Opus 4.8 — most capable',
    provider: 'Anthropic',
  },
  {
    id: 'openai/gpt-5.4-mini',
    label: 'GPT-5.4 mini — fast',
    provider: 'OpenAI',
  },
  {
    id: 'openai/gpt-5.4',
    label: 'GPT-5.4 — capable',
    provider: 'OpenAI',
  },
  {
    id: 'openai/gpt-5.5',
    label: 'GPT-5.5 — most capable',
    provider: 'OpenAI',
  },
];

const APLUS_GENERATION_MODEL_IDS = new Set(
  APLUS_GENERATION_MODELS.map((model) => model.id)
);

/** True if the id is one of the allowlisted generation models. */
export function isAplusGenerationModel(id: string): boolean {
  return APLUS_GENERATION_MODEL_IDS.has(id);
}

/**
 * Creativity level for A+ generation. Surfaced in the UI as Low/Medium/High
 * ("Creativity") and mapped server-side to per-phase sampling temperatures —
 * the word "temperature" never reaches the UI.
 */
export const APLUS_CREATIVITY_LEVELS = ['low', 'medium', 'high'] as const;
export const APlusCreativitySchema = z.enum(APLUS_CREATIVITY_LEVELS);
export type APlusCreativity = z.infer<typeof APlusCreativitySchema>;

/**
 * Per-phase temperature mapping. The strategy phase emits a schema-constrained
 * plan where higher temperature mostly buys enum drift and JSON flakiness, so
 * it stays conservative at every level; module copy is per-field prose where
 * creativity is the point, so it gets the full range (low is 0.3 rather than
 * 0.2 so "Low" still avoids robotic repetition across 5–7 modules).
 */
export const APLUS_CREATIVITY_TEMPERATURE: Record<
  'strategy' | 'moduleCopy',
  Record<APlusCreativity, number>
> = {
  strategy: { low: 0.2, medium: 0.4, high: 0.6 },
  moduleCopy: { low: 0.3, medium: 0.7, high: 1.0 },
};

/**
 * Optional seller guidance appended to the generation prompts (advanced mode).
 * Bounded so a runaway paste can't blow up the prompt; compliance rules in the
 * base prompts always take precedence over guidance.
 */
export const APLUS_GUIDANCE_MAX_LENGTH = 2000;
export const APlusGuidanceSchema = z.object({
  strategy: z.string().max(APLUS_GUIDANCE_MAX_LENGTH).optional(),
  moduleCopy: z.string().max(APLUS_GUIDANCE_MAX_LENGTH).optional(),
});
export type APlusGuidance = z.infer<typeof APlusGuidanceSchema>;

/** True if the type maps to a real renderable layout (i.e. not the fallback). */
export function isRenderableAmazonModuleType(
  amazonModuleType: string
): boolean {
  return amazonModuleType in AMAZON_MODULE_TYPE_TO_KIND;
}

/**
 * Canonical Amazon module types the planner/strategy may choose from — one
 * representative per renderable layout kind. Constraining generation to this set
 * keeps each module mapped to a DISTINCT layout (instead of every free-form
 * label collapsing to the single-image-text fallback) and gives the preview
 * chrome a real Seller Central module name.
 */
export const RENDERABLE_AMAZON_MODULE_TYPES = [
  'STANDARD_COMPANY_LOGO',
  'STANDARD_HEADER_IMAGE_TEXT',
  'STANDARD_IMAGE_TEXT_OVERLAY',
  'STANDARD_SINGLE_IMAGE_HIGHLIGHTS',
  'STANDARD_SINGLE_SIDE_IMAGE',
  'STANDARD_THREE_IMAGE_TEXT',
  'STANDARD_FOUR_IMAGE_TEXT_QUADRANT',
  'STANDARD_COMPARISON_TABLE',
  'STANDARD_TECH_SPECS',
  'STANDARD_PRODUCT_DESCRIPTION',
] as const satisfies readonly (keyof typeof AMAZON_MODULE_TYPE_TO_KIND)[];
export type RenderableAmazonModuleType =
  (typeof RENDERABLE_AMAZON_MODULE_TYPES)[number];

/**
 * Display names exactly as they appear in the Seller Central A+ Content Manager
 * (EBC) module picker, so a seller can match each generated module to the right
 * module when building the page by hand.
 */
export const SELLER_CENTRAL_MODULE_NAMES: Record<string, string> = {
  STANDARD_COMPANY_LOGO: 'Standard Company Logo',
  STANDARD_COMPARISON_TABLE: 'Standard Comparison Table',
  STANDARD_FOUR_IMAGE_TEXT: 'Standard Four Image & Text',
  STANDARD_FOUR_IMAGE_TEXT_QUADRANT: 'Standard Four Image/Text Quadrant',
  STANDARD_HEADER_IMAGE_TEXT: 'Standard Image Header with Text',
  STANDARD_IMAGE_SIDEBAR: 'Standard Single Image & Sidebar',
  STANDARD_IMAGE_TEXT_OVERLAY: 'Standard Image & Text Overlay (Light or Dark)',
  STANDARD_MULTIPLE_IMAGE_TEXT: 'Standard Multiple Image Module A',
  STANDARD_PRODUCT_DESCRIPTION: 'Standard Product Description Text',
  STANDARD_SINGLE_IMAGE_HIGHLIGHTS: 'Standard Single Image & Highlights',
  STANDARD_SINGLE_IMAGE_SPECS_DETAIL: 'Standard Single Image & Specs Detail',
  STANDARD_SINGLE_SIDE_IMAGE: 'Standard Single Left/Right Image',
  STANDARD_TECH_SPECS: 'Standard Technical Specifications',
  STANDARD_TEXT: 'Standard Text',
  STANDARD_THREE_IMAGE_TEXT: 'Standard Three Image & Text',
  STANDARD_DUAL_USE_SPLIT: 'Standard Image (two-scenario split)', // legacy
  STANDARD_ICON_ROW: 'Standard Image (icon highlights strip)', // legacy
  // Premium A+ module picker names (VERIFY against Seller Central).
  PREMIUM_QA: 'Premium Q&A',
  PREMIUM_HOTSPOTS_1: 'Premium Hotspots 1',
  PREMIUM_SIMPLE_IMAGE_CAROUSEL: 'Premium Simple Image Carousel',
  PREMIUM_FULL_IMAGE: 'Premium Full Image',
  PREMIUM_BACKGROUND_IMAGE_TEXT: 'Premium Background Image with Text',
  PREMIUM_SINGLE_IMAGE_TEXT: 'Premium Single Image with Text',
  PREMIUM_DUAL_IMAGES_TEXT: 'Premium Dual Images & Text',
  PREMIUM_FOUR_IMAGES_TEXT: 'Premium Four Images & Text',
  PREMIUM_TEXT: 'Premium Text',
  PREMIUM_TECH_SPECS: 'Premium Technical Specifications',
  PREMIUM_COMPARISON_TABLE_1: 'Premium Comparison Table 1',
};

/** Seller Central A+ module picker name for a given module type. */
export function sellerCentralModuleName(amazonModuleType: string): string {
  return SELLER_CENTRAL_MODULE_NAMES[amazonModuleType] || amazonModuleType;
}

/**
 * Legacy app-invented "Amazon" codes remapped to the real Seller Central type
 * a seller would actually use. Both legacy layouts export as one wide PNG the
 * seller uploads into a standard image module, so the image-header module is
 * the honest deployment target.
 */
export const LEGACY_AMAZON_MODULE_TYPE_REMAP: Record<string, string> = {
  STANDARD_DUAL_USE_SPLIT: 'STANDARD_HEADER_IMAGE_TEXT',
  STANDARD_ICON_ROW: 'STANDARD_HEADER_IMAGE_TEXT',
};

/** Rewrites legacy fake module type codes to a real Seller Central type. */
export function normalizeAmazonModuleType(amazonModuleType: string): string {
  return LEGACY_AMAZON_MODULE_TYPE_REMAP[amazonModuleType] ?? amazonModuleType;
}

/** All image slots in a module (in render order), for per-slot image generation. */
export function moduleImageSlots(
  module: APlusGeneratedModule
): APlusImageSlot[] {
  return moduleImageSlotEntries(module).map((entry) => entry.slot);
}

/**
 * Image slots with their descriptor path into the module (same order as
 * moduleImageSlots), so editors can update slot fields — e.g. the brief at
 * [...path, 'brief'] — via setModuleTextField.
 */
export function moduleImageSlotEntries(
  module: APlusGeneratedModule
): Array<{ slot: APlusImageSlot; path: APlusTextFieldPath }> {
  switch (module.type) {
    case 'company-logo':
      // The logo itself is the seller's uploaded brand asset (never AI), but the
      // ambient brand BACKDROP behind it is AI-generated, so expose that slot.
      return module.background
        ? [{ slot: module.background, path: ['background'] }]
        : [];
    case 'image-header-with-text':
    case 'image-text-overlay':
    case 'single-image-text':
    case 'image-and-text':
      return [{ slot: module.image, path: ['image'] }];
    case 'three-image-text':
      return module.columns.map((column, index) => ({
        slot: column.image,
        path: ['columns', index, 'image'],
      }));
    case 'four-image-text-quadrant':
      return module.quadrants.map((quadrant, index) => ({
        slot: quadrant.image,
        path: ['quadrants', index, 'image'],
      }));
    case 'dual-use-split':
      return module.panels.map((panel, index) => ({
        slot: panel.image,
        path: ['panels', index, 'image'],
      }));
    case 'comparison-table':
      return module.products.flatMap((product, index) =>
        product.image
          ? [{ slot: product.image, path: ['products', index, 'image'] }]
          : []
      );
    case 'hotspots':
      return [{ slot: module.image, path: ['image'] }];
    case 'carousel':
      return module.slides.map((slide, index) => ({
        slot: slide.image,
        path: ['slides', index, 'image'],
      }));
    case 'tech-specs':
    case 'text-only':
    case 'icon-row':
    case 'qna':
      return [];
    default:
      return [];
  }
}

/**
 * Editable copy fields for a module, used to build the Seller Central build
 * sheet and to run guardrails over all customer-facing text.
 */
export function moduleTextFields(
  module: APlusGeneratedModule
): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: string | undefined | null) => {
    const trimmed = value?.trim();
    if (trimmed) fields.push({ label, value: trimmed });
  };

  switch (module.type) {
    case 'company-logo':
      push('Logo alt text', module.logo.alt);
      break;
    case 'image-header-with-text':
    case 'image-text-overlay':
      push('Headline', module.headline);
      push('Body', module.body);
      break;
    case 'single-image-text':
    case 'image-and-text':
      push('Headline', module.headline);
      push('Body', module.body);
      module.bullets?.forEach((bullet, index) =>
        push(`Bullet ${index + 1}`, bullet)
      );
      break;
    case 'three-image-text':
      module.columns.forEach((column, index) => {
        push(`Column ${index + 1} headline`, column.headline);
        push(`Column ${index + 1} body`, column.body);
      });
      break;
    case 'four-image-text-quadrant':
      module.quadrants.forEach((quadrant, index) => {
        push(`Block ${index + 1} headline`, quadrant.headline);
        push(`Block ${index + 1} body`, quadrant.body);
      });
      break;
    case 'dual-use-split':
      module.panels.forEach((panel, index) => {
        push(`Panel ${index + 1} label`, panel.label);
        push(`Panel ${index + 1} caption`, panel.caption);
      });
      break;
    case 'comparison-table':
      module.products.forEach((product, index) =>
        push(`Product ${index + 1}`, product.title)
      );
      module.rows.forEach((row) =>
        push(row.label, row.values.filter(Boolean).join(' | '))
      );
      break;
    case 'tech-specs':
      push('Headline', module.headline);
      module.rows.forEach((row) => push(row.label, row.value));
      break;
    case 'text-only':
      push('Headline', module.headline);
      push('Body', module.body);
      module.bullets?.forEach((bullet, index) =>
        push(`Bullet ${index + 1}`, bullet)
      );
      break;
    case 'icon-row':
      module.items.forEach((item, index) =>
        push(`Icon ${index + 1} label`, item.label)
      );
      break;
    case 'qna':
      push('Headline', module.headline);
      module.items.forEach((item, index) => {
        push(`Question ${index + 1}`, item.question);
        push(`Answer ${index + 1}`, item.answer);
      });
      break;
    case 'hotspots':
      push('Headline', module.headline);
      module.hotspots.forEach((spot, index) => {
        push(`Hotspot ${index + 1} label`, spot.label);
        push(`Hotspot ${index + 1} copy`, spot.copy);
      });
      break;
    case 'carousel':
      module.slides.forEach((slide, index) => {
        push(`Slide ${index + 1} headline`, slide.headline);
        push(`Slide ${index + 1} caption`, slide.caption);
      });
      break;
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Editable text-field descriptors. Enumerates EVERY customer-facing copy field
// of a generated module — including empty optional ones so users can add copy,
// plus the module title and image alt text — each with a stable path usable by
// setModuleTextField(). moduleTextFields() above stays the "filled fields only"
// view that the build sheet and guardrail sweep depend on.
// ---------------------------------------------------------------------------

export type APlusTextFieldPath = ReadonlyArray<string | number>;

export type APlusModuleTextFieldDescriptor = {
  label: string;
  path: APlusTextFieldPath;
  value: string;
  maxLength: number;
  multiline: boolean;
};

export function moduleTextFieldDescriptors(
  module: APlusGeneratedModule
): APlusModuleTextFieldDescriptor[] {
  const fields: APlusModuleTextFieldDescriptor[] = [];
  const add = (
    label: string,
    path: APlusTextFieldPath,
    value: string | undefined | null,
    maxLength: number,
    multiline = false
  ) => fields.push({ label, path, value: value ?? '', maxLength, multiline });

  add('Module title', ['title'], module.title, 120);

  switch (module.type) {
    case 'company-logo':
      add('Headline', ['headline'], module.headline, 120);
      add('Tagline', ['tagline'], module.tagline, 120);
      add('Logo alt text', ['logo', 'alt'], module.logo.alt, 160);
      if (module.background) {
        add(
          'Backdrop alt text',
          ['background', 'alt'],
          module.background.alt,
          160
        );
      }
      break;
    case 'image-header-with-text':
    case 'image-text-overlay':
      add('Headline', ['headline'], module.headline, 160);
      add('Body', ['body'], module.body, 800, true);
      add('Badge', ['badge'], module.badge, 16);
      add('Image alt text', ['image', 'alt'], module.image.alt, 160);
      break;
    case 'single-image-text':
    case 'image-and-text':
      add('Headline', ['headline'], module.headline, 160);
      add('Body', ['body'], module.body, 800, true);
      module.bullets?.forEach((bullet, index) =>
        add(`Bullet ${index + 1}`, ['bullets', index], bullet, 160)
      );
      add('Badge', ['badge'], module.badge, 16);
      add('Image alt text', ['image', 'alt'], module.image.alt, 160);
      break;
    case 'three-image-text':
      module.columns.forEach((column, index) => {
        add(
          `Column ${index + 1} headline`,
          ['columns', index, 'headline'],
          column.headline,
          160
        );
        add(
          `Column ${index + 1} body`,
          ['columns', index, 'body'],
          column.body,
          400,
          true
        );
        add(
          `Column ${index + 1} image alt`,
          ['columns', index, 'image', 'alt'],
          column.image.alt,
          160
        );
      });
      break;
    case 'four-image-text-quadrant':
      module.quadrants.forEach((quadrant, index) => {
        add(
          `Block ${index + 1} headline`,
          ['quadrants', index, 'headline'],
          quadrant.headline,
          160
        );
        add(
          `Block ${index + 1} body`,
          ['quadrants', index, 'body'],
          quadrant.body,
          400,
          true
        );
        add(
          `Block ${index + 1} image alt`,
          ['quadrants', index, 'image', 'alt'],
          quadrant.image.alt,
          160
        );
      });
      break;
    case 'comparison-table':
      module.products.forEach((product, index) => {
        add(
          `Product ${index + 1}`,
          ['products', index, 'title'],
          product.title,
          100
        );
        if (product.image) {
          add(
            `Product ${index + 1} image alt`,
            ['products', index, 'image', 'alt'],
            product.image.alt,
            160
          );
        }
      });
      module.rows.forEach((row, rowIndex) => {
        add(
          `Row ${rowIndex + 1} label`,
          ['rows', rowIndex, 'label'],
          row.label,
          60
        );
        row.values.forEach((value, valueIndex) =>
          add(
            `${row.label || `Row ${rowIndex + 1}`} — ${
              module.products[valueIndex]?.title || `Product ${valueIndex + 1}`
            }`,
            ['rows', rowIndex, 'values', valueIndex],
            value,
            80
          )
        );
      });
      break;
    case 'tech-specs':
      add('Headline', ['headline'], module.headline, 160);
      module.rows.forEach((row, index) => {
        add(`Spec ${index + 1} label`, ['rows', index, 'label'], row.label, 60);
        add(
          `Spec ${index + 1} value`,
          ['rows', index, 'value'],
          row.value,
          200
        );
      });
      break;
    case 'text-only':
      add('Headline', ['headline'], module.headline, 160);
      add('Body', ['body'], module.body, 1200, true);
      module.bullets?.forEach((bullet, index) =>
        add(`Bullet ${index + 1}`, ['bullets', index], bullet, 160)
      );
      break;
    case 'dual-use-split':
      module.panels.forEach((panel, index) => {
        add(
          `Panel ${index + 1} label`,
          ['panels', index, 'label'],
          panel.label,
          40
        );
        add(
          `Panel ${index + 1} caption`,
          ['panels', index, 'caption'],
          panel.caption,
          160
        );
        add(
          `Panel ${index + 1} image alt`,
          ['panels', index, 'image', 'alt'],
          panel.image.alt,
          160
        );
      });
      break;
    case 'icon-row':
      module.items.forEach((item, index) =>
        add(
          `Icon ${index + 1} label`,
          ['items', index, 'label'],
          item.label,
          40
        )
      );
      break;
    case 'qna':
      add('Headline', ['headline'], module.headline, 160);
      module.items.forEach((item, index) => {
        add(
          `Question ${index + 1}`,
          ['items', index, 'question'],
          item.question,
          120
        );
        add(
          `Answer ${index + 1}`,
          ['items', index, 'answer'],
          item.answer,
          800,
          true
        );
      });
      break;
    case 'hotspots':
      add('Headline', ['headline'], module.headline, 160);
      module.hotspots.forEach((spot, index) => {
        add(
          `Hotspot ${index + 1} label`,
          ['hotspots', index, 'label'],
          spot.label,
          50
        );
        add(
          `Hotspot ${index + 1} copy`,
          ['hotspots', index, 'copy'],
          spot.copy,
          200,
          true
        );
      });
      add('Image alt text', ['image', 'alt'], module.image.alt, 160);
      break;
    case 'carousel':
      module.slides.forEach((slide, index) => {
        add(
          `Slide ${index + 1} headline`,
          ['slides', index, 'headline'],
          slide.headline,
          100
        );
        add(
          `Slide ${index + 1} caption`,
          ['slides', index, 'caption'],
          slide.caption,
          200,
          true
        );
        add(
          `Slide ${index + 1} image alt`,
          ['slides', index, 'image', 'alt'],
          slide.image.alt,
          160
        );
      });
      break;
  }

  return fields;
}

/**
 * Immutably sets one text field on a generated module by descriptor path.
 * Clearing a field (empty/whitespace value) stores undefined for object keys
 * and an empty string for array elements (so arrays keep their shape). Editing
 * a slot's alt text also mirrors the value onto the slot's resolved image, so
 * an already-generated image keeps matching alt text.
 */
export function setModuleTextField<T extends APlusGeneratedModule>(
  module: T,
  path: APlusTextFieldPath,
  value: string
): T {
  if (path.length === 0) return module;
  const next = structuredClone(module);
  let parent: unknown = next;
  for (let i = 0; i < path.length - 1; i++) {
    if (parent === null || typeof parent !== 'object') return module;
    parent = (parent as Record<string | number, unknown>)[path[i]];
  }
  if (parent === null || typeof parent !== 'object') return module;

  const target = parent as Record<string | number, unknown>;
  const tail = path[path.length - 1];
  const trimmed = value.trim();
  if (trimmed === '') {
    target[tail] = typeof tail === 'number' ? '' : undefined;
  } else {
    // Store the raw value (not trimmed) so typing trailing spaces works.
    target[tail] = value;
    if (tail === 'alt') {
      const image = (target as { image?: unknown }).image;
      if (image !== null && typeof image === 'object' && 'alt' in image) {
        (image as { alt: string }).alt = value;
      }
    }
  }
  return next;
}

export const APLUS_GUARDRAIL_PATTERNS: Array<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: 'Removed price/promo language',
    pattern:
      /\$|\b\d+%\s*off\b|\bsale\b|\bdiscount\b|\bpromo\b|\bpromotion\b|\bcoupon\b|\bdeal\b|\blimited[- ]time\b/i,
  },
  {
    label: 'Removed delivery/stock claims',
    pattern:
      /\bfree shipping\b|\bnext[- ]day\b|\bsame[- ]day\b|\bin stock\b|\bout of stock\b|\bships in\b|\barrives in\b|\bprime\b|\bone[- ]day\b|\btwo[- ]day\b|\b2[- ]day\b/i,
  },
  {
    label: 'Removed competitor/marketplace claims',
    pattern: /\bbest[- ]selling\b|\bamazon's choice\b|\bbest seller\b|\b#1\b/i,
  },
];

export function applyAPlusGuardrails(text: string): {
  cleaned: string;
  triggered: string[];
} {
  const triggered = new Set<string>();
  let cleaned = text;
  for (const { label, pattern } of APLUS_GUARDRAIL_PATTERNS) {
    if (pattern.test(cleaned)) {
      triggered.add(label);
      cleaned = cleaned
        .replace(new RegExp(pattern.source, pattern.flags + 'g'), '')
        .trim();
    }
  }
  return {
    cleaned: cleaned.replace(/\s{2,}/g, ' '),
    triggered: [...triggered],
  };
}
