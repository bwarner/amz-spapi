import { auth0 } from '../../../../lib/auth0';
import {
  createBrandGuideId,
  getBrandGuide,
  listBrandGuides,
  upsertBrandGuide,
} from '../../../../lib/a-plus-drafts';

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const brandGuides = await listBrandGuides(session.user.sub);
  return Response.json({ brandGuides });
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    brandGuideId?: unknown;
    name?: unknown;
    brandName?: unknown;
    colors?: unknown;
    palette?: unknown;
    fonts?: unknown;
    voice?: unknown;
    logoAsset?: unknown;
    logoNotes?: unknown;
    styleGuideFiles?: unknown;
    styleGuideLinks?: unknown;
    styleGuideNotes?: unknown;
  };

  const palette =
    typeof body.palette === 'object' &&
    body.palette !== null &&
    !Array.isArray(body.palette)
      ? {
          primaryForeground:
            typeof (body.palette as { primaryForeground?: unknown })
              .primaryForeground === 'string'
              ? (body.palette as { primaryForeground?: string })
                  .primaryForeground
              : undefined,
          secondaryForeground:
            typeof (body.palette as { secondaryForeground?: unknown })
              .secondaryForeground === 'string'
              ? (body.palette as { secondaryForeground?: string })
                  .secondaryForeground
              : undefined,
          background:
            typeof (body.palette as { background?: unknown }).background ===
            'string'
              ? (body.palette as { background?: string }).background
              : undefined,
        }
      : undefined;

  const fonts =
    typeof body.fonts === 'object' &&
    body.fonts !== null &&
    !Array.isArray(body.fonts)
      ? {
          primary:
            typeof (body.fonts as { primary?: unknown }).primary === 'string'
              ? (body.fonts as { primary?: string }).primary
              : undefined,
          secondary:
            typeof (body.fonts as { secondary?: unknown }).secondary ===
            'string'
              ? (body.fonts as { secondary?: string }).secondary
              : undefined,
          accent:
            typeof (body.fonts as { accent?: unknown }).accent === 'string'
              ? (body.fonts as { accent?: string }).accent
              : undefined,
        }
      : undefined;

  if (
    !palette?.primaryForeground ||
    !palette.secondaryForeground ||
    !palette.background
  ) {
    return Response.json(
      {
        error:
          'Brand guides require a primary foreground color, a secondary foreground color, and a background color.',
      },
      { status: 400 }
    );
  }

  const brandGuideId =
    typeof body.brandGuideId === 'string' && body.brandGuideId
      ? body.brandGuideId
      : createBrandGuideId();
  const existing = await getBrandGuide({
    userId: session.user.sub,
    brandGuideId,
  });

  const brandGuide = await upsertBrandGuide({
    brandGuideId,
    userId: session.user.sub,
    name:
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : 'Untitled brand guide',
    brandName: typeof body.brandName === 'string' ? body.brandName : undefined,
    colors: typeof body.colors === 'string' ? body.colors : undefined,
    palette,
    fonts,
    voice: typeof body.voice === 'string' ? body.voice : undefined,
    logoAsset:
      typeof body.logoAsset === 'object' &&
      body.logoAsset !== null &&
      !Array.isArray(body.logoAsset) &&
      typeof (body.logoAsset as { assetId?: unknown }).assetId === 'string' &&
      typeof (body.logoAsset as { originalFileName?: unknown })
        .originalFileName === 'string' &&
      typeof (body.logoAsset as { mimeType?: unknown }).mimeType === 'string' &&
      typeof (body.logoAsset as { sizeBytes?: unknown }).sizeBytes ===
        'number' &&
      typeof (body.logoAsset as { storage?: unknown }).storage === 'object' &&
      (body.logoAsset as { storage: { bucket?: unknown; key?: unknown } })
        .storage !== null &&
      typeof (body.logoAsset as { storage: { bucket?: unknown } }).storage
        .bucket === 'string' &&
      typeof (body.logoAsset as { storage: { key?: unknown } }).storage.key ===
        'string'
        ? {
            assetId: (body.logoAsset as { assetId: string }).assetId,
            originalFileName: (body.logoAsset as { originalFileName: string })
              .originalFileName,
            mimeType: (body.logoAsset as { mimeType: string }).mimeType,
            sizeBytes: (body.logoAsset as { sizeBytes: number }).sizeBytes,
            storage: {
              provider: 's3' as const,
              bucket: (body.logoAsset as { storage: { bucket: string } })
                .storage.bucket,
              key: (body.logoAsset as { storage: { key: string } }).storage.key,
            },
          }
        : undefined,
    logoNotes: typeof body.logoNotes === 'string' ? body.logoNotes : undefined,
    styleGuideFiles: Array.isArray(body.styleGuideFiles)
      ? body.styleGuideFiles
          .map((file) =>
            typeof file === 'object' && file !== null
              ? {
                  name:
                    typeof (file as { name?: unknown }).name === 'string'
                      ? (file as { name: string }).name
                      : '',
                  mimeType:
                    typeof (file as { mimeType?: unknown }).mimeType ===
                    'string'
                      ? (file as { mimeType: string }).mimeType
                      : 'application/octet-stream',
                  sizeBytes:
                    typeof (file as { sizeBytes?: unknown }).sizeBytes ===
                    'number'
                      ? (file as { sizeBytes: number }).sizeBytes
                      : 0,
                  lastModified:
                    typeof (file as { lastModified?: unknown }).lastModified ===
                    'number'
                      ? (file as { lastModified: number }).lastModified
                      : 0,
                }
              : null
          )
          .filter(
            (
              file
            ): file is {
              name: string;
              mimeType: string;
              sizeBytes: number;
              lastModified: number;
            } => Boolean(file?.name)
          )
      : undefined,
    styleGuideLinks: Array.isArray(body.styleGuideLinks)
      ? body.styleGuideLinks.filter(
          (item): item is string => typeof item === 'string' && item.length > 0
        )
      : undefined,
    styleGuideNotes:
      typeof body.styleGuideNotes === 'string'
        ? body.styleGuideNotes
        : undefined,
    createdAt: existing?.createdAt,
  });

  return Response.json({ brandGuide });
}
