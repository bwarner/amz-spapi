import { liftGeneratedPackageToExperience } from './experience-lift';

import { REPRESENTATIVE_PACKAGE } from './experience-fixtures';

describe('liftGeneratedPackageToExperience', () => {
  const experience = liftGeneratedPackageToExperience(REPRESENTATIVE_PACKAGE);

  it('lifts package-level fields losslessly', () => {
    expect(experience.title).toBe('Kraft cups A+ package');
    expect(experience.goal).toBe('Premium 50-pack story.');
    expect(experience.artDirection).toEqual(
      REPRESENTATIVE_PACKAGE.creativeDirection
    );
    expect(experience.sections).toHaveLength(6);
    expect(experience.sections.map((section) => section.order)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it('maps kinds to jobs and archetypes per the reuse table', () => {
    const byOrder = (order: number) =>
      experience.sections.find((section) => section.order === order);
    expect(byOrder(1)).toMatchObject({
      job: 'hook',
      visual: {
        layout: {
          archetype: 'brand-story-band',
          presentation: 'logo-band',
          placement: 'header',
          heroVariant: 'overlay',
        },
      },
    });
    expect(byOrder(2)).toMatchObject({
      // 'hook' is reserved for the first module; the overlay follows the brand band.
      job: 'benefit',
      headline: '50 cups, zero fuss',
      visual: {
        layout: { archetype: 'full-bleed-hero', badge: '50-PACK' },
      },
    });
    expect(byOrder(3)).toMatchObject({
      job: 'benefit',
      bullets: ['Cool to hold', 'No leaks'],
      visual: { layout: { archetype: 'split-LR', imagePosition: 'right' } },
    });
    expect(byOrder(4)).toMatchObject({
      job: 'comparison',
      visual: { layout: { archetype: 'comparison-table' } },
    });
    expect(byOrder(5)).toMatchObject({
      job: 'use-cases',
      visual: { layout: { archetype: 'dual-use-split' } },
    });
    expect(byOrder(6)).toMatchObject({
      job: 'benefit',
      visual: { layout: { archetype: 'icon-row' } },
    });
  });

  it('preserves briefs and resolved images on slots', () => {
    const brandSection = experience.sections[0];
    const backdrop = brandSection.visual.images.find(
      (imageSlot) => imageSlot.role === 'brand-backdrop'
    );
    expect(backdrop?.source).toMatchObject({
      strategy: 'generate',
      brief: 'Editorial photo for brand-backdrop.',
    });
    expect(backdrop?.resolved?.url).toBe('https://example.com/backdrop.png');
    expect(backdrop?.intent.subject).toBe('background');
    expect(backdrop?.intent.orientation).toBe('landscape');
  });

  it('beats override job/intent; the beat-less footer keeps inference', () => {
    const withBeats = liftGeneratedPackageToExperience(REPRESENTATIVE_PACKAGE, {
      beats: [
        {
          order: 2,
          job: 'differentiation',
          archetype: 'full-bleed-hero',
          intent: 'Stand apart from flimsy single-wall cups.',
          assetsToUse: [],
        },
      ],
    });
    const overridden = withBeats.sections.find((s) => s.order === 2);
    expect(overridden).toMatchObject({
      job: 'differentiation',
      intent: 'Stand apart from flimsy single-wall cups.',
      visual: { layout: { archetype: 'full-bleed-hero' } },
    });
    // Module 1 (company-logo header) had no beat → inference applies.
    expect(withBeats.sections[0].job).toBe('hook');
  });

  it('a beat never mislabels a module of a different kind (auto-footer case)', () => {
    // Only 1 of 2 planned sections got written; the auto-footer took order 2.
    // Beat 2 (split-LR) must NOT override the footer's inferred brand job.
    const withFooter = liftGeneratedPackageToExperience(
      {
        ...REPRESENTATIVE_PACKAGE,
        modules: [
          REPRESENTATIVE_PACKAGE.modules[1], // image-text-overlay, order 2
          {
            order: 2,
            amazonModuleType: 'STANDARD_COMPANY_LOGO',
            title: 'Brand footer',
            type: 'company-logo',
            logo: {
              role: 'logo',
              brief: 'Brand logo.',
              size: '1024x1024',
              alt: 'Brand logo',
            },
            placement: 'footer',
          },
        ].map((module, index) => ({ ...module, order: index + 1 })),
      },
      {
        beats: [
          {
            order: 1,
            job: 'hook',
            archetype: 'full-bleed-hero',
            intent: 'Open strong.',
            assetsToUse: [],
          },
          {
            order: 2,
            job: 'differentiation',
            archetype: 'split-LR',
            intent: 'Prove the advantage.',
            assetsToUse: [],
          },
        ],
      }
    );
    expect(withFooter.sections[0].job).toBe('hook');
    // Footer keeps its inferred brand job — beat 2's kind doesn't match.
    expect(withFooter.sections[1].job).toBe('brand');
    expect(withFooter.sections[1].intent).not.toBe('Prove the advantage.');
  });

  it('never throws on a minimal module', () => {
    const experience = liftGeneratedPackageToExperience({
      title: 't',
      executiveSummary: 's',
      creativeDirection: {
        positioning: 'p',
        visualSystem: 'v',
        mobilePrinciple: 'm',
        imagePlan: 'i',
      },
      modules: [
        {
          order: 1,
          amazonModuleType: 'STANDARD_PRODUCT_DESCRIPTION',
          title: 'Story',
          type: 'text-only',
          body: 'Body.',
        },
      ],
    });
    expect(experience.sections[0].visual.layout).toMatchObject({
      archetype: 'brand-story-band',
      presentation: 'text-band',
    });
    expect(experience.sections[0].subcopy).toBe('Body.');
  });
});
