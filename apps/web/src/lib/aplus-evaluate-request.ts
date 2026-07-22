import { z } from 'zod';
import { NarrativeBeatSchema } from '@farvisionllc/models';
import { aplusGenerateInputSchema } from './aplus-generate-request';

/**
 * Shared request/response contract for the A+ evaluation judge — one schema
 * for the route (validation) and the editor (typed parsing), so they can't
 * drift.
 */

export const aplusEvaluateRequestSchema = z.object({
  input: aplusGenerateInputSchema,
  /** Judge model override (validated against the shared allowlist). */
  model: z.string().optional(),
  /** The page's narrative, from beatsFromExperience — total for any draft. */
  beats: z.array(NarrativeBeatSchema).min(1),
  /** Per-module rendered copy the buyer actually reads. */
  moduleCopy: z
    .array(
      z.object({
        order: z.number().int().positive(),
        moduleName: z.string().max(120),
        fields: z.array(
          z.object({ label: z.string().max(120), value: z.string().max(2000) })
        ),
      })
    )
    .min(1),
  /** Deterministic lint findings, so the judge doesn't repeat them. */
  lintSummary: z.array(z.string().max(300)).max(30).default([]),
});
export type AplusEvaluateRequest = z.infer<typeof aplusEvaluateRequestSchema>;

const dimensionSchema = z.object({
  score: z.number().min(0).max(100),
  rationale: z.string().max(300),
});

/** Actions the editor can execute one-click — the judge picks from these. */
export const JUDGE_SUGGESTION_ACTIONS = [
  'regenerate-section',
  'edit-field',
  'generate-image',
  'pin-image',
  'switch-archetype',
  'reorder',
  'toggle-tier',
  'none',
] as const;

export const aplusJudgeResultSchema = z.object({
  dimensions: z.object({
    hookStrength: dimensionSchema,
    benefitClarity: dimensionSchema,
    objectionCoverage: dimensionSchema,
    /** No claims beyond the fact sheet — weighted heaviest. */
    factGrounding: dimensionSchema,
    narrativeFlow: dimensionSchema,
    copyCraft: dimensionSchema,
  }),
  suggestions: z
    .array(
      z.object({
        /** The module order the suggestion targets (omit for page-level). */
        sectionOrder: z.number().int().positive().optional(),
        title: z.string().max(80),
        detail: z.string().max(400),
        action: z.enum(JUDGE_SUGGESTION_ACTIONS),
        /** Pre-fills the section's regeneration notes for one-click apply. */
        suggestedNotes: z.string().max(500).optional(),
      })
    )
    .max(8),
});
export type AplusJudgeResult = z.infer<typeof aplusJudgeResultSchema>;
