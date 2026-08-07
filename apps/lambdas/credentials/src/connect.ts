import { upsertDocument } from '@amz-spapi/couchbase-utils';
import { getAmazonOAuthApp } from '@amz-spapi/aws-secrets';
import {
  ADS_API_ENDPOINTS,
  AmazonApiTypeSchema,
  CREDENTIALS_COLLECTION,
  CREDENTIALS_DOMAIN,
  MARKETPLACE_REGIONS,
  credentialDocKey,
  defaultProfileDocKey,
  toPublicProfile,
  type AmazonApiType,
  type AmazonRegion,
  type PublicCredentialProfile,
  type StoredCredentialProfile,
} from '@farvisionllc/models';
import { z } from 'zod';
import { encryptSecrets } from './kms.js';
import { authorizationCodeGrant, type ServiceFailure } from './lwa.js';

/**
 * Completing an Amazon OAuth connection, behind the private API (#55, step 3).
 *
 * ## Why the callback itself stays in the BFF
 *
 * The redirect URI is registered with Amazon and is a browser redirect target,
 * so moving it to API Gateway would mean re-registering it in both LWA
 * applications and giving the gateway a public unauthenticated route — the one
 * route that cannot carry an Auth0 token, because the user is arriving from
 * Amazon rather than from us. Keeping it in the BFF preserves the session
 * cookie that says whose connection this is.
 *
 * ## What that costs, and why it is nothing
 *
 * The BFF holds the authorization CODE. A code is single-use, expires in
 * minutes, and is worthless without the client secret — which is here. So the
 * refresh token, the thing that is actually long-lived and actually dangerous,
 * is minted inside this function and never exists in the Vercel runtime at all.
 *
 * ## The identity rule is unchanged
 *
 * `userId` is NOT in the request body. It comes from the JWT the gateway
 * verified, exactly as it does for every other route here. The OAuth `state`
 * blob carries a `userId` too, and this function deliberately never sees it:
 * state is a CSRF token the BFF checks against its own cookie, not a claim
 * about identity, and treating it as one would let anyone who could forge a
 * state blob write a credential into someone else's account.
 */

/**
 * What the BFF may say.
 *
 * Parsed rather than trusted. Everything here is either short-lived and
 * useless alone (`code`), or a non-secret identifier that Amazon itself
 * validates (`redirectUri`, `marketplaceId`). Nothing in this body grants
 * anything on its own.
 */
export const ConnectRequestSchema = z.object({
  apiType: AmazonApiTypeSchema,
  /** Single-use, minutes-long, worthless without the client secret. */
  code: z.string().min(1),
  /** From the state the BFF minted at authorize time. */
  profileName: z.string().min(1).max(200),
  marketplaceId: z.string().min(1),
  /**
   * Must match the URI the authorize request used, and Amazon checks that.
   * Passed by the BFF because it is per-deployment — local, staging and
   * production each have their own — while one Lambda stage serves all of a
   * stage's front ends.
   *
   * Not a second authorisation: the code is already bound to the real URI, so
   * a caller supplying a different one gets `invalid_grant` and nothing else.
   *
   * Constrained to `https:` explicitly, because `z.string().url()` accepts ANY
   * scheme — `javascript:` and `data:` included — and "it is a URL" is not the
   * property wanted here. A registered LWA redirect URI is always https.
   */
  redirectUri: z.string().refine(
    (value) => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'redirectUri must be an https URL' }
  ),
  /** SP-API only; Amazon returns it on the callback. */
  sellerId: z.string().optional(),
});

export type ConnectRequest = z.infer<typeof ConnectRequestSchema>;

export type ConnectResult =
  | {
      ok: true;
      connected: {
        profiles: PublicCredentialProfile[];
        default: string;
      };
    }
  | { ok: false; failure: ServiceFailure };

/** How long an Ads profile listing may take before the connection fails. */
const ADS_PROFILES_TIMEOUT_MS = 15_000;

export async function connect(
  userId: string,
  request: ConnectRequest
): Promise<ConnectResult> {
  const region = MARKETPLACE_REGIONS[request.marketplaceId];
  if (!region) {
    return failure(
      400,
      'BadRequest',
      `Unknown marketplace "${request.marketplaceId}".`
    );
  }

  const app = await getAmazonOAuthApp(request.apiType);
  const exchanged = await authorizationCodeGrant(
    region,
    app.clientId,
    app.clientSecret,
    request.code,
    request.redirectUri
  );
  if (!exchanged.ok) return exchanged;

  const { accessToken, refreshToken, expiresAt } = exchanged.tokens;
  if (!refreshToken) {
    // An authorization_code grant that returns no refresh token has produced a
    // connection that stops working in an hour with no way to renew it.
    // Storing it would look like success and fail silently later.
    return failure(
      502,
      'NoRefreshToken',
      'Amazon completed the exchange but returned no refresh token, so the ' +
        'connection could not be renewed. Check the application’s scopes.'
    );
  }

  const now = Date.now();

  // One login can cover many advertiser accounts, so Ads fans out into a
  // profile per advertiser while SP-API is always exactly one.
  const targets =
    request.apiType === 'ADS_API'
      ? await adsTargets(accessToken, app.clientId, region, request)
      : {
          ok: true as const,
          targets: [
            {
              profileName: request.profileName,
              marketplaceId: request.marketplaceId,
              region,
              sellerId: request.sellerId,
            },
          ],
        };
  if (!targets.ok) return targets;

  if (targets.targets.length === 0) {
    return failure(
      409,
      'NoAdvertiserProfiles',
      'Amazon Ads authorisation succeeded, but this login has no advertiser ' +
        'profiles. Check that the account has an advertising account in this ' +
        'marketplace.'
    );
  }

  const stored: PublicCredentialProfile[] = [];
  for (const target of targets.targets) {
    const key = credentialDocKey(target.profileName, request.apiType, userId);
    const context = {
      userId,
      apiType: request.apiType,
      profileName: target.profileName,
    };

    const document: StoredCredentialProfile = {
      profile_name: target.profileName,
      api_type: request.apiType,
      user_id: userId,
      client_id: app.clientId,
      marketplace_id: target.marketplaceId,
      region: target.region,
      ...(target.sellerId ? { seller_id: target.sellerId } : {}),
      ...(target.advertiserProfileId
        ? { advertiser_profile_id: target.advertiserProfileId }
        : {}),
      created_at: now,
      updated_at: now,
      // `client_secret` is stored because the shape still carries it, and it is
      // the application's own — not the seller's. It is read by nothing: the
      // authority is Secrets Manager, and this field goes when the last
      // pre-#55 reader does.
      encrypted_secrets: await encryptSecrets(
        {
          client_secret: app.clientSecret,
          refresh_token: refreshToken,
          access_token: accessToken,
        },
        context
      ),
      has_refresh_token: true,
      access_token_expires_at: expiresAt,
    };

    await upsertDocument(
      CREDENTIALS_DOMAIN,
      CREDENTIALS_COLLECTION,
      key,
      document
    );

    // The allow-list schema, so nothing added to storage later can ride back
    // out in a response by being spread into one.
    stored.push(toPublicProfile(document, { hasRefreshToken: true }));
  }

  // Whatever was connected most recently becomes the default, matching what
  // the BFF did before. Written after the profiles, so a failure part-way
  // leaves a default pointing at something that exists.
  const defaultProfile = stored[0].profile_name;
  await upsertDocument(
    CREDENTIALS_DOMAIN,
    CREDENTIALS_COLLECTION,
    defaultProfileDocKey(request.apiType, userId),
    { profileName: defaultProfile }
  );

  return { ok: true, connected: { profiles: stored, default: defaultProfile } };
}

type ConnectTarget = {
  profileName: string;
  marketplaceId: string;
  region: AmazonRegion;
  sellerId?: string;
  advertiserProfileId?: string;
};

/**
 * One Ads login expanded into a profile per advertiser account.
 *
 * `GET /v2/profiles` is the only way to learn what the authorisation actually
 * covers — the consent screen does not say, and an advertiser profile id is
 * required on every subsequent Ads call. Done here rather than in the BFF
 * because it needs the access token, and the access token is here.
 *
 * Plain `fetch` rather than `@farvisionllc/ad-client`: this is one GET with
 * three headers, and the client exists to manage a token lifecycle that a
 * seconds-old token does not have. Pulling it in would also pull axios into a
 * bundle that currently has no CJS dependency to trip over.
 */
async function adsTargets(
  accessToken: string,
  clientId: string,
  region: AmazonRegion,
  request: ConnectRequest
): Promise<
  | { ok: true; targets: ConnectTarget[] }
  | { ok: false; failure: ServiceFailure }
> {
  const endpoint = `${ADS_API_ENDPOINTS[region]}/v2/profiles`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Amazon-Advertising-API-ClientId': clientId,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(ADS_PROFILES_TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      ok: false,
      failure: {
        status: 502,
        error: 'UpstreamFailure',
        detail: `Could not reach ${endpoint}: ${
          cause instanceof Error ? cause.name : 'unknown error'
        }.`,
      },
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      failure: {
        status: 502,
        error: 'AdsProfilesFailed',
        // No body: an Ads error body can echo the request, and the request
        // carried the access token in a header.
        detail:
          `Amazon Ads returned ${response.status} listing advertiser ` +
          'profiles, so the connection could not be completed.',
      },
    };
  }

  const parsed = AdsProfilesSchema.safeParse(await response.json());
  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        status: 502,
        error: 'AdsProfilesFailed',
        detail:
          'Amazon Ads returned an advertiser profile list we could not read.',
      },
    };
  }

  const targets = parsed.data.flatMap((profile) => {
    const advertiserProfileId = String(
      profile.profileId ?? profile.profile_id ?? profile.id ?? ''
    );
    if (!advertiserProfileId) return [];

    const marketplaceId =
      profile.marketplaceId ||
      profile.accountInfo?.marketplaceId ||
      profile.accountInfo?.marketplaceStringId ||
      request.marketplaceId;

    return [
      {
        profileName: adsProfileName(
          request.profileName,
          marketplaceId,
          advertiserProfileId,
          profile.accountInfo?.name
        ),
        marketplaceId,
        // Per advertiser: one login can cover marketplaces in more than one
        // region, and the region decides which Ads host answers.
        region: MARKETPLACE_REGIONS[marketplaceId] || region,
        advertiserProfileId,
      },
    ];
  });

  return { ok: true, targets };
}

/**
 * Amazon's profile listing, as much of it as matters.
 *
 * The three id spellings are not defensiveness for its own sake — the previous
 * BFF implementation accepted all three, so profiles in the database were named
 * from whichever one Amazon happened to send. Narrowing it now would rename
 * connections on reconnect.
 */
const AdsProfilesSchema = z.array(
  z.object({
    profileId: z.union([z.number(), z.string()]).optional(),
    profile_id: z.union([z.number(), z.string()]).optional(),
    id: z.union([z.number(), z.string()]).optional(),
    marketplaceId: z.string().optional(),
    accountInfo: z
      .object({
        name: z.string().optional(),
        marketplaceId: z.string().optional(),
        marketplaceStringId: z.string().optional(),
      })
      .optional(),
  })
);

/**
 * A profile name a person can recognise in a list.
 *
 * Byte-for-byte what the BFF produced, because the name is the document key: a
 * different rule would make every reconnect create a second profile beside the
 * first rather than updating it.
 */
function adsProfileName(
  baseName: string,
  marketplaceId: string,
  advertiserProfileId: string,
  accountName?: string
): string {
  const slug = accountName
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);

  return `${baseName}-${
    slug ? `${slug}-` : ''
  }${marketplaceId}-${advertiserProfileId}`;
}

function failure(
  status: number,
  error: string,
  detail: string
): { ok: false; failure: ServiceFailure } {
  return { ok: false, failure: { status, error, detail } };
}

export type { AmazonApiType };
