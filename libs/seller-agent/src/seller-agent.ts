import { ToolLoopAgent, InferAgentUIMessage, stepCountIs } from 'ai';
import { z } from 'zod';
import type { SpCache } from '@amz-spapi/sp-cache';
import type {
  AIProvider,
  ImageGenerator,
  ModelTier,
} from '@amz-spapi/ai-provider';

/**
 * Host-provided access to the media asset library. Implementations MUST
 * ownership-check asset ids (they arrive from model tool calls).
 */
export interface SellerAssetStore {
  loadImageBytes(
    assetId: string
  ): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  saveGeneratedImage(params: {
    dataUrl: string;
  }): Promise<{ assetId: string; url: string }>;
}

/** A transformed image persisted back into the asset library. */
export type EditedImage = {
  assetId: string;
  url: string;
  width?: number;
  height?: number;
};

/**
 * Host-provided image transformations (sharp + segmentation on the host).
 * Implementations MUST ownership-check asset ids.
 */
export interface SellerImageOps {
  crop(params: {
    assetId: string;
    /** Crop rectangle as fractions of the source (0..1). */
    rect?: { x: number; y: number; width: number; height: number };
    /** Or crop to an aspect ratio like "1:1", positioned by gravity. */
    aspect?: string;
    gravity?: 'center' | 'top' | 'bottom' | 'left' | 'right';
  }): Promise<EditedImage>;
  resize(params: {
    assetId: string;
    width?: number;
    height?: number;
    fit?: 'inside' | 'cover';
    allowUpscale?: boolean;
  }): Promise<EditedImage>;
  removeBackground(params: {
    assetId: string;
    background?: 'white' | 'transparent';
  }): Promise<EditedImage>;
  renderInfographic(params: {
    template: 'benefit-grid' | 'callout-overlay';
    productImageAssetId: string;
    headline: string;
    subheadline?: string;
    benefits?: Array<{ icon: string; label: string; text?: string }>;
    callouts?: Array<{ x: number; y: number; title: string; text?: string }>;
    colors?: { background?: string; text?: string; accent?: string };
  }): Promise<EditedImage>;
  compose(params: {
    foregroundAssetId: string;
    backgroundAssetId: string;
    /** Center of the foreground as fractions of the background (default 0.5/0.6). */
    position?: { x: number; y: number };
    /** Foreground width as a fraction of the background width (default 0.7). */
    scale?: number;
    /** Soft drop shadow under the foreground (default true). */
    shadow?: boolean;
  }): Promise<EditedImage>;
}

export interface SellerAgentConfig {
  spCache?: SpCache;
  provider: AIProvider;
  imageGenerator?: ImageGenerator;
  assetStore?: SellerAssetStore;
  imageOps?: SellerImageOps;
  modelTier?: ModelTier;
  marketplaceId: string;
  additionalInstructions?: string;
}

function getToolsForAgent(spCache: SpCache, marketplaceId: string) {
  return {
    'search-catalog': {
      description:
        'Search the Amazon catalog by keywords, ASIN, or brand name. ' +
        'Returns product titles, ASINs, brands, images, and classification info. ' +
        'Use this to find products before fetching detailed listing data.',
      inputSchema: z.object({
        keywords: z
          .string()
          .optional()
          .describe('Search keywords (e.g., "tea infuser stainless steel")'),
        identifiers: z
          .array(z.string())
          .optional()
          .describe('Product identifiers (ASINs, UPCs, etc.)'),
        identifiersType: z
          .enum(['ASIN', 'EAN', 'GTIN', 'ISBN', 'JAN', 'MINSAN', 'SKU', 'UPC'])
          .optional()
          .describe('Type of identifiers provided'),
        brandNames: z
          .array(z.string())
          .optional()
          .describe('Filter by brand names'),
        pageSize: z
          .number()
          .min(1)
          .max(20)
          .optional()
          .describe('Results per page (max 20)'),
      }),
      execute: async (input: {
        keywords?: string;
        identifiers?: string[];
        identifiersType?:
          | 'ASIN'
          | 'EAN'
          | 'GTIN'
          | 'ISBN'
          | 'JAN'
          | 'MINSAN'
          | 'SKU'
          | 'UPC';
        brandNames?: string[];
        pageSize?: number;
      }) => {
        console.log(
          '[tool:search-catalog] Executing with input:',
          JSON.stringify(input)
        );
        try {
          const result = await spCache.searchCatalogItems({
            keywords: input.keywords,
            identifiers: input.identifiers,
            identifiersType: input.identifiersType,
            brandNames: input.brandNames,
            pageSize: input.pageSize,
            marketplaceIds: [marketplaceId],
            includedData: ['summaries', 'images'],
          });
          console.log(
            '[tool:search-catalog] Success, got',
            result?.numberOfResults,
            'results'
          );
          return result;
        } catch (err: any) {
          console.error('[tool:search-catalog] ERROR:', err.message);
          if (err.response) {
            console.error(
              '[tool:search-catalog] Response status:',
              err.response.status
            );
            console.error(
              '[tool:search-catalog] Response data:',
              JSON.stringify(err.response.data)
            );
          }
          throw err;
        }
      },
    },

    'get-listing': {
      description:
        'Get detailed listing data for a specific ASIN. Returns title, bullet points, description, ' +
        'images, product type, sales ranks, and dimensions. ' +
        'Use this when you need to analyze or critique a listing in detail.',
      inputSchema: z.object({
        asin: z.string().min(1).describe('The ASIN of the product to look up'),
      }),
      execute: async (input: { asin: string }) => {
        return spCache.getCatalogItem(input.asin, {
          marketplaceIds: [marketplaceId],
          includedData: [
            'summaries',
            'attributes',
            'images',
            'productTypes',
            'salesRanks',
            'dimensions',
          ],
        });
      },
    },

    'get-orders': {
      description:
        'Get recent orders for the seller. Can filter by date range, status, and fulfillment channel. ' +
        'Returns order IDs, status, dates, and totals. Does NOT include buyer PII.',
      inputSchema: z.object({
        days: z
          .number()
          .min(1)
          .max(365)
          .optional()
          .describe('Number of days back to search (default 7)'),
        orderStatuses: z
          .array(z.string())
          .optional()
          .describe(
            'Filter by status: Pending, Unshipped, PartiallyShipped, Shipped, Canceled, Unfulfillable'
          ),
        fulfillmentChannels: z
          .array(z.string())
          .optional()
          .describe('Filter: AFN (FBA) or MFN (merchant fulfilled)'),
        maxResults: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe('Max results per page (default 20)'),
      }),
      execute: async (input: {
        days?: number;
        orderStatuses?: string[];
        fulfillmentChannels?: string[];
        maxResults?: number;
      }) => {
        const days = input.days ?? 7;
        const createdAfter = new Date(
          Date.now() - days * 24 * 60 * 60 * 1000
        ).toISOString();
        return spCache.getOrders({
          marketplaceIds: [marketplaceId],
          createdAfter,
          orderStatuses: input.orderStatuses,
          fulfillmentChannels: input.fulfillmentChannels,
          maxResultsPerPage: input.maxResults,
        });
      },
    },

    'get-order-details': {
      description:
        'Get details for a specific order, optionally including line items. ' +
        'Returns order status, dates, totals, and item details (ASIN, quantity, price).',
      inputSchema: z.object({
        orderId: z.string().min(1).describe('The Amazon order ID'),
        includeItems: z
          .boolean()
          .optional()
          .describe('Also fetch order line items (default true)'),
      }),
      execute: async (input: { orderId: string; includeItems?: boolean }) => {
        const order = await spCache.getOrder(input.orderId);
        if (input.includeItems !== false) {
          const items = await spCache.getOrderItems(input.orderId);
          return { order, items };
        }
        return { order };
      },
    },

    'get-inventory': {
      description:
        'Check FBA inventory levels. Returns quantity available, inbound, reserved, ' +
        'and FNSKU for each SKU.',
      inputSchema: z.object({
        sellerSkus: z
          .array(z.string())
          .optional()
          .describe('Filter by specific seller SKUs. Omit to get all.'),
      }),
      execute: async (input: { sellerSkus?: string[] }) => {
        return spCache.getInventorySummaries({
          granularityType: 'Marketplace',
          granularityId: marketplaceId,
          sellerSkus: input.sellerSkus,
          marketplaceIds: [marketplaceId],
        });
      },
    },
  };
}

/**
 * Image slots inside Listings Items attributes: values are arrays of
 * `{ media_location }`. Collected into a flat list the chat UI renders.
 */
function extractListingImages(
  attributes: Record<string, unknown> | undefined
): Array<{ slot: string; url: string }> {
  if (!attributes) return [];
  const images: Array<{ slot: string; url: string }> = [];
  const slotNames = [
    'main_product_image_locator',
    ...Array.from(
      { length: 8 },
      (_, i) => `other_product_image_locator_${i + 1}`
    ),
    'swatch_product_image_locator',
  ];
  for (const slot of slotNames) {
    const value = attributes[slot];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const url = (entry as { media_location?: string })?.media_location;
      if (url) images.push({ slot, url });
    }
  }
  return images;
}

type ListingSummary = {
  marketplaceId?: string;
  asin?: string;
  productType?: string;
  status?: string[];
  itemName?: string;
  createdDate?: string;
  lastUpdatedDate?: string;
  mainImage?: { link?: string; height?: number; width?: number };
};

function getListingsTools(spCache: SpCache) {
  return {
    'get-my-listing': {
      description:
        "Get the seller's OWN listing for a seller SKU — the attributes actually submitted to Amazon " +
        'plus any open validation issues. Different from get-listing (public catalog view). ' +
        'Returns summaries, issues, and the listing images (which are shown to the user automatically). ' +
        'Use search-my-listings first if you only have an ASIN or product name.',
      inputSchema: z.object({
        sku: z.string().min(1).describe('The seller SKU of the listing'),
        includeAttributes: z
          .boolean()
          .optional()
          .describe(
            'Also return the full attribute map (title, bullets, description, keywords). ' +
              'Default false — request it when critiquing or preparing an update.'
          ),
      }),
      execute: async (input: { sku: string; includeAttributes?: boolean }) => {
        const result = await spCache.getListingsItem({
          sku: input.sku,
          includedData: ['summaries', 'attributes', 'issues'],
        });
        const attributes = result?.attributes as
          | Record<string, unknown>
          | undefined;
        return {
          sku: result?.sku,
          summaries: result?.summaries,
          issues: result?.issues,
          images: extractListingImages(attributes),
          ...(input.includeAttributes ? { attributes } : {}),
        };
      },
    },

    'search-my-listings': {
      description:
        "Search the seller's OWN listings. Filter by SKUs or ASINs, or list everything (paginated). " +
        'Returns SKU, ASIN, title, status, and main image per listing. ' +
        'Use this to resolve an ASIN or product name to the seller SKU that other listing tools need.',
      inputSchema: z.object({
        skus: z
          .array(z.string())
          .max(20)
          .optional()
          .describe('Filter by specific seller SKUs (max 20)'),
        asins: z
          .array(z.string())
          .max(20)
          .optional()
          .describe(
            'Filter by specific ASINs (max 20). Ignored if skus is set.'
          ),
        withIssuesOnly: z
          .boolean()
          .optional()
          .describe('Only listings with WARNING or ERROR issues'),
        pageSize: z.number().int().min(1).max(20).optional(),
        pageToken: z.string().optional(),
      }),
      execute: async (input: {
        skus?: string[];
        asins?: string[];
        withIssuesOnly?: boolean;
        pageSize?: number;
        pageToken?: string;
      }) => {
        const identifiers = input.skus?.length
          ? { identifiers: input.skus, identifiersType: 'SKU' as const }
          : input.asins?.length
          ? { identifiers: input.asins, identifiersType: 'ASIN' as const }
          : {};
        const result = await spCache.searchListingsItems({
          ...identifiers,
          withIssueSeverity: input.withIssuesOnly
            ? ['WARNING', 'ERROR']
            : undefined,
          includedData: ['summaries'],
          pageSize: input.pageSize ?? 10,
          pageToken: input.pageToken,
        });
        const items = (result?.items ?? []) as Array<{
          sku?: string;
          summaries?: ListingSummary[];
        }>;
        return {
          numberOfResults: result?.numberOfResults,
          nextToken: result?.pagination?.nextToken,
          listings: items.map((item) => {
            const summary = item.summaries?.[0];
            return {
              sku: item.sku,
              asin: summary?.asin,
              title: summary?.itemName,
              status: summary?.status,
              productType: summary?.productType,
              lastUpdated: summary?.lastUpdatedDate,
              mainImage: summary?.mainImage?.link,
            };
          }),
        };
      },
    },
  };
}

const LISTING_SHOT_TEMPLATES: Record<string, string> = {
  'main-white':
    'Professional Amazon MAIN listing image: the product alone on a pure white ' +
    'seamless background (RGB 255,255,255), filling about 85% of the frame, even ' +
    'studio lighting, tack-sharp focus, true-to-life colors. No props, no text, ' +
    'no logos, no watermarks, no people, no reflections of other objects.',
  lifestyle:
    'Photorealistic lifestyle listing image: the product being used naturally in a ' +
    'realistic, aspirational setting that matches its purpose. Authentic environment, ' +
    'natural light, shallow depth of field. No overlaid text or graphics.',
  detail:
    'Macro detail listing image: a tight close-up of a distinguishing feature, ' +
    'texture, or construction detail of the product. Crisp focus on the feature, ' +
    'clean softly-lit background. No text or graphics.',
  scale:
    'Scale-reference listing image: the product held in a hand or placed beside an ' +
    'everyday object so its true size is obvious. Neutral, clean setting. ' +
    'No overlaid text, rulers rendered as graphics, or size callouts.',
  packaging:
    'Packaging listing image: the product together with its retail packaging on a ' +
    'clean white background, studio lighting. No added text or graphics.',
};

function getPhotoTools(
  imageGenerator: ImageGenerator,
  assetStore: SellerAssetStore
) {
  return {
    'propose-listing-photos': {
      description:
        'Generate proposed Amazon listing photos of the EXACT product shown in reference ' +
        'photos (image-to-image). Provide 1-3 reference asset ids from photos the user ' +
        'attached, and 1-4 shots to produce. Each proposal is saved to the asset library ' +
        'and displayed to the user automatically with its label — refer to proposals by ' +
        'label in conversation. Label each shot "Photo <letter>" continuing the letter ' +
        'sequence already used in this conversation (uploads and earlier proposals).',
      inputSchema: z.object({
        referenceAssetIds: z
          .array(z.string())
          .min(1)
          .max(3)
          .describe(
            "Asset ids of the user's product photos (from attachment manifests, " +
              'e.g. the last path segment of /api/a-plus/assets/<assetId>)'
          ),
        productDescription: z
          .string()
          .min(10)
          .describe(
            'Factual product description: colors, materials, parts, finish — ' +
              'the generator must reproduce the product faithfully'
          ),
        shots: z
          .array(
            z.object({
              label: z
                .string()
                .regex(/^Photo [A-Z]{1,2}$/)
                .describe(
                  'Identifier like "Photo D" — continue the sequence of letters ' +
                    'already used in this conversation (after Photo Z comes ' +
                    'Photo AA, AB, ...)'
                ),
              shotType: z.enum([
                'main-white',
                'lifestyle',
                'detail',
                'scale',
                'packaging',
              ]),
              brief: z
                .string()
                .optional()
                .describe(
                  'Scene specifics: setting, angle, which feature to highlight'
                ),
            })
          )
          .min(1)
          .max(4),
        quality: z.enum(['low', 'medium', 'high']).optional(),
      }),
      execute: async (input: {
        referenceAssetIds: string[];
        productDescription: string;
        shots: { label: string; shotType: string; brief?: string }[];
        quality?: 'low' | 'medium' | 'high';
      }) => {
        const references = (
          await Promise.all(
            input.referenceAssetIds.map((assetId) =>
              assetStore.loadImageBytes(assetId)
            )
          )
        ).filter((ref): ref is NonNullable<typeof ref> => ref !== null);

        if (references.length === 0) {
          return {
            success: false,
            error:
              'None of the reference asset ids could be loaded. Use asset ids from ' +
              "the user's attached photos.",
          };
        }

        const referenceImages = references.map((ref) => ref.bytes);
        const proposals = await Promise.all(
          input.shots.map(async (shot) => {
            const template =
              LISTING_SHOT_TEMPLATES[shot.shotType] ??
              LISTING_SHOT_TEMPLATES['lifestyle'];
            const prompt = [
              template,
              `Product: ${input.productDescription}.`,
              shot.brief ? `Scene: ${shot.brief}.` : '',
              'Depict the EXACT product from the reference photos — identical ' +
                'colors, materials, proportions, and markings. Do not invent ' +
                'variants or accessories that are not in the reference photos.',
            ]
              .filter(Boolean)
              .join(' ');

            try {
              const results = await imageGenerator.generate({
                prompt,
                size: '1024x1024',
                quality: input.quality ?? 'medium',
                referenceImages,
              });
              const first = results[0];
              if (!first?.url) {
                return { label: shot.label, error: 'No image returned.' };
              }
              const saved = await assetStore.saveGeneratedImage({
                dataUrl: first.url,
              });
              return {
                label: shot.label,
                shotType: shot.shotType,
                assetId: saved.assetId,
                url: saved.url,
                revisedPrompt: first.revisedPrompt,
              };
            } catch (error) {
              return {
                label: shot.label,
                error:
                  error instanceof Error ? error.message : 'Generation failed.',
              };
            }
          })
        );

        return {
          success: proposals.some((proposal) => 'assetId' in proposal),
          proposals,
          note:
            'Proposals are displayed to the user automatically with their labels. ' +
            'Do not repeat the image URLs; ask which proposals the user wants to keep.',
        };
      },
    },
  };
}

const PHOTO_LABEL_SCHEMA = z
  .string()
  .regex(/^Photo [A-Z]{1,2}$/)
  .describe(
    'Identifier like "Photo D" — continue the letter sequence already used in ' +
      'this conversation (after Photo Z comes Photo AA, AB, ...)'
  );

const ASSET_ID_SCHEMA = z
  .string()
  .min(1)
  .describe(
    'Asset id of the source image (resolve the photo label via the PHOTO LABEL REGISTRY ' +
      'or the manifest/tool result where it first appeared)'
  );

function getImageEditTools(imageOps: SellerImageOps) {
  const wrap = async (
    label: string,
    edit: () => Promise<EditedImage>
  ): Promise<
    | { success: true; images: Array<EditedImage & { label: string }> }
    | { success: false; error: string }
  > => {
    try {
      const image = await edit();
      return { success: true, images: [{ label, ...image }] };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Image edit failed.',
      };
    }
  };

  return {
    'crop-image': {
      description:
        'Crop a photo — either a fractional rectangle or an aspect ratio with gravity ' +
        '(e.g. square-crop for an Amazon main image). Produces a NEW labeled photo; ' +
        'the original is untouched. The result is displayed to the user automatically.',
      inputSchema: z.object({
        assetId: ASSET_ID_SCHEMA,
        label: PHOTO_LABEL_SCHEMA,
        rect: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            width: z.number().min(0.01).max(1),
            height: z.number().min(0.01).max(1),
          })
          .optional()
          .describe('Crop rectangle as fractions of the source image'),
        aspect: z
          .string()
          .regex(/^\d+(\.\d+)?:\d+(\.\d+)?$/)
          .optional()
          .describe(
            'Target aspect ratio like "1:1" or "4:3" (max centered crop)'
          ),
        gravity: z
          .enum(['center', 'top', 'bottom', 'left', 'right'])
          .optional()
          .describe('Which part of the image to keep for aspect crops'),
      }),
      execute: (input: {
        assetId: string;
        label: string;
        rect?: { x: number; y: number; width: number; height: number };
        aspect?: string;
        gravity?: 'center' | 'top' | 'bottom' | 'left' | 'right';
      }) =>
        wrap(input.label, () =>
          imageOps.crop({
            assetId: input.assetId,
            rect: input.rect,
            aspect: input.aspect,
            gravity: input.gravity,
          })
        ),
    },

    'scale-image': {
      description:
        'Scale a photo to target dimensions (Amazon listing images should be at least ' +
        '1000px on the longest side for zoom; up to 10000px). fit "inside" preserves the ' +
        'whole image, "cover" fills and crops. Produces a NEW labeled photo, displayed ' +
        'to the user automatically.',
      inputSchema: z.object({
        assetId: ASSET_ID_SCHEMA,
        label: PHOTO_LABEL_SCHEMA,
        width: z.number().int().min(50).max(10000).optional(),
        height: z.number().int().min(50).max(10000).optional(),
        fit: z.enum(['inside', 'cover']).optional(),
        allowUpscale: z
          .boolean()
          .optional()
          .describe(
            'Permit enlarging beyond the source size (needed to reach Amazon minimums ' +
              'from small photos). Default false.'
          ),
      }),
      execute: (input: {
        assetId: string;
        label: string;
        width?: number;
        height?: number;
        fit?: 'inside' | 'cover';
        allowUpscale?: boolean;
      }) =>
        wrap(input.label, () =>
          imageOps.resize({
            assetId: input.assetId,
            width: input.width,
            height: input.height,
            fit: input.fit,
            allowUpscale: input.allowUpscale,
          })
        ),
    },

    'generate-infographic': {
      description:
        'Render a professional infographic-style listing image (2000×2000) from ' +
        'structured content — layout, typography, and icons are deterministic ' +
        'templates, so text is always crisp and correct. The product appears as a ' +
        'real photo (use a background-removed cutout assetId for best results). ' +
        'Templates: "benefit-grid" (headline + product beside icon/label benefits) ' +
        'and "callout-overlay" (product large with feature callout chips placed on ' +
        'it). Produces a NEW labeled photo, displayed automatically. Ideal for ' +
        'secondary listing images; never for the MAIN image.',
      inputSchema: z.object({
        template: z.enum(['benefit-grid', 'callout-overlay']),
        label: PHOTO_LABEL_SCHEMA,
        productImageAssetId: ASSET_ID_SCHEMA.describe(
          'Product photo asset id — prefer a transparent cutout from remove-image-background'
        ),
        headline: z.string().min(3).max(60),
        subheadline: z.string().max(90).optional(),
        benefits: z
          .array(
            z.object({
              icon: z
                .string()
                .describe(
                  'One of the supported icon names (same set as A+ icon rows, ' +
                    'e.g. shield, leaf, zap, check, droplet, thermometer)'
                ),
              label: z.string().min(2).max(40),
              text: z.string().max(90).optional(),
            })
          )
          .min(2)
          .max(5)
          .optional()
          .describe('benefit-grid template: 2-5 benefits'),
        callouts: z
          .array(
            z.object({
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              title: z.string().min(2).max(40),
              text: z.string().max(80).optional(),
            })
          )
          .min(2)
          .max(6)
          .optional()
          .describe(
            'callout-overlay template: 2-6 callouts. x/y are CANVAS fractions ' +
              'placed ON the pictured feature — the product renders centered in ' +
              'roughly the region x 0.15-0.85, y 0.25-0.9. Spread callouts apart.'
          ),
        colors: z
          .object({
            background: z.string().optional(),
            text: z.string().optional(),
            accent: z.string().optional(),
          })
          .optional()
          .describe('Hex colors — use the brand palette when one is known'),
      }),
      execute: (input: {
        template: 'benefit-grid' | 'callout-overlay';
        label: string;
        productImageAssetId: string;
        headline: string;
        subheadline?: string;
        benefits?: Array<{ icon: string; label: string; text?: string }>;
        callouts?: Array<{
          x: number;
          y: number;
          title: string;
          text?: string;
        }>;
        colors?: { background?: string; text?: string; accent?: string };
      }) =>
        wrap(input.label, () =>
          imageOps.renderInfographic({
            template: input.template,
            productImageAssetId: input.productImageAssetId,
            headline: input.headline,
            subheadline: input.subheadline,
            benefits: input.benefits,
            callouts: input.callouts,
            colors: input.colors,
          })
        ),
    },

    'compose-image': {
      description:
        'Layer one image on top of another — typically a transparent product cutout ' +
        '(from remove-image-background with background "transparent") placed onto a ' +
        'background/scene image. Position and scale control where and how large the ' +
        'product appears. Produces a NEW labeled photo, displayed automatically. ' +
        'Composites are for lifestyle/secondary/A+ imagery — an Amazon MAIN image must ' +
        'be a real photo of the product on white, not a composite scene.',
      inputSchema: z.object({
        foregroundAssetId: ASSET_ID_SCHEMA.describe(
          'Asset id of the image to place on top (transparent PNG cutouts look best)'
        ),
        backgroundAssetId: ASSET_ID_SCHEMA.describe(
          'Asset id of the background/scene image'
        ),
        label: PHOTO_LABEL_SCHEMA,
        position: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
          })
          .optional()
          .describe(
            'Center of the foreground as fractions of the background (default x 0.5, y 0.6)'
          ),
        scale: z
          .number()
          .min(0.05)
          .max(1)
          .optional()
          .describe(
            'Foreground width as a fraction of the background width (default 0.7)'
          ),
        shadow: z
          .boolean()
          .optional()
          .describe(
            'Soft drop shadow under the foreground so it sits naturally in the ' +
              'scene (default true; disable for flat graphics)'
          ),
      }),
      execute: (input: {
        foregroundAssetId: string;
        backgroundAssetId: string;
        label: string;
        position?: { x: number; y: number };
        scale?: number;
        shadow?: boolean;
      }) =>
        wrap(input.label, () =>
          imageOps.compose({
            foregroundAssetId: input.foregroundAssetId,
            backgroundAssetId: input.backgroundAssetId,
            position: input.position,
            scale: input.scale,
            shadow: input.shadow,
          })
        ),
    },

    'remove-image-background': {
      description:
        'Remove the background from a product photo (ML segmentation of the real pixels — ' +
        'not AI regeneration, so the product stays authentic; required for Amazon main ' +
        'images). background "white" flattens to pure white (Amazon main image), ' +
        '"transparent" keeps a PNG cutout for compositing. Produces a NEW labeled photo, ' +
        'displayed to the user automatically.',
      inputSchema: z.object({
        assetId: ASSET_ID_SCHEMA,
        label: PHOTO_LABEL_SCHEMA,
        background: z.enum(['white', 'transparent']).optional(),
      }),
      execute: (input: {
        assetId: string;
        label: string;
        background?: 'white' | 'transparent';
      }) =>
        wrap(input.label, () =>
          imageOps.removeBackground({
            assetId: input.assetId,
            background: input.background,
          })
        ),
    },
  };
}

function getImageTools(
  imageGenerator: ImageGenerator,
  assetStore?: SellerAssetStore
) {
  return {
    'generate-image': {
      description:
        'Generate a standalone image from a text prompt (infographics, banners, ' +
        'concept art). For listing photos of the actual product, use ' +
        'propose-listing-photos instead — it works from the user’s reference ' +
        'photos. Generated images are saved to the asset library and displayed ' +
        'to the user automatically; label them "Photo <letter>" continuing the ' +
        'sequence used in this conversation.',
      inputSchema: z.object({
        prompt: z
          .string()
          .min(10)
          .describe(
            'Detailed description of the image to generate. Include: ' +
              '1) Subject/product description, 2) Setting/background, 3) Style (photorealistic, ' +
              'illustration, etc.), 4) Lighting, 5) Composition/angle.'
          ),
        label: z
          .string()
          .regex(/^Photo [A-Z]{1,2}$/)
          .optional()
          .describe(
            'Identifier like "Photo D" — continue the letter sequence already ' +
              'used (after Photo Z comes Photo AA, AB, ...)'
          ),
        size: z
          .enum(['1024x1024', '1792x1024', '1024x1792'])
          .optional()
          .describe(
            'Image dimensions. 1792x1024 landscape, 1024x1792 portrait, 1024x1024 square (default).'
          ),
      }),
      execute: async (input: {
        prompt: string;
        label?: string;
        size?: '1024x1024' | '1792x1024' | '1024x1792';
      }) => {
        try {
          const results = await imageGenerator.generate({
            prompt: input.prompt,
            size: input.size || '1024x1024',
          });
          const first = results[0];
          if (!first?.url) {
            return { success: false, error: 'No image returned.' };
          }
          if (!assetStore) {
            return {
              success: true,
              mediaType: first.mediaType,
              note: 'Image generated but no asset store is configured; it could not be saved.',
            };
          }
          const saved = await assetStore.saveGeneratedImage({
            dataUrl: first.url,
          });
          return {
            success: true,
            images: [
              {
                label: input.label,
                assetId: saved.assetId,
                url: saved.url,
              },
            ],
            revisedPrompt: first.revisedPrompt,
            note: 'The image is displayed to the user automatically with its label.',
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : 'Generation failed.',
          };
        }
      },
    },
  };
}

export function createSellerAgent({
  spCache,
  provider,
  imageGenerator,
  assetStore,
  imageOps,
  modelTier,
  marketplaceId,
  additionalInstructions,
}: SellerAgentConfig) {
  // Only include Amazon tools if spCache is available (user has connected their Amazon account)
  const spTools = spCache ? getToolsForAgent(spCache, marketplaceId) : {};
  // Listings tools additionally need the merchant token from the connection.
  const listingsTools = spCache?.hasSellerId() ? getListingsTools(spCache) : {};
  const imageTools = imageGenerator
    ? getImageTools(imageGenerator, assetStore)
    : {};
  const photoTools =
    imageGenerator && assetStore
      ? getPhotoTools(imageGenerator, assetStore)
      : {};
  const imageEditTools = imageOps ? getImageEditTools(imageOps) : {};
  const tools = {
    ...spTools,
    ...listingsTools,
    ...imageTools,
    ...photoTools,
    ...imageEditTools,
  };

  const hasAmazonConnection = !!spCache;
  const hasImageGeneration = !!imageGenerator;

  const imageInstructions = hasImageGeneration
    ? `
- generate-image: Create images for A+ content, lifestyle photos, or infographics.
  Provide detailed prompts including subject, setting, style, lighting, and composition.

IMAGE GENERATION FOR A+ CONTENT:
When asked to create images for A+ content or product listings:
1. Ask clarifying questions about the product, brand style, and intended use.
2. Craft a detailed prompt that includes:
   - Product description and key features to highlight
   - Setting/context (lifestyle, studio, in-use, etc.)
   - Style (photorealistic, minimalist, lifestyle, infographic)
   - Lighting and mood
   - Composition and angle
3. Use appropriate size: 1792x1024 for banners, 1024x1024 for modules, 1024x1792 for mobile.
4. Generate the image — it is displayed to the user automatically; never paste image URLs.
5. Offer to generate variations or adjustments.

Example prompt for a tea infuser:
"Professional product lifestyle photo of a stainless steel mesh tea infuser steeping in a clear
glass mug of amber tea, steam rising gently, on a light wood table with scattered dried tea leaves
and a small honey jar in soft focus background. Warm morning sunlight from left side, cozy kitchen
setting, photorealistic style, 45-degree overhead angle."
`
    : '';

  const hasPhotoTools = Boolean(imageGenerator && assetStore);
  const photoInstructions = hasPhotoTools
    ? `
- propose-listing-photos: Generate proposed listing photos of the user's EXACT product
  from their attached reference photos (image-to-image).

PHOTO WORKFLOW (attachments, labels, proposals):
- Users attach product photos as a manifest of markdown images labeled "Photo A",
  "Photo B", ... The asset id is the last path segment of each image URL
  (/api/a-plus/assets/<assetId>).
- EVERY image in this conversation has a unique letter label. When you generate new
  images (propose-listing-photos shots or generate-image), assign the next unused
  letters — scan the conversation AND the PHOTO LABEL REGISTRY for labels already
  taken (uploads AND earlier proposals) and continue the sequence. After Photo Z the
  sequence continues Photo AA, Photo AB, and so on.
- When the user refers to "Photo B", resolve it to its asset id from the manifest or
  tool result where Photo B first appeared.
- Proposing listing photos: use the user's attached photos as referenceAssetIds,
  write a factual productDescription from what they've told you (colors, materials,
  parts), and pick a useful shot mix — main-white first if they lack a clean main
  image, then lifestyle/detail/scale. Ask about the product before proposing if you
  know nothing about it.
- All generated and listing images are DISPLAYED to the user automatically with
  their labels. Never paste image URLs into your reply — refer to images by label.`
    : '';

  const imageEditInstructions = imageOps
    ? `
- crop-image / scale-image / remove-image-background: Edit an existing photo by asset id.
  Each edit produces a NEW labeled photo (originals are never modified) and is displayed
  to the user automatically.

IMAGE EDITING GUIDANCE:
- Amazon main images: remove-image-background with background "white", then crop-image
  aspect "1:1" if framing needs it, then scale-image to at least 1000px (allowUpscale
  when the source is small). Chain edits by feeding the previous result's assetId in.
- remove-image-background is a real segmentation cutout of the photo's pixels — prefer
  it over generating a new image when the user wants THEIR photo on a clean background.
- Product-on-scene composites: remove-image-background with background "transparent",
  then compose-image with the cutout as foreground over a background (an uploaded scene
  photo or a generate-image backdrop). Composites are secondary/A+ imagery only — never
  present a composite as the MAIN image.
- Infographic listing images: prefer generate-infographic over generate-image whenever
  the image needs READABLE TEXT (benefits, specs, feature callouts) — its text is
  rendered type, never garbled. Feed it a transparent cutout, keep copy short and
  factual (fact-sheet claims only), and use brand colors when known. For
  callout-overlay, place x/y ON the pictured feature and spread callouts apart.
- Ask before destructive-feeling choices (e.g. tight crops that drop parts of the
  product); state which photo label each result came from.`
    : '';

  const hasListingsTools = Boolean(spCache?.hasSellerId());
  const listingsInstructions = hasListingsTools
    ? `
- search-my-listings: Search the seller's OWN listings (by SKU, ASIN, or all). The way to
  resolve an ASIN or product name to a seller SKU. A listing's identity is its seller SKU —
  one ASIN can have several listings.
- get-my-listing: The seller's OWN submitted listing for a SKU — real attributes plus Amazon's
  open validation issues. Its images are displayed to the user automatically in the chat; you
  do not need to repeat the image URLs in your reply, but DO comment on what the images show
  and what is missing. Prefer this over get-listing when the question is about the seller's
  own listing quality, issues, or images.`
    : '';

  const baseInstructions = hasAmazonConnection
    ? `You are Sellavant, an expert Amazon Seller Assistant.
You help Amazon sellers understand their business, optimize listings, and grow sales.

AVAILABLE TOOLS:
- search-catalog: Find products by keywords, ASIN, or brand. Use this first when looking for a listing.
- get-listing: Get full listing details (title, bullets, description, images, product type, sales rank).
  Use this for listing analysis and critique.
- get-orders: Get recent orders with filtering by date, status, fulfillment channel.
- get-order-details: Get specific order details with line items.
- get-inventory: Check FBA inventory levels by SKU.${listingsInstructions}${imageInstructions}${photoInstructions}${imageEditInstructions}

LISTING CRITIQUE WORKFLOW:
When asked to critique, analyze, or improve a listing:
1. If the user gives you an ASIN, call get-listing directly.
2. If they describe a product (e.g., "my tea infuser"), call search-catalog first to find matching products.
3. Call get-listing with the ASIN to get full details (summaries, attributes, images, dimensions, sales rank).
4. Analyze these aspects and provide specific, actionable suggestions:

   TITLE:
   - Is it 150-200 characters? Does it front-load the primary keyword?
   - Does it include brand, key features, size/quantity, and differentiators?
   - Avoid keyword stuffing or ALL CAPS.

   BULLET POINTS:
   - Are there 5 bullets? Are they benefit-driven (not just features)?
   - Do they start with a capital letter keyword phrase?
   - Are they scannable (under 200 chars each)?
   - Do they address common buyer questions and objections?

   DESCRIPTION / A+ CONTENT:
   - Is there a product description or A+ content?
   - Does it tell a story and reinforce the value proposition?
   - Does it include secondary keywords not in the title/bullets?

   IMAGES:
   - How many images are present? (Aim for 7+, including main, lifestyle, infographic, size chart)
   - Is there a main image on white background?

   PRODUCT TYPE & CATEGORY:
   - Is it in the right browse node / category?
   - Are dimensions and weight filled in?

   SALES RANK:
   - What is the current sales rank? In which category?
   - How does this suggest current performance?

   Provide specific rewrite examples (e.g., "Change your title from X to Y") rather than generic advice.

ORDER ANALYSIS:
- When asked about orders, sales, or performance, call get-orders with appropriate filters.
- Summarize trends: total orders, top ASINs, fulfillment breakdown (FBA vs MFN).
- If asked about a specific order, use get-order-details.

INVENTORY MANAGEMENT:
- When asked about stock levels, call get-inventory.
- Flag low-stock items and estimate days of inventory remaining based on recent order velocity.

GENERAL GUIDELINES:
- Always use tools to fetch real data before answering questions. Don't guess.
- Present data in clear markdown tables when appropriate.
- Be concise but thorough in your analysis.
- When you don't have enough data, explain what additional info you'd need.

A+ CONTENT RULE — NO TIME-SENSITIVE CLAIMS:
When suggesting A+ Content copy, image briefs, or module direction, NEVER include price points, dollar amounts, promotional language ("sale", "X% off", "limited time"), delivery/shipping claims ("ships in", "Prime delivery", "free shipping"), stock claims ("in stock", "limited quantity"), or any time-bound statement. A+ Content stays live indefinitely once approved — these claims go stale and Amazon rejects them. Lead with durable benefits: materials, use cases, durability, brand story, problem-solving.
`
    : `You are Sellavant, an expert Amazon Seller Assistant.
You help Amazon sellers understand their business, optimize listings, and grow sales.

NOTE: Your Amazon account is not yet connected. You can still:
- Answer general questions about Amazon selling best practices
- Discuss listing optimization strategies
- Explain how to improve titles, bullet points, and descriptions
- Provide guidance on inventory management and order fulfillment
- Help with keyword research and competitive analysis concepts

To access your real Amazon data (orders, inventory, listings), please go to Settings and connect your Amazon Seller account.

For now, feel free to ask me anything about Amazon selling!
`;

  const instructions = additionalInstructions
    ? `${baseInstructions}\n\n${additionalInstructions}`
    : baseInstructions;

  const providerOptions = {
    anthropic: {
      cacheControl: { type: 'ephemeral' as const },
    },
  };

  return new ToolLoopAgent({
    model: provider.languageModel(modelTier),
    instructions,
    tools: tools as any,
    stopWhen: stepCountIs(20),
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'chat.seller-agent',
    },
    providerOptions,
  });
}

export type SellerAgentUIMessage = InferAgentUIMessage<
  ReturnType<typeof createSellerAgent>
>;
