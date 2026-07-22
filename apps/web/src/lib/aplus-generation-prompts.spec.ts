import {
  APLUS_PLANNABLE_ARCHETYPES,
  CONVERSION_JOBS,
  PREMIUM_PLANNABLE_ARCHETYPES,
} from '@farvisionllc/models';
import {
  aplusModuleLimitForTier,
  buildFactSheetBlock,
  buildModuleCopyGuidanceBlock,
  buildModuleCopyRulesPreview,
  buildNarrativeContextBlock,
  buildNarrativePlanPrompt,
  buildShotBibleBlock,
  compactGenerationInput,
  humanProductName,
  type APlusGenerateInputForPrompt,
} from './aplus-generation-prompts';

const input: APlusGenerateInputForPrompt = {
  productName: 'Kraft Ripple Cups',
  asin: 'B000TEST00',
  contentTier: 'Basic A+',
  pricePoint: '$24.99',
  keyFeatures: 'Triple-wall insulation',
  sources: [
    { kind: 'Product listing', url: 'https://example.com/listing' },
    { kind: 'Competitor', url: '   ' },
  ],
  assets: [
    {
      fileName: 'hero.png',
      description: 'Assembled cup',
      asset: { assetId: 'asset_123', mimeType: 'image/png' },
      uploadStatus: 'uploaded',
    },
  ],
};

describe('buildNarrativePlanPrompt', () => {
  it('embeds the beat count, jobs, archetypes, skeleton, and footer rule', () => {
    const prompt = buildNarrativePlanPrompt({
      contextJson: '{"product":{}}',
      beatCount: 5,
    });
    expect(prompt).toContain('Plan EXACTLY 5 beats');
    expect(prompt).toContain('never spend a slot on a bare logo band');
    expect(prompt).toContain('NEVER echo supplier listing titles');
    expect(prompt).toContain('NEVER open with comparison-table');
    expect(prompt).toContain(
      'never use the same archetype in two consecutive beats'
    );
    expect(prompt).toContain('hook \u2192 (problem) \u2192 benefits');
    for (const job of CONVERSION_JOBS) {
      expect(prompt).toContain(job);
    }
    for (const archetype of APLUS_PLANNABLE_ARCHETYPES) {
      expect(prompt).toContain(archetype);
    }
    expect(prompt).not.toContain('stat-band');
    expect(prompt.endsWith('{"product":{}}')).toBe(true);
  });

  it('appends guidance after the compliance rules, only when provided', () => {
    const without = buildNarrativePlanPrompt({
      contextJson: '{}',
      beatCount: 5,
    });
    expect(without).not.toContain('SELLER GUIDANCE');

    const withGuidance = buildNarrativePlanPrompt({
      contextJson: '{}',
      beatCount: 5,
      guidance: 'Lean into eco-friendly angles.',
    });
    expect(withGuidance).toContain('SELLER GUIDANCE \u2014 STRATEGY');
    expect(withGuidance).toContain('Lean into eco-friendly angles.');
    // Compliance rules stay ahead of (and win over) guidance.
    expect(withGuidance.indexOf('NEVER plan beats around price')).toBeLessThan(
      withGuidance.indexOf('SELLER GUIDANCE')
    );
    // Blank guidance is dropped entirely.
    expect(
      buildNarrativePlanPrompt({
        contextJson: '{}',
        beatCount: 5,
        guidance: '  ',
      })
    ).not.toContain('SELLER GUIDANCE');
  });

  it('Basic prompt never mentions premium archetypes or the premium block', () => {
    const prompt = buildNarrativePlanPrompt({
      contextJson: '{}',
      beatCount: 5,
      tier: 'Basic A+',
    });
    expect(prompt).not.toContain('PREMIUM A+ ARCHETYPES');
    expect(prompt).not.toContain('qna');
    expect(prompt).not.toContain('hotspots');
    expect(prompt).not.toContain('carousel');
  });

  it('Premium tier lists all 13 archetypes and the premium guidance block', () => {
    const prompt = buildNarrativePlanPrompt({
      contextJson: '{}',
      beatCount: 7,
      tier: 'Premium A+',
    });
    expect(PREMIUM_PLANNABLE_ARCHETYPES).toHaveLength(13);
    for (const archetype of PREMIUM_PLANNABLE_ARCHETYPES) {
      expect(prompt).toContain(archetype);
    }
    expect(prompt).toContain('PREMIUM A+ ARCHETYPES');
    expect(prompt).toContain('AT MOST ONCE per page');
    expect(prompt).toContain('buyer.mainObjections has substantive entries');
    expect(prompt).toContain('3–6 labeled feature callouts');
    expect(prompt).toContain('2–6 slides, one idea per slide');
    expect(prompt).toContain('Plan EXACTLY 7 beats');
  });
});

describe('fact discipline', () => {
  it('fact sheet carries seller lines verbatim', () => {
    const block = buildFactSheetBlock({
      keyFeatures: 'Double-wall ripple construction\n50 cups + 50 black lids',
      differentiators: 'Thicker than typical single-wall cups',
    });
    expect(block).toContain('FACT SHEET');
    expect(block).toContain('\u2022 Double-wall ripple construction');
    expect(block).toContain('\u2022 50 cups + 50 black lids');
    expect(block).toContain('\u2022 Thicker than typical single-wall cups');
  });

  it('rules preview includes the consistency rule', () => {
    const preview = buildModuleCopyRulesPreview();
    expect(preview).toContain('FACT DISCIPLINE');
    expect(preview).toContain('never paraphrase upward');
  });
});

describe('buildNarrativeContextBlock', () => {
  const beats = [
    {
      order: 1,
      job: 'hook' as const,
      archetype: 'full-bleed-hero' as const,
      intent: 'Open strong.',
    },
    {
      order: 2,
      job: 'proof' as const,
      archetype: 'spec-sheet' as const,
      intent: 'Answer questions.',
    },
  ];

  it('names the target beat and lists siblings', () => {
    const block = buildNarrativeContextBlock(beats, 2);
    expect(block).toContain('ONLY beat #2');
    expect(block).toContain('Open strong.');
    expect(block).toContain('add NEW information');
  });

  it('whole-package variant has no target', () => {
    expect(buildNarrativeContextBlock(beats)).not.toContain('ONLY beat');
  });
});

describe('buildShotBibleBlock', () => {
  it('names the product and the visual system', () => {
    const block = buildShotBibleBlock({
      productName: 'Kraft Cups',
      visualSystem: 'Warm kraft palette.',
    });
    expect(block).toContain('SAME HERO PRODUCT in every image: Kraft Cups');
    expect(block).toContain('Warm kraft palette.');
  });
});

describe('compactGenerationInput', () => {
  it('omits price and drops blank source urls', () => {
    const json = compactGenerationInput(input);
    expect(json).not.toContain('24.99');
    expect(json).not.toContain('pricePoint');
    const parsed = JSON.parse(json);
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.assets[0]).toMatchObject({
      fileName: 'hero.png',
      assetId: 'asset_123',
      status: 'uploaded',
    });
  });
});

describe('module copy prompt pieces', () => {
  it('rules preview includes compliance and the icon allowlist', () => {
    const preview = buildModuleCopyRulesPreview();
    expect(preview).toContain('NO TIME-SENSITIVE CLAIMS');
    expect(preview).toContain('SUBJECT PRODUCT ONLY');
    expect(preview).not.toContain('dual-use-split');
    // Writers must pick icons from the supported glyph set (unknown names
    // render as fallback shapes).
    expect(preview).toContain('icon MUST be one of exactly: coffee,');
  });

  it('wraps module-copy guidance with the precedence note', () => {
    const block = buildModuleCopyGuidanceBlock('Punchier headlines please. ');
    expect(block).toContain('SELLER GUIDANCE — MODULE COPY');
    expect(block).toContain('Punchier headlines please.');
    expect(block).toContain('which always win');
  });
});

describe('helpers', () => {
  it('maps tiers to module limits', () => {
    expect(aplusModuleLimitForTier('Basic A+')).toBe(5);
    expect(aplusModuleLimitForTier('Premium A+')).toBe(7);
  });

  it('falls back through product name → asin → generic', () => {
    expect(humanProductName({ productName: ' Cups ' })).toBe('Cups');
    expect(humanProductName({ asin: 'B0X' })).toBe('B0X');
    expect(humanProductName({})).toBe('this product');
  });
});
