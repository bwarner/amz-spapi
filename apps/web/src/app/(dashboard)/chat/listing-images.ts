/**
 * Pulling renderable images out of listing and photo tool results.
 *
 * The shapes differ by tool and none of them is ours to change: own-listing
 * tools return a flat `{slot, url}`, the public catalog returns SP-API's nested
 * sets, and the photo tools return proposals. Getting an image on screen means
 * understanding all three.
 */

export type ListingImage = {
  /** Full resolution — what a click should open. */
  url: string;
  /** A sensible size for a thumbnail grid. Falls back to `url`. */
  thumbUrl?: string;
  label?: string;
};

type CatalogImageEntry = {
  variant?: string;
  link?: string;
  width?: number;
  height?: number;
};

export type CatalogImageSet = { images?: CatalogImageEntry[] };

/**
 * ONE image per variant, at two useful sizes.
 *
 * SP-API returns a separate entry for every RESOLUTION of every variant — MAIN
 * at 2560, 500 and 75 pixels, PT01 the same, and so on. Flattening that list
 * and de-duplicating by URL does nothing, because each size has its own URL, so
 * a listing rendered as "MAIN, MAIN, MAIN, PT01, PT01, PT01" — and the cap on
 * how many images one lookup may show was spent on those copies, hiding the
 * rest of the listing behind them.
 *
 * Grouping by variant is what actually de-duplicates. The largest is kept for
 * the link and a mid-size for the grid: a 96px thumbnail does not need 2560px,
 * and the 75px version is visibly soft on a retina screen.
 */
export function pickOnePerVariant(
  entries: CatalogImageEntry[]
): ListingImage[] {
  const byVariant = new Map<string, CatalogImageEntry[]>();
  for (const entry of entries) {
    if (!entry?.link) continue;
    // An entry with no variant is its own group rather than being lumped in
    // with every other unlabelled one.
    const key = entry.variant ?? `__${entry.link}`;
    const group = byVariant.get(key);
    if (group) group.push(entry);
    else byVariant.set(key, [entry]);
  }

  const images: ListingImage[] = [];
  for (const [key, group] of byVariant) {
    const sorted = [...group].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
    const largest = sorted[0];
    // Smallest that is still comfortably sharp at grid size on a 2x display;
    // the largest if nothing qualifies.
    const display =
      [...sorted].reverse().find((entry) => (entry.width ?? 0) >= 320) ??
      largest;
    images.push({
      url: largest.link as string,
      thumbUrl: display.link,
      label: key.startsWith('__') ? undefined : key,
    });
  }
  return images;
}

/** MAIN first; everything else keeps Amazon's order, which is slot order. */
export function mainFirst(images: ListingImage[]): ListingImage[] {
  return [...images].sort((a, b) =>
    a.label === 'MAIN' ? -1 : b.label === 'MAIN' ? 1 : 0
  );
}

function listingSlotLabel(slot: string): string {
  if (slot === 'main_product_image_locator') return 'Main';
  if (slot === 'swatch_product_image_locator') return 'Swatch';
  const other = slot.match(/^other_product_image_locator_(\d+)$/);
  return other ? `Image ${other[1]}` : slot;
}

/** Cap for one catalog item's image set so a single lookup cannot flood the grid. */
const CATALOG_IMAGES_MAX = 8;

export function extractListingToolImages(output: unknown): ListingImage[] {
  if (!output || typeof output !== 'object') return [];
  const data = output as {
    // Own-listing tools: flat {slot|label, url}. Catalog tools: nested SP-API
    // sets {marketplaceId, images: [{variant, link, width, height}]}.
    images?: Array<
      { slot?: string; label?: string; url?: string } | CatalogImageSet
    >;
    listings?: Array<{ mainImage?: string; title?: string; sku?: string }>;
    proposals?: Array<{ label?: string; url?: string }>;
    // Catalog search: one MAIN image per result item.
    items?: Array<{
      asin?: string;
      summaries?: Array<{ itemName?: string }>;
      images?: CatalogImageSet[];
    }>;
  };

  const collected: ListingImage[] = [];
  const catalogEntries: CatalogImageEntry[] = [];

  for (const image of data.images ?? []) {
    if (!image) continue;
    if ('url' in image && image.url) {
      collected.push({
        url: image.url,
        label:
          image.label ??
          (image.slot ? listingSlotLabel(image.slot) : undefined),
      });
      continue;
    }
    if ('images' in image && Array.isArray(image.images)) {
      catalogEntries.push(...image.images);
    }
  }

  collected.push(
    ...mainFirst(pickOnePerVariant(catalogEntries)).slice(0, CATALOG_IMAGES_MAX)
  );

  for (const item of data.items ?? []) {
    const entries = item?.images?.flatMap((set) => set.images ?? []) ?? [];
    const main = mainFirst(pickOnePerVariant(entries))[0];
    if (main) {
      collected.push({
        ...main,
        label: item.summaries?.[0]?.itemName ?? item.asin,
      });
    }
  }

  for (const listing of data.listings ?? []) {
    if (listing?.mainImage) {
      collected.push({
        url: listing.mainImage,
        label: listing.title ?? listing.sku,
      });
    }
  }

  for (const proposal of data.proposals ?? []) {
    if (proposal?.url) {
      collected.push({ url: proposal.url, label: proposal.label });
    }
  }

  return collected;
}
