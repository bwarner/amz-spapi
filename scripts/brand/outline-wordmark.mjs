/**
 * Converts the Sellavant wordmark from live SVG <text> into outlined paths.
 *
 * Why this exists: a hosted brand asset is rasterized by machines we do not
 * control — partner OAuth consoles, email clients, PNG converters. Live text
 * renders in whatever font that machine happens to have, and Inter is not
 * installed on most of them. The wordmark must be frozen into geometry before
 * it leaves the building.
 *
 * This is a rare, deliberate step. The SVGs it writes are committed and are the
 * source of truth, so nothing at build or request time needs a font. Re-run
 * only when the wordmark itself changes.
 *
 *   node scripts/brand/outline-wordmark.mjs
 */
import { openSync } from 'fontkit';
import { writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OUT_DIR = 'apps/web/public/brand';

/** Inter Variable, in the places it usually lands. OFL-1.1 (see apps/web/src/assets/fonts). */
const FONT_CANDIDATES = [
  join(homedir(), 'Library/Fonts/InterVariable.ttf'),
  '/Library/Fonts/InterVariable.ttf',
  '/usr/share/fonts/truetype/inter/InterVariable.ttf',
  join(homedir(), '.local/share/fonts/InterVariable.ttf'),
];

// Type geometry, carried over verbatim from the original <text> element so the
// outlined logo drops in where the live-text one used to be.
const TEXT = 'Sellavant';
const FONT_SIZE = 42;
const WEIGHT = 800;
const LETTER_SPACING = -0.5;
const BASELINE_X = 92;
const BASELINE_Y = 51;

const NAVY = '#152A4A';
const GOLD = '#D9A441';
const CREAM = '#F3E4C0';

const fontPath = FONT_CANDIDATES.find((p) => existsSync(p));
if (!fontPath) {
  console.error(
    'Inter Variable not found. Looked in:\n  ' +
      FONT_CANDIDATES.join('\n  ') +
      '\n\nInstall it from https://rsms.me/inter/ (OFL-1.1) and re-run.\n' +
      'The committed SVGs already contain the outlined wordmark — you only need\n' +
      'this script if the wordmark itself is changing.'
  );
  process.exit(1);
}

const file = openSync(fontPath);
const round = (n) => Number(n.toFixed(2));

/**
 * Flatten "Sellavant" to absolute user-space path data at a given optical size.
 *
 * The transform is applied by hand rather than via path.scale().translate() so
 * the y-axis flip (fonts grow up, SVG grows down) stays explicit and the output
 * carries no transform attribute for a downstream renderer to mishandle.
 */
function outlineWordmark(opticalSize) {
  const font = file.getVariation({ wght: WEIGHT, opsz: opticalSize });
  const scale = FONT_SIZE / font.unitsPerEm;
  const run = font.layout(TEXT);
  const segments = [];
  let penX = 0;

  run.glyphs.forEach((glyph, i) => {
    const pos = run.positions[i];
    const originX = BASELINE_X + (penX + pos.xOffset) * scale;
    const originY = BASELINE_Y - pos.yOffset * scale;
    const fx = (x) => round(originX + x * scale);
    const fy = (y) => round(originY - y * scale);

    for (const { command, args } of glyph.path.commands) {
      switch (command) {
        case 'moveTo':
          segments.push(`M${fx(args[0])} ${fy(args[1])}`);
          break;
        case 'lineTo':
          segments.push(`L${fx(args[0])} ${fy(args[1])}`);
          break;
        case 'quadraticCurveTo':
          segments.push(
            `Q${fx(args[0])} ${fy(args[1])} ${fx(args[2])} ${fy(args[3])}`
          );
          break;
        case 'bezierCurveTo':
          segments.push(
            `C${fx(args[0])} ${fy(args[1])} ${fx(args[2])} ${fy(args[3])} ${fx(args[4])} ${fy(args[5])}`
          );
          break;
        case 'closePath':
          segments.push('Z');
          break;
        default:
          throw new Error(`Unhandled path command from fontkit: ${command}`);
      }
    }
    penX += pos.xAdvance + LETTER_SPACING / scale;
  });

  return {
    d: segments.join(''),
    rightEdge: round(BASELINE_X + penX * scale - LETTER_SPACING),
    glyphs: run.glyphs.length,
  };
}

/** The chart-bars-and-trendline icon tile, shared by every lockup. */
const iconTile = (keyline) =>
  `  <rect x="1" y="1" width="70" height="70" rx="18" fill="${NAVY}"${
    keyline ? ` stroke="${CREAM}" stroke-width="1.5" stroke-opacity="0.35"` : ''
  }/>
  <rect x="19" y="40" width="8" height="16" rx="2.5" fill="${GOLD}"/>
  <rect x="32" y="30" width="8" height="26" rx="2.5" fill="${GOLD}"/>
  <rect x="45" y="18" width="8" height="38" rx="2.5" fill="${GOLD}"/>
  <polyline points="23,40 36,30 49,18" stroke="${CREAM}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`;

const lockup = ({ width, wordmark, fill, keyline, label }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 72" width="${width}" height="72" fill="none" role="img" aria-label="Sellavant">
  <title>${label}</title>
${iconTile(keyline)}
  <path d="${wordmark.d}" fill="${fill}"/>
</svg>
`;

// Inter's optical-size axis, used deliberately:
//   opsz 32 — display cut. What a browser picks at 42px. For the full lockup.
//   opsz 14 — text cut: looser spacing, sturdier joins. Holds up when the whole
//             lockup is rendered around 100px wide, which is what "small" is for.
const display = outlineWordmark(32);
const text = outlineWordmark(14);

// The full lockup keeps viewBox 300x72 because the web app pins matching
// intrinsic sizes (117x28, 133x32, 150x36) at its three call sites. The small
// lockup is new, so its box is trimmed to the artwork.
const files = [
  [
    'sellavant-logo-horizontal.svg',
    lockup({
      width: 300,
      wordmark: display,
      fill: NAVY,
      keyline: false,
      label: 'Sellavant',
    }),
  ],
  [
    'sellavant-logo-horizontal-on-dark.svg',
    lockup({
      width: 300,
      wordmark: display,
      fill: CREAM,
      keyline: true,
      label: 'Sellavant (for dark backgrounds)',
    }),
  ],
  [
    'sellavant-logo-small.svg',
    lockup({
      width: Math.ceil(text.rightEdge) + 1,
      wordmark: text,
      fill: NAVY,
      keyline: false,
      label: 'Sellavant (compact lockup)',
    }),
  ],
  [
    'sellavant-logo-small-on-dark.svg',
    lockup({
      width: Math.ceil(text.rightEdge) + 1,
      wordmark: text,
      fill: CREAM,
      keyline: true,
      label: 'Sellavant (compact lockup, for dark backgrounds)',
    }),
  ],
];

console.log(
  `Outlined "${TEXT}" — ${display.glyphs} glyphs; display cut ends at x=${display.rightEdge}, text cut at x=${text.rightEdge}`
);
for (const [name, svg] of files) {
  writeFileSync(join(OUT_DIR, name), svg);
  console.log(`  wrote ${OUT_DIR}/${name}`);
}
