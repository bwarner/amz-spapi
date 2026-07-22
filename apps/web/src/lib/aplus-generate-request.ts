import { z } from 'zod';

/**
 * Shared zod pieces for the A+ generation input — the product/brand/sources/
 * assets payload common to full generation (/api/a-plus/generate) and
 * per-section regeneration (/api/a-plus/section-regenerate).
 */

export const aplusSourceSchema = z.object({
  id: z.number().optional(),
  kind: z.string(),
  url: z.string(),
});

export const aplusAssetSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  description: z.string().optional(),
  asset: z
    .object({
      assetId: z.string(),
      originalFileName: z.string(),
      mimeType: z.string(),
      storage: z.object({
        provider: z.string(),
        bucket: z.string(),
        key: z.string(),
      }),
    })
    .optional(),
  uploadStatus: z.string().optional(),
});

export const aplusGenerateInputSchema = z.object({
  productName: z.string().optional(),
  asin: z.string().optional(),
  contentTier: z.enum(['Basic A+', 'Premium A+']).default('Basic A+'),
  rawNotes: z.string().optional(),
  productOneLiner: z.string().optional(),
  targetCustomer: z.string().optional(),
  pricePoint: z.string().optional(),
  keyFeatures: z.string().optional(),
  differentiators: z.string().optional(),
  objections: z.string().optional(),
  brand: z
    .object({
      name: z.string().optional(),
      brandName: z.string().optional(),
      colors: z.string().optional(),
      fonts: z.string().optional(),
      voice: z.string().optional(),
      logoNotes: z.string().optional(),
      logoAssetId: z.string().optional(),
    })
    .optional(),
  sources: z.array(aplusSourceSchema).default([]),
  assets: z.array(aplusAssetSchema).default([]),
});

export type AplusGenerateInput = z.infer<typeof aplusGenerateInputSchema>;
