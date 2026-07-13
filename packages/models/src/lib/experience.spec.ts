import {
  ARCHETYPE_CAPABILITIES,
  ARCHETYPE_LABELS,
  CONVERSION_JOB_LABELS,
  CONVERSION_JOBS,
  ExperienceSchema,
  LAYOUT_ARCHETYPES,
  LayoutIntentSchema,
  SectionSchema,
  type LayoutIntent,
} from './experience';

describe('vocabulary v1', () => {
  it('every archetype has capabilities and a label', () => {
    for (const archetype of LAYOUT_ARCHETYPES) {
      expect(ARCHETYPE_CAPABILITIES[archetype]).toBeDefined();
      expect(ARCHETYPE_LABELS[archetype]).toBeTruthy();
    }
  });

  it('structured flags match the doc decision', () => {
    const structured = LAYOUT_ARCHETYPES.filter(
      (archetype) => ARCHETYPE_CAPABILITIES[archetype].structured
    );
    expect(structured.sort()).toEqual(
      ['comparison-table', 'qna', 'spec-sheet'].sort()
    );
  });

  it('non-native archetypes declare a degradation', () => {
    for (const archetype of LAYOUT_ARCHETYPES) {
      const cap = ARCHETYPE_CAPABILITIES[archetype];
      if (!cap.nativeFormats.includes('aplus')) {
        expect(cap.degradesTo).toBeDefined();
      }
    }
  });

  it('every conversion job has a label', () => {
    for (const job of CONVERSION_JOBS) {
      expect(CONVERSION_JOB_LABELS[job]).toBeTruthy();
    }
  });
});

describe('LayoutIntentSchema', () => {
  const variants: LayoutIntent[] = [
    { archetype: 'full-bleed-hero', overlayPosition: 'left', badge: '50-PACK' },
    { archetype: 'split-LR', imagePosition: 'right' },
    { archetype: 'lifestyle-immersion' },
    { archetype: 'problem-solution' },
    {
      archetype: 'feature-grid',
      tiles: [
        { headline: 'A', imageRole: 't1' },
        { headline: 'B', imageRole: 't2' },
        { headline: 'C', imageRole: 't3' },
      ],
    },
    {
      archetype: 'icon-row',
      items: [
        { icon: 'coffee', label: 'Hot' },
        { icon: 'droplet', label: 'Cold' },
      ],
    },
    {
      archetype: 'comparison-table',
      columns: [{ title: 'Ours', highlight: true }, { title: 'Theirs' }],
      rows: [{ label: 'Material', values: ['Kraft', 'Plastic'] }],
    },
    {
      archetype: 'dual-use-split',
      panels: [
        { label: 'HOT', imageRole: 'p1' },
        { label: 'COLD', imageRole: 'p2' },
      ],
    },
    {
      archetype: 'stat-band',
      stats: [
        { value: '50', label: 'cups per pack' },
        { value: '8oz', label: 'capacity' },
      ],
    },
    { archetype: 'spec-sheet', rows: [{ label: 'Weight', value: '120 g' }] },
    { archetype: 'qna', items: [{ question: 'Q?', answer: 'A.' }] },
    { archetype: 'brand-story-band', presentation: 'logo-band' },
    {
      archetype: 'hotspots',
      baseImageRole: 'hero',
      hotspots: [
        { position: { x: 0.5, y: 0.5 }, label: 'Lid', copy: 'Snug fit.' },
      ],
    },
    {
      archetype: 'video',
      intent: 'Show pouring',
      source: 'ugc',
      posterFrameRole: 'poster',
    },
    { archetype: 'carousel', imageRoles: ['c1', 'c2'] },
  ];

  it('parses every archetype variant', () => {
    const covered = new Set(variants.map((variant) => variant.archetype));
    expect([...covered].sort()).toEqual([...LAYOUT_ARCHETYPES].sort());
    for (const variant of variants) {
      expect(() => LayoutIntentSchema.parse(variant)).not.toThrow();
    }
  });

  it('video requires a poster frame role', () => {
    expect(() =>
      LayoutIntentSchema.parse({
        archetype: 'video',
        intent: 'Show pouring',
        source: 'ugc',
      })
    ).toThrow();
  });
});

describe('Section / Experience defaults', () => {
  const section = {
    id: 'section-1',
    order: 1,
    job: 'hook',
    intent: 'Open with the hero moment',
    visual: {
      layout: { archetype: 'lifestyle-immersion' },
      desktop: { aspect: '970:600' },
      images: [],
    },
  };

  it('applies defaults (locked=false, medium=static, status=draft)', () => {
    const parsedSection = SectionSchema.parse(section);
    expect(parsedSection.locked).toBe(false);
    expect(parsedSection.visual.medium).toBe('static');

    const experience = ExperienceSchema.parse({
      id: 'experience-1',
      title: 'Kraft cups',
      goal: 'Sell the 50-pack',
      artDirection: {
        positioning: 'p',
        visualSystem: 'v',
        mobilePrinciple: 'm',
        imagePlan: 'i',
      },
      sections: [section],
    });
    expect(experience.status).toBe('draft');
    expect(experience.sections[0].job).toBe('hook');
  });
});
