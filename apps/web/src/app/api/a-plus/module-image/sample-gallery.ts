import type {
  APlusGeneratedModule,
  APlusGeneratedModuleKind,
  APlusImageSlot,
} from '@farvisionllc/models';

/**
 * Dev-only sample modules for the `?sample=1&module=<kind>` design preview.
 * Realistic "Filtered Blend" coffee-cup copy so renders read like real A+
 * content. Image slots intentionally have no resolved `image` so they show the
 * placeholder — this harness is for iterating on layout/typography/colour, not
 * imagery. Never imported by production code paths.
 */

const slot = (
  role: string,
  alt: string,
  size: APlusImageSlot['size'] = '1792x1024'
): APlusImageSlot => ({ role, brief: 'sample brief', size, alt });

const base = <T extends APlusGeneratedModuleKind>(
  type: T,
  amazonModuleType: string,
  title: string
) => ({ order: 1 as const, type, amazonModuleType, title });

export const SAMPLE_GALLERY: Record<string, APlusGeneratedModule> = {
  'company-logo': {
    ...base('company-logo', 'STANDARD_COMPANY_LOGO', 'Brand logo'),
    logo: slot('logo', 'Filtered Blend logo', '1024x1024'),
    headline: 'Filtered Blend Ripple Wall Coffee Cups',
    tagline: 'Comfortable grip · heat resistant · built for coffee to-go.',
  },
  'image-text-overlay': {
    ...base('image-text-overlay', 'STANDARD_IMAGE_TEXT_OVERLAY', 'Hero'),
    image: slot('hero', 'Barista pouring espresso into a kraft ripple cup'),
    headline: 'Premium 8 oz cups for coffee lovers',
    body: 'Double-wall ripple insulation keeps drinks hot and hands comfortable — no sleeve required.',
    overlayPosition: 'left',
    badge: '50-PACK',
  },
  'image-and-text': {
    ...base('image-and-text', 'STANDARD_SINGLE_SIDE_IMAGE', 'Feature'),
    image: slot('feature', 'Close-up of ripple wall insulation', '1024x1024'),
    imagePosition: 'right',
    headline: 'Engineered for everyday comfort',
    body: 'Each cup is built from food-grade kraft with a ripple wall that traps heat and protects your hands.',
    bullets: [
      'Ripple wall insulation retains heat',
      'Sturdy snap-fit lid resists spills',
      'Sustainable, food-grade kraft exterior',
    ],
    badge: '8 OZ',
  },
  'three-image-text': {
    ...base(
      'three-image-text',
      'STANDARD_THREE_IMAGE_TEXT',
      'Built for comfort & convenience'
    ),
    columns: [
      {
        image: slot('c1', 'Ripple wall', '1024x1024'),
        headline: 'Ripple wall insulation',
        body: 'Keeps drinks hot while protecting your hands — no sleeve required.',
      },
      {
        image: slot('c2', 'Secure lid', '1024x1024'),
        headline: 'Secure lid',
        body: 'Snap-fit lid helps prevent spills and keeps drinks warm on the go.',
      },
      {
        image: slot('c3', 'Food-grade interior', '1024x1024'),
        headline: 'Food-grade interior',
        body: 'Smooth interior lining helps prevent leaks and preserves taste.',
      },
    ],
  },
  'four-image-text-quadrant': {
    ...base(
      'four-image-text-quadrant',
      'STANDARD_FOUR_IMAGE_TEXT_QUADRANT',
      'Why specialty cafés choose us'
    ),
    quadrants: [
      {
        image: slot('q1', 'Hot drinks', '1024x1024'),
        headline: 'Hot or cold',
        body: 'Holds espresso, drip, and iced pours alike.',
      },
      {
        image: slot('q2', 'Ripple grip', '1024x1024'),
        headline: 'Comfort grip',
        body: 'Ripple wall stays cool to the touch.',
      },
      {
        image: slot('q3', 'Matching lids', '1024x1024'),
        headline: 'Matching lids',
        body: 'Snap-fit lids included in every pack.',
      },
      {
        image: slot('q4', 'Kraft finish', '1024x1024'),
        headline: 'Kraft finish',
        body: 'Clean, professional presentation.',
      },
    ],
  },
  'comparison-table': {
    ...base(
      'comparison-table',
      'STANDARD_COMPARISON_TABLE',
      'Why choose ripple wall cups'
    ),
    products: [
      {
        title: 'Ripple Wall Cups',
        image: slot('p1', 'Ripple wall cup', '1024x1024'),
        highlight: true,
      },
      { title: 'Standard Cups', image: slot('p2', 'Plain cup', '1024x1024') },
    ],
    rows: [
      { label: 'Comfortable to hold', values: ['Yes', 'No'] },
      { label: 'No sleeve needed', values: ['Yes', 'No'] },
      { label: 'Ripple insulation', values: ['Yes', 'No'] },
      { label: 'Matching lids', values: ['Included', 'Sold separately'] },
    ],
  },
  'tech-specs': {
    ...base('tech-specs', 'STANDARD_TECH_SPECS', 'Technical specifications'),
    headline: 'Everything you need to know',
    rows: [
      { label: 'Capacity', value: '8 fl oz (237 ml)' },
      { label: 'Material', value: 'Double-wall food-grade kraft paper' },
      { label: 'Lid', value: 'Snap-fit, included' },
      { label: 'Pack size', value: '50 cups with lids' },
      { label: 'Use', value: 'Hot and cold beverages' },
    ],
  },
  'text-only': {
    ...base(
      'text-only',
      'STANDARD_PRODUCT_DESCRIPTION',
      'About Filtered Blend'
    ),
    headline: 'Crafted for the ritual of coffee',
    body: 'Filtered Blend cups are designed to honor the everyday ritual of coffee — whether you are serving specialty espresso to guests or enjoying a quiet morning at home. The ripple wall insulation keeps drinks at the perfect temperature while the sustainable kraft exterior reflects the care you put into every cup.',
    bullets: [
      'Double-wall ripple insulation',
      'Sustainable food-grade kraft',
      'Matching snap-fit lids included',
    ],
  },
  'icon-row': {
    ...base('icon-row', 'STANDARD_ICON_ROW', 'Perfect for any occasion'),
    items: [
      { icon: 'coffee', label: 'Coffee' },
      { icon: 'droplet', label: 'Tea' },
      { icon: 'building', label: 'Offices' },
      { icon: 'users', label: 'Events' },
      { icon: 'home', label: 'At home' },
    ],
  },
  'dual-use-split': {
    ...base('dual-use-split', 'STANDARD_DUAL_USE_SPLIT', 'Hot or cold'),
    panels: [
      {
        image: slot('hot', 'Hot espresso pour'),
        label: 'Hot',
        caption: 'Ripple insulation keeps espresso and drip hot for longer.',
      },
      {
        image: slot('cold', 'Iced coffee'),
        label: 'Cold',
        caption: 'Double walls cut condensation on iced pours.',
      },
    ],
  },
};

export const SAMPLE_GALLERY_KINDS = Object.keys(SAMPLE_GALLERY);
