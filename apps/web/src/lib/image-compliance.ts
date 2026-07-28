import sharp from 'sharp';
import { subjectBoundingBox } from './image-ops';

/**
 * Marketplace image compliance, measured rather than judged.
 *
 * A listing gets suppressed for reasons that are all arithmetic — too small,
 * product too small in frame, background not actually white, alpha left in a
 * main image. Those are worth computing exactly and identically every time,
 * which is why this is sharp and not a model: a pass/fail you gate a live
 * listing write on must not vary between runs.
 *
 * What genuinely needs eyes (text overlays, watermarks, props, whether the
 * photo shows the RIGHT product) comes back as `manualChecks` for the agent to
 * settle with look-at-photo. This tool never claims to have checked those.
 *
 * Platform rules are DATA (`IMAGE_SPECS`). Adding Walmart/Shopify/eBay is a new
 * spec object, not new code.
 */

export type ImageRole = 'main' | 'secondary';

export type PlatformSpec = {
  platform: string;
  /**
   * Where these numbers came from and how much to trust them. Marketplace
   * requirements drift and Amazon's are behind a Seller Central login, so treat
   * every threshold here as correctable rather than authoritative.
   */
  provenance: string;
  /** Longest edge, px. Below `min` the platform rejects or disables zoom. */
  minLongestSide: number;
  recommendedLongestSide: number;
  maxLongestSide: number;
  /** Shortest edge, px — a technical floor independent of the zoom threshold. */
  minShortestSide: number;
  maxBytes: number;
  /** Accepted container formats, as sharp reports them. */
  formats: string[];
  /** Amazon accepts GIF only when non-animated. */
  animatedAllowed: boolean;
  main: {
    requiresWhiteBackground: boolean;
    /** Max mean per-channel distance from 255 across the border ring. */
    whiteTolerance: number;
    /** Min share of border pixels that must be within tolerance. */
    minWhiteBorderShare: number;
    /** Product's longest edge as a share of the frame's longest edge. */
    minCoverage: number;
    allowsTransparency: boolean;
  };
  /** Variance-of-Laplacian floor; heuristic, see calibration note below. */
  minSharpness: number;
  /** Things only a human/vision pass can settle, phrased as questions. */
  manualChecks: Record<ImageRole, string[]>;
};

/**
 * Amazon, from Seller Central help G1881 (Product Image Guide).
 *
 * VERIFIED against that page: the 500-10,000px longest-side range, accepted
 * formats (JPEG recommended; TIFF, PNG, non-animated GIF), pure white main
 * background, ~85% frame coverage, and the content rules encoded as
 * manualChecks. NOT in that page and therefore still assumption: the 10MB file
 * ceiling, and the 1000px zoom threshold (long-standing guidance, treated here
 * as a recommendation rather than a rejection).
 *
 * Note the page read was the .in marketplace; the technical specs are global in
 * practice, but if a marketplace ever diverges this becomes two specs, not an
 * if-statement.
 */
const AMAZON: PlatformSpec = {
  platform: 'amazon',
  provenance:
    'Seller Central help G1881 (Product Image Guide): size range, formats, ' +
    'white main background, ~85% coverage and content rules. The 10MB ceiling ' +
    'and the 1000px zoom threshold are assumptions, not from that page.',
  // The page states 500-10,000px on the LONGEST side as the accepted range —
  // below 500 is rejected outright. 1000px is the zoom threshold, which costs
  // conversions but is not a rejection, so it is a recommendation here.
  minLongestSide: 500,
  recommendedLongestSide: 1000,
  maxLongestSide: 10000,
  // The guide sets no shortest-side floor; asserting one would fail valid
  // panoramic or tall product shots.
  minShortestSide: 0,
  maxBytes: 10 * 1024 * 1024,
  formats: ['jpeg', 'png', 'gif', 'tiff'],
  animatedAllowed: false,
  main: {
    requiresWhiteBackground: true,
    whiteTolerance: 6,
    minWhiteBorderShare: 0.97,
    minCoverage: 0.85,
    allowsTransparency: false,
  },
  minSharpness: 25,
  manualChecks: {
    main: [
      'Is the frame free of text, logos, watermarks and borders? (Only markings ' +
        'physically on the product are allowed.)',
      'Is the product shown alone — no props, no extra accessories, and only ' +
        'ONE unit at ONE angle?',
      'Is packaging excluded, unless the packaging itself is a key feature?',
      'Is this a realistic professional photo of the ACTUAL product — not a ' +
        'placeholder, render, illustration or composite scene?',
      'Category rules: shoes are a single shoe at 45 degrees; adult clothing ' +
        'must be on a standing model; clothing accessories are flat-laid.',
    ],
    secondary: [
      'Does the image accurately match the product and its title?',
      'Is it free of review badges, star ratings, pricing and promotional ' +
        'claims, and of anything resembling an Amazon logo or badge?',
      "No nudity or suggestive content; modesty rules apply to children's and " +
        'baby underwear and swimwear.',
    ],
  },
};

/** Technical baseline for platforms whose exact rules are not encoded yet. */
const GENERIC: PlatformSpec = {
  platform: 'generic',
  provenance:
    'Platform-neutral technical baseline — resolution, sharpness and file ' +
    'size only. No background or coverage rules are asserted.',
  minLongestSide: 500,
  recommendedLongestSide: 1000,
  maxLongestSide: 10000,
  minShortestSide: 0,
  maxBytes: 20 * 1024 * 1024,
  formats: ['jpeg', 'png', 'webp', 'gif', 'tiff'],
  animatedAllowed: true,
  main: {
    requiresWhiteBackground: false,
    // No rule reads this, but it still sets the tolerance the REPORTED border
    // share is measured at — 255 would report every image as 100% white and
    // mislead anyone reading the measurements.
    whiteTolerance: 6,
    minWhiteBorderShare: 0,
    minCoverage: 0,
    allowsTransparency: true,
  },
  minSharpness: 15,
  manualChecks: {
    main: ['Does the image meet the destination platform’s own image policy?'],
    secondary: [],
  },
};

export const IMAGE_SPECS: Record<string, PlatformSpec> = {
  amazon: AMAZON,
  generic: GENERIC,
};

export type ImageMeasurements = {
  width: number;
  height: number;
  longestSide: number;
  shortestSide: number;
  aspectRatio: number;
  format?: string;
  sizeBytes: number;
  hasAlphaChannel: boolean;
  /** Alpha channel present AND actually used — an unused one is harmless. */
  hasTransparentPixels: boolean;
  /** Product's longest edge as a share of the frame's longest edge. */
  coverage?: number;
  subject?: { x: number; y: number; width: number; height: number };
  /** Mean per-channel distance from pure white across the border ring. */
  borderWhiteDistance: number;
  /** Share of border pixels within the platform's white tolerance. */
  borderWhiteShare: number;
  /** Variance of the Laplacian — low means soft/blurry. */
  sharpness: number;
  /** >1 frame: an animated GIF, which Amazon does not accept. */
  frames: number;
  /** Keyword present in XMP dc:subject — where Amazon looks for it. */
  hasSyntheticPerformerTag: boolean;
  /** Keyword found somewhere else in the metadata, where it will not be read. */
  syntheticPerformerTagMisplaced: boolean;
};

export type Finding = {
  id: string;
  severity: 'blocker' | 'warning';
  message: string;
  actual: string;
  required: string;
};

export type ComplianceReport = {
  platform: string;
  role: ImageRole;
  verdict: 'pass' | 'review' | 'fail';
  measurements: ImageMeasurements;
  blockers: Finding[];
  warnings: Finding[];
  /** Questions this tool CANNOT answer — settle them with look-at-photo. */
  manualChecks: string[];
  provenance: string;
};

/**
 * Amazon requires this keyword in an image's IPTC/XMP metadata when the image
 * contains a fully AI-generated, photorealistic PERSON. Not required for real
 * people (even AI-edited), fictional characters, non-photorealistic figures, or
 * images with no people — so it cannot be inferred from "we generated this".
 */
export const SYNTHETIC_PERFORMER_KEYWORD = 'contains-synthetic-performer';

/** A fresh XMP packet carrying just the disclosure keyword. */
function freshSyntheticPerformerXmp(): string {
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:subject>
    <rdf:Bag>
     <rdf:li>${SYNTHETIC_PERFORMER_KEYWORD}</rdf:li>
    </rdf:Bag>
   </dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** The keyword sitting where Amazon actually looks: inside dc:subject's Bag. */
export function hasKeywordInDcSubject(xmp: string): boolean {
  const bag = xmp.match(/<dc:subject>[\s\S]*?<\/dc:subject>/i)?.[0];
  return Boolean(bag && bag.includes(SYNTHETIC_PERFORMER_KEYWORD));
}

/**
 * Add the keyword to an existing XMP packet instead of replacing it.
 *
 * Amazon's own instructions use `exiftool -XMP-dc:Subject+=`, where `+=`
 * appends and leaves other keywords alone. sharp's withXmp() replaces the whole
 * packet, so writing a fresh one would silently discard the photographer's
 * keywords, copyright and camera metadata. Idempotent: the guide warns that
 * running the tag twice duplicates it.
 */
export function mergeSyntheticPerformerXmp(existing?: string): {
  xmp: string;
  alreadyTagged: boolean;
  preservedExisting: boolean;
} {
  const current = existing?.trim();
  if (!current) {
    return {
      xmp: freshSyntheticPerformerXmp(),
      alreadyTagged: false,
      preservedExisting: true,
    };
  }
  if (hasKeywordInDcSubject(current)) {
    return { xmp: current, alreadyTagged: true, preservedExisting: true };
  }

  const li = `<rdf:li>${SYNTHETIC_PERFORMER_KEYWORD}</rdf:li>`;

  // Existing dc:subject Bag — append alongside the keywords already there.
  const bagOpen = current.match(/<dc:subject>\s*<rdf:Bag>/i);
  if (bagOpen?.index !== undefined) {
    const at = bagOpen.index + bagOpen[0].length;
    return {
      xmp: `${current.slice(0, at)}${li}${current.slice(at)}`,
      alreadyTagged: false,
      preservedExisting: true,
    };
  }

  // No dc:subject: add one inside the first rdf:Description, declaring the dc
  // namespace on it when the packet does not already declare it.
  const description = current.match(/<rdf:Description\b[^>]*>/i);
  if (description?.index !== undefined) {
    let tag = description[0];
    if (!/xmlns:dc\s*=/.test(current)) {
      tag = tag.replace(
        /\s*\/?>$/,
        ' xmlns:dc="http://purl.org/dc/elements/1.1/">'
      );
    }
    const at = description.index + description[0].length;
    return {
      xmp:
        current.slice(0, description.index) +
        tag +
        `<dc:subject><rdf:Bag>${li}</rdf:Bag></dc:subject>` +
        current.slice(at),
      alreadyTagged: false,
      preservedExisting: true,
    };
  }

  // Unrecognised packet: the disclosure is mandatory, so it wins — but say that
  // the original metadata could not be carried over.
  return {
    xmp: freshSyntheticPerformerXmp(),
    alreadyTagged: false,
    preservedExisting: false,
  };
}

/** Longest edge used for the pixel scans; full res buys nothing here. */
const SCAN_MAX = 800;
/** Border ring thickness as a share of the shortest edge. */
const BORDER_SHARE = 0.02;

async function measureBorderWhite(
  input: Buffer,
  tolerance: number
): Promise<{ distance: number; share: number }> {
  const { data, info } = await sharp(input)
    .resize({ width: SCAN_MAX, height: SCAN_MAX, fit: 'inside' })
    // A main image must be white AFTER flattening: alpha over white is what a
    // marketplace renders, and unflattened transparency would read as black.
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (channels < 3 || !width || !height) return { distance: 0, share: 1 };

  const ring = Math.max(1, Math.round(Math.min(width, height) * BORDER_SHARE));
  let total = 0;
  let count = 0;
  let within = 0;

  for (let y = 0; y < height; y++) {
    const edgeRow = y < ring || y >= height - ring;
    for (let x = 0; x < width; x++) {
      if (!edgeRow && x >= ring && x < width - ring) continue;
      const i = (y * width + x) * channels;
      const distance =
        (255 - data[i] + (255 - data[i + 1]) + (255 - data[i + 2])) / 3;
      total += distance;
      count++;
      if (distance <= tolerance) within++;
    }
  }
  if (!count) return { distance: 0, share: 1 };
  return { distance: total / count, share: within / count };
}

/**
 * Variance of the Laplacian on a size-normalised greyscale copy — the standard
 * cheap blur proxy. Absolute values are only comparable because the input is
 * always scaled to the same longest edge first.
 */
async function measureSharpness(input: Buffer): Promise<number> {
  const { data, info } = await sharp(input)
    .resize({ width: SCAN_MAX, height: SCAN_MAX, fit: 'inside' })
    .flatten({ background: '#ffffff' })
    .greyscale()
    .convolve({
      width: 3,
      height: 3,
      kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const step = info.channels || 1;
  const pixels = info.width * info.height;
  if (!pixels) return 0;

  let sum = 0;
  let sumSquares = 0;
  for (let i = 0; i < pixels; i++) {
    const value = data[i * step];
    sum += value;
    sumSquares += value * value;
  }
  const mean = sum / pixels;
  return sumSquares / pixels - mean * mean;
}

async function hasTransparentPixels(input: Buffer): Promise<boolean> {
  const { data, info } = await sharp(input)
    .resize({ width: SCAN_MAX, height: SCAN_MAX, fit: 'inside' })
    .ensureAlpha()
    .extractChannel('alpha')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const step = info.channels || 1;
  for (let i = 0; i < data.length; i += step) {
    if (data[i] < 250) return true;
  }
  return false;
}

export async function measureImage(
  input: Buffer,
  spec: PlatformSpec
): Promise<ImageMeasurements> {
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    throw new Error('Could not read image dimensions.');
  }

  const [border, sharpness, transparent, box] = await Promise.all([
    measureBorderWhite(input, spec.main.whiteTolerance),
    measureSharpness(input),
    meta.hasAlpha ?? false
      ? hasTransparentPixels(input)
      : Promise.resolve(false),
    subjectBoundingBox(input),
  ]);

  const xmpText = meta.xmp ? meta.xmp.toString('utf8') : '';
  const otherMetadataText = meta.iptc ? meta.iptc.toString('latin1') : '';
  // Amazon reads XMP dc:subject specifically. The keyword sitting in IPTC or
  // some other XMP field would pass a naive substring check and still fail
  // their validation, so the two cases are reported separately.
  const taggedProperly = hasKeywordInDcSubject(xmpText);
  const taggedElsewhere =
    !taggedProperly &&
    (xmpText.includes(SYNTHETIC_PERFORMER_KEYWORD) ||
      otherMetadataText.includes(SYNTHETIC_PERFORMER_KEYWORD));

  return {
    width,
    height,
    frames: meta.pages ?? 1,
    hasSyntheticPerformerTag: taggedProperly,
    syntheticPerformerTagMisplaced: taggedElsewhere,
    longestSide: Math.max(width, height),
    shortestSide: Math.min(width, height),
    aspectRatio: Math.round((width / height) * 100) / 100,
    format: meta.format,
    sizeBytes: input.byteLength,
    hasAlphaChannel: meta.hasAlpha ?? false,
    hasTransparentPixels: transparent,
    coverage: box
      ? Math.round(Math.max(box.width / width, box.height / height) * 1000) /
        1000
      : undefined,
    subject: box
      ? {
          x: Math.round((box.left / width) * 1000) / 1000,
          y: Math.round((box.top / height) * 1000) / 1000,
          width: Math.round((box.width / width) * 1000) / 1000,
          height: Math.round((box.height / height) * 1000) / 1000,
        }
      : undefined,
    borderWhiteDistance: Math.round(border.distance * 10) / 10,
    borderWhiteShare: Math.round(border.share * 1000) / 1000,
    sharpness: Math.round(sharpness * 10) / 10,
  };
}

function evaluate(
  m: ImageMeasurements,
  role: ImageRole,
  spec: PlatformSpec,
  containsSyntheticPerson?: boolean
): { blockers: Finding[]; warnings: Finding[] } {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const add = (list: Finding[], finding: Finding) => list.push(finding);

  if (m.longestSide < spec.minLongestSide) {
    add(blockers, {
      id: 'resolution',
      severity: 'blocker',
      message:
        `Too small for ${spec.platform}. Upscale with scale-image ` +
        '(allowUpscale) or re-shoot — below this, zoom is disabled.',
      actual: `${m.width}x${m.height}px`,
      required: `longest side >= ${spec.minLongestSide}px`,
    });
  } else if (m.longestSide < spec.recommendedLongestSide) {
    add(warnings, {
      id: 'resolution-recommended',
      severity: 'warning',
      // Worded so it cannot be relayed as "Amazon requires 1000px" — it does
      // not. The image is accepted, it just does not get zoom.
      message:
        `Accepted (above the ${spec.minLongestSide}px floor) but below the ` +
        `${spec.recommendedLongestSide}px that enables zoom. RECOMMENDED, not ` +
        'required — do not tell the user it will be rejected.',
      actual: `${m.longestSide}px`,
      required: `>= ${spec.recommendedLongestSide}px for zoom (recommended)`,
    });
  }

  if (m.shortestSide < spec.minShortestSide) {
    add(blockers, {
      id: 'min-side',
      severity: 'blocker',
      message: 'Shortest edge is below the platform floor.',
      actual: `${m.shortestSide}px`,
      required: `>= ${spec.minShortestSide}px`,
    });
  }

  if (m.longestSide > spec.maxLongestSide) {
    add(blockers, {
      id: 'max-resolution',
      severity: 'blocker',
      message: 'Larger than the platform accepts — scale it down.',
      actual: `${m.longestSide}px`,
      required: `<= ${spec.maxLongestSide}px`,
    });
  }

  if (m.sizeBytes > spec.maxBytes) {
    add(blockers, {
      id: 'file-size',
      severity: 'blocker',
      message: 'File is larger than the platform accepts.',
      actual: `${(m.sizeBytes / 1024 / 1024).toFixed(1)}MB`,
      required: `<= ${(spec.maxBytes / 1024 / 1024).toFixed(0)}MB`,
    });
  }

  if (m.format && !spec.formats.includes(m.format)) {
    add(blockers, {
      id: 'format',
      severity: 'blocker',
      message: `${m.format} is not an accepted format on ${spec.platform}.`,
      actual: m.format,
      required: spec.formats.join(', '),
    });
  }

  if (!spec.animatedAllowed && m.frames > 1) {
    add(blockers, {
      id: 'animated',
      severity: 'blocker',
      message: 'Animated images are not accepted — export a single frame.',
      actual: `${m.frames} frames`,
      required: 'single frame',
    });
  }

  // Amazon's synthetic-performer disclosure. Only the caller knows whether a
  // photorealistic AI person is in the frame, so this fires on their say-so
  // rather than on a guess about how the image was made.
  if (containsSyntheticPerson && !m.hasSyntheticPerformerTag) {
    add(blockers, {
      id: 'synthetic-performer-disclosure',
      severity: 'blocker',
      message: m.syntheticPerformerTagMisplaced
        ? 'The disclosure keyword is in the file but NOT in XMP dc:subject, ' +
          'which is the only place Amazon reads it. Run tag-synthetic-performer.'
        : 'Image contains a fully AI-generated photorealistic person but is not ' +
          'tagged as such. Run tag-synthetic-performer on it before uploading.',
      actual: m.syntheticPerformerTagMisplaced
        ? 'keyword present but outside XMP dc:subject'
        : 'no disclosure keyword',
      required: `"${SYNTHETIC_PERFORMER_KEYWORD}" in XMP dc:subject`,
    });
  } else if (
    containsSyntheticPerson === undefined &&
    m.hasSyntheticPerformerTag
  ) {
    add(warnings, {
      id: 'synthetic-performer-tagged',
      severity: 'warning',
      message:
        'Already carries the synthetic-performer disclosure. Keep it if the ' +
        'image really does show an AI-generated person; it is wrong to claim ' +
        'otherwise.',
      actual: 'disclosure keyword present',
      required: 'only when an AI-generated person is shown',
    });
  }

  if (m.sharpness < spec.minSharpness) {
    add(warnings, {
      id: 'sharpness',
      severity: 'warning',
      message:
        'Looks soft or out of focus. Threshold is heuristic — confirm with ' +
        'look-at-photo before telling the user to re-shoot.',
      actual: `variance ${m.sharpness}`,
      required: `>= ${spec.minSharpness}`,
    });
  }

  if (role !== 'main') return { blockers, warnings };

  if (!spec.main.allowsTransparency && m.hasTransparentPixels) {
    add(blockers, {
      id: 'transparency',
      severity: 'blocker',
      message:
        'Main image still has transparent pixels. Flatten onto white — ' +
        'remove-image-background with background "white", or trim-image with ' +
        'background "white".',
      actual: 'transparent pixels present',
      required: 'fully opaque',
    });
  }

  if (spec.main.requiresWhiteBackground) {
    if (
      m.borderWhiteShare < spec.main.minWhiteBorderShare ||
      m.borderWhiteDistance > spec.main.whiteTolerance
    ) {
      add(blockers, {
        id: 'white-background',
        severity: 'blocker',
        message:
          'Background is not pure white at the frame edge. Off-white studio ' +
          'backdrops fail this — re-cut with remove-image-background ' +
          'background "white".',
        actual:
          `${(m.borderWhiteShare * 100).toFixed(1)}% of the border within ` +
          `tolerance, mean distance ${m.borderWhiteDistance}`,
        required:
          `>= ${(spec.main.minWhiteBorderShare * 100).toFixed(0)}% within ` +
          `${spec.main.whiteTolerance} of 255`,
      });
    }
  }

  if (spec.main.minCoverage > 0) {
    if (m.coverage === undefined) {
      add(warnings, {
        id: 'coverage-unknown',
        severity: 'warning',
        message:
          'Could not measure how much of the frame the product fills (no ' +
          'distinct subject against the background).',
        actual: 'unmeasurable',
        required: `>= ${(spec.main.minCoverage * 100).toFixed(
          0
        )}% of the frame`,
      });
    } else if (m.coverage < spec.main.minCoverage) {
      add(blockers, {
        id: 'coverage',
        severity: 'blocker',
        message:
          'Product does not fill enough of the frame. Re-frame with ' +
          `trim-image aspect "1:1" coverage ${spec.main.minCoverage}.`,
        actual: `${(m.coverage * 100).toFixed(1)}% of the frame`,
        required: `>= ${(spec.main.minCoverage * 100).toFixed(0)}%`,
      });
    }
  }

  return { blockers, warnings };
}

/**
 * Check one image against a platform's rules. Returns `review` when everything
 * measurable passes but manual checks remain — never `pass` on a main image,
 * because text/logo/props cannot be measured here.
 */
export async function checkImageCompliance(params: {
  bytes: Buffer;
  platform?: string;
  role?: ImageRole;
  /**
   * Set when the image shows a fully AI-generated photorealistic person — only
   * the caller can know this, and Amazon requires it disclosed in metadata.
   */
  containsSyntheticPerson?: boolean;
}): Promise<ComplianceReport> {
  const spec =
    IMAGE_SPECS[params.platform ?? 'amazon'] ?? IMAGE_SPECS['amazon'];
  const role: ImageRole = params.role ?? 'main';
  const measurements = await measureImage(params.bytes, spec);
  const { blockers, warnings } = evaluate(
    measurements,
    role,
    spec,
    params.containsSyntheticPerson
  );
  const manualChecks = spec.manualChecks[role] ?? [];

  return {
    platform: spec.platform,
    role,
    verdict: blockers.length ? 'fail' : manualChecks.length ? 'review' : 'pass',
    measurements,
    blockers,
    warnings,
    manualChecks,
    provenance: spec.provenance,
  };
}

/**
 * Embed the synthetic-performer disclosure keyword, preserving the image
 * otherwise. Returns the tagged bytes for the caller to persist as a new asset.
 */
export async function tagSyntheticPerformer(input: Buffer): Promise<{
  bytes: Buffer;
  mediaType: string;
  alreadyTagged: boolean;
  /** False when an unparseable existing XMP packet had to be replaced. */
  preservedExisting: boolean;
}> {
  const meta = await sharp(input).metadata();
  const merged = mergeSyntheticPerformerXmp(
    meta.xmp ? meta.xmp.toString('utf8') : undefined
  );

  // Re-encode in place: JPEG and PNG both carry XMP, and the formats that do
  // not are rejected by the platforms requiring this disclosure anyway.
  const pipeline = sharp(input).withXmp(merged.xmp);
  const png = meta.format === 'png' || meta.hasAlpha;
  return {
    bytes: png
      ? await pipeline.png().toBuffer()
      : await pipeline.jpeg({ quality: 95 }).toBuffer(),
    mediaType: png ? 'image/png' : 'image/jpeg',
    alreadyTagged: merged.alreadyTagged,
    preservedExisting: merged.preservedExisting,
  };
}
