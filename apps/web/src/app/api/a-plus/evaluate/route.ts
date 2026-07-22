import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { z } from 'zod';
import { createAIProvider } from '@amz-spapi/ai-provider';
import {
  APLUS_CREATIVITY_TEMPERATURE,
  JUDGE_DIMENSION_WEIGHTS,
  isAplusGenerationModel,
} from '@farvisionllc/models';
import { auth0 } from '../../../../lib/auth0';
import {
  aplusEvaluateRequestSchema,
  aplusJudgeResultSchema,
} from '../../../../lib/aplus-evaluate-request';
import {
  FACT_CONSISTENCY_RULE,
  buildFactSheetBlock,
  buildNarrativeContextBlock,
  humanProductName,
} from '../../../../lib/aplus-generation-prompts';

export const maxDuration = 60;

function isTemperatureRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /temperature/i.test(message);
}

const STRUCTURED_OUTPUT_PROVIDER_OPTIONS = {
  openai: { strictJsonSchema: false },
} as const;

/**
 * The judge must suggest only actions the editor can execute one-click —
 * mirrored from JUDGE_SUGGESTION_ACTIONS in aplus-evaluate-request.ts.
 */
const AVAILABLE_ACTIONS_BLOCK = [
  'AVAILABLE ACTIONS — every suggestion MUST be phrased as one of these in-app actions (set the "action" field accordingly):',
  '  • regenerate-section: rewrite one section via AI. Provide suggestedNotes — one or two imperative sentences the writer will follow (e.g. "Lead with the insulation benefit; name the exact capacity").',
  '  • edit-field: a small manual copy fix in one field (typos, tightening, one weak phrase).',
  '  • generate-image / pin-image: an image is weak or generic — regenerate it or pin a real product photo.',
  '  • switch-archetype: the section content is right but the layout undersells it (e.g. dense feature list → hotspots; objections → qna; range story → carousel). Name the target layout in the detail.',
  '  • reorder: a section would convert better elsewhere in the page.',
  '  • toggle-tier: the content deserves Premium A+ modules (or should drop to Basic).',
  '  • none: page-level advice with no single in-app action.',
].join('\n');

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof aplusEvaluateRequestSchema>;
  try {
    body = aplusEvaluateRequestSchema.parse(await request.json());
  } catch {
    return Response.json(
      { error: 'Invalid evaluation input.' },
      { status: 400 }
    );
  }

  // Judging rewards a STRONG model (fact cross-checking, score discrimination)
  // and runs on-demand — default to the provider's stronger tier, overridable
  // via the shared model picker.
  const provider =
    body.model && isAplusGenerationModel(body.model)
      ? createAIProvider({ models: { default: body.model, fast: body.model } })
      : createAIProvider();
  const productName = humanProductName(body.input);

  const moduleCopyBlock = body.moduleCopy
    .map((module) =>
      [
        `Module ${module.order} — ${module.moduleName}:`,
        ...module.fields.map((field) => `  ${field.label}: ${field.value}`),
      ].join('\n')
    )
    .join('\n');

  const prompt = [
    `You are a rigorous Amazon A+ content REVIEWER scoring a finished page for ${productName}. You judge what a BUYER experiences — you do not rewrite it.`,
    'Score each dimension 0–100 with a one-sentence rationale. Be discriminating: 90+ is rare, reserved for copy that would survive a professional CRO review; 50 means mediocre; a page with invented facts, generic filler, or a weak arc must score low on the relevant dimension.',
    'Dimensions:',
    `  • factGrounding (weight ${JUDGE_DIMENSION_WEIGHTS.factGrounding}): every physical claim (materials, construction, counts, colors, certifications) is backed by the FACT SHEET below. Invented or upgraded claims are severe failures.`,
    `  • benefitClarity (${JUDGE_DIMENSION_WEIGHTS.benefitClarity}): features are translated into concrete buyer benefits, not spec-speak.`,
    `  • hookStrength (${JUDGE_DIMENSION_WEIGHTS.hookStrength}): the opening section earns the next scroll.`,
    `  • objectionCoverage (${JUDGE_DIMENSION_WEIGHTS.objectionCoverage}): the buyer's stated objections are each answered somewhere on the page.`,
    `  • narrativeFlow (${JUDGE_DIMENSION_WEIGHTS.narrativeFlow}): sections build on each other without repeating; each adds a new idea.`,
    `  • copyCraft (${JUDGE_DIMENSION_WEIGHTS.copyCraft}): specific, active, unpadded prose; no clichés ("elevate", "experience the difference"), no filler.`,
    '',
    'Then give AT MOST 8 improvement suggestions, ordered by conversion impact. Each targets ONE module (sectionOrder) where possible.',
    AVAILABLE_ACTIONS_BLOCK,
    ...(body.lintSummary.length
      ? [
          '',
          'ALREADY FLAGGED by automated checks — do NOT repeat these; suggest different improvements:',
          ...body.lintSummary.map((line) => `  • ${line}`),
        ]
      : []),
    '',
    buildFactSheetBlock(body.input),
    FACT_CONSISTENCY_RULE,
    '',
    buildNarrativeContextBlock(body.beats),
    '',
    'THE PAGE COPY (what the buyer reads):',
    moduleCopyBlock,
  ].join('\n');

  const tStart = Date.now();
  // Low temperature: judging is a discrimination task, not a creative one.
  let temperature: number | undefined =
    APLUS_CREATIVITY_TEMPERATURE.strategy.low;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await generateText({
        model: provider.languageModel('default'),
        abortSignal: AbortSignal.timeout(90_000),
        temperature,
        providerOptions: STRUCTURED_OUTPUT_PROVIDER_OPTIONS,
        output: Output.object({
          schema: aplusJudgeResultSchema,
          name: 'a_plus_evaluation',
        }),
        prompt,
      });
      const result = aplusJudgeResultSchema.parse(res.output);
      console.log(
        `[a-plus-evaluate] ${provider.modelId('default')}: ${(
          (Date.now() - tStart) /
          1000
        ).toFixed(1)}s, ${result.suggestions.length} suggestions`
      );
      return Response.json({
        result,
        modelId: provider.modelId('default'),
      });
    } catch (err: unknown) {
      lastError = err;
      // Some models reject a non-default temperature — retry without it.
      if (isTemperatureRejection(err)) temperature = undefined;
      if (NoObjectGeneratedError.isInstance(err)) {
        console.error(
          `[a-plus-evaluate] schema mismatch (attempt ${
            attempt + 1
          }): finishReason=${err.finishReason ?? 'unknown'}`
        );
      }
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  console.error(
    `[a-plus-evaluate] FAILED after retry: ${detail.slice(0, 300)}`
  );
  return Response.json(
    { error: 'Could not evaluate the content. Please try again.' },
    { status: 502 }
  );
}
