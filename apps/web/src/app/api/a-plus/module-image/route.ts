import {
  cloneElement,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import {
  APlusGeneratedModuleSchema,
  moduleImageSlots,
  type APlusGeneratedModule,
} from '@farvisionllc/models';
import { auth0 } from '../../../../lib/auth0';
import { createAssetS3Client, getAsset } from '../../../../lib/media-assets';
import {
  APLUS_CANVAS_WIDTH,
  APLUS_MOBILE_CANVAS_WIDTH,
  DesignedModule,
  brandThemeFrom,
  type BrandTheme,
} from '../../../(dashboard)/a-plus/components/a-plus-design';

// Needs the AWS SDK + S3 to inline private asset images, so run on Node.
export const runtime = 'nodejs';
export const maxDuration = 30;

const themeSchema = z
  .object({
    bg: z.string(),
    surface: z.string(),
    surfaceAlt: z.string(),
    ink: z.string(),
    muted: z.string(),
    line: z.string(),
    accent: z.string(),
    accentInk: z.string(),
    accentSoft: z.string(),
    headingFont: z.string(),
    bodyFont: z.string(),
    brandName: z.string().optional(),
    logoUrl: z.string().optional(),
    // Design-style treatments — must pass through so exported PNGs match the
    // selected style (not just colors/fonts).
    style: z.enum(['editorial', 'modern', 'bold', 'minimal']),
    headingWeight: z.number(),
    headingCase: z.enum(['none', 'uppercase']),
    headingTracking: z.number(),
    sectionTitle: z.enum(['centered-dots', 'left-rule', 'eyebrow', 'plain']),
    bullet: z.enum(['check', 'square', 'dot', 'dash']),
    radius: z.number(),
    // Structural treatments — must pass through so exported PNGs compose like
    // the selected style (stacked vs split, alignment, bleed, density).
    heroLayout: z.enum(['split', 'stacked']),
    contentAlign: z.enum(['left', 'center']),
    imageSide: z.enum(['left', 'right', 'alternate']),
    imageBleed: z.boolean(),
    density: z.enum(['airy', 'normal', 'tight']),
  })
  .partial();

const bodySchema = z.object({
  module: APlusGeneratedModuleSchema,
  theme: themeSchema.optional(),
  viewport: z.enum(['desktop', 'mobile']).default('desktop'),
});

function lineCount(text: string | undefined, charsPerLine: number): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

/**
 * ImageResponse needs an explicit height. Estimate a generous fixed height per
 * module so content is never clipped; any extra space is painted with the brand
 * background. Errs slightly tall on purpose.
 */
function estimateHeight(
  module: APlusGeneratedModule,
  mobile: boolean,
  theme: BrandTheme
): number {
  const w = mobile ? APLUS_MOBILE_CANVAS_WIDTH : APLUS_CANVAS_WIDTH;
  switch (module.type) {
    case 'company-logo':
      // Brand hero with an ambient backdrop, else the tinted header band.
      if (module.background) return mobile ? 320 : 420;
      return (module.tagline ? (mobile ? 60 : 70) : 0) + (mobile ? 210 : 262);
    case 'image-text-overlay': {
      // Full-bleed overlay hero: content-driven, with a tall minimum.
      const pad = mobile ? 64 : 128;
      const headW = mobile ? w - 64 : 580;
      const headSize = mobile ? 34 : 48;
      const headH =
        lineCount(module.headline, Math.floor(headW / (headSize * 0.55))) *
        (headSize * 1.12);
      const bodyH =
        lineCount(module.body, Math.floor((mobile ? w - 64 : 540) / 9)) *
        (mobile ? 26 : 29);
      const contentH = 24 + headH + 16 + bodyH;
      return Math.round(Math.max(mobile ? 380 : 460, pad + contentH));
    }
    case 'image-header-with-text':
    case 'single-image-text':
    case 'image-and-text': {
      const density = theme.density ?? 'normal';
      const basePad = mobile
        ? density === 'airy'
          ? 32
          : density === 'tight'
          ? 26
          : 28
        : density === 'airy'
        ? 76
        : density === 'tight'
        ? 44
        : 56;
      const stacked = mobile || theme.heroLayout === 'stacked';
      const centered = !mobile && stacked && theme.contentAlign === 'center';
      const headSize = mobile
        ? 32
        : density === 'tight'
        ? 48
        : density === 'airy'
        ? 40
        : 42;
      const textW = stacked ? (centered ? 720 : w - basePad * 2) : 470 - 48;
      const headH =
        lineCount(module.headline, Math.floor(textW / (headSize * 0.5))) *
        (headSize * 1.18);
      const bodyH = lineCount(module.body, Math.floor(textW / 8.5)) * 27;
      const bullets =
        'bullets' in module && module.bullets ? module.bullets.length : 0;
      const lockup = centered ? 0 : 32 + 22;
      const textH = lockup + 22 + headH + 16 + bodyH + bullets * 28 + 8;
      if (stacked) {
        const imgH =
          density === 'airy' ? (mobile ? 240 : 300) : mobile ? 300 : 380;
        return Math.round(imgH + 30 + textH + basePad * 2);
      }
      return Math.round(Math.max(430, textH) + basePad * 2);
    }
    case 'three-image-text':
    case 'four-image-text-quadrant': {
      const cells =
        module.type === 'three-image-text' ? module.columns : module.quadrants;
      const title = 92;
      if (mobile) {
        let h = title + 10;
        for (const c of cells) {
          const textH = 16 + 28 + lineCount(c.body, 38) * 22 + 18;
          h += Math.max(132, textH) + 14;
        }
        return h + 30;
      }
      const imgH =
        theme.density === 'tight' ? 196 : theme.density === 'airy' ? 150 : 172;
      const maxBodyLines = Math.max(
        1,
        ...cells.map((c) => lineCount(c.body, Math.floor(w / cells.length / 8)))
      );
      return (
        title +
        14 +
        imgH +
        16 +
        26 +
        maxBodyLines * 20 +
        16 +
        (theme.density === 'airy' ? 40 : 30)
      );
    }
    case 'comparison-table': {
      const title = 76;
      const rows = module.rows.length;
      if (mobile) {
        let h = title + 10;
        for (let i = 0; i < module.products.length; i++)
          h += 18 + 26 + 12 + rows * 30 + 18 + 10;
        return h + 24;
      }
      return title + 14 + 18 + 26 + 12 + rows * 30 + 18 + 30;
    }
    case 'tech-specs': {
      const title = 92;
      const headline = module.headline ? 40 : 0;
      const rowH = mobile
        ? 58
        : theme.density === 'airy'
        ? 48
        : theme.density === 'tight'
        ? 36
        : 40;
      return title + 14 + headline + 14 + module.rows.length * rowH + 40;
    }
    case 'text-only': {
      const title = 76;
      const headline = module.headline ? 40 : 0;
      const bodyH = lineCount(module.body, mobile ? 64 : 100) * 26;
      const bullets = module.bullets?.length ?? 0;
      return title + 12 + headline + 12 + bodyH + bullets * 28 + 40;
    }
    case 'dual-use-split':
      // Two panels: side-by-side on desktop, stacked on mobile.
      return mobile ? 300 * module.panels.length : 380;
    default:
      return mobile ? 640 : 520;
  }
}

/** Replace private asset-route image URLs with inlined data URLs satori can render. */
async function inlineSlotImages(
  module: APlusGeneratedModule,
  userId: string
): Promise<void> {
  const slots = moduleImageSlots(module).filter((slot) =>
    slot.image?.url?.startsWith('/api/a-plus/assets/')
  );
  if (!slots.length) return;
  const s3 = createAssetS3Client();
  await Promise.all(
    slots.map(async (slot) => {
      const url = slot.image?.url;
      if (!url) return;
      const assetId = url.split('/').pop()?.split('?')[0];
      if (!assetId) return;
      try {
        const asset = await getAsset(assetId);
        if (!asset || asset.userId !== userId) {
          slot.image = undefined;
          return;
        }
        const obj = await s3.send(
          new GetObjectCommand({
            Bucket: asset.storage.bucket,
            Key: asset.storage.key,
          })
        );
        const bytes = await obj.Body?.transformToByteArray();
        if (!bytes) {
          slot.image = undefined;
          return;
        }
        const base64 = Buffer.from(bytes).toString('base64');
        slot.image = {
          url: `data:${asset.mimeType};base64,${base64}`,
          alt: slot.image?.alt ?? 'Product image',
        };
      } catch {
        slot.image = undefined;
      }
    })
  );
}

/**
 * Inline the brand logo as a data URL satori can rasterize. Supports both
 * vector (SVG) and bitmap (PNG/JPG/WebP) logos: SVG is rendered to a crisp PNG
 * with sharp (satori's native SVG handling is unreliable), bitmaps are embedded
 * as-is. On any failure the logo is dropped so the rest of the module still
 * exports.
 */
async function inlineThemeLogo(
  theme: BrandTheme,
  userId: string
): Promise<void> {
  const url = theme.logoUrl;
  if (!url?.startsWith('/api/a-plus/assets/')) return;
  const assetId = url.split('/').pop()?.split('?')[0];
  if (!assetId) {
    theme.logoUrl = undefined;
    return;
  }
  try {
    const asset = await getAsset(assetId);
    if (!asset || asset.userId !== userId) {
      theme.logoUrl = undefined;
      return;
    }
    const s3 = createAssetS3Client();
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: asset.storage.bucket,
        Key: asset.storage.key,
      })
    );
    const bytes = await obj.Body?.transformToByteArray();
    if (!bytes) {
      theme.logoUrl = undefined;
      return;
    }
    const buffer = Buffer.from(bytes);
    const isSvg =
      asset.mimeType.includes('svg') ||
      asset.originalFileName.toLowerCase().endsWith('.svg');
    if (isSvg) {
      // Rasterize the SVG at high density so it stays crisp when scaled up.
      const png = await sharp(buffer, { density: 384 })
        .resize({ height: 240, fit: 'inside', withoutEnlargement: false })
        .png()
        .toBuffer();
      theme.logoUrl = `data:image/png;base64,${png.toString('base64')}`;
    } else {
      theme.logoUrl = `data:${asset.mimeType};base64,${buffer.toString(
        'base64'
      )}`;
    }
  } catch {
    theme.logoUrl = undefined;
  }
}

/**
 * satori chokes on `undefined` style values (React DOM silently drops them).
 * Our shared components use patterns like `width: mobile ? '100%' : undefined`,
 * so strip undefined style props from the element tree before rendering.
 */
function stripUndefinedStyles(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUndefinedStyles);
  if (!isValidElement(node)) return node;
  const props = node.props as Record<string, unknown>;
  const nextProps: Record<string, unknown> = {};
  if (props.style && typeof props.style === 'object') {
    const cleanStyle: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      props.style as Record<string, unknown>
    )) {
      if (value !== undefined) cleanStyle[key] = value;
    }
    nextProps.style = cleanStyle;
  }
  const children =
    props.children !== undefined
      ? stripUndefinedStyles(props.children)
      : undefined;
  return cloneElement(node, nextProps, children as ReactNode);
}

function renderModule(
  module: APlusGeneratedModule,
  theme: BrandTheme,
  viewport: 'desktop' | 'mobile'
): Response {
  const mobile = viewport === 'mobile';
  const width = mobile ? APLUS_MOBILE_CANVAS_WIDTH : APLUS_CANVAS_WIDTH;
  const height = estimateHeight(module, mobile, theme);
  const element = createElement(
    'div',
    {
      style: {
        display: 'flex',
        width: '100%',
        height,
        background: theme.bg,
      },
    },
    createElement(DesignedModule, { module, theme, viewport })
  );
  return new ImageResponse(stripUndefinedStyles(element) as ReactElement, {
    width,
    height,
  });
}

const SAMPLE_MODULE: APlusGeneratedModule = {
  order: 1,
  amazonModuleType: 'STANDARD_THREE_IMAGE_TEXT',
  title: 'Built for comfort & convenience',
  type: 'three-image-text',
  columns: [
    {
      image: { role: 'c1', brief: '', size: '1024x1024', alt: 'a' },
      headline: 'Ripple wall insulation',
      body: 'Keeps drinks hot while protecting your hands — no sleeve required.',
    },
    {
      image: { role: 'c2', brief: '', size: '1024x1024', alt: 'b' },
      headline: 'Secure lid',
      body: 'Snap-fit lid helps prevent spills and keeps drinks warm on the go.',
    },
    {
      image: { role: 'c3', brief: '', size: '1024x1024', alt: 'c' },
      headline: 'Food-grade interior',
      body: 'Smooth interior lining helps prevent leaks and preserves taste.',
    },
  ],
};

export async function GET(request: Request) {
  // Dev-only sample render for verification (no auth, no S3).
  const url = new URL(request.url);
  if (
    url.searchParams.get('sample') === '1' &&
    process.env.NODE_ENV !== 'production'
  ) {
    const viewport =
      url.searchParams.get('viewport') === 'mobile' ? 'mobile' : 'desktop';
    return renderModule(SAMPLE_MODULE, brandThemeFrom(null), viewport);
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
  } catch {
    return Response.json({ error: 'Invalid module payload.' }, { status: 400 });
  }

  const theme = brandThemeFrom(null);
  const merged: BrandTheme = { ...theme, ...input.theme };
  await Promise.all([
    inlineSlotImages(input.module, session.user.sub),
    inlineThemeLogo(merged, session.user.sub),
  ]);
  return renderModule(input.module, merged, input.viewport);
}
