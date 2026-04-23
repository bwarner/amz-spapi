'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
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
  Upload,
  WandSparkles,
} from 'lucide-react';
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
import { cn } from '@/lib/utils';

type SourceKind = 'Product listing' | 'Competitor' | 'Supplier' | 'Reference';
type ContentTier = 'Basic A+' | 'Premium A+';

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
  voice?: string;
  logoNotes?: string;
};

type AmazonBrand = {
  name: string;
  asinCount: number;
  sampleAsins: string[];
  sampleProducts: string[];
  profiles: Array<{
    profileName: string;
    marketplaceId: string;
    region?: string;
    sellerId?: string;
    advertiserProfileId?: string;
  }>;
  source: 'ads' | 'sp-api';
};

type DraftPayload = {
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
  rawNotes?: string;
  strategyId?: string;
  sources?: SourceLink[];
  modules?: APlusModule[];
};

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

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match?.[0] ?? null;
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

function uploadedAssetsForPrompt(modules: APlusModule[]) {
  return modules.flatMap((module) =>
    module.imageSlots
      .filter((slot) => slot.asset)
      .map((slot) => ({
        module: module.title,
        slot: slot.label,
        fileName: slot.fileName,
        assetId: slot.asset?.assetId,
        sha256: slot.asset?.hashes.sha256,
        storageKey: slot.asset?.storage.key,
      }))
  );
}

function buildAPlusPrompt({
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
  logoNotes,
  activeStrategy,
  sources,
  sourceChecks,
  modules,
}: {
  productName: string;
  asin: string;
  contentTier: ContentTier;
  brandVoice: string;
  rawNotes: string;
  productOneLiner: string;
  targetCustomer: string;
  pricePoint: string;
  keyFeatures: string;
  differentiators: string;
  objections: string;
  brandColors: string;
  logoNotes: string;
  activeStrategy: (typeof MODULE_STRATEGIES)[number];
  sources: SourceLink[];
  sourceChecks: Record<number, SourceCheck>;
  modules: APlusModule[];
}) {
  const moduleLimit =
    contentTier === 'Basic A+' ? BASIC_MODULE_LIMIT : PREMIUM_MODULE_LIMIT;
  const filledSources = sources.filter((source) => source.url.trim());
  const uploadedAssets = uploadedAssetsForPrompt(modules);

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
    `Name: ${productName || '[unknown]'}`,
    `ASIN: ${asin || '[not provided]'}`,
    `One-sentence product description: ${
      productOneLiner || '[infer from sources or ask]'
    }`,
    `Price point: ${pricePoint || '[unknown]'}`,
    `Target customer: ${targetCustomer || '[infer from sources or ask]'}`,
    '',
    'BRAND KIT',
    `Voice: ${brandVoice || 'Clear, specific, conversion-focused, no hype.'}`,
    `Colors: ${
      brandColors ||
      '[ask for brand colors or infer cautiously from provided assets]'
    }`,
    `Logo notes: ${
      logoNotes ||
      'Leave logo dropzones/placeholders. Do not recreate or stylize the logo.'
    }`,
    '',
    'RAW INPUTS',
    `Features and benefits: ${
      keyFeatures || '[extract from links/photos/notes]'
    }`,
    `Differentiators: ${
      differentiators || '[extract from sources and competitors]'
    }`,
    `Buyer objections: ${objections || '[identify likely objections]'}`,
    `Other notes: ${rawNotes || '[none]'}`,
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
              `- ${asset.fileName} for ${asset.module} / ${asset.slot}; assetId=${asset.assetId}; sha256=${asset.sha256}; storageKey=${asset.storageKey}`
          )
          .join('\n')
      : '- No uploaded product/logo images yet. Request raw product photos, polished product photos, lifestyle photos, and transparent logo files.',
    '',
    'STARTING MODULE STRATEGY',
    `${activeStrategy.name}: ${activeStrategy.description}`,
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

function DropSlot({
  slot,
  onFile,
}: {
  slot: AssetSlot;
  onFile: (file: File) => void;
}) {
  return (
    <label
      className="group flex cursor-pointer flex-col gap-3 rounded-md border border-dashed bg-background p-4 transition-colors hover:border-primary/60 hover:bg-primary/5"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = [...event.dataTransfer.files].find((item) =>
          item.type.startsWith('image/')
        );
        if (file) onFile(file);
      }}
    >
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
        }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ImagePlus className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{slot.label}</span>
        </div>
        <Badge variant="outline" className="shrink-0 text-[11px]">
          {slot.minSize}
        </Badge>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{slot.detail}</p>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {slot.uploadStatus === 'hashing' ||
        slot.uploadStatus === 'uploading' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
        <span className="truncate">
          {slot.fileName || slot.uploadMessage || 'Choose image'}
        </span>
      </div>
      {slot.uploadMessage && (
        <p
          className={cn(
            'rounded-md border px-2 py-1.5 text-xs leading-5',
            slot.uploadStatus === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : slot.uploadStatus === 'duplicate'
              ? 'border-sky-200 bg-sky-50 text-sky-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          )}
        >
          {slot.uploadMessage}
        </p>
      )}
    </label>
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
          <div className="space-y-2">
            {module.copy.map((line) => (
              <p
                key={line}
                className="rounded-md border bg-card px-3 py-2 text-sm"
              >
                {line}
              </p>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {hasSlots ? (
            module.imageSlots.map((slot) => (
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
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {slot.fileName ||
                    'Reserved image slot for final Amazon upload.'}
                </p>
              </div>
            ))
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

export default function APlusBuilderPage() {
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
  const [rawNotes, setRawNotes] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('Untitled A+ draft');
  const [brandGuideId, setBrandGuideId] = useState<string | null>(null);
  const [brandGuideName, setBrandGuideName] = useState('Default brand guide');
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [brandGuides, setBrandGuides] = useState<BrandGuide[]>([]);
  const [amazonBrands, setAmazonBrands] = useState<AmazonBrand[]>([]);
  const [amazonBrandsConnected, setAmazonBrandsConnected] = useState(false);
  const [amazonBrandMessage, setAmazonBrandMessage] = useState('');
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
  const [modules, setModules] = useState<APlusModule[]>(() =>
    createStrategyModules(defaultStrategyId('Basic A+'), 'Basic A+')
  );
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  const activeStrategy =
    strategiesForTier(contentTier).find(
      (strategy) => strategy.id === strategyId
    ) ||
    strategiesForTier(contentTier)[0] ||
    MODULE_STRATEGIES[0];
  const availableStrategies = strategiesForTier(contentTier);
  const availableModules = modulesForTier(contentTier);

  const assetCount = modules.reduce(
    (count, module) =>
      count + module.imageSlots.filter((slot) => slot.fileName).length,
    0
  );
  const slotCount = modules.reduce(
    (count, module) => count + module.imageSlots.length,
    0
  );

  const currentDraftPayload = useMemo<DraftPayload>(
    () => ({
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
      rawNotes,
      strategyId,
      sources,
      modules,
    }),
    [
      asin,
      brandColors,
      brandVoice,
      contentTier,
      differentiators,
      keyFeatures,
      logoNotes,
      modules,
      objections,
      pricePoint,
      productName,
      productOneLiner,
      rawNotes,
      sources,
      strategyId,
      targetCustomer,
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
        logoNotes,
        activeStrategy,
        sources,
        sourceChecks,
        modules,
      }),
    [
      activeStrategy,
      asin,
      brandColors,
      brandVoice,
      contentTier,
      differentiators,
      keyFeatures,
      logoNotes,
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
        discoveryInputs: {
          productOneLiner,
          targetCustomer,
          pricePoint,
          keyFeatures,
          differentiators,
          objections,
          brandColors,
          logoNotes,
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
      brandVoice,
      contentTier,
      differentiators,
      keyFeatures,
      logoNotes,
      modules,
      objections,
      pricePoint,
      productName,
      productOneLiner,
      rawNotes,
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

  useEffect(() => {
    let cancelled = false;

    async function loadAmazonBrands() {
      try {
        const response = await fetch('/api/a-plus/amazon-brands');
        const body = (await response.json()) as {
          connected?: boolean;
          brands?: AmazonBrand[];
          message?: string;
          error?: string;
        };
        if (cancelled) return;
        setAmazonBrandsConnected(Boolean(body.connected));
        setAmazonBrands(body.brands || []);
        setAmazonBrandMessage(body.error || body.message || '');
      } catch {
        if (!cancelled) {
          setAmazonBrandsConnected(false);
          setAmazonBrands([]);
          setAmazonBrandMessage('Could not query Amazon brands.');
        }
      }
    }

    void loadAmazonBrands();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateSlot(
    moduleId: string,
    slotId: string,
    patch: Partial<AssetSlot>
  ) {
    setModules((current) =>
      current.map((module) =>
        module.id === moduleId
          ? {
              ...module,
              status: module.imageSlots.every(
                (slot) =>
                  slot.id === slotId ||
                  slot.asset ||
                  slot.uploadStatus === 'uploaded' ||
                  slot.uploadStatus === 'duplicate'
              )
                ? 'needs-review'
                : module.status,
              imageSlots: module.imageSlots.map((slot) =>
                slot.id === slotId ? { ...slot, ...patch } : slot
              ),
            }
          : module
      )
    );
  }

  async function uploadSlotAsset(moduleId: string, slotId: string, file: File) {
    try {
      updateSlot(moduleId, slotId, {
        fileName: file.name,
        uploadStatus: 'hashing',
        uploadMessage: 'Fingerprinting image...',
      });

      const sha256 = await sha256File(file);

      updateSlot(moduleId, slotId, {
        uploadStatus: 'uploading',
        uploadMessage: 'Checking for duplicates...',
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
        duplicate?: boolean;
        asset?: UploadedAsset;
        upload?: {
          method: 'PUT';
          url: string;
          headers: Record<string, string>;
        };
      };

      if (!preflightResponse.ok || preflight.error || !preflight.asset) {
        throw new Error(preflight.error || 'Asset preflight failed.');
      }

      if (preflight.duplicate) {
        updateSlot(moduleId, slotId, {
          asset: preflight.asset,
          uploadStatus: 'duplicate',
          uploadMessage: 'Duplicate found. Reusing existing uploaded asset.',
        });
        return;
      }

      if (!preflight.upload) {
        throw new Error('Upload instructions were not returned.');
      }

      updateSlot(moduleId, slotId, {
        uploadStatus: 'uploading',
        uploadMessage: 'Uploading image to S3...',
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

      updateSlot(moduleId, slotId, {
        asset: confirmed.asset,
        uploadStatus: 'uploaded',
        uploadMessage: 'Uploaded and fingerprinted.',
      });
    } catch (error) {
      updateSlot(moduleId, slotId, {
        uploadStatus: 'error',
        uploadMessage:
          error instanceof Error ? error.message : 'Image upload failed.',
      });
    }
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

  function addDroppedSource(url: string) {
    const emptySource = sources.find((source) => !source.url.trim());
    if (emptySource) {
      const nextSource = { ...emptySource, url };
      updateSource(emptySource.id, { url });
      void checkSource(nextSource);
      return;
    }

    const nextSource = {
      id: Date.now(),
      kind: 'Reference' as const,
      url,
    };
    setSources((current) => [...current, nextSource]);
    void checkSource(nextSource);
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

  function hydrateDraft(payload: DraftPayload) {
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
    if (payload.rawNotes !== undefined) setRawNotes(payload.rawNotes);
    if (payload.strategyId) setStrategyId(payload.strategyId);
    if (payload.sources?.length) setSources(payload.sources);
    if (payload.modules?.length) setModules(payload.modules);
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
      hydrateDraft(body.draft.payload || {});
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
    setProductName('');
    setAsin('');
    setContentTier(nextTier);
    setProductOneLiner('');
    setTargetCustomer('');
    setPricePoint('');
    setKeyFeatures('');
    setDifferentiators('');
    setObjections('');
    setRawNotes('');
    setStrategyId(nextStrategyId);
    setSources(DEFAULT_SOURCES);
    setSourceChecks({});
    setModules(createStrategyModules(nextStrategyId, nextTier));
  }

  async function saveBrandGuide() {
    const response = await fetch('/api/a-plus/brand-guides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandGuideId,
        name: brandGuideName,
        brandName: brandGuideName,
        colors: brandColors,
        voice: brandVoice,
        logoNotes,
      }),
    });
    const body = (await response.json()) as {
      brandGuide?: BrandGuide;
      error?: string;
    };
    if (!response.ok || body.error || !body.brandGuide) {
      throw new Error(body.error || 'Could not save brand guide.');
    }
    setBrandGuideId(body.brandGuide.brandGuideId);
    setBrandGuideName(body.brandGuide.name);
    setBrandGuides((current) => [
      body.brandGuide as BrandGuide,
      ...current.filter(
        (guide) => guide.brandGuideId !== body.brandGuide?.brandGuideId
      ),
    ]);
    return body.brandGuide;
  }

  async function saveDraft() {
    setSaveStatus('saving');
    try {
      const guide = await saveBrandGuide();
      const response = await fetch('/api/a-plus/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId,
          brandGuideId: guide.brandGuideId,
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
      setDraftName(body.draft.name);
      setDrafts((current) => [
        body.draft as DraftSummary,
        ...current.filter((draft) => draft.draftId !== body.draft?.draftId),
      ]);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1800);
    } catch {
      setSaveStatus('error');
    }
  }

  function applyBrandGuide(nextBrandGuideId: string) {
    const guide = brandGuides.find(
      (item) => item.brandGuideId === nextBrandGuideId
    );
    if (!guide) return;
    setBrandGuideId(guide.brandGuideId);
    setBrandGuideName(guide.name);
    setBrandColors(guide.colors || '');
    setBrandVoice(guide.voice || '');
    setLogoNotes(guide.logoNotes || '');
  }

  function amazonBrandKey(brand: AmazonBrand) {
    const profile = brand.profiles[0];
    return `${brand.name}::${profile?.profileName || ''}::${
      profile?.marketplaceId || ''
    }`;
  }

  function amazonBrandLabel(brand: AmazonBrand) {
    const profile = brand.profiles[0];
    const context = [
      brand.source === 'ads' ? 'Ads' : 'SP',
      profile?.profileName,
      profile?.marketplaceId,
    ]
      .filter(Boolean)
      .join(' · ');
    return `${brand.name}${context ? ` · ${context}` : ''}`;
  }

  function applyAmazonBrand(brandKey: string) {
    const brand = amazonBrands.find(
      (item) => amazonBrandKey(item) === brandKey
    );
    if (!brand) return;
    setBrandGuideId(null);
    setBrandGuideName(brand.name);
    if (!productName && brand.sampleProducts[0]) {
      setProductName(brand.sampleProducts[0]);
    }
  }

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
              into an Amazon-editable A+ brief with desktop/mobile module plans.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="gap-1.5">
              <Bot className="h-3.5 w-3.5" />
              AI brief
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <PackageCheck className="h-3.5 w-3.5" />
              {modules.length} modules
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <FileImage className="h-3.5 w-3.5" />
              {assetCount}/{slotCount} assets
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              API path confirmed
            </Badge>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                Draft
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select
                  value={draftId || ''}
                  onChange={(event) => void loadDraft(event.target.value)}
                  className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">Current unsaved draft</option>
                  {drafts.map((draft) => (
                    <option key={draft.draftId} value={draft.draftId}>
                      {draft.name}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" onClick={newDraft}>
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
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="brand-guide">Brand guide</Label>
                <select
                  id="brand-guide"
                  value={brandGuideId || ''}
                  onChange={(event) => applyBrandGuide(event.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">New brand guide</option>
                  {brandGuides.map((guide) => (
                    <option key={guide.brandGuideId} value={guide.brandGuideId}>
                      {guide.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="amazon-brand">Amazon brand</Label>
                <select
                  id="amazon-brand"
                  value=""
                  onChange={(event) => applyAmazonBrand(event.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  disabled={!amazonBrands.length}
                >
                  <option value="">
                    {amazonBrands.length
                      ? 'Use brand from Amazon'
                      : amazonBrandsConnected
                      ? 'No Amazon brands found'
                      : 'Connect Amazon to query brands'}
                  </option>
                  {amazonBrands.map((brand) => (
                    <option
                      key={amazonBrandKey(brand)}
                      value={amazonBrandKey(brand)}
                    >
                      {amazonBrandLabel(brand)} · {brand.asinCount} ASIN
                      {brand.asinCount === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
                {amazonBrandMessage && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {amazonBrandMessage}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="brand-guide-name">Brand guide name</Label>
                <Input
                  id="brand-guide-name"
                  value={brandGuideName}
                  onChange={(event) => setBrandGuideName(event.target.value)}
                  placeholder="SellAvant default"
                />
              </div>
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
                Drafts are saved per user and can share reusable brand guides
                across multiple products.
              </p>
            </CardContent>
          </Card>

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
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
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
                            <span className="block text-sm">
                              {module.title}
                            </span>
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4 text-primary" />
                AI Intake
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
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="asin">ASIN</Label>
                <Input
                  id="asin"
                  value={asin}
                  onChange={(event) =>
                    setAsin(event.target.value.toUpperCase())
                  }
                  placeholder="B0..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="content-tier">Content tier</Label>
                <select
                  id="content-tier"
                  value={contentTier}
                  onChange={(event) =>
                    applyContentTier(event.target.value as ContentTier)
                  }
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="Basic A+">Basic A+ · max 5 modules</option>
                  <option value="Premium A+">
                    Premium A+ · max 6-7 modules
                  </option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-listing-url">
                  Product listing link
                </Label>
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
                        sources.find(
                          (source) => source.kind === 'Product listing'
                        ) || sources[0];
                      if (productSource) {
                        const nextSource = { ...productSource, url };
                        updateSource(productSource.id, { url });
                        void checkSource(nextSource);
                      } else {
                        const nextSource = {
                          id: Date.now(),
                          kind: 'Product listing' as const,
                          url,
                        };
                        setSources((current) => [nextSource, ...current]);
                        void checkSource(nextSource);
                      }
                    }
                  }}
                >
                  <LinkIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="product-listing-url"
                    value={
                      sources.find(
                        (source) => source.kind === 'Product listing'
                      )?.url || ''
                    }
                    onChange={(event) => {
                      const url = event.target.value;
                      const productSource =
                        sources.find(
                          (source) => source.kind === 'Product listing'
                        ) || sources[0];
                      if (productSource) {
                        updateSource(productSource.id, { url });
                      }
                    }}
                    onBlur={() => {
                      const productSource = sources.find(
                        (source) => source.kind === 'Product listing'
                      );
                      if (productSource) void checkSource(productSource);
                    }}
                    placeholder="Drag or paste product listing URL"
                    className="pl-7 text-sm"
                  />
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  Drop the Amazon, Shopify, Alibaba, or landing page link here
                  to make it the primary product source.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">What you know so far</Label>
                <Textarea
                  id="notes"
                  value={rawNotes}
                  onChange={(event) => setRawNotes(event.target.value)}
                  placeholder="Paste rough notes, bullets, customer reviews, supplier claims, dimensions, or anything the AI should learn from."
                  className="min-h-24"
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  The AI should fill the structured fields below as it extracts
                  facts from links, photos, notes, and listing data.
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
                    AI-filled product memory
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="one-liner">What it does</Label>
                    <Textarea
                      id="one-liner"
                      value={productOneLiner}
                      onChange={(event) =>
                        setProductOneLiner(event.target.value)
                      }
                      placeholder="One sentence. Usually AI-filled from sources."
                      className="min-h-16"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <div className="space-y-2">
                      <Label htmlFor="target-customer">Target customer</Label>
                      <Textarea
                        id="target-customer"
                        value={targetCustomer}
                        onChange={(event) =>
                          setTargetCustomer(event.target.value)
                        }
                        placeholder="Who buys it, why now, what they care about."
                        className="min-h-20"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="price-point">Price point</Label>
                      <Input
                        id="price-point"
                        value={pricePoint}
                        onChange={(event) => setPricePoint(event.target.value)}
                        placeholder="Budget, mid-market, premium..."
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
                      className="min-h-24"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="differentiators">Differentiators</Label>
                    <Textarea
                      id="differentiators"
                      value={differentiators}
                      onChange={(event) =>
                        setDifferentiators(event.target.value)
                      }
                      placeholder="Materials, bundle, proof, compatibility, patents, certifications..."
                      className="min-h-20"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="objections">Buyer objections</Label>
                    <Textarea
                      id="objections"
                      value={objections}
                      onChange={(event) => setObjections(event.target.value)}
                      placeholder="What might stop a buyer from purchasing?"
                      className="min-h-20"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="brand-colors">Brand colors</Label>
                    <Input
                      id="brand-colors"
                      value={brandColors}
                      onChange={(event) => setBrandColors(event.target.value)}
                      placeholder="#123456, #FFFFFF..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="logo-notes">Logo rules</Label>
                    <Textarea
                      id="logo-notes"
                      value={logoNotes}
                      onChange={(event) => setLogoNotes(event.target.value)}
                      placeholder="Transparent PNG, reversed logo, clear space, preferred placement..."
                      className="min-h-20"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="voice">Brand voice</Label>
                    <Textarea
                      id="voice"
                      value={brandVoice}
                      onChange={(event) => setBrandVoice(event.target.value)}
                      placeholder="Clean, premium, practical, no hype."
                      className="min-h-20"
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

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
                Drag product, supplier, Alibaba, Amazon, Shopify, or competitor
                links here. SellAvant will flag sources that look gated,
                paywalled, or blocked.
              </div>
              {sources.map((source) => (
                <div
                  key={source.id}
                  className="grid grid-cols-[116px_1fr] gap-2"
                >
                  <select
                    value={source.kind}
                    onChange={(event) => {
                      const kind = event.target.value as SourceKind;
                      updateSource(source.id, { kind });
                    }}
                    className="rounded-md border bg-background px-2 text-xs"
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
                      onDrop={(event) => {
                        event.preventDefault();
                        const url =
                          event.dataTransfer.getData('text/uri-list') ||
                          extractFirstUrl(
                            event.dataTransfer.getData('text/plain')
                          );
                        if (url) {
                          const nextSource = { ...source, url };
                          updateSource(source.id, { url });
                          void checkSource(nextSource);
                        }
                      }}
                      placeholder="https://..."
                      className="pl-7 text-sm"
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
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addSource}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add source
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Assets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                Drop product photos, logo files, lifestyle images, and polished
                assets into the module-specific slots when you have them.
              </div>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-between"
                  >
                    {assetCount}/{slotCount} module assets attached
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 space-y-3">
                  {modules
                    .flatMap((module) =>
                      module.imageSlots.map((slot) => ({
                        moduleId: module.id,
                        slot,
                      }))
                    )
                    .map(({ moduleId, slot }) => (
                      <DropSlot
                        key={`${moduleId}-${slot.id}`}
                        slot={slot}
                        onFile={(file) =>
                          void uploadSlotAsset(moduleId, slot.id, file)
                        }
                      />
                    ))}
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0">
          <div className="mb-4 rounded-md border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="flex items-center gap-2">
                  <WandSparkles className="h-4 w-4 text-primary" />
                  <h2 className="font-semibold">AI generation brief</h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  The AI starts by interviewing only for missing facts, then
                  drafts a module-by-module A+ package with logo dropzones,
                  matched mobile layouts, image prompts, Canva instructions, and
                  compliance checks.
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
                <div
                  key={step.title}
                  className="rounded-md border bg-muted/40 p-3"
                >
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </div>

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
                      This is the working prompt assembled from your links,
                      notes, uploaded assets, and module strategy.
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
                  These modules are the starting layout the AI should refine,
                  replace, or reorder based on the product and source evidence.
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
                      Copy this into the next API/import layer or use it as the
                      Seller Central build sheet.
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
        </main>
      </div>
    </div>
  );
}
