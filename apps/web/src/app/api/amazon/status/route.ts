import { auth0 } from '../../../../lib/auth0';
import type { AmazonCredentialProfile } from '@farvisionllc/models';
import { listAmazonConnections } from '../../../../lib/amazon-connections';

type PublicProfile = ReturnType<typeof toPublicProfile>;

function toPublicProfile(profile: AmazonCredentialProfile) {
  return {
    profile_name: profile.profile_name,
    api_type: profile.api_type,
    marketplace_id: profile.marketplace_id,
    region: profile.region,
    seller_id: profile.seller_id,
    advertiser_profile_id: profile.advertiser_profile_id,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}

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
  let spProfiles: PublicProfile[] = [];
  let adsProfiles: PublicProfile[] = [];

  try {
    spProfiles = (
      await listAmazonConnections({
        apiType: 'SP_API',
        userId,
      })
    ).map((connection) => toPublicProfile(connection.profile));
  } catch {
    // Not connected or credential store unavailable
  }

  try {
    adsProfiles = (
      await listAmazonConnections({
        apiType: 'ADS_API',
        userId,
      })
    ).map((connection) => toPublicProfile(connection.profile));
  } catch {
    // Not connected or credential store unavailable
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
