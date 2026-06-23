'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  BookTemplate,
  CheckCircle2,
  FileUp,
  Globe,
  ImageIcon,
  ImageOff,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

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
  styleGuideFiles?: Array<{
    name: string;
    mimeType: string;
    sizeBytes: number;
    lastModified: number;
  }>;
  styleGuideLinks?: string[];
  styleGuideNotes?: string;
  updatedAt: number;
};

type ExtractionResult = {
  brandName?: string;
  colors: string[];
  fonts: string[];
  palette: {
    primaryForeground?: string;
    secondaryForeground?: string;
    background?: string;
  };
  fontRoles: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  notes: string;
};

type UploadedAsset = {
  assetId: string;
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
};

const FIELD_CLASSNAME =
  'border-border/80 bg-card shadow-sm transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20';

const DEFAULT_PALETTE = {
  primaryForeground: '#1d4ed8',
  secondaryForeground: '#0f172a',
  background: '#f8fafc',
};

function emptyGuide(): Omit<BrandGuide, 'updatedAt'> {
  return {
    brandGuideId: '',
    name: '',
    brandName: '',
    colors: '',
    palette: DEFAULT_PALETTE,
    fonts: {
      primary: '',
      secondary: '',
      accent: '',
    },
    voice: '',
    logoAsset: undefined,
    logoNotes: '',
    styleGuideFiles: [],
    styleGuideLinks: [],
    styleGuideNotes: '',
  };
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatGuideUpdatedAt(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(timestamp);
}

/**
 * Chip showing the uploaded logo with its file metadata. When the thumbnail
 * can't be fetched, we no longer silently hide it (which left only the bare
 * filename, reading as "it's showing the filename instead of my logo"). Instead
 * we show a clear failed-load state and probe `/assets/health` to tell a
 * transient storage/session problem (e.g. an expired AWS SSO session) apart
 * from a genuinely broken asset, so the message points at the real fix.
 */
function UploadedLogoPreview({
  asset,
  onRemove,
}: {
  asset: NonNullable<BrandGuide['logoAsset']>;
  onRemove: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [storageDown, setStorageDown] = useState(false);

  // A new asset (re-upload / switching guides) gets a fresh attempt.
  useEffect(() => {
    setFailed(false);
    setStorageDown(false);
  }, [asset.assetId]);

  async function handleError() {
    setFailed(true);
    try {
      const response = await fetch('/api/a-plus/assets/health');
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
      } | null;
      setStorageDown(!body?.ok);
    } catch {
      setStorageDown(true);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-white">
            {failed ? (
              <ImageOff className="h-5 w-5 text-muted-foreground" />
            ) : (
              <img
                src={`/api/a-plus/assets/${asset.assetId}`}
                alt={asset.originalFileName}
                className="max-h-12 max-w-full object-contain"
                onError={handleError}
              />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {asset.originalFileName}
            </p>
            <p className="text-xs text-muted-foreground">
              {asset.mimeType} · {formatBytes(asset.sizeBytes)}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Remove logo</span>
        </Button>
      </div>
      {failed && (
        <p className="flex items-start gap-2 text-xs text-amber-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {storageDown ? (
              <>
                Logo preview couldn’t load — media storage isn’t reachable. Your
                AWS session may have expired; run{' '}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">
                  aws sso login
                </code>{' '}
                and reload. The logo file is still saved with this guide.
              </>
            ) : (
              'Logo preview couldn’t load. The logo file is still saved with this guide.'
            )}
          </span>
        </p>
      )}
    </div>
  );
}

function describeGuideCoverage(guide: BrandGuide) {
  const parts = [
    guide.palette?.primaryForeground &&
    guide.palette?.secondaryForeground &&
    guide.palette?.background
      ? 'colors'
      : null,
    guide.fonts?.primary || guide.fonts?.secondary || guide.fonts?.accent
      ? 'fonts'
      : null,
    guide.logoAsset ? 'logo' : null,
    guide.voice ? 'voice' : null,
  ].filter(Boolean);

  return parts.length ? parts.join(' · ') : 'Still mostly empty';
}

function normalizeFontName(value: string) {
  return value
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ');
}

function googleFontHref(fontName: string) {
  const normalized = normalizeFontName(fontName);
  if (!normalized) return '';
  const family = normalized.split(' ').filter(Boolean).join('+');
  return `https://fonts.googleapis.com/css2?family=${family}:wght@400;500;600;700&display=swap`;
}

function fontPreviewStyle(fontName?: string) {
  const normalized = fontName ? normalizeFontName(fontName) : '';
  return normalized
    ? {
        fontFamily: `"${normalized}", ui-sans-serif, system-ui, sans-serif`,
      }
    : undefined;
}

export default function BrandGuidesPage() {
  const [brandGuides, setBrandGuides] = useState<BrandGuide[]>([]);
  const [activeGuideId, setActiveGuideId] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);
  const [draftGuide, setDraftGuide] = useState<Omit<BrandGuide, 'updatedAt'>>(
    emptyGuide()
  );
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'saving' | 'saved' | 'error'
  >('loading');
  const [validationMessage, setValidationMessage] = useState('');
  const [styleGuideUrl, setStyleGuideUrl] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [isDraggingStyleGuideFiles, setIsDraggingStyleGuideFiles] =
    useState(false);
  const [loadedFonts, setLoadedFonts] = useState<Record<string, boolean>>({});
  const [pendingExtraction, setPendingExtraction] =
    useState<ExtractionResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadBrandGuides() {
      setStatus('loading');
      try {
        const response = await fetch('/api/a-plus/brand-guides');
        const body = (await response.json()) as { brandGuides?: BrandGuide[] };
        if (!response.ok) throw new Error('Could not load brand guides.');
        if (cancelled) return;
        const guides = body.brandGuides || [];
        setBrandGuides(guides);
        if (guides[0]) {
          setActiveGuideId(guides[0].brandGuideId);
          setIsCreating(false);
          setDraftGuide({
            brandGuideId: guides[0].brandGuideId,
            name: guides[0].name || '',
            brandName: guides[0].brandName || '',
            colors: guides[0].colors || '',
            palette: guides[0].palette || DEFAULT_PALETTE,
            fonts: guides[0].fonts || {
              primary: '',
              secondary: '',
              accent: '',
            },
            voice: guides[0].voice || '',
            logoAsset: guides[0].logoAsset,
            logoNotes: guides[0].logoNotes || '',
            styleGuideFiles: guides[0].styleGuideFiles || [],
            styleGuideLinks: guides[0].styleGuideLinks || [],
            styleGuideNotes: guides[0].styleGuideNotes || '',
          });
        } else {
          setActiveGuideId('');
          setIsCreating(false);
          setDraftGuide(emptyGuide());
        }
        setStatus('idle');
        setValidationMessage('');
        setPendingExtraction(null);
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    void loadBrandGuides();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeGuide = useMemo(
    () =>
      brandGuides.find((guide) => guide.brandGuideId === activeGuideId) || null,
    [activeGuideId, brandGuides]
  );

  const fontFamiliesToPreview = useMemo(() => {
    const values = [
      draftGuide.fonts?.primary,
      draftGuide.fonts?.secondary,
      draftGuide.fonts?.accent,
      pendingExtraction?.fontRoles.primary,
      pendingExtraction?.fontRoles.secondary,
      pendingExtraction?.fontRoles.accent,
      ...(pendingExtraction?.fonts || []),
    ];

    return Array.from(
      new Set(
        values.map((value) => normalizeFontName(value || '')).filter(Boolean)
      )
    );
  }, [
    draftGuide.fonts?.accent,
    draftGuide.fonts?.primary,
    draftGuide.fonts?.secondary,
    pendingExtraction,
  ]);

  useEffect(() => {
    if (typeof document === 'undefined' || !fontFamiliesToPreview.length)
      return;

    fontFamiliesToPreview.forEach((fontName) => {
      if (fontName in loadedFonts) return;

      const href = googleFontHref(fontName);
      if (!href) return;

      const existing = document.querySelector<HTMLLinkElement>(
        `link[data-sellavant-font="${fontName}"]`
      );

      if (!existing) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.sellavantFont = fontName;
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
  }, [fontFamiliesToPreview, loadedFonts]);

  function selectGuide(guide: BrandGuide) {
    setActiveGuideId(guide.brandGuideId);
    setIsCreating(false);
    setDraftGuide({
      brandGuideId: guide.brandGuideId,
      name: guide.name || '',
      brandName: guide.brandName || '',
      colors: guide.colors || '',
      palette: guide.palette || DEFAULT_PALETTE,
      fonts: guide.fonts || {
        primary: '',
        secondary: '',
        accent: '',
      },
      voice: guide.voice || '',
      logoAsset: guide.logoAsset,
      logoNotes: guide.logoNotes || '',
      styleGuideFiles: guide.styleGuideFiles || [],
      styleGuideLinks: guide.styleGuideLinks || [],
      styleGuideNotes: guide.styleGuideNotes || '',
    });
    setStatus('idle');
    setValidationMessage('');
    setPendingExtraction(null);
  }

  function applyExtractedBrandName(result: ExtractionResult) {
    setDraftGuide((current) => ({
      ...current,
      name: current.name || result.brandName || current.name,
      brandName: result.brandName || current.brandName,
    }));
  }

  function applyExtractedColors(result: ExtractionResult) {
    setDraftGuide((current) => ({
      ...current,
      palette: {
        ...(current.palette || DEFAULT_PALETTE),
        primaryForeground:
          result.palette.primaryForeground ||
          current.palette?.primaryForeground ||
          DEFAULT_PALETTE.primaryForeground,
        secondaryForeground:
          result.palette.secondaryForeground ||
          current.palette?.secondaryForeground ||
          DEFAULT_PALETTE.secondaryForeground,
        background:
          result.palette.background ||
          current.palette?.background ||
          DEFAULT_PALETTE.background,
      },
    }));
  }

  function applyExtractedFonts(result: ExtractionResult) {
    setDraftGuide((current) => ({
      ...current,
      fonts: {
        ...(current.fonts || {}),
        primary: result.fontRoles.primary || current.fonts?.primary || '',
        secondary: result.fontRoles.secondary || current.fonts?.secondary || '',
        accent: result.fontRoles.accent || current.fonts?.accent || '',
      },
    }));
  }

  function applyExtractedFontRole(
    role: keyof NonNullable<Omit<BrandGuide, 'updatedAt'>['fonts']>,
    value?: string
  ) {
    if (!value) return;
    setDraftGuide((current) => ({
      ...current,
      fonts: {
        ...(current.fonts || {}),
        [role]: value,
      },
    }));
  }

  function applySuggestedFont(font: string) {
    setDraftGuide((current) => {
      const currentFonts = current.fonts || {};
      const nextRole = !currentFonts.primary
        ? 'primary'
        : !currentFonts.secondary
        ? 'secondary'
        : !currentFonts.accent
        ? 'accent'
        : 'accent';

      return {
        ...current,
        fonts: {
          ...currentFonts,
          [nextRole]: font,
        },
      };
    });
  }

  function applyExtractionNotes(result: ExtractionResult) {
    setDraftGuide((current) => ({
      ...current,
      styleGuideNotes: [current.styleGuideNotes, result.notes]
        .filter(Boolean)
        .join('\n\n')
        .trim(),
    }));
  }

  function applyExtractionResult(result: ExtractionResult) {
    applyExtractedBrandName(result);
    applyExtractedColors(result);
    applyExtractedFonts(result);
    applyExtractionNotes(result);
    setPendingExtraction(null);
  }

  function startNewGuide() {
    setActiveGuideId('');
    setIsCreating(true);
    setDraftGuide(emptyGuide());
    setStatus('idle');
    setValidationMessage('');
    setPendingExtraction(null);
  }

  function updatePalette(
    key: keyof NonNullable<Omit<BrandGuide, 'updatedAt'>['palette']>,
    value: string
  ) {
    setDraftGuide((current) => ({
      ...current,
      palette: {
        ...(current.palette || DEFAULT_PALETTE),
        [key]: value,
      },
    }));
    setValidationMessage('');
  }

  async function addStyleGuideFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = [...fileList];
    const nextFiles = files.map((file) => ({
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      lastModified: file.lastModified,
    }));

    setDraftGuide((current) => {
      const existing = current.styleGuideFiles || [];
      const merged = [...existing];
      for (const file of nextFiles) {
        const alreadyPresent = merged.some(
          (item) =>
            item.name === file.name &&
            item.sizeBytes === file.sizeBytes &&
            item.lastModified === file.lastModified
        );
        if (!alreadyPresent) merged.push(file);
      }
      return {
        ...current,
        styleGuideFiles: merged,
      };
    });
    setExtracting(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));
      const response = await fetch('/api/a-plus/brand-guides/extract', {
        method: 'POST',
        body: formData,
      });
      const body = (await response.json()) as {
        merged?: ExtractionResult;
        error?: string;
      };
      if (!response.ok || body.error || !body.merged) {
        throw new Error(body.error || 'Could not extract from uploaded files.');
      }
      setPendingExtraction(body.merged);
    } catch (error) {
      setValidationMessage(
        error instanceof Error
          ? error.message
          : 'Could not extract from uploaded files.'
      );
    } finally {
      setExtracting(false);
    }
  }

  function removeStyleGuideFile(indexToRemove: number) {
    setDraftGuide((current) => ({
      ...current,
      styleGuideFiles: (current.styleGuideFiles || []).filter(
        (_, index) => index !== indexToRemove
      ),
    }));
  }

  async function extractFromLink() {
    if (!styleGuideUrl.trim()) return;
    setExtracting(true);
    setValidationMessage('');
    try {
      const response = await fetch('/api/a-plus/brand-guides/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: styleGuideUrl.trim() }),
      });
      const body = (await response.json()) as {
        merged?: ExtractionResult;
        error?: string;
      };
      if (!response.ok || body.error || !body.merged) {
        throw new Error(body.error || 'Could not read this style guide link.');
      }
      setDraftGuide((current) => ({
        ...current,
        styleGuideLinks: Array.from(
          new Set([...(current.styleGuideLinks || []), styleGuideUrl.trim()])
        ),
      }));
      setPendingExtraction(body.merged);
      setStyleGuideUrl('');
    } catch (error) {
      setValidationMessage(
        error instanceof Error
          ? error.message
          : 'Could not read this style guide link.'
      );
    } finally {
      setExtracting(false);
    }
  }

  async function saveGuide() {
    setStatus('saving');
    try {
      const palette = draftGuide.palette || DEFAULT_PALETTE;
      if (
        !palette.primaryForeground ||
        !palette.secondaryForeground ||
        !palette.background
      ) {
        setValidationMessage(
          'Choose a primary foreground color, a secondary foreground color, and a background color before saving.'
        );
        setStatus('error');
        return;
      }
      const colors = [
        palette.primaryForeground
          ? `Primary foreground ${palette.primaryForeground}`
          : null,
        palette.secondaryForeground
          ? `Secondary foreground ${palette.secondaryForeground}`
          : null,
        palette.background ? `Background ${palette.background}` : null,
      ]
        .filter(Boolean)
        .join(' | ');

      const response = await fetch('/api/a-plus/brand-guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandGuideId: draftGuide.brandGuideId || undefined,
          name: draftGuide.name,
          brandName: draftGuide.brandName,
          colors,
          palette,
          fonts: draftGuide.fonts,
          voice: draftGuide.voice,
          logoAsset: draftGuide.logoAsset,
          logoNotes: draftGuide.logoNotes,
          styleGuideFiles: draftGuide.styleGuideFiles,
          styleGuideLinks: draftGuide.styleGuideLinks,
          styleGuideNotes: draftGuide.styleGuideNotes,
        }),
      });
      const body = (await response.json()) as {
        brandGuide?: BrandGuide;
        error?: string;
      };
      if (!response.ok || body.error || !body.brandGuide) {
        throw new Error(body.error || 'Could not save brand guide.');
      }

      const nextGuide = body.brandGuide;
      setBrandGuides((current) => [
        nextGuide,
        ...current.filter(
          (guide) => guide.brandGuideId !== nextGuide.brandGuideId
        ),
      ]);
      setActiveGuideId(nextGuide.brandGuideId);
      setIsCreating(false);
      setDraftGuide({
        brandGuideId: nextGuide.brandGuideId,
        name: nextGuide.name || '',
        brandName: nextGuide.brandName || '',
        colors: nextGuide.colors || '',
        palette: nextGuide.palette || DEFAULT_PALETTE,
        fonts: nextGuide.fonts || {
          primary: '',
          secondary: '',
          accent: '',
        },
        voice: nextGuide.voice || '',
        logoAsset: nextGuide.logoAsset,
        logoNotes: nextGuide.logoNotes || '',
        styleGuideFiles: nextGuide.styleGuideFiles || [],
        styleGuideLinks: nextGuide.styleGuideLinks || [],
        styleGuideNotes: nextGuide.styleGuideNotes || '',
      });
      setStatus('saved');
      setValidationMessage('');
      setPendingExtraction(null);
      setTimeout(() => setStatus('idle'), 1600);
    } catch {
      setStatus('error');
    }
  }

  async function uploadLogo(file: File) {
    setStatus('saving');
    setValidationMessage('');
    try {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        await file.arrayBuffer()
      );
      const sha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

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
        throw new Error(preflight.error || 'Logo upload failed.');
      }

      let finalAsset = preflight.asset;

      if (!preflight.duplicate) {
        if (!preflight.upload) {
          throw new Error('Logo upload instructions were not returned.');
        }

        const uploadResponse = await fetch(preflight.upload.url, {
          method: preflight.upload.method,
          headers: preflight.upload.headers,
          body: file,
        });

        if (!uploadResponse.ok) {
          throw new Error(
            `Logo upload failed with HTTP ${uploadResponse.status}.`
          );
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
          throw new Error(confirmed.error || 'Logo confirmation failed.');
        }

        finalAsset = confirmed.asset;
      }

      setDraftGuide((current) => ({
        ...current,
        logoAsset: {
          assetId: finalAsset.assetId,
          originalFileName: finalAsset.originalFileName,
          mimeType: finalAsset.mimeType,
          sizeBytes: finalAsset.sizeBytes,
          storage: finalAsset.storage,
        },
      }));
      setStatus('idle');
    } catch (error) {
      setValidationMessage(
        error instanceof Error ? error.message : 'Logo upload failed.'
      );
      setStatus('error');
    }
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BookTemplate className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-bold">Brand Guides</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Keep reusable logo, color, and voice rules here so the A+ builder
              can stay focused on the product package.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/a-plus">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to A+ builder
            </Link>
          </Button>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">Your guides</CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground"
                  onClick={startNewGuide}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  New
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                {brandGuides.map((guide) => (
                  <button
                    key={guide.brandGuideId}
                    type="button"
                    onClick={() => selectGuide(guide)}
                    className={cn(
                      'w-full rounded-md border px-3 py-3 text-left transition-colors',
                      guide.brandGuideId === activeGuideId
                        ? 'border-primary bg-primary/5'
                        : 'bg-background hover:bg-muted/50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {guide.name}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {guide.brandName || 'No brand name yet'}
                        </p>
                      </div>
                      {guide.brandGuideId === activeGuideId && (
                        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          Selected
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">
                        {describeGuideCoverage(guide)}
                      </span>
                      <span className="shrink-0">
                        {formatGuideUpdatedAt(guide.updatedAt)}
                      </span>
                    </div>
                  </button>
                ))}
                {!brandGuides.length && status !== 'loading' && (
                  <div className="rounded-md border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
                    No guides yet. Create one here, then pick it inside the A+
                    wizard.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0">
          {!activeGuide && !isCreating ? (
            <Card>
              <CardContent className="flex min-h-[420px] flex-col items-center justify-center px-8 py-12 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <BookTemplate className="h-7 w-7" />
                </div>
                <h2 className="mt-5 text-2xl font-semibold">
                  Create reusable brand guides
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  Keep logo rules, colors, and voice in one place. Then use the
                  guide in A+ content, listings, and ads without re-entering the
                  same brand details every time.
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <Button type="button" onClick={startNewGuide}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create brand guide
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <Link href="/a-plus">Back to A+ builder</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">
                    {activeGuide
                      ? draftGuide.name || activeGuide.name
                      : 'Create brand guide'}
                  </CardTitle>
                  {isCreating && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (brandGuides[0]) {
                          selectGuide(brandGuides[0]);
                        } else {
                          setIsCreating(false);
                          setDraftGuide(emptyGuide());
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {activeGuide
                    ? 'Edit the reusable brand memory that feeds A+ drafts, listings, and future creative work.'
                    : 'Create a reusable guide once, then apply it anywhere in the product.'}
                </p>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Colors
                    </p>
                    <p className="mt-2 text-sm">
                      {draftGuide.palette?.primaryForeground &&
                      draftGuide.palette?.secondaryForeground &&
                      draftGuide.palette?.background
                        ? 'Ready'
                        : 'Needs setup'}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Fonts
                    </p>
                    <p className="mt-2 text-sm">
                      {draftGuide.fonts?.primary ||
                      draftGuide.fonts?.secondary ||
                      draftGuide.fonts?.accent
                        ? 'Saved'
                        : 'Not chosen'}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Logo
                    </p>
                    <p className="mt-2 truncate text-sm">
                      {draftGuide.logoAsset?.originalFileName || 'No logo yet'}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Voice
                    </p>
                    <p className="mt-2 text-sm">
                      {draftGuide.voice?.trim() ? 'Saved' : 'Not set'}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="guide-name">Guide name</Label>
                    <Input
                      id="guide-name"
                      value={draftGuide.name}
                      onChange={(event) =>
                        setDraftGuide((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Filtered Blend core brand"
                      className={FIELD_CLASSNAME}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="brand-name">Brand name</Label>
                    <Input
                      id="brand-name"
                      value={draftGuide.brandName || ''}
                      onChange={(event) =>
                        setDraftGuide((current) => ({
                          ...current,
                          brandName: event.target.value,
                        }))
                      }
                      placeholder="Filtered Blend"
                      className={FIELD_CLASSNAME}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Brand colors</Label>
                  <div className="grid gap-3 md:grid-cols-3">
                    {(
                      [
                        ['primaryForeground', 'Primary foreground'],
                        ['secondaryForeground', 'Secondary foreground'],
                        ['background', 'Background'],
                      ] as const
                    ).map(([key, label]) => (
                      <div
                        key={key}
                        className="rounded-md border bg-background p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">{label}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {draftGuide.palette?.[key] ||
                                DEFAULT_PALETTE[key]}
                            </p>
                          </div>
                          <input
                            type="color"
                            value={
                              draftGuide.palette?.[key] || DEFAULT_PALETTE[key]
                            }
                            onChange={(event) =>
                              updatePalette(key, event.target.value)
                            }
                            className="h-10 w-10 cursor-pointer rounded-md border bg-transparent p-0"
                            aria-label={`${label} color`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Required: primary foreground, secondary foreground, and one
                    background color.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Brand fonts</Label>
                  <div className="grid gap-4 md:grid-cols-3">
                    {(
                      [
                        [
                          'primary',
                          'Primary font',
                          'Main headline or hero font',
                        ],
                        [
                          'secondary',
                          'Secondary font',
                          'Supporting or body font',
                        ],
                        [
                          'accent',
                          'Accent font',
                          'Optional display or callout font',
                        ],
                      ] as const
                    ).map(([key, label, hint]) => (
                      <div key={key} className="space-y-2">
                        <Label
                          htmlFor={`font-${key}`}
                          className="text-xs text-muted-foreground"
                        >
                          {label}
                        </Label>
                        <Input
                          id={`font-${key}`}
                          value={draftGuide.fonts?.[key] || ''}
                          onChange={(event) =>
                            setDraftGuide((current) => ({
                              ...current,
                              fonts: {
                                ...(current.fonts || {}),
                                [key]: event.target.value,
                              },
                            }))
                          }
                          placeholder={
                            key === 'primary'
                              ? 'Montserrat'
                              : key === 'secondary'
                              ? 'Inter'
                              : 'Playfair Display'
                          }
                          className={FIELD_CLASSNAME}
                        />
                        <div className="rounded-md border bg-background px-3 py-2">
                          <p className="text-xs text-muted-foreground">
                            {draftGuide.fonts?.[key]
                              ? loadedFonts[
                                  normalizeFontName(draftGuide.fonts[key] || '')
                                ]
                                ? 'Preview loaded'
                                : 'Trying to load preview'
                              : 'Enter a font to preview it here'}
                          </p>
                          <p
                            className="mt-1 text-base"
                            style={fontPreviewStyle(draftGuide.fonts?.[key])}
                          >
                            SellAvant turns source material into polished A+
                            content.
                          </p>
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">
                          {hint}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="guide-voice">Brand voice</Label>
                  <Textarea
                    id="guide-voice"
                    value={draftGuide.voice || ''}
                    onChange={(event) =>
                      setDraftGuide((current) => ({
                        ...current,
                        voice: event.target.value,
                      }))
                    }
                    placeholder="Clean, premium, practical, reassuring, no hype..."
                    className={cn('min-h-28', FIELD_CLASSNAME)}
                  />
                </div>

                <div className="space-y-3">
                  <Label>Style guide source files</Label>
                  <label
                    className={cn(
                      'flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-6 py-8 text-center transition-colors',
                      isDraggingStyleGuideFiles
                        ? 'border-primary bg-primary/10'
                        : 'bg-muted/40 hover:bg-muted/60'
                    )}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDraggingStyleGuideFiles(true);
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setIsDraggingStyleGuideFiles(true);
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      if (
                        event.currentTarget.contains(
                          event.relatedTarget as Node | null
                        )
                      ) {
                        return;
                      }
                      setIsDraggingStyleGuideFiles(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setIsDraggingStyleGuideFiles(false);
                      void addStyleGuideFiles(event.dataTransfer.files);
                    }}
                  >
                    <FileUp className="h-6 w-6 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium">
                      Drop brand decks, style guides, PDFs, or screenshots here
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Or click to browse. Save the source material with the
                      guide so we can use it as the basis for brand-aware
                      content later.
                    </p>
                    <input
                      type="file"
                      className="sr-only"
                      multiple
                      accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,.md,image/*"
                      onChange={(event) => {
                        void addStyleGuideFiles(event.target.files);
                        setIsDraggingStyleGuideFiles(false);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Text-based files like TXT, MD, SVG, HTML, and CSS can
                    prefill brand name and color suggestions immediately.
                  </p>
                  {(draftGuide.styleGuideFiles || []).length > 0 && (
                    <div className="space-y-2">
                      {(draftGuide.styleGuideFiles || []).map((file, index) => (
                        <div
                          key={`${file.name}-${file.lastModified}-${index}`}
                          className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {file.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {file.mimeType || 'Unknown type'} ·{' '}
                              {formatBytes(file.sizeBytes)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground"
                            onClick={() => removeStyleGuideFile(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Remove file</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <Label htmlFor="style-guide-link">
                    Read from style guide link
                  </Label>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      id="style-guide-link"
                      value={styleGuideUrl}
                      onChange={(event) => setStyleGuideUrl(event.target.value)}
                      placeholder="https://brand.example.com/style-guide"
                      className={FIELD_CLASSNAME}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="sm:w-auto"
                      disabled={extracting || !styleGuideUrl.trim()}
                      onClick={() => void extractFromLink()}
                    >
                      {extracting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Globe className="mr-2 h-4 w-4" />
                      )}
                      Read link
                    </Button>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Public brand guideline pages and PDF links can be fetched
                    server-side and used to prefill the guide.
                  </p>
                  {(draftGuide.styleGuideLinks || []).length > 0 && (
                    <div className="space-y-2">
                      {(draftGuide.styleGuideLinks || []).map((link, index) => (
                        <div
                          key={`${link}-${index}`}
                          className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                        >
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 truncate text-sm font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {link}
                          </a>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground"
                            onClick={() =>
                              setDraftGuide((current) => ({
                                ...current,
                                styleGuideLinks: (
                                  current.styleGuideLinks || []
                                ).filter((_, itemIndex) => itemIndex !== index),
                              }))
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Remove link</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {pendingExtraction && (
                  <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">
                          Extracted suggestions ready
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Review what we found before applying it to this brand
                          guide.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {pendingExtraction.brandName && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              applyExtractedBrandName(pendingExtraction)
                            }
                          >
                            Apply brand name
                          </Button>
                        )}
                        {(pendingExtraction.colors.length > 0 ||
                          pendingExtraction.palette.primaryForeground ||
                          pendingExtraction.palette.secondaryForeground ||
                          pendingExtraction.palette.background) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              applyExtractedColors(pendingExtraction)
                            }
                          >
                            Apply colors
                          </Button>
                        )}
                        {pendingExtraction.fonts.length > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              applyExtractedFonts(pendingExtraction)
                            }
                          >
                            Apply fonts
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          onClick={() =>
                            applyExtractionResult(pendingExtraction)
                          }
                        >
                          Apply suggestions
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingExtraction(null)}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-md border bg-background p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Brand name
                        </p>
                        <p className="mt-2 text-sm">
                          {pendingExtraction.brandName ||
                            'No brand name detected'}
                        </p>
                      </div>

                      <div className="rounded-md border bg-background p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Color candidates
                        </p>
                        {pendingExtraction.colors.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {pendingExtraction.colors.map((color) => (
                              <div
                                key={color}
                                className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
                              >
                                <span
                                  className="h-4 w-4 rounded-full border"
                                  style={{ backgroundColor: color }}
                                />
                                {color}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm">No colors detected</p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-md border bg-background p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Font candidates
                        </p>
                        {pendingExtraction.fonts.length > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              applyExtractedFonts(pendingExtraction)
                            }
                          >
                            Use these fonts
                          </Button>
                        )}
                      </div>
                      {pendingExtraction.fonts.length ? (
                        <div className="mt-2 grid gap-2 md:grid-cols-3">
                          {(
                            [
                              ['primary', 'Primary'],
                              ['secondary', 'Secondary'],
                              ['accent', 'Accent'],
                            ] as const
                          ).map(([key, label]) => (
                            <div
                              key={key}
                              className="space-y-2 rounded-md border px-3 py-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-muted-foreground">
                                  {label}
                                </p>
                                {pendingExtraction.fontRoles[key] && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() =>
                                      applyExtractedFontRole(
                                        key,
                                        pendingExtraction.fontRoles[key]
                                      )
                                    }
                                  >
                                    Use
                                  </Button>
                                )}
                              </div>
                              <p
                                className="mt-1 text-sm font-medium"
                                style={fontPreviewStyle(
                                  pendingExtraction.fontRoles[key]
                                )}
                              >
                                {pendingExtraction.fontRoles[key] ||
                                  'Not detected'}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm">No fonts detected</p>
                      )}
                      {pendingExtraction.fonts.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {pendingExtraction.fonts.map((font) => (
                            <button
                              key={font}
                              type="button"
                              className="rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-primary/5"
                              style={fontPreviewStyle(font)}
                              onClick={() => applySuggestedFont(font)}
                            >
                              {font}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-md border bg-background p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Extracted notes
                        </p>
                        {pendingExtraction.notes && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              applyExtractionNotes(pendingExtraction)
                            }
                          >
                            Add to notes
                          </Button>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-6">
                        {pendingExtraction.notes || 'No notes extracted'}
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="style-guide-notes">Style guide notes</Label>
                  <Textarea
                    id="style-guide-notes"
                    value={draftGuide.styleGuideNotes || ''}
                    onChange={(event) =>
                      setDraftGuide((current) => ({
                        ...current,
                        styleGuideNotes: event.target.value,
                      }))
                    }
                    placeholder="Optional notes from the uploaded deck or PDF that should shape the guide."
                    className={cn('min-h-24', FIELD_CLASSNAME)}
                  />
                </div>

                <div className="space-y-3">
                  <Label>Logo</Label>
                  <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed bg-muted/40 px-6 py-8 text-center transition-colors hover:bg-muted/60">
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium">Upload logo file</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      SVG uploads are supported. We keep the original logo asset
                      with the guide so it can be reused later.
                    </p>
                    <input
                      type="file"
                      className="sr-only"
                      accept="image/svg+xml,image/png,image/jpeg,image/gif,image/webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadLogo(file);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                  {draftGuide.logoAsset && (
                    <UploadedLogoPreview
                      asset={draftGuide.logoAsset}
                      onRemove={() =>
                        setDraftGuide((current) => ({
                          ...current,
                          logoAsset: undefined,
                        }))
                      }
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="guide-logo">Logo usage notes</Label>
                  <Textarea
                    id="guide-logo"
                    value={draftGuide.logoNotes || ''}
                    onChange={(event) =>
                      setDraftGuide((current) => ({
                        ...current,
                        logoNotes: event.target.value,
                      }))
                    }
                    placeholder="Clear space, preferred placement, reversed logo rules, contrast guidance, do not redraw..."
                    className={cn('min-h-28', FIELD_CLASSNAME)}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" onClick={() => void saveGuide()}>
                    {status === 'saving' ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : status === 'saved' ? (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    ) : null}
                    {status === 'saved' ? 'Saved' : 'Save brand guide'}
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <Link href="/a-plus">Use in A+ builder</Link>
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Save reusable brand settings here, then apply the guide
                    inside the builder.
                  </p>
                </div>

                {status === 'error' && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {validationMessage ||
                      'Could not save this brand guide. Try again in a moment.'}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
