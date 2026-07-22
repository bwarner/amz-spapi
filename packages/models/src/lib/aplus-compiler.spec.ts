import {
  APLUS_GENERATED_MODULE_SCHEMA_BY_KIND,
  moduleTextFields,
} from './aplus';
import {
  KIND_TO_AMAZON,
  KIND_TO_PREMIUM,
  PREMIUM_IMAGE_SPECS,
  amazonModuleTypeForKind,
  compileExperienceToAplus,
  planSliceStack,
  sectionSliceUnits,
} from './aplus-compiler';
import {
  liftGeneratedPackageToExperience,
  liftModuleToSection,
} from './experience-lift';
import { REPRESENTATIVE_PACKAGE } from './experience-fixtures';
import { APLUS_SLICE_CONSTANTS, type Section } from './experience';

function sectionStub(
  order: number,
  layout: Section['visual']['layout'],
  extra?: Partial<Section>
): Section {
  return {
    id: `section-${order}`,
    order,
    job: 'benefit',
    intent: `Section ${order}`,
    locked: false,
    visual: {
      medium: 'static',
      layout,
      desktop: { aspect: '970:600', focalHierarchy: [], textZones: [] },
      images: [],
    },
    ...extra,
  };
}

describe('planSliceStack', () => {
  it('plans exact fits', () => {
    expect(planSliceStack(300).map((slice) => slice.height)).toEqual([300]);
    expect(planSliceStack(600).map((slice) => slice.height)).toEqual([600]);
    expect(planSliceStack(900).map((slice) => slice.height)).toEqual([
      600, 300,
    ]);
    expect(planSliceStack(1200).map((slice) => slice.height)).toEqual([
      600, 600,
    ]);
  });

  it('quantizes up and computes offsets', () => {
    const slices = planSliceStack(1250); // → 1500
    expect(slices.map((slice) => slice.height)).toEqual([600, 600, 300]);
    expect(slices.map((slice) => slice.offsetY)).toEqual([0, 600, 1200]);
  });

  it('flags seam-safety on internal cuts only', () => {
    const slices = planSliceStack(1200);
    expect(slices[0]).toMatchObject({
      seamSafeTop: false,
      seamSafeBottom: true,
    });
    expect(slices[1]).toMatchObject({
      seamSafeTop: true,
      seamSafeBottom: false,
    });
  });
});

describe('sectionSliceUnits', () => {
  it('maps archetypes to quanta', () => {
    expect(
      sectionSliceUnits(sectionStub(1, { archetype: 'lifestyle-immersion' }))
    ).toBe(2);
    expect(
      sectionSliceUnits(
        sectionStub(
          1,
          { archetype: 'lifestyle-immersion' },
          { bullets: ['a', 'b', 'c', 'd'] }
        )
      )
    ).toBe(4);
    expect(
      sectionSliceUnits(
        sectionStub(1, {
          archetype: 'icon-row',
          items: [
            { icon: 'coffee', label: 'Hot' },
            { icon: 'droplet', label: 'Cold' },
          ],
        })
      )
    ).toBe(1);
    expect(
      sectionSliceUnits(
        sectionStub(1, {
          archetype: 'spec-sheet',
          rows: [{ label: 'Weight', value: '120 g' }],
        })
      )
    ).toBe(0);
  });
});

describe('compileExperienceToAplus', () => {
  const experience = liftGeneratedPackageToExperience(REPRESENTATIVE_PACKAGE);
  const deployment = compileExperienceToAplus(experience, {
    tier: 'Basic A+',
  });

  it('round-trips the lifted package (kinds, order, text, briefs, images)', () => {
    const original = REPRESENTATIVE_PACKAGE.modules;
    expect(deployment.modules.map((module) => module.type)).toEqual(
      original.map((module) => module.type)
    );
    expect(deployment.modules.map((module) => module.order)).toEqual(
      original.map((module) => module.order)
    );
    for (let i = 0; i < original.length; i++) {
      expect(moduleTextFields(deployment.modules[i])).toEqual(
        moduleTextFields(original[i])
      );
    }
    // Briefs and resolved images flow back.
    const compiledBrand = deployment.modules[0];
    if (compiledBrand.type !== 'company-logo') throw new Error('kind');
    expect(compiledBrand.background?.brief).toBe(
      'Editorial photo for brand-backdrop.'
    );
    expect(compiledBrand.background?.image?.url).toBe(
      'https://example.com/backdrop.png'
    );
    expect(compiledBrand.heroVariant).toBe('overlay');
  });

  it('classifies mapping kinds and stays within budget', () => {
    const kinds = Object.fromEntries(
      deployment.moduleMapping.map((entry) => [entry.order, entry.kind])
    );
    expect(kinds[1]).toBe('designed-image'); // brand band
    expect(kinds[4]).toBe('native'); // comparison table
    expect(deployment.validation).toEqual([]);
  });

  it('emits an over-budget error with trim guidance', () => {
    const sections = Array.from({ length: 8 }, (_, index) =>
      sectionStub(index + 1, { archetype: 'lifestyle-immersion' })
    );
    const over = compileExperienceToAplus(
      { ...experience, sections },
      { tier: 'Basic A+' }
    );
    const error = over.validation.find((entry) => entry.code === 'over-budget');
    expect(error?.level).toBe('error');
    expect(error?.message).toContain('8 Amazon modules');
    expect(error?.message).toContain('7');
  });

  it('turns tall scenes into slice stacks that spend the budget', () => {
    const tall = sectionStub(
      1,
      { archetype: 'lifestyle-immersion' },
      { bullets: ['a', 'b', 'c', 'd'] }
    );
    const compiled = compileExperienceToAplus(
      { ...experience, sections: [tall] },
      { tier: 'Basic A+' }
    );
    const entry = compiled.moduleMapping[0];
    expect(entry.kind).toBe('image-slice-stack');
    expect(entry.amazonModuleType).toBe('STANDARD_HEADER_IMAGE_TEXT');
    expect(entry.slices?.map((slice) => slice.height)).toEqual([600, 600]);
  });

  it('degrades premium media with warnings', () => {
    const video = sectionStub(1, {
      archetype: 'video',
      intent: 'Show pouring',
      source: 'ugc',
      posterFrameRole: 'poster',
    });
    const qna = sectionStub(2, {
      archetype: 'qna',
      items: [{ question: 'Dishwasher safe?', answer: 'Hand wash only.' }],
    });
    const compiled = compileExperienceToAplus(
      { ...experience, sections: [video, qna] },
      { tier: 'Basic A+' }
    );
    expect(compiled.validation.map((entry) => entry.code).sort()).toEqual([
      'qna-degraded',
      'video-degraded',
    ]);
    expect(compiled.modules[0].type).toBe('image-header-with-text');
    expect(compiled.modules[1].type).toBe('text-only');
    if (compiled.modules[1].type !== 'text-only') throw new Error('kind');
    expect(compiled.modules[1].body).toContain('Q: Dishwasher safe?');
  });
});

describe('amazonModuleTypeForKind / KIND_TO_PREMIUM', () => {
  it('covers every writable kind on both tiers', () => {
    for (const kind of Object.keys(APLUS_GENERATED_MODULE_SCHEMA_BY_KIND)) {
      if (kind === 'qna' || kind === 'hotspots' || kind === 'carousel') {
        // Premium-only kinds have no Basic deployment (the compiler degrades
        // their ARCHETYPES before these kinds ever exist on Basic).
        expect(KIND_TO_PREMIUM[kind]).toMatch(/^PREMIUM_/);
        continue;
      }
      expect(KIND_TO_AMAZON[kind]).toMatch(/^STANDARD_/);
      expect(KIND_TO_PREMIUM[kind]).toMatch(/^PREMIUM_/);
      expect(amazonModuleTypeForKind(kind, 'Basic A+')).toBe(
        KIND_TO_AMAZON[kind]
      );
      expect(amazonModuleTypeForKind(kind, 'Premium A+')).toBe(
        KIND_TO_PREMIUM[kind]
      );
    }
  });

  it('maps the premium natives 1:1', () => {
    expect(amazonModuleTypeForKind('qna', 'Premium A+')).toBe('PREMIUM_QA');
    expect(amazonModuleTypeForKind('hotspots', 'Premium A+')).toBe(
      'PREMIUM_HOTSPOTS_1'
    );
    expect(amazonModuleTypeForKind('carousel', 'Premium A+')).toBe(
      'PREMIUM_SIMPLE_IMAGE_CAROUSEL'
    );
  });
});

describe('compileExperienceToAplus — Premium tier', () => {
  const experience = liftGeneratedPackageToExperience(REPRESENTATIVE_PACKAGE);

  const premiumSections: Section[] = [
    sectionStub(1, {
      archetype: 'qna',
      items: [
        { question: 'Leak-proof?', answer: 'Yes — sealed rims.' },
        { question: 'x'.repeat(180), answer: 'Clamped question.' },
      ],
    }),
    sectionStub(2, {
      archetype: 'hotspots',
      baseImageRole: 'hotspot-base',
      hotspots: [
        {
          position: { x: 0.4, y: 0.3 },
          label: 'A label well within the premium fifty-char cap!!'.slice(
            0,
            48
          ),
          copy: 'Snug fit.',
        },
      ],
    }),
    sectionStub(3, {
      archetype: 'carousel',
      slides: [
        { imageRole: 's1', headline: 'Morning', caption: 'First pour.' },
        { imageRole: 's2', caption: 'On the move.' },
      ],
    }),
  ];

  const premium = compileExperienceToAplus(
    { ...experience, sections: premiumSections },
    { tier: 'Premium A+' }
  );

  it('compiles qna/hotspots/carousel natively — no degradation warnings', () => {
    expect(premium.format).toBe('premium-aplus');
    expect(premium.validation).toEqual([]);
    expect(premium.modules.map((module) => module.type)).toEqual([
      'qna',
      'hotspots',
      'carousel',
    ]);
    expect(
      premium.moduleMapping.every((entry) => entry.kind === 'native')
    ).toBe(true);
    expect(
      premium.moduleMapping.map((entry) => entry.amazonModuleType)
    ).toEqual([
      'PREMIUM_QA',
      'PREMIUM_HOTSPOTS_1',
      'PREMIUM_SIMPLE_IMAGE_CAROUSEL',
    ]);
  });

  it('clamps to native limits at compile time', () => {
    const qna = premium.modules[0];
    if (qna.type !== 'qna') throw new Error('kind');
    expect(qna.items[1].question).toHaveLength(120);
  });

  it('round-trips: each premium module lifts back to its archetype with content intact', () => {
    for (const module of premium.modules) {
      const section = liftModuleToSection(module, {
        id: `rt-${module.order}`,
        order: module.order,
      });
      const layout = section.visual.layout;
      if (module.type === 'qna') {
        if (layout.archetype !== 'qna') throw new Error('archetype');
        expect(layout.items[0].question).toBe('Leak-proof?');
      }
      if (module.type === 'hotspots') {
        if (layout.archetype !== 'hotspots') throw new Error('archetype');
        expect(layout.baseImageRole).toBe('hotspot-base');
        expect(layout.hotspots[0].position).toEqual({ x: 0.4, y: 0.3 });
      }
      if (module.type === 'carousel') {
        if (layout.archetype !== 'carousel') throw new Error('archetype');
        expect(layout.slides.map((slide) => slide.imageRole)).toEqual([
          's1',
          's2',
        ]);
        expect(layout.slides[0].headline).toBe('Morning');
        expect(layout.slides[1].caption).toBe('On the move.');
      }
      // Re-compiling the lifted section reproduces the module content.
      const recompiled = compileExperienceToAplus(
        { ...experience, sections: [section] },
        { tier: 'Premium A+' }
      );
      expect(moduleTextFields(recompiled.modules[0])).toEqual(
        moduleTextFields(module)
      );
    }
  });

  it('the same premium archetypes still degrade (with warnings) on Basic', () => {
    const basic = compileExperienceToAplus(
      { ...experience, sections: premiumSections },
      { tier: 'Basic A+' }
    );
    expect(basic.format).toBe('aplus');
    expect(basic.validation.map((entry) => entry.code).sort()).toEqual([
      'carousel-degraded',
      'hotspots-degraded',
      'qna-degraded',
    ]);
    expect(basic.modules.map((module) => module.type)).toEqual([
      'text-only',
      'single-image-text',
      'three-image-text',
    ]);
  });

  it('every Basic kind gets a premium-native deployment (no designed pixels except full-image bands)', () => {
    const deployment = compileExperienceToAplus(experience, {
      tier: 'Premium A+',
    });
    expect(deployment.format).toBe('premium-aplus');
    for (const entry of deployment.moduleMapping) {
      if (entry.amazonModuleType === 'PREMIUM_FULL_IMAGE') {
        expect(['designed-image', 'image-slice-stack']).toContain(entry.kind);
      } else {
        expect(entry.kind).toBe('native');
      }
    }
  });

  it('premium slice stacks cut on the all-600 grid as PREMIUM_FULL_IMAGE', () => {
    const slices = planSliceStack(1200, APLUS_SLICE_CONSTANTS.premium);
    expect(slices.map((slice) => slice.height)).toEqual([600, 600]);
    expect(slices.map((slice) => slice.offsetY)).toEqual([0, 600]);
  });

  it('mapping entries carry exact image upload dims (imageSpecs)', () => {
    const bandSpec = PREMIUM_IMAGE_SPECS['PREMIUM_HOTSPOTS_1'];
    expect(bandSpec).toMatchObject({
      width: 1464,
      height: 600,
      mobileWidth: 600,
      mobileHeight: 450,
    });
    const hotspotEntry = premium.moduleMapping[1];
    expect(hotspotEntry.imageSpecs).toEqual([
      { role: 'hotspot-base', ...bandSpec },
    ]);
    const carouselEntry = premium.moduleMapping[2];
    expect(carouselEntry.imageSpecs?.map((spec) => spec.role)).toEqual([
      's1',
      's2',
    ]);
    // qna carries no images → no specs.
    expect(premium.moduleMapping[0].imageSpecs).toBeUndefined();
    // Basic never carries specs.
    const basic = compileExperienceToAplus(experience, { tier: 'Basic A+' });
    expect(basic.moduleMapping.every((entry) => !entry.imageSpecs)).toBe(true);
  });
});
