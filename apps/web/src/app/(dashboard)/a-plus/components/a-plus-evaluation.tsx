'use client';

import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Gauge,
  Info,
  Loader2,
  WandSparkles,
} from 'lucide-react';
import {
  JUDGE_DIMENSION_WEIGHTS,
  type EvaluationFinding,
  type EvaluationScore,
  type JudgeDimensionKey,
} from '@farvisionllc/models';
import type { AplusJudgeResult } from '@/lib/aplus-evaluate-request';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const DIMENSION_LABELS: Record<JudgeDimensionKey, string> = {
  factGrounding: 'Fact grounding',
  benefitClarity: 'Benefit clarity',
  hookStrength: 'Hook strength',
  objectionCoverage: 'Objection coverage',
  narrativeFlow: 'Narrative flow',
  copyCraft: 'Copy craft',
};

const SEVERITY_STYLE = {
  critical: 'border-red-200 bg-red-50 text-red-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
} as const;

const SEVERITY_ICON = {
  critical: AlertCircle,
  warn: AlertCircle,
  info: Info,
} as const;

export type JudgeSuggestionView = AplusJudgeResult['suggestions'][number] & {
  /** Resolved from sectionOrder; absent → advisory-only (no Fix button). */
  sectionId?: string;
};

/** What the Fix buttons dispatch — the editor maps these onto its features. */
export type EvaluationFixHandlers = {
  onRegenerateSection: (
    sectionId: string,
    overrides?: { notes?: string; archetype?: string }
  ) => void;
  /** Expand the section card and scroll to the field (or the slot picker). */
  onFocusSection: (sectionId: string, fieldDomId?: string) => void;
  onGenerateImage: (
    moduleOrder: number,
    role: string,
    brief: string,
    size: string
  ) => void;
  onReorder: (sectionId: string, direction: -1 | 1) => void;
  onToggleTier: () => void;
  onAddAsins: () => void;
  onAddBrandLogo: () => void;
};

function scoreTone(overall: number, max: number): string {
  const ratio = overall / max;
  if (ratio >= 0.8) return 'text-emerald-600';
  if (ratio >= 0.55) return 'text-amber-600';
  return 'text-red-600';
}

function FindingFixButton({
  finding,
  handlers,
  disabled,
}: {
  finding: EvaluationFinding;
  handlers: EvaluationFixHandlers;
  disabled: boolean;
}) {
  const { action } = finding;
  const fieldDomId = finding.fieldPath
    ? `aplus-field-${finding.sectionId}-${finding.fieldPath.join('-')}`
    : undefined;

  const run = (): void => {
    switch (action.type) {
      case 'regenerate-section':
        if (finding.sectionId) {
          handlers.onRegenerateSection(finding.sectionId, {
            notes: action.suggestedNotes,
            archetype: action.archetype,
          });
        }
        return;
      case 'switch-archetype':
        if (finding.sectionId) {
          handlers.onRegenerateSection(finding.sectionId, {
            notes: action.suggestedNotes,
            archetype: action.archetype,
          });
        }
        return;
      case 'edit-field':
      case 'pin-image':
        if (finding.sectionId) {
          handlers.onFocusSection(finding.sectionId, fieldDomId);
        }
        return;
      case 'generate-image':
        if (
          action.moduleOrder !== undefined &&
          action.role &&
          action.brief &&
          action.size
        ) {
          handlers.onGenerateImage(
            action.moduleOrder,
            action.role,
            action.brief,
            action.size
          );
        }
        return;
      case 'reorder':
        if (finding.sectionId) {
          handlers.onReorder(finding.sectionId, action.direction ?? 1);
        }
        return;
      case 'toggle-tier':
        handlers.onToggleTier();
        return;
      case 'add-asins':
        handlers.onAddAsins();
        return;
      case 'add-brand-logo':
        handlers.onAddBrandLogo();
        return;
      default:
        return;
    }
  };

  const label =
    action.type === 'regenerate-section' || action.type === 'switch-archetype'
      ? 'Fix with AI'
      : action.type === 'generate-image'
      ? 'Generate'
      : action.type === 'edit-field' || action.type === 'pin-image'
      ? 'Go to field'
      : action.type === 'reorder'
      ? 'Reorder'
      : action.type === 'toggle-tier'
      ? 'Change tier'
      : action.type === 'add-asins'
      ? 'Add ASINs'
      : action.type === 'add-brand-logo'
      ? 'Pick logo'
      : null;
  if (!label) return null;

  const needsSection =
    action.type !== 'toggle-tier' &&
    action.type !== 'add-asins' &&
    action.type !== 'add-brand-logo' &&
    action.type !== 'generate-image';
  if (needsSection && !finding.sectionId) return null;

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 shrink-0 text-xs"
      disabled={disabled}
      onClick={run}
    >
      {label}
    </Button>
  );
}

/**
 * The evaluation card: live 0–100 score (lint completeness always fresh; LLM
 * quality on demand), dimension bars, and findings whose Fix buttons dispatch
 * straight into editor features.
 */
export function APlusEvaluationCard({
  score,
  findings,
  judge,
  judgeModelId,
  stale,
  evaluating,
  regenerating,
  lockedSectionIds,
  sectionLabelByOrder,
  sectionIdByOrder,
  onEvaluate,
  handlers,
}: {
  score: EvaluationScore;
  findings: EvaluationFinding[];
  judge?: AplusJudgeResult;
  judgeModelId?: string;
  /** Content changed since the judge ran. */
  stale: boolean;
  evaluating: boolean;
  /** A section regeneration is in flight — disable regen-type fixes. */
  regenerating: boolean;
  lockedSectionIds: ReadonlySet<string>;
  sectionLabelByOrder: ReadonlyMap<number, string>;
  sectionIdByOrder: ReadonlyMap<number, string>;
  onEvaluate: () => void;
  handlers: EvaluationFixHandlers;
}) {
  const [showAllFindings, setShowAllFindings] = useState(false);
  const judgeUsable = Boolean(judge) && !stale;
  const max = judgeUsable ? 100 : 40;
  const visibleFindings = showAllFindings ? findings : findings.slice(0, 6);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4 text-primary" />
            Content score
          </CardTitle>
          <Button
            type="button"
            size="sm"
            disabled={evaluating}
            onClick={onEvaluate}
          >
            {evaluating ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <WandSparkles className="mr-2 h-3.5 w-3.5" />
            )}
            {evaluating
              ? 'Evaluating…'
              : judge
              ? 'Re-evaluate'
              : 'Run quality evaluation'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p
              className={cn(
                'text-4xl font-semibold leading-none',
                scoreTone(score.overall, max)
              )}
            >
              {score.overall}
              <span className="text-lg font-normal text-muted-foreground">
                {' '}
                / {max}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {score.completeness} / 40 completeness (automatic checks)
              {score.quality !== undefined
                ? ` · ${score.quality} / 60 quality (AI review${
                    judgeModelId ? ` · ${judgeModelId}` : ''
                  })`
                : ' · quality not scored yet'}
            </p>
          </div>
          {stale && judge ? (
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-amber-800"
            >
              Content changed since the last evaluation — re-evaluate
            </Badge>
          ) : null}
        </div>

        {judgeUsable && judge ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(JUDGE_DIMENSION_WEIGHTS) as JudgeDimensionKey[]).map(
              (key) => {
                const dimension = judge.dimensions[key];
                return (
                  <div key={key} className="rounded-md border p-2.5">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span>{DIMENSION_LABELS[key]}</span>
                      <span>{Math.round(dimension.score)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          dimension.score >= 80
                            ? 'bg-emerald-500'
                            : dimension.score >= 55
                            ? 'bg-amber-500'
                            : 'bg-red-500'
                        )}
                        style={{ width: `${Math.min(100, dimension.score)}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {dimension.rationale}
                    </p>
                  </div>
                );
              }
            )}
          </div>
        ) : null}

        {findings.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            No automatic-check issues found.
          </p>
        ) : (
          <div className="space-y-2">
            {visibleFindings.map((finding, index) => {
              const Icon = SEVERITY_ICON[finding.severity];
              const locked = finding.sectionId
                ? lockedSectionIds.has(finding.sectionId)
                : false;
              const regenType =
                finding.action.type === 'regenerate-section' ||
                finding.action.type === 'switch-archetype';
              return (
                <div
                  key={`${finding.id}-${index}`}
                  className={cn(
                    'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
                    SEVERITY_STYLE[finding.severity]
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{finding.message}</p>
                    <p className="text-xs opacity-80">{finding.suggestion}</p>
                  </div>
                  <FindingFixButton
                    finding={finding}
                    handlers={handlers}
                    disabled={
                      evaluating || (regenType && (regenerating || locked))
                    }
                  />
                </div>
              );
            })}
            {findings.length > 6 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowAllFindings((current) => !current)}
              >
                {showAllFindings
                  ? 'Show fewer'
                  : `Show ${findings.length - 6} more`}
              </Button>
            ) : null}
          </div>
        )}

        {judgeUsable && judge && judge.suggestions.length ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">AI suggestions</p>
            {judge.suggestions.map((suggestion, index) => {
              const sectionId = suggestion.sectionOrder
                ? sectionIdByOrder.get(suggestion.sectionOrder)
                : undefined;
              const sectionLabel = suggestion.sectionOrder
                ? sectionLabelByOrder.get(suggestion.sectionOrder)
                : undefined;
              const locked = sectionId
                ? lockedSectionIds.has(sectionId)
                : false;
              const regenType =
                suggestion.action === 'regenerate-section' ||
                suggestion.action === 'switch-archetype';
              const fixable =
                sectionId &&
                (regenType ||
                  suggestion.action === 'edit-field' ||
                  suggestion.action === 'pin-image' ||
                  suggestion.action === 'generate-image' ||
                  suggestion.action === 'reorder');
              return (
                <div
                  key={index}
                  className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <WandSparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {suggestion.title}
                      {sectionLabel ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          Section {suggestion.sectionOrder} · {sectionLabel}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {suggestion.detail}
                    </p>
                  </div>
                  {fixable ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 text-xs"
                      disabled={
                        evaluating || (regenType && (regenerating || locked))
                      }
                      onClick={() => {
                        if (!sectionId) return;
                        if (regenType) {
                          handlers.onRegenerateSection(sectionId, {
                            notes:
                              suggestion.suggestedNotes ?? suggestion.detail,
                          });
                        } else if (suggestion.action === 'reorder') {
                          handlers.onReorder(sectionId, 1);
                        } else {
                          handlers.onFocusSection(sectionId);
                        }
                      }}
                    >
                      {regenType ? 'Fix with AI' : 'Go to section'}
                    </Button>
                  ) : suggestion.action === 'toggle-tier' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 text-xs"
                      disabled={evaluating}
                      onClick={handlers.onToggleTier}
                    >
                      Change tier
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
