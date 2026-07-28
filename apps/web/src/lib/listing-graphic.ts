import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createElement as h, type ReactElement } from 'react';
import { ImageResponse } from 'next/og';

/**
 * Model-authored listing graphics: a declarative layout rendered through the
 * satori pipeline (`next/og`), so every glyph is real rendered type.
 *
 * Why this exists: image models garble text at any size ("Buqunto Paunwr"), and
 * the fixed infographic templates solve legibility but not art direction — the
 * model cannot widen a column, so copy gets clipped and gaps open up. This gives
 * it the layout control it needs while keeping text deterministic.
 *
 * Deliberately NOT raw SVG/HTML from the model: a validated node tree has no
 * script, no <foreignObject>, and no external href to fetch, so there is no
 * sanitising to get wrong. Images arrive as host-resolved data URLs from
 * ownership-checked assets, never as URLs the model supplies.
 */

const FONT_DIR = 'apps/web/src/assets/fonts';

/** Playfair for display copy, Inter for body — the two the fonts dir ships. */
export type GraphicFont = 'serif' | 'sans';

type FontFile = { family: string; file: string; weight: 400 | 600 | 700 };

const FONT_FILES: FontFile[] = [
  { family: 'Playfair', file: 'PlayfairDisplay-400.woff', weight: 400 },
  { family: 'Playfair', file: 'PlayfairDisplay-700.woff', weight: 700 },
  { family: 'Inter', file: 'Inter-400.woff', weight: 400 },
  { family: 'Inter', file: 'Inter-600.woff', weight: 600 },
];

/**
 * Fonts live in the repo, not node_modules, and cwd differs between Nx dev
 * (apps/web) and a deployed function root — same walk-up as the background
 * removal model path.
 */
function fontDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, FONT_DIR);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Listing graphic fonts not found. Expected them at ' + FONT_DIR
  );
}

let cachedFonts: Array<{
  name: string;
  data: Buffer;
  weight: 400 | 600 | 700;
  style: 'normal';
}> | null = null;

function loadFonts() {
  if (cachedFonts) return cachedFonts;
  const dir = fontDir();
  cachedFonts = FONT_FILES.map((font) => ({
    name: font.family,
    data: readFileSync(path.join(dir, font.file)),
    weight: font.weight,
    style: 'normal' as const,
  }));
  return cachedFonts;
}

/**
 * Every position and size is a FRACTION of the canvas (0-1), so a layout is
 * resolution-independent and reads the same way as compose/callout coordinates
 * elsewhere in the toolset. fontSize is a fraction of canvas HEIGHT.
 */
export type GraphicTextNode = {
  type: 'text';
  text: string;
  /** Fraction of canvas height. */
  fontSize: number;
  font?: GraphicFont;
  weight?: 400 | 600 | 700;
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** Fraction of font size. */
  letterSpacing?: number;
  lineHeight?: number;
  uppercase?: boolean;
};

/** A horizontal divider inside a column. */
export type GraphicRuleNode = {
  type: 'rule';
  color: string;
  /** Fraction of canvas height (default hairline). */
  thickness?: number;
  /** Fraction of the column width (default 1). */
  width?: number;
};

export type GraphicNode =
  | {
      /**
       * Text laid out in FLOW, top-down, from an anchor point. Use this for any
       * group of copy: wrapped lines push the following item down instead of
       * overlapping it, which absolute positioning cannot guarantee because the
       * line count of a string is not knowable in advance.
       */
      type: 'column';
      x: number;
      y: number;
      width: number;
      /** Vertical space between children, fraction of canvas height. */
      gap?: number;
      align?: 'left' | 'center' | 'right';
      children: Array<GraphicTextNode | GraphicRuleNode>;
    }
  | {
      type: 'box';
      x: number;
      y: number;
      width: number;
      height: number;
      background?: string;
      borderColor?: string;
      /** Fraction of canvas height. */
      borderWidth?: number;
      radius?: number;
    }
  | (GraphicTextNode & {
      /**
       * Absolutely positioned single line. Safe for short, known-length labels;
       * prefer `column` whenever the copy might wrap.
       */
      x: number;
      y: number;
      width: number;
    })
  | {
      type: 'image';
      /** Host-resolved data URL of an owned asset. */
      dataUrl: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fit?: 'contain' | 'cover';
    };

export type GraphicSpec = {
  width: number;
  height: number;
  background?: string;
  nodes: GraphicNode[];
};

const pct = (value: number) => `${value * 100}%`;

function familyFor(font: GraphicFont | undefined): string {
  return font === 'sans' ? 'Inter' : 'Playfair';
}

/** Snap to a weight the family actually ships; satori has no synthetic bold. */
function weightFor(
  font: GraphicFont | undefined,
  weight?: number
): 400 | 600 | 700 {
  if (!weight || weight < 500) return 400;
  return font === 'sans' ? 600 : 700;
}

/** Text/rule rendered in flow — no position, the column owns placement. */
function renderChild(
  child: GraphicTextNode | GraphicRuleNode,
  key: string,
  canvasHeight: number
) {
  if (child.type === 'rule') {
    return h('div', {
      key,
      style: {
        width: pct(child.width ?? 1),
        height: `${Math.max(
          Math.round((child.thickness ?? 0.0015) * canvasHeight),
          1
        )}px`,
        background: child.color,
      },
    });
  }
  const fontSize = Math.max(Math.round(child.fontSize * canvasHeight), 8);
  return h('div', {
    key,
    style: {
      display: 'flex',
      width: '100%',
      fontFamily: familyFor(child.font),
      fontWeight: weightFor(child.font, child.weight),
      fontSize,
      lineHeight: child.lineHeight ?? 1.2,
      color: child.color ?? '#111111',
      textAlign: child.align ?? 'left',
      ...(child.letterSpacing
        ? { letterSpacing: `${child.letterSpacing * fontSize}px` }
        : {}),
    },
    children: child.uppercase ? child.text.toUpperCase() : child.text,
  });
}

function renderNode(node: GraphicNode, index: number, canvasHeight: number) {
  const key = `n${index}`;
  if (node.type === 'column') {
    return h('div', {
      key,
      style: {
        position: 'absolute',
        left: pct(node.x),
        top: pct(node.y),
        width: pct(node.width),
        display: 'flex',
        flexDirection: 'column',
        gap: `${Math.round((node.gap ?? 0.015) * canvasHeight)}px`,
        alignItems:
          node.align === 'center'
            ? 'center'
            : node.align === 'right'
            ? 'flex-end'
            : 'flex-start',
      },
      children: node.children.map((child, childIndex) =>
        renderChild(child, `${key}c${childIndex}`, canvasHeight)
      ),
    });
  }
  if (node.type === 'box') {
    return h('div', {
      key,
      style: {
        position: 'absolute',
        left: pct(node.x),
        top: pct(node.y),
        width: pct(node.width),
        height: pct(node.height),
        ...(node.background ? { background: node.background } : {}),
        ...(node.borderColor && node.borderWidth
          ? {
              border: `${Math.max(
                Math.round(node.borderWidth * canvasHeight),
                1
              )}px solid ${node.borderColor}`,
            }
          : {}),
        ...(node.radius
          ? { borderRadius: `${Math.round(node.radius * canvasHeight)}px` }
          : {}),
      },
    });
  }

  if (node.type === 'image') {
    return h('div', {
      key,
      style: {
        position: 'absolute',
        left: pct(node.x),
        top: pct(node.y),
        width: pct(node.width),
        height: pct(node.height),
        display: 'flex',
      },
      children: h('img', {
        src: node.dataUrl,
        style: {
          width: '100%',
          height: '100%',
          objectFit: node.fit ?? 'contain',
        },
      }),
    });
  }

  const fontSize = Math.max(Math.round(node.fontSize * canvasHeight), 8);
  return h('div', {
    key,
    style: {
      position: 'absolute',
      left: pct(node.x),
      top: pct(node.y),
      width: pct(node.width),
      display: 'flex',
      // satori needs an explicit direction; text nodes stack their wrapped lines.
      flexDirection: 'column',
      alignItems:
        node.align === 'center'
          ? 'center'
          : node.align === 'right'
          ? 'flex-end'
          : 'flex-start',
      fontFamily: familyFor(node.font),
      fontWeight: weightFor(node.font, node.weight),
      fontSize,
      lineHeight: node.lineHeight ?? 1.2,
      color: node.color ?? '#111111',
      textAlign: node.align ?? 'left',
      ...(node.letterSpacing
        ? { letterSpacing: `${node.letterSpacing * fontSize}px` }
        : {}),
    },
    children: node.uppercase ? node.text.toUpperCase() : node.text,
  });
}

/** Render a layout to PNG bytes. */
export async function renderListingGraphic(spec: GraphicSpec): Promise<Buffer> {
  const element = h(
    'div',
    {
      style: {
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        background: spec.background ?? '#ffffff',
      },
    },
    ...spec.nodes.map((node, index) => renderNode(node, index, spec.height))
  );

  const response = new ImageResponse(element as ReactElement, {
    width: spec.width,
    height: spec.height,
    fonts: loadFonts(),
  });
  return Buffer.from(await response.arrayBuffer());
}
