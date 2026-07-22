import {
  applyAPlusGuardrails,
  moduleImageSlots,
  type APlusTextFieldPath,
} from './aplus.js';
import { sectionTextFieldDescriptors } from './experience-fields.js';
import { OPENER_ARCHETYPES } from './narrative.js';
import type {
  AplusDeployment,
  AplusTier,
  Experience,
  LayoutArchetype,
} from './experience.js';

// ---------------------------------------------------------------------------
// A+ evaluation — the deterministic half. A pure lint over the Experience +
// compiled deployment producing FINDINGS whose actions map 1:1 onto editor
// features (regenerate with notes, edit a field, pin/generate an image, …) so
// every suggestion is one click from applied. The LLM judge (quality rubric)
// lives in the web app; composeScore() blends both into the 0–100 score.
// ---------------------------------------------------------------------------

export type EvaluationSeverity = 'critical' | 'warn' | 'info';

export type EvaluationActionType =
  | 'regenerate-section'
  | 'edit-field'
  | 'generate-image'
  | 'pin-image'
  | 'switch-archetype'
  | 'reorder'
  | 'toggle-tier'
  | 'add-asins'
  | 'add-brand-logo'
  | 'none';

export type EvaluationAction = {
  type: EvaluationActionType;
  /** For image actions: the compiled module order + slot role (jobId = web concern). */
  moduleOrder?: number;
  role?: string;
  brief?: string;
  size?: string;
  /** Pre-fills the section's regeneration notes. */
  suggestedNotes?: string;
  archetype?: LayoutArchetype;
  direction?: -1 | 1;
};

export type EvaluationFinding = {
  id: string;
  severity: EvaluationSeverity;
  /** Penalty against the 40-point completeness budget. */
  points: number;
  sectionId?: string;
  fieldPath?: APlusTextFieldPath;
  action: EvaluationAction;
  message: string;
  suggestion: string;
};

/** Web-only context passed in so the lint stays pure of editor internals. */
export type EvaluationFacts = {
  asins?: string[];
  hasBrandLogo?: boolean;
  /** The seller's buyer-objections input (drives premium-unused). */
  objections?: string;
  /**
   * Slots whose image exists only in transient editor state (freshly
   * generated, not yet persisted), keyed `${moduleOrder}:${role}` — prevents
   * false missing-image findings.
   */
  resolvedSlotKeys?: string[];
};

export const EVALUATION_COMPLETENESS_BUDGET = 40;

/** Judge dimension weights (must sum to 1) — factGrounding weighs heaviest. */
export const JUDGE_DIMENSION_WEIGHTS = {
  factGrounding: 0.25,
  benefitClarity: 0.2,
  hookStrength: 0.15,
  objectionCoverage: 0.15,
  narrativeFlow: 0.15,
  copyCraft: 0.1,
} as const;
export type JudgeDimensionKey = keyof typeof JUDGE_DIMENSION_WEIGHTS;

const PREMIUM_SHOWCASE_ARCHETYPES: readonly LayoutArchetype[] = [
  'qna',
  'hotspots',
  'carousel',
];

/** Character-trigram Jaccard similarity — cheap near-duplicate detector. */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (text: string): Set<string> => {
    const norm = text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .trim();
    const set = new Set<string>();
    for (let i = 0; i <= norm.length - 3; i++) set.add(norm.slice(i, i + 3));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  let shared = 0;
  for (const gram of ga) if (gb.has(gram)) shared++;
  return shared / (ga.size + gb.size - shared);
}

/**
 * Staleness signal for a persisted judge result: changes when any compiled
 * copy, ordering, image, or the tier changes; deliberately blind to section
 * notes (they don't render). djb2 over the module JSON — fast, deterministic.
 */
export function evaluationContentHash(
  deployment: Pick<AplusDeployment, 'modules'>,
  tier: AplusTier
): string {
  const text = JSON.stringify(deployment.modules) + tier;
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

type Capped = { total: number };
const capAdd = (state: Capped, points: number, cap: number): number => {
  const granted = Math.max(0, Math.min(points, cap - state.total));
  state.total += granted;
  return granted;
};

/**
 * Deterministic checks over the document. Never throws; findings are sorted
 * critical → warn → info, each carrying its one-click fix action.
 */
export function lintAplusExperience(
  experience: Experience,
  deployment: AplusDeployment,
  tier: AplusTier,
  facts: EvaluationFacts = {}
): EvaluationFinding[] {
  const findings: EvaluationFinding[] = [];
  const resolvedKeys = new Set(facts.resolvedSlotKeys ?? []);
  const sections = [...experience.sections].sort((a, b) => a.order - b.order);
  const sectionIdByOrder = new Map(
    deployment.moduleMapping.map(
      (entry) => [entry.order, entry.sectionIds[0]] as const
    )
  );

  // --- missing images (critical, 4 each, cap 12) ---------------------------
  const missingCap: Capped = { total: 0 };
  for (const module of deployment.modules) {
    for (const slot of moduleImageSlots(module)) {
      if (slot.image?.url) continue;
      if (resolvedKeys.has(`${module.order}:${slot.role}`)) continue;
      const points = capAdd(missingCap, 4, 12);
      findings.push({
        id: 'missing-image',
        severity: 'critical',
        points,
        sectionId: sectionIdByOrder.get(module.order),
        action: {
          type: 'generate-image',
          moduleOrder: module.order,
          role: slot.role,
          brief: slot.brief,
          size: slot.size,
        },
        message: `Module ${module.order} is missing its “${slot.role}” image.`,
        suggestion:
          'Generate the image, or pin one of your uploaded photos into the slot.',
      });
    }
  }

  // --- compiler validations: over-budget + tier degradations ---------------
  if (deployment.validation.some((entry) => entry.code === 'over-budget')) {
    findings.push({
      id: 'over-budget',
      severity: 'critical',
      points: 5,
      action: { type: 'reorder' },
      message: 'The page needs more Amazon modules than the tier allows.',
      suggestion: 'Remove or merge the lowest-leverage sections.',
    });
  }
  const degradedCap: Capped = { total: 0 };
  for (const entry of deployment.validation) {
    if (!entry.code.endsWith('-degraded')) continue;
    const points = capAdd(degradedCap, 2, 6);
    findings.push({
      id: 'tier-degradation',
      severity: 'warn',
      points,
      sectionId: entry.sectionId,
      action: { type: 'toggle-tier' },
      message: entry.message,
      suggestion:
        'Switch to Premium A+ to deploy this section natively, or regenerate it with a Basic-native layout.',
    });
  }

  // --- per-field checks: guardrails, near-limit, intent leak, empty alt ----
  const guardrailCap: Capped = { total: 0 };
  const nearLimitCap: Capped = { total: 0 };
  const emptyAltCap: Capped = { total: 0 };
  for (const section of sections) {
    for (const field of sectionTextFieldDescriptors(section)) {
      const value = field.value.trim();
      if (!value) continue;
      const isBrief = field.label.toLowerCase().includes('brief');
      if (!isBrief) {
        const { triggered } = applyAPlusGuardrails(value);
        if (triggered.length) {
          findings.push({
            id: 'guardrail-hit',
            severity: 'critical',
            points: capAdd(guardrailCap, 3, 9),
            sectionId: section.id,
            fieldPath: field.path,
            action: { type: 'edit-field' },
            message: `“${
              field.label
            }” contains prohibited content (${triggered.join('; ')}).`,
            suggestion:
              'Rewrite the field without price, promo, delivery, or marketplace claims — Amazon rejects them.',
          });
        }
        if (value.length > field.maxLength * 0.9) {
          findings.push({
            id: 'near-limit',
            severity: 'info',
            points: capAdd(nearLimitCap, 0.5, 2),
            sectionId: section.id,
            fieldPath: field.path,
            action: { type: 'edit-field' },
            message: `“${field.label}” is at ${value.length}/${field.maxLength} characters.`,
            suggestion:
              'Tighten the copy so Seller Central never truncates it.',
          });
        }
      }
    }
    for (const [index, slot] of section.visual.images.entries()) {
      if (slot.alt.trim().length >= 5) continue;
      findings.push({
        id: 'empty-alt',
        severity: 'warn',
        points: capAdd(emptyAltCap, 1, 4),
        sectionId: section.id,
        fieldPath: ['visual', 'images', index, 'alt'],
        action: { type: 'edit-field' },
        message: `The “${slot.role}” image has no meaningful alt text.`,
        suggestion:
          'Describe the photo in a sentence — alt text is required for accessibility and indexing.',
      });
    }

    const intent = section.intent.trim().toLowerCase();
    for (const [label, value] of [
      ['label', section.label],
      ['headline', section.headline],
    ] as const) {
      if (!value || !intent) continue;
      if (value.trim().toLowerCase() === intent) {
        findings.push({
          id: 'intent-leak',
          severity: 'warn',
          points: 2,
          sectionId: section.id,
          fieldPath: [label === 'label' ? 'label' : 'headline'],
          action: {
            type: 'regenerate-section',
            suggestedNotes:
              'Write a short buyer-facing headline — never the planning intent sentence.',
          },
          message: `Section ${section.order}'s ${label} is the planner's intent sentence, not buyer copy.`,
          suggestion:
            'Rewrite it as a benefit-led headline, or regenerate the section.',
        });
      }
    }
  }

  // --- duplicate headlines (trigram similarity > 0.8) ----------------------
  const dupCap: Capped = { total: 0 };
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const a = sections[i].headline?.trim();
      const b = sections[j].headline?.trim();
      if (!a || !b) continue;
      if (trigramSimilarity(a, b) <= 0.8) continue;
      findings.push({
        id: 'duplicate-headline',
        severity: 'warn',
        points: capAdd(dupCap, 2, 6),
        sectionId: sections[j].id,
        action: {
          type: 'regenerate-section',
          suggestedNotes: `Use a headline angle distinct from section ${sections[i].order} (“${a}”).`,
        },
        message: `Sections ${sections[i].order} and ${sections[j].order} have near-identical headlines.`,
        suggestion: 'Regenerate one so each section adds a new angle.',
      });
    }
  }

  // --- structure: opener strength + adjacent archetypes --------------------
  const first = sections[0];
  if (
    first &&
    !(OPENER_ARCHETYPES as readonly string[]).includes(
      first.visual.layout.archetype
    )
  ) {
    findings.push({
      id: 'weak-opener',
      severity: 'warn',
      points: 3,
      sectionId: first.id,
      action: { type: 'reorder', direction: 1 },
      message: `The page opens with a ${first.visual.layout.archetype} — tables and lists above the fold kill engagement.`,
      suggestion: 'Move a visual hero section to position 1.',
    });
  }
  for (let i = 1; i < sections.length; i++) {
    if (
      sections[i].visual.layout.archetype !==
      sections[i - 1].visual.layout.archetype
    ) {
      continue;
    }
    findings.push({
      id: 'adjacent-archetype',
      severity: 'warn',
      points: 2,
      sectionId: sections[i].id,
      action: { type: 'reorder', direction: 1 },
      message: `Sections ${sections[i - 1].order} and ${
        sections[i].order
      } use the same layout back-to-back.`,
      suggestion: 'Reorder or regenerate one for layout variety.',
    });
    break; // one structural finding is enough signal
  }

  // --- premium leverage -----------------------------------------------------
  if (
    tier === 'Premium A+' &&
    facts.objections?.trim() &&
    !sections.some((section) =>
      PREMIUM_SHOWCASE_ARCHETYPES.includes(section.visual.layout.archetype)
    )
  ) {
    findings.push({
      id: 'premium-unused',
      severity: 'info',
      points: 3,
      action: { type: 'switch-archetype', archetype: 'qna' },
      message:
        'Premium A+ is active and you listed buyer objections, but no Q&A, hotspots, or carousel module is used.',
      suggestion:
        'Regenerate a proof section as Q&A — it answers objections in Amazon’s native interactive module.',
    });
  }

  // --- hotspot marker layout -------------------------------------------------
  const hotspotCap: Capped = { total: 0 };
  for (const section of sections) {
    const layout = section.visual.layout;
    if (layout.archetype !== 'hotspots') continue;
    const spots = layout.hotspots;
    const offEdge = spots.some(
      (spot) =>
        spot.position.x < 0.05 ||
        spot.position.x > 0.95 ||
        spot.position.y < 0.05 ||
        spot.position.y > 0.95
    );
    let clustered = false;
    for (let i = 0; i < spots.length && !clustered; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const dx = spots[i].position.x - spots[j].position.x;
        const dy = spots[i].position.y - spots[j].position.y;
        if (Math.hypot(dx, dy) < 0.1) {
          clustered = true;
          break;
        }
      }
    }
    if (!offEdge && !clustered) continue;
    findings.push({
      id: 'hotspot-layout',
      severity: 'warn',
      points: capAdd(hotspotCap, 1, 3),
      sectionId: section.id,
      action: {
        type: 'regenerate-section',
        suggestedNotes:
          'Spread the hotspot markers apart and keep them away from the image edges, each placed ON its feature.',
      },
      message: clustered
        ? `Section ${section.order}'s hotspot markers are clustered together.`
        : `Section ${section.order} has hotspot markers at the image edge.`,
      suggestion:
        'Nudge the positions in the section editor, or regenerate with placement notes.',
    });
  }

  // --- deployment metadata ----------------------------------------------------
  if (!facts.asins?.length) {
    findings.push({
      id: 'no-asins',
      severity: 'warn',
      points: 2,
      action: { type: 'add-asins' },
      message: 'No ASINs are set — the content has nothing to be applied to.',
      suggestion: 'Add the target ASIN(s) in the Basics step.',
    });
  }
  if (
    facts.hasBrandLogo === false &&
    deployment.modules.some((module) => module.type === 'company-logo')
  ) {
    findings.push({
      id: 'no-brand-logo',
      severity: 'info',
      points: 1,
      action: { type: 'add-brand-logo' },
      message: 'A brand module is planned but no brand logo is selected.',
      suggestion: 'Pick or create a brand guide with a logo.',
    });
  }

  const rank: Record<EvaluationSeverity, number> = {
    critical: 0,
    warn: 1,
    info: 2,
  };
  return findings.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || b.points - a.points
  );
}

export type EvaluationScore = {
  /** 0–100 (or 0–40 shown alone while the judge hasn't run). */
  overall: number;
  /** 0–40, from lint penalties. */
  completeness: number;
  /** 0–60, from the judge — undefined until it runs. */
  quality?: number;
};

/** Blend lint findings and (optional) judge dimensions into the 0–100 score. */
export function composeScore(
  findings: EvaluationFinding[],
  judgeDimensions?: Record<JudgeDimensionKey, { score: number }>
): EvaluationScore {
  const penalties = Math.min(
    EVALUATION_COMPLETENESS_BUDGET,
    findings.reduce((sum, finding) => sum + finding.points, 0)
  );
  const completeness = Math.round(EVALUATION_COMPLETENESS_BUDGET - penalties);

  if (!judgeDimensions) return { overall: completeness, completeness };

  const weighted = (
    Object.entries(JUDGE_DIMENSION_WEIGHTS) as Array<
      [JudgeDimensionKey, number]
    >
  ).reduce(
    (sum, [key, weight]) =>
      sum + weight * Math.max(0, Math.min(100, judgeDimensions[key].score)),
    0
  );
  const quality = Math.round(0.6 * weighted);
  return { overall: completeness + quality, completeness, quality };
}
