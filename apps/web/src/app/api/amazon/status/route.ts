import { auth0 } from '../../../../lib/auth0';
import { listAmazonConnections } from '../../../../lib/amazon-connections';
import type { CredentialProfileView } from '../../../../services/credential-service';

/**
 * GET /api/amazon/status — which Amazon accounts this user has connected.
 *
 * The local "public profile" projection this used to carry is gone (#55). It
 * hand-copied eight fields off a full profile to leave the secrets behind — a
 * deny-list, and one that would have leaked anything added to the profile later.
 * What arrives now is already the allow-listed view: there is no secret in the
 * type, so there is nothing to strip.
 */
type StatusProfile = Pick<
  CredentialProfileView,
  | 'profile_name'
  | 'api_type'
  | 'marketplace_id'
  | 'region'
  | 'seller_id'
  | 'advertiser_profile_id'
  | 'created_at'
  | 'updated_at'
  | 'has_refresh_token'
>;

type Section = {
  connected: boolean;
  profiles: StatusProfile[];
  /**
   * True when the answer is "we could not find out", as distinct from "none".
   *
   * These used to be identical: the failure was swallowed and reported as an
   * empty list, so an unreachable API rendered as "your Amazon account is not
   * connected" — wrong, and unfixable by whoever read it, since reconnecting is
   * not the problem. The UI can now say something true instead.
   */
  unavailable: boolean;
};

function project(profile: CredentialProfileView): StatusProfile {
  return {
    profile_name: profile.profile_name,
    api_type: profile.api_type,
    marketplace_id: profile.marketplace_id,
    region: profile.region,
    seller_id: profile.seller_id,
    advertiser_profile_id: profile.advertiser_profile_id,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
    has_refresh_token: profile.has_refresh_token,
  };
}

async function section(apiType: 'SP_API' | 'ADS_API'): Promise<Section> {
  try {
    const connections = await listAmazonConnections({ apiType });
    const profiles = connections.map((connection) =>
      project(connection.profile)
    );
    return { connected: profiles.length > 0, profiles, unavailable: false };
  } catch (error) {
    console.error('[amazon/status] could not list connections', apiType, error);
    return { connected: false, profiles: [], unavailable: true };
  }
}

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [sp, ads] = await Promise.all([section('SP_API'), section('ADS_API')]);

  return Response.json({ sp_api: sp, ads_api: ads });
}
