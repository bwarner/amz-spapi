import type { APlusDocument } from './types';

const ph = (
  w: number,
  h: number,
  label: string,
  bg = '1f2937',
  fg = 'd1d5db'
) =>
  `https://placehold.co/${w}x${h}/${bg}/${fg}/png?text=${encodeURIComponent(
    label
  )}`;

export const sampleAPlusDoc: APlusDocument = {
  asin: 'B0XXXXXXXX',
  productTitle:
    'Filtered Blank Box Triple Sandwich Kraft Paper Cups — 8 oz Insulated Package (50 ct)',
  guardrailsApplied: [
    'Removed price/promo language',
    'Removed delivery/stock claims',
    'Removed comparative superlatives without proof',
  ],
  modules: [
    {
      type: 'company-logo',
      logo: {
        url: ph(600, 180, 'Brand Logo', 'ffffff', '111827'),
        alt: 'Brand logo',
      },
    },
    {
      type: 'image-header-with-text',
      image: {
        url: ph(970, 600, 'Lifestyle Banner — Cafe scene', '0f172a', 'fbbf24'),
        alt: 'Stack of insulated kraft paper cups in a cafe setting',
      },
      headline: 'Triple-wall comfort. Compostable confidence.',
      body: 'Insulated kraft cups designed for hot drinks at home, in cafes, and on the go. A cleaner cup of coffee, every pour.',
    },
    {
      type: 'image-and-text',
      imagePosition: 'left',
      image: {
        url: ph(300, 300, 'Triple-wall cutaway', '111827', 'fbbf24'),
        alt: 'Cross-section showing three insulating layers',
      },
      headline: 'Stays comfortable in your hand',
      body: 'Three bonded layers of unbleached kraft trap heat between air pockets so the outer wall stays cool. No sleeves, no juggling, no second cup.',
    },
    {
      type: 'image-and-text',
      imagePosition: 'right',
      image: {
        url: ph(300, 300, 'Compostable certification mark', '14532d', 'ecfccb'),
        alt: 'Compostable certification logo',
      },
      headline: 'Plant-based lining, certified compostable',
      body: 'PLA bio-lining replaces traditional polyethylene. The whole cup breaks down in commercial compost facilities — no separation, no sorting.',
    },
    {
      type: 'four-image-text-quadrant',
      quadrants: [
        {
          image: {
            url: ph(485, 300, '8 oz', '7c2d12', 'fed7aa'),
            alt: '8 oz cup',
          },
          headline: 'Right size for espresso drinks',
          body: 'A balanced 8 oz pour for cappuccino, flat white, or a generous cortado.',
        },
        {
          image: {
            url: ph(485, 300, 'Stackable', '78350f', 'fde68a'),
            alt: 'Stacked cups',
          },
          headline: 'Stacks tight, stores small',
          body: 'Tapered profile keeps 50 cups in roughly the footprint of a single mug.',
        },
        {
          image: {
            url: ph(485, 300, 'Print-ready', '111827', 'fbbf24'),
            alt: 'Custom-printed cup mockup',
          },
          headline: 'Blank canvas for your brand',
          body: 'Smooth uncoated exterior takes ink, stamps, and labels cleanly.',
        },
        {
          image: {
            url: ph(
              485,
              300,
              'Microwave-safe lid optional',
              '1e3a8a',
              'dbeafe'
            ),
            alt: 'Cup with lid',
          },
          headline: 'Compatible with standard 80mm lids',
          body: 'Pairs with the lid system you already stock — no retooling.',
        },
      ],
    },
    {
      type: 'comparison-table',
      products: [
        {
          title: 'This product — Triple-wall Kraft 8 oz',
          image: {
            url: ph(120, 120, 'This', '111827', 'fbbf24'),
            alt: 'This product',
          },
          highlight: true,
        },
        {
          title: 'Single-wall Kraft 8 oz',
          image: {
            url: ph(120, 120, 'Alt A', '374151', 'd1d5db'),
            alt: 'Alt A',
          },
        },
        {
          title: 'Foam 8 oz',
          image: {
            url: ph(120, 120, 'Alt B', '374151', 'd1d5db'),
            alt: 'Alt B',
          },
        },
        {
          title: 'Double-wall Kraft 12 oz',
          image: {
            url: ph(120, 120, 'Alt C', '374151', 'd1d5db'),
            alt: 'Alt C',
          },
        },
      ],
      rows: [
        { label: 'Insulating layers', values: ['3', '1', '1 (foam)', '2'] },
        { label: 'Capacity', values: ['8 oz', '8 oz', '8 oz', '12 oz'] },
        { label: 'Sleeve required', values: ['No', 'Yes', 'No', 'Sometimes'] },
        {
          label: 'Compostable',
          values: ['Yes — PLA lined', 'Yes', 'No', 'Yes — PLA lined'],
        },
        {
          label: 'Lid compatibility',
          values: ['80 mm', '80 mm', '80 mm', '90 mm'],
        },
        {
          label: 'Best for',
          values: [
            'Hot espresso drinks',
            'Cold drinks, low heat',
            'Quick-service hot',
            'Drip coffee, tea',
          ],
        },
      ],
    },
  ],
};
