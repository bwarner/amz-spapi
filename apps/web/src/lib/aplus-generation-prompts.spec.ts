import { RENDERABLE_AMAZON_MODULE_TYPES } from '@farvisionllc/models';
import {
  aplusModuleLimitForTier,
  buildModuleCopyGuidanceBlock,
  buildModuleCopyRulesPreview,
  buildStrategyPrompt,
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

describe('buildStrategyPrompt', () => {
  it('embeds the module count and the renderable type list', () => {
    const prompt = buildStrategyPrompt({
      contextJson: '{"product":{}}',
      moduleCount: 5,
    });
    expect(prompt).toContain('exactly 5 modulePlan entries');
    for (const type of RENDERABLE_AMAZON_MODULE_TYPES) {
      expect(prompt).toContain(type);
    }
    expect(prompt).not.toContain('STANDARD_DUAL_USE_SPLIT');
    expect(prompt).not.toContain('STANDARD_ICON_ROW');
    expect(prompt.endsWith('{"product":{}}')).toBe(true);
  });

  it('appends guidance after the compliance rules, only when provided', () => {
    const without = buildStrategyPrompt({ contextJson: '{}', moduleCount: 5 });
    expect(without).not.toContain('SELLER GUIDANCE');

    const withGuidance = buildStrategyPrompt({
      contextJson: '{}',
      moduleCount: 5,
      guidance: 'Lean into eco-friendly angles.',
    });
    expect(withGuidance).toContain('SELLER GUIDANCE — STRATEGY');
    expect(withGuidance).toContain('Lean into eco-friendly angles.');
    // Compliance rules stay ahead of (and win over) guidance.
    expect(
      withGuidance.indexOf('NEVER plan modules around price')
    ).toBeLessThan(withGuidance.indexOf('SELLER GUIDANCE'));
    // Blank guidance is dropped entirely.
    expect(
      buildStrategyPrompt({ contextJson: '{}', moduleCount: 5, guidance: '  ' })
    ).not.toContain('SELLER GUIDANCE');
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
  it('rules preview includes compliance and no legacy module rules', () => {
    const preview = buildModuleCopyRulesPreview();
    expect(preview).toContain('NO TIME-SENSITIVE CLAIMS');
    expect(preview).toContain('SUBJECT PRODUCT ONLY');
    expect(preview).not.toContain('dual-use-split');
    expect(preview).not.toContain('icon-row');
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
