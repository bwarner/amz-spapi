import { ToolLoopAgent, InferAgentUIMessage, stepCountIs } from 'ai';
import { z } from 'zod';
import type { SpCache } from '@amz-spapi/sp-cache';
import type {
  AIProvider,
  ImageGenerator,
  ModelTier,
} from '@amz-spapi/ai-provider';

export interface SellerAgentConfig {
  spCache?: SpCache;
  provider: AIProvider;
  imageGenerator?: ImageGenerator;
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

function getImageTools(imageGenerator: ImageGenerator) {
  return {
    'generate-image': {
      description:
        'Generate an image for A+ content, lifestyle photos, infographics, or product ' +
        'context. Provide a detailed prompt describing the image. The generated image is ' +
        'NOT returned in the chat — it is saved separately. Tell the user to view and ' +
        'download generated images from the A+ Content Studio review page.',
      inputSchema: z.object({
        prompt: z
          .string()
          .min(10)
          .describe(
            'Detailed description of the image to generate. Include: ' +
              '1) Subject/product description, 2) Setting/background, 3) Style (photorealistic, ' +
              'illustration, etc.), 4) Lighting, 5) Composition/angle.'
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
        size?: '1024x1024' | '1792x1024' | '1024x1792';
      }) => {
        console.log(
          '[tool:generate-image] Generating with prompt:',
          input.prompt.substring(0, 100) + '...'
        );
        try {
          const results = await imageGenerator.generate({
            prompt: input.prompt,
            size: input.size || '1024x1024',
          });
          console.log(
            '[tool:generate-image] Success, generated',
            results.length,
            'image(s)'
          );
          return {
            success: true,
            count: results.length,
            mediaType: results[0]?.mediaType,
            note: 'Image generated. Bytes are not returned in chat. Direct the user to the A+ Content Studio review page to view and download.',
          };
        } catch (err: any) {
          console.error('[tool:generate-image] ERROR:', err.message);
          return {
            success: false,
            error: err.message,
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
  modelTier,
  marketplaceId,
  additionalInstructions,
}: SellerAgentConfig) {
  // Only include Amazon tools if spCache is available (user has connected their Amazon account)
  const spTools = spCache ? getToolsForAgent(spCache, marketplaceId) : {};
  const imageTools = imageGenerator ? getImageTools(imageGenerator) : {};
  const tools = { ...spTools, ...imageTools };

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
4. Generate the image and present the URL to the user.
5. Offer to generate variations or adjustments.

Example prompt for a tea infuser:
"Professional product lifestyle photo of a stainless steel mesh tea infuser steeping in a clear
glass mug of amber tea, steam rising gently, on a light wood table with scattered dried tea leaves
and a small honey jar in soft focus background. Warm morning sunlight from left side, cozy kitchen
setting, photorealistic style, 45-degree overhead angle."
`
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
- get-inventory: Check FBA inventory levels by SKU.${imageInstructions}

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
