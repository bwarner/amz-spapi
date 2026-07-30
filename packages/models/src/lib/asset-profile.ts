import { z } from 'zod';

/**
 * Structured visual profile of an uploaded asset (redesign §3a).
 *
 * Two consumers, which is why it lives here rather than beside the route that
 * produces it: the Asset Matcher decides how an asset can be used in a scene,
 * and the intelligence layer reads product facts off it when there is no
 * catalog listing to read.
 *
 * The vision model describes what is in the picture. It is NOT asked for
 * anything measurable — orientation and dimensions come from the real pixels,
 * because a model guessing at an aspect ratio it can see is a guess we do not
 * have to accept.
 */
export const VisionAssetProfileSchema = z.object({
  role: z.enum([
    'product-iso',
    'product-in-scene',
    'background',
    'detail-macro',
    'diagram',
    'logo',
    'person',
    'other',
  ]),
  subjectPresent: z.boolean(),
  subjectProminence: z.enum(['hero', 'soft', 'absent']),
  subjectPosition: z.enum(['left', 'right', 'center']),
  /** Where the empty space is — this is what decides where overlaid text can go. */
  negativeSpace: z.object({
    side: z.enum(['left', 'right', 'top', 'bottom', 'none']),
    amount: z.enum(['low', 'medium', 'high']),
  }),
  background: z.enum([
    'white',
    'transparent',
    'plain',
    'busy',
    'real-environment',
  ]),
  affordances: z.array(
    z.enum([
      'hero-bg',
      'carousel-tile',
      'feature-callout',
      'comparison-thumb',
      'backdrop-layer',
      'reference-only',
    ])
  ),
  /** Amazon rejects text rendered into a module image; this gates placement. */
  hasBakedText: z.boolean(),
  isRender: z.boolean(),
  dominantColors: z.array(z.string()).max(5),
  description: z.string(),
});
export type VisionAssetProfile = z.infer<typeof VisionAssetProfileSchema>;

/** The vision profile plus the facts measured from the image itself. */
export const AssetProfileSchema = VisionAssetProfileSchema.extend({
  orientation: z.enum(['portrait', 'landscape', 'square']),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type AssetProfile = z.infer<typeof AssetProfileSchema>;

export type AssetAffordance = AssetProfile['affordances'][number];
