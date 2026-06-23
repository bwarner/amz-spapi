'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  BrainCircuit,
  ChevronDown,
  CheckCircle2,
  Clipboard,
  FileImage,
  FileText,
  ImagePlus,
  Layers3,
  Link as LinkIcon,
  Loader2,
  Monitor,
  PackageCheck,
  Plus,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import {
  APLUS_GENERATION_MODELS,
  applyAPlusGuardrails,
  moduleImageSlots,
  type APlusGeneratedModule as GeneratedModule,
} from '@farvisionllc/models';
import {
  APlusModuleProductionDetails,
  slotJobId,
} from './components/a-plus-modules';
import {
  brandThemeFrom,
  DESIGN_STYLE_KEYS,
  DESIGN_STYLE_LABELS,
  type DesignStyleKey,
} from './components/a-plus-design';
import { APlusDesignedPreview } from './components/a-plus-design-preview';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

type AssetSlot = {
  id: string;
  label: string;
  detail: string;
  minSize: string;
  fileName?: string;
  asset?: UploadedAsset;
  uploadStatus?:
    | 'idle'
    | 'hashing'
    | 'uploading'
    | 'uploaded'
    | 'duplicate'
    | 'error';
  uploadMessage?: string;
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

type APlusModule = {
  id: string;
  tier: ContentTier;
  amazonType: string;
  title: string;
  role: string;
  desktop: string;
  mobile: string;
  copy: string[];
  imageSlots: AssetSlot[];
  status: 'ready' | 'needs-assets' | 'needs-review';
};

type PackageImageJob = {
  jobId: string;
  prompt: string;
  size: string;
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
  strategyId?: string;
  sources?: SourceLink[];
  assets?: AssetLibraryItem[];
  modules?: APlusModule[];
  generatedPackage?: GeneratedAPlusResponse;
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

type GeneratedAPlusResponse = {
  strategy: unknown;
  package: GeneratedAPlusPackage;
  /** Which A/B paths actually ran for this generation. */
  runConfig?: {
    generationMode: string;
    imageVariant: string;
    model: string;
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

const APLUS_PROMPT_RULES = [
  'Work in two phases: discovery/wireframe first, production assets second.',
  'Recommend real Amazon A+ module types instead of one flattened graphic.',
  'Show desktop and mobile plans side-by-side for every module.',
  'Reserve explicit logo safe zones with X/Y/W/H coordinates and contrast notes.',
  'Do not ask image generation to render logos, text, watermarks, or words.',
  'Generate editable copy, image prompts, alt text, and Canva layer instructions.',
  'Flag unsupported claims, gated sources, missing product facts, and spelling risks.',
];

const BASIC_MODULE_LIMIT = 5;
const PREMIUM_MODULE_LIMIT = 7;
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

const BASIC_MODULES: APlusModule[] = [
  {
    id: 'brand-logo',
    tier: 'Basic A+',
    amazonType: 'STANDARD_COMPANY_LOGO',
    title: 'Brand mark',
    role: 'Logo-only brand anchor',
    desktop: 'Logo centered in a 600 x 180 safe area.',
    mobile: 'Same logo asset, scaled down with matching clear space.',
    copy: ['Alt text: Brand logo'],
    status: 'needs-assets',
    imageSlots: [
      {
        id: 'logo',
        label: 'Logo',
        detail:
          'Transparent PNG or clean JPG. Keep the brand mark unrendered by AI.',
        minSize: '600 x 180',
      },
    ],
  },
  {
    id: 'hero',
    tier: 'Basic A+',
    amazonType: 'STANDARD_IMAGE_TEXT_OVERLAY',
    title: 'Hero promise',
    role: 'Lead benefit and visual hook',
    desktop: 'Wide hero with text overlay kept inside Amazon text limits.',
    mobile: 'Same hierarchy, cropped from the center with the headline first.',
    copy: [
      'Headline: A clearer way to show the product promise',
      'Body: One concise paragraph focused on the primary customer outcome.',
    ],
    status: 'needs-assets',
    imageSlots: [
      {
        id: 'hero-image',
        label: 'Hero image',
        detail: 'Use polished product photography or lifestyle context.',
        minSize: '970 x 300',
      },
    ],
  },
  {
    id: 'story',
    tier: 'Basic A+',
    amazonType: 'STANDARD_HEADER_IMAGE_TEXT',
    title: 'Product story',
    role: 'Explain what it is and why it matters',
    desktop: 'Header image above concise body copy.',
    mobile: 'Image remains first, body copy broken into short readable lines.',
    copy: [
      'Headline: Built for the moments your customers care about',
      'Body: A proofed description assembled from listing, supplier, and competitor inputs.',
    ],
    status: 'needs-review',
    imageSlots: [
      {
        id: 'story-image',
        label: 'Story image',
        detail: 'Raw or polished product photo accepted.',
        minSize: '970 x 600',
      },
    ],
  },
  {
    id: 'features',
    tier: 'Basic A+',
    amazonType: 'STANDARD_THREE_IMAGE_TEXT',
    title: 'Three feature blocks',
    role: 'Break benefits into Amazon-editable modules',
    desktop: 'Three equal columns with one image, headline, and body each.',
    mobile: 'The same three blocks stack in the same order.',
    copy: [
      'Block 1: Primary differentiator with evidence.',
      'Block 2: Use-case benefit that answers a buyer objection.',
      'Block 3: Material, compatibility, or durability proof point.',
    ],
    status: 'needs-assets',
    imageSlots: [
      {
        id: 'feature-1',
        label: 'Feature 1',
        detail: 'Close-up or annotation image.',
        minSize: '300 x 300',
      },
      {
        id: 'feature-2',
        label: 'Feature 2',
        detail: 'Use-case or scale image.',
        minSize: '300 x 300',
      },
      {
        id: 'feature-3',
        label: 'Feature 3',
        detail: 'Detail, material, or package image.',
        minSize: '300 x 300',
      },
    ],
  },
  {
    id: 'comparison',
    tier: 'Basic A+',
    amazonType: 'STANDARD_COMPARISON_TABLE',
    title: 'Comparison table',
    role: 'Position against alternatives without hand-cutting graphics',
    desktop: 'Amazon comparison module with product columns.',
    mobile: 'Amazon handles responsive table behavior from the same data.',
    copy: [
      'Columns: This product, competitor alternatives, adjacent SKU.',
      'Rows: best use, core differentiator, size/material, included items.',
    ],
    status: 'needs-review',
    imageSlots: [],
  },
  {
    id: 'specs',
    tier: 'Basic A+',
    amazonType: 'STANDARD_TECH_SPECS',
    title: 'Specs and compatibility',
    role: 'Turn claims into structured product facts',
    desktop: 'Specification table with short labels.',
    mobile: 'Same spec rows, no separate mobile copy.',
    copy: [
      'Include: dimensions, materials, care, compatibility, package contents.',
      'Avoid: unverifiable claims, ranking language, or unsupported guarantees.',
    ],
    status: 'ready',
    imageSlots: [],
  },
  {
    id: 'single-image-text',
    tier: 'Basic A+',
    amazonType: 'STANDARD_SINGLE_IMAGE_TEXT',
    title: 'Single image and text',
    role: 'Focus one benefit with one strong visual',
    desktop: 'One image paired with a concise headline and body.',
    mobile: 'Image and copy stack from the same module.',
    copy: [
      'Headline: One sharp product benefit',
      'Body: Explain the proof point without turning it into a graphic.',
    ],
    status: 'needs-assets',
    imageSlots: [
      {
        id: 'single-image',
        label: 'Single image',
        detail: 'Use a product or use-case image with clear subject focus.',
        minSize: '970 x 600',
      },
    ],
  },
  {
    id: 'side-image',
    tier: 'Basic A+',
    amazonType: 'STANDARD_SINGLE_SIDE_IMAGE',
    title: 'Side image detail',
    role: 'Pair detail copy with a close-up visual',
    desktop: 'Image sits beside short, scannable copy.',
    mobile: 'Image stacks before the matching copy block.',
    copy: [
      'Headline: Show the detail buyers inspect',
      'Body: Use for materials, mechanism, texture, compatibility, or scale.',
    ],
    status: 'needs-assets',
    imageSlots: [
      {
        id: 'side-image',
        label: 'Side image',
        detail: 'Close-up, annotation-ready, or scale reference photo.',
        minSize: '300 x 300',
      },
    ],
  },
  {
    id: 'four-quadrant',
    tier: 'Basic A+',
    amazonType: 'STANDARD_FOUR_IMAGE_TEXT',
    title: 'Four image grid',
    role: 'Show use cases, benefits, or kit components',
    desktop: 'Four equal image/text blocks in a grid.',
    mobile: 'Blocks stack in the same order.',
    copy: [
      'Block 1: Benefit or component.',
      'Block 2: Benefit or component.',
      'Block 3: Benefit or component.',
      'Block 4: Benefit or component.',
    ],
    status: 'needs-assets',
    imageSlots: [
      {
        id: 'quad-1',
        label: 'Grid image 1',
        detail: 'Use-case, component, or benefit visual.',
        minSize: '220 x 220',
      },
      {
        id: 'quad-2',
        label: 'Grid image 2',
        detail: 'Use-case, component, or benefit visual.',
        minSize: '220 x 220',
      },
      {
        id: 'quad-3',
        label: 'Grid image 3',
        detail: 'Use-case, component, or benefit visual.',
        minSize: '220 x 220',
      },
      {
        id: 'quad-4',
        label: 'Grid image 4',
        detail: 'Use-case, component, or benefit visual.',
        minSize: '220 x 220',
      },
    ],
  },
  {
    id: 'text-only',
    tier: 'Basic A+',
    amazonType: 'STANDARD_TEXT',
    title: 'Text block',
    role: 'Use when copy matters more than imagery',
    desktop: 'Short headline and proof-led body copy.',
    mobile: 'Same text source, kept concise.',
    copy: [
      'Headline: Clarify the buyer promise',
      'Body: Use for origin story, care instructions, compliance-safe claims, or warranty language.',
    ],
    status: 'needs-review',
    imageSlots: [],
  },
];

const PREMIUM_MODULES: APlusModule[] = [
  {
    id: 'premium-hero',
    tier: 'Premium A+',
    amazonType: 'PREMIUM_BACKGROUND_IMAGE_WITH_TEXT',
    title: 'Premium hero',
    role: 'Large immersive lead benefit with editable overlay copy',
    desktop:
      '1464 x 600 background image with a reserved logo zone and copy overlay.',
    mobile:
      '600 x 450 version using the same hierarchy and a matched logo zone.',
    copy: [
      'Headline: Lead with the premium product promise.',
      'Body: Keep copy short enough for a clean mobile overlay.',
    ],
    status: 'needs-assets',
    imageSlots: [
      {
        id: 'premium-hero-desktop',
        label: 'Hero desktop',
        detail: 'Generate or upload a 1464 x 600 hero with an empty logo zone.',
        minSize: '1464 x 600',
      },
      {
        id: 'premium-hero-mobile',
        label: 'Hero mobile',
        detail: 'Matched 600 x 450 crop/composition, not an unrelated design.',
        minSize: '600 x 450',
      },
    ],
  },
  {
    id: 'premium-full-image',
    tier: 'Premium A+',
    amazonType: 'PREMIUM_FULL_IMAGE',
    title: 'Premium full image',
    role: 'Show a clean product/lifestyle scene without flattening text into the image',
    desktop: '1464 x 600 full-width image with optional copy above or below.',
    mobile: '600 x 450 scaled/cropped image preserving the same story.',
    copy: ['Alt text: Product shown in its primary use context.'],
    status: 'needs-assets',
    imageSlots: [
      {
        id: 'full-image-desktop',
        label: 'Full image desktop',
        detail: 'Full-width premium visual, no generated text or logo.',
        minSize: '1464 x 600',
      },
      {
        id: 'full-image-mobile',
        label: 'Full image mobile',
        detail: 'Mobile companion crop with the same subject and intent.',
        minSize: '600 x 450',
      },
    ],
  },
  {
    id: 'premium-hotspots',
    tier: 'Premium A+',
    amazonType: 'PREMIUM_HOTSPOTS',
    title: 'Premium hotspots',
    role: 'Let buyers explore materials, features, or included parts interactively',
    desktop: '1464 x 600 base image with up to six hotspot callouts.',
    mobile:
      'Scaled/tap behavior with the same hotspot order and concise callouts.',
    copy: [
      'Hotspot 1: Primary differentiator.',
      'Hotspot 2: Material, mechanism, or compatibility proof.',
      'Hotspot 3: Included item, scale, or use-case detail.',
    ],
    status: 'needs-assets',
    imageSlots: [
      {
        id: 'hotspot-base',
        label: 'Hotspot base image',
        detail:
          'Wide image with clear areas for hotspot markers and logo zone.',
        minSize: '1464 x 600',
      },
    ],
  },
  {
    id: 'premium-carousel',
    tier: 'Premium A+',
    amazonType: 'PREMIUM_NAVIGATION_CAROUSEL',
    title: 'Premium carousel',
    role: 'Organize use cases, features, or regimen steps into swipeable panels',
    desktop: '2-5 panels at 1464 x 600 with tab labels.',
    mobile: 'Same panel sequence, swipeable, with mobile-safe typography.',
    copy: [
      'Panel 1: Main use case.',
      'Panel 2: Differentiator.',
      'Panel 3: Proof or objection answer.',
    ],
    status: 'needs-assets',
    imageSlots: [
      {
        id: 'carousel-panel-1',
        label: 'Carousel panel 1',
        detail: 'First panel visual with clear logo-safe area.',
        minSize: '1464 x 600',
      },
      {
        id: 'carousel-panel-2',
        label: 'Carousel panel 2',
        detail: 'Second panel visual matched to the first.',
        minSize: '1464 x 600',
      },
      {
        id: 'carousel-panel-3',
        label: 'Carousel panel 3',
        detail: 'Third panel visual for proof, scale, or use case.',
        minSize: '1464 x 600',
      },
    ],
  },
  {
    id: 'premium-four-images',
    tier: 'Premium A+',
    amazonType: 'PREMIUM_FOUR_IMAGES_TEXT',
    title: 'Premium four feature grid',
    role: 'Four higher-resolution benefit blocks with editable text',
    desktop: 'Four 300 x 225 visuals with short headline/body copy.',
    mobile: '2x2 or stacked layout preserving the same block order.',
    copy: [
      'Block 1: Best buyer outcome.',
      'Block 2: Differentiator.',
      'Block 3: Objection answer.',
      'Block 4: Trust or compatibility proof.',
    ],
    status: 'needs-assets',
    imageSlots: [
      {
        id: 'premium-feature-1',
        label: 'Premium feature 1',
        detail: 'High-res feature visual.',
        minSize: '300 x 225',
      },
      {
        id: 'premium-feature-2',
        label: 'Premium feature 2',
        detail: 'High-res feature visual.',
        minSize: '300 x 225',
      },
      {
        id: 'premium-feature-3',
        label: 'Premium feature 3',
        detail: 'High-res feature visual.',
        minSize: '300 x 225',
      },
      {
        id: 'premium-feature-4',
        label: 'Premium feature 4',
        detail: 'High-res feature visual.',
        minSize: '300 x 225',
      },
    ],
  },
  {
    id: 'premium-comparison',
    tier: 'Premium A+',
    amazonType: 'PREMIUM_COMPARISON_TABLE',
    title: 'Premium comparison',
    role: 'Compare this product against competitors or adjacent SKUs',
    desktop: 'Hero product plus 3-6 comparison products with 5-12 metrics.',
    mobile: 'Scrollable/toggle comparison using the same data.',
    copy: [
      'Columns: This product, competitor alternatives, adjacent SKUs.',
      'Rows: best use, differentiator, material/size, included items, compatibility.',
    ],
    status: 'needs-review',
    imageSlots: [],
  },
  {
    id: 'premium-video',
    tier: 'Premium A+',
    amazonType: 'PREMIUM_FULL_VIDEO',
    title: 'Premium video',
    role: 'Demonstrate setup, use, transformation, or quality proof',
    desktop: 'MP4 video, 1920 x 1080 minimum, 15 seconds to 3 minutes.',
    mobile:
      'Amazon scales the video; thumbnail needs mobile-safe subject framing.',
    copy: [
      'Storyboard: opening problem, product in use, proof detail, final benefit.',
      'Thumbnail: no text baked in; reserve logo or product-safe area only.',
    ],
    status: 'needs-assets',
    imageSlots: [
      {
        id: 'video-thumbnail',
        label: 'Video thumbnail',
        detail: 'Still image for the Premium video module.',
        minSize: '1464 x 600',
      },
    ],
  },
  {
    id: 'premium-qa',
    tier: 'Premium A+',
    amazonType: 'PREMIUM_QA',
    title: 'Premium Q&A',
    role: 'Answer objections in an expandable module',
    desktop: '2-5 questions with concise answers.',
    mobile: 'Same questions and answers in accordion behavior.',
    copy: [
      'Question 1: Answer the biggest purchase objection.',
      'Question 2: Clarify sizing, compatibility, care, or setup.',
      'Question 3: Reinforce proof without unsupported claims.',
    ],
    status: 'needs-review',
    imageSlots: [],
  },
  {
    id: 'premium-specs',
    tier: 'Premium A+',
    amazonType: 'PREMIUM_TECHNICAL_SPECIFICATIONS',
    title: 'Premium technical specs',
    role: 'Turn product facts into a richer specifications table',
    desktop: '4-16 metric rows with short labels.',
    mobile: 'Same structured rows with no separate mobile copy.',
    copy: [
      'Include: dimensions, materials, care, compatibility, contents, certifications.',
      'Avoid: unverifiable superlatives, guarantees, and ranking language.',
    ],
    status: 'ready',
    imageSlots: [],
  },
];

type ModuleStrategy = {
  id: string;
  tier: ContentTier;
  name: string;
  description: string;
  moduleIds: string[];
};

const MODULE_LIBRARY = [...BASIC_MODULES, ...PREMIUM_MODULES];

const MODULE_STRATEGIES: ModuleStrategy[] = [
  {
    id: 'basic-balanced',
    tier: 'Basic A+',
    name: 'Basic balanced launch',
    description:
      'Brand, hero, story, features, and specs within Basic A+ limits.',
    moduleIds: ['brand-logo', 'hero', 'story', 'features', 'specs'],
  },
  {
    id: 'basic-visual',
    tier: 'Basic A+',
    name: 'Basic visual product',
    description: 'Best when photos and lifestyle use cases sell the product.',
    moduleIds: [
      'brand-logo',
      'hero',
      'single-image-text',
      'four-quadrant',
      'features',
    ],
  },
  {
    id: 'basic-technical',
    tier: 'Basic A+',
    name: 'Basic technical/spec heavy',
    description:
      'Best for compatibility, parts, dimensions, or utility products.',
    moduleIds: ['brand-logo', 'hero', 'side-image', 'features', 'specs'],
  },
  {
    id: 'basic-comparison',
    tier: 'Basic A+',
    name: 'Basic comparison driven',
    description: 'Best when competitors or adjacent SKUs are central.',
    moduleIds: ['brand-logo', 'hero', 'features', 'comparison', 'specs'],
  },
  {
    id: 'premium-immersive',
    tier: 'Premium A+',
    name: 'Premium immersive launch',
    description:
      'Large hero, full image, hotspots, carousel, feature grid, Q&A, and specs.',
    moduleIds: [
      'premium-hero',
      'premium-full-image',
      'premium-hotspots',
      'premium-carousel',
      'premium-four-images',
      'premium-qa',
      'premium-specs',
    ],
  },
  {
    id: 'premium-visual',
    tier: 'Premium A+',
    name: 'Premium visual storytelling',
    description:
      'Best when lifestyle imagery, panels, and product detail visuals carry the sale.',
    moduleIds: [
      'premium-hero',
      'premium-carousel',
      'premium-full-image',
      'premium-four-images',
      'premium-hotspots',
      'premium-comparison',
    ],
  },
  {
    id: 'premium-technical',
    tier: 'Premium A+',
    name: 'Premium technical proof',
    description:
      'Best for feature exploration, specs, compatibility, and objection handling.',
    moduleIds: [
      'premium-hero',
      'premium-hotspots',
      'premium-four-images',
      'premium-comparison',
      'premium-specs',
      'premium-qa',
    ],
  },
  {
    id: 'premium-video',
    tier: 'Premium A+',
    name: 'Premium video led',
    description:
      'Best when a demo, transformation, or setup sequence is central.',
    moduleIds: [
      'premium-hero',
      'premium-video',
      'premium-carousel',
      'premium-four-images',
      'premium-comparison',
      'premium-qa',
    ],
  },
];

function strategiesForTier(contentTier: ContentTier) {
  return MODULE_STRATEGIES.filter((strategy) => strategy.tier === contentTier);
}

function modulesForTier(contentTier: ContentTier) {
  return MODULE_LIBRARY.filter((module) => module.tier === contentTier);
}

function defaultStrategyId(contentTier: ContentTier) {
  return strategiesForTier(contentTier)[0]?.id || MODULE_STRATEGIES[0].id;
}

function createModule(
  templateId: string,
  contentTier: ContentTier
): APlusModule {
  const tierLibrary = modulesForTier(contentTier);
  const template =
    tierLibrary.find((module) => module.id === templateId) || tierLibrary[0];

  return {
    ...template,
    id:
      template.id +
      '-' +
      Date.now() +
      '-' +
      Math.random().toString(16).slice(2, 8),
    copy: [...template.copy],
    imageSlots: template.imageSlots.map((slot) => ({ ...slot })),
  };
}

function createStrategyModules(
  strategyId: string,
  contentTier: ContentTier
): APlusModule[] {
  const tierStrategies = strategiesForTier(contentTier);
  const strategy =
    tierStrategies.find((item) => item.id === strategyId) || tierStrategies[0];
  return strategy.moduleIds.map((moduleId) =>
    createModule(moduleId, contentTier)
  );
}

function statusLabel(status: APlusModule['status']) {
  if (status === 'ready') return 'Ready';
  if (status === 'needs-assets') return 'Assets';
  return 'Review';
}

function statusClass(status: APlusModule['status']) {
  if (status === 'ready')
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'needs-assets')
    return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-sky-200 bg-sky-50 text-sky-800';
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

function uploadedAssetsForPrompt(
  modules: APlusModule[],
  assetLibrary: AssetLibraryItem[]
) {
  const libraryAssets = assetLibrary
    .filter((item) => item.asset)
    .map((item) => ({
      source: 'Asset library',
      fileName: item.fileName,
      description: item.description,
      assetId: item.asset?.assetId,
      sha256: item.asset?.hashes.sha256,
      storageKey: item.asset?.storage.key,
    }));

  const slotAssets = modules.flatMap((module) =>
    module.imageSlots
      .filter((slot) => slot.asset)
      .map((slot) => ({
        source: `${module.title} / ${slot.label}`,
        module: module.title,
        slot: slot.label,
        fileName: slot.fileName,
        description: slot.detail,
        assetId: slot.asset?.assetId,
        sha256: slot.asset?.hashes.sha256,
        storageKey: slot.asset?.storage.key,
      }))
  );

  return [...libraryAssets, ...slotAssets];
}

function buildAPlusPrompt({
  productName,
  asin,
  contentTier,
  brandVoice,
  brandFontNotes,
  rawNotes,
  productOneLiner,
  targetCustomer,
  pricePoint,
  keyFeatures,
  differentiators,
  objections,
  brandColors,
  logoNotes,
  brandLogoAssetId,
  selectedBrandGuide,
  activeStrategy,
  sources,
  sourceChecks,
  assets,
  modules,
}: {
  productName: string;
  asin: string;
  contentTier: ContentTier;
  brandVoice: string;
  brandFontNotes: string;
  rawNotes: string;
  productOneLiner: string;
  targetCustomer: string;
  pricePoint: string;
  keyFeatures: string;
  differentiators: string;
  objections: string;
  brandColors: string;
  logoNotes: string;
  brandLogoAssetId: string;
  selectedBrandGuide: BrandGuide | null;
  activeStrategy: (typeof MODULE_STRATEGIES)[number];
  sources: SourceLink[];
  sourceChecks: Record<number, SourceCheck>;
  assets: AssetLibraryItem[];
  modules: APlusModule[];
}) {
  const moduleLimit =
    contentTier === 'Basic A+' ? BASIC_MODULE_LIMIT : PREMIUM_MODULE_LIMIT;
  const filledSources = sources.filter((source) => source.url.trim());
  const uploadedAssets = uploadedAssetsForPrompt(modules, assets);

  return [
    'You are SellAvant, an expert Amazon A+ content strategist and production designer.',
    '',
    'GOAL',
    `Create a ${contentTier} content package that can be entered into Amazon Seller Central A+ Content Manager without manually slicing one giant design.`,
    `Use no more than ${moduleLimit} modules unless you explicitly mark extras as optional alternates.`,
    contentTier === 'Premium A+'
      ? 'Use the Premium A+ module pool: background image with text, full image, comparison tables, dual/single image with text, four images, technical specs, carousels, hotspots, Q&A, and video modules.'
      : 'Use the Basic A+ module pool: company logo, image/text modules, comparison chart, text modules, and technical specifications.',
    '',
    'PRODUCT',
    `Name: ${productName || 'Not provided. Infer cautiously from sources.'}`,
    `ASIN: ${asin || 'Not provided.'}`,
    `One-sentence product description: ${
      productOneLiner || 'Infer from sources when enough evidence exists.'
    }`,
    `Price point: ${pricePoint || 'Not provided.'}`,
    `Target customer: ${
      targetCustomer || 'Infer from sources when enough evidence exists.'
    }`,
    '',
    'BRAND KIT',
    `Guide: ${
      selectedBrandGuide
        ? `${selectedBrandGuide.name}${
            selectedBrandGuide.brandName
              ? ` (${selectedBrandGuide.brandName})`
              : ''
          }`
        : 'No saved guide selected.'
    }`,
    `Voice: ${brandVoice || 'Clear, specific, conversion-focused, no hype.'}`,
    `Colors: ${
      brandColors ||
      'No saved colors. Infer cautiously from provided brand assets only.'
    }`,
    `Fonts: ${
      brandFontNotes || 'No saved brand fonts. Use clean Amazon-safe defaults.'
    }`,
    `Logo notes: ${
      logoNotes ||
      'Leave logo dropzones/placeholders. Do not recreate or stylize the logo.'
    }`,
    `Logo asset id: ${brandLogoAssetId || 'No uploaded logo asset attached.'}`,
    '',
    'RAW INPUTS',
    `Features and benefits: ${
      keyFeatures || 'Extract from links, photos, notes, and listing data.'
    }`,
    `Differentiators: ${
      differentiators || 'Extract from sources and competitor references.'
    }`,
    `Buyer objections: ${objections || 'Identify likely objections.'}`,
    `Other notes: ${rawNotes || 'None provided.'}`,
    '',
    'SOURCES',
    filledSources.length
      ? filledSources
          .map((source) => {
            const check = sourceChecks[source.id];
            const status = check
              ? ` - source check: ${check.status}${
                  check.httpStatus ? ` HTTP ${check.httpStatus}` : ''
                }${check.message ? `, ${check.message}` : ''}`
              : '';
            return `- ${source.kind}: ${source.url}${status}`;
          })
          .join('\n')
      : '- No links provided yet. Ask for an Amazon listing, supplier page, Alibaba page, Shopify page, or competitor links.',
    '',
    'UPLOADED ASSETS',
    uploadedAssets.length
      ? uploadedAssets
          .map(
            (asset) =>
              `- ${asset.fileName}; source=${asset.source}; description=${
                asset.description || 'None provided.'
              }; assetId=${asset.assetId}; sha256=${asset.sha256}; storageKey=${
                asset.storageKey
              }`
          )
          .join('\n')
      : '- No uploaded product/logo images yet. Request raw product photos, polished product photos, lifestyle photos, packaging shots, screenshots, and transparent logo files.',
    '',
    'STARTING MODULE STRATEGY',
    `${activeStrategy.name}: ${activeStrategy.description}. Treat this as a recommendation, not a user-selected design decision. Choose the best Amazon modules from the product facts and available assets.`,
    modules
      .slice(0, moduleLimit)
      .map(
        (module, index) =>
          `${index + 1}. ${module.amazonType} - ${module.title}: ${module.role}`
      )
      .join('\n'),
    '',
    'OUTPUT CONTRACT',
    APLUS_PROMPT_RULES.map((rule) => `- ${rule}`).join('\n'),
    '',
    'DELIVERABLES',
    '1. Missing-information questions, only if needed.',
    '2. Recommended module list with Amazon module type, role, copy, asset requirements, and why it belongs.',
    '3. Low-fidelity desktop/mobile wireframe for each module with logo safe zones.',
    '4. Image-generation prompts for each needed image with exact dimensions and empty logo areas.',
    '5. Canva/Seller Central build sheet with copy, alt text, module order, and image slots.',
    '6. Compliance and spelling review checklist before publishing.',
  ].join('\n');
}

function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s*\|.*\|/.test(text) || /(^|\n)\s*[-*+#]\s/.test(text);
}

function cleanAPlusDisplayText(text: string): string {
  return applyAPlusGuardrails(text).cleaned;
}

function cleanAPlusDisplayLines(lines: string[]): string[] {
  return lines.map(cleanAPlusDisplayText).filter(Boolean);
}

function prepareGeneratedImagePrompt(prompt: string, forbiddenText: string[]) {
  const specificForbiddenText = forbiddenText.length
    ? ` Do not render these exact strings anywhere in the image: ${forbiddenText
        .map((item) => `"${item}"`)
        .join(', ')}.`
    : '';

  return [
    prompt,
    '',
    `Important image rule: do not render brand names, brand badges, logos, brand lockups, watermarks, product labels with brand names, or readable brand marks anywhere in the image.${specificForbiddenText} Leave any brand/logo placement as an empty logo-safe area for later editing.`,
  ].join('\n');
}

function MarkdownText({
  text,
  className,
  fallbackTag = 'p',
}: {
  text: string;
  className?: string;
  fallbackTag?: 'p' | 'div';
}) {
  if (!text) return null;

  if (!looksLikeMarkdown(text)) {
    if (fallbackTag === 'div') {
      return <div className={className}>{text}</div>;
    }
    return <p className={className}>{text}</p>;
  }

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ node: _node, ...props }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs" {...props} />
            </div>
          ),
          thead: ({ node: _node, ...props }) => (
            <thead className="bg-muted" {...props} />
          ),
          th: ({ node: _node, ...props }) => (
            <th
              className="border border-border px-2 py-1.5 text-left font-medium"
              {...props}
            />
          ),
          td: ({ node: _node, ...props }) => (
            <td
              className="border border-border px-2 py-1.5 align-top"
              {...props}
            />
          ),
          p: ({ node: _node, ...props }) => (
            <p
              className="my-1.5 leading-relaxed last:mb-0 first:mt-0"
              {...props}
            />
          ),
          ul: ({ node: _node, ...props }) => (
            <ul className="my-1.5 list-disc space-y-1 pl-5" {...props} />
          ),
          ol: ({ node: _node, ...props }) => (
            <ol className="my-1.5 list-decimal space-y-1 pl-5" {...props} />
          ),
          h1: ({ node: _node, ...props }) => (
            <h4 className="mt-2 mb-1 text-sm font-semibold" {...props} />
          ),
          h2: ({ node: _node, ...props }) => (
            <h4 className="mt-2 mb-1 text-sm font-semibold" {...props} />
          ),
          h3: ({ node: _node, ...props }) => (
            <h4 className="mt-2 mb-1 text-sm font-semibold" {...props} />
          ),
          code: ({ node: _node, ...props }) => (
            <code
              className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]"
              {...props}
            />
          ),
          strong: ({ node: _node, ...props }) => (
            <strong className="font-semibold" {...props} />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ModuleCopy({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;

  const text = lines.join('\n');

  if (!looksLikeMarkdown(text)) {
    return (
      <div className="space-y-2">
        {lines.map((line) => (
          <p key={line} className="rounded-md border bg-card px-3 py-2 text-sm">
            {line}
          </p>
        ))}
      </div>
    );
  }

  return (
    <MarkdownText
      text={text}
      className="rounded-md border bg-card px-3 py-2 text-sm"
      fallbackTag="div"
    />
  );
}

function ModulePreview({
  module,
  canMoveUp,
  canMoveDown,
  canRemove,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  module: APlusModule;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const hasSlots = module.imageSlots.length > 0;

  return (
    <article className="rounded-md border bg-background">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{module.title}</h3>
            <Badge variant="outline" className="font-mono text-[10px]">
              {module.amazonType}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{module.role}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge className={cn('border', statusClass(module.status))}>
            {statusLabel(module.status)}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!canMoveUp}
            onClick={onMoveUp}
            title="Move module up"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!canMoveDown}
            onClick={onMoveDown}
            title="Move module down"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            disabled={!canRemove}
            onClick={onRemove}
            title="Remove module"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-3">
          <div className="rounded-md bg-muted p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Monitor className="h-4 w-4" />
              Desktop
            </div>
            <p className="text-sm text-muted-foreground">{module.desktop}</p>
          </div>
          <div className="rounded-md bg-muted p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Smartphone className="h-4 w-4" />
              Mobile
            </div>
            <p className="text-sm text-muted-foreground">{module.mobile}</p>
          </div>
          <ModuleCopy lines={module.copy} />
        </div>
        <div className="space-y-3">
          {hasSlots ? (
            module.imageSlots.map((slot) => {
              const previewable =
                slot.asset?.status === 'uploaded' &&
                (slot.asset.mimeType?.startsWith('image/') ?? true);
              return (
                <div key={slot.id} className="rounded-md border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <FileImage className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{slot.label}</span>
                    </div>
                    <Badge variant="secondary" className="text-[11px]">
                      {slot.fileName ? 'Attached' : 'Open'}
                    </Badge>
                  </div>
                  {previewable && slot.asset ? (
                    <div className="mt-3 overflow-hidden rounded-md border bg-muted">
                      <img
                        src={`/api/a-plus/assets/${slot.asset.assetId}`}
                        alt={slot.fileName || slot.label}
                        className="block max-h-48 w-full object-contain"
                        loading="lazy"
                      />
                    </div>
                  ) : null}
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {slot.fileName ||
                      'Reserved image slot for final Amazon upload.'}
                  </p>
                </div>
              );
            })
          ) : (
            <div className="rounded-md border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Text/data module
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                This module exports as structured copy instead of a flattened
                graphic.
              </p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
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
  const [assetLibrary, setAssetLibrary] = useState<AssetLibraryItem[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('Untitled A+ draft');
  const [brandGuideId, setBrandGuideId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [brandGuides, setBrandGuides] = useState<BrandGuide[]>([]);
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'loading' | 'saving' | 'saved' | 'error'
  >('idle');
  const [strategyId, setStrategyId] = useState(() =>
    defaultStrategyId('Basic A+')
  );
  const [sources, setSources] = useState<SourceLink[]>(DEFAULT_SOURCES);
  const [sourceChecks, setSourceChecks] = useState<Record<number, SourceCheck>>(
    {}
  );
  const [sourceExtractions, setSourceExtractions] = useState<
    Record<number, SourceExtraction>
  >({});
  const [modules, setModules] = useState<APlusModule[]>(() =>
    createStrategyModules(defaultStrategyId('Basic A+'), 'Basic A+')
  );
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
  const [generatedPackage, setGeneratedPackage] =
    useState<GeneratedAPlusResponse | null>(null);
  const [previewViewport, setPreviewViewport] =
    useState<PreviewViewport>('desktop');
  const [designStyle, setDesignStyle] = useState<DesignStyleKey>('editorial');
  const [generationModel, setGenerationModel] = useState<string>(
    APLUS_GENERATION_MODELS[0]?.id ?? 'anthropic/claude-haiku-4.5'
  );
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

  const activeStrategy =
    strategiesForTier(contentTier).find(
      (strategy) => strategy.id === strategyId
    ) ||
    strategiesForTier(contentTier)[0] ||
    MODULE_STRATEGIES[0];
  const availableStrategies = strategiesForTier(contentTier);
  const availableModules = modulesForTier(contentTier);

  const libraryAssetCount = assetLibrary.filter(
    (item) =>
      item.uploadStatus === 'uploaded' || item.uploadStatus === 'duplicate'
  ).length;
  const productListingSource =
    sources.find((source) => source.kind === 'Product listing') || sources[0];
  const productListingExtraction = productListingSource
    ? sourceExtractions[productListingSource.id]
    : undefined;

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
      strategyId,
      sources,
      assets: assetLibrary,
      modules,
      generatedPackage: generatedPackage ?? undefined,
    }),
    [
      asin,
      brandColors,
      brandFontNotes,
      brandVoice,
      builderMode,
      contentTier,
      differentiators,
      keyFeatures,
      logoNotes,
      brandLogoAssetId,
      assetLibrary,
      modules,
      objections,
      pricePoint,
      productName,
      productOneLiner,
      rawNotes,
      sources,
      strategyId,
      targetCustomer,
      wizardStep,
      generatedPackage,
    ]
  );

  const aiPrompt = useMemo(
    () =>
      buildAPlusPrompt({
        productName,
        asin,
        contentTier,
        brandVoice,
        rawNotes,
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
        selectedBrandGuide,
        activeStrategy,
        sources,
        sourceChecks,
        assets: assetLibrary,
        modules,
      }),
    [
      activeStrategy,
      asin,
      brandColors,
      brandFontNotes,
      brandVoice,
      contentTier,
      differentiators,
      keyFeatures,
      logoNotes,
      brandLogoAssetId,
      assetLibrary,
      modules,
      objections,
      pricePoint,
      productName,
      productOneLiner,
      rawNotes,
      sourceChecks,
      sources,
      targetCustomer,
    ]
  );

  const packageJson = useMemo(
    () => ({
      contentDocument: {
        name: productName || 'Untitled A+ content package',
        contentType: 'EMC',
        tier: contentTier,
        locale: 'en-US',
        moduleStrategy: activeStrategy.name,
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
        contentModuleList: modules.map((module) => ({
          id: module.id,
          tier: module.tier,
          contentModuleType: module.amazonType,
          title: module.title,
          desktopPlan: module.desktop,
          mobilePlan: module.mobile,
          copy: module.copy,
          imageSlots: module.imageSlots.map((slot) => ({
            id: slot.id,
            label: slot.label,
            minimumSize: slot.minSize,
            fileName: slot.fileName || null,
            assetId: slot.asset?.assetId || null,
            sha256: slot.asset?.hashes.sha256 || null,
            storage: slot.asset?.storage || null,
          })),
        })),
      },
      workflow: {
        apiPossible: true,
        aiPrompt,
        promptRules: APLUS_PROMPT_RULES,
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
      activeStrategy.name,
      asin,
      aiPrompt,
      brandColors,
      brandFontNotes,
      brandVoice,
      contentTier,
      differentiators,
      keyFeatures,
      logoNotes,
      brandLogoAssetId,
      assetLibrary,
      modules,
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
    if (!generatedPackage) return;
    const handle = window.setTimeout(() => {
      void saveDraft({ silent: true });
    }, 1200);
    return () => window.clearTimeout(handle);
  }, [generatedPackage]);

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

  async function uploadLibraryAsset(file: File) {
    const itemId = `${Date.now()}-${file.name}`;
    setAssetLibrary((current) => [
      ...current,
      {
        id: itemId,
        fileName: file.name,
        description: '',
        file,
        uploadStatus: 'hashing',
        uploadMessage: 'Fingerprinting image...',
      },
    ]);

    await uploadLibraryAssetById(itemId, file);
  }

  async function uploadLibraryAssetById(itemId: string, file: File) {
    try {
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
          mimeType: file.type || 'application/octet-stream',
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
    [...fileList]
      .filter((file) => file.type.startsWith('image/'))
      .forEach((file) => void uploadLibraryAsset(file));
  }

  function applyStrategy(nextStrategyId: string) {
    setStrategyId(nextStrategyId);
    setModules(createStrategyModules(nextStrategyId, contentTier));
  }

  function addModule(templateId: string) {
    setModules((current) => [
      ...current,
      createModule(templateId, contentTier),
    ]);
  }

  function applyContentTier(nextTier: ContentTier) {
    const nextStrategyId = defaultStrategyId(nextTier);
    setContentTier(nextTier);
    setStrategyId(nextStrategyId);
    setModules(createStrategyModules(nextStrategyId, nextTier));
  }

  function removeModule(moduleId: string) {
    setModules((current) =>
      current.length > 1
        ? current.filter((module) => module.id !== moduleId)
        : current
    );
  }

  function moveModule(moduleId: string, direction: -1 | 1) {
    setModules((current) => {
      const index = current.findIndex((module) => module.id === moduleId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [module] = next.splice(index, 1);
      next.splice(nextIndex, 0, module);
      return next;
    });
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
    await navigator.clipboard.writeText(aiPrompt);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  }

  function writeSlotImageIntoPackage(jobId: string, url: string) {
    const match = /^img-(\d+)-(.+)$/.exec(jobId);
    if (!match) return;
    // Only persist real asset references (e.g. /api/a-plus/assets/<id>). A
    // `data:` URL means the image failed to upload to storage (commonly expired
    // AWS creds); it stays in transient preview state but must NEVER be written
    // into the package — several 2-3MB base64 blobs exceed the draft request-body
    // limit and corrupt the save (Unterminated JSON / 500). The image still shows
    // in the preview via imageJobResults; it just won't survive a reload.
    if (url.startsWith('data:')) return;
    const order = Number(match[1]);
    const role = match[2];
    setGeneratedPackage((current) => {
      if (!current) return current;
      let changed = false;
      const modules = current.package.modules.map((module) => {
        if (module.order !== order) return module;
        const clone = structuredClone(module);
        for (const slot of moduleImageSlots(clone)) {
          if (slot.role === role) {
            slot.image = { url, alt: slot.alt };
            changed = true;
          }
        }
        return clone;
      });
      if (!changed) return current;
      return { ...current, package: { ...current.package, modules } };
    });
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
          prompt: prepareGeneratedImagePrompt(prompt, imageForbiddenText),
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
    if (!generatedPackage) return [];

    return generatedPackage.package.modules.flatMap((module) =>
      moduleImageSlots(module).map((slot) => ({
        jobId: slotJobId(module.order, slot.role),
        prompt: slot.brief,
        size: slot.size,
        hasImage: Boolean(slot.image?.url),
      }))
    );
  }, [generatedPackage]);

  const hasRunnablePackageImageJobs = allPackageImageJobs.some((job) => {
    if (job.hasImage) return false;
    const status = imageJobResults[job.jobId]?.status;
    return status !== 'done' && status !== 'generating';
  });

  const isGeneratingPackageImage = allPackageImageJobs.some(
    (job) => imageJobResults[job.jobId]?.status === 'generating'
  );

  function generateAllPackageImages() {
    for (const job of allPackageImageJobs) {
      // Never re-pay for a slot that already has an image — including a draft
      // reloaded from storage, where in-memory job status is empty.
      if (job.hasImage) continue;
      const status = imageJobResults[job.jobId]?.status;
      if (status === 'done' || status === 'generating') continue;
      void generateImageForJob(job.jobId, job.prompt, job.size);
    }
  }

  async function generateAPlusPackage() {
    setGenerateStatus('generating');
    setGenerateError('');
    setGenerationProgress({ startedAt: Date.now(), phase: 'strategy' });

    try {
      const response = await fetch('/api/a-plus/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName,
          asin,
          model: generationModel,
          contentTier,
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

      setGeneratedPackage(finalPayload);
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
    if (payload.strategyId) setStrategyId(payload.strategyId);
    if (payload.sources?.length) setSources(payload.sources);
    if (payload.modules?.length) setModules(payload.modules);
    if (payload.generatedPackage) setGeneratedPackage(payload.generatedPackage);
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
    const nextTier = 'Basic A+' as const;
    const nextStrategyId = defaultStrategyId(nextTier);
    setDraftId(null);
    setDraftName('Untitled A+ draft');
    setBuilderMode('simple');
    setWizardStep('basics');
    setProductName('');
    setAsin('');
    setContentTier(nextTier);
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
    setStrategyId(nextStrategyId);
    setSources(DEFAULT_SOURCES);
    setSourceChecks({});
    setModules(createStrategyModules(nextStrategyId, nextTier));
    setGeneratedPackage(null);
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

  const strategyCard = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers3 className="h-4 w-4 text-primary" />
          Module Strategy
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="module-strategy">Starting layout</Label>
          <select
            id="module-strategy"
            value={strategyId}
            onChange={(event) => applyStrategy(event.target.value)}
            className={SELECT_CLASSNAME}
          >
            {availableStrategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.name}
              </option>
            ))}
          </select>
          <p className="text-xs leading-5 text-muted-foreground">
            {activeStrategy.description}
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
              Advanced module controls
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label>Current module order</Label>
              <div className="space-y-1.5">
                {modules.map((module, index) => (
                  <div
                    key={module.id}
                    className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-xs"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-muted font-mono">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {module.title}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {module.imageSlots.length
                        ? `${module.imageSlots.length} img`
                        : 'text'}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Add module</Label>
              <div className="grid gap-2">
                {availableModules.map((module) => (
                  <Button
                    key={module.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto justify-start whitespace-normal py-2 text-left"
                    onClick={() => addModule(module.id)}
                  >
                    <Plus className="mr-2 h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm">{module.title}</span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {module.amazonType}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
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
          <Label htmlFor="notes">What you know so far</Label>
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

  const generatedPackageCard = generatedPackage ? (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageCheck className="h-4 w-4 text-primary" />
            Generated A+ Package
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
        <div>
          <h3 className="text-lg font-semibold">
            {cleanAPlusDisplayText(generatedPackage.package.title)}
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {cleanAPlusDisplayText(generatedPackage.package.executiveSummary)}
          </p>
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">A+ Page Preview</p>
              <p className="text-xs text-muted-foreground">
                Buyer-facing module stack. Layout and copy are live HTML; images
                fill in as you generate them.
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
                — they show in this preview but won’t persist on reload, and the
                draft won’t store them. This usually means your AWS sign-in
                expired. Run{' '}
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
            modules={generatedPackage.package.modules}
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
                {generatedPackage.modelRuns.map((run) => (
                  <Badge key={`${run.role}-${run.modelId}`} variant="outline">
                    {run.role === 'strategy'
                      ? 'Strategy model'
                      : 'Package model'}
                    : {run.provider} / {run.modelId}
                  </Badge>
                ))}
                <Badge variant="outline">
                  Images{' '}
                  {generatedPackage.imageGeneration.enabled ? 'on' : 'planned'}
                </Badge>
                {generatedPackage.runConfig ? (
                  <>
                    <Badge variant="secondary">
                      Mode: {generatedPackage.runConfig.generationMode}
                    </Badge>
                    <Badge variant="secondary">
                      Image: {generatedPackage.runConfig.imageVariant}
                    </Badge>
                  </>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {[
                  [
                    'Positioning',
                    generatedPackage.package.creativeDirection.positioning,
                  ],
                  [
                    'Visual System',
                    generatedPackage.package.creativeDirection.visualSystem,
                  ],
                  [
                    'Mobile Principle',
                    generatedPackage.package.creativeDirection.mobilePrinciple,
                  ],
                  [
                    'Image Plan',
                    generatedPackage.package.creativeDirection.imagePlan,
                  ],
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

              {generatedPackage.package.assumptions.length ? (
                <div className="rounded-md border bg-card p-3">
                  <p className="text-sm font-medium">Assumptions</p>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {cleanAPlusDisplayLines(
                      generatedPackage.package.assumptions
                    ).map((assumption) => (
                      <li key={assumption}>- {assumption}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                {generatedPackage.package.sellerCentralBuildSheet.map((row) => (
                  <div
                    key={`${row.step}-${row.value}`}
                    className="rounded-md border bg-card p-3 text-sm"
                  >
                    <p className="font-medium">{row.step}</p>
                    <p className="mt-1 text-muted-foreground">
                      {cleanAPlusDisplayText(row.value)}
                    </p>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        <div className="space-y-3">
          {generatedPackage.package.modules.map((module) => (
            <article
              key={`${module.order}-${module.amazonModuleType}`}
              className="rounded-md border bg-background"
            >
              <Collapsible>
                <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div>
                    <Badge variant="secondary">Module {module.order}</Badge>
                    <h4 className="mt-2 font-semibold">
                      {cleanAPlusDisplayText(module.title)}
                    </h4>
                    <p className="mt-1 text-xs font-mono text-muted-foreground">
                      {module.amazonModuleType}
                    </p>
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Build details
                      <ChevronDown className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  </CollapsibleTrigger>
                </div>

                <CollapsibleContent className="border-t p-4">
                  <APlusModuleProductionDetails
                    module={module}
                    slotResults={imageJobResults}
                    onGenerate={(jobId, brief, size) =>
                      generateImageForJob(jobId, brief, size)
                    }
                  />
                </CollapsibleContent>
              </Collapsible>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  ) : null;

  const tabsSection = (
    <Tabs defaultValue="brief" className="space-y-4">
      <TabsList>
        <TabsTrigger value="brief">AI Brief</TabsTrigger>
        <TabsTrigger value="modules">Modules</TabsTrigger>
        <TabsTrigger value="output">Output</TabsTrigger>
        <TabsTrigger value="checks">Checks</TabsTrigger>
      </TabsList>

      <TabsContent value="brief" className="space-y-4">
        <div className="rounded-md border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Prompt contract</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This is the working prompt assembled from your links, notes,
                uploaded assets, and module strategy.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyPrompt}
            >
              <Clipboard className="mr-2 h-4 w-4" />
              {promptCopied ? 'Copied' : 'Copy prompt'}
            </Button>
          </div>
        </div>
        <pre className="max-h-[70vh] overflow-auto rounded-md border bg-muted p-4 text-xs leading-5">
          {aiPrompt}
        </pre>
      </TabsContent>

      <TabsContent value="modules" className="space-y-4">
        <div className="rounded-md border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Editable package plan</h2>
            </div>
            <Button type="button" size="sm" onClick={copyPrompt}>
              <Sparkles className="mr-2 h-4 w-4" />
              Send to AI
            </Button>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            These modules are the starting layout the AI should refine, replace,
            or reorder based on the product and source evidence.
          </p>
        </div>
        {modules.map((module, index) => (
          <ModulePreview
            key={module.id}
            module={module}
            canMoveUp={index > 0}
            canMoveDown={index < modules.length - 1}
            canRemove={modules.length > 1}
            onMoveUp={() => moveModule(module.id, -1)}
            onMoveDown={() => moveModule(module.id, 1)}
            onRemove={() => removeModule(module.id)}
          />
        ))}
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
            <Badge variant="outline" className="gap-1.5">
              <PackageCheck className="h-3.5 w-3.5" />
              {modules.length} modules
            </Badge>
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
            {strategyCard}
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
                        : generatedPackage
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
