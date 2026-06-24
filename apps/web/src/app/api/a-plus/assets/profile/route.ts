import { GetObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { createAIProvider } from '@amz-spapi/ai-provider';
import { auth0 } from '../../../../../lib/auth0';
import { createAssetS3Client, getAsset } from '../../../../../lib/media-assets';

// sharp + the AI SDK need the Node runtime.
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Structured visual profile of an asset (see redesign §3a). Drives the Asset
 * Matcher (how to use the asset in a scene) AND serves as a product-intelligence
 * source when no catalog/listing exists. Orientation/dimensions are computed from
 * the real image, not inferred by the model.
 */
const VisionProfileSchema = z.object({
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
  hasBakedText: z.boolean(),
  isRender: z.boolean(),
  dominantColors: z.array(z.string()).max(5),
  description: z.string(),
});

const PROFILE_PROMPT = [
  'You are profiling an uploaded product asset for an Amazon A+ content builder.',
  'Return STRUCTURED data describing how this image could be used in a designed scene — be literal about what is actually shown.',
  '- role: product-iso = product alone on a plain/white background; product-in-scene = product within a real environment; background = an environment with no product; detail-macro = close-up of a feature; diagram = chart/infographic; logo; person; other.',
  '- subjectProminence: how dominant the product is (hero, soft/incidental, or absent).',
  '- subjectPosition / negativeSpace: where the subject sits and where empty space is (this decides where overlaid text can go).',
  '- background: white | transparent | plain | busy | real-environment.',
  '- affordances: which uses this image is GOOD for — hero-bg (room for a headline), carousel-tile (clean square-ish), feature-callout (a detail), comparison-thumb (isolated product), backdrop-layer (texture/scene behind copy), reference-only (use only to guide generation).',
  '- hasBakedText: true if any text/labels/logos are rendered into the image (Amazon rejects baked-in text for module images).',
  '- isRender: true if it looks like a 3D render/CGI rather than a real photo.',
  '- dominantColors: up to 5 hex codes.',
  '- description: 1–2 factual sentences (product, color/material/finish, packaging, setting). No marketing language, no invented brand names.',
].join('\n');

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { assetId?: unknown };
  try {
    body = (await request.json()) as { assetId?: unknown };
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (typeof body.assetId !== 'string') {
    return Response.json({ error: 'assetId is required.' }, { status: 400 });
  }

  const asset = await getAsset(body.assetId);
  if (!asset || asset.userId !== session.user.sub) {
    return Response.json({ error: 'Asset not found.' }, { status: 404 });
  }
  if (asset.status !== 'uploaded') {
    return Response.json({ error: 'Asset is not ready yet.' }, { status: 409 });
  }

  // Fetch, read true dimensions, and downscale before sending to the model.
  let imageBytes: Uint8Array;
  let width = 0;
  let height = 0;
  try {
    const object = await createAssetS3Client().send(
      new GetObjectCommand({
        Bucket: asset.storage.bucket,
        Key: asset.storage.key,
      })
    );
    const raw = await object.Body?.transformToByteArray();
    if (!raw) throw new Error('Empty image body.');
    const pipeline = sharp(Buffer.from(raw), { limitInputPixels: 64_000_000 });
    const meta = await pipeline.metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
    const png = await pipeline
      .resize({
        width: 768,
        height: 768,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    imageBytes = new Uint8Array(png);
  } catch {
    return Response.json(
      { error: 'Could not read the image to profile it.' },
      { status: 502 }
    );
  }

  try {
    const provider = createAIProvider();
    const result = await generateText({
      model: provider.languageModel('default'),
      maxOutputTokens: 600,
      abortSignal: AbortSignal.timeout(25_000),
      output: Output.object({
        schema: VisionProfileSchema,
        name: 'asset_profile',
      }),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROFILE_PROMPT },
            { type: 'image', image: imageBytes, mediaType: 'image/png' },
          ],
        },
      ],
    });

    // Orientation comes from the real pixels, not the model.
    const orientation =
      width && height
        ? width > height * 1.05
          ? 'landscape'
          : height > width * 1.05
          ? 'portrait'
          : 'square'
        : 'square';

    return Response.json({
      profile: {
        ...result.output,
        orientation,
        width,
        height,
        hasBakedText: result.output.hasBakedText,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Asset profiling failed.';
    return Response.json({ error: message }, { status: 500 });
  }
}
