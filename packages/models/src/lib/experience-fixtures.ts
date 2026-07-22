import type { APlusGeneratedModule } from './aplus.js';

// Shared test fixture: a representative generated package covering one
// module of each family (incl. legacy dual-use-split / icon-row).
// Test-only -- intentionally NOT exported from the package index.

const slot = (role: string, size: '1792x1024' | '1024x1024' = '1792x1024') => ({
  role,
  brief: `Editorial photo for ${role}.`,
  size,
  alt: `${role} image`,
});

export const REPRESENTATIVE_MODULES: APlusGeneratedModule[] = [
  {
    order: 1,
    amazonModuleType: 'STANDARD_COMPANY_LOGO',
    title: 'Brand hero',
    type: 'company-logo',
    logo: { ...slot('logo', '1024x1024') },
    headline: 'Sellavant Kraft Cups',
    tagline: 'Better every sip',
    background: {
      ...slot('brand-backdrop'),
      image: { url: 'https://example.com/backdrop.png', alt: 'Backdrop' },
    },
    heroVariant: 'overlay',
    logoCorner: 'bottom-left',
  },
  {
    order: 2,
    amazonModuleType: 'STANDARD_IMAGE_TEXT_OVERLAY',
    title: 'Hero opening',
    type: 'image-text-overlay',
    image: slot('hero'),
    headline: '50 cups, zero fuss',
    body: 'Triple-wall comfort for every pour.',
    overlayPosition: 'left',
    badge: '50-PACK',
  },
  {
    order: 3,
    amazonModuleType: 'STANDARD_SINGLE_SIDE_IMAGE',
    title: 'Grip that works',
    type: 'image-and-text',
    image: slot('grip', '1024x1024'),
    imagePosition: 'right',
    headline: 'Ripple grip',
    body: 'No sleeves needed.',
    bullets: ['Cool to hold', 'No leaks'],
  },
  {
    order: 4,
    amazonModuleType: 'STANDARD_COMPARISON_TABLE',
    title: 'Compare',
    type: 'comparison-table',
    products: [
      { title: 'Ours', highlight: true, image: slot('thumb-1', '1024x1024') },
      { title: 'Theirs' },
    ],
    rows: [{ label: 'Walls', values: ['Triple', 'Single'] }],
  },
  {
    order: 5,
    amazonModuleType: 'STANDARD_DUAL_USE_SPLIT',
    title: 'Hot & cold',
    type: 'dual-use-split',
    panels: [
      { image: slot('hot', '1024x1024'), label: 'HOT', caption: 'Coffee' },
      { image: slot('cold', '1024x1024'), label: 'COLD', caption: 'Iced tea' },
    ],
  },
  {
    order: 6,
    amazonModuleType: 'STANDARD_ICON_ROW',
    title: 'Benefits',
    type: 'icon-row',
    items: [
      { icon: 'coffee', label: 'Hot drinks' },
      { icon: 'droplet', label: 'Cold drinks' },
    ],
  },
];

export const REPRESENTATIVE_PACKAGE = {
  title: 'Kraft cups A+ package',
  executiveSummary: 'Premium 50-pack story.',
  creativeDirection: {
    positioning: 'Premium daily-driver cups',
    visualSystem: 'Warm kraft palette',
    mobilePrinciple: 'Stacked and short',
    imagePlan: 'One continuous shoot',
  },
  modules: REPRESENTATIVE_MODULES,
};
