import {
  liftGeneratedPackageToExperience,
  liftModuleToSection,
} from './experience-lift';

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

  it('lifts premium kinds with positions, captions, briefs, and resolved images intact', () => {
    const qna = liftModuleToSection(
      {
        order: 1,
        amazonModuleType: 'PREMIUM_QA',
        title: 'Q&A',
        type: 'qna',
        headline: 'Your questions',
        items: [{ question: 'Leak-proof?', answer: 'Yes — sealed rims.' }],
      },
      { id: 's1', order: 1 }
    );
    expect(qna.job).toBe('proof');
    expect(qna.headline).toBe('Your questions');
    if (qna.visual.layout.archetype !== 'qna') throw new Error('archetype');
    expect(qna.visual.layout.items).toEqual([
      { question: 'Leak-proof?', answer: 'Yes — sealed rims.' },
    ]);

    const hotspots = liftModuleToSection(
      {
        order: 2,
        amazonModuleType: 'PREMIUM_HOTSPOTS_1',
        title: 'Feature tour',
        type: 'hotspots',
        image: {
          role: 'hotspot-base',
          brief: 'Whole product on a counter.',
          size: '1792x1024',
          alt: 'Cup with lid',
          image: { url: 'https://example.com/base.png', alt: 'Cup with lid' },
        },
        hotspots: [
          {
            position: { x: 0.25, y: 0.75 },
            label: 'Snap lid',
            copy: 'Seals tight.',
          },
        ],
      },
      { id: 's2', order: 2 }
    );
    expect(hotspots.job).toBe('how-it-works');
    if (hotspots.visual.layout.archetype !== 'hotspots')
      throw new Error('archetype');
    expect(hotspots.visual.layout.baseImageRole).toBe('hotspot-base');
    expect(hotspots.visual.layout.hotspots[0].position).toEqual({
      x: 0.25,
      y: 0.75,
    });
    expect(hotspots.visual.images[0]).toMatchObject({
      role: 'hotspot-base',
      source: { brief: 'Whole product on a counter.' },
      resolved: { url: 'https://example.com/base.png' },
    });

    const carousel = liftModuleToSection(
      {
        order: 3,
        amazonModuleType: 'PREMIUM_SIMPLE_IMAGE_CAROUSEL',
        title: 'Day in the life',
        type: 'carousel',
        slides: [
          {
            image: {
              role: 's1',
              brief: 'Morning kitchen scene.',
              size: '1024x1024',
              alt: 'Morning pour',
            },
            headline: 'Morning',
            caption: 'First pour.',
          },
          {
            image: {
              role: 's2',
              brief: 'Commuter scene.',
              size: '1024x1024',
              alt: 'On the go',
            },
            caption: 'On the move.',
          },
        ],
      },
      { id: 's3', order: 3 }
    );
    expect(carousel.job).toBe('use-cases');
    if (carousel.visual.layout.archetype !== 'carousel')
      throw new Error('archetype');
    expect(carousel.visual.layout.slides).toEqual([
      { imageRole: 's1', headline: 'Morning', caption: 'First pour.' },
      { imageRole: 's2', headline: undefined, caption: 'On the move.' },
    ]);
    expect(carousel.visual.images.map((slot) => slot.role)).toEqual([
      's1',
      's2',
    ]);
    expect(carousel.visual.images[0].source.brief).toBe(
      'Morning kitchen scene.'
    );
  });
});
