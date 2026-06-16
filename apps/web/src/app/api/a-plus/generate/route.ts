import { generateText, Output } from 'ai';
import { z } from 'zod';
import { createAIProvider } from '@amz-spapi/ai-provider';
import {
  APlusGeneratedModuleSchema,
  RENDERABLE_AMAZON_MODULE_TYPES,
  type RenderableAmazonModuleType,
  amazonModuleTypeToKind,
  generatedModuleSchemaForKind,
  isAplusGenerationModel,
  isRenderableAmazonModuleType,
  moduleImageSlots,
} from '@farvisionllc/models';
import { auth0 } from '../../../../lib/auth0';
import {
  resolveAplusGenerationMode,
  resolveImageModelVariant,
} from '../../../../lib/image-model-flag';

export const maxDuration = 120;

const sourceSchema = z.object({
  id: z.number().optional(),
  kind: z.string(),
  url: z.string(),
});

const assetSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  description: z.string().optional(),
  asset: z
    .object({
      assetId: z.string(),
      originalFileName: z.string(),
      mimeType: z.string(),
      storage: z.object({
        provider: z.string(),
        bucket: z.string(),
        key: z.string(),
      }),
    })
    .optional(),
  uploadStatus: z.string().optional(),
});

const requestSchema = z.object({
  productName: z.string().optional(),
  asin: z.string().optional(),
  // Optional generation model override (gateway slug). Validated against the
  // shared allowlist before use; anything else falls back to the server default.
  model: z.string().optional(),
  contentTier: z.enum(['Basic A+', 'Premium A+']).default('Basic A+'),
  rawNotes: z.string().optional(),
  productOneLiner: z.string().optional(),
  targetCustomer: z.string().optional(),
  pricePoint: z.string().optional(),
  keyFeatures: z.string().optional(),
  differentiators: z.string().optional(),
  objections: z.string().optional(),
  brand: z
    .object({
      name: z.string().optional(),
      brandName: z.string().optional(),
      colors: z.string().optional(),
      fonts: z.string().optional(),
      voice: z.string().optional(),
      logoNotes: z.string().optional(),
      logoAssetId: z.string().optional(),
    })
    .optional(),
  sources: z.array(sourceSchema).default([]),
  assets: z.array(assetSchema).default([]),
});

const strategySchema = z.object({
  productSummary: z.string(),
  buyer: z.object({
    likelyCustomer: z.string(),
    purchaseContext: z.string(),
    mainObjections: z.array(z.string()),
  }),
  usableAssets: z.array(
    z.object({
      fileName: z.string(),
      likelyUse: z.string(),
      confidence: z.enum(['low', 'medium', 'high']),
      notes: z.string(),
    })
  ),
  missingFacts: z.array(
    z.object({
      fact: z.string(),
      whyItMatters: z.string(),
      canProceedWithoutIt: z.boolean(),
    })
  ),
  modulePlan: z.array(
    z.object({
      // Constrained to canonical Amazon module types so each planned module maps
      // to a DISTINCT renderable layout (free-form labels collapse to the
      // single-image-text fallback → every module looks identical).
      moduleType: z.enum(RENDERABLE_AMAZON_MODULE_TYPES),
      role: z.string(),
      assetsToUse: z.array(z.string()),
      reason: z.string(),
    })
  ),
});

const moduleSpecSchema = z.object({
  order: z.number(),
  amazonModuleType: z.enum(RENDERABLE_AMAZON_MODULE_TYPES),
  title: z.string(),
  objective: z.string(),
});

const packageOuterSchema = z.object({
  title: z.string(),
  executiveSummary: z.string(),
  creativeDirection: z.object({
    positioning: z.string(),
    visualSystem: z.string(),
    mobilePrinciple: z.string(),
    imagePlan: z.string(),
  }),
  assumptions: z.array(z.string()),
  moduleSpecs: z.array(moduleSpecSchema).min(1).max(8),
  sellerCentralBuildSheet: z.array(
    z.object({
      step: z.string(),
      value: z.string(),
    })
  ),
  qualityChecklist: z.array(z.string()),
});

const packageSchema = z.object({
  title: z.string(),
  executiveSummary: z.string(),
  creativeDirection: z.object({
    positioning: z.string(),
    visualSystem: z.string(),
    mobilePrinciple: z.string(),
    imagePlan: z.string(),
  }),
  assumptions: z.array(z.string()),
  modules: z.array(APlusGeneratedModuleSchema),
  sellerCentralBuildSheet: z.array(
    z.object({
      step: z.string(),
      value: z.string(),
    })
  ),
  qualityChecklist: z.array(z.string()),
});

type StrategyOutput = z.infer<typeof strategySchema>;
type PackageOuterOutput = z.infer<typeof packageOuterSchema>;

const NO_TIME_SENSITIVE_RULE = [
  'CRITICAL — NO TIME-SENSITIVE CLAIMS. The following content is FORBIDDEN in every field of the output (headline, bodyCopy, bullets, visualBrief, canvaLayers content, alt text, image prompts, build sheet, everything):',
  '  • Price points or dollar amounts ($, €, £, "only X dollars", "starting at", etc.)',
  '  • Promotional language ("sale", "discount", "X% off", "limited time", "deal", "offer")',
  '  • Delivery or shipping claims ("ships in", "arrives by", "free shipping", "Prime delivery", "same-day", "next-day")',
  '  • Stock or availability claims ("in stock", "limited quantity", "while supplies last", "selling fast")',
  '  • Time-bound claims ("new for 2026", "this season", "now available")',
  'Reason: A+ Content stays live indefinitely once approved; these claims go stale fast and Amazon rejects them. Use price input only as positioning context (e.g. premium voice vs value voice) — never surface the number. Lead with durable benefits, materials, use cases, durability, and brand story instead.',
].join('\n');

function clampModuleCount(
  contentTier: z.infer<typeof requestSchema>['contentTier']
) {
  return contentTier === 'Premium A+' ? 7 : 5;
}

function humanProductName(input: z.infer<typeof requestSchema>) {
  return input.productName?.trim() || input.asin?.trim() || 'this product';
}

function buildPackageOuterFromStrategy(
  input: z.infer<typeof requestSchema>,
  strategy: StrategyOutput
): PackageOuterOutput {
  const maxModules = clampModuleCount(input.contentTier);
  // Keep only planned modules that map to a real renderable layout, and dedupe
  // by layout KIND so two modules never render as the same design (the user's
  // "all modules look the same" complaint). The default sequence below pads up
  // to the tier target with additional distinct layouts.
  const seenKinds = new Set<string>();
  const plannedModules = strategy.modulePlan
    .filter((module) => isRenderableAmazonModuleType(module.moduleType))
    .filter((module) => {
      const kind = amazonModuleTypeToKind(module.moduleType);
      if (seenKinds.has(kind)) return false;
      seenKinds.add(kind);
      return true;
    })
    .slice(0, maxModules);
  // A coherent default A+ story, using only Amazon module types we can render.
  // Used to pad the AI's plan up to the tier target so Basic always ships a
  // full set of modules instead of however few the strategy happened to name.
  const defaultSequence: Array<{
    moduleType: RenderableAmazonModuleType;
    role: string;
    assetsToUse: string[];
    reason: string;
  }> = [
    {
      moduleType: 'STANDARD_IMAGE_TEXT_OVERLAY',
      role: 'Introduce the product and primary buyer benefit.',
      assetsToUse: [],
      reason: 'Gives shoppers a fast, clear reason to keep reading.',
    },
    {
      moduleType: 'STANDARD_THREE_IMAGE_TEXT',
      role: 'Explain the strongest features as scannable benefits.',
      assetsToUse: [],
      reason: 'Turns product details into an easy-to-scan benefit row.',
    },
    {
      moduleType: 'STANDARD_DUAL_USE_SPLIT',
      role: 'Show two contrasting use scenarios side by side (e.g. hot vs cold).',
      assetsToUse: [],
      reason: 'Demonstrates versatility at a glance with the same product.',
    },
    {
      moduleType: 'STANDARD_FOUR_IMAGE_TEXT_QUADRANT',
      role: 'Show use cases, kit contents, or additional benefits.',
      assetsToUse: [],
      reason: 'Adds breadth of benefits without long copy.',
    },
    {
      moduleType: 'STANDARD_COMPARISON_TABLE',
      role: 'Help shoppers choose the right option or understand positioning.',
      assetsToUse: [],
      reason: 'Supports decision speed without promotional claims.',
    },
    {
      moduleType: 'STANDARD_TECH_SPECS',
      role: 'Clarify dimensions, materials, care, and compatibility.',
      assetsToUse: [],
      reason: 'Reduces buyer uncertainty before purchase.',
    },
    {
      moduleType: 'STANDARD_HEADER_IMAGE_TEXT',
      role: 'Tell the brand or product story.',
      assetsToUse: [],
      reason: 'Builds trust and context for the buyer.',
    },
  ];
  const fallbackModules = [...plannedModules];
  // Rotate the fallback order per product so two different products don't pad
  // out to the same canonical tail when the AI plan is short.
  const rot =
    humanProductName(input).length % Math.max(1, defaultSequence.length);
  const rotatedDefault = [
    ...defaultSequence.slice(rot),
    ...defaultSequence.slice(0, rot),
  ];
  for (const candidate of rotatedDefault) {
    if (fallbackModules.length >= maxModules) break;
    const kind = amazonModuleTypeToKind(candidate.moduleType);
    if (seenKinds.has(kind)) continue;
    seenKinds.add(kind);
    fallbackModules.push(candidate);
  }

  return {
    title: `${humanProductName(input)} A+ content package`,
    executiveSummary:
      strategy.productSummary ||
      `A practical A+ package for ${humanProductName(
        input
      )} focused on durable shopper benefits and clear buying confidence.`,
    creativeDirection: {
      positioning:
        input.productOneLiner?.trim() ||
        strategy.buyer.purchaseContext ||
        'Position the product around durable use-case value and buyer confidence.',
      visualSystem:
        input.brand?.colors?.trim() ||
        input.brand?.voice?.trim() ||
        'Clean editorial product imagery, restrained benefit copy, and mobile-first layouts.',
      mobilePrinciple:
        'Use stacked compositions, short headlines, and fewer callouts so each module scans cleanly on small screens.',
      imagePlan:
        strategy.usableAssets.length > 0
          ? `Prioritize uploaded assets: ${strategy.usableAssets
              .slice(0, 4)
              .map((asset) => asset.fileName)
              .join(', ')}.`
          : 'Use generated or newly shot editorial product imagery only where it directly clarifies a benefit.',
    },
    assumptions: [
      ...strategy.missingFacts
        .filter((fact) => fact.canProceedWithoutIt)
        .map((fact) => `${fact.fact}: ${fact.whyItMatters}`),
      'Package planning used the fast deterministic planner to avoid long AI planning latency.',
    ],
    moduleSpecs: fallbackModules.map((module, index) => ({
      order: index + 1,
      amazonModuleType: module.moduleType,
      title:
        module.role.split(/[.!?]/)[0]?.slice(0, 80) || `Module ${index + 1}`,
      objective: module.reason,
    })),
    sellerCentralBuildSheet: [
      {
        step: 'Create module sequence',
        value: 'Build modules in the generated top-to-bottom order.',
      },
      {
        step: 'Prepare desktop and mobile assets',
        value:
          'Export each module image at the requested dimensions and keep source files editable.',
      },
      {
        step: 'Review compliance',
        value:
          'Remove price, discount, shipping, stock, time-sensitive, and unsupported claims before upload.',
      },
    ],
    qualityChecklist: [
      'Every claim is supported by product facts or conservative assumptions.',
      'No price, promotion, shipping-speed, stock, or time-sensitive language appears in copy or imagery.',
      'Desktop and mobile layouts are composed separately, not just resized.',
      'Alt text describes the visual content without adding unsupported claims.',
    ],
  };
}

function createProvider(modelOverride?: string) {
  // A valid allowlisted override drives BOTH tiers (the generator runs on the
  // 'fast' tier); otherwise fall back to env config / built-in defaults.
  const override =
    modelOverride && isAplusGenerationModel(modelOverride)
      ? modelOverride
      : undefined;
  if (override) {
    return createAIProvider({ models: { default: override, fast: override } });
  }
  return createAIProvider({
    models: {
      ...(process.env['AI_DEFAULT_MODEL']
        ? { default: process.env['AI_DEFAULT_MODEL'] }
        : {}),
      ...(process.env['AI_FAST_MODEL']
        ? { fast: process.env['AI_FAST_MODEL'] }
        : {}),
    },
  });
}

function compactInput(input: z.infer<typeof requestSchema>) {
  return JSON.stringify(
    {
      product: {
        name: input.productName,
        asin: input.asin,
        contentTier: input.contentTier,
        oneLiner: input.productOneLiner,
        targetCustomer: input.targetCustomer,
        pricePoint: input.pricePoint,
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

function prepareGeneratedImagePrompt(prompt: string): string {
  return [
    prompt,
    '',
    'Important image rule: do not render brand names, brand badges, logos, brand lockups, watermarks, product labels with brand names, or readable brand marks anywhere in the image. Leave any brand/logo placement as an empty logo-safe area for later editing.',
  ].join('\n');
}

function classifyError(detail: string, phase: string) {
  const lower = detail.toLowerCase();
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout')
  ) {
    return {
      message:
        phase === 'package-modules'
          ? 'Module generation timed out. This usually clears up on retry.'
          : phase === 'package-outer'
          ? 'The package planning step timed out. Please retry.'
          : phase === 'strategy'
          ? 'The AI gateway timed out building your strategy. Please retry.'
          : 'Image generation timed out. Please retry.',
      status: 504,
    };
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return {
      message: 'AI rate limit reached. Wait a moment and retry.',
      status: 429,
    };
  }
  if (lower.includes('402') || lower.includes('budget')) {
    return {
      message: 'AI generation budget reached. Contact support.',
      status: 402,
    };
  }
  if (lower.includes('schema') || lower.includes('invalid output')) {
    return {
      message:
        'The AI returned an invalid response. Please retry — this is usually transient.',
      status: 500,
    };
  }
  return {
    message: 'Could not generate the A+ package. Please try again.',
    status: 500,
  };
}

/** Per-module field rules shared by both generation strategies. */
const MODULE_FIELD_RULES: string[] = [
  'TEXT FIELDS — write real CUSTOMER-FACING copy the buyer reads. Not design notes, not descriptions of the layout.',
  '  • headline: ≤8 words, a concrete benefit. body: 1–3 sentences of durable benefit/use-case copy. bullets: ≤90 chars each, benefit statements.',
  '  • company-logo: set tagline to a short (≤10 words) durable brand promise shown under the logo — e.g. “Insulated kraft cups built for specialty coffee service.” No price/claims.',
  '  • hero modules (image-header-with-text / image-text-overlay / single-image-text / image-and-text): set badge to a SHORT spec/size pill (≤12 chars, e.g. “16 OZ”, “50-PACK”, “BPA-FREE”) when an obvious size/spec applies; omit otherwise. Never price or promo.',
  '  • comparison-table: products[].title are the column labels; rows[] are spec/benefit rows with exactly one value per product (same order). Set highlight=true on the seller’s own product.',
  '  • tech-specs: rows[] are {label, value} product facts (dimensions, materials, care, compatibility, package contents).',
  '  • dual-use-split: exactly 2 panels showing two CONTRASTING use scenarios of the SAME product (e.g. “Hot Beverages” vs “Cold Drinks”, “Indoor” vs “Outdoor”). Each panel: a short uppercase label (≤3 words), an optional ≤120-char caption, and an image slot whose brief depicts that exact scenario with the same product/look.',
  '',
  'IMAGE SLOTS — every image slot describes a PHOTOGRAPH to be generated or uploaded later. For each slot provide role, size, alt, and brief. DO NOT output an "image" field; slots are filled downstream.',
  '  • role: short stable id (e.g. "hero", "column-1", "comparison-thumb-1").',
  '  • size: 1792x1024 for a wide hero/banner; 1024x1024 for square feature/column/grid images; 1024x1792 only when a tall portrait genuinely helps.',
  '  • alt: ≤160 char description of the photo content. No brand names.',
  '  • brief: a CINEMATIC, ASPIRATIONAL LIFESTYLE photographic prompt of 4–6 sentences — the kind of premium imagery in a high-end brand campaign, NOT a plain product shot. Prefer real people / hands actively USING the product in a believable moment, in a specific aspirational named environment (e.g. a sunlit specialty café, a modern kitchen at golden hour). It must name: the human action/moment, the hero product in genuine use, 3–5 atmospheric props, a specific surface + directional natural light source + ambient background depth, cinematic editorial lighting (soft window light, warm golden hour, etc.), shallow depth of field with foreground/mid/background layers, and a refined premium brand mood. Avoid flat-lay, isolated-on-white, studio-seamless, stock-photo stiffness, and minimalist-whitespace defaults.',
  '  • CONTINUITY: every brief MUST restate the SAME product (same material/color/finish/shape per the SHOT BIBLE) and the SAME lighting, palette, lens and mood, so all images look like one shoot.',
  '  • CRITICAL: the brief must NEVER ask for any rendered text, headline, label, callout, price, watermark, badge, or logo. All text lives in the HTML fields above, never baked into pixels.',
  '  • company-logo background slot: an AMBIENT, on-brand atmosphere photo (soft out-of-focus environment, warm bokeh, brand-colored mood) that sits BEHIND the logo under a tint — keep it soft, low-contrast, and uncluttered, with NO product hero front-and-center, no people staring, no text.',
];

type ModuleGenContext = {
  provider: ReturnType<typeof createProvider>;
  moduleSpecs: z.infer<typeof packageOuterSchema>['moduleSpecs'];
  sharedContextBlock: string;
  emit: (event: Record<string, unknown>) => void;
  startMs: number;
};
type ModuleGenResult = {
  results: z.infer<typeof APlusGeneratedModuleSchema>[];
  failures: Array<{ order: number; reason: string }>;
};

/** SINGLE call: one model request writes the whole package (all modules). */
async function generateModulesSingle(
  ctx: ModuleGenContext
): Promise<ModuleGenResult> {
  const { provider, moduleSpecs, sharedContextBlock, emit, startMs } = ctx;
  const results: ModuleGenResult['results'] = [];
  const failures: ModuleGenResult['failures'] = [];
  const planForPrompt = moduleSpecs.map((spec) => ({
    order: spec.order,
    amazonModuleType: spec.amazonModuleType,
    type: amazonModuleTypeToKind(spec.amazonModuleType),
    title: spec.title,
    objective: spec.objective,
  }));
  const packagePrompt = [
    'You are SellAvant, writing the COMPLETE set of structured modules for ONE Amazon A+ content package in a SINGLE response.',
    `Output EXACTLY ${moduleSpecs.length} modules in the "modules" array, IN ORDER. For each module, set "type" to EXACTLY the kind given in the plan, set order and amazonModuleType from the plan, and a short title.`,
    'Fill EVERY field that module type defines, and ONLY those fields. No bracket placeholders, no "[unknown]". Write all modules as ONE cohesive set — same positioning, voice, and visual system throughout.',
    '',
    'MODULE PLAN (produce these, in this exact order and type):',
    JSON.stringify(planForPrompt, null, 2),
    '',
    ...MODULE_FIELD_RULES,
    NO_TIME_SENSITIVE_RULE,
    '',
    sharedContextBlock,
  ].join('\n');
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await generateText({
        model: provider.languageModel('fast'),
        abortSignal: AbortSignal.timeout(180_000),
        output: Output.object({
          schema: z.object({ modules: z.array(APlusGeneratedModuleSchema) }),
          name: 'a_plus_package_modules',
        }),
        prompt: packagePrompt,
      });
      results.length = 0;
      res.output.modules.forEach((module, index) => {
        results.push({
          ...module,
          order: index + 1,
        } as z.infer<typeof APlusGeneratedModuleSchema>);
        emit({
          type: 'module-done',
          order: index + 1,
          ms: Date.now() - startMs,
        });
      });
      if (results.length) return { results, failures };
    } catch (err: unknown) {
      lastError = err;
    }
  }
  const reason =
    lastError instanceof Error ? lastError.message : String(lastError);
  failures.push({ order: 0, reason });
  console.error(
    '[a-plus-generate] single-call module generation FAILED after retry:',
    reason
  );
  return { results, failures };
}

/** PARALLEL: one model request per module, run concurrently with retry. */
async function generateModulesParallel(
  ctx: ModuleGenContext
): Promise<ModuleGenResult> {
  const { provider, moduleSpecs, sharedContextBlock, emit } = ctx;
  const results: ModuleGenResult['results'] = [];
  const failures: ModuleGenResult['failures'] = [];
  await Promise.all(
    moduleSpecs.map(async (spec) => {
      const tThisModule = Date.now();
      const kind = amazonModuleTypeToKind(spec.amazonModuleType);
      const modulePrompt = [
        'You are SellAvant, producing ONE structured module of an Amazon A+ content package.',
        `This module is the "${kind}" type. Set the "type" field to exactly "${kind}".`,
        `Set order=${spec.order}, amazonModuleType="${spec.amazonModuleType}", and title to a short module label.`,
        'Fill EVERY field the schema defines for this module type, and ONLY those fields. Do not invent fields. No bracket placeholders, no "[unknown]".',
        'Match the global creative direction — same positioning, voice, and visual system as the rest of the package.',
        '',
        ...MODULE_FIELD_RULES,
        NO_TIME_SENSITIVE_RULE,
        '',
        'MODULE SPEC',
        JSON.stringify(spec, null, 2),
        '',
        sharedContextBlock,
      ].join('\n');
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await generateText({
            model: provider.languageModel('fast'),
            abortSignal: AbortSignal.timeout(90_000),
            output: Output.object({
              schema: generatedModuleSchemaForKind(kind),
              name: 'a_plus_module',
            }),
            prompt: modulePrompt,
          });
          results.push({
            ...res.output,
            order: spec.order,
            amazonModuleType: spec.amazonModuleType,
            type: kind,
          } as z.infer<typeof APlusGeneratedModuleSchema>);
          emit({
            type: 'module-done',
            order: spec.order,
            ms: Date.now() - tThisModule,
          });
          return;
        } catch (err: unknown) {
          lastError = err;
        }
      }
      const reason =
        lastError instanceof Error ? lastError.message : String(lastError);
      failures.push({ order: spec.order, reason });
      console.error(
        `[a-plus-generate] module ${spec.order} (${spec.amazonModuleType}) FAILED after retry:`,
        reason
      );
      emit({ type: 'module-failed', order: spec.order, reason });
    })
  );
  results.sort((a, b) => a.order - b.order);
  return { results, failures };
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return Response.json(
      { error: 'Invalid A+ generation input.' },
      { status: 400 }
    );
  }

  const provider = createProvider(input.model);
  const context = compactInput(input);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };

      const tStart = Date.now();
      let phase: 'strategy' | 'package-outer' | 'package-modules' | 'images' =
        'strategy';

      console.log(
        '[a-plus-generate] start',
        JSON.stringify({
          strategyModel: provider.modelId('fast'),
          packageOuterModel:
            process.env['A_PLUS_USE_AI_PACKAGE_PLANNER'] === 'true'
              ? provider.modelId('fast')
              : 'deterministic',
          packageModuleModel: provider.modelId('fast'),
          contextChars: context.length,
        })
      );
      send({ type: 'start', contextChars: context.length });

      try {
        send({ type: 'phase', phase: 'strategy' });
        const tStrategy = Date.now();
        const strategyResult = await generateText({
          model: provider.languageModel('fast'),
          abortSignal: AbortSignal.timeout(120_000),
          output: Output.object({
            schema: strategySchema,
            name: 'a_plus_content_strategy',
          }),
          prompt: [
            'You are an ecommerce content strategist for Amazon A+ content.',
            'Create a practical strategy from the provided product facts, links, brand guide, and uploaded assets.',
            'Do not use placeholder strings. If information is missing, make a safe assumption or add it to missingFacts.',
            'The user is an ecommerce operator, not a designer. Choose modules and asset usage for them.',
            `For each modulePlan entry, set moduleType to one of these exact Amazon module types: ${RENDERABLE_AMAZON_MODULE_TYPES.join(
              ', '
            )}.`,
            `Plan the COMPLETE package: choose and ORDER exactly ${clampModuleCount(
              input.contentTier
            )} modulePlan entries that tell THIS product's story end to end. This is the final module sequence.`,
            'STRUCTURE MUST BE DYNAMIC, not a fixed template: decide the opening, the mix of module types, and their order based on what THIS specific product needs to persuade its buyer. Two different products should produce noticeably different structures — vary which modules appear and in what sequence. Do not default to one canonical order.',
            'Use a VARIETY of distinct module types (each renders as a different layout). Open with a strong hero or brand moment, then sequence the rest into the most persuasive narrative for this product (features, real-life use cases, dual-use scenarios, proof/specs, comparison, brand story) — in whatever order fits best. Avoid repeating the same moduleType.',
            'NEVER plan modules around price points, discounts, promotions, delivery times, shipping speed, stock levels, or any time-sensitive claim. A+ Content stays live indefinitely; these go stale fast and Amazon rejects them. Use price input only as positioning context (premium vs value tier) — do not surface the number anywhere in module copy.',
            '',
            context,
          ].join('\n'),
        });
        const strategyMs = Date.now() - tStrategy;
        console.log(
          `[a-plus-generate] strategy: ${(strategyMs / 1000).toFixed(1)}s`
        );
        send({ type: 'phase-done', phase: 'strategy', ms: strategyMs });

        phase = 'package-outer';
        send({ type: 'phase', phase: 'package-outer' });
        const tPackageOuter = Date.now();
        const useAiPackagePlanner =
          process.env['A_PLUS_USE_AI_PACKAGE_PLANNER'] === 'true';
        const packageOuterResult = useAiPackagePlanner
          ? await generateText({
              model: provider.languageModel('fast'),
              abortSignal: AbortSignal.timeout(45_000),
              output: Output.object({
                schema: packageOuterSchema,
                name: 'a_plus_content_package_outer',
              }),
              prompt: [
                'You are SellAvant, an expert Amazon A+ content producer.',
                'Decide the high-level shape of an A+ content package. DO NOT write per-module copy yet — that comes in a follow-up step.',
                'Return: title, executiveSummary, creativeDirection (positioning, visualSystem, mobilePrinciple, imagePlan), assumptions, sellerCentralBuildSheet, qualityChecklist, and a list of moduleSpecs.',
                'Each moduleSpec is JUST: order (1..N), amazonModuleType (e.g. STANDARD_IMAGE_TEXT_OVERLAY, STANDARD_COMPARISON_TABLE), title (short module label), objective (1 sentence on what the module must accomplish).',
                'Choose 4–6 moduleSpecs that combine to tell a coherent product story. Order them as they will appear top-to-bottom on the listing.',
                'Choose the Amazon module combination yourself. The user is an ecommerce operator, not a UI designer.',
                'Do not include bracket placeholders. If a fact is absent, make a conservative assumption and list it in assumptions, or omit the claim.',
                NO_TIME_SENSITIVE_RULE,
                'Use the strategy below, but improve it when needed.',
                '',
                'INPUT',
                context,
                '',
                'STRATEGY',
                JSON.stringify(strategyResult.output, null, 2),
              ].join('\n'),
            })
          : {
              output: buildPackageOuterFromStrategy(
                input,
                strategyResult.output
              ),
            };
        const outerMs = Date.now() - tPackageOuter;
        console.log(
          `[a-plus-generate] package outer: ${(outerMs / 1000).toFixed(1)}s (${
            packageOuterResult.output.moduleSpecs.length
          } module specs, planner=${
            useAiPackagePlanner ? 'ai' : 'deterministic'
          })`
        );
        const outer = packageOuterResult.output;
        send({
          type: 'phase-done',
          phase: 'package-outer',
          ms: outerMs,
          planner: useAiPackagePlanner ? 'ai' : 'deterministic',
          moduleSpecs: outer.moduleSpecs.map((s) => ({
            order: s.order,
            amazonModuleType: s.amazonModuleType,
            title: s.title,
          })),
        });

        phase = 'package-modules';
        send({
          type: 'phase',
          phase: 'package-modules',
          total: outer.moduleSpecs.length,
        });
        const tModules = Date.now();
        // Shared "shot bible" so every module's image brief depicts the SAME
        // product in the SAME look — the page reads as one photoshoot, not a
        // pile of unrelated AI images (the biggest "this is AI" tell).
        const shotBible = [
          'VISUAL CONTINUITY — SHOT BIBLE (applies to EVERY image brief in this package):',
          `  • SAME HERO PRODUCT in every image: ${humanProductName(
            input
          )}. Describe its material, color, finish, shape, and proportions IDENTICALLY across all modules so it is unmistakably the same physical product.`,
          `  • ONE consistent look everywhere: ${outer.creativeDirection.visualSystem} Keep the same color palette, the same lighting direction & quality (e.g. soft warm window light from one side), the same lens/perspective character, and the same mood in every shot.`,
          '  • Treat all module images as frames from ONE cohesive premium photoshoot — never disparate stock photos with different products, lighting, or color grading.',
        ].join('\n');
        const sharedContextBlock = [
          shotBible,
          '',
          'GLOBAL CREATIVE DIRECTION',
          JSON.stringify(outer.creativeDirection, null, 2),
          '',
          'ASSUMPTIONS',
          JSON.stringify(outer.assumptions, null, 2),
          '',
          'INPUT',
          context,
          '',
          'STRATEGY',
          JSON.stringify(strategyResult.output, null, 2),
        ].join('\n');

        // A/B: PostHog flag `aplus-generation-mode` chooses how modules are
        // written — 'single' (one call, default) or 'parallel' (one per module).
        // Resolve the image-model variant here too so the response can report it.
        const [generationMode, imageVariant] = await Promise.all([
          resolveAplusGenerationMode(session.user.sub),
          resolveImageModelVariant(session.user.sub),
        ]);
        console.log(
          `[a-plus-generate] generation mode: ${generationMode}, image variant: ${imageVariant}`
        );
        const { results: moduleResults, failures: moduleFailures } =
          await (generationMode === 'parallel'
            ? generateModulesParallel
            : generateModulesSingle)({
            provider,
            moduleSpecs: outer.moduleSpecs,
            sharedContextBlock,
            emit: send,
            startMs: tModules,
          });

        moduleResults.sort((a, b) => a.order - b.order);
        const modulesMs = Date.now() - tModules;
        console.log(
          `[a-plus-generate] package modules: ${(modulesMs / 1000).toFixed(
            1
          )}s (${moduleResults.length}/${outer.moduleSpecs.length} succeeded)`
        );
        send({
          type: 'phase-done',
          phase: 'package-modules',
          ms: modulesMs,
          succeeded: moduleResults.length,
          failed: moduleFailures.length,
        });

        if (moduleResults.length === 0) {
          throw new Error(
            `All ${
              outer.moduleSpecs.length
            } module generations failed. First error: ${
              moduleFailures[0]?.reason || 'unknown'
            }`
          );
        }

        const assemblyAssumptions = [
          ...outer.assumptions,
          ...moduleFailures.map(
            (f) =>
              `Module ${f.order} could not be generated and was skipped — retry to fill it in. (${f.reason})`
          ),
        ];

        const assembledPackage = packageSchema.parse({
          title: outer.title,
          executiveSummary: outer.executiveSummary,
          creativeDirection: outer.creativeDirection,
          assumptions: assemblyAssumptions,
          modules: moduleResults,
          sellerCentralBuildSheet: outer.sellerCentralBuildSheet,
          qualityChecklist: outer.qualityChecklist,
        });

        phase = 'images';
        const shouldGenerateImages =
          process.env['A_PLUS_GENERATE_IMAGES'] === 'true' &&
          typeof provider.imageGenerator === 'function';

        const imageGenerator = shouldGenerateImages
          ? provider.imageGenerator?.(imageVariant)
          : undefined;

        let imageResults: Array<{
          moduleOrder: number;
          role: string;
        }> = [];
        if (imageGenerator) {
          send({ type: 'phase', phase: 'images' });
          const tImages = Date.now();
          // Eagerly fill only the first slot of the first couple of modules.
          // Slots returned by moduleImageSlots reference the parsed module, so
          // assigning slot.image mutates assembledPackage in place.
          const tasks = assembledPackage.modules.slice(0, 2).flatMap((module) =>
            moduleImageSlots(module)
              .slice(0, 1)
              .map((slot) =>
                imageGenerator
                  .generate({
                    prompt: prepareGeneratedImagePrompt(slot.brief),
                    size: slot.size,
                  })
                  .then((images) => {
                    const first = images[0];
                    if (first?.url) {
                      slot.image = { url: first.url, alt: slot.alt };
                    }
                    return { moduleOrder: module.order, role: slot.role };
                  })
              )
          );
          imageResults = await Promise.all(tasks);
          const imagesMs = Date.now() - tImages;
          console.log(
            `[a-plus-generate] images: ${(imagesMs / 1000).toFixed(1)}s (${
              imageResults.length
            } generated)`
          );
          send({
            type: 'phase-done',
            phase: 'images',
            ms: imagesMs,
            count: imageResults.length,
          });
        }

        const totalMs = Date.now() - tStart;
        console.log(`[a-plus-generate] total: ${(totalMs / 1000).toFixed(1)}s`);

        send({
          type: 'final',
          totalMs,
          payload: {
            strategy: strategyResult.output,
            package: assembledPackage,
            // Which A/B paths actually ran, so the UI can show it.
            runConfig: {
              generationMode,
              imageVariant,
              model: provider.modelId('fast'),
            },
            imageGeneration: {
              enabled: shouldGenerateImages,
              results: imageResults,
            },
            modelRuns: [
              {
                role: 'strategy',
                provider: provider.providerName,
                modelId: provider.modelId('fast'),
              },
              {
                role: 'package-outer',
                provider: useAiPackagePlanner ? provider.providerName : 'local',
                modelId: useAiPackagePlanner
                  ? provider.modelId('fast')
                  : 'deterministic-planner',
              },
              {
                role: 'package-modules',
                provider: provider.providerName,
                modelId: provider.modelId('fast'),
              },
            ],
          },
        });
      } catch (error) {
        const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
        const detail = error instanceof Error ? error.message : String(error);
        console.error(
          `[a-plus-generate] FAILED phase=${phase} after=${elapsed}s`,
          detail
        );
        const classified = classifyError(detail, phase);
        send({
          type: 'error',
          message: classified.message,
          phase,
          status: classified.status,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
