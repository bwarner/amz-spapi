import { z } from 'zod';

export const APlusImageSchema = z.object({
  url: z.string().url(),
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
  /** Short brand promise shown under the logo in the header band. */
  tagline: z.string().max(120).optional(),
  /** Ambient brand backdrop photo behind the logo (NOT the logo itself). */
  background: APlusImageSlotSchema.optional(),
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

export const APlusGeneratedModuleSchema = z.discriminatedUnion('type', [
  companyLogoModule,
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
  // A two-panel scenario split (e.g. Hot vs Cold). Exports as one image; the
  // seller uploads it into a standard image module in Seller Central.
  STANDARD_DUAL_USE_SPLIT: 'dual-use-split',
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
  'STANDARD_DUAL_USE_SPLIT',
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
  STANDARD_DUAL_USE_SPLIT: 'Standard Image (two-scenario split)',
};

/** Seller Central A+ module picker name for a given module type. */
export function sellerCentralModuleName(amazonModuleType: string): string {
  return SELLER_CENTRAL_MODULE_NAMES[amazonModuleType] || amazonModuleType;
}

/** All image slots in a module (in render order), for per-slot image generation. */
export function moduleImageSlots(
  module: APlusGeneratedModule
): APlusImageSlot[] {
  switch (module.type) {
    case 'company-logo':
      // The logo itself is the seller's uploaded brand asset (never AI), but the
      // ambient brand BACKDROP behind it is AI-generated, so expose that slot.
      return module.background ? [module.background] : [];
    case 'image-header-with-text':
    case 'image-text-overlay':
    case 'single-image-text':
    case 'image-and-text':
      return [module.image];
    case 'three-image-text':
      return module.columns.map((column) => column.image);
    case 'four-image-text-quadrant':
      return module.quadrants.map((quadrant) => quadrant.image);
    case 'dual-use-split':
      return module.panels.map((panel) => panel.image);
    case 'comparison-table':
      return module.products.flatMap((product) =>
        product.image ? [product.image] : []
      );
    case 'tech-specs':
    case 'text-only':
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
  }

  return fields;
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
