import OpenAI, { type Uploadable } from 'openai';
import type { ImageGenerator } from './types';

/**
 * DALL-E 3 image generator for A+ content and product imagery.
 *
 * Supports:
 * - Text-to-image generation with detailed prompts
 * - Image editing (DALL-E 2) for modifying existing product photos
 * - Multiple sizes optimized for Amazon A+ content
 */
export function createDalleImageGenerator(apiKey: string): ImageGenerator {
  const openai = new OpenAI({ apiKey });

  return {
    async generate(params: Parameters<ImageGenerator['generate']>[0]) {
      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt: params.prompt,
        size: params.size || '1024x1024',
        quality: params.quality || 'hd',
        style: params.style || 'natural',
        n: 1, // DALL-E 3 only supports n=1
        response_format: 'url',
      });

      return (response.data ?? []).flatMap((img) =>
        img.url
          ? [
              {
                url: img.url,
                revisedPrompt: img.revised_prompt,
              },
            ]
          : []
      );
    },

    async edit(params: Parameters<NonNullable<ImageGenerator['edit']>>[0]) {
      // DALL-E 2 for editing (DALL-E 3 doesn't support edit yet)
      let image: Uploadable;
      let mask: Uploadable | undefined;

      if (typeof params.image === 'string') {
        // Assume base64 or file path
        if (params.image.startsWith('data:')) {
          // Base64 data URL
          const base64Data = params.image.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          image = new File([buffer], 'image.png', { type: 'image/png' });
        } else {
          // File path - read it
          const fs = await import('fs');
          const buffer = fs.readFileSync(params.image);
          image = new File([buffer], 'image.png', { type: 'image/png' });
        }
      } else {
        image = new File([params.image], 'image.png', { type: 'image/png' });
      }

      if (params.mask) {
        if (typeof params.mask === 'string') {
          if (params.mask.startsWith('data:')) {
            const base64Data = params.mask.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            mask = new File([buffer], 'mask.png', { type: 'image/png' });
          } else {
            const fs = await import('fs');
            const buffer = fs.readFileSync(params.mask);
            mask = new File([buffer], 'mask.png', { type: 'image/png' });
          }
        } else {
          mask = new File([params.mask], 'mask.png', { type: 'image/png' });
        }
      }

      const response = await openai.images.edit({
        model: 'dall-e-2',
        image,
        mask,
        prompt: params.prompt,
        size: params.size || '1024x1024',
        n: params.n || 1,
        response_format: 'url',
      });

      return (response.data ?? []).flatMap((img) =>
        img.url ? [{ url: img.url }] : []
      );
    },
  };
}
