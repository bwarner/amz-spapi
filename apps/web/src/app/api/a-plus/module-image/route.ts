import sharp from 'sharp';
import { z } from 'zod';
import { APlusGeneratedModuleSchema } from '@farvisionllc/models';
import { auth0 } from '../../../../lib/auth0';
import {
  inlineSlotImages,
  inlineThemeLogo,
  renderModule,
  themeSchema,
} from '../../../../lib/aplus-export-render';
import { SAMPLE_GALLERY } from './sample-gallery';
import {
  brandThemeFrom,
  type BrandTheme,
} from '../../../(dashboard)/a-plus/components/a-plus-design';

// Needs the AWS SDK + S3 to inline private asset images, so run on Node.
export const runtime = 'nodejs';
export const maxDuration = 30;

const bodySchema = z.object({
  module: APlusGeneratedModuleSchema,
  theme: themeSchema.optional(),
  viewport: z.enum(['desktop', 'mobile']).default('desktop'),
  // Premium renders on the 1464px canvas; premium FULL_IMAGE bands export as
  // fixed 1464×600 / 600×450 frames (Amazon's exact upload dims).
  tier: z.enum(['Basic A+', 'Premium A+']).default('Basic A+'),
});

const SAMPLE_STYLES = ['editorial', 'modern', 'bold', 'minimal'] as const;

/** Dev-only: rasterize a sample wordmark so the logo header is reviewable. */
async function sampleLogoDataUrl(): Promise<string> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="300" viewBox="0 0 420 300">
       <g fill="none" stroke="#9C6B3F" stroke-width="9" stroke-linecap="round">
         <path d="M150 130 h110 a28 28 0 0 1 0 56 h-10"/>
         <path d="M150 130 v52 a38 38 0 0 0 38 38 h34 a38 38 0 0 0 38-38 v-52 z"/>
         <path d="M185 108 c0-14 18-14 18-28M213 108 c0-14 18-14 18-28"/>
       </g>
       <text x="210" y="252" font-family="Georgia, serif" font-size="42" fill="#2A2018" text-anchor="middle">Filtered Blend</text>
       <text x="210" y="282" font-family="system-ui, sans-serif" font-size="16" fill="#9C6B3F" letter-spacing="3" text-anchor="middle">PASSIONATE COFFEE</text>
     </svg>`
  );
  const png = await sharp(svg, { density: 384 })
    .resize({ height: 300, fit: 'inside' })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/**
 * Dev-only ambient backdrop for previewing the hero. Uses a real photo when
 * APLUS_SAMPLE_BACKDROP (or the default dev path) points to one, else falls back
 * to a synthetic warm bokeh so the harness works with no assets.
 */
async function sampleBackdropDataUrl(): Promise<string> {
  const path =
    process.env['APLUS_SAMPLE_BACKDROP'] || '/tmp/aplus/img/coffee_sm.jpg';
  try {
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(path);
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  } catch {
    // fall through to the synthetic backdrop
  }
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700">
       <defs>
         <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0" stop-color="#5b3d27"/>
           <stop offset="1" stop-color="#24180f"/>
         </linearGradient>
       </defs>
       <rect width="1200" height="700" fill="url(#g)"/>
       <circle cx="250" cy="520" r="200" fill="#caa06a" opacity="0.55"/>
       <circle cx="980" cy="180" r="240" fill="#3a2616" opacity="0.7"/>
       <circle cx="720" cy="600" r="170" fill="#e6c08a" opacity="0.4"/>
       <circle cx="520" cy="120" r="130" fill="#8a5a34" opacity="0.5"/>
     </svg>`
  );
  const png = await sharp(svg).blur(38).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function GET(request: Request) {
  // Dev-only design preview (no auth, no S3): renders any sample module/style.
  //   /api/a-plus/module-image?sample=1&module=<kind>&style=<preset>&viewport=<vp>
  const url = new URL(request.url);
  if (
    url.searchParams.get('sample') === '1' &&
    process.env.NODE_ENV !== 'production'
  ) {
    const viewport =
      url.searchParams.get('viewport') === 'mobile' ? 'mobile' : 'desktop';
    const tier =
      url.searchParams.get('tier') === 'premium' ? 'Premium A+' : 'Basic A+';
    const styleParam = url.searchParams.get('style') ?? 'editorial';
    const style = (SAMPLE_STYLES as readonly string[]).includes(styleParam)
      ? (styleParam as (typeof SAMPLE_STYLES)[number])
      : 'editorial';
    const moduleKey = url.searchParams.get('module') ?? 'three-image-text';
    const sampleModule =
      SAMPLE_GALLERY[moduleKey] ?? SAMPLE_GALLERY['three-image-text'];
    const theme = brandThemeFrom({ brandName: 'Filtered Blend' }, style);
    let mod = sampleModule;
    if (mod.type === 'company-logo') {
      theme.logoUrl = await sampleLogoDataUrl();
      theme.logoAspect = 420 / 300; // matches the sample wordmark viewBox
      // The hero treatment is normally AI-chosen per product (module.heroVariant);
      // ?hero= and ?corner= let the harness preview each choice.
      const heroParam = url.searchParams.get('hero');
      const heroVariant =
        heroParam === 'plate' ||
        heroParam === 'glass' ||
        heroParam === 'split' ||
        heroParam === 'overlay'
          ? heroParam
          : undefined;
      const cornerParam = url.searchParams.get('corner');
      const logoCorner =
        cornerParam === 'bottom-left' || cornerParam === 'bottom-right'
          ? cornerParam
          : undefined;
      // ?headline= / ?tagline= override the sample copy so ANY product can be
      // previewed (the feature is product-agnostic; the gallery is just one).
      // ?bg=1 attaches an ambient backdrop so the hero is reviewable without
      // running real image generation.
      const hl = url.searchParams.get('headline');
      const tl = url.searchParams.get('tagline');
      const bg =
        url.searchParams.get('bg') === '1'
          ? await sampleBackdropDataUrl()
          : undefined;
      const footer = url.searchParams.get('placement') === 'footer';
      mod = {
        ...mod,
        ...(footer ? { placement: 'footer' as const } : {}),
        ...(heroVariant ? { heroVariant } : {}),
        ...(logoCorner ? { logoCorner } : {}),
        ...(hl !== null ? { headline: hl } : {}),
        ...(tl !== null ? { tagline: tl } : {}),
        ...(bg
          ? {
              background: {
                role: 'backdrop',
                brief: 'ambient brand backdrop',
                size: '1792x1024' as const,
                alt: 'Ambient lifestyle backdrop',
                image: { url: bg, alt: 'Ambient lifestyle backdrop' },
              },
            }
          : {}),
      };
    }
    // ?band=1 previews the premium band composition (e.g. icon grid).
    return renderModule(
      mod,
      theme,
      viewport,
      tier,
      undefined,
      url.searchParams.get('band') === '1'
    );
  }
  return Response.json({ error: 'Use POST.' }, { status: 405 });
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let input: z.infer<typeof bodySchema>;
  try {
    input = bodySchema.parse(await request.json());
  } catch (error) {
    const detail =
      error instanceof z.ZodError
        ? error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join(' | ')
        : error instanceof Error
        ? error.message
        : String(error);
    console.error(
      `[a-plus-module-image] invalid payload: ${detail.slice(0, 500)}`
    );
    return Response.json(
      { error: `Invalid module payload: ${detail.slice(0, 200)}` },
      { status: 400 }
    );
  }

  const theme = brandThemeFrom(null);
  const merged: BrandTheme = { ...theme, ...input.theme };
  await Promise.all([
    inlineSlotImages(input.module, session.user.sub),
    inlineThemeLogo(merged, session.user.sub),
  ]);
  return renderModule(input.module, merged, input.viewport, input.tier);
}
