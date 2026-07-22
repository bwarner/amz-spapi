import {
  EVALUATION_COMPLETENESS_BUDGET,
  composeScore,
  evaluationContentHash,
  lintAplusExperience,
  trigramSimilarity,
  type JudgeDimensionKey,
} from './aplus-evaluate';
import { compileExperienceToAplus } from './aplus-compiler';
import type { Experience, Section } from './experience';

function section(
  order: number,
  layout: Section['visual']['layout'],
  extra?: Partial<Section>
): Section {
  return {
    id: `section-${order}`,
    order,
    job: 'benefit',
    intent: `Make the buyer believe claim ${order}.`,
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

function experienceOf(sections: Section[]): Experience {
  return {
    id: 'experience-1',
    title: 'Kraft cups',
    goal: 'Sell the 50-pack',
    artDirection: {
      positioning: 'p',
      visualSystem: 'v',
      mobilePrinciple: 'm',
      imagePlan: 'i',
    },
    sections,
    status: 'draft',
  };
}

const heroSlot = (role: string, url?: string) => ({
  role,
  intent: {
    subject: 'product' as const,
    mustShow: [],
    orientation: 'landscape' as const,
    productProminence: 'hero' as const,
  },
  source: { strategy: 'generate' as const, brief: `Photo for ${role}.` },
  alt: `${role} lifestyle photo`,
  ...(url ? { resolved: { url, alt: `${role} lifestyle photo` } } : {}),
});

const FACTS = { asins: ['B0TEST1'], hasBrandLogo: true };

describe('trigramSimilarity', () => {
  it('scores near-duplicates high and distinct strings low', () => {
    expect(
      trigramSimilarity('Built for comfort', 'Built for comfort!')
    ).toBeGreaterThan(0.8);
    expect(
      trigramSimilarity('Built for comfort', 'Answers every objection')
    ).toBeLessThan(0.3);
  });
});

describe('evaluationContentHash', () => {
  const experience = experienceOf([
    section(1, { archetype: 'lifestyle-immersion' }, { headline: 'Hello' }),
  ]);
  const deployment = compileExperienceToAplus(experience, {
    tier: 'Basic A+',
  });

  it('is stable for identical content and changes with copy or tier', () => {
    expect(evaluationContentHash(deployment, 'Basic A+')).toBe(
      evaluationContentHash(deployment, 'Basic A+')
    );
    expect(evaluationContentHash(deployment, 'Premium A+')).not.toBe(
      evaluationContentHash(deployment, 'Basic A+')
    );
    const edited = compileExperienceToAplus(
      experienceOf([
        section(1, { archetype: 'lifestyle-immersion' }, { headline: 'Bye' }),
      ]),
      { tier: 'Basic A+' }
    );
    expect(evaluationContentHash(edited, 'Basic A+')).not.toBe(
      evaluationContentHash(deployment, 'Basic A+')
    );
  });

  it('ignores section notes (they never render)', () => {
    const noted = compileExperienceToAplus(
      experienceOf([
        section(
          1,
          { archetype: 'lifestyle-immersion' },
          { headline: 'Hello', notes: 'try a warmer angle' }
        ),
      ]),
      { tier: 'Basic A+' }
    );
    expect(evaluationContentHash(noted, 'Basic A+')).toBe(
      evaluationContentHash(deployment, 'Basic A+')
    );
  });
});

describe('lintAplusExperience', () => {
  it('flags missing images with generate actions, honoring transient results', () => {
    const experience = experienceOf([
      section(
        1,
        { archetype: 'lifestyle-immersion' },
        { headline: 'Comfort', visual: undefined as never }
      ),
    ]);
    experience.sections[0].visual = {
      medium: 'static',
      layout: { archetype: 'lifestyle-immersion' },
      desktop: { aspect: '970:600', focalHierarchy: [], textZones: [] },
      images: [heroSlot('hero')],
    };
    const deployment = compileExperienceToAplus(experience, {
      tier: 'Basic A+',
    });
    const findings = lintAplusExperience(
      experience,
      deployment,
      'Basic A+',
      FACTS
    );
    const missing = findings.find((finding) => finding.id === 'missing-image');
    expect(missing).toMatchObject({
      severity: 'critical',
      points: 4,
      action: { type: 'generate-image', moduleOrder: 1, role: 'hero' },
    });

    // The same slot freshly generated (transient) → no finding.
    const quiet = lintAplusExperience(experience, deployment, 'Basic A+', {
      ...FACTS,
      resolvedSlotKeys: ['1:hero'],
    });
    expect(quiet.some((finding) => finding.id === 'missing-image')).toBe(false);
  });

  it('flags guardrail hits on rendered fields with the field path', () => {
    const experience = experienceOf([
      section(
        1,
        { archetype: 'lifestyle-immersion' },
        { headline: 'Now 50% off with free shipping' }
      ),
    ]);
    const deployment = compileExperienceToAplus(experience, {
      tier: 'Basic A+',
    });
    const hit = lintAplusExperience(
      experience,
      deployment,
      'Basic A+',
      FACTS
    ).find((finding) => finding.id === 'guardrail-hit');
    expect(hit).toMatchObject({
      severity: 'critical',
      action: { type: 'edit-field' },
      fieldPath: ['headline'],
    });
  });

  it('flags intent leaks, duplicate headlines, weak openers, adjacency', () => {
    const experience = experienceOf([
      section(1, {
        archetype: 'spec-sheet',
        rows: [{ label: 'Weight', value: '120 g' }],
      }),
      section(
        2,
        { archetype: 'lifestyle-immersion' },
        { headline: 'Make the buyer believe claim 2.' } // == its intent
      ),
      section(
        3,
        { archetype: 'lifestyle-immersion' },
        { headline: 'Comfort in every hold' }
      ),
      section(
        4,
        { archetype: 'problem-solution' },
        { headline: 'Comfort in every hold!' }
      ),
    ]);
    const deployment = compileExperienceToAplus(experience, {
      tier: 'Basic A+',
    });
    const ids = lintAplusExperience(
      experience,
      deployment,
      'Basic A+',
      FACTS
    ).map((finding) => finding.id);
    expect(ids).toContain('weak-opener');
    expect(ids).toContain('intent-leak');
    expect(ids).toContain('duplicate-headline');
    expect(ids).toContain('adjacent-archetype');
  });

  it('suggests premium natives when objections exist but none are used', () => {
    const experience = experienceOf([
      section(1, { archetype: 'lifestyle-immersion' }, { headline: 'Hook' }),
    ]);
    const deployment = compileExperienceToAplus(experience, {
      tier: 'Premium A+',
    });
    const findings = lintAplusExperience(experience, deployment, 'Premium A+', {
      ...FACTS,
      objections: 'Will the lids leak?',
    });
    expect(
      findings.find((finding) => finding.id === 'premium-unused')
    ).toMatchObject({ action: { type: 'switch-archetype', archetype: 'qna' } });
  });

  it('flags clustered and edge hotspot markers', () => {
    const experience = experienceOf([
      section(1, { archetype: 'lifestyle-immersion' }, { headline: 'Opener' }),
      section(2, {
        archetype: 'hotspots',
        baseImageRole: 'base',
        hotspots: [
          { position: { x: 0.5, y: 0.5 }, label: 'A', copy: 'a' },
          { position: { x: 0.52, y: 0.52 }, label: 'B', copy: 'b' },
        ],
      }),
    ]);
    const deployment = compileExperienceToAplus(experience, {
      tier: 'Premium A+',
    });
    const finding = lintAplusExperience(
      experience,
      deployment,
      'Premium A+',
      FACTS
    ).find((candidate) => candidate.id === 'hotspot-layout');
    expect(finding?.message).toContain('clustered');
    expect(finding?.action.type).toBe('regenerate-section');
  });

  it('flags missing asins and missing brand logo', () => {
    const experience = experienceOf([
      section(
        1,
        {
          archetype: 'brand-story-band',
          presentation: 'logo-band',
        },
        { headline: 'Brand' }
      ),
    ]);
    const deployment = compileExperienceToAplus(experience, {
      tier: 'Basic A+',
    });
    const ids = lintAplusExperience(experience, deployment, 'Basic A+', {
      asins: [],
      hasBrandLogo: false,
    }).map((finding) => finding.id);
    expect(ids).toContain('no-asins');
    expect(ids).toContain('no-brand-logo');
  });
});

describe('composeScore', () => {
  it('is completeness-only without a judge and caps penalties at the budget', () => {
    expect(composeScore([])).toEqual({
      overall: EVALUATION_COMPLETENESS_BUDGET,
      completeness: EVALUATION_COMPLETENESS_BUDGET,
    });
    const heavy = Array.from({ length: 30 }, () => ({
      id: 'x',
      severity: 'critical' as const,
      points: 4,
      action: { type: 'none' as const },
      message: '',
      suggestion: '',
    }));
    expect(composeScore(heavy).completeness).toBe(0);
  });

  it('blends judge dimensions into 0–100 with the documented weights', () => {
    const perfect = Object.fromEntries(
      (
        [
          'factGrounding',
          'benefitClarity',
          'hookStrength',
          'objectionCoverage',
          'narrativeFlow',
          'copyCraft',
        ] as JudgeDimensionKey[]
      ).map((key) => [key, { score: 100 }])
    ) as Record<JudgeDimensionKey, { score: number }>;
    expect(composeScore([], perfect)).toEqual({
      overall: 100,
      completeness: 40,
      quality: 60,
    });
    const mixed = { ...perfect, factGrounding: { score: 0 } };
    // Losing all of factGrounding (weight .25) costs 15 of the 60.
    expect(composeScore([], mixed).quality).toBe(45);
  });
});
