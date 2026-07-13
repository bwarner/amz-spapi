'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  BrainCircuit,
  ChevronDown,
  CheckCircle2,
  Clipboard,
  FileImage,
  FileText,
  ImagePlus,
  Link as LinkIcon,
  Loader2,
  Monitor,
  PackageCheck,
  Plus,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import {
  APLUS_GENERATION_MODELS,
  applyAPlusGuardrails,
  compileExperienceToAplus,
  liftGeneratedPackageToExperience,
  moduleImageSlots,
  moduleTextFields,
  normalizeAmazonModuleType,
  setSectionResolvedImage,
  setSectionTextField,
  type APlusCreativity,
  type APlusGeneratedModule as GeneratedModule,
  type APlusGuidance,
  type APlusTextFieldPath,
  type Experience,
} from '@farvisionllc/models';
import {
  aplusModuleLimitForTier,
  buildModuleCopyRulesPreview,
  buildStrategyPrompt,
  compactGenerationInput,
} from '@/lib/aplus-generation-prompts';
import { slotJobId } from './components/a-plus-modules';
import { APlusSectionsPanel } from './components/a-plus-sections';
import {
  brandThemeFrom,
  DESIGN_STYLE_KEYS,
  DESIGN_STYLE_LABELS,
  type DesignStyleKey,
} from './components/a-plus-design';
import { APlusDesignedPreview } from './components/a-plus-design-preview';
import { APlusGuidancePanel } from './components/a-plus-guidance-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { matchAssetToSlot, type MatcherCandidate } from '@/lib/asset-matcher';

type SourceKind = 'Product listing' | 'Competitor' | 'Supplier' | 'Reference';
type ContentTier = 'Basic A+' | 'Premium A+';
type BuilderMode = 'simple' | 'advanced';
type WizardStep = 'basics' | 'sources' | 'assets' | 'review';
type PreviewViewport = 'desktop' | 'mobile';

type SourceLink = {
  id: number;
  kind: SourceKind;
  url: string;
};

type SourceCheck = {
  status:
    | 'idle'
    | 'checking'
    | 'accessible'
    | 'warning'
    | 'blocked'
    | 'invalid';
  message?: string;
  httpStatus?: number;
  finalUrl?: string;
};

type SourceExtraction = {
  status: 'idle' | 'extracting' | 'extracted' | 'warning' | 'error';
  message?: string;
  cacheHit?: boolean;
  facts?: {
    productName?: string;
    brandName?: string;
    asin?: string;
    oneLiner?: string;
    pricePoint?: string;
    features: string[];
    differentiators: string[];
    warnings: string[];
    evidence: string[];
    finalUrl?: string;
  };
};

type UploadedAsset = {
  assetId: string;
  createdForFeature?: 'a-plus' | 'ads' | 'listings' | 'shared';
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  hashes: {
    sha256: string;
  };
  status: 'pending_upload' | 'uploaded' | 'duplicate';
  storage: {
    provider: 's3';
    bucket: string;
    key: string;
  };
  duplicateOfAssetId?: string;
};

/** Structured visual profile from /api/a-plus/assets/profile (see redesign §3a). */
type AssetProfileData = {
  role: string;
  subjectProminence: string;
  orientation: string;
  background: string;
  negativeSpace: { side: string; amount: string };
  affordances: string[];
  hasBakedText: boolean;
  isRender: boolean;
  dominantColors: string[];
  description: string;
};

type AssetLibraryItem = {
  id: string;
  fileName: string;
  description: string;
  file?: File;
  asset?: UploadedAsset;
  uploadStatus: 'hashing' | 'uploading' | 'uploaded' | 'duplicate' | 'error';
  uploadMessage?: string;
  uploadAction?: string;
  uploadErrorCode?: string;
  /** Vision profile + whether it's currently being computed. */
  profile?: AssetProfileData;
  profiling?: boolean;
};

/**
 * AI-generated A+ images are named `generated-*` and belong in module slots,
 * not the user uploads library. Older drafts may still have them persisted in
 * `assets`, so we filter them out on load.
 */
function isGeneratedLibraryAsset(item: AssetLibraryItem): boolean {
  const name = item.asset?.originalFileName ?? item.fileName ?? '';
  return name.startsWith('generated-');
}

const EXT_TO_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
};

// Detect an image type from the file's magic bytes. Lets us accept files that
// have NO extension and no browser-provided MIME (which would otherwise be
// silently dropped or rejected by the upload preflight).
async function sniffImageMime(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    ''
  );
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('47494638')) return 'image/gif';
  if ((bytes[0] ?? 0) === 0x42 && (bytes[1] ?? 0) === 0x4d) return 'image/bmp';
  if (hex.startsWith('49492a00') || hex.startsWith('4d4d002a'))
    return 'image/tiff';
  // RIFF....WEBP
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250')
    return 'image/webp';
  // ISO-BMFF "ftyp" box (avif/heic) at bytes 4–7
  if (
    (bytes[4] ?? 0) === 0x66 &&
    (bytes[5] ?? 0) === 0x74 &&
    (bytes[6] ?? 0) === 0x79 &&
    (bytes[7] ?? 0) === 0x70
  ) {
    const brand = String.fromCharCode(
      bytes[8] ?? 0,
      bytes[9] ?? 0,
      bytes[10] ?? 0,
      bytes[11] ?? 0
    );
    if (brand.startsWith('avi')) return 'image/avif';
    if (brand.startsWith('hei') || brand.startsWith('mif')) return 'image/heic';
  }
  return null;
}

// Best image MIME for a dropped file: browser type → extension → content sniff.
// Returns null when the file is not a recognized image (so the caller can show
// a clear error instead of failing silently).
async function resolveImageMime(file: File): Promise<string | null> {
  if (file.type.startsWith('image/')) return file.type;
  const ext = file.name.includes('.')
    ? (file.name.split('.').pop() ?? '').toLowerCase()
    : '';
  if (ext && EXT_TO_IMAGE_MIME[ext]) return EXT_TO_IMAGE_MIME[ext];
  return sniffImageMime(file);
}

type PackageImageJob = {
  jobId: string;
  prompt: string;
  size: string;
  /** Slot role — used by the asset matcher to decide place vs generate. */
  role: string;
  /** True when this slot already has a generated/uploaded image (e.g. a draft
   * reloaded from storage) — so "Generate all" never re-pays for it. */
  hasImage: boolean;
};

type ImageJobResult =
  | { status: 'generating' }
  | {
      status: 'done';
      url: string;
      revisedPrompt?: string;
      assetId?: string;
      persistError?: string;
      /** Filled directly from one of the seller's uploaded assets, not generated. */
      fromAsset?: boolean;
    }
  | { status: 'error'; message: string };

type DraftSummary = {
  draftId: string;
  brandGuideId?: string;
  name: string;
  productName?: string;
  asin?: string;
  contentTier?: ContentTier;
  updatedAt: number;
};

type BrandGuide = {
  brandGuideId: string;
  name: string;
  brandName?: string;
  colors?: string;
  palette?: {
    primaryForeground?: string;
    secondaryForeground?: string;
    background?: string;
  };
  fonts?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  voice?: string;
  logoAsset?: {
    assetId: string;
    originalFileName: string;
    mimeType: string;
    sizeBytes: number;
    storage: {
      provider: 's3';
      bucket: string;
      key: string;
    };
  };
  logoNotes?: string;
};

type DraftPayload = {
  builderMode?: BuilderMode;
  wizardStep?: WizardStep;
  productName?: string;
  asin?: string;
  contentTier?: ContentTier;
  productOneLiner?: string;
  targetCustomer?: string;
  pricePoint?: string;
  keyFeatures?: string;
  differentiators?: string;
  objections?: string;
  brandColors?: string;
  logoNotes?: string;
  brandVoice?: string;
  brandFontNotes?: string;
  brandLogoAssetId?: string;
  rawNotes?: string;
  sources?: SourceLink[];
  assets?: AssetLibraryItem[];
  /**
   * The authoritative document (redesign §4). Older drafts carry only
   * `generatedPackage`, which is lifted into an Experience on load; newer
   * drafts persist both (generatedPackage = the compiled deployment, kept so
   * older app versions can still open the draft).
   */
  experience?: Experience;
  generationMeta?: GenerationMeta;
  generatedPackage?: GeneratedAPlusResponse;
  /** "Creativity" level sent to generation (temperature under the hood). */
  creativity?: APlusCreativity;
  /** Advanced-mode seller guidance appended to the generation prompts. */
  guidance?: APlusGuidance;
  /** True once the user hand-edits generated content (regenerate warns). */
  hasManualEdits?: boolean;
};

type GeneratedAPlusPackage = {
  title: string;
  executiveSummary: string;
  creativeDirection: {
    positioning: string;
    visualSystem: string;
    mobilePrinciple: string;
    imagePlan: string;
  };
  assumptions: string[];
  modules: GeneratedModule[];
  sellerCentralBuildSheet: Array<{
    step: string;
    value: string;
  }>;
  qualityChecklist: string[];
};

/**
 * Generation-run artifacts that aren't part of the editable Experience:
 * model/run reporting plus package-level notes shown in the rationale panel.
 */
type GenerationMeta = {
  strategy?: unknown;
  runConfig?: GeneratedAPlusResponse['runConfig'];
  imageGeneration?: GeneratedAPlusResponse['imageGeneration'];
  modelRuns?: GeneratedAPlusResponse['modelRuns'];
  assumptions?: string[];
  sellerCentralBuildSheet?: Array<{ step: string; value: string }>;
  qualityChecklist?: string[];
};

type GeneratedAPlusResponse = {
  strategy: unknown;
  package: GeneratedAPlusPackage;
  /** Which A/B paths actually ran for this generation. */
  runConfig?: {
    generationMode: string;
    imageVariant: string;
    model: string;
    creativity?: string;
  };
  imageGeneration: {
    enabled: boolean;
    results: unknown[];
  };
  modelRuns: Array<{
    role: string;
    provider: string;
    modelId: string;
  }>;
};

/**
 * Rewrites legacy app-invented Amazon module type codes (STANDARD_DUAL_USE_SPLIT,
 * STANDARD_ICON_ROW) to a real Seller Central type on draft load. The render
 * kind (`type`) is untouched, so legacy layouts still render and PNG-export.
 * Never throws — a malformed package is returned as-is rather than blocking
 * the draft from loading.
 */
function normalizeGeneratedPackage(
  response: GeneratedAPlusResponse
): GeneratedAPlusResponse {
  try {
    return {
      ...response,
      package: {
        ...response.package,
        modules: response.package.modules.map((module) => ({
          ...module,
          amazonModuleType: normalizeAmazonModuleType(module.amazonModuleType),
        })),
      },
    };
  } catch {
    return response;
  }
}

function summarizeBrandGuideColors(guide: BrandGuide | null) {
  if (!guide) return '';
  if (guide.colors?.trim()) return guide.colors.trim();

  const palette = [
    guide.palette?.primaryForeground
      ? `Primary foreground ${guide.palette.primaryForeground}`
      : null,
    guide.palette?.secondaryForeground
      ? `Secondary foreground ${guide.palette.secondaryForeground}`
      : null,
    guide.palette?.background ? `Background ${guide.palette.background}` : null,
  ].filter(Boolean);

  return palette.join(', ');
}

function summarizeBrandGuideFonts(guide: BrandGuide | null) {
  if (!guide) return '';

  const fonts = [
    guide.fonts?.primary ? `Primary ${guide.fonts.primary}` : null,
    guide.fonts?.secondary ? `Secondary ${guide.fonts.secondary}` : null,
    guide.fonts?.accent ? `Accent ${guide.fonts.accent}` : null,
  ].filter(Boolean);

  return fonts.join(', ');
}

function summarizeBrandGuideLogoNotes(guide: BrandGuide | null) {
  if (!guide) return '';

  const details = [
    guide.logoAsset?.originalFileName
      ? `Use uploaded logo asset ${guide.logoAsset.originalFileName}`
      : null,
    guide.logoNotes?.trim() || null,
  ].filter(Boolean);

  return details.join('. ');
}

function getBrandGuidePaletteEntries(guide: BrandGuide | null) {
  if (!guide) return [];

  return [
    {
      label: 'Primary',
      color: guide.palette?.primaryForeground || '',
      textColor: guide.palette?.background || '#ffffff',
    },
    {
      label: 'Secondary',
      color: guide.palette?.secondaryForeground || '',
      textColor: guide.palette?.background || '#ffffff',
    },
    {
      label: 'Background',
      color: guide.palette?.background || '',
      textColor: guide.palette?.primaryForeground || '#111827',
    },
  ].filter((entry) => entry.color);
}

function getBrandGuideFontEntries(guide: BrandGuide | null) {
  if (!guide) return [];

  return [
    {
      label: 'Primary',
      name: guide.fonts?.primary || '',
      sample: 'Aa',
    },
    {
      label: 'Secondary',
      name: guide.fonts?.secondary || '',
      sample: 'The quick brown fox',
    },
    {
      label: 'Accent',
      name: guide.fonts?.accent || '',
      sample: '123 ABC',
    },
  ].filter((entry) => entry.name);
}

function fontPreviewStyle(fontName?: string) {
  const normalized = fontName?.trim();
  return normalized
    ? {
        fontFamily: `"${normalized}", ui-sans-serif, system-ui, sans-serif`,
      }
    : undefined;
}

function normalizeFontName(value?: string) {
  return (
    value
      ?.trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\s+/g, ' ') || ''
  );
}

function googleFontHref(fontName?: string) {
  const normalized = normalizeFontName(fontName);
  if (!normalized) return '';
  const family = normalized.split(' ').filter(Boolean).join('+');
  return `https://fonts.googleapis.com/css2?family=${family}:wght@400;500;600;700&display=swap`;
}

function mergeGuideIntoDraftPayload(
  payload: DraftPayload,
  guide: BrandGuide | null
): DraftPayload {
  if (!guide) return payload;

  return {
    ...payload,
    brandColors:
      payload.brandColors !== undefined && payload.brandColors.trim()
        ? payload.brandColors
        : summarizeBrandGuideColors(guide),
    brandVoice:
      payload.brandVoice !== undefined && payload.brandVoice.trim()
        ? payload.brandVoice
        : guide.voice || '',
    logoNotes:
      payload.logoNotes !== undefined && payload.logoNotes.trim()
        ? payload.logoNotes
        : summarizeBrandGuideLogoNotes(guide),
    brandFontNotes:
      payload.brandFontNotes !== undefined && payload.brandFontNotes.trim()
        ? payload.brandFontNotes
        : summarizeBrandGuideFonts(guide),
    brandLogoAssetId:
      payload.brandLogoAssetId !== undefined && payload.brandLogoAssetId.trim()
        ? payload.brandLogoAssetId
        : guide.logoAsset?.assetId || '',
  };
}

const APLUS_AUTOSAVE_KEY = 'sellavant:a-plus:autosave-v1';

// Fixed module-copy rules shown read-only in the guidance overlay.
const MODULE_COPY_RULES_PREVIEW = buildModuleCopyRulesPreview();

const DEFAULT_SOURCES: SourceLink[] = [
  { id: 1, kind: 'Product listing', url: '' },
  { id: 2, kind: 'Competitor', url: '' },
  { id: 3, kind: 'Supplier', url: '' },
];

const SOURCE_KINDS: SourceKind[] = [
  'Product listing',
  'Competitor',
  'Supplier',
  'Reference',
];

const SIMPLE_WIZARD_STEPS: Array<{
  id: WizardStep;
  title: string;
  body: string;
}> = [
  {
    id: 'basics',
    title: 'Basics',
    body: 'Product, brand, and the core brief.',
  },
  {
    id: 'sources',
    title: 'Sources',
    body: 'Links and messy inputs the AI should learn from.',
  },
  {
    id: 'assets',
    title: 'Assets',
    body: 'Drop product images and let AI decide how to use them.',
  },
  {
    id: 'review',
    title: 'Review',
    body: 'Generate the actual A+ package and build sheet.',
  },
];

const FIELD_CLASSNAME =
  'border-border/80 bg-card shadow-sm transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20';
const SELECT_CLASSNAME = cn(
  'h-10 w-full rounded-md border px-3 text-sm',
  FIELD_CLASSNAME
);
const COMPACT_SELECT_CLASSNAME = cn(
  'h-10 min-w-0 rounded-md border px-3 text-sm',
  FIELD_CLASSNAME
);
const TEXTAREA_CLASSNAME = cn(
  'border-border/80 bg-card shadow-sm transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20'
);

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match?.[0] ?? null;
}

function formatDraftOption(draft: DraftSummary): string {
  const product = draft.productName?.trim() || draft.asin?.trim();
  const date = new Date(draft.updatedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return [draft.name, product, date].filter(Boolean).join(' · ');
}

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer()
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function sourceStatusClass(status: SourceCheck['status']) {
  if (status === 'accessible') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (status === 'blocked' || status === 'invalid') {
    return 'border-red-200 bg-red-50 text-red-800';
  }
  if (status === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  return 'border-border bg-muted text-muted-foreground';
}

function sourceExtractionStatusClass(status: SourceExtraction['status']) {
  if (status === 'extracted') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (status === 'error') {
    return 'border-red-200 bg-red-50 text-red-800';
  }
  if (status === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  return 'border-border bg-muted text-muted-foreground';
}

function appendUniqueText(current: string, heading: string, lines: string[]) {
  const cleanedLines = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!cleanedLines.length) return current;

  const block = [heading, ...cleanedLines.map((line) => `- ${line}`)].join(
    '\n'
  );
  if (current.includes(heading)) return current;
  return current.trim() ? `${current.trim()}\n\n${block}` : block;
}

function cleanAPlusDisplayText(text: string): string {
  return applyAPlusGuardrails(text).cleaned;
}

function cleanAPlusDisplayLines(lines: string[]): string[] {
  return lines.map(cleanAPlusDisplayText).filter(Boolean);
}

function prepareGeneratedImagePrompt(
  prompt: string,
  forbiddenText: string[],
  productContext?: string
) {
  const specificForbiddenText = forbiddenText.length
    ? ` Do not render these exact strings anywhere in the image: ${forbiddenText
        .map((item) => `"${item}"`)
        .join(', ')}.`
    : '';

  return [
    // A slot brief regenerated on its own carries no surrounding module/shot
    // context, so always restate WHAT the product is — without this the image
    // model invents a subject (famously: an office printer for coffee cups).
    ...(productContext
      ? [`THE HERO PRODUCT IN THIS SHOT: ${productContext}`, '']
      : []),
    prompt,
    '',
    `Important image rule: do not render brand names, brand badges, logos, brand lockups, watermarks, product labels with brand names, or readable brand marks anywhere in the image.${specificForbiddenText} Leave any brand/logo placement as an empty logo-safe area for later editing.`,
  ].join('\n');
}

export function APlusEditor({
  initialDraftId,
  isNew,
}: {
  initialDraftId?: string;
  isNew?: boolean;
}) {
  const router = useRouter();
  const [builderMode, setBuilderMode] = useState<BuilderMode>('simple');
  const [wizardStep, setWizardStep] = useState<WizardStep>('basics');
  const [productName, setProductName] = useState('');
  const [asin, setAsin] = useState('');
  const [contentTier, setContentTier] = useState<ContentTier>('Basic A+');
  const [productOneLiner, setProductOneLiner] = useState('');
  const [targetCustomer, setTargetCustomer] = useState('');
  const [pricePoint, setPricePoint] = useState('');
  const [keyFeatures, setKeyFeatures] = useState('');
  const [differentiators, setDifferentiators] = useState('');
  const [objections, setObjections] = useState('');
  const [brandColors, setBrandColors] = useState('');
  const [logoNotes, setLogoNotes] = useState('');
  const [brandVoice, setBrandVoice] = useState('');
  const [brandFontNotes, setBrandFontNotes] = useState('');
  const [brandLogoAssetId, setBrandLogoAssetId] = useState('');
  const [rawNotes, setRawNotes] = useState('');
  const [rebuildingNotes, setRebuildingNotes] = useState(false);
  const [assetLibrary, setAssetLibrary] = useState<AssetLibraryItem[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('Untitled A+ draft');
  const [brandGuideId, setBrandGuideId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [brandGuides, setBrandGuides] = useState<BrandGuide[]>([]);
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'loading' | 'saving' | 'saved' | 'error'
  >('idle');
  const [sources, setSources] = useState<SourceLink[]>(DEFAULT_SOURCES);
  const [sourceChecks, setSourceChecks] = useState<Record<number, SourceCheck>>(
    {}
  );
  const [sourceExtractions, setSourceExtractions] = useState<
    Record<number, SourceExtraction>
  >({});
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<
    'idle' | 'generating' | 'generated' | 'error'
  >('idle');
  const [generateError, setGenerateError] = useState('');
  const [generationProgress, setGenerationProgress] = useState<{
    phase?:
      | 'strategy'
      | 'package-outer'
      | 'package-modules'
      | 'images'
      | 'finalizing';
    moduleSpecs?: Array<{
      order: number;
      amazonModuleType: string;
      title: string;
    }>;
    moduleStatus?: Record<number, 'pending' | 'done' | 'failed'>;
    startedAt?: number;
    elapsedMs?: number;
  }>({});
  // The authoritative document: everything the user edits lives here; the
  // Amazon deployment below is always derived from it.
  const [experience, setExperience] = useState<Experience | null>(null);
  const [generationMeta, setGenerationMeta] = useState<GenerationMeta | null>(
    null
  );
  const [previewViewport, setPreviewViewport] =
    useState<PreviewViewport>('desktop');
  const [designStyle, setDesignStyle] = useState<DesignStyleKey>('editorial');
  const [generationModel, setGenerationModel] = useState<string>(
    APLUS_GENERATION_MODELS[0]?.id ?? 'anthropic/claude-haiku-4.5'
  );
  // "Creativity" (Low/Medium/High) — maps to sampling temperature server-side.
  const [creativity, setCreativity] = useState<APlusCreativity>('medium');
  // Advanced-mode seller guidance appended to the generation prompts.
  const [guidanceStrategy, setGuidanceStrategy] = useState('');
  const [guidanceModuleCopy, setGuidanceModuleCopy] = useState('');
  // True once generated module copy has been hand-edited (regenerate warns).
  const [hasManualEdits, setHasManualEdits] = useState(false);
  const [imageJobResults, setImageJobResults] = useState<
    Record<string, ImageJobResult>
  >({});
  // Draft mode generates cheap low-quality images for fast iteration; turn off
  // for full-quality finals. (Only the gpt-image-1 backend honors quality.)
  const [draftImages, setDraftImages] = useState(false);
  // Full-resolution image opened from a library thumbnail (null = closed).
  const [previewImage, setPreviewImage] = useState<{
    assetId: string;
    fileName: string;
  } | null>(null);
  const [loadedFonts, setLoadedFonts] = useState<Record<string, boolean>>({});
  const selectedBrandGuide =
    brandGuides.find((guide) => guide.brandGuideId === brandGuideId) || null;
  const designTheme = useMemo(
    () =>
      brandThemeFrom(
        selectedBrandGuide
          ? {
              brandName:
                selectedBrandGuide.brandName || selectedBrandGuide.name,
              palette: selectedBrandGuide.palette,
              fonts: selectedBrandGuide.fonts,
              logoUrl: selectedBrandGuide.logoAsset
                ? `/api/a-plus/assets/${selectedBrandGuide.logoAsset.assetId}`
                : undefined,
            }
          : null,
        designStyle
      ),
    [selectedBrandGuide, designStyle]
  );
  const imageForbiddenText = useMemo(
    () =>
      Array.from(
        new Set(
          [selectedBrandGuide?.brandName, selectedBrandGuide?.name]
            .map((value) => value?.trim())
            .filter((value): value is string =>
              Boolean(value && value.length > 2)
            )
        )
      ),
    [selectedBrandGuide?.brandName, selectedBrandGuide?.name]
  );
  // Compact product identity prepended to every image-generation prompt so a
  // slot regenerated on its own still knows what the product is.
  const imageProductContext = useMemo(() => {
    const facts = keyFeatures
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join('; ');
    return [
      productName.trim() || 'the product described below',
      productOneLiner.trim(),
      facts ? `Key physical facts: ${facts}` : '',
    ]
      .filter(Boolean)
      .join('. ')
      .slice(0, 500);
  }, [keyFeatures, productName, productOneLiner]);

  const brandGuideFontsToPreview = useMemo(
    () =>
      Array.from(
        new Set(
          [
            selectedBrandGuide?.fonts?.primary,
            selectedBrandGuide?.fonts?.secondary,
            selectedBrandGuide?.fonts?.accent,
          ]
            .map((font) => normalizeFontName(font))
            .filter(Boolean)
        )
      ),
    [
      selectedBrandGuide?.fonts?.accent,
      selectedBrandGuide?.fonts?.primary,
      selectedBrandGuide?.fonts?.secondary,
    ]
  );

  const libraryAssetCount = assetLibrary.filter(
    (item) =>
      item.uploadStatus === 'uploaded' || item.uploadStatus === 'duplicate'
  ).length;
  const productListingSource =
    sources.find((source) => source.kind === 'Product listing') || sources[0];
  const productListingExtraction = productListingSource
    ? sourceExtractions[productListingSource.id]
    : undefined;

  // The Amazon deployment is a pure derivation of the Experience — recompiled
  // live on every edit/reorder (the compiler is framework-free and cheap).
  const deployment = useMemo(
    () =>
      experience
        ? compileExperienceToAplus(experience, { tier: contentTier })
        : null,
    [contentTier, experience]
  );

  // Back/forward-compat view of the generated package: older app versions
  // read payload.generatedPackage, so keep writing it from the compiled state.
  const compatGeneratedPackage = useMemo<GeneratedAPlusResponse | null>(() => {
    if (!experience || !deployment) return null;
    return {
      strategy: generationMeta?.strategy ?? null,
      package: {
        title: experience.title,
        executiveSummary: experience.goal,
        creativeDirection: experience.artDirection,
        assumptions: generationMeta?.assumptions ?? [],
        modules: deployment.modules,
        sellerCentralBuildSheet: generationMeta?.sellerCentralBuildSheet ?? [],
        qualityChecklist: generationMeta?.qualityChecklist ?? [],
      },
      runConfig: generationMeta?.runConfig,
      imageGeneration: generationMeta?.imageGeneration ?? {
        enabled: false,
        results: [],
      },
      modelRuns: generationMeta?.modelRuns ?? [],
    };
  }, [deployment, experience, generationMeta]);

  const currentDraftPayload = useMemo<DraftPayload>(
    () => ({
      builderMode,
      wizardStep,
      productName,
      asin,
      contentTier,
      productOneLiner,
      targetCustomer,
      pricePoint,
      keyFeatures,
      differentiators,
      objections,
      brandColors,
      logoNotes,
      brandVoice,
      brandFontNotes,
      brandLogoAssetId,
      rawNotes,
      sources,
      assets: assetLibrary,
      experience: experience ?? undefined,
      generationMeta: generationMeta ?? undefined,
      generatedPackage: compatGeneratedPackage ?? undefined,
      creativity,
      guidance: {
        strategy: guidanceStrategy.trim() || undefined,
        moduleCopy: guidanceModuleCopy.trim() || undefined,
      },
      hasManualEdits: hasManualEdits || undefined,
    }),
    [
      asin,
      brandColors,
      brandFontNotes,
      brandVoice,
      builderMode,
      compatGeneratedPackage,
      contentTier,
      creativity,
      differentiators,
      experience,
      generationMeta,
      guidanceModuleCopy,
      guidanceStrategy,
      hasManualEdits,
      keyFeatures,
      logoNotes,
      brandLogoAssetId,
      assetLibrary,
      objections,
      pricePoint,
      productName,
      productOneLiner,
      rawNotes,
      sources,
      targetCustomer,
      wizardStep,
    ]
  );

  // The exact POST body sent to /api/a-plus/generate. Factored into a memo so
  // the guidance overlay's prompt preview and the actual request can't drift.
  const generateRequestBody = useMemo(
    () => ({
      productName,
      asin,
      model: generationModel,
      contentTier,
      creativity,
      guidance: {
        strategy: guidanceStrategy.trim() || undefined,
        moduleCopy: guidanceModuleCopy.trim() || undefined,
      },
      rawNotes,
      productOneLiner,
      targetCustomer,
      pricePoint,
      keyFeatures,
      differentiators,
      objections,
      brand: {
        name: selectedBrandGuide?.name,
        brandName: selectedBrandGuide?.brandName,
        colors: brandColors,
        fonts: brandFontNotes,
        voice: brandVoice,
        logoNotes,
        logoAssetId: brandLogoAssetId,
      },
      sources,
      assets: assetLibrary,
    }),
    [
      asin,
      brandColors,
      brandFontNotes,
      brandVoice,
      contentTier,
      creativity,
      differentiators,
      generationModel,
      guidanceModuleCopy,
      guidanceStrategy,
      keyFeatures,
      logoNotes,
      brandLogoAssetId,
      assetLibrary,
      objections,
      pricePoint,
      productName,
      productOneLiner,
      rawNotes,
      selectedBrandGuide,
      sources,
      targetCustomer,
    ]
  );

  // The real Phase-1 strategy prompt the generator runs (shown read-only in
  // the guidance overlay), built from the same request body it will receive.
  const strategyPromptPreview = useMemo(
    () =>
      buildStrategyPrompt({
        contextJson: compactGenerationInput(generateRequestBody),
        moduleCount: aplusModuleLimitForTier(contentTier),
        guidance: guidanceStrategy,
      }),
    [contentTier, generateRequestBody, guidanceStrategy]
  );

  const packageJson = useMemo(
    () => ({
      contentDocument: {
        name: productName || 'Untitled A+ content package',
        contentType: 'EMC',
        tier: contentTier,
        locale: 'en-US',
        asinSet: asin ? [asin] : [],
        sourceLinks: sources.filter((source) => source.url.trim()),
        brandVoice,
        rawNotes,
        uploadedAssets: assetLibrary.map((item) => ({
          id: item.id,
          fileName: item.fileName,
          description: item.description,
          assetId: item.asset?.assetId || null,
          sha256: item.asset?.hashes.sha256 || null,
          storage: item.asset?.storage || null,
          status: item.uploadStatus,
        })),
        // The build sheet is derived from the COMPILED deployment (including
        // any hand edits), so it always matches what the preview shows.
        contentModuleList: (deployment?.modules ?? []).map((module) => ({
          order: module.order,
          contentModuleType: module.amazonModuleType,
          title: module.title,
          textFields: moduleTextFields(module),
          imageSlots: moduleImageSlots(module).map((slot) => ({
            role: slot.role,
            size: slot.size,
            alt: slot.alt,
            url: slot.image?.url ?? null,
          })),
        })),
        // Which sections produced which Amazon modules (incl. slice stacks).
        deployment: deployment
          ? {
              moduleMapping: deployment.moduleMapping,
              validation: deployment.validation,
            }
          : null,
      },
      workflow: {
        apiPossible: true,
        aiPrompt: strategyPromptPreview,
        creativity,
        guidance: {
          strategy: guidanceStrategy.trim() || null,
          moduleCopy: guidanceModuleCopy.trim() || null,
        },
        brandGuide: selectedBrandGuide
          ? {
              brandGuideId: selectedBrandGuide.brandGuideId,
              name: selectedBrandGuide.name,
              brandName: selectedBrandGuide.brandName || null,
              palette: selectedBrandGuide.palette || null,
              fonts: selectedBrandGuide.fonts || null,
              voice: selectedBrandGuide.voice || null,
              logoAsset: selectedBrandGuide.logoAsset
                ? {
                    assetId: selectedBrandGuide.logoAsset.assetId,
                    fileName: selectedBrandGuide.logoAsset.originalFileName,
                    mimeType: selectedBrandGuide.logoAsset.mimeType,
                    storage: selectedBrandGuide.logoAsset.storage,
                  }
                : null,
              logoNotes: selectedBrandGuide.logoNotes || null,
            }
          : null,
        discoveryInputs: {
          productOneLiner,
          targetCustomer,
          pricePoint,
          keyFeatures,
          differentiators,
          objections,
          brandColors,
          brandFontNotes,
          logoNotes,
          brandLogoAssetId,
        },
        nextApiSteps: [
          'Create upload destinations for final images with the Uploads API.',
          'Insert returned uploadDestinationId values into the A+ content document.',
          'Validate content and ASIN relations.',
          'Create or update the content document.',
          'Attach ASINs and submit for approval.',
        ],
      },
    }),
    [
      asin,
      brandColors,
      brandFontNotes,
      brandVoice,
      contentTier,
      creativity,
      deployment,
      differentiators,
      guidanceModuleCopy,
      guidanceStrategy,
      keyFeatures,
      logoNotes,
      brandLogoAssetId,
      assetLibrary,
      objections,
      pricePoint,
      productName,
      productOneLiner,
      rawNotes,
      selectedBrandGuide,
      sources,
      strategyPromptPreview,
      targetCustomer,
    ]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadSavedWork() {
      setSaveStatus('loading');
      try {
        const [draftResponse, brandGuideResponse] = await Promise.all([
          fetch('/api/a-plus/drafts'),
          fetch('/api/a-plus/brand-guides'),
        ]);

        if (!draftResponse.ok || !brandGuideResponse.ok) {
          throw new Error('Could not load saved A+ work.');
        }

        const draftBody = (await draftResponse.json()) as {
          drafts?: DraftSummary[];
        };
        const brandGuideBody = (await brandGuideResponse.json()) as {
          brandGuides?: BrandGuide[];
        };

        if (!cancelled) {
          setDrafts(draftBody.drafts || []);
          setBrandGuides(brandGuideBody.brandGuides || []);
          setSaveStatus('idle');
        }
      } catch {
        if (!cancelled) setSaveStatus('error');
      }
    }

    void loadSavedWork();
    return () => {
      cancelled = true;
    };
  }, []);

  // The route decides what to edit: /a-plus/<draftId> loads that saved design
  // from the database; /a-plus/new starts a blank one. Re-runs if the route
  // param changes (navigating between designs reuses this component).
  useEffect(() => {
    if (initialDraftId) {
      void loadDraft(initialDraftId);
    } else if (isNew) {
      newDraft();
    }
  }, [initialDraftId, isNew]);

  // Debounced autosave of the current inputs to localStorage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handle = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          APLUS_AUTOSAVE_KEY,
          JSON.stringify({ draftId, payload: currentDraftPayload })
        );
      } catch {
        // Storage may be full or blocked; ignore.
      }
    }, 600);
    return () => window.clearTimeout(handle);
  }, [currentDraftPayload, draftId]);

  // Persist the generated design to the database whenever it changes (after a
  // generation completes, or as slot images fill in). Debounced + silent so it
  // doesn't churn the visible save indicator. The first save creates the draft
  // row; subsequent saves update it via the returned draftId.
  useEffect(() => {
    if (!experience) return;
    const handle = window.setTimeout(() => {
      void saveDraft({ silent: true });
    }, 1200);
    return () => window.clearTimeout(handle);
  }, [experience]);

  useEffect(() => {
    if (generateStatus !== 'generating' || !generationProgress.startedAt) {
      return;
    }
    const interval = setInterval(() => {
      setGenerationProgress((p) =>
        p.startedAt ? { ...p, elapsedMs: Date.now() - p.startedAt } : p
      );
    }, 500);
    return () => clearInterval(interval);
  }, [generateStatus, generationProgress.startedAt]);

  useEffect(() => {
    if (typeof document === 'undefined' || !brandGuideFontsToPreview.length) {
      return;
    }

    brandGuideFontsToPreview.forEach((fontName) => {
      if (fontName in loadedFonts) return;

      const href = googleFontHref(fontName);
      if (!href) return;

      const existing = document.querySelector<HTMLLinkElement>(
        `link[data-sellavant-a-plus-font="${fontName}"]`
      );

      if (!existing) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.sellavantAPlusFont = fontName;
        document.head.appendChild(link);
      }

      void document.fonts
        .load(`16px "${fontName}"`)
        .then(() => {
          setLoadedFonts((current) => ({ ...current, [fontName]: true }));
        })
        .catch(() => {
          setLoadedFonts((current) => ({ ...current, [fontName]: false }));
        });
    });
  }, [brandGuideFontsToPreview, loadedFonts]);

  function updateAssetLibraryItem(
    itemId: string,
    patch: Partial<AssetLibraryItem>
  ) {
    setAssetLibrary((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
    );
  }

  function removeAssetLibraryItem(itemId: string) {
    setAssetLibrary((current) => current.filter((item) => item.id !== itemId));
  }

  /**
   * Vision-profile an uploaded asset: detects role/composition/affordances and a
   * factual description (redesign §3a). Auto-runs after upload; `force` (manual
   * "Re-profile") re-runs it. Fills the description field only when it's blank
   * (unless forced), so it never clobbers seller text.
   */
  async function profileAsset(itemId: string, assetId: string, force = false) {
    setAssetLibrary((current) =>
      current.map((item) =>
        item.id === itemId ? { ...item, profiling: true } : item
      )
    );
    try {
      const response = await fetch('/api/a-plus/assets/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId }),
      });
      const body = (await response.json()) as {
        profile?: AssetProfileData;
        error?: string;
      };
      setAssetLibrary((current) =>
        current.map((item) => {
          if (item.id !== itemId) return item;
          if (!response.ok || !body.profile) {
            return { ...item, profiling: false };
          }
          const keepTyped = !force && item.description.trim().length > 0;
          return {
            ...item,
            profiling: false,
            profile: body.profile,
            description: keepTyped
              ? item.description
              : body.profile.description || item.description,
          };
        })
      );
    } catch {
      updateAssetLibraryItem(itemId, { profiling: false });
    }
  }

  async function uploadLibraryAsset(file: File) {
    // Unique per item — a batch drop runs in one tick, so Date.now() collides
    // and same-named files would share a React key (and collapse to one row).
    const itemId = crypto.randomUUID();
    // Prepend so the new row is immediately visible under the dropzone (with its
    // progress/duplicate/error status) instead of appended below the fold.
    setAssetLibrary((current) => [
      {
        id: itemId,
        fileName: file.name,
        description: '',
        file,
        uploadStatus: 'hashing',
        uploadMessage: 'Reading image…',
      },
      ...current,
    ]);

    await uploadLibraryAssetById(itemId, file);
  }

  async function uploadLibraryAssetById(itemId: string, file: File) {
    try {
      // Determine the image type up front (browser type → extension → content
      // sniff). A file with no extension and no detectable image signature is
      // surfaced as an error row, never silently dropped.
      const mimeType = await resolveImageMime(file);
      if (!mimeType) {
        updateAssetLibraryItem(itemId, {
          uploadStatus: 'error',
          uploadMessage: 'Not a recognized image file.',
          uploadAction:
            'Use a JPG, PNG, WebP, GIF, AVIF, HEIC, BMP, or TIFF image.',
        });
        return;
      }

      const sha256 = await sha256File(file);
      updateAssetLibraryItem(itemId, {
        uploadStatus: 'uploading',
        uploadMessage: 'Checking for duplicates...',
        uploadAction: undefined,
        uploadErrorCode: undefined,
      });

      const preflightResponse = await fetch('/api/a-plus/assets/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType,
          sizeBytes: file.size,
          sha256,
        }),
      });

      const preflight = (await preflightResponse.json()) as {
        error?: string;
        action?: string;
        code?: string;
        duplicate?: boolean;
        asset?: UploadedAsset;
        upload?: {
          method: 'PUT';
          url: string;
          headers: Record<string, string>;
        };
      };

      if (!preflightResponse.ok || preflight.error || !preflight.asset) {
        throw new Error(
          [
            preflight.error || 'Asset preflight failed.',
            preflight.action || '',
            preflight.code ? `code:${preflight.code}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        );
      }

      if (preflight.duplicate) {
        updateAssetLibraryItem(itemId, {
          asset: preflight.asset,
          uploadStatus: 'duplicate',
          uploadMessage: 'Duplicate found. Reusing existing uploaded asset.',
          uploadAction: undefined,
          uploadErrorCode: undefined,
        });
        void profileAsset(itemId, preflight.asset.assetId);
        return;
      }

      if (!preflight.upload) {
        throw new Error('Upload instructions were not returned.');
      }

      updateAssetLibraryItem(itemId, {
        uploadStatus: 'uploading',
        uploadMessage: 'Uploading image to S3...',
        uploadAction: undefined,
        uploadErrorCode: undefined,
      });

      const uploadResponse = await fetch(preflight.upload.url, {
        method: preflight.upload.method,
        headers: preflight.upload.headers,
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error(`S3 upload failed with HTTP ${uploadResponse.status}.`);
      }

      const confirmResponse = await fetch('/api/a-plus/assets/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: preflight.asset.assetId }),
      });
      const confirmed = (await confirmResponse.json()) as {
        error?: string;
        asset?: UploadedAsset;
      };

      if (!confirmResponse.ok || confirmed.error || !confirmed.asset) {
        throw new Error(confirmed.error || 'Asset confirmation failed.');
      }

      updateAssetLibraryItem(itemId, {
        asset: confirmed.asset,
        uploadStatus: 'uploaded',
        uploadMessage: 'Uploaded and fingerprinted.',
        uploadAction: undefined,
        uploadErrorCode: undefined,
      });
      void profileAsset(itemId, confirmed.asset.assetId);
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : 'Image upload failed.';
      const [message, action, codeLine] = rawMessage.split('\n');
      updateAssetLibraryItem(itemId, {
        uploadStatus: 'error',
        uploadMessage: message || 'Image upload failed.',
        uploadAction: action || undefined,
        uploadErrorCode: codeLine?.startsWith('code:')
          ? codeLine.replace('code:', '')
          : undefined,
      });
    }
  }

  function uploadLibraryFiles(fileList: FileList | File[]) {
    // Accept every dropped file — image detection (incl. extensionless files
    // via content sniffing) and any rejection happen per-file in the upload,
    // so nothing is ever silently discarded.
    [...fileList].forEach((file) => void uploadLibraryAsset(file));
  }

  function applyContentTier(nextTier: ContentTier) {
    setContentTier(nextTier);
  }

  /** Applies an edit to one section of the Experience (single source of truth). */
  function updateSection(
    sectionId: string,
    update: (
      section: Experience['sections'][number]
    ) => Experience['sections'][number]
  ) {
    setExperience((current) => {
      if (!current) return current;
      let changed = false;
      const sections = current.sections.map((section) => {
        if (section.id !== sectionId) return section;
        const next = update(section);
        if (next !== section) changed = true;
        return next;
      });
      if (!changed) return current;
      return { ...current, sections };
    });
  }

  function updateSectionText(
    sectionId: string,
    path: APlusTextFieldPath,
    value: string
  ) {
    updateSection(sectionId, (section) =>
      setSectionTextField(section, path, value)
    );
    setHasManualEdits(true);
  }

  function updateSectionNotes(sectionId: string, value: string) {
    updateSection(sectionId, (section) => ({
      ...section,
      notes: value.trim() ? value : undefined,
    }));
  }

  function toggleSectionLock(sectionId: string) {
    updateSection(sectionId, (section) => ({
      ...section,
      locked: !section.locked,
    }));
  }

  /** Reorders a section within the narrative; the deployment recompiles live. */
  function moveSection(sectionId: string, direction: -1 | 1) {
    setExperience((current) => {
      if (!current) return current;
      const ordered = [...current.sections].sort((a, b) => a.order - b.order);
      const index = ordered.findIndex((section) => section.id === sectionId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) {
        return current;
      }
      const swapped = [...ordered];
      [swapped[index], swapped[nextIndex]] = [
        swapped[nextIndex],
        swapped[index],
      ];
      return {
        ...current,
        sections: swapped.map((section, position) => ({
          ...section,
          order: position + 1,
        })),
      };
    });
    setHasManualEdits(true);
  }

  function updateExperienceTitle(value: string) {
    setExperience((current) =>
      current ? { ...current, title: value } : current
    );
    setHasManualEdits(true);
  }

  function updateExperienceGoal(value: string) {
    setExperience((current) =>
      current ? { ...current, goal: value } : current
    );
    setHasManualEdits(true);
  }

  function addSource() {
    setSources((current) => [
      ...current,
      { id: Date.now(), kind: 'Reference', url: '' },
    ]);
  }

  function updateSource(id: number, patch: Partial<SourceLink>) {
    setSources((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  async function checkSource(source: SourceLink) {
    const trimmedUrl = source.url.trim();
    if (!trimmedUrl) return;

    setSourceChecks((current) => ({
      ...current,
      [source.id]: { status: 'checking', message: 'Checking source...' },
    }));

    try {
      const response = await fetch('/api/a-plus/source-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmedUrl }),
      });
      const result = (await response.json()) as SourceCheck;
      setSourceChecks((current) => ({
        ...current,
        [source.id]: result,
      }));
    } catch {
      setSourceChecks((current) => ({
        ...current,
        [source.id]: {
          status: 'warning',
          message: 'Could not check this source.',
        },
      }));
    }
  }

  function mergeSourceFacts(
    source: SourceLink,
    facts: SourceExtraction['facts'],
    options: { overwrite?: boolean } = {}
  ) {
    if (!facts) return;
    const overwrite = options.overwrite === true;

    const isProductListing = source.kind === 'Product listing';
    if (isProductListing) {
      if ((!productName.trim() || overwrite) && facts.productName) {
        setProductName(facts.productName);
      }
      if ((!asin.trim() || overwrite) && facts.asin) {
        setAsin(facts.asin);
      }
    }

    if ((!productOneLiner.trim() || overwrite) && facts.oneLiner) {
      setProductOneLiner(facts.oneLiner);
    }
    // A+ content never shows price, and auto-extracted prices are frequently
    // wrong, so we deliberately do NOT pull price into the brief.
    if ((!keyFeatures.trim() || overwrite) && facts.features.length) {
      setKeyFeatures(facts.features.join('\n'));
    }
    if (
      (!differentiators.trim() || overwrite) &&
      facts.differentiators.length
    ) {
      setDifferentiators(facts.differentiators.join('\n'));
    }

    const baseEvidence = facts.evidence.length
      ? facts.evidence
      : ([
          facts.productName ? `Product: ${facts.productName}` : null,
          facts.oneLiner ? `Summary: ${facts.oneLiner}` : null,
          ...facts.features.map((feature) => `Feature: ${feature}`),
        ].filter(Boolean) as string[]);
    // A+ never uses price — keep it out of the notes the AI reads.
    const evidence = baseEvidence.filter((line) => !/^\s*price\b/i.test(line));

    const displayUrl = facts.finalUrl || source.url;
    // Only the Product listing describes OUR product. Mark every other source
    // as a different product so the AI never copies a competitor's attributes
    // (color, size, materials, pack count) into our copy or image briefs.
    const sourceHeader =
      source.kind === 'Product listing'
        ? `Source facts from ${source.kind}: ${displayUrl}`
        : `Source facts from ${source.kind} — DIFFERENT product, for comparison/positioning ONLY (do NOT describe our product with these): ${displayUrl}`;
    setRawNotes((current) => appendUniqueText(current, sourceHeader, evidence));
  }

  function sourceOverwriteCandidateCount(
    source: SourceLink,
    facts: SourceExtraction['facts']
  ) {
    if (!facts) return 0;
    let count = 0;
    const isProductListing = source.kind === 'Product listing';

    if (isProductListing && productName.trim() && facts.productName) count += 1;
    if (isProductListing && asin.trim() && facts.asin) count += 1;
    if (productOneLiner.trim() && facts.oneLiner) count += 1;
    if (pricePoint.trim() && facts.pricePoint) count += 1;
    if (keyFeatures.trim() && facts.features.length) count += 1;
    if (differentiators.trim() && facts.differentiators.length) count += 1;

    return count;
  }

  function applyExtractedSourceFacts(source: SourceLink, overwrite = false) {
    const facts = sourceExtractions[source.id]?.facts;
    if (!facts) return;
    mergeSourceFacts(source, facts, { overwrite });
    setSourceExtractions((current) => ({
      ...current,
      [source.id]: {
        ...current[source.id],
        status: facts.warnings.length ? 'warning' : 'extracted',
        message: overwrite
          ? 'Extracted facts applied, including filled fields.'
          : 'Extracted facts applied to blank fields.',
        facts,
      },
    }));
  }

  async function extractSource(source: SourceLink) {
    const trimmedUrl = source.url.trim();
    if (!trimmedUrl) return;

    setSourceExtractions((current) => ({
      ...current,
      [source.id]: {
        status: 'extracting',
        message: 'Reading page and extracting product facts...',
      },
    }));

    try {
      const response = await fetch('/api/a-plus/source-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmedUrl }),
      });
      const body = (await response.json()) as {
        facts?: SourceExtraction['facts'];
        error?: string;
        httpStatus?: number;
        cacheHit?: boolean;
      };

      if (!response.ok || body.error || !body.facts) {
        setSourceExtractions((current) => ({
          ...current,
          [source.id]: {
            status:
              body.httpStatus === 401 || body.httpStatus === 403
                ? 'warning'
                : 'error',
            message: body.error || 'Could not extract product facts.',
          },
        }));
        return;
      }

      mergeSourceFacts(source, body.facts);
      const overwriteCount = sourceOverwriteCandidateCount(source, body.facts);
      setSourceExtractions((current) => ({
        ...current,
        [source.id]: {
          status: body.facts?.warnings.length ? 'warning' : 'extracted',
          message:
            overwriteCount > 0
              ? `Product facts extracted. ${overwriteCount} filled field${
                  overwriteCount === 1 ? '' : 's'
                } can be overwritten if you approve.`
              : body.facts?.warnings.length
              ? body.facts.warnings.join(' ')
              : body.cacheHit
              ? 'Product facts loaded from cache.'
              : 'Product facts extracted and merged into blank fields.',
          cacheHit: body.cacheHit,
          facts: body.facts,
        },
      }));
    } catch {
      setSourceExtractions((current) => ({
        ...current,
        [source.id]: {
          status: 'error',
          message: 'Could not extract product facts from this source.',
        },
      }));
    }
  }

  function inspectSource(source: SourceLink) {
    void checkSource(source);
    void extractSource(source);
  }

  /**
   * Clear "What you know so far" and re-extract every linked source into it.
   * Needed because the notes builder only appends/dedupes by header — it never
   * rewrites old blocks — so re-extracting in place can't drop stale lines
   * (e.g. a prior price line or an unlabeled competitor block). Clearing first
   * lets each source re-append under the current rules (price filtered out,
   * non-product sources labeled). Structured fields you already filled are left
   * alone: mergeSourceFacts only fills blanks.
   */
  async function rebuildFromSources() {
    const linked = sources.filter((source) => source.url.trim());
    if (!linked.length || rebuildingNotes) return;
    setRebuildingNotes(true);
    try {
      setRawNotes('');
      await Promise.all(linked.map((source) => extractSource(source)));
    } finally {
      setRebuildingNotes(false);
    }
  }

  function addDroppedSource(url: string) {
    const emptySource = sources.find((source) => !source.url.trim());
    if (emptySource) {
      const nextSource = { ...emptySource, url };
      updateSource(emptySource.id, { url });
      inspectSource(nextSource);
      return;
    }

    const nextSource = {
      id: Date.now(),
      kind: 'Reference' as const,
      url,
    };
    setSources((current) => [...current, nextSource]);
    inspectSource(nextSource);
  }

  async function copyPackage() {
    await navigator.clipboard.writeText(JSON.stringify(packageJson, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(strategyPromptPreview);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  }

  function writeSlotImageIntoPackage(jobId: string, url: string) {
    const match = /^img-(\d+)-(.+)$/.exec(jobId);
    if (!match) return;
    // Only persist real asset references (e.g. /api/a-plus/assets/<id>). A
    // `data:` URL means the image failed to upload to storage (commonly expired
    // AWS creds); it stays in transient preview state but must NEVER be written
    // into the draft — several 2-3MB base64 blobs exceed the draft request-body
    // limit and corrupt the save (Unterminated JSON / 500). The image still shows
    // in the preview via imageJobResults; it just won't survive a reload.
    if (url.startsWith('data:')) return;
    const order = Number(match[1]);
    const role = match[2];
    // Job ids are keyed by COMPILED module order; resolve back to the source
    // section through the deployment mapping, then write into the Experience
    // (single source of truth) — the compiled slot picks it up on recompile.
    const sectionId = deployment?.moduleMapping.find(
      (entry) => entry.order === order
    )?.sectionIds[0];
    if (!sectionId) return;
    updateSection(sectionId, (section) =>
      setSectionResolvedImage(section, role, { url })
    );
  }

  async function generateImageForJob(
    jobId: string,
    prompt: string,
    size: string
  ) {
    setImageJobResults((current) => ({
      ...current,
      [jobId]: { status: 'generating' },
    }));
    try {
      const response = await fetch('/api/a-plus/image-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prepareGeneratedImagePrompt(
            prompt,
            imageForbiddenText,
            imageProductContext
          ),
          size,
          // Draft mode generates cheap, low-quality images for fast iteration;
          // finals are full quality. Only gpt-image-1 honors this.
          quality: draftImages ? 'low' : undefined,
        }),
      });
      const body = (await response.json()) as {
        url?: string;
        revisedPrompt?: string;
        error?: string;
        persistError?: string;
        asset?: {
          assetId: string;
          originalFileName: string;
          mimeType: string;
          sizeBytes: number;
          status: 'pending_upload' | 'uploaded' | 'duplicate';
          storage: { provider: 's3'; bucket: string; key: string };
        };
      };
      if (!response.ok || !body.url) {
        setImageJobResults((current) => ({
          ...current,
          [jobId]: {
            status: 'error',
            message: body.error || 'Image generation failed.',
          },
        }));
        return;
      }
      const imageUrl = body.url;
      setImageJobResults((current) => ({
        ...current,
        [jobId]: {
          status: 'done',
          url: imageUrl,
          revisedPrompt: body.revisedPrompt,
          assetId: body.asset?.assetId,
          persistError: body.persistError,
        },
      }));
      // Write the generated image into the matching package slot so it is
      // persisted with the design (and survives a reload), not just held in
      // transient imageJobResults. jobId is "img-{order}-{role}".
      writeSlotImageIntoPackage(jobId, imageUrl);
      // Generated images live ONLY in the package slot (written above) — they
      // are intentionally not added to the uploads asset library, which is for
      // user-provided source images. Keeping generated outputs out of the
      // library also lets save-time cleanup reclaim a refreshed slot's prior
      // image once the slot stops referencing it (see a-plus-asset-cleanup).
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Image generation failed.';
      setImageJobResults((current) => ({
        ...current,
        [jobId]: { status: 'error', message },
      }));
    }
  }

  const allPackageImageJobs = useMemo<PackageImageJob[]>(() => {
    if (!deployment) return [];

    return deployment.modules.flatMap((module) =>
      moduleImageSlots(module).map((slot) => ({
        jobId: slotJobId(module.order, slot.role),
        prompt: slot.brief,
        size: slot.size,
        role: slot.role,
        hasImage: Boolean(slot.image?.url),
      }))
    );
  }, [deployment]);

  const hasRunnablePackageImageJobs = allPackageImageJobs.some((job) => {
    if (job.hasImage) return false;
    const status = imageJobResults[job.jobId]?.status;
    return status !== 'done' && status !== 'generating';
  });

  const isGeneratingPackageImage = allPackageImageJobs.some(
    (job) => imageJobResults[job.jobId]?.status === 'generating'
  );

  const placedFromAssetCount = Object.values(imageJobResults).filter(
    (result) => result?.status === 'done' && result.fromAsset
  ).length;

  function orientationFromSize(
    size: string
  ): 'portrait' | 'landscape' | 'square' {
    const match = size.match(/(\d+)\s*x\s*(\d+)/i);
    if (!match) return 'square';
    const w = Number(match[1]);
    const h = Number(match[2]);
    if (w > h * 1.05) return 'landscape';
    if (h > w * 1.05) return 'portrait';
    return 'square';
  }

  function generateAllPackageImages() {
    // Profiled, uploaded assets are candidates for direct placement (redesign #26).
    const baseCandidates: MatcherCandidate[] = assetLibrary
      .filter(
        (item) =>
          item.profile &&
          item.asset?.assetId &&
          (item.uploadStatus === 'uploaded' ||
            item.uploadStatus === 'duplicate')
      )
      .map((item) => ({
        assetId: item.asset!.assetId,
        profile: item.profile!,
      }));
    // Don't place the same photo into more than one slot.
    const usedAssetIds = new Set<string>();

    for (const job of allPackageImageJobs) {
      // Never re-pay for a slot that already has an image — including a draft
      // reloaded from storage, where in-memory job status is empty.
      if (job.hasImage) continue;
      const status = imageJobResults[job.jobId]?.status;
      if (status === 'done' || status === 'generating') continue;

      const decision = matchAssetToSlot(
        { role: job.role, orientation: orientationFromSize(job.size) },
        baseCandidates.filter((c) => !usedAssetIds.has(c.assetId))
      );

      if (decision.strategy === 'place') {
        // Use the seller's real photo directly — no generation, no cost.
        const url = `/api/a-plus/assets/${decision.assetId}`;
        usedAssetIds.add(decision.assetId);
        writeSlotImageIntoPackage(job.jobId, url);
        setImageJobResults((current) => ({
          ...current,
          [job.jobId]: {
            status: 'done',
            url,
            assetId: decision.assetId,
            fromAsset: true,
          },
        }));
        continue;
      }

      void generateImageForJob(job.jobId, job.prompt, job.size);
    }
  }

  async function generateAPlusPackage() {
    // Hand-edited copy would be silently replaced — make it an explicit choice.
    if (
      experience &&
      hasManualEdits &&
      !window.confirm(
        'Regenerating will replace your edited module copy. Continue?'
      )
    ) {
      return;
    }
    setGenerateStatus('generating');
    setGenerateError('');
    setGenerationProgress({ startedAt: Date.now(), phase: 'strategy' });

    try {
      const response = await fetch('/api/a-plus/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generateRequestBody),
      });

      if (
        !response.ok &&
        response.headers.get('content-type')?.includes('application/json')
      ) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || 'Could not generate the A+ package.');
      }
      if (!response.body) {
        throw new Error('No response stream received.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalPayload: GeneratedAPlusResponse | null = null;
      let serverError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          switch (event['type']) {
            case 'phase':
              setGenerationProgress((p) => ({
                ...p,
                phase: event['phase'] as typeof p.phase,
                ...(event['phase'] === 'package-modules'
                  ? { moduleStatus: p.moduleStatus ?? {} }
                  : {}),
              }));
              break;
            case 'phase-done':
              if (event['phase'] === 'package-outer') {
                const specs = event['moduleSpecs'] as Array<{
                  order: number;
                  amazonModuleType: string;
                  title: string;
                }>;
                const initialStatus: Record<
                  number,
                  'pending' | 'done' | 'failed'
                > = {};
                for (const s of specs) initialStatus[s.order] = 'pending';
                setGenerationProgress((p) => ({
                  ...p,
                  moduleSpecs: specs,
                  moduleStatus: initialStatus,
                }));
              }
              break;
            case 'module-done':
              setGenerationProgress((p) => ({
                ...p,
                moduleStatus: {
                  ...(p.moduleStatus ?? {}),
                  [event['order'] as number]: 'done',
                },
              }));
              break;
            case 'module-failed':
              setGenerationProgress((p) => ({
                ...p,
                moduleStatus: {
                  ...(p.moduleStatus ?? {}),
                  [event['order'] as number]: 'failed',
                },
              }));
              break;
            case 'final':
              setGenerationProgress((p) => ({ ...p, phase: 'finalizing' }));
              finalPayload = event['payload'] as GeneratedAPlusResponse;
              break;
            case 'error':
              serverError =
                (event['message'] as string) || 'Generation failed.';
              break;
          }
        }
      }

      if (serverError) {
        throw new Error(serverError);
      }
      if (!finalPayload) {
        throw new Error('Generation finished without producing a package.');
      }

      // Lift the generated package into the Experience model — the editor's
      // single source of truth; the deployment view recompiles from it.
      setExperience(
        liftGeneratedPackageToExperience(finalPayload.package, {
          productId: asin.trim() || undefined,
        })
      );
      setGenerationMeta({
        strategy: finalPayload.strategy,
        runConfig: finalPayload.runConfig,
        imageGeneration: finalPayload.imageGeneration,
        modelRuns: finalPayload.modelRuns,
        assumptions: finalPayload.package.assumptions,
        sellerCentralBuildSheet: finalPayload.package.sellerCentralBuildSheet,
        qualityChecklist: finalPayload.package.qualityChecklist,
      });
      setHasManualEdits(false);
      setGenerateStatus('generated');
      setGenerationProgress({});
    } catch (error) {
      setGenerateStatus('error');
      setGenerateError(
        error instanceof Error
          ? error.message
          : 'Could not generate the A+ package.'
      );
      setGenerationProgress({});
    }
  }

  function hydrateDraft(payload: DraftPayload) {
    if (payload.builderMode) setBuilderMode(payload.builderMode);
    if (payload.wizardStep) setWizardStep(payload.wizardStep);
    if (payload.productName !== undefined) setProductName(payload.productName);
    if (payload.asin !== undefined) setAsin(payload.asin);
    if (payload.contentTier) setContentTier(payload.contentTier);
    if (payload.productOneLiner !== undefined)
      setProductOneLiner(payload.productOneLiner);
    if (payload.targetCustomer !== undefined)
      setTargetCustomer(payload.targetCustomer);
    if (payload.pricePoint !== undefined) setPricePoint(payload.pricePoint);
    if (payload.keyFeatures !== undefined) setKeyFeatures(payload.keyFeatures);
    if (payload.differentiators !== undefined)
      setDifferentiators(payload.differentiators);
    if (payload.objections !== undefined) setObjections(payload.objections);
    if (payload.brandColors !== undefined) setBrandColors(payload.brandColors);
    if (payload.logoNotes !== undefined) setLogoNotes(payload.logoNotes);
    if (payload.brandVoice !== undefined) setBrandVoice(payload.brandVoice);
    if (payload.brandFontNotes !== undefined)
      setBrandFontNotes(payload.brandFontNotes);
    if (payload.brandLogoAssetId !== undefined)
      setBrandLogoAssetId(payload.brandLogoAssetId);
    if (payload.rawNotes !== undefined) setRawNotes(payload.rawNotes);
    if (payload.assets?.length)
      setAssetLibrary(
        payload.assets.filter((a) => !isGeneratedLibraryAsset(a))
      );
    if (payload.sources?.length) setSources(payload.sources);
    // Old drafts may also carry `strategyId`/`modules` (the retired
    // pre-generation module plan) — those keys are simply ignored.
    if (payload.experience) {
      // Newer drafts persist the Experience directly.
      setExperience(payload.experience);
      setGenerationMeta(payload.generationMeta ?? null);
    } else if (payload.generatedPackage) {
      // Older drafts only carry the generated package — lift it.
      const normalized = normalizeGeneratedPackage(payload.generatedPackage);
      setExperience(liftGeneratedPackageToExperience(normalized.package));
      setGenerationMeta({
        strategy: normalized.strategy,
        runConfig: normalized.runConfig,
        imageGeneration: normalized.imageGeneration,
        modelRuns: normalized.modelRuns,
        assumptions: normalized.package.assumptions,
        sellerCentralBuildSheet: normalized.package.sellerCentralBuildSheet,
        qualityChecklist: normalized.package.qualityChecklist,
      });
    }
    if (payload.creativity) setCreativity(payload.creativity);
    setGuidanceStrategy(payload.guidance?.strategy ?? '');
    setGuidanceModuleCopy(payload.guidance?.moduleCopy ?? '');
    setHasManualEdits(payload.hasManualEdits === true);
  }

  async function loadDraft(nextDraftId: string) {
    if (!nextDraftId) return;
    setSaveStatus('loading');
    try {
      const response = await fetch(`/api/a-plus/drafts/${nextDraftId}`);
      const body = (await response.json()) as {
        error?: string;
        draft?: DraftSummary & {
          payload?: DraftPayload;
        };
      };
      if (!response.ok || body.error || !body.draft) {
        throw new Error(body.error || 'Could not load draft.');
      }

      setDraftId(body.draft.draftId);
      setDraftName(body.draft.name);
      setBrandGuideId(body.draft.brandGuideId || null);
      const guide =
        brandGuides.find(
          (item) => item.brandGuideId === body.draft?.brandGuideId
        ) || null;
      hydrateDraft(mergeGuideIntoDraftPayload(body.draft.payload || {}, guide));
      setSaveStatus('idle');
    } catch {
      setSaveStatus('error');
    }
  }

  function newDraft() {
    setDraftId(null);
    setDraftName('Untitled A+ draft');
    setBuilderMode('simple');
    setWizardStep('basics');
    setProductName('');
    setAsin('');
    setContentTier('Basic A+');
    setProductOneLiner('');
    setTargetCustomer('');
    setPricePoint('');
    setKeyFeatures('');
    setDifferentiators('');
    setObjections('');
    setBrandColors('');
    setLogoNotes('');
    setBrandVoice('');
    setBrandFontNotes('');
    setBrandLogoAssetId('');
    setBrandGuideId(null);
    setRawNotes('');
    setAssetLibrary([]);
    setSources(DEFAULT_SOURCES);
    setSourceChecks({});
    setExperience(null);
    setGenerationMeta(null);
    setCreativity('medium');
    setGuidanceStrategy('');
    setGuidanceModuleCopy('');
    setHasManualEdits(false);
    setImageJobResults({});
  }

  async function saveDraft(options?: { silent?: boolean }) {
    const silent = options?.silent === true;
    if (!silent) setSaveStatus('saving');
    try {
      const response = await fetch('/api/a-plus/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId,
          brandGuideId,
          name: draftName,
          productName,
          asin,
          contentTier,
          payload: currentDraftPayload,
          packageJson,
        }),
      });
      const body = (await response.json()) as {
        draft?: DraftSummary;
        error?: string;
      };
      if (!response.ok || body.error || !body.draft) {
        throw new Error(body.error || 'Could not save draft.');
      }
      setDraftId(body.draft.draftId);
      if (!silent) setDraftName(body.draft.name);
      setDrafts((current) => [
        body.draft as DraftSummary,
        ...current.filter((draft) => draft.draftId !== body.draft?.draftId),
      ]);
      if (!silent) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 1800);
      }
    } catch {
      if (!silent) setSaveStatus('error');
    }
  }

  function applyBrandGuide(nextBrandGuideId: string) {
    if (!nextBrandGuideId) {
      setBrandGuideId(null);
      return;
    }

    const guide = brandGuides.find(
      (item) => item.brandGuideId === nextBrandGuideId
    );
    if (!guide) return;
    setBrandGuideId(guide.brandGuideId);
    setBrandColors(summarizeBrandGuideColors(guide));
    setBrandVoice(guide.voice || '');
    setLogoNotes(summarizeBrandGuideLogoNotes(guide));
    setBrandFontNotes(summarizeBrandGuideFonts(guide));
    setBrandLogoAssetId(guide.logoAsset?.assetId || '');
  }

  const activeWizardIndex = SIMPLE_WIZARD_STEPS.findIndex(
    (step) => step.id === wizardStep
  );
  const currentWizardStep =
    SIMPLE_WIZARD_STEPS[activeWizardIndex] || SIMPLE_WIZARD_STEPS[0];
  function goToWizardStep(step: WizardStep) {
    setWizardStep(step);
  }

  function moveWizardStep(direction: -1 | 1) {
    const nextIndex = Math.min(
      SIMPLE_WIZARD_STEPS.length - 1,
      Math.max(0, activeWizardIndex + direction)
    );
    setWizardStep(SIMPLE_WIZARD_STEPS[nextIndex]?.id || 'basics');
  }

  const draftWorkspaceCard = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-primary" />
          Draft
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.push('/a-plus')}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Designs
          </Button>
          <select
            value={draftId || ''}
            onChange={(event) => {
              if (event.target.value)
                router.push(`/a-plus/${event.target.value}`);
            }}
            className={cn(COMPACT_SELECT_CLASSNAME, 'flex-1')}
          >
            <option value="">Current unsaved draft</option>
            {drafts.map((draft) => (
              <option key={draft.draftId} value={draft.draftId}>
                {draft.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/a-plus/new')}
          >
            New
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor="draft-name">Draft name</Label>
          <Input
            id="draft-name"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Spring launch A+"
            className={FIELD_CLASSNAME}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="brand-guide">Brand guide</Label>
          <select
            id="brand-guide"
            value={brandGuideId || ''}
            onChange={(event) => applyBrandGuide(event.target.value)}
            className={SELECT_CLASSNAME}
          >
            <option value="">No guide selected</option>
            {brandGuides.map((guide) => (
              <option key={guide.brandGuideId} value={guide.brandGuideId}>
                {guide.name}
              </option>
            ))}
          </select>
          <p className="text-xs leading-5 text-muted-foreground">
            Advanced workspace control for reusing a saved brand style.
          </p>
        </div>
        <Button asChild type="button" variant="outline" className="w-full">
          <Link href="/brand-guides">Manage brand guides</Link>
        </Button>
        <Button
          type="button"
          className="w-full"
          disabled={saveStatus === 'saving' || saveStatus === 'loading'}
          onClick={() => void saveDraft()}
        >
          {saveStatus === 'saving' || saveStatus === 'loading' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Clipboard className="mr-2 h-4 w-4" />
          )}
          {saveStatus === 'saved'
            ? 'Saved'
            : saveStatus === 'error'
            ? 'Retry save'
            : 'Save draft'}
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          Drafts are saved per user and can share reusable brand guides across
          multiple products.
        </p>
      </CardContent>
    </Card>
  );

  const brandGuideWizardCard = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-primary" />
          Brand style
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="wizard-brand-guide">Brand guide</Label>
          <select
            id="wizard-brand-guide"
            value={brandGuideId || ''}
            onChange={(event) => applyBrandGuide(event.target.value)}
            className={SELECT_CLASSNAME}
          >
            <option value="">Create or choose a brand guide</option>
            {brandGuides.map((guide) => (
              <option key={guide.brandGuideId} value={guide.brandGuideId}>
                {guide.name}
              </option>
            ))}
          </select>
        </div>

        {selectedBrandGuide ? (
          <div className="rounded-md border bg-muted/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{selectedBrandGuide.name}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  This guide is actively filling the draft brief and generation
                  prompt with saved brand defaults.
                </p>
              </div>
              <Badge variant="outline" className="shrink-0">
                Applied
              </Badge>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border bg-background p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Colors
                </p>
                <div className="mt-3 grid gap-2">
                  {getBrandGuidePaletteEntries(selectedBrandGuide).length ? (
                    getBrandGuidePaletteEntries(selectedBrandGuide).map(
                      (entry) => (
                        <div
                          key={entry.label}
                          className="rounded-md border p-2"
                          style={{ backgroundColor: entry.color }}
                        >
                          <p
                            className="text-xs font-medium"
                            style={{ color: entry.textColor }}
                          >
                            {entry.label}
                          </p>
                        </div>
                      )
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No saved colors yet
                    </p>
                  )}
                </div>
              </div>
              <div className="rounded-md border bg-background p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Fonts
                </p>
                <div className="mt-3 space-y-2">
                  {getBrandGuideFontEntries(selectedBrandGuide).length ? (
                    getBrandGuideFontEntries(selectedBrandGuide).map(
                      (entry) => (
                        <div
                          key={entry.label}
                          className="rounded-md border bg-muted/20 p-2"
                        >
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {entry.label}
                          </p>
                          <p
                            className="mt-1 text-base"
                            style={fontPreviewStyle(entry.name)}
                          >
                            {entry.sample}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {entry.name}
                          </p>
                        </div>
                      )
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No saved fonts yet
                    </p>
                  )}
                </div>
              </div>
              <div className="rounded-md border bg-background p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Voice
                </p>
                <p className="mt-2 text-sm">
                  {selectedBrandGuide.voice || 'No saved voice notes yet'}
                </p>
              </div>
              <div className="rounded-md border bg-background p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Logo
                </p>
                <p className="mt-2 text-sm">
                  {selectedBrandGuide.logoAsset?.originalFileName ||
                    selectedBrandGuide.logoNotes ||
                    'No saved logo asset yet'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed bg-muted/40 p-4">
            <p className="text-sm font-medium">No brand guide selected yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create one now if you want the AI to stay aligned on colors, logo
              handling, and tone. You can also keep going and fill this in
              later.
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild type="button" variant="outline">
            <Link href="/brand-guides">Create or edit brand guides</Link>
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            Choose one here when it exists, or create it in a separate flow and
            come back.
          </p>
        </div>
      </CardContent>
    </Card>
  );

  const intakeCard = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4 text-primary" />
          Product details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="product-name">Product name</Label>
          <Input
            id="product-name"
            value={productName}
            onChange={(event) => setProductName(event.target.value)}
            placeholder="Stainless tea infuser"
            className={FIELD_CLASSNAME}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="asin">ASIN</Label>
            <Input
              id="asin"
              value={asin}
              onChange={(event) => setAsin(event.target.value.toUpperCase())}
              placeholder="B0..."
              className={FIELD_CLASSNAME}
            />
          </div>
          <div className="space-y-2">
            <Label>Package type</Label>
            <ToggleGroup
              type="single"
              value={contentTier}
              onValueChange={(value) => {
                if (value) applyContentTier(value as ContentTier);
              }}
              variant="outline"
              className="grid w-full grid-cols-2"
              aria-label="A+ package type"
            >
              <ToggleGroupItem
                value="Basic A+"
                className="h-auto min-h-14 flex-col items-start px-3 py-2 text-left"
                aria-label="Basic A plus package"
              >
                <span className="text-sm font-medium">Basic A+</span>
                <span className="text-xs text-muted-foreground">
                  Up to 5 modules
                </span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="Premium A+"
                className="h-auto min-h-14 flex-col items-start px-3 py-2 text-left"
                aria-label="Premium A plus package"
              >
                <span className="text-sm font-medium">Premium A+</span>
                <span className="text-xs text-muted-foreground">
                  Up to 6-7 modules
                </span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-listing-url">Product listing link</Label>
          <div
            className="relative"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const url =
                event.dataTransfer.getData('text/uri-list') ||
                extractFirstUrl(event.dataTransfer.getData('text/plain'));
              if (url) {
                const productSource =
                  sources.find((source) => source.kind === 'Product listing') ||
                  sources[0];
                if (productSource) {
                  const nextSource = { ...productSource, url };
                  updateSource(productSource.id, { url });
                  inspectSource(nextSource);
                } else {
                  const nextSource = {
                    id: Date.now(),
                    kind: 'Product listing' as const,
                    url,
                  };
                  setSources((current) => [nextSource, ...current]);
                  inspectSource(nextSource);
                }
              }
            }}
          >
            <LinkIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="product-listing-url"
              value={
                sources.find((source) => source.kind === 'Product listing')
                  ?.url || ''
              }
              onChange={(event) => {
                const url = event.target.value;
                const productSource =
                  sources.find((source) => source.kind === 'Product listing') ||
                  sources[0];
                if (productSource) {
                  updateSource(productSource.id, { url });
                }
              }}
              onPaste={(event) => {
                const url = extractFirstUrl(
                  event.clipboardData.getData('text')
                );
                if (!url) return;
                event.preventDefault();
                const productSource =
                  sources.find((source) => source.kind === 'Product listing') ||
                  sources[0];
                if (productSource) {
                  const nextSource = { ...productSource, url };
                  updateSource(productSource.id, { url });
                  inspectSource(nextSource);
                }
              }}
              onBlur={() => {
                const productSource = sources.find(
                  (source) => source.kind === 'Product listing'
                );
                if (productSource) inspectSource(productSource);
              }}
              placeholder="Drag or paste product listing URL"
              className={cn('pl-7 text-sm', FIELD_CLASSNAME)}
            />
          </div>
          {productListingExtraction?.status &&
          productListingExtraction.status !== 'idle' ? (
            <div className="rounded-md border px-3 py-2 text-xs">
              <div className="flex items-start gap-2">
                {productListingExtraction.status === 'extracting' ? (
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : productListingExtraction.status === 'extracted' ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 text-amber-600" />
                )}
                <span
                  className={cn(
                    'rounded-sm border px-1.5 py-0.5 font-medium',
                    sourceExtractionStatusClass(productListingExtraction.status)
                  )}
                >
                  {productListingExtraction.status === 'extracting'
                    ? 'reading'
                    : productListingExtraction.status}
                </span>
                <span className="leading-5 text-muted-foreground">
                  {productListingExtraction.message}
                </span>
              </div>
              {productListingSource && productListingExtraction.facts ? (
                <div className="mt-2 flex flex-wrap gap-2 pl-5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      applyExtractedSourceFacts(productListingSource, false)
                    }
                  >
                    Fill blanks
                  </Button>
                  {sourceOverwriteCandidateCount(
                    productListingSource,
                    productListingExtraction.facts
                  ) > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        applyExtractedSourceFacts(productListingSource, true)
                      }
                    >
                      Overwrite filled fields
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {productListingExtraction.facts?.evidence.length ? (
                <div className="mt-2 space-y-1 pl-5 text-muted-foreground">
                  {productListingExtraction.facts.evidence
                    .slice(0, 4)
                    .map((item) => (
                      <p key={item} className="leading-5">
                        {item}
                      </p>
                    ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs leading-5 text-muted-foreground">
            Drop the Amazon, Shopify, Alibaba, or landing page link here to make
            it the primary product source. SellAvant will read public pages and
            fill blank product fields from the page.
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="notes">What you know so far</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void rebuildFromSources()}
              disabled={
                rebuildingNotes || !sources.some((source) => source.url.trim())
              }
              title="Clear these notes and re-read every linked source with the current extraction rules"
            >
              {rebuildingNotes ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
              )}
              Rebuild from sources
            </Button>
          </div>
          <Textarea
            id="notes"
            value={rawNotes}
            onChange={(event) => setRawNotes(event.target.value)}
            placeholder="Paste rough notes, bullets, customer reviews, supplier claims, dimensions, or anything the AI should learn from."
            className={cn('min-h-24', TEXTAREA_CLASSNAME)}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            The AI should fill the structured fields below as it extracts facts
            from links, photos, notes, and listing data.
          </p>
        </div>
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-between"
            >
              More product context (optional)
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-4">
            <div className="rounded-md border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium">
                      Brand instructions for AI
                    </Label>
                    {selectedBrandGuide ? (
                      <Badge variant="outline" className="text-[11px]">
                        Pulled from {selectedBrandGuide.name}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Use this only when you want to add or override what the
                    selected brand guide already tells the AI.
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="brand-voice">Brand voice</Label>
                    {selectedBrandGuide?.voice ? (
                      <Badge variant="secondary" className="text-[11px]">
                        Guide default
                      </Badge>
                    ) : null}
                  </div>
                  <Textarea
                    id="brand-voice"
                    value={brandVoice}
                    onChange={(event) => setBrandVoice(event.target.value)}
                    placeholder="Tone, writing style, words to lean into or avoid..."
                    className={cn('min-h-20', TEXTAREA_CLASSNAME)}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="brand-colors">Brand colors</Label>
                    {selectedBrandGuide?.palette ? (
                      <Badge variant="secondary" className="text-[11px]">
                        Guide default
                      </Badge>
                    ) : null}
                  </div>
                  <Textarea
                    id="brand-colors"
                    value={brandColors}
                    onChange={(event) => setBrandColors(event.target.value)}
                    placeholder="Primary foreground #..., Secondary foreground #..., Background #..."
                    className={cn('min-h-16', TEXTAREA_CLASSNAME)}
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="brand-fonts">Brand fonts</Label>
                      {selectedBrandGuide?.fonts ? (
                        <Badge variant="secondary" className="text-[11px]">
                          Guide default
                        </Badge>
                      ) : null}
                    </div>
                    <Textarea
                      id="brand-fonts"
                      value={brandFontNotes}
                      onChange={(event) =>
                        setBrandFontNotes(event.target.value)
                      }
                      placeholder="Primary ..., Secondary ..., Accent ..."
                      className={cn('min-h-16', TEXTAREA_CLASSNAME)}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="logo-notes">Logo handling</Label>
                      {selectedBrandGuide?.logoAsset ||
                      selectedBrandGuide?.logoNotes ? (
                        <Badge variant="secondary" className="text-[11px]">
                          Guide default
                        </Badge>
                      ) : null}
                    </div>
                    <Textarea
                      id="logo-notes"
                      value={logoNotes}
                      onChange={(event) => setLogoNotes(event.target.value)}
                      placeholder="Safe area, placement, reversed logo rules, do not redraw..."
                      className={cn('min-h-16', TEXTAREA_CLASSNAME)}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="one-liner">What it does</Label>
              <Textarea
                id="one-liner"
                value={productOneLiner}
                onChange={(event) => setProductOneLiner(event.target.value)}
                placeholder="One sentence. Usually AI-filled from sources."
                className={cn('min-h-16', TEXTAREA_CLASSNAME)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="target-customer">Target customer</Label>
                <Textarea
                  id="target-customer"
                  value={targetCustomer}
                  onChange={(event) => setTargetCustomer(event.target.value)}
                  placeholder="Who buys it, why now, what they care about."
                  className={cn('min-h-20', TEXTAREA_CLASSNAME)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price-point">Price point</Label>
                <Input
                  id="price-point"
                  value={pricePoint}
                  onChange={(event) => setPricePoint(event.target.value)}
                  placeholder="Budget, mid-market, premium..."
                  className={FIELD_CLASSNAME}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="features">Features and benefits</Label>
              <Textarea
                id="features"
                value={keyFeatures}
                onChange={(event) => setKeyFeatures(event.target.value)}
                placeholder="Top features with buyer benefit for each."
                className={cn('min-h-24', TEXTAREA_CLASSNAME)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="differentiators">Differentiators</Label>
              <Textarea
                id="differentiators"
                value={differentiators}
                onChange={(event) => setDifferentiators(event.target.value)}
                placeholder="Materials, bundle, proof, compatibility, patents, certifications..."
                className={cn('min-h-20', TEXTAREA_CLASSNAME)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="objections">Buyer objections</Label>
              <Textarea
                id="objections"
                value={objections}
                onChange={(event) => setObjections(event.target.value)}
                placeholder="What might stop a buyer from purchasing?"
                className={cn('min-h-20', TEXTAREA_CLASSNAME)}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );

  const sourcesCard = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Source Links</CardTitle>
      </CardHeader>
      <CardContent
        className="space-y-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const url =
            event.dataTransfer.getData('text/uri-list') ||
            extractFirstUrl(event.dataTransfer.getData('text/plain'));
          if (url) {
            addDroppedSource(url);
          }
        }}
      >
        <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
          Drag product, supplier, Alibaba, Amazon, Shopify, or competitor links
          here. SellAvant will flag sources that look gated, paywalled, or
          blocked.
        </div>
        {sources.map((source) => (
          <div key={source.id} className="grid grid-cols-[116px_1fr] gap-2">
            <select
              value={source.kind}
              onChange={(event) => {
                const kind = event.target.value as SourceKind;
                updateSource(source.id, { kind });
              }}
              className={cn('rounded-md border px-2 text-xs', FIELD_CLASSNAME)}
            >
              {SOURCE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            <div className="relative">
              <LinkIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={source.url}
                onChange={(event) => {
                  const url = event.target.value;
                  updateSource(source.id, { url });
                }}
                onBlur={() => checkSource(source)}
                onPaste={(event) => {
                  const url = extractFirstUrl(
                    event.clipboardData.getData('text')
                  );
                  if (!url) return;
                  event.preventDefault();
                  const nextSource = { ...source, url };
                  updateSource(source.id, { url });
                  inspectSource(nextSource);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const url =
                    event.dataTransfer.getData('text/uri-list') ||
                    extractFirstUrl(event.dataTransfer.getData('text/plain'));
                  if (url) {
                    const nextSource = { ...source, url };
                    updateSource(source.id, { url });
                    inspectSource(nextSource);
                  }
                }}
                placeholder="https://..."
                className={cn('pl-7 text-sm', FIELD_CLASSNAME)}
              />
            </div>
            {sourceChecks[source.id]?.status &&
              sourceChecks[source.id]?.status !== 'idle' && (
                <div className="col-span-2 -mt-1 flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
                  {sourceChecks[source.id].status === 'checking' ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : sourceChecks[source.id].status === 'accessible' ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 text-amber-600" />
                  )}
                  <span
                    className={cn(
                      'rounded-sm border px-1.5 py-0.5 font-medium',
                      sourceStatusClass(sourceChecks[source.id].status)
                    )}
                  >
                    {sourceChecks[source.id].status}
                  </span>
                  <span className="leading-5 text-muted-foreground">
                    {sourceChecks[source.id].message}
                    {sourceChecks[source.id].httpStatus
                      ? ` HTTP ${sourceChecks[source.id].httpStatus}.`
                      : ''}
                  </span>
                </div>
              )}
            {sourceExtractions[source.id]?.status &&
              sourceExtractions[source.id]?.status !== 'idle' && (
                <div className="col-span-2 -mt-1 rounded-md border px-3 py-2 text-xs">
                  <div className="flex items-start gap-2">
                    {sourceExtractions[source.id].status === 'extracting' ? (
                      <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : sourceExtractions[source.id].status === 'extracted' ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 text-amber-600" />
                    )}
                    <span
                      className={cn(
                        'rounded-sm border px-1.5 py-0.5 font-medium',
                        sourceExtractionStatusClass(
                          sourceExtractions[source.id].status
                        )
                      )}
                    >
                      {sourceExtractions[source.id].status === 'extracting'
                        ? 'reading'
                        : sourceExtractions[source.id].status}
                    </span>
                    {sourceExtractions[source.id].cacheHit ? (
                      <span className="rounded-sm border border-sky-300 bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700">
                        cached
                      </span>
                    ) : null}
                    <span className="leading-5 text-muted-foreground">
                      {sourceExtractions[source.id].message}
                    </span>
                  </div>
                  {sourceExtractions[source.id].facts ? (
                    <div className="mt-2 flex flex-wrap gap-2 pl-5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => applyExtractedSourceFacts(source, false)}
                      >
                        Fill blanks
                      </Button>
                      {sourceOverwriteCandidateCount(
                        source,
                        sourceExtractions[source.id].facts
                      ) > 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            applyExtractedSourceFacts(source, true)
                          }
                        >
                          Overwrite filled fields
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {sourceExtractions[source.id].facts?.evidence.length ? (
                    <div className="mt-2 space-y-1 pl-5 text-muted-foreground">
                      {sourceExtractions[source.id].facts?.evidence
                        .slice(0, 4)
                        .map((item) => (
                          <p key={item} className="leading-5">
                            {item}
                          </p>
                        ))}
                    </div>
                  ) : null}
                </div>
              )}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addSource}>
          <Plus className="mr-2 h-4 w-4" />
          Add source
        </Button>
      </CardContent>
    </Card>
  );

  const assetsCard = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Product Images</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label
          className="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-muted/30 px-4 py-10 text-center transition-colors hover:border-primary/60 hover:bg-primary/5"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            uploadLibraryFiles(event.dataTransfer.files);
          }}
        >
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(event) => {
              if (event.target.files) uploadLibraryFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ImagePlus className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium">Drop product images here</p>
            <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              Raw photos, polished shots, packaging, lifestyle images, and
              screenshots are all fine. SellAvant will decide where they fit in
              the A+ package.
            </p>
          </div>
        </label>

        {assetLibrary.length ? (
          <div className="space-y-3">
            {assetLibrary.map((item) => (
              <div
                key={item.id}
                className="grid gap-3 rounded-md border bg-background p-3 md:grid-cols-[minmax(0,220px)_1fr_auto]"
              >
                <div className="min-w-0">
                  {item.asset?.assetId &&
                  (item.uploadStatus === 'uploaded' ||
                    item.uploadStatus === 'duplicate') ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewImage({
                          assetId: item.asset!.assetId,
                          fileName: item.fileName,
                        })
                      }
                      className="mb-2 block w-full overflow-hidden rounded border bg-muted transition hover:opacity-90"
                      aria-label={`Preview ${item.fileName}`}
                    >
                      <img
                        src={`/api/a-plus/assets/${item.asset.assetId}?w=320`}
                        alt={item.fileName}
                        loading="lazy"
                        className="h-28 w-full object-cover"
                      />
                    </button>
                  ) : null}
                  <div className="flex items-center gap-2">
                    {item.uploadStatus === 'hashing' ||
                    item.uploadStatus === 'uploading' ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <FileImage className="h-4 w-4 shrink-0 text-primary" />
                    )}
                    <p className="truncate text-sm font-medium">
                      {item.fileName}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge
                      className={cn(
                        'border text-[11px]',
                        item.uploadStatus === 'error'
                          ? 'border-red-200 bg-red-50 text-red-800'
                          : item.uploadStatus === 'uploaded' ||
                            item.uploadStatus === 'duplicate'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-border bg-muted text-muted-foreground'
                      )}
                    >
                      {item.uploadStatus === 'duplicate'
                        ? 'Reused'
                        : item.uploadStatus}
                    </Badge>
                    {item.uploadStatus !== 'error' && item.uploadMessage ? (
                      <span className="text-xs text-muted-foreground">
                        {item.uploadMessage}
                      </span>
                    ) : null}
                  </div>
                  {item.profiling ? (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Analyzing image…
                    </div>
                  ) : item.profile ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <Badge className="border-border bg-secondary text-[10px] text-secondary-foreground">
                        {item.profile.role}
                      </Badge>
                      {item.profile.affordances.slice(0, 3).map((a) => (
                        <Badge
                          key={a}
                          className="border-border bg-muted text-[10px] text-muted-foreground"
                        >
                          {a}
                        </Badge>
                      ))}
                      {item.profile.hasBakedText ? (
                        <Badge className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                          has text
                        </Badge>
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          item.asset?.assetId &&
                          void profileAsset(item.id, item.asset.assetId, true)
                        }
                        className="ml-1 text-[10px] text-primary hover:underline"
                      >
                        Re-analyze
                      </button>
                    </div>
                  ) : null}
                  {item.uploadStatus === 'error' ? (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-900">
                      <p className="font-medium">
                        {item.uploadMessage || 'Image upload failed.'}
                      </p>
                      {item.uploadAction ? (
                        <p className="mt-1 text-red-800">{item.uploadAction}</p>
                      ) : (
                        <p className="mt-1 text-red-800">
                          Retry this image, or remove it and upload another
                          copy.
                        </p>
                      )}
                      {item.uploadErrorCode ? (
                        <p className="mt-2 font-mono text-[11px] text-red-700">
                          {item.uploadErrorCode}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`asset-description-${item.id}`}>
                    Description
                  </Label>
                  <Input
                    id={`asset-description-${item.id}`}
                    value={item.description}
                    onChange={(event) =>
                      updateAssetLibraryItem(item.id, {
                        description: event.target.value,
                      })
                    }
                    placeholder="What should the AI know about this image?"
                    className={FIELD_CLASSNAME}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive md:self-end"
                  aria-label={`Remove ${item.fileName}`}
                  onClick={() => removeAssetLibraryItem(item.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                {item.uploadStatus === 'error' && item.file ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="md:col-start-2 md:w-fit"
                    onClick={() =>
                      void uploadLibraryAssetById(item.id, item.file as File)
                    }
                  >
                    Retry upload
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );

  const generationBrief = (
    <div className="mb-4 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <WandSparkles className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">AI generation brief</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The AI starts by interviewing only for missing facts, then drafts a
            module-by-module A+ package with logo dropzones, matched mobile
            layouts, image prompts, Canva instructions, and compliance checks.
          </p>
        </div>
        <Button type="button" onClick={copyPrompt}>
          <Clipboard className="mr-2 h-4 w-4" />
          {promptCopied ? 'Prompt copied' : 'Copy AI prompt'}
        </Button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {[
          {
            title: '1. Learn',
            body: 'Read listing, supplier, competitor, notes, and uploaded images.',
          },
          {
            title: '2. Wireframe',
            body: 'Choose real Amazon modules with desktop/mobile and logo safe zones.',
          },
          {
            title: '3. Produce',
            body: 'Write copy, image prompts, alt text, and Seller Central build sheet.',
          },
        ].map((step) => (
          <div key={step.title} className="rounded-md border bg-muted/40 p-3">
            <p className="text-sm font-medium">{step.title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {step.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );

  const generatedPackageCard =
    experience && deployment ? (
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <PackageCheck className="h-4 w-4 text-primary" />
              Your A+ Story
            </CardTitle>
            {allPackageImageJobs.length ? (
              <div className="flex items-center gap-3">
                <label
                  className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
                  title="Generate cheaper, low-quality draft images for fast iteration. Turn off for full-quality finals."
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    checked={draftImages}
                    onChange={(event) => setDraftImages(event.target.checked)}
                  />
                  Draft quality
                </label>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={!hasRunnablePackageImageJobs}
                  onClick={generateAllPackageImages}
                >
                  {isGeneratingPackageImage ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <WandSparkles className="mr-2 h-3.5 w-3.5" />
                  )}
                  {isGeneratingPackageImage
                    ? 'Generating images'
                    : hasRunnablePackageImageJobs
                    ? 'Generate all images'
                    : 'All images generated'}
                </Button>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {placedFromAssetCount > 0 ? (
            <p className="text-xs font-medium text-emerald-700">
              {placedFromAssetCount} image
              {placedFromAssetCount === 1 ? '' : 's'} placed from your uploaded
              photos; the rest were generated.
            </p>
          ) : null}

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">A+ Page Preview</p>
                <p className="text-xs text-muted-foreground">
                  Buyer-facing module stack. Layout and copy are live HTML;
                  images fill in as you generate them.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ToggleGroup
                  type="single"
                  value={previewViewport}
                  onValueChange={(value) => {
                    if (value === 'desktop' || value === 'mobile') {
                      setPreviewViewport(value);
                    }
                  }}
                  className="rounded-md border bg-background p-1"
                >
                  <ToggleGroupItem
                    value="desktop"
                    aria-label="Show desktop preview"
                    className="h-8 gap-1.5 px-3"
                  >
                    <Monitor className="h-3.5 w-3.5" />
                    Desktop
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="mobile"
                    aria-label="Show mobile preview"
                    className="h-8 gap-1.5 px-3"
                  >
                    <Smartphone className="h-3.5 w-3.5" />
                    Mobile
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
            {Object.values(imageJobResults).some(
              (result) => result?.status === 'done' && result.persistError
            ) ? (
              <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Some images generated but{' '}
                  <span className="font-medium">
                    couldn’t be saved to storage
                  </span>{' '}
                  — they show in this preview but won’t persist on reload, and
                  the draft won’t store them. This usually means your AWS
                  sign-in expired. Run{' '}
                  <code className="rounded bg-rose-100 px-1 py-0.5 text-[12px]">
                    aws sso login --profile sellavant-dev
                  </code>{' '}
                  then regenerate the affected images.
                </span>
              </div>
            ) : null}
            {hasRunnablePackageImageJobs || isGeneratingPackageImage ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
                <div className="flex items-start gap-2 text-sm text-amber-900">
                  <ImagePlus className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    The preview shows{' '}
                    <span className="font-medium">“Image pending”</span>{' '}
                    placeholders — module images aren’t generated until you run
                    them. This step uses AI image credits.
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={generateAllPackageImages}
                  disabled={isGeneratingPackageImage}
                >
                  {isGeneratingPackageImage ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <WandSparkles className="mr-2 h-3.5 w-3.5" />
                  )}
                  {isGeneratingPackageImage
                    ? 'Generating images…'
                    : 'Generate all images'}
                </Button>
              </div>
            ) : null}
            <APlusDesignedPreview
              modules={deployment.modules}
              theme={designTheme}
              viewport={previewViewport}
              slotResults={imageJobResults}
              onRegenerate={(jobId, brief, size) =>
                generateImageForJob(jobId, brief, size)
              }
            />
          </section>

          <Collapsible>
            <div className="rounded-md border bg-muted/20">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="flex h-auto w-full justify-between gap-3 px-4 py-3 text-left"
                >
                  <span>
                    <span className="block text-sm font-medium">
                      Package rationale
                    </span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      Strategy, model runs, assumptions, and package-level build
                      notes.
                    </span>
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 border-t p-4">
                <div className="flex flex-wrap gap-2">
                  {(generationMeta?.modelRuns ?? []).map((run) => (
                    <Badge key={`${run.role}-${run.modelId}`} variant="outline">
                      {run.role === 'strategy'
                        ? 'Strategy model'
                        : 'Package model'}
                      : {run.provider} / {run.modelId}
                    </Badge>
                  ))}
                  <Badge variant="outline">
                    Images{' '}
                    {generationMeta?.imageGeneration?.enabled
                      ? 'on'
                      : 'planned'}
                  </Badge>
                  {generationMeta?.runConfig ? (
                    <>
                      <Badge variant="secondary">
                        Mode: {generationMeta.runConfig.generationMode}
                      </Badge>
                      <Badge variant="secondary">
                        Image: {generationMeta.runConfig.imageVariant}
                      </Badge>
                      {generationMeta.runConfig.creativity ? (
                        <Badge variant="secondary">
                          Creativity: {generationMeta.runConfig.creativity}
                        </Badge>
                      ) : null}
                    </>
                  ) : null}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    ['Positioning', experience.artDirection.positioning],
                    ['Visual System', experience.artDirection.visualSystem],
                    [
                      'Mobile Principle',
                      experience.artDirection.mobilePrinciple,
                    ],
                    ['Image Plan', experience.artDirection.imagePlan],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border bg-card p-3">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        {label}
                      </p>
                      <p className="mt-2 text-sm leading-6">
                        {cleanAPlusDisplayText(value)}
                      </p>
                    </div>
                  ))}
                </div>

                {generationMeta?.assumptions?.length ? (
                  <div className="rounded-md border bg-card p-3">
                    <p className="text-sm font-medium">Assumptions</p>
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {cleanAPlusDisplayLines(generationMeta.assumptions).map(
                        (assumption) => (
                          <li key={assumption}>- {assumption}</li>
                        )
                      )}
                    </ul>
                  </div>
                ) : null}

                <div className="grid gap-3 md:grid-cols-2">
                  {(generationMeta?.sellerCentralBuildSheet ?? []).map(
                    (row) => (
                      <div
                        key={`${row.step}-${row.value}`}
                        className="rounded-md border bg-card p-3 text-sm"
                      >
                        <p className="font-medium">{row.step}</p>
                        <p className="mt-1 text-muted-foreground">
                          {cleanAPlusDisplayText(row.value)}
                        </p>
                      </div>
                    )
                  )}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          <div className="space-y-3">
            <APlusSectionsPanel
              experience={experience}
              deployment={deployment}
              tier={contentTier}
              slotResults={imageJobResults}
              onEditTitle={updateExperienceTitle}
              onEditGoal={updateExperienceGoal}
              onEditSectionField={updateSectionText}
              onEditSectionNotes={updateSectionNotes}
              onToggleSectionLock={toggleSectionLock}
              onMoveSection={moveSection}
              onGenerateImage={(jobId, brief, size) =>
                generateImageForJob(jobId, brief, size)
              }
            />
          </div>
        </CardContent>
      </Card>
    ) : null;

  const tabsSection = (
    <Tabs defaultValue="guidance" className="space-y-4">
      <TabsList>
        <TabsTrigger value="guidance">Guidance</TabsTrigger>
        <TabsTrigger value="output">Output</TabsTrigger>
        <TabsTrigger value="checks">Checks</TabsTrigger>
      </TabsList>

      <TabsContent value="guidance" className="space-y-4">
        <APlusGuidancePanel
          strategyPromptPreview={strategyPromptPreview}
          moduleCopyRulesPreview={MODULE_COPY_RULES_PREVIEW}
          guidanceStrategy={guidanceStrategy}
          guidanceModuleCopy={guidanceModuleCopy}
          onGuidanceStrategyChange={setGuidanceStrategy}
          onGuidanceModuleCopyChange={setGuidanceModuleCopy}
          onCopyStrategyPrompt={copyPrompt}
          strategyPromptCopied={promptCopied}
        />
      </TabsContent>

      <TabsContent value="output" className="space-y-4">
        <div className="rounded-md border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Amazon Builder Package</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Copy this into the next API/import layer or use it as the Seller
                Central build sheet.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyPackage}
            >
              <Clipboard className="mr-2 h-4 w-4" />
              {copied ? 'Copied' : 'Copy JSON'}
            </Button>
          </div>
        </div>
        <pre className="max-h-[70vh] overflow-auto rounded-md border bg-muted p-4 text-xs leading-5">
          {JSON.stringify(packageJson, null, 2)}
        </pre>
      </TabsContent>

      <TabsContent value="checks" className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {[
            'Each visual section maps to a real Amazon module.',
            'Mobile copy and desktop copy share the same source module.',
            'Logo is reserved as an upload slot, not regenerated by AI.',
            'All generated headlines stay under the module character limits.',
            'Final copy needs spelling and compliance review before approval submission.',
            'A+ API publishing requires Product Listing or Brand Analytics access.',
          ].map((check, index) => (
            <div key={check} className="rounded-md border bg-card p-4">
              <div className="flex items-start gap-3">
                {index < 4 ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 text-amber-600" />
                )}
                <p className="text-sm leading-6">{check}</p>
              </div>
            </div>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-bold">AI A+ Content Studio</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Drop messy product links, supplier pages, competitor references,
              raw photos, polished assets, and logo rules. SellAvant turns them
              into an Amazon-editable A+ package with desktop/mobile design
              blueprints.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex rounded-md border bg-background p-1">
              <Button
                type="button"
                variant={builderMode === 'simple' ? 'default' : 'ghost'}
                size="sm"
                className="h-8"
                onClick={() => setBuilderMode('simple')}
              >
                Simple
              </Button>
              <Button
                type="button"
                variant={builderMode === 'advanced' ? 'default' : 'ghost'}
                size="sm"
                className="h-8"
                onClick={() => setBuilderMode('advanced')}
              >
                Advanced
              </Button>
            </div>
            <Badge variant="outline" className="gap-1.5">
              <Bot className="h-3.5 w-3.5" />
              AI package
            </Badge>
            {experience ? (
              <Badge variant="outline" className="gap-1.5">
                <PackageCheck className="h-3.5 w-3.5" />
                {experience.sections.length} sections
              </Badge>
            ) : null}
            <Badge variant="outline" className="gap-1.5">
              <FileImage className="h-3.5 w-3.5" />
              {libraryAssetCount} images
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              API path confirmed
            </Badge>
          </div>
        </div>
      </div>

      {builderMode === 'advanced' ? (
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-4">
            {draftWorkspaceCard}
            {intakeCard}
            {sourcesCard}
            {assetsCard}
          </aside>

          <main className="min-w-0">
            {generationBrief}
            {tabsSection}
          </main>
        </div>
      ) : (
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
          <div className="rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-medium text-primary">Simple flow</p>
                <h2 className="mt-1 text-xl font-semibold">
                  {currentWizardStep.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {currentWizardStep.body}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push('/a-plus')}
                  >
                    <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                    Designs
                  </Button>
                  <select
                    aria-label="Open a saved design"
                    value={draftId || ''}
                    onChange={(event) => {
                      if (event.target.value)
                        router.push(`/a-plus/${event.target.value}`);
                    }}
                    className={cn(
                      COMPACT_SELECT_CLASSNAME,
                      'min-w-[200px] max-w-[320px]'
                    )}
                  >
                    <option value="">
                      {drafts.length
                        ? 'Open a saved design…'
                        : 'No saved designs yet'}
                    </option>
                    {drafts.map((draft) => (
                      <option key={draft.draftId} value={draft.draftId}>
                        {formatDraftOption(draft)}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => router.push('/a-plus/new')}
                  >
                    New
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {draftId
                    ? `Saved as “${draftName}” · auto-saving`
                    : 'New designs auto-save to your library once generated.'}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              {SIMPLE_WIZARD_STEPS.map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => goToWizardStep(step.id)}
                  className={cn(
                    'rounded-md border px-3 py-3 text-left transition-colors',
                    step.id === wizardStep
                      ? 'border-primary bg-primary/5'
                      : 'bg-background hover:bg-muted/50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium">{step.title}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {step.body}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {wizardStep === 'basics' && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-6">{intakeCard}</div>
              <div className="space-y-6">
                {brandGuideWizardCard}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      What happens here
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <p>
                      Start with the product, listing URL, and whatever rough
                      notes you already have.
                    </p>
                    <p>
                      Once the product and brand style are clear, the rest of
                      the wizard can focus on sources, assets, and the final A+
                      package.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {wizardStep === 'sources' && (
            <div className="space-y-6">
              {sourcesCard}
              {generationBrief}
            </div>
          )}

          {wizardStep === 'assets' && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-6">
                {assetsCard}
                <div className="rounded-md border bg-card p-4">
                  <h3 className="font-semibold">How SellAvant uses them</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The AI will classify each image as a product shot, lifestyle
                    scene, package detail, logo, comparison reference, or source
                    material, then recommend the right Amazon A+ modules around
                    the strongest assets.
                  </p>
                </div>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Image Library</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-md border bg-muted/40 p-3">
                    <p className="text-2xl font-semibold">
                      {libraryAssetCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      uploaded images
                    </p>
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      Add a short description when it is not obvious what the
                      image shows.
                    </p>
                    <p>
                      You do not need to decide which module gets which image.
                      That happens during generation.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {wizardStep === 'review' && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <WandSparkles className="h-4 w-4 text-primary" />
                    Generate Package
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="draft-name">Draft name</Label>
                    <Input
                      id="draft-name"
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      placeholder="Spring launch A+"
                      className={FIELD_CLASSNAME}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="design-style-main">Design style</Label>
                    <select
                      id="design-style-main"
                      aria-label="Design style"
                      value={designStyle}
                      onChange={(event) =>
                        setDesignStyle(event.target.value as DesignStyleKey)
                      }
                      className={FIELD_CLASSNAME}
                    >
                      {DESIGN_STYLE_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {DESIGN_STYLE_LABELS[key]}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Sets the layout &amp; look for the whole package — applies
                      live to the preview below.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="generation-model">Generation model</Label>
                    <select
                      id="generation-model"
                      aria-label="Generation model"
                      value={generationModel}
                      onChange={(event) =>
                        setGenerationModel(event.target.value)
                      }
                      className={FIELD_CLASSNAME}
                    >
                      <optgroup label="Anthropic">
                        {APLUS_GENERATION_MODELS.filter(
                          (model) => model.provider === 'Anthropic'
                        ).map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="OpenAI">
                        {APLUS_GENERATION_MODELS.filter(
                          (model) => model.provider === 'OpenAI'
                        ).map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Model used to write the strategy and module copy. Larger
                      models are slower but stronger.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="generation-creativity">Creativity</Label>
                    <select
                      id="generation-creativity"
                      aria-label="Creativity"
                      value={creativity}
                      onChange={(event) =>
                        setCreativity(event.target.value as APlusCreativity)
                      }
                      className={FIELD_CLASSNAME}
                    >
                      <option value="low">
                        Low — plays it safe, sticks closely to your facts
                      </option>
                      <option value="medium">
                        Medium — balanced (recommended)
                      </option>
                      <option value="high">
                        High — bolder angles, more varied wording
                      </option>
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Applies to copywriting; the module plan itself stays
                      grounded.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      onClick={() => void generateAPlusPackage()}
                      disabled={generateStatus === 'generating'}
                    >
                      {generateStatus === 'generating' ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <WandSparkles className="mr-2 h-4 w-4" />
                      )}
                      {generateStatus === 'generating'
                        ? 'Generating'
                        : experience
                        ? 'Regenerate Package'
                        : 'Generate A+ Package'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void saveDraft()}
                      disabled={
                        saveStatus === 'saving' || saveStatus === 'loading'
                      }
                    >
                      {saveStatus === 'saving' || saveStatus === 'loading' ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Clipboard className="mr-2 h-4 w-4" />
                      )}
                      {saveStatus === 'saved'
                        ? 'Saved'
                        : saveStatus === 'error'
                        ? 'Retry save'
                        : 'Save draft'}
                    </Button>
                  </div>
                  {generateStatus === 'generating' ? (
                    <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-900">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="font-medium">
                            {generationProgress.phase === 'strategy'
                              ? 'Building strategy…'
                              : generationProgress.phase === 'package-outer'
                              ? 'Planning module structure…'
                              : generationProgress.phase === 'package-modules'
                              ? `Writing modules (${
                                  Object.values(
                                    generationProgress.moduleStatus ?? {}
                                  ).filter((s) => s !== 'pending').length
                                }/${
                                  generationProgress.moduleSpecs?.length ?? '?'
                                })…`
                              : generationProgress.phase === 'images'
                              ? 'Generating preview images…'
                              : generationProgress.phase === 'finalizing'
                              ? 'Finalizing…'
                              : 'Starting…'}
                          </span>
                        </div>
                        <span className="font-mono text-xs text-sky-700">
                          {((generationProgress.elapsedMs ?? 0) / 1000).toFixed(
                            1
                          )}
                          s
                        </span>
                      </div>
                      {generationProgress.moduleSpecs?.length ? (
                        <ul className="mt-3 space-y-1">
                          {generationProgress.moduleSpecs.map((spec) => {
                            const status =
                              generationProgress.moduleStatus?.[spec.order] ??
                              'pending';
                            return (
                              <li
                                key={spec.order}
                                className="flex items-center gap-2 text-xs"
                              >
                                {status === 'done' ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                ) : status === 'failed' ? (
                                  <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                                ) : (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />
                                )}
                                <span className="font-mono text-[10px] text-sky-700">
                                  M{spec.order}
                                </span>
                                <span className="truncate text-sky-900">
                                  {spec.title}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {generateStatus === 'error' && generateError ? (
                    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{generateError}</span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-red-300 bg-white hover:bg-red-100"
                        onClick={() => void generateAPlusPackage()}
                      >
                        <WandSparkles className="mr-2 h-3.5 w-3.5" />
                        Retry
                      </Button>
                    </div>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    SellAvant will run separate strategy and package models,
                    then produce the actual module copy, paired desktop/mobile
                    blueprints, asset assignments, logo dropzones, optional
                    image briefs, and Seller Central build sheet.
                  </p>
                </CardContent>
              </Card>
              {generatedPackageCard}
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border bg-card p-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => moveWizardStep(-1)}
              disabled={activeWizardIndex <= 0}
            >
              Back
            </Button>
            <p className="text-sm text-muted-foreground">
              Step {activeWizardIndex + 1} of {SIMPLE_WIZARD_STEPS.length}
            </p>
            <Button
              type="button"
              onClick={() => moveWizardStep(1)}
              disabled={activeWizardIndex >= SIMPLE_WIZARD_STEPS.length - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {previewImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-h-full max-w-4xl"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={`/api/a-plus/assets/${previewImage.assetId}`}
              alt={previewImage.fileName}
              className="max-h-[85vh] w-auto rounded-md object-contain shadow-2xl"
            />
            <div className="mt-2 flex items-center justify-between gap-3 text-sm text-white">
              <span className="truncate">{previewImage.fileName}</span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setPreviewImage(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
