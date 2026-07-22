import {
  moduleImageSlotEntries,
  type APlusGeneratedModule,
  type APlusImageSize,
  type APlusImageSlot,
} from './aplus.js';
import {
  APLUS_SLICE_CONSTANTS,
  type AplusDeployment,
  type AplusTier,
  type DeploymentValidation,
  type Experience,
  type ExperienceImageSlot,
  type ModuleImageSpec,
  type ModuleMappingEntry,
  type Section,
  type SliceSpec,
} from './experience.js';

// ---------------------------------------------------------------------------
// A+ Deployment Compiler (redesign §7): Experience → Amazon Standard A+
// modules. Structured sections compile to NATIVE modules (real fields, no
// pixels — decided in the doc); image sections compile to designed-image
// modules; tall scenes become image-slice-stacks (one Amazon module per
// slice). Pure and framework-free so it can run in the browser (live
// recompiles on edit/reorder) and on the server. Never throws — problems are
// reported through Deployment.validation.
// ---------------------------------------------------------------------------

/**
 * Quantizes a scene height UP to the slice grid and plans the stack: greedy
 * tall (600px) slices with a single short (300px) remainder. Internal cuts are
 * flagged seam-safe (no focal element within seamSafePx of the cut).
 */
export function planSliceStack(
  sceneHeightPx: number,
  constants: {
    sliceUnitPx: number;
    tallSlicePx: number;
  } = APLUS_SLICE_CONSTANTS
): SliceSpec[] {
  const unit = constants.sliceUnitPx;
  const tall = constants.tallSlicePx;
  const total = Math.max(unit, Math.ceil(sceneHeightPx / unit) * unit);

  const heights: Array<300 | 600> = [];
  let remaining = total;
  while (remaining > 0) {
    if (remaining >= tall) {
      heights.push(600);
      remaining -= tall;
    } else {
      heights.push(300);
      remaining -= unit;
    }
  }

  let offsetY = 0;
  return heights.map((height, index) => {
    const slice: SliceSpec = {
      index,
      offsetY,
      height,
      seamSafeTop: index > 0,
      seamSafeBottom: index < heights.length - 1,
    };
    offsetY += height;
    return slice;
  });
}

/**
 * Height quantum for a section's designed scene, in 300px units. Structured
 * sections return 0 (they deploy as native modules, not images).
 */
export function sectionSliceUnits(section: Section): number {
  const layout = section.visual.layout;
  switch (layout.archetype) {
    case 'comparison-table':
    case 'spec-sheet':
    case 'qna':
      return 0;
    case 'icon-row':
    case 'stat-band':
      return 1;
    case 'brand-story-band':
      return layout.placement === 'footer' ? 1 : 2;
    case 'lifestyle-immersion':
      return (section.bullets?.length ?? 0) > 3 ? 4 : 2;
    default:
      return 2;
  }
}

function sizeFromOrientation(
  orientation: 'portrait' | 'landscape' | 'square'
): APlusImageSize {
  if (orientation === 'landscape') return '1792x1024';
  if (orientation === 'portrait') return '1024x1792';
  return '1024x1024';
}

function toModuleSlot(slot: ExperienceImageSlot): APlusImageSlot {
  return {
    role: slot.role,
    brief: slot.source.brief?.trim() || `Photograph for ${slot.role}`,
    size: sizeFromOrientation(slot.intent.orientation),
    alt: slot.alt.trim() || slot.role,
    image: slot.resolved,
  };
}

/** Slot by role, else a synthesized default (compile never throws). */
function slotByRole(
  section: Section,
  role: string | undefined,
  fallbackRole: string
): APlusImageSlot {
  const slots = section.visual.images;
  const match = role ? slots.find((slot) => slot.role === role) : undefined;
  if (match) return toModuleSlot(match);
  if (!role && slots[0]) return toModuleSlot(slots[0]);
  return {
    role: role ?? fallbackRole,
    brief: `Photograph for ${role ?? fallbackRole}`,
    size: '1792x1024',
    alt: role ?? fallbackRole,
  };
}

function firstSlot(section: Section, fallbackRole: string): APlusImageSlot {
  return slotByRole(section, section.visual.images[0]?.role, fallbackRole);
}

/** Module kind → the Amazon Seller Central type it deploys as. */
export const KIND_TO_AMAZON: Record<string, string> = {
  'company-logo': 'STANDARD_COMPANY_LOGO',
  'image-text-overlay': 'STANDARD_IMAGE_TEXT_OVERLAY',
  'image-header-with-text': 'STANDARD_HEADER_IMAGE_TEXT',
  'single-image-text': 'STANDARD_SINGLE_IMAGE_HIGHLIGHTS',
  'image-and-text': 'STANDARD_SINGLE_SIDE_IMAGE',
  'three-image-text': 'STANDARD_THREE_IMAGE_TEXT',
  'four-image-text-quadrant': 'STANDARD_FOUR_IMAGE_TEXT_QUADRANT',
  'comparison-table': 'STANDARD_COMPARISON_TABLE',
  'tech-specs': 'STANDARD_TECH_SPECS',
  'text-only': 'STANDARD_PRODUCT_DESCRIPTION',
  'dual-use-split': 'STANDARD_HEADER_IMAGE_TEXT',
  'icon-row': 'STANDARD_HEADER_IMAGE_TEXT',
};

/**
 * Module kind → Premium A+ (EBC) deployment target — NATIVE-FIRST: premium
 * image+text modules carry real text fields, so copy goes into Amazon's fields
 * (accessible, editable in Seller Central) and images ship as raw photos
 * cover-cropped to exact slot dims. Baked-text designed PNGs remain only where
 * no native module fits (icon-row, sliced scenes → PREMIUM_FULL_IMAGE).
 * Identifiers are app-invented (the SP-API A+ API is STANDARD-only; Premium is
 * built manually) — sellerCentralModuleName() carries the seller-facing names.
 */
export const KIND_TO_PREMIUM: Record<string, string> = {
  'company-logo': 'PREMIUM_BACKGROUND_IMAGE_TEXT',
  'image-text-overlay': 'PREMIUM_BACKGROUND_IMAGE_TEXT',
  'image-header-with-text': 'PREMIUM_BACKGROUND_IMAGE_TEXT',
  'single-image-text': 'PREMIUM_SINGLE_IMAGE_TEXT',
  'image-and-text': 'PREMIUM_SINGLE_IMAGE_TEXT',
  'three-image-text': 'PREMIUM_FOUR_IMAGES_TEXT',
  'four-image-text-quadrant': 'PREMIUM_FOUR_IMAGES_TEXT',
  'comparison-table': 'PREMIUM_COMPARISON_TABLE_1',
  'tech-specs': 'PREMIUM_TECH_SPECS',
  'text-only': 'PREMIUM_TEXT',
  'dual-use-split': 'PREMIUM_DUAL_IMAGES_TEXT',
  'icon-row': 'PREMIUM_FULL_IMAGE',
  qna: 'PREMIUM_QA',
  hotspots: 'PREMIUM_HOTSPOTS_1',
  carousel: 'PREMIUM_SIMPLE_IMAGE_CAROUSEL',
};

/** The Amazon module type a kind deploys as on the given tier. */
export function amazonModuleTypeForKind(kind: string, tier: AplusTier): string {
  if (tier === 'Premium A+') {
    return KIND_TO_PREMIUM[kind] ?? KIND_TO_AMAZON[kind] ?? 'PREMIUM_TEXT';
  }
  return KIND_TO_AMAZON[kind] ?? 'STANDARD_HEADER_IMAGE_TEXT';
}

/**
 * Exact image upload dimensions per Premium module type (web-researched
 * 2026-07 — VERIFY every value against the live Premium A+ Content Manager).
 * Full-width bands take a separate 600×450 mobile upload; inset images reflow.
 */
export const PREMIUM_IMAGE_SPECS: Record<
  string,
  Omit<ModuleImageSpec, 'role'>
> = {
  PREMIUM_BACKGROUND_IMAGE_TEXT: {
    width: 1464,
    height: 600,
    mobileWidth: 600,
    mobileHeight: 450,
  },
  PREMIUM_FULL_IMAGE: {
    width: 1464,
    height: 600,
    mobileWidth: 600,
    mobileHeight: 450,
  },
  PREMIUM_HOTSPOTS_1: {
    width: 1464,
    height: 600,
    mobileWidth: 600,
    mobileHeight: 450,
  },
  PREMIUM_SIMPLE_IMAGE_CAROUSEL: {
    width: 1464,
    height: 600,
    mobileWidth: 600,
    mobileHeight: 450,
  },
  PREMIUM_SINGLE_IMAGE_TEXT: { width: 800, height: 600 },
  PREMIUM_DUAL_IMAGES_TEXT: { width: 650, height: 350 },
  PREMIUM_FOUR_IMAGES_TEXT: { width: 600, height: 450 },
  PREMIUM_COMPARISON_TABLE_1: { width: 300, height: 300 },
};

/** Per-slot exact upload dims for a premium-deployed module (else undefined). */
function premiumImageSpecs(
  module: APlusGeneratedModule,
  amazonModuleType: string
): ModuleImageSpec[] | undefined {
  const spec = PREMIUM_IMAGE_SPECS[amazonModuleType];
  if (!spec) return undefined;
  const entries = moduleImageSlotEntries(module);
  if (!entries.length) return undefined;
  return entries.map(({ slot }) => ({ role: slot.role, ...spec }));
}

type CompiledSection = {
  module: APlusGeneratedModule;
  mappingKind: ModuleMappingEntry['kind'];
  warnings: DeploymentValidation[];
};

function compileSection(section: Section, tier: AplusTier): CompiledSection {
  const premium = tier === 'Premium A+';
  const layout = section.visual.layout;
  // NEVER the intent — that's planner instruction-prose, not display copy.
  const title =
    section.label?.slice(0, 120) ||
    section.headline?.slice(0, 120) ||
    `Section ${section.order}`;
  // order is re-assigned by the caller; 0 is a placeholder.
  const common = { order: 0, title };
  const warn = (code: string, message: string): DeploymentValidation => ({
    level: 'warning',
    code,
    message,
    sectionId: section.id,
  });

  switch (layout.archetype) {
    case 'brand-story-band': {
      if (layout.presentation === 'text-band') {
        return {
          mappingKind: 'native',
          warnings: [],
          module: {
            ...common,
            amazonModuleType: KIND_TO_AMAZON['text-only'],
            type: 'text-only',
            headline: section.headline,
            body: section.subcopy ?? '',
            bullets: section.bullets,
          },
        };
      }
      const slots = section.visual.images;
      const logoSlot =
        slots.find((slot) => slot.role.toLowerCase().includes('logo')) ??
        slots[0];
      const backgroundSlot =
        slots.find(
          (slot) =>
            slot !== logoSlot &&
            /backdrop|background/.test(slot.role.toLowerCase())
        ) ?? slots.find((slot) => slot !== logoSlot);
      return {
        mappingKind: 'designed-image',
        warnings: [],
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['company-logo'],
          type: 'company-logo',
          logo: logoSlot
            ? toModuleSlot(logoSlot)
            : {
                role: 'logo',
                brief: 'Brand logo (seller-supplied, never generated).',
                size: '1024x1024',
                alt: 'Brand logo',
              },
          headline: section.headline,
          tagline: section.subcopy?.slice(0, 120),
          background: backgroundSlot ? toModuleSlot(backgroundSlot) : undefined,
          placement: layout.placement,
          heroVariant: layout.heroVariant,
          logoCorner: layout.logoCorner,
        },
      };
    }
    case 'full-bleed-hero':
      return {
        mappingKind: 'designed-image',
        warnings: [],
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['image-text-overlay'],
          type: 'image-text-overlay',
          image: firstSlot(section, 'hero'),
          headline: section.headline,
          body: section.subcopy?.slice(0, 800),
          overlayPosition: layout.overlayPosition,
          badge: layout.badge,
        },
      };
    case 'lifestyle-immersion':
    case 'problem-solution':
      return {
        mappingKind: 'designed-image',
        warnings: [],
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['image-header-with-text'],
          type: 'image-header-with-text',
          image: firstSlot(section, 'hero'),
          headline: section.headline,
          body: section.subcopy?.slice(0, 800),
          badge: layout.badge,
        },
      };
    case 'split-LR': {
      if (layout.imagePosition) {
        return {
          mappingKind: 'designed-image',
          warnings: [],
          module: {
            ...common,
            amazonModuleType: KIND_TO_AMAZON['image-and-text'],
            type: 'image-and-text',
            image: firstSlot(section, 'feature'),
            imagePosition: layout.imagePosition,
            headline: section.headline,
            body: section.subcopy?.slice(0, 800),
            bullets: section.bullets,
            badge: layout.badge,
          },
        };
      }
      return {
        mappingKind: 'designed-image',
        warnings: [],
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['single-image-text'],
          type: 'single-image-text',
          image: firstSlot(section, 'feature'),
          headline: section.headline,
          body: section.subcopy?.slice(0, 800),
          bullets: section.bullets,
          badge: layout.badge,
        },
      };
    }
    case 'feature-grid': {
      const warnings: DeploymentValidation[] = [];
      const cellFor = (tile: (typeof layout.tiles)[number]) => ({
        image: slotByRole(section, tile.imageRole, tile.imageRole),
        headline: tile.headline,
        body: tile.body,
      });
      if (layout.tiles.length >= 4) {
        if (layout.tiles.length > 4) {
          warnings.push(
            warn(
              'tiles-truncated',
              `Feature grid has ${layout.tiles.length} tiles; Standard A+ shows 4.`
            )
          );
        }
        return {
          mappingKind: 'designed-image',
          warnings,
          module: {
            ...common,
            amazonModuleType: KIND_TO_AMAZON['four-image-text-quadrant'],
            type: 'four-image-text-quadrant',
            quadrants: [
              cellFor(layout.tiles[0]),
              cellFor(layout.tiles[1]),
              cellFor(layout.tiles[2]),
              cellFor(layout.tiles[3]),
            ],
          },
        };
      }
      return {
        mappingKind: 'designed-image',
        warnings,
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['three-image-text'],
          type: 'three-image-text',
          columns: [
            cellFor(layout.tiles[0]),
            cellFor(layout.tiles[1]),
            cellFor(layout.tiles[2]),
          ],
        },
      };
    }
    case 'icon-row':
      return {
        mappingKind: 'designed-image',
        warnings: [],
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['icon-row'],
          type: 'icon-row',
          items: layout.items.map((item) => ({ ...item })),
        },
      };
    case 'dual-use-split':
      return {
        mappingKind: 'designed-image',
        warnings: [],
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['dual-use-split'],
          type: 'dual-use-split',
          panels: [
            {
              image: slotByRole(section, layout.panels[0].imageRole, 'panel-1'),
              label: layout.panels[0].label,
              caption: layout.panels[0].caption,
            },
            {
              image: slotByRole(section, layout.panels[1].imageRole, 'panel-2'),
              label: layout.panels[1].label,
              caption: layout.panels[1].caption,
            },
          ],
        },
      };
    case 'comparison-table':
      return {
        mappingKind: 'native',
        warnings: [],
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['comparison-table'],
          type: 'comparison-table',
          products: layout.columns.map((column) => ({
            title: column.title,
            highlight: column.highlight,
            image: column.imageRole
              ? slotByRole(section, column.imageRole, column.imageRole)
              : undefined,
          })),
          rows: layout.rows.map((row) => ({
            label: row.label,
            values: [...row.values],
          })),
        },
      };
    case 'spec-sheet':
      return {
        mappingKind: 'native',
        warnings: [],
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['tech-specs'],
          type: 'tech-specs',
          headline: section.headline,
          rows: layout.rows.map((row) => ({ ...row })),
        },
      };
    case 'qna': {
      if (premium) {
        // Premium Q&A is native — clamp to its field limits (VERIFY).
        return {
          mappingKind: 'native',
          warnings: [],
          module: {
            ...common,
            amazonModuleType: KIND_TO_PREMIUM['qna'],
            type: 'qna',
            headline: section.headline,
            items: layout.items.slice(0, 5).map((item) => ({
              question: item.question.slice(0, 120),
              answer: item.answer.slice(0, 800),
            })),
          },
        };
      }
      // Standard A+ has no native Q&A — degrade to a text module (doc).
      const body = layout.items
        .map((item) => `Q: ${item.question}\nA: ${item.answer}`)
        .join('\n\n')
        .slice(0, 1200);
      return {
        mappingKind: 'native',
        warnings: [
          warn(
            'qna-degraded',
            'Q&A is not native on Standard A+; compiled to a text module.'
          ),
        ],
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['text-only'],
          type: 'text-only',
          headline: section.headline ?? 'Questions & answers',
          body,
        },
      };
    }
    case 'stat-band':
      return {
        mappingKind: 'native',
        warnings: [
          warn(
            'stat-band-text-fallback',
            'Stat band has no designed renderer yet; compiled to a text module.'
          ),
        ],
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['text-only'],
          type: 'text-only',
          headline: section.headline,
          body: section.subcopy ?? '',
          bullets: layout.stats
            .slice(0, 6)
            .map((stat) => `${stat.value} — ${stat.label}`.slice(0, 160)),
        },
      };
    case 'hotspots':
      if (premium) {
        // Premium Hotspots: raw base photo + native callouts (VERIFY limits).
        return {
          mappingKind: 'native',
          warnings: [],
          module: {
            ...common,
            amazonModuleType: KIND_TO_PREMIUM['hotspots'],
            type: 'hotspots',
            headline: section.headline,
            image: slotByRole(section, layout.baseImageRole, 'hotspot-base'),
            hotspots: layout.hotspots.slice(0, 6).map((spot) => ({
              position: { ...spot.position },
              label: spot.label.slice(0, 50),
              copy: spot.copy.slice(0, 200),
            })),
          },
        };
      }
      return {
        mappingKind: 'designed-image',
        warnings: [
          warn(
            'hotspots-degraded',
            'Hotspots are Premium A+ native; compiled to an annotated static image.'
          ),
        ],
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['single-image-text'],
          type: 'single-image-text',
          image: slotByRole(section, layout.baseImageRole, 'hotspot-base'),
          headline: section.headline,
          body: section.subcopy?.slice(0, 800),
          bullets: layout.hotspots
            .slice(0, 6)
            .map((spot) => `${spot.label}: ${spot.copy}`.slice(0, 160)),
        },
      };
    case 'video':
      return {
        mappingKind: 'designed-image',
        warnings: [
          warn(
            'video-degraded',
            'Video is Premium A+/Listing native; compiled to the poster frame.'
          ),
        ],
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['image-header-with-text'],
          type: 'image-header-with-text',
          image: slotByRole(section, layout.posterFrameRole, 'poster-frame'),
          headline: section.headline,
          body: section.subcopy?.slice(0, 800),
        },
      };
    case 'carousel': {
      if (premium) {
        // Premium Simple Image Carousel: 2–6 native slides (VERIFY limits).
        return {
          mappingKind: 'native',
          warnings: [],
          module: {
            ...common,
            amazonModuleType: KIND_TO_PREMIUM['carousel'],
            type: 'carousel',
            slides: layout.slides.slice(0, 6).map((slide) => ({
              image: slotByRole(section, slide.imageRole, slide.imageRole),
              headline: slide.headline?.slice(0, 100),
              caption: slide.caption?.slice(0, 200),
            })),
          },
        };
      }
      const roles = layout.slides.map((slide) => slide.imageRole).slice(0, 3);
      while (roles.length < 3) roles.push(roles[roles.length - 1] ?? 'tile');
      return {
        mappingKind: 'designed-image',
        warnings: [
          warn(
            'carousel-degraded',
            'Carousel is Premium A+ native; compiled to a three-image row.'
          ),
        ],
        module: {
          ...common,
          amazonModuleType: KIND_TO_AMAZON['three-image-text'],
          type: 'three-image-text',
          columns: roles.map((role) => ({
            image: slotByRole(section, role, role),
          })),
        },
      };
    }
  }
}

/**
 * Compiles an Experience to an A+ deployment for the given tier. Premium is
 * NATIVE-FIRST: every kind with a premium native counterpart deploys as that
 * module (real text fields, exact-dim raw photos); only PREMIUM_FULL_IMAGE
 * bands (icon-row, sliced scenes) remain designed images.
 */
export function compileExperienceToAplus(
  experience: Experience,
  opts: { tier: AplusTier }
): AplusDeployment {
  const premium = opts.tier === 'Premium A+';
  const validation: DeploymentValidation[] = [];
  const modules: APlusGeneratedModule[] = [];
  const moduleMapping: ModuleMappingEntry[] = [];

  const ordered = [...experience.sections].sort((a, b) => a.order - b.order);
  for (const section of ordered) {
    const compiled = compileSection(section, opts.tier);
    validation.push(...compiled.warnings);

    let mappingKind = compiled.mappingKind;
    let amazonModuleType = compiled.module.amazonModuleType;
    if (premium) {
      amazonModuleType = amazonModuleTypeForKind(
        compiled.module.type,
        opts.tier
      );
      // Native-first: only full-image bands keep baked-text designed pixels.
      mappingKind =
        amazonModuleType === 'PREMIUM_FULL_IMAGE' ? 'designed-image' : 'native';
    }

    const order = modules.length + 1;
    const module = { ...compiled.module, order, amazonModuleType };
    modules.push(module);

    const units = sectionSliceUnits(section);
    const isSliceStack = mappingKind === 'designed-image' && units > 2;
    moduleMapping.push({
      order,
      amazonModuleType: isSliceStack
        ? premium
          ? 'PREMIUM_FULL_IMAGE'
          : 'STANDARD_HEADER_IMAGE_TEXT'
        : amazonModuleType,
      sectionIds: [section.id],
      kind: isSliceStack ? 'image-slice-stack' : mappingKind,
      slices: isSliceStack
        ? planSliceStack(
            // Scene heights are measured in 300px quanta regardless of tier;
            // the premium grid just cuts them into all-600 slices.
            units * APLUS_SLICE_CONSTANTS.sliceUnitPx,
            premium ? APLUS_SLICE_CONSTANTS.premium : APLUS_SLICE_CONSTANTS
          )
        : undefined,
      imageSpecs: premium
        ? premiumImageSpecs(
            module,
            isSliceStack ? 'PREMIUM_FULL_IMAGE' : amazonModuleType
          )
        : undefined,
    });
  }

  const budget =
    opts.tier === 'Premium A+'
      ? APLUS_SLICE_CONSTANTS.moduleBudget.premium
      : APLUS_SLICE_CONSTANTS.moduleBudget.basic;
  const spent = moduleMapping.reduce(
    (sum, entry) => sum + (entry.slices?.length ?? 1),
    0
  );
  if (spent > budget) {
    const trimCandidates = ordered
      .filter((section) => !section.locked)
      .slice(-2)
      .map((section) => section.id)
      .join(', ');
    validation.push({
      level: 'error',
      code: 'over-budget',
      message: `Deployment needs ${spent} Amazon modules but ${opts.tier} allows ${budget}. Remove or merge lower-leverage sections (e.g. ${trimCandidates}).`,
    });
  }

  return {
    experienceId: experience.id,
    format: premium ? 'premium-aplus' : 'aplus',
    modules,
    moduleMapping,
    validation,
  };
}
