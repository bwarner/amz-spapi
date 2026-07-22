'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Download,
  FolderArchive,
  Loader2,
  Monitor,
  Smartphone,
  WandSparkles,
} from 'lucide-react';
import {
  moduleImageSlots,
  sellerCentralModuleName,
  type APlusGeneratedModule,
  type AplusTier,
  type ModuleMappingEntry,
} from '@farvisionllc/models';
import { Button } from '@/components/ui/button';
import { exportBaseName } from '@/lib/aplus-export-kit';
import { slotJobId, type SlotImageResult } from './a-plus-modules';
import {
  APLUS_CANVAS_WIDTH,
  APLUS_MOBILE_CANVAS_WIDTH,
  APLUS_PREMIUM_CANVAS_WIDTH,
  DesignedModule,
  type BrandTheme,
} from './a-plus-design';

/** POST a module to the export route and trigger a PNG download. */
async function downloadModulePng(
  module: APlusGeneratedModule,
  theme: BrandTheme,
  viewport: 'desktop' | 'mobile',
  tier: AplusTier
): Promise<void> {
  const response = await fetch('/api/a-plus/module-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module, theme, viewport, tier }),
  });
  if (!response.ok) throw new Error(`Export failed (${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `aplus-module-${module.order}-${viewport}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Fill each module's image slots from in-progress generation results so the
 * preview shows freshly generated images immediately (before they've been
 * persisted into slot.image). The pure DesignedModule only reads slot.image.
 */
function resolveModuleImages(
  module: APlusGeneratedModule,
  slotResults?: Record<string, SlotImageResult>
): APlusGeneratedModule {
  if (!slotResults) return module;
  const clone = structuredClone(module);
  for (const slot of moduleImageSlots(clone)) {
    if (slot.image) continue;
    const result = slotResults[slotJobId(clone.order, slot.role)];
    if (result?.status === 'done') {
      slot.image = { url: result.url, alt: slot.alt };
    }
  }
  return clone;
}

/**
 * Scale a fixed-canvas design down to the container width. Uses CSS `zoom`
 * (scales LAYOUT, so the box height is always the real scaled height) instead
 * of transform + a manually measured height — the measured height could go
 * stale (late-loading brand fonts/images) and clip a module mid-content while
 * the next one rendered straight over the overflow.
 */
function FitToWidth({
  canvasWidth,
  children,
}: {
  canvasWidth: number;
  children: React.ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const update = () => setScale(Math.min(1, outer.clientWidth / canvasWidth));
    const ro = new ResizeObserver(update);
    ro.observe(outer);
    update();
    return () => ro.disconnect();
  }, [canvasWidth]);

  return (
    // Paint containment: Chrome can leak stale painted fragments of zoomed
    // content into unrelated page regions (ghost duplicates of a module were
    // observed over other cards at the premium 1464→~908 zoom factor). It also
    // hides the one-frame full-size flash before the first scale measurement.
    <div
      ref={outerRef}
      style={{ width: '100%', overflow: 'hidden', contain: 'paint' }}
    >
      <div style={{ width: canvasWidth, zoom: scale }}>{children}</div>
    </div>
  );
}

/** assetId when the slot's resolved image is a user asset (exportable). */
function assetIdFromSlotUrl(url: string | undefined): string | undefined {
  if (!url?.startsWith('/api/a-plus/assets/')) return undefined;
  return url.split('/').pop()?.split('?')[0] || undefined;
}

/** Stacked, designed, brand-themed preview of the whole package. */
export function APlusDesignedPreview({
  modules,
  theme,
  slotResults,
  viewport = 'desktop',
  onRegenerate,
  tier = 'Basic A+',
  moduleMapping,
  title,
  asins,
}: {
  modules: APlusGeneratedModule[];
  theme: BrandTheme;
  slotResults?: Record<string, SlotImageResult>;
  viewport?: 'desktop' | 'mobile';
  /** Regenerate a single image slot in place (e.g. a bad AI image). */
  onRegenerate?: (jobId: string, brief: string, size: string) => void;
  /** Premium renders at 1464px and unlocks exact-dim raw-photo exports. */
  tier?: AplusTier;
  /** Compiled mapping — carries per-image exact upload dims on Premium. */
  moduleMapping?: ModuleMappingEntry[];
  /** Draft name — names the export-kit zip. */
  title?: string;
  /** Deploy-target ASINs listed in the kit instructions. */
  asins?: string[];
}) {
  // Resolve in-progress images into slots once, for both render and export.
  const resolved = modules.map((module) =>
    resolveModuleImages(module, slotResults)
  );
  const [busy, setBusy] = useState<string | null>(null);

  const mappingByOrder = new Map(
    (moduleMapping ?? []).map((entry) => [entry.order, entry] as const)
  );

  async function download(
    module: APlusGeneratedModule,
    target: 'desktop' | 'mobile',
    key: string
  ) {
    setBusy(key);
    try {
      await downloadModulePng(module, theme, target, tier);
    } catch {
      // Surfaced by the disabled state clearing; keep the preview resilient.
    } finally {
      setBusy(null);
    }
  }

  async function downloadAll(target: 'desktop' | 'mobile') {
    const key = `all-${target}`;
    setBusy(key);
    try {
      for (const module of resolved) {
        await downloadModulePng(module, theme, target, tier);
      }
    } catch {
      // ignore; user can retry individual modules
    } finally {
      setBusy(null);
    }
  }

  /** One ZIP with instructions + every asset at Amazon's exact upload dims. */
  async function downloadExportKit() {
    setBusy('zip');
    try {
      const response = await fetch('/api/a-plus/export-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // `resolved` so freshly generated (unsaved) slot images ship too.
          modules: resolved,
          moduleMapping: moduleMapping ?? [],
          theme,
          tier,
          title,
          asins,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error || `Export failed (HTTP ${response.status}).`
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${exportBaseName(title)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : 'Export failed. Please retry.'
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-md border bg-muted/40 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Download module images:
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void downloadAll('desktop')}
        >
          {busy === 'all-desktop' ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Monitor className="mr-1 h-3.5 w-3.5" />
          )}
          All · Desktop
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void downloadAll('mobile')}
        >
          {busy === 'all-mobile' ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Smartphone className="mr-1 h-3.5 w-3.5" />
          )}
          All · Mobile
        </Button>
        {moduleMapping?.length ? (
          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={busy !== null}
            title="One ZIP: build instructions, every image at Amazon's exact upload size (numbered in build order), and a full-page preview."
            onClick={() => void downloadExportKit()}
          >
            {busy === 'zip' ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderArchive className="mr-1 h-3.5 w-3.5" />
            )}
            Export Seller Central kit
          </Button>
        ) : null}
        <span className="text-[11px] text-muted-foreground">
          PNGs to upload into each Seller Central module’s image slot.
        </span>
      </div>
      {/* Modules render flush (no gaps) so the page reads as one continuous
          design. The Seller-Central mapping + per-image actions live in a hover
          toolbar so they never break the full-page look. */}
      <div
        className={
          viewport === 'mobile'
            ? 'mx-auto max-w-[430px] overflow-hidden rounded-md border border-neutral-200'
            : 'mx-auto max-w-[970px] overflow-hidden rounded-md border border-neutral-200'
        }
      >
        <div className="flex flex-col">
          {resolved.map((module) => (
            <div key={module.order} className="group relative">
              <FitToWidth
                canvasWidth={
                  viewport === 'mobile'
                    ? APLUS_MOBILE_CANVAS_WIDTH
                    : tier === 'Premium A+'
                    ? APLUS_PREMIUM_CANVAS_WIDTH
                    : APLUS_CANVAS_WIDTH
                }
              >
                <DesignedModule
                  module={module}
                  theme={theme}
                  viewport={viewport}
                />
              </FitToWidth>
              <div className="absolute inset-x-0 top-0 flex flex-wrap items-center gap-1 px-2 py-2 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="rounded bg-white/90 px-2 py-0.5 text-[11px] font-medium text-neutral-700 shadow-sm ring-1 ring-black/5 backdrop-blur">
                  Module {module.order} ·{' '}
                  {sellerCentralModuleName(module.amazonModuleType)}
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-1">
                  {onRegenerate
                    ? moduleImageSlots(module).map((slot, slotIndex, all) => {
                        const jobId = slotJobId(module.order, slot.role);
                        const generating =
                          slotResults?.[jobId]?.status === 'generating';
                        const label =
                          all.length > 1
                            ? `Redo ${slotIndex + 1}`
                            : 'Regenerate';
                        return (
                          <button
                            key={jobId}
                            type="button"
                            disabled={generating}
                            title={`Regenerate image: ${slot.role}`}
                            onClick={() =>
                              onRegenerate(jobId, slot.brief, slot.size)
                            }
                            className="flex items-center gap-1 rounded bg-amber-500/95 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm hover:bg-amber-600 disabled:opacity-50"
                          >
                            {generating ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <WandSparkles className="h-3 w-3" />
                            )}
                            {label}
                          </button>
                        );
                      })
                    : null}
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void download(module, 'desktop', `d-${module.order}`)
                    }
                    className="flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-neutral-700 shadow-sm ring-1 ring-black/5 hover:bg-white disabled:opacity-50"
                  >
                    {busy === `d-${module.order}` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    Desktop
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void download(module, 'mobile', `m-${module.order}`)
                    }
                    className="flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-neutral-700 shadow-sm ring-1 ring-black/5 hover:bg-white disabled:opacity-50"
                  >
                    {busy === `m-${module.order}` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    Mobile
                  </button>
                  {/* Premium NATIVE modules upload raw photos at Amazon's
                      exact dims — per-slot exports leave pre-cropped so the
                      seller never crops by hand. */}
                  {tier === 'Premium A+' &&
                  mappingByOrder.get(module.order)?.kind === 'native'
                    ? (
                        mappingByOrder.get(module.order)?.imageSpecs ?? []
                      ).flatMap((spec) => {
                        const slot = moduleImageSlots(module).find(
                          (candidate) => candidate.role === spec.role
                        );
                        const assetId = assetIdFromSlotUrl(slot?.image?.url);
                        if (!assetId) return [];
                        const links = [
                          {
                            key: `${module.order}-${spec.role}-desktop`,
                            width: spec.width,
                            height: spec.height,
                          },
                          ...(spec.mobileWidth && spec.mobileHeight
                            ? [
                                {
                                  key: `${module.order}-${spec.role}-mobile`,
                                  width: spec.mobileWidth,
                                  height: spec.mobileHeight,
                                },
                              ]
                            : []),
                        ];
                        return links.map((link) => (
                          <a
                            key={link.key}
                            href={`/api/a-plus/asset-export?assetId=${encodeURIComponent(
                              assetId
                            )}&width=${link.width}&height=${link.height}`}
                            title={`Download ${spec.role} at ${link.width}×${link.height} (exact Amazon slot size)`}
                            className="flex items-center gap-1 rounded bg-emerald-600/95 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm hover:bg-emerald-700"
                          >
                            <Download className="h-3 w-3" />
                            {`${spec.role} ${link.width}×${link.height}`}
                          </a>
                        ));
                      })
                    : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
