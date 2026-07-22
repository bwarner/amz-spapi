import type {
  APlusGeneratedModule,
  ModuleMappingEntry,
} from '@farvisionllc/models';
import {
  buildInstructionsModel,
  entryFileName,
  exportBaseName,
  instructionsHtml,
  slugify,
  zipEntryPlan,
} from './aplus-export-kit';

const slot = (role: string, url?: string) => ({
  role,
  brief: 'sample brief',
  size: '1792x1024' as const,
  alt: `${role} photo`,
  ...(url ? { image: { url, alt: `${role} photo` } } : {}),
});

// A premium deployment exercising every naming-table row: native w/ mobile
// spec, native w/o images (qna), designed band, and a slice stack.
const premiumModules: APlusGeneratedModule[] = [
  {
    order: 1,
    amazonModuleType: 'PREMIUM_BACKGROUND_IMAGE_TEXT',
    title: 'Hero',
    type: 'image-text-overlay',
    image: slot('hero', '/api/a-plus/assets/asset_hero'),
    headline: 'Only $9.99 headline gets cleaned',
  },
  {
    order: 2,
    amazonModuleType: 'PREMIUM_QA',
    title: 'Q&A',
    type: 'qna',
    items: [{ question: 'Leak-proof?', answer: 'Yes — sealed rims.' }],
  },
  {
    order: 3,
    amazonModuleType: 'PREMIUM_HOTSPOTS_1',
    title: 'Tour',
    type: 'hotspots',
    image: slot('hotspot-base'), // NO resolved image → missing
    hotspots: [
      {
        position: { x: 0.42, y: 0.777 },
        label: 'Snap lid',
        copy: 'Seals tight.',
      },
    ],
  },
  {
    order: 4,
    amazonModuleType: 'PREMIUM_FULL_IMAGE',
    title: 'Benefits',
    type: 'icon-row',
    items: [
      { icon: 'coffee', label: 'Hot' },
      { icon: 'droplet', label: 'Cold' },
    ],
  },
];

const premiumMapping: ModuleMappingEntry[] = [
  {
    order: 1,
    amazonModuleType: 'PREMIUM_BACKGROUND_IMAGE_TEXT',
    sectionIds: ['s1'],
    kind: 'native',
    imageSpecs: [
      {
        role: 'hero',
        width: 1464,
        height: 600,
        mobileWidth: 600,
        mobileHeight: 450,
      },
    ],
  },
  {
    order: 2,
    amazonModuleType: 'PREMIUM_QA',
    sectionIds: ['s2'],
    kind: 'native',
  },
  {
    order: 3,
    amazonModuleType: 'PREMIUM_HOTSPOTS_1',
    sectionIds: ['s3'],
    kind: 'native',
    imageSpecs: [
      {
        role: 'hotspot-base',
        width: 1464,
        height: 600,
        mobileWidth: 600,
        mobileHeight: 450,
      },
    ],
  },
  {
    order: 4,
    amazonModuleType: 'PREMIUM_FULL_IMAGE',
    sectionIds: ['s4'],
    kind: 'designed-image',
  },
];

describe('slugify / exportBaseName / entryFileName', () => {
  it('slugifies seller central names', () => {
    expect(slugify('Premium Hotspots 1')).toBe('premium-hotspots-1');
    expect(slugify('Premium Dual Images & Text')).toBe(
      'premium-dual-images-and-text'
    );
    expect(slugify('***')).toBe('item');
  });

  it('builds the zip download name from the draft title', () => {
    expect(exportBaseName('Kraft Cups A+ draft')).toBe(
      'kraft-cups-a-draft-seller-central-kit'
    );
    expect(exportBaseName()).toBe('seller-central-kit');
  });

  it('appends dims + extension once known', () => {
    expect(
      entryFileName({ baseName: '04-x-band', ext: 'png' }, 1464, 600)
    ).toBe('04-x-band-1464x600.png');
  });
});

describe('zipEntryPlan — premium', () => {
  const plan = zipEntryPlan(premiumModules, premiumMapping, 'Premium A+');

  it('covers every naming-table row and sorts lexically in build order', () => {
    const names = plan.map((entry) => entry.baseName);
    expect(names).toEqual([
      '01-premium-background-image-with-text-hero',
      '01-premium-background-image-with-text-hero-mobile',
      '03-premium-hotspots-1-hotspot-base',
      '03-premium-hotspots-1-hotspot-base-mobile',
      '04-premium-full-image-band',
      '04-premium-full-image-band-mobile',
    ]);
    // Zero-padded order prefix → lexical sort IS build order.
    expect([...names].sort()).toEqual(names);
  });

  it('native crops are JPG at exact spec dims; qna emits no files', () => {
    const hero = plan[0];
    expect(hero.ext).toBe('jpg');
    expect(hero.source).toMatchObject({
      kind: 'crop',
      slotUrl: '/api/a-plus/assets/asset_hero',
      width: 1464,
      height: 600,
    });
    const heroMobile = plan[1];
    expect(heroMobile.source).toMatchObject({ width: 600, height: 450 });
    expect(plan.some((entry) => entry.moduleOrder === 2)).toBe(false);
  });

  it('flags missing slot images in the plan (no URL, entry retained)', () => {
    const base = plan.find(
      (entry) => entry.baseName === '03-premium-hotspots-1-hotspot-base'
    );
    expect(base?.source).toMatchObject({ kind: 'crop', slotUrl: undefined });
  });

  it('designed bands are PNG renders per viewport with derived alt text', () => {
    const band = plan.find(
      (entry) => entry.baseName === '04-premium-full-image-band'
    );
    expect(band).toMatchObject({
      ext: 'png',
      source: { kind: 'render', viewport: 'desktop' },
    });
    // Alt summarizes the baked-in content: title + first item labels.
    const alt = (band?.source as { alt?: string }).alt ?? '';
    expect(alt).toContain('Benefits');
    expect(alt).toContain('Hot');
    expect(alt.length).toBeLessThanOrEqual(100);
  });
});

describe('zipEntryPlan — basic designed + slice stack', () => {
  const modules: APlusGeneratedModule[] = [
    {
      order: 1,
      amazonModuleType: 'STANDARD_HEADER_IMAGE_TEXT',
      title: 'Scene',
      type: 'image-header-with-text',
      image: slot('hero'),
    },
  ];
  const mapping: ModuleMappingEntry[] = [
    {
      order: 1,
      amazonModuleType: 'STANDARD_HEADER_IMAGE_TEXT',
      sectionIds: ['s1'],
      kind: 'image-slice-stack',
      slices: [
        {
          index: 0,
          offsetY: 0,
          height: 600,
          seamSafeTop: false,
          seamSafeBottom: true,
        },
        {
          index: 1,
          offsetY: 600,
          height: 600,
          seamSafeTop: true,
          seamSafeBottom: false,
        },
      ],
    },
  ];

  it('emits per-slice desktop + mobile entries with offsets', () => {
    const plan = zipEntryPlan(modules, mapping, 'Basic A+');
    expect(plan.map((entry) => entry.baseName)).toEqual([
      '01-standard-image-header-with-text-slice-1',
      '01-standard-image-header-with-text-slice-1-mobile',
      '01-standard-image-header-with-text-slice-2',
      '01-standard-image-header-with-text-slice-2-mobile',
    ]);
    expect(plan[2].source).toMatchObject({
      kind: 'slice',
      index: 2,
      offsetY: 600,
      sliceHeight: 600,
      totalHeight: 1200,
    });
  });

  it('basic designed modules use the -module suffix', () => {
    const plan = zipEntryPlan(
      modules,
      [{ ...mapping[0], kind: 'designed-image', slices: undefined }],
      'Basic A+'
    );
    expect(plan.map((entry) => entry.baseName)).toEqual([
      '01-standard-image-header-with-text-module',
      '01-standard-image-header-with-text-module-mobile',
    ]);
  });
});

describe('buildInstructionsModel + instructionsHtml', () => {
  const model = buildInstructionsModel({
    modules: premiumModules,
    moduleMapping: premiumMapping,
    tier: 'Premium A+',
    title: 'Kraft Cups',
    asins: ['B0TEST1', 'B0TEST2'],
    files: [
      {
        fileName: '01-premium-background-image-with-text-hero-1464x600.jpg',
        moduleOrder: 1,
        slot: 'hero',
        width: 1464,
        height: 600,
        alt: 'hero photo',
      },
    ],
    missing: [{ moduleOrder: 3, slot: 'hotspot-base' }],
    warnings: ['One image was recompressed to fit the size limit.'],
  });

  it('steps follow the mapping order with seller central names', () => {
    expect(model.steps.map((step) => step.moduleName)).toEqual([
      'Premium Background Image with Text',
      'Premium Q&A',
      'Premium Hotspots 1',
      'Premium Full Image',
    ]);
  });

  it('native copy is guardrail-cleaned with AMAZON limits; designed steps carry none', () => {
    const heroStep = model.steps[0];
    const headline = heroStep.textFields.find(
      (field) => field.label === 'Headline'
    );
    expect(headline?.value).not.toContain('$');
    // Native limit for PREMIUM_BACKGROUND_IMAGE_TEXT titles, not our internal 160.
    expect(headline?.limit).toBe(60);
    expect(model.steps[3].textFields).toEqual([]);
  });

  it('normalizes typographic characters Seller Central rejects', () => {
    const fancy: APlusGeneratedModule = {
      order: 1,
      amazonModuleType: 'PREMIUM_SINGLE_IMAGE_TEXT',
      title: 'T',
      type: 'single-image-text',
      image: slot('hero', '/api/a-plus/assets/asset_x'),
      headline: 'Hot — or “cold”… it’s ready',
    };
    const built = buildInstructionsModel({
      modules: [fancy],
      moduleMapping: [
        {
          order: 1,
          amazonModuleType: 'PREMIUM_SINGLE_IMAGE_TEXT',
          sectionIds: ['s1'],
          kind: 'native',
        },
      ],
      tier: 'Premium A+',
      files: [],
    });
    const headline = built.steps[0].textFields.find(
      (field) => field.label === 'Headline'
    );
    expect(headline?.value).toBe('Hot - or "cold"... it\'s ready');
  });

  it('converts hotspot fractions to percentages', () => {
    expect(model.steps[2].hotspots).toEqual([
      {
        index: 1,
        xPercent: 42,
        yPercent: 78,
        label: 'Snap lid',
        copy: 'Seals tight.',
      },
    ]);
  });

  it('carries missing-image flags and uploads to the right steps', () => {
    expect(model.steps[2].missingImages).toEqual(['hotspot-base']);
    expect(model.steps[0].uploads[0].fileName).toContain('hero-1464x600.jpg');
  });

  it('lists only native Amazon fields: no Module title/Badge; bullets fold into body', () => {
    const singleImage: APlusGeneratedModule = {
      order: 1,
      amazonModuleType: 'PREMIUM_SINGLE_IMAGE_TEXT',
      title: 'A Better Cup for Every Pour',
      type: 'single-image-text',
      image: slot('hero-split', '/api/a-plus/assets/asset_x'),
      headline: 'Premium grip. No burned fingers.',
      body: 'Triple-wall construction keeps heat inside the cup.',
      bullets: ['Insulates hands', 'Fits 8 oz drinks'],
      badge: '8 OZ',
    };
    const folded = buildInstructionsModel({
      modules: [singleImage],
      moduleMapping: [
        {
          order: 1,
          amazonModuleType: 'PREMIUM_SINGLE_IMAGE_TEXT',
          sectionIds: ['s1'],
          kind: 'native',
          imageSpecs: [{ role: 'hero-split', width: 800, height: 600 }],
        },
      ],
      tier: 'Premium A+',
      files: [],
    });
    const labels = folded.steps[0].textFields.map((field) => field.label);
    // Amazon's module: Subheadline (40, holds our module title) + Headline +
    // one Body text — confirmed in Seller Central.
    expect(labels).toEqual(['Subheadline', 'Headline', 'Body']);
    expect(folded.steps[0].textFields[0]).toMatchObject({
      value: 'A Better Cup for Every Pour',
      limit: 40,
    });
    const body = folded.steps[0].textFields.find(
      (field) => field.label === 'Body'
    );
    if (!body) throw new Error('missing Body field');
    expect(body.limit).toBe(500); // Amazon's native cap, not our internal 800
    expect(body.value).toContain('keeps heat inside the cup.');
    expect(body.value).toContain('• Insulates hands');
    expect(body.value).toContain('• Fits 8 oz drinks');
    expect(body.value.length).toBeLessThanOrEqual(500);
    expect(folded.steps[0].note).toContain('no separate bullet fields');
    expect(folded.steps[0].warnings).toBeUndefined();
  });

  it('bullets that overflow the native limit become warnings, never truncated copy', () => {
    const longBody: APlusGeneratedModule = {
      order: 1,
      amazonModuleType: 'PREMIUM_SINGLE_IMAGE_TEXT',
      title: 'T',
      type: 'single-image-text',
      image: slot('hero', '/api/a-plus/assets/asset_x'),
      body: 'x'.repeat(460),
      bullets: [
        'First short bullet fits in nothing',
        'Second bullet also left out',
      ],
    };
    const folded = buildInstructionsModel({
      modules: [longBody],
      moduleMapping: [
        {
          order: 1,
          amazonModuleType: 'PREMIUM_SINGLE_IMAGE_TEXT',
          sectionIds: ['s1'],
          kind: 'native',
        },
      ],
      tier: 'Premium A+',
      files: [],
    });
    const body = folded.steps[0].textFields.find((f) => f.label === 'Body');
    expect(body?.value.length).toBeLessThanOrEqual(500);
    expect(body?.value).not.toContain('Second bullet');
    const warning = folded.steps[0].warnings?.join(' ');
    expect(warning).toContain("Amazon's 500-character text limit");
    expect(warning).toContain('Second bullet also left out');
  });

  it('renders self-contained HTML with steps, warnings, and escaping', () => {
    const html = instructionsHtml(model);
    expect(html).toContain('Step 3 of 4');
    expect(html).toContain('42% from left, 78% from top');
    expect(html).toContain('One image was recompressed');
    expect(html).toContain('B0TEST1');
    expect(html).toContain('Premium Q&amp;A');
    expect(html).not.toMatch(/src=|href="http/); // self-contained
  });
});
