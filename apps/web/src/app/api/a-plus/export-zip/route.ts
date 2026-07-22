import sharp from 'sharp';
import { zipSync, strToU8, type Zippable } from 'fflate';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import {
  APlusGeneratedModuleSchema,
  ModuleMappingEntrySchema,
  type APlusGeneratedModule,
} from '@farvisionllc/models';
import { auth0 } from '../../../../lib/auth0';
import { createAssetS3Client, getAsset } from '../../../../lib/media-assets';
import {
  PREMIUM_BAND_FRAME,
  inlineSlotImages,
  inlineThemeLogo,
  renderModule,
  themeSchema,
} from '../../../../lib/aplus-export-render';
import {
  buildInstructionsModel,
  entryFileName,
  exportBaseName,
  instructionsHtml,
  zipEntryPlan,
  type FinalizedKitFile,
} from '../../../../lib/aplus-export-kit';
import {
  APLUS_CANVAS_WIDTH,
  APLUS_PREMIUM_CANVAS_WIDTH,
  brandThemeFrom,
  type BrandTheme,
} from '../../../(dashboard)/a-plus/components/a-plus-design';

// The whole Seller Central hand-off in one download: instructions, every
// image pre-cropped/rendered at Amazon's exact upload dims (filenames sort in
// build order), and a full-page preview composite. Sharp + S3 → Node runtime;
// ~7 modules of satori renders + crops fit comfortably in 60s.
export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({
  modules: z.array(APlusGeneratedModuleSchema).min(1),
  moduleMapping: z.array(ModuleMappingEntrySchema).min(1),
  theme: themeSchema.optional(),
  tier: z.enum(['Basic A+', 'Premium A+']).default('Basic A+'),
  title: z.string().max(200).optional(),
  asins: z.array(z.string().max(20)).max(50).default([]),
});

/**
 * Amazon rejects oversized uploads — keep every photo under this. VERIFY the
 * live per-image limit in Seller Central (commonly cited: 2MB Basic, 5MB
 * Premium); 2MB is the safe floor for both tiers.
 */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const JPEG_QUALITY_STEPS = [90, 80, 70] as const;

/** Raw bytes for a slot image URL — asset route (ownership-checked) or data URL. */
async function slotBytes(url: string, userId: string): Promise<Buffer | null> {
  if (url.startsWith('data:')) {
    const base64 = url.split(',')[1];
    return base64 ? Buffer.from(base64, 'base64') : null;
  }
  if (!url.startsWith('/api/a-plus/assets/')) return null;
  const assetId = url.split('/').pop()?.split('?')[0];
  if (!assetId) return null;
  try {
    const asset = await getAsset(assetId);
    if (!asset || asset.userId !== userId) return null;
    const s3 = createAssetS3Client();
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: asset.storage.bucket,
        Key: asset.storage.key,
      })
    );
    const bytes = await obj.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}

/**
 * Fit a tight content render into an exact band frame: scale up to fill the
 * width, then pad evenly with the module background. Yields visibly LARGER
 * content than rendering small content inside a tall fixed frame.
 */
async function fitIntoBandFrame(
  png: Buffer,
  width: number,
  height: number,
  background: string
): Promise<Buffer> {
  return sharp(png)
    .resize({ width, height, fit: 'contain', background })
    .png()
    .toBuffer();
}

/**
 * Trim a render's empty bottom slack (estimateHeight errs tall on purpose so
 * content is never clipped) down to `keepPx` of breathing room — used ONLY for
 * the full-page composite so stacked modules read as one continuous page.
 * Rows are "empty" when every pixel matches the row's own first pixel; a
 * full-bleed photo bottom is non-uniform, so those modules pass through.
 */
async function trimBottomSlack(png: Buffer, keepPx = 28): Promise<Buffer> {
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const rowUniform = (y: number): boolean => {
    const start = y * width * channels;
    for (let x = 1; x < width; x++) {
      const i = start + x * channels;
      if (
        Math.abs(data[i] - data[start]) > 2 ||
        Math.abs(data[i + 1] - data[start + 1]) > 2 ||
        Math.abs(data[i + 2] - data[start + 2]) > 2
      ) {
        return false;
      }
    }
    return true;
  };
  let contentBottom = height - 1;
  while (contentBottom > 0 && rowUniform(contentBottom)) contentBottom--;
  const trimmedHeight = Math.min(height, contentBottom + 1 + keepPx);
  if (trimmedHeight >= height) return png;
  return sharp(png)
    .extract({ left: 0, top: 0, width, height: trimmedHeight })
    .png()
    .toBuffer();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The spec-badge pill ("8 OZ", "50-PACK") stamped onto native photo crops —
 * Amazon's native modules have NO badge field, so the pill only reaches the
 * live page baked into the image. Mirrors the preview's SpecBadge styling.
 */
function specBadgeSvg(
  text: string,
  imageWidth: number,
  theme: { accent: string; accentInk: string }
): { svg: Buffer; width: number; height: number; margin: number } {
  const scale = Math.max(0.55, Math.min(1.6, imageWidth / 970));
  const fontSize = Math.round(18 * scale);
  const padX = Math.round(16 * scale);
  const padY = Math.round(10 * scale);
  const label = text.toUpperCase();
  const textWidth = Math.ceil(label.length * fontSize * 0.66);
  const width = textWidth + padX * 2;
  const height = fontSize + padY * 2;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
       <rect width="${width}" height="${height}" rx="${Math.round(
      8 * scale
    )}" fill="${theme.accent}" stroke="rgba(255,255,255,0.55)" stroke-width="${
      1.5 * scale
    }"/>
       <text x="${width / 2}" y="${
      height / 2
    }" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="800" letter-spacing="${
      1.5 * scale
    }" fill="${
      theme.accentInk
    }" text-anchor="middle" dominant-baseline="central">${escapeXml(
      label
    )}</text>
     </svg>`
  );
  return { svg, width, height, margin: Math.round(18 * scale) };
}

/** Center cover-crop to exact dims as JPEG, stepping quality down to fit. */
async function cropToJpeg(
  bytes: Buffer,
  width: number,
  height: number,
  badge?: { text: string; accent: string; accentInk: string }
): Promise<{ jpeg: Buffer; recompressed: boolean }> {
  let base = sharp(bytes).resize({
    width,
    height,
    fit: 'cover',
    position: 'centre',
  });
  if (badge?.text.trim()) {
    const pill = specBadgeSvg(badge.text.trim(), width, badge);
    base = sharp(
      await base.png().toBuffer() // flatten the resize before compositing
    ).composite([
      {
        input: pill.svg,
        left: Math.max(0, width - pill.width - pill.margin),
        top: pill.margin,
      },
    ]);
  }
  let jpeg = await base.jpeg({ quality: JPEG_QUALITY_STEPS[0] }).toBuffer();
  let recompressed = false;
  for (const quality of JPEG_QUALITY_STEPS.slice(1)) {
    if (jpeg.byteLength <= MAX_IMAGE_BYTES) break;
    jpeg = await base.jpeg({ quality }).toBuffer();
    recompressed = true;
  }
  return { jpeg, recompressed };
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.sub;

  let input: z.infer<typeof bodySchema>;
  try {
    input = bodySchema.parse(await request.json());
  } catch (error) {
    // A silent 400 is undebuggable — log WHAT failed validation and where.
    const detail =
      error instanceof z.ZodError
        ? error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join(' | ')
        : error instanceof Error
        ? error.message
        : String(error);
    console.error(
      `[a-plus-export-zip] invalid payload: ${detail.slice(0, 500)}`
    );
    return Response.json(
      { error: `Invalid export payload: ${detail.slice(0, 200)}` },
      { status: 400 }
    );
  }
  const premium = input.tier === 'Premium A+';
  const canvasWidth = premium ? APLUS_PREMIUM_CANVAS_WIDTH : APLUS_CANVAS_WIDTH;

  const tStart = Date.now();
  try {
    const theme: BrandTheme = { ...brandThemeFrom(null), ...input.theme };
    await inlineThemeLogo(theme, userId);

    // One inlined clone + one desktop render per module — reused by the
    // per-module exports AND the full-page composite (never rendered twice).
    const orderedMapping = [...input.moduleMapping].sort(
      (a, b) => a.order - b.order
    );
    const clones = new Map<number, APlusGeneratedModule>();
    const desktopRenders = new Map<number, Buffer>();
    for (const entry of orderedMapping) {
      const module = input.modules.find(
        (candidate) => candidate.order === entry.order
      );
      if (!module) continue;
      const clone = structuredClone(module);
      await inlineSlotImages(clone, userId);
      clones.set(entry.order, clone);

      // Everything premium renders TIGHT at the designed 970px width first —
      // the layouts and height estimates are tuned there. Native modules then
      // upscale to the premium canvas; designed BANDS scale-and-pad into their
      // exact 1464×600 frame (bigger content, less dead space than rendering
      // small content inside a tall fixed frame).
      const isBand =
        premium && module.amazonModuleType === 'PREMIUM_FULL_IMAGE';
      let png = Buffer.from(
        await renderModule(
          clone,
          theme,
          'desktop',
          input.tier,
          premium ? APLUS_CANVAS_WIDTH : undefined,
          isBand
        ).arrayBuffer()
      );
      if (isBand) {
        png = await fitIntoBandFrame(
          await trimBottomSlack(png, 16),
          PREMIUM_BAND_FRAME.desktop.width,
          PREMIUM_BAND_FRAME.desktop.height,
          theme.bg
        );
      } else if (premium) {
        png = await sharp(png).resize({ width: canvasWidth }).png().toBuffer();
      }
      desktopRenders.set(entry.order, png);
    }

    const imageEntries: Record<string, Uint8Array> = {};
    const finalized: FinalizedKitFile[] = [];
    const missing: Array<{ moduleOrder: number; slot: string }> = [];
    const warnings: string[] = [];
    const addFile = (
      spec: { baseName: string; ext: 'jpg' | 'png' },
      meta: Omit<FinalizedKitFile, 'fileName'>,
      bytes: Buffer
    ) => {
      const fileName = entryFileName(spec, meta.width, meta.height);
      imageEntries[fileName] = new Uint8Array(bytes);
      finalized.push({ ...meta, fileName });
    };

    for (const spec of zipEntryPlan(
      input.modules,
      input.moduleMapping,
      input.tier
    )) {
      const clone = clones.get(spec.moduleOrder);
      try {
        if (spec.source.kind === 'crop') {
          const bytes = spec.source.slotUrl
            ? await slotBytes(spec.source.slotUrl, userId)
            : null;
          if (!bytes) {
            missing.push({ moduleOrder: spec.moduleOrder, slot: spec.slot });
            continue;
          }
          // Modules with a spec badge get it stamped on (native modules have
          // no badge field — pixels are the only way it reaches the page).
          const module = clone ?? undefined;
          const badgeText =
            module && 'badge' in module ? module.badge?.trim() : undefined;
          const { jpeg, recompressed } = await cropToJpeg(
            bytes,
            spec.source.width,
            spec.source.height,
            badgeText
              ? {
                  text: badgeText,
                  accent: theme.accent,
                  accentInk: theme.accentInk,
                }
              : undefined
          );
          if (recompressed) {
            warnings.push(
              `"${entryFileName(
                spec,
                spec.source.width,
                spec.source.height
              )}" was recompressed to stay under Amazon's image size limit.`
            );
          }
          addFile(
            spec,
            {
              moduleOrder: spec.moduleOrder,
              slot: spec.slot,
              width: spec.source.width,
              height: spec.source.height,
              alt: spec.source.alt,
            },
            jpeg
          );
        } else if (spec.source.kind === 'render') {
          if (!clone) continue;
          let png: Buffer | undefined;
          if (spec.source.viewport === 'desktop') {
            png = desktopRenders.get(spec.moduleOrder);
          } else {
            // Mobile: tight content render, then scale/pad into the mobile
            // band frame on premium (Basic ships content-height as-is).
            const raw = Buffer.from(
              await renderModule(
                clone,
                theme,
                'mobile',
                input.tier,
                premium ? 600 : undefined
              ).arrayBuffer()
            );
            png = premium
              ? await fitIntoBandFrame(
                  await trimBottomSlack(raw, 16),
                  PREMIUM_BAND_FRAME.mobile.width,
                  PREMIUM_BAND_FRAME.mobile.height,
                  theme.bg
                )
              : raw;
          }
          if (!png) continue;
          const meta = await sharp(png).metadata();
          addFile(
            spec,
            {
              moduleOrder: spec.moduleOrder,
              slot: spec.slot,
              width: meta.width ?? 0,
              height: meta.height ?? 0,
              alt: spec.source.alt,
            },
            png
          );
        } else {
          // Slice: cut the desktop scene render on the slice grid. The render
          // height rarely equals the grid exactly — cover-resize first
          // (documented tradeoff; briefs keep focal content off the seams).
          const scene = desktopRenders.get(spec.moduleOrder);
          if (!scene) continue;
          const gridded = sharp(scene).resize({
            width: canvasWidth,
            height: spec.source.totalHeight,
            fit: 'cover',
            position: 'centre',
          });
          const slicePng = await gridded
            .extract({
              left: 0,
              top: spec.source.offsetY,
              width: canvasWidth,
              height: spec.source.sliceHeight,
            })
            .png()
            .toBuffer();
          if (spec.source.viewport === 'desktop') {
            addFile(
              spec,
              {
                moduleOrder: spec.moduleOrder,
                slot: spec.slot,
                width: canvasWidth,
                height: spec.source.sliceHeight,
                alt: spec.source.alt,
              },
              slicePng
            );
          } else {
            // Mobile: premium slices get the exact 600×450 frame; Basic gets
            // a proportional 600-wide resize.
            const target = premium
              ? PREMIUM_BAND_FRAME.mobile
              : {
                  width: 600,
                  height: Math.round(
                    (spec.source.sliceHeight * 600) / canvasWidth
                  ),
                };
            const mobilePng = await sharp(slicePng)
              .resize({ ...target, fit: 'cover', position: 'centre' })
              .png()
              .toBuffer();
            addFile(
              spec,
              {
                moduleOrder: spec.moduleOrder,
                slot: spec.slot,
                width: target.width,
                height: target.height,
                alt: spec.source.alt,
              },
              mobilePng
            );
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(
          `[a-plus-export-zip] entry ${spec.baseName} failed: ${detail.slice(
            0,
            200
          )}`
        );
        missing.push({ moduleOrder: spec.moduleOrder, slot: spec.slot });
      }
    }

    // Full-page preview: stack every module's desktop render top-to-bottom.
    let preview: Buffer | undefined;
    try {
      const stack: Array<{ input: Buffer; top: number }> = [];
      let offset = 0;
      for (const entry of orderedMapping) {
        const png = desktopRenders.get(entry.order);
        if (!png) continue;
        // Composite-only copy with the empty bottom slack trimmed, so the
        // stacked page reads continuous (zip band files stay untouched).
        const trimmed = await trimBottomSlack(png);
        const meta = await sharp(trimmed).metadata();
        if (!meta.height) continue;
        stack.push({ input: trimmed, top: offset });
        offset += meta.height;
      }
      if (stack.length) {
        preview = await sharp({
          create: {
            width: canvasWidth,
            height: offset,
            channels: 3,
            background: '#ffffff',
          },
        })
          .composite(stack.map((item) => ({ ...item, left: 0 })))
          .png()
          .toBuffer();
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `[a-plus-export-zip] preview composite failed: ${detail.slice(0, 200)}`
      );
      warnings.push(
        'The full-page preview image could not be generated — use the on-screen preview instead.'
      );
    }

    const html = instructionsHtml(
      buildInstructionsModel({
        modules: input.modules,
        moduleMapping: input.moduleMapping,
        tier: input.tier,
        title: input.title,
        asins: input.asins,
        files: finalized,
        missing,
        warnings,
      })
    );

    // Kit files first (00- prefix), then images in build order. Images are
    // already compressed — store them; deflate only the HTML.
    const zippable: Zippable = {
      '00-instructions.html': [strToU8(html), { level: 6 }],
      ...(preview
        ? {
            '00-full-page-preview.png': [new Uint8Array(preview), { level: 0 }],
          }
        : {}),
    };
    for (const [name, bytes] of Object.entries(imageEntries)) {
      zippable[name] = [bytes, { level: 0 }];
    }
    const zip = zipSync(zippable);

    console.log(
      `[a-plus-export-zip] ${finalized.length} images, ${
        missing.length
      } missing, ${(zip.byteLength / 1024 / 1024).toFixed(1)}MB in ${(
        (Date.now() - tStart) /
        1000
      ).toFixed(1)}s`
    );
    return new Response(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${exportBaseName(
          input.title
        )}.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[a-plus-export-zip] FAILED: ${detail.slice(0, 300)}`);
    return Response.json(
      { error: 'Could not build the export kit. Please try again.' },
      { status: 500 }
    );
  }
}
