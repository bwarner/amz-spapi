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
  moduleImageSlots,
  type APlusGeneratedModule,
} from '@farvisionllc/models';
import { createAssetS3Client, getAsset } from './media-assets';
import {
  APLUS_CANVAS_WIDTH,
  APLUS_MOBILE_CANVAS_WIDTH,
  APLUS_PREMIUM_CANVAS_WIDTH,
  DesignedModule,
  type BrandTheme,
} from '../app/(dashboard)/a-plus/components/a-plus-design';

// ---------------------------------------------------------------------------
// Server-side designed-module rendering, shared by the module-image route
// (single PNG export) and the export-zip route (Seller Central kit). Moved
// verbatim from module-image/route.ts — behavior must stay identical.
// ---------------------------------------------------------------------------

export const themeSchema = z
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

/**
 * Fixed-frame export dims for premium designed-image bands (VERIFY against
 * Seller Central). Everything else is content-height on the tier's canvas.
 */
export const PREMIUM_BAND_FRAME = {
  desktop: { width: 1464, height: 600 },
  mobile: { width: 600, height: 450 },
} as const;

export function lineCount(
  text: string | undefined,
  charsPerLine: number
): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

/**
 * ImageResponse needs an explicit height. Estimate a generous fixed height per
 * module so content is never clipped; any extra space is painted with the brand
 * background. Errs slightly tall on purpose.
 */
export function estimateHeight(
  module: APlusGeneratedModule,
  mobile: boolean,
  theme: BrandTheme,
  /** Actual render width — wrap math must match it or tall frames leave big
   * empty bottoms (the wrap constants are tuned at 970/600). */
  width?: number,
  /** Band-frame render — some layouts compose taller (see Ctx.band). */
  band?: boolean
): number {
  const w = width ?? (mobile ? APLUS_MOBILE_CANVAS_WIDTH : APLUS_CANVAS_WIDTH);
  switch (module.type) {
    case 'company-logo':
      if (module.placement === 'footer') return mobile ? 240 : 300;
      // Brand hero with an ambient backdrop, else the framed brand band.
      if (module.background) return mobile ? 420 : 480;
      return (module.tagline ? (mobile ? 56 : 60) : 0) + (mobile ? 300 : 400);
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
      // Cards carry a ribbon (26) + accent header (~54) + ~44px rows + padding.
      if (mobile) {
        let h = title + 12;
        for (let i = 0; i < module.products.length; i++)
          h += 26 + 54 + rows * 44 + 16 + 12;
        return h + 24;
      }
      return title + 18 + 26 + 54 + rows * 44 + 16 + 34;
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
    case 'icon-row':
      // Title + icon-above-label cells (3-col wrapped grid on mobile/bands).
      if (mobile) return 76 + Math.ceil(module.items.length / 3) * 118 + 24;
      if (band && module.items.length > 3) {
        return 76 + 16 + Math.ceil(module.items.length / 3) * 160 + 28;
      }
      return 76 + 16 + 122 + 28;
    case 'qna': {
      const title = 92;
      let h = title + 14;
      for (const item of module.items) {
        const qH =
          lineCount(item.question, mobile ? 40 : 70) * (mobile ? 24 : 26);
        const aH = lineCount(item.answer, mobile ? 50 : 95) * 26;
        h += (mobile ? 32 : 40) + qH + 8 + aH + 12;
      }
      return h + (mobile ? 24 : 32);
    }
    case 'hotspots': {
      const title = 92;
      const band = mobile ? 450 : 480;
      let legend = 0;
      for (const spot of module.hotspots) {
        legend += 24 + lineCount(spot.copy, mobile ? 48 : 95) * 24 + 10;
      }
      return title + 14 + band + 18 + legend + (mobile ? 24 : 32);
    }
    case 'carousel': {
      const title = 92;
      const total = module.slides.length;
      if (mobile) {
        let h = title + 10;
        for (const slide of module.slides) {
          const text =
            (slide.headline ? 26 : 0) +
            lineCount(slide.caption, 44) * 22 +
            12 +
            16;
          h += 300 + text + 16;
        }
        return h + 24;
      }
      const imgH = total >= 5 ? 220 : 260;
      const captionChars = Math.max(24, Math.floor(w / total / 8));
      const maxTextH = Math.max(
        1,
        ...module.slides.map(
          (slide) =>
            (slide.headline
              ? lineCount(slide.headline, captionChars) * 22
              : 0) +
            lineCount(slide.caption, captionChars) * 21
        )
      );
      return title + 14 + imgH + 14 + maxTextH + 18 + 32;
    }
    default:
      return mobile ? 640 : 520;
  }
}

/** Replace private asset-route image URLs with inlined data URLs satori can render. */
export async function inlineSlotImages(
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
export async function inlineThemeLogo(
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
      const meta = await sharp(png).metadata();
      if (meta.width && meta.height)
        theme.logoAspect = meta.width / meta.height;
    } else {
      theme.logoUrl = `data:${asset.mimeType};base64,${buffer.toString(
        'base64'
      )}`;
      const meta = await sharp(buffer).metadata();
      if (meta.width && meta.height)
        theme.logoAspect = meta.width / meta.height;
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
export function stripUndefinedStyles(node: unknown): unknown {
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

export function renderModule(
  module: APlusGeneratedModule,
  theme: BrandTheme,
  viewport: 'desktop' | 'mobile',
  tier: 'Basic A+' | 'Premium A+' = 'Basic A+',
  /** Render at a specific canvas width (content-height modules only) — the
   * export composite renders premium natives at 970 (their designed width)
   * and upscales, instead of the airy/gappy fixed-column look at 1464. */
  overrideWidth?: number,
  /** Content destined for a premium band frame — taller compositions. */
  band?: boolean
): Response {
  const mobile = viewport === 'mobile';
  const premium = tier === 'Premium A+';

  // Premium designed-image bands export at Amazon's EXACT upload dims — the
  // module fills the fixed frame full-bleed (zero manual cropping for the
  // seller); estimateHeight is bypassed. An overrideWidth opts OUT of the
  // fixed frame: the export route renders band content tight at its designed
  // width, then scales/pads it into the frame with sharp (bigger content,
  // less dead space than rendering small content inside a tall frame).
  const fixedFrame =
    !overrideWidth &&
    premium &&
    module.amazonModuleType === 'PREMIUM_FULL_IMAGE'
      ? PREMIUM_BAND_FRAME[mobile ? 'mobile' : 'desktop']
      : undefined;

  const width = fixedFrame
    ? fixedFrame.width
    : overrideWidth ??
      (mobile
        ? APLUS_MOBILE_CANVAS_WIDTH
        : premium
        ? APLUS_PREMIUM_CANVAS_WIDTH
        : APLUS_CANVAS_WIDTH);
  const height = fixedFrame
    ? fixedFrame.height
    : estimateHeight(module, mobile, theme, width, band);
  const element = createElement(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: fixedFrame ? 'center' : undefined,
        width: '100%',
        height,
        overflow: fixedFrame ? 'hidden' : undefined,
        background: theme.bg,
      },
    },
    createElement(DesignedModule, { module, theme, viewport, band })
  );
  return new ImageResponse(stripUndefinedStyles(element) as ReactElement, {
    width,
    height,
  });
}
