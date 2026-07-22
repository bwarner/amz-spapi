import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { z } from 'zod';
import { createAIProvider } from '@amz-spapi/ai-provider';
import {
  APLUS_CREATIVITY_TEMPERATURE,
  APlusCreativitySchema,
  APlusGuidanceSchema,
  ArtDirectionSchema,
  NarrativeBeatSchema,
  amazonModuleTypeForKind,
  generatedModuleSchemaForKind,
  isAplusGenerationModel,
  liftModuleToSection,
  moduleKindForBeat,
  type APlusGeneratedModule,
} from '@farvisionllc/models';
import { auth0 } from '../../../../lib/auth0';
import { aplusGenerateInputSchema } from '../../../../lib/aplus-generate-request';
import {
  FACT_CONSISTENCY_RULE,
  MODULE_FIELD_RULES,
  NO_TIME_SENSITIVE_RULE,
  buildFactSheetBlock,
  buildModuleCopyGuidanceBlock,
  buildNarrativeContextBlock,
  buildShotBibleBlock,
  compactGenerationInput,
  humanProductName,
} from '../../../../lib/aplus-generation-prompts';

export const maxDuration = 60;

const requestSchema = z.object({
  input: aplusGenerateInputSchema,
  model: z.string().optional(),
  creativity: APlusCreativitySchema.default('medium'),
  guidance: APlusGuidanceSchema.optional(),
  artDirection: ArtDirectionSchema,
  /** The full narrative — siblings give the section its non-repeat context. */
  beats: z.array(NarrativeBeatSchema).min(1),
  targetBeat: NarrativeBeatSchema,
  /** The section's own notes ("direction for regeneration"). */
  sectionNotes: z.string().max(1000).optional(),
  /** Locked sibling summaries — final content this section must not contradict. */
  lockedSiblingSummaries: z.array(z.string().max(300)).max(10).default([]),
});

// The one prompt block that differs from full generation: the brand backdrop
// guarantee for regenerated company-logo modules (mirrors ensureLogoBackdrop).
function ensureLogoBackdrop(
  module: APlusGeneratedModule,
  productName: string
): void {
  if (module.type === 'company-logo' && !module.background) {
    module.background = {
      role: 'brand-backdrop',
      size: '1792x1024',
      alt: 'Ambient brand lifestyle backdrop',
      brief: `An ambient, on-brand lifestyle scene in the REAL setting where ${productName} is naturally used or displayed — derived from its category, never a generic theme. THE PRODUCT ITSELF (${productName}) must appear, softly out of focus and offset to ONE side, so the scene is clearly about this product, with clean low-detail negative space on the OPPOSITE side for overlaid text. Layered depth, gentle bokeh, refined premium natural light. Show only ${productName} and props that naturally belong in its genuine use setting. No people staring at camera, no text or logos.`,
    };
  }
}

function isTemperatureRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /temperature/i.test(message);
}

const STRUCTURED_OUTPUT_PROVIDER_OPTIONS = {
  openai: { strictJsonSchema: false },
} as const;

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return Response.json(
      { error: 'Invalid section regeneration input.' },
      { status: 400 }
    );
  }

  const { input, targetBeat } = body;
  const provider =
    body.model && isAplusGenerationModel(body.model)
      ? createAIProvider({ models: { default: body.model, fast: body.model } })
      : createAIProvider({
          models: {
            ...(process.env['AI_FAST_MODEL']
              ? { fast: process.env['AI_FAST_MODEL'] }
              : {}),
          },
        });
  const kind = moduleKindForBeat(targetBeat);
  const amazonModuleType = amazonModuleTypeForKind(kind, input.contentTier);
  const productName = humanProductName(input);
  const moduleCopyGuidance = body.guidance?.moduleCopy?.trim();
  const sectionNotes = body.sectionNotes?.trim();

  const prompt = [
    'You are SellAvant, REWRITING one section of an existing Amazon A+ content package. The rest of the page is already written — your section must fit it, not restart it.',
    `This module is the "${kind}" type. Set the "type" field to exactly "${kind}".`,
    `Set order=${targetBeat.order}, amazonModuleType="${amazonModuleType}", and title to a short module label.`,
    `This section's conversion job is "${targetBeat.job}". Its intent: ${targetBeat.intent}`,
    'Fill EVERY field the schema defines for this module type, and ONLY those fields. Do not invent fields. No bracket placeholders, no "[unknown]".',
    '',
    ...MODULE_FIELD_RULES,
    NO_TIME_SENSITIVE_RULE,
    '',
    buildShotBibleBlock({
      productName,
      visualSystem: body.artDirection.visualSystem,
    }),
    '',
    'GLOBAL ART DIRECTION',
    JSON.stringify(body.artDirection, null, 2),
    '',
    buildFactSheetBlock(input),
    FACT_CONSISTENCY_RULE,
    '',
    buildNarrativeContextBlock(body.beats, targetBeat.order),
    ...(body.lockedSiblingSummaries.length
      ? [
          '',
          'LOCKED SIBLING SECTIONS (already final — do not contradict or repeat them):',
          ...body.lockedSiblingSummaries.map((summary) => `  • ${summary}`),
        ]
      : []),
    ...(sectionNotes
      ? ['', 'SELLER NOTES FOR THIS SECTION (follow them):', sectionNotes]
      : []),
    ...(moduleCopyGuidance
      ? ['', buildModuleCopyGuidanceBlock(moduleCopyGuidance)]
      : []),
    '',
    'INPUT',
    compactGenerationInput(input),
  ].join('\n');

  const tStart = Date.now();
  let temperature: number | undefined =
    APLUS_CREATIVITY_TEMPERATURE.moduleCopy[body.creativity];
  let lastError: unknown;
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
        prompt,
      });
      const module = {
        ...res.output,
        order: targetBeat.order,
        amazonModuleType,
        type: kind,
      } as APlusGeneratedModule;
      ensureLogoBackdrop(module, productName);

      const section = liftModuleToSection(module, {
        id: `section-${targetBeat.order}`,
        order: targetBeat.order,
        beat: targetBeat,
      });
      console.log(
        `[a-plus-section-regenerate] beat ${targetBeat.order} (${
          targetBeat.job
        }/${targetBeat.archetype}): ${((Date.now() - tStart) / 1000).toFixed(
          1
        )}s`
      );
      return Response.json({ section });
    } catch (err: unknown) {
      lastError = err;
      // Some models reject a non-default temperature — retry without it.
      if (isTemperatureRejection(err)) temperature = undefined;
      if (NoObjectGeneratedError.isInstance(err)) {
        console.error(
          `[a-plus-section-regenerate] schema mismatch (attempt ${
            attempt + 1
          }): finishReason=${err.finishReason ?? 'unknown'}`
        );
      }
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  console.error(
    `[a-plus-section-regenerate] FAILED after retry: ${detail.slice(0, 300)}`
  );
  return Response.json(
    { error: 'Could not regenerate this section. Please try again.' },
    { status: 502 }
  );
}
