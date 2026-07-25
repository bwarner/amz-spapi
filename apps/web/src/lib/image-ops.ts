import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import type { SellerImageOps } from '@amz-spapi/seller-agent';
import { loadAssetBytes, persistGeneratedImageAsset } from './media-assets';
import { renderListingInfographic } from './listing-infographic';

const BG_REMOVAL_DIST = 'node_modules/@imgly/background-removal-node/dist';

/**
 * The background-removal package resolves its model files via
 * `path.resolve('node_modules/...')` from the process CWD — which is apps/web
 * under Nx dev (and the function root on Vercel), NOT the workspace root where
 * pnpm hoists the dependency. Walk up from cwd to find the real dist dir and
 * pass it as an explicit publicPath. Plain fs/path (no createRequire) so
 * webpack never tries to statically analyze a dynamic module resolution.
 */
function backgroundRemovalPublicPath(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, BG_REMOVAL_DIST);
    if (existsSync(candidate)) return `${pathToFileURL(candidate).href}/`;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback to the library's own default location relative to cwd.
  return `${pathToFileURL(path.join(process.cwd(), BG_REMOVAL_DIST)).href}/`;
}

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

type Box = { left: number; top: number; width: number; height: number };

/** Longest edge used for the pixel scan — the bbox is mapped back to source coords. */
const SCAN_MAX = 900;
const ALPHA_THRESHOLD = 8;
const COLOR_THRESHOLD = 12;

function maskBounds(
  isContent: (index: number) => boolean,
  width: number,
  height: number
): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!isContent(row + x)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/** Map a scan-space box back to source pixels, bleeding one scan pixel outward. */
function toSourceBox(
  box: Box,
  scan: { width: number; height: number },
  src: { width: number; height: number }
): Box {
  const sx = src.width / scan.width;
  const sy = src.height / scan.height;
  const left = Math.max(0, Math.floor((box.left - 1) * sx));
  const top = Math.max(0, Math.floor((box.top - 1) * sy));
  const right = Math.min(src.width, Math.ceil((box.left + box.width + 1) * sx));
  const bottom = Math.min(
    src.height,
    Math.ceil((box.top + box.height + 1) * sy)
  );
  return {
    left,
    top,
    width: Math.max(right - left, 1),
    height: Math.max(bottom - top, 1),
  };
}

/**
 * Bounding box of the actual subject, measured from the pixels — the alpha
 * channel for cutouts, otherwise the pixels that differ from the (uniform)
 * border color. This is the piece the model cannot do: it never sees pixel
 * data, so any crop rect it invents for a cutout is a guess. A PNG that
 * carries an unused alpha channel (opaque photo on white) falls through to the
 * color pass so white-background photos trim too.
 */
export async function subjectBoundingBox(
  input: Buffer,
  threshold?: number
): Promise<Box | null> {
  const meta = await sharp(input).metadata();
  const srcWidth = meta.width ?? 0;
  const srcHeight = meta.height ?? 0;
  if (!srcWidth || !srcHeight) return null;

  const scale = Math.min(1, SCAN_MAX / Math.max(srcWidth, srcHeight));
  const scan = {
    width: Math.max(1, Math.round(srcWidth * scale)),
    height: Math.max(1, Math.round(srcHeight * scale)),
  };
  const src = { width: srcWidth, height: srcHeight };
  const resized = () =>
    sharp(input).resize({
      width: scan.width,
      height: scan.height,
      fit: 'fill',
    });

  if (meta.hasAlpha) {
    const cutoff = threshold ?? ALPHA_THRESHOLD;
    const { data } = await resized()
      .ensureAlpha()
      .extractChannel('alpha')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const box = maskBounds((i) => data[i] > cutoff, scan.width, scan.height);
    // Fully opaque alpha channel tells us nothing — fall through to color.
    if (box && box.width * box.height < scan.width * scan.height * 0.995) {
      return toSourceBox(box, scan, src);
    }
    if (!box) return null;
  }

  const cutoff = threshold ?? COLOR_THRESHOLD;
  const { data } = await resized()
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = data.length / (scan.width * scan.height);
  if (channels < 3) return null;
  const corners = [
    0,
    (scan.width - 1) * channels,
    (scan.height - 1) * scan.width * channels,
    ((scan.height - 1) * scan.width + scan.width - 1) * channels,
  ];
  const reference = [0, 1, 2].map((c) => {
    const values = corners
      .map((offset) => data[offset + c])
      .sort((a, b) => a - b);
    return (values[1] + values[2]) / 2;
  });
  const box = maskBounds(
    (i) => {
      const offset = i * channels;
      return (
        Math.abs(data[offset] - reference[0]) > cutoff ||
        Math.abs(data[offset + 1] - reference[1]) > cutoff ||
        Math.abs(data[offset + 2] - reference[2]) > cutoff
      );
    },
    scan.width,
    scan.height
  );
  return box ? toSourceBox(box, scan, src) : null;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function padBox(
  box: Box,
  padding: number,
  frame: { width: number; height: number }
): Box {
  const margin = Math.round(
    Math.max(box.width, box.height) * Math.max(padding, 0)
  );
  const left = Math.max(0, box.left - margin);
  const top = Math.max(0, box.top - margin);
  const right = Math.min(frame.width, box.left + box.width + margin);
  const bottom = Math.min(frame.height, box.top + box.height + margin);
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Crop `input` down to its subject plus `padding` (a fraction of the subject's
 * longest side). Returns the input untouched when no subject can be found or
 * the crop would gain nothing.
 */
export async function trimToSubject(
  input: Buffer,
  options: { padding?: number; threshold?: number } = {}
): Promise<{ buffer: Buffer; box: Box | null; trimmed: boolean }> {
  const meta = await sharp(input).metadata();
  const frame = { width: meta.width ?? 0, height: meta.height ?? 0 };
  if (!frame.width || !frame.height)
    return { buffer: input, box: null, trimmed: false };

  const subject = await subjectBoundingBox(input, options.threshold);
  if (!subject) return { buffer: input, box: null, trimmed: false };

  const region = padBox(subject, options.padding ?? 0, frame);
  if (region.width >= frame.width && region.height >= frame.height) {
    return { buffer: input, box: subject, trimmed: false };
  }
  const buffer = await sharp(input).extract(region).png().toBuffer();
  return {
    buffer,
    box: {
      left: subject.left - region.left,
      top: subject.top - region.top,
      width: subject.width,
      height: subject.height,
    },
    trimmed: true,
  };
}

/**
 * Center `input` on a canvas of `aspect`, sized so the image fills `coverage`
 * of it — the deterministic way to build an Amazon main image (square, product
 * at ~85%) from an already-trimmed subject.
 */
export async function frameToAspect(
  input: Buffer,
  options: { aspect: string; coverage?: number; background?: sharp.Color }
): Promise<{ buffer: Buffer; offset: { left: number; top: number } }> {
  const meta = await sharp(input).metadata();
  const contentWidth = meta.width ?? 0;
  const contentHeight = meta.height ?? 0;
  if (!contentWidth || !contentHeight) {
    throw new Error('Could not read image dimensions.');
  }
  const ratio = parseAspect(options.aspect);
  const coverage = Math.min(Math.max(options.coverage ?? 0.85, 0.1), 1);

  let canvasWidth = Math.ceil(contentWidth / coverage);
  let canvasHeight = Math.ceil(canvasWidth / ratio);
  if (contentHeight > canvasHeight * coverage) {
    canvasHeight = Math.ceil(contentHeight / coverage);
    canvasWidth = Math.ceil(canvasHeight * ratio);
  }
  const left = Math.round((canvasWidth - contentWidth) / 2);
  const top = Math.round((canvasHeight - contentHeight) / 2);

  const buffer = await sharp(input)
    .ensureAlpha()
    .extend({
      top,
      bottom: canvasHeight - contentHeight - top,
      left,
      right: canvasWidth - contentWidth - left,
      background: options.background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return { buffer, offset: { left, top } };
}

/** In-place 1D minimum filter (radius 1) — one erosion step per axis. */
function erodeAlpha(alpha: Uint8Array, width: number, height: number): void {
  const row = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    const base = y * width;
    row.set(alpha.subarray(base, base + width));
    for (let x = 0; x < width; x++) {
      const left = x > 0 ? row[x - 1] : row[x];
      const right = x < width - 1 ? row[x + 1] : row[x];
      alpha[base + x] = Math.min(row[x], left, right);
    }
  }
  const column = new Uint8Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) column[y] = alpha[y * width + x];
    for (let y = 0; y < height; y++) {
      const up = y > 0 ? column[y - 1] : column[y];
      const down = y < height - 1 ? column[y + 1] : column[y];
      alpha[y * width + x] = Math.min(column[y], up, down);
    }
  }
}

/** In-place 3-tap box blur per axis — feathers a hard-eroded mask by ~1px. */
function featherAlpha(alpha: Uint8Array, width: number, height: number): void {
  const row = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    const base = y * width;
    row.set(alpha.subarray(base, base + width));
    for (let x = 0; x < width; x++) {
      const left = x > 0 ? row[x - 1] : row[x];
      const right = x < width - 1 ? row[x + 1] : row[x];
      alpha[base + x] = (left + row[x] + right) / 3;
    }
  }
  const column = new Uint8Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) column[y] = alpha[y * width + x];
    for (let y = 0; y < height; y++) {
      const up = y > 0 ? column[y - 1] : column[y];
      const down = y < height - 1 ? column[y + 1] : column[y];
      alpha[y * width + x] = (up + column[y] + down) / 3;
    }
  }
}

/** How many pixels of edge to drop — the fringe scales with the cutout. */
function defaultEdgeShrink(width: number, height: number): number {
  return Math.min(Math.max(Math.round(Math.min(width, height) / 400), 1), 4);
}

/**
 * Kill the light halo a segmentation cutout carries at its edges.
 *
 * Two defects live in that ring: alpha that is partially transparent where it
 * should be empty, and RGB that is still the ORIGINAL BACKGROUND's color.
 * Flattening onto white hides both; compositing onto a dark scene shows them as
 * a light outline that no amount of blending fixes. So: erode the alpha by
 * `shrink` px (drops the ring entirely), feather the hard edge back by ~1px to
 * avoid stair-stepping, then repaint whatever partial pixels remain with their
 * neighbours' alpha-weighted color — pulling product color outward instead of
 * letting background color bleed inward.
 *
 * The ring is a fixed number of source pixels wide, so `shrink` scales with the
 * image: a 1px erosion is invisible on a 2000px cutout.
 */
export async function refineCutoutEdges(
  input: Buffer,
  shrink?: number
): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (channels !== 4 || !width || !height) return input;

  const steps = Math.min(
    Math.max(Math.round(shrink ?? defaultEdgeShrink(width, height)), 0),
    8
  );
  if (steps === 0) return input;

  const pixels = width * height;
  const original = new Uint8Array(pixels);
  const refined = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) {
    original[i] = data[i * 4 + 3];
    refined[i] = original[i];
  }
  for (let step = 0; step < steps; step++) {
    erodeAlpha(refined, width, height);
  }
  featherAlpha(refined, width, height);

  const out = Buffer.from(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const alpha = refined[index];
      out[index * 4 + 3] = alpha;
      // Only the partially covered ring needs its color rebuilt.
      if (alpha === 0 || alpha >= 250) continue;

      let weight = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const neighbour = ny * width + nx;
          // Weight by ORIGINAL alpha: solid product pixels dominate, so the
          // background's color never gets a vote.
          const w = original[neighbour];
          if (w < 250) continue;
          weight += w;
          r += data[neighbour * 4] * w;
          g += data[neighbour * 4 + 1] * w;
          b += data[neighbour * 4 + 2] * w;
        }
      }
      if (!weight) continue;
      out[index * 4] = Math.round(r / weight);
      out[index * 4 + 1] = Math.round(g / weight);
      out[index * 4 + 2] = Math.round(b / weight);
    }
  }

  return sharp(out, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

/** Mean RGB of a cutout's solid pixels — its own lighting, ignoring the void. */
async function subjectMeanColor(
  input: Buffer
): Promise<[number, number, number] | null> {
  const { data, info } = await sharp(input)
    .resize({ width: 160, height: 160, fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) return null;

  let count = 0;
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 250) continue;
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
    count++;
  }
  if (!count) return null;
  return [sum[0] / count, sum[1] / count, sum[2] / count];
}

/** Mean RGB of the background patch the product will cover. */
async function regionMeanColor(
  input: Buffer,
  region: sharp.Region
): Promise<[number, number, number] | null> {
  const stats = await sharp(input)
    .extract(region)
    .removeAlpha()
    .toColourspace('srgb')
    .stats();
  const [r, g, b] = stats.channels;
  if (!r || !g || !b) return null;
  return [r.mean, g.mean, b.mean];
}

/**
 * Nudge the cutout's exposure and color temperature toward the scene it is
 * being dropped into — a studio-lit product pasted on a warm dim shelf shot
 * looks pasted precisely because its channel means are wrong.
 *
 * Gray-world transfer, per channel, damped by `strength` and hard-clamped:
 * enough to sell the composite, never enough to recolor the product.
 */
export async function matchLighting(
  fgBuffer: Buffer,
  bgBuffer: Buffer,
  region: sharp.Region,
  strength: number
): Promise<Buffer> {
  const [subject, scene] = await Promise.all([
    subjectMeanColor(fgBuffer),
    regionMeanColor(bgBuffer, region),
  ]);
  if (!subject || !scene) return fgBuffer;

  // The clamp widens with strength: at the default it nudges, at 1 it can
  // genuinely relight a studio shot for a dim warm scene — but a gain is never
  // free to invert the product's own tonality.
  const limit = 0.25 + 0.35 * strength;
  const gains = subject.map((value, channel) => {
    if (value < 4) return 1;
    const ratio = scene[channel] / value;
    return Math.min(Math.max(1 + strength * (ratio - 1), 1 - limit), 1 + limit);
  }) as [number, number, number];

  if (gains.every((gain) => Math.abs(gain - 1) < 0.02)) return fgBuffer;

  // linear() must not touch alpha, so detach it and rejoin after.
  const { data, info } = await sharp(fgBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) return fgBuffer;
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.min(255, Math.round(data[i] * gains[0]));
    out[i + 1] = Math.min(255, Math.round(data[i + 1] * gains[1]));
    out[i + 2] = Math.min(255, Math.round(data[i + 2] * gains[2]));
  }
  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/**
 * Contact shadow under the foreground, derived from its alpha.
 *
 * The geometry matters more than the softness: an omnidirectional blur of a
 * boxy product (a coffee bag, a carton) reads as a black FRAME around it, not
 * as a shadow — which is exactly what a big sigma with a small offset used to
 * produce. So the mask is squashed toward its base, pushed well below the
 * product, blurred modestly, and dimmed. Returns null when the shadow falls
 * entirely outside the frame (sharp composites must lie inside the base).
 */
export async function buildDropShadow(params: {
  fgBuffer: Buffer;
  fgWidth: number;
  fgHeight: number;
  left: number;
  top: number;
  bgWidth: number;
  bgHeight: number;
  /** 0 = none, 1 = full strength (default 0.55). */
  strength?: number;
}): Promise<sharp.OverlayOptions | null> {
  const { fgBuffer, fgWidth, fgHeight, left, top, bgWidth, bgHeight } = params;
  const strength = Math.min(Math.max(params.strength ?? 0.55, 0), 1);
  if (strength <= 0) return null;

  const blurSigma = Math.min(Math.max(Math.round(fgWidth * 0.012), 3), 16);
  const pad = blurSigma * 3;
  const opacity = 0.45 * strength;
  // Push the shadow clear of the product so it grounds it instead of ringing it.
  const offsetY = Math.max(Math.round(fgHeight * 0.045), pad);
  // Flatten the silhouette toward the floor — a cast shadow is not a copy of
  // the object, and squashing keeps it from peeking out at the sides.
  const squash = 0.35;
  const shadowSourceHeight = Math.max(Math.round(fgHeight * squash), 8);

  const shadowWidth = fgWidth + pad * 2;
  const shadowHeight = fgHeight + pad * 2;

  // TWO passes, deliberately. sharp applies operations in a fixed internal
  // order, not call order: extend/resize run BEFORE extractChannel. Chaining
  // them meant `background: 'black'` padded the still-RGBA image with OPAQUE
  // black, so the extracted "alpha" was 255 everywhere — a solid black
  // rectangle instead of a shadow. And linear() cannot dim it either: linear
  // also runs before the extraction, and on RGBA it skips alpha. So: isolate
  // the alpha into a real greyscale image first, shape it second, dim it in JS.
  const alphaOnly = await sharp(fgBuffer)
    .ensureAlpha()
    .extractChannel('alpha')
    .toColourspace('b-w')
    .png()
    .toBuffer();

  const shaped = await sharp(alphaOnly)
    .resize({ width: fgWidth, height: shadowSourceHeight, fit: 'fill' })
    .extend({
      top: pad + (fgHeight - shadowSourceHeight),
      bottom: pad,
      left: pad,
      right: pad,
      // Genuinely 1-channel now, so black means fully transparent shadow.
      background: 'black',
    })
    .blur(blurSigma)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Never assume the channel count: sharp promotes greyscale to 3-channel sRGB
  // partway through this pipeline, which would make a raw buffer read as the
  // wrong dimensions. Take channel 0 per pixel and dim while we are here.
  const step = shaped.info.channels;
  const mask = Buffer.alloc(shadowWidth * shadowHeight);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = Math.round(shaped.data[i * step] * opacity);
  }

  const shadow = await sharp({
    create: {
      width: shadowWidth,
      height: shadowHeight,
      channels: 3,
      background: 'black',
    },
  })
    .joinChannel(mask, {
      raw: { width: shadowWidth, height: shadowHeight, channels: 1 },
    })
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

  const save = async (buffer: Buffer, mime: string, subject?: Box | null) => {
    const asset = await persistGeneratedImageAsset({
      userId,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
      feature: 'listings',
    });
    const meta = await sharp(buffer).metadata();
    const width = meta.width;
    const height = meta.height;
    return {
      assetId: asset.assetId,
      url: `/api/a-plus/assets/${asset.assetId}`,
      width,
      height,
      subject:
        subject && width && height
          ? {
              x: round3(subject.left / width),
              y: round3(subject.top / height),
              width: round3(subject.width / width),
              height: round3(subject.height / height),
            }
          : undefined,
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

    async trim(params) {
      const { bytes, mimeType } = await load(params.assetId);
      // With an aspect, `coverage` sets the margin — padding first would make
      // the subject land smaller than asked.
      const { buffer: trimmed, box } = await trimToSubject(Buffer.from(bytes), {
        padding: params.aspect ? 0 : params.padding ?? 0.02,
        threshold: params.threshold,
      });
      if (!box) {
        throw new Error(
          'Could not find a subject to trim to — the image has no transparent or ' +
            'uniform border to crop away. Crop it with crop-image instead.'
        );
      }

      // Default to keeping whatever the source had: flattening a cutout to
      // white here would quietly destroy the transparency it was made for.
      const sourceHasAlpha =
        (await sharp(trimmed).metadata()).hasAlpha ?? false;
      const transparent =
        params.background === 'transparent' ||
        (params.background === undefined && sourceHasAlpha);
      const fill: sharp.Color = transparent
        ? { r: 0, g: 0, b: 0, alpha: 0 }
        : params.background ?? '#ffffff';
      const format = transparent
        ? { mime: 'image/png', apply: (p: sharp.Sharp) => p.png() }
        : outputFormat(mimeType);

      const framed = params.aspect
        ? await frameToAspect(trimmed, {
            aspect: params.aspect,
            coverage: params.coverage,
            background: fill,
          })
        : { buffer: trimmed, offset: { left: 0, top: 0 } };

      const pipeline = transparent
        ? sharp(framed.buffer).ensureAlpha()
        : sharp(framed.buffer).flatten({ background: fill });
      return save(await format.apply(pipeline).toBuffer(), format.mime, {
        left: box.left + framed.offset.left,
        top: box.top + framed.offset.top,
        width: box.width,
        height: box.height,
      });
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
      // Templates size the product by its image box, so an untrimmed cutout
      // would render small inside its own empty margins.
      const { buffer: productBuffer, trimmed } = await trimToSubject(
        Buffer.from(product.bytes)
      );
      const productMime = trimmed ? 'image/png' : product.mimeType;
      const response = renderListingInfographic({
        template: params.template,
        productImageDataUrl: `data:${productMime};base64,${productBuffer.toString(
          'base64'
        )}`,
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

      // Scale/position are meant to describe the PRODUCT, so measure from the
      // product: a cutout that still carries the original photo's empty
      // margins would otherwise land small and off-center.
      const fgSource =
        params.trimForeground === false
          ? Buffer.from(foreground.bytes)
          : (await trimToSubject(Buffer.from(foreground.bytes))).buffer;

      // Decontaminate before scaling: the fringe is a fixed pixel ring in the
      // source, so a downscale would smear it instead of removing it.
      const fgClean =
        params.refineEdges === false
          ? fgSource
          : await refineCutoutEdges(fgSource, params.edgeShrink);

      const scale = params.scale ?? 0.7;
      const fgTargetWidth = Math.max(Math.round(bgWidth * scale), 8);
      const fgScaled = await sharp(fgClean)
        .resize({
          width: fgTargetWidth,
          height: bgHeight,
          fit: 'inside',
        })
        .png()
        .toBuffer();
      const fgMeta = await sharp(fgScaled).metadata();
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

      // Match the product's exposure/temperature to the patch it covers, now
      // that we know exactly which patch that is.
      const lightingStrength = Math.min(
        Math.max(params.lightingMatch ?? 0.5, 0),
        1
      );
      const fgBuffer =
        lightingStrength > 0
          ? await matchLighting(
              fgScaled,
              Buffer.from(background.bytes),
              { left, top, width: fgWidth, height: fgHeight },
              lightingStrength
            )
          : fgScaled;

      const layers: sharp.OverlayOptions[] = [];
      const shadowStrength =
        params.shadow === false
          ? 0
          : typeof params.shadow === 'number'
          ? params.shadow
          : 0.55;
      if (shadowStrength > 0) {
        const shadowLayer = await buildDropShadow({
          fgBuffer,
          fgWidth,
          fgHeight,
          left,
          top,
          bgWidth,
          bgHeight,
          strength: shadowStrength,
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
          publicPath: backgroundRemovalPublicPath(),
          model: 'medium',
          output: { format: 'image/png' },
        }
      );
      const cutoutBuffer = Buffer.from(await cutout.arrayBuffer());

      // The mask's edge ring still carries the ORIGINAL background's color at
      // partial alpha — invisible once flattened onto white, but a white halo
      // the moment the cutout lands on a dark scene. Clean it here, at the
      // source, instead of in every consumer.
      const decontaminated =
        params.refineEdges === false
          ? cutoutBuffer
          : await refineCutoutEdges(cutoutBuffer, params.edgeShrink);

      // Segmentation leaves the product surrounded by whatever empty space the
      // original photo had. Crop to the cutout's alpha bounding box by default
      // so downstream scale/position math refers to the product, not the
      // leftover canvas.
      const { buffer: framed, box } =
        params.trim === false
          ? { buffer: decontaminated, box: null }
          : await trimToSubject(decontaminated, {
              padding: params.padding ?? 0.02,
            });

      if ((params.background ?? 'white') === 'transparent') {
        return save(framed, 'image/png', box);
      }
      const buffer = await sharp(framed)
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 95 })
        .toBuffer();
      return save(buffer, 'image/jpeg', box);
    },
  };
}
