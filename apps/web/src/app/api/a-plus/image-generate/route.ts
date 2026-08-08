import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createAIProvider } from '@amz-spapi/ai-provider';
import { auth0 } from '../../../../lib/auth0';
import { denyIfWithoutAccess } from '../../../../lib/access';
import { resolveImageModelVariant } from '../../../../lib/image-model-flag';
import {
  type MediaAsset,
  createAssetS3Client,
  getAsset,
  persistGeneratedImageAsset,
} from '../../../../lib/media-assets';
import { loggerFor } from '../../../../lib/logger';
const log = loggerFor('a-plus-image-generate');

// Direct image-model generation runs ~8-12s, but allow headroom for slower
// variants/high quality and cold starts so the request never times out
// mid-generation (the old ~190s reasoning-tool path is gone).
export const maxDuration = 120;

type ImageSize = '1024x1024' | '1792x1024' | '1024x1792';

function pickImageSize(requested: string | undefined): ImageSize {
  if (!requested) return '1024x1024';
  const match = requested.match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (!match) return '1024x1024';
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return '1024x1024';
  if (width > height * 1.1) return '1792x1024';
  if (height > width * 1.1) return '1024x1792';
  return '1024x1024';
}

function prepareImagePrompt(prompt: string, hasReferences = false): string {
  return [
    ...(hasReferences
      ? [
          'Reference photo(s) of the ACTUAL product are attached. Depict THIS exact product — same shape, proportions, materials, surface texture, and the EXACT color of every component and part as in the reference photos — recreating the scene described below around it. Never substitute a generic look-alike.',
          '',
        ]
      : []),
    prompt,
    '',
    // Hard realism override — enforced on EVERY image regardless of the brief,
    // because conceptual cell labels (e.g. "Cross-Section Proof", "Insulation
    // Engineering") otherwise push the model toward unrealistic diagram/CGI art.
    'Important image rule: render a realistic, natural-light PHOTOGRAPH of the real physical product in a believable real-world setting. Absolutely NO cutaways, cross-sections, exploded or see-through/x-ray views, technical or engineering diagrams, schematics, blueprints, infographics, heat-maps, arrows/annotations, 3D or CGI renders, or abstract concept art. If the description implies an internal or technical detail, instead show the real product in a natural context that implies it (e.g. a hand holding it, a tidy stack on a counter) — never a depiction OF the concept.',
    // Color/material drift is the #1 reference-generate failure (component
    // colors invented, contents ghosting through solid parts) — restate it as
    // a hard rule on EVERY image, not only when references are attached.
    'Important image rule: component COLORS and MATERIALS are factual, not stylistic. Every part of the product (e.g. lids, caps, handles, closures, trims, straps, cables) keeps the EXACT color stated in the product facts or shown in the reference photos, in every unit visible in the frame — never recolor parts to match the scene palette. All solid parts are fully OPAQUE: never show liquid, contents, or light through a closed or solid component, and never render a solid part as translucent.',
    'Important image rule: do not render brand names, brand badges, logos, brand lockups, watermarks, product labels with brand names, readable brand marks, or any other text, callouts, or numbers anywhere in the image. Leave any brand/logo placement as an empty logo-safe area for later editing.',
  ].join('\n');
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Authenticated is not authorised: this route spends money, so the
  // invite gate is enforced here and not only in the UI that leads to it.
  const denied = await denyIfWithoutAccess(session);
  if (denied) return denied;

  let body: {
    prompt?: unknown;
    size?: unknown;
    quality?: unknown;
    referenceAssetIds?: unknown;
  };
  try {
    body = (await request.json()) as {
      prompt?: unknown;
      size?: unknown;
      quality?: unknown;
      referenceAssetIds?: unknown;
    };
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (typeof body.prompt !== 'string' || body.prompt.trim().length < 10) {
    return Response.json(
      { error: 'A prompt of at least 10 characters is required.' },
      { status: 400 }
    );
  }

  // Optional cost/quality tier — 'low' for cheap drafts. Invalid values fall
  // through to the provider/env default (no error).
  const quality =
    body.quality === 'low' ||
    body.quality === 'medium' ||
    body.quality === 'high'
      ? body.quality
      : undefined;

  const provider = createAIProvider();

  // A/B-selected image backend (PostHog flag `aplus-image-model`, default openai).
  const variant = await resolveImageModelVariant(session.user.sub);
  const imageGenerator = provider.imageGenerator?.(variant);
  if (!imageGenerator) {
    return Response.json(
      { error: 'Image generation is not configured.' },
      { status: 503 }
    );
  }

  const size = pickImageSize(
    typeof body.size === 'string' ? body.size : undefined
  );

  // Reference-generate: fetch the seller's real product photos (ownership
  // checked) so the image model depicts THIS exact product, not a text-only
  // approximation. Unreadable/foreign assets are skipped, never fatal.
  const referenceAssetIds = Array.isArray(body.referenceAssetIds)
    ? body.referenceAssetIds
        .filter((id): id is string => typeof id === 'string')
        .slice(0, 2)
    : [];
  const referenceImages: Uint8Array[] = [];
  if (referenceAssetIds.length) {
    const s3 = createAssetS3Client();
    for (const assetId of referenceAssetIds) {
      try {
        const refAsset = await getAsset(assetId);
        if (!refAsset || refAsset.userId !== session.user.sub) continue;
        const obj = await s3.send(
          new GetObjectCommand({
            Bucket: refAsset.storage.bucket,
            Key: refAsset.storage.key,
          })
        );
        const bytes = await obj.Body?.transformToByteArray();
        if (bytes) referenceImages.push(bytes);
      } catch {
        // Skip unreadable references — text-only generation still works.
      }
    }
    log.info(
      `references: ${referenceImages.length}/${referenceAssetIds.length} usable`
    );
  }

  let generated: { url: string; mediaType: string; revisedPrompt?: string };
  try {
    const results = await imageGenerator.generate({
      prompt: prepareImagePrompt(body.prompt, referenceImages.length > 0),
      size,
      quality,
      referenceImages: referenceImages.length ? referenceImages : undefined,
    });
    const first = results[0];
    if (!first?.url) {
      return Response.json(
        { error: 'Image generation returned no image.' },
        { status: 502 }
      );
    }
    generated = first;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Image generation failed.';
    log.error(
      `FAILED (variant=${variant}, refs=${
        referenceImages.length
      }): ${message.slice(0, 300)}`
    );
    return Response.json({ error: message }, { status: 500 });
  }

  const userId = session.user.sub;
  let asset: MediaAsset | null = null;

  try {
    asset = await persistGeneratedImageAsset({
      userId,
      dataUrl: generated.url,
    });
  } catch (error) {
    const persistError =
      error instanceof Error ? error.message : 'Could not persist image.';
    return Response.json({
      url: generated.url,
      revisedPrompt: generated.revisedPrompt,
      size,
      persistError,
    });
  }

  return Response.json({
    url: `/api/a-plus/assets/${asset.assetId}`,
    revisedPrompt: generated.revisedPrompt,
    size,
    asset: {
      assetId: asset.assetId,
      originalFileName: asset.originalFileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      status: asset.status,
      storage: asset.storage,
    },
  });
}
