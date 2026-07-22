import type { APlusGeneratedModule } from './aplus';
import type { Experience, Section } from './experience';
import { liftModuleToSection } from './experience-lift';
import {
  IMMERSIVE_ARCHETYPES,
  PREMIUM_PLANNABLE_ARCHETYPES,
  NarrativeBeatSchema,
  beatsFromExperience,
  fallbackNarrativeBeats,
  isImmersiveArchetype,
  moduleKindForBeat,
  sanitizeNarrativeBeats,
  type NarrativeBeat,
} from './narrative';

const slot = (role: string) => ({
  role,
  brief: `Editorial photo for ${role}.`,
  size: '1792x1024' as const,
  alt: `${role} image`,
});

const beat = (
  order: number,
  job: NarrativeBeat['job'],
  archetype: NarrativeBeat['archetype'],
  intent = `Beat ${order}`
): NarrativeBeat => ({ order, job, archetype, intent, assetsToUse: [] });

/** A minimal writable module of the given kind (order/title placeholders). */
function minimalModule(kind: string): APlusGeneratedModule {
  const common = { order: 1, amazonModuleType: 'X', title: 'T' };
  switch (kind) {
    case 'company-logo':
      return { ...common, type: 'company-logo', logo: slot('logo') };
    case 'image-text-overlay':
      return { ...common, type: 'image-text-overlay', image: slot('hero') };
    case 'image-header-with-text':
      return { ...common, type: 'image-header-with-text', image: slot('hero') };
    case 'image-and-text':
      return {
        ...common,
        type: 'image-and-text',
        image: slot('side'),
        imagePosition: 'left',
      };
    case 'three-image-text':
      return {
        ...common,
        type: 'three-image-text',
        columns: [
          { image: slot('c1') },
          { image: slot('c2') },
          { image: slot('c3') },
        ],
      };
    case 'four-image-text-quadrant':
      return {
        ...common,
        type: 'four-image-text-quadrant',
        quadrants: [
          { image: slot('q1') },
          { image: slot('q2') },
          { image: slot('q3') },
          { image: slot('q4') },
        ],
      };
    case 'comparison-table':
      return {
        ...common,
        type: 'comparison-table',
        products: [{ title: 'Ours' }, { title: 'Theirs' }],
        rows: [{ label: 'Material', values: ['Kraft', 'Plastic'] }],
      };
    case 'tech-specs':
      return {
        ...common,
        type: 'tech-specs',
        rows: [{ label: 'Weight', value: '120 g' }],
      };
    case 'text-only':
      return { ...common, type: 'text-only', body: 'Body.' };
    case 'dual-use-split':
      return {
        ...common,
        type: 'dual-use-split',
        panels: [
          { image: slot('hot'), label: 'HOT' },
          { image: slot('cold'), label: 'COLD' },
        ],
      };
    case 'icon-row':
      return {
        ...common,
        type: 'icon-row',
        items: [
          { icon: 'coffee', label: 'Hot' },
          { icon: 'droplet', label: 'Cold' },
        ],
      };
    case 'qna':
      return {
        ...common,
        type: 'qna',
        items: [{ question: 'Leak-proof?', answer: 'Yes — sealed rims.' }],
      };
    case 'hotspots':
      return {
        ...common,
        type: 'hotspots',
        image: slot('hotspot-base'),
        hotspots: [
          { position: { x: 0.5, y: 0.4 }, label: 'Lid', copy: 'Snug fit.' },
        ],
      };
    case 'carousel':
      return {
        ...common,
        type: 'carousel',
        slides: [
          { image: slot('s1'), headline: 'Morning' },
          { image: slot('s2'), caption: 'Refill.' },
        ],
      };
    default:
      throw new Error(`no minimal module for kind ${kind}`);
  }
}

describe('NarrativeBeatSchema', () => {
  it('parses a beat and defaults assetsToUse', () => {
    const parsed = NarrativeBeatSchema.parse({
      order: 1,
      job: 'hook',
      archetype: 'full-bleed-hero',
      intent: 'Open strong.',
    });
    expect(parsed.assetsToUse).toEqual([]);
  });

  it('rejects archetypes no tier can plan', () => {
    for (const archetype of ['stat-band', 'video']) {
      expect(
        NarrativeBeatSchema.safeParse({
          order: 1,
          job: 'proof',
          archetype,
          intent: 'x',
        }).success
      ).toBe(false);
    }
  });

  it('parses premium archetypes (Basic safety lives in sanitize)', () => {
    for (const archetype of ['qna', 'hotspots', 'carousel']) {
      expect(
        NarrativeBeatSchema.safeParse({
          order: 1,
          job: 'proof',
          archetype,
          intent: 'x',
        }).success
      ).toBe(true);
    }
  });
});

describe('moduleKindForBeat round-trip', () => {
  it('every plannable archetype writes a kind that lifts back to it', () => {
    // Representative jobs incl. the job-sensitive splits.
    const cases: Array<[NarrativeBeat['job'], NarrativeBeat['archetype']]> = [
      ['hook', 'full-bleed-hero'],
      ['benefit', 'split-LR'],
      ['benefit', 'lifestyle-immersion'],
      ['problem', 'problem-solution'],
      ['benefit', 'feature-grid'],
      ['use-cases', 'feature-grid'],
      ['benefit', 'icon-row'],
      ['comparison', 'comparison-table'],
      ['use-cases', 'dual-use-split'],
      ['proof', 'spec-sheet'],
      ['hook', 'brand-story-band'],
      ['brand', 'brand-story-band'],
      ['cta', 'brand-story-band'],
      ['proof', 'qna'],
      ['how-it-works', 'hotspots'],
      ['use-cases', 'carousel'],
    ];
    const covered = new Set(cases.map(([, archetype]) => archetype));
    expect([...covered].sort()).toEqual(
      [...PREMIUM_PLANNABLE_ARCHETYPES].sort()
    );

    for (const [job, archetype] of cases) {
      const theBeat = beat(1, job, archetype, 'Make the buyer believe it.');
      const kind = moduleKindForBeat(theBeat);
      const section = liftModuleToSection(minimalModule(kind), {
        id: 'section-1',
        order: 1,
        beat: theBeat,
      });
      expect(section.job).toBe(job);
      expect(section.intent).toBe('Make the buyer believe it.');
      expect(section.visual.layout.archetype).toBe(archetype);
    }
  });
});

describe('sanitizeNarrativeBeats', () => {
  const opts = { maxBeats: 5, productName: 'Kraft Cups' };

  it('clamps, renumbers, and preserves valid beats', () => {
    const beats = [
      beat(3, 'proof', 'spec-sheet'),
      beat(1, 'hook', 'full-bleed-hero'),
      beat(2, 'benefit', 'feature-grid'),
    ];
    const sanitized = sanitizeNarrativeBeats(beats, opts);
    expect(sanitized.map((b) => b.order)).toEqual([1, 2, 3, 4, 5]);
    expect(sanitized[0].archetype).toBe('full-bleed-hero');
    expect(sanitized[1].archetype).toBe('feature-grid');
    expect(sanitized[2].archetype).toBe('spec-sheet');
  });

  it('breaks back-to-back archetype repeats', () => {
    const beats = [
      beat(1, 'benefit', 'lifestyle-immersion'),
      beat(2, 'use-cases', 'lifestyle-immersion'),
      beat(3, 'proof', 'spec-sheet'),
    ];
    const sanitized = sanitizeNarrativeBeats(beats, {
      ...opts,
      maxBeats: 3,
    });
    for (let i = 1; i < sanitized.length; i++) {
      expect(sanitized[i].archetype).not.toBe(sanitized[i - 1].archetype);
    }
  });

  it('drops invalid entries and pads from the fallback story', () => {
    const sanitized = sanitizeNarrativeBeats(
      [
        beat(1, 'hook', 'full-bleed-hero'),
        {
          order: 2,
          job: 'proof',
          archetype: 'stat-band',
          intent: 'x',
          assetsToUse: [],
        } as unknown as NarrativeBeat,
      ],
      opts
    );
    expect(sanitized).toHaveLength(5);
    expect(sanitized[0].archetype).toBe('full-bleed-hero');
    // No duplicates introduced by padding.
    const archetypes = sanitized.map((b) => b.archetype);
    expect(new Set(archetypes).size).toBe(archetypes.length);
  });

  it('empty plan yields the full fallback', () => {
    const sanitized = sanitizeNarrativeBeats([], opts);
    expect(sanitized).toHaveLength(5);
    expect(sanitized.map((b) => b.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('promotes a visual opener when the plan opens with a table', () => {
    const sanitized = sanitizeNarrativeBeats(
      [
        beat(1, 'proof', 'spec-sheet'),
        beat(2, 'comparison', 'comparison-table'),
        beat(3, 'hook', 'full-bleed-hero'),
      ],
      opts
    );
    expect(sanitized[0].archetype).toBe('full-bleed-hero');
    expect(sanitized.map((b) => b.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('drops a closing logo band and pads with conversion beats instead', () => {
    const sanitized = sanitizeNarrativeBeats(
      [
        beat(1, 'hook', 'full-bleed-hero'),
        beat(2, 'proof', 'spec-sheet'),
        beat(3, 'brand', 'brand-story-band'),
      ],
      opts
    );
    // The trailing brand band is gone; nothing padded it back in.
    expect(
      sanitized.some(
        (b) => b.archetype === 'brand-story-band' && b.job !== 'hook'
      )
    ).toBe(false);
    expect(sanitized[sanitized.length - 1].archetype).not.toBe(
      'brand-story-band'
    );
    // Brand band as the OPENER hook survives.
    const openerBand = sanitizeNarrativeBeats(
      [beat(1, 'hook', 'brand-story-band'), beat(2, 'proof', 'spec-sheet')],
      opts
    );
    expect(openerBand[0].archetype).toBe('brand-story-band');
  });

  it('synthesizes a hero opener when no visual beat exists', () => {
    const sanitized = sanitizeNarrativeBeats(
      [beat(1, 'proof', 'spec-sheet')],
      opts
    );
    expect(sanitized[0]).toMatchObject({
      order: 1,
      job: 'hook',
      archetype: 'full-bleed-hero',
    });
    expect(sanitized[1].archetype).toBe('spec-sheet');
  });

  it('default (Basic) coerces premium beats, preserving job and intent', () => {
    const sanitized = sanitizeNarrativeBeats(
      [
        beat(1, 'hook', 'full-bleed-hero'),
        beat(2, 'proof', 'qna', 'Kill the leak objection.'),
        beat(3, 'how-it-works', 'hotspots', 'Tour the features.'),
        beat(4, 'use-cases', 'carousel', 'Show the range.'),
      ],
      { ...opts, maxBeats: 4 }
    );
    expect(sanitized[1]).toMatchObject({
      job: 'proof',
      archetype: 'spec-sheet',
      intent: 'Kill the leak objection.',
    });
    expect(sanitized[2]).toMatchObject({
      job: 'how-it-works',
      archetype: 'split-LR',
      intent: 'Tour the features.',
    });
    expect(sanitized[3]).toMatchObject({
      job: 'use-cases',
      archetype: 'feature-grid',
      intent: 'Show the range.',
    });
  });

  it('premium allowlist passes premium beats through', () => {
    const sanitized = sanitizeNarrativeBeats(
      [
        beat(1, 'hook', 'full-bleed-hero'),
        beat(2, 'proof', 'qna'),
        beat(3, 'how-it-works', 'hotspots'),
        beat(4, 'use-cases', 'carousel'),
      ],
      {
        ...opts,
        maxBeats: 4,
        allowedArchetypes: PREMIUM_PLANNABLE_ARCHETYPES,
      }
    );
    expect(sanitized.map((b) => b.archetype)).toEqual([
      'full-bleed-hero',
      'qna',
      'hotspots',
      'carousel',
    ]);
  });

  it('separates adjacent edge-to-edge photo modules with a text-anchored beat', () => {
    const sanitized = sanitizeNarrativeBeats(
      [
        beat(1, 'hook', 'full-bleed-hero'),
        beat(2, 'benefit', 'lifestyle-immersion'),
        beat(3, 'proof', 'spec-sheet'),
        beat(4, 'comparison', 'comparison-table'),
      ],
      { ...opts, maxBeats: 4 }
    );
    // The spec sheet is pulled between the two photo modules.
    expect(sanitized.map((b) => b.archetype)).toEqual([
      'full-bleed-hero',
      'spec-sheet',
      'lifestyle-immersion',
      'comparison-table',
    ]);
    for (let i = 1; i < sanitized.length; i++) {
      expect(
        isImmersiveArchetype(sanitized[i - 1].archetype) &&
          isImmersiveArchetype(sanitized[i].archetype)
      ).toBe(false);
    }
  });

  it('leaves an all-immersive plan intact (nothing to separate with)', () => {
    const sanitized = sanitizeNarrativeBeats(
      [
        beat(1, 'hook', 'full-bleed-hero'),
        beat(2, 'benefit', 'lifestyle-immersion'),
        beat(3, 'problem', 'problem-solution'),
      ],
      { ...opts, maxBeats: 3 }
    );
    // Padding may add non-immersive beats; with maxBeats hit, order stays.
    expect(sanitized).toHaveLength(3);
    expect(sanitized[0].archetype).toBe('full-bleed-hero');
  });

  it('IMMERSIVE_ARCHETYPES covers the full-bleed photo layouts', () => {
    expect([...IMMERSIVE_ARCHETYPES].sort()).toEqual(
      [
        'full-bleed-hero',
        'lifestyle-immersion',
        'problem-solution',
        'hotspots',
        'carousel',
        'video',
      ].sort()
    );
    expect(isImmersiveArchetype('spec-sheet')).toBe(false);
  });

  it('allows at most ONE of each premium showcase archetype', () => {
    const sanitized = sanitizeNarrativeBeats(
      [
        beat(1, 'hook', 'full-bleed-hero'),
        beat(2, 'proof', 'qna'),
        beat(3, 'differentiation', 'qna', 'Second qna must coerce.'),
        beat(4, 'use-cases', 'carousel'),
      ],
      {
        ...opts,
        maxBeats: 4,
        allowedArchetypes: PREMIUM_PLANNABLE_ARCHETYPES,
      }
    );
    const qnaCount = sanitized.filter((b) => b.archetype === 'qna').length;
    expect(qnaCount).toBe(1);
    const repeat = sanitized.find(
      (b) => b.intent === 'Second qna must coerce.'
    );
    expect(repeat?.archetype).toBe('spec-sheet');
  });
});

describe('fallbackNarrativeBeats', () => {
  it('is deterministic and rotates by product name', () => {
    const a = fallbackNarrativeBeats('Kraft Cups', 5);
    expect(fallbackNarrativeBeats('Kraft Cups', 5)).toEqual(a);
    const b = fallbackNarrativeBeats('Kraft Cupss', 5);
    expect(b[0].archetype).not.toBe(a[0].archetype);
    expect(a.map((x) => x.order)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('beatsFromExperience', () => {
  it('coerces non-plannable archetypes and renumbers', () => {
    const section = (
      order: number,
      layout: Section['visual']['layout'],
      job: Section['job'] = 'benefit'
    ): Section => ({
      id: `section-${order}`,
      order,
      job,
      intent: `Intent ${order}`,
      locked: false,
      visual: {
        medium: 'static',
        layout,
        desktop: { aspect: '970:600', focalHierarchy: [], textZones: [] },
        images: [],
      },
    });
    const experience: Experience = {
      id: 'experience-1',
      title: 't',
      goal: 'g',
      artDirection: {
        positioning: 'p',
        visualSystem: 'v',
        mobilePrinciple: 'm',
        imagePlan: 'i',
      },
      sections: [
        section(2, {
          archetype: 'qna',
          items: [{ question: 'Q?', answer: 'A.' }],
        }),
        section(1, { archetype: 'lifestyle-immersion' }, 'hook'),
        section(3, {
          archetype: 'stat-band',
          stats: [
            { value: '50', label: 'cups' },
            { value: '8oz', label: 'capacity' },
          ],
        }),
      ],
      status: 'draft',
    };
    const beats = beatsFromExperience(experience);
    expect(beats.map((b) => b.order)).toEqual([1, 2, 3]);
    expect(beats[0]).toMatchObject({
      job: 'hook',
      archetype: 'lifestyle-immersion',
    });
    // Premium archetypes pass through (regen returns the same kind)...
    expect(beats[1].archetype).toBe('qna');
    // ...while truly non-plannable ones still coerce.
    expect(beats[2].archetype).toBe('icon-row');
  });
});
