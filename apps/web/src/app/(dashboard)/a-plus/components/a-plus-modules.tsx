'use client';

import { FileImage, Loader2, WandSparkles } from 'lucide-react';
import {
  applyAPlusGuardrails,
  moduleImageSlots,
  moduleTextFields,
  type APlusGeneratedModule,
  type APlusImageSlot,
} from '@farvisionllc/models';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type SlotImageResult =
  | { status: 'generating' }
  | {
      status: 'done';
      url: string;
      revisedPrompt?: string;
      assetId?: string;
      persistError?: string;
    }
  | { status: 'error'; message: string };

/** Stable job id for an image slot, shared by the renderer and the page. */
export function slotJobId(moduleOrder: number, role: string): string {
  return `img-${moduleOrder}-${role}`;
}

function cleanText(text: string | undefined | null): string {
  if (!text) return '';
  return applyAPlusGuardrails(text).cleaned;
}

function slotUrl(
  slot: APlusImageSlot,
  moduleOrder: number,
  slotResults?: Record<string, SlotImageResult>
): string | undefined {
  if (slot.image?.url) return slot.image.url;
  const result = slotResults?.[slotJobId(moduleOrder, slot.role)];
  return result?.status === 'done' ? result.url : undefined;
}

function SlotImage({
  slot,
  moduleOrder,
  slotResults,
  className,
  aspectClass,
}: {
  slot: APlusImageSlot;
  moduleOrder: number;
  slotResults?: Record<string, SlotImageResult>;
  className?: string;
  aspectClass?: string;
}) {
  const url = slotUrl(slot, moduleOrder, slotResults);
  const pending =
    slotResults?.[slotJobId(moduleOrder, slot.role)]?.status === 'generating';

  if (url) {
    return (
      <img
        src={url}
        alt={slot.alt}
        className={cn('block h-auto w-full bg-neutral-100', className)}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center bg-neutral-100 px-4 text-center text-neutral-500',
        aspectClass ?? 'aspect-[97/45] min-h-[200px]',
        className
      )}
    >
      <FileImage className="h-7 w-7 text-neutral-400" />
      <p className="mt-2 text-xs font-medium text-neutral-600">
        {pending ? 'Generating image' : 'Image pending'}
      </p>
    </div>
  );
}

function Copy({
  headline,
  body,
  bullets,
  className,
}: {
  headline?: string;
  body?: string;
  bullets?: string[];
  className?: string;
}) {
  const cleanHeadline = cleanText(headline);
  const cleanBody = cleanText(body);
  const cleanBullets = (bullets ?? []).map(cleanText).filter(Boolean);
  if (!cleanHeadline && !cleanBody && !cleanBullets.length) return null;

  return (
    <div className={cn('px-6 py-5', className)}>
      {cleanHeadline ? (
        <h3 className="text-[19px] font-bold leading-tight text-neutral-900">
          {cleanHeadline}
        </h3>
      ) : null}
      {cleanBody ? (
        <p className="mt-2 text-[14px] leading-[1.55] text-neutral-700">
          {cleanBody}
        </p>
      ) : null}
      {cleanBullets.length ? (
        <ul className="mt-3 grid gap-1.5 text-[13px] leading-[1.45] text-neutral-700">
          {cleanBullets.map((bullet) => (
            <li key={bullet}>- {bullet}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Buyer-facing HTML/CSS render of a single A+ module. Mirrors the real Amazon
 * module layout: images come from photographic slots, text is live HTML (never
 * baked into pixels). Responsive desktop/mobile reflow is driven by the
 * enclosing @container width, so one render serves both viewports.
 */
export function APlusModuleRenderer({
  module,
  slotResults,
}: {
  module: APlusGeneratedModule;
  slotResults?: Record<string, SlotImageResult>;
}) {
  const order = module.order;

  switch (module.type) {
    case 'company-logo':
      return (
        <section className="flex items-center justify-center bg-white px-6 py-8">
          <div className="max-h-[180px] w-full max-w-[600px]">
            <SlotImage
              slot={module.logo}
              moduleOrder={order}
              slotResults={slotResults}
              className="object-contain"
              aspectClass="aspect-[10/3] min-h-[120px]"
            />
          </div>
        </section>
      );

    case 'image-header-with-text':
      return (
        <section className="bg-white">
          <SlotImage
            slot={module.image}
            moduleOrder={order}
            slotResults={slotResults}
          />
          <Copy headline={module.headline} body={module.body} />
        </section>
      );

    case 'image-text-overlay': {
      const url = slotUrl(module.image, order, slotResults);
      const align =
        module.overlayPosition === 'right'
          ? 'items-end text-right'
          : module.overlayPosition === 'center'
          ? 'items-center text-center'
          : 'items-start text-left';
      if (!url) {
        return (
          <section className="bg-white">
            <SlotImage
              slot={module.image}
              moduleOrder={order}
              slotResults={slotResults}
            />
            <Copy headline={module.headline} body={module.body} />
          </section>
        );
      }
      return (
        <section className="relative bg-white">
          <SlotImage
            slot={module.image}
            moduleOrder={order}
            slotResults={slotResults}
          />
          <div
            className={cn(
              'absolute inset-0 flex flex-col justify-center p-6',
              align
            )}
          >
            <div className="max-w-[60%] rounded-md bg-white/85 px-4 py-3 backdrop-blur-sm">
              {cleanText(module.headline) ? (
                <h3 className="text-[18px] font-bold leading-tight text-neutral-900">
                  {cleanText(module.headline)}
                </h3>
              ) : null}
              {cleanText(module.body) ? (
                <p className="mt-1 text-[13px] leading-snug text-neutral-700">
                  {cleanText(module.body)}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      );
    }

    case 'single-image-text':
      return (
        <section className="bg-white">
          <SlotImage
            slot={module.image}
            moduleOrder={order}
            slotResults={slotResults}
          />
          <Copy
            headline={module.headline}
            body={module.body}
            bullets={module.bullets}
          />
        </section>
      );

    case 'image-and-text': {
      const imageFirst = module.imagePosition !== 'right';
      const image = (
        <div className="w-full @[640px]:w-1/2">
          <SlotImage
            slot={module.image}
            moduleOrder={order}
            slotResults={slotResults}
            aspectClass="aspect-[4/3] min-h-[200px]"
          />
        </div>
      );
      const text = (
        <div className="w-full @[640px]:w-1/2">
          <Copy
            headline={module.headline}
            body={module.body}
            bullets={module.bullets}
          />
        </div>
      );
      return (
        <section className="flex flex-col items-stretch bg-white @[640px]:flex-row">
          {imageFirst ? (
            <>
              {image}
              {text}
            </>
          ) : (
            <>
              {text}
              {image}
            </>
          )}
        </section>
      );
    }

    case 'three-image-text':
      return (
        <section className="grid grid-cols-1 gap-px bg-neutral-200 @[640px]:grid-cols-3">
          {module.columns.map((column, index) => (
            <div key={index} className="bg-white">
              <SlotImage
                slot={column.image}
                moduleOrder={order}
                slotResults={slotResults}
                aspectClass="aspect-square min-h-[160px]"
              />
              <Copy
                headline={column.headline}
                body={column.body}
                className="px-4 py-4"
              />
            </div>
          ))}
        </section>
      );

    case 'four-image-text-quadrant':
      return (
        <section className="grid grid-cols-1 gap-px bg-neutral-200 @[640px]:grid-cols-2">
          {module.quadrants.map((quadrant, index) => (
            <div key={index} className="bg-white">
              <SlotImage
                slot={quadrant.image}
                moduleOrder={order}
                slotResults={slotResults}
                aspectClass="aspect-square min-h-[160px]"
              />
              <Copy
                headline={quadrant.headline}
                body={quadrant.body}
                className="px-4 py-4"
              />
            </div>
          ))}
        </section>
      );

    case 'comparison-table': {
      const hasThumbs = module.products.some((product) => product.image);
      return (
        <section className="bg-white px-4 py-5">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="border border-neutral-200 bg-neutral-50 p-2 text-left" />
                  {module.products.map((product, index) => (
                    <th
                      key={index}
                      className={cn(
                        'border border-neutral-200 p-2 text-center align-top font-semibold',
                        product.highlight
                          ? 'bg-amber-50 text-neutral-900'
                          : 'bg-neutral-50 text-neutral-700'
                      )}
                    >
                      {product.image ? (
                        <div className="mx-auto mb-2 w-20">
                          <SlotImage
                            slot={product.image}
                            moduleOrder={order}
                            slotResults={slotResults}
                            aspectClass="aspect-square min-h-[64px]"
                          />
                        </div>
                      ) : hasThumbs ? (
                        <div className="mx-auto mb-2 h-16 w-20" />
                      ) : null}
                      {cleanText(product.title)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {module.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td className="border border-neutral-200 bg-neutral-50 p-2 font-medium text-neutral-700">
                      {row.label}
                    </td>
                    {module.products.map((product, colIndex) => (
                      <td
                        key={colIndex}
                        className={cn(
                          'border border-neutral-200 p-2 text-center align-top text-neutral-700',
                          product.highlight ? 'bg-amber-50/60' : ''
                        )}
                      >
                        {cleanText(row.values[colIndex] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    }

    case 'tech-specs':
      return (
        <section className="bg-white px-6 py-5">
          {cleanText(module.headline) ? (
            <h3 className="mb-3 text-[18px] font-bold text-neutral-900">
              {cleanText(module.headline)}
            </h3>
          ) : null}
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {module.rows.map((row, index) => (
                <tr key={index} className="border-b border-neutral-200">
                  <td className="w-1/3 py-2 pr-4 font-medium text-neutral-700">
                    {row.label}
                  </td>
                  <td className="py-2 text-neutral-700">
                    {cleanText(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      );

    case 'text-only':
      return (
        <section className="bg-white">
          <Copy
            headline={module.headline}
            body={module.body}
            bullets={module.bullets}
          />
        </section>
      );

    default:
      return null;
  }
}

/** A vertical stack of rendered modules inside a viewport frame. */
export function APlusPagePreview({
  modules,
  viewport,
  slotResults,
}: {
  modules: APlusGeneratedModule[];
  viewport: 'desktop' | 'mobile';
  slotResults?: Record<string, SlotImageResult>;
}) {
  const isMobile = viewport === 'mobile';
  return (
    <div className="@container rounded-md border bg-muted/40 p-3">
      <div
        className={cn(
          'mx-auto overflow-hidden rounded-md border border-neutral-200 bg-neutral-100',
          isMobile ? 'max-w-[430px]' : 'max-w-[970px]'
        )}
      >
        <div className="flex flex-col gap-[7px]">
          {modules.map((module) => (
            <APlusModuleRenderer
              key={`${module.order}-${viewport}`}
              module={module}
              slotResults={slotResults}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function downloadNameFor(moduleOrder: number, role: string): string {
  return (
    `module-${moduleOrder}-${role}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) + '.png'
  );
}

/**
 * Editor-side production details for one module: the editable text fields that
 * map to Seller Central text boxes, and the per-slot image briefs with generate
 * / download controls. Replaces the old composite-mockup + canva-layers panels.
 */
export function APlusModuleProductionDetails({
  module,
  slotResults,
  onGenerate,
}: {
  module: APlusGeneratedModule;
  slotResults?: Record<string, SlotImageResult>;
  onGenerate: (jobId: string, brief: string, size: string) => void;
}) {
  const textFields = moduleTextFields(module);
  const slots = moduleImageSlots(module);

  return (
    <div className="space-y-4">
      {textFields.length ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Seller Central text fields</p>
          <div className="grid gap-2 md:grid-cols-2">
            {textFields.map((field, index) => (
              <div
                key={`${field.label}-${index}`}
                className="rounded-md border bg-muted/20 p-3 text-sm"
              >
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  {field.label}
                </p>
                <p className="mt-1 text-neutral-700">
                  {cleanText(field.value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {slots.length ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Image slots</p>
          {slots.map((slot) => {
            const jobId = slotJobId(module.order, slot.role);
            const result = slotResults?.[jobId];
            const downloadName = downloadNameFor(module.order, slot.role);
            return (
              <div
                key={jobId}
                className="rounded-md border bg-muted/20 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{slot.size}</Badge>
                    <p className="font-medium">{slot.role}</p>
                  </div>
                  <div className="flex items-center gap-2">
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
                      disabled={result?.status === 'generating'}
                      onClick={() => onGenerate(jobId, slot.brief, slot.size)}
                    >
                      {result?.status === 'generating' ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          Generating
                        </>
                      ) : result?.status === 'done' ? (
                        <>
                          <WandSparkles className="mr-2 h-3.5 w-3.5" />
                          Regenerate
                        </>
                      ) : (
                        <>
                          <WandSparkles className="mr-2 h-3.5 w-3.5" />
                          Generate
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{slot.alt}</p>
                <p className="mt-2 leading-6 text-muted-foreground">
                  {slot.brief}
                </p>
                {result?.status === 'done' ? (
                  <div className="mt-3 overflow-hidden rounded-md border bg-background">
                    <img
                      src={result.url}
                      alt={slot.alt}
                      className="block max-h-72 w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                ) : null}
                {result?.status === 'error' ? (
                  <p className="mt-3 text-xs text-destructive">
                    {result.message}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This module has no image slots — it is text/table only.
        </p>
      )}
    </div>
  );
}
