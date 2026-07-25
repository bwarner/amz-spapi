import type { ImageGenerator } from '@amz-spapi/ai-provider';
import { withPaidCall } from './cost-ledger';

/**
 * Wrap an ImageGenerator so every generation passes the daily spend cap and
 * lands in the cost ledger.
 *
 * Image generation is the most expensive thing a chat turn can do, and the
 * agent triggers it without asking — propose-listing-photos fans out several
 * shots in parallel. Metering at this seam covers every caller (proposals,
 * generate-image, backdrops) without each tool having to remember.
 *
 * No published price is baked in: gpt-image-1 and Imagen bill differently per
 * size and quality tier, so cost comes from COST_UNIT_PRICE_<SLUG> when set and
 * from COST_DEFAULT_CALL_USD otherwise, always recorded as `estimated` with
 * `priceKnown: false`. Set the real number for your model rather than trusting
 * a constant someone guessed.
 */
export function meterImageGenerator(
  generator: ImageGenerator,
  owner: { userId: string; chatId?: string }
): ImageGenerator {
  return {
    modelSlug: generator.modelSlug,
    generate: (params) =>
      withPaidCall(
        {
          userId: owner.userId,
          chatId: owner.chatId,
          feature: 'image-generation',
          vendor: 'image-generation',
          operation: generator.modelSlug ?? 'unknown-image-model',
          expectedUnits: params.n ?? 1,
        },
        async (report) => {
          const images = await generator.generate(params);
          // Bill for images actually returned, not requested.
          report(images.length);
          return images;
        }
      ),
  };
}
