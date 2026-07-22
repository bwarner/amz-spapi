import {
  APLUS_GUIDANCE_MAX_LENGTH,
  APLUS_PLANNABLE_ARCHETYPES,
  CONVERSION_JOBS,
  ICON_ROW_ICONS,
  PREMIUM_PLANNABLE_ARCHETYPES,
  type NarrativeBeat,
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
  'NEVER echo supplier listing titles, SEO keyword strings, factory/company names, or document/file names from the sources into ANY customer-facing field (titles, headlines, column labels, captions, alt text). Source text is raw material to learn facts from, never copy.',
  'TEXT FIELDS — write real CUSTOMER-FACING copy the buyer reads. Not design notes, not descriptions of the layout.',
  '  • headline: ≤8 words, a concrete benefit. body: 1–3 sentences of durable benefit/use-case copy. bullets: ≤90 chars each, benefit statements.',
  '  • company-logo: a full-bleed brand HERO. Set headline to the brand name plus a short product descriptor — the hero line, ≤8 words (e.g. “<Brand> <Product Category>”). Set tagline to a short (≤10 words) durable benefit/brand-promise subhead. Both must suit THIS product (any category — never assume a specific one). No price/claims. ALSO choose a hero TREATMENT that best fits this product so pages do not all look identical: set heroVariant to one of overlay | split | plate | glass, and (only for overlay) set logoCorner to bottom-left or bottom-right. Vary this choice per product based on the brand mood — do NOT default every product to the same one.',
  '  • hero modules (image-header-with-text / image-text-overlay / single-image-text / image-and-text): set badge to a SHORT spec/size pill (≤12 chars, e.g. “16 OZ”, “50-PACK”, “BPA-FREE”) when an obvious size/spec applies; omit otherwise. Never price or promo.',
  '  • comparison-table: products[].title are the column labels; rows[] are spec/benefit rows with exactly one value per product (same order). Set highlight=true on the seller’s own product. The own-product column title is a SHORT buyer-facing product name (≤4 words) derived from the product facts (e.g. the product’s category name); competitor columns get generic category descriptors. NEVER use supplier listing titles, factory/company names, or document/file names as a column title.',
  '  • tech-specs: rows[] are {label, value} product facts (dimensions, materials, care, compatibility, package contents).',
  `  • icon-row: each item's icon MUST be one of exactly: ${ICON_ROW_ICONS.join(', ')}. Any other name renders as a generic fallback glyph — pick the closest supported one.`,
  '  • PREMIUM COPY BUDGETS: on Premium A+ pages the copy is typed into Amazon’s native fields with HARD caps. For single-image / image-and-text modules keep body + bullets ≤450 characters COMBINED (the native text field holds 500). For full-bleed hero / image-header / brand-hero modules keep the body ≤280 characters (native description holds 300) and the headline ≤60 characters. Prefer 2–3 tight bullets over 4 long ones.',
  '  • qna (Premium): items[] are REAL buyer objections, each question ≤120 chars ending with "?", answered in 1–3 factual sentences backed by the FACT SHEET. Never open an answer with filler like “Great question”.',
  '  • hotspots (Premium): ONE wide base image (size 1792x1024) showing the WHOLE product with every callout-worthy feature clearly visible. Each hotspot: position {x, y} as fractions 0..1 placed ON the pictured feature (spread the markers apart — never cluster), label ≤50 chars naming the feature, copy one factual sentence.',
  '  • carousel (Premium): slides[] tell ONE sequential story — each slide a visually DISTINCT scene carrying one idea (never crops or variations of the same photo). Per slide: a short headline (≤100 chars) and/or caption (≤200 chars). All slide briefs follow the SHOT BIBLE so the sequence reads as one shoot.',
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

/** The Phase-1 narrative planning prompt — exactly what the generator runs. */
export function buildNarrativePlanPrompt(options: {
  contextJson: string;
  beatCount: number;
  guidance?: string;
  /** 'Premium A+' unlocks the EBC-native archetypes; defaults to Basic. */
  tier?: string;
}): string {
  const guidance = options.guidance?.trim();
  const premium = options.tier === 'Premium A+';
  const archetypes = premium
    ? PREMIUM_PLANNABLE_ARCHETYPES
    : APLUS_PLANNABLE_ARCHETYPES;
  return [
    'You are an ecommerce conversion strategist planning an Amazon A+ content page as a BUYER-JOURNEY NARRATIVE.',
    'Analyze the buyer first, then plan an ordered list of narrative BEATS. Each beat is ONE section of the page carrying exactly ONE conversion job and ONE idea — split or cut anything that needs two.',
    `For each beat set: order (1..N), job (one of: ${CONVERSION_JOBS.join(
      ', '
    )}), archetype (one of: ${archetypes.join(
      ', '
    )}), intent (ONE sentence: what this section must make the buyer believe or feel), headlineAngle (optional short angle, not final copy), assetsToUse (fileNames of uploaded assets to feature).`,
    ...(premium
      ? [
          'PREMIUM A+ ARCHETYPES — this page deploys as Premium A+ (EBC), so the interactive showcase archetypes are available. Use each AT MOST ONCE per page, and only where it out-converts a static layout:',
          '  • hotspots: best for feature-dense products — one wide hero photo carrying 3–6 labeled feature callouts. Choose it when several physical features deserve pointing at on ONE image.',
          '  • qna: ONLY when buyer.mainObjections has substantive entries — each Q&A pair resolves one real objection with facts. Skip it for objection-light products.',
          '  • carousel: best for range/variety stories (use cases, settings, steps) — 2–6 slides, one idea per slide.',
        ]
      : []),
    'DERIVE THE ARC FROM THIS PRODUCT’S STRATEGY — NOT A TEMPLATE:',
    '  • Every major objection you list in buyer.mainObjections must be answered by a beat (proof, comparison, how-it-works, or spec-sheet).',
    '  • The top benefits drive benefit / use-cases beats, weighted by how much they matter to THIS buyer.',
    '  • Soft skeleton to select, order, and weight per product (do NOT include every step): hook → (problem) → benefits → differentiation → proof → use-cases → brand → cta. A commodity leans differentiation+comparison; a premium brand leans brand+proof; a technical product leans how-it-works+spec-sheet.',
    `Plan EXACTLY ${options.beatCount} beats. Every beat costs one of the page's few Amazon module slots — spend each one on conversion. Include a brand beat (brand-story-band) ONLY when brand trust is genuinely central to this purchase decision; never spend a slot on a bare logo band.`,
    'The FIRST beat is the above-the-fold opener — use a visual archetype (full-bleed-hero, lifestyle-immersion, split-LR, or brand-story-band). NEVER open with comparison-table, spec-sheet, or icon-row.',
    'LAYOUT DIVERSITY: never use the same archetype in two consecutive beats; vary layouts across the page.',
    'Also return artDirection: positioning (the one persuasive frame), visualSystem (palette/lighting/mood in one paragraph), mobilePrinciple, imagePlan (how uploaded assets vs generated imagery will be used).',
    'Write productSummary, every intent, and every headlineAngle in clean buyer-facing language. NEVER echo supplier listing titles, SEO keyword strings, factory/company names, or document names from the sources — an Alibaba listing title is raw material to learn facts from, not copy.',
    'Do not use placeholder strings. If information is missing, make a safe assumption or add it to missingFacts.',
    'NEVER plan beats around price points, discounts, promotions, delivery times, shipping speed, stock levels, or any time-sensitive claim. A+ Content stays live indefinitely; these go stale fast and Amazon rejects them.',
    'Competitor/Reference/Supplier sources are DIFFERENT products. Use them only to inform comparison and positioning — NEVER let their attributes (color, size, materials, pack count, finishes) define our product’s appearance or the visual system.',
    ...(guidance ? ['', guidanceBlock('STRATEGY', guidance)] : []),
    '',
    options.contextJson,
  ].join('\n');
}

/**
 * The FACT SHEET: the only product-construction facts copy may state,
 * verbatim from the seller. Included in every writing context (full
 * generation AND per-section regeneration) alongside FACT_CONSISTENCY_RULE.
 */
export function buildFactSheetBlock(
  input: Pick<
    APlusGenerateInputForPrompt,
    'keyFeatures' | 'differentiators' | 'objections'
  >
): string {
  const lines = (value: string | undefined, label: string) => {
    const items = (value ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return items.length
      ? [`${label}:`, ...items.map((item) => `  • ${item}`)]
      : [];
  };
  return [
    'FACT SHEET — the ONLY product-construction facts you may state (verbatim from the seller):',
    ...lines(input.keyFeatures, 'Product facts'),
    ...lines(input.differentiators, 'Differentiators'),
    ...lines(input.objections, 'Buyer objections to answer'),
  ].join('\n');
}

/** Fact discipline appended to every writing prompt (and the overlay preview). */
export const FACT_CONSISTENCY_RULE = [
  'FACT DISCIPLINE — the FACT SHEET is the only source of physical-product truth:',
  '  • State materials, wall/layer construction, counts, sizes, and certifications EXACTLY as written — never paraphrase upward (e.g. "double-wall" must NEVER become "triple-layer" or "triple-insulated"), never invent counts, materials, or construction claims.',
  '  • If the FACT SHEET does not state a fact, do not claim it.',
  '  • When the INPUT context, source notes, or supplier listings CONTRADICT the FACT SHEET, the FACT SHEET wins — ignore the conflicting source text entirely.',
  '  • Every section describes the SAME physical product — sections must never contradict each other.',
].join('\n');

/**
 * The full page plan, given to every writing call so each section knows what
 * its siblings cover — the cross-section redundancy killer.
 */
export function buildNarrativeContextBlock(
  beats: Array<
    Pick<NarrativeBeat, 'order' | 'job' | 'archetype' | 'intent'> &
      Partial<Pick<NarrativeBeat, 'headlineAngle'>>
  >,
  targetOrder?: number
): string {
  return [
    targetOrder === undefined
      ? 'NARRATIVE — the full page plan. Every section carries ONE job and ONE idea; sections must not repeat each other’s message, facts, or headline angle.'
      : `NARRATIVE — the full page plan. You are writing ONLY beat #${targetOrder}. Sibling beats cover the other angles: do NOT repeat their message, facts, or headline angle — your section must add NEW information.`,
    JSON.stringify(
      beats.map((beat) => ({
        order: beat.order,
        job: beat.job,
        archetype: beat.archetype,
        intent: beat.intent,
        ...(beat.headlineAngle ? { headlineAngle: beat.headlineAngle } : {}),
      })),
      null,
      2
    ),
  ].join('\n');
}

/**
 * Visual continuity shot bible (one photoshoot, one product) shared by the
 * generate route and per-section regeneration.
 */
export function buildShotBibleBlock(options: {
  productName: string;
  visualSystem: string;
}): string {
  return [
    'VISUAL CONTINUITY — SHOT BIBLE (applies to EVERY image brief in this package):',
    `  • SAME HERO PRODUCT in every image: ${options.productName}. Describe its material, color, finish, shape, and proportions IDENTICALLY across all modules so it is unmistakably the same physical product.`,
    '  • Base the product’s appearance ONLY on OUR product facts. Competitor/Reference sources are DIFFERENT products — NEVER borrow their colors, lids, sizes, materials, or finishes (e.g. a competitor’s brown cups must not turn our product brown).',
    `  • ONE consistent look everywhere: ${options.visualSystem} Keep the same color palette, the same lighting direction & quality (e.g. soft warm window light from one side), the same lens/perspective character, and the same mood in every shot.`,
    '  • Treat all module images as frames from ONE cohesive premium photoshoot — never disparate stock photos with different products, lighting, or color grading.',
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
 * (Product context, fact sheet, narrative plan, and shot bible are appended
 * at generation time — they depend on the planning result.)
 */
export function buildModuleCopyRulesPreview(): string {
  return [
    ...MODULE_FIELD_RULES,
    NO_TIME_SENSITIVE_RULE,
    FACT_CONSISTENCY_RULE,
  ].join('\n');
}
