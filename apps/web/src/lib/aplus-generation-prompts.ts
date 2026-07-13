import {
  APLUS_GUIDANCE_MAX_LENGTH,
  RENDERABLE_AMAZON_MODULE_TYPES,
} from '@farvisionllc/models';

/**
 * Shared A+ generation prompt building blocks. Client-safe (no server-only
 * imports) so the advanced-mode guidance overlay can show the REAL prompts the
 * generator runs, instead of a hand-maintained copy that drifts.
 */

export { APLUS_GUIDANCE_MAX_LENGTH };

export const NO_TIME_SENSITIVE_RULE = [
  'CRITICAL — NO TIME-SENSITIVE CLAIMS. The following content is FORBIDDEN in every field of the output (headline, bodyCopy, bullets, visualBrief, canvaLayers content, alt text, image prompts, build sheet, everything):',
  '  • Price points or dollar amounts ($, €, £, "only X dollars", "starting at", etc.)',
  '  • Promotional language ("sale", "discount", "X% off", "limited time", "deal", "offer")',
  '  • Delivery or shipping claims ("ships in", "arrives by", "free shipping", "Prime delivery", "same-day", "next-day")',
  '  • Stock or availability claims ("in stock", "limited quantity", "while supplies last", "selling fast")',
  '  • Time-bound claims ("new for 2026", "this season", "now available")',
  'Reason: A+ Content stays live indefinitely once approved; these claims go stale fast and Amazon rejects them. Use price input only as positioning context (e.g. premium voice vs value voice) — never surface the number. Lead with durable benefits, materials, use cases, durability, and brand story instead.',
].join('\n');

/** Per-module field rules shared by both module generation strategies. */
export const MODULE_FIELD_RULES: string[] = [
  'SUBJECT PRODUCT ONLY: describe and depict OUR product (the "Product listing" source / product facts). Competitor, Supplier, and Reference sources are DIFFERENT products — use them ONLY for comparison-table contrasts and positioning. NEVER attribute their color, size, materials, pack count, lids, or features to our product, in copy OR in image briefs.',
  'NEVER mention price, discounts, or promotions anywhere — A+ content stays live indefinitely and Amazon rejects time-sensitive claims.',
  'TEXT FIELDS — write real CUSTOMER-FACING copy the buyer reads. Not design notes, not descriptions of the layout.',
  '  • headline: ≤8 words, a concrete benefit. body: 1–3 sentences of durable benefit/use-case copy. bullets: ≤90 chars each, benefit statements.',
  '  • company-logo: a full-bleed brand HERO. Set headline to the brand name plus a short product descriptor — the hero line, ≤8 words (e.g. “<Brand> <Product Category>”). Set tagline to a short (≤10 words) durable benefit/brand-promise subhead. Both must suit THIS product (any category — never assume a specific one). No price/claims. ALSO choose a hero TREATMENT that best fits this product so pages do not all look identical: set heroVariant to one of overlay | split | plate | glass, and (only for overlay) set logoCorner to bottom-left or bottom-right. Vary this choice per product based on the brand mood — do NOT default every product to the same one.',
  '  • hero modules (image-header-with-text / image-text-overlay / single-image-text / image-and-text): set badge to a SHORT spec/size pill (≤12 chars, e.g. “16 OZ”, “50-PACK”, “BPA-FREE”) when an obvious size/spec applies; omit otherwise. Never price or promo.',
  '  • comparison-table: products[].title are the column labels; rows[] are spec/benefit rows with exactly one value per product (same order). Set highlight=true on the seller’s own product.',
  '  • tech-specs: rows[] are {label, value} product facts (dimensions, materials, care, compatibility, package contents).',
  '',
  'IMAGE SLOTS — every image slot describes a PHOTOGRAPH to be generated or uploaded later. For each slot provide role, size, alt, and brief. DO NOT output an "image" field; slots are filled downstream.',
  '  • role: short stable id (e.g. "hero", "column-1", "comparison-thumb-1").',
  '  • size: 1792x1024 for a wide hero/banner; 1024x1024 for square feature/column/grid images; 1024x1792 only when a tall portrait genuinely helps.',
  '  • alt: ≤160 char description of the photo content. No brand names.',
  '  • brief: a CINEMATIC, ASPIRATIONAL LIFESTYLE photographic prompt of 4–6 sentences — the kind of premium imagery in a high-end brand campaign, NOT a plain product shot. Prefer real people / hands actively USING the product in a believable moment, in a specific aspirational named environment (e.g. a sunlit specialty café, a modern kitchen at golden hour). It must name: the human action/moment, the hero product in genuine use, 3–5 atmospheric props, a specific surface + directional natural light source + ambient background depth, cinematic editorial lighting (soft window light, warm golden hour, etc.), shallow depth of field with foreground/mid/background layers, and a refined premium brand mood. Avoid flat-lay, isolated-on-white, studio-seamless, stock-photo stiffness, and minimalist-whitespace defaults.',
  '  • NO ABSTRACT / CGI SLOP: every image is a believable REAL PHOTOGRAPH of the actual product. NEVER ask for cutaways, cross-sections, exploded views, technical/engineering diagrams, schematics, infographics, 3D-render or CGI looks, extreme material macros, or floating/isolated concept shots. For a feature/benefit cell, show the product in a real context that IMPLIES the benefit (e.g. the cup comfortably held, a neat stack on a counter) — never a diagram OF the benefit.',
  '  • CONTINUITY: every brief MUST restate the SAME product (same material/color/finish/shape per the SHOT BIBLE) and the SAME lighting, palette, lens and mood, so all images look like one shoot.',
  '  • CRITICAL: the brief must NEVER ask for any rendered text, headline, label, callout, price, watermark, badge, or logo. All text lives in the HTML fields above, never baked into pixels.',
  '  • company-logo background slot: ALWAYS include a background slot for every company-logo module — the header is a brand HERO, never a bare logo. It is an AMBIENT, on-brand LIFESTYLE photo of the REAL setting where THIS specific product is actually used or displayed — DERIVE the setting from the product category, never a generic/fixed theme. THE PRODUCT ITSELF MUST APPEAR in the scene, softly out of focus and pushed toward ONE side, so the backdrop is unmistakably about THIS product (not a random room). Keep clean, low-detail NEGATIVE SPACE on the OPPOSITE side so the overlaid headline/subhead stays legible. Soft out-of-focus depth, gentle bokeh, premium natural light. NEVER include unrelated focal objects — no electronics, appliances, printers, gadgets, office equipment, or any prop that is not the product or a natural part of its genuine use setting. No text, no logos, no people staring at camera.',
];

/** Module count target for a content tier (Premium A+ pages run longer). */
export function aplusModuleLimitForTier(contentTier: string): number {
  return contentTier === 'Premium A+' ? 7 : 5;
}

/** Minimal structural view of the generate request used to build prompts. */
export type APlusGenerateInputForPrompt = {
  productName?: string;
  asin?: string;
  contentTier: string;
  rawNotes?: string;
  productOneLiner?: string;
  targetCustomer?: string;
  /** Accepted for positioning context but never serialized into the prompt. */
  pricePoint?: string;
  keyFeatures?: string;
  differentiators?: string;
  objections?: string;
  brand?: {
    name?: string;
    brandName?: string;
    colors?: string;
    fonts?: string;
    voice?: string;
    logoNotes?: string;
    logoAssetId?: string;
  };
  sources: Array<{ id?: number; kind: string; url: string }>;
  assets: Array<{
    fileName: string;
    description?: string;
    asset?: { assetId: string; mimeType: string };
    uploadStatus?: string;
  }>;
};

export function humanProductName(input: {
  productName?: string;
  asin?: string;
}): string {
  return input.productName?.trim() || input.asin?.trim() || 'this product';
}

/** Serializes the request into the compact JSON context the prompts embed. */
export function compactGenerationInput(
  input: APlusGenerateInputForPrompt
): string {
  return JSON.stringify(
    {
      product: {
        name: input.productName,
        asin: input.asin,
        contentTier: input.contentTier,
        oneLiner: input.productOneLiner,
        targetCustomer: input.targetCustomer,
        // Price is intentionally NOT sent: A+ content never displays price and
        // extracted prices are unreliable. Omitting it keeps it out of copy.
        keyFeatures: input.keyFeatures,
        differentiators: input.differentiators,
        objections: input.objections,
        rawNotes: input.rawNotes,
      },
      brand: input.brand,
      sources: input.sources.filter((source) => source.url?.trim()),
      assets: input.assets.map((asset) => ({
        fileName: asset.fileName,
        description: asset.description,
        assetId: asset.asset?.assetId,
        mimeType: asset.asset?.mimeType,
        status: asset.uploadStatus,
      })),
    },
    null,
    2
  );
}

/**
 * Wraps optional seller guidance so it steers generation without being able to
 * override the compliance rules in the base prompt.
 */
function guidanceBlock(scope: string, text: string): string {
  return [
    `SELLER GUIDANCE — ${scope} (from the user; follow it unless it conflicts with the compliance rules above, which always win):`,
    text.trim(),
  ].join('\n');
}

/** The Phase-1 strategy prompt — exactly what the generator runs. */
export function buildStrategyPrompt(options: {
  contextJson: string;
  moduleCount: number;
  guidance?: string;
}): string {
  const guidance = options.guidance?.trim();
  return [
    'You are an ecommerce content strategist for Amazon A+ content.',
    'Create a practical strategy from the provided product facts, links, brand guide, and uploaded assets.',
    'Do not use placeholder strings. If information is missing, make a safe assumption or add it to missingFacts.',
    'The user is an ecommerce operator, not a designer. Choose modules and asset usage for them.',
    `For each modulePlan entry, set moduleType to one of these exact Amazon module types: ${RENDERABLE_AMAZON_MODULE_TYPES.join(
      ', '
    )}.`,
    `Plan the COMPLETE package: choose and ORDER exactly ${options.moduleCount} modulePlan entries that tell THIS product's story end to end. This is the final module sequence.`,
    'STRUCTURE MUST BE DYNAMIC, not a fixed template: decide the opening, the mix of module types, and their order based on what THIS specific product needs to persuade its buyer. Two different products should produce noticeably different structures — vary which modules appear and in what sequence. Do not default to one canonical order.',
    'Use a VARIETY of distinct module types (each renders as a different layout). Open with a strong hero or brand moment, then sequence the rest into the most persuasive narrative for this product (features, real-life use cases, proof/specs, comparison, brand story) — in whatever order fits best. Avoid repeating the same moduleType.',
    'NEVER plan modules around price points, discounts, promotions, delivery times, shipping speed, stock levels, or any time-sensitive claim. A+ Content stays live indefinitely; these go stale fast and Amazon rejects them.',
    'Competitor/Reference/Supplier sources are DIFFERENT products. Use them only to inform comparison and positioning — NEVER let their attributes (color, size, materials, pack count, finishes) define our product’s appearance or the visual system.',
    ...(guidance ? ['', guidanceBlock('STRATEGY', guidance)] : []),
    '',
    options.contextJson,
  ].join('\n');
}

/** Seller guidance block appended to the module-copy shared context. */
export function buildModuleCopyGuidanceBlock(text: string): string {
  return guidanceBlock('MODULE COPY', text);
}

/** Seller strategy guidance block (for prompts other than buildStrategyPrompt). */
export function buildStrategyGuidanceBlock(text: string): string {
  return guidanceBlock('STRATEGY', text);
}

/**
 * Read-only preview of the fixed module-copy rules for the guidance overlay.
 * (Product context, module plan, and shot bible are appended at generation
 * time — they depend on the strategy result.)
 */
export function buildModuleCopyRulesPreview(): string {
  return [...MODULE_FIELD_RULES, NO_TIME_SENSITIVE_RULE].join('\n');
}
