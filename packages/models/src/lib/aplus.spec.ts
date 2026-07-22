import {
  APLUS_CREATIVITY_TEMPERATURE,
  APlusCreativitySchema,
  APlusGeneratedModuleSchema,
  APlusGuidanceSchema,
  PREMIUM_A_PLUS_MODULE_TYPES,
  RENDERABLE_AMAZON_MODULE_TYPES,
  amazonModuleTypeToKind,
  applyAPlusGuardrails,
  generatedModuleSchemaForKind,
  moduleImageSlotEntries,
  moduleImageSlots,
  moduleTextFieldDescriptors,
  moduleTextFields,
  normalizeAmazonModuleType,
  setModuleTextField,
  type APlusGeneratedModule,
} from './aplus';

const slot = (role: string) => ({
  role,
  brief: 'Editorial product photo, warm light, no text, no logos.',
  size: '1792x1024' as const,
  alt: `${role} image`,
});

describe('aplus schema', () => {
  it('parses a structured comparison-table module', () => {
    const module: APlusGeneratedModule = {
      order: 1,
      amazonModuleType: 'STANDARD_COMPARISON_TABLE',
      title: 'Compare the range',
      type: 'comparison-table',
      products: [
        { title: 'This product', highlight: true },
        { title: 'Alternative' },
      ],
      rows: [{ label: 'Material', values: ['Stainless', 'Plastic'] }],
    };
    expect(APlusGeneratedModuleSchema.parse(module)).toEqual(module);
  });

  it('parses a four-image quadrant module with image slots', () => {
    const module: APlusGeneratedModule = {
      order: 2,
      amazonModuleType: 'STANDARD_FOUR_IMAGE_TEXT',
      title: 'Four benefits',
      type: 'four-image-text-quadrant',
      quadrants: [
        { image: slot('q1'), headline: 'A', body: 'a' },
        { image: slot('q2'), headline: 'B', body: 'b' },
        { image: slot('q3'), headline: 'C', body: 'c' },
        { image: slot('q4'), headline: 'D', body: 'd' },
      ],
    };
    const parsed = APlusGeneratedModuleSchema.parse(module);
    expect(moduleImageSlots(parsed)).toHaveLength(4);
  });

  it('rejects an unknown module type', () => {
    expect(() =>
      APlusGeneratedModuleSchema.parse({
        order: 0,
        amazonModuleType: 'X',
        title: 'x',
        type: 'not-real',
      })
    ).toThrow();
  });
});

describe('amazonModuleTypeToKind', () => {
  it('maps known Amazon types', () => {
    expect(amazonModuleTypeToKind('STANDARD_COMPARISON_TABLE')).toBe(
      'comparison-table'
    );
    expect(amazonModuleTypeToKind('STANDARD_TECH_SPECS')).toBe('tech-specs');
  });

  it('falls back to single-image-text for unknown types', () => {
    expect(amazonModuleTypeToKind('STANDARD_MYSTERY')).toBe(
      'single-image-text'
    );
  });
});

describe('moduleTextFields', () => {
  it('collects editable copy and skips empty fields', () => {
    const fields = moduleTextFields({
      order: 1,
      amazonModuleType: 'STANDARD_SINGLE_IMAGE_TEXT',
      title: 'Hero',
      type: 'single-image-text',
      image: slot('hero'),
      headline: 'Built to last',
      body: '',
      bullets: ['Durable', ''],
    });
    expect(fields).toEqual([
      { label: 'Headline', value: 'Built to last' },
      { label: 'Bullet 1', value: 'Durable' },
    ]);
  });
});

/**
 * Real Seller Central A+ module types (SP-API ContentModuleType). The planner
 * must never be offered an app-invented code again.
 */
const REAL_AMAZON_MODULE_TYPES = new Set([
  'STANDARD_COMPANY_LOGO',
  'STANDARD_COMPARISON_TABLE',
  'STANDARD_FOUR_IMAGE_TEXT',
  'STANDARD_FOUR_IMAGE_TEXT_QUADRANT',
  'STANDARD_HEADER_IMAGE_TEXT',
  'STANDARD_IMAGE_SIDEBAR',
  'STANDARD_IMAGE_TEXT_OVERLAY',
  'STANDARD_MULTIPLE_IMAGE_TEXT',
  'STANDARD_PRODUCT_DESCRIPTION',
  'STANDARD_SINGLE_IMAGE_HIGHLIGHTS',
  'STANDARD_SINGLE_IMAGE_SPECS_DETAIL',
  'STANDARD_SINGLE_SIDE_IMAGE',
  'STANDARD_TECH_SPECS',
  'STANDARD_TEXT',
  'STANDARD_THREE_IMAGE_TEXT',
]);

describe('RENDERABLE_AMAZON_MODULE_TYPES', () => {
  it('contains only real Seller Central module types', () => {
    for (const type of RENDERABLE_AMAZON_MODULE_TYPES) {
      expect(REAL_AMAZON_MODULE_TYPES.has(type)).toBe(true);
    }
  });

  it('excludes the legacy app-invented codes', () => {
    const types: readonly string[] = RENDERABLE_AMAZON_MODULE_TYPES;
    expect(types).not.toContain('STANDARD_DUAL_USE_SPLIT');
    expect(types).not.toContain('STANDARD_ICON_ROW');
  });
});

describe('normalizeAmazonModuleType', () => {
  it('remaps legacy codes to a real Seller Central type', () => {
    expect(normalizeAmazonModuleType('STANDARD_DUAL_USE_SPLIT')).toBe(
      'STANDARD_HEADER_IMAGE_TEXT'
    );
    expect(normalizeAmazonModuleType('STANDARD_ICON_ROW')).toBe(
      'STANDARD_HEADER_IMAGE_TEXT'
    );
  });

  it('passes real codes through unchanged', () => {
    expect(normalizeAmazonModuleType('STANDARD_COMPARISON_TABLE')).toBe(
      'STANDARD_COMPARISON_TABLE'
    );
  });

  it('keeps legacy render-kind mapping for old drafts', () => {
    expect(amazonModuleTypeToKind('STANDARD_DUAL_USE_SPLIT')).toBe(
      'dual-use-split'
    );
    expect(amazonModuleTypeToKind('STANDARD_ICON_ROW')).toBe('icon-row');
  });
});

describe('creativity + guidance schemas', () => {
  it('parses the three creativity levels and rejects junk', () => {
    expect(APlusCreativitySchema.parse('low')).toBe('low');
    expect(APlusCreativitySchema.parse('medium')).toBe('medium');
    expect(APlusCreativitySchema.parse('high')).toBe('high');
    expect(() => APlusCreativitySchema.parse('spicy')).toThrow();
  });

  it('maps every level to a temperature for both phases', () => {
    for (const phase of ['strategy', 'moduleCopy'] as const) {
      for (const level of ['low', 'medium', 'high'] as const) {
        const temperature = APLUS_CREATIVITY_TEMPERATURE[phase][level];
        expect(temperature).toBeGreaterThanOrEqual(0);
        expect(temperature).toBeLessThanOrEqual(1);
      }
    }
  });

  it('bounds guidance length', () => {
    expect(APlusGuidanceSchema.parse({ strategy: 'lean playful' })).toEqual({
      strategy: 'lean playful',
    });
    expect(() =>
      APlusGuidanceSchema.parse({ moduleCopy: 'x'.repeat(2001) })
    ).toThrow();
  });
});

describe('moduleTextFieldDescriptors', () => {
  const comparison: APlusGeneratedModule = {
    order: 1,
    amazonModuleType: 'STANDARD_COMPARISON_TABLE',
    title: 'Compare the range',
    type: 'comparison-table',
    products: [
      { title: 'This product', image: slot('p1'), highlight: true },
      { title: 'Alternative' },
    ],
    rows: [{ label: 'Material', values: ['Stainless', 'Plastic'] }],
  };

  it('enumerates comparison-table cells with stable paths', () => {
    const descriptors = moduleTextFieldDescriptors(comparison);
    const byPath = (path: unknown[]) =>
      descriptors.find((d) => JSON.stringify(d.path) === JSON.stringify(path));
    expect(byPath(['title'])?.value).toBe('Compare the range');
    expect(byPath(['products', 0, 'title'])?.value).toBe('This product');
    expect(byPath(['products', 0, 'image', 'alt'])?.value).toBe('p1 image');
    // Product 2 has no image, so no alt descriptor for it.
    expect(byPath(['products', 1, 'image', 'alt'])).toBeUndefined();
    expect(byPath(['rows', 0, 'label'])?.maxLength).toBe(60);
    expect(byPath(['rows', 0, 'values', 1])?.value).toBe('Plastic');
    expect(byPath(['rows', 0, 'values', 1])?.maxLength).toBe(80);
  });

  it('includes empty optional fields so users can add copy', () => {
    const descriptors = moduleTextFieldDescriptors({
      order: 2,
      amazonModuleType: 'STANDARD_HEADER_IMAGE_TEXT',
      title: 'Hero',
      type: 'image-header-with-text',
      image: slot('hero'),
    });
    const headline = descriptors.find((d) => d.label === 'Headline');
    expect(headline).toMatchObject({ value: '', maxLength: 160 });
    const body = descriptors.find((d) => d.label === 'Body');
    expect(body).toMatchObject({ value: '', multiline: true });
    expect(descriptors.find((d) => d.label === 'Image alt text')?.value).toBe(
      'hero image'
    );
  });

  it('covers every kind: filled moduleTextFields values appear in descriptors', () => {
    const modules: APlusGeneratedModule[] = [
      {
        order: 0,
        amazonModuleType: 'STANDARD_COMPANY_LOGO',
        title: 'Brand',
        type: 'company-logo',
        logo: slot('logo'),
        headline: 'Sellavant',
        tagline: 'Better listings',
      },
      {
        order: 1,
        amazonModuleType: 'STANDARD_HEADER_IMAGE_TEXT',
        title: 'Hero',
        type: 'image-header-with-text',
        image: slot('hero'),
        headline: 'Built to last',
        body: 'Body copy',
      },
      {
        order: 2,
        amazonModuleType: 'STANDARD_IMAGE_TEXT_OVERLAY',
        title: 'Overlay',
        type: 'image-text-overlay',
        image: slot('overlay'),
        headline: 'Overlay headline',
        body: 'Overlay body',
      },
      {
        order: 3,
        amazonModuleType: 'STANDARD_SINGLE_IMAGE_HIGHLIGHTS',
        title: 'Highlights',
        type: 'single-image-text',
        image: slot('single'),
        headline: 'H',
        body: 'B',
        bullets: ['One', 'Two'],
      },
      {
        order: 4,
        amazonModuleType: 'STANDARD_SINGLE_SIDE_IMAGE',
        title: 'Side',
        type: 'image-and-text',
        image: slot('side'),
        imagePosition: 'left',
        headline: 'H',
        body: 'B',
      },
      {
        order: 5,
        amazonModuleType: 'STANDARD_THREE_IMAGE_TEXT',
        title: 'Trio',
        type: 'three-image-text',
        columns: [
          { image: slot('c1'), headline: 'A', body: 'a' },
          { image: slot('c2'), headline: 'B', body: 'b' },
          { image: slot('c3'), headline: 'C', body: 'c' },
        ],
      },
      {
        order: 6,
        amazonModuleType: 'STANDARD_FOUR_IMAGE_TEXT_QUADRANT',
        title: 'Quad',
        type: 'four-image-text-quadrant',
        quadrants: [
          { image: slot('q1'), headline: 'A', body: 'a' },
          { image: slot('q2'), headline: 'B', body: 'b' },
          { image: slot('q3'), headline: 'C', body: 'c' },
          { image: slot('q4'), headline: 'D', body: 'd' },
        ],
      },
      comparison,
      {
        order: 8,
        amazonModuleType: 'STANDARD_TECH_SPECS',
        title: 'Specs',
        type: 'tech-specs',
        headline: 'Specifications',
        rows: [{ label: 'Weight', value: '120 g' }],
      },
      {
        order: 9,
        amazonModuleType: 'STANDARD_PRODUCT_DESCRIPTION',
        title: 'Story',
        type: 'text-only',
        headline: 'Our story',
        body: 'Long body',
        bullets: ['Point'],
      },
      {
        order: 10,
        amazonModuleType: 'STANDARD_DUAL_USE_SPLIT',
        title: 'Hot & Cold',
        type: 'dual-use-split',
        panels: [
          { image: slot('hot'), label: 'HOT', caption: 'Coffee' },
          { image: slot('cold'), label: 'COLD', caption: 'Iced tea' },
        ],
      },
      {
        order: 11,
        amazonModuleType: 'STANDARD_ICON_ROW',
        title: 'Benefits',
        type: 'icon-row',
        items: [
          { icon: 'coffee', label: 'Hot drinks' },
          { icon: 'droplet', label: 'Cold drinks' },
        ],
      },
      {
        order: 12,
        amazonModuleType: 'PREMIUM_QA',
        title: 'Q&A',
        type: 'qna',
        headline: 'Your questions',
        items: [
          { question: 'Leak-proof?', answer: 'Yes — sealed rims.' },
          { question: 'Lids included?', answer: 'Every pack.' },
        ],
      },
      {
        order: 13,
        amazonModuleType: 'PREMIUM_HOTSPOTS_1',
        title: 'Feature tour',
        type: 'hotspots',
        headline: 'Every detail',
        image: slot('hotspot-base'),
        hotspots: [
          {
            position: { x: 0.3, y: 0.4 },
            label: 'Snap lid',
            copy: 'Seals tight.',
          },
          {
            position: { x: 0.7, y: 0.6 },
            label: 'Ripple wall',
            copy: 'Cool to hold.',
          },
        ],
      },
      {
        order: 14,
        amazonModuleType: 'PREMIUM_SIMPLE_IMAGE_CAROUSEL',
        title: 'Day in the life',
        type: 'carousel',
        slides: [
          { image: slot('s1'), headline: 'Morning', caption: 'First pour.' },
          { image: slot('s2'), caption: 'On the move.' },
        ],
      },
    ];

    for (const module of modules) {
      const descriptorValues = moduleTextFieldDescriptors(module).map(
        (d) => d.value
      );
      // Every value the build sheet / guardrail sweep sees must be editable.
      // (comparison-table joins row cells with ' | '; descriptors are per-cell)
      for (const field of moduleTextFields(module)) {
        for (const part of field.value.split(' | ')) {
          expect(descriptorValues).toContain(part);
        }
      }
      // Paths must be unique so edits can't collide.
      const paths = moduleTextFieldDescriptors(module).map((d) =>
        JSON.stringify(d.path)
      );
      expect(new Set(paths).size).toBe(paths.length);
    }
  });
});

describe('moduleImageSlotEntries', () => {
  it('mirrors moduleImageSlots and provides working brief paths', () => {
    const module: APlusGeneratedModule = {
      order: 1,
      amazonModuleType: 'STANDARD_THREE_IMAGE_TEXT',
      title: 'Trio',
      type: 'three-image-text',
      columns: [
        { image: slot('c1'), headline: 'A', body: 'a' },
        { image: slot('c2'), headline: 'B', body: 'b' },
        { image: slot('c3'), headline: 'C', body: 'c' },
      ],
    };
    const entries = moduleImageSlotEntries(module);
    expect(entries.map((e) => e.slot)).toEqual(moduleImageSlots(module));

    const next = setModuleTextField(
      module,
      [...entries[1].path, 'brief'],
      'Cup held in hand, black lid visible.'
    );
    if (next.type !== 'three-image-text') throw new Error('kind');
    expect(next.columns[1].image.brief).toBe(
      'Cup held in hand, black lid visible.'
    );
    expect(next.columns[0].image.brief).toBe(module.columns[0].image.brief);
  });

  it('skips comparison products without images', () => {
    const entries = moduleImageSlotEntries({
      order: 1,
      amazonModuleType: 'STANDARD_COMPARISON_TABLE',
      title: 'Compare',
      type: 'comparison-table',
      products: [{ title: 'Ours', image: slot('p1') }, { title: 'Theirs' }],
      rows: [{ label: 'Material', values: ['Steel', 'Plastic'] }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toEqual(['products', 0, 'image']);
  });
});

describe('setModuleTextField', () => {
  const quad: APlusGeneratedModule = {
    order: 1,
    amazonModuleType: 'STANDARD_FOUR_IMAGE_TEXT_QUADRANT',
    title: 'Quad',
    type: 'four-image-text-quadrant',
    quadrants: [
      { image: slot('q1'), headline: 'A', body: 'a' },
      { image: slot('q2'), headline: 'B', body: 'b' },
      { image: slot('q3'), headline: 'C', body: 'c' },
      { image: slot('q4'), headline: 'D', body: 'd' },
    ],
  };

  it('updates nested fields immutably', () => {
    const next = setModuleTextField(quad, ['quadrants', 2, 'body'], 'updated');
    expect(next).not.toBe(quad);
    if (next.type !== 'four-image-text-quadrant') throw new Error('kind');
    expect(next.quadrants[2].body).toBe('updated');
    expect(next.quadrants[2].headline).toBe('C');
    // Original untouched.
    if (quad.type !== 'four-image-text-quadrant') throw new Error('kind');
    expect(quad.quadrants[2].body).toBe('c');
  });

  it('updates comparison cells by row/value index', () => {
    const table: APlusGeneratedModule = {
      order: 1,
      amazonModuleType: 'STANDARD_COMPARISON_TABLE',
      title: 'Compare',
      type: 'comparison-table',
      products: [{ title: 'Ours' }, { title: 'Theirs' }],
      rows: [{ label: 'Material', values: ['Steel', 'Plastic'] }],
    };
    const next = setModuleTextField(table, ['rows', 0, 'values', 0], 'Kraft');
    if (next.type !== 'comparison-table') throw new Error('kind');
    expect(next.rows[0].values).toEqual(['Kraft', 'Plastic']);
  });

  it('clears optional object fields but keeps array slots as empty strings', () => {
    const cleared = setModuleTextField(quad, ['quadrants', 0, 'body'], '   ');
    if (cleared.type !== 'four-image-text-quadrant') throw new Error('kind');
    expect(cleared.quadrants[0].body).toBeUndefined();

    const single: APlusGeneratedModule = {
      order: 2,
      amazonModuleType: 'STANDARD_SINGLE_IMAGE_HIGHLIGHTS',
      title: 'Hero',
      type: 'single-image-text',
      image: slot('hero'),
      bullets: ['One', 'Two'],
    };
    const bullets = setModuleTextField(single, ['bullets', 1], '');
    if (bullets.type !== 'single-image-text') throw new Error('kind');
    expect(bullets.bullets).toEqual(['One', '']);
  });

  it('mirrors slot alt edits into the resolved image alt', () => {
    const withImage: APlusGeneratedModule = {
      order: 3,
      amazonModuleType: 'STANDARD_HEADER_IMAGE_TEXT',
      title: 'Hero',
      type: 'image-header-with-text',
      image: {
        ...slot('hero'),
        image: { url: 'https://example.com/hero.png', alt: 'old alt' },
      },
    };
    const next = setModuleTextField(withImage, ['image', 'alt'], 'new alt');
    if (next.type !== 'image-header-with-text') throw new Error('kind');
    expect(next.image.alt).toBe('new alt');
    expect(next.image.image?.alt).toBe('new alt');
  });

  it('returns the module unchanged for a broken path', () => {
    expect(setModuleTextField(quad, ['nope', 5, 'x'], 'v')).toBe(quad);
  });
});

describe('applyAPlusGuardrails', () => {
  it('strips price and delivery claims', () => {
    const { cleaned, triggered } = applyAPlusGuardrails(
      'Only $19.99 with free shipping'
    );
    expect(cleaned).not.toMatch(/\$|free shipping/i);
    expect(triggered.length).toBeGreaterThan(0);
  });
});

describe('resolved image URL shapes', () => {
  const withUrl = (url: string): APlusGeneratedModule => ({
    order: 1,
    amazonModuleType: 'STANDARD_HEADER_IMAGE_TEXT',
    title: 'Hero',
    type: 'image-header-with-text',
    image: { ...slot('hero'), image: { url, alt: 'hero photo' } },
  });

  it('accepts the app’s root-relative asset routes, data URLs, and https', () => {
    // Regression: z.string().url() rejected /api/a-plus/assets/… and silently
    // 400’d every module round-trip once images persisted to real assets.
    for (const url of [
      '/api/a-plus/assets/asset_38bfc72e-9591-44f3-963c-ae34a799a976',
      'data:image/png;base64,AAAA',
      'https://example.com/x.png',
    ]) {
      expect(APlusGeneratedModuleSchema.safeParse(withUrl(url)).success).toBe(
        true
      );
    }
  });

  it('still rejects non-URL garbage', () => {
    expect(
      APlusGeneratedModuleSchema.safeParse(withUrl('not a url')).success
    ).toBe(false);
    expect(APlusGeneratedModuleSchema.safeParse(withUrl('')).success).toBe(
      false
    );
  });
});

describe('premium module kinds (qna / hotspots / carousel)', () => {
  it('writer-shaped payloads parse via generatedModuleSchemaForKind', () => {
    const qna = generatedModuleSchemaForKind('qna').parse({
      order: 3,
      amazonModuleType: 'PREMIUM_QA',
      title: 'Q&A',
      type: 'qna',
      items: [{ question: 'Leak-proof?', answer: 'Yes — sealed rims.' }],
    });
    expect(APlusGeneratedModuleSchema.parse(qna).type).toBe('qna');

    const hotspots = generatedModuleSchemaForKind('hotspots').parse({
      order: 4,
      amazonModuleType: 'PREMIUM_HOTSPOTS_1',
      title: 'Tour',
      type: 'hotspots',
      image: slot('hotspot-base'),
      hotspots: [
        { position: { x: 0.5, y: 0.5 }, label: 'Lid', copy: 'Snug fit.' },
      ],
    });
    expect(APlusGeneratedModuleSchema.parse(hotspots).type).toBe('hotspots');

    const carousel = generatedModuleSchemaForKind('carousel').parse({
      order: 5,
      amazonModuleType: 'PREMIUM_SIMPLE_IMAGE_CAROUSEL',
      title: 'Story',
      type: 'carousel',
      slides: [
        { image: slot('s1'), headline: 'Morning' },
        { image: slot('s2'), caption: 'Refill.' },
      ],
    });
    expect(APlusGeneratedModuleSchema.parse(carousel).type).toBe('carousel');
  });

  it('enforces native limits (question length, hotspot/slide counts)', () => {
    const schema = generatedModuleSchemaForKind('qna');
    expect(
      schema.safeParse({
        order: 1,
        amazonModuleType: 'PREMIUM_QA',
        title: 'Q&A',
        type: 'qna',
        items: [{ question: 'x'.repeat(121), answer: 'a' }],
      }).success
    ).toBe(false);
    expect(
      generatedModuleSchemaForKind('carousel').safeParse({
        order: 1,
        amazonModuleType: 'PREMIUM_SIMPLE_IMAGE_CAROUSEL',
        title: 'Solo',
        type: 'carousel',
        slides: [{ image: slot('s1') }],
      }).success
    ).toBe(false);
  });

  it('exposes image slots with working descriptor paths', () => {
    const hotspots: APlusGeneratedModule = {
      order: 1,
      amazonModuleType: 'PREMIUM_HOTSPOTS_1',
      title: 'Tour',
      type: 'hotspots',
      image: slot('hotspot-base'),
      hotspots: [
        { position: { x: 0.5, y: 0.5 }, label: 'Lid', copy: 'Snug fit.' },
      ],
    };
    expect(
      moduleImageSlotEntries(hotspots).map((entry) => entry.slot.role)
    ).toEqual(['hotspot-base']);

    const carousel: APlusGeneratedModule = {
      order: 2,
      amazonModuleType: 'PREMIUM_SIMPLE_IMAGE_CAROUSEL',
      title: 'Story',
      type: 'carousel',
      slides: [{ image: slot('s1') }, { image: slot('s2') }],
    };
    const entries = moduleImageSlotEntries(carousel);
    expect(entries.map((entry) => entry.slot.role)).toEqual(['s1', 's2']);
    // The brief path drives per-slot editing exactly like other kinds.
    const edited = setModuleTextField(
      carousel,
      [...entries[1].path, 'brief'],
      'New slide brief'
    );
    if (edited.type !== 'carousel') throw new Error('kind');
    expect(edited.slides[1].image.brief).toBe('New slide brief');

    const qna: APlusGeneratedModule = {
      order: 3,
      amazonModuleType: 'PREMIUM_QA',
      title: 'Q&A',
      type: 'qna',
      items: [{ question: 'Q?', answer: 'A.' }],
    };
    expect(moduleImageSlots(qna)).toEqual([]);
  });

  it('PREMIUM_A_PLUS_MODULE_TYPES names exactly the premium-only kinds', () => {
    expect([...PREMIUM_A_PLUS_MODULE_TYPES].sort()).toEqual([
      'carousel',
      'hotspots',
      'qna',
    ]);
  });
});
