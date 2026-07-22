import {
  applyAPlusGuardrails,
  moduleImageSlotEntries,
  moduleTextFieldDescriptors,
  moduleTextFields,
  sellerCentralModuleName,
  type APlusGeneratedModule,
  type AplusTier,
  type ModuleMappingEntry,
} from '@farvisionllc/models';

// ---------------------------------------------------------------------------
// Seller Central export kit — the PURE half (no I/O): zip entry naming and the
// instructions document. The export-zip route turns entry specs into bytes and
// feeds the finalized file list back into the instructions builder. Filenames
// zero-pad the module order so a lexical sort IS the build order.
// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item'
  );
}

/** Download base name for the kit, from the draft title. */
export function exportBaseName(title?: string): string {
  const slug = title ? slugify(title).slice(0, 40).replace(/-+$/, '') : '';
  return slug ? `${slug}-seller-central-kit` : 'seller-central-kit';
}

/** `03` — zero-padded module order so filenames sort in build order. */
function pad(order: number): string {
  return String(Math.max(0, Math.trunc(order))).padStart(2, '0');
}

export type ZipEntrySource =
  | {
      kind: 'crop';
      /** The slot's resolved image URL (asset route or data URL); absent = missing. */
      slotUrl?: string;
      alt: string;
      width: number;
      height: number;
    }
  | { kind: 'render'; viewport: 'desktop' | 'mobile'; alt: string }
  | {
      kind: 'slice';
      viewport: 'desktop' | 'mobile';
      /** 1-based slice number within the stack. */
      index: number;
      offsetY: number;
      sliceHeight: number;
      totalHeight: number;
      alt: string;
    };

/**
 * Alt text for a DESIGNED image (band/panel/slice): the whole module is baked
 * into pixels, so the alt summarizes what the module says — title plus the
 * first rendered copy fragments, kept short.
 */
export function designedImageAlt(module: APlusGeneratedModule): string {
  const fragments = moduleTextFields(module)
    .slice(0, 3)
    .map((field) => field.value.trim())
    .filter(Boolean);
  const text = [module.title.trim(), ...fragments].filter(Boolean).join(' - ');
  const safe = sellerCentralSafeText(applyAPlusGuardrails(text).cleaned);
  if (safe.length <= 100) return safe;
  const cut = safe.slice(0, 100);
  return (cut.includes(' ') ? cut.slice(0, cut.lastIndexOf(' ')) : cut).replace(
    /[.,;:\s-]+$/,
    ''
  );
}

export type ZipEntrySpec = {
  /** Filename minus the trailing `-WxH.ext` (dims appended once known). */
  baseName: string;
  ext: 'jpg' | 'png';
  moduleOrder: number;
  /** Human slot description for the instructions upload table. */
  slot: string;
  source: ZipEntrySource;
};

/** Final on-disk name once dimensions are known. */
export function entryFileName(
  spec: Pick<ZipEntrySpec, 'baseName' | 'ext'>,
  width: number,
  height: number
): string {
  return `${spec.baseName}-${width}x${height}.${spec.ext}`;
}

function moduleByOrder(
  modules: APlusGeneratedModule[],
  order: number
): APlusGeneratedModule | undefined {
  return modules.find((module) => module.order === order);
}

/**
 * Every image file the kit should contain, in build order. Photos (native
 * crops) are JPG; designed renders/slices are PNG. Missing slot images stay in
 * the plan (source.slotUrl undefined) so the instructions can flag them.
 * Duplicate names get deterministic -2/-3 suffixes.
 */
export function zipEntryPlan(
  modules: APlusGeneratedModule[],
  moduleMapping: ModuleMappingEntry[],
  tier: AplusTier
): ZipEntrySpec[] {
  const premium = tier === 'Premium A+';
  const entries: ZipEntrySpec[] = [];
  const used = new Map<string, number>();
  const uniqueBase = (base: string): string => {
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };

  const ordered = [...moduleMapping].sort((a, b) => a.order - b.order);
  for (const entry of ordered) {
    const module = moduleByOrder(modules, entry.order);
    if (!module) continue;
    const sc = slugify(sellerCentralModuleName(entry.amazonModuleType));
    const nn = pad(entry.order);

    if (entry.kind === 'native') {
      // Native modules upload RAW photos at exact slot dims (Premium only —
      // Basic natives carry no imageSpecs and export no files).
      for (const spec of entry.imageSpecs ?? []) {
        const slot = moduleImageSlotEntries(module).find(
          (candidate) => candidate.slot.role === spec.role
        )?.slot;
        const base = uniqueBase(`${nn}-${sc}-${slugify(spec.role)}`);
        const crop = {
          kind: 'crop' as const,
          slotUrl: slot?.image?.url,
          alt: slot?.image?.alt ?? slot?.alt ?? spec.role,
        };
        entries.push({
          baseName: base,
          ext: 'jpg',
          moduleOrder: entry.order,
          slot: spec.role,
          source: { ...crop, width: spec.width, height: spec.height },
        });
        if (spec.mobileWidth && spec.mobileHeight) {
          entries.push({
            baseName: `${base}-mobile`,
            ext: 'jpg',
            moduleOrder: entry.order,
            slot: `${spec.role} (mobile)`,
            source: {
              ...crop,
              width: spec.mobileWidth,
              height: spec.mobileHeight,
            },
          });
        }
      }
      continue;
    }

    if (entry.kind === 'image-slice-stack' && entry.slices?.length) {
      const totalHeight = entry.slices.reduce(
        (sum, slice) => sum + slice.height,
        0
      );
      const stackAlt = designedImageAlt(module);
      for (const slice of entry.slices) {
        const k = slice.index + 1;
        for (const viewport of ['desktop', 'mobile'] as const) {
          const base = uniqueBase(
            `${nn}-${sc}-slice-${k}${viewport === 'mobile' ? '-mobile' : ''}`
          );
          entries.push({
            baseName: base,
            ext: 'png',
            moduleOrder: entry.order,
            slot: `slice ${k} of ${entry.slices.length}${
              viewport === 'mobile' ? ' (mobile)' : ''
            }`,
            source: {
              kind: 'slice',
              viewport,
              index: k,
              offsetY: slice.offsetY,
              sliceHeight: slice.height,
              totalHeight,
              alt: `${stackAlt}, part ${k} of ${entry.slices.length}`,
            },
          });
        }
      }
      continue;
    }

    // designed-image: the module ships as one finished band/panel per viewport
    // (premium = fixed 1464×600 / 600×450 frames; Basic = content height).
    const part = premium ? 'band' : 'module';
    const renderAlt = designedImageAlt(module);
    for (const viewport of ['desktop', 'mobile'] as const) {
      const base = uniqueBase(
        `${nn}-${sc}-${part}${viewport === 'mobile' ? '-mobile' : ''}`
      );
      entries.push({
        baseName: base,
        ext: 'png',
        moduleOrder: entry.order,
        slot: viewport === 'mobile' ? 'mobile image' : 'desktop image',
        source: { kind: 'render', viewport, alt: renderAlt },
      });
    }
  }

  return entries;
}

// ------------------------------ Instructions ---------------------------------

export type InstructionUpload = {
  fileName: string;
  slot: string;
  dims: string;
  alt?: string;
};

export type InstructionStep = {
  order: number;
  moduleName: string;
  assembly: ModuleMappingEntry['kind'];
  /** Assembly guidance specific to the module kind. */
  note?: string;
  uploads: InstructionUpload[];
  missingImages: string[];
  /** Copy problems the seller must resolve (over-limit, unfolded bullets). */
  warnings?: string[];
  textFields: Array<{ label: string; value: string; limit?: number }>;
  hotspots?: Array<{
    index: number;
    xPercent: number;
    yPercent: number;
    label: string;
    copy: string;
  }>;
};

export type InstructionsModel = {
  title?: string;
  tier: AplusTier;
  asins: string[];
  steps: InstructionStep[];
  warnings: string[];
};

/** A finalized zip file the route actually wrote, mapped back to its module. */
export type FinalizedKitFile = {
  fileName: string;
  moduleOrder: number;
  slot: string;
  width: number;
  height: number;
  alt?: string;
};

/**
 * Seller Central's field validation rejects typographic characters (em dashes
 * confirmed 2026-07; smart quotes/ellipses are the same class) — every value
 * destined for a native field is normalized to plain-ASCII punctuation.
 * Designed images are unaffected and keep real typography.
 */
export function sellerCentralSafeText(value: string): string {
  return value
    .replace(/[—–―]/g, '-')
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/…/g, '...')
    .replace(/\u00a0/g, ' ');
}

const clean = (value: string): string =>
  sellerCentralSafeText(applyAPlusGuardrails(value).cleaned);

/**
 * Native modules whose ONLY long-form field is a single body text (no bullet
 * fields exist in Seller Central — VERIFY) — bullet copy is folded into the
 * body block so no copy is silently lost.
 */
const FOLD_BULLETS_INTO_BODY = new Set([
  'PREMIUM_SINGLE_IMAGE_TEXT',
  'PREMIUM_BACKGROUND_IMAGE_TEXT',
  'PREMIUM_TEXT',
  'STANDARD_PRODUCT_DESCRIPTION',
  'STANDARD_TEXT',
]);

/**
 * Fields that exist only in OUR model, never as typed Seller Central fields
 * (badges are baked into designed renders). The module title is ALSO internal
 * — except where a native module offers a matching short field (see
 * MODULE_TITLE_TARGET).
 */
const INTERNAL_ONLY_LABELS = new Set(['Badge']);

/**
 * Native homes for our internal Module title, confirmed per module in Seller
 * Central. Premium Single Image with Text has a 40-char Subheadline
 * (confirmed 2026-07); modules without an entry drop the title.
 */
const MODULE_TITLE_TARGET: Record<string, { label: string; limit: number }> = {
  PREMIUM_SINGLE_IMAGE_TEXT: { label: 'Subheadline', limit: 40 },
  // Confirmed via live renders 2026-07: background modules show a short bold
  // line above the headline (VERIFY exact limit; 40 consistent with observed).
  PREMIUM_BACKGROUND_IMAGE_TEXT: { label: 'Subheadline', limit: 40 },
};

/**
 * Amazon's NATIVE per-field character limits for single-text modules — these
 * override our looser internal limits in the instructions, and cap bullet
 * folding. Single-image body=500 confirmed in Seller Central (2026-07);
 * others VERIFY.
 */
const NATIVE_TEXT_LIMITS: Record<string, { headline?: number; body?: number }> =
  {
    PREMIUM_SINGLE_IMAGE_TEXT: { headline: 160, body: 500 },
    PREMIUM_BACKGROUND_IMAGE_TEXT: { headline: 60, body: 300 },
    PREMIUM_TEXT: { headline: 160, body: 5000 },
    STANDARD_PRODUCT_DESCRIPTION: { headline: 160, body: 6000 },
    STANDARD_TEXT: { headline: 160, body: 5000 },
  };

/**
 * The instructions document data — built AFTER the route finalizes file names
 * (content-height renders only know their dims post-render). Pure: fabricate
 * `files`/`missing` in tests.
 */
export function buildInstructionsModel(options: {
  modules: APlusGeneratedModule[];
  moduleMapping: ModuleMappingEntry[];
  tier: AplusTier;
  title?: string;
  asins?: string[];
  files: FinalizedKitFile[];
  /** slot descriptions per module order that had no exportable image. */
  missing?: Array<{ moduleOrder: number; slot: string }>;
  warnings?: string[];
}): InstructionsModel {
  const steps: InstructionStep[] = [];
  const ordered = [...options.moduleMapping].sort((a, b) => a.order - b.order);

  for (const entry of ordered) {
    const module = moduleByOrder(options.modules, entry.order);
    if (!module) continue;

    const uploads: InstructionUpload[] = options.files
      .filter((file) => file.moduleOrder === entry.order)
      .map((file) => ({
        fileName: file.fileName,
        slot: file.slot,
        dims: `${file.width} × ${file.height}px`,
        alt: file.alt ? clean(file.alt) : undefined,
      }));
    const missingImages = (options.missing ?? [])
      .filter((item) => item.moduleOrder === entry.order)
      .map((item) => item.slot);

    // Native modules: the seller TYPES this copy into Amazon's fields — so
    // list ONLY fields the Seller Central module actually has, with AMAZON'S
    // character limits. Internal-only fields are dropped; bullets fold into
    // the body where the native module has a single text block, but only as
    // many as FIT the native limit — leftovers become explicit warnings, never
    // silently truncated copy.
    let bulletsFolded = false;
    const stepWarnings: string[] = [];
    let textFields: InstructionStep['textFields'] = [];
    if (entry.kind === 'native') {
      const nativeLimits = NATIVE_TEXT_LIMITS[entry.amazonModuleType];
      const titleTarget = MODULE_TITLE_TARGET[entry.amazonModuleType];
      textFields = moduleTextFieldDescriptors(module)
        .filter(
          (descriptor) =>
            descriptor.value.trim() &&
            // Alt text rides on the upload rows, not the copy table.
            !descriptor.label.toLowerCase().includes('alt') &&
            !INTERNAL_ONLY_LABELS.has(descriptor.label) &&
            // Module title is internal unless this module has a native home.
            (descriptor.label !== 'Module title' || titleTarget)
        )
        .map((descriptor) =>
          descriptor.label === 'Module title' && titleTarget
            ? {
                label: titleTarget.label,
                value: clean(descriptor.value),
                limit: titleTarget.limit,
              }
            : {
                label: descriptor.label,
                value: clean(descriptor.value),
                limit:
                  descriptor.label === 'Headline' && nativeLimits?.headline
                    ? nativeLimits.headline
                    : descriptor.label === 'Body' && nativeLimits?.body
                    ? nativeLimits.body
                    : descriptor.maxLength,
              }
        );
      if (FOLD_BULLETS_INTO_BODY.has(entry.amazonModuleType)) {
        const bullets = textFields.filter((field) =>
          /^Bullet \d+$/.test(field.label)
        );
        if (bullets.length) {
          bulletsFolded = true;
          textFields = textFields.filter(
            (field) => !/^Bullet \d+$/.test(field.label)
          );
          let body = textFields.find((field) => field.label === 'Body');
          if (!body) {
            body = { label: 'Body', value: '', limit: nativeLimits?.body };
            textFields.push(body);
          }
          const bodyMax = body.limit ?? Number.POSITIVE_INFINITY;
          const leftovers: string[] = [];
          for (const bullet of bullets) {
            const candidate = body.value
              ? `${body.value}\n• ${bullet.value}`
              : `• ${bullet.value}`;
            if (candidate.length <= bodyMax) body.value = candidate;
            else leftovers.push(bullet.value);
          }
          if (leftovers.length) {
            stepWarnings.push(
              `${leftovers.length} highlight${
                leftovers.length === 1 ? '' : 's'
              } did not fit Amazon's ${bodyMax}-character text limit and are NOT in the body block — shorten the body to make room, or drop them: ${leftovers.join(
                ' · '
              )}`
            );
          }
        }
      }
      for (const field of textFields) {
        if (field.limit && field.value.length > field.limit) {
          stepWarnings.push(
            `“${field.label}” is ${
              field.value.length
            } characters — over Amazon's ${field.limit}-character limit by ${
              field.value.length - field.limit
            }. Shorten it before pasting or Seller Central will truncate it.`
          );
        }
      }
    }

    const hotspots =
      module.type === 'hotspots'
        ? module.hotspots.map((spot, index) => ({
            index: index + 1,
            xPercent: Math.round(spot.position.x * 100),
            yPercent: Math.round(spot.position.y * 100),
            label: clean(spot.label),
            copy: clean(spot.copy),
          }))
        : undefined;

    let note =
      entry.kind === 'designed-image'
        ? 'Add ONE module and upload BOTH files into it: the desktop file into the main image slot, the -mobile file into the module’s mobile image slot (do NOT add a second module for the mobile file). Leave Headline and every other text field EMPTY on purpose — all copy is baked into the image and typing it again would show twice on the live page. Do paste the alt text into each image’s keyword/alt field.'
        : entry.kind === 'image-slice-stack'
        ? `Add ${
            entry.slices?.length ?? 0
          } consecutive “${sellerCentralModuleName(
            entry.amazonModuleType
          )}” modules and upload the slices in order with no spacing between them — together they form one tall scene.`
        : module.type === 'carousel'
        ? 'Add the slides in the numbered order — each slide takes one image plus its headline/caption below.'
        : module.type === 'hotspots'
        ? 'Upload the base image, then drag each numbered marker to the position in the table below (percentages are measured from the image’s top-left corner — match the preview image).'
        : undefined;
    if (bulletsFolded) {
      note = [
        note,
        'This module has no separate bullet fields — the highlight bullets are folded into the body text below.',
      ]
        .filter(Boolean)
        .join(' ');
    }
    const badge =
      entry.kind === 'native' && 'badge' in module
        ? module.badge?.trim()
        : undefined;
    if (badge) {
      note = [
        note,
        `The spec badge ("${sellerCentralSafeText(
          badge
        )}") is already stamped on the uploaded image's top-right corner — nothing to type for it.`,
      ]
        .filter(Boolean)
        .join(' ');
    }

    steps.push({
      order: entry.order,
      moduleName: sellerCentralModuleName(entry.amazonModuleType),
      assembly: entry.kind,
      note,
      uploads,
      missingImages,
      warnings: stepWarnings.length ? stepWarnings : undefined,
      textFields,
      hotspots,
    });
  }

  return {
    title: options.title,
    tier: options.tier,
    asins: options.asins ?? [],
    steps,
    warnings: options.warnings ?? [],
  };
}

// ------------------------------- HTML output ---------------------------------

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Self-contained instructions page (no external assets — opens from the
 * unzipped folder). Deliberately plain, print-friendly HTML.
 */
export function instructionsHtml(model: InstructionsModel): string {
  const stepCount = model.steps.length;
  const parts: string[] = [];

  parts.push(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(
    model.title || 'A+ content'
  )} — Seller Central build instructions</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c1917; margin: 40px auto; max-width: 860px; padding: 0 20px; line-height: 1.55; }
  h1 { font-size: 26px; margin-bottom: 4px; }
  h2 { font-size: 19px; margin: 36px 0 6px; padding-top: 16px; border-top: 1px solid #e7e5e4; }
  .meta { color: #57534e; font-size: 14px; }
  .note { background: #f5f5f4; border-left: 3px solid #a8a29e; padding: 8px 12px; font-size: 14px; margin: 10px 0; }
  .warn { background: #fef3c7; border-left: 3px solid #d97706; padding: 8px 12px; font-size: 14px; margin: 10px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 14px; }
  th, td { border: 1px solid #e7e5e4; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #fafaf9; font-weight: 600; }
  code, .copy { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
  .copy { display: block; background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 4px; padding: 8px 10px; white-space: pre-wrap; }
  .limit { color: #78716c; font-size: 12px; }
  ol.checklist { padding-left: 20px; }
</style>
</head>
<body>
<h1>${esc(model.title || 'A+ content')} — build instructions</h1>
<p class="meta">${esc(model.tier)} · ${stepCount} module${
    stepCount === 1 ? '' : 's'
  }${
    model.asins.length
      ? ` · ASIN${model.asins.length === 1 ? '' : 's'}: ${esc(
          model.asins.join(', ')
        )}`
      : ''
  }</p>
<div class="note">
  <strong>How to use this kit:</strong>
  <ol class="checklist">
    <li>Open Seller Central → Advertising → <strong>A+ Content Manager</strong> → Start creating A+ content → choose <strong>${esc(
      model.tier === 'Premium A+' ? 'Premium A+' : 'Basic A+'
    )}</strong>.</li>
    <li><code>00-full-page-preview.png</code> shows the finished page in OUR art direction — use it for content and order. Modules where you TYPE copy render in <strong>Amazon's own fonts and layout</strong> on the live page, so those will look styled-by-Amazon, not exactly like the preview. That's correct and expected.</li>
    <li>Image files are numbered in usage order: work top to bottom, ONE Seller Central module per step below (a desktop + -mobile file pair always goes into the SAME module).</li>
    <li>Copy each text block exactly as written — the copy already passes Amazon's content rules.</li>
  </ol>
</div>`);

  for (const warning of model.warnings) {
    parts.push(`<div class="warn">⚠ ${esc(warning)}</div>`);
  }

  for (const step of model.steps) {
    parts.push(
      `<h2>Step ${step.order} of ${stepCount} — add module: ${esc(
        step.moduleName
      )}</h2>`
    );
    if (step.note) parts.push(`<div class="note">${esc(step.note)}</div>`);
    for (const warning of step.warnings ?? []) {
      parts.push(`<div class="warn">⚠ ${esc(warning)}</div>`);
    }
    for (const slot of step.missingImages) {
      parts.push(
        `<div class="warn">⚠ Image “${esc(
          slot
        )}” is missing — generate or pin it in the editor, then re-export this kit.</div>`
      );
    }
    if (step.uploads.length) {
      parts.push(
        `<table><tr><th>Upload file</th><th>Into slot</th><th>Size</th><th>Alt text to paste</th></tr>${step.uploads
          .map(
            (upload) =>
              `<tr><td><code>${esc(upload.fileName)}</code></td><td>${esc(
                upload.slot
              )}</td><td>${esc(upload.dims)}</td><td>${
                upload.alt ? esc(upload.alt) : '—'
              }</td></tr>`
          )
          .join('')}</table>`
      );
    }
    if (step.textFields.length) {
      parts.push(
        step.textFields
          .map(
            (field) =>
              `<p><strong>${esc(field.label)}</strong>${
                field.limit
                  ? ` <span class="limit">(max ${field.limit} characters)</span>`
                  : ''
              }<span class="copy">${esc(field.value)}</span></p>`
          )
          .join('')
      );
    }
    if (step.hotspots?.length) {
      parts.push(
        `<table><tr><th>Marker</th><th>Position</th><th>Label</th><th>Text</th></tr>${step.hotspots
          .map(
            (spot) =>
              `<tr><td>${spot.index}</td><td>${spot.xPercent}% from left, ${
                spot.yPercent
              }% from top</td><td>${esc(spot.label)}</td><td>${esc(
                spot.copy
              )}</td></tr>`
          )
          .join('')}</table>`
      );
    }
  }

  parts.push(`<h2>Finish</h2>
<ol class="checklist">
  <li>Review the page against <code>00-full-page-preview.png</code>.</li>
  <li>Apply the content to your ASIN${model.asins.length === 1 ? '' : 's'}${
    model.asins.length
      ? `: <code>${esc(model.asins.join('</code>, <code>'))}</code>`
      : ''
  }.</li>
  <li>Submit for approval — Amazon review typically takes up to 7 business days.</li>
</ol>
</body>
</html>`);

  return parts.join('\n');
}
