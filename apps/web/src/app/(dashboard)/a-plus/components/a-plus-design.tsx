// Server-safe core: pure, inline-flex designed module components shared by the
// on-screen preview (a-plus-design-preview.tsx) and the PNG export route
// (next/og). No hooks, no client-only imports — images come from slot.image so
// this renders identically in the browser and in satori on the server.
import {
  applyAPlusGuardrails,
  type APlusGeneratedModule,
  type APlusImageSlot,
  type IconRowIcon,
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
  /** Logo width/height ratio, so the logo plate hugs the mark (no big margins). */
  logoAspect?: number;
  /** Brand-header treatment when an ambient backdrop is present. */
  heroVariant?: 'plate' | 'glass' | 'split' | 'overlay';
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
  // A branded "tag": accent fill, a fine inner ring, and tracked uppercase type
  // for a premium product-badge feel (vs a plain white pill).
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.accent,
        color: theme.accentInk,
        fontFamily: theme.headingFont,
        fontWeight: 800,
        fontSize: 18,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        lineHeight: 1,
        padding: '10px 16px',
        borderRadius: theme.radius,
        border: `1.5px solid ${withAlpha('#FFFFFF', 0.55)}`,
        boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
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
            {!mobile && carded ? (
              <div
                style={{ display: 'flex', height: 4, background: theme.accent }}
              />
            ) : null}
            <div
              style={{
                position: 'relative',
                display: 'flex',
                width: mobile ? 140 : '100%',
                borderRadius: carded ? 0 : theme.radius,
                overflow: 'hidden',
              }}
            >
              <Photo slot={cell.image} height={mobile ? 120 : imgH} />
              {/* Bold numbered step badge over the image. */}
              <div
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: mobile ? 28 : 34,
                  height: mobile ? 28 : 34,
                  borderRadius: 34,
                  background: theme.accent,
                  color: theme.accentInk,
                  fontFamily: theme.headingFont,
                  fontSize: mobile ? 14 : 16,
                  fontWeight: 800,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.22)',
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </div>
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
                    fontSize: mobile ? 18 : 19,
                    fontWeight: theme.headingWeight,
                    color: theme.ink,
                    letterSpacing: theme.headingTracking,
                    marginBottom: 7,
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

const COMPARISON_POSITIVE =
  /^(yes|included|✓|true|standard|always|full|both)\b/i;
const COMPARISON_NEGATIVE = /^(no|none|n\/a|n\.a\.|false|✗|never)\b/i;

/** Classify a comparison cell so we can swap text for a check/cross glyph. */
function comparisonGlyph(value: string): 'yes' | 'no' | null {
  const v = value.trim();
  if (!v) return null;
  if (v === '✓' || COMPARISON_POSITIVE.test(v)) return 'yes';
  if (
    v === '✗' ||
    v === '—' ||
    v === '–' ||
    v === '-' ||
    COMPARISON_NEGATIVE.test(v)
  )
    return 'no';
  return null;
}

/**
 * Small accent check / muted cross used in comparison cells. The glyphs are
 * DRAWN (rotated borders/bars), not typed — the bundled satori font has no
 * ✓/✗, so a unicode character would render as tofu in PNG export.
 */
function GlyphBadge({
  kind,
  theme,
}: {
  kind: 'yes' | 'no';
  theme: BrandTheme;
}) {
  const yes = kind === 'yes';
  const mark = yes ? theme.accentInk : theme.muted;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        borderRadius: 22,
        background: yes ? theme.accent : 'transparent',
        border: yes ? 'none' : `1.5px solid ${withAlpha(theme.muted, 0.4)}`,
      }}
    >
      {yes ? (
        <div
          style={{
            display: 'flex',
            width: 10,
            height: 5,
            marginTop: -2,
            borderLeft: `2.5px solid ${mark}`,
            borderBottom: `2.5px solid ${mark}`,
            transform: 'rotate(-45deg)',
          }}
        />
      ) : (
        // A muted dash for "no" — satori's rotate-origin handling makes a clean
        // X unreliable, and check-vs-dash reads clearly in a comparison table.
        <div
          style={{
            display: 'flex',
            width: 9,
            height: 2,
            borderRadius: 2,
            background: mark,
          }}
        />
      )}
    </div>
  );
}

/** Accent "VS" medallion shown between the two cards of a head-to-head table. */
function VsBadge({ theme }: { theme: BrandTheme }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        alignSelf: 'center',
        margin: '0 2px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 52,
          height: 52,
          borderRadius: 52,
          background: theme.accent,
          color: theme.accentInk,
          fontFamily: theme.headingFont,
          fontSize: 19,
          fontWeight: 800,
          letterSpacing: 0.5,
          boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
        }}
      >
        VS
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
  const { theme, mobile } = ctx;
  const ribbonH = 26;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        background: theme.bg,
        paddingBottom: 34,
      }}
    >
      <SectionTitle title={module.title} theme={theme} />
      <div
        style={{
          display: 'flex',
          flexDirection: mobile ? 'column' : 'row',
          alignItems: mobile ? 'stretch' : 'flex-start',
          padding: mobile ? '12px 22px 0' : '18px 30px 0',
        }}
      >
        {module.products.flatMap((product, pi) => {
          const highlight = !!product.highlight;
          const card = (
            <div
              key={pi}
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: mobile ? '0 1 auto' : 1,
                width: mobile ? '100%' : 'auto',
                margin: mobile
                  ? '0 0 12px 0'
                  : pi === 0
                  ? '0 7px 0 0'
                  : pi === module.products.length - 1
                  ? '0 0 0 7px'
                  : '0 7px',
                background: highlight ? theme.surface : theme.surfaceAlt,
                border: `${highlight ? 2 : 1}px solid ${
                  highlight ? theme.accent : theme.line
                }`,
                borderRadius: theme.radius * 1.4,
                overflow: 'hidden',
                boxShadow: highlight ? '0 16px 40px rgba(0,0,0,0.12)' : 'none',
              }}
            >
              {/* Ribbon — reserved on every card so headers stay aligned. */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: ribbonH,
                  background: highlight ? theme.accent : 'transparent',
                  color: highlight ? theme.accentInk : 'transparent',
                  fontFamily: theme.bodyFont,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 1.5,
                }}
              >
                {highlight ? 'RECOMMENDED' : ''}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '13px 14px',
                  background: highlight
                    ? withAlpha(theme.accent, 0.12)
                    : 'transparent',
                  fontFamily: theme.headingFont,
                  fontSize: 17,
                  fontWeight: 800,
                  color: theme.ink,
                  textAlign: 'center',
                }}
              >
                {clean(product.title)}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '4px 16px 16px',
                }}
              >
                {module.rows.map((row, ri) => {
                  const value = clean(row.values[pi] ?? '');
                  const glyph = comparisonGlyph(value);
                  return (
                    <div
                      key={ri}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '10px 0',
                        borderTop:
                          ri === 0 ? 'none' : `1px solid ${theme.line}`,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flex: 1,
                          fontFamily: theme.bodyFont,
                          fontSize: 12.5,
                          color: theme.muted,
                        }}
                      >
                        {row.label}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          minWidth: 24,
                        }}
                      >
                        {glyph ? (
                          <GlyphBadge kind={glyph} theme={theme} />
                        ) : (
                          <div
                            style={{
                              display: 'flex',
                              fontFamily: theme.bodyFont,
                              fontSize: 13,
                              fontWeight: highlight ? 700 : 600,
                              color: highlight ? theme.accent : theme.ink,
                              textAlign: 'right',
                            }}
                          >
                            {value}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
          // Head-to-head (exactly 2 products): drop a VS medallion between them.
          if (!mobile && module.products.length === 2 && pi === 0) {
            return [card, <VsBadge key="vs" theme={theme} />];
          }
          return [card];
        })}
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
  // Specs render as a framed card with zebra rows + accent labels across every
  // style — a polished, scannable spec sheet beats naked hairline rows. Padding
  // scales with density.
  const rowPadY =
    theme.density === 'airy' ? 16 : theme.density === 'tight' ? 11 : 13;
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
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 16,
            borderRadius: theme.radius * 1.5,
            border: `1px solid ${theme.line}`,
            overflow: 'hidden',
            boxShadow: '0 10px 30px rgba(0,0,0,0.05)',
          }}
        >
          {module.rows.map((row, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: mobile ? 'column' : 'row',
                alignItems: mobile ? 'flex-start' : 'center',
                padding: mobile ? '12px 18px' : `${rowPadY}px 24px`,
                background: i % 2 === 0 ? theme.surface : theme.surfaceAlt,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  width: mobile ? '100%' : 300,
                  marginBottom: mobile ? 2 : 0,
                  fontFamily: theme.bodyFont,
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: 0.2,
                  color: theme.accent,
                }}
              >
                {row.label}
              </div>
              <div
                style={{
                  display: 'flex',
                  flex: mobile ? '0 1 auto' : 1,
                  fontFamily: theme.bodyFont,
                  fontSize: 15,
                  color: theme.ink,
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
  const tagline = clean(module.tagline);

  // The logo is never AI-generated. Height-driven so the plate HUGS the mark:
  // when the aspect is known (PNG export) we set an exact width so there are no
  // dead margins; in the browser preview (aspect unknown) width:'auto' lets the
  // browser size it naturally. `maxW` caps very wide wordmarks.
  const renderLogo = (targetH: number, maxW: number) => {
    if (theme.logoUrl) {
      let w: number | undefined;
      let h = targetH;
      if (theme.logoAspect) {
        w = Math.round(targetH * theme.logoAspect);
        if (w > maxW) {
          w = maxW;
          h = Math.round(maxW / theme.logoAspect);
        }
      }
      return (
        <img
          src={theme.logoUrl}
          alt={theme.brandName || 'Brand logo'}
          width={w}
          height={h}
          style={{
            width: w ?? 'auto',
            height: h,
            maxWidth: maxW,
            objectFit: 'contain',
            display: 'block',
          }}
        />
      );
    }
    return theme.brandName ? (
      <div
        style={{
          display: 'flex',
          fontFamily: theme.headingFont,
          fontSize: mobile ? 30 : 46,
          fontWeight: theme.headingWeight,
          letterSpacing: 4,
          textTransform: 'uppercase',
          color: theme.ink,
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
  };

  // A lockup column — logo, accent rule, tagline — with alignment + sizing per use.
  const lockup = (o: {
    align: 'center' | 'flex-start';
    logoW: number;
    logoH: number;
    taglineColor: string;
    taglineAlign: 'center' | 'left';
    maxTaglineW: number;
  }) => (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: o.align }}
    >
      {renderLogo(o.logoH, o.logoW)}
      <div
        style={{
          width: 76,
          height: 3,
          marginTop: 24,
          borderRadius: 3,
          background: theme.accent,
        }}
      />
      {tagline ? (
        <div
          style={{
            display: 'flex',
            marginTop: 16,
            maxWidth: o.maxTaglineW,
            fontFamily: theme.headingFont,
            fontSize: mobile ? 17 : 22,
            lineHeight: 1.4,
            letterSpacing: 0.2,
            color: o.taglineColor,
            textAlign: o.taglineAlign,
          }}
        >
          {tagline}
        </div>
      ) : null}
    </div>
  );

  // Brand FOOTER: a clean, typographic closing band — thin accent rule, the
  // logo sitting directly on brand paper (no chip, no ornament), tagline in a
  // quiet tone beneath. Photographic backdrops read as murk at this size, so
  // the footer deliberately ignores any background slot on the module.
  if (module.placement === 'footer') {
    return (
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          minHeight: mobile ? 200 : 240,
          padding: mobile ? '40px 30px' : '52px 0',
          background: theme.bg,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            display: 'flex',
            background: theme.accent,
          }}
        />
        {renderLogo(mobile ? 88 : 108, mobile ? 260 : 340)}
        {tagline ? (
          <div
            style={{
              display: 'flex',
              marginTop: 18,
              maxWidth: 600,
              fontFamily: theme.headingFont,
              fontSize: mobile ? 15 : 19,
              lineHeight: 1.4,
              letterSpacing: 0.2,
              color: theme.muted,
              textAlign: 'center',
            }}
          >
            {tagline}
          </div>
        ) : null}
      </div>
    );
  }

  // Brand hero with an ambient backdrop — the AI picks the treatment per product
  // (module.heroVariant), so pages vary; theme/default only backstop it.
  if (bgSrc) {
    const variant = module.heroVariant ?? theme.heroVariant ?? 'overlay';

    // OVERLAY: editorial hero — headline + benefit subhead + divider + logo
    // lockup laid directly on a full-bleed lifestyle photo (matches premium A+
    // brand heroes). A left-weighted scrim keeps text legible on any photo.
    if (variant === 'overlay') {
      const headline = clean(module.headline) || theme.brandName || '';
      return (
        <div
          style={{
            position: 'relative',
            display: 'flex',
            width: '100%',
            minHeight: mobile ? 420 : 480,
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
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              background:
                'linear-gradient(90deg, rgba(0,0,0,0.66) 0%, rgba(0,0,0,0.42) 40%, rgba(0,0,0,0.06) 100%)',
            }}
          />
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
              justifyContent: 'center',
              alignItems: 'flex-start',
              width: '100%',
              padding: mobile ? '44px 32px' : '56px 64px',
            }}
          >
            {headline ? (
              <div
                style={{
                  display: 'flex',
                  maxWidth: mobile ? '100%' : 560,
                  fontFamily: theme.headingFont,
                  fontSize: mobile ? 34 : 50,
                  lineHeight: 1.08,
                  fontWeight: theme.headingWeight,
                  letterSpacing: theme.headingTracking,
                  textTransform: theme.headingCase,
                  color: '#FFFFFF',
                }}
              >
                {headline}
              </div>
            ) : null}
            {tagline ? (
              <div
                style={{
                  display: 'flex',
                  marginTop: 14,
                  maxWidth: mobile ? '100%' : 480,
                  fontFamily: theme.bodyFont,
                  fontSize: mobile ? 16 : 20,
                  lineHeight: 1.4,
                  color: 'rgba(255,255,255,0.92)',
                }}
              >
                {tagline}
              </div>
            ) : null}
          </div>
          {/* Brand bar anchored to a bottom corner (AI-chosen side) — not floating. */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              ...(module.logoCorner === 'bottom-right'
                ? { right: 0, borderTopLeftRadius: theme.radius * 2.6 }
                : { left: 0, borderTopRightRadius: theme.radius * 2.6 }),
              display: 'flex',
              alignItems: 'center',
              padding: mobile ? '12px 22px' : '14px 28px',
              background: `linear-gradient(135deg, #FFFFFF 0%, ${theme.surfaceAlt} 100%)`,
              borderTop: `4px solid ${theme.accent}`,
              boxShadow: '0 -6px 22px rgba(0,0,0,0.22)',
            }}
          >
            {renderLogo(mobile ? 42 : 50, mobile ? 200 : 240)}
          </div>
        </div>
      );
    }

    // SPLIT: lifestyle photo beside a solid brand panel (color-blocked, bold).
    if (variant === 'split') {
      return (
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: mobile ? 'column' : 'row',
            width: '100%',
            minHeight: mobile ? 0 : 440,
            background: theme.surface,
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'flex',
              width: mobile ? '100%' : '54%',
              minHeight: mobile ? 240 : 0,
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
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'flex-start',
              width: mobile ? '100%' : '46%',
              padding: mobile ? '34px 30px' : '48px 56px',
              background: theme.surface,
            }}
          >
            {lockup({
              align: 'flex-start',
              logoW: mobile ? 300 : 360,
              logoH: mobile ? 84 : 120,
              taglineColor: theme.ink,
              taglineAlign: 'left',
              maxTaglineW: 360,
            })}
          </div>
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
        </div>
      );
    }

    // PLATE (solid) / GLASS (translucent): full-bleed photo + centered card.
    const glass = variant === 'glass';
    return (
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          minHeight: mobile ? 360 : 460,
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
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.12) 42%, rgba(0,0,0,0.40) 100%)',
          }}
        />
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
            padding: mobile ? '30px 34px' : '40px 72px',
            borderRadius: theme.radius * 1.6,
            background: glass ? withAlpha('#FFFFFF', 0.7) : theme.surface,
            border: `1px solid ${
              glass ? withAlpha('#FFFFFF', 0.55) : withAlpha(theme.ink, 0.06)
            }`,
            boxShadow: '0 24px 60px rgba(0,0,0,0.34)',
          }}
        >
          {lockup({
            align: 'center',
            logoW: mobile ? 340 : 440,
            logoH: mobile ? 88 : 128,
            taglineColor: theme.ink,
            taglineAlign: 'center',
            maxTaglineW: 640,
          })}
        </div>
      </div>
    );
  }

  // Fallback (no AI backdrop): a large logo in a soft raised panel on a subtle
  // brand gradient, so the header reads as an intentional brand lockup rather
  // than an empty band. Satori-safe: flexbox + linear-gradient + boxShadow only.
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        background: `linear-gradient(160deg, ${
          theme.surfaceAlt
        } 0%, ${withAlpha(theme.accent, 0.1)} 100%)`,
        borderTop: `5px solid ${theme.accent}`,
        padding: mobile ? '36px 24px' : '48px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: mobile ? '28px 32px' : '40px 64px',
          borderRadius: theme.radius * 1.5,
          background: theme.surface,
          border: `1px solid ${theme.line}`,
          boxShadow: '0 18px 44px rgba(0,0,0,0.10)',
        }}
      >
        {lockup({
          align: 'center',
          logoW: mobile ? 340 : 500,
          logoH: mobile ? 104 : 168,
          taglineColor: theme.ink,
          taglineAlign: 'center',
          maxTaglineW: 640,
        })}
      </div>
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

/**
 * Generic lucide-style icon paths (stroke), drawn as inline <svg>. Inline SVG
 * renders both in the browser preview and in satori/next-og export.
 */
const ICON_PATHS: Record<IconRowIcon, string[]> = {
  coffee: [
    'M17 8h1a4 4 0 1 1 0 8h-1',
    'M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z',
    'M6 2v2',
    'M10 2v2',
    'M14 2v2',
  ],
  leaf: [
    'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z',
    'M2 21c0-3 1.85-5.36 5.08-6',
  ],
  shield: [
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
  ],
  zap: [
    'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
  ],
  heart: [
    'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
  ],
  star: [
    'M11.5 2.3a.5.5 0 0 1 1 0l2.6 5.3 5.8.8a.5.5 0 0 1 .3.9l-4.2 4 1 5.8a.5.5 0 0 1-.8.5L12 19l-5.2 2.7a.5.5 0 0 1-.7-.5l1-5.8-4.2-4a.5.5 0 0 1 .3-.9l5.8-.8z',
  ],
  package: [
    'M11 21.7a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7z',
    'M3.3 7 12 12l8.7-5',
    'M12 22V12',
  ],
  home: [
    'M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    'M9 21v-6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6',
  ],
  gift: [
    'M20 12v10H4V12',
    'M2 7h20v5H2z',
    'M12 22V7',
    'M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7Z',
    'M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z',
  ],
  sparkles: [
    'M9.9 15.5A2 2 0 0 0 8.5 14.1l-6.1-1.6a.5.5 0 0 1 0-1L8.5 9.9A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0L14.1 8.5A2 2 0 0 0 15.5 9.9l6.1 1.6a.5.5 0 0 1 0 1L15.5 14.1a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z',
  ],
  building: [
    'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z',
    'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2',
    'M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2',
    'M10 6h4',
    'M10 10h4',
    'M10 14h4',
  ],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    'M22 21v-2a4 4 0 0 0-3-3.9',
    'M16 3.1a4 4 0 0 1 0 7.8',
  ],
  check: ['M20 6 9 17l-5-5'],
  clock: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'M12 6v6l4 2'],
  droplet: [
    'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C4 11.1 3 13 3 15a7 7 0 0 0 7 7Z',
  ],
  thermometer: ['M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z'],
};

/** Map common/intuitive icon names the model emits to a supported glyph. */
const ICON_ALIASES: Record<string, IconRowIcon> = {
  mug: 'coffee',
  cup: 'coffee',
  espresso: 'coffee',
  latte: 'coffee',
  beverage: 'coffee',
  tea: 'droplet',
  drink: 'droplet',
  water: 'droplet',
  liquid: 'droplet',
  hydration: 'droplet',
  office: 'building',
  work: 'building',
  business: 'building',
  commercial: 'building',
  workplace: 'building',
  cafe: 'building',
  restaurant: 'building',
  event: 'users',
  events: 'users',
  party: 'users',
  people: 'users',
  community: 'users',
  group: 'users',
  team: 'users',
  family: 'users',
  social: 'users',
  calendar: 'clock',
  schedule: 'clock',
  time: 'clock',
  date: 'clock',
  duration: 'clock',
  timer: 'clock',
  eco: 'leaf',
  recycle: 'leaf',
  green: 'leaf',
  sustainable: 'leaf',
  plant: 'leaf',
  natural: 'leaf',
  biodegradable: 'leaf',
  compostable: 'leaf',
  organic: 'leaf',
  durable: 'shield',
  protect: 'shield',
  protection: 'shield',
  safe: 'shield',
  secure: 'shield',
  safety: 'shield',
  warranty: 'shield',
  guarantee: 'shield',
  sturdy: 'shield',
  fast: 'zap',
  power: 'zap',
  energy: 'zap',
  quick: 'zap',
  instant: 'zap',
  performance: 'zap',
  powerful: 'zap',
  quality: 'star',
  premium: 'star',
  award: 'star',
  best: 'star',
  rating: 'star',
  certified: 'star',
  excellence: 'star',
  trusted: 'star',
  love: 'heart',
  comfort: 'heart',
  care: 'heart',
  favorite: 'heart',
  comfortable: 'heart',
  cozy: 'heart',
  ship: 'package',
  shipping: 'package',
  delivery: 'package',
  box: 'package',
  bundle: 'package',
  kit: 'package',
  pack: 'package',
  value: 'package',
  bulk: 'package',
  thermal: 'thermometer',
  hot: 'thermometer',
  cold: 'thermometer',
  temperature: 'thermometer',
  insulated: 'thermometer',
  insulation: 'thermometer',
  heat: 'thermometer',
  house: 'home',
  household: 'home',
  domestic: 'home',
  present: 'gift',
  sparkle: 'sparkles',
  shine: 'sparkles',
  clean: 'sparkles',
  new: 'sparkles',
  fresh: 'sparkles',
  verified: 'check',
  yes: 'check',
  included: 'check',
  tick: 'check',
  done: 'check',
};

function resolveIcon(name: string): IconRowIcon {
  const k = name.trim().toLowerCase();
  if (k in ICON_PATHS) return k as IconRowIcon;
  return ICON_ALIASES[k] ?? 'check';
}

/** A horizontal strip of icon + label highlights (use cases / key benefits). */
function DesignedIconRow({
  module,
  ctx,
}: {
  module: Extract<APlusGeneratedModule, { type: 'icon-row' }>;
  ctx: Ctx;
}) {
  const { theme, mobile } = ctx;
  const iconSize = mobile ? 24 : 28;
  const circle = mobile ? 46 : 56;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        background: theme.bg,
        paddingBottom: mobile ? 22 : 28,
      }}
    >
      <SectionTitle title={module.title} theme={theme} />
      <div
        style={{
          display: 'flex',
          flexDirection: mobile ? 'column' : 'row',
          alignItems: 'stretch',
          justifyContent: 'center',
          padding: mobile ? '10px 24px 0' : '16px 30px 0',
        }}
      >
        {module.items.map((item, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              flexDirection: mobile ? 'row' : 'column',
              alignItems: 'center',
              justifyContent: mobile ? 'flex-start' : 'center',
              flex: 1,
              padding: mobile ? '12px 0' : '6px 10px',
              borderLeft: !mobile && i > 0 ? `1px solid ${theme.line}` : 'none',
              borderTop: mobile && i > 0 ? `1px solid ${theme.line}` : 'none',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: circle,
                height: circle,
                borderRadius: circle,
                background: theme.accentSoft,
                marginRight: mobile ? 14 : 0,
                marginBottom: mobile ? 0 : 12,
              }}
            >
              <svg
                width={iconSize}
                height={iconSize}
                viewBox="0 0 24 24"
                fill="none"
                stroke={theme.accent}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {ICON_PATHS[resolveIcon(item.icon)].map((d, j) => (
                  <path key={j} d={d} />
                ))}
              </svg>
            </div>
            <div
              style={{
                display: 'flex',
                fontFamily: theme.bodyFont,
                fontSize: mobile ? 15 : 14,
                fontWeight: 600,
                color: theme.ink,
                textAlign: 'center',
              }}
            >
              {clean(item.label)}
            </div>
          </div>
        ))}
      </div>
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
    case 'icon-row':
      return <DesignedIconRow module={module} ctx={ctx} />;
    default:
      return null;
  }
}
