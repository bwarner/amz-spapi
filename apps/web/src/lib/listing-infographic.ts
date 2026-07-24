import { createElement as h, type ReactElement } from 'react';
import { ImageResponse } from 'next/og';
import { stripUndefinedStyles } from './aplus-export-render';
import {
  ICON_PATHS,
  resolveIcon,
} from '../app/(dashboard)/a-plus/components/a-plus-design';

/**
 * Deterministic infographic templates for listing images (square 2000×2000):
 * the model supplies CONTENT (headline, benefits, callouts, colors); layout,
 * typography, and icons are fixed here — same satori pipeline and standards
 * as the A+ designed bands. The product appears as a real photo/cutout data
 * URL, never generated.
 */

export const INFOGRAPHIC_SIZE = 2000;

export type InfographicContent = {
  template: 'benefit-grid' | 'callout-overlay';
  productImageDataUrl: string;
  headline: string;
  subheadline?: string;
  /** benefit-grid: 2–5 items. */
  benefits?: Array<{ icon: string; label: string; text?: string }>;
  /** callout-overlay: 2–6 items; x/y are canvas fractions on the product. */
  callouts?: Array<{ x: number; y: number; title: string; text?: string }>;
  colors?: { background?: string; text?: string; accent?: string };
};

type Palette = {
  background: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
};

function palette(colors?: InfographicContent['colors']): Palette {
  const accent = colors?.accent ?? '#4f46e5';
  return {
    background: colors?.background ?? '#ffffff',
    text: colors?.text ?? '#1f2937',
    muted: '#6b7280',
    accent,
    accentSoft: `${accent}1f`,
  };
}

function icon(name: string, size: number, stroke: string): ReactElement {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke,
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    ICON_PATHS[resolveIcon(name)].map((d, index) =>
      h('path', { key: index, d })
    )
  );
}

function headerBlock(content: InfographicContent, colors: Palette) {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          fontSize: 104,
          fontWeight: 700,
          color: colors.text,
          lineHeight: 1.1,
          textAlign: 'center',
        },
      },
      content.headline
    ),
    content.subheadline
      ? h(
          'div',
          {
            style: {
              display: 'flex',
              marginTop: 28,
              fontSize: 52,
              color: colors.muted,
              textAlign: 'center',
            },
          },
          content.subheadline
        )
      : null
  );
}

function benefitGrid(content: InfographicContent, colors: Palette) {
  const benefits = (content.benefits ?? []).slice(0, 5);
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: INFOGRAPHIC_SIZE,
        height: INFOGRAPHIC_SIZE,
        background: colors.background,
        padding: 100,
      },
    },
    headerBlock(content, colors),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          marginTop: 60,
          gap: 80,
        },
      },
      h('img', {
        src: content.productImageDataUrl,
        style: {
          width: 900,
          height: 1300,
          objectFit: 'contain',
        },
      }),
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
            gap: benefits.length > 3 ? 56 : 88,
          },
        },
        benefits.map((benefit, index) =>
          h(
            'div',
            { key: index, style: { display: 'flex', gap: 44 } },
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 128,
                  height: 128,
                  borderRadius: 64,
                  background: colors.accentSoft,
                  flexShrink: 0,
                },
              },
              icon(benefit.icon, 64, colors.accent)
            ),
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                },
              },
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    fontSize: 54,
                    fontWeight: 700,
                    color: colors.text,
                    lineHeight: 1.15,
                  },
                },
                benefit.label
              ),
              benefit.text
                ? h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        marginTop: 10,
                        fontSize: 40,
                        color: colors.muted,
                        lineHeight: 1.3,
                      },
                    },
                    benefit.text
                  )
                : null
            )
          )
        )
      )
    )
  );
}

function calloutOverlay(content: InfographicContent, colors: Palette) {
  const callouts = (content.callouts ?? []).slice(0, 6);
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: INFOGRAPHIC_SIZE,
        height: INFOGRAPHIC_SIZE,
        background: colors.background,
        padding: 100,
        position: 'relative',
      },
    },
    headerBlock(content, colors),
    h('img', {
      src: content.productImageDataUrl,
      style: {
        position: 'absolute',
        left: 300,
        top: 420,
        width: 1400,
        height: 1400,
        objectFit: 'contain',
      },
    }),
    callouts.map((callout, index) => {
      const dotX = Math.round(callout.x * INFOGRAPHIC_SIZE);
      const dotY = Math.round(callout.y * INFOGRAPHIC_SIZE);
      const chipOnLeft = callout.x >= 0.5;
      const chipWidth = 460;
      const chipLeft = chipOnLeft
        ? Math.max(dotX - chipWidth - 70, 24)
        : Math.min(dotX + 70, INFOGRAPHIC_SIZE - chipWidth - 24);
      return h(
        'div',
        { key: index, style: { display: 'flex' } },
        h('div', {
          style: {
            position: 'absolute',
            left: dotX - 22,
            top: dotY - 22,
            width: 44,
            height: 44,
            borderRadius: 22,
            background: colors.accent,
            border: '8px solid #ffffff',
          },
        }),
        h(
          'div',
          {
            style: {
              position: 'absolute',
              left: chipLeft,
              top: Math.min(Math.max(dotY - 70, 24), INFOGRAPHIC_SIZE - 260),
              display: 'flex',
              flexDirection: 'column',
              width: chipWidth,
              padding: '28px 36px',
              borderRadius: 24,
              background: 'rgba(255,255,255,0.94)',
              border: `4px solid ${colors.accent}`,
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                fontSize: 44,
                fontWeight: 700,
                color: colors.text,
                lineHeight: 1.15,
              },
            },
            callout.title
          ),
          callout.text
            ? h(
                'div',
                {
                  style: {
                    display: 'flex',
                    marginTop: 8,
                    fontSize: 34,
                    color: colors.muted,
                    lineHeight: 1.3,
                  },
                },
                callout.text
              )
            : null
        )
      );
    })
  );
}

export function renderListingInfographic(
  content: InfographicContent
): Response {
  const colors = palette(content.colors);
  const element =
    content.template === 'benefit-grid'
      ? benefitGrid(content, colors)
      : calloutOverlay(content, colors);
  return new ImageResponse(stripUndefinedStyles(element) as ReactElement, {
    width: INFOGRAPHIC_SIZE,
    height: INFOGRAPHIC_SIZE,
  });
}
