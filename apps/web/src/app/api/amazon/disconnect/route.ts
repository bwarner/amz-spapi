import { NextResponse, type NextRequest } from 'next/server';
import { auth0 } from '../../../../lib/auth0';
import { getCredentialStore } from '../../../../lib/credential-store';
import { AmazonApiTypeSchema } from '@farvisionllc/models';

/**
 * DELETE /api/amazon/disconnect
 * Removes stored Amazon credentials for the current user.
 *
 * Query params:
 *   apiType: 'SP_API' | 'ADS_API'
 *   profile: profile name (default: 'default')
 */
export async function DELETE(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const rawApiType = searchParams.get('apiType');
  const profileName = searchParams.get('profile') || 'default';

  const parseResult = AmazonApiTypeSchema.safeParse(rawApiType);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid apiType. Must be SP_API or ADS_API.' },
      { status: 400 }
    );
  }

  const apiType = parseResult.data;
  const userId = session.user.sub;
  const credStore = getCredentialStore();

  try {
    await credStore.deleteProfile(profileName, apiType, userId);
    return NextResponse.json({ success: true, message: `${apiType} account disconnected.` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to disconnect account';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
