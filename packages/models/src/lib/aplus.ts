import { z } from 'zod';

export const APlusImageSchema = z.object({
  url: z.string().url(),
  alt: z.string().min(1).max(160),
});
export type APlusImage = z.infer<typeof APlusImageSchema>;

const headlineField = z.string().max(160).optional();
const bodyField = z.string().max(800).optional();

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
