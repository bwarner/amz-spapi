/**
 * Rasterizes the committed brand SVGs into the PNGs that external consumers
 * require.
 *
 * Two audiences drive this list:
 *   - Partner/OAuth consoles (Amazon SP-API & Ads app listings, Auth0 Universal
 *     Login). They want a square PNG at a fixed size and generally will not
 *     follow a redirect or render an SVG.
 *   - Transactional email. Gmail and Outlook do not render SVG at all, and need
 *     an explicit pixel width plus a 2x asset for retina.
 *
 * Depends only on the committed SVGs — no font is needed, because the wordmark
 * was already outlined by outline-wordmark.mjs. That is the point: this can run
 * on any machine, in CI, and produce byte-identical output.
 *
 *   node scripts/brand/render-pngs.mjs
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'apps/web/public/brand';

/** Native SVG user-space size, so we can rasterize at 1:1 instead of upscaling. */
const HORIZONTAL = { w: 300, h: 72 };
const ICON = { w: 72, h: 72 };

const targets = [
  // Email headers. Display the 300px asset at 300px wide; the 600/900 variants
  // are the 2x/3x sources for retina.
  ...[300, 600, 900].map((w) => ({
    src: 'sellavant-logo-horizontal.svg',
    out: `sellavant-logo-horizontal-${w}.png`,
    native: HORIZONTAL,
    width: w,
  })),
  // Same, for dark backgrounds — including email clients that force dark mode
  // and would otherwise render navy type on a near-black card.
  ...[300, 600, 900].map((w) => ({
    src: 'sellavant-logo-horizontal-on-dark.svg',
    out: `sellavant-logo-horizontal-on-dark-${w}.png`,
    native: HORIZONTAL,
    width: w,
  })),
  // Square app icon for partner consoles. 512 covers Amazon's app listing,
  // 150 covers Auth0 Universal Login, 256 is the common middle request.
  ...[512, 256, 150].map((w) => ({
    src: 'sellavant-icon.svg',
    out: `sellavant-icon-${w}.png`,
    native: ICON,
    width: w,
  })),
];

const results = [];

for (const t of targets) {
  const height = Math.round((t.width * t.native.h) / t.native.w);
  // Rasterize at the target resolution rather than at the SVG's nominal 72dpi
  // and scaling up, which would soften the curves.
  const density = Math.min(2400, Math.round(72 * (t.width / t.native.w)));
  const buf = await sharp(readFileSync(join(DIR, t.src)), { density })
    .resize(t.width, height, { fit: 'fill' })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();

  // Write the encoded buffer straight through. Handing it back to sharp via
  // .toFile() would re-encode it with default options, discarding the palette
  // and inflating each file roughly 2.5x.
  writeFileSync(join(DIR, t.out), buf);
  const meta = await sharp(buf).metadata();
  results.push({
    file: t.out,
    px: `${meta.width}x${meta.height}`,
    kb: (buf.length / 1024).toFixed(1),
    alpha: meta.hasAlpha,
  });
}

console.table(results);
console.log(`${results.length} PNGs written to ${DIR}/`);
