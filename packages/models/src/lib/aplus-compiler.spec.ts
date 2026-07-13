import { moduleTextFields } from './aplus';
import {
  compileExperienceToAplus,
  planSliceStack,
  sectionSliceUnits,
} from './aplus-compiler';
import { liftGeneratedPackageToExperience } from './experience-lift';
import { REPRESENTATIVE_PACKAGE } from './experience-fixtures';
import type { Section } from './experience';

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
