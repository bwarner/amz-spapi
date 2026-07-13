import { moduleTextFields } from './aplus';
import { compileExperienceToAplus } from './aplus-compiler';
import {
  sectionTextFieldDescriptors,
  setSectionResolvedImage,
  setSectionTextField,
} from './experience-fields';
import { liftGeneratedPackageToExperience } from './experience-lift';
import { REPRESENTATIVE_PACKAGE } from './experience-fixtures';

const experience = liftGeneratedPackageToExperience(REPRESENTATIVE_PACKAGE);

describe('sectionTextFieldDescriptors', () => {
  it('covers everything the compiled build sheet shows (moduleTextFields parity)', () => {
    const deployment = compileExperienceToAplus(experience, {
      tier: 'Basic A+',
    });
    for (const entry of deployment.moduleMapping) {
      const section = experience.sections.find(
        (candidate) => candidate.id === entry.sectionIds[0]
      );
      if (!section) throw new Error('mapping without section');
      const descriptorValues = sectionTextFieldDescriptors(section).map(
        (descriptor) => descriptor.value
      );
      const module = deployment.modules[entry.order - 1];
      for (const field of moduleTextFields(module)) {
        // comparison-table joins row cells with ' | '; descriptors are per-cell
        for (const part of field.value.split(' | ')) {
          expect(descriptorValues).toContain(part);
        }
      }
    }
  });

  it('exposes image alt + brief with slot paths', () => {
    const hero = experience.sections[1];
    const descriptors = sectionTextFieldDescriptors(hero);
    const brief = descriptors.find((descriptor) =>
      descriptor.label.endsWith('image brief')
    );
    expect(brief).toMatchObject({
      value: 'Editorial photo for hero.',
      maxLength: 1200,
      multiline: true,
    });
    expect(brief?.path).toEqual(['visual', 'images', 0, 'source', 'brief']);
  });

  it('paths are unique per section', () => {
    for (const section of experience.sections) {
      const paths = sectionTextFieldDescriptors(section).map((descriptor) =>
        JSON.stringify(descriptor.path)
      );
      expect(new Set(paths).size).toBe(paths.length);
    }
  });
});

describe('setSectionTextField', () => {
  it('updates nested layout content immutably', () => {
    const comparison = experience.sections[3];
    const next = setSectionTextField(
      comparison,
      ['visual', 'layout', 'rows', 0, 'values', 1],
      'Double'
    );
    expect(next).not.toBe(comparison);
    if (next.visual.layout.archetype !== 'comparison-table')
      throw new Error('archetype');
    expect(next.visual.layout.rows[0].values).toEqual(['Triple', 'Double']);
    if (comparison.visual.layout.archetype !== 'comparison-table')
      throw new Error('archetype');
    expect(comparison.visual.layout.rows[0].values[1]).toBe('Single');
  });

  it('clears optional keys and mirrors alt onto resolved images', () => {
    const brand = experience.sections[0];
    const cleared = setSectionTextField(brand, ['subcopy'], '  ');
    expect(cleared.subcopy).toBeUndefined();

    const backdropIndex = brand.visual.images.findIndex(
      (slot) => slot.role === 'brand-backdrop'
    );
    const altEdited = setSectionTextField(
      brand,
      ['visual', 'images', backdropIndex, 'alt'],
      'Warm kraft backdrop'
    );
    const slot = altEdited.visual.images[backdropIndex];
    expect(slot.alt).toBe('Warm kraft backdrop');
    expect(slot.resolved?.alt).toBe('Warm kraft backdrop');
  });
});

describe('setSectionResolvedImage', () => {
  it('writes into the matching role and no other', () => {
    const hero = experience.sections[1];
    const next = setSectionResolvedImage(hero, 'hero', {
      url: 'https://example.com/hero.png',
    });
    expect(next.visual.images[0].resolved).toEqual({
      url: 'https://example.com/hero.png',
      alt: 'hero image',
    });
    // Unknown role → unchanged reference.
    expect(setSectionResolvedImage(hero, 'nope', { url: 'x' })).toBe(hero);
  });
});
