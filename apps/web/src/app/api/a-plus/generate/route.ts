import { generateText, Output } from 'ai';
import { z } from 'zod';
import { createAIProvider } from '@amz-spapi/ai-provider';
import { auth0 } from '../../../../lib/auth0';

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
      moduleType: z.string(),
      role: z.string(),
      assetsToUse: z.array(z.string()),
      reason: z.string(),
    })
  ),
});

const moduleSchema = z.object({
  order: z.number(),
  amazonModuleType: z.string(),
  title: z.string(),
  objective: z.string(),
  visualBrief: z.string(),
  desktopLayout: z.string(),
  mobileLayout: z.string(),
  desktopWireframe: z.array(z.string()),
  mobileWireframe: z.array(z.string()),
  headline: z.string(),
  bodyCopy: z.string(),
  bullets: z.array(z.string()),
  canvaLayers: z.array(
    z.object({
      layer: z.string(),
      content: z.string(),
      notes: z.string(),
    })
  ),
  assetAssignments: z.array(
    z.object({
      assetFileName: z.string(),
      role: z.string(),
      editNotes: z.string(),
    })
  ),
  imageJobs: z.array(
    z.object({
      jobId: z.string(),
      purpose: z.string(),
      size: z.enum(['1024x1024', '1792x1024', '1024x1792']),
      prompt: z.string(),
      avoid: z.array(z.string()),
    })
  ),
  logoDropzone: z.object({
    needed: z.boolean(),
    placement: z.string(),
    notes: z.string(),
  }),
  altText: z.string(),
  complianceNotes: z.array(z.string()),
  compositeMockup: z
    .object({
      purpose: z.string(),
      desktop: z.object({
        size: z.enum(['1024x1024', '1792x1024', '1024x1792']),
        prompt: z.string(),
        textElements: z.array(
          z.object({
            role: z.string(),
            text: z.string(),
            position: z.string(),
            typography: z.string(),
          })
        ),
      }),
      mobile: z.object({
        size: z.enum(['1024x1024', '1792x1024', '1024x1792']),
        prompt: z.string(),
        textElements: z.array(
          z.object({
            role: z.string(),
            text: z.string(),
            position: z.string(),
            typography: z.string(),
          })
        ),
      }),
    })
    .optional(),
});

const moduleSpecSchema = z.object({
  order: z.number(),
  amazonModuleType: z.string(),
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
  modules: z.array(moduleSchema),
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
  return contentTier === 'Premium A+' ? 6 : 5;
}

function humanProductName(input: z.infer<typeof requestSchema>) {
  return input.productName?.trim() || input.asin?.trim() || 'this product';
}

function buildPackageOuterFromStrategy(
  input: z.infer<typeof requestSchema>,
  strategy: StrategyOutput
): PackageOuterOutput {
  const maxModules = clampModuleCount(input.contentTier);
  const plannedModules = strategy.modulePlan.slice(0, maxModules);
  const fallbackModules =
    plannedModules.length > 0
      ? plannedModules
      : [
          {
            moduleType: 'STANDARD_IMAGE_TEXT_OVERLAY',
            role: 'Introduce the product and primary buyer benefit.',
            assetsToUse: [],
            reason: 'Gives shoppers a fast, clear reason to keep reading.',
          },
          {
            moduleType: 'STANDARD_FOUR_IMAGE_TEXT',
            role: 'Explain the strongest features as scannable benefits.',
            assetsToUse: [],
            reason: 'Turns product details into an easy comparison surface.',
          },
          {
            moduleType: 'STANDARD_SINGLE_IMAGE_SPECS_DETAIL',
            role: 'Clarify practical usage, fit, or materials.',
            assetsToUse: [],
            reason: 'Reduces buyer uncertainty before purchase.',
          },
          {
            moduleType: 'STANDARD_COMPARISON_TABLE',
            role: 'Help shoppers choose the right option or understand positioning.',
            assetsToUse: [],
            reason: 'Supports decision speed without promotional claims.',
          },
        ];

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

function createProvider() {
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

  const provider = createProvider();
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
        const sharedContextBlock = [
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

        const moduleResults: z.infer<typeof moduleSchema>[] = [];
        const moduleFailures: Array<{ order: number; reason: string }> = [];

        await Promise.all(
          outer.moduleSpecs.map((spec) => {
            const tThisModule = Date.now();
            return generateText({
              model: provider.languageModel('fast'),
              abortSignal: AbortSignal.timeout(90_000),
              output: Output.object({
                schema: moduleSchema,
                name: 'a_plus_module',
              }),
              prompt: [
                'You are SellAvant, producing ONE module of an Amazon A+ content package.',
                'Write the full module: visualBrief, desktopLayout, mobileLayout, desktopWireframe, mobileWireframe, headline, bodyCopy, bullets (3–5), canvaLayers, assetAssignments, imageJobs (only if a generated image is genuinely needed; size must be 1024x1024 / 1792x1024 / 1024x1792; assign jobIds like "module-{order}-{purpose}"), logoDropzone, altText, complianceNotes, compositeMockup.',
                'Use the order, amazonModuleType, title, and objective EXACTLY as given in the module spec.',
                'Match the global creative direction — same positioning, voice, visual system, and mobile principle as the rest of the package.',
                'Never ask image generation to render readable text, logos, watermarks, claims badges, or brand marks. Use logo dropzones instead.',
                'Do not include bracket placeholders. Do not say "[unknown]" or "[missing]".',
                '',
                'CRITICAL — EACH FIELD HAS A DIFFERENT JOB. DO NOT RESTATE CONTENT ACROSS FIELDS.',
                '  • visualBrief (1–2 sentences): mood, color palette, lighting, photographic style ONLY. Do NOT describe layout, composition, or what physical elements appear where — that goes in the wireframe.',
                '  • desktopLayout (ONE sentence, ≤140 chars): one-line summary of where the major elements sit on desktop.',
                '  • mobileLayout (ONE sentence, ≤140 chars): one-line summary for mobile. Must DIFFER from desktopLayout (e.g. stack vs split, crop differences) — do not paraphrase.',
                '  • desktopWireframe (4–7 items): TERSE layout sketches, ≤80 chars each, format "{position}: {element type}" — NOT prose. Do not describe content, only position and element type. Examples: "Top 60%: hero image", "Right rail: headline + body", "Below image: 3-bullet row", "Bottom-right: logo dropzone".',
                '  • mobileWireframe (4–7 items): same format, mobile-stacked. Different items than desktop, not a paraphrase.',
                '  • bodyCopy: 1–2 sentences of CUSTOMER-FACING copy. Not direction, not description of the design. Real prose the buyer reads.',
                '  • bullets (3–5): each ≤90 chars, customer-facing benefit statements. No design notes, no layout direction.',
                '  • canvaLayers: only Seller Central field labels with their copy values (e.g. "Headline Text" → the actual headline string). Do not duplicate visualBrief here.',
                '  • compositeMockup: brief for generating finished-module images with text rendered DIRECTLY in the image (the way premium Amazon brands actually ship A+ content today). PRODUCE BOTH a desktop variant AND a mobile variant — Amazon serves them differently and they must be composed differently, not just resized.',
                '',
                '      QUALITY BAR — READ THIS BEFORE WRITING THE prompt FIELD:',
                '      Premium Amazon A+ photography is EDITORIAL / LIFESTYLE / MAGAZINE-QUALITY — not catalog flat-lay, not isolated product on plain background, not single-subject minimalism. Look at brands like Yeti, Lifeboost, Stanley, Hydro Flask, Vitruvi, Brumate. Their hero composites have 6–10 visual elements composing one cohesive scene with depth, atmosphere, and use-case context.',
                '',
                '      FORBIDDEN photography defaults (do NOT write these):',
                '          ✗ "Flat-lay shot on a neutral background"',
                '          ✗ "Single product on white/cream/taupe surface"',
                '          ✗ "Minimalist composition with whitespace"',
                '          ✗ "Studio lighting on isolated subject"',
                '          ✗ "Clean simple background"',
                '      These produce boring catalog images. Write the OPPOSITE.',
                '',
                '      REQUIRED elements for every photography prompt — name them explicitly:',
                '          1. HERO product treatment — multiple instances when the product is small (stack of cups, line of bottles, fanned arrangement). Show scale, abundance, or hierarchy.',
                '          2. USE-CASE ACTION — someone preparing, pouring, serving, holding, using the product. A hand in frame. Liquid in motion. Steam rising. The product MID-USE, not static.',
                '          3. ATMOSPHERIC PROPS — 3 to 5 contextual objects that build the scene: ingredients, garnishes, tools, related items, complementary props (e.g. coffee beans + grinder + saucers + sugar cubes + croissant for a coffee cup). Avoid props that compete for attention.',
                '          4. SPECIFIC ENVIRONMENT — name the setting concretely: "modern marble kitchen counter with natural light from a window", "warm wooden cafe table with morning sun", "minimalist gallery countertop with soft blurred greenery in background". Never "neutral surface" — name surface, lighting source, and ambient depth.',
                '          5. EDITORIAL LIGHTING — specific direction and quality: "warm directional morning sun from upper-right with subtle backlight rim", "soft north-facing window light with deep shadow falloff", "golden-hour low-angle with long shadows". Never "soft natural lighting".',
                '          6. DEPTH — foreground prop, mid-ground subject, background environment. Shallow depth of field with intentional bokeh OR layered staging. The image should NOT be flat.',
                '          7. BRAND MOOD — explicit emotional register that matches positioning: "warm artisanal", "clinical-modern minimalism", "rugged-outdoor adventure", "indulgent-luxe". Anchor this with concrete cues (color palette, texture, prop choice).',
                '',
                '      TEXT-ELEMENT QUALITY BAR — text should be GRAPHIC-DESIGN treatment, not plain text floating on the image:',
                '          ✗ "centered text, top of image, ~48pt sans-serif"',
                '          ✓ "Top-left brand lockup inside a white rounded card ~280x120px with subtle drop shadow; serif logotype + sans-serif tagline stacked vertically; warm cream background; padded ~20px"',
                '          ✓ "Centered headline in elegant uppercase letterspacing, set against a translucent dark-brown horizontal band ~140px tall positioned at vertical center-top, ~32px padding"',
                '          ✓ "Bottom-strip of 4 category tabs evenly spaced, each in a soft-cream pill with thin underline indicator beneath the active tab; 13pt small-caps, warm gray"',
                '          ✓ "Vertical right-rail callout strip with 3 stacked feature labels: each is a small icon + 2-word label inside a thin-bordered rectangle; dark-brown ink on cream"',
                '      Text positions should reference design treatments — badges, cards, color blocks, divider strips, ribbons, ruler-arrows for measurements, tab strips. Never just floating type.',
                '',
                '      - purpose: ONE short shared label (e.g. "Hero composite — brand lockup + lifestyle pour scene"). Same purpose, two variants below.',
                '      - desktop: { size, prompt, textElements } for the wide desktop view.',
                '          • size: prefer 1792x1024 (16:9 landscape) for hero/banner; 1024x1024 only for square spec/feature modules.',
                '          • prompt: write 4–6 sentences covering all 7 required elements above. Specific, editorial, layered.',
                '          • Layout intuition: side-by-side or asymmetric editorial composition. Brand lockup in a styled badge top-left. Headline anchored to a colored band or text-card adjacent to the photo. 4–5 deliberate text elements.',
                '      - mobile: { size, prompt, textElements } for the narrow mobile view.',
                '          • size: prefer 1024x1024 (square) for most modules; 1024x1792 (tall portrait) only when content really benefits from tall stacking.',
                '          • prompt: same scene, props, lighting, and mood as desktop but RECOMPOSED — tighter crop, vertical framing, fewer props (2–3 instead of 4–5), subject often centered or upper-third.',
                '          • Layout intuition: STACKED. Headline above or below the photo in a colored band/card (not overlaid on the photo — small screens make overlay text hard to read). Bigger text relative to image dimensions. 2–3 text elements only — drop decorative callouts that would crowd a small screen.',
                '          • Headlines on mobile are SHORTER — aim ≤5 words. Write a tighter mobile-only headline if the desktop one is longer.',
                '      Both variants share: brand voice, photography subject + key props, color palette. They differ in: composition (asymmetric/editorial vs stacked), text density (4–5 vs 2–3), and headline length.',
                '      For each variant, textElements has 2–5 items (mobile: 2–3 typical). Each item:',
                '          • role: "headline" | "subhead" | "callout" | "feature-label" | "brand-badge" | "spec-label" | "category-tab"',
                '          • text: the EXACT string to render, ≤80 chars. Headlines: desktop 2–6 words, mobile 2–5 words. Labels/callouts 1–4 words. Brand badges 1–3 words. NEVER paragraphs, NEVER body copy, NEVER prices, NEVER promo claims.',
                '          • position: REFERENCE A DESIGN TREATMENT (badge, card, color band, ribbon, ruler-arrow callout, tab strip) — not just coordinates. See examples above.',
                '          • typography: visual style (e.g. "elegant serif logo, dark brown #2C1A0E, ~36pt with subtle letterspacing, set as a stacked lockup"). Mobile typography is typically LARGER relative to image dimensions than desktop.',
                '      All text MUST satisfy NO TIME-SENSITIVE CLAIMS rule. No prices, no promotions, no shipping/delivery claims, no stock claims.',
                '      Match the brand palette and any fonts mentioned in the brand context. If no brand fonts are given, default to a paired serif logotype + clean modern sans-serif body, with a warm or cool accent matched to the product mood.',
                '      Keep textElements deliberate — 3 well-placed elements beat 5 cluttered ones.',
                'If you find yourself repeating words from a previous field, stop and write something the previous field did not say.',
                NO_TIME_SENSITIVE_RULE,
                '',
                'MODULE SPEC',
                JSON.stringify(spec, null, 2),
                '',
                sharedContextBlock,
              ].join('\n'),
            })
              .then((res) => {
                const result = { ...res.output, order: spec.order };
                moduleResults.push(result);
                send({
                  type: 'module-done',
                  order: spec.order,
                  ms: Date.now() - tThisModule,
                });
              })
              .catch((err: unknown) => {
                const reason = err instanceof Error ? err.message : String(err);
                moduleFailures.push({ order: spec.order, reason });
                console.error(
                  `[a-plus-generate] module ${spec.order} (${spec.amazonModuleType}) FAILED:`,
                  reason
                );
                send({
                  type: 'module-failed',
                  order: spec.order,
                  reason,
                });
              });
          })
        );

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
          ? provider.imageGenerator?.()
          : undefined;

        let imageResults: Array<{
          moduleOrder: number;
          jobId: string;
          images: Awaited<
            ReturnType<NonNullable<typeof imageGenerator>['generate']>
          >;
        }> = [];
        if (imageGenerator) {
          send({ type: 'phase', phase: 'images' });
          const tImages = Date.now();
          const tasks = assembledPackage.modules.slice(0, 2).flatMap((module) =>
            module.imageJobs.slice(0, 1).map((job) =>
              imageGenerator
                .generate({
                  prompt: job.prompt,
                  size: job.size,
                })
                .then((images) => ({
                  moduleOrder: module.order,
                  jobId: job.jobId,
                  images,
                }))
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
