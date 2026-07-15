import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { z } from 'zod';
import { createAIProvider } from '@amz-spapi/ai-provider';
import {
  APLUS_CREATIVITY_TEMPERATURE,
  APlusCreativitySchema,
  APlusGeneratedModuleSchema,
  APlusGuidanceSchema,
  KIND_TO_AMAZON,
  NarrativePlanSchema,
  fallbackNarrativeBeats,
  generatedModuleSchemaForKind,
  isAplusGenerationModel,
  liftGeneratedPackageToExperience,
  moduleImageSlots,
  moduleKindForBeat,
  sanitizeNarrativeBeats,
  type APlusGeneratedModuleKind,
  type NarrativeBeat,
  type NarrativePlan,
} from '@farvisionllc/models';
import { auth0 } from '../../../../lib/auth0';
import { aplusGenerateInputSchema } from '../../../../lib/aplus-generate-request';
import {
  FACT_CONSISTENCY_RULE,
  MODULE_FIELD_RULES,
  NO_TIME_SENSITIVE_RULE,
  aplusModuleLimitForTier,
  buildFactSheetBlock,
  buildModuleCopyGuidanceBlock,
  buildNarrativeContextBlock,
  buildNarrativePlanPrompt,
  buildShotBibleBlock,
  compactGenerationInput,
  humanProductName,
} from '../../../../lib/aplus-generation-prompts';
import {
  resolveAplusGenerationMode,
  resolveImageModelVariant,
} from '../../../../lib/image-model-flag';

export const maxDuration = 120;

const requestSchema = aplusGenerateInputSchema.extend({
  // Optional generation model override (gateway slug). Validated against the
  // shared allowlist before use; anything else falls back to the server default.
  model: z.string().optional(),
  // "Creativity" in the UI — mapped to per-phase sampling temperature.
  creativity: APlusCreativitySchema.default('medium'),
  // Optional advanced-mode seller guidance appended to the prompts.
  guidance: APlusGuidanceSchema.optional(),
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

/**
 * Static Seller Central hand-off notes — previously synthesized by the
 * deterministic package planner, now route constants.
 */
const DEFAULT_BUILD_SHEET = [
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
];

const DEFAULT_QUALITY_CHECKLIST = [
  'Every claim is supported by product facts or conservative assumptions.',
  'No price, promotion, shipping-speed, stock, or time-sensitive language appears in copy or imagery.',
  'Desktop and mobile layouts are composed separately, not just resized.',
  'Alt text describes the visual content without adding unsupported claims.',
];

/**
 * Deterministic narrative plan used when the planning call fails or returns
 * nothing usable — generation never hard-fails on a bad plan.
 */
function fallbackNarrativePlan(
  input: z.infer<typeof requestSchema>,
  beatCount: number
): NarrativePlan {
  const productName = humanProductName(input);
  return {
    productSummary:
      input.productOneLiner?.trim() ||
      `A practical A+ package for ${productName} focused on durable shopper benefits and clear buying confidence.`,
    buyer: {
      likelyCustomer:
        input.targetCustomer?.trim() || 'Everyday buyers of this category.',
      purchaseContext:
        'Comparing options quickly; needs clear, durable reasons to choose this product.',
      mainObjections: (input.objections ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    },
    usableAssets: [],
    missingFacts: [],
    artDirection: {
      positioning:
        input.productOneLiner?.trim() ||
        'Position the product around durable use-case value and buyer confidence.',
      visualSystem:
        input.brand?.colors?.trim() ||
        input.brand?.voice?.trim() ||
        'Clean editorial product imagery, restrained benefit copy, and mobile-first layouts.',
      mobilePrinciple:
        'Use stacked compositions, short headlines, and fewer callouts so each module scans cleanly on small screens.',
      imagePlan:
        input.assets.length > 0
          ? `Prioritize uploaded assets: ${input.assets
              .slice(0, 4)
              .map((asset) => asset.fileName)
              .join(', ')}.`
          : 'Use generated or newly shot editorial product imagery only where it directly clarifies a benefit.',
    },
    beats: fallbackNarrativeBeats(productName, beatCount),
  };
}

// OpenAI models default to STRICT JSON-schema structured outputs in AI SDK v6,
// which reject our discriminated-union/optional package schema. Anthropic's
// structured output is tool-based and lenient (which is why Claude works), so we
// turn strict mode off for OpenAI. Keyed under `openai`, so it's ignored by
// Anthropic and other providers — safe to pass on every call.
const STRUCTURED_OUTPUT_PROVIDER_OPTIONS = {
  openai: { strictJsonSchema: false },
} as const;

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

function prepareGeneratedImagePrompt(
  prompt: string,
  productContext?: string
): string {
  return [
    // The image model sees ONLY this prompt — no shot bible, no module plan —
    // so always restate what the product is or it will invent a subject.
    ...(productContext
      ? [
          `THE HERO PRODUCT IN THIS SHOT — depict EXACTLY this product; every physical detail listed here (colors, lid color, materials, counts) is MANDATORY and overrides anything else: ${productContext}`,
          '',
        ]
      : []),
    prompt,
    '',
    'Important image rule: do not render brand names, brand badges, logos, brand lockups, watermarks, product labels with brand names, or readable brand marks anywhere in the image. Leave any brand/logo placement as an empty logo-safe area for later editing.',
  ].join('\n');
}

/** Compact product identity for image prompts (name + one-liner + key facts). */
function imageProductContext(input: z.infer<typeof requestSchema>): string {
  const facts = (input.keyFeatures ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    // Physical appearance facts (e.g. lid color) often sit low in the list —
    // carry enough lines that the image model actually hears about them.
    .slice(0, 8)
    .join('; ');
  return [
    humanProductName(input),
    input.productOneLiner?.trim(),
    facts ? `Key physical facts: ${facts}` : '',
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, 700);
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
          ? 'Section writing timed out. This usually clears up on retry.'
          : phase === 'narrative'
          ? 'The AI gateway timed out planning your story. Please retry.'
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

/**
 * Detects a model/provider rejection of the temperature parameter (some OpenAI
 * reasoning models only accept the default). Callers retry without it.
 */
function isTemperatureRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /temperature/i.test(message);
}

/** One writing task, derived from a narrative beat. */
type ModuleSpec = {
  order: number;
  kind: APlusGeneratedModuleKind;
  amazonModuleType: string;
  job: NarrativeBeat['job'];
  title: string;
  objective: string;
};

type ModuleGenContext = {
  provider: ReturnType<typeof createProvider>;
  moduleSpecs: ModuleSpec[];
  sharedContextBlock: string;
  /** Sampling temperature for module copy (from the creativity level). */
  temperature: number;
  emit: (event: Record<string, unknown>) => void;
  startMs: number;
};
type ModuleGenResult = {
  results: z.infer<typeof APlusGeneratedModuleSchema>[];
  failures: Array<{ order: number; reason: string }>;
};

/** One-line diagnostic for a structured-output failure (cause, truncation). */
function describeNoObjectError(
  err: InstanceType<typeof NoObjectGeneratedError>
) {
  const cause =
    err.cause instanceof Error ? err.cause.message : String(err.cause ?? '');
  return `finishReason=${err.finishReason ?? 'unknown'} textChars=${
    err.text?.length ?? 0
  } cause=${cause.slice(0, 600)}`;
}

/**
 * Salvage individually-valid modules from a failed whole-package response —
 * one malformed module must not throw away its healthy siblings. Returns null
 * when nothing can be recovered (e.g. truncated JSON).
 */
function salvageModulesFromText(
  text: string | undefined,
  expected: number
): {
  modules: z.infer<typeof APlusGeneratedModuleSchema>[];
  invalid: number;
} | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { modules?: unknown[] };
    if (!Array.isArray(parsed.modules)) return null;
    const modules: z.infer<typeof APlusGeneratedModuleSchema>[] = [];
    let invalid = 0;
    // The single-call writer produces modules in PLAN ORDER, so a module's
    // position in the raw array is its true beat order — keep it, or the
    // survivors get renumbered onto the wrong beats.
    for (const [rawIndex, candidate] of parsed.modules
      .slice(0, expected)
      .entries()) {
      const result = APlusGeneratedModuleSchema.safeParse(candidate);
      if (result.success) modules.push({ ...result.data, order: rawIndex + 1 });
      else invalid++;
    }
    return modules.length ? { modules, invalid } : null;
  } catch {
    return null;
  }
}

/** SINGLE call: one model request writes the whole package (all modules). */
async function generateModulesSingle(
  ctx: ModuleGenContext
): Promise<ModuleGenResult> {
  const { provider, moduleSpecs, sharedContextBlock, emit, startMs } = ctx;
  const results: ModuleGenResult['results'] = [];
  const failures: ModuleGenResult['failures'] = [];
  let temperature: number | undefined = ctx.temperature;
  const planForPrompt = moduleSpecs.map((spec) => ({
    order: spec.order,
    amazonModuleType: spec.amazonModuleType,
    type: spec.kind,
    job: spec.job,
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
        // All modules in one object is token-heavy — give it ample room so the
        // JSON is never truncated (truncation reads as a schema mismatch).
        maxOutputTokens: 32000,
        temperature,
        providerOptions: STRUCTURED_OUTPUT_PROVIDER_OPTIONS,
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
      // Some models reject a non-default temperature — retry without it.
      if (isTemperatureRejection(err)) temperature = undefined;
      if (NoObjectGeneratedError.isInstance(err)) {
        console.error(
          `[a-plus-generate] single-call schema mismatch (attempt ${
            attempt + 1
          }): ${describeNoObjectError(err)}`
        );
        // One malformed module must not discard its healthy siblings — keep
        // every module that validates on its own.
        const salvaged = salvageModulesFromText(err.text, moduleSpecs.length);
        if (salvaged) {
          salvaged.modules.forEach((module) => {
            results.push(module);
            emit({
              type: 'module-done',
              order: module.order,
              ms: Date.now() - startMs,
            });
          });
          if (salvaged.invalid > 0) {
            failures.push({
              order: 0,
              reason: `${salvaged.invalid} module(s) failed schema validation and were skipped.`,
            });
          }
          console.log(
            `[a-plus-generate] salvaged ${salvaged.modules.length} module(s) from the failed response (${salvaged.invalid} invalid)`
          );
          return { results, failures };
        }
      }
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
      const kind = spec.kind;
      const modulePrompt = [
        'You are SellAvant, producing ONE structured module of an Amazon A+ content package.',
        `This module is the "${kind}" type. Set the "type" field to exactly "${kind}".`,
        `Set order=${spec.order}, amazonModuleType="${spec.amazonModuleType}", and title to a short module label.`,
        `This section's conversion job is "${spec.job}". Its intent: ${spec.objective}`,
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
      let temperature: number | undefined = ctx.temperature;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await generateText({
            model: provider.languageModel('fast'),
            abortSignal: AbortSignal.timeout(90_000),
            temperature,
            providerOptions: STRUCTURED_OUTPUT_PROVIDER_OPTIONS,
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
          // Some models reject a non-default temperature — retry without it.
          if (isTemperatureRejection(err)) temperature = undefined;
          if (NoObjectGeneratedError.isInstance(err)) {
            console.error(
              `[a-plus-generate] module ${
                spec.order
              } schema mismatch (attempt ${
                attempt + 1
              }): ${describeNoObjectError(err)}`
            );
          }
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

/**
 * The brand-header module renders as a HERO only when it has a background slot
 * (an ambient lifestyle backdrop behind the logo). The prompt asks for one, but
 * if the model omits it we inject a default so the header never degrades to the
 * plain band. The slot's image is filled by the downstream image-generate step.
 */
function ensureLogoBackdrop(
  modules: z.infer<typeof APlusGeneratedModuleSchema>[],
  productName: string
): void {
  for (const module of modules) {
    if (module.type === 'company-logo' && !module.background) {
      module.background = {
        role: 'brand-backdrop',
        size: '1792x1024',
        alt: 'Ambient brand lifestyle backdrop',
        // This brief may be sent to the image model on its own (per-slot
        // regenerate), so it must NAME the product — a self-reference like
        // "per the shot bible" means nothing outside this pipeline.
        brief: `An ambient, on-brand lifestyle scene in the REAL setting where ${productName} is naturally used or displayed — derived from its category, never a generic theme. THE PRODUCT ITSELF (${productName}) must appear, softly out of focus and offset to ONE side, so the scene is clearly about this product, with clean low-detail negative space on the OPPOSITE side for overlaid text. Layered depth, gentle bokeh, refined premium natural light. Show only ${productName} and props that naturally belong in its genuine use setting. No people staring at camera, no text or logos.`,
      };
    }
  }
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
  const context = compactGenerationInput(input);
  const strategyTemperature =
    APLUS_CREATIVITY_TEMPERATURE.strategy[input.creativity];
  const moduleCopyTemperature =
    APLUS_CREATIVITY_TEMPERATURE.moduleCopy[input.creativity];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };

      const tStart = Date.now();
      let phase: 'narrative' | 'package-modules' | 'images' = 'narrative';

      console.log(
        '[a-plus-generate] start',
        JSON.stringify({
          narrativeModel: provider.modelId('fast'),
          packageModuleModel: provider.modelId('fast'),
          contextChars: context.length,
        })
      );
      send({ type: 'start', contextChars: context.length });

      try {
        send({ type: 'phase', phase: 'narrative' });
        const tNarrative = Date.now();
        const beatCount = aplusModuleLimitForTier(input.contentTier);
        const narrativePrompt = buildNarrativePlanPrompt({
          contextJson: context,
          beatCount,
          guidance: input.guidance?.strategy,
        });
        const runNarrative = (temperature: number | undefined) =>
          generateText({
            model: provider.languageModel('fast'),
            abortSignal: AbortSignal.timeout(120_000),
            temperature,
            providerOptions: STRUCTURED_OUTPUT_PROVIDER_OPTIONS,
            output: Output.object({
              schema: NarrativePlanSchema,
              name: 'a_plus_narrative_plan',
            }),
            prompt: narrativePrompt,
          });
        // Planning must never hard-fail the run — a bad/failed plan falls back
        // to the deterministic default story.
        const plan: NarrativePlan = await runNarrative(strategyTemperature)
          .catch((err: unknown) => {
            // Some models reject a non-default temperature — retry without it.
            if (isTemperatureRejection(err)) return runNarrative(undefined);
            throw err;
          })
          .then((result) => result.output)
          .catch((err: unknown) => {
            const detail = err instanceof Error ? err.message : String(err);
            console.error(
              `[a-plus-generate] narrative planning failed — using fallback plan: ${detail.slice(
                0,
                300
              )}`
            );
            return fallbackNarrativePlan(input, beatCount);
          });
        const beats = sanitizeNarrativeBeats(plan.beats, {
          maxBeats: beatCount,
          productName: humanProductName(input),
        });
        plan.beats = beats;
        const narrativeMs = Date.now() - tNarrative;
        console.log(
          `[a-plus-generate] narrative: ${(narrativeMs / 1000).toFixed(1)}s (${
            beats.length
          } beats)`
        );
        send({
          type: 'phase-done',
          phase: 'narrative',
          ms: narrativeMs,
          beats: beats.map((beat) => ({
            order: beat.order,
            job: beat.job,
            archetype: beat.archetype,
            intent: beat.intent,
          })),
        });

        phase = 'package-modules';
        send({ type: 'phase', phase: 'package-modules', total: beats.length });
        const tModules = Date.now();
        const moduleSpecs: ModuleSpec[] = beats.map((beat) => {
          const kind = moduleKindForBeat(beat);
          return {
            order: beat.order,
            kind,
            amazonModuleType: KIND_TO_AMAZON[kind],
            job: beat.job,
            title: beat.headlineAngle ?? beat.intent.slice(0, 80),
            objective: beat.intent,
          };
        });
        const assumptions = plan.missingFacts
          .filter((fact) => fact.canProceedWithoutIt)
          .map((fact) => `${fact.fact}: ${fact.whyItMatters}`);
        const moduleCopyGuidance = input.guidance?.moduleCopy?.trim();
        const sharedContextBlock = [
          buildShotBibleBlock({
            productName: humanProductName(input),
            visualSystem: plan.artDirection.visualSystem,
          }),
          '',
          ...(moduleCopyGuidance
            ? [buildModuleCopyGuidanceBlock(moduleCopyGuidance), '']
            : []),
          'GLOBAL ART DIRECTION',
          JSON.stringify(plan.artDirection, null, 2),
          '',
          buildFactSheetBlock(input),
          FACT_CONSISTENCY_RULE,
          '',
          buildNarrativeContextBlock(beats),
          '',
          'ASSUMPTIONS',
          JSON.stringify(assumptions, null, 2),
          '',
          'INPUT',
          context,
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
        const moduleGenContext: ModuleGenContext = {
          provider,
          moduleSpecs,
          sharedContextBlock,
          temperature: moduleCopyTemperature,
          emit: send,
          startMs: tModules,
        };
        let { results: moduleResults, failures: moduleFailures } =
          await (generationMode === 'parallel'
            ? generateModulesParallel
            : generateModulesSingle)(moduleGenContext);
        // The single-call mode writes one huge JSON object and occasionally
        // fails schema validation wholesale; per-module generation is far more
        // robust (one small schema per call) — use it as the safety net.
        if (moduleResults.length === 0 && generationMode !== 'parallel') {
          console.error(
            '[a-plus-generate] single-call produced no modules — falling back to parallel per-module generation'
          );
          ({ results: moduleResults, failures: moduleFailures } =
            await generateModulesParallel(moduleGenContext));
        }
        // Partial recovery: rewrite ONLY the missing beats via the per-module
        // writer, so a flaky whole-package call never ships a thin page.
        if (
          moduleResults.length > 0 &&
          moduleResults.length < moduleSpecs.length
        ) {
          const written = new Set(moduleResults.map((module) => module.order));
          const missing = moduleSpecs.filter(
            (spec) => !written.has(spec.order)
          );
          console.error(
            `[a-plus-generate] ${missing.length} section(s) missing after primary write — topping up via parallel writer`
          );
          const topUp = await generateModulesParallel({
            ...moduleGenContext,
            moduleSpecs: missing,
          });
          moduleResults.push(...topUp.results);
          moduleFailures = moduleFailures
            .filter(
              (failure) =>
                !topUp.results.some((module) => module.order === failure.order)
            )
            .concat(topUp.failures);
        }

        moduleResults.sort((a, b) => a.order - b.order);
        // Brand header renders as a hero only with a backdrop — guarantee one.
        // (No auto-footer: every module slot costs conversion space, so brand
        // bands exist only when the narrative PLANS a brand beat.)
        ensureLogoBackdrop(moduleResults, humanProductName(input));
        const modulesMs = Date.now() - tModules;
        console.log(
          `[a-plus-generate] package modules: ${(modulesMs / 1000).toFixed(
            1
          )}s (${moduleResults.length}/${moduleSpecs.length} succeeded)`
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
              moduleSpecs.length
            } module generations failed. First error: ${
              moduleFailures[0]?.reason || 'unknown'
            }`
          );
        }

        const assemblyAssumptions = [
          ...assumptions,
          ...moduleFailures.map(
            (f) =>
              `Module ${f.order} could not be generated and was skipped — retry to fill it in. (${f.reason})`
          ),
        ];

        const assembledPackage = packageSchema.parse({
          title: `${humanProductName(input)} A+ content package`,
          executiveSummary: plan.productSummary,
          creativeDirection: plan.artDirection,
          assumptions: assemblyAssumptions,
          modules: moduleResults,
          sellerCentralBuildSheet: DEFAULT_BUILD_SHEET,
          qualityChecklist: DEFAULT_QUALITY_CHECKLIST,
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
                    prompt: prepareGeneratedImagePrompt(
                      slot.brief,
                      imageProductContext(input)
                    ),
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

        // Lift AFTER eager image generation so resolved slot images flow into
        // the experience — the ONLY document shape the editor consumes.
        const experience = liftGeneratedPackageToExperience(assembledPackage, {
          productId: input.asin?.trim() || undefined,
          beats,
        });

        const totalMs = Date.now() - tStart;
        console.log(`[a-plus-generate] total: ${(totalMs / 1000).toFixed(1)}s`);

        send({
          type: 'final',
          totalMs,
          payload: {
            narrativePlan: plan,
            experience,
            assumptions: assemblyAssumptions,
            sellerCentralBuildSheet: DEFAULT_BUILD_SHEET,
            qualityChecklist: DEFAULT_QUALITY_CHECKLIST,
            // Which A/B paths actually ran, so the UI can show it.
            runConfig: {
              generationMode,
              imageVariant,
              model: provider.modelId('fast'),
              creativity: input.creativity,
            },
            imageGeneration: {
              enabled: shouldGenerateImages,
              results: imageResults,
            },
            modelRuns: [
              {
                role: 'narrative',
                provider: provider.providerName,
                modelId: provider.modelId('fast'),
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
