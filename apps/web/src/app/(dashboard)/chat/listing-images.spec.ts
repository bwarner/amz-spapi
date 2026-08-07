/**
 * Images out of listing tool results.
 *
 * The fixture is a real `get-listing` response, read back out of a stored
 * conversation: SP-API returns one entry per RESOLUTION of every variant, and
 * flattening that is what made a listing render as "MAIN, MAIN, MAIN, PT01,
 * PT01, PT01" — with the cap on how many images a lookup may show spent on
 * copies, hiding the rest of the listing behind them.
 */

import { describe, expect, it } from 'vitest';
import { extractListingToolImages, pickOnePerVariant } from './listing-images';

/** Verbatim shape and sizes from a real response. */
const CATALOG_SET = {
  images: [
    {
      variant: 'MAIN',
      link: 'https://m/71nhxp7ZiBL.jpg',
      width: 2560,
      height: 2560,
    },
    {
      variant: 'MAIN',
      link: 'https://m/41rLpjaoOvL.jpg',
      width: 500,
      height: 500,
    },
    {
      variant: 'MAIN',
      link: 'https://m/41rLpjaoOvL._SL75_.jpg',
      width: 75,
      height: 75,
    },
    {
      variant: 'PT01',
      link: 'https://m/51NXZkQ4uYL.jpg',
      width: 1080,
      height: 1080,
    },
    {
      variant: 'PT01',
      link: 'https://m/41zUcpoEscL.jpg',
      width: 500,
      height: 500,
    },
    {
      variant: 'PT01',
      link: 'https://m/41zUcpoEscL._SL75_.jpg',
      width: 75,
      height: 75,
    },
    {
      variant: 'PT02',
      link: 'https://m/61aiFka5HjL.jpg',
      width: 1080,
      height: 1080,
    },
    {
      variant: 'PT02',
      link: 'https://m/41iUrII3xiL.jpg',
      width: 500,
      height: 500,
    },
    {
      variant: 'PT02',
      link: 'https://m/41iUrII3xiL._SL75_.jpg',
      width: 75,
      height: 75,
    },
  ],
};

describe('pickOnePerVariant', () => {
  it('returns one image per variant, not one per resolution', () => {
    const images = pickOnePerVariant(CATALOG_SET.images);
    expect(images.map((image) => image.label)).toEqual([
      'MAIN',
      'PT01',
      'PT02',
    ]);
  });

  it('links the largest and shows a mid-size in the grid', () => {
    // A 96px thumbnail does not need 2560px, and the 75px version is visibly
    // soft on a retina screen.
    const [main] = pickOnePerVariant(CATALOG_SET.images);
    expect(main.url).toBe('https://m/71nhxp7ZiBL.jpg'); // 2560
    expect(main.thumbUrl).toBe('https://m/41rLpjaoOvL.jpg'); // 500
  });

  it('falls back to the largest when nothing is big enough', () => {
    const [only] = pickOnePerVariant([
      { variant: 'MAIN', link: 'https://m/tiny.jpg', width: 75 },
      { variant: 'MAIN', link: 'https://m/small.jpg', width: 160 },
    ]);
    expect(only.url).toBe('https://m/small.jpg');
    expect(only.thumbUrl).toBe('https://m/small.jpg');
  });

  it('keeps unlabelled images apart instead of collapsing them into one', () => {
    const images = pickOnePerVariant([
      { link: 'https://m/a.jpg', width: 500 },
      { link: 'https://m/b.jpg', width: 500 },
    ]);
    expect(images).toHaveLength(2);
    expect(images.every((image) => image.label === undefined)).toBe(true);
  });

  it('ignores entries with no link', () => {
    expect(pickOnePerVariant([{ variant: 'MAIN' }])).toEqual([]);
  });
});

describe('extractListingToolImages', () => {
  it('shows a catalog listing once per slot, MAIN first', () => {
    const images = extractListingToolImages({ images: [CATALOG_SET] });
    expect(images).toHaveLength(3);
    expect(images[0].label).toBe('MAIN');
  });

  it('leaves the cap for distinct images rather than duplicate sizes', () => {
    // Nine slots at three resolutions each: 27 entries, 9 images, and the cap
    // of 8 now bites on real images instead of on copies of the first three.
    const many = {
      images: Array.from({ length: 9 }, (_, slot) =>
        [2560, 500, 75].map((width) => ({
          variant: slot === 0 ? 'MAIN' : `PT0${slot}`,
          link: `https://m/${slot}-${width}.jpg`,
          width,
        }))
      ).flat(),
    };
    const images = extractListingToolImages({ images: [many] });
    expect(images).toHaveLength(8);
    expect(new Set(images.map((image) => image.label)).size).toBe(8);
  });

  it('still reads the flat own-listing shape and names the slots', () => {
    const images = extractListingToolImages({
      images: [
        { slot: 'main_product_image_locator', url: 'https://m/main.jpg' },
        { slot: 'other_product_image_locator_3', url: 'https://m/pt3.jpg' },
      ],
    });
    expect(images.map((image) => image.label)).toEqual(['Main', 'Image 3']);
  });

  it('takes one image per search result, at a sensible size', () => {
    const images = extractListingToolImages({
      items: [
        {
          asin: 'B0FRD9RR2B',
          summaries: [{ itemName: 'French Press' }],
          images: [CATALOG_SET],
        },
      ],
    });
    expect(images).toHaveLength(1);
    expect(images[0].label).toBe('French Press');
    expect(images[0].thumbUrl).toBe('https://m/41rLpjaoOvL.jpg');
  });

  it('reads proposals and own listings unchanged', () => {
    expect(
      extractListingToolImages({
        proposals: [{ url: 'https://m/p.jpg', label: 'Photo A' }],
      })
    ).toEqual([{ url: 'https://m/p.jpg', label: 'Photo A' }]);

    expect(
      extractListingToolImages({
        listings: [{ mainImage: 'https://m/l.jpg', sku: 'SKU-1' }],
      })
    ).toEqual([{ url: 'https://m/l.jpg', label: 'SKU-1' }]);
  });

  it('returns nothing for output that carries no images', () => {
    expect(extractListingToolImages(null)).toEqual([]);
    expect(extractListingToolImages({ orders: [] })).toEqual([]);
  });
});
