import {
  APlusGeneratedModuleSchema,
  amazonModuleTypeToKind,
  applyAPlusGuardrails,
  moduleImageSlots,
  moduleTextFields,
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

describe('applyAPlusGuardrails', () => {
  it('strips price and delivery claims', () => {
    const { cleaned, triggered } = applyAPlusGuardrails(
      'Only $19.99 with free shipping'
    );
    expect(cleaned).not.toMatch(/\$|free shipping/i);
    expect(triggered.length).toBeGreaterThan(0);
  });
});
