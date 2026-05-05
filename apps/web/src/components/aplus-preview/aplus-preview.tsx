import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { APlusDocument, APlusModule } from './types';

function APlusImg({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      // @ts-expect-error fetchpriority is a valid HTML attribute
      fetchpriority="low"
      className={cn('h-auto w-full bg-neutral-100 object-cover', className)}
    />
  );
}

function ModuleHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[19px] font-bold leading-tight text-neutral-900">
      {children}
    </h3>
  );
}

function ModuleBody({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[14px] leading-[1.55] text-neutral-700">{children}</p>
  );
}

function CompanyLogoModule({
  module,
}: {
  module: Extract<APlusModule, { type: 'company-logo' }>;
}) {
  return (
    <div className="flex items-center justify-center bg-white px-6 py-5">
      <img
        src={module.logo.url}
        alt={module.logo.alt}
        loading="lazy"
        decoding="async"
        className="h-14 w-auto"
      />
    </div>
  );
}

function ImageHeaderWithTextModule({
  module,
}: {
  module: Extract<APlusModule, { type: 'image-header-with-text' }>;
}) {
  return (
    <div className="bg-white">
      <APlusImg
        src={module.image.url}
        alt={module.image.alt}
        className="aspect-[97/60] w-full"
      />
      {(module.headline || module.body) && (
        <div className="px-6 py-5">
          {module.headline && <ModuleHeading>{module.headline}</ModuleHeading>}
          {module.body && <ModuleBody>{module.body}</ModuleBody>}
        </div>
      )}
    </div>
  );
}

function ImageTextOverlayModule({
  module,
}: {
  module: Extract<APlusModule, { type: 'image-text-overlay' }>;
}) {
  const align =
    module.overlayPosition === 'right'
      ? 'items-end text-right'
      : module.overlayPosition === 'center'
      ? 'items-center text-center'
      : 'items-start text-left';
  return (
    <div className="relative bg-black">
      <APlusImg
        src={module.image.url}
        alt={module.image.alt}
        className="aspect-[97/40] w-full opacity-80"
      />
      <div
        className={cn(
          'absolute inset-0 flex flex-col justify-center gap-2 px-10',
          align
        )}
      >
        {module.headline && (
          <h3 className="max-w-md text-2xl font-bold text-white drop-shadow">
            {module.headline}
          </h3>
        )}
        {module.body && (
          <p className="max-w-md text-sm text-white/90 drop-shadow">
            {module.body}
          </p>
        )}
      </div>
    </div>
  );
}

function ImageAndTextModule({
  module,
}: {
  module: Extract<APlusModule, { type: 'image-and-text' }>;
}) {
  const flex =
    module.imagePosition === 'left' ? '@2xl:flex-row' : '@2xl:flex-row-reverse';
  return (
    <div className={cn('flex flex-col gap-6 bg-white p-6', flex)}>
      <div className="@2xl:w-[300px] @2xl:shrink-0">
        <APlusImg
          src={module.image.url}
          alt={module.image.alt}
          className="aspect-square"
        />
      </div>
      <div className="min-w-0 flex-1">
        {module.headline && <ModuleHeading>{module.headline}</ModuleHeading>}
        {module.body && <ModuleBody>{module.body}</ModuleBody>}
      </div>
    </div>
  );
}

function FourImageQuadrantModule({
  module,
}: {
  module: Extract<APlusModule, { type: 'four-image-text-quadrant' }>;
}) {
  return (
    <div className="grid grid-cols-1 gap-px bg-neutral-200 @2xl:grid-cols-2">
      {module.quadrants.map((q, i) => (
        <div key={i} className="flex flex-col bg-white p-5">
          <APlusImg
            src={q.image.url}
            alt={q.image.alt}
            className="mb-3 aspect-[485/300]"
          />
          {q.headline && (
            <h4 className="mb-1 text-[15px] font-bold text-neutral-900">
              {q.headline}
            </h4>
          )}
          {q.body && (
            <p className="text-[13px] leading-[1.5] text-neutral-700">
              {q.body}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function ComparisonTableModule({
  module,
}: {
  module: Extract<APlusModule, { type: 'comparison-table' }>;
}) {
  return (
    <div className="overflow-x-auto bg-white p-6">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="w-32 border-b border-neutral-200 p-2 text-left font-normal text-neutral-500" />
            {module.products.map((p, i) => (
              <th
                key={i}
                className={cn(
                  'border-b border-neutral-200 p-2 text-center align-bottom',
                  p.highlight && 'bg-amber-50'
                )}
              >
                {p.image && (
                  <img
                    src={p.image.url}
                    alt={p.image.alt}
                    loading="lazy"
                    decoding="async"
                    className="mx-auto mb-2 h-20 w-20 object-contain"
                  />
                )}
                <div
                  className={cn(
                    'text-[13px] leading-tight',
                    p.highlight
                      ? 'font-bold text-neutral-900'
                      : 'text-neutral-700'
                  )}
                >
                  {p.title}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {module.rows.map((row, i) => (
            <tr key={i} className="even:bg-neutral-50">
              <td className="p-2 text-left font-medium text-neutral-600">
                {row.label}
              </td>
              {row.values.map((v, j) => (
                <td
                  key={j}
                  className={cn(
                    'p-2 text-center text-neutral-700',
                    module.products[j]?.highlight && 'bg-amber-50 font-medium'
                  )}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModuleRenderer({ module }: { module: APlusModule }) {
  switch (module.type) {
    case 'company-logo':
      return <CompanyLogoModule module={module} />;
    case 'image-header-with-text':
      return <ImageHeaderWithTextModule module={module} />;
    case 'image-text-overlay':
      return <ImageTextOverlayModule module={module} />;
    case 'image-and-text':
      return <ImageAndTextModule module={module} />;
    case 'four-image-text-quadrant':
      return <FourImageQuadrantModule module={module} />;
    case 'comparison-table':
      return <ComparisonTableModule module={module} />;
  }
}

export function APlusPreview({ doc }: { doc: APlusDocument }) {
  return (
    <div className="@container w-full">
      <div className="mb-3 flex flex-col gap-1 rounded-t-md border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-600 @xl:flex-row @xl:items-center @xl:justify-between @xl:gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 font-medium uppercase tracking-wide">
            Preview
          </span>
          <span className="truncate">{doc.productTitle}</span>
          {doc.asin && (
            <span className="hidden shrink-0 text-neutral-400 @md:inline">
              · {doc.asin}
            </span>
          )}
        </div>
        {doc.guardrailsApplied && doc.guardrailsApplied.length > 0 && (
          <details className="group shrink-0 cursor-pointer">
            <summary className="flex items-center gap-1 text-emerald-700 marker:hidden [&::-webkit-details-marker]:hidden">
              <ShieldCheck className="h-3.5 w-3.5" />
              {doc.guardrailsApplied.length} guardrail
              {doc.guardrailsApplied.length === 1 ? '' : 's'} applied
            </summary>
            <ul className="mt-1 list-disc pl-5 text-[11px] text-neutral-600">
              {doc.guardrailsApplied.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="mx-auto max-w-[970px] overflow-hidden rounded-md border border-neutral-200 bg-neutral-100">
        <div className="flex flex-col gap-[7px]">
          {doc.modules.map((m, i) => (
            <ModuleRenderer key={i} module={m} />
          ))}
        </div>
      </div>
    </div>
  );
}
