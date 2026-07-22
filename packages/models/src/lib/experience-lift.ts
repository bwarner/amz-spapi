import type {
  APlusGeneratedModule,
  APlusImageSize,
  APlusImageSlot,
} from './aplus.js';
import type {
  ConversionJob,
  Experience,
  ExperienceImageSlot,
  ImageIntent,
  LayoutIntent,
  Section,
  VisualConcept,
} from './experience.js';
import { moduleKindForBeat, type NarrativeBeat } from './narrative.js';

// ---------------------------------------------------------------------------
// Lift: today's generated A+ package → an Experience (redesign §4 reuse
// mapping). This is the strangler-fig bridge: generation still produces
// modules; the editor lifts them into the format-agnostic model, edits there,
// and compiles back (aplus-compiler.ts). Deterministic, pure, never throws on
// well-typed modules.
// ---------------------------------------------------------------------------

export type LiftablePackage = {
  title: string;
  executiveSummary: string;
  creativeDirection: {
    positioning: string;
    visualSystem: string;
    mobilePrinciple: string;
    imagePlan: string;
  };
  modules: APlusGeneratedModule[];
};

function orientationFromSize(size: APlusImageSize): ImageIntent['orientation'] {
  if (size === '1792x1024') return 'landscape';
  if (size === '1024x1792') return 'portrait';
  return 'square';
}

/** Same keyword approach as the asset matcher's desiredAffordance(). */
function intentFromSlot(slot: APlusImageSlot): ImageIntent {
  const role = slot.role.toLowerCase();
  const background = role.includes('backdrop') || role.includes('background');
  const detail =
    role.includes('detail') || role.includes('macro') || role.includes('thumb');
  return {
    subject: background ? 'background' : detail ? 'detail' : 'product',
    mustShow: [],
    orientation: orientationFromSize(slot.size),
    productProminence: background ? 'soft' : 'hero',
  };
}

function liftSlot(slot: APlusImageSlot): ExperienceImageSlot {
  return {
    role: slot.role,
    intent: intentFromSlot(slot),
    source: { strategy: 'generate', brief: slot.brief },
    alt: slot.alt,
    resolved: slot.image,
  };
}

const DESKTOP_COMPOSITION = {
  aspect: '970:600',
  focalHierarchy: [],
  textZones: [],
};

function visualConcept(
  layout: LayoutIntent,
  slots: APlusImageSlot[]
): VisualConcept {
  return {
    medium: 'static',
    layout,
    desktop: { ...DESKTOP_COMPOSITION },
    images: slots.map(liftSlot),
  };
}

/** (job, section fields, visual) for one module. */
function liftModule(
  module: APlusGeneratedModule,
  isFirst: boolean
): Omit<Section, 'id' | 'order' | 'locked'> {
  const base = (
    job: ConversionJob,
    visual: VisualConcept,
    fields?: Partial<Pick<Section, 'headline' | 'subcopy' | 'bullets'>>
  ): Omit<Section, 'id' | 'order' | 'locked'> => ({
    job,
    intent: module.title,
    // The written module title is the short buyer-facing section label.
    label: module.title,
    visual,
    ...fields,
  });

  switch (module.type) {
    case 'company-logo': {
      const isFooter = module.placement === 'footer';
      const slots: APlusImageSlot[] = [
        module.logo,
        ...(module.background ? [module.background] : []),
      ];
      return base(
        isFooter ? 'brand' : 'hook',
        visualConcept(
          {
            archetype: 'brand-story-band',
            presentation: 'logo-band',
            placement: isFooter ? 'footer' : 'header',
            heroVariant: module.heroVariant,
            logoCorner: module.logoCorner,
          },
          slots
        ),
        { headline: module.headline, subcopy: module.tagline }
      );
    }
    case 'image-text-overlay':
      return base(
        isFirst ? 'hook' : 'benefit',
        visualConcept(
          {
            archetype: 'full-bleed-hero',
            overlayPosition: module.overlayPosition,
            badge: module.badge,
          },
          [module.image]
        ),
        { headline: module.headline, subcopy: module.body }
      );
    case 'image-header-with-text':
      return base(
        'benefit',
        visualConcept(
          { archetype: 'lifestyle-immersion', badge: module.badge },
          [module.image]
        ),
        { headline: module.headline, subcopy: module.body }
      );
    case 'single-image-text':
    case 'image-and-text':
      return base(
        'benefit',
        visualConcept(
          {
            archetype: 'split-LR',
            imagePosition:
              module.type === 'image-and-text'
                ? module.imagePosition
                : undefined,
            badge: module.badge,
          },
          [module.image]
        ),
        {
          headline: module.headline,
          subcopy: module.body,
          bullets: module.bullets,
        }
      );
    case 'three-image-text':
    case 'four-image-text-quadrant': {
      const cells =
        module.type === 'three-image-text' ? module.columns : module.quadrants;
      return base(
        module.type === 'three-image-text' ? 'benefit' : 'use-cases',
        visualConcept(
          {
            archetype: 'feature-grid',
            tiles: cells.map((cell) => ({
              headline: cell.headline,
              body: cell.body,
              imageRole: cell.image.role,
            })),
          },
          cells.map((cell) => cell.image)
        )
      );
    }
    case 'comparison-table':
      return base(
        'comparison',
        visualConcept(
          {
            archetype: 'comparison-table',
            columns: module.products.map((product) => ({
              title: product.title,
              highlight: product.highlight,
              imageRole: product.image?.role,
            })),
            rows: module.rows.map((row) => ({
              label: row.label,
              values: [...row.values],
            })),
          },
          module.products.flatMap((product) =>
            product.image ? [product.image] : []
          )
        )
      );
    case 'tech-specs':
      return base(
        'proof',
        visualConcept(
          {
            archetype: 'spec-sheet',
            rows: module.rows.map((row) => ({ ...row })),
          },
          []
        ),
        { headline: module.headline }
      );
    case 'text-only':
      return base(
        'brand',
        visualConcept(
          { archetype: 'brand-story-band', presentation: 'text-band' },
          []
        ),
        {
          headline: module.headline,
          subcopy: module.body,
          bullets: module.bullets,
        }
      );
    case 'dual-use-split':
      return base(
        'use-cases',
        visualConcept(
          {
            archetype: 'dual-use-split',
            panels: module.panels.map((panel) => ({
              label: panel.label,
              caption: panel.caption,
              imageRole: panel.image.role,
            })),
          },
          module.panels.map((panel) => panel.image)
        )
      );
    case 'icon-row':
      return base(
        'benefit',
        visualConcept(
          {
            archetype: 'icon-row',
            items: module.items.map((item) => ({ ...item })),
          },
          []
        )
      );
    case 'qna':
      return base(
        'proof',
        visualConcept(
          {
            archetype: 'qna',
            items: module.items.map((item) => ({ ...item })),
          },
          []
        ),
        { headline: module.headline }
      );
    case 'hotspots':
      return base(
        'how-it-works',
        visualConcept(
          {
            archetype: 'hotspots',
            baseImageRole: module.image.role,
            hotspots: module.hotspots.map((spot) => ({
              position: { ...spot.position },
              label: spot.label,
              copy: spot.copy,
            })),
          },
          [module.image]
        ),
        { headline: module.headline }
      );
    case 'carousel':
      return base(
        'use-cases',
        visualConcept(
          {
            archetype: 'carousel',
            slides: module.slides.map((slide) => ({
              imageRole: slide.image.role,
              headline: slide.headline,
              caption: slide.caption,
            })),
          },
          module.slides.map((slide) => slide.image)
        )
      );
  }
}

/**
 * Lifts one module into a Section. When a narrative `beat` is provided (the
 * Narrative Engine planned this section), the beat's job and intent OVERRIDE
 * the kind-based inference — the arc is chosen by strategy, not layouts. The
 * only archetype re-tag is the shape-compatible problem-solution case (it
 * writes as image-header-with-text, which otherwise lifts to
 * lifestyle-immersion).
 */
export function liftModuleToSection(
  module: APlusGeneratedModule,
  opts: {
    id: string;
    order: number;
    beat?: NarrativeBeat;
    locked?: boolean;
    notes?: string;
    isFirst?: boolean;
  }
): Section {
  const section: Section = {
    id: opts.id,
    order: opts.order,
    locked: opts.locked ?? false,
    notes: opts.notes,
    ...liftModule(module, opts.isFirst ?? false),
  };
  const beat = opts.beat;
  // A beat only applies to the module KIND it planned — this keeps
  // beats-by-order from mislabeling e.g. the auto-appended brand footer when
  // some planned sections failed to write.
  if (!beat || moduleKindForBeat(beat) !== module.type) return section;

  section.job = beat.job;
  section.intent = beat.intent;
  const layout = section.visual.layout;
  if (
    beat.archetype === 'problem-solution' &&
    layout.archetype === 'lifestyle-immersion'
  ) {
    section.visual.layout = {
      archetype: 'problem-solution',
      badge: layout.badge,
    };
  }
  return section;
}

/**
 * Lifts a generated A+ package into an Experience (deterministic section ids,
 * order preserved). `resolved` images and briefs survive so a subsequent
 * compile reproduces the package losslessly. `opts.beats` (matched to modules
 * by module.order) carries the planned narrative into the sections; modules
 * without a beat — e.g. the auto-appended brand footer — keep the inference.
 */
export function liftGeneratedPackageToExperience(
  pkg: LiftablePackage,
  opts?: {
    id?: string;
    productId?: string;
    goal?: string;
    beats?: NarrativeBeat[];
  }
): Experience {
  const ordered = [...pkg.modules].sort((a, b) => a.order - b.order);
  const beatByOrder = new Map(
    (opts?.beats ?? []).map((beat) => [beat.order, beat] as const)
  );
  const sections: Section[] = ordered.map((module, index) =>
    liftModuleToSection(module, {
      id: `section-${index + 1}`,
      order: index + 1,
      beat: beatByOrder.get(module.order),
      isFirst: index === 0,
    })
  );

  return {
    id: opts?.id ?? 'experience-1',
    productId: opts?.productId,
    title: pkg.title,
    goal: opts?.goal ?? pkg.executiveSummary,
    artDirection: { ...pkg.creativeDirection },
    sections,
    status: 'draft',
  };
}
