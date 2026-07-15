'use client';

import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Loader2,
  Lock,
  LockOpen,
  WandSparkles,
} from 'lucide-react';
import {
  APLUS_SLICE_CONSTANTS,
  ARCHETYPE_LABELS,
  CONVERSION_JOB_LABELS,
  moduleImageSlots,
  sectionTextFieldDescriptors,
  sellerCentralModuleName,
  type APlusGeneratedModule,
  type APlusTextFieldPath,
  type AplusDeployment,
  type ConversionJob,
  type Experience,
} from '@farvisionllc/models';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { EditableTextField } from './a-plus-editable-field';
import { slotJobId, type SlotImageResult } from './a-plus-modules';

/** Color-coded conversion-job badges so the narrative arc reads at a glance. */
const JOB_BADGE_CLASSES: Record<ConversionJob, string> = {
  hook: 'border-violet-200 bg-violet-50 text-violet-800',
  problem: 'border-rose-200 bg-rose-50 text-rose-800',
  benefit: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'how-it-works': 'border-cyan-200 bg-cyan-50 text-cyan-800',
  differentiation: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800',
  proof: 'border-blue-200 bg-blue-50 text-blue-800',
  comparison: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  'use-cases': 'border-amber-200 bg-amber-50 text-amber-800',
  brand: 'border-stone-300 bg-stone-100 text-stone-800',
  cta: 'border-orange-200 bg-orange-50 text-orange-800',
};

function downloadNameFor(moduleOrder: number, role: string): string {
  return (
    `module-${moduleOrder}-${role}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) + '.png'
  );
}

export type PlaceableAsset = { assetId: string; fileName: string };

/** Compact per-slot generate/download controls against the compiled module. */
function SectionImageSlots({
  module,
  slotResults,
  onGenerateImage,
  placeableAssets,
  onPlaceAsset,
}: {
  module: APlusGeneratedModule;
  slotResults?: Record<string, SlotImageResult>;
  onGenerateImage: (jobId: string, brief: string, size: string) => void;
  placeableAssets: PlaceableAsset[];
  onPlaceAsset: (jobId: string, assetId: string) => void;
}) {
  const slots = moduleImageSlots(module);
  if (!slots.length) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Images</p>
      <div className="grid gap-2 md:grid-cols-2">
        {slots.map((slot) => {
          const jobId = slotJobId(module.order, slot.role);
          const result = slotResults?.[jobId];
          const imageUrl =
            slot.image?.url ??
            (result?.status === 'done' ? result.url : undefined);
          const downloadName = downloadNameFor(module.order, slot.role);
          return (
            <div
              key={jobId}
              className="rounded-md border bg-muted/20 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{slot.size}</Badge>
                  <p className="font-medium">{slot.role}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {result?.status === 'done' ? (
                    <Button type="button" variant="outline" size="sm" asChild>
                      <a
                        href={
                          result.assetId
                            ? `/api/a-plus/assets/${
                                result.assetId
                              }?download=1&filename=${encodeURIComponent(
                                downloadName
                              )}`
                            : result.url
                        }
                        download={downloadName}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      result?.status === 'generating' || !slot.brief?.trim()
                    }
                    onClick={() =>
                      onGenerateImage(jobId, slot.brief, slot.size)
                    }
                  >
                    {result?.status === 'generating' ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        Generating
                      </>
                    ) : (
                      <>
                        <WandSparkles className="mr-2 h-3.5 w-3.5" />
                        {imageUrl ? 'Regenerate' : 'Generate'}
                      </>
                    )}
                  </Button>
                </div>
              </div>
              {imageUrl ? (
                <div className="mt-2 overflow-hidden rounded-md border bg-background">
                  <img
                    src={imageUrl}
                    alt={slot.alt}
                    className="block max-h-48 w-full object-contain"
                    loading="lazy"
                  />
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Not generated yet — edit the image brief below, then Generate.
                </p>
              )}
              {result?.status === 'error' ? (
                <p className="mt-2 text-xs text-destructive">
                  {result.message}
                </p>
              ) : null}
              {placeableAssets.length ? (
                <select
                  aria-label={`Place an uploaded photo into ${slot.role}`}
                  value=""
                  onChange={(event) => {
                    if (event.target.value) {
                      onPlaceAsset(jobId, event.target.value);
                    }
                  }}
                  className="mt-2 h-8 w-full rounded-md border bg-background px-2 text-xs"
                >
                  <option value="">
                    Use one of your photos instead (no AI)…
                  </option>
                  {placeableAssets.map((asset) => (
                    <option key={asset.assetId} value={asset.assetId}>
                      {asset.fileName}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Sections-first editing surface: the Experience narrative (jobs, copy,
 * locks, order) is the document; Amazon modules are its compiled deployment,
 * shown per section with a budget meter.
 */
export function APlusSectionsPanel({
  experience,
  deployment,
  tier,
  slotResults,
  onEditTitle,
  onEditGoal,
  onEditSectionField,
  onEditSectionNotes,
  onToggleSectionLock,
  onMoveSection,
  onRegenerateSection,
  regeneratingSectionId,
  onGenerateImage,
  placeableAssets,
  onPlaceAsset,
}: {
  experience: Experience;
  deployment: AplusDeployment;
  tier: 'Basic A+' | 'Premium A+';
  slotResults?: Record<string, SlotImageResult>;
  onEditTitle: (value: string) => void;
  onEditGoal: (value: string) => void;
  onEditSectionField: (
    sectionId: string,
    path: APlusTextFieldPath,
    value: string
  ) => void;
  onEditSectionNotes: (sectionId: string, value: string) => void;
  onToggleSectionLock: (sectionId: string) => void;
  onMoveSection: (sectionId: string, direction: -1 | 1) => void;
  /** Rewrite one section via the narrative writer (locks/notes honored). */
  onRegenerateSection: (sectionId: string) => void;
  regeneratingSectionId?: string | null;
  onGenerateImage: (jobId: string, brief: string, size: string) => void;
  /** Uploaded photos the seller can pin into any slot (no generation cost). */
  placeableAssets: PlaceableAsset[];
  onPlaceAsset: (jobId: string, assetId: string) => void;
}) {
  const budget =
    tier === 'Premium A+'
      ? APLUS_SLICE_CONSTANTS.moduleBudget.premium
      : APLUS_SLICE_CONSTANTS.moduleBudget.basic;
  const spent = deployment.moduleMapping.reduce(
    (sum, entry) => sum + (entry.slices?.length ?? 1),
    0
  );
  const overBudget = spent > budget;
  const sections = [...experience.sections].sort((a, b) => a.order - b.order);
  const mappingBySection = new Map(
    deployment.moduleMapping.flatMap((entry) =>
      entry.sectionIds.map((sectionId) => [sectionId, entry] as const)
    )
  );

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="experience-title">Narrative title</Label>
              <Input
                id="experience-title"
                value={experience.title}
                maxLength={200}
                onChange={(event) => onEditTitle(event.target.value)}
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="experience-goal">Story summary</Label>
              <Textarea
                id="experience-goal"
                value={experience.goal}
                maxLength={1000}
                onChange={(event) => onEditGoal(event.target.value)}
                className="min-h-16 bg-background"
              />
            </div>
          </div>
          <div
            className={cn(
              'shrink-0 rounded-md border px-4 py-3 text-center',
              overBudget
                ? 'border-red-300 bg-red-50 text-red-900'
                : 'border-emerald-200 bg-emerald-50/60 text-emerald-900'
            )}
          >
            <p className="text-2xl font-semibold">
              {spent}
              <span className="text-sm font-normal text-muted-foreground">
                {' '}
                / {budget}
              </span>
            </p>
            <p className="text-xs">Amazon modules used</p>
          </div>
        </div>
        {deployment.validation.length ? (
          <ul className="mt-3 space-y-1.5">
            {deployment.validation.map((entry, index) => (
              <li
                key={`${entry.code}-${index}`}
                className={cn(
                  'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
                  entry.level === 'error'
                    ? 'border-red-200 bg-red-50 text-red-900'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                )}
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{entry.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {sections.map((section, index) => {
        const mapping = mappingBySection.get(section.id);
        const compiledModule = mapping
          ? deployment.modules[mapping.order - 1]
          : undefined;
        return (
          <article
            key={section.id}
            className={cn(
              'rounded-md border bg-background',
              section.locked ? 'border-stone-400/60' : ''
            )}
          >
            <Collapsible>
              <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {index + 1}
                    </span>
                    <Badge
                      className={cn('border', JOB_BADGE_CLASSES[section.job])}
                    >
                      {CONVERSION_JOB_LABELS[section.job]}
                    </Badge>
                    <Badge variant="outline">
                      {ARCHETYPE_LABELS[section.visual.layout.archetype]}
                    </Badge>
                    {section.locked ? (
                      <Badge variant="secondary" className="gap-1">
                        <Lock className="h-3 w-3" />
                        Locked
                      </Badge>
                    ) : null}
                  </div>
                  <h4 className="mt-2 font-semibold">
                    {section.headline || section.intent}
                  </h4>
                  {mapping ? (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      → {sellerCentralModuleName(mapping.amazonModuleType)}
                      {mapping.slices
                        ? ` × ${mapping.slices.length} slices`
                        : ''}
                      {mapping.kind === 'native' ? ' (native fields)' : ''}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  {!section.locked ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Rewrite this section (uses your notes; locked sections stay untouched)"
                      disabled={regeneratingSectionId !== null}
                      onClick={() => onRegenerateSection(section.id)}
                    >
                      {regeneratingSectionId === section.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <WandSparkles className="h-4 w-4" />
                      )}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title={
                      section.locked
                        ? 'Unlock section (regeneration may change it)'
                        : 'Lock section (regeneration must keep it)'
                    }
                    onClick={() => onToggleSectionLock(section.id)}
                  >
                    {section.locked ? (
                      <Lock className="h-4 w-4" />
                    ) : (
                      <LockOpen className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={index === 0}
                    title="Move section up"
                    onClick={() => onMoveSection(section.id, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={index === sections.length - 1}
                    title="Move section down"
                    onClick={() => onMoveSection(section.id, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Edit
                      <ChevronDown className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  </CollapsibleTrigger>
                </div>
              </div>

              <CollapsibleContent className="space-y-4 border-t p-4">
                <p className="text-xs text-muted-foreground">
                  {section.intent}
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  {sectionTextFieldDescriptors(section).map((field) => (
                    <EditableTextField
                      key={JSON.stringify(field.path)}
                      field={field}
                      onEdit={(path, value) =>
                        onEditSectionField(section.id, path, value)
                      }
                    />
                  ))}
                </div>
                {compiledModule ? (
                  <SectionImageSlots
                    module={compiledModule}
                    slotResults={slotResults}
                    onGenerateImage={onGenerateImage}
                    placeableAssets={placeableAssets}
                    onPlaceAsset={onPlaceAsset}
                  />
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor={`section-notes-${section.id}`}>
                    Notes for regeneration (optional)
                  </Label>
                  <Textarea
                    id={`section-notes-${section.id}`}
                    value={section.notes ?? ''}
                    maxLength={1000}
                    placeholder="e.g. Keep the black-lid close-up; mention the resealable bag."
                    onChange={(event) =>
                      onEditSectionNotes(section.id, event.target.value)
                    }
                    className="min-h-16 bg-background"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </article>
        );
      })}
    </div>
  );
}
