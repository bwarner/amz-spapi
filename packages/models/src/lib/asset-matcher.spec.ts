import {
  desiredAffordance,
  matchAssetToIntent,
  type AssetCandidate,
} from './asset-matcher.js';
import type { AssetProfile } from './asset-profile.js';
import type { ImageIntent } from './experience.js';

function profile(overrides: Partial<AssetProfile> = {}): AssetProfile {
  return {
    role: 'product-iso',
    subjectPresent: true,
    subjectProminence: 'hero',
    subjectPosition: 'center',
    negativeSpace: { side: 'none', amount: 'low' },
    background: 'white',
    affordances: ['comparison-thumb'],
    hasBakedText: false,
    isRender: false,
    dominantColors: ['#8b5a2b'],
    description: 'A kraft paper cup on a white background.',
    orientation: 'square',
    ...overrides,
  };
}

function asset(
  assetId: string,
  overrides: Partial<AssetProfile> = {}
): AssetCandidate {
  return { assetId, profile: profile(overrides) };
}

function intent(overrides: Partial<ImageIntent> = {}): ImageIntent {
  return {
    subject: 'product',
    mustShow: [],
    orientation: 'square',
    productProminence: 'hero',
    ...overrides,
  };
}

describe('desiredAffordance', () => {
  it('maps what the scene shows to how an asset would be used', () => {
    expect(desiredAffordance(intent({ subject: 'background' }))).toBe(
      'backdrop-layer'
    );
    expect(desiredAffordance(intent({ subject: 'detail' }))).toBe(
      'feature-callout'
    );
    expect(desiredAffordance(intent({ subject: 'scene' }))).toBe('hero-bg');
    expect(
      desiredAffordance(
        intent({ subject: 'product', productProminence: 'soft' })
      )
    ).toBe('carousel-tile');
  });
});

describe('matchAssetToIntent — placing a real photo', () => {
  it('places a photo that affords the slot, matches prominence and orientation', () => {
    const match = matchAssetToIntent(intent(), [asset('a1')]);

    expect(match.strategy).toBe('place');
    expect(match.assetId).toBe('a1');
    expect(match.score?.affordance).toBe(3);
    expect(match.score?.prominence).toBe(2);
    expect(match.reasons).toContain('affords comparison-thumb');
  });

  it('scores the negative-space side, because that is where the copy goes', () => {
    const wantsLeft = intent({
      subject: 'scene',
      orientation: 'landscape',
      negativeSpace: { side: 'left', amount: 'medium' },
    });
    const candidates = [
      asset('right-space', {
        role: 'product-in-scene',
        affordances: ['hero-bg'],
        orientation: 'landscape',
        negativeSpace: { side: 'right', amount: 'high' },
      }),
      asset('left-space', {
        role: 'product-in-scene',
        affordances: ['hero-bg'],
        orientation: 'landscape',
        negativeSpace: { side: 'left', amount: 'high' },
      }),
    ];

    const match = matchAssetToIntent(wantsLeft, candidates);

    expect(match.strategy).toBe('place');
    expect(match.assetId).toBe('left-space');
    // +1 orientation, +2 side, +1 amount at least as generous as asked.
    expect(match.score?.composition).toBe(4);
  });

  it('refuses to place an image with baked-in text, but keeps it as a reference', () => {
    const match = matchAssetToIntent(intent(), [
      asset('texty', { hasBakedText: true }),
    ]);

    expect(match.strategy).toBe('reference-generate');
    expect(match.referenceAssetIds).toEqual(['texty']);
    // The seller needs to know WHY their photo was not used.
    expect(
      match.reasons.some((reason) => reason.includes('baked-in text'))
    ).toBe(true);
  });

  it('refuses to place a hero product shot into a slot that wants no product', () => {
    const backdropSlot = intent({
      subject: 'background',
      productProminence: 'absent',
    });

    const match = matchAssetToIntent(backdropSlot, [
      asset('hero', { affordances: ['backdrop-layer'] }),
    ]);

    expect(match.strategy).not.toBe('place');
  });

  it('refuses to place an asset that shows none of what the scene requires', () => {
    const needsLid = intent({ mustShow: ['snap-on lid'] });

    const match = matchAssetToIntent(needsLid, [
      asset('no-lid', {
        description: 'A plain kraft cup, no lid, on white.',
        affordances: ['comparison-thumb'],
      }),
    ]);

    expect(match.strategy).not.toBe('place');
    expect(
      match.reasons.some((reason) => reason.includes('shows none of'))
    ).toBe(true);
  });

  it('rewards an asset that shows everything required', () => {
    const needsLid = intent({ mustShow: ['lid', 'kraft'] });

    const match = matchAssetToIntent(needsLid, [
      asset('both', {
        description: 'A kraft cup with a snap-on lid on white.',
      }),
    ]);

    expect(match.strategy).toBe('place');
    expect(match.score?.mustShow).toBe(2);
  });

  it('counts an exact palette match as brand fit and nothing else', () => {
    const branded = intent({ paletteRefs: ['#8B5A2B'] });
    const near = intent({ paletteRefs: ['#8b5a2c'] });

    expect(matchAssetToIntent(branded, [asset('a1')]).score?.brandFit).toBe(1);
    // A near miss scores zero rather than an invented similarity.
    expect(matchAssetToIntent(near, [asset('a1')]).score?.brandFit).toBe(0);
  });

  it('penalises a busy background only when the scene needs room for copy', () => {
    const overlay = intent({
      subject: 'scene',
      orientation: 'landscape',
      negativeSpace: { side: 'left', amount: 'high' },
    });
    const busy = asset('busy', {
      role: 'product-in-scene',
      affordances: ['hero-bg'],
      background: 'busy',
      orientation: 'landscape',
      negativeSpace: { side: 'left', amount: 'high' },
    });

    const match = matchAssetToIntent(overlay, [busy]);
    expect(match.score?.quality).toBe(0);
    expect(
      match.reasons.some((reason) => reason.includes('busy background'))
    ).toBe(true);
  });
});

describe('matchAssetToIntent — when nothing fits', () => {
  it('composites a real backdrop with a real product rather than inventing either', () => {
    const sceneSlot = intent({
      subject: 'scene',
      orientation: 'landscape',
      productProminence: 'soft',
    });

    const match = matchAssetToIntent(sceneSlot, [
      asset('kitchen', {
        role: 'background',
        subjectPresent: false,
        subjectProminence: 'absent',
        affordances: ['backdrop-layer'],
        orientation: 'landscape',
        description: 'An empty kitchen counter.',
      }),
      asset('cup'),
    ]);

    expect(match.strategy).toBe('composite');
    expect(match.assetId).toBe('kitchen');
    expect(match.referenceAssetIds).toEqual(['cup']);
  });

  it('conditions generation on product photos when only products exist', () => {
    const sceneSlot = intent({ subject: 'scene', orientation: 'landscape' });

    const match = matchAssetToIntent(sceneSlot, [asset('cup')]);

    expect(match.strategy).toBe('reference-generate');
    expect(match.referenceAssetIds).toEqual(['cup']);
  });

  it('prefers an isolated product on a clean background as the reference', () => {
    const sceneSlot = intent({ subject: 'scene', orientation: 'landscape' });

    const match = matchAssetToIntent(sceneSlot, [
      asset('in-scene', {
        role: 'product-in-scene',
        background: 'real-environment',
      }),
      asset('iso', { role: 'product-iso', background: 'white' }),
    ]);

    expect(match.referenceAssetIds?.[0]).toBe('iso');
  });

  it('sends at most two references', () => {
    const sceneSlot = intent({ subject: 'scene', orientation: 'landscape' });
    const match = matchAssetToIntent(sceneSlot, [
      asset('a'),
      asset('b'),
      asset('c'),
    ]);

    expect(match.referenceAssetIds).toHaveLength(2);
  });

  it('generates from nothing when there is no product photo at all', () => {
    const match = matchAssetToIntent(intent({ subject: 'background' }), [
      asset('backdrop', {
        role: 'background',
        subjectPresent: false,
        subjectProminence: 'absent',
        affordances: ['backdrop-layer'],
      }),
    ]);

    expect(match.strategy).toBe('generate');
    expect(match.referenceAssetIds).toBeUndefined();
  });

  it('generates when there are no assets', () => {
    const match = matchAssetToIntent(intent(), []);
    expect(match.strategy).toBe('generate');
    expect(match.reasons).toEqual(['no assets available']);
  });

  it('always explains itself', () => {
    for (const match of [
      matchAssetToIntent(intent(), [asset('a1')]),
      matchAssetToIntent(intent(), []),
      matchAssetToIntent(intent(), [asset('t', { hasBakedText: true })]),
    ]) {
      expect(match.reasons.length).toBeGreaterThan(0);
    }
  });
});
