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
    voice?: unknown;
    logoNotes?: unknown;
  };

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
    voice: typeof body.voice === 'string' ? body.voice : undefined,
    logoNotes: typeof body.logoNotes === 'string' ? body.logoNotes : undefined,
    createdAt: existing?.createdAt,
  });

  return Response.json({ brandGuide });
}
