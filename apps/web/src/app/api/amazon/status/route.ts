import { auth0 } from '../../../../lib/auth0';
import { getCredentialStore } from '../../../../lib/credential-store';

/**
 * GET /api/amazon/status
 * Returns Amazon account connection status and list of connected profiles for the current user.
 */
export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.sub;
  const credStore = getCredentialStore();

  let spProfiles: any[] = [];
  let adsProfiles: any[] = [];

  try {
    spProfiles = await credStore.listFullProfiles('SP_API', userId);
  } catch {
    // Not connected or Couchbase unavailable
  }

  try {
    adsProfiles = await credStore.listFullProfiles('ADS_API', userId);
  } catch {
    // Not connected or Couchbase unavailable
  }

  return Response.json({
    sp_api: {
      connected: spProfiles.length > 0,
      profiles: spProfiles,
    },
    ads_api: {
      connected: adsProfiles.length > 0,
      profiles: adsProfiles,
    },
  });
}
