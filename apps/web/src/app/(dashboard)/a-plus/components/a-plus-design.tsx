// Server-safe core: pure, inline-flex designed module components shared by the
// on-screen preview (a-plus-design-preview.tsx) and the PNG export route
// (next/og). No hooks, no client-only imports — images come from slot.image so
// this renders identically in the browser and in satori on the server.
import {
  applyAPlusGuardrails,
  type APlusGeneratedModule,
  type APlusImageSlot,
} from '@farvisionllc/models';

/**
 * Design canvas width. A standard Amazon A+ module renders at 970px; we author
 * the designed templates at this fixed width (inline-flex styles only, the
 * subset satori/next-og can rasterize) so the SAME component serves both the
 * on-screen preview (scaled to fit) and the PNG export.
 */
export const APLUS_CANVAS_WIDTH = 970;
/** Mobile module canvas. Amazon renders A+ modules far narrower on mobile, so
 * the mobile compositions are authored separately (stacked, larger type, fewer
 * columns) rather than a scaled-down desktop. */
export const APLUS_MOBILE_CANVAS_WIDTH = 600;

/** Selectable design styles. Same content + layouts, different visual language. */
export type DesignStyleKey = 'editorial' | 'modern' | 'bold' | 'minimal';

export const DESIGN_STYLE_KEYS: DesignStyleKey[] = [
  'editorial',
  'modern',
  'bold',
  'minimal',
];

export const DESIGN_STYLE_LABELS: Record<DesignStyleKey, string> = {
  editorial: 'Editorial',
  modern: 'Modern Clean',
  bold: 'Bold Commerce',
  minimal: 'Minimal',
};

export type BrandTheme = {
  bg: string;
  surface: string;
  /** Secondary surface for cards/cells, for rhythm against the page bg. */
  surfaceAlt: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentInk: string;
  /** Soft accent tint for fills/eyebrow blocks. */
  accentSoft: string;
  headingFont: string;
  bodyFont: string;
  brandName?: string;
  logoUrl?: string;
  // --- style treatments (consumed by the shared primitives) ---
  style: DesignStyleKey;
  headingWeight: number;
  headingCase: 'none' | 'uppercase';
  headingTracking: number;
  sectionTitle: 'centered-dots' | 'left-rule' | 'eyebrow' | 'plain';
  bullet: 'check' | 'square' | 'dot' | 'dash';
  radius: number;
  // --- structural treatments: the style drives COMPOSITION, not just skin ---
  /** 'split' = text beside image; 'stacked' = image above text (single column). */
  heroLayout: 'split' | 'stacked';
  /** Default text alignment for hero/stacked compositions. */
  contentAlign: 'left' | 'center';
  /** Which side the hero image sits on for 'split' ('alternate' flips per module). */
  imageSide: 'left' | 'right' | 'alternate';
  /** Image runs to the module edge (no padding on its side, square corner). */
  imageBleed: boolean;
  /** Spacing scale — drives padding and image size. */
  density: 'airy' | 'normal' | 'tight';
};

type StylePreset = Omit<BrandTheme, 'brandName' | 'logoUrl'>;

/** Per-style design tokens. Brand-guide palette/fonts override these when set. */
const STYLE_PRESETS: Record<DesignStyleKey, StylePreset> = {
  editorial: {
    bg: '#F6F1EA',
    surface: '#FFFFFF',
    surfaceAlt: '#EFE7DB',
    ink: '#2A2018',
    muted: '#5E564D',
    line: '#E4DBCF',
    accent: '#9C6B3F',
    accentInk: '#FFFFFF',
    accentSoft: '#EDE0D2',
    headingFont: 'Georgia, "Times New Roman", serif',
    bodyFont: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    style: 'editorial',
    headingWeight: 700,
    headingCase: 'none',
    headingTracking: 0,
    sectionTitle: 'centered-dots',
    bullet: 'check',
    radius: 10,
    // Editorial: symmetric, centered, image-above-text single column.
    heroLayout: 'stacked',
    contentAlign: 'center',
    imageSide: 'right',
    imageBleed: false,
    density: 'normal',
  },
  modern: {
    bg: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceAlt: '#F3F6F8',
    ink: '#16202A',
    muted: '#56657A',
    line: '#E2E8ED',
    accent: '#2D6CDF',
    accentInk: '#FFFFFF',
    accentSoft: '#E7EFFC',
    headingFont: '"Helvetica Neue", Arial, system-ui, sans-serif',
    bodyFont: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    style: 'modern',
    headingWeight: 600,
    headingCase: 'none',
    headingTracking: -0.3,
    sectionTitle: 'left-rule',
    bullet: 'dash',
    radius: 8,
    // Modern: asymmetric split, left-aligned, image bleeds to the right edge.
    heroLayout: 'split',
    contentAlign: 'left',
    imageSide: 'right',
    imageBleed: true,
    density: 'normal',
  },
  bold: {
    bg: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceAlt: '#F4F2F0',
    ink: '#121212',
    muted: '#555555',
    line: '#E6E3E0',
    accent: '#E4471C',
    accentInk: '#FFFFFF',
    accentSoft: '#FBE3DA',
    headingFont: '"Arial Black", "Helvetica Neue", Arial, sans-serif',
    bodyFont: 'Arial, system-ui, sans-serif',
    style: 'bold',
    headingWeight: 800,
    headingCase: 'uppercase',
    headingTracking: 0.2,
    sectionTitle: 'eyebrow',
    bullet: 'square',
    radius: 4,
    // Bold: edge-to-edge images that ALTERNATE sides per module, tight + big.
    heroLayout: 'split',
    contentAlign: 'left',
    imageSide: 'alternate',
    imageBleed: true,
    density: 'tight',
  },
  minimal: {
    bg: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceAlt: '#FAFAFA',
    ink: '#111111',
    muted: '#6A6A6A',
    line: '#ECECEC',
    accent: '#111111',
    accentInk: '#FFFFFF',
    accentSoft: '#F2F2F2',
    headingFont: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    bodyFont: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    style: 'minimal',
    headingWeight: 500,
    headingCase: 'none',
    headingTracking: 0,
    sectionTitle: 'plain',
    bullet: 'dot',
    radius: 2,
    // Minimal: single column, left-aligned, smaller image, lots of air.
    heroLayout: 'stacked',
    contentAlign: 'left',
    imageSide: 'right',
    imageBleed: false,
    density: 'airy',
  },
};

export type BrandThemeInput = {
  brandName?: string;
  palette?: {
    primaryForeground?: string;
    secondaryForeground?: string;
    background?: string;
  };
  fonts?: { primary?: string; secondary?: string };
  logoUrl?: string;
};

/**
 * Derive a usable design theme from the selected brand guide + chosen design
 * style. The style preset sets the visual language; brand-guide palette/fonts
 * override the preset where provided.
 */
export function brandThemeFrom(
  input?: BrandThemeInput | null,
  styleKey: DesignStyleKey = 'editorial'
): BrandTheme {
  const preset = STYLE_PRESETS[styleKey] ?? STYLE_PRESETS.editorial;
  if (!input) return { ...preset };
  const font = (name?: string, fallback?: string) =>
    name?.trim() ? `"${name.trim()}", ${fallback}` : fallback;
  return {
    ...preset,
    ink: input.palette?.primaryForeground || preset.ink,
    accent: input.palette?.secondaryForeground || preset.accent,
    bg: input.palette?.background || preset.bg,
    headingFont:
      font(input.fonts?.primary, preset.headingFont) || preset.headingFont,
    bodyFont: font(input.fonts?.secondary, preset.bodyFont) || preset.bodyFont,
    brandName: input.brandName,
    logoUrl: input.logoUrl,
  };
}

function clean(text: string | undefined | null): string {
  if (!text) return '';
  return applyAPlusGuardrails(text).cleaned;
}

// --- shared primitives (inline styles only; satori-safe) ---------------------

function Photo({
  slot,
  height,
  radius = 0,
}: {
  slot: APlusImageSlot;
  height: number;
  radius?: number;
}) {
  const src = slot.image?.url;
  if (src) {
    return (
      <img
        src={src}
        alt={slot.alt}
        width={0}
        height={height}
        style={{
          width: '100%',
          height,
          objectFit: 'cover',
          borderRadius: radius,
          display: 'block',
        }}
      />
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height,
        borderRadius: radius,
        background: '#ECE6DD',
        color: '#A89C8D',
        fontSize: 13,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      Image pending
    </div>
  );
}

function SectionTitle({ title, theme }: { title: string; theme: BrandTheme }) {
  const text = clean(title);
  if (!text) return null;
  const headingBase = {
    fontFamily: theme.headingFont,
    fontWeight: theme.headingWeight,
    color: theme.ink,
    textTransform: theme.headingCase,
    letterSpacing: theme.headingTracking,
  } as const;

  // Bold: an accent "eyebrow" pill.
  if (theme.sectionTitle === 'eyebrow') {
    return (
      <div
        style={{
          display: 'flex',
          width: '100%',
          padding: '40px 48px 8px',
        }}
      >
        <div
          style={{
            display: 'flex',
            background: theme.accent,
            color: theme.accentInk,
            fontFamily: theme.bodyFont,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            padding: '5px 11px',
            borderRadius: theme.radius,
          }}
        >
          {text.toUpperCase()}
        </div>
      </div>
    );
  }

  // Modern: left-aligned with a short accent rule.
  if (theme.sectionTitle === 'left-rule') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          padding: '40px 48px 8px',
        }}
      >
        <div style={{ ...headingBase, fontSize: 30 }}>{text}</div>
        <div
          style={{
            width: 54,
            height: 3,
            marginTop: 10,
            borderRadius: 3,
            background: theme.accent,
          }}
        />
      </div>
    );
  }

  // Minimal: plain left-aligned title, no decoration.
  if (theme.sectionTitle === 'plain') {
    return (
      <div style={{ display: 'flex', width: '100%', padding: '40px 48px 8px' }}>
        <div style={{ ...headingBase, fontSize: 28 }}>{text}</div>
      </div>
    );
  }

  // Editorial (default): centered title between accent dots and rules.
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        padding: '38px 0 8px',
      }}
    >
      <div style={{ width: 70, height: 1, background: theme.line }} />
      <div
        style={{
          width: 7,
          height: 7,
          margin: '0 14px',
          borderRadius: 7,
          background: theme.accent,
        }}
      />
      <div style={{ ...headingBase, fontSize: 30, textAlign: 'center' }}>
        {text}
      </div>
      <div
        style={{
          width: 7,
          height: 7,
          margin: '0 14px',
          borderRadius: 7,
          background: theme.accent,
        }}
      />
      <div style={{ width: 70, height: 1, background: theme.line }} />
    </div>
  );
}

function BrandLockup({ theme }: { theme: BrandTheme }) {
  if (theme.logoUrl) {
    return (
      <img
        src={theme.logoUrl}
        alt={theme.brandName || 'Brand logo'}
        height={32}
        style={{
          height: 32,
          width: 'auto',
          maxWidth: 200,
          objectFit: 'contain',
          // The text column is a stretch-aligned flex column; without this the
          // logo would stretch to the full column width and distort.
          alignSelf: 'flex-start',
          display: 'block',
        }}
      />
    );
  }
  if (!theme.brandName) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          fontFamily: theme.headingFont,
          fontSize: 20,
          letterSpacing: 3,
          textTransform: 'uppercase',
          color: theme.ink,
        }}
      >
        {theme.brandName}
      </div>
      <div
        style={{ width: 46, height: 2, marginTop: 4, background: theme.accent }}
      />
    </div>
  );
}

function Heading({
  children,
  theme,
  size = 34,
}: {
  children: string;
  theme: BrandTheme;
  size?: number;
}) {
  // Uppercase in JS too: satori (PNG export) does not apply CSS text-transform,
  // so this keeps the on-screen preview and the exported image identical.
  const content =
    theme.headingCase === 'uppercase' ? children.toUpperCase() : children;
  return (
    <div
      style={{
        fontFamily: theme.headingFont,
        fontSize: size,
        lineHeight: 1.12,
        fontWeight: theme.headingWeight,
        color: theme.ink,
        textTransform: theme.headingCase,
        letterSpacing: theme.headingTracking,
      }}
    >
      {content}
    </div>
  );
}

/** Per-style bullet marker (satori-safe inline boxes). */
function BulletMarker({ theme }: { theme: BrandTheme }) {
  if (theme.bullet === 'square') {
    return (
      <div
        style={{
          width: 9,
          height: 9,
          marginRight: 11,
          marginTop: 6,
          background: theme.accent,
        }}
      />
    );
  }
  if (theme.bullet === 'dash') {
    return (
      <div
        style={{
          width: 14,
          height: 2,
          marginRight: 10,
          marginTop: 9,
          background: theme.accent,
        }}
      />
    );
  }
  if (theme.bullet === 'dot') {
    return (
      <div
        style={{
          width: 6,
          height: 6,
          marginRight: 11,
          marginTop: 7,
          borderRadius: 6,
          background: theme.accent,
        }}
      />
    );
  }
  // check (default)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        marginRight: 10,
        marginTop: 1,
        borderRadius: 18,
        background: theme.accent,
        color: theme.accentInk,
        fontSize: 12,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      ✓
    </div>
  );
}

function Body({ children, theme }: { children: string; theme: BrandTheme }) {
  return (
    <div
      style={{
        fontFamily: theme.bodyFont,
        fontSize: 16,
        lineHeight: 1.65,
        color: theme.muted,
      }}
    >
      {children}
    </div>
  );
}

function Bullets({ items, theme }: { items: string[]; theme: BrandTheme }) {
  const list = items.map(clean).filter(Boolean);
  if (!list.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
      {list.map((b) => (
        <div
          key={b}
          style={{ display: 'flex', alignItems: 'flex-start', marginTop: 11 }}
        >
          <BulletMarker theme={theme} />
          <div
            style={{
              fontFamily: theme.bodyFont,
              fontSize: 15,
              lineHeight: 1.5,
              color: theme.ink,
            }}
          >
            {b}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Bold spec/size pill (e.g. "16 OZ") overlaid on a hero image. */
function SpecBadge({ text, theme }: { text: string; theme: BrandTheme }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#FFFFFF',
        color: '#111111',
        fontFamily: theme.headingFont,
        fontWeight: 800,
        fontSize: 24,
        letterSpacing: 0.5,
        lineHeight: 1,
        padding: '10px 18px',
        borderRadius: theme.radius,
        boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
      }}
    >
      {text.toUpperCase()}
    </div>
  );
}

/** Hero photo with an optional spec badge pinned to the top-right corner. */
function HeroPhoto({
  slot,
  height,
  radius,
  badge,
  theme,
  mobile,
}: {
  slot: APlusImageSlot;
  height: number;
  radius: number;
  badge: string;
  theme: BrandTheme;
  mobile: boolean;
}) {
  return (
    <div style={{ position: 'relative', display: 'flex', width: '100%' }}>
      <Photo slot={slot} height={height} radius={radius} />
      {badge ? (
        <div
          style={{
            position: 'absolute',
            top: mobile ? 14 : 18,
            right: mobile ? 14 : 18,
            display: 'flex',
          }}
        >
          <SpecBadge text={badge} theme={theme} />
        </div>
      ) : null}
    </div>
  );
}

// --- per-type designed modules ----------------------------------------------

type Ctx = {
  theme: BrandTheme;
  mobile: boolean;
};

function DesignedHero({
  module,
  ctx,
}: {
  module: Extract<
    APlusGeneratedModule,
    {
      type:
        | 'image-header-with-text'
        | 'image-text-overlay'
        | 'single-image-text';
    }
  >;
  ctx: Ctx;
}) {
  const { theme, mobile } = ctx;
  const stacked = mobile || theme.heroLayout === 'stacked';
  const centered = !mobile && stacked && theme.contentAlign === 'center';
  const basePad =
    theme.density === 'airy'
      ? mobile
        ? 32
        : 76
      : theme.density === 'tight'
      ? mobile
        ? 26
        : 44
      : mobile
      ? 28
      : 56;
  const headSize = mobile
    ? 32
    : theme.density === 'tight'
    ? 48
    : theme.density === 'airy'
    ? 40
    : 42;
  // 'alternate' flips the image side every other module (by module order).
  const side: 'left' | 'right' =
    theme.imageSide === 'alternate'
      ? module.order % 2 === 0
        ? 'left'
        : 'right'
      : theme.imageSide === 'left'
      ? 'left'
      : 'right';

  const headline = clean(module.headline);
  const body = clean(module.body);
  const bullets = 'bullets' in module && module.bullets ? module.bullets : null;
  const badge = clean('badge' in module ? module.badge : undefined);

  // Shared inner content; alignment follows the style.
  const content = (isCentered: boolean) => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxWidth: isCentered ? 720 : '100%',
        alignItems: isCentered ? 'center' : 'flex-start',
        textAlign: isCentered ? 'center' : 'left',
      }}
    >
      {isCentered ? null : <BrandLockup theme={theme} />}
      {isCentered ? null : <div style={{ height: mobile ? 16 : 22 }} />}
      <div
        style={{
          width: 48,
          height: 4,
          marginBottom: 18,
          borderRadius: 4,
          background: theme.accent,
        }}
      />
      {headline ? (
        <Heading theme={theme} size={headSize}>
          {headline}
        </Heading>
      ) : null}
      <div style={{ height: 16 }} />
      {body ? <Body theme={theme}>{body}</Body> : null}
      {bullets ? <Bullets items={bullets} theme={theme} /> : null}
    </div>
  );

  // Stacked: image above, text below (Editorial centered; Minimal left + airy).
  if (stacked) {
    const imgH =
      theme.density === 'airy' ? (mobile ? 240 : 300) : mobile ? 300 : 380;
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          background: theme.bg,
          padding: basePad,
          alignItems: centered ? 'center' : 'stretch',
        }}
      >
        <div
          style={{
            display: 'flex',
            width: '100%',
            maxWidth: centered ? 820 : '100%',
          }}
        >
          <HeroPhoto
            slot={module.image}
            height={imgH}
            radius={theme.radius}
            badge={badge}
            theme={theme}
            mobile={mobile}
          />
        </div>
        <div style={{ height: mobile ? 22 : 30 }} />
        {content(centered)}
      </div>
    );
  }

  // Split: text beside image (Modern image bleeds right; Bold alternates + bleeds).
  const photo = (
    <div style={{ display: 'flex', flex: 1 }}>
      <HeroPhoto
        slot={module.image}
        height={430}
        radius={theme.imageBleed ? 0 : theme.radius}
        badge={badge}
        theme={theme}
        mobile={mobile}
      />
    </div>
  );
  const text = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 470,
        paddingLeft: side === 'left' ? 48 : 0,
        paddingRight: side === 'right' ? 48 : 0,
      }}
    >
      {content(false)}
    </div>
  );
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        background: theme.bg,
        alignItems: 'center',
        paddingTop: basePad,
        paddingBottom: basePad,
        paddingLeft: theme.imageBleed && side === 'left' ? 0 : basePad,
        paddingRight: theme.imageBleed && side === 'right' ? 0 : basePad,
      }}
    >
      {side === 'left' ? (
        <>
          {photo}
          {text}
        </>
      ) : (
        <>
          {text}
          {photo}
        </>
      )}
    </div>
  );
}

/** Large full-bleed hero: a full-width image with the headline overlaid. */
function DesignedOverlayHero({
  module,
  ctx,
}: {
  module: Extract<APlusGeneratedModule, { type: 'image-text-overlay' }>;
  ctx: Ctx;
}) {
  const { theme, mobile } = ctx;
  // Content-driven height: a minimum hero size, but the container GROWS with the
  // text so long copy never clips or spills into the next module.
  const minHeight = mobile ? 380 : 460;
  const pos = module.overlayPosition || 'left';
  const alignText =
    pos === 'center' ? 'center' : pos === 'right' ? 'flex-end' : 'flex-start';
  const textAlign: 'left' | 'center' = pos === 'center' ? 'center' : 'left';
  // Stronger scrim so white copy stays legible even over bright images.
  const scrim =
    pos === 'right'
      ? 'linear-gradient(270deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.42) 45%, rgba(0,0,0,0.08) 100%)'
      : pos === 'center'
      ? 'linear-gradient(180deg, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.68) 100%)'
      : 'linear-gradient(90deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.42) 45%, rgba(0,0,0,0.08) 100%)';
  const headline = clean(module.headline);
  const body = clean(module.body);
  const src = module.image.image?.url;
  const badge = clean(module.badge);
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        minHeight,
        // Dark base so white text is readable even before/without an image.
        background: '#241D17',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
        }}
      >
        {src ? (
          <img
            src={src}
            alt={module.image.alt}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          <div style={{ display: 'flex', width: '100%', height: '100%' }} />
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          background: scrim,
        }}
      />
      {badge ? (
        <div
          style={{
            position: 'absolute',
            top: mobile ? 22 : 30,
            right: mobile ? 22 : 30,
            display: 'flex',
          }}
        >
          <SpecBadge text={badge} theme={theme} />
        </div>
      ) : null}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          padding: mobile ? 32 : 64,
          alignItems: alignText,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            maxWidth: mobile ? '100%' : 580,
            alignItems: alignText,
            textAlign,
          }}
        >
          <div
            style={{
              width: 52,
              height: 4,
              marginBottom: 20,
              borderRadius: 4,
              background: theme.accent,
            }}
          />
          {headline ? (
            <div
              style={{
                fontFamily: theme.headingFont,
                fontSize: mobile ? 34 : 48,
                lineHeight: 1.1,
                fontWeight: theme.headingWeight,
                color: '#FFFFFF',
                textTransform: theme.headingCase,
                letterSpacing: theme.headingTracking,
              }}
            >
              {theme.headingCase === 'uppercase'
                ? headline.toUpperCase()
                : headline}
            </div>
          ) : null}
          {body ? (
            <div
              style={{
                marginTop: 16,
                fontFamily: theme.bodyFont,
                fontSize: mobile ? 16 : 18,
                lineHeight: 1.6,
                color: 'rgba(255,255,255,0.92)',
                maxWidth: 540,
              }}
            >
              {body}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DesignedColumns({
  module,
  ctx,
}: {
  module: Extract<
    APlusGeneratedModule,
    { type: 'three-image-text' | 'four-image-text-quadrant' }
  >;
  ctx: Ctx;
}) {
  const { theme, mobile } = ctx;
  const cells =
    module.type === 'three-image-text' ? module.columns : module.quadrants;
  // Editorial = bordered surface cards; every other style = borderless cells with
  // edge-to-edge images (square for Bold via radius, rounded otherwise).
  const carded = !theme.imageBleed && theme.density !== 'airy';
  const cellCentered = !mobile && theme.contentAlign === 'center';
  const gap =
    theme.density === 'airy' ? 18 : theme.density === 'tight' ? 8 : 11;
  const imgH = mobile
    ? 120
    : theme.density === 'tight'
    ? 196
    : theme.density === 'airy'
    ? 150
    : 172;
  const outerPad = theme.density === 'airy' ? '14px 46px 0' : '14px 30px 0';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        background: theme.bg,
        paddingBottom: theme.density === 'airy' ? 40 : mobile ? 22 : 30,
      }}
    >
      <SectionTitle title={module.title} theme={theme} />
      <div
        style={{
          display: 'flex',
          flexDirection: mobile ? 'column' : 'row',
          flexWrap: mobile ? 'nowrap' : 'wrap',
          width: '100%',
          padding: mobile ? '10px 22px 0' : outerPad,
        }}
      >
        {cells.map((cell, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              flexDirection: mobile ? 'row' : 'column',
              flex: mobile ? '0 1 auto' : 1,
              width: mobile ? '100%' : 'auto',
              alignItems: mobile ? 'center' : 'stretch',
              margin: mobile
                ? '0 0 12px 0'
                : i === 0
                ? `0 ${gap}px 0 0`
                : i === cells.length - 1
                ? `0 0 0 ${gap}px`
                : `0 ${gap}px`,
              background: carded ? theme.surface : 'transparent',
              borderRadius: carded ? theme.radius : 0,
              overflow: carded ? 'hidden' : 'visible',
              border: carded ? `1px solid ${theme.line}` : 'none',
            }}
          >
            <div
              style={{
                display: 'flex',
                width: mobile ? 140 : '100%',
                borderRadius: carded ? 0 : theme.radius,
                overflow: 'hidden',
              }}
            >
              <Photo slot={cell.image} height={mobile ? 120 : imgH} />
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: mobile ? 1 : '0 1 auto',
                padding: carded ? 16 : `14px ${mobile ? 0 : 2}px 0`,
                alignItems: cellCentered ? 'center' : 'flex-start',
                textAlign: cellCentered ? 'center' : 'left',
              }}
            >
              {clean(cell.headline) ? (
                <div
                  style={{
                    fontFamily: theme.headingFont,
                    fontSize: mobile ? 18 : 17,
                    fontWeight: theme.headingWeight,
                    color: theme.ink,
                    letterSpacing: theme.headingTracking,
                    marginBottom: 6,
                  }}
                >
                  {clean(cell.headline)}
                </div>
              ) : null}
              {clean(cell.body) ? (
                <div
                  style={{
                    fontFamily: theme.bodyFont,
                    fontSize: mobile ? 14 : 13.5,
                    lineHeight: 1.5,
                    color: theme.muted,
                  }}
                >
                  {clean(cell.body)}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DesignedComparison({
  module,
  ctx,
}: {
  module: Extract<APlusGeneratedModule, { type: 'comparison-table' }>;
  ctx: Ctx;
}) {
  const { theme } = ctx;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        background: theme.bg,
        paddingBottom: 30,
      }}
    >
      <SectionTitle title={module.title} theme={theme} />
      <div
        style={{
          display: 'flex',
          flexDirection: ctx.mobile ? 'column' : 'row',
          padding: ctx.mobile ? '10px 22px 0' : '14px 30px 0',
        }}
      >
        {module.products.map((product, pi) => (
          <div
            key={pi}
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: ctx.mobile ? '0 1 auto' : 1,
              width: ctx.mobile ? '100%' : 'auto',
              margin: ctx.mobile
                ? '0 0 10px 0'
                : pi === 0
                ? '0 8px 0 0'
                : pi === module.products.length - 1
                ? '0 0 0 8px'
                : '0 8px',
              background: product.highlight ? theme.surface : '#F0EAE1',
              border: `1px solid ${
                product.highlight ? theme.accent : theme.line
              }`,
              borderRadius: theme.radius,
              padding: 18,
            }}
          >
            <div
              style={{
                fontFamily: theme.headingFont,
                fontSize: 18,
                fontWeight: 700,
                color: theme.ink,
                textAlign: 'center',
                marginBottom: 12,
              }}
            >
              {clean(product.title)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {module.rows.map((row, ri) => {
                const value = clean(row.values[pi] ?? '');
                return (
                  <div
                    key={ri}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '7px 0',
                      borderTop: ri === 0 ? 'none' : `1px solid ${theme.line}`,
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        fontFamily: theme.bodyFont,
                        fontSize: 12,
                        color: theme.muted,
                      }}
                    >
                      {row.label}
                    </div>
                    <div
                      style={{
                        fontFamily: theme.bodyFont,
                        fontSize: 13,
                        fontWeight: product.highlight ? 700 : 400,
                        color: product.highlight ? theme.accent : theme.ink,
                        textAlign: 'right',
                      }}
                    >
                      {value}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DesignedSpecsOrText({
  module,
  ctx,
}: {
  module: Extract<APlusGeneratedModule, { type: 'tech-specs' | 'text-only' }>;
  ctx: Ctx;
}) {
  const { theme, mobile } = ctx;
  // Bold (tight) gets alternating row fills + accent labels; airy gets roomy
  // hairline rows; others keep clean line-divided rows. Padding scales with density.
  const zebra = theme.density === 'tight';
  const rowPadY =
    theme.density === 'airy' ? 14 : theme.density === 'tight' ? 8 : 10;
  const outerPad =
    theme.density === 'airy'
      ? '12px 48px 44px'
      : theme.density === 'tight'
      ? '8px 40px 28px'
      : '10px 40px 34px';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        background: theme.bg,
        padding: outerPad,
      }}
    >
      <SectionTitle title={module.title} theme={theme} />
      {clean(module.headline) ? (
        <div style={{ display: 'flex', marginTop: 6 }}>
          <Heading theme={theme} size={theme.density === 'tight' ? 26 : 24}>
            {clean(module.headline)}
          </Heading>
        </div>
      ) : null}
      {module.type === 'tech-specs' ? (
        <div
          style={{ display: 'flex', flexDirection: 'column', marginTop: 14 }}
        >
          {module.rows.map((row, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: mobile ? 'column' : 'row',
                padding: `${rowPadY}px ${zebra ? 14 : 0}px`,
                background:
                  zebra && i % 2 === 1 ? theme.surfaceAlt : 'transparent',
                borderTop:
                  zebra || i === 0 ? 'none' : `1px solid ${theme.line}`,
              }}
            >
              <div
                style={{
                  width: mobile ? '100%' : 280,
                  marginBottom: mobile ? 2 : 0,
                  fontFamily: theme.bodyFont,
                  fontSize: 14,
                  fontWeight: 600,
                  color: zebra ? theme.accent : theme.ink,
                }}
              >
                {row.label}
              </div>
              <div
                style={{
                  flex: mobile ? '0 1 auto' : 1,
                  fontFamily: theme.bodyFont,
                  fontSize: 14,
                  color: theme.muted,
                }}
              >
                {clean(row.value)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}
        >
          {clean(module.body) ? (
            <Body theme={theme}>{clean(module.body)}</Body>
          ) : null}
          {module.bullets ? (
            <Bullets items={module.bullets} theme={theme} />
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Convert #RGB / #RRGGBB to rgba(); returns the input unchanged if not hex. */
function withAlpha(color: string, alpha: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function DesignedLogo({
  module,
  ctx,
}: {
  module: Extract<APlusGeneratedModule, { type: 'company-logo' }>;
  ctx: Ctx;
}) {
  const { theme, mobile } = ctx;
  // A brand HERO: the seller's real (large) logo over an ambient brand backdrop
  // with a brand-tinted scrim + accent flair and a heading-font tagline. The
  // logo is never AI-generated; only the backdrop is.
  const bgSrc = module.background?.image?.url;
  // Fit the logo within a box (cap BOTH height and width) so wide wordmarks get
  // width and tall stacked lockups don't dominate — scales to fill without
  // forcing an oversized fixed height.
  const logoMaxHeight = bgSrc ? (mobile ? 72 : 104) : mobile ? 64 : 92;
  const logoMaxWidth = mobile ? 340 : 460;
  const logo = theme.logoUrl ? (
    <img
      src={theme.logoUrl}
      alt={theme.brandName || 'Brand logo'}
      style={{
        maxHeight: logoMaxHeight,
        maxWidth: logoMaxWidth,
        width: 'auto',
        height: 'auto',
        objectFit: 'contain',
        display: 'block',
      }}
    />
  ) : theme.brandName ? (
    <div
      style={{
        fontFamily: theme.headingFont,
        fontSize: mobile ? 34 : 52,
        fontWeight: theme.headingWeight,
        letterSpacing: 4,
        textTransform: 'uppercase',
        color: theme.ink,
        textAlign: 'center',
      }}
    >
      {theme.brandName}
    </div>
  ) : (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 280,
        height: 72,
        border: `1px dashed ${theme.line}`,
        borderRadius: theme.radius,
        color: theme.muted,
        fontFamily: theme.bodyFont,
        fontSize: 13,
      }}
    >
      Add your brand logo
    </div>
  );
  const tagline = clean(module.tagline);
  const accentRule = (
    <div
      style={{
        width: 76,
        height: 3,
        marginTop: 24,
        borderRadius: 3,
        background: theme.accent,
      }}
    />
  );
  const taglineEl = tagline ? (
    <div
      style={{
        marginTop: 16,
        maxWidth: 700,
        fontFamily: theme.headingFont,
        fontSize: mobile ? 17 : 22,
        lineHeight: 1.4,
        letterSpacing: 0.2,
        color: theme.ink,
        textAlign: 'center',
      }}
    >
      {tagline}
    </div>
  ) : null;

  // Brand hero with an ambient backdrop image.
  if (bgSrc) {
    return (
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          minHeight: mobile ? 320 : 420,
          background: theme.surfaceAlt,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
          }}
        >
          <img
            src={bgSrc}
            alt={module.background?.alt || ''}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </div>
        {/* Brand-tinted veil so the photo reads as an on-brand backdrop. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            background: `linear-gradient(180deg, ${withAlpha(
              theme.bg,
              0.74
            )} 0%, ${withAlpha(theme.bg, 0.86)} 100%)`,
          }}
        />
        {/* Accent flair bar across the top. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 5,
            display: 'flex',
            background: theme.accent,
          }}
        />
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: mobile ? '44px 28px' : '60px 0',
          }}
        >
          {logo}
          {accentRule}
          {taglineEl}
        </div>
      </div>
    );
  }

  // Fallback: tinted band (no backdrop) with a large logo.
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        background: theme.surfaceAlt,
        borderTop: `5px solid ${theme.accent}`,
        padding: mobile ? '40px 24px' : '56px 0',
      }}
    >
      {logo}
      {accentRule}
      {taglineEl}
    </div>
  );
}

/** Two side-by-side scenario panels (e.g. Hot vs Cold), each a labeled photo. */
function DesignedDualUse({
  module,
  ctx,
}: {
  module: Extract<APlusGeneratedModule, { type: 'dual-use-split' }>;
  ctx: Ctx;
}) {
  const { theme, mobile } = ctx;
  const height = mobile ? 300 : 380;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: mobile ? 'column' : 'row',
        width: '100%',
        background: theme.bg,
      }}
    >
      {module.panels.map((panel, i) => {
        const src = panel.image.image?.url;
        const caption = clean(panel.caption);
        return (
          <div
            key={i}
            style={{
              position: 'relative',
              display: 'flex',
              flex: 1,
              height,
              borderLeft: !mobile && i === 1 ? '2px solid #FFFFFF' : 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
              }}
            >
              {src ? (
                <img
                  src={src}
                  alt={panel.image.alt}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    width: '100%',
                    height: '100%',
                    background: theme.surfaceAlt,
                  }}
                />
              )}
            </div>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                background:
                  'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.05) 38%, rgba(0,0,0,0.05) 62%, rgba(0,0,0,0.6) 100%)',
              }}
            />
            <div
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                width: '100%',
                height: '100%',
                padding: mobile ? 20 : 26,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  style={{
                    width: 11,
                    height: 11,
                    marginRight: 9,
                    borderRadius: 11,
                    background: theme.accent,
                  }}
                />
                <div
                  style={{
                    fontFamily: theme.headingFont,
                    fontSize: mobile ? 18 : 20,
                    fontWeight: theme.headingWeight,
                    letterSpacing: 0.6,
                    textTransform: 'uppercase',
                    color: '#FFFFFF',
                  }}
                >
                  {clean(panel.label).toUpperCase()}
                </div>
              </div>
              {caption ? (
                <div
                  style={{
                    display: 'flex',
                    maxWidth: 380,
                    fontFamily: theme.bodyFont,
                    fontSize: mobile ? 13 : 14,
                    lineHeight: 1.45,
                    color: 'rgba(255,255,255,0.92)',
                  }}
                >
                  {caption}
                </div>
              ) : (
                <div style={{ display: 'flex' }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Designed (branded) render of one module — used by preview and PNG export. */
export function DesignedModule({
  module,
  theme,
  viewport = 'desktop',
}: {
  module: APlusGeneratedModule;
  theme: BrandTheme;
  viewport?: 'desktop' | 'mobile';
}) {
  const ctx: Ctx = { theme, mobile: viewport === 'mobile' };
  switch (module.type) {
    case 'company-logo':
      return <DesignedLogo module={module} ctx={ctx} />;
    case 'image-text-overlay':
      return <DesignedOverlayHero module={module} ctx={ctx} />;
    case 'image-header-with-text':
    case 'single-image-text':
    case 'image-and-text':
      return (
        <DesignedHero
          module={module as Parameters<typeof DesignedHero>[0]['module']}
          ctx={ctx}
        />
      );
    case 'three-image-text':
    case 'four-image-text-quadrant':
      return <DesignedColumns module={module} ctx={ctx} />;
    case 'comparison-table':
      return <DesignedComparison module={module} ctx={ctx} />;
    case 'tech-specs':
    case 'text-only':
      return <DesignedSpecsOrText module={module} ctx={ctx} />;
    case 'dual-use-split':
      return <DesignedDualUse module={module} ctx={ctx} />;
    default:
      return null;
  }
}
