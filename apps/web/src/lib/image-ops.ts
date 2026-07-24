import sharp from 'sharp';
import type { SellerImageOps } from '@amz-spapi/seller-agent';
import { loadAssetBytes, persistGeneratedImageAsset } from './media-assets';
import { renderListingInfographic } from './listing-infographic';

/**
 * Host implementation of the agent's image-editing operations. Every op loads
 * an owned asset, transforms with sharp (background removal via the ONNX
 * segmentation model in @imgly/background-removal-node, lazily imported — the
 * model loads once per server process on first use), and persists the result
 * as a new `generated-*` asset.
 */

const GRAVITY_POSITIONS = ['center', 'top', 'bottom', 'left', 'right'] as const;
type Gravity = (typeof GRAVITY_POSITIONS)[number];

function outputFormat(mimeType: string): {
  mime: string;
  apply: (pipeline: sharp.Sharp) => sharp.Sharp;
} {
  if (mimeType.includes('png')) {
    return { mime: 'image/png', apply: (p) => p.png() };
  }
  if (mimeType.includes('webp')) {
    return { mime: 'image/webp', apply: (p) => p.webp({ quality: 92 }) };
  }
  return { mime: 'image/jpeg', apply: (p) => p.jpeg({ quality: 92 }) };
}

function parseAspect(aspect: string): number {
  const match = aspect.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match)
    throw new Error(`Invalid aspect "${aspect}" — use e.g. "1:1" or "4:3".`);
  const ratio = Number(match[1]) / Number(match[2]);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new Error(`Invalid aspect "${aspect}".`);
  }
  return ratio;
}

/**
 * Soft drop shadow derived from the foreground's alpha: the mask is padded (so
 * the blur can spread), blurred, dimmed, and cast onto black — then offset
 * slightly downward and clipped to the background frame (sharp composites
 * must lie fully inside the base image). Returns null when the shadow falls
 * entirely outside the frame.
 */
async function buildDropShadow(params: {
  fgBuffer: Buffer;
  fgWidth: number;
  fgHeight: number;
  left: number;
  top: number;
  bgWidth: number;
  bgHeight: number;
}): Promise<sharp.OverlayOptions | null> {
  const { fgBuffer, fgWidth, fgHeight, left, top, bgWidth, bgHeight } = params;
  const blurSigma = Math.min(Math.max(Math.round(fgWidth * 0.02), 4), 25);
  const pad = blurSigma * 3;
  const opacity = 0.35;
  const offsetY = Math.max(Math.round(fgHeight * 0.03), 4);

  const alpha = await sharp(fgBuffer)
    .ensureAlpha()
    .extractChannel('alpha')
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: 'black',
    })
    .blur(blurSigma)
    .linear(opacity, 0)
    .toBuffer();

  const shadowWidth = fgWidth + pad * 2;
  const shadowHeight = fgHeight + pad * 2;
  const shadow = await sharp({
    create: {
      width: shadowWidth,
      height: shadowHeight,
      channels: 3,
      background: 'black',
    },
  })
    .joinChannel(alpha)
    .png()
    .toBuffer();

  // Desired placement, then intersect with the frame.
  const desiredLeft = left - pad;
  const desiredTop = top - pad + offsetY;
  const srcX = Math.max(0, -desiredLeft);
  const srcY = Math.max(0, -desiredTop);
  const dstLeft = Math.max(0, desiredLeft);
  const dstTop = Math.max(0, desiredTop);
  const visibleWidth = Math.min(shadowWidth - srcX, bgWidth - dstLeft);
  const visibleHeight = Math.min(shadowHeight - srcY, bgHeight - dstTop);
  if (visibleWidth <= 0 || visibleHeight <= 0) return null;

  const clipped = await sharp(shadow)
    .extract({
      left: srcX,
      top: srcY,
      width: visibleWidth,
      height: visibleHeight,
    })
    .png()
    .toBuffer();

  return { input: clipped, left: dstLeft, top: dstTop };
}

export function createImageOps(userId: string): SellerImageOps {
  const load = async (assetId: string) => {
    const asset = await loadAssetBytes({ userId, assetId });
    if (!asset) {
      throw new Error(
        `Asset ${assetId} not found. Use an asset id from this conversation's photos.`
      );
    }
    return asset;
  };

  const save = async (buffer: Buffer, mime: string) => {
    const asset = await persistGeneratedImageAsset({
      userId,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
      feature: 'listings',
    });
    const meta = await sharp(buffer).metadata();
    return {
      assetId: asset.assetId,
      url: `/api/a-plus/assets/${asset.assetId}`,
      width: meta.width,
      height: meta.height,
    };
  };

  return {
    async crop(params) {
      const { bytes, mimeType } = await load(params.assetId);
      const source = sharp(Buffer.from(bytes));
      const meta = await source.metadata();
      const srcWidth = meta.width ?? 0;
      const srcHeight = meta.height ?? 0;
      if (!srcWidth || !srcHeight)
        throw new Error('Could not read image dimensions.');

      let region: sharp.Region;
      if (params.rect) {
        const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
        const x = clamp(params.rect.x);
        const y = clamp(params.rect.y);
        const width = Math.min(clamp(params.rect.width), 1 - x);
        const height = Math.min(clamp(params.rect.height), 1 - y);
        region = {
          left: Math.round(x * srcWidth),
          top: Math.round(y * srcHeight),
          width: Math.max(Math.round(width * srcWidth), 8),
          height: Math.max(Math.round(height * srcHeight), 8),
        };
      } else if (params.aspect) {
        const target = parseAspect(params.aspect);
        const sourceRatio = srcWidth / srcHeight;
        const cropWidth =
          sourceRatio > target ? Math.round(srcHeight * target) : srcWidth;
        const cropHeight =
          sourceRatio > target ? srcHeight : Math.round(srcWidth / target);
        const gravity: Gravity = params.gravity ?? 'center';
        const left =
          gravity === 'left'
            ? 0
            : gravity === 'right'
            ? srcWidth - cropWidth
            : Math.round((srcWidth - cropWidth) / 2);
        const top =
          gravity === 'top'
            ? 0
            : gravity === 'bottom'
            ? srcHeight - cropHeight
            : Math.round((srcHeight - cropHeight) / 2);
        region = { left, top, width: cropWidth, height: cropHeight };
      } else {
        throw new Error('Provide either rect (fractions) or aspect for crop.');
      }

      const format = outputFormat(mimeType);
      const buffer = await format.apply(source.extract(region)).toBuffer();
      return save(buffer, format.mime);
    },

    async resize(params) {
      if (!params.width && !params.height) {
        throw new Error('Provide a target width and/or height.');
      }
      const { bytes, mimeType } = await load(params.assetId);
      const format = outputFormat(mimeType);
      const buffer = await format
        .apply(
          sharp(Buffer.from(bytes)).resize({
            width: params.width,
            height: params.height,
            fit: params.fit ?? 'inside',
            withoutEnlargement: !params.allowUpscale,
          })
        )
        .toBuffer();
      return save(buffer, format.mime);
    },

    async renderInfographic(params) {
      const product = await load(params.productImageAssetId);
      const response = renderListingInfographic({
        template: params.template,
        productImageDataUrl: `data:${product.mimeType};base64,${Buffer.from(
          product.bytes
        ).toString('base64')}`,
        headline: params.headline,
        subheadline: params.subheadline,
        benefits: params.benefits,
        callouts: params.callouts,
        colors: params.colors,
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      return save(buffer, 'image/png');
    },

    async compose(params) {
      const [foreground, background] = await Promise.all([
        load(params.foregroundAssetId),
        load(params.backgroundAssetId),
      ]);
      const bg = sharp(Buffer.from(background.bytes));
      const bgMeta = await bg.metadata();
      const bgWidth = bgMeta.width ?? 0;
      const bgHeight = bgMeta.height ?? 0;
      if (!bgWidth || !bgHeight) {
        throw new Error('Could not read background dimensions.');
      }

      const scale = params.scale ?? 0.7;
      const fgTargetWidth = Math.max(Math.round(bgWidth * scale), 8);
      const fgBuffer = await sharp(Buffer.from(foreground.bytes))
        .resize({
          width: fgTargetWidth,
          height: bgHeight,
          fit: 'inside',
        })
        .png()
        .toBuffer();
      const fgMeta = await sharp(fgBuffer).metadata();
      const fgWidth = fgMeta.width ?? fgTargetWidth;
      const fgHeight = fgMeta.height ?? 0;

      // Position by center, clamped so the foreground stays inside the frame.
      const clamp = (value: number, min: number, max: number) =>
        Math.min(Math.max(value, min), Math.max(max, min));
      const centerX = (params.position?.x ?? 0.5) * bgWidth;
      const centerY = (params.position?.y ?? 0.6) * bgHeight;
      const left = clamp(
        Math.round(centerX - fgWidth / 2),
        0,
        bgWidth - fgWidth
      );
      const top = clamp(
        Math.round(centerY - fgHeight / 2),
        0,
        bgHeight - fgHeight
      );

      const layers: sharp.OverlayOptions[] = [];
      if (params.shadow ?? true) {
        const shadowLayer = await buildDropShadow({
          fgBuffer,
          fgWidth,
          fgHeight,
          left,
          top,
          bgWidth,
          bgHeight,
        });
        if (shadowLayer) layers.push(shadowLayer);
      }
      layers.push({ input: fgBuffer, left, top });

      const format = outputFormat(background.mimeType);
      const buffer = await format.apply(bg.composite(layers)).toBuffer();
      return save(buffer, format.mime);
    },

    async removeBackground(params) {
      const { bytes, mimeType } = await load(params.assetId);
      const { removeBackground } = await import(
        '@imgly/background-removal-node'
      );
      // The segmentation lib dispatches its decoder on Blob.type — an untyped
      // Blob fails with "Unsupported format".
      const cutout = await removeBackground(
        new Blob([Buffer.from(bytes)], { type: mimeType || 'image/png' }),
        {
          model: 'medium',
          output: { format: 'image/png' },
        }
      );
      const cutoutBuffer = Buffer.from(await cutout.arrayBuffer());

      if ((params.background ?? 'white') === 'transparent') {
        return save(cutoutBuffer, 'image/png');
      }
      const buffer = await sharp(cutoutBuffer)
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 95 })
        .toBuffer();
      return save(buffer, 'image/jpeg');
    },
  };
}
